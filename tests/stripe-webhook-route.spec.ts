import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";
import { StripeWebhookProfileRepositoryError } from "../src/lib/billing/stripeWebhookProfileRepositoryCore";

const ROUTE_PATH = resolve(process.cwd(), "app/api/stripe/webhook/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const CUSTOMER_ID = "cus_WebhookRoute";
const SUBSCRIPTION_ID = "sub_WebhookRoute";
const PERIOD_END = 1787702400;

type EventObject = Readonly<{
  id: string;
  type: string;
  data: Readonly<{ object: Record<string, unknown> }>;
}>;

function subscriptionObject(
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    id: SUBSCRIPTION_ID,
    customer: CUSTOMER_ID,
    status: "active",
    metadata: { user_id: USER_ID, plan: "pro" },
    items: { data: [{ current_period_end: PERIOD_END }] },
    cancel_at_period_end: false,
    cancel_at: null,
    ...overrides,
  };
}

function checkoutEvent(): EventObject {
  return {
    id: "evt_checkout_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_checkout_completed",
        customer: CUSTOMER_ID,
        subscription: SUBSCRIPTION_ID,
        customer_details: { email: "private@example.test" },
        metadata: { user_id: USER_ID, plan: "pro" },
      },
    },
  };
}

function subscriptionEvent(
  type: "customer.subscription.updated" | "customer.subscription.deleted",
  overrides?: Partial<Record<string, unknown>>,
): EventObject {
  return {
    id: `evt_${type}`,
    type,
    data: { object: subscriptionObject(overrides) },
  };
}

