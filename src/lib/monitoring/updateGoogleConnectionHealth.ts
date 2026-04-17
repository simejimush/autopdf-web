import { supabaseAdmin } from "@/lib/supabase/admin";

type UpdateGoogleConnectionHealthParams = {
  userId: string;
  event: "success" | "error";
  errorCode?: string | null;
};

const REAUTH_REQUIRED_CODES = new Set([
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_PERMISSION_DENIED",
]);

export async function updateGoogleConnectionHealth(
  params: UpdateGoogleConnectionHealthParams,
): Promise<void> {
  const now = new Date().toISOString();

  if (params.event === "success") {
    await supabaseAdmin
      .from("google_connections")
      .update({
        last_success_at: now,
        reauth_required: false,
        last_error_code: null,
        updated_at: now,
      })
      .eq("user_id", params.userId);

    return;
  }

  const errorCode = params.errorCode ?? "UNKNOWN";
  const requiresReauth = REAUTH_REQUIRED_CODES.has(errorCode);

  await supabaseAdmin
    .from("google_connections")
    .update({
      last_error_at: now,
      last_error_code: errorCode,
      ...(requiresReauth ? { reauth_required: true } : {}),
      updated_at: now,
    })
    .eq("user_id", params.userId);
}
