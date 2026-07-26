import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const GOOGLE_OAUTH_STATE_COOKIE_NAME = "autopdf_google_oauth_state";
export const GOOGLE_OAUTH_STATE_COOKIE_PATH = "/api/google/callback";
export const GOOGLE_OAUTH_STATE_TTL_SECONDS = 10 * 60;

const GOOGLE_OAUTH_STATE_VERSION = 2;
const GOOGLE_OAUTH_STATE_NONCE_BYTES = 32;
const GOOGLE_OAUTH_PKCE_VERIFIER_BYTES = 32;
const GOOGLE_OAUTH_STATE_CLOCK_SKEW_MS = 60 * 1000;
const GOOGLE_OAUTH_STATE_COOKIE_MAX_LENGTH = 1_024;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const GOOGLE_OAUTH_PKCE_CODE_VERIFIER_PATTERN =
  /^[A-Za-z0-9._~-]{43,128}$/;

type GoogleOAuthStatePayload = Readonly<{
  v: typeof GOOGLE_OAUTH_STATE_VERSION;
  n: string;
  i: number;
  e: number;
  u: string;
  r: string;
  p: string;
}>;

export type GoogleOAuthState = Readonly<{
  state: string;
  cookieValue: string;
  codeChallenge: string;
}>;

export type GoogleOAuthStateCookieOptions = Readonly<{
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: typeof GOOGLE_OAUTH_STATE_COOKIE_PATH;
  maxAge: number;
  expires?: Date;
}>;

export class GoogleOAuthStateError extends Error {
  constructor() {
    super("GOOGLE_OAUTH_STATE_INVALID");
    this.name = "GoogleOAuthStateError";
  }
}

function fail(): never {
  throw new GoogleOAuthStateError();
}

function normalizeRedirectUri(value: string): string {
  if (!value || value.trim() !== value) fail();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail();
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") fail();
  return url.toString();
}

function deriveSigningKey(secret: string): Buffer {
  if (!secret || secret.trim() !== secret) fail();
  return createHmac("sha256", secret)
    .update("autopdf|google-oauth-state|signing-key|v2")
    .digest();
}

function hmacBase64Url(key: Buffer, purpose: string, value: string): string {
  return createHmac("sha256", key)
    .update(purpose)
    .update("\0")
    .update(value)
    .digest("base64url");
}

function stateChallenge(nonce: string): string {
  return createHash("sha256").update(nonce).digest("base64url");
}

function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

function safelyEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isPayload(value: unknown): value is GoogleOAuthStatePayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === GOOGLE_OAUTH_STATE_VERSION &&
    typeof payload.n === "string" &&
    BASE64URL_SHA256_PATTERN.test(payload.n) &&
    typeof payload.i === "number" &&
    Number.isSafeInteger(payload.i) &&
    typeof payload.e === "number" &&
    Number.isSafeInteger(payload.e) &&
    typeof payload.u === "string" &&
    BASE64URL_SHA256_PATTERN.test(payload.u) &&
    typeof payload.r === "string" &&
    BASE64URL_SHA256_PATTERN.test(payload.r) &&
    typeof payload.p === "string" &&
    GOOGLE_OAUTH_PKCE_CODE_VERIFIER_PATTERN.test(payload.p)
  );
}

export function getGoogleOAuthStateCookieOptions(
  input: Readonly<{
    secure: boolean;
    consumed?: boolean;
  }>,
): GoogleOAuthStateCookieOptions {
  const consumed = input.consumed === true;
  return Object.freeze({
    httpOnly: true,
    secure: input.secure,
    sameSite: "lax",
    path: GOOGLE_OAUTH_STATE_COOKIE_PATH,
    maxAge: consumed ? 0 : GOOGLE_OAUTH_STATE_TTL_SECONDS,
    ...(consumed ? { expires: new Date(0) } : {}),
  });
}

export function createGoogleOAuthState(
  input: Readonly<{
    userId: string;
    redirectUri: string;
    signingSecret: string;
    now?: number;
  }>,
): GoogleOAuthState {
  const now = input.now ?? Date.now();
  if (!input.userId || !Number.isSafeInteger(now)) fail();

  const redirectUri = normalizeRedirectUri(input.redirectUri);
  const signingKey = deriveSigningKey(input.signingSecret);
  const nonce = randomBytes(GOOGLE_OAUTH_STATE_NONCE_BYTES).toString(
    "base64url",
  );
  const codeVerifier = randomBytes(GOOGLE_OAUTH_PKCE_VERIFIER_BYTES).toString(
    "base64url",
  );
  const expiresAt = now + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000;
  const payload: GoogleOAuthStatePayload = Object.freeze({
    v: GOOGLE_OAUTH_STATE_VERSION,
    n: nonce,
    i: now,
    e: expiresAt,
    u: hmacBase64Url(signingKey, "user", input.userId),
    r: hmacBase64Url(signingKey, "redirect", redirectUri),
    p: codeVerifier,
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = hmacBase64Url(signingKey, "payload", encodedPayload);

  return Object.freeze({
    state: stateChallenge(nonce),
    cookieValue: `${encodedPayload}.${signature}`,
    codeChallenge: pkceChallenge(codeVerifier),
  });
}

export function validateGoogleOAuthState(
  input: Readonly<{
    state: string | null;
    cookieValue: string | null;
    userId: string;
    redirectUri: string;
    signingSecret: string;
    now?: number;
  }>,
): string | null {
  try {
    const now = input.now ?? Date.now();
    if (
      !input.userId ||
      !Number.isSafeInteger(now) ||
      !input.state ||
      !BASE64URL_SHA256_PATTERN.test(input.state) ||
      !input.cookieValue ||
      input.cookieValue.length > GOOGLE_OAUTH_STATE_COOKIE_MAX_LENGTH
    ) {
      return null;
    }

    const redirectUri = normalizeRedirectUri(input.redirectUri);
    const signingKey = deriveSigningKey(input.signingSecret);
    const parts = input.cookieValue.split(".");
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    if (
      !encodedPayload ||
      !signature ||
      !BASE64URL_SHA256_PATTERN.test(signature)
    ) {
      return null;
    }

    const expectedSignature = hmacBase64Url(
      signingKey,
      "payload",
      encodedPayload,
    );
    if (!safelyEqual(signature, expectedSignature)) return null;

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      );
    } catch {
      return null;
    }
    if (!isPayload(parsedPayload)) return null;

    const expectedLifetime = GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000;
    if (
      parsedPayload.e - parsedPayload.i !== expectedLifetime ||
      parsedPayload.i > now + GOOGLE_OAUTH_STATE_CLOCK_SKEW_MS ||
      parsedPayload.e < now
    ) {
      return null;
    }

    const stateIsValid =
      safelyEqual(input.state, stateChallenge(parsedPayload.n)) &&
      safelyEqual(
        parsedPayload.u,
        hmacBase64Url(signingKey, "user", input.userId),
      ) &&
      safelyEqual(
        parsedPayload.r,
        hmacBase64Url(signingKey, "redirect", redirectUri),
      );

    return stateIsValid ? parsedPayload.p : null;
  } catch {
    return null;
  }
}
