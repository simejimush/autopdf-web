import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  StripeWebhookProfileRepositoryError,
  createStripeWebhookProfileRepository,
  type StripeWebhookProfileRepositoryErrorCode,
  type StripeWebhookProfileSupabaseClient,
  type StripeWebhookProfileUpdatePayload,
} from "../src/lib/billing/stripeWebhookProfileRepositoryCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const CUSTOMER_ID = "cus_WebhookOwner";
const OTHER_CUSTOMER_ID = "cus_OtherOwner";
const SUBSCRIPTION_ID = "sub_WebhookOwner";
const OTHER_SUBSCRIPTION_ID = "sub_OtherOwner";

type ProfileRow = Readonly<{
  id: string;
  user_id: string;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
}>;

type RawResult = Readonly<{ data: unknown; error: unknown }>;

function profile(
  userId = USER_ID,
  customerId: string | null = CUSTOMER_ID,
  subscriptionId: string | null = SUBSCRIPTION_ID,
): ProfileRow {
  return {
    id: `profile-${userId}`,
    user_id: userId,
    billing_customer_id: customerId,
    billing_subscription_id: subscriptionId,
  };
}

function lookupKey(column: string, value: string) {
  return `${column}:${value}`;
}

function createHarness(options?: {
  lookups?: Readonly<Record<string, RawResult>>;
  updateResult?: RawResult;
  getClientError?: Error;
  queryError?: Error;
  updateError?: Error;
}) {
  const owner = profile();
  const defaultLookups: Readonly<Record<string, RawResult>> = {
    [lookupKey("billing_customer_id", CUSTOMER_ID)]: {
      data: [owner],
      error: null,
    },
    [lookupKey("user_id", USER_ID)]: { data: [owner], error: null },
    [lookupKey("billing_subscription_id", SUBSCRIPTION_ID)]: {
      data: [owner],
      error: null,
    },
  };
  const calls = {
    clientLoads: 0,
    from: [] as string[],
    select: [] as string[],
    lookupEq: [] as Array<{ column: string; value: string }>,
    update: [] as StripeWebhookProfileUpdatePayload[],
    updateEq: [] as Array<{ column: string; value: string }>,
    updateSelect: [] as string[],
  };

  const client: StripeWebhookProfileSupabaseClient = {
    from(table) {
      calls.from.push(table);
      return {
        select(columns) {
          calls.select.push(columns);
          return {
            async eq(column, value) {
              calls.lookupEq.push({ column, value });
              if (options?.queryError) throw options.queryError;
              return (
                options?.lookups?.[lookupKey(column, value)] ??
                defaultLookups[lookupKey(column, value)] ?? {
                  data: [],
                  error: null,
                }
              );
            },
          };
        },
        update(payload) {
          calls.update.push(payload);
          return {
            eq(userColumn, userValue) {
              calls.updateEq.push({ column: userColumn, value: userValue });
              return {
                eq(customerColumn, customerValue) {
                  calls.updateEq.push({
                    column: customerColumn,
                    value: customerValue,
                  });
                  return {
                    async select(columns) {
                      calls.updateSelect.push(columns);
                      if (options?.updateError) throw options.updateError;
                      return (
                        options?.updateResult ?? {
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
    },
  };

  const repository = createStripeWebhookProfileRepository(async () => {
    calls.clientLoads += 1;
    if (options?.getClientError) throw options.getClientError;
    return client;
  });

  return { repository, calls };
}

async function expectRepositoryError(
  action: () => Promise<unknown>,
  code: StripeWebhookProfileRepositoryErrorCode,
) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(StripeWebhookProfileRepositoryError);
    expect(error).toMatchObject({ code });
    expect(error).not.toHaveProperty("cause");
    return error as StripeWebhookProfileRepositoryError;
  }
  throw new Error(`Expected ${code}`);
}

function resolveOwner(
  repository: ReturnType<typeof createStripeWebhookProfileRepository>,
  overrides?: Partial<{
    customerId: string;
    subscriptionId: string;
    metadataUserId: string | null;
    requireMetadataUserId: boolean;
  }>,
) {
  return repository.resolveStripeWebhookProfileOwner({
    customerId: CUSTOMER_ID,
    subscriptionId: SUBSCRIPTION_ID,
    metadataUserId: USER_ID,
    requireMetadataUserId: true,
    ...overrides,
  });
}

test("server adapter keeps service-role access lazy and isolated", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/billing/stripeWebhookProfileRepository.ts"),
    "utf8",
  );

  expect(source).toContain('import "server-only";');
  expect(source).toContain('await import("@/lib/supabase/admin")');
  expect(source).not.toContain("createSupabaseServerClient");
});

test("customer, subscription, and metadata resolve exactly one owner", async () => {
  const { repository, calls } = createHarness();

  const owner = await resolveOwner(repository);

  expect(owner).toEqual({
    userId: USER_ID,
    customerId: CUSTOMER_ID,
    subscriptionId: SUBSCRIPTION_ID,
  });
  expect(Object.isFrozen(owner)).toBe(true);
  expect(calls.lookupEq).toEqual([
    { column: "billing_customer_id", value: CUSTOMER_ID },
    { column: "user_id", value: USER_ID },
    { column: "billing_subscription_id", value: SUBSCRIPTION_ID },
  ]);
});

test("a new subscription may bind only when the customer owner has no subscription", async () => {
  const ownerWithoutSubscription = profile(USER_ID, CUSTOMER_ID, null);
  const { repository } = createHarness({
    lookups: {
      [lookupKey("billing_customer_id", CUSTOMER_ID)]: {
        data: [ownerWithoutSubscription],
        error: null,
      },
      [lookupKey("user_id", USER_ID)]: {
        data: [ownerWithoutSubscription],
        error: null,
      },
      [lookupKey("billing_subscription_id", SUBSCRIPTION_ID)]: {
        data: [],
        error: null,
      },
    },
  });

  await expect(resolveOwner(repository)).resolves.toMatchObject({
    userId: USER_ID,
  });
});

test("metadata cannot identify a different customer or subscription owner", async () => {
  for (const metadataProfile of [
    profile(OTHER_USER_ID, OTHER_CUSTOMER_ID, SUBSCRIPTION_ID),
    profile(USER_ID, CUSTOMER_ID, OTHER_SUBSCRIPTION_ID),
  ]) {
    const { repository, calls } = createHarness({
      lookups: {
        [lookupKey("billing_customer_id", CUSTOMER_ID)]: {
          data: [profile()],
          error: null,
        },
        [lookupKey("user_id", OTHER_USER_ID)]: {
          data: [metadataProfile],
          error: null,
        },
        [lookupKey("user_id", USER_ID)]: {
          data: [metadataProfile],
          error: null,
        },
      },
    });

    await expectRepositoryError(
      () =>
        resolveOwner(repository, {
          metadataUserId: metadataProfile.user_id,
        }),
      "STRIPE_WEBHOOK_OWNER_CONFLICT",
    );
    expect(calls.update).toHaveLength(0);
  }
});

test("customer and subscription pointing to different users fail closed", async () => {
  const { repository, calls } = createHarness({
    lookups: {
      [lookupKey("billing_customer_id", CUSTOMER_ID)]: {
        data: [profile(USER_ID, CUSTOMER_ID, null)],
        error: null,
      },
      [lookupKey("billing_subscription_id", SUBSCRIPTION_ID)]: {
        data: [profile(OTHER_USER_ID, OTHER_CUSTOMER_ID, SUBSCRIPTION_ID)],
        error: null,
      },
    },
  });

  await expectRepositoryError(
    () =>
      resolveOwner(repository, {
        metadataUserId: null,
        requireMetadataUserId: false,
      }),
    "STRIPE_WEBHOOK_OWNER_CONFLICT",
  );
  expect(calls.update).toHaveLength(0);
});

test("zero and duplicate customer candidates are rejected", async () => {
  for (const [data, code] of [
    [[], "STRIPE_WEBHOOK_OWNER_NOT_FOUND"],
    [
      [profile(), profile(OTHER_USER_ID, CUSTOMER_ID, null)],
      "STRIPE_WEBHOOK_OWNER_DUPLICATE",
    ],
  ] as const) {
    const { repository, calls } = createHarness({
      lookups: {
        [lookupKey("billing_customer_id", CUSTOMER_ID)]: {
          data,
          error: null,
        },
      },
    });

    await expectRepositoryError(() => resolveOwner(repository), code);
    expect(calls.update).toHaveLength(0);
  }
});

test("zero conflicting and duplicate subscription candidates are rejected", async () => {
  const cases: Array<{
    customer: ProfileRow;
    subscriptions: ProfileRow[];
    code: StripeWebhookProfileRepositoryErrorCode;
  }> = [
    {
      customer: profile(USER_ID, CUSTOMER_ID, OTHER_SUBSCRIPTION_ID),
      subscriptions: [],
      code: "STRIPE_WEBHOOK_OWNER_CONFLICT",
    },
    {
      customer: profile(),
      subscriptions: [profile(), profile(OTHER_USER_ID, null, SUBSCRIPTION_ID)],
      code: "STRIPE_WEBHOOK_OWNER_DUPLICATE",
    },
  ];

  for (const testCase of cases) {
    const { repository, calls } = createHarness({
      lookups: {
        [lookupKey("billing_customer_id", CUSTOMER_ID)]: {
          data: [testCase.customer],
          error: null,
        },
        [lookupKey("billing_subscription_id", SUBSCRIPTION_ID)]: {
          data: testCase.subscriptions,
          error: null,
        },
      },
    });

    await expectRepositoryError(
      () =>
        resolveOwner(repository, {
          metadataUserId: null,
          requireMetadataUserId: false,
        }),
      testCase.code,
    );
    expect(calls.update).toHaveLength(0);
  }
});

test("metadata zero and duplicate candidates are rejected without fallback", async () => {
  for (const [data, code] of [
    [[], "STRIPE_WEBHOOK_OWNER_NOT_FOUND"],
    [
      [profile(), profile(USER_ID, CUSTOMER_ID, null)],
      "STRIPE_WEBHOOK_OWNER_DUPLICATE",
    ],
  ] as const) {
    const { repository, calls } = createHarness({
      lookups: {
        [lookupKey("billing_customer_id", CUSTOMER_ID)]: {
          data: [profile()],
          error: null,
        },
        [lookupKey("user_id", USER_ID)]: { data, error: null },
      },
    });

    await expectRepositoryError(() => resolveOwner(repository), code);
    expect(calls.update).toHaveLength(0);
  }
});

test("invalid identifiers and missing required metadata fail before service-role access", async () => {
  for (const overrides of [
    { customerId: "not-customer" },
    { subscriptionId: "not-subscription" },
    { metadataUserId: "not-user" },
    { metadataUserId: null },
  ]) {
    const { repository, calls } = createHarness();
    await expectRepositoryError(
      () => resolveOwner(repository, overrides),
      "STRIPE_WEBHOOK_INPUT_INVALID",
    );
    expect(calls.clientLoads).toBe(0);
  }
});

test("updates only the resolved user and customer and requires exactly one row", async () => {
  const { repository, calls } = createHarness();
  const owner = await resolveOwner(repository);

  await repository.updateStripeWebhookProfile({
    owner,
    plan: "pro",
    billingStatus: "active",
    currentPeriodEnd: "2026-08-26T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    planUpdatedAt: "2026-07-26T00:00:00.000Z",
  });

  expect(calls.updateEq).toEqual([
    { column: "user_id", value: USER_ID },
    { column: "billing_customer_id", value: CUSTOMER_ID },
  ]);
  expect(calls.updateSelect).toEqual(["id"]);
  expect(calls.update).toEqual([
    {
      plan: "pro",
      billing_provider: "stripe",
      billing_customer_id: CUSTOMER_ID,
      billing_subscription_id: SUBSCRIPTION_ID,
      billing_status: "active",
      current_period_end: "2026-08-26T00:00:00.000Z",
      cancel_at_period_end: false,
      plan_updated_at: "2026-07-26T00:00:00.000Z",
    },
  ]);
  expect(calls.update[0]).not.toHaveProperty("user_id");
  expect(Object.isFrozen(calls.update[0])).toBe(true);
});

test("zero, duplicate, malformed, and failed updates never count as success", async () => {
  const cases: Array<{
    options: Parameters<typeof createHarness>[0];
    code: StripeWebhookProfileRepositoryErrorCode;
  }> = [
    {
      options: { updateResult: { data: [], error: null } },
      code: "STRIPE_WEBHOOK_PROFILE_UPDATE_NOT_FOUND",
    },
    {
      options: {
        updateResult: { data: [{ id: "one" }, { id: "two" }], error: null },
      },
      code: "STRIPE_WEBHOOK_PROFILE_UPDATE_DUPLICATE",
    },
    {
      options: { updateResult: { data: null, error: null } },
      code: "STRIPE_WEBHOOK_PROFILE_UPDATE_FAILED",
    },
    {
      options: {
        updateResult: { data: null, error: { message: "private DB error" } },
      },
      code: "STRIPE_WEBHOOK_PROFILE_UPDATE_FAILED",
    },
    {
      options: { updateError: new Error("private DB error") },
      code: "STRIPE_WEBHOOK_PROFILE_UPDATE_FAILED",
    },
  ];

  for (const testCase of cases) {
    const { repository } = createHarness(testCase.options);
    const owner = await resolveOwner(repository);
    const error = await expectRepositoryError(
      () =>
        repository.updateStripeWebhookProfile({
          owner,
          plan: "pro",
          billingStatus: "active",
          currentPeriodEnd: null,
          planUpdatedAt: "2026-07-26T00:00:00.000Z",
        }),
      testCase.code,
    );

    expect(error.message).not.toContain(USER_ID);
    expect(error.message).not.toContain(CUSTOMER_ID);
    expect(error.message).not.toContain(SUBSCRIPTION_ID);
    expect(error.message).not.toContain("private DB error");
  }
});

test("read failures and malformed rows expose only fixed errors", async () => {
  for (const options of [
    { getClientError: new Error("private service-role error") },
    { queryError: new Error("private query error") },
    {
      lookups: {
        [lookupKey("billing_customer_id", CUSTOMER_ID)]: {
          data: [{ user_id: USER_ID }],
          error: null,
        },
      },
    },
  ]) {
    const { repository } = createHarness(options);
    const error = await expectRepositoryError(
      () => resolveOwner(repository),
      "STRIPE_WEBHOOK_PROFILE_READ_FAILED",
    );
    expect(error.message).not.toContain("private");
    expect(error.message).not.toContain(CUSTOMER_ID);
  }
});
