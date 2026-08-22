import { createHash, randomUUID } from "node:crypto";
import Stripe from "stripe";

const ENABLE_VALUE = "CONTROLLED_PREVIEW_STRIPE_WEBHOOK";
const EXECUTE_APPROVAL_VALUE = "APPROVED_CONTROLLED_PREVIEW_WEBHOOK";
const EXPECTED_ACCOUNT_HASH =
  "e4faa1997723db3b467816d0a26b6719ec9de3d0d427cb15a901eafcfab26f2b";
const EVENT_TYPE = "customer.subscription.updated";
const PRODUCTION_HOST = "autopdf-web.vercel.app";
const PREVIEW_HOST_PATTERN =
  /^autopdf-web-git-codex-stripe-safety-clean-[a-z0-9-]+\.vercel\.app$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CUSTOMER_PATTERN = /^cus_[A-Za-z0-9]{8,}$/;
const SUBSCRIPTION_PATTERN = /^sub_[A-Za-z0-9]{8,}$/;

type OperatorMode = "dry_run" | "execute";
type StripeMode = "test" | "live" | "unknown";
type SafeFetch = typeof fetch;

type OperatorConfig = Readonly<{
  mode: OperatorMode;
  targetUrl: URL;
  stripeSecretKey: string;
  webhookSigningSecret: string;
  vercelBypassSecret: string;
  customerId: string;
  subscriptionId: string;
  baselineCreated: number;
  controlledCreated: number;
}>;

type ControlledEvent = Readonly<{
  id: string;
  object: "event";
  created: number;
  data: Readonly<{
    object: Readonly<{
      id: string;
      object: "subscription";
      customer: string;
    }>;
  }>;
  livemode: false;
  pending_webhooks: 1;
  type: typeof EVENT_TYPE;
}>;

export class OperatorError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "OperatorError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new OperatorError(code);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  errorCode: string,
) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) fail(errorCode);
  return value;
}

function parseEpoch(value: string, errorCode: string) {
  if (!/^\d{1,12}$/.test(value)) fail(errorCode);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(errorCode);
  return parsed;
}

export function parseOperatorMode(argv: readonly string[]): OperatorMode {
  if (argv.length !== 1) fail("OPERATOR_ARGUMENT_INVALID");
  if (argv[0] === "--dry-run") return "dry_run";
  if (argv[0] === "--execute") return "execute";
  fail("OPERATOR_ARGUMENT_INVALID");
}

export function classifyStripeMode(secretKey: string): StripeMode {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return "unknown";
}

export function validateEventType(eventType: string) {
  if (eventType !== EVENT_TYPE) fail("OPERATOR_EVENT_TYPE_REJECTED");
  return EVENT_TYPE;
}

export function validateStaleCreated(
  controlledCreated: number,
  baselineCreated: number,
) {
  if (
    !Number.isSafeInteger(controlledCreated) ||
    !Number.isSafeInteger(baselineCreated) ||
    controlledCreated <= 0 ||
    baselineCreated <= 0 ||
    controlledCreated >= baselineCreated
  ) {
    fail("OPERATOR_EVENT_NOT_STALE");
  }
}

export function validateFixture(customerId: string, subscriptionId: string) {
  if (!CUSTOMER_PATTERN.test(customerId)) {
    fail("OPERATOR_FIXTURE_CUSTOMER_INVALID");
  }
  if (!SUBSCRIPTION_PATTERN.test(subscriptionId)) {
    fail("OPERATOR_FIXTURE_SUBSCRIPTION_INVALID");
  }
}

export function validatePreviewTarget(
  rawTarget: string,
  expectedHostHash: string,
) {
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    fail("OPERATOR_TARGET_URL_INVALID");
  }

  if (target.hostname === PRODUCTION_HOST) {
    fail("OPERATOR_PRODUCTION_TARGET_REJECTED");
  }
  if (
    target.protocol !== "https:" ||
    target.port !== "" ||
    target.username !== "" ||
    target.password !== "" ||
    target.search !== "" ||
    target.hash !== "" ||
    target.pathname !== "/api/stripe/webhook" ||
    !PREVIEW_HOST_PATTERN.test(target.hostname)
  ) {
    fail("OPERATOR_PREVIEW_TARGET_REJECTED");
  }
  if (
    !SHA256_PATTERN.test(expectedHostHash) ||
    sha256(target.hostname) !== expectedHostHash
  ) {
    fail("OPERATOR_PREVIEW_HOST_MISMATCH");
  }
  return target;
}

