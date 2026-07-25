import "server-only";

import {
  createManualRunRepository,
  type ManualRunSupabaseClient,
} from "@/lib/runs/manualRunRepositoryCore";

const manualRunRepository = createManualRunRepository({
  async getClient() {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return supabaseAdmin as unknown as ManualRunSupabaseClient;
  },
  now: () => new Date().toISOString(),
});

export const createManualRun = manualRunRepository.createManualRun;
