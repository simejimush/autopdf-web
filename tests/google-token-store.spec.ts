import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { expect, test } from "@playwright/test";
import {
  createGoogleTokenCredentialHandle,
  createGoogleTokenEncryptionWritePreflight,
  createGoogleTokenStore,
  createGoogleCredentialVersion,
  createGoogleRefreshLeaseIdHash,
  createPlaintextGoogleToken,
  GOOGLE_CALLBACK_REFRESH_COLUMNS,
  GOOGLE_CALLBACK_SNAPSHOT_COLUMNS,
  GOOGLE_TOKEN_CREDENTIAL_COLUMNS,
  GoogleTokenCredentialSerializationError,
  GoogleTokenStoreError,
  type GoogleConnectionWritePayload,
  type GoogleCredentialVersion,
  type GoogleTokenConnectionRow,
  type GoogleTokenRepository,
  type GoogleTokenStoreErrorCode,
  type PlaintextGoogleToken,
  type SaveGoogleCallbackConnectionInput,
} from "../src/lib/google/tokenStoreCore";
import {
  decryptGoogleToken,
  encryptGoogleToken,
  GoogleTokenCryptoError,
  type GoogleTokenType,
} from "../src/lib/security/googleTokenCrypto";
import {
  createGoogleTokenRepository,
  type GoogleTokenSupabaseClient,
} from "../src/lib/google/tokenStoreRepository";
import { getRunErrorMessage } from "../src/lib/runs/getRunErrorMessage";
import { normalizeRunErrorCode } from "../src/lib/runs/normalizeRunErrorCode";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const KEY_ID = "token-store-test-key";
const NOW = "2026-08-01T00:00:00.000Z";
const EXPIRY = "2026-08-01T01:00:00.000Z";
const VERSION_0 = createGoogleCredentialVersion(0);
const VERSION_1 = createGoogleCredentialVersion(1);
const LEASE_HASH = createGoogleRefreshLeaseIdHash("a".repeat(64));

function disconnectInput(userId = USER_ID) {
  return {
    userId,
    expectedStatus: "connected",
    expectedCredentialVersion: VERSION_0,
    refreshLeaseIdHash: LEASE_HASH,
  } as const;
}

type SelectResult =
  | { ok: true; rows: readonly GoogleTokenConnectionRow[] }
  | { ok: false };
type WriteResult = { ok: true; count: number } | { ok: false };

type RepositoryCalls = {
  selects: Array<{
    userId: string;
    columns: readonly string[];
  }>;
  inserts: Array<{
    userId: string;
    payload: GoogleConnectionWritePayload;
  }>;
  updates: Array<{
    userId: string;
    expectedStatus: string | null;
    expectedCredentialVersion: GoogleCredentialVersion;
    payload: GoogleConnectionWritePayload;
  }>;
};

function createKey(): string {
  return randomBytes(32).toString("base64url");
}

function createCryptoAdapter(options?: {
  key?: string;
  failEncryptType?: GoogleTokenType;
  encryptErrorCode?: "GOOGLE_TOKEN_KEY_MISSING" | "GOOGLE_TOKEN_KEY_INVALID";
  encryptedOutput?: string;
  onDecrypt?: (tokenType: GoogleTokenType) => void;
}) {
  const key = options?.key ?? createKey();

  return {
    key,
    adapter: {
      encrypt(input: {
        token: PlaintextGoogleToken;
        userId: string;
        tokenType: GoogleTokenType;
      }) {
        if (options?.encryptErrorCode) {
          throw new GoogleTokenCryptoError(options.encryptErrorCode);
        }

        if (input.tokenType === options?.failEncryptType) {
          throw new Error("test encryption failure");
        }

        if (options?.encryptedOutput) {
          return options.encryptedOutput;
        }

        return encryptGoogleToken({
          token: input.token,
          userId: input.userId,
          tokenType: input.tokenType,
          keyId: KEY_ID,
          key,
        });
      },
      decrypt(input: {
        token: string;
        userId: string;
        tokenType: GoogleTokenType;
      }) {
        options?.onDecrypt?.(input.tokenType);
        return decryptGoogleToken({
          token: input.token,
          userId: input.userId,
          tokenType: input.tokenType,
          keyId: KEY_ID,
          key,
        });
      },
    },
  };
}

function createRepository(options?: {
  selectResult?: SelectResult;
  insertResult?: WriteResult;
  updateResult?: WriteResult;
}) {
  const calls: RepositoryCalls = {
    selects: [],
    inserts: [],
    updates: [],
  };
  const repository: GoogleTokenRepository = {
    async selectConnectionsByUserId(input) {
      calls.selects.push({
        userId: input.userId,
        columns: [...input.columns],
      });
      return (
        options?.selectResult ?? {
          ok: true,
          rows: [
            {
              statusStored: "connected",
              credentialVersionStored: VERSION_0,
            },
          ],
        }
      );
    },
    async insertConnection(input) {
      calls.inserts.push({ userId: input.userId, payload: input.payload });
      const result = options?.insertResult ?? { ok: true, count: 1 };
      return result.ok
        ? {
            ok: true,
            credentialVersions: Array.from(
              { length: result.count },
              () => input.payload.credential_version ?? VERSION_0,
            ),
          }
        : result;
    },
    async updateConnectionByCredentialVersion(input) {
      calls.updates.push({
        userId: input.userId,
        expectedStatus: input.expectedStatus,
        expectedCredentialVersion: input.expectedCredentialVersion,
        payload: input.payload,
      });
      const result = options?.updateResult ?? { ok: true, count: 1 };
      return result.ok
        ? {
            ok: true,
            credentialVersions: Array.from(
              { length: result.count },
              () => input.payload.credential_version ?? VERSION_1,
            ),
          }
        : result;
    },
    async claimGoogleCredentialRefreshLease(input) {
      const result = options?.updateResult ?? { ok: true, count: 1 };
      return result.ok
        ? {
            ok: true,
            credentialVersions: Array.from(
              { length: result.count },
              () => input.expectedCredentialVersion,
            ),
          }
        : result;
    },
  };

  return { repository, calls };
}

function createHarness(options?: {
  selectResult?: SelectResult;
  insertResult?: WriteResult;
  updateResult?: WriteResult;
  key?: string;
  failEncryptType?: GoogleTokenType;
  encryptErrorCode?: "GOOGLE_TOKEN_KEY_MISSING" | "GOOGLE_TOKEN_KEY_INVALID";
  encryptedOutput?: string;
  onDecrypt?: (tokenType: GoogleTokenType) => void;
}) {
  const repository = createRepository(options);
  const crypto = createCryptoAdapter(options);
  const store = createGoogleTokenStore({
    repository: repository.repository,
    crypto: crypto.adapter,
    now: () => NOW,
  });

  return { store, calls: repository.calls, key: crypto.key };
}

function createStatefulCasHarness() {
  const crypto = createCryptoAdapter();
  const state: {
    userId: string;
    status: string | null;
    credentialVersion: GoogleCredentialVersion;
    refreshTokenStored: string | null;
    lastPayload: GoogleConnectionWritePayload | null;
  } = {
    userId: USER_ID,
    status: "connected",
    credentialVersion: VERSION_0,
    refreshTokenStored: "legacy-refresh-token",
    lastPayload: null,
  };
  const repository: GoogleTokenRepository = {
    async selectConnectionsByUserId(input) {
      if (input.userId !== state.userId) {
        return { ok: true, rows: [] };
      }
      return {
        ok: true,
        rows: [
          {
            refreshTokenStored: state.refreshTokenStored,
            statusStored: state.status,
            credentialVersionStored: state.credentialVersion,
          },
        ],
      };
    },
    async insertConnection() {
      return { ok: false };
    },
    async updateConnectionByCredentialVersion(input) {
      if (
        input.userId !== state.userId ||
        input.expectedStatus !== state.status ||
        input.expectedCredentialVersion !== state.credentialVersion
      ) {
        return { ok: true, credentialVersions: [] };
      }
      const nextVersion = input.payload.credential_version;
      if (nextVersion === undefined) {
        return { ok: false };
      }
      state.status = input.payload.status ?? state.status;
      state.credentialVersion = nextVersion;
      if (
        Object.prototype.hasOwnProperty.call(input.payload, "refresh_token_enc")
      ) {
        state.refreshTokenStored = input.payload.refresh_token_enc ?? null;
      }
      state.lastPayload = input.payload;
      return { ok: true, credentialVersions: [nextVersion] };
    },
    async claimGoogleCredentialRefreshLease(input) {
      if (
        input.userId !== state.userId ||
        input.expectedStatus !== state.status ||
        input.expectedCredentialVersion !== state.credentialVersion
      ) {
        return { ok: true, credentialVersions: [] };
      }
      return {
        ok: true,
        credentialVersions: [input.expectedCredentialVersion],
      };
    },
  };
  const store = createGoogleTokenStore({
    repository,
    crypto: crypto.adapter,
    now: () => NOW,
  });
  return { store, state };
}

