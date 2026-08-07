import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  MANUAL_RUN_SELECT,
  ManualRunRepositoryError,
  createManualRunRepository,
  type ManualRunInsertPayload,
  type ManualRunRepositoryErrorCode,
  type ManualRunSupabaseClient,
} from "../src/lib/runs/manualRunRepositoryCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_RULE_ID = "77777777-7777-4777-8777-777777777777";
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const STARTED_AT = "2026-08-03T00:00:00.000Z";

function createdRow(overrides?: Record<string, unknown>) {
  return {
    id: RUN_ID,
    user_id: USER_ID,
    rule_id: RULE_ID,
    trigger: "manual",
    status: "running",
    started_at: STARTED_AT,
    ...overrides,
  };
}

type RawResult = Readonly<{ data: unknown; error: unknown }>;

function createHarness(options?: {
  result?: RawResult;
  getClientError?: Error;
  queryError?: Error;
  now?: string;
  nowError?: Error;
}) {
  const calls = {
    clientLoads: 0,
    now: 0,
    from: [] as string[],
    insert: [] as ManualRunInsertPayload[],
    select: [] as string[],
  };
  const client: ManualRunSupabaseClient = {
    from(table) {
      calls.from.push(table);
      return {
        insert(payload) {
          calls.insert.push(payload);
          return {
            async select(columns) {
              calls.select.push(columns);
              if (options?.queryError) {
                throw options.queryError;
              }
              return options?.result ?? { data: [createdRow()], error: null };
            },
          };
        },
      };
    },
  };
  const repository = createManualRunRepository({
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
      return options?.now ?? STARTED_AT;
    },
  });

  return { repository, calls };
}

async function expectRepositoryError(
  action: () => Promise<unknown>,
  code: ManualRunRepositoryErrorCode,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ManualRunRepositoryError);
    expect(error).toMatchObject({
      name: "ManualRunRepositoryError",
      code,
    });
    expect(error).not.toHaveProperty("cause");
    return error as ManualRunRepositoryError;
  }

  throw new Error(`Expected ${code}`);
}

test("server adapter is isolated and loads the service-role client lazily", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/runs/manualRunRepository.ts"),
    "utf8",
  );

  expect(source).toContain('import "server-only";');
  expect(source).toContain('await import("@/lib/supabase/admin")');
  expect(source).not.toContain("createSupabaseServerClient");
});

test("inserts the fixed manual running record and returns the public run", async () => {
  const { repository, calls } = createHarness();

  const run = await repository.createManualRun({
    userId: USER_ID,
    ruleId: RULE_ID,
  });

  expect(calls).toEqual({
    clientLoads: 1,
    now: 1,
    from: ["runs"],
    insert: [
      {
        user_id: USER_ID,
        rule_id: RULE_ID,
        trigger: "manual",
        status: "running",
        processed_count: 0,
        saved_count: 0,
        skipped_count: 0,
        message: "Run started",
        started_at: STARTED_AT,
      },
    ],
    select: [MANUAL_RUN_SELECT],
  });
  expect(run).toEqual({
    id: RUN_ID,
    status: "running",
    started_at: STARTED_AT,
  });
  expect(run).not.toHaveProperty("user_id");
  expect(run).not.toHaveProperty("rule_id");
  expect(Object.isFrozen(calls.insert[0])).toBe(true);
});

test("request-style status, trigger, counters, messages, and timestamps cannot enter the payload", async () => {
  const { repository, calls } = createHarness();
  const input = {
    userId: USER_ID,
    ruleId: RULE_ID,
    user_id: OTHER_USER_ID,
    rule_id: OTHER_RULE_ID,
    trigger: "cron",
    status: "success",
    processed_count: 999,
    saved_count: 999,
    skipped_count: 999,
    message: "attacker message",
    error_code: "ATTACKER",
    started_at: "attacker-started-at",
    finished_at: "attacker-finished-at",
    updated_at: "attacker-updated-at",
    id: "attacker-id",
  };

  await repository.createManualRun(input);

  expect(calls.insert[0]).toEqual({
    user_id: USER_ID,
    rule_id: RULE_ID,
    trigger: "manual",
    status: "running",
    processed_count: 0,
    saved_count: 0,
    skipped_count: 0,
    message: "Run started",
    started_at: STARTED_AT,
  });
  for (const forbiddenColumn of [
    "id",
    "finished_at",
    "error_code",
    "updated_at",
  ]) {
    expect(calls.insert[0]).not.toHaveProperty(forbiddenColumn);
  }
});

