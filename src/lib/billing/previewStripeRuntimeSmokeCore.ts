import {
  EXPECTED_PREVIEW_STRIPE_ACCOUNT_SHA256,
  classifyStripeMode,
  prepareControlledSignedRequest,
  sha256,
  validateFixture,
  validateStaleCreated,
} from "@/lib/billing/controlledStripeEventCore";
import type { StripeWebhookResponse } from "@/lib/billing/stripeWebhookCore";

const EXPECTED_BRANCH = "codex/stripe-safety-clean";
const ENABLE_VALUE = "CONTROLLED_PREVIEW_STRIPE_WEBHOOK";
const EXECUTE_VALUE = "APPROVED_CONTROLLED_PREVIEW_WEBHOOK";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

export type PreviewStripeSmokeProfile = Readonly<{
  user_id: string;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  billing_provider: string | null;
  plan: string | null;
  billing_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}>;

export type PreviewSmokeGateResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; errorCode: string }>;

export class PreviewStripeSmokeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PreviewStripeSmokeError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new PreviewStripeSmokeError(code);
}

function validExpectedHash(value: string | undefined) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function safeOrigin(rawUrl: string | undefined) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function evaluatePreviewStripeSmokeGate(input: {
  vercelEnv: string | undefined;
  gitBranch: string | undefined;
  gitSha: string | undefined;
  allowedGitSha: string | undefined;
  vercelProjectId: string | undefined;
  expectedVercelProjectHash: string | undefined;
  deploymentId: string | undefined;
  vercelUrl: string | undefined;
  supabaseUrl: string | undefined;
  expectedSupabaseOriginHash: string | undefined;
  enabled: string | undefined;
  execute: string | undefined;
}): PreviewSmokeGateResult {
  if (input.vercelEnv !== "preview") {
    return { ok: false, errorCode: "PREVIEW_SMOKE_PREVIEW_ONLY" };
  }
  if (input.gitBranch !== EXPECTED_BRANCH) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_BRANCH_FORBIDDEN" };
  }
  if (
    !input.allowedGitSha ||
    !GIT_SHA_PATTERN.test(input.allowedGitSha) ||
    input.gitSha !== input.allowedGitSha
  ) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_GIT_SHA_FORBIDDEN" };
  }
  if (
    !input.vercelProjectId ||
    !validExpectedHash(input.expectedVercelProjectHash) ||
    sha256(input.vercelProjectId) !== input.expectedVercelProjectHash
  ) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_PROJECT_FORBIDDEN" };
  }
  if (!input.deploymentId || !input.vercelUrl) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_DEPLOYMENT_REQUIRED" };
  }
  const supabaseOrigin = safeOrigin(input.supabaseUrl);
  if (
    !supabaseOrigin ||
    !validExpectedHash(input.expectedSupabaseOriginHash) ||
    sha256(supabaseOrigin) !== input.expectedSupabaseOriginHash
  ) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_SUPABASE_FORBIDDEN" };
  }
  if (input.enabled !== ENABLE_VALUE) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_DISABLED" };
  }
  if (input.execute !== EXECUTE_VALUE) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_EXECUTION_NOT_APPROVED" };
  }
  return { ok: true };
}

export function evaluatePreviewSmokeRequest(input: {
  requestUrl: string;
  origin: string | null;
  fetchSite: string | null;
  fetchMode: string | null;
  vercelUrl: string;
}): PreviewSmokeGateResult {
  let requestUrl: URL;
  try {
    requestUrl = new URL(input.requestUrl);
  } catch {
    return { ok: false, errorCode: "PREVIEW_SMOKE_REQUEST_FORBIDDEN" };
  }
  const expectedOrigin = `https://${input.vercelUrl}`;
  if (
    requestUrl.origin !== expectedOrigin ||
    input.origin !== expectedOrigin ||
    input.fetchSite !== "same-origin" ||
    input.fetchMode !== "cors"
  ) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_REQUEST_FORBIDDEN" };
  }
  return { ok: true };
}

export function authorizePreviewSmokeFixture(input: {
  userId: string;
  profile: PreviewStripeSmokeProfile | null;
  expectedOwnerHash: string | undefined;
  expectedCustomerHash: string | undefined;
  expectedSubscriptionHash: string | undefined;
}): PreviewSmokeGateResult {
  const profile = input.profile;
  if (
    !profile ||
    profile.user_id !== input.userId ||
    !profile.billing_customer_id ||
    !profile.billing_subscription_id ||
    !validExpectedHash(input.expectedOwnerHash) ||
    !validExpectedHash(input.expectedCustomerHash) ||
    !validExpectedHash(input.expectedSubscriptionHash) ||
    sha256(input.userId) !== input.expectedOwnerHash ||
    sha256(profile.billing_customer_id) !== input.expectedCustomerHash ||
    sha256(profile.billing_subscription_id) !== input.expectedSubscriptionHash
  ) {
    return { ok: false, errorCode: "PREVIEW_SMOKE_FIXTURE_FORBIDDEN" };
  }
  return { ok: true };
}