function expectStoreError(
  error: unknown,
  code: GoogleTokenStoreErrorCode,
): void {
  expect(error).toBeInstanceOf(GoogleTokenStoreError);
  expect((error as GoogleTokenStoreError).code).toBe(code);
}

async function expectStoreErrorAsync(
  action: () => Promise<unknown>,
  code: GoogleTokenStoreErrorCode,
): Promise<GoogleTokenStoreError> {
  try {
    await action();
  } catch (error) {
    expectStoreError(error, code);
    return error as GoogleTokenStoreError;
  }

  throw new Error(`Expected ${code}`);
}

function callbackInput(options?: {
  writeMode?: "insert" | "update";
  accessToken?: string;
  refreshToken?: SaveGoogleCallbackConnectionInput["refreshToken"];
}): SaveGoogleCallbackConnectionInput {
  return {
    userId: USER_ID,
    writeMode: options?.writeMode ?? "insert",
    accessToken: createPlaintextGoogleToken(
      options?.accessToken ?? "callback-access-token",
    ),
    refreshToken: options?.refreshToken ?? {
      mode: "update",
      token: createPlaintextGoogleToken("callback-refresh-token"),
    },
    state: {
      tokenExpiryAt: EXPIRY,
      scopes: "gmail.readonly drive.file",
      lastVerifiedAt: NOW,
      lastUserNotifiedAt: null,
      lastUserNotifiedErrorCode: null,
      updatedAt: NOW,
    },
    ...(options?.writeMode === "update"
      ? {
          expectedStatus: "connected",
          expectedCredentialVersion: VERSION_0,
          refreshLeaseIdHash: LEASE_HASH,
        }
      : {}),
  };
}

type RawSupabaseResult = Readonly<{ data: unknown; error: unknown }>;

function createSupabaseRepositoryHarness(options?: {
  selectResult?: RawSupabaseResult;
  insertResult?: RawSupabaseResult;
  updateResult?: RawSupabaseResult;
  getClientError?: Error;
  queryThrow?: Readonly<{
    operation: "select" | "insert" | "update";
    stage: "builder" | "await";
    error: Error;
  }>;
}) {
  const calls = {
    clientLoads: 0,
    from: [] as string[],
    select: [] as string[],
    eq: [] as Array<{ column: string; value: string }>,
    or: [] as string[],
    limit: [] as number[],
    insert: [] as Array<Record<string, unknown>>,
    update: [] as GoogleConnectionWritePayload[],
    rpc: [] as Array<{ functionName: string; args: Record<string, unknown> }>,
    writeSelect: [] as string[],
  };
  const client: GoogleTokenSupabaseClient = {
    async rpc(functionName, args) {
      calls.rpc.push({ functionName, args });
      return (
        options?.updateResult ?? {
          data: [{ id: "row", credential_version: 0 }],
          error: null,
        }
      );
    },
    from(table) {
      calls.from.push(table);
      return {
        select(columns) {
          if (
            options?.queryThrow?.operation === "select" &&
            options.queryThrow.stage === "builder"
          ) {
            throw options.queryThrow.error;
          }

          calls.select.push(columns);
          return {
            eq(column, value) {
              calls.eq.push({ column, value });
              return {
                async limit(count) {
                  if (
                    options?.queryThrow?.operation === "select" &&
                    options.queryThrow.stage === "await"
                  ) {
                    throw options.queryThrow.error;
                  }

                  calls.limit.push(count);
                  return (
                    options?.selectResult ?? {
                      data: [
                        Object.fromEntries(
                          columns
                            .split(",")
                            .map((selectedColumn) => [
                              selectedColumn,
                              selectedColumn === "status"
                                ? "connected"
                                : selectedColumn === "credential_version"
                                  ? 0
                                  : null,
                            ]),
                        ),
                      ],
                      error: null,
                    }
                  );
                },
              };
            },
          };
        },
        insert(payload) {
          if (
            options?.queryThrow?.operation === "insert" &&
            options.queryThrow.stage === "builder"
          ) {
            throw options.queryThrow.error;
          }

          calls.insert.push(payload);
          return {
            async select(columns) {
              if (
                options?.queryThrow?.operation === "insert" &&
                options.queryThrow.stage === "await"
              ) {
                throw options.queryThrow.error;
              }

              calls.writeSelect.push(columns);
              return (
                options?.insertResult ?? {
                  data: [{ id: "row", credential_version: 0 }],
                  error: null,
                }
              );
            },
          };
        },
        update(payload) {
          if (
            options?.queryThrow?.operation === "update" &&
            options.queryThrow.stage === "builder"
          ) {
            throw options.queryThrow.error;
          }

          calls.update.push(payload);
          const filter = {
            eq(
              column:
                | "user_id"
                | "status"
                | "credential_version"
                | "refresh_lease_id_hash",
              value: string,
            ) {
              calls.eq.push({ column, value });
              return filter;
            },
            is(column: "status", value: null) {
              calls.eq.push({ column, value: String(value) });
              return filter;
            },
            or(filters: string) {
              calls.or.push(filters);
              return filter;
            },
            async select(columns: "id,credential_version") {
              if (
                options?.queryThrow?.operation === "update" &&
                options.queryThrow.stage === "await"
              ) {
                throw options.queryThrow.error;
              }

              calls.writeSelect.push(columns);
              return (
                options?.updateResult ?? {
                  data: [
                    {
                      id: "row",
                      credential_version:
                        payload.credential_version ?? VERSION_0,
                    },
                  ],
                  error: null,
                }
              );
            },
          };
          return filter;
        },
      };
    },
  };
  const repository = createGoogleTokenRepository(async () => {
    calls.clientLoads += 1;
    if (options?.getClientError) {
      throw options.getClientError;
    }
    return client;
  });
  const crypto = createCryptoAdapter();
  const store = createGoogleTokenStore({
    repository,
    crypto: crypto.adapter,
    now: () => NOW,
  });

  return { store, repository, calls };
}

test("valid UUID is passed to the repository user boundary", async () => {
  const { store, calls } = createHarness();

  await store.disconnectGoogleConnection(disconnectInput());

  expect(calls.updates).toHaveLength(1);
  expect(calls.updates[0].userId).toBe(USER_ID);
});

test("empty and invalid UUIDs fail before repository access", async () => {
  for (const userId of ["", "not-a-uuid", "secret-user-id-value"]) {
    const { store, calls } = createHarness();
    const error = await expectStoreErrorAsync(
      () => store.disconnectGoogleConnection(disconnectInput(userId)),
      "GOOGLE_TOKEN_INPUT_INVALID",
    );

    expect(calls.updates).toHaveLength(0);
    if (userId) {
      expect(error.message).not.toContain(userId);
    }
  }
});

test("whitespace plaintext tokens fail without normalization", () => {
  const opaqueToken = "  opaque-token  ";
  expect(createPlaintextGoogleToken(opaqueToken)).toBe(opaqueToken);

  for (const token of ["", " ", "\t\r\n"]) {
    try {
      createPlaintextGoogleToken(token);
      throw new Error("Expected plaintext validation to fail");
    } catch (error) {
      expectStoreError(error, "GOOGLE_TOKEN_ENCRYPT_FAILED");
    }
  }
});

test("load distinguishes missing, duplicate, and DB failure rows", async () => {
  const cases: Array<{
    result: SelectResult;
    code: GoogleTokenStoreErrorCode;
  }> = [
    {
      result: { ok: true, rows: [] },
      code: "GOOGLE_TOKEN_ROW_NOT_FOUND",
    },
    {
      result: { ok: true, rows: [{}, {}] },
      code: "GOOGLE_TOKEN_ROW_DUPLICATE",
    },
    { result: { ok: false }, code: "GOOGLE_TOKEN_STORE_FAILED" },
  ];

  for (const testCase of cases) {
    const { store } = createHarness({ selectResult: testCase.result });
    await expectStoreErrorAsync(
      () => store.loadGoogleTokenCredentials(USER_ID),
      testCase.code,
    );
  }
});

