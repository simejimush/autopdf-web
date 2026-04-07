import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(status: number, error_code: string, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error_code,
      message,
    },
    { status },
  );
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      error: errorResponse(401, "AUTH_REQUIRED", "ログインしてください。"),
    };
  }

  return { user, error: null };
}

export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireUser();
  if (authError || !user) return authError!;

  const ruleId = req.nextUrl.searchParams.get("ruleId")?.trim();

  // =========================
  // 履歴取得（ruleIdあり）
  // =========================
  if (ruleId) {
    if (!UUID_RE.test(ruleId)) {
      return errorResponse(400, "VALIDATION_ERROR", "ruleId形式が不正です。");
    }

    const { data, error } = await supabaseAdmin
      .from("runs")
      .select(
        [
          "id",
          "status",
          "message",
          "error_code",
          "started_at",
          "finished_at",
          "processed_count",
          "saved_count",
          "skipped_count",
        ].join(","),
      )
      .eq("user_id", user.id)
      .eq("rule_id", ruleId)
      .order("started_at", { ascending: false })
      .limit(5);

    if (error) {
      return errorResponse(
        500,
        "DB_READ_FAILED",
        "実行履歴の取得に失敗しました。",
      );
    }

    return NextResponse.json(
      {
        ok: true,
        data: data ?? [],
      },
      { status: 200 },
    );
  }

  // =========================
  // ルールごとの最新1件
  // =========================
  const { data, error } = await supabaseAdmin
    .from("runs")
    .select("rule_id,status,finished_at,message,started_at")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(500);

  if (error) {
    return errorResponse(
      500,
      "DB_READ_FAILED",
      "最新の実行結果の取得に失敗しました。",
    );
  }

  const latestByRule: Record<
    string,
    {
      status: string;
      finished_at: string | null;
      message: string | null;
      started_at: string | null;
    }
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

  return NextResponse.json(
    {
      ok: true,
      data: latestByRule,
    },
    { status: 200 },
  );
}
