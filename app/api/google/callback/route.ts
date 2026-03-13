import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/settings?google=missing", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";

  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[google.callback] missing env", {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasRedirectUri: !!redirectUri,
    });
    return NextResponse.redirect(new URL("/settings?google=env_missing", url.origin));
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const token = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("[google.callback] token exchange failed", {
        status: tokenRes.status,
        error: token?.error,
        error_description: token?.error_description,
      });

      const reason =
        typeof token?.error === "string" ? token.error : "token_failed";

      return NextResponse.redirect(
        new URL(`/settings?google=${encodeURIComponent(reason)}`, url.origin),
      );
    }

    const expiresIn = token.expires_in as number | undefined;
    const tokenExpiryAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const { error: saveErr } = await supabase.from("google_connections").upsert(
      {
        user_id: user.id,
        status: "connected",
        access_token_enc: token.access_token ?? null,
        refresh_token_enc: token.refresh_token ?? null,
        token_expiry_at: tokenExpiryAt,
        last_verified_at: new Date().toISOString(),
        scopes: token.scope ?? null,
      },
      { onConflict: "user_id" },
    );

    if (saveErr) {
      console.error("[google.callback] failed to save connection", {
        userId: user.id,
        message: saveErr.message,
      });
      return NextResponse.redirect(
        new URL("/settings?google=save_failed", url.origin),
      );
    }

    return NextResponse.redirect(
      new URL("/settings?google=connected", url.origin),
    );
  } catch (error) {
    console.error("[google.callback] unexpected error", error);
    return NextResponse.redirect(
      new URL("/settings?google=callback_exception", url.origin),
    );
  }
}