test("load dual-reads legacy access and refresh with explicit columns", async () => {
  const decryptTypes: GoogleTokenType[] = [];
  const { store, calls } = createHarness({
    selectResult: {
      ok: true,
      rows: [
        {
          accessTokenStored: "legacy-access-token",
          refreshTokenStored: "legacy-refresh-token",
          credentialVersionStored: VERSION_0,
        },
      ],
    },
    onDecrypt: (tokenType) => decryptTypes.push(tokenType),
  });

  const credentials = await store.loadGoogleTokenCredentials(USER_ID);

  expect(credentials.getAccessToken()).toBe("legacy-access-token");
  expect(credentials.getRefreshToken()).toBe("legacy-refresh-token");
  expect(credentials.getTokenExpiryAt()).toBeNull();
  expect(decryptTypes).toEqual(["access", "refresh"]);
  expect(calls.selects).toEqual([
    { userId: USER_ID, columns: [...GOOGLE_TOKEN_CREDENTIAL_COLUMNS] },
  ]);
});

test("load decrypts encrypted access and refresh with separate AAD", async () => {
  const key = createKey();
  const accessToken = encryptGoogleToken({
    token: "encrypted-access-token",
    userId: USER_ID,
    tokenType: "access",
    keyId: KEY_ID,
    key,
  });
  const refreshToken = encryptGoogleToken({
    token: "encrypted-refresh-token",
    userId: USER_ID,
    tokenType: "refresh",
    keyId: KEY_ID,
    key,
  });
  const { store } = createHarness({
    key,
    selectResult: {
      ok: true,
      rows: [
        {
          accessTokenStored: accessToken,
          refreshTokenStored: refreshToken,
          credentialVersionStored: VERSION_0,
        },
      ],
    },
  });

  const credentials = await store.loadGoogleTokenCredentials(USER_ID);

  expect(credentials.getAccessToken()).toBe("encrypted-access-token");
  expect(credentials.getRefreshToken()).toBe("encrypted-refresh-token");
  expect(credentials.getTokenExpiryAt()).toBeNull();
});

test("credential handle preserves token and expiry variants exactly", () => {
  const accessToken = createPlaintextGoogleToken("  opaque-access-token  ");
  const refreshToken = createPlaintextGoogleToken("opaque-refresh-token");
  const cases = [
    { accessToken, refreshToken, tokenExpiryAt: EXPIRY },
    { accessToken, refreshToken: null, tokenExpiryAt: null },
    { accessToken: null, refreshToken, tokenExpiryAt: EXPIRY },
    { accessToken: null, refreshToken: null, tokenExpiryAt: null },
  ];

  for (const testCase of cases) {
    const handle = createGoogleTokenCredentialHandle(testCase);

    expect(handle.getAccessToken()).toBe(testCase.accessToken);
    expect(handle.getRefreshToken()).toBe(testCase.refreshToken);
    expect(handle.getTokenExpiryAt()).toBe(testCase.tokenExpiryAt);
    expect(handle.exists()).toBe(true);
  }
});

test("credential handle does not expose tokens through enumeration or copy", () => {
  const secrets = ["enumeration-access-token", "enumeration-refresh-token"];
  const handle = createGoogleTokenCredentialHandle({
    accessToken: createPlaintextGoogleToken(secrets[0]),
    refreshToken: createPlaintextGoogleToken(secrets[1]),
    tokenExpiryAt: EXPIRY,
  });
  const results = [
    Object.keys(handle),
    Object.values(handle),
    Object.entries(handle),
    { ...handle },
    Object.assign({}, handle),
    structuredClone(handle),
  ];

  for (const result of results) {
    expect(Object.keys(result)).toHaveLength(0);
    const serialized = JSON.stringify(result);
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
  }
});

