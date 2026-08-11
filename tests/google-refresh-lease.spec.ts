import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createGoogleCredentialVersion,
  createGoogleRefreshLeaseIdHash,
  createGoogleTokenStore,
  createPlaintextGoogleToken,
  type GoogleConnectionWritePayload,
  type GoogleCredentialVersion,
  type GoogleRefreshLeaseIdHash,
  type GoogleTokenRepository,
} from "../src/lib/google/tokenStoreCore";
import {
  decryptGoogleToken,
  encryptGoogleToken,
} from "../src/lib/security/googleTokenCrypto";

const USER_A = "44444444-4444-4444-8444-444444444444";
const USER_B = "55555555-5555-4555-8555-555555555555";
const VERSION_0 = createGoogleCredentialVersion(0);
const NOW_MS = Date.parse("2026-08-09T08:00:00.000Z");
const LEASE_TTL_MS = 90 * 1000;
const KEY_ID = "refresh-lease-test-key";
const KEY = randomBytes(32).toString("base64url");

type ConnectionState = {
  status: string | null;
  version: GoogleCredentialVersion;
  leaseHash: GoogleRefreshLeaseIdHash | null;
  leaseExpiresAt: string | null;
  accessTokenStored: string | null;
  refreshTokenStored: string | null;
  updates: number;
};

function leaseHash(label: string): GoogleRefreshLeaseIdHash {
  return createGoogleRefreshLeaseIdHash(label.repeat(64).slice(0, 64));
}

function createLeaseHarness() {
  let serverNowMs = NOW_MS;
  const states = new Map<string, ConnectionState>();
  for (const userId of [USER_A, USER_B]) {
    states.set(userId, {
      status: "connected",
      version: VERSION_0,
      leaseHash: null,
      leaseExpiresAt: null,
      accessTokenStored: null,
      refreshTokenStored: `legacy-refresh-${userId.slice(0, 1)}`,
      updates: 0,
    });
  }

  const repository: GoogleTokenRepository = {
    async selectConnectionsByUserId(input) {
      const state = states.get(input.userId);
      if (!state) return { ok: true, rows: [] };
      return {
        ok: true,
        rows: [
          {
            accessTokenStored: state.accessTokenStored,
            refreshTokenStored: state.refreshTokenStored,
            statusStored: state.status,
            tokenExpiryAtStored: null,
            scopesStored: "gmail.readonly drive.file",
            credentialVersionStored: state.version,
          },
        ],
      };
    },
    async insertConnection() {
      return { ok: false };
    },
    async updateConnectionByCredentialVersion(input) {
      const state = states.get(input.userId);
      if (
        !state ||
        state.status !== input.expectedStatus ||
        state.version !== input.expectedCredentialVersion
      ) {
        return { ok: true, credentialVersions: [] };
      }
      if (
        input.expectedRefreshLeaseIdHash !== undefined &&
        state.leaseHash !== input.expectedRefreshLeaseIdHash
      ) {
        return { ok: true, credentialVersions: [] };
      }
      applyPayload(state, input.payload);
      state.updates += 1;
      return { ok: true, credentialVersions: [state.version] };
    },
    async claimGoogleCredentialRefreshLease(input) {
      const state = states.get(input.userId);
      if (!state) return { ok: true, credentialVersions: [] };
      const leaseIsAvailable =
        state.leaseHash === null ||
        (state.leaseHash !== null &&
          state.leaseExpiresAt !== null &&
          Date.parse(state.leaseExpiresAt) <= serverNowMs);
      if (
        state.status !== input.expectedStatus ||
        state.version !== input.expectedCredentialVersion ||
        !leaseIsAvailable
      ) {
        return { ok: true, credentialVersions: [] };
      }
      state.leaseHash = input.leaseIdHash;
      state.leaseExpiresAt = new Date(serverNowMs + LEASE_TTL_MS).toISOString();
      return {
        ok: true,
        credentialVersions: [input.expectedCredentialVersion],
      };
    },
  };

  const store = createGoogleTokenStore({
    repository,
    now: () => new Date(NOW_MS).toISOString(),
    crypto: {
      encrypt({ token, userId, tokenType }) {
        return encryptGoogleToken({
          token,
          userId,
          tokenType,
          keyId: KEY_ID,
          key: KEY,
        });
      },
      decrypt({ token, userId, tokenType }) {
        if (!token.startsWith("autopdf-token:")) return token;
        return decryptGoogleToken({
          token,
          userId,
          tokenType,
          keyId: KEY_ID,
          key: KEY,
        });
      },
    },
  });

  return {
    store,
    states,
    advanceServerTo(ms: number) {
      serverNowMs = ms;
    },
  };
}

