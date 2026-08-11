import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  createGoogleTokenEncryptionWritePreflight,
  createGoogleTokenStore,
  createGoogleCredentialVersion,
  createGoogleUserId,
  createGoogleRefreshLeaseIdHash,
  createPlaintextGoogleToken,
  GoogleTokenStoreError,
  type GoogleTokenCryptoAdapter,
} from "@/lib/google/tokenStoreCore";
import {
  createGoogleTokenRepository,
  type GoogleTokenSupabaseClient,
} from "@/lib/google/tokenStoreRepository";
import {
  decryptGoogleToken,
  encryptGoogleToken,
} from "@/lib/security/googleTokenCrypto";
import {
  getCurrentGoogleTokenKey,
  getGoogleTokenDecryptKey,
} from "@/lib/security/googleTokenKeyring";

export const GOOGLE_REFRESH_LEASE_TTL_SECONDS = 90;
export const GOOGLE_REFRESH_LEASE_SECRET_BYTES = 32;

const repository = createGoogleTokenRepository(async () => {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin as unknown as GoogleTokenSupabaseClient;
});

const crypto: GoogleTokenCryptoAdapter = Object.freeze({
  encrypt({ token, userId, tokenType }) {
    const currentKey = getCurrentGoogleTokenKey();
    return encryptGoogleToken({
      token,
      userId,
      tokenType,
      keyId: currentKey.keyId,
      key: currentKey.key,
    });
  },
  decrypt({ token, userId, tokenType }) {
    return decryptGoogleToken({
      token,
      userId,
      tokenType,
      resolveKey: getGoogleTokenDecryptKey,
    });
  },
});

const tokenStore = createGoogleTokenStore({
  repository,
  crypto,
  now: () => new Date().toISOString(),
});

const runEncryptionWritePreflight = createGoogleTokenEncryptionWritePreflight({
  crypto,
  readInterlock: () => process.env.GOOGLE_TOKEN_ENCRYPTION_WRITES_DISABLED,
});

export function preflightGoogleTokenEncryptionWrite(): void {
  runEncryptionWritePreflight();
}

export { createGoogleCredentialVersion, createPlaintextGoogleToken };
export type {
  GoogleCredentialVersion,
  GoogleRefreshTokenWrite,
  GoogleRefreshedTokenWrite,
  GoogleCallbackConnectionSnapshot,
  GoogleTokenCredentials,
  PlaintextGoogleToken,
  RecordGoogleCredentialValidationFailureInput,
  SaveGoogleCallbackConnectionInput,
  UpdateRefreshedGoogleAccessTokenInput,
  GoogleRefreshLeaseIdHash,
  GoogleRefreshLeaseHandle,
  EncryptedGoogleToken,
} from "@/lib/google/tokenStoreCore";

export function createRefreshLeaseHandle(): import("@/lib/google/tokenStoreCore").GoogleRefreshLeaseHandle {
  const rawLeaseSecret = randomBytes(GOOGLE_REFRESH_LEASE_SECRET_BYTES);
  const handle = Object.create(Object.prototype) as Record<
    PropertyKey,
    unknown
  >;
  Object.defineProperties(handle, {
    getIdHash: {
      value: () =>
        createGoogleRefreshLeaseIdHash(
          createHash("sha256").update(rawLeaseSecret).digest("hex"),
        ),
      enumerable: false,
    },
    toJSON: {
      value: (): never => {
        throw new Error("Google refresh lease cannot be serialized");
      },
      enumerable: false,
    },
    toString: {
      value: () => "[GoogleRefreshLeaseHandle]",
      enumerable: false,
    },
  });
  return Object.freeze(
    handle,
  ) as import("@/lib/google/tokenStoreCore").GoogleRefreshLeaseHandle;
}

export function encryptGoogleTokenForStore(
  token: import("@/lib/google/tokenStoreCore").PlaintextGoogleToken,
  userId: string,
  tokenType: "access" | "refresh",
): import("@/lib/google/tokenStoreCore").EncryptedGoogleToken {
  return crypto.encrypt({
    token,
    userId: createGoogleUserId(userId),
    tokenType,
  }) as import("@/lib/google/tokenStoreCore").EncryptedGoogleToken;
}