export function loadOperatorConfig(
  environment: NodeJS.ProcessEnv,
  argv: readonly string[],
): OperatorConfig {
  const mode = parseOperatorMode(argv);
  if (
    requiredEnvironment(
      environment,
      "AUTOPDF_PREVIEW_STRIPE_SMOKE_ENABLE",
      "OPERATOR_ENABLE_GATE_REQUIRED",
    ) !== ENABLE_VALUE
  ) {
    fail("OPERATOR_ENABLE_GATE_REJECTED");
  }
  if (
    mode === "execute" &&
    requiredEnvironment(
      environment,
      "AUTOPDF_PREVIEW_STRIPE_EXECUTE",
      "OPERATOR_EXECUTION_APPROVAL_REQUIRED",
    ) !== EXECUTE_APPROVAL_VALUE
  ) {
    fail("OPERATOR_EXECUTION_APPROVAL_REJECTED");
  }

  const targetUrl = validatePreviewTarget(
    requiredEnvironment(
      environment,
      "AUTOPDF_PREVIEW_STRIPE_WEBHOOK_URL",
      "OPERATOR_TARGET_URL_REQUIRED",
    ),
    requiredEnvironment(
      environment,
      "AUTOPDF_PREVIEW_STRIPE_HOST_SHA256",
      "OPERATOR_PREVIEW_HOST_HASH_REQUIRED",
    ),
  );
  const stripeSecretKey = requiredEnvironment(
    environment,
    "AUTOPDF_PREVIEW_STRIPE_SECRET_KEY",
    "OPERATOR_STRIPE_CREDENTIAL_REQUIRED",
  );
  if (classifyStripeMode(stripeSecretKey) !== "test") {
    fail("OPERATOR_STRIPE_TEST_MODE_REQUIRED");
  }
  const webhookSigningSecret = requiredEnvironment(
    environment,
    "AUTOPDF_PREVIEW_STRIPE_WEBHOOK_SECRET",
    "OPERATOR_WEBHOOK_SECRET_REQUIRED",
  );
  const vercelBypassSecret = requiredEnvironment(
    environment,
    "AUTOPDF_PREVIEW_VERCEL_BYPASS_SECRET",
    "OPERATOR_BYPASS_SECRET_REQUIRED",
  );
  const customerId = requiredEnvironment(
    environment,
    "AUTOPDF_PREVIEW_STRIPE_CUSTOMER_ID",
    "OPERATOR_FIXTURE_CUSTOMER_REQUIRED",
  );
  const subscriptionId = requiredEnvironment(
    environment,
    "AUTOPDF_PREVIEW_STRIPE_SUBSCRIPTION_ID",
    "OPERATOR_FIXTURE_SUBSCRIPTION_REQUIRED",
  );
  validateFixture(customerId, subscriptionId);

  const baselineCreated = parseEpoch(
    requiredEnvironment(
      environment,
      "AUTOPDF_PREVIEW_STRIPE_BASELINE_CREATED",
      "OPERATOR_BASELINE_CREATED_REQUIRED",
    ),
    "OPERATOR_BASELINE_CREATED_INVALID",
  );
  const controlledCreated = parseEpoch(
    requiredEnvironment(
      environment,
      "AUTOPDF_PREVIEW_STRIPE_STALE_CREATED",
      "OPERATOR_STALE_CREATED_REQUIRED",
    ),
    "OPERATOR_STALE_CREATED_INVALID",
  );
  validateStaleCreated(controlledCreated, baselineCreated);

  return {
    mode,
    targetUrl,
    stripeSecretKey,
    webhookSigningSecret,
    vercelBypassSecret,
    customerId,
    subscriptionId,
    baselineCreated,
    controlledCreated,
  };
}

export function buildControlledEvent(
  config: Pick<
    OperatorConfig,
    "customerId" | "subscriptionId" | "baselineCreated" | "controlledCreated"
  >,
  createId: () => string = randomUUID,
): ControlledEvent {
  validateEventType(EVENT_TYPE);
  validateFixture(config.customerId, config.subscriptionId);
  validateStaleCreated(config.controlledCreated, config.baselineCreated);
  const entropy = createId().replaceAll("-", "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(entropy)) {
    fail("OPERATOR_EVENT_ID_GENERATION_FAILED");
  }
  return {
    id: `evt_autopdf_preview_${entropy}`,
    object: "event",
    created: config.controlledCreated,
    data: {
      object: {
        id: config.subscriptionId,
        object: "subscription",
        customer: config.customerId,
      },
    },
    livemode: false,
    pending_webhooks: 1,
    type: EVENT_TYPE,
  };
}

