import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import {
  evaluatePreviewCheckoutFixtureObservation,
  runtimeBaselineFixtureValid,
  runtimeFixtureRowValid,
  type PreviewCheckoutFixtureObservation,
} from "../scripts/preview-stripe-checkout-fixture-contract";
import {
  PREVIEW_FIXTURE_DIAGNOSTIC_ENV_NAMES,
  PreviewCheckoutFixtureDiagnosticError,
  executePreviewCheckoutFixtureDiagnostic,
  runPreviewCheckoutFixtureDiagnosticCli,
  type PreviewCheckoutFixtureDiagnosticDependencies,
} from "../scripts/preview-stripe-checkout-fixture-diagnostic";
import { resolveFixtureDiagnosticDbReads } from "../scripts/preview-stripe-checkout-fixture-diagnostic-dependencies";

const APPROVAL = "APPROVED_PREVIEW_FIXTURE_READ_DIAGNOSTIC";
const SENSITIVE_MARKERS = [
  "synthetic-user-id-marker",
  "synthetic-email-marker@example.invalid",
  "cus_synthetic-marker",
  "cs_synthetic-marker",
  "sub_synthetic-marker",
  "synthetic-cookie-marker",
  "synthetic-secret-marker",
  "synthetic-raw-provider-error",
];

function validObservation(
  overrides: Partial<PreviewCheckoutFixtureObservation> = {},
): PreviewCheckoutFixtureObservation {
  return {
    dbReadSucceeded: true,
    stripeReadSucceeded: true,
    ownerProfileUniqueAndValid: true,
    effectivePlanFree: true,
    billingStatusNone: true,
    paidEffectiveFalse: true,
    activeCheckoutAttemptCount: "zero",
    customerCount: "zero",
    checkoutSessionCount: "zero",
    subscriptionCount: "zero",
    activeOrTrialingSubscriptionCount: "zero",
    stripeObjectsTestModeOnly: true,
    stripeOwnerMatch: true,
    stripeListWithinBound: true,
    ...overrides,
  };
}

function dependencies(
  inspect: PreviewCheckoutFixtureDiagnosticDependencies["inspect"] = async () =>
    validObservation(),
): PreviewCheckoutFixtureDiagnosticDependencies {
  return { inspect };
}

function execute(dependency = dependencies()) {
  return executePreviewCheckoutFixtureDiagnostic({
    environment: {
      [PREVIEW_FIXTURE_DIAGNOSTIC_ENV_NAMES.execute]: APPROVAL,
    },
    argv: [],
    dependencies: dependency,
  });
}

test("all fixture conditions pass only as one overall valid result", async () => {
  const report = await execute();
  expect(report).toMatchObject({
    verdict: "READY",
    error_code: "FIXTURE_DIAGNOSTIC_VALID",
    db_fixture_valid: true,
    stripe_fixture_valid: true,
    overall_fixture_valid: true,
  });
});

