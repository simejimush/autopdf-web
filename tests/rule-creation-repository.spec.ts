import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  RULE_CREATION_SELECT,
  RuleCreationRepositoryError,
  createRuleCreationRepository,
  normalizeRuleSubjectKeywords,
  type RuleCreationInsertPayload,
  type RuleCreationRepositoryErrorCode,
  type RuleCreationSupabaseClient,
  type RuleCreationValues,
} from "../src/lib/rules/ruleCreationRepositoryCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const UPDATED_AT = "2026-08-02T00:00:00.000Z";

const VALUES: RuleCreationValues = Object.freeze({
  driveFolderId: "drive-folder-id",
  gmailQuery: "from:billing@example.com",
  queryLabel: "請求メール",
  subjectKeywords: "請求書,領収書",
  fileNameFormat: "standard",
  isActive: true,
  runTiming: "manual",
});

function createdRow(userId = USER_ID) {
  return {
    id: RULE_ID,
    user_id: userId,
    is_active: true,
    run_timing: "manual",
    drive_folder_id: "drive-folder-id",
    gmail_query: "from:billing@example.com",
    query_label: "請求メール",
    file_name_format: "standard",
    updated_at: UPDATED_AT,
  };
}

type RawResult = Readonly<{ data: unknown; error: unknown }>;

function createHarness(options?: {
  result?: RawResult;
  getClientError?: Error;
  queryError?: Error;
}) {
  const calls = {
    clientLoads: 0,
    from: [] as string[],
    insert: [] as Array<readonly [RuleCreationInsertPayload]>,
    select: [] as string[],
  };
  const client: RuleCreationSupabaseClient = {
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
  const repository = createRuleCreationRepository(async () => {
    calls.clientLoads += 1;
    if (options?.getClientError) {
      throw options.getClientError;
    }
    return client;
  });

  return { repository, calls };
}

async function expectRepositoryError(
  action: () => Promise<unknown>,
  code: RuleCreationRepositoryErrorCode,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(RuleCreationRepositoryError);
    expect(error).toMatchObject({
      name: "RuleCreationRepositoryError",
      code,
    });
    expect(error).not.toHaveProperty("cause");
    return error as RuleCreationRepositoryError;
  }

  throw new Error(`Expected ${code}`);
}

test("server adapter is isolated and loads the service-role client lazily", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/rules/ruleCreationRepository.ts"),
    "utf8",
  );

  expect(source).toContain('import "server-only";');
  expect(source).toContain('await import("@/lib/supabase/admin")');
  expect(source).not.toContain("createSupabaseServerClient");
});

test("inserts fixed rule columns for the authenticated user and returns the public shape", async () => {
  const { repository, calls } = createHarness();

  const created = await repository.createRuleForUser({
    userId: USER_ID,
    values: VALUES,
  });

  expect(calls).toEqual({
    clientLoads: 1,
    from: ["rules"],
    insert: [
      [
        {
          user_id: USER_ID,
          drive_folder_id: "drive-folder-id",
          gmail_query: "from:billing@example.com",
          query_label: "請求メール",
          subject_keywords: "請求書,領収書",
          file_name_format: "standard",
          is_active: true,
          run_timing: "manual",
        },
      ],
    ],
    select: [RULE_CREATION_SELECT],
  });
  expect(created).toEqual({
    id: RULE_ID,
    is_active: true,
    run_timing: "manual",
    drive_folder_id: "drive-folder-id",
    gmail_query: "from:billing@example.com",
    query_label: "請求メール",
    file_name_format: "standard",
    updated_at: UPDATED_AT,
  });
  expect(created).not.toHaveProperty("user_id");
  expect(Object.isFrozen(calls.insert[0][0])).toBe(true);
});

