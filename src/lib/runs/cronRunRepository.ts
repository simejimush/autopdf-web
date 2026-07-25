import "server-only";

import {
  createCronRunRepository,
  type CronRunSupabaseClient,
} from "@/lib/runs/cronRunRepositoryCore";

const cronRunRepository = createCronRunRepository({
  async getClient() {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return supabaseAdmin as unknown as CronRunSupabaseClient;
  },
  now: () => new Date().toISOString(),
});

export const createCronRun = cronRunRepository.createCronRun;