function stateHash(profile: PreviewStripeSmokeProfile) {
  return sha256(
    JSON.stringify({
      plan: profile.plan,
      billing_provider: profile.billing_provider,
      billing_status: profile.billing_status,
      current_period_end: profile.current_period_end,
      cancel_at_period_end: profile.cancel_at_period_end,
    }),
  );
}

type ProviderClient = Readonly<{
  accounts: Readonly<{ retrieve(): Promise<{ id?: string }> }>;
  subscriptions: Readonly<{
    retrieve(id: string): Promise<{
      id: string;
      customer: string | { id?: string } | null;
      livemode: boolean;
    }>;
  }>;
}>;

export async function runPreviewStripeSmoke(input: {
  deploymentId: string;
  stripeSecretKey: string;
  webhookSecret: string;
  baselineCreatedAt: string;
  profileBefore: PreviewStripeSmokeProfile;
  provider: ProviderClient;
  expectedStripeAccountHash?: string;
  processWebhook(request: {
    secretKey: string;
    webhookSecret: string;
    signature: string;
    body: string;
  }): Promise<StripeWebhookResponse>;
  loadProfileAfter(): Promise<PreviewStripeSmokeProfile | null>;
}) {
  if (classifyStripeMode(input.stripeSecretKey) !== "test") {
    fail("PREVIEW_SMOKE_STRIPE_TEST_MODE_REQUIRED");
  }
  if (!input.webhookSecret) fail("PREVIEW_SMOKE_WEBHOOK_SECRET_REQUIRED");

  const customerId = input.profileBefore.billing_customer_id;
  const subscriptionId = input.profileBefore.billing_subscription_id;
  if (!customerId || !subscriptionId) fail("PREVIEW_SMOKE_FIXTURE_INVALID");
  validateFixture(customerId, subscriptionId);

  const baselineMilliseconds = Date.parse(input.baselineCreatedAt);
  const baselineCreated = Math.floor(baselineMilliseconds / 1000);
  const controlledCreated = baselineCreated - 1;
  validateStaleCreated(controlledCreated, baselineCreated);

  let account: { id?: string };
  let subscription: Awaited<
    ReturnType<ProviderClient["subscriptions"]["retrieve"]>
  >;
  try {
    account = await input.provider.accounts.retrieve();
    subscription = await input.provider.subscriptions.retrieve(subscriptionId);
  } catch {
    fail("PREVIEW_SMOKE_PROVIDER_READ_FAILED");
  }
  if (
    typeof account.id !== "string" ||
    sha256(account.id) !==
      (input.expectedStripeAccountHash ??
        EXPECTED_PREVIEW_STRIPE_ACCOUNT_SHA256)
  ) {
    fail("PREVIEW_SMOKE_STRIPE_ACCOUNT_FORBIDDEN");
  }
  const providerCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
  if (
    subscription.livemode !== false ||
    subscription.id !== subscriptionId ||
    providerCustomerId !== customerId
  ) {
    fail("PREVIEW_SMOKE_PROVIDER_FIXTURE_MISMATCH");
  }

  const deterministicId = sha256(
    `autopdf-preview-stripe-smoke:v1:${input.deploymentId}:${customerId}:${subscriptionId}`,
  );
  const prepared = prepareControlledSignedRequest({
    config: {
      customerId,
      subscriptionId,
      baselineCreated,
      controlledCreated,
    },
    stripeSecretKey: input.stripeSecretKey,
    webhookSigningSecret: input.webhookSecret,
    createId: () => deterministicId,
  });

  const webhookResult = await input.processWebhook({
    secretKey: input.stripeSecretKey,
    webhookSecret: input.webhookSecret,
    signature: prepared.signature,
    body: prepared.payload,
  });
  const stale = webhookResult.body.stale === true;
  const duplicate = webhookResult.body.duplicate === true;
  if (webhookResult.status !== 200 || (!stale && !duplicate)) {
    fail("PREVIEW_SMOKE_WEBHOOK_FAILED");
  }

  let profileAfter: PreviewStripeSmokeProfile | null;
  try {
    profileAfter = await input.loadProfileAfter();
  } catch {
    fail("PREVIEW_SMOKE_PROFILE_VERIFY_FAILED");
  }
  if (
    !profileAfter ||
    profileAfter.user_id !== input.profileBefore.user_id ||
    profileAfter.billing_customer_id !== customerId ||
    profileAfter.billing_subscription_id !== subscriptionId ||
    stateHash(profileAfter) !== stateHash(input.profileBefore)
  ) {
    fail("PREVIEW_SMOKE_BILLING_STATE_CHANGED");
  }

  return Object.freeze({
    ok: true,
    state: "pass",
    stale,
    duplicate,
    billing_state_unchanged: true,
    event_id_hash: prepared.eventIdHash,
  });
}
