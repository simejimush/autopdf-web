const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]+$/;

export type BillingProfileRepositoryErrorCode =
  | "BILLING_PROFILE_INPUT_INVALID"
  | "BILLING_PROFILE_STORE_FAILED"
  | "BILLING_PROFILE_ROW_NOT_FOUND"
  | "BILLING_PROFILE_ROW_DUPLICATE";

const SAFE_ERROR_MESSAGES: Readonly<
  Record<BillingProfileRepositoryErrorCode, string>
> = Object.freeze({
  BILLING_PROFILE_INPUT_INVALID: "Billing profile input is invalid",
  BILLING_PROFILE_STORE_FAILED: "Billing profile update failed",
  BILLING_PROFILE_ROW_NOT_FOUND: "Billing profile row was not found",
  BILLING_PROFILE_ROW_DUPLICATE: "Billing profile row is not unique",
});

export class BillingProfileRepositoryError extends Error {
  readonly code: BillingProfileRepositoryErrorCode;

  constructor(code: BillingProfileRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "BillingProfileRepositoryError";
    this.code = code;
  }
}

export type BillingCustomerReferencePayload = Readonly<{
  billing_customer_id: string;
  billing_provider: "stripe";
}>;

type BillingProfileWriteResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type BillingProfileSupabaseClient = Readonly<{
  from(table: "user_profiles"): Readonly<{
    update(payload: BillingCustomerReferencePayload): Readonly<{
      eq(
        column: "user_id",
        value: string,
      ): Readonly<{
        select(columns: "id"): PromiseLike<BillingProfileWriteResult>;
      }>;
    }>;
  }>;
}>;

function fail(code: BillingProfileRepositoryErrorCode): never {
  throw new BillingProfileRepositoryError(code);
}

function validateInput(
  input: Readonly<{
    userId: string;
    customerId: string;
  }>,
): void {
  if (
    !UUID_PATTERN.test(input.userId) ||
    !STRIPE_CUSTOMER_ID_PATTERN.test(input.customerId)
  ) {
    fail("BILLING_PROFILE_INPUT_INVALID");
  }
}

export function createBillingProfileRepository(
  getClient: () =>
    | BillingProfileSupabaseClient
    | Promise<BillingProfileSupabaseClient>,
) {
  async function saveStripeCustomerReference(
    input: Readonly<{
      userId: string;
      customerId: string;
    }>,
  ): Promise<void> {
    validateInput(input);

    const payload: BillingCustomerReferencePayload = Object.freeze({
      billing_customer_id: input.customerId,
      billing_provider: "stripe",
    });

    let result: BillingProfileWriteResult;
    try {
      const client = await getClient();
      result = await client
        .from("user_profiles")
        .update(payload)
        .eq("user_id", input.userId)
        .select("id");
    } catch {
      fail("BILLING_PROFILE_STORE_FAILED");
    }

    if (result.error || !Array.isArray(result.data)) {
      fail("BILLING_PROFILE_STORE_FAILED");
    }

    if (result.data.length === 0) {
      fail("BILLING_PROFILE_ROW_NOT_FOUND");
    }

    if (result.data.length !== 1) {
      fail("BILLING_PROFILE_ROW_DUPLICATE");
    }
  }

  return Object.freeze({ saveStripeCustomerReference });
}
