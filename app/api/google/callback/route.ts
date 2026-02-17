import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const userId = url.searchParams.get("state");

  if (!code || !userId) {
    return NextResponse.redirect(new URL("/me?google=missing", url.origin));
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
    console.error("token exchange failed", token);
    return NextResponse.redirect(
      new URL("/me?google=token_failed", url.origin)
    );
  }

  const accessToken = token.access_token as string | undefined;
  const refreshToken = token.refresh_token as string | undefined;
  const expiresIn = token.expires_in as number | undefined;

  if (!accessToken) {
    return NextResponse.redirect(new URL("/me?google=no_access", url.origin));
  }

  const token_expiry_at = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const { error } = await supabaseAdmin.from("google_connections").upsert(
    {
      user_id: userId,
      access_token_enc: accessToken,
      refresh_token_enc: refreshToken ?? null,
      token_expiry_at,
      last_verified_at: new Date().toISOString(),
      scopes: token.scope ?? null,
    },
    { onConflict: "user_id" } // ←これが必須
  );

  if (error) {
    console.error("save google_connections failed", error);
    return NextResponse.redirect(new URL("/me?google=save_failed", url.origin));
  }

  return NextResponse.redirect(new URL("/me?google=connected", url.origin));
}
