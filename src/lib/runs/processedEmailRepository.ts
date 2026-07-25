import "server-only";

import {
  createProcessedEmailRepository,
  type ProcessedEmailSupabaseClient,
} from "@/lib/runs/processedEmailRepositoryCore";

const processedEmailRepository = createProcessedEmailRepository({
  async getClient() {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return supabaseAdmin as unknown as ProcessedEmailSupabaseClient;
  },
  now: () => new Date().toISOString(),
});

export const recordProcessedEmail =
  processedEmailRepository.recordProcessedEmail;
