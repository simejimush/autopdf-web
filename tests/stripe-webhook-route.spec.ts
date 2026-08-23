import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextRequest, NextResponse } from "next/server";
import ts from "typescript";
import { createStripeWebhookProcessor } from "../src/lib/billing/stripeWebhookCore";

const ROUTE_PATH = resolve(process.cwd(), "app/api/stripe/webhook/route.ts");

function subscription() {
  return {
    id: "sub_safe",
    customer: "cus_safe",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    items: { data: [{ current_period_end: 1_900_000_000 }] },
  };
}

function loadRoute(options?: {
  invalidSignature?: boolean;
  claimDisposition?: "claimed" | "duplicate" | "in_progress" | "conflict";
  claimFailure?: boolean;
  finalizeDisposition?: "processed" | "stale" | "retryable_failed";
  providerFailure?: boolean;
  customerMismatch?: boolean;
  failureTransitionError?: boolean;
}) {
  const source = readFileSync(ROUTE_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const calls = { claims: 0, retrieves: 0, finalizes: 0, failures: 0 };
  class MockStripe {
    webhooks = {
      constructEvent: () => {
        if (options?.invalidSignature) throw new Error("signature secret leak");
        return {
          id: "evt_safe",
          type: "customer.subscription.updated",
          created: 1_800_000_000,
          data: { object: subscription() },
        };
      },
    };
    subscriptions = {
      retrieve: async () => {
        calls.retrieves += 1;
        if (options?.providerFailure) throw new Error("raw provider response");
        return options?.customerMismatch
          ? { ...subscription(), customer: "cus_other" }
          : subscription();
      },
    };
  }
  const loaded = {
    exports: {} as { POST: (request: NextRequest) => Promise<Response> },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextRequest, NextResponse };
    if (specifier === "stripe")
      return { __esModule: true, default: MockStripe };
    if (specifier === "@/lib/billing/stripeWebhookCore") {
      return { createStripeWebhookProcessor };
    }
    if (specifier === "@/lib/billing/stripeSafetyRepository") {
      return {
        stripeSafetyRepository: {
          async claimWebhook() {
            calls.claims += 1;
            if (options?.claimFailure) throw new Error("raw database details");
            return {
              disposition: options?.claimDisposition ?? "claimed",
              leaseHash: "a".repeat(32),
            };
          },
          async finalizeWebhook() {
            calls.finalizes += 1;
            return options?.finalizeDisposition ?? "processed";
          },
          async failWebhook() {
            calls.failures += 1;
            if (options?.failureTransitionError) {
              throw new Error("STRIPE_WEBHOOK_FAILURE_CAS_LOST");
            }
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
        STRIPE_WEBHOOK_SECRET: "whsec_test",
      },
    },
    Date,
    Set,
  });
  return { POST: loaded.exports.POST, calls };
}

function request(signature = "valid") {
  return new NextRequest("https://app.example/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: "signed raw body",
  });
}

test("signature validation happens before every ledger or provider operation", async () => {
  const route = loadRoute({ invalidSignature: true });
  const response = await route.POST(request("invalid"));
  expect(response.status).toBe(400);
  expect(route.calls.claims).toBe(0);
  expect(route.calls.retrieves).toBe(0);
  expect(route.calls.finalizes).toBe(0);
});

test("duplicate event IDs are acknowledged without a second profile update", async () => {
  const route = loadRoute({ claimDisposition: "duplicate" });
  const response = await route.POST(request());
  expect(response.status).toBe(200);
  expect(route.calls.retrieves).toBe(0);
  expect(route.calls.finalizes).toBe(0);
});

test("in-progress and conflicting claims stop before provider access", async () => {
  for (const [claimDisposition, status] of [
    ["in_progress", 503],
    ["conflict", 400],
  ] as const) {
    const route = loadRoute({ claimDisposition });
    const response = await route.POST(request());
    expect(response.status).toBe(status);
    expect(route.calls.retrieves).toBe(0);
    expect(route.calls.finalizes).toBe(0);
  }
});

test("ledger failure is sanitized and stops before provider access", async () => {
  const route = loadRoute({ claimFailure: true });
  const response = await route.POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    ok: false,
    error_code: "STRIPE_WEBHOOK_LEDGER_UNAVAILABLE",
    message: "Webhookを安全に記録できませんでした。",
  });
  expect(route.calls.retrieves).toBe(0);
  expect(route.calls.finalizes).toBe(0);
});

test("an old event is reconciled and reported stale without route-level writes", async () => {
  const route = loadRoute({ finalizeDisposition: "stale" });
  const response = await route.POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ received: true, stale: true });
  expect(route.calls.finalizes).toBe(1);
});

test("provider failure after durable claim is marked retryable without raw leakage", async () => {
  const route = loadRoute({ providerFailure: true });
  const response = await route.POST(request());
  const text = await response.text();
  expect(response.status).toBe(503);
  expect(route.calls.claims).toBe(1);
  expect(route.calls.failures).toBe(1);
  expect(route.calls.finalizes).toBe(0);
  expect(text).not.toContain("raw provider response");
  expect(text).not.toContain("whsec_test");
});

test("provider/customer ownership mismatch becomes terminal before profile finalization", async () => {
  const route = loadRoute({ customerMismatch: true });
  const response = await route.POST(request());
  expect(response.status).toBe(400);
  expect(route.calls.failures).toBe(1);
  expect(route.calls.finalizes).toBe(0);
});

test("lost failure CAS keeps the webhook retryable at the HTTP boundary", async () => {
  const route = loadRoute({
    customerMismatch: true,
    failureTransitionError: true,
  });
  const response = await route.POST(request());
  expect(response.status).toBe(503);
  expect(route.calls.failures).toBe(2);
  expect(route.calls.finalizes).toBe(0);
});
