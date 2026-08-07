import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveEffectivePlan } from "@/lib/billing/resolveEffectivePlan";
import {
  createUserProfileRepository,
  UserProfileRepositoryError,
  type UserProfileRow,
  type UserProfileSupabaseClient,
  type UserProfileUpdateInput,
} from "@/lib/profile/profileRepositoryCore";

export type UserProfile = UserProfileRow;

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
  const repository = createUserProfileRepository(
    () => supabase as unknown as UserProfileSupabaseClient,
  );
  const existing = await repository.loadByUserId(user.id);

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

  const created = await repository.loadByUserId(user.id);
  if (!created) {
    throw new UserProfileRepositoryError("PROFILE_CREATE_FAILED");
  }
  // UNIQUE競合などでINSERTが失敗しても、同じowner rowを再取得できた場合だけ
  // signup trigger / concurrent createの成功として扱う。
  void insErr;

  return {
    ...created,
    plan: resolveEffectivePlan(created),
    email,
  };
}

export async function updateMyProfile(
  input: UserProfileUpdateInput,
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) throw new Error("Unauthorized");

  const repository = createUserProfileRepository(
    () => supabase as unknown as UserProfileSupabaseClient,
  );
  await repository.updateByUserId(user.id, input);
}