function applyPayload(
  state: ConnectionState,
  payload: GoogleConnectionWritePayload,
) {
  if (payload.status !== undefined) state.status = payload.status;
  if (payload.credential_version !== undefined) {
    state.version = payload.credential_version;
  }
  if (Object.hasOwn(payload, "refresh_lease_id_hash")) {
    state.leaseHash = payload.refresh_lease_id_hash ?? null;
  }
  if (Object.hasOwn(payload, "refresh_lease_expires_at")) {
    state.leaseExpiresAt = payload.refresh_lease_expires_at ?? null;
  }
  if (Object.hasOwn(payload, "access_token_enc")) {
    state.accessTokenStored = payload.access_token_enc ?? null;
  }
  if (Object.hasOwn(payload, "refresh_token_enc")) {
    state.refreshTokenStored = payload.refresh_token_enc ?? null;
  }
}

async function claim(
  harness: ReturnType<typeof createLeaseHarness>,
  userId: string,
  hash: GoogleRefreshLeaseIdHash,
  claimedAtMs: number,
) {
  harness.advanceServerTo(claimedAtMs);
  await harness.store.claimGoogleCredentialRefreshLease({
    userId,
    expectedStatus: "connected",
    expectedCredentialVersion: VERSION_0,
    leaseIdHash: hash,
  });
}

