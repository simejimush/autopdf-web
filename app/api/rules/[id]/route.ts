// app/api/rules/[id]/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";


function jsonError(message: string, status = 500, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id) return jsonError("id is required", 400);

  const { data, error } = await supabaseAdmin
    .from("rules")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return jsonError("Rule not found", 404, error);

  return NextResponse.json({ data }, { status: 200 });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  if (!id) return jsonError("id is required", 400);

  const body = await req.json().catch(() => ({}) as any);

  // 更新を許可するフィールドだけ拾う（安全）
  const update: any = {};
  if ("drive_folder_id" in body) update.drive_folder_id = body.drive_folder_id;
  if ("subject_keywords" in body) update.subject_keywords = body.subject_keywords;
  if ("gmail_query" in body) update.gmail_query = body.gmail_query; // ★復活
  if ("gmail_label_id" in body) update.gmail_label_id = body.gmail_label_id; // ★追加
  if ("is_active" in body) update.is_active = body.is_active;
  if ("run_timing" in body) update.run_timing = body.run_timing;

  // 現在のDB状態を取得して、今回の更新とマージして「有効判定」する
  const { data: current, error: currentErr } = await supabaseAdmin
    .from("rules")
    .select(
      "id, is_active, drive_folder_id, gmail_query, gmail_label_id, subject_keywords",
    )
    .eq("id", id)
    .single();

  if (currentErr || !current) {
    return jsonError("Failed to load current rule", 500, currentErr);
  }

  // マージ後の値（今回送られてこない項目は current を使う）
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

  // subject_keywords を配列に正規化（textでもarrayでもOKにする）
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

  // 「検索条件があるか」判定（gmail_query / gmail_label_id / subject_keywords のどれか）
  const hasQuery =
    (typeof merged.gmail_query === "string" && merged.gmail_query.trim().length > 0) ||
    (typeof merged.gmail_label_id === "string" && merged.gmail_label_id.trim().length > 0) ||
    normalizedKeywords.length > 0;

  // body から subject_keywords が来てて、型が文字列だったら update 側も配列に揃える
  if ("subject_keywords" in update && typeof update.subject_keywords === "string") {
    update.subject_keywords = normalizedKeywords;
  }

  // 未設定なら強制OFF（ただし is_active を明示指定してるならそれを尊重）
  if (!("is_active" in body)) {
    if (!hasQuery || !merged.drive_folder_id) {
      update.is_active = false;
    } else {
      update.is_active = true;
    }
  }

  // 何も更新が無いなら 400
  if (Object.keys(update).length === 0) {
    return jsonError("No updatable fields provided", 400);
  }

  const { data, error } = await supabaseAdmin
    .from("rules")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) return jsonError("Failed to update rule", 500, error);

  return NextResponse.json({ data }, { status: 200 });
}
