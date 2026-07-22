import "server-only";

import {
  createGoogleTokenKeyringLoader,
  GOOGLE_TOKEN_KEYRING_ENV_NAMES,
  type GoogleTokenKey,
} from "@/lib/security/googleTokenKeyringCore";

const keyringLoader = createGoogleTokenKeyringLoader(() => ({
  currentKeyId:
    process.env[GOOGLE_TOKEN_KEYRING_ENV_NAMES.currentKeyId],
  keysJson: process.env[GOOGLE_TOKEN_KEYRING_ENV_NAMES.keysJson],
}));

export function getCurrentGoogleTokenKey(): GoogleTokenKey {
  return keyringLoader.getCurrentKey();
}

export function getGoogleTokenDecryptKey(keyId: string): GoogleTokenKey {
  return keyringLoader.getDecryptKey(keyId);
}
