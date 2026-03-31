// app/api/rules/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RULE_LIMIT_FREE = 3;

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

  // 🔹 plan取得
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return jsonError("Failed to load user profile", 500, profileError);
  }

  const plan = profile?.plan ?? "free";

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

  if (error) return jsonError("Failed to load rules", 500, error);

  return NextResponse.json({ data: data ?? [], plan }, { status: 200 });
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

  // 🔹 plan取得（POSTでも使う）
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("plan")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return jsonError("Failed to load user profile", 500, profileError);
  }

  const plan = profile?.plan ?? "free";

  const { count, error: countError } = await supabase
    .from("rules")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    return jsonError("Failed to count rules", 500, countError);
  }

  // 🔹 Freeだけ制限
  if (plan === "free" && (count ?? 0) >= RULE_LIMIT_FREE) {
    return NextResponse.json({ error: "RULE_LIMIT_EXCEEDED" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  console.log("POST /api/rules body", body);

  const drive_folder_id = String((body as any)?.drive_folder_id ?? "").trim();
  const gmail_query = (body as any)?.gmail_query
    ? String((body as any).gmail_query).trim()
    : null;
  const query_label = (body as any)?.query_label
    ? String((body as any).query_label).trim()
    : null;
  const run_timing = (body as any)?.run_timing
    ? String((body as any).run_timing).trim()
    : "manual";

  if (!drive_folder_id) {
    return jsonError("drive_folder_id is required", 400);
  }

  const insertRow = {
    user_id: user.id,
    drive_folder_id,
    gmail_query,
    query_label,
    subject_keywords: null,
    is_active: gmail_query ? Boolean((body as any)?.is_active) : false,
    run_timing,
  };

  console.log("POST /api/rules insertRow", insertRow);

  const { data, error } = await supabase
    .from("rules")
    .insert([insertRow])
    .select(
      "id, is_active, run_timing, drive_folder_id, gmail_query, query_label, updated_at",
    )
    .single();

  if (error || !data) {
    return jsonError("Failed to create rule", 500, error);
  }

  return NextResponse.json({ data }, { status: 201 });
}
