import { expect, test } from "@playwright/test";
import {
  GuardedExecutionRepositoryError,
  createGuardedExecutionRepository,
  type GuardedExecutionSupabaseClient,
} from "../src/lib/runs/guardedExecutionRepositoryCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const LEASE_ID_HASH = "a".repeat(64);
const EXPIRES = "2026-08-30T12:01:15.000Z";

type RpcResponse = Readonly<{ data: unknown; error: unknown }>;

function createHarness(responses: RpcResponse[]) {
  const calls: Array<{
    functionName: string;
    parameters: Readonly<Record<string, unknown>>;
  }> = [];
  let index = 0;
  const client: GuardedExecutionSupabaseClient = {
    async rpc(functionName, parameters) {
      calls.push({ functionName, parameters });
      const response = responses[index++];
      if (!response) throw new Error("raw unexpected RPC call");
      return response;
    },
  };
  const repository = createGuardedExecutionRepository({
    getClient: () => client,
    createLeaseIdHash: () => LEASE_ID_HASH,
    cronCandidateLimit: 500,
  });

  return { repository, calls };
}

async function expectStoreFailure(action: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GuardedExecutionRepositoryError);
  expect(caught).toMatchObject({ code: "GUARD_STORE_FAILED" });
  expect(String(caught)).not.toContain("raw");
}

test("valid claim passes only server-owned identity and returns the lease contract", async () => {
  const harness = createHarness([
    {
      data: [
        {
          outcome: "CLAIMED",
          run_id: RUN_ID,
          lease_expires_at: EXPIRES,
        },
      ],
      error: null,
    },
  ]);

  await expect(
    harness.repository.claimGuardedExecution({
      userId: USER_ID,
      ruleId: RULE_ID,
      trigger: "manual",
    }),
  ).resolves.toEqual({
    claimed: true,
    runId: RUN_ID,
    leaseIdHash: LEASE_ID_HASH,
    leaseExpiresAt: EXPIRES,
  });
  expect(harness.calls).toEqual([
    {
      functionName: "claim_guarded_execution",
      parameters: {
        p_user_id: USER_ID,
        p_rule_id: RULE_ID,
        p_trigger: "manual",
        p_lease_id_hash: LEASE_ID_HASH,
      },
    },
  ]);
  expect(harness.calls[0].parameters).not.toHaveProperty("p_now");
});

test("preserves each fixed expected rejection without a run or lease", async () => {
  for (const errorCode of [
    "SYSTEM_LIMIT_EXCEEDED",
    "USER_RATE_LIMIT_EXCEEDED",
    "EXECUTION_CONCURRENCY_LIMIT",
    "RUN_ALREADY_RUNNING",
  ] as const) {
    const harness = createHarness([
      {
        data: [{ outcome: errorCode, run_id: null, lease_expires_at: null }],
        error: null,
      },
    ]);
    await expect(
      harness.repository.claimGuardedExecution({
        userId: USER_ID,
        ruleId: RULE_ID,
        trigger: "cron",
      }),
    ).resolves.toEqual({ claimed: false, errorCode });
  }
});

test("malformed, zero, multiple, unknown, and DB error claim results fail closed", async () => {
  for (const response of [
    { data: [], error: null },
    {
      data: [
        { outcome: "CLAIMED", run_id: RUN_ID, lease_expires_at: EXPIRES },
        { outcome: "CLAIMED", run_id: RUN_ID, lease_expires_at: EXPIRES },
      ],
      error: null,
    },
    { data: [{ outcome: "CLAIMED" }], error: null },
    {
      data: [{ outcome: "NOT_A_CODE", run_id: null, lease_expires_at: null }],
      error: null,
    },
    { data: null, error: { message: "raw DB error" } },
  ]) {
    const harness = createHarness([response]);
    await expectStoreFailure(() =>
      harness.repository.claimGuardedExecution({
        userId: USER_ID,
        ruleId: RULE_ID,
        trigger: "manual",
      }),
    );
  }
});

