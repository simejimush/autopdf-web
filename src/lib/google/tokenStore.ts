import "server-only";

import {
  createGoogleTokenStore,
  createPlaintextGoogleToken,
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

const tokenStore = createGoogleTokenStore({
  repository,
  crypto: {
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
  },
  now: () => new Date().toISOString(),
});

export { createPlaintextGoogleToken };
export type {
  GoogleRefreshTokenWrite,
  GoogleTokenCredentials,
  PlaintextGoogleToken,
  SaveGoogleCallbackConnectionInput,
  UpdateRefreshedGoogleAccessTokenInput,
} from "@/lib/google/tokenStoreCore";

export const loadGoogleTokenCredentials =
  tokenStore.loadGoogleTokenCredentials;
export const loadGoogleRefreshTokenForCallback =
  tokenStore.loadGoogleRefreshTokenForCallback;
export const saveGoogleCallbackConnection =
  tokenStore.saveGoogleCallbackConnection;
export const updateRefreshedGoogleAccessToken =
  tokenStore.updateRefreshedGoogleAccessToken;
export const disconnectGoogleConnection =
  tokenStore.disconnectGoogleConnection;
