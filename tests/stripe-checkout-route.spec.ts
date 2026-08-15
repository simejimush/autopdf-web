import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

const ROUTE_PATH = resolve(process.cwd(), "app/api/stripe/checkout/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";

function loadRoute(options?: {
  user?: { id: string; email?: string } | null;
  disposition?: "claimed" | "busy" | "session_ready";
  providerFailure?: boolean;
}) {
  const source = readFileSync(ROUTE_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const calls = {
    customerCreate: [] as Array<{ input: unknown; options: unknown }>,
    sessionCreate: [] as Array<{ input: unknown; options: unknown }>,
    claims: 0,
    customerRecords: 0,
    sessionRecords: 0,
    failures: 0,
  };

  class MockStripe {
    customers = {
      create: async (input: unknown, requestOptions: unknown) => {
        calls.customerCreate.push({ input, options: requestOptions });
        if (options?.providerFailure)
          throw new Error("provider timeout with secret");
        return { id: "cus_safe" };
      },
    };
    subscriptions = { list: async () => ({ data: [] }) };
    checkout = {
      sessions: {
        list: async () => ({ data: [] }),
        retrieve: async () => ({
          id: "cs_existing",
          client_reference_id: USER_ID,
          mode: "subscription",
          status: "open",
          url: "https://checkout.example/existing",
        }),
        create: async (input: unknown, requestOptions: unknown) => {
          calls.sessionCreate.push({ input, options: requestOptions });
          return { id: "cs_new", url: "https://checkout.example/new" };
        },
      },
    };
  }

  const loaded = { exports: {} as { POST: () => Promise<Response> } };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextResponse };
    if (specifier === "stripe")
      return { __esModule: true, default: MockStripe };
    if (specifier === "@/lib/supabase/server") {
      return {
        async createSupabaseServerClient() {
          return {
            auth: {
              async getUser() {
                return {
                  data: {
                    user:
                      options?.user === undefined
                        ? { id: USER_ID, email: "safe@example.com" }
                        : options.user,
                  },
                  error: null,
                };
              },
            },
            from() {
              return {
                select: () => ({
                  eq: () => ({
                    single: async () => ({
                      data: {
                        plan: "free",
                        billing_status: null,
                        current_period_end: null,
                      },
                      error: null,
                    }),
                  }),
                }),
              };
            },
          };
        },
      };
    }
    if (specifier === "@/lib/billing/stripeSafetyRepository") {
      return {
        stripeSafetyRepository: {
          async claimCheckout() {
            calls.claims += 1;
            const disposition = options?.disposition ?? "claimed";
            return {
              disposition,
              attemptId: disposition === "claimed" ? ATTEMPT_ID : undefined,
              sessionId:
                disposition === "session_ready" ? "cs_existing" : undefined,
              leaseHash: "a".repeat(32),
            };
          },
          async recordCheckoutCustomer() {
            calls.customerRecords += 1;
          },
          async recordCheckoutSession() {
            calls.sessionRecords += 1;
          },
          async failCheckout() {
            calls.failures += 1;
          },
        },
      };
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  runInNewContext(compiled, {
    exports: loaded.exports,
    module: loaded,
    require: localRequire,
    process: {
      env: {
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_PRICE_ID_PRO: "price_pro",
        NEXT_PUBLIC_APP_URL: "https://app.example",
      },
    },
    Date,
  });
  return { POST: loaded.exports.POST, calls, source };
}

test("unauthenticated Checkout is 401 before claim or provider calls", async () => {
  const route = loadRoute({ user: null });
  const response = await route.POST();
  expect(response.status).toBe(401);
  expect(route.calls.claims).toBe(0);
  expect(route.calls.customerCreate).toHaveLength(0);
});

test("a concurrent request is rejected before any Stripe write", async () => {
  const route = loadRoute({ disposition: "busy" });
  const response = await route.POST();
  expect(response.status).toBe(409);
  expect(route.calls.claims).toBe(1);
  expect(route.calls.customerCreate).toHaveLength(0);
  expect(route.calls.sessionCreate).toHaveLength(0);
});

test("one attempt supplies stable, non-user-derived idempotency keys", async () => {
  const route = loadRoute();
  const response = await route.POST();
  expect(response.status).toBe(200);
  expect(route.calls.customerCreate[0].options).toEqual({
    idempotencyKey: `autopdf_checkout_customer_${ATTEMPT_ID}`,
  });
  expect(route.calls.sessionCreate[0].options).toEqual({
    idempotencyKey: `autopdf_checkout_session_${ATTEMPT_ID}`,
  });
  expect(route.calls.customerRecords).toBe(1);
  expect(route.calls.sessionRecords).toBe(1);
});

test("provider ambiguity is persisted as retryable with no raw error leak", async () => {
  const route = loadRoute({ providerFailure: true });
  const response = await route.POST();
  const responseText = await response.text();
  expect(response.status).toBe(503);
  expect(route.calls.failures).toBe(1);
  expect(route.calls.sessionCreate).toHaveLength(0);
  expect(responseText).not.toContain("provider timeout");
  expect(responseText).not.toContain("sk_test");
});

test("a durable open Session is reused and never duplicated", async () => {
  const route = loadRoute({ disposition: "session_ready" });
  const response = await route.POST();
  expect(response.status).toBe(200);
  expect(route.calls.customerCreate).toHaveLength(0);
  expect(route.calls.sessionCreate).toHaveLength(0);
});
