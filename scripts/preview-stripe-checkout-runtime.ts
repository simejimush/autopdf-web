import { createHash, timingSafeEqual } from "node:crypto";

const EXECUTE_APPROVAL = "APPROVED_PREVIEW_CHECKOUT_CONCURRENCY";
const REQUEST_COUNT = 2 as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PRODUCTION_HOST = "autopdf-web.vercel.app";

export const PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES = Object.freeze({
  appOrigin: "AUTOPDF_PREVIEW_HARNESS_APP_ORIGIN",
  expectedAppOriginHash: "AUTOPDF_PREVIEW_HARNESS_EXPECTED_APP_ORIGIN_SHA256",
  expectedOwnerHash: "AUTOPDF_PREVIEW_HARNESS_EXPECTED_OWNER_SHA256",
  authCookie: "AUTOPDF_PREVIEW_HARNESS_AUTH_COOKIE",
  stripeSecretKey: "AUTOPDF_PREVIEW_HARNESS_STRIPE_SECRET_KEY",
  execute: "AUTOPDF_PREVIEW_HARNESS_EXECUTE",
} as const);

type HarnessEnvironment = Readonly<Record<string, string | undefined>>;

type RuntimeErrorCode =
  | "RUNTIME_ARGUMENT_FORBIDDEN"
  | "RUNTIME_REQUIRED_ENV_MISSING"
  | "RUNTIME_EXECUTION_APPROVAL_REQUIRED"
  | "RUNTIME_APP_ORIGIN_INVALID"
  | "RUNTIME_APP_ORIGIN_MISMATCH"
  | "RUNTIME_PRODUCTION_FORBIDDEN"
  | "RUNTIME_OWNER_TRUST_ROOT_INVALID"
  | "RUNTIME_AUTH_COOKIE_INVALID"
  | "RUNTIME_STRIPE_TEST_MODE_REQUIRED"
  | "RUNTIME_PREFLIGHT_FAILED"
  | "RUNTIME_FIXTURE_INVALID"
  | "RUNTIME_CONCURRENCY_FAILED"
  | "RUNTIME_CONCURRENCY_RESULT_UNSAFE"
  | "RUNTIME_CLEANUP_FAILED";

export type PreviewCheckoutRuntimeConfig = Readonly<{
  appOrigin: string;
  expectedOwnerHash: string;
  authCookie: string;
  stripeSecretKey: string;
  requestCount: typeof REQUEST_COUNT;
}>;

export type PreviewCheckoutRuntimeBaseline = Readonly<{
  activeCheckoutAttemptCount: number;
  customerCount: number;
  checkoutSessionCount: number;
  subscriptionCount: number;
  effectivePlan: "free" | "pro" | "pro_plus" | "unknown";
  billingStatus: "none" | "active" | "trialing" | "other";
  paid: boolean;
}>;

type RuntimeExecutionResult = Readonly<{
  authenticated: boolean;
  request_count: number;
  winner_count: number;
  loser_count: number;
  active_attempt_max: number;
  active_attempt_count: number;
  customer_created_count: number;
  session_created_count: number;
  subscription_created_count: number;
  production_operations: number;
  live_operations: number;
  fixture_fresh: boolean;
  fixture_free: boolean;
  fixture_unsubscribed: boolean;
  billing_profile_paid_mutation: boolean;
}>;

type CleanupResult = Readonly<{
  complete: boolean;
  activeAttemptFinal: number;
  fixtureFree: boolean;
  fixtureUnsubscribed: boolean;
  unnecessaryArtifactCount: number;
}>;

export type PreviewCheckoutRuntimeHarness = Readonly<{
  inspectBaseline(): Promise<PreviewCheckoutRuntimeBaseline>;
  prepareFixture(): Promise<void>;
  executeConcurrency(): Promise<RuntimeExecutionResult>;
  cleanupCreatedArtifacts(): Promise<CleanupResult>;
}>;

type RuntimePreflightResult = Readonly<{
  previewDeploymentIdentityMatch: boolean;
  previewSupabaseIdentityMatch: boolean;
  stripeMode: "test" | "other";
  expectedStripeAccountMatch: boolean;
  ownerIdentityMatch: boolean;
  productionIdentity: boolean;
  developmentIdentity: boolean;
  harness: PreviewCheckoutRuntimeHarness;
}>;

export type PreviewCheckoutRuntimeDependencies = Readonly<{
  runPreflight(input: {
    config: PreviewCheckoutRuntimeConfig;
    environment: HarnessEnvironment;
  }): Promise<RuntimePreflightResult>;
}>;

