import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  createRealPreviewCheckoutRuntimeDependencies,
  enforceSafeCheckoutResponse,
  type PreviewCheckoutRuntimePorts,
} from "../scripts/preview-stripe-checkout-runtime-dependencies";
import {
  PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES,
  executePreviewCheckoutConcurrencyRuntime,
} from "../scripts/preview-stripe-checkout-runtime";

const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const CUSTOMER_ID = "cus_synthetic_runtime";
const SESSION_ID = "cs_synthetic_runtime";
const ACCOUNT_ID = "acct_synthetic_runtime";
const APP_ORIGIN = "https://synthetic-preview.invalid";
const SUPABASE_ORIGIN = "https://synthetic-preview.supabase.co";
const AUTH_COOKIE = "sb-synthetic-auth-token=synthetic-session-material";
const STRIPE_KEY = "sk_test_synthetic-runtime-material";

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("only the explicit in-progress 409 is classified as a safe loser", async () => {
  const safe = await enforceSafeCheckoutResponse(
    Response.json(
      { ok: false, error_code: "STRIPE_CHECKOUT_IN_PROGRESS" },
      { status: 409 },
    ),
  );
  const unsafe = await enforceSafeCheckoutResponse(
    Response.json(
      { ok: false, error_code: "STRIPE_ALREADY_SUBSCRIBED" },
      { status: 409 },
    ),
  );
  const malformed = await enforceSafeCheckoutResponse(
    new Response("raw-provider-marker", { status: 409 }),
  );

  expect(safe.status).toBe(409);
  expect(unsafe.status).toBe(500);
  expect(malformed.status).toBe(500);
});