test("explicit diagnostic approval is required before dependency access", async () => {
  let inspectionCalls = 0;
  const report = await executePreviewCheckoutFixtureDiagnostic({
    environment: {},
    argv: [],
    dependencies: dependencies(async () => {
      inspectionCalls += 1;
      return validObservation();
    }),
  });
  expect(report.error_code).toBe("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
  expect(inspectionCalls).toBe(0);
});

for (const [name, override, field] of [
  [
    "profile zero rows",
    { ownerProfileUniqueAndValid: false },
    "db_fixture_valid",
  ],
  [
    "profile multiple rows",
    { ownerProfileUniqueAndValid: false },
    "db_fixture_valid",
  ],
  ["non-Free plan", { effectivePlanFree: false }, "db_fixture_valid"],
  ["non-null billing status", { billingStatusNone: false }, "db_fixture_valid"],
  ["effective paid", { paidEffectiveFalse: false }, "db_fixture_valid"],
  [
    "active Checkout attempt",
    { activeCheckoutAttemptCount: "nonzero" },
    "db_fixture_valid",
  ],
  ["Stripe Customer", { customerCount: "nonzero" }, "stripe_fixture_valid"],
  [
    "Checkout Session",
    { checkoutSessionCount: "nonzero" },
    "stripe_fixture_valid",
  ],
  ["Subscription", { subscriptionCount: "nonzero" }, "stripe_fixture_valid"],
  [
    "active or trialing Subscription",
    { activeOrTrialingSubscriptionCount: "nonzero" },
    "stripe_fixture_valid",
  ],
  [
    "live-mode object",
    { stripeObjectsTestModeOnly: false },
    "stripe_fixture_valid",
  ],
  ["owner mismatch", { stripeOwnerMatch: false }, "stripe_fixture_valid"],
  [
    "list overflow",
    { customerCount: "overflow", stripeListWithinBound: false },
    "stripe_fixture_valid",
  ],
] as const) {
  test(`${name} is independently fail-closed`, () => {
    const report = evaluatePreviewCheckoutFixtureObservation(
      validObservation(override),
    );
    expect(report[field]).toBe(false);
    expect(report.overall_fixture_valid).toBe(false);
    expect(report.error_code).toBe("FIXTURE_DIAGNOSTIC_STATE_INVALID");
  });
}

type DbReadMock = Readonly<{
  data: readonly unknown[] | null;
  error: Error | null;
}>;

const dbReadSuccess: DbReadMock = { data: [], error: null };
const dbReadFailure: DbReadMock = {
  data: null,
  error: new Error(SENSITIVE_MARKERS.join(":")),
};

async function dbReadFailureCode(input: {
  profileRead(): PromiseLike<DbReadMock>;
  attemptsRead(): PromiseLike<DbReadMock>;
}) {
  try {
    await resolveFixtureDiagnosticDbReads(input);
  } catch (error) {
    return error instanceof PreviewCheckoutFixtureDiagnosticError
      ? error.code
      : "UNEXPECTED";
  }
  return "SUCCESS";
}

test("both DB reads succeed without changing the fixture state path", async () => {
  await expect(
    resolveFixtureDiagnosticDbReads({
      profileRead: async () => dbReadSuccess,
      attemptsRead: async () => dbReadSuccess,
    }),
  ).resolves.toEqual({
    profileResult: dbReadSuccess,
    attemptResult: dbReadSuccess,
  });
});

for (const [name, profileRead, attemptsRead, expected] of [
  [
    "profile query error",
    async () => dbReadFailure,
    async () => dbReadSuccess,
    "FIXTURE_DIAGNOSTIC_PROFILE_READ_FAILED",
  ],
  [
    "attempts query error",
    async () => dbReadSuccess,
    async () => dbReadFailure,
    "FIXTURE_DIAGNOSTIC_ATTEMPTS_READ_FAILED",
  ],
  [
    "both query errors",
    async () => dbReadFailure,
    async () => dbReadFailure,
    "FIXTURE_DIAGNOSTIC_BOTH_DB_READS_FAILED",
  ],
  [
    "profile rejection",
    async () => Promise.reject(new Error(SENSITIVE_MARKERS.join(":"))),
    async () => dbReadSuccess,
    "FIXTURE_DIAGNOSTIC_PROFILE_READ_FAILED",
  ],
  [
    "attempts rejection",
    async () => dbReadSuccess,
    async () => Promise.reject(new Error(SENSITIVE_MARKERS.join(":"))),
    "FIXTURE_DIAGNOSTIC_ATTEMPTS_READ_FAILED",
  ],
  [
    "both rejections",
    async () => Promise.reject(new Error(SENSITIVE_MARKERS.join(":"))),
    async () => Promise.reject(new Error(SENSITIVE_MARKERS.join(":"))),
    "FIXTURE_DIAGNOSTIC_BOTH_DB_READS_FAILED",
  ],
] as const) {
  test(`${name} maps to a fixed DB stage code without raw error exposure`, async () => {
    const errorCode = await dbReadFailureCode({ profileRead, attemptsRead });
    expect(errorCode).toBe(expected);
    expect(errorCode).not.toContain("synthetic");
  });
}

test("a DB-stage failure stops before a later Stripe inspection", async () => {
  let profileReadCalls = 0;
  let attemptsReadCalls = 0;
  let stripeInspectionCalls = 0;
  const report = await execute(
    dependencies(async () => {
      await resolveFixtureDiagnosticDbReads({
        profileRead: async () => {
          profileReadCalls += 1;
          return dbReadFailure;
        },
        attemptsRead: async () => {
          attemptsReadCalls += 1;
          return dbReadSuccess;
        },
      });
      stripeInspectionCalls += 1;
      return validObservation();
    }),
  );
  expect(report).toMatchObject({
    verdict: "BLOCKED",
    error_code: "FIXTURE_DIAGNOSTIC_PROFILE_READ_FAILED",
    overall_fixture_valid: "unknown",
  });
  expect(profileReadCalls).toBe(1);
  expect(attemptsReadCalls).toBe(1);
  expect(stripeInspectionCalls).toBe(0);
});

test("a raw DB read rejection never reaches CLI output", async () => {
  const stdout: string[] = [];
  const exitCode = await runPreviewCheckoutFixtureDiagnosticCli({
    environment: {
      [PREVIEW_FIXTURE_DIAGNOSTIC_ENV_NAMES.execute]: APPROVAL,
    },
    argv: [],
    dependencies: dependencies(async () => {
      await resolveFixtureDiagnosticDbReads({
        profileRead: async () =>
          Promise.reject(new Error(SENSITIVE_MARKERS.join(":"))),
        attemptsRead: async () => dbReadSuccess,
      });
      return validObservation();
    }),
    stdout: {
      write: (value: unknown) => stdout.push(String(value)),
    } as never,
  });

  expect(exitCode).toBe(1);
  expect(stdout).toHaveLength(1);
  expect(JSON.parse(stdout[0])).toMatchObject({
    verdict: "BLOCKED",
    error_code: "FIXTURE_DIAGNOSTIC_PROFILE_READ_FAILED",
  });
  for (const marker of SENSITIVE_MARKERS) {
    expect(stdout[0]).not.toContain(marker);
  }
});

test("Stripe read failure preserves safe DB classifications", async () => {
  const report = await execute(
    dependencies(async () =>
      validObservation({
        stripeReadSucceeded: false,
        customerCount: "unknown",
        checkoutSessionCount: "unknown",
        subscriptionCount: "unknown",
        activeOrTrialingSubscriptionCount: "unknown",
        stripeObjectsTestModeOnly: "unknown",
        stripeOwnerMatch: "unknown",
        stripeListWithinBound: "unknown",
      }),
    ),
  );
  expect(report).toMatchObject({
    verdict: "BLOCKED",
    error_code: "FIXTURE_DIAGNOSTIC_STRIPE_READ_FAILED",
    db_fixture_valid: true,
    stripe_fixture_valid: false,
    overall_fixture_valid: false,
  });
});

test("CLI output contains only fixed fields and never raw sensitive material", async () => {
  const stdout: string[] = [];
  const exitCode = await runPreviewCheckoutFixtureDiagnosticCli({
    environment: {
      [PREVIEW_FIXTURE_DIAGNOSTIC_ENV_NAMES.execute]: APPROVAL,
    },
    argv: [],
    dependencies: dependencies(async () => {
      throw new Error(SENSITIVE_MARKERS.join(":"));
    }),
    stdout: {
      write: (value: unknown) => stdout.push(String(value)),
    } as never,
  });

  expect(exitCode).toBe(1);
  expect(stdout).toHaveLength(1);
  const serialized = stdout[0];
  expect(JSON.parse(serialized)).toMatchObject({
    verdict: "BLOCKED",
    error_code: "FIXTURE_DIAGNOSTIC_INTERNAL_FAILED",
  });
  for (const marker of SENSITIVE_MARKERS) {
    expect(serialized).not.toContain(marker);
  }
  for (const forbiddenKey of [
    "user_id",
    "email",
    "customer_id",
    "session_id",
    "subscription_id",
    "cookie",
    "token",
    "secret",
    "raw_error",
  ]) {
    expect(serialized).not.toContain(forbiddenKey);
  }
});

test("diagnostic and runtime baseline contracts share the same decisions", () => {
  const cases = [
    {},
    { activeCheckoutAttemptCount: 1 },
    { customerCount: 1 },
    { checkoutSessionCount: 1 },
    { subscriptionCount: 1 },
    { effectivePlan: "pro" as const, paid: true },
    { billingStatus: "active" as const, paid: true },
  ];
  for (const override of cases) {
    const baseline = {
      activeCheckoutAttemptCount: 0,
      customerCount: 0,
      checkoutSessionCount: 0,
      subscriptionCount: 0,
      effectivePlan: "free" as const,
      billingStatus: "none" as const,
      paid: false,
      ...override,
    };
    const runtimeValid = runtimeBaselineFixtureValid(baseline);
    const diagnosticValid =
      evaluatePreviewCheckoutFixtureObservation(
        validObservation({
          activeCheckoutAttemptCount:
            baseline.activeCheckoutAttemptCount === 0 ? "zero" : "nonzero",
          customerCount: baseline.customerCount === 0 ? "zero" : "nonzero",
          checkoutSessionCount:
            baseline.checkoutSessionCount === 0 ? "zero" : "nonzero",
          subscriptionCount:
            baseline.subscriptionCount === 0 ? "zero" : "nonzero",
          effectivePlanFree: baseline.effectivePlan === "free",
          billingStatusNone: baseline.billingStatus === "none",
          paidEffectiveFalse: !baseline.paid,
        }),
      ).overall_fixture_valid === true;
    expect(diagnosticValid).toBe(runtimeValid);
  }
});

test("diagnostic and adapter row contracts share the same decisions", () => {
  for (const override of [
    {},
    { plan: "pro" },
    { billingStatus: "active" },
    { paid: true },
    { activeOrTrialingSubscriptionCount: 1 },
    { activeCheckoutAttemptCount: 1 },
    { customerCount: 1 },
    { checkoutSessionCount: 1 },
    { subscriptionCount: 1 },
  ]) {
    const row = {
      plan: "free",
      billingStatus: "none",
      paid: false,
      activeOrTrialingSubscriptionCount: 0,
      activeCheckoutAttemptCount: 0,
      customerCount: 0,
      checkoutSessionCount: 0,
      subscriptionCount: 0,
      ...override,
    };
    const runtimeValid = runtimeFixtureRowValid(row);
    const diagnosticValid =
      evaluatePreviewCheckoutFixtureObservation(
        validObservation({
          effectivePlanFree: row.plan === "free",
          billingStatusNone: row.billingStatus === "none",
          paidEffectiveFalse: !row.paid,
          activeOrTrialingSubscriptionCount:
            row.activeOrTrialingSubscriptionCount === 0 ? "zero" : "nonzero",
          activeCheckoutAttemptCount:
            row.activeCheckoutAttemptCount === 0 ? "zero" : "nonzero",
          customerCount: row.customerCount === 0 ? "zero" : "nonzero",
          checkoutSessionCount:
            row.checkoutSessionCount === 0 ? "zero" : "nonzero",
          subscriptionCount: row.subscriptionCount === 0 ? "zero" : "nonzero",
        }),
      ).overall_fixture_valid === true;
    expect(diagnosticValid).toBe(runtimeValid);
  }
});

test("real diagnostic dependency surface contains read paths only", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "scripts/preview-stripe-checkout-fixture-diagnostic-dependencies.ts",
    ),
    "utf8",
  );
  expect(source).not.toMatch(/\.(insert|upsert|delete|del|expire|create)\s*\(/);
  expect(source).not.toMatch(/\.update\s*\(\s*\{/);
  expect(source).not.toContain("/api/stripe/checkout");
  expect(source).not.toContain("cleanupCreatedArtifacts");
  expect(source).not.toContain("prepareFixture");
  expect(source).not.toContain("executeConcurrency");
  expect(source).not.toMatch(/method:\s*["']POST["']/);
});
