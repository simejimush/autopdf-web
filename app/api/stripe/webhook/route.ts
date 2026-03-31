import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(message: string, status = 500, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
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
      const plan = metadata.plan === "pro" ? "pro" : "free";

      if (!userId) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          plan,
          billing_provider: "stripe",
          billing_customer_id:
            typeof session.customer === "string" ? session.customer : null,
          billing_subscription_id:
            typeof session.subscription === "string"
              ? session.subscription
              : null,
          billing_status: "active",
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

      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : null;

      const billingStatus = subscription.status;
      const plan =
        billingStatus === "active" || billingStatus === "trialing"
          ? "pro"
          : "free";

      const currentPeriodEnd = subscription.items.data[0]?.current_period_end
        ? new Date(
            subscription.items.data[0].current_period_end * 1000,
          ).toISOString()
        : null;

      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          plan,
          billing_provider: "stripe",
          billing_customer_id: customerId,
          billing_subscription_id: subscription.id,
          billing_status: billingStatus,
          current_period_end: currentPeriodEnd,
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
