import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(message: string, status = 500, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
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
    return jsonError("STRIPE_SECRET_KEY is not set", 500);
  }

  if (!webhookSecret) {
    return jsonError("STRIPE_WEBHOOK_SECRET is not set", 500);
  }

  const stripe = new Stripe(secretKey);

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return jsonError("Missing stripe-signature header", 400);
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    return jsonError("Invalid Stripe webhook signature", 400, error);
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
        return jsonError("Failed to update user_profiles", 500, error);
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const cancelAtPeriodEnd = subscription.cancel_at_period_end;

      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : null;

      if (!customerId) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      const billingStatus = subscription.status;
      const currentPeriodEnd = getCurrentPeriodEndIso(subscription);
      console.log("STRIPE SUBSCRIPTION RAW", {
        subscriptionId: subscription.id,
        status: subscription.status,
        items: subscription.items.data,
        currentPeriodEnd,
      });
      const plan = resolvePlan(billingStatus, currentPeriodEnd);

      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          plan,
          billing_provider: "stripe",
          billing_customer_id: customerId,
          billing_subscription_id: subscription.id,
          billing_status: billingStatus,
          current_period_end: currentPeriodEnd,
          cancel_at_period_end: cancelAtPeriodEnd,
          plan_updated_at: new Date().toISOString(),
        })
        .eq("billing_customer_id", customerId);

      if (error) {
        return jsonError("Failed to update user_profiles", 500, error);
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    return jsonError("Webhook handling failed", 500, error);
  }
}
