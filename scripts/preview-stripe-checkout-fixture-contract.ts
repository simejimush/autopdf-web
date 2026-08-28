export type FixtureDiagnosticFlag = boolean | "unknown";
export type FixtureCountClassification =
  | "zero"
  | "nonzero"
  | "overflow"
  | "unknown";

export type PreviewCheckoutFixtureObservation = Readonly<{
  dbReadSucceeded: FixtureDiagnosticFlag;
  stripeReadSucceeded: FixtureDiagnosticFlag;
  ownerProfileUniqueAndValid: FixtureDiagnosticFlag;
  effectivePlanFree: FixtureDiagnosticFlag;
  billingStatusNone: FixtureDiagnosticFlag;
  paidEffectiveFalse: FixtureDiagnosticFlag;
  activeCheckoutAttemptCount: FixtureCountClassification;
  customerCount: FixtureCountClassification;
  checkoutSessionCount: FixtureCountClassification;
  subscriptionCount: FixtureCountClassification;
  activeOrTrialingSubscriptionCount: FixtureCountClassification;
  stripeObjectsTestModeOnly: FixtureDiagnosticFlag;
  stripeOwnerMatch: FixtureDiagnosticFlag;
  stripeListWithinBound: FixtureDiagnosticFlag;
}>;

export type PreviewCheckoutFixtureDiagnosticErrorCode =
  | "FIXTURE_DIAGNOSTIC_VALID"
  | "FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED"
  | "FIXTURE_DIAGNOSTIC_DB_READ_FAILED"
  | "FIXTURE_DIAGNOSTIC_PROFILE_READ_FAILED"
  | "FIXTURE_DIAGNOSTIC_ATTEMPTS_READ_FAILED"
  | "FIXTURE_DIAGNOSTIC_BOTH_DB_READS_FAILED"
  | "FIXTURE_DIAGNOSTIC_STRIPE_READ_FAILED"
  | "FIXTURE_DIAGNOSTIC_STATE_INVALID"
  | "FIXTURE_DIAGNOSTIC_INTERNAL_FAILED";

export type PreviewCheckoutAttemptsReadFailureClassification = Readonly<{
  failure_kind: "TRANSPORT" | "POSTGREST" | "UNKNOWN";
  http_status_class: "4XX" | "5XX" | "OTHER" | "UNKNOWN";
  provider_code_class:
    | "POSTGRES_UNDEFINED_COLUMN"
    | "POSTGRES_UNDEFINED_TABLE"
    | "POSTGRES_INSUFFICIENT_PRIVILEGE"
    | "POSTGREST_COLUMN_NOT_FOUND"
    | "POSTGREST_TABLE_NOT_FOUND"
    | "UNKNOWN";
}>;

export type PreviewCheckoutFixtureDiagnosticReport = Readonly<{
  verdict: "READY" | "BLOCKED";
  error_code: PreviewCheckoutFixtureDiagnosticErrorCode;
  owner_profile_unique_and_valid: FixtureDiagnosticFlag;
  effective_plan_free: FixtureDiagnosticFlag;
  billing_status_none: FixtureDiagnosticFlag;
  paid_effective_false: FixtureDiagnosticFlag;
  active_checkout_attempt_count: FixtureCountClassification;
  customer_count: FixtureCountClassification;
  checkout_session_count: FixtureCountClassification;
  subscription_count: FixtureCountClassification;
  active_or_trialing_subscription_count: FixtureCountClassification;
  stripe_objects_test_mode_only: FixtureDiagnosticFlag;
  stripe_owner_match: FixtureDiagnosticFlag;
  stripe_list_within_bound: FixtureDiagnosticFlag;
  db_fixture_valid: FixtureDiagnosticFlag;
  stripe_fixture_valid: FixtureDiagnosticFlag;
  overall_fixture_valid: FixtureDiagnosticFlag;
  attempts_read_failure?: PreviewCheckoutAttemptsReadFailureClassification;
}>;

export function effectiveFixturePlan(profile: {
  plan: "free" | "pro" | "pro_plus" | null;
  billing_status: string | null;
  current_period_end: string | null;
}) {
  if (
    (profile.billing_status === "active" ||
      profile.billing_status === "trialing") &&
    (profile.plan === "pro" || profile.plan === "pro_plus")
  ) {
    return profile.plan;
  }
  if (
    profile.billing_status === "canceled" &&
    profile.current_period_end &&
    Date.parse(profile.current_period_end) > Date.now() &&
    (profile.plan === "pro" || profile.plan === "pro_plus")
  ) {
    return profile.plan;
  }
  return "free" as const;
}

export function fixtureBillingStatus(profile: {
  billing_status: string | null;
}) {
  if (profile.billing_status === null) return "none" as const;
  if (profile.billing_status === "active") return "active" as const;
  if (profile.billing_status === "trialing") return "trialing" as const;
  return "other" as const;
}

function allTrue(values: readonly FixtureDiagnosticFlag[]) {
  if (values.some((value) => value === false)) return false;
  if (values.some((value) => value === "unknown")) return "unknown";
  return true;
}

