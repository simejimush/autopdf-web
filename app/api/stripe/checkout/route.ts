import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const secretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRICE_ID_PRO;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

const BLOCKED_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
]);

function normalizeAppUrl(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function POST() {
  try {
    if (!secretKey) {
      return NextResponse.json(
        { error: "STRIPE_SECRET_KEY is not set" },
        { status: 500 },
      );
    }

    if (!priceId) {
      return NextResponse.json(
        { error: "STRIPE_PRICE_ID_PRO is not set" },
        { status: 500 },
      );
    }

    if (!appUrl) {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_APP_URL is not set" },
        { status: 500 },
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileErr } = await supabase
      .from("user_profiles")
      .select(
        "plan, billing_status, current_period_end, cancel_at_period_end, billing_customer_id, billing_provider",
      )
      .eq("user_id", user.id)
      .single();

    if (profileErr) {
      return NextResponse.json(
        { error: "Failed to load profile" },
        { status: 500 },
      );
    }

    const plan = profile?.plan ?? "free";
    const billingStatus = profile?.billing_status ?? null;
    const currentPeriodEnd = profile?.current_period_end
      ? new Date(profile.current_period_end)
      : null;
    const now = new Date();

    const isPaidPlan = plan === "pro" || plan === "pro_plus";
    const isSubscriptionActive =
      (billingStatus === "active" || billingStatus === "trialing") &&
      currentPeriodEnd !== null &&
      currentPeriodEnd.getTime() > now.getTime();

    if (isPaidPlan && isSubscriptionActive) {
      return NextResponse.json(
        {
          error: "ALREADY_SUBSCRIBED",
          message: "すでに有料プランをご利用中です。",
        },
        { status: 409 },
      );
    }

    const stripe = new Stripe(secretKey);

    let customerId = profile?.billing_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: {
          user_id: user.id,
        },
      });

      customerId = customer.id;

      const { error: updateCustomerErr } = await supabase
        .from("user_profiles")
        .update({
          billing_customer_id: customerId,
          billing_provider: "stripe",
        })
        .eq("user_id", user.id);

      if (updateCustomerErr) {
        return NextResponse.json(
          { error: "Failed to save Stripe customer" },
          { status: 500 },
        );
      }
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });

    const blockingSubscription = subscriptions.data.find((subscription) =>
      BLOCKED_SUBSCRIPTION_STATUSES.has(subscription.status),
    );

    if (blockingSubscription) {
      return NextResponse.json(
        {
          error: "ALREADY_SUBSCRIBED",
          message: "すでに有効または処理中のサブスクリプションがあります。",
        },
        { status: 409 },
      );
    }

    const openSessions = await stripe.checkout.sessions.list({
      customer: customerId,
      status: "open",
      limit: 10,
    });

    const reusableSession = openSessions.data.find(
      (session) => session.mode === "subscription" && !!session.url,
    );

    if (reusableSession?.url) {
      return NextResponse.json(
        { url: reusableSession.url, reused: true },
        { status: 200 },
      );
    }

    const baseUrl = normalizeAppUrl(appUrl);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing/cancel`,
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        plan: "pro",
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan: "pro",
        },
      },
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Failed to create checkout url" },
        { status: 500 },
      );
    }

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create Stripe checkout session" },
      { status: 500 },
    );
  }
}
