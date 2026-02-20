// app/api/rules/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function jsonError(message: string, status = 500, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ✅ runs を join しない（一覧を軽くする）
  const { data, error } = await supabase
    .from("rules")
    .select(
      `
      id,
      is_active,
      run_timing,
      drive_folder_id,
      gmail_query,
      updated_at
    `
    )
    .order("updated_at", { ascending: false });

  if (error) return jsonError("Failed to load rules", 500, error);
  return NextResponse.json({ data: data ?? [] }, { status: 200 });
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));

  const drive_folder_id = String(body?.drive_folder_id ?? "").trim();
  const subject_keywords = body?.subject_keywords ?? null;

  if (!drive_folder_id) return jsonError("drive_folder_id is required", 400);

  const insertRow: any = {
    user_id: user.id, // ★必須
    drive_folder_id,
    subject_keywords,
    gmail_label_id: "INBOX",
    unread_only: true,
    lookback_days: 7,
    is_active: true,
    run_timing: "manual",
  };

  const hasQuery =
    !!insertRow.gmail_query ||
    !!insertRow.gmail_label_id ||
    (Array.isArray(insertRow.subject_keywords) &&
      insertRow.subject_keywords.length > 0);

  if (!hasQuery || !insertRow.drive_folder_id) {
    insertRow.is_active = false;
  }

  const { data, error } = await supabase
    .from("rules")
    .insert([insertRow])
    .select(
      "id, is_active, run_timing, drive_folder_id, gmail_query, updated_at"
    )
    .single();

  if (error || !data) return jsonError("Failed to create rule", 500, error);

  return NextResponse.json({ data }, { status: 201 });
}
