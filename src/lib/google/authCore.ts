import {
  createGoogleTokenCredentialHandle,
  GoogleTokenStoreError,
  type GoogleCredentialVersion,
  type GoogleTokenCredentials,
  type PlaintextGoogleToken,
} from "@/lib/google/tokenStoreCore";
import type {
  GoogleRefreshOperationHandle,
  GoogleRefreshPrepareResult,
} from "@/lib/google/refreshOperationCore";

export const GOOGLE_AUTH_EAGER_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GoogleTokenRefreshResult = Readonly<{
  accessToken: PlaintextGoogleToken;
  refreshToken?: PlaintextGoogleToken;
  tokenExpiryAt: string;
}>;

export type GoogleTokenRefreshOperationResult = Readonly<{
  credentials: GoogleTokenCredentials;
  refreshTokenRotated: boolean;
}>;

export type GoogleAuthCoreDependencies = Readonly<{
  now: () => number;
  preflightEncryptionWrite: () => void;
  prepareRefreshOperation(
    userId: string,
    expectedCredentialVersion: GoogleCredentialVersion,
  ): Promise<GoogleRefreshPrepareResult>;
  markProviderStarted(
    userId: string,
    expectedCredentialVersion: GoogleCredentialVersion,
    handle: GoogleRefreshOperationHandle,
  ): Promise<void>;
  transitionRefreshOperation(
    input: Readonly<{
      userId: string;
      expectedCredentialVersion: GoogleCredentialVersion;
      handle: GoogleRefreshOperationHandle;
      targetState: "retryable" | "failed_terminal" | "outcome_unknown";
      errorCode: string;
    }>,
  ): Promise<void>;
  loadCredentials(userId: string): Promise<GoogleTokenCredentials>;
  classifyProviderFailure(
    error: unknown,
  ): "failed_terminal" | "outcome_unknown";
  refreshTokens(
    input: Readonly<{
      accessToken: PlaintextGoogleToken | null;
      refreshToken: PlaintextGoogleToken;
    }>,
  ): Promise<GoogleTokenRefreshResult>;
  finalizeRefreshOperation(
    input: Readonly<{
      userId: string;
      expectedCredentialVersion: GoogleCredentialVersion;
      handle: GoogleRefreshOperationHandle;
      accessToken: PlaintextGoogleToken;
      refreshToken?: PlaintextGoogleToken;
      tokenExpiryAt: string;
      timestamp: string;
    }>,
  ): Promise<GoogleCredentialVersion>;
}>;

function normalizeRefreshedExpiry(
  value: string,
  refreshStartedAt: number,
): string {
  const timestamp = Date.parse(value);
  if (
    !value.trim() ||
    !Number.isFinite(timestamp) ||
    timestamp <= refreshStartedAt
  ) {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
  }

  return new Date(timestamp).toISOString();
}

export function createGoogleAuthCore(dependencies: GoogleAuthCoreDependencies) {
  async function refreshCredentials(
    userId: string,
    credentials: GoogleTokenCredentials,
    currentTimestamp: number,
  ): Promise<GoogleTokenRefreshOperationResult> {
    const accessToken = credentials.getAccessToken();
    const refreshToken = credentials.getRefreshToken();
    if (refreshToken === null) {
      throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
    }

    const expectedCredentialVersion = credentials.getCredentialVersion();
    const prepared = await dependencies.prepareRefreshOperation(
      userId,
      expectedCredentialVersion,
    );
    if (prepared.state === "completed") {
      const completedCredentials = await dependencies.loadCredentials(userId);
      if (
        !completedCredentials.exists() ||
        completedCredentials.getCredentialVersion() !==
          prepared.resultCredentialVersion
      ) {
        throw new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED");
      }
      return Object.freeze({
        credentials: completedCredentials,
        refreshTokenRotated: false,
      });
    }
    const handle = prepared.handle;
    try {
      dependencies.preflightEncryptionWrite();
    } catch (error) {
      await dependencies.transitionRefreshOperation({
        userId,
        expectedCredentialVersion,
        handle,
        targetState: "retryable",
        errorCode: "GOOGLE_TOKEN_WRITE_DISABLED",
      });
      throw error;
    }
    await dependencies.markProviderStarted(
      userId,
      expectedCredentialVersion,
      handle,
    );

    let refreshed: GoogleTokenRefreshResult;
    try {
      refreshed = await dependencies.refreshTokens({
        accessToken,
        refreshToken,
      });
      const tokenExpiryAt = normalizeRefreshedExpiry(
        refreshed.tokenExpiryAt,
        currentTimestamp,
      );
      const timestamp = new Date(currentTimestamp).toISOString();
      const savedCredentialVersion =
        await dependencies.finalizeRefreshOperation({
          userId,
          expectedCredentialVersion,
          handle,
          accessToken: refreshed.accessToken,
          ...(refreshed.refreshToken
            ? { refreshToken: refreshed.refreshToken }
            : {}),
          tokenExpiryAt,
          timestamp,
        });

      return Object.freeze({
        credentials: createGoogleTokenCredentialHandle({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? refreshToken,
          tokenExpiryAt,
          status: credentials.getStatus(),
          scopes: credentials.getScopes(),
          credentialVersion: savedCredentialVersion,
        }),
        refreshTokenRotated: refreshed.refreshToken !== undefined,
      });
    } catch (error) {
      const targetState = dependencies.classifyProviderFailure(error);
      const errorCode =
        targetState === "failed_terminal"
          ? "GOOGLE_TOKEN_INVALID"
          : "GOOGLE_REFRESH_OUTCOME_UNKNOWN";
      try {
        await dependencies.transitionRefreshOperation({
          userId,
          expectedCredentialVersion,
          handle,
          targetState,
          errorCode,
        });
      } catch {
        throw new GoogleTokenStoreError("GOOGLE_REFRESH_OUTCOME_UNKNOWN");
      }
      if (targetState === "outcome_unknown") {
        throw new GoogleTokenStoreError("GOOGLE_REFRESH_OUTCOME_UNKNOWN");
      }
      throw error;
    }
  }

  function validateRefreshInput(userId: string): number {
    if (!UUID_PATTERN.test(userId)) {
      throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
    }

    const currentTimestamp = dependencies.now();
    if (!Number.isFinite(currentTimestamp)) {
      throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
    }

    return currentTimestamp;
  }

  async function prepareCredentials(
    userId: string,
    credentials: GoogleTokenCredentials,
  ): Promise<GoogleTokenCredentials> {
    const currentTimestamp = validateRefreshInput(userId);

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

    return (await refreshCredentials(userId, credentials, currentTimestamp))
      .credentials;
  }

  async function refreshCredentialsOnce(
    userId: string,
    credentials: GoogleTokenCredentials,
  ): Promise<GoogleTokenRefreshOperationResult> {
    const currentTimestamp = validateRefreshInput(userId);
    return refreshCredentials(userId, credentials, currentTimestamp);
  }

  return Object.freeze({ prepareCredentials, refreshCredentialsOnce });
}