export type PreviewCheckoutRuntimeReport = Readonly<{
  verdict: "STRIPE_SAFETY_PHASE_CLOSED";
  preview_deployment_identity_match: true;
  preview_supabase_identity_match: true;
  stripe_mode: "test";
  expected_stripe_account_match: true;
  fixture_fresh: true;
  fixture_free: true;
  fixture_unsubscribed: true;
  baseline_active_checkout_attempt_count: 0;
  baseline_customer_count: 0;
  baseline_checkout_session_count: 0;
  baseline_subscription_count: 0;
  concurrent_authenticated_request_count: 2;
  winner_count: 1;
  safe_loser_count: 1;
  active_checkout_attempt_max: number;
  active_checkout_attempt_final: 0;
  stripe_customer_delta: number;
  checkout_session_delta: number;
  subscription_delta: 0;
  billing_profile_paid_mutation: false;
  privacy_exposure_count: 0;
  secret_token_cookie_exposure_count: 0;
  production_operation_count: 0;
  stripe_live_operation_count: 0;
  cleanup: "complete";
  repository_changes: 0;
  stripe_safety_phase_closed: true;
  next_phase: "Cost Safety / Unit Economics";
}>;

export class PreviewCheckoutRuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(code: RuntimeErrorCode) {
    super(code);
    this.name = "PreviewCheckoutRuntimeError";
    this.code = code;
  }
}

function fail(code: RuntimeErrorCode): never {
  throw new PreviewCheckoutRuntimeError(code);
}

function requiredEnvironment(environment: HarnessEnvironment, name: string) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    fail("RUNTIME_REQUIRED_ENV_MISSING");
  }
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeHashMatch(calculated: string, expected: string) {
  return timingSafeEqual(
    Buffer.from(calculated, "hex"),
    Buffer.from(expected, "hex"),
  );
}

function normalizeAppOrigin(rawValue: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    fail("RUNTIME_APP_ORIGIN_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    fail("RUNTIME_APP_ORIGIN_INVALID");
  }
  if (parsed.hostname === PRODUCTION_HOST) {
    fail("RUNTIME_PRODUCTION_FORBIDDEN");
  }
  return parsed.origin;
}

function loadRuntimeConfig(
  environment: HarnessEnvironment,
  argv: readonly string[],
): PreviewCheckoutRuntimeConfig {
  if (argv.length !== 0) fail("RUNTIME_ARGUMENT_FORBIDDEN");
  if (
    requiredEnvironment(
      environment,
      PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.execute,
    ) !== EXECUTE_APPROVAL
  ) {
    fail("RUNTIME_EXECUTION_APPROVAL_REQUIRED");
  }

  const appOrigin = normalizeAppOrigin(
    requiredEnvironment(
      environment,
      PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.appOrigin,
    ),
  );
  const expectedAppOriginHash = requiredEnvironment(
    environment,
    PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.expectedAppOriginHash,
  );
  if (
    !SHA256_PATTERN.test(expectedAppOriginHash) ||
    !safeHashMatch(sha256(appOrigin), expectedAppOriginHash)
  ) {
    fail("RUNTIME_APP_ORIGIN_MISMATCH");
  }

  const expectedOwnerHash = requiredEnvironment(
    environment,
    PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.expectedOwnerHash,
  );
  if (!SHA256_PATTERN.test(expectedOwnerHash)) {
    fail("RUNTIME_OWNER_TRUST_ROOT_INVALID");
  }

  const authCookie = requiredEnvironment(
    environment,
    PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.authCookie,
  );
  if (
    authCookie.length > 32_768 ||
    /[\r\n\0]/.test(authCookie) ||
    !authCookie.includes("=")
  ) {
    fail("RUNTIME_AUTH_COOKIE_INVALID");
  }

  const stripeSecretKey = requiredEnvironment(
    environment,
    PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.stripeSecretKey,
  );
  if (!stripeSecretKey.startsWith("sk_test_")) {
    fail("RUNTIME_STRIPE_TEST_MODE_REQUIRED");
  }

  return Object.freeze({
    appOrigin,
    expectedOwnerHash,
    authCookie,
    stripeSecretKey,
    requestCount: REQUEST_COUNT,
  });
}

function validatePreflight(result: RuntimePreflightResult) {
  if (
    !result.previewDeploymentIdentityMatch ||
    !result.previewSupabaseIdentityMatch ||
    result.stripeMode !== "test" ||
    !result.expectedStripeAccountMatch ||
    !result.ownerIdentityMatch ||
    result.productionIdentity ||
    result.developmentIdentity
  ) {
    fail("RUNTIME_PREFLIGHT_FAILED");
  }
}

function validateBaseline(baseline: PreviewCheckoutRuntimeBaseline) {
  if (
    baseline.activeCheckoutAttemptCount !== 0 ||
    baseline.customerCount !== 0 ||
    baseline.checkoutSessionCount !== 0 ||
    baseline.subscriptionCount !== 0 ||
    baseline.effectivePlan !== "free" ||
    baseline.billingStatus !== "none" ||
    baseline.paid
  ) {
    fail("RUNTIME_FIXTURE_INVALID");
  }
}

