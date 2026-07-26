import "server-only";

import {
  createStripeWebhookProfileRepository,
  type StripeWebhookProfileSupabaseClient,
} from "@/lib/billing/stripeWebhookProfileRepositoryCore";

const stripeWebhookProfileRepository = createStripeWebhookProfileRepository(
  async () => {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return supabaseAdmin as unknown as StripeWebhookProfileSupabaseClient;
  },
);

export const { resolveStripeWebhookProfileOwner, updateStripeWebhookProfile } =
  stripeWebhookProfileRepository;
