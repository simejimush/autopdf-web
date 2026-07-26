const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]+$/;
const STRIPE_SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]+$/;

const PROFILE_SELECT =
  "id, user_id, billing_customer_id, billing_subscription_id" as const;

export type StripeWebhookProfileRepositoryErrorCode =
  | "STRIPE_WEBHOOK_INPUT_INVALID"
  | "STRIPE_WEBHOOK_OWNER_NOT_FOUND"
  | "STRIPE_WEBHOOK_OWNER_DUPLICATE"
  | "STRIPE_WEBHOOK_OWNER_CONFLICT"
  | "STRIPE_WEBHOOK_PROFILE_READ_FAILED"
  | "STRIPE_WEBHOOK_PROFILE_UPDATE_FAILED"
  | "STRIPE_WEBHOOK_PROFILE_UPDATE_NOT_FOUND"
  | "STRIPE_WEBHOOK_PROFILE_UPDATE_DUPLICATE";

const SAFE_ERROR_MESSAGES: Readonly<
  Record<StripeWebhookProfileRepositoryErrorCode, string>
> = Object.freeze({
  STRIPE_WEBHOOK_INPUT_INVALID: "Stripe webhook input is invalid",
  STRIPE_WEBHOOK_OWNER_NOT_FOUND: "Stripe webhook owner was not found",
  STRIPE_WEBHOOK_OWNER_DUPLICATE: "Stripe webhook owner is not unique",
  STRIPE_WEBHOOK_OWNER_CONFLICT: "Stripe webhook ownership conflicts",
  STRIPE_WEBHOOK_PROFILE_READ_FAILED: "Stripe webhook profile read failed",
  STRIPE_WEBHOOK_PROFILE_UPDATE_FAILED: "Stripe webhook profile update failed",
  STRIPE_WEBHOOK_PROFILE_UPDATE_NOT_FOUND:
    "Stripe webhook profile update matched no rows",
  STRIPE_WEBHOOK_PROFILE_UPDATE_DUPLICATE:
    "Stripe webhook profile update matched multiple rows",
});

export class StripeWebhookProfileRepositoryError extends Error {
  readonly code: StripeWebhookProfileRepositoryErrorCode;

  constructor(code: StripeWebhookProfileRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "StripeWebhookProfileRepositoryError";
    this.code = code;
  }
}

type StripeWebhookProfileRow = Readonly<{
  id: string;
  user_id: string;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
}>;

type ProfileLookupColumn =
  | "user_id"
  | "billing_customer_id"
  | "billing_subscription_id";

type StripeWebhookProfileResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type StripeWebhookProfileUpdatePayload = Readonly<{
  plan: "free" | "pro";
  billing_provider: "stripe";
  billing_customer_id: string;
  billing_subscription_id: string;
  billing_status: string;
  current_period_end: string | null;
  cancel_at_period_end?: boolean;
  plan_updated_at: string;
}>;

export type StripeWebhookProfileSupabaseClient = Readonly<{
  from(table: "user_profiles"): Readonly<{
    select(columns: typeof PROFILE_SELECT): Readonly<{
      eq(
        column: ProfileLookupColumn,
        value: string,
      ): PromiseLike<StripeWebhookProfileResult>;
    }>;
    update(payload: StripeWebhookProfileUpdatePayload): Readonly<{
      eq(
        column: "user_id",
        value: string,
      ): Readonly<{
        eq(
          column: "billing_customer_id",
          value: string,
        ): Readonly<{
          select(columns: "id"): PromiseLike<StripeWebhookProfileResult>;
        }>;
      }>;
    }>;
  }>;
}>;

export type ResolvedStripeWebhookProfileOwner = Readonly<{
  userId: string;
  customerId: string;
  subscriptionId: string;
}>;

type ResolveOwnerInput = Readonly<{
  customerId: string;
  subscriptionId: string;
  metadataUserId: string | null;
  requireMetadataUserId: boolean;
}>;

type UpdateProfileInput = Readonly<{
  owner: ResolvedStripeWebhookProfileOwner;
  plan: "free" | "pro";
  billingStatus: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd?: boolean;
  planUpdatedAt: string;
}>;

