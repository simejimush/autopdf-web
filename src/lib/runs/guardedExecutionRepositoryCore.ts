import type { RunFinalization } from "@/lib/runs/runUpdateRepositoryCore";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_HASH_PATTERN = /^[0-9a-f]{64}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const EXECUTION_GUARD_REJECTION_CODES = [
  "SYSTEM_LIMIT_EXCEEDED",
  "USER_RATE_LIMIT_EXCEEDED",
  "EXECUTION_CONCURRENCY_LIMIT",
  "RUN_ALREADY_RUNNING",
] as const;

export type ExecutionGuardRejectionCode =
  (typeof EXECUTION_GUARD_REJECTION_CODES)[number];

export type GuardedExecutionRepositoryErrorCode = "GUARD_STORE_FAILED";

export class GuardedExecutionRepositoryError extends Error {
  readonly code: GuardedExecutionRepositoryErrorCode;

  constructor() {
    super("Execution guard storage failed");
    this.name = "GuardedExecutionRepositoryError";
    this.code = "GUARD_STORE_FAILED";
  }
}

export type GuardedExecutionClaim =
  | Readonly<{
      claimed: true;
      runId: string;
      leaseIdHash: string;
      leaseExpiresAt: string;
    }>
  | Readonly<{
      claimed: false;
      errorCode: ExecutionGuardRejectionCode;
    }>;

type RpcResult = Readonly<{ data: unknown; error: unknown }>;

export type GuardedExecutionSupabaseClient = Readonly<{
  rpc(
    functionName: "claim_guarded_execution" | "finalize_guarded_execution",
    parameters: Readonly<Record<string, unknown>>,
  ): PromiseLike<RpcResult>;
}>;

function fail(): never {
  throw new GuardedExecutionRepositoryError();
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    Number.isFinite(Date.parse(value))
  );
}

function validateIdentity(input: {
  userId: string;
  ruleId: string;
  leaseIdHash: string;
}): void {
  if (
    !UUID_PATTERN.test(input.userId) ||
    !UUID_PATTERN.test(input.ruleId) ||
    !LEASE_HASH_PATTERN.test(input.leaseIdHash)
  ) {
    fail();
  }
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validateFinalization(finalization: RunFinalization): void {
  if (
    typeof finalization.message !== "string" ||
    finalization.message.trim().length === 0
  ) {
    fail();
  }
  if (finalization.status === "success") {
    if (
      !isCount(finalization.processedCount) ||
      !isCount(finalization.savedCount) ||
      !isCount(finalization.skippedCount)
    ) {
      fail();
    }
    return;
  }
  if (!ERROR_CODE_PATTERN.test(finalization.errorCode)) fail();
}

function getOnlyRow(result: RpcResult): Record<string, unknown> {
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
    fail();
  }

  const row = result.data[0];
  if (!row || typeof row !== "object") fail();
  return row as Record<string, unknown>;
}

export function createGuardedExecutionRepository(
  dependencies: Readonly<{
    getClient: () =>
      | GuardedExecutionSupabaseClient
      | Promise<GuardedExecutionSupabaseClient>;
    createLeaseIdHash: () => string;
  }>,
) {
  async function callRpc(
    functionName: "claim_guarded_execution" | "finalize_guarded_execution",
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    try {
      const client = await dependencies.getClient();
      return getOnlyRow(await client.rpc(functionName, parameters));
    } catch (error) {
      if (error instanceof GuardedExecutionRepositoryError) throw error;
      fail();
    }
  }

  async function claimGuardedExecution(
    input: Readonly<{
      userId: string;
      ruleId: string;
      trigger: "manual" | "cron";
    }>,
  ): Promise<GuardedExecutionClaim> {
    let leaseIdHash: string;
    try {
      leaseIdHash = dependencies.createLeaseIdHash();
    } catch {
      fail();
    }

    validateIdentity({ ...input, leaseIdHash });
    if (!["manual", "cron"].includes(input.trigger)) {
      fail();
    }

    const row = await callRpc("claim_guarded_execution", {
      p_user_id: input.userId,
      p_rule_id: input.ruleId,
      p_trigger: input.trigger,
      p_lease_id_hash: leaseIdHash,
    });

    if (row.outcome === "CLAIMED") {
      if (
        typeof row.run_id !== "string" ||
        !UUID_PATTERN.test(row.run_id) ||
        !isIsoTimestamp(row.lease_expires_at)
      ) {
        fail();
      }

      return Object.freeze({
        claimed: true,
        runId: row.run_id,
        leaseIdHash,
        leaseExpiresAt: row.lease_expires_at,
      });
    }

    if (
      typeof row.outcome === "string" &&
      EXECUTION_GUARD_REJECTION_CODES.includes(
        row.outcome as ExecutionGuardRejectionCode,
      ) &&
      row.run_id === null &&
      row.lease_expires_at === null
    ) {
      return Object.freeze({
        claimed: false,
        errorCode: row.outcome as ExecutionGuardRejectionCode,
      });
    }

    fail();
  }

  async function finalizeGuardedExecution(
    input: Readonly<{
      runId: string;
      userId: string;
      ruleId: string;
      leaseIdHash: string;
      finalization: RunFinalization;
    }>,
  ): Promise<void> {
    validateIdentity(input);
    if (!UUID_PATTERN.test(input.runId)) fail();

    const finalization = input.finalization;
    validateFinalization(finalization);
    const row = await callRpc("finalize_guarded_execution", {
      p_run_id: input.runId,
      p_user_id: input.userId,
      p_rule_id: input.ruleId,
      p_lease_id_hash: input.leaseIdHash,
      p_status: finalization.status,
      p_processed_count:
        finalization.status === "success" ? finalization.processedCount : null,
      p_saved_count:
        finalization.status === "success" ? finalization.savedCount : null,
      p_skipped_count:
        finalization.status === "success" ? finalization.skippedCount : null,
      p_message: finalization.message,
      p_error_code:
        finalization.status === "error" ? finalization.errorCode : null,
    });

    if (
      row.outcome !== "FINALIZED" ||
      row.run_id !== input.runId ||
      row.status !== finalization.status
    ) {
      fail();
    }
  }

  return Object.freeze({ claimGuardedExecution, finalizeGuardedExecution });
}
