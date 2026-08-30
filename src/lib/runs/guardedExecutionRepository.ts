import "server-only";

import { createHash, randomBytes } from "node:crypto";
import {
  createGuardedExecutionRepository,
  type GuardedExecutionSupabaseClient,
} from "@/lib/runs/guardedExecutionRepositoryCore";

export type { GuardedExecutionClaim } from "@/lib/runs/guardedExecutionRepositoryCore";

const repository = createGuardedExecutionRepository({
  async getClient() {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return supabaseAdmin as unknown as GuardedExecutionSupabaseClient;
  },
  now: () => new Date().toISOString(),
  createLeaseIdHash: () =>
    createHash("sha256").update(randomBytes(32)).digest("hex"),
});

export const claimGuardedExecution = repository.claimGuardedExecution;
export const finalizeGuardedExecution = repository.finalizeGuardedExecution;
