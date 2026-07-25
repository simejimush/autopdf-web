import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  RUN_UPDATE_SELECT,
  RunUpdateRepositoryError,
  createRunUpdateRepository,
  type RunFinalization,
  type RunUpdatePayload,
  type RunUpdateRepositoryErrorCode,
  type RunUpdateSupabaseClient,
} from "../src/lib/runs/runUpdateRepositoryCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const OTHER_RUN_ID = "99999999-9999-4999-8999-999999999999";
const FINISHED_AT = "2026-08-04T00:00:00.000Z";

const SUCCESS: RunFinalization = {
  status: "success",
  processedCount: 1,
  savedCount: 2,
  skippedCount: 3,
  message: "Saved 2 files to Drive",
};

type RawResult = Readonly<{ data: unknown; error: unknown }>;

function updatedRow(overrides?: Record<string, unknown>) {
  return {
    id: RUN_ID,
    user_id: USER_ID,
    status: SUCCESS.status,
    ...overrides,
  };
}

function createHarness(options?: {
  result?: unknown;
  getClientError?: Error;
  queryError?: Error;
  now?: string;
  nowError?: Error;
}) {
  const calls = {
    clientLoads: 0,
    now: 0,
    from: [] as string[],
    update: [] as RunUpdatePayload[],
    eq: [] as Array<{ column: string; value: string }>,
    select: [] as string[],
  };
  const client: RunUpdateSupabaseClient = {
    from(table) {
      calls.from.push(table);
      return {
        update(payload) {
          calls.update.push(payload);
          return {
            eq(column, value) {
              calls.eq.push({ column, value });
              return {
                eq(secondColumn, secondValue) {
                  calls.eq.push({ column: secondColumn, value: secondValue });
                  return {
                    async select(columns) {
                      calls.select.push(columns);
                      if (options?.queryError) {
                        throw options.queryError;
                      }
                      return (
                        options && "result" in options
                          ? options.result
                          : {
                              data: [updatedRow()],
                              error: null,
                            }
                      ) as RawResult;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const repository = createRunUpdateRepository({
    async getClient() {
      calls.clientLoads += 1;
      if (options?.getClientError) {
        throw options.getClientError;
      }
      return client;
    },
    now() {
      calls.now += 1;
      if (options?.nowError) {
        throw options.nowError;
      }
      return options?.now ?? FINISHED_AT;
    },
  });

  return { repository, calls };
}

async function expectRepositoryError(
  action: () => Promise<unknown>,
  code: RunUpdateRepositoryErrorCode,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(RunUpdateRepositoryError);
    expect(error).toMatchObject({
      name: "RunUpdateRepositoryError",
      code,
    });
    expect(error).not.toHaveProperty("cause");
    return error as RunUpdateRepositoryError;
  }

  throw new Error(`Expected ${code}`);
}

test("server adapter is isolated and loads the service-role client lazily", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/runs/runUpdateRepository.ts"),
    "utf8",
  );

  expect(source).toContain('import "server-only";');
  expect(source).toContain('await import("@/lib/supabase/admin")');
  expect(source).not.toContain("createSupabaseServerClient");
});

test("success updates only fixed columns and scopes by run then owner", async () => {
  const { repository, calls } = createHarness();

  await repository.finalizeRunForUser({
    runId: RUN_ID,
    userId: USER_ID,
    finalization: {
      ...SUCCESS,
      id: OTHER_RUN_ID,
      user_id: OTHER_USER_ID,
      rule_id: "attacker-rule",
      trigger: "cron",
      started_at: "attacker-start",
      updated_at: "attacker-update",
      drive_folder_id: "attacker-folder",
      error_code: "ATTACKER",
    } as RunFinalization,
  });

  expect(calls).toEqual({
    clientLoads: 1,
    now: 1,
    from: ["runs"],
    update: [
      {
        status: "success",
        processed_count: 1,
        saved_count: 2,
        skipped_count: 3,
        message: "Saved 2 files to Drive",
        finished_at: FINISHED_AT,
      },
    ],
    eq: [
      { column: "id", value: RUN_ID },
      { column: "user_id", value: USER_ID },
    ],
    select: [RUN_UPDATE_SELECT],
  });
  expect(Object.isFrozen(calls.update[0])).toBe(true);
});

test("ordinary failures preserve counts while limit failures reset them", async () => {
  for (const [resetCounts, expectedCounts] of [
    [false, false],
    [true, true],
  ] as const) {
    const { repository, calls } = createHarness({
      result: { data: [updatedRow({ status: "error" })], error: null },
    });

    await repository.finalizeRunForUser({
      runId: RUN_ID,
      userId: USER_ID,
      finalization: {
        status: "error",
        errorCode: "FREE_MONTHLY_LIMIT_EXCEEDED",
        resetCounts,
        message: "Safe failure",
      },
    });

    expect(calls.update[0]).toEqual({
      status: "error",
      error_code: "FREE_MONTHLY_LIMIT_EXCEEDED",
      ...(expectedCounts
        ? { processed_count: 0, saved_count: 0, skipped_count: 0 }
        : {}),
      message: "Safe failure",
      finished_at: FINISHED_AT,
    });
  }
});

test("invalid IDs, status, counts, messages, and error codes fail before service access", async () => {
  const invalidInputs = [
    { runId: "request-run", userId: USER_ID, finalization: SUCCESS },
    { runId: RUN_ID, userId: "request-user", finalization: SUCCESS },
    {
      runId: RUN_ID,
      userId: USER_ID,
      finalization: { ...SUCCESS, status: "running" },
    },
    {
      runId: RUN_ID,
      userId: USER_ID,
      finalization: { ...SUCCESS, processedCount: -1 },
    },
    {
      runId: RUN_ID,
      userId: USER_ID,
      finalization: { ...SUCCESS, savedCount: 1.5 },
    },
    {
      runId: RUN_ID,
      userId: USER_ID,
      finalization: { ...SUCCESS, skippedCount: Number.MAX_SAFE_INTEGER + 1 },
    },
    {
      runId: RUN_ID,
      userId: USER_ID,
      finalization: { ...SUCCESS, message: "   " },
    },
    {
      runId: RUN_ID,
      userId: USER_ID,
      finalization: {
        status: "error",
        errorCode: "raw error details",
        resetCounts: false,
        message: "Safe failure",
      },
    },
  ];

  for (const input of invalidInputs) {
    const { repository, calls } = createHarness();
    await expectRepositoryError(
      () =>
        repository.finalizeRunForUser(
          input as Parameters<typeof repository.finalizeRunForUser>[0],
        ),
      "RUN_UPDATE_INPUT_INVALID",
    );
    expect(calls.now).toBe(0);
    expect(calls.clientLoads).toBe(0);
  }
});

test("invalid server timestamps and clock failures are normalized", async () => {
  for (const options of [
    { now: "invalid timestamp" },
    { nowError: new Error("raw clock failure") },
  ]) {
    const { repository, calls } = createHarness(options);
    const error = await expectRepositoryError(
      () =>
        repository.finalizeRunForUser({
          runId: RUN_ID,
          userId: USER_ID,
          finalization: SUCCESS,
        }),
      "RUN_UPDATE_FAILED",
    );
    expect(calls.clientLoads).toBe(0);
    expect(error.message).not.toContain("raw clock failure");
  }
});

test("zero, multiple, mismatched owner/id/status, and malformed rows fail closed", async () => {
  const cases: Array<{
    data: unknown;
    code: RunUpdateRepositoryErrorCode;
  }> = [
    { data: [], code: "RUN_UPDATE_RESULT_MISSING" },
    {
      data: [updatedRow(), updatedRow()],
      code: "RUN_UPDATE_RESULT_DUPLICATE",
    },
    {
      data: [updatedRow({ id: OTHER_RUN_ID })],
      code: "RUN_UPDATE_RESULT_MISMATCH",
    },
    {
      data: [updatedRow({ user_id: OTHER_USER_ID })],
      code: "RUN_UPDATE_RESULT_MISMATCH",
    },
    {
      data: [updatedRow({ status: "error" })],
      code: "RUN_UPDATE_RESULT_MISMATCH",
    },
    { data: [null], code: "RUN_UPDATE_FAILED" },
    { data: [updatedRow({ id: "not-a-uuid" })], code: "RUN_UPDATE_FAILED" },
  ];

  for (const { data, code } of cases) {
    const { repository } = createHarness({
      result: { data, error: null },
    });
    await expectRepositoryError(
      () =>
        repository.finalizeRunForUser({
          runId: RUN_ID,
          userId: USER_ID,
          finalization: SUCCESS,
        }),
      code,
    );
  }
});

test("database, client, query, and result-shape failures hide raw details and IDs", async () => {
  const rawError = "raw service-role run update details";
  for (const options of [
    { result: { data: null, error: { message: rawError } } },
    { result: { data: { id: RUN_ID }, error: null } },
    { result: undefined },
    { getClientError: new Error(rawError) },
    { queryError: new Error(rawError) },
  ]) {
    const { repository } = createHarness(options);
    const error = await expectRepositoryError(
      () =>
        repository.finalizeRunForUser({
          runId: RUN_ID,
          userId: USER_ID,
          finalization: SUCCESS,
        }),
      "RUN_UPDATE_FAILED",
    );

    expect(error.message).not.toContain(rawError);
    expect(error.message).not.toContain(RUN_ID);
    expect(error.message).not.toContain(USER_ID);
  }
});
