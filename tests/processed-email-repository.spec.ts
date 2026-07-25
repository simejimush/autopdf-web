import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  PROCESSED_EMAIL_SELECT,
  ProcessedEmailRepositoryError,
  createProcessedEmailRepository,
  type ProcessedEmailInsertPayload,
  type ProcessedEmailRepositoryErrorCode,
  type ProcessedEmailSupabaseClient,
} from "../src/lib/runs/processedEmailRepositoryCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_RULE_ID = "77777777-7777-4777-8777-777777777777";
const RECORD_ID = "88888888-8888-4888-8888-888888888888";
const MESSAGE_ID = "gmail-message-id";
const SAVED_AT = "2026-08-05T00:00:00.000Z";

const INPUT = {
  userId: USER_ID,
  ruleId: RULE_ID,
  gmailMessageId: MESSAGE_ID,
  drive: {
    fileId: "drive-file-id",
    webViewLink: "https://drive.google.com/file/d/safe-id/view",
    fileName: "2026-08-05_Invoice_message.pdf",
  },
} as const;

function storedRow(overrides?: Record<string, unknown>) {
  return {
    id: RECORD_ID,
    user_id: USER_ID,
    rule_id: RULE_ID,
    gmail_message_id: MESSAGE_ID,
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
    insert: [] as ProcessedEmailInsertPayload[],
    select: [] as string[],
  };
  const client: ProcessedEmailSupabaseClient = {
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
              return (
                options && "result" in options
                  ? options.result
                  : { data: [storedRow()], error: null }
              ) as {
                data: unknown;
                error: unknown;
              };
            },
          };
        },
      };
    },
  };
  const repository = createProcessedEmailRepository({
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
      return options?.now ?? SAVED_AT;
    },
  });

  return { repository, calls };
}

async function expectRepositoryError(
  action: () => Promise<unknown>,
  code: ProcessedEmailRepositoryErrorCode,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProcessedEmailRepositoryError);
    expect(error).toMatchObject({
      name: "ProcessedEmailRepositoryError",
      code,
    });
    expect(error).not.toHaveProperty("cause");
    return error as ProcessedEmailRepositoryError;
  }

  throw new Error(`Expected ${code}`);
}

test("server adapter is isolated and loads the service-role client lazily", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/runs/processedEmailRepository.ts"),
    "utf8",
  );

  expect(source).toContain('import "server-only";');
  expect(source).toContain('await import("@/lib/supabase/admin")');
  expect(source).not.toContain("createSupabaseServerClient");
});

test("inserts fixed owner, rule, message, Drive fields, and server saved time", async () => {
  const { repository, calls } = createHarness();

  const record = await repository.recordProcessedEmail(INPUT);

  expect(calls).toEqual({
    clientLoads: 1,
    now: 1,
    from: ["processed_emails"],
    insert: [
      {
        user_id: USER_ID,
        rule_id: RULE_ID,
        gmail_message_id: MESSAGE_ID,
        drive_file_id: INPUT.drive.fileId,
        drive_web_view_link: INPUT.drive.webViewLink,
        drive_file_name: INPUT.drive.fileName,
        saved_at: SAVED_AT,
      },
    ],
    select: [PROCESSED_EMAIL_SELECT],
  });
  expect(record).toEqual({ id: RECORD_ID });
  expect(Object.isFrozen(record)).toBe(true);
  expect(Object.isFrozen(calls.insert[0])).toBe(true);
});

test("request-style protected columns cannot enter the fixed payload", async () => {
  const { repository, calls } = createHarness();
  const input = {
    ...INPUT,
    id: "attacker-id",
    user_id: OTHER_USER_ID,
    rule_id: OTHER_RULE_ID,
    gmail_message_id: "attacker-message",
    created_at: "attacker-created-at",
    saved_at: "attacker-saved-at",
    run_id: "attacker-run",
    status: "success",
    count: 999,
  };

  await repository.recordProcessedEmail(input);

  expect(calls.insert[0]).toEqual({
    user_id: USER_ID,
    rule_id: RULE_ID,
    gmail_message_id: MESSAGE_ID,
    drive_file_id: INPUT.drive.fileId,
    drive_web_view_link: INPUT.drive.webViewLink,
    drive_file_name: INPUT.drive.fileName,
    saved_at: SAVED_AT,
  });
  for (const forbiddenColumn of [
    "id",
    "created_at",
    "run_id",
    "status",
    "count",
  ]) {
    expect(calls.insert[0]).not.toHaveProperty(forbiddenColumn);
  }
});

test("nullable Drive ID and URL preserve the existing insert contract", async () => {
  const { repository, calls } = createHarness();
  await repository.recordProcessedEmail({
    ...INPUT,
    drive: { ...INPUT.drive, fileId: null, webViewLink: null },
  });

  expect(calls.insert[0]).toMatchObject({
    drive_file_id: null,
    drive_web_view_link: null,
  });
});

