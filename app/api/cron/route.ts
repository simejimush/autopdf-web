import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// 既存の「手動Run」処理を使い回す（重複実装しない）
import { POST as runRulePOST } from "@/app/api/rules/[id]/run/route";

type RuleRow = {
  id: string;
  // 有効フラグはプロジェクトにより名前が違う可能性があるので両対応
  is_enabled?: boolean | null;
  enabled?: boolean | null;
};

export async function GET(req: Request) {
// --- Auth guard ---
// Vercel Cron からの呼び出しはこのヘッダが付く（Cron Jobs）
const isVercelCron =
  req.headers.get("x-vercel-cron") === "1" ||
  req.headers.get("x-vercel-cron") === "true";

const auth = req.headers.get("authorization") ?? "";
const expected = process.env.CRON_SECRET
  ? `Bearer ${process.env.CRON_SECRET}`
  : "";

// Vercel Cron 以外（手動叩き等）は今まで通りシークレット必須
if (!isVercelCron) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron] CRON_SECRET is missing in env");
    return NextResponse.json(
      { error: "CRON_SECRET is missing in env" },
      { status: 500 },
    );
  }
  if (auth !== expected) {
    console.error("[cron] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

  console.log("[cron] Cron triggered");
  console.log("### NEW VERSION ###");

  // --- 1) rules を取得 ---
  // カラム名差異で詰まらないように、まずは * で取ってJS側でフィルタする
  const { data, error } = await supabaseAdmin.from("rules").select("*");

  if (error) {
    console.error("[cron] Failed to fetch rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch rules", detail: error.message },
      { status: 500 }
    );
  }

  const rules = (data ?? []) as RuleRow[];

  // --- 2) 有効ルールだけ抽出 ---
  // is_enabled があればそれ優先、なければ enabled、両方なければ「全部有効」として扱う
  const enabledRules = rules.filter((r) => {
    const v = (r as any).is_enabled ?? (r as any).enabled;
    return v === undefined ? true : Boolean(v);
  });

  console.log(
    "[cron] total rules:",
    rules.length,
    "enabled:",
    enabledRules.length
  );

  // --- 3) 逐次実行（安全優先） ---
  let ok = 0;
  let ng = 0;

  const results: Array<{ id: string; status: number; body?: any }> = [];

  for (const r of enabledRules) {
    const id = r.id;

    try {
      const res = await runRulePOST(
        new Request("http://internal", { method: "POST" }),
        { params: Promise.resolve({ id }) } as any
      );

      const status = (res as any).status ?? 200;

      let body: any = null;
      try {
        body = await (res as any).json?.();
      } catch {}

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
