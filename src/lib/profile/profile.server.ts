import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveEffectivePlan } from "@/lib/billing/resolveEffectivePlan";

export type UserProfile = {
  user_id: string;
  display_name: string | null;
  company_name: string | null;
  industry: string | null;
  employee_size: string | null;
  marketing_opt_in: boolean;
  plan: "free" | "pro" | "pro_plus" | null;
  billing_status: string | null;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
};

const PROFILE_SELECT = `
  user_id,
  display_name,
  company_name,
  industry,
  employee_size,
  marketing_opt_in,
  plan,
  billing_status,
  billing_customer_id,
  billing_subscription_id,
  current_period_end,
  cancel_at_period_end
`;

export async function getOrCreateMyProfile(): Promise<
  UserProfile & { email: string | null }
> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Unauthorized");

  const email = user.email ?? null;

  const { data: existing, error: selErr } = await supabase
    .from("user_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();

  if (selErr) throw selErr;

  if (existing) {
    return {
      ...existing,
      plan: resolveEffectivePlan(existing),
      email,
    };
  }

  const { error: insErr } = await supabase.from("user_profiles").insert({
    user_id: user.id,
  });

  if (insErr) {
    // no-op
  }

  const { data: created, error: sel2Err } = await supabase
    .from("user_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", user.id)
    .single();

  if (sel2Err) throw sel2Err;

  return {
    ...created,
    plan: resolveEffectivePlan(created),
    email,
  };
}

export async function updateMyProfile(input: {
  display_name?: string | null;
  company_name?: string | null;
  industry?: string | null;
  employee_size?: string | null;
  marketing_opt_in?: boolean;
}): Promise<UserProfile & { email: string | null }> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Unauthorized");

  const email = user.email ?? null;

  const { data, error } = await supabase
    .from("user_profiles")
    .update({ ...input })
    .eq("user_id", user.id)
    .select(PROFILE_SELECT)
    .single();

  if (error) throw error;

  return {
    ...data,
    plan: resolveEffectivePlan(data),
    email,
  };
}
