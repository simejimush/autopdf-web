import { expect, test } from "@playwright/test";
import {
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

test("creates unpredictable opaque state without direct user identity", () => {
  const first = createState();
  const second = createState();

  expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.state).not.toBe(second.state);
  expect(first.cookieValue).not.toBe(second.cookieValue);
  expect(first.state).not.toContain(USER_ID);
  expect(first.cookieValue).not.toContain(USER_ID);

  const encodedPayload = first.cookieValue.split(".")[0];
  const payloadText = Buffer.from(encodedPayload, "base64url").toString("utf8");
  expect(payloadText).not.toContain(USER_ID);
  expect(payloadText).not.toContain(REDIRECT_URI);
});

test("accepts only the matching signed state within its lifetime", () => {
  const oauthState = createState();

  expect(validate(oauthState)).toBe(true);
  expect(
    validate(oauthState, {
      now: NOW + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000,
    }),
  ).toBe(true);
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
    expect(validate(oauthState, overrides)).toBe(false);
  }
});

test("rejects expired state before provider work", () => {
  const oauthState = createState();

  expect(
    validate(oauthState, {
      now: NOW + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000 + 1,
    }),
  ).toBe(false);
});

test("binds state to the authenticated user, redirect URI, and environment secret", () => {
  const oauthState = createState();

  expect(validate(oauthState, { userId: OTHER_USER_ID })).toBe(false);
  expect(validate(oauthState, { redirectUri: OTHER_REDIRECT_URI })).toBe(false);
  expect(
    validate(oauthState, { signingSecret: "other-environment-secret" }),
  ).toBe(false);
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
