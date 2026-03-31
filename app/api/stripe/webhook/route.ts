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
    if (
      event.type === "checkout.session.completed" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const object = event.data.object as Record<string, unknown>;

      const metadata =
        typeof object.metadata === "object" && object.metadata !== null
          ? (object.metadata as Record<string, string>)
          : {};

      const userId =
        typeof metadata.user_id === "string" ? metadata.user_id : null;

      if (!userId) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      let plan = "free";
      let billingStatus: string | null = null;
      let billingProvider = "stripe";
      let billingCustomerId: string | null = null;
      let billingSubscriptionId: string | null = null;
      let currentPeriodEnd: string | null = null;

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;

        billingStatus = "active";
        billingCustomerId =
          typeof session.customer === "string" ? session.customer : null;
        billingSubscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : null;
        plan = metadata.plan === "pro" ? "pro" : "free";
      }

      if (
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        const subscription = event.data.object as Stripe.Subscription;

        billingStatus = subscription.status;
        billingCustomerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : null;
        billingSubscriptionId = subscription.id;
        currentPeriodEnd = subscription.items.data[0]?.current_period_end
          ? new Date(
              subscription.items.data[0].current_period_end * 1000,
            ).toISOString()
          : null;

        if (
          subscription.status === "active" ||
          subscription.status === "trialing"
        ) {
          plan = "pro";
        } else {
          plan = "free";
        }
      }

      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update({
          plan,
          billing_provider: billingProvider,
          billing_customer_id: billingCustomerId,
          billing_subscription_id: billingSubscriptionId,
          billing_status: billingStatus,
          current_period_end: currentPeriodEnd,
          plan_updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (error) {
        return jsonError("Failed to update user_profiles", 500, error);
      }
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    return jsonError("Webhook handling failed", 500, error);
  }
}
