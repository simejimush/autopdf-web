import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createGoogleTokenStore,
  createPlaintextGoogleToken,
  GOOGLE_CALLBACK_REFRESH_COLUMNS,
  GOOGLE_TOKEN_CREDENTIAL_COLUMNS,
  GoogleTokenStoreError,
  type GoogleConnectionWritePayload,
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
      return options?.selectResult ?? { ok: true, rows: [] };
    },
    async insertConnection(input) {
      calls.inserts.push({ userId: input.userId, payload: input.payload });
      return options?.insertResult ?? { ok: true, count: 1 };
    },
    async updateConnectionByUserId(input) {
      calls.updates.push({ userId: input.userId, payload: input.payload });
      return options?.updateResult ?? { ok: true, count: 1 };
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
    refreshToken:
      options?.refreshToken ?? {
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
    limit: [] as number[],
    insert: [] as Array<Record<string, unknown>>,
    update: [] as GoogleConnectionWritePayload[],
    writeSelect: [] as string[],
  };
  const client: GoogleTokenSupabaseClient = {
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
                  return options?.selectResult ?? { data: [], error: null };
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
              return options?.insertResult ?? { data: [{ id: "row" }], error: null };
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
          return {
            eq(column, value) {
              calls.eq.push({ column, value });
              return {
                async select(columns) {
                  if (
                    options?.queryThrow?.operation === "update" &&
                    options.queryThrow.stage === "await"
                  ) {
                    throw options.queryThrow.error;
                  }

                  calls.writeSelect.push(columns);
                  return options?.updateResult ?? { data: [{ id: "row" }], error: null };
                },
              };
            },
          };
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

  await store.disconnectGoogleConnection(USER_ID);

  expect(calls.updates).toHaveLength(1);
  expect(calls.updates[0].userId).toBe(USER_ID);
});

test("empty and invalid UUIDs fail before repository access", async () => {
  for (const userId of ["", "not-a-uuid", "secret-user-id-value"]) {
    const { store, calls } = createHarness();
    const error = await expectStoreErrorAsync(
      () => store.disconnectGoogleConnection(userId),
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
  const cases: Array<{ result: SelectResult; code: GoogleTokenStoreErrorCode }> = [
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
        },
      ],
    },
    onDecrypt: (tokenType) => decryptTypes.push(tokenType),
  });

  const credentials = await store.loadGoogleTokenCredentials(USER_ID);

  expect(credentials).toEqual({
    accessToken: "legacy-access-token",
    refreshToken: "legacy-refresh-token",
  });
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
        },
      ],
    },
  });

  await expect(
    store.loadGoogleTokenCredentials(USER_ID),
  ).resolves.toEqual({
    accessToken: "encrypted-access-token",
    refreshToken: "encrypted-refresh-token",
  });
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
      rows: [{ accessTokenStored: refreshCiphertext }],
    },
  });

  await expect(store.loadGoogleTokenCredentials(USER_ID)).rejects.toMatchObject({
    code: "GOOGLE_TOKEN_DECRYPT_FAILED",
  });
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

  await expect(
    store.loadGoogleRefreshTokenForCallback(USER_ID),
  ).resolves.toBe("legacy-callback-refresh");
  expect(calls.selects).toEqual([
    { userId: USER_ID, columns: [...GOOGLE_CALLBACK_REFRESH_COLUMNS] },
  ]);
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
      () =>
        store.saveGoogleCallbackConnection(
          callbackInput({ refreshToken }),
        ),
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

test("production repository loads its client lazily and uses the select chain", async () => {
  const { store, calls } = createSupabaseRepositoryHarness({
    selectResult: {
      data: [
        {
          access_token_enc: "legacy-access",
          refresh_token_enc: null,
        },
      ],
      error: null,
    },
  });

  expect(calls.clientLoads).toBe(0);
  await expect(store.loadGoogleTokenCredentials(USER_ID)).resolves.toEqual({
    accessToken: "legacy-access",
    refreshToken: null,
  });
  expect(calls).toMatchObject({
    clientLoads: 1,
    from: ["google_connections"],
    select: ["access_token_enc,refresh_token_enc"],
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
    () => update.store.disconnectGoogleConnection(USER_ID),
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
        harness.store.disconnectGoogleConnection(USER_ID),
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
          : () => harness.store.disconnectGoogleConnection(USER_ID);
    const error = await expectStoreErrorAsync(
      run,
      "GOOGLE_TOKEN_STORE_FAILED",
    );

    expect(harness.calls.clientLoads).toBe(1);
    expect(harness.calls.from).toEqual(["google_connections"]);
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
  ).resolves.toEqual({ ok: true, count: 1 });

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
      repository.updateConnectionByUserId({
        userId: USER_ID as never,
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
    const data = Array.from({ length: count }, (_, index) => ({ id: index }));
    const insert = createSupabaseRepositoryHarness({
      insertResult: { data, error: null },
    });
    const insertAction = () =>
      insert.store.saveGoogleCallbackConnection(callbackInput());

    if (count === 1) {
      await expect(insertAction()).resolves.toBeUndefined();
    } else {
      await expectStoreErrorAsync(
        insertAction,
        "GOOGLE_TOKEN_UPDATE_CONFLICT",
      );
    }
    expect(insert.calls.writeSelect).toEqual(["id"]);

    const update = createSupabaseRepositoryHarness({
      updateResult: { data, error: null },
    });
    const updateAction = () => update.store.disconnectGoogleConnection(USER_ID);

    if (count === 1) {
      await expect(updateAction()).resolves.toBeUndefined();
    } else {
      await expectStoreErrorAsync(
        updateAction,
        "GOOGLE_TOKEN_UPDATE_CONFLICT",
      );
    }
    expect(update.calls.writeSelect).toEqual(["id"]);
    expect(update.calls.eq).toEqual([
      { column: "user_id", value: USER_ID },
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
      () => update.store.disconnectGoogleConnection(USER_ID),
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
  });

  expect(result).toBeUndefined();
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
      }),
    "GOOGLE_TOKEN_ENCRYPT_FAILED",
  );
  expect(calls.updates).toHaveLength(0);
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
        }),
      testCase.code,
    );
  }
});

test("disconnect clears tokens and health state in one user-scoped update", async () => {
  const { store, calls } = createHarness();

  await store.disconnectGoogleConnection(USER_ID);

  expect(calls.updates).toEqual([
    {
      userId: USER_ID,
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
      () => store.disconnectGoogleConnection(USER_ID),
      testCase.code,
    );
  }
});

test("store errors normalize safely without reconnect classification", () => {
  const codes: GoogleTokenStoreErrorCode[] = [
    "GOOGLE_TOKEN_INPUT_INVALID",
    "GOOGLE_TOKEN_ENCRYPT_FAILED",
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
