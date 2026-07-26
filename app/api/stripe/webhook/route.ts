import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { StripeWebhookProfileRepositoryError } from "@/lib/billing/stripeWebhookProfileRepositoryCore";
import {
  resolveStripeWebhookProfileOwner,
  updateStripeWebhookProfile,
} from "@/lib/billing/stripeWebhookProfileRepository";
import { disableFreePlanOverflowRules } from "@/lib/rules/freePlanLimit";

export const runtime = "nodejs";

const OWNERSHIP_ERROR_CODES = new Set([
  "STRIPE_WEBHOOK_INPUT_INVALID",
  "STRIPE_WEBHOOK_OWNER_NOT_FOUND",
  "STRIPE_WEBHOOK_OWNER_DUPLICATE",
  "STRIPE_WEBHOOK_OWNER_CONFLICT",
]);

function getStripeObjectId(value: unknown) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;

  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function getMetadataUserId(metadata: Stripe.Metadata | null | undefined) {
  const value = metadata?.user_id;
  if (value === undefined) return null;
  return typeof value === "string" ? value : "";
}

function failOwnership(): never {
  throw new StripeWebhookProfileRepositoryError(
    "STRIPE_WEBHOOK_OWNER_CONFLICT",
  );
}

function logWebhookFailure(errorCode: string, eventType: string) {
  console.error("[stripe-webhook] processing failed", {
    error_code: errorCode,
    event_type: eventType,
  });
}

function errorResponse(status: number, error_code: string, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error_code,
      message,
    },
    { status },
  );
}

function toIsoFromUnix(value?: number | null) {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

function getCurrentPeriodEndIso(subscription: Stripe.Subscription) {
  const fromItem = subscription.items.data[0]?.current_period_end;
  if (typeof fromItem === "number") {
    return toIsoFromUnix(fromItem);
  }
  return null;
}

function isCancelScheduled(subscription: Stripe.Subscription) {
  if (subscription.cancel_at_period_end) {
    return true;
  }

  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;

  return (
    typeof subscription.cancel_at === "number" &&
    typeof currentPeriodEnd === "number" &&
    subscription.cancel_at === currentPeriodEnd
  );
}

function resolvePlan(
  billingStatus?: string | null,
  currentPeriodEnd?: string | null,
) {
  if (!billingStatus) return "free";

  if (billingStatus === "active" || billingStatus === "trialing") {
    return "pro";
  }

  if (billingStatus === "canceled" && currentPeriodEnd) {
    const endMs = new Date(currentPeriodEnd).getTime();
    if (!Number.isNaN(endMs) && endMs > Date.now()) {
      return "pro";
    }
  }

  return "free";
}

export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey) {
    return errorResponse(500, "INTERNAL_ERROR", "Stripe設定に問題があります。");
  }

  if (!webhookSecret) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Webhook設定に問題があります。",
    );
  }

  const stripe = new Stripe(secretKey);

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return errorResponse(400, "INVALID_REQUEST", "署名ヘッダーがありません。");
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return errorResponse(400, "INVALID_SIGNATURE", "Webhook署名が不正です。");
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const metadataUserId = getMetadataUserId(session.metadata);
      const customerId = getStripeObjectId(session.customer) ?? "";
      const subscriptionId = getStripeObjectId(session.subscription) ?? "";
      const owner = await resolveStripeWebhookProfileOwner({
        customerId,
        subscriptionId,
        metadataUserId,
        requireMetadataUserId: true,
      });

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionCustomerId = getStripeObjectId(subscription.customer);
      const subscriptionMetadataUserId = getMetadataUserId(
        subscription.metadata,
      );

      if (
        subscription.id !== subscriptionId ||
        subscriptionCustomerId !== customerId ||
        (subscriptionMetadataUserId !== null &&
          subscriptionMetadataUserId !== metadataUserId)
      ) {
        failOwnership();
      }

      const billingStatus = subscription.status;
      const currentPeriodEnd = getCurrentPeriodEndIso(subscription);

      const plan = resolvePlan(billingStatus, currentPeriodEnd);

      await updateStripeWebhookProfile({
        owner,
        plan,
        billingStatus,
        currentPeriodEnd,
        planUpdatedAt: new Date().toISOString(),
      });

      const userId = owner.userId;
      if (plan === "free") {
        const disableResult = await disableFreePlanOverflowRules(userId);

        if (!disableResult.ok) {
          return errorResponse(
            500,
            "DB_UPDATE_FAILED",
            "Freeプラン上限超過ルールの停止に失敗しました。",
          );
        }
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;

      const customerId = getStripeObjectId(subscription.customer) ?? "";
      const subscriptionId = getStripeObjectId(subscription.id) ?? "";
      const metadataUserId = getMetadataUserId(subscription.metadata);
      const owner = await resolveStripeWebhookProfileOwner({
        customerId,
        subscriptionId,
        metadataUserId,
        requireMetadataUserId: false,
      });

      const billingStatus = subscription.status;
      const currentPeriodEnd = getCurrentPeriodEndIso(subscription);
      const plan = resolvePlan(billingStatus, currentPeriodEnd);

      await updateStripeWebhookProfile({
        owner,
        plan,
        billingStatus,
        currentPeriodEnd,
        cancelAtPeriodEnd: isCancelScheduled(subscription),
        planUpdatedAt: new Date().toISOString(),
      });

      const userId = owner.userId;

      if (plan === "free") {
        const disableResult = await disableFreePlanOverflowRules(userId);

        if (!disableResult.ok) {
          return errorResponse(
            500,
            "DB_UPDATE_FAILED",
            "Freeプラン上限超過ルールの停止に失敗しました。",
          );
        }
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    if (error instanceof StripeWebhookProfileRepositoryError) {
      logWebhookFailure(error.code, event.type);

      if (OWNERSHIP_ERROR_CODES.has(error.code)) {
        return errorResponse(
          500,
          "BILLING_OWNERSHIP_INVALID",
          "課金情報の所有関係を確認できませんでした。",
        );
      }

      return errorResponse(
        500,
        "DB_UPDATE_FAILED",
        "ユーザー情報の更新に失敗しました。",
      );
    }

    logWebhookFailure("STRIPE_WEBHOOK_PROCESSING_FAILED", event.type);
    return errorResponse(500, "INTERNAL_ERROR", "Webhook処理に失敗しました。");
  }
}
