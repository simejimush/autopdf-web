import { supabaseAdmin } from "@/lib/supabase/admin";

export const FREE_PLAN_RULE_LIMIT = 3;

type Plan = "free" | "pro" | "pro_plus";

type RuleForLimit = {
  id: string;
  user_id: string | null;
  created_at: string | null;
};

function normalizePlan(plan: unknown): Plan {
  if (plan === "pro" || plan === "pro_plus") {
    return plan;
  }

  return "free";
}

export async function getUserPlan(userId: string): Promise<Plan> {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to fetch user plan");
  }

  return normalizePlan(data?.plan);
}

export async function canCreateMoreRules(userId: string): Promise<{
  ok: boolean;
  plan: Plan;
  ruleCount: number;
  limit: number | null;
}> {
  const plan = await getUserPlan(userId);

  if (plan !== "free") {
    return {
      ok: true,
      plan,
      ruleCount: 0,
      limit: null,
    };
  }

  const { count, error } = await supabaseAdmin
    .from("rules")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    throw new Error("Failed to count rules");
  }

  const ruleCount = count ?? 0;

  return {
    ok: ruleCount < FREE_PLAN_RULE_LIMIT,
    plan,
    ruleCount,
    limit: FREE_PLAN_RULE_LIMIT,
  };
}

export async function getFreePlanOverflowRuleIds(
  userId: string,
): Promise<string[]> {
  const plan = await getUserPlan(userId);

  if (plan !== "free") {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("rules")
    .select("id, user_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error("Failed to fetch rules for free plan limit");
  }

  const rules = (data ?? []) as RuleForLimit[];

  return rules.slice(FREE_PLAN_RULE_LIMIT).map((rule) => rule.id);
}

export async function isFreePlanOverflowRule({
  userId,
  ruleId,
}: {
  userId: string;
  ruleId: string;
}): Promise<{
  isOverflow: boolean;
  overflowRuleIds: string[];
}> {
  const overflowRuleIds = await getFreePlanOverflowRuleIds(userId);

  return {
    isOverflow: overflowRuleIds.includes(ruleId),
    overflowRuleIds,
  };
}

export async function disableFreePlanOverflowRules(userId: string): Promise<{
  ok: boolean;
  disabledCount: number;
}> {
  const overflowRuleIds = await getFreePlanOverflowRuleIds(userId);

  if (overflowRuleIds.length === 0) {
    return {
      ok: true,
      disabledCount: 0,
    };
  }

  const { error } = await supabaseAdmin
    .from("rules")
    .update({
      is_enabled: false,
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .in("id", overflowRuleIds);

  if (error) {
    return {
      ok: false,
      disabledCount: 0,
    };
  }

  return {
    ok: true,
    disabledCount: overflowRuleIds.length,
  };
}
