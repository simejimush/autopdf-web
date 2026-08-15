import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripeSafetyRepository } from "@/lib/billing/stripeSafetyRepository";
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
  return NextResponse.json({ ok: false, error_code, message }, { status });
}

export async function POST() {
  if (!secretKey || !priceId || !appUrl) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "決済設定を確認できませんでした。時間をおいて再度お試しください。",
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return errorResponse(401, "AUTH_REQUIRED", "ログインしてください。");
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("plan, billing_status, current_period_end")
    .eq("user_id", user.id)
    .single();

  if (profileError) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "契約情報を確認できませんでした。",
    );
  }

  const periodEnd = profile.current_period_end
    ? new Date(profile.current_period_end).getTime()
    : 0;
  if (
    (profile.plan === "pro" || profile.plan === "pro_plus") &&
    (profile.billing_status === "active" ||
      profile.billing_status === "trialing") &&
    periodEnd > Date.now()
  ) {
    return errorResponse(
      409,
      "STRIPE_ALREADY_SUBSCRIBED",
      "すでに有料プランを利用中です。",
    );
  }

  let claim;
  try {
    claim = await stripeSafetyRepository.claimCheckout(user.id);
  } catch {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "決済処理を開始できませんでした。",
    );
  }

  if (claim.disposition === "busy") {
    return errorResponse(
      409,
      "STRIPE_CHECKOUT_IN_PROGRESS",
      "決済処理中です。しばらく待ってから再度お試しください。",
    );
  }
  if (
    claim.disposition === "terminal_failed" ||
    claim.disposition === "owner_invalid"
  ) {
    return errorResponse(
      409,
      "STRIPE_CHECKOUT_BLOCKED",
      "決済状態を安全に確認できません。サポートへお問い合わせください。",
    );
  }

  const stripe = new Stripe(secretKey);

  if (claim.disposition === "session_ready" && claim.sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(claim.sessionId);
      if (
        session.client_reference_id === user.id &&
        session.mode === "subscription" &&
        session.status === "open" &&
        session.url
      ) {
        return NextResponse.json({ ok: true, url: session.url, reused: true });
      }
      if (session.status === "expired" && claim.attemptId) {
        await stripeSafetyRepository.expireCheckoutSession({
          userId: user.id,
          attemptId: claim.attemptId,
          sessionId: claim.sessionId,
        });
        return errorResponse(
          409,
          "STRIPE_CHECKOUT_SESSION_EXPIRED",
          "以前の決済画面は期限切れです。もう一度お試しください。",
        );
      }
    } catch {
      // The durable attempt remains fail-closed; do not create another Session.
    }
    return errorResponse(
      409,
      "STRIPE_CHECKOUT_BLOCKED",
      "既存の決済状態を安全に再利用できません。サポートへお問い合わせください。",
    );
  }

  if (claim.disposition !== "claimed" || !claim.attemptId) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "決済処理を開始できませんでした。",
    );
  }

  try {
    let customerId = claim.customerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: user.email ?? undefined,
          preferred_locales: ["ja"],
          metadata: { user_id: user.id },
        },
        { idempotencyKey: `autopdf_checkout_customer_${claim.attemptId}` },
      );
      customerId = customer.id;
      await stripeSafetyRepository.recordCheckoutCustomer({
        userId: user.id,
        attemptId: claim.attemptId,
        leaseHash: claim.leaseHash,
        customerId,
      });
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });
    if (
      subscriptions.data.some((subscription) =>
        BLOCKED_SUBSCRIPTION_STATUSES.has(subscription.status),
      )
    ) {
      await stripeSafetyRepository.failCheckout({
        userId: user.id,
        attemptId: claim.attemptId,
        leaseHash: claim.leaseHash,
        errorCode: "STRIPE_ALREADY_SUBSCRIBED",
        retryable: false,
      });
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
    const reusable = openSessions.data.find(
      (session) =>
        session.mode === "subscription" &&
        session.client_reference_id === user.id &&
        Boolean(session.url),
    );
    if (reusable?.url) {
      await stripeSafetyRepository.recordCheckoutSession({
        userId: user.id,
        attemptId: claim.attemptId,
        leaseHash: claim.leaseHash,
        sessionId: reusable.id,
      });
      return NextResponse.json({ ok: true, url: reusable.url, reused: true });
    }

    const baseUrl = normalizeAppUrl(appUrl);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        locale: "ja",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/billing/cancel`,
        client_reference_id: user.id,
        metadata: { user_id: user.id, plan: "pro" },
        subscription_data: { metadata: { user_id: user.id, plan: "pro" } },
      },
      { idempotencyKey: `autopdf_checkout_session_${claim.attemptId}` },
    );
    if (!session.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");

    await stripeSafetyRepository.recordCheckoutSession({
      userId: user.id,
      attemptId: claim.attemptId,
      leaseHash: claim.leaseHash,
      sessionId: session.id,
    });
    return NextResponse.json({ ok: true, url: session.url });
  } catch {
    await stripeSafetyRepository
      .failCheckout({
        userId: user.id,
        attemptId: claim.attemptId,
        leaseHash: claim.leaseHash,
        errorCode: "STRIPE_CHECKOUT_PROVIDER_AMBIGUOUS",
        retryable: true,
      })
      .catch(() => undefined);
    return errorResponse(
      503,
      "STRIPE_CHECKOUT_RETRYABLE",
      "決済サービスの結果を確認できませんでした。時間をおいて再度お試しください。",
    );
  }
}
