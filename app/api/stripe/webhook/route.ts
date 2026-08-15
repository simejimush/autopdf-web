import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripeSafetyRepository } from "@/lib/billing/stripeSafetyRepository";

export const runtime = "nodejs";

const SUPPORTED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

function errorResponse(status: number, error_code: string, message: string) {
  return NextResponse.json({ ok: false, error_code, message }, { status });
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

export async function POST(request: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Webhook設定を確認できませんでした。",
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return errorResponse(400, "INVALID_REQUEST", "署名ヘッダーがありません。");
  }

  const stripe = new Stripe(secretKey);
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return errorResponse(400, "INVALID_SIGNATURE", "Webhook署名が不正です。");
  }

  if (!SUPPORTED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  let claim;
  try {
    claim = await stripeSafetyRepository.claimWebhook({
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
    return NextResponse.json({ received: true, duplicate: true });
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
        typeof session.subscription === "string" ? session.subscription : null;
      if (!userId || !customerId || !subscriptionId) {
        await stripeSafetyRepository.failWebhook({
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
        await stripeSafetyRepository.failWebhook({
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

    // Reconcile against current provider state. Event payload ordering is never trusted.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const providerCustomerId =
      typeof subscription.customer === "string" ? subscription.customer : null;
    if (!providerCustomerId || providerCustomerId !== customerId) {
      await stripeSafetyRepository.failWebhook({
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
    const disposition = await stripeSafetyRepository.finalizeWebhook({
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
    return NextResponse.json({
      received: true,
      stale: disposition === "stale",
    });
  } catch {
    await stripeSafetyRepository
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
}