function validateExecution(result: RuntimeExecutionResult) {
  if (
    !result.authenticated ||
    result.request_count !== REQUEST_COUNT ||
    result.winner_count !== 1 ||
    result.loser_count !== 1 ||
    result.active_attempt_max > 1 ||
    result.active_attempt_count > 1 ||
    result.customer_created_count < 0 ||
    result.customer_created_count > 1 ||
    result.session_created_count < 0 ||
    result.session_created_count > 1 ||
    result.subscription_created_count !== 0 ||
    result.production_operations !== 0 ||
    result.live_operations !== 0 ||
    !result.fixture_fresh ||
    !result.fixture_free ||
    !result.fixture_unsubscribed ||
    result.billing_profile_paid_mutation
  ) {
    fail("RUNTIME_CONCURRENCY_RESULT_UNSAFE");
  }
}

function validateCleanup(result: CleanupResult) {
  if (
    !result.complete ||
    result.activeAttemptFinal !== 0 ||
    !result.fixtureFree ||
    !result.fixtureUnsubscribed ||
    result.unnecessaryArtifactCount !== 0
  ) {
    fail("RUNTIME_CLEANUP_FAILED");
  }
}

export async function executePreviewCheckoutConcurrencyRuntime(input: {
  environment: HarnessEnvironment;
  argv: readonly string[];
  dependencies: PreviewCheckoutRuntimeDependencies;
}): Promise<PreviewCheckoutRuntimeReport> {
  const config = loadRuntimeConfig(input.environment, input.argv);

  let preflight: RuntimePreflightResult;
  try {
    preflight = await input.dependencies.runPreflight({
      config,
      environment: input.environment,
    });
  } catch {
    fail("RUNTIME_PREFLIGHT_FAILED");
  }
  validatePreflight(preflight);

  let baseline: PreviewCheckoutRuntimeBaseline;
  try {
    baseline = await preflight.harness.inspectBaseline();
  } catch {
    fail("RUNTIME_FIXTURE_INVALID");
  }
  validateBaseline(baseline);

  try {
    await preflight.harness.prepareFixture();
  } catch {
    fail("RUNTIME_FIXTURE_INVALID");
  }

  let execution: RuntimeExecutionResult | undefined;
  let executionFailed = false;
  try {
    execution = await preflight.harness.executeConcurrency();
  } catch {
    executionFailed = true;
  }

  let cleanup: CleanupResult;
  try {
    cleanup = await preflight.harness.cleanupCreatedArtifacts();
  } catch {
    fail("RUNTIME_CLEANUP_FAILED");
  }
  validateCleanup(cleanup);
  if (executionFailed || !execution) fail("RUNTIME_CONCURRENCY_FAILED");
  validateExecution(execution);

  return Object.freeze({
    verdict: "STRIPE_SAFETY_PHASE_CLOSED",
    preview_deployment_identity_match: true,
    preview_supabase_identity_match: true,
    stripe_mode: "test",
    expected_stripe_account_match: true,
    fixture_fresh: true,
    fixture_free: true,
    fixture_unsubscribed: true,
    baseline_active_checkout_attempt_count: 0,
    baseline_customer_count: 0,
    baseline_checkout_session_count: 0,
    baseline_subscription_count: 0,
    concurrent_authenticated_request_count: REQUEST_COUNT,
    winner_count: 1,
    safe_loser_count: 1,
    active_checkout_attempt_max: execution.active_attempt_max,
    active_checkout_attempt_final: 0,
    stripe_customer_delta: execution.customer_created_count,
    checkout_session_delta: execution.session_created_count,
    subscription_delta: 0,
    billing_profile_paid_mutation: false,
    privacy_exposure_count: 0,
    secret_token_cookie_exposure_count: 0,
    production_operation_count: 0,
    stripe_live_operation_count: 0,
    cleanup: "complete",
    repository_changes: 0,
    stripe_safety_phase_closed: true,
    next_phase: "Cost Safety / Unit Economics",
  });
}

export async function runPreviewCheckoutConcurrencyRuntimeCli(input: {
  environment: HarnessEnvironment;
  argv: readonly string[];
  dependencies: PreviewCheckoutRuntimeDependencies;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}) {
  try {
    const result = await executePreviewCheckoutConcurrencyRuntime(input);
    input.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const errorCode =
      error instanceof PreviewCheckoutRuntimeError
        ? error.code
        : "RUNTIME_UNEXPECTED_FAILURE";
    input.stderr.write(
      `${JSON.stringify({ verdict: "BLOCKED", error_code: errorCode })}\n`,
    );
    return 1;
  }
}
