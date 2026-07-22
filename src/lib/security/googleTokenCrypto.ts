import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const TOKEN_PREFIX = "autopdf-token";
const TOKEN_VERSION = "v1";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type GoogleTokenType = "access" | "refresh";

export type GoogleTokenCryptoErrorCode =
  | "GOOGLE_TOKEN_KEY_MISSING"
  | "GOOGLE_TOKEN_KEY_INVALID"
  | "GOOGLE_TOKEN_KEY_ID_UNKNOWN"
  | "GOOGLE_TOKEN_FORMAT_UNSUPPORTED"
  | "GOOGLE_TOKEN_DECRYPT_FAILED";

const SAFE_ERROR_MESSAGES: Record<GoogleTokenCryptoErrorCode, string> = {
  GOOGLE_TOKEN_KEY_MISSING: "Google token encryption key is unavailable",
  GOOGLE_TOKEN_KEY_INVALID: "Google token encryption key is invalid",
  GOOGLE_TOKEN_KEY_ID_UNKNOWN: "Google token encryption key ID is unknown",
  GOOGLE_TOKEN_FORMAT_UNSUPPORTED: "Google token format is unsupported",
  GOOGLE_TOKEN_DECRYPT_FAILED: "Google token decryption failed",
};

export class GoogleTokenCryptoError extends Error {
  readonly code: GoogleTokenCryptoErrorCode;

  constructor(code: GoogleTokenCryptoErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "GoogleTokenCryptoError";
    this.code = code;
  }
}

type GoogleTokenCryptoParams = {
  token: string;
  userId: string;
  tokenType: GoogleTokenType;
  keyId?: string;
  key?: string;
  resolveKey?: (keyId: string) => { keyId: string; key: string };
};

type ParsedEncryptedToken = {
  keyId: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
};

function fail(code: GoogleTokenCryptoErrorCode): never {
  throw new GoogleTokenCryptoError(code);
}

function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function decodeBase64Url(value: string, expectedLength?: number): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    fail("GOOGLE_TOKEN_FORMAT_UNSUPPORTED");
  }

  const decoded = Buffer.from(value, "base64url");

  if (
    encodeBase64Url(decoded) !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    fail("GOOGLE_TOKEN_FORMAT_UNSUPPORTED");
  }

  return decoded;
}

function parseEncryptedGoogleToken(token: string): ParsedEncryptedToken {
  const parts = token.split(":");

  if (parts.length !== 6 || parts[0] !== TOKEN_PREFIX) {
    fail("GOOGLE_TOKEN_FORMAT_UNSUPPORTED");
  }

  const [, version, keyId, ivValue, tagValue, ciphertextValue] = parts;

  if (version !== TOKEN_VERSION || !KEY_ID_PATTERN.test(keyId)) {
    fail("GOOGLE_TOKEN_FORMAT_UNSUPPORTED");
  }

  return {
    keyId,
    iv: decodeBase64Url(ivValue, IV_LENGTH_BYTES),
    tag: decodeBase64Url(tagValue, AUTH_TAG_LENGTH_BYTES),
    ciphertext: decodeBase64Url(ciphertextValue),
  };
}

export function validateEncryptedGoogleToken(token: string): void {
  parseEncryptedGoogleToken(token);
}

export function validateGoogleTokenKeyId(keyId: string): void {
  if (!KEY_ID_PATTERN.test(keyId)) {
    fail("GOOGLE_TOKEN_KEY_INVALID");
  }
}

export function validateGoogleTokenKey(key: string): void {
  if (!BASE64URL_PATTERN.test(key)) {
    fail("GOOGLE_TOKEN_KEY_INVALID");
  }

  const decodedKey = Buffer.from(key, "base64url");

  if (
    decodedKey.length !== KEY_LENGTH_BYTES ||
    encodeBase64Url(decodedKey) !== key
  ) {
    fail("GOOGLE_TOKEN_KEY_INVALID");
  }
}

function getConfiguredKey(keyId?: string, key?: string): {
  keyId: string;
  key: Buffer;
} {
  if (!keyId || !key) {
    fail("GOOGLE_TOKEN_KEY_MISSING");
  }

  validateGoogleTokenKeyId(keyId);
  validateGoogleTokenKey(key);

  return { keyId, key: Buffer.from(key, "base64url") };
}

function buildAdditionalAuthenticatedData(
  userId: string,
  tokenType: GoogleTokenType,
): Buffer {
  if (!userId || userId.includes("|") || !["access", "refresh"].includes(tokenType)) {
    fail("GOOGLE_TOKEN_FORMAT_UNSUPPORTED");
  }

  return Buffer.from(
    `autopdf|google-oauth|${TOKEN_VERSION}|${userId}|${tokenType}`,
    "utf8",
  );
}

export function isEncryptedGoogleToken(token: string): boolean {
  return token.startsWith(`${TOKEN_PREFIX}:`);
}

export function encryptGoogleToken(params: GoogleTokenCryptoParams): string {
  if (!params.token || isEncryptedGoogleToken(params.token)) {
    fail("GOOGLE_TOKEN_FORMAT_UNSUPPORTED");
  }

  const configured = getConfiguredKey(params.keyId, params.key);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", configured.key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  cipher.setAAD(buildAdditionalAuthenticatedData(params.userId, params.tokenType));

  const ciphertext = Buffer.concat([
    cipher.update(params.token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_PREFIX,
    TOKEN_VERSION,
    configured.keyId,
    encodeBase64Url(iv),
    encodeBase64Url(tag),
    encodeBase64Url(ciphertext),
  ].join(":");
}

export function decryptGoogleToken(params: GoogleTokenCryptoParams): string {
  if (!isEncryptedGoogleToken(params.token)) {
    return params.token;
  }

  const parsed = parseEncryptedGoogleToken(params.token);
  const resolvedKey = params.resolveKey?.(parsed.keyId);
  const configured = getConfiguredKey(
    resolvedKey?.keyId ?? params.keyId,
    resolvedKey?.key ?? params.key,
  );

  if (parsed.keyId !== configured.keyId) {
    fail(
      params.resolveKey
        ? "GOOGLE_TOKEN_KEY_ID_UNKNOWN"
        : "GOOGLE_TOKEN_KEY_MISSING",
    );
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      configured.key,
      parsed.iv,
      { authTagLength: AUTH_TAG_LENGTH_BYTES },
    );

    decipher.setAAD(
      buildAdditionalAuthenticatedData(params.userId, params.tokenType),
    );
    decipher.setAuthTag(parsed.tag);

    return Buffer.concat([
      decipher.update(parsed.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    fail("GOOGLE_TOKEN_DECRYPT_FAILED");
  }
}