test("real dependency wiring completes one mocked owner-scoped runtime", async () => {
  let checkoutCalls = 0;
  let credentialReads = 0;
  let deploymentReads = 0;
  let attemptTerminalWrites = 0;
  let profileRestoreWrites = 0;
  let customerDeleteWrites = 0;
  let sessionExpireWrites = 0;
  let checkoutStarted = 0;
  let releaseCheckout: (() => void) | undefined;
  const bothCheckoutStarted = new Promise<void>((resolve) => {
    releaseCheckout = resolve;
  });

  let customerDeleted = false;
  let sessionStatus: "open" | "expired" = "open";
  let profile = {
    user_id: OWNER_ID,
    plan: "free" as const,
    billing_provider: null as string | null,
    billing_customer_id: null as string | null,
    billing_subscription_id: null,
    billing_status: null,
    current_period_end: null,
    cancel_at_period_end: false,
  };
  let attempts: Array<{
    attempt_id: string;
    user_id: string;
    status: "session_ready";
    lease_hash: null;
    stripe_customer_id: string;
    stripe_session_id: string;
  }> = [];

  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.pathname === "/auth/v1/settings") {
      credentialReads += 1;
      return new Response("{}", { status: 200 });
    }
    if (url.pathname === "/api/internal/stripe-preview-smoke") {
      deploymentReads += 1;
      return Response.json(
        { ok: false, state: "blocked", error_code: "AUTH_REQUIRED" },
        { status: 401 },
      );
    }
    if (url.pathname === "/api/stripe/checkout") {
      checkoutStarted += 1;
      const requestNumber = checkoutStarted;
      if (checkoutStarted === 2) releaseCheckout?.();
      await bothCheckoutStarted;
      checkoutCalls += 1;
      if (requestNumber === 1) {
        profile = {
          ...profile,
          billing_provider: "stripe",
          billing_customer_id: CUSTOMER_ID,
        };
        attempts = [
          {
            attempt_id: ATTEMPT_ID,
            user_id: OWNER_ID,
            status: "session_ready",
            lease_hash: null,
            stripe_customer_id: CUSTOMER_ID,
            stripe_session_id: SESSION_ID,
          },
        ];
        return Response.json({ ok: true }, { status: 200 });
      }
      return Response.json(
        { ok: false, error_code: "STRIPE_CHECKOUT_IN_PROGRESS" },
        { status: 409 },
      );
    }
    throw new Error("unexpected mocked request");
  };

  function createAdminClient() {
    return {
      from(table: string) {
        return {
          select() {
            if (table === "user_profiles") {
              return {
                eq() {
                  return {
                    async limit() {
                      return { data: [profile], error: null };
                    },
                  };
                },
              };
            }
            const attemptQuery = {
              eq() {
                return attemptQuery;
              },
              in() {
                return attemptQuery;
              },
              order() {
                return attemptQuery;
              },
              async limit() {
                return { data: attempts, error: null };
              },
            };
            return attemptQuery;
          },
          update(payload: Record<string, unknown>) {
            const updateQuery = {
              eq() {
                return updateQuery;
              },
              in() {
                return updateQuery;
              },
              async select() {
                if (table === "stripe_checkout_attempts") {
                  attemptTerminalWrites += 1;
                  attempts = [];
                  return { data: [{ attempt_id: ATTEMPT_ID }], error: null };
                }
                profileRestoreWrites += 1;
                profile = {
                  ...profile,
                  billing_provider: payload.billing_provider as null,
                  billing_customer_id: payload.billing_customer_id as null,
                };
                return { data: [{ user_id: OWNER_ID }], error: null };
              },
            };
            return updateQuery;
          },
        };
      },
    } as never;
  }

  const customer = {
    id: CUSTOMER_ID,
    livemode: false,
    deleted: false,
    metadata: { user_id: OWNER_ID },
  };
  const session = () => ({
    id: SESSION_ID,
    livemode: false,
    client_reference_id: OWNER_ID,
    mode: "subscription",
    status: sessionStatus,
  });
  function createStripe() {
    return {
      accounts: { retrieve: async () => ({ id: ACCOUNT_ID }) },
      customers: {
        search: async () => ({
          data:
            profile.billing_customer_id && !customerDeleted ? [customer] : [],
          has_more: false,
        }),
        retrieve: async () => customer,
        del: async () => {
          customerDeleteWrites += 1;
          customerDeleted = true;
          return { id: CUSTOMER_ID, deleted: true };
        },
      },
      checkout: {
        sessions: {
          list: async () => ({
            data: attempts.length > 0 && !customerDeleted ? [session()] : [],
            has_more: false,
          }),
          retrieve: async () => session(),
          expire: async () => {
            sessionExpireWrites += 1;
            sessionStatus = "expired";
            return session();
          },
        },
      },
      subscriptions: {
        list: async () => ({ data: [], has_more: false }),
        retrieve: async () => {
          throw new Error("subscription retrieval must stay unreachable");
        },
      },
    } as never;
  }

  const ports: PreviewCheckoutRuntimePorts = {
    fetchImpl,
    expectedStripeAccountHash: hash(ACCOUNT_ID),
    createStripe,
    createAdminClient,
    async authenticate() {
      return {
        user: {
          id: OWNER_ID,
          is_anonymous: false,
        } as never,
        cookieHeader: AUTH_COOKIE,
        protectionCookie: "synthetic-protection=present",
      };
    },
  };

  const environment = {
    AUTOPDF_PREVIEW_HARNESS_EXPECTED_SUPABASE_ORIGIN_SHA256:
      hash(SUPABASE_ORIGIN),
    AUTOPDF_PREVIEW_HARNESS_SUPABASE_URL: SUPABASE_ORIGIN,
    AUTOPDF_PREVIEW_HARNESS_SUPABASE_ANON_KEY: "sb_publishable_x",
    AUTOPDF_PREVIEW_HARNESS_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.appOrigin]: APP_ORIGIN,
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.expectedAppOriginHash]:
      hash(APP_ORIGIN),
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.expectedOwnerHash]: hash(OWNER_ID),
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.authCookie]: AUTH_COOKIE,
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.stripeSecretKey]: STRIPE_KEY,
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.execute]:
      "APPROVED_PREVIEW_CHECKOUT_CONCURRENCY",
  };

  const result = await executePreviewCheckoutConcurrencyRuntime({
    environment,
    argv: [],
    dependencies: createRealPreviewCheckoutRuntimeDependencies(ports),
  });

  expect(result.verdict).toBe("STRIPE_SAFETY_PHASE_CLOSED");
  expect(result.concurrent_authenticated_request_count).toBe(2);
  expect(result.winner_count).toBe(1);
  expect(result.safe_loser_count).toBe(1);
  expect(result.cleanup).toBe("complete");
  expect(credentialReads).toBe(2);
  expect(deploymentReads).toBe(1);
  expect(checkoutCalls).toBe(2);
  expect(attemptTerminalWrites).toBe(1);
  expect(profileRestoreWrites).toBe(1);
  expect(sessionExpireWrites).toBe(1);
  expect(customerDeleteWrites).toBe(1);
  expect(attempts).toEqual([]);
  expect(profile.billing_customer_id).toBeNull();
});
