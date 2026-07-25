import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  CRON_RUN_SELECT,
  CronRunRepositoryError,
  createCronRunRepository,
  type CronRunInsertPayload,
  type CronRunRepositoryErrorCode,
  type CronRunSupabaseClient,
} from "../src/lib/runs/cronRunRepositoryCore";

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
    trigger: "cron",
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
    insert: [] as CronRunInsertPayload[],
    select: [] as string[],
  };
  const client: CronRunSupabaseClient = {
    from(table) {
      calls.from.push(table);
      return {
        insert(payload) {
          calls.insert.push(payload);
          return {
            async select(columns) {
              calls.select.push(columns);
              if (options?.queryError) throw options.queryError;
              return options?.result ?? { data: [createdRow()], error: null };
            },
          };
        },
      };
    },
  };
  const repository = createCronRunRepository({
    async getClient() {
      calls.clientLoads += 1;
      if (options?.getClientError) throw options.getClientError;
      return client;
    },
    now() {
      calls.now += 1;
      if (options?.nowError) throw options.nowError;
      return options?.now ?? STARTED_AT;
    },
  });

  return { repository, calls };
}

async function expectRepositoryError(
  action: () => Promise<unknown>,
  code: CronRunRepositoryErrorCode,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(CronRunRepositoryError);
    expect(error).toMatchObject({ name: "CronRunRepositoryError", code });
    expect(error).not.toHaveProperty("cause");
    return error as CronRunRepositoryError;
  }
  throw new Error(`Expected ${code}`);
}

test("server adapter is isolated and loads the service-role client lazily", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/runs/cronRunRepository.ts"),
    "utf8",
  );

  expect(source).toContain('import "server-only";');
  expect(source).toContain('await import("@/lib/supabase/admin")');
  expect(source).not.toContain("createSupabaseServerClient");
});

test("inserts only the fixed cron running record and returns the public run", async () => {
  const { repository, calls } = createHarness();
  const run = await repository.createCronRun({
    userId: USER_ID,
    ruleId: RULE_ID,
    trigger: "manual",
    status: "success",
    processed_count: 99,
    saved_count: 99,
    skipped_count: 99,
    message: "attacker message",
    started_at: "attacker timestamp",
    finished_at: "attacker timestamp",
    error_code: "ATTACKER",
    updated_at: "attacker timestamp",
    drive_folder_id: "attacker folder",
    id: "attacker-id",
  } as Parameters<typeof repository.createCronRun>[0]);

  expect(calls).toEqual({
    clientLoads: 1,
    now: 1,
    from: ["runs"],
    insert: [
      {
        user_id: USER_ID,
        rule_id: RULE_ID,
        trigger: "cron",
        status: "running",
        processed_count: 0,
        saved_count: 0,
        skipped_count: 0,
        message: "Run started",
        started_at: STARTED_AT,
      },
    ],
    select: [CRON_RUN_SELECT],
  });
  expect(run).toEqual({
    id: RUN_ID,
    status: "running",
    started_at: STARTED_AT,
  });
  expect(run).not.toHaveProperty("user_id");
  expect(run).not.toHaveProperty("rule_id");
  expect(Object.isFrozen(calls.insert[0])).toBe(true);
  for (const forbiddenColumn of [
    "id",
    "finished_at",
    "error_code",
    "updated_at",
    "drive_folder_id",
  ]) {
    expect(calls.insert[0]).not.toHaveProperty(forbiddenColumn);
  }
});

test("invalid identifiers and server clocks fail before service access", async () => {
  for (const input of [
    { userId: "invalid-user", ruleId: RULE_ID },
    { userId: USER_ID, ruleId: "invalid-rule" },
  ]) {
    const { repository, calls } = createHarness();
    await expectRepositoryError(
      () => repository.createCronRun(input),
      "RUN_STORE_INPUT_INVALID",
    );
    expect(calls.now).toBe(0);
    expect(calls.clientLoads).toBe(0);
  }

  for (const options of [
    { now: "invalid timestamp" },
    { nowError: new Error("raw clock details") },
  ]) {
    const { repository, calls } = createHarness(options);
    const error = await expectRepositoryError(
      () => repository.createCronRun({ userId: USER_ID, ruleId: RULE_ID }),
      "RUN_STORE_FAILED",
    );
    expect(calls.clientLoads).toBe(0);
    expect(error.message).not.toContain("raw clock details");
  }
});

test("zero, multiple, malformed, and mismatched returned rows fail closed", async () => {
  const cases: Array<{
    data: unknown;
    code: CronRunRepositoryErrorCode;
  }> = [
    { data: [], code: "RUN_STORE_RESULT_MISSING" },
    {
      data: [createdRow(), createdRow()],
      code: "RUN_STORE_RESULT_DUPLICATE",
    },
    {
      data: [createdRow({ user_id: OTHER_USER_ID })],
      code: "RUN_STORE_RESULT_MISMATCH",
    },
    {
      data: [createdRow({ rule_id: OTHER_RULE_ID })],
      code: "RUN_STORE_RESULT_MISMATCH",
    },
    {
      data: [createdRow({ trigger: "manual" })],
      code: "RUN_STORE_RESULT_MISMATCH",
    },
    {
      data: [createdRow({ status: "success" })],
      code: "RUN_STORE_RESULT_MISMATCH",
    },
    {
      data: [createdRow({ started_at: "invalid" })],
      code: "RUN_STORE_RESULT_MISMATCH",
    },
    { data: [null], code: "RUN_STORE_FAILED" },
    { data: [createdRow({ id: "not-a-uuid" })], code: "RUN_STORE_FAILED" },
    { data: { id: RUN_ID }, code: "RUN_STORE_FAILED" },
  ];

  for (const { data, code } of cases) {
    const { repository } = createHarness({
      result: { data, error: null },
    });
    await expectRepositoryError(
      () => repository.createCronRun({ userId: USER_ID, ruleId: RULE_ID }),
      code,
    );
  }
});

test("database, client, and query failures hide raw details and identifiers", async () => {
  const rawError = "raw service-role cron insert details";
  for (const options of [
    { result: { data: null, error: { message: rawError } } },
    { getClientError: new Error(rawError) },
    { queryError: new Error(rawError) },
  ]) {
    const { repository } = createHarness(options);
    const error = await expectRepositoryError(
      () => repository.createCronRun({ userId: USER_ID, ruleId: RULE_ID }),
      "RUN_STORE_FAILED",
    );
    expect(error.message).not.toContain(rawError);
    expect(error.message).not.toContain(USER_ID);
    expect(error.message).not.toContain(RULE_ID);
    expect(error.message).not.toContain(RUN_ID);
  }
});
