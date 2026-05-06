import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { canCreateMoreRules } from "@/lib/rules/freePlanLimit";

function errorResponse(status: number, error_code: string, message: string) {
  return NextResponse.json({ ok: false, error_code, message }, { status });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return errorResponse(401, "AUTH_REQUIRED", "ログインしてください。");
  }

  // 元ルール取得
  const { data: original, error: fetchErr } = await supabaseAdmin
    .from("rules")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !original) {
    return errorResponse(404, "RULE_NOT_FOUND", "ルールが見つかりません。");
  }

  const createCheck = await canCreateMoreRules(user.id);

  if (!createCheck.ok) {
    return errorResponse(
      403,
      "FREE_PLAN_RULE_LIMIT_EXCEEDED",
      "Freeプランではルールを3件まで作成できます。コピーするにはProにアップグレードしてください。",
    );
  }

  // タイトル生成
  const newLabel = original.query_label
    ? `${original.query_label}のコピー`
    : "コピーしたルール";

  // 複製
  const { data, error } = await supabaseAdmin
    .from("rules")
    .insert([
      {
        user_id: user.id,
        drive_folder_id: original.drive_folder_id,
        gmail_query: original.gmail_query,
        query_label: newLabel,
        subject_keywords: original.subject_keywords,
        is_active: false,
        run_timing: original.run_timing,
      },
    ])
    .select("*")
    .single();

  if (error || !data) {
    return errorResponse(
      500,
      "DB_INSERT_FAILED",
      "ルールの複製に失敗しました。",
    );
  }

  return NextResponse.json({ ok: true, data }, { status: 201 });
}
