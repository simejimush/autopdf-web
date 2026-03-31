import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings?google=missing", url.origin),
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  // 最低限の state 検証
  if (!state || state !== user.id) {
    return NextResponse.redirect(
      new URL("/settings?google=state_invalid", url.origin),
    );
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
    return NextResponse.redirect(
      new URL("/settings?google=env_missing", url.origin),
    );
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

    const expiresIn =
      typeof token?.expires_in === "number" ? token.expires_in : undefined;

    const tokenExpiryAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    // 既存接続を取得して refresh_token を維持する
    const { data: existingConnection, error: existingErr } = await supabase
      .from("google_connections")
      .select("refresh_token_enc")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingErr) {
      console.error("[google.callback] failed to load existing connection", {
        userId: user.id,
        message: existingErr.message,
      });
      return NextResponse.redirect(
        new URL("/settings?google=load_failed", url.origin),
      );
    }

    const refreshTokenToSave =
      token.refresh_token ?? existingConnection?.refresh_token_enc ?? null;

    const payload: Record<string, unknown> = {
      user_id: user.id,
      status: "connected",
      access_token_enc: token.access_token ?? null,
      refresh_token_enc: refreshTokenToSave,
      token_expiry_at: tokenExpiryAt,
      last_verified_at: new Date().toISOString(),
      scopes: token.scope ?? null,
    };

    // ここ重要:
    // google_connections テーブルに接続エラー系カラムがあるなら、
    // 再接続成功時に必ずクリアする
    // 例:
    // payload.last_error_code = null;
    // payload.last_error_message = null;
    // payload.needs_reconnect = false;

    const { error: saveErr } = await supabase
      .from("google_connections")
      .upsert(payload, { onConflict: "user_id" });

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
