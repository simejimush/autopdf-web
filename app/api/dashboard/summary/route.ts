import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rules } = await supabase
    .from("rules")
    .select("id")
    .eq("user_id", user.id);

  if (!rules || rules.length === 0) {
    return NextResponse.json({
      lastRunAt: null,
      processedTotal7d: 0,
      savedTotal7d: 0,
      errorCount7d: 0,
    });
  }

  const ruleIds = rules.map((r) => r.id);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: lastRun } = await supabase
    .from("runs")
    .select("finished_at")
    .in("rule_id", ruleIds)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: runs7d } = await supabase
    .from("runs")
    .select("status, processed_count, saved_count, finished_at")
    .in("rule_id", ruleIds)
    .gte("finished_at", since)
    .not("finished_at", "is", null)
    .limit(200);

  let processedTotal7d = 0;
  let savedTotal7d = 0;
  let errorCount7d = 0;

  for (const r of runs7d ?? []) {
    processedTotal7d += Number(r.processed_count ?? 0);
    savedTotal7d += Number(r.saved_count ?? 0);
    if (r.status === "error") errorCount7d += 1;
  }

  return NextResponse.json({
    lastRunAt: lastRun?.finished_at ?? null,
    processedTotal7d,
    savedTotal7d,
    errorCount7d,
  });
}
