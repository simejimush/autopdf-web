import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { sha256 } from "../src/lib/billing/controlledStripeEventCore";
import {
  PreviewStripeSmokeError,
  runPreviewStripeSmoke,
  type PreviewStripeSmokeProfile,
} from "../src/lib/billing/previewStripeRuntimeSmokeCore";
import {
  createPreviewStripeSmokeRoute,
  type PreviewSmokeEnvironment,
} from "../src/lib/billing/previewStripeSmokeRouteCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = `cus_${"a".repeat(12)}`;
const SUBSCRIPTION_ID = `sub_${"b".repeat(12)}`;
const ACCOUNT_ID = "acct_runtime_fixture";
const VERCEL_URL = "autopdf-web-git-codex-stripe-safety-clean-safe.vercel.app";
const REQUEST_URL = `https://${VERCEL_URL}/api/internal/stripe-preview-smoke`;
const TEST_SECRET = `sk_${"test"}_runtime-placeholder`;
const WEBHOOK_SECRET = `whsec_${"runtime-placeholder"}`;

const PROFILE: PreviewStripeSmokeProfile = Object.freeze({
  user_id: USER_ID,
  billing_customer_id: CUSTOMER_ID,
  billing_subscription_id: SUBSCRIPTION_ID,
  billing_provider: "stripe",
  plan: "pro",
  billing_status: "active",
  current_period_end: "2030-02-01T00:00:00.000Z",
  cancel_at_period_end: false,
});

function environment(
  overrides: Partial<PreviewSmokeEnvironment> = {},
): PreviewSmokeEnvironment {
  const projectId = "project-runtime-fixture";
  const supabaseOrigin = "https://preview-runtime.supabase.co";
  const gitSha = "a".repeat(40);
  return {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "codex/stripe-safety-clean",
    VERCEL_GIT_COMMIT_SHA: gitSha,
    VERCEL_PROJECT_ID: projectId,
    VERCEL_DEPLOYMENT_ID: "deployment-runtime-fixture",
    VERCEL_URL,
    NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin,
    AUTOPDF_PREVIEW_STRIPE_SMOKE_ALLOWED_GIT_SHA: gitSha,
    AUTOPDF_PREVIEW_STRIPE_SMOKE_VERCEL_PROJECT_SHA256: sha256(projectId),
    AUTOPDF_PREVIEW_STRIPE_SMOKE_SUPABASE_ORIGIN_SHA256: sha256(supabaseOrigin),
    AUTOPDF_PREVIEW_STRIPE_SMOKE_ENABLE: "CONTROLLED_PREVIEW_STRIPE_WEBHOOK",
    AUTOPDF_PREVIEW_STRIPE_EXECUTE: "APPROVED_CONTROLLED_PREVIEW_WEBHOOK",
    AUTOPDF_PREVIEW_STRIPE_SMOKE_OWNER_SHA256: sha256(USER_ID),
    AUTOPDF_PREVIEW_STRIPE_SMOKE_CUSTOMER_SHA256: sha256(CUSTOMER_ID),
    AUTOPDF_PREVIEW_STRIPE_SMOKE_SUBSCRIPTION_SHA256: sha256(SUBSCRIPTION_ID),
    STRIPE_SECRET_KEY: TEST_SECRET,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...overrides,
  };
}

function routeHarness(options?: {
  authenticated?: boolean;
  profile?: PreviewStripeSmokeProfile;
}) {
  const calls = { authenticate: 0, execute: 0, provider: 0, webhook: 0 };
  const route = createPreviewStripeSmokeRoute({
    async authenticate() {
      calls.authenticate += 1;
      if (options?.authenticated === false) return { ok: false };
      return {
        ok: true,
        userId: USER_ID,
        profile: options?.profile ?? PROFILE,
        async loadProfileAfter() {
          return options?.profile ?? PROFILE;
        },
      };
    },
    async createExecution() {
      calls.execute += 1;
      return {
        provider: {
          accounts: {
            async retrieve() {
              calls.provider += 1;
              return { id: "wrong-account" };
            },
          },
          subscriptions: {
            async retrieve() {
              calls.provider += 1;
              return {
                id: SUBSCRIPTION_ID,
                customer: CUSTOMER_ID,
                livemode: false,
              };
            },
          },
        },
        async loadBaselineCreatedAt() {
          return "2030-01-01T00:00:00.000Z";
        },
        async processWebhook() {
          calls.webhook += 1;
          return { status: 200, body: { received: true, stale: true } };
        },
      };
    },
  });
  return { route, calls };
}

function invokeRoute(
  route: ReturnType<typeof createPreviewStripeSmokeRoute>,
  env = environment(),
  requestOverrides: Partial<{
    requestUrl: string;
    origin: string | null;
    fetchSite: string | null;
    fetchMode: string | null;
  }> = {},
) {
  return route({
    requestUrl: REQUEST_URL,
    origin: `https://${VERCEL_URL}`,
    fetchSite: "same-origin",
    fetchMode: "cors",
    environment: env,
    ...requestOverrides,
  });
}

