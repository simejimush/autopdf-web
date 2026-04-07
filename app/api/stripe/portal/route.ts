import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const secretKey = process.env.STRIPE_SECRET_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

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
        "請求管理の初期設定に問題があります。時間をおいて再度お試しください。",
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
      .select("billing_customer_id")
      .eq("user_id", user.id)
      .single();

    if (profileErr || !profile?.billing_customer_id) {
      return errorResponse(
        400,
        "STRIPE_CUSTOMER_NOT_FOUND",
        "請求情報が見つかりませんでした。",
      );
    }

    const stripe = new Stripe(secretKey);

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.billing_customer_id,
      return_url: `${appUrl}/billing`,
    });

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
      "請求管理ページの作成に失敗しました。時間をおいて再度お試しください。",
    );
  }
}
