// autopdf-web/src/lib/google/auth.ts
import { google } from "googleapis";
import { createGoogleAuthCore } from "@/lib/google/authCore";
import {
  createPlaintextGoogleToken,
  loadGoogleTokenCredentials,
  preflightGoogleTokenEncryptionWrite,
} from "@/lib/google/tokenStore";
import {
  finalizeGoogleRefreshOperation,
  markGoogleRefreshProviderStarted,
  prepareGoogleRefreshOperation,
  transitionGoogleRefreshOperation,
} from "@/lib/google/refreshOperation";
import { GoogleTokenStoreError } from "@/lib/google/tokenStoreCore";

type GoogleOAuthErrorCode =
  | "GOOGLE_CONNECTION_NOT_FOUND"
  | "GOOGLE_REFRESH_TOKEN_MISSING"
  | "GOOGLE_TOKEN_INVALID"
  | "GOOGLE_PERMISSION_DENIED"
  | "GOOGLE_TOKEN_REFRESH_FAILED"
  | "GOOGLE_REFRESH_OUTCOME_UNKNOWN";

export const GOOGLE_REFRESH_PROVIDER_TIMEOUT_MS = 30_000;

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
  let storedCredentials;
  try {
    storedCredentials = await loadGoogleTokenCredentials(userId);
  } catch (error) {
    if (
      error instanceof GoogleTokenStoreError &&
      error.code === "GOOGLE_TOKEN_ROW_NOT_FOUND"
    ) {
      throw new GoogleOAuthError("GOOGLE_CONNECTION_NOT_FOUND");
    }
    throw error;
  }

  if (
    !storedCredentials.exists() ||
    storedCredentials.getStatus() !== "connected"
  ) {
    throw new GoogleOAuthError("GOOGLE_CONNECTION_NOT_FOUND");
  }

  if (!storedCredentials.getRefreshToken()) {
    throw new GoogleOAuthError("GOOGLE_REFRESH_TOKEN_MISSING");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError("GOOGLE_TOKEN_REFRESH_FAILED");
  }

  const authCore = createGoogleAuthCore({
    now: Date.now,
    preflightEncryptionWrite: preflightGoogleTokenEncryptionWrite,
    prepareRefreshOperation: prepareGoogleRefreshOperation,
    markProviderStarted: markGoogleRefreshProviderStarted,
    transitionRefreshOperation: transitionGoogleRefreshOperation,
    finalizeRefreshOperation: finalizeGoogleRefreshOperation,
    loadCredentials: loadGoogleTokenCredentials,
    classifyProviderFailure(error) {
      return error instanceof GoogleOAuthError &&
        error.code === "GOOGLE_TOKEN_INVALID"
        ? "failed_terminal"
        : "outcome_unknown";
    },
    async refreshTokens(input) {
      const refreshClient = new google.auth.OAuth2({
        clientId,
        clientSecret,
        transporterOptions: {
          timeout: GOOGLE_REFRESH_PROVIDER_TIMEOUT_MS,
          retryConfig: {
            retry: 0,
            noResponseRetries: 0,
          },
        },
      });
      let refreshTokenFromEvent: string | undefined;
      refreshClient.on("tokens", (tokens) => {
        const candidate = tokens.refresh_token?.trim();
        if (candidate) refreshTokenFromEvent = candidate;
      });
      refreshClient.setCredentials({
        refresh_token: input.refreshToken,
        ...(input.accessToken ? { access_token: input.accessToken } : {}),
        expiry_date: 0,
      });

      try {
        const accessTokenResult = await refreshClient.getAccessToken();
        const accessToken = accessTokenResult?.token?.trim() ?? "";
        const expiryDate = refreshClient.credentials.expiry_date;

        if (!accessToken || typeof expiryDate !== "number") {
          throw new GoogleOAuthError("GOOGLE_TOKEN_REFRESH_FAILED");
        }

        const rotatedRefreshToken =
          refreshTokenFromEvent ??
          refreshClient.credentials.refresh_token?.trim() ??
          "";

        return {
          accessToken: createPlaintextGoogleToken(accessToken),
          ...(rotatedRefreshToken && rotatedRefreshToken !== input.refreshToken
            ? {
                refreshToken: createPlaintextGoogleToken(rotatedRefreshToken),
              }
            : {}),
          tokenExpiryAt: new Date(expiryDate).toISOString(),
        };
      } catch (error) {
        throw error instanceof GoogleOAuthError
          ? error
          : new GoogleOAuthError(getGoogleRefreshErrorCode(error));
      }
    },
  });

  const credentials = await authCore.prepareCredentials(
    userId,
    storedCredentials,
  );
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  const tokenExpiryAt = credentials.getTokenExpiryAt();
  oauth2Client.setCredentials({
    access_token: credentials.getAccessToken() ?? undefined,
    refresh_token: credentials.getRefreshToken() ?? undefined,
    expiry_date: tokenExpiryAt ? Date.parse(tokenExpiryAt) : undefined,
  });

  return oauth2Client;
}
