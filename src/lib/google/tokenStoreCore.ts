import {
  GoogleTokenCryptoError,
  isEncryptedGoogleToken,
  validateEncryptedGoogleToken,
} from "@/lib/security/googleTokenCrypto";

declare const plaintextGoogleTokenBrand: unique symbol;
declare const encryptedGoogleTokenBrand: unique symbol;
declare const googleUserIdBrand: unique symbol;
declare const googleCredentialVersionBrand: unique symbol;
declare const googleRefreshLeaseIdHashBrand: unique symbol;

export type PlaintextGoogleToken = string & {
  readonly [plaintextGoogleTokenBrand]: true;
};

export type EncryptedGoogleToken = string & {
  readonly [encryptedGoogleTokenBrand]: true;
};

export type GoogleUserId = string & {
  readonly [googleUserIdBrand]: true;
};

export type GoogleCredentialVersion = string & {
  readonly [googleCredentialVersionBrand]: true;
};

export type GoogleRefreshLeaseIdHash = string & {
  readonly [googleRefreshLeaseIdHashBrand]: true;
};

export type GoogleRefreshLeaseHandle = Readonly<{
  getIdHash(): GoogleRefreshLeaseIdHash;
  toJSON(): never;
}>;

export type GoogleTokenStoreErrorCode =
  | "GOOGLE_TOKEN_INPUT_INVALID"
  | "GOOGLE_TOKEN_ENCRYPT_FAILED"
  | "GOOGLE_TOKEN_WRITE_DISABLED"
  | "GOOGLE_TOKEN_STORE_FAILED"
  | "GOOGLE_TOKEN_UPDATE_CONFLICT"
  | "GOOGLE_TOKEN_REFRESH_IN_PROGRESS"
  | "GOOGLE_REFRESH_OUTCOME_UNKNOWN"
  | "GOOGLE_TOKEN_ROW_NOT_FOUND"
  | "GOOGLE_TOKEN_ROW_DUPLICATE";