export async function claimGoogleCredentialRefreshLease(
  input: Readonly<{
    userId: string;
    expectedStatus?: string | null;
    expectedCredentialVersion: import("@/lib/google/tokenStoreCore").GoogleCredentialVersion;
  }>,
): Promise<import("@/lib/google/tokenStoreCore").GoogleRefreshLeaseHandle> {
  const lease = createRefreshLeaseHandle();
  await tokenStore.claimGoogleCredentialRefreshLease({
    userId: input.userId,
    expectedStatus:
      input.expectedStatus === undefined ? "connected" : input.expectedStatus,
    expectedCredentialVersion: input.expectedCredentialVersion,
    leaseIdHash: lease.getIdHash(),
  });
  return lease;
}

export async function releaseGoogleCredentialRefreshLease(
  input: Readonly<{
    userId: string;
    expectedStatus?: string | null;
    expectedCredentialVersion: import("@/lib/google/tokenStoreCore").GoogleCredentialVersion;
    lease: import("@/lib/google/tokenStoreCore").GoogleRefreshLeaseHandle;
  }>,
): Promise<void> {
  await tokenStore.releaseGoogleCredentialRefreshLease({
    userId: input.userId,
    expectedCredentialVersion: input.expectedCredentialVersion,
    leaseIdHash: input.lease.getIdHash(),
    expectedStatus:
      input.expectedStatus === undefined ? "connected" : input.expectedStatus,
  });
}

export const loadGoogleTokenCredentials = tokenStore.loadGoogleTokenCredentials;
export const loadGoogleRefreshCanaryCredentials =
  tokenStore.loadGoogleRefreshCanaryCredentials;
export const loadGoogleRefreshTokenForCallback =
  tokenStore.loadGoogleRefreshTokenForCallback;
export const loadGoogleCallbackConnectionSnapshot =
  tokenStore.loadGoogleCallbackConnectionSnapshot;
export async function saveGoogleCallbackConnection(
  input: import("@/lib/google/tokenStoreCore").SaveGoogleCallbackConnectionInput,
): Promise<void> {
  preflightGoogleTokenEncryptionWrite();
  await tokenStore.saveGoogleCallbackConnection(input);
}
export async function updateRefreshedGoogleAccessToken(
  input: import("@/lib/google/tokenStoreCore").UpdateRefreshedGoogleAccessTokenInput,
): Promise<import("@/lib/google/tokenStoreCore").GoogleCredentialVersion> {
  preflightGoogleTokenEncryptionWrite();
  return tokenStore.updateRefreshedGoogleAccessToken(input);
}
export const recordGoogleCredentialValidationFailure =
  tokenStore.recordGoogleCredentialValidationFailure;

export async function disconnectGoogleConnection(
  userId: string,
): Promise<void> {
  const snapshot =
    await tokenStore.loadGoogleCallbackConnectionSnapshot(userId);
  const expectedCredentialVersion = snapshot.getCredentialVersion();
  if (!snapshot.exists() || expectedCredentialVersion === null) {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_ROW_NOT_FOUND");
  }

  let lease: import("@/lib/google/tokenStoreCore").GoogleRefreshLeaseHandle;
  try {
    lease = await claimGoogleCredentialRefreshLease({
      userId,
      expectedStatus: snapshot.getStatus(),
      expectedCredentialVersion,
    });
  } catch (error) {
    if (
      error instanceof GoogleTokenStoreError &&
      error.code === "GOOGLE_TOKEN_UPDATE_CONFLICT"
    ) {
      throw new GoogleTokenStoreError("GOOGLE_TOKEN_REFRESH_IN_PROGRESS");
    }
    throw error;
  }

  await tokenStore.disconnectGoogleConnection({
    userId,
    expectedStatus: snapshot.getStatus(),
    expectedCredentialVersion,
    refreshLeaseIdHash: lease.getIdHash(),
  });
}
