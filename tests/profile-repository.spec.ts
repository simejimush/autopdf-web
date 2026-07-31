import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  USER_PROFILE_SELECT,
  UserProfileRepositoryError,
  createUserProfileRepository,
  type UserProfileRepositoryErrorCode,
  type UserProfileSupabaseClient,
  type UserProfileUpdateInput,
  type UserProfileUpdatePayload,
} from "../src/lib/profile/profileRepositoryCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";

const PROFILE_ROW = Object.freeze({
  user_id: USER_ID,
  display_name: "AutoPDF User",
  company_name: "AutoPDF",
  industry: "software",
  employee_size: "1-10",
  marketing_opt_in: false,
  plan: "free" as const,
  billing_provider: null,
  billing_customer_id: null,
  billing_subscription_id: null,
  billing_status: null,
  current_period_end: null,
  cancel_at_period_end: false,
});

type RawReadResult = Readonly<{ data: unknown; error: unknown }>;
type RawUpdateResult = Readonly<{
  data: unknown;
  error: unknown;
  count: number | null;
}>;

function createHarness(options?: {
  readResult?: RawReadResult;
  updateResult?: RawUpdateResult;
  queryError?: Error;
}) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    update: [] as UserProfileUpdatePayload[],
    updateOptions: [] as Array<Readonly<{ count: "exact" }>>,
    eq: [] as Array<{ column: string; value: string }>,
    maxAffected: [] as number[],
    updateSelectCalls: 0,
  };

  const client: UserProfileSupabaseClient = {
    from(table) {
      calls.from.push(table);
      return {
        select(columns) {
          calls.select.push(columns);
          return {
            eq(column, value) {
              calls.eq.push({ column, value });
              return {
                async maybeSingle() {
                  if (options?.queryError) throw options.queryError;
                  return (
                    options?.readResult ?? { data: PROFILE_ROW, error: null }
                  );
                },
              };
            },
          };
        },
        update(payload, updateOptions) {
          calls.update.push(payload);
          calls.updateOptions.push(updateOptions);
          return {
            eq(column, value) {
              calls.eq.push({ column, value });
              return {
                async maxAffected(value) {
                  calls.maxAffected.push(value);
                  if (options?.queryError) throw options.queryError;
                  return (
                    options?.updateResult ?? {
                      data: null,
                      error: null,
                      count: 1,
                    }
                  );
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    repository: createUserProfileRepository(() => client),
    calls,
  };
}

async function expectRepositoryError(
  action: () => Promise<unknown>,
  code: UserProfileRepositoryErrorCode,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(UserProfileRepositoryError);
    expect(error).toMatchObject({ code });
    expect(error).not.toHaveProperty("cause");
    return;
  }
  throw new Error(`Expected ${code}`);
}

test("loads only the authenticated user profile columns allowed by the database contract", async () => {
  const { repository, calls } = createHarness();

  await expect(repository.loadByUserId(USER_ID)).resolves.toEqual(PROFILE_ROW);
  expect(calls.select).toEqual([USER_PROFILE_SELECT]);
  expect(USER_PROFILE_SELECT).not.toContain("*");
  expect(USER_PROFILE_SELECT.split(",").map((column) => column.trim())).toEqual(
    [
      "user_id",
      "display_name",
      "company_name",
      "industry",
      "employee_size",
      "marketing_opt_in",
      "plan",
      "billing_provider",
      "billing_customer_id",
      "billing_subscription_id",
      "billing_status",
      "current_period_end",
      "cancel_at_period_end",
    ],
  );
  expect(calls.eq).toEqual([{ column: "user_id", value: USER_ID }]);
});

for (const [column, value] of [
  ["display_name", "Updated User"],
  ["company_name", "Updated Company"],
  ["industry", "manufacturing"],
  ["employee_size", "11-50"],
  ["marketing_opt_in", true],
] as const) {
  test(`updates the allowed ${column} column with an exact owner filter`, async () => {
    const { repository, calls } = createHarness();

    await repository.updateByUserId(USER_ID, { [column]: value });

    expect(calls.update).toEqual([{ [column]: value }]);
    expect(calls.updateOptions).toEqual([{ count: "exact" }]);
    expect(calls.eq).toEqual([{ column: "user_id", value: USER_ID }]);
    expect(calls.maxAffected).toEqual([1]);
    expect(calls.updateSelectCalls).toBe(0);
    expect(Object.isFrozen(calls.update[0])).toBe(true);
  });
}

test("filters plan, billing, ownership, and unknown fields out of the update payload", async () => {
  const { repository, calls } = createHarness();
  const input = {
    display_name: "Allowed",
    plan: "pro",
    billing_provider: "stripe",
    billing_customer_id: "cus_forbidden",
    billing_subscription_id: "sub_forbidden",
    billing_status: "active",
    current_period_end: new Date().toISOString(),
    cancel_at_period_end: true,
    plan_updated_at: new Date().toISOString(),
    user_id: OTHER_USER_ID,
    unknown_field: "forbidden",
  } as unknown as UserProfileUpdateInput;

  await repository.updateByUserId(USER_ID, input);

  expect(calls.update).toEqual([{ display_name: "Allowed" }]);
  expect(calls.eq).toEqual([{ column: "user_id", value: USER_ID }]);
});

test("rejects an update containing no allowed profile fields", async () => {
  const { repository, calls } = createHarness();

  await expectRepositoryError(
    () =>
      repository.updateByUserId(USER_ID, {
        plan: "pro",
        user_id: OTHER_USER_ID,
      } as unknown as UserProfileUpdateInput),
    "PROFILE_INPUT_INVALID",
  );
  expect(calls.from).toEqual([]);
});

test("fails closed when the authenticated update matches no row", async () => {
  const { repository } = createHarness({
    updateResult: { data: null, error: null, count: 0 },
  });

  await expectRepositoryError(
    () => repository.updateByUserId(USER_ID, { display_name: "Missing" }),
    "PROFILE_ROW_NOT_FOUND",
  );
});

test("fails closed when the authenticated update unexpectedly matches multiple rows", async () => {
  const { repository } = createHarness({
    updateResult: { data: null, error: null, count: 2 },
  });

  await expectRepositoryError(
    () => repository.updateByUserId(USER_ID, { display_name: "Duplicate" }),
    "PROFILE_ROW_DUPLICATE",
  );
});

test("normalizes database failures without exposing Postgres hints", async () => {
  const rawHint = "GRANT SELECT ON public.user_profiles TO authenticated";
  const { repository } = createHarness({
    updateResult: {
      data: null,
      error: { code: "42501", hint: rawHint },
      count: null,
    },
  });

  try {
    await repository.updateByUserId(USER_ID, { display_name: "Failure" });
  } catch (error) {
    expect(error).toBeInstanceOf(UserProfileRepositoryError);
    expect((error as Error).message).not.toContain(rawHint);
    expect((error as Error).message).not.toContain("42501");
    return;
  }
  throw new Error("Expected PROFILE_UPDATE_FAILED");
});

test("normalizes profile read failures without exposing Postgres hints", async () => {
  const rawHint = "GRANT SELECT ON public.user_profiles TO authenticated";
  const { repository } = createHarness({
    readResult: {
      data: null,
      error: { code: "42501", hint: rawHint },
    },
  });

  try {
    await repository.loadByUserId(USER_ID);
  } catch (error) {
    expect(error).toBeInstanceOf(UserProfileRepositoryError);
    expect(error).toMatchObject({ code: "PROFILE_READ_FAILED" });
    expect((error as Error).message).not.toContain(rawHint);
    expect((error as Error).message).not.toContain("42501");
    return;
  }
  throw new Error("Expected PROFILE_READ_FAILED");
});

test("settings profile adapter performs no update RETURNING select", () => {
  const serverSource = readFileSync(
    resolve(process.cwd(), "src/lib/profile/profile.server.ts"),
    "utf8",
  );
  const coreSource = readFileSync(
    resolve(process.cwd(), "src/lib/profile/profileRepositoryCore.ts"),
    "utf8",
  );

  expect(serverSource).toContain('import "server-only";');
  expect(serverSource).toContain("repository.updateByUserId(user.id, input)");
  expect(serverSource).not.toContain(".update({ ...input })");
  expect(coreSource).toContain('.update(payload, { count: "exact" })');
  expect(coreSource).toContain(".maxAffected(1)");
  expect(coreSource).not.toMatch(/\.update\([\s\S]*?\.select\(/);
});

test("authenticated Google connection reads exclude token and internal notification columns", () => {
  const authenticatedSources = [
    "app/layout.tsx",
    "app/(app)/layout.tsx",
    "app/(app)/rules/page.tsx",
    "app/(app)/settings/page.tsx",
  ].map((file) => readFileSync(resolve(process.cwd(), file), "utf8"));

  for (const source of authenticatedSources) {
    const query = source.match(
      /\.from\("google_connections"\)[\s\S]{0,300}?\.select\(([\s\S]*?)\)\s*\.eq/,
    );
    expect(query).not.toBeNull();

    for (const forbiddenColumn of [
      "access_token_enc",
      "refresh_token_enc",
      "token_expiry_at",
      "credential_version",
      "created_at",
      "last_user_notified_at",
      "last_user_notified_error_code",
    ]) {
      expect(query?.[1]).not.toContain(forbiddenColumn);
    }
  }

  for (const serviceRoleFile of [
    "src/lib/google/tokenStore.ts",
    "src/lib/monitoring/notifyUser.ts",
    "src/lib/monitoring/updateGoogleConnectionHealth.ts",
  ]) {
    const source = readFileSync(
      resolve(process.cwd(), serviceRoleFile),
      "utf8",
    );
    expect(source).toContain("supabaseAdmin");
  }
});
