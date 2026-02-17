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
  const url = new URL(req.url);

  // ✅ Vercel Cron からの呼び出し判定（secret無しでも許可）
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  // ?secret=xxx で呼ぶ方式（手動実行・外部Cron向け）
  const secret = url.searchParams.get("secret") ?? "";
  const expected = process.env.CRON_SECRET ?? "";

  // secret を使う運用の場合は env 必須（Vercel Cron だけで回すなら無くても動くが、手動実行が詰む）
  if (!expected && !isVercelCron) {
    console.error("[cron] CRON_SECRET is missing in env");
    return NextResponse.json(
      { error: "CRON_SECRET is missing in env" },
      { status: 500 }
    );
  }

  // ✅ Vercel Cron 以外は secret 必須
  if (!isVercelCron && secret !== expected) {
    console.error("[cron] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron] Cron triggered", { isVercelCron });
  console.log("### NEW VERSION ###");

  await supabaseAdmin.rpc("mark_stuck_runs", { p_minutes: 5 });

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

  console.log("[cron] total rules:", rules.length, "enabled:", enabledRules.length);

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
