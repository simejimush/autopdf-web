import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripeSafetyRepository } from "@/lib/billing/stripeSafetyRepository";
import { createStripeWebhookProcessor } from "@/lib/billing/stripeWebhookCore";

export const runtime = "nodejs";

const processStripeWebhook = createStripeWebhookProcessor({
  createStripe: (secretKey) => new Stripe(secretKey),
  repository: stripeSafetyRepository,
});

export async function POST(request: NextRequest) {
  const result = await processStripeWebhook({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    signature: request.headers.get("stripe-signature"),
    readBody: () => request.text(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
