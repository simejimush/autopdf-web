import {
  GoogleTokenCryptoError,
  validateGoogleTokenKey,
  validateGoogleTokenKeyId,
} from "@/lib/security/googleTokenCrypto";

export const MAX_GOOGLE_TOKEN_KEYS = 8;

export const GOOGLE_TOKEN_KEYRING_ENV_NAMES = Object.freeze({
  currentKeyId: "GOOGLE_TOKEN_ENCRYPTION_CURRENT_KEY_ID",
  keysJson: "GOOGLE_TOKEN_ENCRYPTION_KEYS_JSON",
} as const);

export type GoogleTokenKey = Readonly<{
  keyId: string;
  key: string;
}>;

export type GoogleTokenKeyring = Readonly<{
  getCurrentKey(): GoogleTokenKey;
  getDecryptKey(keyId: string): GoogleTokenKey;
}>;

export type GoogleTokenKeyringConfig = {
  currentKeyId: string | undefined;
  keysJson: string | undefined;
};

export type GoogleTokenKeyringLoader = Readonly<{
  getCurrentKey(): GoogleTokenKey;
  getDecryptKey(keyId: string): GoogleTokenKey;
  resetForTests(): void;
}>;

function failInvalidKeyring(): never {
  throw new GoogleTokenCryptoError("GOOGLE_TOKEN_KEY_INVALID");
}

function hasExactFields(
  value: Record<string, unknown>,
  expectedFields: readonly string[],
): boolean {
  const fields = Object.keys(value).sort();
  const expected = [...expectedFields].sort();

  return (
    fields.length === expected.length &&
    fields.every((field, index) => field === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGoogleTokenKeyring(
  params: GoogleTokenKeyringConfig,
): GoogleTokenKeyring {
  if (params.currentKeyId === undefined || params.keysJson === undefined) {
    throw new GoogleTokenCryptoError("GOOGLE_TOKEN_KEY_MISSING");
  }

  validateGoogleTokenKeyId(params.currentKeyId);

  let parsed: unknown;

  try {
    parsed = JSON.parse(params.keysJson);
  } catch {
    failInvalidKeyring();
  }

  if (
    !isRecord(parsed) ||
    !hasExactFields(parsed, ["version", "keys"]) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length === 0 ||
    parsed.keys.length > MAX_GOOGLE_TOKEN_KEYS
  ) {
    failInvalidKeyring();
  }

  const keys = new Map<string, GoogleTokenKey>();

  for (const entry of parsed.keys) {
    if (
      !isRecord(entry) ||
      !hasExactFields(entry, ["id", "key"]) ||
      typeof entry.id !== "string" ||
      typeof entry.key !== "string"
    ) {
      failInvalidKeyring();
    }

    validateGoogleTokenKeyId(entry.id);
    validateGoogleTokenKey(entry.key);

    if (keys.has(entry.id)) {
      failInvalidKeyring();
    }

    keys.set(
      entry.id,
      Object.freeze({
        keyId: entry.id,
        key: entry.key,
      }),
    );
  }

  const currentKey = keys.get(params.currentKeyId);

  if (!currentKey) {
    failInvalidKeyring();
  }

  return Object.freeze({
    getCurrentKey() {
      return currentKey;
    },
    getDecryptKey(keyId: string) {
      const key = keys.get(keyId);

      if (!key) {
        throw new GoogleTokenCryptoError("GOOGLE_TOKEN_KEY_ID_UNKNOWN");
      }

      return key;
    },
  });
}

export function createGoogleTokenKeyringLoader(
  readConfig: () => GoogleTokenKeyringConfig,
): GoogleTokenKeyringLoader {
  let cached:
    | Readonly<GoogleTokenKeyringConfig & { keyring: GoogleTokenKeyring }>
    | undefined;

  function getKeyring(): GoogleTokenKeyring {
    const { currentKeyId, keysJson } = readConfig();

    if (
      cached !== undefined &&
      cached.currentKeyId === currentKeyId &&
      cached.keysJson === keysJson
    ) {
      return cached.keyring;
    }

    const keyring = parseGoogleTokenKeyring({ currentKeyId, keysJson });
    cached = Object.freeze({ currentKeyId, keysJson, keyring });

    return keyring;
  }

  return Object.freeze({
    getCurrentKey() {
      return getKeyring().getCurrentKey();
    },
    getDecryptKey(keyId: string) {
      return getKeyring().getDecryptKey(keyId);
    },
    resetForTests() {
      cached = undefined;
    },
  });
}
