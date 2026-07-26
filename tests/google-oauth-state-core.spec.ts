import { expect, test } from "@playwright/test";
import { createHash, createHmac } from "node:crypto";
import {
  GOOGLE_OAUTH_PKCE_CODE_VERIFIER_PATTERN,
  GOOGLE_OAUTH_STATE_TTL_SECONDS,
  GoogleOAuthStateError,
  createGoogleOAuthState,
  validateGoogleOAuthState,
} from "../src/lib/google/oauthStateCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const REDIRECT_URI = "https://app.example.test/api/google/callback";
const OTHER_REDIRECT_URI = "https://preview.example.test/api/google/callback";
const SIGNING_SECRET = "dummy-google-client-secret";
const NOW = Date.parse("2026-07-26T00:00:00.000Z");

type TestPayload = Readonly<{
  v: number;
  n: string;
  i: number;
  e: number;
  u: string;
  r: string;
  p?: string;
}>;

function createState(now = NOW) {
  return createGoogleOAuthState({
    userId: USER_ID,
    redirectUri: REDIRECT_URI,
    signingSecret: SIGNING_SECRET,
    now,
  });
}

function validate(
  oauthState: ReturnType<typeof createState>,
  overrides?: Partial<Parameters<typeof validateGoogleOAuthState>[0]>,
) {
  return validateGoogleOAuthState({
    state: oauthState.state,
    cookieValue: oauthState.cookieValue,
    userId: USER_ID,
    redirectUri: REDIRECT_URI,
    signingSecret: SIGNING_SECRET,
    now: NOW,
    ...overrides,
  });
}

function decodePayload(cookieValue: string): TestPayload {
  const encodedPayload = cookieValue.split(".")[0];
  return JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as TestPayload;
}

function signPayload(payload: TestPayload): string {
  const signingKey = createHmac("sha256", SIGNING_SECRET)
    .update("autopdf|google-oauth-state|signing-key|v2")
    .digest();
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = createHmac("sha256", signingKey)
    .update("payload")
    .update("\0")
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

test("creates unpredictable opaque state without direct user identity", () => {
  const first = createState();
  const second = createState();
  const firstPayload = decodePayload(first.cookieValue);
  const secondPayload = decodePayload(second.cookieValue);

  expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.state).not.toBe(second.state);
  expect(first.cookieValue).not.toBe(second.cookieValue);
  expect(first.state).not.toContain(USER_ID);
  expect(first.cookieValue).not.toContain(USER_ID);
  expect(firstPayload.v).toBe(2);
  expect(firstPayload.p).toMatch(GOOGLE_OAUTH_PKCE_CODE_VERIFIER_PATTERN);
  expect(firstPayload.p).toHaveLength(43);
  expect(firstPayload.p).not.toBe(secondPayload.p);
  expect(first.state).not.toContain(firstPayload.p!);
  expect(first.codeChallenge).not.toContain(firstPayload.p!);
  expect(first.codeChallenge).toBe(
    createHash("sha256").update(firstPayload.p!, "ascii").digest("base64url"),
  );
  expect(first.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.codeChallenge).not.toContain("=");
  expect(first.cookieValue.length).toBeLessThan(1_024);

  const encodedPayload = first.cookieValue.split(".")[0];
  const payloadText = Buffer.from(encodedPayload, "base64url").toString("utf8");
  expect(payloadText).not.toContain(USER_ID);
  expect(payloadText).not.toContain(REDIRECT_URI);
});

test("accepts only the matching signed state within its lifetime", () => {
  const oauthState = createState();
  const codeVerifier = decodePayload(oauthState.cookieValue).p;

  expect(validate(oauthState)).toBe(codeVerifier);
  expect(
    validate(oauthState, {
      now: NOW + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000,
    }),
  ).toBe(codeVerifier);
});

test("rejects missing, mismatched, malformed, and tampered values", () => {
  const oauthState = createState();
  const [payload, signature] = oauthState.cookieValue.split(".");

  for (const overrides of [
    { state: null },
    { state: "x".repeat(43) },
    { cookieValue: null },
    { cookieValue: "malformed" },
    { cookieValue: `${payload.slice(0, -1)}x.${signature}` },
    { cookieValue: `${payload}.${signature.slice(0, -1)}x` },
    { cookieValue: "x".repeat(1_025) },
  ]) {
    expect(validate(oauthState, overrides)).toBeNull();
  }
});

test("rejects expired state before provider work", () => {
  const oauthState = createState();

  expect(
    validate(oauthState, {
      now: NOW + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000 + 1,
    }),
  ).toBeNull();
});

test("rejects old, missing, and invalid verifier envelopes before use", () => {
  const oauthState = createState();
  const payload = decodePayload(oauthState.cookieValue);
  const withoutVerifier = { ...payload, p: undefined };
  const invalidEnvelopes = [
    signPayload({ ...payload, v: 1 }),
    signPayload(withoutVerifier),
    signPayload({ ...payload, p: "" }),
    signPayload({ ...payload, p: "x".repeat(42) }),
    signPayload({ ...payload, p: `${"x".repeat(42)}=` }),
  ];

  for (const cookieValue of invalidEnvelopes) {
    expect(validate(oauthState, { cookieValue })).toBeNull();
  }
});

test("code verifier is covered by the envelope signature", () => {
  const oauthState = createState();
  const payload = decodePayload(oauthState.cookieValue);
  const [encodedPayload, signature] = oauthState.cookieValue.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...payload, p: "z".repeat(43) }),
  ).toString("base64url");

  expect(
    validate(oauthState, {
      cookieValue: `${tamperedPayload}.${signature}`,
    }),
  ).toBeNull();
  expect(encodedPayload).not.toBe(tamperedPayload);
});

test("binds state to the authenticated user, redirect URI, and environment secret", () => {
  const oauthState = createState();

  expect(validate(oauthState, { userId: OTHER_USER_ID })).toBeNull();
  expect(validate(oauthState, { redirectUri: OTHER_REDIRECT_URI })).toBeNull();
  expect(
    validate(oauthState, { signingSecret: "other-environment-secret" }),
  ).toBeNull();
});

test("configuration errors expose only a fixed safe error", () => {
  const secret = "raw-google-secret";
  const invalidRedirect = "not-a-redirect-uri";

  try {
    createGoogleOAuthState({
      userId: USER_ID,
      redirectUri: invalidRedirect,
      signingSecret: secret,
      now: NOW,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(GoogleOAuthStateError);
    expect(error).toMatchObject({
      name: "GoogleOAuthStateError",
      message: "GOOGLE_OAUTH_STATE_INVALID",
    });
    expect(String(error)).not.toContain(USER_ID);
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain(invalidRedirect);
    return;
  }

  throw new Error("Expected GoogleOAuthStateError");
});
