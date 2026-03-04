// autopdf-web/app/api/cron/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type RuleRow = {
  id: string;
  // 有効フラグはプロジェクトにより名前が違う可能性があるので両対応
  is_enabled?: boolean | null;
  enabled?: boolean | null;
  is_active?: boolean | null;
};

export async function GET(req: Request) {
  // --- Auth guard（ブラウザ直叩き対策 & Vercel Cron用）---
  const url = new URL(req.url);

  // ?secret=xxx で呼ぶ方式（VercelのCronで設定しやすい）
  const secret = url.searchParams.get("secret") ?? "";
  const expected = process.env.CRON_SECRET ?? "";

  if (!expected) {
    console.error("[cron] CRON_SECRET is missing in env");
    return NextResponse.json(
      { error: "CRON_SECRET is missing in env" },
      { status: 500 },
    );
  }

  if (secret !== expected) {
    console.error("[cron] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron] Cron triggered");
  console.log("### NEW VERSION (fetch /api/rules/:id/run) ###");

  // --- 1) rules を取得 ---
  // カラム名差異で詰まらないように、まずは * で取ってJS側でフィルタする
  const { data, error } = await supabaseAdmin.from("rules").select("*");

  if (error) {
    console.error("[cron] Failed to fetch rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch rules", detail: error.message },
      { status: 500 },
    );
  }

  const rules = (data ?? []) as RuleRow[];

  // --- 2) 有効ルールだけ抽出 ---
  // 優先順: is_active -> is_enabled -> enabled -> (未定義なら有効扱い)
  const enabledRules = rules.filter((r) => {
    const v =
      (r as any).is_active ?? (r as any).is_enabled ?? (r as any).enabled;

    return v === undefined ? true : Boolean(v);
  });

  console.log(
    "[cron] total rules:",
    rules.length,
    "enabled:",
    enabledRules.length,
  );

  // --- 3) 逐次実行（安全優先） ---
  let ok = 0;
  let ng = 0;

  const results: Array<{ id: string; status: number; body?: any }> = [];

  // デプロイ先の origin を使って内部APIを叩く
  const origin = url.origin;

  for (const r of enabledRules) {
    const id = r.id;

    try {
      const runRes = await fetch(`${origin}/api/rules/${id}/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // run側が cron secret を受け付ける実装なら、ここで渡す
          "x-cron-secret": expected,
        },
        body: JSON.stringify({ trigger: "cron" }),
        cache: "no-store",
      });

      const status = runRes.status;

      let body: any = null;
      try {
        body = await runRes.json();
      } catch {
        body = null;
      }

      if (status >= 200 && status < 300) ok++;
      else ng++;

      console.log("[cron] rule done:", id, "status:", status);
      results.push({ id, status, body });
    } catch (e: any) {
      ng++;
      console.error("[cron] rule failed:", id, e?.message ?? e);
      results.push({
        id,
        status: 500,
        body: { error: e?.message ?? String(e) },
      });
    }
  }

  return NextResponse.json({
    message: "Cron finished",
    total_rules: rules.length,
    enabled_rules: enabledRules.length,
    ok,
    ng,
    results,
  });
}
