//app\api\google\callback\route.ts

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { google } from "googleapis";
import {
  getGoogleOAuthStateCookieOptions,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  validateGoogleOAuthState,
} from "@/lib/google/oauthStateCore";
import {
  createPlaintextGoogleToken,
  loadGoogleCallbackConnectionSnapshot,
  preflightGoogleTokenEncryptionWrite,
  recordGoogleCredentialValidationFailure,
  saveGoogleCallbackConnection,
} from "@/lib/google/tokenStore";

function redirectWithConsumedOAuthState(path: string, requestUrl: URL) {
  const response = NextResponse.redirect(new URL(path, requestUrl.origin));
  response.cookies.set(
    GOOGLE_OAUTH_STATE_COOKIE_NAME,
    "",
    getGoogleOAuthStateCookieOptions({
      secure: requestUrl.protocol === "https:",
      consumed: true,
    }),
  );
  return response;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return redirectWithConsumedOAuthState("/login", url);
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
    return redirectWithConsumedOAuthState("/settings?google=env_missing", url);
  }

  const cookieStore = await cookies();
  const stateIsValid = validateGoogleOAuthState({
    state,
    cookieValue: cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE_NAME)?.value ?? null,
    userId: user.id,
    redirectUri,
    signingSecret: clientSecret,
  });

  if (!stateIsValid) {
    return redirectWithConsumedOAuthState(
      "/settings?google=state_invalid",
      url,
    );
  }

  if (providerError) {
    const reason =
      providerError === "access_denied" ? providerError : "oauth_error";
    return redirectWithConsumedOAuthState(
      `/settings?google=${encodeURIComponent(reason)}`,
      url,
    );
  }

  if (!code) {
    return redirectWithConsumedOAuthState("/settings?google=missing", url);
  }

  try {
    preflightGoogleTokenEncryptionWrite();
  } catch {
    console.error("[google.callback] token write preflight failed", {
      code: "GOOGLE_TOKEN_WRITE_PREFLIGHT_FAILED",
      location: "oauth_callback_preflight",
    });
    return redirectWithConsumedOAuthState("/settings?google=env_missing", url);
  }

  let callbackSnapshot;
  try {
    callbackSnapshot = await loadGoogleCallbackConnectionSnapshot(user.id);
  } catch {
    console.error("[google.callback] failed to load existing connection", {
      code: "GOOGLE_CONNECTION_LOAD_FAILED",
      location: "load_existing_google_connection",
    });
    return redirectWithConsumedOAuthState("/settings?google=load_failed", url);
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

      const reason = ["access_denied", "invalid_grant"].includes(token?.error)
        ? token.error
        : "token_failed";

      return redirectWithConsumedOAuthState(
        `/settings?google=${encodeURIComponent(reason)}`,
        url,
      );
    }

    const expiresIn =
      typeof token?.expires_in === "number" ? token.expires_in : undefined;

    const tokenExpiryAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const refreshTokenFromExchange = token?.refresh_token;
    const now = new Date().toISOString();
    let verifiedAccessToken;
    let refreshTokenToSave = callbackSnapshot.getRefreshToken();
    let validatedRefreshToken = refreshTokenToSave;
    let verifiedExpiryAt = tokenExpiryAt;

    try {
      if (
        refreshTokenFromExchange !== undefined &&
        refreshTokenFromExchange !== null
      ) {
        if (typeof refreshTokenFromExchange !== "string") {
          throw new Error("invalid_refresh_token");
        }
        refreshTokenToSave = createPlaintextGoogleToken(
          refreshTokenFromExchange,
        );
        validatedRefreshToken = refreshTokenToSave;
      }

      if (!refreshTokenToSave) {
        throw new Error("missing_refresh_token");
      }

      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri,
      );

      oauth2Client.on("tokens", (tokens) => {
        const candidate = tokens.refresh_token?.trim();
        if (candidate) {
          validatedRefreshToken = createPlaintextGoogleToken(candidate);
        }
      });

      oauth2Client.setCredentials({
        refresh_token: refreshTokenToSave,
      });

      const accessTokenResult = await oauth2Client.getAccessToken();
      const accessToken = accessTokenResult?.token?.trim() ?? "";

      if (!accessToken) {
        throw new Error("missing_access_token");
      }

      verifiedAccessToken = createPlaintextGoogleToken(accessToken);
      if (typeof oauth2Client.credentials.expiry_date === "number") {
        verifiedExpiryAt = new Date(
          oauth2Client.credentials.expiry_date,
        ).toISOString();
      }
    } catch {
      console.error("[google.callback] token validation failed", {
        reason: "oauth_access_token_check_failed",
      });

      try {
        await recordGoogleCredentialValidationFailure({
          userId: user.id,
          writeMode: callbackSnapshot.exists() ? "update" : "insert",
        });
      } catch {
        console.error("[google.callback] failed to mark token invalid", {
          code: "GOOGLE_CONNECTION_HEALTH_UPDATE_FAILED",
          location: "mark_google_token_invalid",
        });
      }

      return redirectWithConsumedOAuthState(
        "/settings?google=token_invalid",
        url,
      );
    }

    if (!validatedRefreshToken) {
      return redirectWithConsumedOAuthState(
        "/settings?google=token_invalid",
        url,
      );
    }

    try {
      await saveGoogleCallbackConnection({
        userId: user.id,
        writeMode: callbackSnapshot.exists() ? "update" : "insert",
        accessToken: verifiedAccessToken,
        refreshToken: { mode: "update", token: validatedRefreshToken },
        state: {
          tokenExpiryAt: verifiedExpiryAt,
          scopes:
            typeof token?.scope === "string"
              ? token.scope
              : callbackSnapshot.getScopes(),
          lastVerifiedAt: now,
          lastUserNotifiedAt: null,
          lastUserNotifiedErrorCode: null,
          updatedAt: now,
        },
      });
    } catch {
      console.error("[google.callback] failed to save connection", {
        code: "GOOGLE_CONNECTION_SAVE_FAILED",
        location: "save_google_connection",
      });
      return redirectWithConsumedOAuthState(
        "/settings?google=save_failed",
        url,
      );
    }

    return redirectWithConsumedOAuthState("/settings?google=connected", url);
  } catch {
    console.error("[google.callback] unexpected error", {
      code: "GOOGLE_CALLBACK_FAILED",
      location: "oauth_callback",
    });
    return redirectWithConsumedOAuthState(
      "/settings?google=callback_exception",
      url,
    );
  }
}
