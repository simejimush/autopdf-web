import { expect, test } from "@playwright/test";
import { createGoogleAuthCore } from "../src/lib/google/authCore";
import { createGoogleRefreshOperationId } from "../src/lib/google/refreshOperationCore";
import {
  createGoogleCredentialVersion,
  createGoogleRefreshLeaseIdHash,
  createGoogleTokenCredentialHandle,
  createPlaintextGoogleToken,
  GoogleTokenStoreError,
} from "../src/lib/google/tokenStoreCore";

const USER_A = "44444444-4444-4444-8444-444444444444";
const USER_B = "55555555-5555-4555-8555-555555555555";
const VERSION_0 = createGoogleCredentialVersion(0);
const VERSION_1 = createGoogleCredentialVersion(1);

function credentials() {
  return createGoogleTokenCredentialHandle({
    accessToken: null,
    refreshToken: createPlaintextGoogleToken("fixture-refresh"),
    tokenExpiryAt: null,
    status: "connected",
    scopes: "gmail.readonly",
    credentialVersion: VERSION_0,
  });
}

function coordinator(waitDuringProvider?: () => Promise<void>) {
  const states = new Map<string, "prepared" | "started" | "completed">();
  let providerCalls = 0;
  const core = createGoogleAuthCore({
    now: () => Date.parse("2026-08-01T00:00:00.000Z"),
    preflightEncryptionWrite() {},
    async prepareRefreshOperation(userId) {
      const state = states.get(userId);
      if (state === "started") {
        throw new GoogleTokenStoreError("GOOGLE_TOKEN_REFRESH_IN_PROGRESS");
      }
      if (state === "completed") {
        return { state: "completed", resultCredentialVersion: VERSION_1 };
      }
      states.set(userId, "prepared");
      const hash = createGoogleRefreshLeaseIdHash(
        (userId === USER_A ? "a" : "b").repeat(64),
      );
      return {
        state: "prepared",
        handle: {
          operationId: createGoogleRefreshOperationId(userId, VERSION_0),
          lease: {
            getIdHash: () => hash,
            toJSON: (): never => {
              throw new Error("lease serialization forbidden");
            },
          },
        },
      };
    },
    async markProviderStarted(userId) {
      states.set(userId, "started");
    },
    async transitionRefreshOperation() {},
    async loadCredentials() {
      return createGoogleTokenCredentialHandle({
        accessToken: createPlaintextGoogleToken("saved-access"),
        refreshToken: createPlaintextGoogleToken("fixture-refresh"),
        tokenExpiryAt: "2026-08-01T01:00:00.000Z",
        status: "connected",
        scopes: "gmail.readonly",
        credentialVersion: VERSION_1,
      });
    },
    classifyProviderFailure: () => "outcome_unknown",
    async refreshTokens() {
      providerCalls += 1;
      await waitDuringProvider?.();
      return {
        accessToken: createPlaintextGoogleToken("saved-access"),
        tokenExpiryAt: "2026-08-01T01:00:00.000Z",
      };
    },
    async finalizeRefreshOperation(input) {
      states.set(input.userId, "completed");
      return VERSION_1;
    },
  });
  return { core, getProviderCalls: () => providerCalls };
}

test("same-user loser and same-operation replay call provider zero times", async () => {
  let release!: () => void;
  let started!: () => void;
  const providerStarted = new Promise<void>((resolve) => (started = resolve));
  const providerRelease = new Promise<void>((resolve) => (release = resolve));
  const harness = coordinator(async () => {
    started();
    await providerRelease;
  });

  const winner = harness.core.refreshCredentialsOnce(USER_A, credentials());
  await providerStarted;
  await expect(
    harness.core.refreshCredentialsOnce(USER_A, credentials()),
  ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_REFRESH_IN_PROGRESS" });
  expect(harness.getProviderCalls()).toBe(1);
  release();
  await winner;
  await harness.core.refreshCredentialsOnce(USER_A, credentials());
  expect(harness.getProviderCalls()).toBe(1);
});

test("different users refresh independently", async () => {
  const harness = coordinator();
  await Promise.all([
    harness.core.refreshCredentialsOnce(USER_A, credentials()),
    harness.core.refreshCredentialsOnce(USER_B, credentials()),
  ]);
  expect(harness.getProviderCalls()).toBe(2);
});