test("invalid ownership, message, and Drive values fail before clock or service access", async () => {
  const invalidInputs = [
    { ...INPUT, userId: "request-user" },
    { ...INPUT, ruleId: "request-rule" },
    { ...INPUT, gmailMessageId: "" },
    { ...INPUT, gmailMessageId: " message-with-padding " },
    { ...INPUT, drive: { ...INPUT.drive, fileId: 123 } },
    { ...INPUT, drive: { ...INPUT.drive, fileId: "" } },
    { ...INPUT, drive: { ...INPUT.drive, webViewLink: 123 } },
    {
      ...INPUT,
      drive: { ...INPUT.drive, webViewLink: "http://drive.google.com/file" },
    },
    { ...INPUT, drive: { ...INPUT.drive, webViewLink: "not-a-url" } },
    { ...INPUT, drive: { ...INPUT.drive, fileName: "" } },
  ];

  for (const input of invalidInputs) {
    const { repository, calls } = createHarness();
    const error = await expectRepositoryError(
      () =>
        repository.recordProcessedEmail(
          input as Parameters<typeof repository.recordProcessedEmail>[0],
        ),
      "PROCESSED_EMAIL_INPUT_INVALID",
    );

    expect(calls.now).toBe(0);
    expect(calls.clientLoads).toBe(0);
    expect(error.message).not.toContain(String(input.userId));
    expect(error.message).not.toContain(String(input.ruleId));
  }
});

test("invalid server timestamps and clock failures are normalized", async () => {
  for (const options of [
    { now: "invalid timestamp" },
    { nowError: new Error("raw clock failure") },
  ]) {
    const { repository, calls } = createHarness(options);
    const error = await expectRepositoryError(
      () => repository.recordProcessedEmail(INPUT),
      "PROCESSED_EMAIL_STORE_FAILED",
    );

    expect(calls.clientLoads).toBe(0);
    expect(error.message).not.toContain("raw clock failure");
  }
});

test("zero, multiple, mismatched identity, and malformed rows fail closed", async () => {
  const cases: Array<{
    data: unknown;
    code: ProcessedEmailRepositoryErrorCode;
  }> = [
    { data: [], code: "PROCESSED_EMAIL_RESULT_MISSING" },
    {
      data: [storedRow(), storedRow()],
      code: "PROCESSED_EMAIL_RESULT_DUPLICATE",
    },
    {
      data: [storedRow({ user_id: OTHER_USER_ID })],
      code: "PROCESSED_EMAIL_RESULT_MISMATCH",
    },
    {
      data: [storedRow({ rule_id: OTHER_RULE_ID })],
      code: "PROCESSED_EMAIL_RESULT_MISMATCH",
    },
    {
      data: [storedRow({ gmail_message_id: "other-message" })],
      code: "PROCESSED_EMAIL_RESULT_MISMATCH",
    },
    { data: [null], code: "PROCESSED_EMAIL_STORE_FAILED" },
    {
      data: [storedRow({ id: "not-a-uuid" })],
      code: "PROCESSED_EMAIL_STORE_FAILED",
    },
  ];

  for (const { data, code } of cases) {
    const { repository } = createHarness({
      result: { data, error: null },
    });
    await expectRepositoryError(
      () => repository.recordProcessedEmail(INPUT),
      code,
    );
  }
});

test("Postgres unique violations receive a fixed duplicate classification", async () => {
  const rawError = "duplicate key exposes constraint and Gmail ID";
  const { repository } = createHarness({
    result: {
      data: null,
      error: { code: "23505", message: rawError },
    },
  });

  const error = await expectRepositoryError(
    () => repository.recordProcessedEmail(INPUT),
    "PROCESSED_EMAIL_ALREADY_EXISTS",
  );
  expect(error.message).not.toContain(rawError);
  expect(error.message).not.toContain(MESSAGE_ID);
});

test("database, client, query, and result-shape failures hide raw details and identifiers", async () => {
  const rawError = "raw processed email service-role details";
  for (const options of [
    { result: { data: null, error: { code: "42501", message: rawError } } },
    { result: { data: { id: RECORD_ID }, error: null } },
    { result: undefined },
    { getClientError: new Error(rawError) },
    { queryError: new Error(rawError) },
  ]) {
    const { repository } = createHarness(options);
    const error = await expectRepositoryError(
      () => repository.recordProcessedEmail(INPUT),
      "PROCESSED_EMAIL_STORE_FAILED",
    );

    expect(error.message).not.toContain(rawError);
    expect(error.message).not.toContain(USER_ID);
    expect(error.message).not.toContain(RULE_ID);
    expect(error.message).not.toContain(MESSAGE_ID);
    expect(error.message).not.toContain(INPUT.drive.fileId);
  }
});
