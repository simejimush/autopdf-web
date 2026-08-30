import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { executeRule } from "@/lib/runs/executeRule";
import { getFreePlanOverflowRuleIds } from "@/lib/rules/freePlanLimit";
import { claimExecutionGuard } from "@/lib/cost-safety/executionGuard";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RuleRow = {
  id?: string;
  user_id?: string | null;
  is_enabled?: boolean | null;
  enabled?: boolean | null;
  is_active?: boolean | null;
  created_at?: string | null;
};

type CronResultRow = {
  id: string;
  ok: boolean;
  runId?: string;
  error?: string;
  message?: string;
};

function isEnabledRule(rule: RuleRow): boolean {
  const value = rule.is_active ?? rule.is_enabled ?? rule.enabled;
  return value === undefined ? true : Boolean(value);
}

function hasValidIdentity(
  rule: RuleRow,
): rule is RuleRow & { id: string; user_id: string } {
  return (
    UUID_PATTERN.test(rule.id ?? "") && UUID_PATTERN.test(rule.user_id ?? "")
  );
}

export async function GET(req: Request) {
  const authorization = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected?.trim() || authorization !== "Bearer " + expected) {
    console.error("[cron] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron] Cron triggered");

  // 互換性優先で * 取得し、JS側で有効判定する
  const { data, error } = await supabaseAdmin.from("rules").select("*");

  if (error) {
    console.error("[cron] Failed to fetch rules");
    return NextResponse.json(
      { error: "Failed to fetch rules" },
      { status: 500 },
    );
  }

  const rules = (Array.isArray(data) ? data : []).map((rule) =>
    rule && typeof rule === "object" ? (rule as RuleRow) : ({} as RuleRow),
  );
  const enabledRules = rules.filter(isEnabledRule);

  const ruleIdCounts = new Map<string, number>();
  for (const rule of enabledRules) {
    const ruleId = rule.id ?? "";
    ruleIdCounts.set(ruleId, (ruleIdCounts.get(ruleId) ?? 0) + 1);
  }

  const validUniqueRules = enabledRules.filter(
    (rule) => hasValidIdentity(rule) && ruleIdCounts.get(rule.id) === 1,
  );

  const overflowRuleIds = new Set<string>();
  const userIds = Array.from(
    new Set(
      validUniqueRules
        .map((rule) => rule.user_id)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  );

  for (const userId of userIds) {
    const ids = await getFreePlanOverflowRuleIds(userId);

    for (const id of ids) {
      overflowRuleIds.add(id);
    }
  }

  const runnableRules = enabledRules.filter(
    (rule) => !overflowRuleIds.has(rule.id ?? ""),
  );

  console.log(
    "[cron] total rules:",
    rules.length,
    "enabled:",
    enabledRules.length,
    "runnable:",
    runnableRules.length,
    "free_overflow_skipped:",
    enabledRules.length - runnableRules.length,
  );

  let ok = 0;
  let ng = 0;

  const results: CronResultRow[] = [];

  for (const rule of runnableRules) {
    try {
      if (!hasValidIdentity(rule) || ruleIdCounts.get(rule.id ?? "") !== 1) {
        ng++;
        console.error("[cron] Skip invalid rule row");
        results.push({
          id: UUID_PATTERN.test(rule.id ?? "") ? rule.id! : "(unknown)",
          ok: false,
          error: "RUN_STORE_INPUT_INVALID",
        });
        continue;
      }

      const claim = await claimExecutionGuard({
        userId: rule.user_id,
        ruleId: rule.id,
        trigger: "cron",
      });

      if (!claim.claimed) {
        ng++;
        console.error("[cron] Execution guard rejected", {
          code: claim.errorCode,
        });
        results.push({
          id: rule.id,
          ok: false,
          error: claim.errorCode,
        });
        continue;
      }

      const result = await executeRule({
        ruleId: rule.id,
        userId: rule.user_id,
        runId: claim.runId,
        leaseIdHash: claim.leaseIdHash,
        trigger: "cron",
      });

      if (result.ok) ok++;
      else ng++;

      console.log("[cron] rule done:", rule.id, "ok:", result.ok);

      results.push({
        id: rule.id,
        ok: result.ok,
        runId: claim.runId,
        message: result.message,
        ...(result.ok ? {} : { error: result.errorCode ?? "UNKNOWN" }),
      });
    } catch {
      ng++;
      console.error("[cron] rule failed");

      results.push({
        id: UUID_PATTERN.test(rule.id ?? "") ? rule.id! : "(unknown)",
        ok: false,
        error: "UNKNOWN",
      });
    }
  }

  return NextResponse.json({
    message: "Cron finished",
    total_rules: rules.length,
    enabled_rules: enabledRules.length,
    runnable_rules: runnableRules.length,
    free_overflow_skipped: enabledRules.length - runnableRules.length,
    ok,
    ng,
    results,
  });
}
