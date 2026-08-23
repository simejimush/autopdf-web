import type Stripe from "stripe";

const SUPPORTED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export type StripeWebhookResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
}>;

export type StripeWebhookRepository = Readonly<{
  claimWebhook(input: {
    eventId: string;
    eventType: string;
    providerCreatedAt: string;
  }): Promise<{
    disposition: "claimed" | "duplicate" | "in_progress" | "conflict";
    leaseHash: string;
  }>;
  failWebhook(input: {
    eventId: string;
    leaseHash: string;
    errorCode: string;
    retryable: boolean;
  }): Promise<void>;
  finalizeWebhook(input: {
    eventId: string;
    leaseHash: string;
    userId: string | null;
    customerId: string | null;
    subscriptionId: string | null;
    plan: "free" | "pro" | "pro_plus";
    billingStatus: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }): Promise<
    | "processed"
    | "stale"
    | "retryable_failed"
    | "terminal_failed"
    | "lost_claim"
  >;
}>;

type StripeWebhookClient = Readonly<{
  webhooks: Readonly<{
    constructEvent(
      body: string,
      signature: string,
      secret: string,
    ): Stripe.Event;
  }>;
  subscriptions: Readonly<{
    retrieve(subscriptionId: string): Promise<Stripe.Subscription>;
  }>;
}>;

function response(
  status: number,
  body: Readonly<Record<string, unknown>>,
): StripeWebhookResponse {
  return { status, body };
}

function errorResponse(status: number, error_code: string, message: string) {
  return response(status, { ok: false, error_code, message });
}

function currentPeriodEnd(subscription: Stripe.Subscription) {
  const value = subscription.items.data[0]?.current_period_end;
  return typeof value === "number"
    ? new Date(value * 1000).toISOString()
    : null;
}

function cancelScheduled(subscription: Stripe.Subscription) {
  if (subscription.cancel_at_period_end) return true;
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return (
    typeof subscription.cancel_at === "number" &&
    typeof periodEnd === "number" &&
    subscription.cancel_at === periodEnd
  );
}

function planFor(status: string, periodEnd: string | null): "free" | "pro" {
  if (status === "active" || status === "trialing") return "pro";
  if (
    status === "canceled" &&
    periodEnd &&
    new Date(periodEnd).getTime() > Date.now()
  ) {
    return "pro";
  }
  return "free";
}

export function createStripeWebhookProcessor(dependencies: {
  createStripe(secretKey: string): StripeWebhookClient;
  repository: StripeWebhookRepository;
}) {
  return async function processStripeWebhook(input: {
    secretKey: string | undefined;
    webhookSecret: string | undefined;
    signature: string | null;
    readBody(): Promise<string>;
  }): Promise<StripeWebhookResponse> {
    if (!input.secretKey || !input.webhookSecret) {
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "Webhook設定を確認できませんでした。",
      );
    }

    if (!input.signature) {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "署名ヘッダーがありません。",
      );
    }

    const stripe = dependencies.createStripe(input.secretKey);
    const body = await input.readBody();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        input.signature,
        input.webhookSecret,
      );
    } catch {
      return errorResponse(400, "INVALID_SIGNATURE", "Webhook署名が不正です。");
    }

    if (!SUPPORTED_EVENTS.has(event.type)) {
      return response(200, { received: true });
    }

    let claim;
    try {
      claim = await dependencies.repository.claimWebhook({
        eventId: event.id,
        eventType: event.type,
        providerCreatedAt: new Date(event.created * 1000).toISOString(),
      });
    } catch {
      return errorResponse(
        503,
        "STRIPE_WEBHOOK_LEDGER_UNAVAILABLE",
        "Webhookを安全に記録できませんでした。",
      );
    }

    if (claim.disposition === "duplicate") {
      return response(200, { received: true, duplicate: true });
    }
    if (claim.disposition === "in_progress") {
      return errorResponse(
        503,
        "STRIPE_WEBHOOK_IN_PROGRESS",
        "Webhook処理中です。",
      );
    }
    if (claim.disposition !== "claimed") {
      return errorResponse(
        400,
        "STRIPE_WEBHOOK_EVENT_CONFLICT",
        "Webhook eventの整合性を確認できませんでした。",
      );
    }

    try {
      let userId: string | null = null;
      let customerId: string | null = null;
      let subscriptionId: string | null = null;

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        userId =
          typeof session.metadata?.user_id === "string"
            ? session.metadata.user_id
            : null;
        customerId =
          typeof session.customer === "string" ? session.customer : null;
        subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : null;
        if (!userId || !customerId || !subscriptionId) {
          await dependencies.repository.failWebhook({
            eventId: event.id,
            leaseHash: claim.leaseHash,
            errorCode: "STRIPE_WEBHOOK_OWNER_METADATA_INVALID",
            retryable: false,
          });
          return errorResponse(
            400,
            "STRIPE_WEBHOOK_OWNER_METADATA_INVALID",
            "Webhookの所有者情報が不正です。",
          );
        }
      } else {
        const eventSubscription = event.data.object as Stripe.Subscription;
        subscriptionId = eventSubscription.id;
        customerId =
          typeof eventSubscription.customer === "string"
            ? eventSubscription.customer
            : null;
        if (!customerId) {
          await dependencies.repository.failWebhook({
            eventId: event.id,
            leaseHash: claim.leaseHash,
            errorCode: "STRIPE_WEBHOOK_CUSTOMER_INVALID",
            retryable: false,
          });
          return errorResponse(
            400,
            "STRIPE_WEBHOOK_CUSTOMER_INVALID",
            "Webhookの顧客情報が不正です。",
          );
        }
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const providerCustomerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : null;
      if (!providerCustomerId || providerCustomerId !== customerId) {
        await dependencies.repository.failWebhook({
          eventId: event.id,
          leaseHash: claim.leaseHash,
          errorCode: "STRIPE_WEBHOOK_CUSTOMER_MISMATCH",
          retryable: false,
        });
        return errorResponse(
          400,
          "STRIPE_WEBHOOK_CUSTOMER_MISMATCH",
          "Webhookの顧客情報が一致しません。",
        );
      }

      const periodEnd = currentPeriodEnd(subscription);
      const disposition = await dependencies.repository.finalizeWebhook({
        eventId: event.id,
        leaseHash: claim.leaseHash,
        userId,
        customerId,
        subscriptionId: subscription.id,
        plan: planFor(subscription.status, periodEnd),
        billingStatus: subscription.status,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: cancelScheduled(subscription),
      });

      if (disposition === "retryable_failed" || disposition === "lost_claim") {
        return errorResponse(
          503,
          "STRIPE_WEBHOOK_RETRYABLE",
          "Webhook処理を完了できませんでした。",
        );
      }
      if (disposition === "terminal_failed") {
        return errorResponse(
          400,
          "STRIPE_WEBHOOK_OWNER_CONFLICT",
          "Webhookの所有権を安全に確認できませんでした。",
        );
      }
      return response(200, {
        received: true,
        stale: disposition === "stale",
      });
    } catch {
      await dependencies.repository
        .failWebhook({
          eventId: event.id,
          leaseHash: claim.leaseHash,
          errorCode: "STRIPE_WEBHOOK_PROVIDER_RETRYABLE",
          retryable: true,
        })
        .catch(() => undefined);
      return errorResponse(
        503,
        "STRIPE_WEBHOOK_RETRYABLE",
        "Webhook処理を完了できませんでした。",
      );
    }
  };
}
