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

export async function POST() {
  try {
    if (!secretKey) {
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "決済の初期設定に問題があります。時間をおいて再度お試しください。",
      );
    }

    if (!priceId) {
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "決済の初期設定に問題があります。時間をおいて再度お試しください。",
      );
    }

    if (!appUrl) {
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "アプリの初期設定に問題があります。時間をおいて再度お試しください。",
      );
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return errorResponse(401, "AUTH_REQUIRED", "ログインしてください。");
    }

    const { data: profile, error: profileErr } = await supabase
      .from("user_profiles")
      .select(
        "plan, billing_status, current_period_end, cancel_at_period_end, billing_customer_id, billing_provider",
      )
      .eq("user_id", user.id)
      .single();

    if (profileErr) {
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "契約情報の確認に失敗しました。時間をおいて再度お試しください。",
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
      return errorResponse(
        409,
        "STRIPE_ALREADY_SUBSCRIBED",
        "すでに有料プランをご利用中です。",
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
        return errorResponse(
          500,
          "INTERNAL_ERROR",
          "決済情報の保存に失敗しました。時間をおいて再度お試しください。",
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
      return errorResponse(
        409,
        "STRIPE_ALREADY_SUBSCRIBED",
        "すでに有効または処理中のサブスクリプションがあります。",
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
        {
          ok: true,
          url: reusableSession.url,
          reused: true,
        },
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
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "決済画面の作成に失敗しました。時間をおいて再度お試しください。",
      );
    }

    return NextResponse.json(
      {
        ok: true,
        url: session.url,
      },
      { status: 200 },
    );
  } catch {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "決済処理でエラーが発生しました。時間をおいて再度お試しください。",
    );
  }
}
