import { expect, test } from "@playwright/test";
import {
  createGoogleAuthCore,
  GOOGLE_AUTH_EAGER_REFRESH_THRESHOLD_MS,
  type GoogleTokenRefreshResult,
} from "../src/lib/google/authCore";
import {
  createGoogleTokenCredentialHandle,
  createGoogleCredentialVersion,
  createGoogleRefreshLeaseIdHash,
  createPlaintextGoogleToken,
  GoogleTokenStoreError,
  type GoogleTokenCredentials,
  type UpdateRefreshedGoogleAccessTokenInput,
} from "../src/lib/google/tokenStoreCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const NOW_MS = Date.parse("2026-08-01T00:00:00.000Z");
const REFRESHED_EXPIRY = "2026-08-01T01:00:00.000Z";
const VERSION_0 = createGoogleCredentialVersion(0);
const VERSION_1 = createGoogleCredentialVersion(1);
const LEASE_HASH = createGoogleRefreshLeaseIdHash("a".repeat(64));
const LEASE = Object.freeze({
  getIdHash: () => LEASE_HASH,
  toJSON: (): never => {
    throw new Error("lease serialization forbidden");
  },
});

function credentials(input?: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiry?: string | null;
}): GoogleTokenCredentials {
  return createGoogleTokenCredentialHandle({
    accessToken:
      input?.accessToken === null
        ? null
        : createPlaintextGoogleToken(input?.accessToken ?? "access-token"),
    refreshToken:
      input?.refreshToken === null
        ? null
        : createPlaintextGoogleToken(input?.refreshToken ?? "refresh-token"),
    tokenExpiryAt:
      input?.expiry === undefined ? "2026-08-01T01:00:00.000Z" : input.expiry,
    status: "connected",
    scopes: "gmail.readonly",
    credentialVersion: VERSION_0,
  });
}

function harness(options?: {
  refreshed?: GoogleTokenRefreshResult;
  preflightError?: Error;
  refreshError?: Error;
  updateError?: Error;
}) {
  const calls = {
    claims: 0,
    releases: 0,
    preflight: 0,
    refresh: 0,
    updates: [] as UpdateRefreshedGoogleAccessTokenInput[],
  };
  const core = createGoogleAuthCore({
    now: () => NOW_MS,
    preflightEncryptionWrite() {
      calls.preflight += 1;
      if (options?.preflightError) throw options.preflightError;
    },
    async claimRefreshLease() {
      calls.claims += 1;
      return LEASE;
    },
    async releaseRefreshLease() {
      calls.releases += 1;
    },
    async refreshTokens() {
      calls.refresh += 1;
      if (options?.refreshError) throw options.refreshError;
      return (
        options?.refreshed ?? {
          accessToken: createPlaintextGoogleToken("refreshed-access"),
          tokenExpiryAt: REFRESHED_EXPIRY,
        }
      );
    },
    async updateRefreshedTokens(input) {
      calls.updates.push(input);
      if (options?.updateError) throw options.updateError;
      return VERSION_1;
    },
  });

  return { core, calls };
}

test("usable access token returns the same safe handle without side effects", async () => {
  const { core, calls } = harness();
  const original = credentials();

  const result = await core.prepareCredentials(USER_ID, original);

  expect(result).toBe(original);
  expect(calls).toEqual({
    claims: 0,
    releases: 0,
    preflight: 0,
    refresh: 0,
    updates: [],
  });
});

test("missing, invalid, and eagerly expiring access credentials refresh", async () => {
  const inputs = [
    credentials({ accessToken: null }),
    credentials({ expiry: null }),
    credentials({ expiry: "not-a-date" }),
    credentials({
      expiry: new Date(
        NOW_MS + GOOGLE_AUTH_EAGER_REFRESH_THRESHOLD_MS,
      ).toISOString(),
    }),
  ];

  for (const input of inputs) {
    const { core, calls } = harness();
    const result = await core.prepareCredentials(USER_ID, input);
    expect(result.getAccessToken()).toBe("refreshed-access");
    expect(calls.preflight).toBe(1);
    expect(calls.refresh).toBe(1);
    expect(calls.updates).toHaveLength(1);
  }
});

test("missing refresh token and invalid user fail before external work", async () => {
  for (const [userId, input] of [
    [USER_ID, credentials({ expiry: null, refreshToken: null })],
    ["invalid-user", credentials({ expiry: null })],
  ] as const) {
    const { core, calls } = harness();
    await expect(core.prepareCredentials(userId, input)).rejects.toMatchObject({
      code: "GOOGLE_TOKEN_INPUT_INVALID",
    });
    expect(calls).toEqual({
      claims: 0,
      releases: 0,
      preflight: 0,
      refresh: 0,
      updates: [],
    });
  }
});

