const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const USER_PROFILE_SELECT =
  "user_id, display_name, company_name, industry, employee_size, marketing_opt_in, plan, billing_provider, billing_customer_id, billing_subscription_id, billing_status, current_period_end, cancel_at_period_end" as const;

export type UserProfileRow = Readonly<{
  user_id: string;
  display_name: string | null;
  company_name: string | null;
  industry: string | null;
  employee_size: string | null;
  marketing_opt_in: boolean;
  plan: "free" | "pro" | "pro_plus" | null;
  billing_provider: string | null;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  billing_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}>;

export type UserProfileUpdateInput = Readonly<{
  display_name?: string | null;
  company_name?: string | null;
  industry?: string | null;
  employee_size?: string | null;
  marketing_opt_in?: boolean;
}>;

export type UserProfileUpdatePayload = UserProfileUpdateInput;

export type UserProfileRepositoryErrorCode =
  | "PROFILE_INPUT_INVALID"
  | "PROFILE_READ_FAILED"
  | "PROFILE_CREATE_FAILED"
  | "PROFILE_UPDATE_FAILED"
  | "PROFILE_ROW_NOT_FOUND"
  | "PROFILE_ROW_DUPLICATE";

const SAFE_ERROR_MESSAGES: Readonly<
  Record<UserProfileRepositoryErrorCode, string>
> = Object.freeze({
  PROFILE_INPUT_INVALID: "Profile input is invalid",
  PROFILE_READ_FAILED: "Profile could not be loaded",
  PROFILE_CREATE_FAILED: "Profile could not be created",
  PROFILE_UPDATE_FAILED: "Profile could not be updated",
  PROFILE_ROW_NOT_FOUND: "Profile row was not found",
  PROFILE_ROW_DUPLICATE: "Profile row is not unique",
});

export class UserProfileRepositoryError extends Error {
  readonly code: UserProfileRepositoryErrorCode;

  constructor(code: UserProfileRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "UserProfileRepositoryError";
    this.code = code;
  }
}

type UserProfileReadResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

type UserProfileUpdateResult = Readonly<{
  data: unknown;
  error: unknown;
  count: number | null;
}>;

export type UserProfileSupabaseClient = Readonly<{
  from(table: "user_profiles"): Readonly<{
    select(columns: typeof USER_PROFILE_SELECT): Readonly<{
      eq(
        column: "user_id",
        value: string,
      ): Readonly<{
        maybeSingle(): PromiseLike<UserProfileReadResult>;
      }>;
    }>;
    update(
      payload: UserProfileUpdatePayload,
      options: Readonly<{ count: "exact" }>,
    ): Readonly<{
      eq(
        column: "user_id",
        value: string,
      ): Readonly<{
        maxAffected(value: 1): PromiseLike<UserProfileUpdateResult>;
      }>;
    }>;
  }>;
}>;

function fail(code: UserProfileRepositoryErrorCode): never {
  throw new UserProfileRepositoryError(code);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isUserProfileRow(value: unknown): value is UserProfileRow {
  if (!value || typeof value !== "object") return false;

  const row = value as Record<string, unknown>;
  return (
    typeof row.user_id === "string" &&
    UUID_PATTERN.test(row.user_id) &&
    isNullableString(row.display_name) &&
    isNullableString(row.company_name) &&
    isNullableString(row.industry) &&
    isNullableString(row.employee_size) &&
    typeof row.marketing_opt_in === "boolean" &&
    (row.plan === null ||
      row.plan === "free" ||
      row.plan === "pro" ||
      row.plan === "pro_plus") &&
    isNullableString(row.billing_provider) &&
    isNullableString(row.billing_customer_id) &&
    isNullableString(row.billing_subscription_id) &&
    isNullableString(row.billing_status) &&
    isNullableString(row.current_period_end) &&
    (row.cancel_at_period_end === null ||
      typeof row.cancel_at_period_end === "boolean")
  );
}

function buildUpdatePayload(
  input: UserProfileUpdateInput,
): UserProfileUpdatePayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("PROFILE_INPUT_INVALID");
  }

  const source = input as Record<string, unknown>;
  const payload: Record<string, string | boolean | null> = {};

  for (const column of [
    "display_name",
    "company_name",
    "industry",
    "employee_size",
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(source, column)) continue;
    const value = source[column];
    if (!isNullableString(value)) fail("PROFILE_INPUT_INVALID");
    payload[column] = value;
  }

  if (Object.prototype.hasOwnProperty.call(source, "marketing_opt_in")) {
    if (typeof source.marketing_opt_in !== "boolean") {
      fail("PROFILE_INPUT_INVALID");
    }
    payload.marketing_opt_in = source.marketing_opt_in;
  }

  if (Object.keys(payload).length === 0) {
    fail("PROFILE_INPUT_INVALID");
  }

  return Object.freeze(payload) as UserProfileUpdatePayload;
}

export function createUserProfileRepository(
  getClient: () =>
    | UserProfileSupabaseClient
    | Promise<UserProfileSupabaseClient>,
) {
  async function loadByUserId(userId: string): Promise<UserProfileRow | null> {
    if (!UUID_PATTERN.test(userId)) fail("PROFILE_INPUT_INVALID");

    let result: UserProfileReadResult;
    try {
      const client = await getClient();
      result = await client
        .from("user_profiles")
        .select(USER_PROFILE_SELECT)
        .eq("user_id", userId)
        .maybeSingle();
    } catch {
      fail("PROFILE_READ_FAILED");
    }

    if (result.error) fail("PROFILE_READ_FAILED");
    if (result.data === null) return null;
    if (!isUserProfileRow(result.data) || result.data.user_id !== userId) {
      fail("PROFILE_READ_FAILED");
    }

    return result.data;
  }

  async function updateByUserId(
    userId: string,
    input: UserProfileUpdateInput,
  ): Promise<void> {
    if (!UUID_PATTERN.test(userId)) fail("PROFILE_INPUT_INVALID");
    const payload = buildUpdatePayload(input);

    let result: UserProfileUpdateResult;
    try {
      const client = await getClient();
      result = await client
        .from("user_profiles")
        .update(payload, { count: "exact" })
        .eq("user_id", userId)
        .maxAffected(1);
    } catch {
      fail("PROFILE_UPDATE_FAILED");
    }

    if (result.error || result.data !== null || result.count === null) {
      fail("PROFILE_UPDATE_FAILED");
    }
    if (result.count === 0) fail("PROFILE_ROW_NOT_FOUND");
    if (result.count !== 1) fail("PROFILE_ROW_DUPLICATE");
  }

  return Object.freeze({ loadByUserId, updateByUserId });
}
