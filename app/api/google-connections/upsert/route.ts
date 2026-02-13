// app/api/google-connections/upsert/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 1) Supabaseログイン中ユーザーを特定（cookieのJWTから）
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authHeader = req.headers.get("authorization") ?? "";

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) {
    return NextResponse.json({ ok: false, step: "getUser", userErr }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { provider_token, provider_refresh_token, expires_at, scopes } = body ?? {};

  if (!provider_refresh_token) {
    return NextResponse.json(
      { ok: false, step: "need_refresh_token", message: "provider_refresh_token is empty" },
      { status: 400 },
    );
  }

  // 2) google_connections を upsert
  const { error: upsertErr } = await supabaseAdmin
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
    return NextResponse.json({ ok: false, step: "upsert", upsertErr }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