function countIsZero(value: FixtureCountClassification) {
  if (value === "unknown") return "unknown";
  return value === "zero";
}

export function runtimeBaselineFixtureValid(input: {
  activeCheckoutAttemptCount: number;
  customerCount: number;
  checkoutSessionCount: number;
  subscriptionCount: number;
  effectivePlan: "free" | "pro" | "pro_plus" | "unknown";
  billingStatus: "none" | "active" | "trialing" | "other";
  paid: boolean;
}) {
  return (
    input.activeCheckoutAttemptCount === 0 &&
    input.customerCount === 0 &&
    input.checkoutSessionCount === 0 &&
    input.subscriptionCount === 0 &&
    input.effectivePlan === "free" &&
    input.billingStatus === "none" &&
    !input.paid
  );
}

export function runtimeFixtureRowValid(input: {
  plan: string;
  billingStatus: string;
  paid: boolean;
  activeOrTrialingSubscriptionCount: number;
  activeCheckoutAttemptCount: number;
  customerCount: number;
  checkoutSessionCount: number;
  subscriptionCount: number;
}) {
  const counts = [
    input.activeOrTrialingSubscriptionCount,
    input.activeCheckoutAttemptCount,
    input.customerCount,
    input.checkoutSessionCount,
    input.subscriptionCount,
  ];
  return (
    input.plan === "free" &&
    input.billingStatus === "none" &&
    !input.paid &&
    counts.every((value) => Number.isSafeInteger(value) && value === 0)
  );
}

export function evaluatePreviewCheckoutFixtureObservation(
  observation: PreviewCheckoutFixtureObservation,
): PreviewCheckoutFixtureDiagnosticReport {
  const dbFixtureValid = allTrue([
    observation.dbReadSucceeded,
    observation.ownerProfileUniqueAndValid,
    observation.effectivePlanFree,
    observation.billingStatusNone,
    observation.paidEffectiveFalse,
    countIsZero(observation.activeCheckoutAttemptCount),
  ]);
  const stripeFixtureValid = allTrue([
    observation.stripeReadSucceeded,
    countIsZero(observation.customerCount),
    countIsZero(observation.checkoutSessionCount),
    countIsZero(observation.subscriptionCount),
    countIsZero(observation.activeOrTrialingSubscriptionCount),
    observation.stripeObjectsTestModeOnly,
    observation.stripeOwnerMatch,
    observation.stripeListWithinBound,
  ]);
  const overallFixtureValid = allTrue([dbFixtureValid, stripeFixtureValid]);
  const errorCode: PreviewCheckoutFixtureDiagnosticErrorCode =
    observation.dbReadSucceeded === false
      ? "FIXTURE_DIAGNOSTIC_DB_READ_FAILED"
      : observation.stripeReadSucceeded === false
        ? "FIXTURE_DIAGNOSTIC_STRIPE_READ_FAILED"
        : overallFixtureValid === true
          ? "FIXTURE_DIAGNOSTIC_VALID"
          : "FIXTURE_DIAGNOSTIC_STATE_INVALID";

  return Object.freeze({
    verdict: overallFixtureValid === true ? "READY" : "BLOCKED",
    error_code: errorCode,
    owner_profile_unique_and_valid: observation.ownerProfileUniqueAndValid,
    effective_plan_free: observation.effectivePlanFree,
    billing_status_none: observation.billingStatusNone,
    paid_effective_false: observation.paidEffectiveFalse,
    active_checkout_attempt_count: observation.activeCheckoutAttemptCount,
    customer_count: observation.customerCount,
    checkout_session_count: observation.checkoutSessionCount,
    subscription_count: observation.subscriptionCount,
    active_or_trialing_subscription_count:
      observation.activeOrTrialingSubscriptionCount,
    stripe_objects_test_mode_only: observation.stripeObjectsTestModeOnly,
    stripe_owner_match: observation.stripeOwnerMatch,
    stripe_list_within_bound: observation.stripeListWithinBound,
    db_fixture_valid: dbFixtureValid,
    stripe_fixture_valid: stripeFixtureValid,
    overall_fixture_valid: overallFixtureValid,
  });
}

export function unknownFixtureObservation(
  overrides: Partial<PreviewCheckoutFixtureObservation> = {},
): PreviewCheckoutFixtureObservation {
  return Object.freeze({
    dbReadSucceeded: "unknown",
    stripeReadSucceeded: "unknown",
    ownerProfileUniqueAndValid: "unknown",
    effectivePlanFree: "unknown",
    billingStatusNone: "unknown",
    paidEffectiveFalse: "unknown",
    activeCheckoutAttemptCount: "unknown",
    customerCount: "unknown",
    checkoutSessionCount: "unknown",
    subscriptionCount: "unknown",
    activeOrTrialingSubscriptionCount: "unknown",
    stripeObjectsTestModeOnly: "unknown",
    stripeOwnerMatch: "unknown",
    stripeListWithinBound: "unknown",
    ...overrides,
  });
}
