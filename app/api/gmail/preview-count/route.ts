import { NextResponse } from "next/server";
import { google } from "googleapis";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getOAuthClientForUser } from "@/lib/google/auth";
import { normalizeRunErrorCode } from "@/lib/runs/normalizeRunErrorCode";

export async function POST(req: Request) {
  try {
    // ===== 認証 =====
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    }

    // ===== 入力チェック =====
    const body = (await req.json().catch(() => null)) as {
      query?: unknown;
    } | null;

    const query = typeof body?.query === "string" ? body.query.trim() : "";

    if (!query) {
      return NextResponse.json({ error: "QUERY_REQUIRED" }, { status: 400 });
    }

    if (query.length > 500) {
      return NextResponse.json({ error: "QUERY_TOO_LONG" }, { status: 400 });
    }

    // ===== OAuthクライアント取得（←ここが重要） =====
    const oauth2Client = await getOAuthClientForUser(user.id);

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // ===== Gmail検索 =====
    const res = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
    });

    const count = res.data.messages?.length ?? 0;
    const overThreshold = count >= 100;

    return NextResponse.json({
      count,
      overThreshold,
      query,
    });
  } catch (error) {
    const errorCode = normalizeRunErrorCode(error);
    const authErrorCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null;

    // よくあるエラーを分類
    if (authErrorCode === "GOOGLE_CONNECTION_NOT_FOUND") {
      return NextResponse.json(
        { error: "GOOGLE_NOT_CONNECTED" },
        { status: 400 },
      );
    }

    if (authErrorCode === "GOOGLE_REFRESH_TOKEN_MISSING") {
      return NextResponse.json(
        { error: "GOOGLE_REFRESH_TOKEN_MISSING" },
        { status: 400 },
      );
    }

    if (
      authErrorCode === "GOOGLE_TOKEN_REFRESH_FAILED" ||
      errorCode === "GOOGLE_TOKEN_INVALID"
    ) {
      return NextResponse.json(
        { error: "GOOGLE_TOKEN_REFRESH_FAILED" },
        { status: 401 },
      );
    }

    console.error("[gmail.preview-count] failed", {
      code: errorCode,
      errorName: error instanceof Error ? error.name : "UnknownError",
      location: "gmail_preview_count",
    });

    return NextResponse.json(
      { error: "GMAIL_PREVIEW_FAILED" },
      { status: 500 },
    );
  }
}
