import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { executeRule } from "@/lib/runs/executeRule";
import { isFreePlanOverflowRule } from "@/lib/rules/freePlanLimit";

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

    if (!rule) {
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

    const startedAt = new Date().toISOString();

    const { data: run, error: runErr } = await supabase
      .from("runs")
      .insert({
        user_id: user.id,
        rule_id: rule.id,
        trigger: "manual",
        status: "running",
        processed_count: 0,
        saved_count: 0,
        skipped_count: 0,
        message: "Run started",
        started_at: startedAt,
      })
      .select("id, status, started_at")
      .single();

    if (runErr) {
      return NextResponse.json({ error: runErr.message }, { status: 500 });
    }

    const result = await executeRule({
      ruleId: rule.id,
      userId: user.id,
      runId: run.id,
      trigger: "manual",
    });

    return NextResponse.json({
      ok: result.ok,
      runId: run.id,
      message: result.message,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