function loadRoute(options?: {
  event?: EventObject;
  signatureError?: Error;
  resolveError?: Error;
  updateError?: Error;
  retrievedSubscription?: Record<string, unknown>;
  disableResult?: Readonly<{ ok: boolean }>;
}) {
  const source = readFileSync(ROUTE_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: ROUTE_PATH,
  }).outputText;
  const event = options?.event ?? checkoutEvent();
  const owner = Object.freeze({
    userId: USER_ID,
    customerId: CUSTOMER_ID,
    subscriptionId: SUBSCRIPTION_ID,
  });
  const calls = {
    constructEvent: [] as Array<{
      body: string;
      signature: string;
      secret: string;
    }>,
    retrieve: [] as string[],
    resolve: [] as Array<Record<string, unknown>>,
    update: [] as Array<Record<string, unknown>>,
    disable: [] as string[],
    logs: [] as unknown[][],
  };

  class MockStripe {
    webhooks = {
      constructEvent: (body: string, signature: string, secret: string) => {
        calls.constructEvent.push({ body, signature, secret });
        if (options?.signatureError) throw options.signatureError;
        return event;
      },
    };

    subscriptions = {
      retrieve: async (subscriptionId: string) => {
        calls.retrieve.push(subscriptionId);
        return options?.retrievedSubscription ?? subscriptionObject();
      },
    };
  }

  const loadedModule = {
    exports: {} as { POST: (request: Request) => Promise<Response> },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextResponse };
    if (specifier === "stripe") {
      return { __esModule: true, default: MockStripe };
    }
    if (specifier === "@/lib/billing/stripeWebhookProfileRepositoryCore") {
      return { StripeWebhookProfileRepositoryError };
    }
    if (specifier === "@/lib/billing/stripeWebhookProfileRepository") {
      return {
        async resolveStripeWebhookProfileOwner(input: Record<string, unknown>) {
          calls.resolve.push(input);
          if (options?.resolveError) throw options.resolveError;
          if (input.requireMetadataUserId && !input.metadataUserId) {
            throw new StripeWebhookProfileRepositoryError(
              "STRIPE_WEBHOOK_INPUT_INVALID",
            );
          }
          return owner;
        },
        async updateStripeWebhookProfile(input: Record<string, unknown>) {
          calls.update.push(input);
          if (options?.updateError) throw options.updateError;
        },
      };
    }
    if (specifier === "@/lib/rules/freePlanLimit") {
      return {
        async disableFreePlanOverflowRules(userId: string) {
          calls.disable.push(userId);
          return options?.disableResult ?? { ok: true };
        },
      };
    }
    throw new Error(`Unexpected route dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    console: {
      error(...args: unknown[]) {
        calls.logs.push(args);
      },
    },
    process: {
      env: {
        STRIPE_SECRET_KEY: "sk_test_not-a-real-secret",
        STRIPE_WEBHOOK_SECRET: "whsec_not-a-real-secret",
      },
    },
  });

  function request(options?: { signature?: string | null; body?: string }) {
    const headers = new Headers();
    if (options?.signature !== null) {
      headers.set("stripe-signature", options?.signature ?? "valid-signature");
    }
    return new Request("https://app.example/api/stripe/webhook", {
      method: "POST",
      headers,
      body: options?.body ?? "signed-body",
    });
  }

  return { POST: loadedModule.exports.POST, request, calls, source };
}

async function responseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("checkout completion resolves ownership before one profile update", async () => {
  const route = loadRoute();
  const response = await route.POST(route.request());

  expect(response.status).toBe(200);
  expect(await responseBody(response)).toEqual({ received: true });
  expect(route.calls.resolve).toEqual([
    {
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      metadataUserId: USER_ID,
      requireMetadataUserId: true,
    },
  ]);
  expect(route.calls.retrieve).toEqual([SUBSCRIPTION_ID]);
  expect(route.calls.update).toHaveLength(1);
  expect(route.calls.update[0]).toMatchObject({
    owner: {
      userId: USER_ID,
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
    },
    plan: "pro",
    billingStatus: "active",
    currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(),
  });
  expect(route.calls.update[0]).not.toHaveProperty("cancelAtPeriodEnd");
});

test("subscription updated preserves status and cancellation calculation", async () => {
  const route = loadRoute({
    event: subscriptionEvent("customer.subscription.updated", {
      cancel_at_period_end: true,
    }),
  });
  const response = await route.POST(route.request());

  expect(response.status).toBe(200);
  expect(route.calls.resolve).toEqual([
    {
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      metadataUserId: USER_ID,
      requireMetadataUserId: false,
    },
  ]);
  expect(route.calls.retrieve).toHaveLength(0);
  expect(route.calls.update[0]).toMatchObject({
    plan: "pro",
    billingStatus: "active",
    cancelAtPeriodEnd: true,
  });
});

test("subscription deleted updates only the owner and applies existing free-plan handling", async () => {
  const route = loadRoute({
    event: subscriptionEvent("customer.subscription.deleted", {
      status: "canceled",
      items: { data: [] },
    }),
  });
  const response = await route.POST(route.request());

  expect(response.status).toBe(200);
  expect(route.calls.update).toHaveLength(1);
  expect(route.calls.update[0]).toMatchObject({
    owner: { userId: USER_ID },
    plan: "free",
    billingStatus: "canceled",
    currentPeriodEnd: null,
  });
  expect(route.calls.disable).toEqual([USER_ID]);
});

test("expanded Stripe objects retain the same ownership contract", async () => {
  const route = loadRoute({
    event: subscriptionEvent("customer.subscription.updated", {
      customer: { id: CUSTOMER_ID },
    }),
  });
  const response = await route.POST(route.request());

  expect(response.status).toBe(200);
  expect(route.calls.resolve[0]).toMatchObject({ customerId: CUSTOMER_ID });
  expect(route.calls.update).toHaveLength(1);
});

test("missing checkout metadata fails closed without update or fallback", async () => {
  const event = checkoutEvent();
  const route = loadRoute({
    event: {
      ...event,
      data: { object: { ...event.data.object, metadata: {} } },
    },
  });
  const response = await route.POST(route.request());

  expect(response.status).toBe(500);
  expect(await responseBody(response)).toMatchObject({
    ok: false,
    error_code: "BILLING_OWNERSHIP_INVALID",
  });
  expect(route.calls.update).toHaveLength(0);
  expect(route.calls.retrieve).toHaveLength(0);
});

test("repository ownership conflicts never update or fall back to another user", async () => {
  const route = loadRoute({
    event: subscriptionEvent("customer.subscription.updated", {
      metadata: { user_id: OTHER_USER_ID },
    }),
    resolveError: new StripeWebhookProfileRepositoryError(
      "STRIPE_WEBHOOK_OWNER_CONFLICT",
    ),
  });
  const response = await route.POST(route.request());

  expect(response.status).toBe(500);
  expect(route.calls.resolve).toHaveLength(1);
  expect(route.calls.update).toHaveLength(0);
  expect(route.calls.disable).toHaveLength(0);
});

test("retrieved subscription identifiers and metadata must match the Session", async () => {
  for (const retrievedSubscription of [
    subscriptionObject({ customer: "cus_Different" }),
    subscriptionObject({ id: "sub_Different" }),
    subscriptionObject({ metadata: { user_id: OTHER_USER_ID } }),
  ]) {
    const route = loadRoute({ retrievedSubscription });
    const response = await route.POST(route.request());

    expect(response.status).toBe(500);
    expect(route.calls.resolve).toHaveLength(1);
    expect(route.calls.update).toHaveLength(0);
  }
});

test("zero and duplicate update results remain retryable failures", async () => {
  for (const code of [
    "STRIPE_WEBHOOK_PROFILE_UPDATE_NOT_FOUND",
    "STRIPE_WEBHOOK_PROFILE_UPDATE_DUPLICATE",
  ] as const) {
    const route = loadRoute({
      event: subscriptionEvent("customer.subscription.updated"),
      updateError: new StripeWebhookProfileRepositoryError(code),
    });
    const response = await route.POST(route.request());

    expect(response.status).toBe(500);
    expect(await responseBody(response)).toMatchObject({
      ok: false,
      error_code: "DB_UPDATE_FAILED",
    });
    expect(route.calls.update).toHaveLength(1);
  }
});

test("signature failures stop before all profile and Stripe subscription work", async () => {
  for (const options of [
    { signature: null, signatureError: undefined },
    { signature: "invalid", signatureError: new Error("invalid signature") },
  ]) {
    const route = loadRoute({ signatureError: options.signatureError });
    const response = await route.POST(
      route.request({ signature: options.signature }),
    );

    expect(response.status).toBe(400);
    expect(route.calls.resolve).toHaveLength(0);
    expect(route.calls.update).toHaveLength(0);
    expect(route.calls.retrieve).toHaveLength(0);
  }
});

test("same verified event can be retried without changing the logical billing state", async () => {
  const route = loadRoute({
    event: subscriptionEvent("customer.subscription.updated"),
  });

  const first = await route.POST(route.request());
  const second = await route.POST(route.request());

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(route.calls.update).toHaveLength(2);
  for (const update of route.calls.update) {
    expect(update).toMatchObject({
      owner: {
        userId: USER_ID,
        customerId: CUSTOMER_ID,
        subscriptionId: SUBSCRIPTION_ID,
      },
      plan: "pro",
      billingStatus: "active",
      cancelAtPeriodEnd: false,
    });
  }
});

test("ownership failures expose only fixed codes and event type", async () => {
  const privateEmail = "private@example.test";
  const route = loadRoute({
    resolveError: new StripeWebhookProfileRepositoryError(
      "STRIPE_WEBHOOK_OWNER_CONFLICT",
    ),
  });
  const response = await route.POST(route.request({ body: privateEmail }));
  const responseText = await response.text();
  const logText = JSON.stringify(route.calls.logs);

  expect(response.status).toBe(500);
  for (const secret of [
    USER_ID,
    CUSTOMER_ID,
    SUBSCRIPTION_ID,
    privateEmail,
    "signed-body",
  ]) {
    expect(responseText).not.toContain(secret);
    expect(logText).not.toContain(secret);
  }
  expect(logText).toContain("STRIPE_WEBHOOK_OWNER_CONFLICT");
  expect(logText).toContain("checkout.session.completed");
});

test("route never identifies owners by email or accesses service role directly", () => {
  const route = loadRoute();

  expect(route.source).not.toContain("supabaseAdmin");
  expect(route.source).not.toContain("customer_details");
  expect(route.source).not.toContain("customer_email");
  expect(route.source).not.toContain("event.id");
  expect(route.source).toContain("resolveStripeWebhookProfileOwner");
  expect(route.source).toContain("updateStripeWebhookProfile");
});