const SAFE_ERROR_MESSAGES: Record<GoogleTokenStoreErrorCode, string> = {
  GOOGLE_TOKEN_INPUT_INVALID: "Google token store input is invalid",
  GOOGLE_TOKEN_ENCRYPT_FAILED: "Google token encryption failed",
  GOOGLE_TOKEN_WRITE_DISABLED: "Google token encryption writes are disabled",
  GOOGLE_TOKEN_STORE_FAILED: "Google token storage failed",
  GOOGLE_TOKEN_UPDATE_CONFLICT: "Google token storage update conflicted",
  GOOGLE_TOKEN_REFRESH_IN_PROGRESS: "Google token refresh is in progress",
  GOOGLE_REFRESH_OUTCOME_UNKNOWN:
    "Google token refresh outcome is unknown; reconnect is required",
  GOOGLE_TOKEN_ROW_NOT_FOUND: "Google token row was not found",
  GOOGLE_TOKEN_ROW_DUPLICATE: "Multiple Google token rows were found",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREDENTIAL_VERSION_PATTERN = /^(0|[1-9][0-9]*)$/;
const REFRESH_LEASE_ID_HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

export const GOOGLE_TOKEN_CREDENTIAL_COLUMNS = Object.freeze([
  "access_token_enc",
  "refresh_token_enc",
  "status",
  "token_expiry_at",
  "scopes",
  "credential_version",
] as const);

export const GOOGLE_CALLBACK_REFRESH_COLUMNS = Object.freeze([
  "refresh_token_enc",
] as const);

export const GOOGLE_CALLBACK_SNAPSHOT_COLUMNS = Object.freeze([
  "refresh_token_enc",
  "status",
  "token_expiry_at",
  "scopes",
  "credential_version",
] as const);

export type GoogleTokenReadColumn =
  | (typeof GOOGLE_TOKEN_CREDENTIAL_COLUMNS)[number]
  | (typeof GOOGLE_CALLBACK_REFRESH_COLUMNS)[number]
  | (typeof GOOGLE_CALLBACK_SNAPSHOT_COLUMNS)[number];

export type GoogleTokenConnectionRow = Readonly<{
  accessTokenStored?: string | null;
  refreshTokenStored?: string | null;
  statusStored?: string | null;
  tokenExpiryAtStored?: string | null;
  scopesStored?: string | null;
  credentialVersionStored?: GoogleCredentialVersion;
}>;

export type GoogleConnectionWritePayload = Readonly<{
  access_token_enc?: EncryptedGoogleToken | null;
  refresh_token_enc?: EncryptedGoogleToken | null;
  token_expiry_at?: string | null;
  scopes?: string | null;
  status?: string;
  last_verified_at?: string | null;
  reauth_required?: boolean;
  last_error_code?: string | null;
  last_error_at?: string | null;
  last_user_notified_at?: string | null;
  last_user_notified_error_code?: string | null;
  updated_at?: string;
  credential_version?: GoogleCredentialVersion;
  refresh_lease_id_hash?: GoogleRefreshLeaseIdHash | null;
  refresh_lease_expires_at?: string | null;
}>;

type RepositorySelectResult =
  | Readonly<{ ok: true; rows: readonly GoogleTokenConnectionRow[] }>
  | Readonly<{ ok: false }>;

type RepositoryWriteResult =
  | Readonly<{
      ok: true;
      credentialVersions: readonly GoogleCredentialVersion[];
    }>
  | Readonly<{ ok: false }>;

export type GoogleTokenRepository = Readonly<{
  selectConnectionsByUserId(
    input: Readonly<{
      userId: GoogleUserId;
      columns: readonly GoogleTokenReadColumn[];
    }>,
  ): Promise<RepositorySelectResult>;
  insertConnection(
    input: Readonly<{
      userId: GoogleUserId;
      payload: GoogleConnectionWritePayload;
    }>,
  ): Promise<RepositoryWriteResult>;
  updateConnectionByCredentialVersion(
    input: Readonly<{
      userId: GoogleUserId;
      expectedStatus: string | null;
      expectedCredentialVersion: GoogleCredentialVersion;
      payload: GoogleConnectionWritePayload;
      expectedRefreshLeaseIdHash?: GoogleRefreshLeaseIdHash;
    }>,
  ): Promise<RepositoryWriteResult>;
  claimGoogleCredentialRefreshLease(
    input: Readonly<{
      userId: GoogleUserId;
      expectedStatus: string | null;
      expectedCredentialVersion: GoogleCredentialVersion;
      leaseIdHash: GoogleRefreshLeaseIdHash;
    }>,
  ): Promise<RepositoryWriteResult>;
}>;

export type GoogleTokenCryptoAdapter = Readonly<{
  encrypt(
    input: Readonly<{
      token: PlaintextGoogleToken;
      userId: GoogleUserId;
      tokenType: "access" | "refresh";
    }>,
  ): string;
  decrypt(
    input: Readonly<{
      token: string;
      userId: GoogleUserId;
      tokenType: "access" | "refresh";
    }>,
  ): string;
}>;

export type GoogleRefreshTokenWrite =
  | Readonly<{ mode: "preserve" }>
  | Readonly<{ mode: "update"; token: PlaintextGoogleToken }>
  | Readonly<{ mode: "clear" }>;

export type GoogleRefreshedTokenWrite =
  | Readonly<{ mode: "preserve" }>
  | Readonly<{ mode: "update"; token: PlaintextGoogleToken }>;

type GoogleCallbackConnectionState = Readonly<{
  tokenExpiryAt: string | null;
  scopes: string | null;
  lastVerifiedAt: string | null;
  lastUserNotifiedAt: string | null;
  lastUserNotifiedErrorCode: string | null;
  updatedAt: string;
}>;

export type SaveGoogleCallbackConnectionInput = Readonly<{
  userId: string;
  writeMode: "insert" | "update";
  accessToken: PlaintextGoogleToken;
  refreshToken: GoogleRefreshTokenWrite;
  state: GoogleCallbackConnectionState;
  expectedStatus?: string | null;
  expectedCredentialVersion?: GoogleCredentialVersion;
  refreshLeaseIdHash?: GoogleRefreshLeaseIdHash;
}>;

export type UpdateRefreshedGoogleAccessTokenInput = Readonly<{
  userId: string;
  accessToken: PlaintextGoogleToken;
  refreshToken?: GoogleRefreshedTokenWrite;
  tokenExpiryAt: string | null;
  lastVerifiedAt: string;
  updatedAt: string;
  expectedCredentialVersion: GoogleCredentialVersion;
  refreshLeaseIdHash: GoogleRefreshLeaseIdHash;
}>;

export type RecordGoogleCredentialValidationFailureInput = Readonly<{
  userId: string;
  writeMode: "insert" | "update";
  expectedStatus?: string | null;
  expectedCredentialVersion?: GoogleCredentialVersion;
  refreshLeaseIdHash?: GoogleRefreshLeaseIdHash;
}>;

export type ClaimGoogleCredentialRefreshLeaseInput = Readonly<{
  userId: string;
  expectedStatus: string | null;
  expectedCredentialVersion: GoogleCredentialVersion;
  leaseIdHash: GoogleRefreshLeaseIdHash;
}>;

export type ReleaseGoogleCredentialRefreshLeaseInput = Readonly<{
  userId: string;
  expectedStatus: string | null;
  expectedCredentialVersion: GoogleCredentialVersion;
  leaseIdHash: GoogleRefreshLeaseIdHash;
}>;

export type DisconnectGoogleConnectionInput = Readonly<{
  userId: string;
  expectedStatus: string | null;
  expectedCredentialVersion: GoogleCredentialVersion;
  refreshLeaseIdHash: GoogleRefreshLeaseIdHash;
}>;

export type GoogleTokenCredentialHandle = Readonly<{
  exists(): boolean;
  getAccessToken(): PlaintextGoogleToken | null;
  getRefreshToken(): PlaintextGoogleToken | null;
  getTokenExpiryAt(): string | null;
  getStatus(): string | null;
  getScopes(): string | null;
  getCredentialVersion(): GoogleCredentialVersion;
  toJSON(): never;
}>;

export type GoogleCallbackConnectionSnapshot = Readonly<{
  exists(): boolean;
  getRefreshToken(): PlaintextGoogleToken | null;
  getTokenExpiryAt(): string | null;
  getStatus(): string | null;
  getScopes(): string | null;
  getCredentialVersion(): GoogleCredentialVersion | null;
  toJSON(): never;
}>;

export type GoogleTokenCredentials = GoogleTokenCredentialHandle;

const GOOGLE_TOKEN_CREDENTIAL_HANDLE_DISPLAY = "[GoogleTokenCredentialHandle]";
const GOOGLE_TOKEN_CREDENTIAL_SERIALIZATION_ERROR =
  "Google token credentials cannot be serialized";

export class GoogleTokenCredentialSerializationError extends Error {
  readonly code = "GOOGLE_TOKEN_CREDENTIAL_SERIALIZATION_FORBIDDEN";

  constructor() {
    super(GOOGLE_TOKEN_CREDENTIAL_SERIALIZATION_ERROR);
    this.name = "GoogleTokenCredentialSerializationError";
  }
}

export function createGoogleTokenCredentialHandle(
  input: Readonly<{
    accessToken: PlaintextGoogleToken | null;
    refreshToken: PlaintextGoogleToken | null;
    tokenExpiryAt: string | null;
    status?: string | null;
    scopes?: string | null;
    rowExists?: boolean;
    credentialVersion?: GoogleCredentialVersion;
  }>,
): GoogleTokenCredentialHandle {
  const { accessToken, refreshToken, tokenExpiryAt } = input;
  const status = input.status ?? null;
  const scopes = input.scopes ?? null;
  const rowExists = input.rowExists ?? true;
  const credentialVersion =
    input.credentialVersion ?? createGoogleCredentialVersion(0);
  const handle = Object.create(Object.prototype) as Record<
    PropertyKey,
    unknown
  >;

  Object.defineProperties(handle, {
    exists: {
      value: () => rowExists,
      enumerable: false,
    },
    getAccessToken: {
      value: () => accessToken,
      enumerable: false,
    },
    getRefreshToken: {
      value: () => refreshToken,
      enumerable: false,
    },
    getTokenExpiryAt: {
      value: () => tokenExpiryAt,
      enumerable: false,
    },
    getStatus: {
      value: () => status,
      enumerable: false,
    },
    getScopes: {
      value: () => scopes,
      enumerable: false,
    },
    getCredentialVersion: {
      value: () => credentialVersion,
      enumerable: false,
    },
    toJSON: {
      value: (): never => {
        throw new GoogleTokenCredentialSerializationError();
      },
      enumerable: false,
    },
    toString: {
      value: () => GOOGLE_TOKEN_CREDENTIAL_HANDLE_DISPLAY,
      enumerable: false,
    },
  });

  return Object.freeze(handle) as GoogleTokenCredentialHandle;
}

function createGoogleCallbackConnectionSnapshot(
  input: Readonly<{
    rowExists: boolean;
    refreshToken: PlaintextGoogleToken | null;
    tokenExpiryAt: string | null;
    status: string | null;
    scopes: string | null;
    credentialVersion: GoogleCredentialVersion | null;
  }>,
): GoogleCallbackConnectionSnapshot {
  const snapshot = Object.create(Object.prototype) as Record<
    PropertyKey,
    unknown
  >;

  Object.defineProperties(snapshot, {
    exists: { value: () => input.rowExists, enumerable: false },
    getRefreshToken: { value: () => input.refreshToken, enumerable: false },
    getTokenExpiryAt: { value: () => input.tokenExpiryAt, enumerable: false },
    getStatus: { value: () => input.status, enumerable: false },
    getScopes: { value: () => input.scopes, enumerable: false },
    getCredentialVersion: {
      value: () => input.credentialVersion,
      enumerable: false,
    },
    toJSON: {
      value: (): never => {
        throw new GoogleTokenCredentialSerializationError();
      },
      enumerable: false,
    },
    toString: {
      value: () => "[GoogleCallbackConnectionSnapshot]",
      enumerable: false,
    },
  });

  return Object.freeze(snapshot) as GoogleCallbackConnectionSnapshot;
}

export class GoogleTokenStoreError extends Error {
  readonly code: GoogleTokenStoreErrorCode;

  constructor(code: GoogleTokenStoreErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "GoogleTokenStoreError";
    this.code = code;
  }
}

function fail(code: GoogleTokenStoreErrorCode): never {
  throw new GoogleTokenStoreError(code);
}

function validateUserId(userId: string): GoogleUserId {
  if (!UUID_PATTERN.test(userId)) {
    fail("GOOGLE_TOKEN_INPUT_INVALID");
  }

  return userId as GoogleUserId;
}

export function createGoogleUserId(userId: string): GoogleUserId {
  return validateUserId(userId);
}

export function createPlaintextGoogleToken(
  token: string,
): PlaintextGoogleToken {
  if (token.trim().length === 0 || isEncryptedGoogleToken(token)) {
    fail("GOOGLE_TOKEN_ENCRYPT_FAILED");
  }

  return token as PlaintextGoogleToken;
}

export function createGoogleCredentialVersion(
  value: string | number,
): GoogleCredentialVersion {
  const normalized =
    typeof value === "number"
      ? Number.isSafeInteger(value) && value >= 0
        ? String(value)
        : ""
      : value;

  if (!CREDENTIAL_VERSION_PATTERN.test(normalized)) {
    fail("GOOGLE_TOKEN_INPUT_INVALID");
  }

  let parsed: bigint;
  try {
    parsed = BigInt(normalized);
  } catch {
    fail("GOOGLE_TOKEN_INPUT_INVALID");
  }

  if (parsed > MAX_POSTGRES_BIGINT) {
    fail("GOOGLE_TOKEN_INPUT_INVALID");
  }

  return normalized as GoogleCredentialVersion;
}

export function createGoogleRefreshLeaseIdHash(
  value: string,
): GoogleRefreshLeaseIdHash {
  if (!REFRESH_LEASE_ID_HASH_PATTERN.test(value)) {
    fail("GOOGLE_TOKEN_INPUT_INVALID");
  }

  return value as GoogleRefreshLeaseIdHash;
}

function nextCredentialVersion(
  version: GoogleCredentialVersion,
): GoogleCredentialVersion {
  const current = BigInt(version);
  if (current >= MAX_POSTGRES_BIGINT) {
    fail("GOOGLE_TOKEN_STORE_FAILED");
  }

  return String(current + BigInt(1)) as GoogleCredentialVersion;
}

function markEncryptedGoogleToken(token: string): EncryptedGoogleToken {
  validateEncryptedGoogleToken(token);

  return token as EncryptedGoogleToken;
}

function markDecryptedGoogleToken(token: string): PlaintextGoogleToken {
  if (!token || isEncryptedGoogleToken(token)) {
    fail("GOOGLE_TOKEN_INPUT_INVALID");
  }

  return token as PlaintextGoogleToken;
}

function getSingleRow(
  result: RepositorySelectResult,
): GoogleTokenConnectionRow {
  if (!result.ok) {
    fail("GOOGLE_TOKEN_STORE_FAILED");
  }

  if (result.rows.length === 0) {
    fail("GOOGLE_TOKEN_ROW_NOT_FOUND");
  }

  if (result.rows.length > 1) {
    fail("GOOGLE_TOKEN_ROW_DUPLICATE");
  }

  return result.rows[0];
}

function assertSingleWrite(
  result: RepositoryWriteResult,
  expectedCredentialVersion: GoogleCredentialVersion,
): void {
  if (!result.ok) {
    fail("GOOGLE_TOKEN_STORE_FAILED");
  }

  if (result.credentialVersions.length === 0) {
    fail("GOOGLE_TOKEN_UPDATE_CONFLICT");
  }

  if (result.credentialVersions.length > 1) {
    fail("GOOGLE_TOKEN_ROW_DUPLICATE");
  }

  if (result.credentialVersions[0] !== expectedCredentialVersion) {
    fail("GOOGLE_TOKEN_STORE_FAILED");
  }
}

function normalizeStoredExpiry(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value.trim().length === 0) {
    fail("GOOGLE_TOKEN_STORE_FAILED");
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    fail("GOOGLE_TOKEN_STORE_FAILED");
  }

  return new Date(timestamp).toISOString();
}

