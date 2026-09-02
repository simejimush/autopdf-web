import { NextResponse } from "next/server";
import { executeRule } from "@/lib/runs/executeRule";
import { getFreePlanOverflowRuleIds } from "@/lib/rules/freePlanLimit";
import { claimExecutionGuard } from "@/lib/cost-safety/executionGuard";
import { readExecutionDisabledFromEnv } from "@/lib/cost-safety/killSwitch";
import { listCronCandidates } from "@/lib/runs/guardedExecutionRepository";

type CronResultRow = {
  id: string;
  ok: boolean;
  runId?: string;
  error?: string;
  message?: string;
};

export async function GET(req: Request) {
  const authorization = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected?.trim() || authorization !== "Bearer " + expected) {
    console.error("[cron] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (readExecutionDisabledFromEnv(process.env)) {
    console.warn("[cron] Execution disabled");
    return NextResponse.json({ message: "Cron disabled" });
  }

  console.log("[cron] Cron triggered");

  let candidates: Awaited<ReturnType<typeof listCronCandidates>>;
  try {
    candidates = await listCronCandidates();
  } catch {
    console.error("[cron] Failed to fetch candidates");
    return NextResponse.json(
      { error: "Failed to fetch cron candidates" },
      { status: 500 },
    );
  }

  const overflowRuleIds = new Set<string>();
  const userIds = Array.from(
    new Set(candidates.map((candidate) => candidate.userId)),
  );

  try {
    for (const userId of userIds) {
      const ids = await getFreePlanOverflowRuleIds(userId);

      for (const id of ids) {
        overflowRuleIds.add(id);
      }
    }
  } catch {
    console.error("[cron] Failed to evaluate plan limits");
    return NextResponse.json(
      { error: "Failed to prepare cron candidates" },
      { status: 500 },
    );
  }

  const runnableCandidates = candidates.filter(
    (candidate) => !overflowRuleIds.has(candidate.ruleId),
  );

  console.log(
    "[cron] total rules:",
    candidates.length,
    "enabled:",
    candidates.length,
    "runnable:",
    runnableCandidates.length,
    "free_overflow_skipped:",
    candidates.length - runnableCandidates.length,
  );

  let ok = 0;
  let ng = 0;

  const results: CronResultRow[] = [];

  for (const candidate of runnableCandidates) {
    try {
      const claim = await claimExecutionGuard({
        userId: candidate.userId,
        ruleId: candidate.ruleId,
        trigger: "cron",
      });

      if (!claim.claimed) {
        ng++;
        console.error("[cron] Execution guard rejected", {
          code: claim.errorCode,
        });
        results.push({
          id: candidate.ruleId,
          ok: false,
          error: claim.errorCode,
        });
        if (
          claim.errorCode === "SYSTEM_LIMIT_EXCEEDED" ||
          claim.errorCode === "GUARD_STORE_FAILED"
        ) {
          console.error(
            "[cron] Stopping after systemic execution guard rejection",
            {
              code: claim.errorCode,
            },
          );
          break;
        }
        continue;
      }

      const result = await executeRule({
        ruleId: candidate.ruleId,
        userId: candidate.userId,
        runId: claim.runId,
        leaseIdHash: claim.leaseIdHash,
        trigger: "cron",
      });

      if (result.ok) ok++;
      else ng++;

      console.log("[cron] rule done:", candidate.ruleId, "ok:", result.ok);

      results.push({
        id: candidate.ruleId,
        ok: result.ok,
        runId: claim.runId,
        message: result.message,
        ...(result.ok ? {} : { error: result.errorCode ?? "UNKNOWN" }),
      });
    } catch {
      ng++;
      console.error("[cron] rule failed");

      results.push({
        id: candidate.ruleId,
        ok: false,
        error: "UNKNOWN",
      });
    }
  }

  return NextResponse.json({
    message: "Cron finished",
    total_rules: candidates.length,
    enabled_rules: candidates.length,
    runnable_rules: runnableCandidates.length,
    free_overflow_skipped: candidates.length - runnableCandidates.length,
    ok,
    ng,
    results,
  });
}
