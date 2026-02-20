import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/me?google=missing", url.origin));
  }

  // ✅ ログインユーザー確定（URLのstateは信用しない）
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
    }),
  });

  const token = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/me?google=token_failed", url.origin));
  }

  const expiresIn = token.expires_in as number | undefined;

  const token_expiry_at = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const { error } = await supabase.from("google_connections").upsert(
    {
      user_id: data.user.id,
      access_token_enc: token.access_token ?? null,
      refresh_token_enc: token.refresh_token ?? null,
      token_expiry_at,
      last_verified_at: new Date().toISOString(),
      scopes: token.scope ?? null,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return NextResponse.redirect(new URL("/me?google=save_failed", url.origin));
  }

  return NextResponse.redirect(new URL("/me?google=connected", url.origin));
}
