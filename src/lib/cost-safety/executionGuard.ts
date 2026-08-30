import "server-only";

import { getRunErrorMessage } from "@/lib/runs/getRunErrorMessage";
import {
  claimGuardedExecution,
  type GuardedExecutionClaim,
} from "@/lib/runs/guardedExecutionRepository";
import { notifySlack } from "@/lib/monitoring/notifySlack";

export type ExecutionGuardResult =
  | GuardedExecutionClaim
  | Readonly<{ claimed: false; errorCode: "GUARD_STORE_FAILED" }>;

const ADMIN_NOTIFY_CODES = new Set([
  "SYSTEM_LIMIT_EXCEEDED",
  "GUARD_STORE_FAILED",
]);

async function notifyGuardFailure(input: {
  errorCode: string;
  userId: string;
  ruleId: string;
  trigger: "manual" | "cron";
}): Promise<void> {
  if (!ADMIN_NOTIFY_CODES.has(input.errorCode)) return;

  const safe = getRunErrorMessage(input.errorCode);
  try {
    await notifySlack({
      errorCode: input.errorCode,
      message: `${safe.title}。${safe.action ?? safe.message}`,
      userId: input.userId,
      ruleId: input.ruleId,
      trigger: input.trigger,
      occurredAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[executionGuard] Slack notify failed", {
      code: "SLACK_NOTIFY_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function claimExecutionGuard(input: {
  userId: string;
  ruleId: string;
  trigger: "manual" | "cron";
}): Promise<ExecutionGuardResult> {
  let result: ExecutionGuardResult;
  try {
    result = await claimGuardedExecution(input);
  } catch {
    result = Object.freeze({
      claimed: false,
      errorCode: "GUARD_STORE_FAILED" as const,
    });
  }

  if (!result.claimed) {
    await notifyGuardFailure({ ...input, errorCode: result.errorCode });
  }

  return result;
}
