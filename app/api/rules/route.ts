// app/api/rules/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function jsonError(message: string, status = 500, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("rules")
    .select(
      `
    id,
    is_active,
    run_timing,
    drive_folder_id,
    gmail_query,
    updated_at,
    runs (
      id,
      status,
      message,
      error_code,
      started_at,
      finished_at,
      processed_count,
      saved_count
    )
  `
    )
    .order("started_at", { foreignTable: "runs", ascending: false })
    .limit(1, { foreignTable: "runs" })
    .order("updated_at", { ascending: false });

  if (error) return jsonError("Failed to load rules", 500, error);
  return NextResponse.json({ data: data ?? [] }, { status: 200 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));

  const drive_folder_id = String(body?.drive_folder_id ?? "").trim();
  const subject_keywords = body?.subject_keywords ?? null;

  if (!drive_folder_id) return jsonError("drive_folder_id is required", 400);

  // ※いまは service role で動かしてる前提の「MVP仕様」
  // user_id が必要なら、既存のあなたの実装に合わせてここを戻す
  const insertRow: any = {
    drive_folder_id,
    subject_keywords,
    gmail_label_id: "INBOX",
    unread_only: true,
    lookback_days: 7,
    is_active: true,
    run_timing: "manual",
  };

  // 未設定（⚠）なら is_active を強制 false
  const hasQuery =
    !!insertRow.gmail_query ||
    !!insertRow.gmail_label_id ||
    (Array.isArray(insertRow.subject_keywords) &&
      insertRow.subject_keywords.length > 0);

  if (!hasQuery || !insertRow.drive_folder_id) {
    insertRow.is_active = false;
  }

  const { data, error } = await supabaseAdmin
    .from("rules")
    .insert([insertRow])
    .select(
      "id, is_active, run_timing, drive_folder_id, gmail_query, updated_at"
    )
    .single();

  if (error || !data) return jsonError("Failed to create rule", 500, error);

  return NextResponse.json({ data }, { status: 201 });
}
