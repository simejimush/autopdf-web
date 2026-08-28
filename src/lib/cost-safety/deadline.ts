import "server-only";

import {
  DB_FINALIZATION_RESERVE_MS,
  EXECUTION_ABSOLUTE_DEADLINE_MS,
} from "@/lib/cost-safety/limits";

function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isValidPositiveDuration(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Number.isFinite(value) &&
    value > 0
  );
}

export function getExecutionDeadlineMs(
  executionStartedAtMs: unknown,
): number | null {
  if (!isValidTimestamp(executionStartedAtMs)) {
    return null;
  }

  const deadline = executionStartedAtMs + EXECUTION_ABSOLUTE_DEADLINE_MS;

  return Number.isSafeInteger(deadline) ? deadline : null;
}

export function getAllowedStageTimeoutMs(input: {
  executionStartedAtMs: unknown;
  currentTimeMs: unknown;
  stageRemainingMs: unknown;
}): number | null {
  if (
    !isValidTimestamp(input.executionStartedAtMs) ||
    !isValidTimestamp(input.currentTimeMs) ||
    !isValidPositiveDuration(input.stageRemainingMs) ||
    input.currentTimeMs < input.executionStartedAtMs
  ) {
    return null;
  }

  const deadline = getExecutionDeadlineMs(input.executionStartedAtMs);

  if (deadline === null) {
    return null;
  }

  const absoluteRemainingMs = deadline - input.currentTimeMs;
  const providerBudgetMs = absoluteRemainingMs - DB_FINALIZATION_RESERVE_MS;

  if (!Number.isSafeInteger(providerBudgetMs) || providerBudgetMs <= 0) {
    return null;
  }

  const allowedStageMs = Math.min(input.stageRemainingMs, providerBudgetMs);

  return allowedStageMs > 0 ? allowedStageMs : null;
}
