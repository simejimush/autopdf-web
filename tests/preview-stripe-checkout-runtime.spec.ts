import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES,
  PreviewCheckoutRuntimeError,
  PreviewCheckoutRuntimePreflightStageError,
  executePreviewCheckoutConcurrencyRuntime,
  runPreviewCheckoutConcurrencyRuntimeCli,
  type PreviewCheckoutRuntimeBaseline,
  type PreviewCheckoutRuntimeDependencies,
  type PreviewCheckoutRuntimeHarness,
} from "../scripts/preview-stripe-checkout-runtime";

const APP_ORIGIN = "https://synthetic-preview.invalid";
const COOKIE_MARKER = "sb-synthetic-auth-token=synthetic-cookie-secret";
const STRIPE_MARKER = "sk_test_synthetic-runtime-secret";
const OWNER_HASH = "a".repeat(64);
const SENSITIVE_MARKERS = [
  APP_ORIGIN,
  COOKIE_MARKER,
  STRIPE_MARKER,
  OWNER_HASH,
];

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.appOrigin]: APP_ORIGIN,
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.expectedAppOriginHash]:
      hash(APP_ORIGIN),
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.expectedOwnerHash]: OWNER_HASH,
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.authCookie]: COOKIE_MARKER,
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.stripeSecretKey]: STRIPE_MARKER,
    [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.execute]:
      "APPROVED_PREVIEW_CHECKOUT_CONCURRENCY",
    AUTOPDF_PREVIEW_HARNESS_EXPECTED_SUPABASE_ORIGIN_SHA256: "b".repeat(64),
    AUTOPDF_PREVIEW_HARNESS_SUPABASE_URL:
      "https://synthetic-preview.supabase.co",
    AUTOPDF_PREVIEW_HARNESS_SUPABASE_ANON_KEY: "synthetic-anon",
    AUTOPDF_PREVIEW_HARNESS_SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    ...overrides,
  };
}

function baseline(
  overrides: Partial<PreviewCheckoutRuntimeBaseline> = {},
): PreviewCheckoutRuntimeBaseline {
  return {
    activeCheckoutAttemptCount: 0,
    customerCount: 0,
    checkoutSessionCount: 0,
    subscriptionCount: 0,
    effectivePlan: "free",
    billingStatus: "none",
    paid: false,
    ...overrides,
  };
}

function runtimeHarness(
  overrides: Partial<PreviewCheckoutRuntimeHarness> = {},
) {
  const calls = { baseline: 0, prepare: 0, execute: 0, cleanup: 0 };
  const harness: PreviewCheckoutRuntimeHarness = {
    async inspectBaseline() {
      calls.baseline += 1;
      return baseline();
    },
    async prepareFixture() {
      calls.prepare += 1;
    },
    async executeConcurrency() {
      calls.execute += 1;
      return {
        authenticated: true,
        request_count: 2,
        winner_count: 1,
        loser_count: 1,
        active_attempt_max: 1,
        active_attempt_count: 1,
        customer_created_count: 1,
        session_created_count: 1,
        subscription_created_count: 0,
        production_operations: 0,
        live_operations: 0,
        fixture_fresh: true,
        fixture_free: true,
        fixture_unsubscribed: true,
        billing_profile_paid_mutation: false,
      };
    },
    async cleanupCreatedArtifacts() {
      calls.cleanup += 1;
      return {
        complete: true,
        activeAttemptFinal: 0,
        fixtureFree: true,
        fixtureUnsubscribed: true,
        unnecessaryArtifactCount: 0,
      };
    },
    ...overrides,
  };
  return { calls, harness };
}

function dependencies(input?: {
  harness?: PreviewCheckoutRuntimeHarness;
  preflight?: Partial<
    Awaited<ReturnType<PreviewCheckoutRuntimeDependencies["runPreflight"]>>
  >;
  preflightError?: Error;
}) {
  const calls = { preflight: 0 };
  const fallbackHarness = runtimeHarness().harness;
  const value: PreviewCheckoutRuntimeDependencies = {
    async runPreflight() {
      calls.preflight += 1;
      if (input?.preflightError) throw input.preflightError;
      return {
        previewDeploymentIdentityMatch: true,
        previewSupabaseIdentityMatch: true,
        stripeMode: "test",
        expectedStripeAccountMatch: true,
        ownerIdentityMatch: true,
        productionIdentity: false,
        developmentIdentity: false,
        harness: input?.harness ?? fallbackHarness,
        ...input?.preflight,
      };
    },
  };
  return { calls, value };
}

async function execute(input?: {
  env?: Record<string, string | undefined>;
  argv?: readonly string[];
  dependencies?: PreviewCheckoutRuntimeDependencies;
}) {
  return executePreviewCheckoutConcurrencyRuntime({
    environment: input?.env ?? environment(),
    argv: input?.argv ?? [],
    dependencies: input?.dependencies ?? dependencies().value,
  });
}

