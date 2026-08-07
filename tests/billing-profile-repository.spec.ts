import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  BillingProfileRepositoryError,
  createBillingProfileRepository,
  type BillingCustomerReferencePayload,
  type BillingProfileRepositoryErrorCode,
  type BillingProfileSupabaseClient,
} from "../src/lib/billing/billingProfileRepositoryCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "cus_BillingRepositoryTest";

test("server adapter is isolated and loads the service-role client lazily", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/billing/billingProfileRepository.ts"),
    "utf8",
  );

  expect(source).toContain('import "server-only";');
  expect(source).toContain('await import("@/lib/supabase/admin")');
  expect(source).not.toContain("createSupabaseServerClient");
});

type RawResult = Readonly<{ data: unknown; error: unknown }>;

function createHarness(options?: {
  result?: RawResult;
  getClientError?: Error;
  queryError?: Error;
}) {
  const calls = {
    clientLoads: 0,
    from: [] as string[],
    update: [] as BillingCustomerReferencePayload[],
    eq: [] as Array<{ column: string; value: string }>,
    select: [] as string[],
  };
  const client: BillingProfileSupabaseClient = {
    from(table) {
      calls.from.push(table);
      return {
        update(payload) {
          calls.update.push(payload);
          return {
            eq(column, value) {
              calls.eq.push({ column, value });
              return {
                async select(columns) {
                  calls.select.push(columns);
                  if (options?.queryError) {
                    throw options.queryError;
                  }
                  return (
                    options?.result ?? {
                      data: [{ id: "profile-row" }],
                      error: null,
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
  const repository = createBillingProfileRepository(async () => {
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
  code: BillingProfileRepositoryErrorCode,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(BillingProfileRepositoryError);
    expect(error).toMatchObject({
      name: "BillingProfileRepositoryError",
      code,
    });
    expect(error).not.toHaveProperty("cause");
    return error as BillingProfileRepositoryError;
  }

  throw new Error(`Expected ${code}`);
}

test("updates one user profile with the fixed Stripe customer payload", async () => {
  const { repository, calls } = createHarness();

  await repository.saveStripeCustomerReference({
    userId: USER_ID,
    customerId: CUSTOMER_ID,
  });

  expect(calls).toEqual({
    clientLoads: 1,
    from: ["user_profiles"],
    update: [
      {
        billing_customer_id: CUSTOMER_ID,
        billing_provider: "stripe",
      },
    ],
    eq: [{ column: "user_id", value: USER_ID }],
    select: ["id"],
  });
  expect(Object.isFrozen(calls.update[0])).toBe(true);
});

test("never includes protected billing, plan, profile, or ownership columns", async () => {
  const { repository, calls } = createHarness();

  await repository.saveStripeCustomerReference({
    userId: USER_ID,
    customerId: CUSTOMER_ID,
  });

  expect(Object.keys(calls.update[0]).sort()).toEqual([
    "billing_customer_id",
    "billing_provider",
  ]);
  for (const forbiddenColumn of [
    "plan",
    "billing_subscription_id",
    "billing_status",
    "current_period_end",
    "cancel_at_period_end",
    "plan_updated_at",
    "display_name",
    "company_name",
    "industry",
    "employee_size",
    "marketing_opt_in",
    "user_id",
  ]) {
    expect(calls.update[0]).not.toHaveProperty(forbiddenColumn);
  }
});

test("invalid ownership and customer identifiers fail before service-role access", async () => {
  for (const input of [
    { userId: "request-body-user", customerId: CUSTOMER_ID },
    { userId: USER_ID, customerId: "" },
    { userId: USER_ID, customerId: "not-a-stripe-customer" },
  ]) {
    const { repository, calls } = createHarness();
    const error = await expectRepositoryError(
      () => repository.saveStripeCustomerReference(input),
      "BILLING_PROFILE_INPUT_INVALID",
    );

    expect(calls.clientLoads).toBe(0);
    expect(error.message).not.toContain(input.userId);
    if (input.customerId) {
      expect(error.message).not.toContain(input.customerId);
    }
  }
});

test("a missing profile row fails closed", async () => {
  const { repository } = createHarness({
    result: { data: [], error: null },
  });

  await expectRepositoryError(
    () =>
      repository.saveStripeCustomerReference({
        userId: USER_ID,
        customerId: CUSTOMER_ID,
      }),
    "BILLING_PROFILE_ROW_NOT_FOUND",
  );
});

test("duplicate profile rows fail closed", async () => {
  const { repository } = createHarness({
    result: { data: [{ id: "one" }, { id: "two" }], error: null },
  });

  await expectRepositoryError(
    () =>
      repository.saveStripeCustomerReference({
        userId: USER_ID,
        customerId: CUSTOMER_ID,
      }),
    "BILLING_PROFILE_ROW_DUPLICATE",
  );
});

test("database errors are normalized without raw details or customer IDs", async () => {
  const rawDetails = "raw database error with service-role details";
  for (const options of [
    { result: { data: null, error: { message: rawDetails } } },
    { getClientError: new Error(rawDetails) },
    { queryError: new Error(rawDetails) },
  ]) {
    const { repository } = createHarness(options);
    const error = await expectRepositoryError(
      () =>
        repository.saveStripeCustomerReference({
          userId: USER_ID,
          customerId: CUSTOMER_ID,
        }),
      "BILLING_PROFILE_STORE_FAILED",
    );

    expect(error.message).not.toContain(rawDetails);
    expect(error.message).not.toContain(CUSTOMER_ID);
  }
});

test("malformed write results fail closed", async () => {
  const { repository } = createHarness({
    result: { data: { id: "not-an-array" }, error: null },
  });

  await expectRepositoryError(
    () =>
      repository.saveStripeCustomerReference({
        userId: USER_ID,
        customerId: CUSTOMER_ID,
      }),
    "BILLING_PROFILE_STORE_FAILED",
  );
});