test("lease claim is atomic, active leases cannot be stolen, and expired leases can be reclaimed", async () => {
  const harness = createLeaseHarness();
  const first = leaseHash("a");
  const second = leaseHash("b");
  await claim(harness, USER_A, first, NOW_MS);
  expect(harness.states.get(USER_A)?.leaseHash).toBe(first);

  await expect(
    claim(harness, USER_A, second, NOW_MS + 1),
  ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_UPDATE_CONFLICT" });
  await claim(harness, USER_A, second, NOW_MS + LEASE_TTL_MS);
  expect(harness.states.get(USER_A)?.leaseHash).toBe(second);
});

test("wrong owner, status, version, and lease hash fail closed", async () => {
  const harness = createLeaseHarness();
  const owner = leaseHash("a");
  await claim(harness, USER_A, owner, NOW_MS);
  const invalidActions = [
    () =>
      harness.store.releaseGoogleCredentialRefreshLease({
        userId: USER_B,
        expectedStatus: "connected",
        expectedCredentialVersion: VERSION_0,
        leaseIdHash: owner,
      }),
    () =>
      harness.store.releaseGoogleCredentialRefreshLease({
        userId: USER_A,
        expectedStatus: "error",
        expectedCredentialVersion: VERSION_0,
        leaseIdHash: owner,
      }),
    () =>
      harness.store.releaseGoogleCredentialRefreshLease({
        userId: USER_A,
        expectedStatus: "connected",
        expectedCredentialVersion: createGoogleCredentialVersion(1),
        leaseIdHash: owner,
      }),
    () =>
      harness.store.releaseGoogleCredentialRefreshLease({
        userId: USER_A,
        expectedStatus: "connected",
        expectedCredentialVersion: VERSION_0,
        leaseIdHash: leaseHash("b"),
      }),
  ];
  for (const action of invalidActions) {
    await expect(action()).rejects.toMatchObject({
      code: "GOOGLE_TOKEN_UPDATE_CONFLICT",
    });
  }
  expect(harness.states.get(USER_A)?.leaseHash).toBe(owner);
});

test("successful save encrypts tokens, increments version, and clears the owned lease atomically", async () => {
  const harness = createLeaseHarness();
  const owner = leaseHash("a");
  await claim(harness, USER_A, owner, NOW_MS);
  const version = await harness.store.updateRefreshedGoogleAccessToken({
    userId: USER_A,
    accessToken: createPlaintextGoogleToken("rotated-access"),
    refreshToken: {
      mode: "update",
      token: createPlaintextGoogleToken("rotated-refresh"),
    },
    tokenExpiryAt: new Date(NOW_MS + 3600000).toISOString(),
    lastVerifiedAt: new Date(NOW_MS).toISOString(),
    updatedAt: new Date(NOW_MS).toISOString(),
    expectedCredentialVersion: VERSION_0,
    refreshLeaseIdHash: owner,
  });
  const state = harness.states.get(USER_A)!;
  expect(version).toBe(createGoogleCredentialVersion(1));
  expect(state.leaseHash).toBeNull();
  expect(state.leaseExpiresAt).toBeNull();
  expect(state.accessTokenStored).toMatch(/^autopdf-token:/);
  expect(state.refreshTokenStored).toMatch(/^autopdf-token:/);
});

test("wrong lease hash and stale version cannot save credentials", async () => {
  const harness = createLeaseHarness();
  const owner = leaseHash("a");
  await claim(harness, USER_A, owner, NOW_MS);
  for (const [hash, version] of [
    [leaseHash("b"), VERSION_0],
    [owner, createGoogleCredentialVersion(1)],
  ] as const) {
    await expect(
      harness.store.updateRefreshedGoogleAccessToken({
        userId: USER_A,
        accessToken: createPlaintextGoogleToken("rejected-access"),
        tokenExpiryAt: null,
        lastVerifiedAt: new Date(NOW_MS).toISOString(),
        updatedAt: new Date(NOW_MS).toISOString(),
        expectedCredentialVersion: version,
        refreshLeaseIdHash: hash,
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_UPDATE_CONFLICT" });
  }
  expect(harness.states.get(USER_A)).toMatchObject({
    version: VERSION_0,
    leaseHash: owner,
    accessTokenStored: null,
  });
});

test("disconnect is rejected during an active lease and succeeds after expiry", async () => {
  const harness = createLeaseHarness();
  await claim(harness, USER_A, leaseHash("a"), NOW_MS);
  await expect(
    claim(harness, USER_A, leaseHash("b"), NOW_MS + 1),
  ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_UPDATE_CONFLICT" });
  const disconnectLease = leaseHash("b");
  await claim(harness, USER_A, disconnectLease, NOW_MS + LEASE_TTL_MS);
  await harness.store.disconnectGoogleConnection({
    userId: USER_A,
    expectedStatus: "connected",
    expectedCredentialVersion: VERSION_0,
    refreshLeaseIdHash: disconnectLease,
  });
  expect(harness.states.get(USER_A)).toMatchObject({
    status: "disconnected",
    version: createGoogleCredentialVersion(1),
    leaseHash: null,
  });
});

test("lease digest validation rejects malformed, uppercase, and nonhex values", () => {
  for (const value of ["a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
    expect(() => createGoogleRefreshLeaseIdHash(value)).toThrowError(
      /Google token store input is invalid/,
    );
  }
});

test("runtime lease identity uses a non-serializable 32-byte CSPRNG secret and stores only SHA-256", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/google/tokenStore.ts"),
    "utf8",
  );
  expect(source).toContain("GOOGLE_REFRESH_LEASE_SECRET_BYTES = 32");
  expect(source).toContain("randomBytes(GOOGLE_REFRESH_LEASE_SECRET_BYTES)");
  expect(source).toContain('createHash("sha256")');
  expect(source).toContain("Google refresh lease cannot be serialized");
  expect(source).not.toMatch(
    /refresh_lease_(id_hash|expires_at).*rawLeaseSecret/,
  );
});