test("successful finite runtime produces only the sanitized close report", async () => {
  const runtime = runtimeHarness();
  const dependency = dependencies({ harness: runtime.harness });
  const result = await execute({ dependencies: dependency.value });

  expect(result).toMatchObject({
    verdict: "STRIPE_SAFETY_PHASE_CLOSED",
    concurrent_authenticated_request_count: 2,
    winner_count: 1,
    safe_loser_count: 1,
    active_checkout_attempt_max: 1,
    active_checkout_attempt_final: 0,
    stripe_customer_delta: 1,
    checkout_session_delta: 1,
    subscription_delta: 0,
    privacy_exposure_count: 0,
    production_operation_count: 0,
    stripe_live_operation_count: 0,
    cleanup: "complete",
    stripe_safety_phase_closed: true,
  });
  expect(dependency.calls.preflight).toBe(1);
  expect(runtime.calls).toEqual({
    baseline: 1,
    prepare: 1,
    execute: 1,
    cleanup: 1,
  });
  for (const marker of SENSITIVE_MARKERS) {
    expect(JSON.stringify(result)).not.toContain(marker);
  }
});

test("preflight failure stops before fixture, Checkout, or cleanup", async () => {
  const runtime = runtimeHarness();
  const dependency = dependencies({
    harness: runtime.harness,
    preflightError: new Error(`${COOKIE_MARKER}:${STRIPE_MARKER}`),
  });
  await expect(
    execute({ dependencies: dependency.value }),
  ).rejects.toMatchObject({
    code: "RUNTIME_PREFLIGHT_FAILED",
    stageCode: "PREFLIGHT_INTERNAL_FAILED",
  });
  expect(runtime.calls).toEqual({
    baseline: 0,
    prepare: 0,
    execute: 0,
    cleanup: 0,
  });
});

test("CLI preserves the top-level preflight code and adds only a fixed stage code", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const dependency = dependencies({
    preflightError: new PreviewCheckoutRuntimePreflightStageError(
      "PREFLIGHT_SUPABASE_AUTH_FAILED",
    ),
  });

  const exitCode = await runPreviewCheckoutConcurrencyRuntimeCli({
    environment: environment(),
    argv: [],
    dependencies: dependency.value,
    stdout: {
      write: (value: unknown) => stdout.push(String(value)),
    } as never,
    stderr: {
      write: (value: unknown) => stderr.push(String(value)),
    } as never,
  });

  expect(exitCode).toBe(1);
  expect(stdout).toEqual([]);
  expect(stderr).toEqual([
    '{"verdict":"BLOCKED","error_code":"RUNTIME_PREFLIGHT_FAILED","stage_code":"PREFLIGHT_SUPABASE_AUTH_FAILED"}\n',
  ]);
});

for (const [name, preflight] of [
  ["Production", { productionIdentity: true }],
  ["Development", { developmentIdentity: true }],
  ["deployment mismatch", { previewDeploymentIdentityMatch: false }],
  ["Supabase mismatch", { previewSupabaseIdentityMatch: false }],
  ["Stripe account mismatch", { expectedStripeAccountMatch: false }],
  ["owner mismatch", { ownerIdentityMatch: false }],
] as const) {
  test(`${name} fails before every write path`, async () => {
    const runtime = runtimeHarness();
    const dependency = dependencies({ harness: runtime.harness, preflight });
    await expect(
      execute({ dependencies: dependency.value }),
    ).rejects.toMatchObject({
      code: "RUNTIME_PREFLIGHT_FAILED",
      stageCode: "PREFLIGHT_RESULT_VALIDATION_FAILED",
    });
    expect(runtime.calls).toEqual({
      baseline: 0,
      prepare: 0,
      execute: 0,
      cleanup: 0,
    });
  });
}

test("live Stripe input is rejected before preflight", async () => {
  const dependency = dependencies();
  await expect(
    execute({
      env: environment({
        [PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.stripeSecretKey]:
          "sk_live_synthetic-forbidden",
      }),
      dependencies: dependency.value,
    }),
  ).rejects.toMatchObject({ code: "RUNTIME_STRIPE_TEST_MODE_REQUIRED" });
  expect(dependency.calls.preflight).toBe(0);
});