test("invalid identity fails before RPC access", async () => {
  const harness = createHarness([]);
  await expectStoreFailure(() =>
    harness.repository.claimGuardedExecution({
      userId: "bad",
      ruleId: RULE_ID,
      trigger: "manual",
    }),
  );
  expect(harness.calls).toHaveLength(0);
});

test("valid success and error finalization use one guarded RPC", async () => {
  for (const finalization of [
    {
      status: "success" as const,
      processedCount: 1,
      savedCount: 2,
      skippedCount: 0,
      message: "Saved",
    },
    {
      status: "error" as const,
      errorCode: "TIMEOUT",
      resetCounts: false,
      message: "Timed out",
    },
  ]) {
    const harness = createHarness([
      {
        data: [
          { outcome: "FINALIZED", run_id: RUN_ID, status: finalization.status },
        ],
        error: null,
      },
    ]);
    await harness.repository.finalizeGuardedExecution({
      runId: RUN_ID,
      userId: USER_ID,
      ruleId: RULE_ID,
      leaseIdHash: LEASE_ID_HASH,
      finalization,
    });
    expect(harness.calls[0].functionName).toBe("finalize_guarded_execution");
    expect(harness.calls[0].parameters).toMatchObject({
      p_run_id: RUN_ID,
      p_user_id: USER_ID,
      p_rule_id: RULE_ID,
      p_lease_id_hash: LEASE_ID_HASH,
      p_status: finalization.status,
    });
    expect(harness.calls[0].parameters).not.toHaveProperty("p_now");
  }
});

test("identity mismatch, duplicate finalize, invalid transition, and DB failures are never success", async () => {
  for (const response of [
    {
      data: [{ outcome: "FINALIZE_REJECTED", run_id: null, status: null }],
      error: null,
    },
    { data: [], error: null },
    {
      data: [
        { outcome: "FINALIZED", run_id: RUN_ID, status: "success" },
        { outcome: "FINALIZED", run_id: RUN_ID, status: "success" },
      ],
      error: null,
    },
    {
      data: [{ outcome: "FINALIZED", run_id: RUN_ID, status: "running" }],
      error: null,
    },
    { data: null, error: { message: "raw finalize DB error" } },
  ]) {
    const harness = createHarness([response]);
    await expectStoreFailure(() =>
      harness.repository.finalizeGuardedExecution({
        runId: RUN_ID,
        userId: USER_ID,
        ruleId: RULE_ID,
        leaseIdHash: LEASE_ID_HASH,
        finalization: {
          status: "success",
          processedCount: 0,
          savedCount: 0,
          skippedCount: 0,
          message: "Done",
        },
      }),
    );
  }
});

test("bounded Cron candidates accept only the exact RPC shape", async () => {
  const harness = createHarness([
    {
      data: [
        { rule_id: RULE_ID, user_id: USER_ID },
        { rule_id: "77777777-7777-4777-8777-777777777777", user_id: USER_ID },
      ],
      error: null,
    },
  ]);

  await expect(harness.repository.listCronCandidates()).resolves.toEqual([
    { ruleId: RULE_ID, userId: USER_ID },
    { ruleId: "77777777-7777-4777-8777-777777777777", userId: USER_ID },
  ]);
  expect(harness.calls).toEqual([
    { functionName: "list_cron_candidates", parameters: {} },
  ]);
});

test("Cron candidate malformed, duplicate, oversized, and DB-error results fail closed", async () => {
  const validCandidate = { rule_id: RULE_ID, user_id: USER_ID };
  const oversized = Array.from({ length: 501 }, () => validCandidate);

  for (const response of [
    { data: null, error: null },
    { data: [{ rule_id: "bad", user_id: USER_ID }], error: null },
    { data: [{ rule_id: RULE_ID, user_id: "bad" }], error: null },
    { data: [{ ...validCandidate, unexpected: true }], error: null },
    { data: [validCandidate, validCandidate], error: null },
    { data: oversized, error: null },
    { data: null, error: { message: "raw candidate DB error" } },
  ]) {
    const harness = createHarness([response]);
    await expectStoreFailure(() => harness.repository.listCronCandidates());
  }
});
