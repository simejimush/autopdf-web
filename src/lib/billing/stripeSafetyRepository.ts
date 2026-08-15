import "server-only";

import {
  createStripeSafetyRepository,
  type StripeSafetyClient,
} from "@/lib/billing/stripeSafetyRepositoryCore";

export const stripeSafetyRepository = createStripeSafetyRepository(async () => {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin as unknown as StripeSafetyClient;
});
