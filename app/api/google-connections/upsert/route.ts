// app/api/google-connections/upsert/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 1) cookie セッションからログインユーザー取得
  const supabase = await createSupabaseServerClient();
  const { data: userRes, error: userErr } = await supabase.auth.getUser();

  if (userErr || !userRes?.user) {
    return NextResponse.json(
      { ok: false, step: "getUser", error: userErr?.message ?? "Auth session missing" },
      { status: 401 },
    );
  }

  // 2) body 取得（user_id は絶対に受け取らない）
  const body = await req.json().catch(() => ({}));
  const { provider_token, provider_refresh_token, expires_at, scopes } = body ?? {};

  if (!provider_refresh_token) {
    return NextResponse.json(
      { ok: false, step: "need_refresh_token", message: "provider_refresh_token is empty" },
      { status: 400 },
    );
  }

  // 3) google_connections を upsert（RLSで user_id=auth.uid() のみ許可）
  const { error: upsertErr } = await supabase
    .from("google_connections")
    .upsert(
      {
        user_id: userRes.user.id,
        status: "connected",
        access_token_enc: provider_token ?? null,
        refresh_token_enc: provider_refresh_token,
        token_expiry_at: expires_at ? new Date(expires_at * 1000).toISOString() : null,
        scopes: scopes ?? null,
        last_verified_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (upsertErr) {
    return NextResponse.json({ ok: false, step: "upsert", error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