function fail(code: StripeWebhookProfileRepositoryErrorCode): never {
  throw new StripeWebhookProfileRepositoryError(code);
}

function isProfileRow(value: unknown): value is StripeWebhookProfileRow {
  if (!value || typeof value !== "object") return false;

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.user_id === "string" &&
    UUID_PATTERN.test(row.user_id) &&
    (row.billing_customer_id === null ||
      (typeof row.billing_customer_id === "string" &&
        STRIPE_CUSTOMER_ID_PATTERN.test(row.billing_customer_id))) &&
    (row.billing_subscription_id === null ||
      (typeof row.billing_subscription_id === "string" &&
        STRIPE_SUBSCRIPTION_ID_PATTERN.test(row.billing_subscription_id)))
  );
}

function validateOwnerInput(input: ResolveOwnerInput): void {
  if (
    !STRIPE_CUSTOMER_ID_PATTERN.test(input.customerId) ||
    !STRIPE_SUBSCRIPTION_ID_PATTERN.test(input.subscriptionId) ||
    typeof input.requireMetadataUserId !== "boolean" ||
    (input.metadataUserId !== null &&
      !UUID_PATTERN.test(input.metadataUserId)) ||
    (input.requireMetadataUserId && input.metadataUserId === null)
  ) {
    fail("STRIPE_WEBHOOK_INPUT_INVALID");
  }
}

function validateUpdateInput(input: UpdateProfileInput): void {
  const periodEndValid =
    input.currentPeriodEnd === null ||
    (typeof input.currentPeriodEnd === "string" &&
      !Number.isNaN(Date.parse(input.currentPeriodEnd)));

  if (
    !UUID_PATTERN.test(input.owner.userId) ||
    !STRIPE_CUSTOMER_ID_PATTERN.test(input.owner.customerId) ||
    !STRIPE_SUBSCRIPTION_ID_PATTERN.test(input.owner.subscriptionId) ||
    (input.plan !== "free" && input.plan !== "pro") ||
    typeof input.billingStatus !== "string" ||
    input.billingStatus.length === 0 ||
    input.billingStatus.length > 64 ||
    !periodEndValid ||
    (input.cancelAtPeriodEnd !== undefined &&
      typeof input.cancelAtPeriodEnd !== "boolean") ||
    typeof input.planUpdatedAt !== "string" ||
    Number.isNaN(Date.parse(input.planUpdatedAt))
  ) {
    fail("STRIPE_WEBHOOK_INPUT_INVALID");
  }
}

function requireExactlyOne(
  rows: readonly StripeWebhookProfileRow[],
): StripeWebhookProfileRow {
  if (rows.length === 0) {
    fail("STRIPE_WEBHOOK_OWNER_NOT_FOUND");
  }
  if (rows.length !== 1) {
    fail("STRIPE_WEBHOOK_OWNER_DUPLICATE");
  }
  return rows[0];
}

