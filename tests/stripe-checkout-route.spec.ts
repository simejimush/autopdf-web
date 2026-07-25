import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

const ROUTE_PATH = resolve(process.cwd(), "app/api/stripe/checkout/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "cus_CheckoutRouteTest";

type Profile = Readonly<{
  plan: string;
  billing_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  billing_customer_id: string | null;
  billing_provider: string | null;
}>;

function createProfile(customerId: string | null): Profile {
  return {
    plan: "free",
    billing_status: null,
    current_period_end: null,
    cancel_at_period_end: false,
    billing_customer_id: customerId,
    billing_provider: customerId ? "stripe" : null,
  };
}

function loadRoute(options?: {
  user?: { id: string; email?: string } | null;
  authError?: { message: string } | null;
  profile?: Profile;
  profileError?: { message: string } | null;
  repositoryError?: Error;
  subscriptions?: Array<{ status: string }>;
  openSessions?: Array<{ mode: string; url: string | null }>;
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
  const calls = {
    getUser: 0,
    profileSelect: [] as string[],
    profileEq: [] as Array<{ column: string; value: string }>,
    jwtUpdates: [] as unknown[],
    customerCreate: [] as unknown[],
    repository: [] as Array<{ userId: string; customerId: string }>,
    subscriptionList: [] as unknown[],
    openSessionList: [] as unknown[],
    checkoutCreate: [] as unknown[],
  };

  class MockStripe {
    customers = {
      create: async (input: unknown) => {
        calls.customerCreate.push(input);
        return { id: CUSTOMER_ID };
      },
    };

    subscriptions = {
      list: async (input: unknown) => {
        calls.subscriptionList.push(input);
        return { data: options?.subscriptions ?? [] };
      },
    };

    checkout = {
      sessions: {
        list: async (input: unknown) => {
          calls.openSessionList.push(input);
          return { data: options?.openSessions ?? [] };
        },
        create: async (input: unknown) => {
          calls.checkoutCreate.push(input);
          return { url: "https://checkout.example/session" };
        },
      },
    };
  }

  const loadedModule = {
    exports: {} as { POST: () => Promise<Response> },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") {
      return { NextResponse };
    }
    if (specifier === "stripe") {
      return { __esModule: true, default: MockStripe };
    }
    if (specifier === "@/lib/supabase/server") {
      return {
        async createSupabaseServerClient() {
          return {
            auth: {
              async getUser() {
                calls.getUser += 1;
                return {
                  data: {
                    user:
                      options?.user === undefined
                        ? { id: USER_ID, email: "test@example.com" }
                        : options.user,
                  },
                  error: options?.authError ?? null,
                };
              },
            },
            from(table: string) {
              expect(table).toBe("user_profiles");
              return {
                select(columns: string) {
                  calls.profileSelect.push(columns);
                  return {
                    eq(column: string, value: string) {
                      calls.profileEq.push({ column, value });
                      return {
                        async single() {
                          return {
                            data: options?.profile ?? createProfile(null),
                            error: options?.profileError ?? null,
                          };
                        },
                      };
                    },
                  };
                },
                update(payload: unknown) {
                  calls.jwtUpdates.push(payload);
                  throw new Error("authenticated JWT update is forbidden");
                },
              };
            },
          };
        },
      };
    }
    if (specifier === "@/lib/billing/billingProfileRepository") {
      return {
        async saveStripeCustomerReference(input: {
          userId: string;
          customerId: string;
        }) {
          calls.repository.push(input);
          if (options?.repositoryError) {
            throw options.repositoryError;
          }
        },
      };
    }
    throw new Error(`Unexpected route dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    process: {
      env: {
        STRIPE_SECRET_KEY: "sk_test_not-a-real-secret",
        STRIPE_PRICE_ID_PRO: "price_test_pro",
        NEXT_PUBLIC_APP_URL: "https://app.example/",
      },
    },
  });

  return { POST: loadedModule.exports.POST, calls, source };
}

async function responseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("unauthenticated Checkout remains a fixed 401 without side effects", async () => {
  const route = loadRoute({ user: null });
  const response = await route.POST();

  expect(response.status).toBe(401);
  expect(await responseBody(response)).toEqual({
    ok: false,
    error_code: "AUTH_REQUIRED",
    message: "ログインしてください。",
  });
  expect(route.calls.repository).toHaveLength(0);
  expect(route.calls.customerCreate).toHaveLength(0);
  expect(route.calls.checkoutCreate).toHaveLength(0);
});

test("new customers are saved for the authenticated user before Session creation", async () => {
  const route = loadRoute();
  const response = await route.POST();

  expect(response.status).toBe(200);
  expect(route.calls.repository).toEqual([
    { userId: USER_ID, customerId: CUSTOMER_ID },
  ]);
  expect(route.calls.profileEq).toEqual([
    { column: "user_id", value: USER_ID },
  ]);
  expect(route.calls.jwtUpdates).toHaveLength(0);
  expect(route.calls.customerCreate).toHaveLength(1);
  expect(route.calls.checkoutCreate).toHaveLength(1);
  expect(route.source).not.toContain("request.json");
  expect(route.source).not.toContain("request.body");
  expect(route.source).not.toContain("supabaseAdmin");
  expect(route.source).not.toContain(".update(");
});

test("an existing profile customer is reused without a repository write", async () => {
  const route = loadRoute({ profile: createProfile("cus_ExistingCustomer") });
  const response = await route.POST();

  expect(response.status).toBe(200);
  expect(route.calls.customerCreate).toHaveLength(0);
  expect(route.calls.repository).toHaveLength(0);
  expect(route.calls.subscriptionList).toEqual([
    { customer: "cus_ExistingCustomer", status: "all", limit: 10 },
  ]);
  expect(route.calls.checkoutCreate).toHaveLength(1);
});

test("repository failure stops Checkout with the existing safe response", async () => {
  const rawError = "raw database service-role error";
  const route = loadRoute({ repositoryError: new Error(rawError) });
  const response = await route.POST();
  const text = await response.clone().text();

  expect(response.status).toBe(500);
  expect(await responseBody(response)).toEqual({
    ok: false,
    error_code: "INTERNAL_ERROR",
    message: "決済情報の保存に失敗しました。時間をおいて再度お試しください。",
  });
  expect(route.calls.customerCreate).toHaveLength(1);
  expect(route.calls.repository).toHaveLength(1);
  expect(route.calls.subscriptionList).toHaveLength(0);
  expect(route.calls.openSessionList).toHaveLength(0);
  expect(route.calls.checkoutCreate).toHaveLength(0);
  expect(text).not.toContain(rawError);
  expect(text).not.toContain(CUSTOMER_ID);
  expect(route.source).not.toContain("console.");
});

test("an open subscription Checkout Session remains reusable", async () => {
  const route = loadRoute({
    profile: createProfile("cus_ExistingCustomer"),
    openSessions: [
      { mode: "subscription", url: "https://checkout.example/reused" },
    ],
  });
  const response = await route.POST();

  expect(response.status).toBe(200);
  expect(await responseBody(response)).toEqual({
    ok: true,
    url: "https://checkout.example/reused",
    reused: true,
  });
  expect(route.calls.checkoutCreate).toHaveLength(0);
});

test("profile read failures keep the existing safe failure contract", async () => {
  const rawError = "raw profile read details";
  const route = loadRoute({ profileError: { message: rawError } });
  const response = await route.POST();
  const text = await response.clone().text();

  expect(response.status).toBe(500);
  expect(await responseBody(response)).toEqual({
    ok: false,
    error_code: "INTERNAL_ERROR",
    message: "契約情報の確認に失敗しました。時間をおいて再度お試しください。",
  });
  expect(route.calls.customerCreate).toHaveLength(0);
  expect(route.calls.repository).toHaveLength(0);
  expect(text).not.toContain(rawError);
});
