import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isFreePlanOverflowRule } from "@/lib/rules/freePlanLimit";
import { resolveEffectivePlan } from "@/lib/billing/resolveEffectivePlan";
import { normalizeFileNameFormatForPlan } from "@/lib/rules/fileNameFormat";
import { normalizeRuleSubjectKeywords } from "@/lib/rules/ruleCreationRepositoryCore";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUBJECT_KEYWORDS_MAX_ITEMS = 100;
const SUBJECT_KEYWORDS_MAX_ITEM_LENGTH = 1_000;
const SUBJECT_KEYWORDS_MAX_NORMALIZED_LENGTH = 10_000;

function normalizeSubjectKeywordsUpdate(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };

  const parts = typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(parts) ||
    parts.length > SUBJECT_KEYWORDS_MAX_ITEMS ||
    parts.some(
      (part) =>
        typeof part !== "string" ||
        part.length > SUBJECT_KEYWORDS_MAX_ITEM_LENGTH,
    )
  ) {
    return { ok: false };
  }

  const normalized = normalizeRuleSubjectKeywords(parts);
  if (
    normalized !== null &&
    normalized.length > SUBJECT_KEYWORDS_MAX_NORMALIZED_LENGTH
  ) {
    return { ok: false };
  }

  return { ok: true, value: normalized };
}

function errorResponse(status: number, error_code: string, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error_code,
      message,
    },
    { status },
  );
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      error: errorResponse(401, "AUTH_REQUIRED", "ログインしてください。"),
    };
  }

  return { user, error: null };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id) return errorResponse(400, "INVALID_REQUEST", "idが必要です。");
  if (!UUID_RE.test(id))
    return errorResponse(400, "INVALID_REQUEST", "id形式が不正です。");

  const { user, error: authError } = await requireUser();
  if (authError || !user) return authError!;

  const { data, error } = await supabaseAdmin
    .from("rules")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return errorResponse(404, "NOT_FOUND", "ルールが見つかりません。");
  }

  return NextResponse.json({ ok: true, data }, { status: 200 });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id) return errorResponse(400, "INVALID_REQUEST", "idが必要です。");
  if (!UUID_RE.test(id))
    return errorResponse(400, "INVALID_REQUEST", "id形式が不正です。");

  const { user, error: authError } = await requireUser();
  if (authError || !user) return authError!;

  const rawBody: unknown = await req.json().catch(() => ({}));
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : {};

  const hasSubjectKeywordsUpdate = "subject_keywords" in body;
  const subjectKeywordsUpdate = hasSubjectKeywordsUpdate
    ? normalizeSubjectKeywordsUpdate(body.subject_keywords)
    : null;

  if (subjectKeywordsUpdate && !subjectKeywordsUpdate.ok) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "件名キーワードの形式が不正です。",
    );
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select("plan, billing_status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return errorResponse(
      500,
      "DB_READ_FAILED",
      "ユーザー情報の取得に失敗しました。",
    );
  }

  const plan = resolveEffectivePlan(profile);

  const update: Record<string, unknown> = {};
  if ("drive_folder_id" in body) update.drive_folder_id = body.drive_folder_id;
  if ("query_label" in body) update.query_label = body.query_label;
  if (subjectKeywordsUpdate?.ok)
    update.subject_keywords = subjectKeywordsUpdate.value;
  if ("gmail_query" in body) update.gmail_query = body.gmail_query;
  if ("gmail_label_id" in body) update.gmail_label_id = body.gmail_label_id;
  if ("is_active" in body) update.is_active = body.is_active;
  if ("run_timing" in body) update.run_timing = body.run_timing;
  if ("file_name_format" in body) {
    update.file_name_format = normalizeFileNameFormatForPlan(
      body.file_name_format,
      plan,
    );
  }

  const { data: current, error: currentErr } = await supabaseAdmin
    .from("rules")
    .select(
      "id, user_id, is_active, drive_folder_id, gmail_query, gmail_label_id, subject_keywords",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (currentErr || !current) {
    return errorResponse(404, "NOT_FOUND", "ルールが見つかりません。");
  }

  const merged = {
    drive_folder_id:
      "drive_folder_id" in update
        ? update.drive_folder_id
        : current.drive_folder_id,
    gmail_query:
      "gmail_query" in update ? update.gmail_query : current.gmail_query,
    gmail_label_id:
      "gmail_label_id" in update
        ? update.gmail_label_id
        : current.gmail_label_id,
    subject_keywords:
      "subject_keywords" in update
        ? update.subject_keywords
        : current.subject_keywords,
  };

  const normalizedKeywords: string[] = Array.isArray(merged.subject_keywords)
    ? merged.subject_keywords
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    : typeof merged.subject_keywords === "string"
      ? merged.subject_keywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const hasQuery =
    (typeof merged.gmail_query === "string" &&
      merged.gmail_query.trim().length > 0) ||
    (typeof merged.gmail_label_id === "string" &&
      merged.gmail_label_id.trim().length > 0) ||
    normalizedKeywords.length > 0;

  if (!("is_active" in body)) {
    if (!hasQuery || !merged.drive_folder_id) {
      update.is_active = false;
    } else {
      update.is_active = true;
    }
  }

  if (update.is_active === true) {
    const overflowCheck = await isFreePlanOverflowRule({
      userId: user.id,
      ruleId: current.id,
    });

    if (overflowCheck.isOverflow) {
      return errorResponse(
        403,
        "FREE_PLAN_RULE_LIMIT_EXCEEDED",
        "Freeプランでは有効化できるルールは3件までです。Proに戻すとこのルールをONにできます。",
      );
    }
  }

  if (Object.keys(update).length === 0) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "更新対象の項目がありません。",
    );
  }

  const { data, error } = await supabaseAdmin
    .from("rules")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error || !data) {
    return errorResponse(
      500,
      "DB_UPDATE_FAILED",
      "ルールの更新に失敗しました。",
    );
  }

  return NextResponse.json({ ok: true, data }, { status: 200 });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id) return errorResponse(400, "INVALID_REQUEST", "idが必要です。");
  if (!UUID_RE.test(id))
    return errorResponse(400, "INVALID_REQUEST", "id形式が不正です。");

  const { user, error: authError } = await requireUser();
  if (authError || !user) return authError!;

  const { data, error } = await supabaseAdmin
    .from("rules")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (error || !data) {
    return errorResponse(404, "NOT_FOUND", "ルールの削除に失敗しました。");
  }

  return NextResponse.json({ ok: true, deletedId: data.id }, { status: 200 });
}