for (const [name, override, code] of [
  ["production", { VERCEL_ENV: "production" }, "PREVIEW_SMOKE_PREVIEW_ONLY"],
  ["development", { VERCEL_ENV: "development" }, "PREVIEW_SMOKE_PREVIEW_ONLY"],
  [
    "unknown environment",
    { VERCEL_ENV: "unknown" },
    "PREVIEW_SMOKE_PREVIEW_ONLY",
  ],
  [
    "wrong branch",
    { VERCEL_GIT_COMMIT_REF: "main" },
    "PREVIEW_SMOKE_BRANCH_FORBIDDEN",
  ],
  [
    "missing allowed SHA",
    { AUTOPDF_PREVIEW_STRIPE_SMOKE_ALLOWED_GIT_SHA: undefined },
    "PREVIEW_SMOKE_GIT_SHA_FORBIDDEN",
  ],
  [
    "wrong SHA",
    { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
    "PREVIEW_SMOKE_GIT_SHA_FORBIDDEN",
  ],
  [
    "wrong project",
    { VERCEL_PROJECT_ID: "other-project" },
    "PREVIEW_SMOKE_PROJECT_FORBIDDEN",
  ],
  [
    "wrong Supabase",
    { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
    "PREVIEW_SMOKE_SUPABASE_FORBIDDEN",
  ],
  [
    "missing enable",
    { AUTOPDF_PREVIEW_STRIPE_SMOKE_ENABLE: undefined },
    "PREVIEW_SMOKE_DISABLED",
  ],
  [
    "wrong enable",
    { AUTOPDF_PREVIEW_STRIPE_SMOKE_ENABLE: "wrong" },
    "PREVIEW_SMOKE_DISABLED",
  ],
  [
    "missing execute",
    { AUTOPDF_PREVIEW_STRIPE_EXECUTE: undefined },
    "PREVIEW_SMOKE_EXECUTION_NOT_APPROVED",
  ],
  [
    "wrong execute",
    { AUTOPDF_PREVIEW_STRIPE_EXECUTE: "wrong" },
    "PREVIEW_SMOKE_EXECUTION_NOT_APPROVED",
  ],
] as const) {
  test(`${name} fails before every external dependency`, async () => {
    const harness = routeHarness();
    const result = await invokeRoute(harness.route, environment(override));
    expect(result.body).toEqual({
      ok: false,
      state: "blocked",
      error_code: code,
    });
    expect(harness.calls).toEqual({
      authenticate: 0,
      execute: 0,
      provider: 0,
      webhook: 0,
    });
  });
}

test("Host, Origin, and Fetch Metadata are exact CSRF boundaries", async () => {
  for (const requestOverrides of [
    { requestUrl: "https://other.example/api/internal/stripe-preview-smoke" },
    { origin: "https://other.example" },
    { fetchSite: "cross-site" },
    { fetchMode: "navigate" },
  ]) {
    const harness = routeHarness();
    const result = await invokeRoute(
      harness.route,
      environment(),
      requestOverrides,
    );
    expect(result.status).toBe(403);
    expect(harness.calls.authenticate).toBe(0);
    expect(harness.calls.execute).toBe(0);
  }
});

test("verified session and exact fixture ownership are both required", async () => {
  const unauthenticated = routeHarness({ authenticated: false });
  expect((await invokeRoute(unauthenticated.route)).status).toBe(401);
  expect(unauthenticated.calls.execute).toBe(0);

  const wrongOwner = routeHarness({
    profile: { ...PROFILE, user_id: "55555555-5555-4555-8555-555555555555" },
  });
  expect((await invokeRoute(wrongOwner.route)).status).toBe(403);
  expect(wrongOwner.calls.execute).toBe(0);
});

test("profile read failure is sanitized before Stripe execution", async () => {
  let execute = 0;
  const route = createPreviewStripeSmokeRoute({
    async authenticate() {
      throw new Error("raw database details");
    },
    async createExecution() {
      execute += 1;
      throw new Error("must not run");
    },
  });
  const result = await invokeRoute(route);
  expect(result).toEqual({
    status: 503,
    body: {
      ok: false,
      state: "failed",
      error_code: "PREVIEW_SMOKE_PROFILE_READ_FAILED",
    },
  });
  expect(execute).toBe(0);
  expect(JSON.stringify(result)).not.toContain("raw database details");
});

test("a live secret is rejected before Stripe client creation", async () => {
  const harness = routeHarness();
  const result = await invokeRoute(
    harness.route,
    environment({ STRIPE_SECRET_KEY: `sk_${"live"}_forbidden` }),
  );
  expect(result.body).toMatchObject({
    error_code: "PREVIEW_SMOKE_STRIPE_TEST_MODE_REQUIRED",
  });
  expect(harness.calls.execute).toBe(0);
});

function provider(options?: {
  accountId?: string;
  livemode?: boolean;
  customerId?: string;
  subscriptionId?: string;
}) {
  return {
    accounts: {
      async retrieve() {
        return { id: options?.accountId ?? ACCOUNT_ID };
      },
    },
    subscriptions: {
      async retrieve() {
        return {
          id: options?.subscriptionId ?? SUBSCRIPTION_ID,
          customer: options?.customerId ?? CUSTOMER_ID,
          livemode: options?.livemode ?? false,
        };
      },
    },
  };
}

function smokeInput(
  overrides: Partial<Parameters<typeof runPreviewStripeSmoke>[0]> = {},
) {
  return {
    deploymentId: "deployment-runtime-fixture",
    stripeSecretKey: TEST_SECRET,
    webhookSecret: WEBHOOK_SECRET,
    baselineCreatedAt: "2030-01-01T00:00:00.000Z",
    profileBefore: PROFILE,
    provider: provider(),
    expectedStripeAccountHash: sha256(ACCOUNT_ID),
    async processWebhook() {
      return { status: 200, body: { received: true, stale: true } };
    },
    async loadProfileAfter() {
      return PROFILE;
    },
    ...overrides,
  };
}

test("provider livemode, account, fixture, and stale baseline fail closed", async () => {
  for (const [override, code] of [
    [
      { provider: provider({ livemode: true }) },
      "PREVIEW_SMOKE_PROVIDER_FIXTURE_MISMATCH",
    ],
    [
      { provider: provider({ accountId: "wrong" }) },
      "PREVIEW_SMOKE_STRIPE_ACCOUNT_FORBIDDEN",
    ],
    [
      { provider: provider({ customerId: "cus_wrongfixture" }) },
      "PREVIEW_SMOKE_PROVIDER_FIXTURE_MISMATCH",
    ],
    [
      { baselineCreatedAt: "1970-01-01T00:00:01.000Z" },
      "OPERATOR_EVENT_NOT_STALE",
    ],
  ] as const) {
    await expect(
      runPreviewStripeSmoke(smokeInput(override)),
    ).rejects.toMatchObject({
      code,
    });
  }
});

test("same deployment and fixture produce one deterministic replay identity", async () => {
  const eventIds: string[] = [];
  let calls = 0;
  const input = smokeInput({
    async processWebhook(request) {
      calls += 1;
      eventIds.push((JSON.parse(request.body) as { id: string }).id);
      return calls === 1
        ? { status: 200, body: { received: true, stale: true } }
        : { status: 200, body: { received: true, duplicate: true } };
    },
  });
  const first = await runPreviewStripeSmoke(input);
  const replay = await runPreviewStripeSmoke(input);
  expect(eventIds[0]).toBe(eventIds[1]);
  expect(first.event_id_hash).toBe(replay.event_id_hash);
  expect(first.stale).toBe(true);
  expect(replay.duplicate).toBe(true);
});

test("parallel invocations share the deterministic ledger identity", async () => {
  const eventIds: string[] = [];
  let calls = 0;
  const input = smokeInput({
    async processWebhook(request) {
      eventIds.push((JSON.parse(request.body) as { id: string }).id);
      calls += 1;
      return calls === 1
        ? { status: 200, body: { received: true, stale: true } }
        : { status: 200, body: { received: true, duplicate: true } };
    },
  });
  await Promise.all([
    runPreviewStripeSmoke(input),
    runPreviewStripeSmoke(input),
  ]);
  expect(new Set(eventIds).size).toBe(1);
});

test("unexpected billing mutation fails and all outputs stay sanitized", async () => {
  const changed = { ...PROFILE, billing_status: "canceled" };
  await expect(
    runPreviewStripeSmoke(
      smokeInput({
        async loadProfileAfter() {
          return changed;
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "PREVIEW_SMOKE_BILLING_STATE_CHANGED" });

  const result = await runPreviewStripeSmoke(smokeInput());
  const serialized = JSON.stringify(result);
  for (const sensitive of [
    TEST_SECRET,
    WEBHOOK_SECRET,
    USER_ID,
    CUSTOMER_ID,
    SUBSCRIPTION_ID,
    ACCOUNT_ID,
  ]) {
    expect(serialized).not.toContain(sensitive);
  }
  expect(result).toEqual({
    ok: true,
    state: "pass",
    stale: true,
    duplicate: false,
    billing_state_unchanged: true,
    event_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(new PreviewStripeSmokeError("SAFE_CODE").message).toBe("SAFE_CODE");
});

test("the POST adapter keeps privileged access lazy, narrow, and server-only", () => {
  const route = readFileSync(
    resolve(process.cwd(), "app/api/internal/stripe-preview-smoke/route.ts"),
    "utf8",
  );
  const repository = readFileSync(
    resolve(process.cwd(), "src/lib/billing/previewStripeSmokeRepository.ts"),
    "utf8",
  );
  expect(route).toContain("export async function POST");
  expect(route).not.toContain("export async function GET");
  expect(route).toContain('import("@/lib/supabase/server")');
  expect(route).toContain('import("stripe")');
  expect(route).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
  expect(route).not.toContain("console.");
  expect(repository).toContain('import "server-only"');
  expect(repository).toContain('"user_id, billing_last_event_created_at"');
  expect(repository).toContain('.eq("user_id", userId)');
  expect(repository).not.toContain('select("*")');
});