export function createStripeWebhookProfileRepository(
  getClient: () =>
    | StripeWebhookProfileSupabaseClient
    | Promise<StripeWebhookProfileSupabaseClient>,
) {
  async function loadProfiles(
    client: StripeWebhookProfileSupabaseClient,
    column: ProfileLookupColumn,
    value: string,
  ): Promise<readonly StripeWebhookProfileRow[]> {
    let result: StripeWebhookProfileResult;
    try {
      result = await client
        .from("user_profiles")
        .select(PROFILE_SELECT)
        .eq(column, value);
    } catch {
      fail("STRIPE_WEBHOOK_PROFILE_READ_FAILED");
    }

    if (
      result.error ||
      !Array.isArray(result.data) ||
      !result.data.every(isProfileRow)
    ) {
      fail("STRIPE_WEBHOOK_PROFILE_READ_FAILED");
    }

    return result.data;
  }

  async function resolveStripeWebhookProfileOwner(
    input: ResolveOwnerInput,
  ): Promise<ResolvedStripeWebhookProfileOwner> {
    validateOwnerInput(input);

    let client: StripeWebhookProfileSupabaseClient;
    try {
      client = await getClient();
    } catch {
      fail("STRIPE_WEBHOOK_PROFILE_READ_FAILED");
    }

    const customerProfiles = await loadProfiles(
      client,
      "billing_customer_id",
      input.customerId,
    );
    const customerOwner = requireExactlyOne(customerProfiles);

    if (customerOwner.billing_customer_id !== input.customerId) {
      fail("STRIPE_WEBHOOK_OWNER_CONFLICT");
    }

    if (input.metadataUserId !== null) {
      const metadataProfiles = await loadProfiles(
        client,
        "user_id",
        input.metadataUserId,
      );
      const metadataOwner = requireExactlyOne(metadataProfiles);

      if (
        metadataOwner.user_id !== input.metadataUserId ||
        metadataOwner.user_id !== customerOwner.user_id ||
        (metadataOwner.billing_customer_id !== null &&
          metadataOwner.billing_customer_id !== input.customerId) ||
        (metadataOwner.billing_subscription_id !== null &&
          metadataOwner.billing_subscription_id !== input.subscriptionId)
      ) {
        fail("STRIPE_WEBHOOK_OWNER_CONFLICT");
      }
    }

    const subscriptionProfiles = await loadProfiles(
      client,
      "billing_subscription_id",
      input.subscriptionId,
    );

    if (subscriptionProfiles.length > 1) {
      fail("STRIPE_WEBHOOK_OWNER_DUPLICATE");
    }

    if (
      customerOwner.billing_subscription_id !== null &&
      customerOwner.billing_subscription_id !== input.subscriptionId
    ) {
      fail("STRIPE_WEBHOOK_OWNER_CONFLICT");
    }

    if (
      subscriptionProfiles.length === 1 &&
      (subscriptionProfiles[0].billing_subscription_id !==
        input.subscriptionId ||
        subscriptionProfiles[0].user_id !== customerOwner.user_id ||
        (subscriptionProfiles[0].billing_customer_id !== null &&
          subscriptionProfiles[0].billing_customer_id !== input.customerId))
    ) {
      fail("STRIPE_WEBHOOK_OWNER_CONFLICT");
    }

    if (
      subscriptionProfiles.length === 0 &&
      customerOwner.billing_subscription_id !== null
    ) {
      fail("STRIPE_WEBHOOK_OWNER_CONFLICT");
    }

    return Object.freeze({
      userId: customerOwner.user_id,
      customerId: input.customerId,
      subscriptionId: input.subscriptionId,
    });
  }

  async function updateStripeWebhookProfile(
    input: UpdateProfileInput,
  ): Promise<void> {
    validateUpdateInput(input);

    const payload: StripeWebhookProfileUpdatePayload = Object.freeze({
      plan: input.plan,
      billing_provider: "stripe",
      billing_customer_id: input.owner.customerId,
      billing_subscription_id: input.owner.subscriptionId,
      billing_status: input.billingStatus,
      current_period_end: input.currentPeriodEnd,
      ...(input.cancelAtPeriodEnd === undefined
        ? {}
        : { cancel_at_period_end: input.cancelAtPeriodEnd }),
      plan_updated_at: input.planUpdatedAt,
    });

    let result: StripeWebhookProfileResult;
    try {
      const client = await getClient();
      result = await client
        .from("user_profiles")
        .update(payload)
        .eq("user_id", input.owner.userId)
        .eq("billing_customer_id", input.owner.customerId)
        .select("id");
    } catch {
      fail("STRIPE_WEBHOOK_PROFILE_UPDATE_FAILED");
    }

    if (result.error || !Array.isArray(result.data)) {
      fail("STRIPE_WEBHOOK_PROFILE_UPDATE_FAILED");
    }
    if (result.data.length === 0) {
      fail("STRIPE_WEBHOOK_PROFILE_UPDATE_NOT_FOUND");
    }
    if (result.data.length !== 1) {
      fail("STRIPE_WEBHOOK_PROFILE_UPDATE_DUPLICATE");
    }
  }

  return Object.freeze({
    resolveStripeWebhookProfileOwner,
    updateStripeWebhookProfile,
  });
}
