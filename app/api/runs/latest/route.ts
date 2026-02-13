import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  // 直近のrunsを多めに取って、サーバー側で rule_id ごとに最新だけ残す
  const { data, error } = await supabaseAdmin
    .from("runs")
    .select("rule_id,status,finished_at,message,started_at")
    .order("started_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const latestByRule: Record<
    string,
    { status: string; finished_at: string | null; message: string | null; started_at: string | null }
  > = {};

  for (const r of data ?? []) {
    if (!latestByRule[r.rule_id]) {
      latestByRule[r.rule_id] = {
        status: r.status,
        finished_at: r.finished_at ?? null,
        message: r.message ?? null,
        started_at: r.started_at ?? null,
      };
    }
  }

  return NextResponse.json({ data: latestByRule }, { status: 200 });
}