test("invalid ownership identifiers fail before time or service-role access", async () => {
  for (const input of [
    { userId: "request-user", ruleId: RULE_ID },
    { userId: USER_ID, ruleId: "route-param-only" },
  ]) {
    const { repository, calls } = createHarness();
    const error = await expectRepositoryError(
      () => repository.createManualRun(input),
      "RUN_STORE_INPUT_INVALID",
    );

    expect(calls.now).toBe(0);
    expect(calls.clientLoads).toBe(0);
    expect(error.message).not.toContain(input.userId);
    expect(error.message).not.toContain(input.ruleId);
  }
});

test("invalid server timestamps fail before service-role access", async () => {
  const { repository, calls } = createHarness({ now: "invalid timestamp" });

  await expectRepositoryError(
    () => repository.createManualRun({ userId: USER_ID, ruleId: RULE_ID }),
    "RUN_STORE_FAILED",
  );
  expect(calls.clientLoads).toBe(0);
});

test("server clock failures are normalized before service-role access", async () => {
  const rawError = "raw server clock details";
  const { repository, calls } = createHarness({
    nowError: new Error(rawError),
  });

  const error = await expectRepositoryError(
    () => repository.createManualRun({ userId: USER_ID, ruleId: RULE_ID }),
    "RUN_STORE_FAILED",
  );
  expect(calls.clientLoads).toBe(0);
  expect(error.message).not.toContain(rawError);
});

test("a missing created run fails closed", async () => {
  const { repository } = createHarness({
    result: { data: [], error: null },
  });

  await expectRepositoryError(
    () => repository.createManualRun({ userId: USER_ID, ruleId: RULE_ID }),
    "RUN_STORE_RESULT_MISSING",
  );
});

test("multiple created runs fail closed", async () => {
  const { repository } = createHarness({
    result: { data: [createdRow(), createdRow()], error: null },
  });

  await expectRepositoryError(
    () => repository.createManualRun({ userId: USER_ID, ruleId: RULE_ID }),
    "RUN_STORE_RESULT_DUPLICATE",
  );
});

test("mismatched owner, rule, trigger, status, and timestamp fail closed", async () => {
  for (const overrides of [
    { user_id: OTHER_USER_ID },
    { rule_id: OTHER_RULE_ID },
    { trigger: "cron" },
    { status: "success" },
    { started_at: "not-a-timestamp" },
  ]) {
    const { repository } = createHarness({
      result: { data: [createdRow(overrides)], error: null },
    });

    await expectRepositoryError(
      () => repository.createManualRun({ userId: USER_ID, ruleId: RULE_ID }),
      "RUN_STORE_RESULT_MISMATCH",
    );
  }
});

test("invalid returned IDs and malformed shapes fail closed", async () => {
  for (const data of [
    { id: RUN_ID },
    [null],
    [createdRow({ id: "not-a-uuid" })],
  ]) {
    const { repository } = createHarness({ result: { data, error: null } });

    await expectRepositoryError(
      () => repository.createManualRun({ userId: USER_ID, ruleId: RULE_ID }),
      "RUN_STORE_FAILED",
    );
  }
});

test("database and client failures are normalized without raw identifiers", async () => {
  const rawError = "raw service-role run insert details";
  for (const options of [
    { result: { data: null, error: { message: rawError } } },
    { getClientError: new Error(rawError) },
    { queryError: new Error(rawError) },
  ]) {
    const { repository } = createHarness(options);
    const error = await expectRepositoryError(
      () => repository.createManualRun({ userId: USER_ID, ruleId: RULE_ID }),
      "RUN_STORE_FAILED",
    );

    expect(error.message).not.toContain(rawError);
    expect(error.message).not.toContain(USER_ID);
    expect(error.message).not.toContain(RULE_ID);
  }
});
