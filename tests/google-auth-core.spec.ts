import { expect, test } from "@playwright/test";
import {
  createGoogleAuthCore,
  GOOGLE_AUTH_EAGER_REFRESH_THRESHOLD_MS,
  type GoogleTokenRefreshResult,
} from "../src/lib/google/authCore";
import { createGoogleRefreshOperationId } from "../src/lib/google/refreshOperationCore";
import {
  createGoogleCredentialVersion,
  createGoogleRefreshLeaseIdHash,
  createGoogleTokenCredentialHandle,
  createPlaintextGoogleToken,
  GoogleTokenStoreError,
  type GoogleTokenCredentials,
} from "../src/lib/google/tokenStoreCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const NOW_MS = Date.parse("2026-08-01T00:00:00.000Z");
const REFRESHED_EXPIRY = "2026-08-01T01:00:00.000Z";
const VERSION_0 = createGoogleCredentialVersion(0);
const VERSION_1 = createGoogleCredentialVersion(1);
const LEASE_HASH = createGoogleRefreshLeaseIdHash("a".repeat(64));
const HANDLE = Object.freeze({
  operationId: createGoogleRefreshOperationId(USER_ID, VERSION_0),
  lease: Object.freeze({
    getIdHash: () => LEASE_HASH,
    toJSON: (): never => {
      throw new Error("lease serialization forbidden");
    },
  }),
});

function credentials(input?: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiry?: string | null;
  version?: 0 | 1;
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
    credentialVersion: input?.version === 1 ? VERSION_1 : VERSION_0,
  });
}

function harness(options?: {
  prepareState?: "prepared" | "completed";
  prepareError?: Error;
  refreshed?: GoogleTokenRefreshResult;
  preflightError?: Error;
  markError?: Error;
  refreshError?: Error;
  finalizeError?: Error;
  terminalProviderFailure?: boolean;
}) {
  const calls = {
    prepare: 0,
    preflight: 0,
    mark: 0,
    provider: 0,
    finalize: 0,
    finalizedRefreshTokens: [] as Array<string | undefined>,
    load: 0,
    transitions: [] as string[],
  };
  const core = createGoogleAuthCore({
    now: () => NOW_MS,
    preflightEncryptionWrite() {
      calls.preflight += 1;
      if (options?.preflightError) throw options.preflightError;
    },
    async prepareRefreshOperation() {
      calls.prepare += 1;
      if (options?.prepareError) throw options.prepareError;
      return options?.prepareState === "completed"
        ? { state: "completed" as const, resultCredentialVersion: VERSION_1 }
        : { state: "prepared" as const, handle: HANDLE };
    },
    async markProviderStarted() {
      calls.mark += 1;
      if (options?.markError) throw options.markError;
    },
    async transitionRefreshOperation(input) {
      calls.transitions.push(input.targetState);
    },
    async loadCredentials() {
      calls.load += 1;
      return credentials({ version: 1 });
    },
    classifyProviderFailure() {
      return options?.terminalProviderFailure
        ? "failed_terminal"
        : "outcome_unknown";
    },
    async refreshTokens() {
      calls.provider += 1;
      if (options?.refreshError) throw options.refreshError;
      return (
        options?.refreshed ?? {
          accessToken: createPlaintextGoogleToken("refreshed-access"),
          tokenExpiryAt: REFRESHED_EXPIRY,
        }
      );
    },
    async finalizeRefreshOperation(input) {
      calls.finalize += 1;
      calls.finalizedRefreshTokens.push(input.refreshToken);
      if (options?.finalizeError) throw options.finalizeError;
      return VERSION_1;
    },
  });
  return { core, calls };
}

test("usable access token returns without starting an operation", async () => {
  const { core, calls } = harness();
  const original = credentials();
  expect(await core.prepareCredentials(USER_ID, original)).toBe(original);
  expect(calls.prepare).toBe(0);
  expect(calls.provider).toBe(0);
});

test("missing, invalid, and eagerly expiring access credentials refresh once", async () => {
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
    expect(calls).toMatchObject({
      prepare: 1,
      mark: 1,
      provider: 1,
      finalize: 1,
    });
  }
});

test("completed operation replay loads the committed version without provider call", async () => {
  const { core, calls } = harness({ prepareState: "completed" });
  const result = await core.refreshCredentialsOnce(USER_ID, credentials());
  expect(result.credentials.getCredentialVersion()).toBe(VERSION_1);
  expect(calls).toMatchObject({ provider: 0, finalize: 0, load: 1 });
});

