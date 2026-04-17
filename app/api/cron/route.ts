import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { executeRule } from "@/lib/runs/executeRule";

type RuleRow = {
  id: string;
  user_id?: string | null;
  is_enabled?: boolean | null;
  enabled?: boolean | null;
  is_active?: boolean | null;
};

type CronResultRow = {
  id: string;
  ok: boolean;
  runId?: string;
  error?: string;
  message?: string;
};

function isEnabledRule(rule: RuleRow): boolean {
  const value = rule.is_active ?? rule.is_enabled ?? rule.enabled;
  return value === undefined ? true : Boolean(value);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
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

  // 互換性優先で * 取得し、JS側で有効判定する
  const { data, error } = await supabaseAdmin.from("rules").select("*");

  if (error) {
    console.error("[cron] Failed to fetch rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch rules", detail: error.message },
      { status: 500 },
    );
  }

  const rules = (data ?? []) as RuleRow[];
  const enabledRules = rules.filter(isEnabledRule);

  console.log(
    "[cron] total rules:",
    rules.length,
    "enabled:",
    enabledRules.length,
  );

  let ok = 0;
  let ng = 0;

  const results: CronResultRow[] = [];

  for (const rule of enabledRules) {
    try {
      if (!rule.id || !rule.user_id) {
        ng++;
        console.error("[cron] Skip invalid rule row:", rule);
        results.push({
          id: rule.id ?? "(unknown)",
          ok: false,
          error: "Invalid rule row: missing id or user_id",
        });
        continue;
      }

      const startedAt = new Date().toISOString();

      const { data: run, error: runErr } = await supabaseAdmin
        .from("runs")
        .insert({
          user_id: rule.user_id,
          rule_id: rule.id,
          trigger: "cron",
          status: "running",
          processed_count: 0,
          saved_count: 0,
          skipped_count: 0,
          message: "Run started",
          started_at: startedAt,
        })
        .select("id")
        .single();

      if (runErr || !run) {
        ng++;
        console.error("[cron] Failed to create run:", rule.id, runErr);
        results.push({
          id: rule.id,
          ok: false,
          error: runErr?.message ?? "Failed to create run",
        });
        continue;
      }

      const result = await executeRule({
        ruleId: rule.id,
        userId: rule.user_id,
        runId: run.id,
        trigger: "cron",
      });

      if (result.ok) ok++;
      else ng++;

      console.log("[cron] rule done:", rule.id, "ok:", result.ok);

      results.push({
        id: rule.id,
        ok: result.ok,
        runId: run.id,
        message: result.message,
        ...(result.ok ? {} : { error: result.errorCode ?? "UNKNOWN" }),
      });
    } catch (error) {
      ng++;
      const message =
        error instanceof Error ? error.message : "Unknown cron error";

      console.error("[cron] rule failed:", rule.id, message);

      results.push({
        id: rule.id,
        ok: false,
        error: message,
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
