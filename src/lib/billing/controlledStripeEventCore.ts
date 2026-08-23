import { createHash, randomUUID } from "node:crypto";
import Stripe from "stripe";

export const CONTROLLED_STRIPE_EVENT_TYPE =
  "customer.subscription.updated" as const;
export const EXPECTED_PREVIEW_STRIPE_ACCOUNT_SHA256 =
  "e4faa1997723db3b467816d0a26b6719ec9de3d0d427cb15a901eafcfab26f2b";

const CUSTOMER_PATTERN = /^cus_[A-Za-z0-9]{8,}$/;
const SUBSCRIPTION_PATTERN = /^sub_[A-Za-z0-9]{8,}$/;

export type StripeMode = "test" | "live" | "unknown";

export type ControlledEventInput = Readonly<{
  customerId: string;
  subscriptionId: string;
  baselineCreated: number;
  controlledCreated: number;
}>;

export type ControlledStripeEvent = Readonly<{
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
  type: typeof CONTROLLED_STRIPE_EVENT_TYPE;
}>;

export class OperatorError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "OperatorError";
    this.code = code;
  }
}

export function failOperator(code: string): never {
  throw new OperatorError(code);
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function classifyStripeMode(secretKey: string): StripeMode {
  if (secretKey.startsWith("sk_test_")) return "test";
  if (secretKey.startsWith("sk_live_")) return "live";
  return "unknown";
}

export function validateEventType(eventType: string) {
  if (eventType !== CONTROLLED_STRIPE_EVENT_TYPE) {
    failOperator("OPERATOR_EVENT_TYPE_REJECTED");
  }
  return CONTROLLED_STRIPE_EVENT_TYPE;
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
    failOperator("OPERATOR_EVENT_NOT_STALE");
  }
}

export function validateFixture(customerId: string, subscriptionId: string) {
  if (!CUSTOMER_PATTERN.test(customerId)) {
    failOperator("OPERATOR_FIXTURE_CUSTOMER_INVALID");
  }
  if (!SUBSCRIPTION_PATTERN.test(subscriptionId)) {
    failOperator("OPERATOR_FIXTURE_SUBSCRIPTION_INVALID");
  }
}

export function buildControlledEvent(
  config: ControlledEventInput,
  createId: () => string = randomUUID,
): ControlledStripeEvent {
  validateEventType(CONTROLLED_STRIPE_EVENT_TYPE);
  validateFixture(config.customerId, config.subscriptionId);
  validateStaleCreated(config.controlledCreated, config.baselineCreated);
  const entropy = createId().replaceAll("-", "");
  if (!/^[A-Za-z0-9]{16,64}$/.test(entropy)) {
    failOperator("OPERATOR_EVENT_ID_GENERATION_FAILED");
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
    type: CONTROLLED_STRIPE_EVENT_TYPE,
  };
}

export function prepareControlledSignedRequest(input: {
  config: ControlledEventInput;
  stripeSecretKey: string;
  webhookSigningSecret: string;
  createId?: () => string;
}) {
  const event = buildControlledEvent(input.config, input.createId);
  const payload = JSON.stringify(event);
  const stripe = new Stripe(input.stripeSecretKey);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: input.webhookSigningSecret,
    timestamp: Math.floor(Date.now() / 1000),
  });
  const verified = stripe.webhooks.constructEvent(
    payload,
    signature,
    input.webhookSigningSecret,
  );
  if (
    verified.id !== event.id ||
    verified.type !== CONTROLLED_STRIPE_EVENT_TYPE
  ) {
    failOperator("OPERATOR_SIGNATURE_COMPATIBILITY_FAILED");
  }
  return {
    payload,
    signature,
    eventIdHash: sha256(event.id),
  };
}
