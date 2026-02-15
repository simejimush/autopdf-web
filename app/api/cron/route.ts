import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ✅ 既存の手動Run（/api/rules/[id]/run）を使い回す
import { POST as runRulePOST } from "@/app/api/rules/[id]/run/route";

export async function GET(req: Request) {
  // --- Auth guard (そのまま) ---
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;

  if (!process.env.CRON_SECRET) {
    console.error("[cron] CRON_SECRET is missing in env");
    return NextResponse.json(
      { error: "CRON_SECRET is missing in env" },
      { status: 500 }
    );
  }

  if (auth !== expected) {
    console.error("[cron] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron] Cron triggered");

  // --- 1) 有効なルール一覧取得 ---
  // ⚠ カラム名が違う場合はここだけ合わせて（例: enabled / is_enabled）
  const { data: rules, error } = await supabaseAdmin
    .from("rules")
    .select("id")
    .eq("is_enabled", true);

  if (error) {
    console.error("[cron] Failed to fetch rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch rules", detail: error.message },
      { status: 500 }
    );
  }

  const ids = (rules ?? []).map((r) => r.id);
  console.log("[cron] target rules:", ids.length);

  // --- 2) 1件ずつ実行（安全のため逐次） ---
  let ok = 0;
  let ng = 0;
  const results: Array<{ id: string; status: number; body?: any }> = [];

  for (const id of ids) {
    try {
      // run route の ctx.params は Promise なので合わせる
      const res = await runRulePOST(new Request("http://internal", { method: "POST" })
