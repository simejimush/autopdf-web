import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const ruleId = req.nextUrl.searchParams.get("ruleId")?.trim();

  // =========================
  // 🔹 履歴取得モード
  // =========================
  if (ruleId) {
    if (!UUID_RE.test(ruleId)) {
      return NextResponse.json({ error: "Invalid ruleId" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("runs")
      .select(
        [
          "id",
          "status",
          "trigger",
          "message",
          "error_code",
          "started_at",
          "finished_at",
          "processed_count",
          "saved_count",
          "skipped_count",
        ].join(","),
      )
      .eq("rule_id", ruleId)
      .order("started_at", { ascending: false })
      .limit(5);

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to load runs" },
        { status: 500 },
      );
    }

    return NextResponse.json({ items: data ?? [] }, { status: 200 });
  }

  // =========================
  // 🔹 ルール一覧用：最新1件まとめ
  // =========================
  const { data, error } = await supabaseAdmin
    .from("runs")
    .select(
      [
        "rule_id",
        "status",
        "trigger",
        "message",
        "error_code",
        "started_at",
        "finished_at",
        "processed_count",
        "saved_count",
        "skipped_count",
      ].join(","),
    )
    .order("started_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const latestByRule: Record<
    string,
    {
      status: string | null;
      trigger: string | null;
      finished_at: string | null;
      message: string | null;
      error_code: string | null;
      started_at: string | null;
      processed_count: number | null;
      saved_count: number | null;
      skipped_count: number | null;
    }
  > = {};

  for (const r of data ?? []) {
    if (!latestByRule[r.rule_id]) {
      latestByRule[r.rule_id] = {
        status: r.status ?? null,
        trigger: r.trigger ?? null,
        finished_at: r.finished_at ?? null,
        message: r.message ?? null,
        error_code: r.error_code ?? null,
        started_at: r.started_at ?? null,
        processed_count: r.processed_count ?? null,
        saved_count: r.saved_count ?? null,
        skipped_count: r.skipped_count ?? null,
      };
    }
  }

  return NextResponse.json({ data: latestByRule }, { status: 200 });
}