test("credential handle JSON serialization fails closed safely", () => {
  const accessToken = "json-access-token-secret";
  const refreshToken = "json-refresh-token-secret";
  const handle = createGoogleTokenCredentialHandle({
    accessToken: createPlaintextGoogleToken(accessToken),
    refreshToken: createPlaintextGoogleToken(refreshToken),
    tokenExpiryAt: EXPIRY,
  });
  const forbiddenValues = [
    accessToken,
    refreshToken,
    "autopdf-token:v1:ciphertext-marker",
    "key-id-marker",
    "aad-marker",
    USER_ID,
  ];

  for (const serialize of [
    () => JSON.stringify(handle),
    () => JSON.stringify({ credentials: handle }),
  ]) {
    try {
      serialize();
      throw new Error("Expected credential serialization to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(GoogleTokenCredentialSerializationError);
      expect(error).toMatchObject({
        name: "GoogleTokenCredentialSerializationError",
        code: "GOOGLE_TOKEN_CREDENTIAL_SERIALIZATION_FORBIDDEN",
        message: "Google token credentials cannot be serialized",
      });
      expect(error).not.toHaveProperty("cause");
      for (const value of forbiddenValues) {
        expect((error as Error).message).not.toContain(value);
      }
    }
  }
});

test("credential handle has safe string and inspection output", () => {
  const secrets = ["string-access-token", "string-refresh-token"];
  const handle = createGoogleTokenCredentialHandle({
    accessToken: createPlaintextGoogleToken(secrets[0]),
    refreshToken: createPlaintextGoogleToken(secrets[1]),
    tokenExpiryAt: EXPIRY,
  });
  const outputs = [String(handle), `${handle}`, inspect(handle)];

  expect(outputs[0]).toBe("[GoogleTokenCredentialHandle]");
  expect(outputs[1]).toBe("[GoogleTokenCredentialHandle]");
  for (const output of outputs) {
    for (const secret of secrets) {
      expect(output).not.toContain(secret);
    }
  }
});

test("credential handle is frozen against method and property mutation", () => {
  const accessToken = "immutable-access-token";
  const refreshToken = "immutable-refresh-token";
  const handle = createGoogleTokenCredentialHandle({
    accessToken: createPlaintextGoogleToken(accessToken),
    refreshToken: createPlaintextGoogleToken(refreshToken),
    tokenExpiryAt: EXPIRY,
  });

  expect(Object.isFrozen(handle)).toBe(true);
  expect(Reflect.set(handle, "getAccessToken", () => "replacement")).toBe(
    false,
  );
  expect(Reflect.set(handle, "accessToken", accessToken)).toBe(false);
  expect(Reflect.deleteProperty(handle, "getRefreshToken")).toBe(false);

  try {
    Object.defineProperty(handle, "refreshToken", { value: refreshToken });
    throw new Error("Expected credential mutation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).not.toContain(accessToken);
    expect((error as Error).message).not.toContain(refreshToken);
  }

  expect(handle.getAccessToken()).toBe(accessToken);
  expect(handle.getRefreshToken()).toBe(refreshToken);
  expect(handle.getTokenExpiryAt()).toBe(EXPIRY);
});

test("swapped token types fail decryption without DB writes", async () => {
  const key = createKey();
  const refreshCiphertext = encryptGoogleToken({
    token: "refresh-token",
    userId: USER_ID,
    tokenType: "refresh",
    keyId: KEY_ID,
    key,
  });
  const { store, calls } = createHarness({
    key,
    selectResult: {
      ok: true,
      rows: [
        {
          accessTokenStored: refreshCiphertext,
          credentialVersionStored: VERSION_0,
        },
      ],
    },
  });

  await expect(store.loadGoogleTokenCredentials(USER_ID)).rejects.toMatchObject(
    {
      code: "GOOGLE_TOKEN_DECRYPT_FAILED",
    },
  );
  expect(calls.inserts).toHaveLength(0);
  expect(calls.updates).toHaveLength(0);
});

test("callback refresh load requests only refresh token and dual-reads it", async () => {
  const { store, calls } = createHarness({
    selectResult: {
      ok: true,
      rows: [{ refreshTokenStored: "legacy-callback-refresh" }],
    },
  });

  await expect(store.loadGoogleRefreshTokenForCallback(USER_ID)).resolves.toBe(
    "legacy-callback-refresh",
  );
  expect(calls.selects).toEqual([
    { userId: USER_ID, columns: [...GOOGLE_CALLBACK_REFRESH_COLUMNS] },
  ]);
});

test("callback snapshot distinguishes a missing row from a null refresh token", async () => {
  const missing = createHarness({ selectResult: { ok: true, rows: [] } });
  const missingSnapshot =
    await missing.store.loadGoogleCallbackConnectionSnapshot(USER_ID);

  expect(missingSnapshot.exists()).toBe(false);
  expect(missingSnapshot.getRefreshToken()).toBeNull();
  expect(missing.calls.selects).toEqual([
    { userId: USER_ID, columns: [...GOOGLE_CALLBACK_SNAPSHOT_COLUMNS] },
  ]);

  const present = createHarness({
    selectResult: {
      ok: true,
      rows: [
        {
          refreshTokenStored: null,
          statusStored: "connected",
          tokenExpiryAtStored: EXPIRY,
          scopesStored: "gmail.readonly",
          credentialVersionStored: VERSION_0,
        },
      ],
    },
  });
  const presentSnapshot =
    await present.store.loadGoogleCallbackConnectionSnapshot(USER_ID);

  expect(presentSnapshot.exists()).toBe(true);
  expect(presentSnapshot.getRefreshToken()).toBeNull();
  expect(presentSnapshot.getTokenExpiryAt()).toBe(EXPIRY);
  expect(presentSnapshot.getStatus()).toBe("connected");
  expect(presentSnapshot.getScopes()).toBe("gmail.readonly");
  expect(Object.keys(presentSnapshot)).toEqual([]);
  expect(structuredClone(presentSnapshot)).toEqual({});
  expect(() => JSON.stringify(presentSnapshot)).toThrow(
    GoogleTokenCredentialSerializationError,
  );
});

test("callback snapshot dual-reads legacy refresh and rejects invalid expiry", async () => {
  const valid = createHarness({
    selectResult: {
      ok: true,
      rows: [
        {
          refreshTokenStored: "legacy-refresh-token",
          statusStored: null,
          tokenExpiryAtStored: null,
          scopesStored: null,
          credentialVersionStored: VERSION_0,
        },
      ],
    },
  });
  const snapshot =
    await valid.store.loadGoogleCallbackConnectionSnapshot(USER_ID);
  expect(snapshot.getRefreshToken()).toBe("legacy-refresh-token");

  const invalid = createHarness({
    selectResult: {
      ok: true,
      rows: [
        {
          refreshTokenStored: null,
          statusStored: "connected",
          tokenExpiryAtStored: "not-a-date",
          scopesStored: null,
          credentialVersionStored: VERSION_0,
        },
      ],
    },
  });
  await expectStoreErrorAsync(
    () => invalid.store.loadGoogleCallbackConnectionSnapshot(USER_ID),
    "GOOGLE_TOKEN_STORE_FAILED",
  );
});

test("encryption write preflight is strict and performs no repository access", () => {
  for (const value of ["true", "TRUE", "1", " false "]) {
    const crypto = createCryptoAdapter();
    const preflight = createGoogleTokenEncryptionWritePreflight({
      crypto: crypto.adapter,
      readInterlock: () => value,
    });
    expect(() => preflight()).toThrow(
      expect.objectContaining({ code: "GOOGLE_TOKEN_WRITE_DISABLED" }),
    );
  }

  for (const value of [undefined, "false"]) {
    const crypto = createCryptoAdapter();
    const preflight = createGoogleTokenEncryptionWritePreflight({
      crypto: crypto.adapter,
      readInterlock: () => value,
    });
    expect(() => preflight()).not.toThrow();
  }
});

test("encryption write preflight fails closed on key or round-trip failure", () => {
  const keyFailure = createCryptoAdapter({
    encryptErrorCode: "GOOGLE_TOKEN_KEY_MISSING",
  });
  const keyPreflight = createGoogleTokenEncryptionWritePreflight({
    crypto: keyFailure.adapter,
    readInterlock: () => undefined,
  });
  expect(() => keyPreflight()).toThrow(
    expect.objectContaining({ code: "GOOGLE_TOKEN_KEY_MISSING" }),
  );

  const working = createCryptoAdapter();
  const mismatchPreflight = createGoogleTokenEncryptionWritePreflight({
    crypto: {
      ...working.adapter,
      decrypt: () => "different-token",
    },
    readInterlock: () => "false",
  });
  expect(() => mismatchPreflight()).toThrow(
    expect.objectContaining({ code: "GOOGLE_TOKEN_ENCRYPT_FAILED" }),
  );
});

test("callback insert encrypts both tokens before one insert", async () => {
  const { store, calls, key } = createHarness();

  await store.saveGoogleCallbackConnection(callbackInput());

  expect(calls.updates).toHaveLength(0);
  expect(calls.inserts).toHaveLength(1);
  const payload = calls.inserts[0].payload;
  expect(payload).toMatchObject({
    token_expiry_at: EXPIRY,
    scopes: "gmail.readonly drive.file",
    status: "connected",
    last_verified_at: NOW,
    reauth_required: false,
    last_error_code: null,
    last_error_at: null,
    last_user_notified_at: null,
    last_user_notified_error_code: null,
    updated_at: NOW,
  });
  expect(payload.access_token_enc).not.toBe("callback-access-token");
  expect(payload.refresh_token_enc).not.toBe("callback-refresh-token");
  expect(
    decryptGoogleToken({
      token: String(payload.access_token_enc),
      userId: USER_ID,
      tokenType: "access",
      keyId: KEY_ID,
      key,
    }),
  ).toBe("callback-access-token");
  expect(
    decryptGoogleToken({
      token: String(payload.refresh_token_enc),
      userId: USER_ID,
      tokenType: "refresh",
      keyId: KEY_ID,
      key,
    }),
  ).toBe("callback-refresh-token");
});

test("callback update with a new refresh token performs one update", async () => {
  const { store, calls } = createHarness();

  await store.saveGoogleCallbackConnection(
    callbackInput({ writeMode: "update" }),
  );

  expect(calls.inserts).toHaveLength(0);
  expect(calls.updates).toHaveLength(1);
  expect(calls.updates[0].payload.refresh_token_enc).toMatch(
    /^autopdf-token:v1:/,
  );
});

test("callback update can preserve or clear the refresh column explicitly", async () => {
  const preserve = createHarness();
  await preserve.store.saveGoogleCallbackConnection(
    callbackInput({ writeMode: "update", refreshToken: { mode: "preserve" } }),
  );
  expect("refresh_token_enc" in preserve.calls.updates[0].payload).toBe(false);

  const clear = createHarness();
  await clear.store.saveGoogleCallbackConnection(
    callbackInput({ writeMode: "update", refreshToken: { mode: "clear" } }),
  );
  expect(clear.calls.updates[0].payload.refresh_token_enc).toBeNull();
});

test("callback insert requires a new refresh token before DB access", async () => {
  for (const refreshToken of [
    { mode: "preserve" } as const,
    { mode: "clear" } as const,
  ]) {
    const { store, calls } = createHarness();
    await expectStoreErrorAsync(
      () => store.saveGoogleCallbackConnection(callbackInput({ refreshToken })),
      "GOOGLE_TOKEN_INPUT_INVALID",
    );
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  }
});

test("callback encryption failures occur before repository writes", async () => {
  for (const tokenType of ["access", "refresh"] as const) {
    const { store, calls } = createHarness({ failEncryptType: tokenType });
    await expectStoreErrorAsync(
      () => store.saveGoogleCallbackConnection(callbackInput()),
      "GOOGLE_TOKEN_ENCRYPT_FAILED",
    );
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  }
});

test("malformed encrypted adapter output never reaches the repository", async () => {
  for (const encryptedOutput of [
    "autopdf-token:",
    "autopdf-token:v2:key:AA:AA:AA",
    "autopdf-token:v1:key:not-base64!:AA:AA",
  ]) {
    const { store, calls } = createHarness({ encryptedOutput });
    const error = await expectStoreErrorAsync(
      () => store.saveGoogleCallbackConnection(callbackInput()),
      "GOOGLE_TOKEN_ENCRYPT_FAILED",
    );

    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
    expect(error.message).not.toContain(encryptedOutput);
  }
});

test("known key configuration errors retain their safe codes", async () => {
  for (const code of [
    "GOOGLE_TOKEN_KEY_MISSING",
    "GOOGLE_TOKEN_KEY_INVALID",
  ] as const) {
    const { store, calls } = createHarness({ encryptErrorCode: code });

    await expect(
      store.saveGoogleCallbackConnection(callbackInput()),
    ).rejects.toMatchObject({ code });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  }
});

test("callback rejects missing access and double encryption before DB", async () => {
  const key = createKey();
  const ciphertext = encryptGoogleToken({
    token: "already-encrypted-token",
    userId: USER_ID,
    tokenType: "access",
    keyId: KEY_ID,
    key,
  });

  for (const invalidAccessToken of ["", ciphertext]) {
    const { store, calls } = createHarness({ key });
    const input = callbackInput();
    const unsafeInput = {
      ...input,
      accessToken: invalidAccessToken as PlaintextGoogleToken,
    };
    const error = await expectStoreErrorAsync(
      () => store.saveGoogleCallbackConnection(unsafeInput),
      "GOOGLE_TOKEN_ENCRYPT_FAILED",
    );

    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
    if (invalidAccessToken) {
      expect(error.message).not.toContain(invalidAccessToken);
    }
  }
});

test("callback payload never contains plaintext tokens", async () => {
  const accessToken = "plaintext-access-secret";
  const refreshToken = "plaintext-refresh-secret";
  const { store, calls } = createHarness();

  await store.saveGoogleCallbackConnection(
    callbackInput({
      accessToken,
      refreshToken: {
        mode: "update",
        token: createPlaintextGoogleToken(refreshToken),
      },
    }),
  );

  const serializedPayload = JSON.stringify(calls.inserts[0].payload);
  expect(serializedPayload).not.toContain(accessToken);
  expect(serializedPayload).not.toContain(refreshToken);
});

test("callback success health state is fixed inside the store", async () => {
  const { store, calls } = createHarness();
  const input = callbackInput({ writeMode: "update" });
  const unsafeInput = {
    ...input,
    state: {
      ...input.state,
      status: "disconnected",
      reauthRequired: true,
      lastErrorCode: "GOOGLE_TOKEN_INVALID",
      lastErrorAt: NOW,
    },
  } as SaveGoogleCallbackConnectionInput;

  await store.saveGoogleCallbackConnection(unsafeInput);

  expect(calls.updates[0].payload).toMatchObject({
    status: "connected",
    reauth_required: false,
    last_error_code: null,
    last_error_at: null,
  });
});

test("credential validation failure updates only fixed health columns", async () => {
  const { store, calls } = createHarness();

  await store.recordGoogleCredentialValidationFailure({
    userId: USER_ID,
    writeMode: "update",
    expectedStatus: "connected",
    expectedCredentialVersion: VERSION_0,
    refreshLeaseIdHash: LEASE_HASH,
  });

  expect(calls.inserts).toEqual([]);
  expect(calls.updates).toEqual([
    {
      userId: USER_ID,
      payload: {
        status: "error",
        reauth_required: true,
        last_error_code: "GOOGLE_TOKEN_INVALID",
        last_error_at: NOW,
        updated_at: NOW,
        credential_version: VERSION_1,
        refresh_lease_id_hash: null,
        refresh_lease_expires_at: null,
      },
      expectedStatus: "connected",
      expectedCredentialVersion: VERSION_0,
    },
  ]);
  const payload = calls.updates[0].payload;
  for (const preservedColumn of [
    "access_token_enc",
    "refresh_token_enc",
    "token_expiry_at",
    "scopes",
    "last_verified_at",
    "last_success_at",
    "last_user_notified_at",
    "last_user_notified_error_code",
  ]) {
    expect(payload).not.toHaveProperty(preservedColumn);
  }
});

test("credential validation failure inserts a minimal row when none exists", async () => {
  const { store, calls } = createHarness();

  await store.recordGoogleCredentialValidationFailure({
    userId: USER_ID,
    writeMode: "insert",
  });

  expect(calls.updates).toEqual([]);
  expect(calls.inserts).toEqual([
    {
      userId: USER_ID,
      payload: {
        status: "error",
        reauth_required: true,
        last_error_code: "GOOGLE_TOKEN_INVALID",
        last_error_at: NOW,
        updated_at: NOW,
        credential_version: VERSION_0,
      },
    },
  ]);
});

test("credential validation failure fixes user scope and rejects invalid mode", async () => {
  const scoped = createHarness();
  await scoped.store.recordGoogleCredentialValidationFailure({
    userId: USER_ID,
    writeMode: "update",
    expectedStatus: "connected",
    expectedCredentialVersion: VERSION_0,
    refreshLeaseIdHash: LEASE_HASH,
  });
  expect(scoped.calls.updates[0].userId).toBe(USER_ID);

  const invalid = createHarness();
  await expectStoreErrorAsync(
    () =>
      invalid.store.recordGoogleCredentialValidationFailure({
        userId: USER_ID,
        writeMode: "invalid" as never,
      }),
    "GOOGLE_TOKEN_INPUT_INVALID",
  );
  expect(invalid.calls.inserts).toEqual([]);
  expect(invalid.calls.updates).toEqual([]);
});

test("credential validation failure fails closed on DB and cardinality errors", async () => {
  for (const testCase of [
    {
      updateResult: { ok: false } as const,
      code: "GOOGLE_TOKEN_STORE_FAILED" as const,
    },
    {
      updateResult: { ok: true, count: 0 } as const,
      code: "GOOGLE_TOKEN_UPDATE_CONFLICT" as const,
    },
    {
      updateResult: { ok: true, count: 2 } as const,
      code: "GOOGLE_TOKEN_ROW_DUPLICATE" as const,
    },
  ]) {
    const { store } = createHarness({
      updateResult: testCase.updateResult,
    });
    const error = await expectStoreErrorAsync(
      () =>
        store.recordGoogleCredentialValidationFailure({
          userId: USER_ID,
          writeMode: "update",
          expectedStatus: "connected",
          expectedCredentialVersion: VERSION_0,
          refreshLeaseIdHash: LEASE_HASH,
        }),
      testCase.code,
    );
    expect(error.message).not.toContain("raw-db-secret");
    expect(error.message).not.toContain("autopdf-token:v1:");
    expect(error).not.toHaveProperty("cause");
  }
});

test("production repository scopes validation health update by user ID", async () => {
  const { store, calls } = createSupabaseRepositoryHarness();

  await store.recordGoogleCredentialValidationFailure({
    userId: USER_ID,
    writeMode: "update",
    expectedStatus: "connected",
    expectedCredentialVersion: VERSION_0,
    refreshLeaseIdHash: LEASE_HASH,
  });

  expect(calls.update).toEqual([
    {
      status: "error",
      reauth_required: true,
      last_error_code: "GOOGLE_TOKEN_INVALID",
      last_error_at: NOW,
      updated_at: NOW,
      credential_version: VERSION_1,
      refresh_lease_id_hash: null,
      refresh_lease_expires_at: null,
    },
  ]);
  expect(calls.eq).toEqual([
    { column: "user_id", value: USER_ID },
    { column: "credential_version", value: VERSION_0 },
    { column: "status", value: "connected" },
    { column: "refresh_lease_id_hash", value: LEASE_HASH },
  ]);
  expect(calls.writeSelect).toEqual(["id,credential_version"]);
  expect(JSON.stringify(calls)).not.toContain(OTHER_USER_ID);
});

test("production repository claims a lease through the server-clock RPC", async () => {
  const { store, calls } = createSupabaseRepositoryHarness();
  await store.claimGoogleCredentialRefreshLease({
    userId: USER_ID,
    expectedStatus: "connected",
    expectedCredentialVersion: VERSION_0,
    leaseIdHash: LEASE_HASH,
  });
  expect(calls.rpc).toEqual([
    {
      functionName: "claim_google_credential_refresh_lease",
      args: {
        p_user_id: USER_ID,
        p_expected_status: "connected",
        p_expected_credential_version: VERSION_0,
        p_lease_id_hash: LEASE_HASH,
      },
    },
  ]);
  expect(calls.update).toEqual([]);
});

test("production repository releases only the matching lease owner", async () => {
  const { store, calls } = createSupabaseRepositoryHarness();
  await store.releaseGoogleCredentialRefreshLease({
    userId: USER_ID,
    expectedStatus: "connected",
    expectedCredentialVersion: VERSION_0,
    leaseIdHash: LEASE_HASH,
  });
  expect(calls.update).toEqual([
    { refresh_lease_id_hash: null, refresh_lease_expires_at: null },
  ]);
  expect(calls.eq).toEqual([
    { column: "user_id", value: USER_ID },
    { column: "credential_version", value: VERSION_0 },
    { column: "status", value: "connected" },
    { column: "refresh_lease_id_hash", value: LEASE_HASH },
  ]);
});

test("production repository loads its client lazily and uses the select chain", async () => {
  const { store, calls } = createSupabaseRepositoryHarness({
    selectResult: {
      data: [
        {
          access_token_enc: "legacy-access",
          refresh_token_enc: null,
          status: "connected",
          token_expiry_at: null,
          scopes: "gmail.readonly",
          credential_version: 0,
        },
      ],
      error: null,
    },
  });

  expect(calls.clientLoads).toBe(0);
  const credentials = await store.loadGoogleTokenCredentials(USER_ID);
  expect(credentials.getAccessToken()).toBe("legacy-access");
  expect(credentials.getRefreshToken()).toBeNull();
  expect(credentials.getTokenExpiryAt()).toBeNull();
  expect(credentials.getStatus()).toBe("connected");
  expect(credentials.getScopes()).toBe("gmail.readonly");
  expect(calls).toMatchObject({
    clientLoads: 1,
    from: ["google_connections"],
    select: [
      "access_token_enc,refresh_token_enc,status,token_expiry_at,scopes,credential_version",
    ],
    eq: [{ column: "user_id", value: USER_ID }],
    limit: [2],
  });
});

test("production repository distinguishes select cardinality", async () => {
  const cases: Array<{
    data: unknown;
    code?: GoogleTokenStoreErrorCode;
  }> = [
    { data: [], code: "GOOGLE_TOKEN_ROW_NOT_FOUND" },
    {
      data: [{ refresh_token_enc: null }],
    },
    {
      data: [{ refresh_token_enc: null }, { refresh_token_enc: null }],
      code: "GOOGLE_TOKEN_ROW_DUPLICATE",
    },
  ];

  for (const testCase of cases) {
    const { store } = createSupabaseRepositoryHarness({
      selectResult: { data: testCase.data, error: null },
    });
    const action = () => store.loadGoogleRefreshTokenForCallback(USER_ID);

    if (testCase.code) {
      await expectStoreErrorAsync(action, testCase.code);
    } else {
      await expect(action()).resolves.toBeNull();
    }
  }
});

test("production repository fails closed on invalid select responses", async () => {
  const invalidData = [
    null,
    { refresh_token_enc: null },
    [{}],
    [{ refresh_token_enc: undefined }],
    [{ refresh_token_enc: 123 }],
  ];

  for (const data of invalidData) {
    const { store } = createSupabaseRepositoryHarness({
      selectResult: { data, error: null },
    });
    await expectStoreErrorAsync(
      () => store.loadGoogleRefreshTokenForCallback(USER_ID),
      "GOOGLE_TOKEN_STORE_FAILED",
    );
  }
});

test("production repository hides raw Supabase errors", async () => {
  const rawMessage = "raw-db-message-with-secret-value";
  const select = createSupabaseRepositoryHarness({
    selectResult: { data: null, error: { message: rawMessage } },
  });
  const selectError = await expectStoreErrorAsync(
    () => select.store.loadGoogleRefreshTokenForCallback(USER_ID),
    "GOOGLE_TOKEN_STORE_FAILED",
  );
  expect(selectError.message).not.toContain(rawMessage);

  const insert = createSupabaseRepositoryHarness({
    insertResult: { data: null, error: { message: rawMessage } },
  });
  const insertError = await expectStoreErrorAsync(
    () => insert.store.saveGoogleCallbackConnection(callbackInput()),
    "GOOGLE_TOKEN_STORE_FAILED",
  );
  expect(insertError.message).not.toContain(rawMessage);

  const update = createSupabaseRepositoryHarness({
    updateResult: { data: null, error: { message: rawMessage } },
  });
  const updateError = await expectStoreErrorAsync(
    () => update.store.disconnectGoogleConnection(disconnectInput()),
    "GOOGLE_TOKEN_STORE_FAILED",
  );
  expect(updateError.message).not.toContain(rawMessage);
});

test("production repository hides client getter exceptions", async () => {
  const rawMarker = "repository-client-loader-sensitive-marker";
  const operations = [
    {
      name: "select",
      run: (harness: ReturnType<typeof createSupabaseRepositoryHarness>) =>
        harness.store.loadGoogleRefreshTokenForCallback(USER_ID),
    },
    {
      name: "insert",
      run: (harness: ReturnType<typeof createSupabaseRepositoryHarness>) =>
        harness.store.saveGoogleCallbackConnection(callbackInput()),
    },
    {
      name: "update",
      run: (harness: ReturnType<typeof createSupabaseRepositoryHarness>) =>
        harness.store.disconnectGoogleConnection(disconnectInput()),
    },
  ];

  for (const operation of operations) {
    const loaderError = new Error(`${rawMarker}-${operation.name}`, {
      cause: { marker: rawMarker },
    });
    loaderError.name = `Raw${operation.name}LoaderError`;
    const harness = createSupabaseRepositoryHarness({
      getClientError: loaderError,
    });
    const error = await expectStoreErrorAsync(
      () => operation.run(harness),
      "GOOGLE_TOKEN_STORE_FAILED",
    );

    expect(harness.calls.clientLoads).toBe(1);
    expect(harness.calls.from).toHaveLength(0);
    expect(error.name).toBe("GoogleTokenStoreError");
    expect(error.message).not.toContain(rawMarker);
    expect(error.stack).not.toContain(rawMarker);
    expect(error).not.toHaveProperty("cause");
  }
});

test("production repository hides query builder and await exceptions", async () => {
  const rawMarker = "repository-query-sensitive-marker";
  const cases = [
    { operation: "select", stage: "builder" },
    { operation: "select", stage: "await" },
    { operation: "insert", stage: "builder" },
    { operation: "insert", stage: "await" },
    { operation: "update", stage: "builder" },
    { operation: "update", stage: "await" },
  ] as const;

  for (const testCase of cases) {
    const queryError = new Error(
      `${rawMarker}-${testCase.operation}-${testCase.stage}`,
      { cause: { marker: rawMarker } },
    );
    const harness = createSupabaseRepositoryHarness({
      queryThrow: { ...testCase, error: queryError },
    });
    const run =
      testCase.operation === "select"
        ? () => harness.store.loadGoogleRefreshTokenForCallback(USER_ID)
        : testCase.operation === "insert"
          ? () => harness.store.saveGoogleCallbackConnection(callbackInput())
          : () => harness.store.disconnectGoogleConnection(disconnectInput());
    const error = await expectStoreErrorAsync(run, "GOOGLE_TOKEN_STORE_FAILED");

    const expectedLoads = 1;
    expect(harness.calls.clientLoads).toBe(expectedLoads);
    expect(harness.calls.from).toEqual(
      Array.from({ length: expectedLoads }, () => "google_connections"),
    );
    expect(error.message).not.toContain(rawMarker);
    expect(error.stack).not.toContain(rawMarker);
    expect(error).not.toHaveProperty("cause");
  }
});

test("production repository forces the validated user ID on insert", async () => {
  const { repository, calls } = createSupabaseRepositoryHarness();
  const payload = {
    status: "connected",
    user_id: OTHER_USER_ID,
  } as unknown as GoogleConnectionWritePayload;

  await expect(
    repository.insertConnection({
      userId: USER_ID as never,
      payload,
    }),
  ).resolves.toEqual({ ok: true, credentialVersions: [VERSION_0] });

  expect(calls.insert).toEqual([
    {
      status: "connected",
      user_id: USER_ID,
    },
  ]);
  expect(JSON.stringify(calls.insert)).not.toContain(OTHER_USER_ID);
});

test("production repository rejects own user_id properties on update", async () => {
  for (const userId of [OTHER_USER_ID, USER_ID, undefined]) {
    const { repository, calls } = createSupabaseRepositoryHarness();
    const payload = {
      status: "connected",
      user_id: userId,
    } as unknown as GoogleConnectionWritePayload;

    await expect(
      repository.updateConnectionByCredentialVersion({
        userId: USER_ID as never,
        expectedStatus: "connected",
        expectedCredentialVersion: VERSION_0,
        payload,
      }),
    ).resolves.toEqual({ ok: false });

    expect(calls.clientLoads).toBe(0);
    expect(calls.from).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  }
});

test("production repository verifies insert and update result counts", async () => {
  for (const count of [0, 1, 2]) {
    const insertData = Array.from({ length: count }, (_, index) => ({
      id: String(index),
      credential_version: 0,
    }));
    const insert = createSupabaseRepositoryHarness({
      insertResult: { data: insertData, error: null },
    });
    const insertAction = () =>
      insert.store.saveGoogleCallbackConnection(callbackInput());

    if (count === 1) {
      await expect(insertAction()).resolves.toBeUndefined();
    } else {
      await expectStoreErrorAsync(
        insertAction,
        count === 0
          ? "GOOGLE_TOKEN_UPDATE_CONFLICT"
          : "GOOGLE_TOKEN_ROW_DUPLICATE",
      );
    }
    expect(insert.calls.writeSelect).toEqual(["id,credential_version"]);

    const updateData = Array.from({ length: count }, (_, index) => ({
      id: String(index),
      credential_version: 1,
    }));
    const update = createSupabaseRepositoryHarness({
      updateResult: { data: updateData, error: null },
    });
    const updateAction = () =>
      update.store.disconnectGoogleConnection(disconnectInput());

    if (count === 1) {
      await expect(updateAction()).resolves.toBeUndefined();
    } else {
      await expectStoreErrorAsync(
        updateAction,
        count === 0
          ? "GOOGLE_TOKEN_UPDATE_CONFLICT"
          : "GOOGLE_TOKEN_ROW_DUPLICATE",
      );
    }
    expect(update.calls.writeSelect).toEqual(["id,credential_version"]);
    expect(update.calls.eq).toEqual([
      { column: "user_id", value: USER_ID },
      { column: "credential_version", value: VERSION_0 },
      { column: "status", value: "connected" },
      { column: "refresh_lease_id_hash", value: LEASE_HASH },
    ]);
  }
});

test("production repository rejects null and non-array write responses", async () => {
  for (const data of [null, { id: "row" }]) {
    const insert = createSupabaseRepositoryHarness({
      insertResult: { data, error: null },
    });
    await expectStoreErrorAsync(
      () => insert.store.saveGoogleCallbackConnection(callbackInput()),
      "GOOGLE_TOKEN_STORE_FAILED",
    );

    const update = createSupabaseRepositoryHarness({
      updateResult: { data, error: null },
    });
    await expectStoreErrorAsync(
      () => update.store.disconnectGoogleConnection(disconnectInput()),
      "GOOGLE_TOKEN_STORE_FAILED",
    );
  }
});

test("callback DB error and zero-row update use safe store codes", async () => {
  const cases: Array<{
    updateResult: WriteResult;
    code: GoogleTokenStoreErrorCode;
  }> = [
    { updateResult: { ok: false }, code: "GOOGLE_TOKEN_STORE_FAILED" },
    {
      updateResult: { ok: true, count: 0 },
      code: "GOOGLE_TOKEN_UPDATE_CONFLICT",
    },
  ];

  for (const testCase of cases) {
    const { store } = createHarness({ updateResult: testCase.updateResult });
    await expectStoreErrorAsync(
      () =>
        store.saveGoogleCallbackConnection(
          callbackInput({ writeMode: "update" }),
        ),
      testCase.code,
    );
  }
});

test("callback insert DB failure uses a fixed store error", async () => {
  const { store } = createHarness({ insertResult: { ok: false } });

  await expectStoreErrorAsync(
    () => store.saveGoogleCallbackConnection(callbackInput()),
    "GOOGLE_TOKEN_STORE_FAILED",
  );
});

test("refresh update encrypts access with expiry and never writes refresh", async () => {
  const { store, calls, key } = createHarness();
  const result = await store.updateRefreshedGoogleAccessToken({
    userId: USER_ID,
    accessToken: createPlaintextGoogleToken("refreshed-access-token"),
    tokenExpiryAt: EXPIRY,
    lastVerifiedAt: NOW,
    updatedAt: NOW,
    expectedCredentialVersion: VERSION_0,
    refreshLeaseIdHash: LEASE_HASH,
  });

  expect(result).toBe(VERSION_1);
  expect(calls.updates).toHaveLength(1);
  const payload = calls.updates[0].payload;
  expect(payload.token_expiry_at).toBe(EXPIRY);
  expect(payload.last_verified_at).toBe(NOW);
  expect("refresh_token_enc" in payload).toBe(false);
  expect(payload.access_token_enc).not.toBe("refreshed-access-token");
  expect(
    decryptGoogleToken({
      token: String(payload.access_token_enc),
      userId: USER_ID,
      tokenType: "access",
      keyId: KEY_ID,
      key,
    }),
  ).toBe("refreshed-access-token");
});

test("refresh encryption failure prevents DB update", async () => {
  const { store, calls } = createHarness({ failEncryptType: "access" });

  await expectStoreErrorAsync(
    () =>
      store.updateRefreshedGoogleAccessToken({
        userId: USER_ID,
        accessToken: createPlaintextGoogleToken("refresh-failure-token"),
        tokenExpiryAt: EXPIRY,
        lastVerifiedAt: NOW,
        updatedAt: NOW,
        expectedCredentialVersion: VERSION_0,
        refreshLeaseIdHash: LEASE_HASH,
      }),
    "GOOGLE_TOKEN_ENCRYPT_FAILED",
  );
  expect(calls.updates).toHaveLength(0);
});

test("refresh update rotates access and refresh tokens in one update", async () => {
  const { store, calls, key } = createHarness();

  await store.updateRefreshedGoogleAccessToken({
    userId: USER_ID,
    accessToken: createPlaintextGoogleToken("rotated-access-token"),
    refreshToken: {
      mode: "update",
      token: createPlaintextGoogleToken("rotated-refresh-token"),
    },
    tokenExpiryAt: EXPIRY,
    lastVerifiedAt: NOW,
    updatedAt: NOW,
    expectedCredentialVersion: VERSION_0,
    refreshLeaseIdHash: LEASE_HASH,
  });

  expect(calls.updates).toHaveLength(1);
  const payload = calls.updates[0].payload;
  expect(
    decryptGoogleToken({
      token: String(payload.access_token_enc),
      userId: USER_ID,
      tokenType: "access",
      keyId: KEY_ID,
      key,
    }),
  ).toBe("rotated-access-token");
  expect(
    decryptGoogleToken({
      token: String(payload.refresh_token_enc),
      userId: USER_ID,
      tokenType: "refresh",
      keyId: KEY_ID,
      key,
    }),
  ).toBe("rotated-refresh-token");
});

test("refresh DB failure and zero-row update use defined codes", async () => {
  for (const testCase of [
    {
      updateResult: { ok: false } as const,
      code: "GOOGLE_TOKEN_STORE_FAILED" as const,
    },
    {
      updateResult: { ok: true, count: 0 } as const,
      code: "GOOGLE_TOKEN_UPDATE_CONFLICT" as const,
    },
  ]) {
    const { store } = createHarness({ updateResult: testCase.updateResult });
    await expectStoreErrorAsync(
      () =>
        store.updateRefreshedGoogleAccessToken({
          userId: USER_ID,
          accessToken: createPlaintextGoogleToken("refresh-db-token"),
          tokenExpiryAt: EXPIRY,
          lastVerifiedAt: NOW,
          updatedAt: NOW,
          expectedCredentialVersion: VERSION_0,
          refreshLeaseIdHash: LEASE_HASH,
        }),
      testCase.code,
    );
  }
});

test("production repository rejects malformed and mismatched CAS rows", async () => {
  for (const data of [
    [{}],
    [{ id: "row" }],
    [{ id: "", credential_version: 1 }],
    [{ id: "row", credential_version: -1 }],
    [{ id: "row", credential_version: "01" }],
    [{ id: "row", credential_version: 2 }],
  ]) {
    const harness = createSupabaseRepositoryHarness({
      updateResult: { data, error: null },
    });
    await expectStoreErrorAsync(
      () => harness.store.disconnectGoogleConnection(disconnectInput()),
      "GOOGLE_TOKEN_STORE_FAILED",
    );
  }
});

test("production repository rejects unsafe or invalid stored versions", async () => {
  for (const credentialVersion of [
    null,
    -1,
    "01",
    "9223372036854775808",
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const harness = createSupabaseRepositoryHarness({
      selectResult: {
        data: [
          {
            access_token_enc: null,
            refresh_token_enc: null,
            status: "connected",
            token_expiry_at: null,
            scopes: null,
            credential_version: credentialVersion,
          },
        ],
        error: null,
      },
    });
    await expectStoreErrorAsync(
      () => harness.store.loadGoogleTokenCredentials(USER_ID),
      "GOOGLE_TOKEN_STORE_FAILED",
    );
  }
});

test("two refresh saves from one version allow exactly one winner", async () => {
  const { store, state } = createStatefulCasHarness();
  const write = (label: string) =>
    store.updateRefreshedGoogleAccessToken({
      userId: USER_ID,
      accessToken: createPlaintextGoogleToken(label),
      tokenExpiryAt: EXPIRY,
      lastVerifiedAt: NOW,
      updatedAt: NOW,
      expectedCredentialVersion: VERSION_0,
      refreshLeaseIdHash: LEASE_HASH,
    });

  const results = await Promise.allSettled([
    write("first-concurrent-access"),
    write("second-concurrent-access"),
  ]);

  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.find((result) => result.status === "rejected");
  expect(rejected).toMatchObject({
    status: "rejected",
    reason: { code: "GOOGLE_TOKEN_UPDATE_CONFLICT" },
  });
  expect(state.credentialVersion).toBe(VERSION_1);
});

test("callback CAS prevents an older refresh from overwriting reconnect", async () => {
  const { store, state } = createStatefulCasHarness();
  await store.saveGoogleCallbackConnection(
    callbackInput({ writeMode: "update" }),
  );
  const callbackPayload = state.lastPayload;

  await expectStoreErrorAsync(
    () =>
      store.updateRefreshedGoogleAccessToken({
        userId: USER_ID,
        accessToken: createPlaintextGoogleToken("stale-refresh-access"),
        tokenExpiryAt: EXPIRY,
        lastVerifiedAt: NOW,
        updatedAt: NOW,
        expectedCredentialVersion: VERSION_0,
        refreshLeaseIdHash: LEASE_HASH,
      }),
    "GOOGLE_TOKEN_UPDATE_CONFLICT",
  );

  expect(state.credentialVersion).toBe(VERSION_1);
  expect(state.lastPayload).toBe(callbackPayload);
});

test("disconnect CAS prevents an in-flight refresh from reviving credentials", async () => {
  const { store, state } = createStatefulCasHarness();
  await store.disconnectGoogleConnection(disconnectInput());
  const disconnectPayload = state.lastPayload;

  await expectStoreErrorAsync(
    () =>
      store.updateRefreshedGoogleAccessToken({
        userId: USER_ID,
        accessToken: createPlaintextGoogleToken("stale-after-disconnect"),
        tokenExpiryAt: EXPIRY,
        lastVerifiedAt: NOW,
        updatedAt: NOW,
        expectedCredentialVersion: VERSION_0,
        refreshLeaseIdHash: LEASE_HASH,
      }),
    "GOOGLE_TOKEN_UPDATE_CONFLICT",
  );

  expect(state.status).toBe("disconnected");
  expect(state.credentialVersion).toBe(VERSION_1);
  expect(state.lastPayload).toBe(disconnectPayload);
});

test("access-only refresh preserves the newest stored refresh token", async () => {
  const { store, state } = createStatefulCasHarness();
  await store.saveGoogleCallbackConnection(
    callbackInput({ writeMode: "update" }),
  );
  const newestRefreshTokenStored = state.refreshTokenStored;

  await store.updateRefreshedGoogleAccessToken({
    userId: USER_ID,
    accessToken: createPlaintextGoogleToken("access-only-refresh"),
    refreshToken: { mode: "preserve" },
    tokenExpiryAt: EXPIRY,
    lastVerifiedAt: NOW,
    updatedAt: NOW,
    expectedCredentialVersion: VERSION_1,
    refreshLeaseIdHash: LEASE_HASH,
  });

  expect(state.refreshTokenStored).toBe(newestRefreshTokenStored);
  expect(state.credentialVersion).toBe(createGoogleCredentialVersion(2));
});

test("owner mismatch cannot update another user's credential", async () => {
  const { store, state } = createStatefulCasHarness();
  await expectStoreErrorAsync(
    () =>
      store.updateRefreshedGoogleAccessToken({
        userId: OTHER_USER_ID,
        accessToken: createPlaintextGoogleToken("other-owner-access"),
        tokenExpiryAt: EXPIRY,
        lastVerifiedAt: NOW,
        updatedAt: NOW,
        expectedCredentialVersion: VERSION_0,
        refreshLeaseIdHash: LEASE_HASH,
      }),
    "GOOGLE_TOKEN_UPDATE_CONFLICT",
  );
  expect(state.credentialVersion).toBe(VERSION_0);
  expect(state.lastPayload).toBeNull();
});

test("credential version overflow stops before repository update", async () => {
  const { store, calls } = createHarness();
  await expectStoreErrorAsync(
    () =>
      store.updateRefreshedGoogleAccessToken({
        userId: USER_ID,
        accessToken: createPlaintextGoogleToken("overflow-access"),
        tokenExpiryAt: EXPIRY,
        lastVerifiedAt: NOW,
        updatedAt: NOW,
        expectedCredentialVersion: createGoogleCredentialVersion(
          "9223372036854775807",
        ),
        refreshLeaseIdHash: LEASE_HASH,
      }),
    "GOOGLE_TOKEN_STORE_FAILED",
  );
  expect(calls.updates).toEqual([]);
});

test("disconnect clears tokens and health state in one user-scoped update", async () => {
  const { store, calls } = createHarness();

  await store.disconnectGoogleConnection(disconnectInput());

  expect(calls.updates).toEqual([
    {
      userId: USER_ID,
      expectedStatus: "connected",
      expectedCredentialVersion: VERSION_0,
      payload: {
        access_token_enc: null,
        refresh_token_enc: null,
        token_expiry_at: null,
        scopes: null,
        status: "disconnected",
        last_verified_at: null,
        reauth_required: false,
        last_error_code: null,
        last_error_at: null,
        updated_at: NOW,
        credential_version: VERSION_1,
        refresh_lease_id_hash: null,
        refresh_lease_expires_at: null,
      },
    },
  ]);
});

test("disconnect DB failure and zero rows use defined codes", async () => {
  for (const testCase of [
    {
      updateResult: { ok: false } as const,
      code: "GOOGLE_TOKEN_STORE_FAILED" as const,
    },
    {
      updateResult: { ok: true, count: 0 } as const,
      code: "GOOGLE_TOKEN_UPDATE_CONFLICT" as const,
    },
  ]) {
    const { store } = createHarness({ updateResult: testCase.updateResult });
    await expectStoreErrorAsync(
      () => store.disconnectGoogleConnection(disconnectInput()),
      testCase.code,
    );
  }
});

test("store errors normalize safely without reconnect classification", () => {
  const codes: GoogleTokenStoreErrorCode[] = [
    "GOOGLE_TOKEN_INPUT_INVALID",
    "GOOGLE_TOKEN_ENCRYPT_FAILED",
    "GOOGLE_TOKEN_WRITE_DISABLED",
    "GOOGLE_TOKEN_STORE_FAILED",
    "GOOGLE_TOKEN_UPDATE_CONFLICT",
    "GOOGLE_TOKEN_ROW_NOT_FOUND",
    "GOOGLE_TOKEN_ROW_DUPLICATE",
  ];
  const secrets = [
    "plaintext-secret-token",
    "autopdf-token:v1:secret-ciphertext",
    createKey(),
    OTHER_USER_ID,
  ];

  for (const code of codes) {
    const error = new GoogleTokenStoreError(code);
    const normalized = normalizeRunErrorCode(error);
    const userFacing = getRunErrorMessage(normalized);

    expect(normalized).toBe(code);
    expect(userFacing.action).not.toContain("再接続");
    for (const secret of secrets) {
      expect(error.message).not.toContain(secret);
      expect(userFacing.message).not.toContain(secret);
    }
  }
});
