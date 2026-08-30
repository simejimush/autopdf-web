import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { executeRule } from "@/lib/runs/executeRule";
import { isFreePlanOverflowRule } from "@/lib/rules/freePlanLimit";
import { claimExecutionGuard } from "@/lib/cost-safety/executionGuard";
import { getRunErrorMessage } from "@/lib/runs/getRunErrorMessage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(_req: NextRequest, context: RouteContext) {
  const supabase = await createSupabaseServerClient();

  try {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: ruleId } = await context.params;

    if (!ruleId || !isUuid(ruleId)) {
      return NextResponse.json({ error: "Invalid rule id" }, { status: 400 });
    }

    const { data: rule, error: ruleErr } = await supabase
      .from("rules")
      .select("id, user_id")
      .eq("id", ruleId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (ruleErr) {
      return NextResponse.json(
        { error: "Failed to fetch rule" },
        { status: 500 },
      );
    }

    if (!rule || rule.id !== ruleId || rule.user_id !== user.id) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const overflowCheck = await isFreePlanOverflowRule({
      userId: user.id,
      ruleId: rule.id,
    });

    if (overflowCheck.isOverflow) {
      return NextResponse.json(
        {
          error:
            "Freeプランでは4件目以降のルールは実行できません。Proに戻すと実行できます。",
          code: "FREE_PLAN_RULE_LIMIT_EXCEEDED",
        },
        { status: 403 },
      );
    }

    const claim = await claimExecutionGuard({
      userId: user.id,
      ruleId: rule.id,
      trigger: "manual",
    });

    if (!claim.claimed) {
      const safe = getRunErrorMessage(claim.errorCode);
      const status =
        claim.errorCode === "USER_RATE_LIMIT_EXCEEDED" ||
        claim.errorCode === "SYSTEM_LIMIT_EXCEEDED"
          ? 429
          : claim.errorCode === "GUARD_STORE_FAILED"
            ? 503
            : 409;
      return NextResponse.json(
        { error: safe.action ?? safe.message, code: claim.errorCode },
        { status },
      );
    }

    const result = await executeRule({
      ruleId: rule.id,
      userId: user.id,
      runId: claim.runId,
      leaseIdHash: claim.leaseIdHash,
      trigger: "manual",
    });

    return NextResponse.json({
      ok: result.ok,
      runId: claim.runId,
      message: result.message,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
