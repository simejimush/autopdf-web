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

const GOOGLE_CONNECTION_HEALTH_SELECT = "id, user_id";

function isExpectedUpdatedRow(value: unknown, userId: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.user_id === userId;
}

function reportHealthUpdateFailure(): false {
  console.error("[monitoring] Google connection health update failed", {
    code: "GOOGLE_CONNECTION_HEALTH_UPDATE_FAILED",
    location: "update_google_connection_health",
  });
  return false;
}

export async function updateGoogleConnectionHealth(
  params: UpdateGoogleConnectionHealthParams,
): Promise<boolean> {
  const now = new Date().toISOString();
  let result: { data: unknown; error: unknown };

  try {
    if (params.event === "success") {
      result = await supabaseAdmin
        .from("google_connections")
        .update({
          last_success_at: now,
          reauth_required: false,
          last_error_code: null,
          updated_at: now,
        })
        .eq("user_id", params.userId)
        .select(GOOGLE_CONNECTION_HEALTH_SELECT);
    } else {
      const errorCode = params.errorCode ?? "UNKNOWN";
      const requiresReauth = REAUTH_REQUIRED_CODES.has(errorCode);

      result = await supabaseAdmin
        .from("google_connections")
        .update({
          last_error_at: now,
          last_error_code: errorCode,
          ...(requiresReauth ? { reauth_required: true } : {}),
          updated_at: now,
        })
        .eq("user_id", params.userId)
        .select(GOOGLE_CONNECTION_HEALTH_SELECT);
    }
  } catch {
    return reportHealthUpdateFailure();
  }

  if (
    result.error ||
    !Array.isArray(result.data) ||
    result.data.length !== 1 ||
    !isExpectedUpdatedRow(result.data[0], params.userId)
  ) {
    return reportHealthUpdateFailure();
  }

  return true;
}