test("request-style ownership and protected columns cannot enter the insert payload", async () => {
  const valuesWithForbiddenProperties = {
    ...VALUES,
    user_id: OTHER_USER_ID,
    id: RULE_ID,
    created_at: "attacker-created-at",
    updated_at: "attacker-updated-at",
    consecutive_failures: 999,
    auto_disabled_at: "attacker-disabled-at",
    run_count: 999,
    is_enabled: true,
  } as RuleCreationValues;
  const { repository, calls } = createHarness();

  await repository.createRuleForUser({
    userId: USER_ID,
    values: valuesWithForbiddenProperties,
  });

  const payload = calls.insert[0][0];
  expect(payload.user_id).toBe(USER_ID);
  expect(Object.keys(payload).sort()).toEqual([
    "drive_folder_id",
    "file_name_format",
    "gmail_query",
    "is_active",
    "query_label",
    "run_timing",
    "subject_keywords",
    "user_id",
  ]);
  for (const forbiddenColumn of [
    "id",
    "created_at",
    "updated_at",
    "consecutive_failures",
    "auto_disabled_at",
    "run_count",
    "is_enabled",
  ]) {
    expect(payload).not.toHaveProperty(forbiddenColumn);
  }
});

test("subject keywords normalize to canonical comma-delimited text", () => {
  expect(normalizeRuleSubjectKeywords("  請求書, 領収書\n見積書  ")).toBe(
    "請求書,領収書,見積書",
  );
  expect(normalizeRuleSubjectKeywords([" 請求書 ", "", "領収書\n見積書"])).toBe(
    "請求書,領収書,見積書",
  );
});

test("empty and unsupported subject keywords normalize to null", () => {
  for (const value of [null, undefined, "", "  \n, ", [], ["", " "]]) {
    expect(normalizeRuleSubjectKeywords(value)).toBeNull();
  }
  expect(normalizeRuleSubjectKeywords(["請求書", 123, null])).toBe("請求書");
});

test("invalid or noncanonical inputs fail before service-role access", async () => {
  for (const input of [
    { userId: OTHER_USER_ID.replace("5555", "invalid"), values: VALUES },
    { userId: USER_ID, values: { ...VALUES, driveFolderId: " " } },
    {
      userId: USER_ID,
      values: { ...VALUES, subjectKeywords: "請求書, 領収書" },
    },
    { userId: USER_ID, values: { ...VALUES, runTiming: " manual " } },
  ]) {
    const { repository, calls } = createHarness();
    await expectRepositoryError(
      () =>
        repository.createRuleForUser({
          userId: input.userId,
          values: input.values as RuleCreationValues,
        }),
      "RULE_STORE_INPUT_INVALID",
    );
    expect(calls.clientLoads).toBe(0);
  }
});

test("a missing insert result fails closed", async () => {
  const { repository } = createHarness({
    result: { data: [], error: null },
  });

  await expectRepositoryError(
    () => repository.createRuleForUser({ userId: USER_ID, values: VALUES }),
    "RULE_STORE_RESULT_MISSING",
  );
});

test("empty canonical keywords are inserted as null", async () => {
  const { repository, calls } = createHarness();

  await repository.createRuleForUser({
    userId: USER_ID,
    values: {
      ...VALUES,
      subjectKeywords: normalizeRuleSubjectKeywords([]),
    },
  });

  expect(calls.insert[0][0].subject_keywords).toBeNull();
});

test("multiple insert results fail closed", async () => {
  const { repository } = createHarness({
    result: { data: [createdRow(), createdRow()], error: null },
  });

  await expectRepositoryError(
    () => repository.createRuleForUser({ userId: USER_ID, values: VALUES }),
    "RULE_STORE_RESULT_DUPLICATE",
  );
});

test("database failures are normalized without raw values", async () => {
  const rawError = "raw service-role database details";
  for (const options of [
    { result: { data: null, error: { message: rawError } } },
    { getClientError: new Error(rawError) },
    { queryError: new Error(rawError) },
  ]) {
    const { repository } = createHarness(options);
    const error = await expectRepositoryError(
      () => repository.createRuleForUser({ userId: USER_ID, values: VALUES }),
      "RULE_STORE_FAILED",
    );

    expect(error.message).not.toContain(rawError);
    expect(error.message).not.toContain(USER_ID);
    expect(error.message).not.toContain(VALUES.driveFolderId);
  }
});

test("malformed and mismatched result rows fail closed", async () => {
  for (const data of [
    { id: RULE_ID },
    [null],
    [createdRow(OTHER_USER_ID)],
    [{ ...createdRow(), id: "not-a-uuid" }],
  ]) {
    const { repository } = createHarness({
      result: { data, error: null },
    });
    await expectRepositoryError(
      () => repository.createRuleForUser({ userId: USER_ID, values: VALUES }),
      "RULE_STORE_FAILED",
    );
  }
});