test("outcome_unknown replay fails closed without provider call", async () => {
  const { core, calls } = harness({
    prepareError: new GoogleTokenStoreError("GOOGLE_REFRESH_OUTCOME_UNKNOWN"),
  });
  await expect(
    core.refreshCredentialsOnce(USER_ID, credentials()),
  ).rejects.toMatchObject({ code: "GOOGLE_REFRESH_OUTCOME_UNKNOWN" });
  expect(calls).toMatchObject({ provider: 0, mark: 0, finalize: 0 });
});

test("preflight failure becomes retryable before provider start", async () => {
  const { core, calls } = harness({
    preflightError: new GoogleTokenStoreError("GOOGLE_TOKEN_WRITE_DISABLED"),
  });
  await expect(
    core.refreshCredentialsOnce(USER_ID, credentials()),
  ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_WRITE_DISABLED" });
  expect(calls.provider).toBe(0);
  expect(calls.transitions).toEqual(["retryable"]);
});

test("provider-start persistence failure does not call the provider", async () => {
  const { core, calls } = harness({
    markError: new Error("store unavailable"),
  });
  await expect(
    core.refreshCredentialsOnce(USER_ID, credentials()),
  ).rejects.toBeTruthy();
  expect(calls.provider).toBe(0);
  expect(calls.transitions).toEqual([]);
});

test("provider or finalize ambiguity transitions to outcome_unknown", async () => {
  for (const options of [
    { refreshError: new Error("timeout") },
    { finalizeError: new Error("response lost") },
  ]) {
    const { core, calls } = harness(options);
    await expect(
      core.refreshCredentialsOnce(USER_ID, credentials()),
    ).rejects.toMatchObject({ code: "GOOGLE_REFRESH_OUTCOME_UNKNOWN" });
    expect(calls.provider).toBe(1);
    expect(calls.transitions).toEqual(["outcome_unknown"]);
  }
});

test("invalid or non-future refreshed expiry never reaches finalization", async () => {
  for (const tokenExpiryAt of [
    "",
    "not-a-date",
    "1970-01-01T00:00:00.000Z",
    new Date(NOW_MS - 1).toISOString(),
    new Date(NOW_MS).toISOString(),
  ]) {
    const { core, calls } = harness({
      refreshed: {
        accessToken: createPlaintextGoogleToken("refreshed-access"),
        tokenExpiryAt,
      },
    });

    await expect(
      core.refreshCredentialsOnce(
        USER_ID,
        credentials({
          expiry: "1970-01-01T00:00:00.000Z",
        }),
      ),
    ).rejects.toMatchObject({ code: "GOOGLE_REFRESH_OUTCOME_UNKNOWN" });
    expect(calls.provider).toBe(1);
    expect(calls.finalize).toBe(0);
    expect(calls.transitions).toEqual(["outcome_unknown"]);
  }
});

test("confirmed invalid grant becomes terminal and is not rewritten as unknown", async () => {
  const invalidGrant = new Error("invalid grant");
  const { core, calls } = harness({
    refreshError: invalidGrant,
    terminalProviderFailure: true,
  });
  await expect(
    core.refreshCredentialsOnce(USER_ID, credentials()),
  ).rejects.toBe(invalidGrant);
  expect(calls.transitions).toEqual(["failed_terminal"]);
});

test("rotation returns the new refresh token without logging or serialization", async () => {
  const { core, calls } = harness({
    refreshed: {
      accessToken: createPlaintextGoogleToken("rotated-access"),
      refreshToken: createPlaintextGoogleToken("rotated-refresh"),
      tokenExpiryAt: REFRESHED_EXPIRY,
    },
  });
  const result = await core.refreshCredentialsOnce(USER_ID, credentials());
  expect(result.refreshTokenRotated).toBe(true);
  expect(result.credentials.getRefreshToken()).toBe("rotated-refresh");
  expect(calls.finalizedRefreshTokens).toEqual(["rotated-refresh"]);
  expect(calls.finalize).toBe(1);
});

test("preserved refresh token is finalized for lazy encryption without reporting rotation", async () => {
  const { core, calls } = harness();
  const result = await core.refreshCredentialsOnce(
    USER_ID,
    credentials({ refreshToken: "preserved-refresh" }),
  );

  expect(result.refreshTokenRotated).toBe(false);
  expect(result.credentials.getRefreshToken()).toBe("preserved-refresh");
  expect(calls.finalizedRefreshTokens).toEqual(["preserved-refresh"]);
  expect(calls.finalize).toBe(1);
});
