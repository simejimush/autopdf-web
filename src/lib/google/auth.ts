// autopdf-web/src/lib/google/auth.ts
import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptGoogleToken } from "@/lib/security/googleTokenCrypto";

type GoogleOAuthErrorCode =
  | "GOOGLE_CONNECTION_NOT_FOUND"
  | "GOOGLE_REFRESH_TOKEN_MISSING"
  | "GOOGLE_TOKEN_INVALID"
  | "GOOGLE_PERMISSION_DENIED"
  | "GOOGLE_TOKEN_REFRESH_FAILED";

export class GoogleOAuthError extends Error {
  readonly code: GoogleOAuthErrorCode;

  constructor(code: GoogleOAuthErrorCode) {
    super(code);
    this.name = "GoogleOAuthError";
    this.code = code;
  }
}

function getGoogleRefreshErrorCode(error: unknown): GoogleOAuthErrorCode {
  if (!error || typeof error !== "object") {
    return "GOOGLE_TOKEN_REFRESH_FAILED";
  }

  const candidate = error as {
    code?: unknown;
    response?: { status?: unknown; data?: { error?: unknown } };
  };
  const status = candidate.response?.status ?? candidate.code;
  const providerCode = candidate.response?.data?.error;

  if (status === 401 || providerCode === "invalid_grant") {
    return "GOOGLE_TOKEN_INVALID";
  }

  if (status === 403) {
    return "GOOGLE_PERMISSION_DENIED";
  }

  return "GOOGLE_TOKEN_REFRESH_FAILED";
}

export async function getOAuthClientForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("google_connections")
    .select("access_token_enc, refresh_token_enc, updated_at")
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const conn = data?.[0];
  if (!conn) throw new GoogleOAuthError("GOOGLE_CONNECTION_NOT_FOUND");

  const keyId = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_ID;
  const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const refreshToken = decryptGoogleToken({
    token: String(conn.refresh_token_enc ?? "").trim(),
    userId,
    tokenType: "refresh",
    keyId,
    key,
  });
  const accessToken = decryptGoogleToken({
    token: String(conn.access_token_enc ?? "").trim(),
    userId,
    tokenType: "access",
    keyId,
    key,
  });

  if (!refreshToken) {
    throw new GoogleOAuthError("GOOGLE_REFRESH_TOKEN_MISSING");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in runtime env",
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

  // refresh_token は必須。access_token はあればセット。
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    ...(accessToken ? { access_token: accessToken } : {}),
  });

  // refresh を実行し、返ってきた access token を credentials に確実に反映
  try {
    const at = await oauth2Client.getAccessToken();
    const newAccessToken = at?.token?.trim() ?? "";

    if (!newAccessToken) {
      throw new GoogleOAuthError("GOOGLE_TOKEN_REFRESH_FAILED");
    }

    oauth2Client.setCredentials({
      refresh_token: refreshToken,
      access_token: newAccessToken,
    });

    // DBにも保存（差分がある場合のみ）
    if (newAccessToken !== accessToken) {
      await supabaseAdmin
        .from("google_connections")
        .update({
          access_token_enc: newAccessToken,
          last_verified_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    console.log("[google.auth] refresh succeeded", {
      location: "oauth_access_token_refresh",
    });
  } catch (error) {
    const safeError =
      error instanceof GoogleOAuthError
        ? error
        : new GoogleOAuthError(getGoogleRefreshErrorCode(error));

    console.error("[google.auth] refresh failed", {
      code: safeError.code,
      errorName: error instanceof Error ? error.name : "UnknownError",
      location: "oauth_access_token_refresh",
    });
    throw safeError;
  }

  return oauth2Client;
}