export function prepareSignedRequest(
  config: OperatorConfig,
  createId: () => string = randomUUID,
) {
  const event = buildControlledEvent(config, createId);
  const payload = JSON.stringify(event);
  const stripe = new Stripe(config.stripeSecretKey);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: config.webhookSigningSecret,
    timestamp: Math.floor(Date.now() / 1000),
  });
  const verified = stripe.webhooks.constructEvent(
    payload,
    signature,
    config.webhookSigningSecret,
  );
  if (verified.id !== event.id || verified.type !== EVENT_TYPE) {
    fail("OPERATOR_SIGNATURE_COMPATIBILITY_FAILED");
  }
  return {
    payload,
    signature,
    eventIdHash: sha256(event.id),
  };
}

async function safeJson(response: Response, errorCode: string) {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(errorCode);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    fail(errorCode);
  }
}

async function verifyProviderFixture(
  config: OperatorConfig,
  fetchImpl: SafeFetch,
) {
  const requestInit: RequestInit = {
    headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  };
  const accountResponse = await fetchImpl(
    "https://api.stripe.com/v1/account",
    requestInit,
  ).catch(() => fail("OPERATOR_STRIPE_ACCOUNT_READ_FAILED"));
  if (!accountResponse.ok) fail("OPERATOR_STRIPE_ACCOUNT_READ_FAILED");
  const account = await safeJson(
    accountResponse,
    "OPERATOR_STRIPE_ACCOUNT_RESPONSE_INVALID",
  );
  if (
    typeof account.id !== "string" ||
    sha256(account.id) !== EXPECTED_ACCOUNT_HASH
  ) {
    fail("OPERATOR_STRIPE_ACCOUNT_IDENTITY_MISMATCH");
  }

  const subscriptionResponse = await fetchImpl(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(config.subscriptionId)}`,
    requestInit,
  ).catch(() => fail("OPERATOR_STRIPE_SUBSCRIPTION_READ_FAILED"));
  if (!subscriptionResponse.ok) {
    fail("OPERATOR_STRIPE_SUBSCRIPTION_READ_FAILED");
  }
  const subscription = await safeJson(
    subscriptionResponse,
    "OPERATOR_STRIPE_SUBSCRIPTION_RESPONSE_INVALID",
  );
  if (
    subscription.id !== config.subscriptionId ||
    subscription.customer !== config.customerId ||
    subscription.livemode !== false
  ) {
    fail("OPERATOR_STRIPE_FIXTURE_IDENTITY_MISMATCH");
  }
}

export async function runOperator(
  environment: NodeJS.ProcessEnv,
  argv: readonly string[],
  fetchImpl: SafeFetch = fetch,
) {
  const config = loadOperatorConfig(environment, argv);
  const prepared = prepareSignedRequest(config);

  if (config.mode === "dry_run") {
    return {
      ok: true,
      mode: "dry_run",
      target_classification: "preview",
      stripe_mode: "test",
      owner_identity_gate: "configured",
      fixture_inputs_present: true,
      event_type: EVENT_TYPE,
      stale_timestamp: true,
      signature_compatible: true,
      event_id_hash: prepared.eventIdHash,
      network_requests: 0,
      database_writes: 0,
      stripe_writes: 0,
    } as const;
  }

  await verifyProviderFixture(config, fetchImpl);
  const response = await fetchImpl(config.targetUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": prepared.signature,
      "x-vercel-protection-bypass": config.vercelBypassSecret,
    },
    body: prepared.payload,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => fail("OPERATOR_PREVIEW_WEBHOOK_REQUEST_FAILED"));
  if (!response.ok) fail("OPERATOR_PREVIEW_WEBHOOK_REQUEST_FAILED");
  const result = await safeJson(
    response,
    "OPERATOR_PREVIEW_WEBHOOK_RESPONSE_INVALID",
  );
  if (result.received !== true || result.stale !== true) {
    fail("OPERATOR_PREVIEW_WEBHOOK_STALE_NOT_CONFIRMED");
  }
  return {
    ok: true,
    mode: "execute",
    target_classification: "preview",
    stripe_mode: "test",
    owner_identity_gate: "matched",
    fixture_identity_gate: "matched",
    http_status: response.status,
    received: true,
    stale: true,
    duplicate: result.duplicate === true,
    event_id_hash: prepared.eventIdHash,
    provider_read_requests: 2,
    preview_webhook_requests: 1,
    stripe_writes: 0,
  } as const;
}
