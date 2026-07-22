//app\api\google\callback\route.ts

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { google } from "googleapis";

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
        code: "GOOGLE_TOKEN_EXCHANGE_FAILED",
        status: tokenRes.status,
        location: "oauth_token_exchange",
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
        code: "GOOGLE_CONNECTION_LOAD_FAILED",
        dbCode:
          typeof existingErr.code === "string" ? existingErr.code : undefined,
        location: "load_existing_google_connection",
      });
      return NextResponse.redirect(
        new URL("/settings?google=load_failed", url.origin),
      );
    }

    const refreshTokenToSave =
      token.refresh_token ?? existingConnection?.refresh_token_enc ?? null;

    const now = new Date().toISOString();

    try {
      if (!refreshTokenToSave) {
        throw new Error("missing_refresh_token");
      }

      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri,
      );

      oauth2Client.setCredentials({
        refresh_token: refreshTokenToSave,
      });

      const accessTokenResult = await oauth2Client.getAccessToken();
      const verifiedAccessToken = accessTokenResult?.token?.trim() ?? "";

      if (!verifiedAccessToken) {
        throw new Error("missing_access_token");
      }

      if (!token.access_token) {
        token.access_token = verifiedAccessToken;
      }
    } catch (verifyErr) {
      console.error("[google.callback] token validation failed", {
        userId: user.id,
        reason: "oauth_access_token_check_failed",
        errorName: verifyErr instanceof Error ? verifyErr.name : "unknown",
      });

      const { error: markErr } = await supabase
        .from("google_connections")
        .upsert(
          {
            user_id: user.id,
            status: "error",
            reauth_required: true,
            last_error_code: "GOOGLE_TOKEN_INVALID",
            last_error_at: now,
            updated_at: now,
          },
          { onConflict: "user_id" },
        );

      if (markErr) {
        console.error("[google.callback] failed to mark token invalid", {
          code: "GOOGLE_CONNECTION_HEALTH_UPDATE_FAILED",
          dbCode:
            typeof markErr.code === "string" ? markErr.code : undefined,
          location: "mark_google_token_invalid",
        });
      }

      return NextResponse.redirect(
        new URL("/settings?google=token_invalid", url.origin),
      );
    }

    const payload: Record<string, unknown> = {
      user_id: user.id,
      status: "connected",
      access_token_enc: token.access_token ?? null,
      refresh_token_enc: refreshTokenToSave,
      token_expiry_at: tokenExpiryAt,
      last_verified_at: now,
      scopes: token.scope ?? null,
      reauth_required: false,
      last_error_code: null,
      last_error_at: null,
      last_user_notified_at: null,
      last_user_notified_error_code: null,
      updated_at: now,
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
        code: "GOOGLE_CONNECTION_SAVE_FAILED",
        dbCode:
          typeof saveErr.code === "string" ? saveErr.code : undefined,
        location: "save_google_connection",
      });
      return NextResponse.redirect(
        new URL("/settings?google=save_failed", url.origin),
      );
    }

    return NextResponse.redirect(
      new URL("/settings?google=connected", url.origin),
    );
  } catch (error) {
    console.error("[google.callback] unexpected error", {
      code: "GOOGLE_CALLBACK_FAILED",
      errorName: error instanceof Error ? error.name : "UnknownError",
      location: "oauth_callback",
    });
    return NextResponse.redirect(
      new URL("/settings?google=callback_exception", url.origin),
    );
  }
}
