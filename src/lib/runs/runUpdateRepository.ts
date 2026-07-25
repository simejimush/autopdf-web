import "server-only";

import {
  createRunUpdateRepository,
  type RunUpdateSupabaseClient,
} from "@/lib/runs/runUpdateRepositoryCore";

const runUpdateRepository = createRunUpdateRepository({
  async getClient() {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return supabaseAdmin as unknown as RunUpdateSupabaseClient;
  },
  now: () => new Date().toISOString(),
});

export const finalizeRunForUser = runUpdateRepository.finalizeRunForUser;
