// autopdf-web/src/lib/profile/profile.server.ts
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UserProfile = {
  user_id: string;
  display_name: string | null;
  company_name: string | null;
  industry: string | null;
  employee_size: string | null;
  marketing_opt_in: boolean;
};

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

  // Try to read
  const { data: existing, error: selErr } = await supabase
    .from("user_profiles")
    .select(
      `
      user_id,
      display_name,
      company_name,
      industry,
      employee_size,
      marketing_opt_in
    `,
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (selErr) throw selErr;

  if (existing) {
    return { ...existing, email };
  }

  // Create if missing
  const { error: insErr } = await supabase.from("user_profiles").insert({
    user_id: user.id,
  });

  // If insert failed due to conflict, continue and re-select.
  if (insErr) {
    // no-op
  }

  const { data: created, error: sel2Err } = await supabase
    .from("user_profiles")
    .select(
      `
      user_id,
      display_name,
      company_name,
      industry,
      employee_size,
      marketing_opt_in
    `,
    )
    .eq("user_id", user.id)
    .single();

  if (sel2Err) throw sel2Err;

  return { ...created, email };
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
    .select(
      `
      user_id,
      display_name,
      company_name,
      industry,
      employee_size,
      marketing_opt_in
    `,
    )
    .single();

  if (error) throw error;

  return { ...data, email };
}