for (const [name, invalidBaseline] of [
  ["active attempt", baseline({ activeCheckoutAttemptCount: 1 })],
  ["Customer", baseline({ customerCount: 1 })],
  ["Session", baseline({ checkoutSessionCount: 1 })],
  ["Subscription", baseline({ subscriptionCount: 1 })],
  ["paid plan", baseline({ effectivePlan: "pro", paid: true })],
  ["active billing", baseline({ billingStatus: "active", paid: true })],
] as const) {
  test(`invalid fixture (${name}) stops before preparation or Checkout`, async () => {
    const runtime = runtimeHarness({
      async inspectBaseline() {
        runtime.calls.baseline += 1;
        return invalidBaseline;
      },
    });
    await expect(
      execute({
        dependencies: dependencies({ harness: runtime.harness }).value,
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_FIXTURE_INVALID" });
    expect(runtime.calls.prepare).toBe(0);
    expect(runtime.calls.execute).toBe(0);
    expect(runtime.calls.cleanup).toBe(0);
  });
}

for (const [name, unsafeResult] of [
  ["two winners", { winner_count: 2, loser_count: 0 }],
  ["sequential count", { request_count: 1 }],
  ["Customer delta two", { customer_created_count: 2 }],
  ["Session delta two", { session_created_count: 2 }],
  ["Subscription delta one", { subscription_created_count: 1 }],
  ["paid mutation", { billing_profile_paid_mutation: true }],
  ["Production operation", { production_operations: 1 }],
  ["live operation", { live_operations: 1 }],
] as const) {
  test(`${name} fails only after scoped cleanup`, async () => {
    const runtime = runtimeHarness({
      async executeConcurrency() {
        runtime.calls.execute += 1;
        const safeResult = {
          authenticated: true,
          request_count: 2,
          winner_count: 1,
          loser_count: 1,
          active_attempt_max: 1,
          active_attempt_count: 1,
          customer_created_count: 1,
          session_created_count: 1,
          subscription_created_count: 0,
          production_operations: 0,
          live_operations: 0,
          fixture_fresh: true,
          fixture_free: true,
          fixture_unsubscribed: true,
          billing_profile_paid_mutation: false,
        };
        return { ...safeResult, ...unsafeResult };
      },
    });
    await expect(
      execute({
        dependencies: dependencies({ harness: runtime.harness }).value,
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_CONCURRENCY_RESULT_UNSAFE" });
    expect(runtime.calls.execute).toBe(1);
    expect(runtime.calls.cleanup).toBe(1);
  });
}

test("runtime execution failure still performs one scoped cleanup", async () => {
  const runtime = runtimeHarness({
    async executeConcurrency() {
      runtime.calls.execute += 1;
      throw new Error(`${COOKIE_MARKER}:${STRIPE_MARKER}`);
    },
  });
  await expect(
    execute({ dependencies: dependencies({ harness: runtime.harness }).value }),
  ).rejects.toMatchObject({ code: "RUNTIME_CONCURRENCY_FAILED" });
  expect(runtime.calls.cleanup).toBe(1);
});

test("cleanup failure prevents PASS and is never retried", async () => {
  const runtime = runtimeHarness({
    async cleanupCreatedArtifacts() {
      runtime.calls.cleanup += 1;
      throw new Error(`${COOKIE_MARKER}:${STRIPE_MARKER}`);
    },
  });
  await expect(
    execute({ dependencies: dependencies({ harness: runtime.harness }).value }),
  ).rejects.toMatchObject({ code: "RUNTIME_CLEANUP_FAILED" });
  expect(runtime.calls.cleanup).toBe(1);
});

test("arguments are rejected before preflight or any operation", async () => {
  const dependency = dependencies();
  await expect(
    execute({ argv: ["--requests=4"], dependencies: dependency.value }),
  ).rejects.toMatchObject({ code: "RUNTIME_ARGUMENT_FORBIDDEN" });
  expect(dependency.calls.preflight).toBe(0);
});

test("CLI never exposes credential, token, cookie, URL, hash, or raw errors", async () => {
  for (const dependency of [
    dependencies(),
    dependencies({
      preflightError: new Error(SENSITIVE_MARKERS.join(":")),
    }),
  ]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    await runPreviewCheckoutConcurrencyRuntimeCli({
      environment: environment(),
      argv: [],
      dependencies: dependency.value,
      stdout: {
        write: (value: unknown) => stdout.push(String(value)),
      } as never,
      stderr: {
        write: (value: unknown) => stderr.push(String(value)),
      } as never,
    });
    const output = `${stdout.join("")}\n${stderr.join("")}`;
    for (const marker of SENSITIVE_MARKERS) {
      expect(output).not.toContain(marker);
    }
  }
});

test("runtime errors contain fixed codes only", async () => {
  try {
    await execute({ argv: [COOKIE_MARKER] });
    throw new Error("expected failure");
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewCheckoutRuntimeError);
    const safeError = error as Error;
    expect(safeError.message).toBe("RUNTIME_ARGUMENT_FORBIDDEN");
    for (const marker of SENSITIVE_MARKERS) {
      expect(safeError.message).not.toContain(marker);
      expect(safeError.stack ?? "").not.toContain(marker);
    }
  }
});
