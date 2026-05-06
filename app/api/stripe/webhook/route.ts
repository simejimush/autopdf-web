import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { disableFreePlanOverflowRules } from "@/lib/rules/freePlanLimit";

export const runtime = "nodejs";

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

      const metadata = session.metadata ?? {};
      const userId =
        typeof metadata.user_id === "string" ? metadata.user_id : null;

      if (!userId) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      const customerId =
        typeof session.customer === "string" ? session.customer : null;
      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : null;

      let billingStatus: string | null = "active";
      let currentPeriodEnd: string | null = null;

      if (subscriptionId) {
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        billingStatus = subscription.status;
        currentPeriodEnd = getCurrentPeriodEndIso(subscription);
      }

      const plan = resolvePlan(billingStatus, currentPeriodEnd);

      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          plan,
          billing_provider: "stripe",
          billing_customer_id: customerId,
          billing_subscription_id: subscriptionId,
          billing_status: billingStatus,
          current_period_end: currentPeriodEnd,
          plan_updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) {
        return errorResponse(
          500,
          "DB_UPDATE_FAILED",
          "ユーザー情報の更新に失敗しました。",
        );
      }
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

      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : null;

      if (!customerId) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      const billingStatus = subscription.status;
      const currentPeriodEnd = getCurrentPeriodEndIso(subscription);
      const plan = resolvePlan(billingStatus, currentPeriodEnd);

      const { data: profile, error: profileError } = await supabaseAdmin
        .from("user_profiles")
        .select("user_id")
        .eq("billing_customer_id", customerId)
        .maybeSingle();

      if (profileError) {
        return errorResponse(
          500,
          "DB_UPDATE_FAILED",
          "ユーザー情報の取得に失敗しました。",
        );
      }

      if (!profile?.user_id) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      const userId = profile.user_id;

      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          plan,
          billing_provider: "stripe",
          billing_customer_id: customerId,
          billing_subscription_id: subscription.id,
          billing_status: billingStatus,
          current_period_end: currentPeriodEnd,
          cancel_at_period_end: subscription.cancel_at_period_end,
          plan_updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) {
        return errorResponse(
          500,
          "DB_UPDATE_FAILED",
          "ユーザー情報の更新に失敗しました。",
        );
      }

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
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Webhook処理に失敗しました。");
  }
}
