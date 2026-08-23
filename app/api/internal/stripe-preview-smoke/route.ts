import { NextResponse } from "next/server";

import {
  PreviewStripeSmokeError,
  type PreviewStripeSmokeProfile,
} from "@/lib/billing/previewStripeRuntimeSmokeCore";
import {
  createPreviewStripeSmokeRoute,
  type PreviewSmokeEnvironment,
} from "@/lib/billing/previewStripeSmokeRouteCore";
import { createStripeWebhookProcessor } from "@/lib/billing/stripeWebhookCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = Object.freeze({ "Cache-Control": "no-store" });
const PROFILE_SELECT =
  "user_id, billing_provider, billing_customer_id, billing_subscription_id, plan, billing_status, current_period_end, cancel_at_period_end" as const;

type ProfileReadResult = Readonly<{ data: unknown; error: unknown }>;
type ProfileClient = Readonly<{
  from(table: "user_profiles"): Readonly<{
    select(columns: typeof PROFILE_SELECT): Readonly<{
      eq(
        column: "user_id",
        value: string,
      ): Readonly<{ maybeSingle(): PromiseLike<ProfileReadResult> }>;
    }>;
  }>;
}>;

function json(body: Readonly<Record<string, unknown>>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isProfile(value: unknown): value is PreviewStripeSmokeProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.user_id === "string" &&
    isNullableString(row.billing_customer_id) &&
    isNullableString(row.billing_subscription_id) &&
    isNullableString(row.billing_provider) &&
    isNullableString(row.plan) &&
    isNullableString(row.billing_status) &&
    isNullableString(row.current_period_end) &&
    (row.cancel_at_period_end === null ||
      typeof row.cancel_at_period_end === "boolean")
  );
}

async function loadOwnProfile(client: ProfileClient, userId: string) {
  const result = await client
    .from("user_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", userId)
    .maybeSingle();
  if (
    result.error ||
    !isProfile(result.data) ||
    result.data.user_id !== userId
  ) {
    throw new PreviewStripeSmokeError("PREVIEW_SMOKE_PROFILE_READ_FAILED");
  }
  return result.data;
}

export async function POST(request: Request) {
  let supabase: Awaited<
    ReturnType<
      (typeof import("@/lib/supabase/server"))["createSupabaseServerClient"]
    >
  > | null = null;
  let userId = "";
  const handle = createPreviewStripeSmokeRoute({
    async authenticate() {
      const { createSupabaseServerClient } =
        await import("@/lib/supabase/server");
      supabase = await createSupabaseServerClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) return { ok: false } as const;
      userId = user.id;
      const profile = await loadOwnProfile(
        supabase as unknown as ProfileClient,
        userId,
      );
      return {
        ok: true,
        userId,
        profile,
        loadProfileAfter: () =>
          loadOwnProfile(supabase as unknown as ProfileClient, userId),
      } as const;
    },
    async createExecution(secretKey) {
      const [
        { default: Stripe },
        { stripeSafetyRepository },
        { loadPreviewStripeSmokeBaseline },
      ] = await Promise.all([
        import("stripe"),
        import("@/lib/billing/stripeSafetyRepository"),
        import("@/lib/billing/previewStripeSmokeRepository"),
      ]);
      return {
        provider: new Stripe(secretKey),
        loadBaselineCreatedAt: loadPreviewStripeSmokeBaseline,
        processWebhook: (request) =>
          createStripeWebhookProcessor({
            createStripe: (key) => new Stripe(key),
            repository: stripeSafetyRepository,
          })({
            secretKey: request.secretKey,
            webhookSecret: request.webhookSecret,
            signature: request.signature,
            readBody: async () => request.body,
          }),
      };
    },
  });
  const result = await handle({
    requestUrl: request.url,
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
    fetchMode: request.headers.get("sec-fetch-mode"),
    environment: process.env as PreviewSmokeEnvironment,
  });
  return json(result.body, result.status);
}
