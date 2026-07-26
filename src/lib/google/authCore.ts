import {
  createGoogleTokenCredentialHandle,
  GoogleTokenStoreError,
  type GoogleCredentialVersion,
  type GoogleTokenCredentials,
  type PlaintextGoogleToken,
  type UpdateRefreshedGoogleAccessTokenInput,
} from "@/lib/google/tokenStoreCore";

export const GOOGLE_AUTH_EAGER_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GoogleTokenRefreshResult = Readonly<{
  accessToken: PlaintextGoogleToken;
  refreshToken?: PlaintextGoogleToken;
  tokenExpiryAt: string;
}>;

export type GoogleAuthCoreDependencies = Readonly<{
  now: () => number;
  preflightEncryptionWrite: () => void;
  refreshTokens(
    input: Readonly<{
      accessToken: PlaintextGoogleToken | null;
      refreshToken: PlaintextGoogleToken;
    }>,
  ): Promise<GoogleTokenRefreshResult>;
  updateRefreshedTokens(
    input: UpdateRefreshedGoogleAccessTokenInput,
  ): Promise<GoogleCredentialVersion>;
}>;

function normalizeRefreshedExpiry(value: string): string {
  const timestamp = Date.parse(value);
  if (!value.trim() || !Number.isFinite(timestamp)) {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
  }

  return new Date(timestamp).toISOString();
}

export function createGoogleAuthCore(dependencies: GoogleAuthCoreDependencies) {
  async function prepareCredentials(
    userId: string,
    credentials: GoogleTokenCredentials,
  ): Promise<GoogleTokenCredentials> {
    if (!UUID_PATTERN.test(userId)) {
      throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
    }

    const currentTimestamp = dependencies.now();
    if (!Number.isFinite(currentTimestamp)) {
      throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
    }

    const accessToken = credentials.getAccessToken();
    const expiry = credentials.getTokenExpiryAt();
    const expiryTimestamp = expiry === null ? Number.NaN : Date.parse(expiry);
    const accessTokenIsUsable =
      accessToken !== null &&
      Number.isFinite(expiryTimestamp) &&
      expiryTimestamp - currentTimestamp >
        GOOGLE_AUTH_EAGER_REFRESH_THRESHOLD_MS;

    if (accessTokenIsUsable) {
      return credentials;
    }

    const refreshToken = credentials.getRefreshToken();
    if (refreshToken === null) {
      throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
    }

    dependencies.preflightEncryptionWrite();
    const refreshed = await dependencies.refreshTokens({
      accessToken,
      refreshToken,
    });
    const tokenExpiryAt = normalizeRefreshedExpiry(refreshed.tokenExpiryAt);
    const timestamp = new Date(currentTimestamp).toISOString();

    const savedCredentialVersion = await dependencies.updateRefreshedTokens({
      userId,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken
        ? { mode: "update", token: refreshed.refreshToken }
        : { mode: "preserve" },
      tokenExpiryAt,
      lastVerifiedAt: timestamp,
      updatedAt: timestamp,
      expectedCredentialVersion: credentials.getCredentialVersion(),
    });

    return createGoogleTokenCredentialHandle({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      tokenExpiryAt,
      status: credentials.getStatus(),
      scopes: credentials.getScopes(),
      credentialVersion: savedCredentialVersion,
    });
  }

  return Object.freeze({ prepareCredentials });
}
