// profile.server.ts - add your code below
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

export async function getOrCreateMyProfile(): Promise<UserProfile> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Unauthorized");

  // まず取得
  const { data: existing, error: selErr } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, company_name, industry, employee_size, marketing_opt_in")
    .eq("user_id", user.id)
    .maybeSingle();

  if (selErr) throw selErr;
  if (existing) return existing as UserProfile;

  // 無ければ作成（バックフィル不要）
  const { error: insErr } = await supabase.from("user_profiles").insert({
    user_id: user.id,
  });

  // on conflict が supabase-js insert だと扱いづらいので、
  // ここは「存在しないはず」前提。万一競合しても次のselectで回収。
  if (insErr) {
    // 競合や一時エラーを吸収して再取得
    // (RLS/制約系はここで落ちる)
  }

  const { data: created, error: sel2Err } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, company_name, industry, employee_size, marketing_opt_in")
    .eq("user_id", user.id)
    .single();

  if (sel2Err) throw sel2Err;
  return created as UserProfile;
}

export async function updateMyProfile(input: {
  display_name?: string | null;
  company_name?: string | null;
  industry?: string | null;
  employee_size?: string | null;
  marketing_opt_in?: boolean;
}): Promise<UserProfile> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Unauthorized");

  const { data, error } = await supabase
    .from("user_profiles")
    .update({
      ...input,
    })
    .eq("user_id", user.id)
    .select("user_id, display_name, company_name, industry, employee_size, marketing_opt_in")
    .single();

  if (error) throw error;
  return data as UserProfile;
}