function getStoredCredentialVersion(
  row: GoogleTokenConnectionRow,
): GoogleCredentialVersion {
  if (row.credentialVersionStored === undefined) {
    fail("GOOGLE_TOKEN_STORE_FAILED");
  }

  return row.credentialVersionStored;
}

export function createGoogleTokenEncryptionWritePreflight(
  dependencies: Readonly<{
    crypto: GoogleTokenCryptoAdapter;
    readInterlock: () => string | undefined;
  }>,
): () => void {
  const selfTestUserId = "00000000-0000-4000-8000-000000000000" as GoogleUserId;
  const selfTestToken =
    "google-token-encryption-self-test" as PlaintextGoogleToken;

  return () => {
    const interlock = dependencies.readInterlock();
    if (
      interlock === "true" ||
      (interlock !== undefined && interlock !== "false")
    ) {
      fail("GOOGLE_TOKEN_WRITE_DISABLED");
    }

    let encrypted: string;
    let decrypted: string;
    try {
      encrypted = dependencies.crypto.encrypt({
        token: selfTestToken,
        userId: selfTestUserId,
        tokenType: "access",
      });
      validateEncryptedGoogleToken(encrypted);
      decrypted = dependencies.crypto.decrypt({
        token: encrypted,
        userId: selfTestUserId,
        tokenType: "access",
      });
    } catch (error) {
      if (error instanceof GoogleTokenCryptoError) {
        throw error;
      }
      fail("GOOGLE_TOKEN_ENCRYPT_FAILED");
    }

    if (decrypted !== selfTestToken) {
      fail("GOOGLE_TOKEN_ENCRYPT_FAILED");
    }
  };
}