test("invalid injected current time fails before refresh", async () => {
  const calls = { preflight: 0, refresh: 0, update: 0 };
  const core = createGoogleAuthCore({
    now: () => Number.NaN,
    preflightEncryptionWrite: () => {
      calls.preflight += 1;
    },
    claimRefreshLease: async () => LEASE,
    releaseRefreshLease: async () => undefined,
    refreshTokens: async () => {
      calls.refresh += 1;
      throw new Error("unexpected refresh");
    },
    updateRefreshedTokens: async () => {
      calls.update += 1;
      return VERSION_1;
    },
  });

  await expect(
    core.prepareCredentials(USER_ID, credentials({ expiry: null })),
  ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INPUT_INVALID" });
  expect(calls).toEqual({ preflight: 0, refresh: 0, update: 0 });
});

test("preflight and refresh failures never reach token storage", async () => {
  for (const options of [
    {
      preflightError: new GoogleTokenStoreError("GOOGLE_TOKEN_WRITE_DISABLED"),
    },
    { refreshError: new Error("safe refresh failure") },
  ]) {
    const { core, calls } = harness(options);
    await expect(
      core.prepareCredentials(USER_ID, credentials({ expiry: null })),
    ).rejects.toBeTruthy();
    expect(calls.updates).toHaveLength(0);
  }
});

test("refresh rotation persists both tokens in one atomic store call", async () => {
  const { core, calls } = harness({
    refreshed: {
      accessToken: createPlaintextGoogleToken("rotated-access"),
      refreshToken: createPlaintextGoogleToken("rotated-refresh"),
      tokenExpiryAt: REFRESHED_EXPIRY,
    },
  });

  const result = await core.prepareCredentials(
    USER_ID,
    credentials({ expiry: null }),
  );

  expect(calls.updates).toHaveLength(1);
  expect(calls.updates[0]).toMatchObject({
    userId: USER_ID,
    accessToken: "rotated-access",
    refreshToken: { mode: "update", token: "rotated-refresh" },
    tokenExpiryAt: REFRESHED_EXPIRY,
    expectedCredentialVersion: VERSION_0,
  });
  expect(result.getAccessToken()).toBe("rotated-access");
  expect(result.getRefreshToken()).toBe("rotated-refresh");
  expect(result.getStatus()).toBe("connected");
  expect(result.getScopes()).toBe("gmail.readonly");
  expect(result.getCredentialVersion()).toBe(VERSION_1);
});

test("refresh without rotation preserves refresh and returned handle is reusable", async () => {
  const { core, calls } = harness();
  const first = await core.prepareCredentials(
    USER_ID,
    credentials({ expiry: null }),
  );
  const second = await core.prepareCredentials(USER_ID, first);

  expect(first.getRefreshToken()).toBe("refresh-token");
  expect(second).toBe(first);
  expect(calls.refresh).toBe(1);
  expect(calls.updates).toHaveLength(1);
  expect(calls.updates[0].refreshToken).toEqual({ mode: "preserve" });
});

test("invalid refreshed expiry and storage failure do not return credentials", async () => {
  const invalid = harness({
    refreshed: {
      accessToken: createPlaintextGoogleToken("refreshed-access"),
      tokenExpiryAt: "not-a-date",
    },
  });
  await expect(
    invalid.core.prepareCredentials(USER_ID, credentials({ expiry: null })),
  ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INPUT_INVALID" });
  expect(invalid.calls.updates).toHaveLength(0);

  const failedStore = harness({
    updateError: new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED"),
  });
  await expect(
    failedStore.core.prepareCredentials(USER_ID, credentials({ expiry: null })),
  ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_STORE_FAILED" });
  expect(failedStore.calls.updates).toHaveLength(1);
});

test("auth Core fixed errors never include credential values", async () => {
  const secretAccess = "auth-core-secret-access-token";
  const secretRefresh = "auth-core-secret-refresh-token";
  const { core } = harness();
  let captured: unknown;

  try {
    await core.prepareCredentials(
      "invalid-user",
      credentials({
        accessToken: secretAccess,
        refreshToken: secretRefresh,
        expiry: "invalid-expiry",
      }),
    );
  } catch (error) {
    captured = error;
  }

  expect(captured).toBeInstanceOf(GoogleTokenStoreError);
  expect((captured as Error).message).not.toContain(secretAccess);
  expect((captured as Error).message).not.toContain(secretRefresh);
});

test("refreshCredentialsOnce forces exactly one refresh even with a usable access token", async () => {
  const { core, calls } = harness();

  const result = await core.refreshCredentialsOnce(USER_ID, credentials());

  expect(result.refreshTokenRotated).toBe(false);
  expect(result.credentials.getCredentialVersion()).toBe(VERSION_1);
  expect(calls.preflight).toBe(1);
  expect(calls.refresh).toBe(1);
  expect(calls.updates).toHaveLength(1);
  expect(calls.updates[0].expectedCredentialVersion).toBe(VERSION_0);
});

test("refreshCredentialsOnce reports refresh rotation without exposing token values", async () => {
  const { core, calls } = harness({
    refreshed: {
      accessToken: createPlaintextGoogleToken("rotated-access"),
      refreshToken: createPlaintextGoogleToken("rotated-refresh"),
      tokenExpiryAt: REFRESHED_EXPIRY,
    },
  });

  const result = await core.refreshCredentialsOnce(USER_ID, credentials());

  expect(result.refreshTokenRotated).toBe(true);
  expect(calls.refresh).toBe(1);
  expect(calls.updates).toHaveLength(1);
});
