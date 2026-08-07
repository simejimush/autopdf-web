import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveEffectivePlan } from "@/lib/billing/resolveEffectivePlan";
import { normalizeFileNameFormatForPlan } from "@/lib/rules/fileNameFormat";
import { createRuleForUser } from "@/lib/rules/ruleCreationRepository";
import { normalizeRuleSubjectKeywords } from "@/lib/rules/ruleCreationRepositoryCore";

const RULE_LIMIT_FREE = 3;

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

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return errorResponse(401, "AUTH_REQUIRED", "ログインしてください。");
  }

  const { data: profile, error: profileError } = await supabase
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

  const { data, error } = await supabase
    .from("rules")
    .select(
      `
      id,
      is_active,
      run_timing,
      drive_folder_id,
      gmail_query,
      query_label,
      updated_at
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    return errorResponse(
      500,
      "DB_READ_FAILED",
      "ルール一覧の取得に失敗しました。",
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: data ?? [],
      plan,
    },
    { status: 200 },
  );
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return errorResponse(401, "AUTH_REQUIRED", "ログインしてください。");
  }

  const { data: profile, error: profileError } = await supabase
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

  const { count, error: countError } = await supabase
    .from("rules")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    return errorResponse(
      500,
      "DB_READ_FAILED",
      "ルール数の確認に失敗しました。",
    );
  }

  if (plan === "free" && (count ?? 0) >= RULE_LIMIT_FREE) {
    return errorResponse(
      403,
      "RULE_LIMIT_EXCEEDED",
      "Freeプランではルールは3件までです。",
    );
  }

  const rawBody: unknown = await req.json().catch(() => ({}));
  const body =
    rawBody && typeof rawBody === "object"
      ? (rawBody as Record<string, unknown>)
      : {};

  const drive_folder_id = String(body.drive_folder_id ?? "").trim();
  const gmail_query = body.gmail_query ? String(body.gmail_query).trim() : null;
  const query_label = body.query_label ? String(body.query_label).trim() : null;
  const run_timing = body.run_timing
    ? String(body.run_timing).trim()
    : "manual";
  const subject_keywords = normalizeRuleSubjectKeywords(body.subject_keywords);

  const file_name_format = normalizeFileNameFormatForPlan(
    body.file_name_format,
    plan,
  );

  if (!drive_folder_id) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "保存先フォルダIDは必須です。",
    );
  }

  let data;
  try {
    data = await createRuleForUser({
      userId: user.id,
      values: {
        driveFolderId: drive_folder_id,
        gmailQuery: gmail_query,
        queryLabel: query_label,
        subjectKeywords: subject_keywords,
        fileNameFormat: file_name_format,
        isActive: gmail_query ? Boolean(body.is_active) : false,
        runTiming: run_timing,
      },
    });
  } catch {
    return errorResponse(
      500,
      "DB_INSERT_FAILED",
      "ルールの作成に失敗しました。",
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data,
    },
    { status: 201 },
  );
}
