import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RunHistoryRow = {
  id: string;
  status: string | null;
  trigger: string | null;
  message: string | null;
  error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
  processed_count: number | null;
  saved_count: number | null;
  skipped_count: number | null;
};

type LatestRunRow = {
  rule_id: string;
  status: string | null;
  trigger: string | null;
  message: string | null;
  error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
  processed_count: number | null;
  saved_count: number | null;
  skipped_count: number | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function toRunHistoryRows(value: unknown): RunHistoryRow[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isObject)
    .map((row) => ({
      id: typeof row.id === "string" ? row.id : "",
      status: toNullableString(row.status),
      trigger: toNullableString(row.trigger),
      message: toNullableString(row.message),
      error_code: toNullableString(row.error_code),
      started_at: toNullableString(row.started_at),
      finished_at: toNullableString(row.finished_at),
      processed_count: toNullableNumber(row.processed_count),
      saved_count: toNullableNumber(row.saved_count),
      skipped_count: toNullableNumber(row.skipped_count),
    }))
    .filter((row) => row.id !== "");
}

function toLatestRunRows(value: unknown): LatestRunRow[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(isObject)
    .map((row) => ({
      rule_id: typeof row.rule_id === "string" ? row.rule_id : "",
      status: toNullableString(row.status),
      trigger: toNullableString(row.trigger),
      message: toNullableString(row.message),
      error_code: toNullableString(row.error_code),
      started_at: toNullableString(row.started_at),
      finished_at: toNullableString(row.finished_at),
      processed_count: toNullableNumber(row.processed_count),
      saved_count: toNullableNumber(row.saved_count),
      skipped_count: toNullableNumber(row.skipped_count),
    }))
    .filter((row) => row.rule_id !== "");
}

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

    const items = toRunHistoryRows(data);

    return NextResponse.json({ items }, { status: 200 });
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

  const rows = toLatestRunRows(data);

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

  for (const r of rows) {
    if (!latestByRule[r.rule_id]) {
      latestByRule[r.rule_id] = {
        status: r.status,
        trigger: r.trigger,
        finished_at: r.finished_at,
        message: r.message,
        error_code: r.error_code,
        started_at: r.started_at,
        processed_count: r.processed_count,
        saved_count: r.saved_count,
        skipped_count: r.skipped_count,
      };
    }
  }

  return NextResponse.json({ data: latestByRule }, { status: 200 });
}
