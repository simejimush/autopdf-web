import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { CRON_RULES_PER_SYSTEM_INVOCATION_LIMIT } from "@/lib/cost-safety/limits";
import {
  createGuardedExecutionRepository,
  type GuardedExecutionSupabaseClient,
} from "@/lib/runs/guardedExecutionRepositoryCore";

export type {
  CronCandidate,
  GuardedExecutionClaim,
} from "@/lib/runs/guardedExecutionRepositoryCore";

const repository = createGuardedExecutionRepository({
  async getClient() {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    return supabaseAdmin as unknown as GuardedExecutionSupabaseClient;
  },
  createLeaseIdHash: () =>
    createHash("sha256").update(randomBytes(32)).digest("hex"),
  cronCandidateLimit: CRON_RULES_PER_SYSTEM_INVOCATION_LIMIT,
});

export const claimGuardedExecution = repository.claimGuardedExecution;
export const finalizeGuardedExecution = repository.finalizeGuardedExecution;
export const listCronCandidates = repository.listCronCandidates;
