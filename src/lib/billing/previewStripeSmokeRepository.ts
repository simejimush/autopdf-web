import "server-only";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASELINE_SELECT = "user_id, billing_last_event_created_at" as const;

type BaselineResult = Readonly<{ data: unknown; error: unknown }>;

export async function loadPreviewStripeSmokeBaseline(userId: string) {
  if (!UUID_PATTERN.test(userId)) {
    throw new Error("PREVIEW_SMOKE_BASELINE_INPUT_INVALID");
  }
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  let result: BaselineResult;
  try {
    result = await supabaseAdmin
      .from("user_profiles")
      .select(BASELINE_SELECT)
      .eq("user_id", userId)
      .maybeSingle();
  } catch {
    throw new Error("PREVIEW_SMOKE_BASELINE_READ_FAILED");
  }
  if (result.error || !result.data || typeof result.data !== "object") {
    throw new Error("PREVIEW_SMOKE_BASELINE_READ_FAILED");
  }
  const row = result.data as Record<string, unknown>;
  if (
    row.user_id !== userId ||
    typeof row.billing_last_event_created_at !== "string" ||
    !Number.isFinite(Date.parse(row.billing_last_event_created_at))
  ) {
    throw new Error("PREVIEW_SMOKE_BASELINE_READ_FAILED");
  }
  return row.billing_last_event_created_at;
}
