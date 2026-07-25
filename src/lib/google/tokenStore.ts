import "server-only";

import {
  createGoogleTokenEncryptionWritePreflight,
  createGoogleTokenStore,
  createPlaintextGoogleToken,
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

export { createPlaintextGoogleToken };
export type {
  GoogleRefreshTokenWrite,
  GoogleRefreshedTokenWrite,
  GoogleCallbackConnectionSnapshot,
  GoogleTokenCredentials,
  PlaintextGoogleToken,
  RecordGoogleCredentialValidationFailureInput,
  SaveGoogleCallbackConnectionInput,
  UpdateRefreshedGoogleAccessTokenInput,
} from "@/lib/google/tokenStoreCore";

export const loadGoogleTokenCredentials = tokenStore.loadGoogleTokenCredentials;
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
): Promise<void> {
  preflightGoogleTokenEncryptionWrite();
  await tokenStore.updateRefreshedGoogleAccessToken(input);
}
export const recordGoogleCredentialValidationFailure =
  tokenStore.recordGoogleCredentialValidationFailure;
export const disconnectGoogleConnection = tokenStore.disconnectGoogleConnection;
