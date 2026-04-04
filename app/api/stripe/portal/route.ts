import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const secretKey = process.env.STRIPE_SECRET_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

export async function POST() {
  try {
    if (!secretKey) {
      return NextResponse.json(
        { error: "STRIPE_SECRET_KEY is not set" },
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
      .select("billing_customer_id")
      .eq("user_id", user.id)
      .single();

    if (profileErr || !profile?.billing_customer_id) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 400 },
      );
    }

    const stripe = new Stripe(secretKey);

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.billing_customer_id,
      return_url: `${appUrl}/billing`,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create portal session", details: error },
      { status: 500 },
    );
  }
}