export function createGoogleTokenStore(
  dependencies: Readonly<{
    repository: GoogleTokenRepository;
    crypto: GoogleTokenCryptoAdapter;
    now: () => string;
  }>,
) {
  const { repository, crypto, now } = dependencies;

  function encryptForStore(
    token: PlaintextGoogleToken,
    userId: GoogleUserId,
    tokenType: "access" | "refresh",
  ): EncryptedGoogleToken {
    try {
      return markEncryptedGoogleToken(
        crypto.encrypt({ token, userId, tokenType }),
      );
    } catch (error) {
      if (
        error instanceof GoogleTokenCryptoError &&
        error.code !== "GOOGLE_TOKEN_FORMAT_UNSUPPORTED"
      ) {
        throw error;
      }

      fail("GOOGLE_TOKEN_ENCRYPT_FAILED");
    }
  }

  function decryptStoredToken(
    token: string | null | undefined,
    userId: GoogleUserId,
    tokenType: "access" | "refresh",
  ): PlaintextGoogleToken | null {
    if (!token) {
      return null;
    }

    return markDecryptedGoogleToken(
      crypto.decrypt({ token, userId, tokenType }),
    );
  }

  async function loadGoogleTokenCredentials(
    rawUserId: string,
  ): Promise<GoogleTokenCredentials> {
    const userId = validateUserId(rawUserId);
    const result = await repository.selectConnectionsByUserId({
      userId,
      columns: GOOGLE_TOKEN_CREDENTIAL_COLUMNS,
    });
    const row = getSingleRow(result);

    return createGoogleTokenCredentialHandle({
      accessToken: decryptStoredToken(row.accessTokenStored, userId, "access"),
      refreshToken: decryptStoredToken(
        row.refreshTokenStored,
        userId,
        "refresh",
      ),
      tokenExpiryAt: normalizeStoredExpiry(row.tokenExpiryAtStored),
      status: row.statusStored ?? null,
      scopes: row.scopesStored ?? null,
      credentialVersion: getStoredCredentialVersion(row),
    });
  }

  async function loadGoogleCallbackConnectionSnapshot(
    rawUserId: string,
  ): Promise<GoogleCallbackConnectionSnapshot> {
    const userId = validateUserId(rawUserId);
    const result = await repository.selectConnectionsByUserId({
      userId,
      columns: GOOGLE_CALLBACK_SNAPSHOT_COLUMNS,
    });

    if (!result.ok) {
      fail("GOOGLE_TOKEN_STORE_FAILED");
    }
    if (result.rows.length > 1) {
      fail("GOOGLE_TOKEN_ROW_DUPLICATE");
    }
    if (result.rows.length === 0) {
      return createGoogleCallbackConnectionSnapshot({
        rowExists: false,
        refreshToken: null,
        tokenExpiryAt: null,
        status: null,
        scopes: null,
        credentialVersion: null,
      });
    }

    const row = result.rows[0];
    return createGoogleCallbackConnectionSnapshot({
      rowExists: true,
      refreshToken: decryptStoredToken(
        row.refreshTokenStored,
        userId,
        "refresh",
      ),
      tokenExpiryAt: normalizeStoredExpiry(row.tokenExpiryAtStored),
      status: row.statusStored ?? null,
      scopes: row.scopesStored ?? null,
      credentialVersion: getStoredCredentialVersion(row),
    });
  }

  async function loadGoogleRefreshTokenForCallback(
    rawUserId: string,
  ): Promise<PlaintextGoogleToken | null> {
    const userId = validateUserId(rawUserId);
    const result = await repository.selectConnectionsByUserId({
      userId,
      columns: GOOGLE_CALLBACK_REFRESH_COLUMNS,
    });
    const row = getSingleRow(result);

    return decryptStoredToken(row.refreshTokenStored, userId, "refresh");
  }

  async function saveGoogleCallbackConnection(
    input: SaveGoogleCallbackConnectionInput,
  ): Promise<void> {
    const userId = validateUserId(input.userId);

    if (input.writeMode === "insert" && input.refreshToken.mode !== "update") {
      fail("GOOGLE_TOKEN_INPUT_INVALID");
    }

    if (
      input.writeMode === "update" &&
      (input.expectedCredentialVersion === undefined ||
        input.expectedStatus === undefined ||
        input.refreshLeaseIdHash === undefined)
    ) {
      fail("GOOGLE_TOKEN_INPUT_INVALID");
    }

    const nextVersion =
      input.writeMode === "insert"
        ? createGoogleCredentialVersion(0)
        : nextCredentialVersion(input.expectedCredentialVersion!);

    const accessTokenEncrypted = encryptForStore(
      input.accessToken,
      userId,
      "access",
    );
    let refreshTokenPayload:
      | Readonly<{ refresh_token_enc: EncryptedGoogleToken | null }>
      | undefined;

    if (input.refreshToken.mode === "update") {
      refreshTokenPayload = Object.freeze({
        refresh_token_enc: encryptForStore(
          input.refreshToken.token,
          userId,
          "refresh",
        ),
      });
    } else if (input.refreshToken.mode === "clear") {
      refreshTokenPayload = Object.freeze({ refresh_token_enc: null });
    }

    const payload: GoogleConnectionWritePayload = Object.freeze({
      access_token_enc: accessTokenEncrypted,
      ...(refreshTokenPayload ?? {}),
      token_expiry_at: input.state.tokenExpiryAt,
      scopes: input.state.scopes,
      status: "connected",
      last_verified_at: input.state.lastVerifiedAt,
      reauth_required: false,
      last_error_code: null,
      last_error_at: null,
      last_user_notified_at: input.state.lastUserNotifiedAt,
      last_user_notified_error_code: input.state.lastUserNotifiedErrorCode,
      updated_at: input.state.updatedAt,
      credential_version: nextVersion,
      ...(input.writeMode === "update"
        ? { refresh_lease_id_hash: null, refresh_lease_expires_at: null }
        : {}),
    });

    const result =
      input.writeMode === "insert"
        ? await repository.insertConnection({ userId, payload })
        : await repository.updateConnectionByCredentialVersion({
            userId,
            expectedStatus: input.expectedStatus!,
            expectedCredentialVersion: input.expectedCredentialVersion!,
            expectedRefreshLeaseIdHash: input.refreshLeaseIdHash!,
            payload,
          });

    assertSingleWrite(result, nextVersion);
  }

  async function updateRefreshedGoogleAccessToken(
    input: UpdateRefreshedGoogleAccessTokenInput,
  ): Promise<GoogleCredentialVersion> {
    const userId = validateUserId(input.userId);
    const accessTokenEncrypted = encryptForStore(
      input.accessToken,
      userId,
      "access",
    );
    const refreshTokenWrite = input.refreshToken ?? { mode: "preserve" };
    const nextVersion = nextCredentialVersion(input.expectedCredentialVersion);
    const refreshTokenPayload =
      refreshTokenWrite.mode === "update"
        ? Object.freeze({
            refresh_token_enc: encryptForStore(
              refreshTokenWrite.token,
              userId,
              "refresh",
            ),
          })
        : undefined;
    const payload: GoogleConnectionWritePayload = Object.freeze({
      access_token_enc: accessTokenEncrypted,
      ...(refreshTokenPayload ?? {}),
      token_expiry_at: input.tokenExpiryAt,
      last_verified_at: input.lastVerifiedAt,
      updated_at: input.updatedAt,
      credential_version: nextVersion,
      refresh_lease_id_hash: null,
      refresh_lease_expires_at: null,
    });
    const result = await repository.updateConnectionByCredentialVersion({
      userId,
      expectedStatus: "connected",
      expectedCredentialVersion: input.expectedCredentialVersion,
      expectedRefreshLeaseIdHash: input.refreshLeaseIdHash,
      payload,
    });

    assertSingleWrite(result, nextVersion);
    return nextVersion;
  }

  async function recordGoogleCredentialValidationFailure(
    input: RecordGoogleCredentialValidationFailureInput,
  ): Promise<void> {
    const userId = validateUserId(input.userId);
    if (input.writeMode !== "insert" && input.writeMode !== "update") {
      fail("GOOGLE_TOKEN_INPUT_INVALID");
    }
    if (
      input.writeMode === "update" &&
      (input.expectedCredentialVersion === undefined ||
        input.expectedStatus === undefined ||
        input.refreshLeaseIdHash === undefined)
    ) {
      fail("GOOGLE_TOKEN_INPUT_INVALID");
    }
    const timestamp = now();
    const nextVersion =
      input.writeMode === "insert"
        ? createGoogleCredentialVersion(0)
        : nextCredentialVersion(input.expectedCredentialVersion!);
    const payload: GoogleConnectionWritePayload = Object.freeze({
      status: "error",
      reauth_required: true,
      last_error_code: "GOOGLE_TOKEN_INVALID",
      last_error_at: timestamp,
      updated_at: timestamp,
      credential_version: nextVersion,
      ...(input.writeMode === "update"
        ? { refresh_lease_id_hash: null, refresh_lease_expires_at: null }
        : {}),
    });
    const result =
      input.writeMode === "insert"
        ? await repository.insertConnection({ userId, payload })
        : await repository.updateConnectionByCredentialVersion({
            userId,
            expectedStatus: input.expectedStatus!,
            expectedCredentialVersion: input.expectedCredentialVersion!,
            expectedRefreshLeaseIdHash: input.refreshLeaseIdHash!,
            payload,
          });

    assertSingleWrite(result, nextVersion);
  }

  async function disconnectGoogleConnection(
    input: DisconnectGoogleConnectionInput,
  ): Promise<void> {
    const userId = validateUserId(input.userId);
    const timestamp = now();
    const nextVersion = nextCredentialVersion(input.expectedCredentialVersion);
    const payload: GoogleConnectionWritePayload = Object.freeze({
      access_token_enc: null,
      refresh_token_enc: null,
      token_expiry_at: null,
      scopes: null,
      status: "disconnected",
      last_verified_at: null,
      reauth_required: false,
      last_error_code: null,
      last_error_at: null,
      updated_at: timestamp,
      credential_version: nextVersion,
      refresh_lease_id_hash: null,
      refresh_lease_expires_at: null,
    });
    const result = await repository.updateConnectionByCredentialVersion({
      userId,
      expectedStatus: input.expectedStatus,
      expectedCredentialVersion: input.expectedCredentialVersion,
      expectedRefreshLeaseIdHash: input.refreshLeaseIdHash,
      payload,
    });

    assertSingleWrite(result, nextVersion);
  }

  async function claimGoogleCredentialRefreshLease(
    input: ClaimGoogleCredentialRefreshLeaseInput,
  ): Promise<void> {
    const userId = validateUserId(input.userId);
    const result = await repository.claimGoogleCredentialRefreshLease({
      userId,
      expectedStatus: input.expectedStatus,
      expectedCredentialVersion: input.expectedCredentialVersion,
      leaseIdHash: input.leaseIdHash,
    });
    assertSingleWrite(result, input.expectedCredentialVersion);
  }

  async function releaseGoogleCredentialRefreshLease(
    input: ReleaseGoogleCredentialRefreshLeaseInput,
  ): Promise<void> {
    const userId = validateUserId(input.userId);
    const result = await repository.updateConnectionByCredentialVersion({
      userId,
      expectedStatus: input.expectedStatus,
      expectedCredentialVersion: input.expectedCredentialVersion,
      expectedRefreshLeaseIdHash: input.leaseIdHash,
      payload: {
        refresh_lease_id_hash: null,
        refresh_lease_expires_at: null,
      },
    });
    assertSingleWrite(result, input.expectedCredentialVersion);
  }

  return Object.freeze({
    loadGoogleTokenCredentials,
    loadGoogleRefreshTokenForCallback,
    loadGoogleCallbackConnectionSnapshot,
    saveGoogleCallbackConnection,
    updateRefreshedGoogleAccessToken,
    recordGoogleCredentialValidationFailure,
    disconnectGoogleConnection,
    claimGoogleCredentialRefreshLease,
    releaseGoogleCredentialRefreshLease,
  });
}
