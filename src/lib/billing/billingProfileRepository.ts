import "server-only";

import {
  createBillingProfileRepository,
  type BillingProfileSupabaseClient,
} from "@/lib/billing/billingProfileRepositoryCore";

const billingProfileRepository = createBillingProfileRepository(async () => {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin as unknown as BillingProfileSupabaseClient;
});

export const saveStripeCustomerReference =
  billingProfileRepository.saveStripeCustomerReference;
