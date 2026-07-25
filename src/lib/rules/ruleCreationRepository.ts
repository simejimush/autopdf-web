import "server-only";

import {
  createRuleCreationRepository,
  type RuleCreationSupabaseClient,
} from "@/lib/rules/ruleCreationRepositoryCore";

const ruleCreationRepository = createRuleCreationRepository(async () => {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin as unknown as RuleCreationSupabaseClient;
});

export const createRuleForUser = ruleCreationRepository.createRuleForUser;
