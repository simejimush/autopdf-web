import {
  GoogleTokenCryptoError,
  isEncryptedGoogleToken,
  validateEncryptedGoogleToken,
} from "@/lib/security/googleTokenCrypto";

declare const plaintextGoogleTokenBrand: unique symbol;
declare const encryptedGoogleTokenBrand: unique symbol;
declare const googleUserIdBrand: unique symbol;

export type PlaintextGoogleToken = string & {
  readonly [plaintextGoogleTokenBrand]: true;
};

export type EncryptedGoogleToken = string & {
  readonly [encryptedGoogleTokenBrand]: true;
};

export type GoogleUserId = string & {
  readonly [googleUserIdBrand]: true;
};

export type GoogleTokenStoreErrorCode =
  | "GOOGLE_TOKEN_INPUT_INVALID"
  | "GOOGLE_TOKEN_ENCRYPT_FAILED"
  | "GOOGLE_TOKEN_STORE_FAILED"
  | "GOOGLE_TOKEN_UPDATE_CONFLICT"
  | "GOOGLE_TOKEN_ROW_NOT_FOUND"
  | "GOOGLE_TOKEN_ROW_DUPLICATE";

const SAFE_ERROR_MESSAGES: Record<GoogleTokenStoreErrorCode, string> = {
  GOOGLE_TOKEN_INPUT_INVALID: "Google token store input is invalid",
  GOOGLE_TOKEN_ENCRYPT_FAILED: "Google token encryption failed",
  GOOGLE_TOKEN_STORE_FAILED: "Google token storage failed",
  GOOGLE_TOKEN_UPDATE_CONFLICT: "Google token storage update conflicted",
  GOOGLE_TOKEN_ROW_NOT_FOUND: "Google token row was not found",
  GOOGLE_TOKEN_ROW_DUPLICATE: "Multiple Google token rows were found",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GOOGLE_TOKEN_CREDENTIAL_COLUMNS = Object.freeze([
  "access_token_enc",
  "refresh_token_enc",
] as const);

export const GOOGLE_CALLBACK_REFRESH_COLUMNS = Object.freeze([
  "refresh_token_enc",
] as const);

export type GoogleTokenReadColumn =
  | (typeof GOOGLE_TOKEN_CREDENTIAL_COLUMNS)[number]
  | (typeof GOOGLE_CALLBACK_REFRESH_COLUMNS)[number];

export type GoogleTokenConnectionRow = Readonly<{
  accessTokenStored?: string | null;
  refreshTokenStored?: string | null;
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
}>;

type RepositorySelectResult =
  | Readonly<{ ok: true; rows: readonly GoogleTokenConnectionRow[] }>
  | Readonly<{ ok: false }>;

type RepositoryWriteResult =
  | Readonly<{ ok: true; count: number }>
  | Readonly<{ ok: false }>;

export type GoogleTokenRepository = Readonly<{
  selectConnectionsByUserId(input: Readonly<{
    userId: GoogleUserId;
    columns: readonly GoogleTokenReadColumn[];
  }>): Promise<RepositorySelectResult>;
  insertConnection(input: Readonly<{
    userId: GoogleUserId;
    payload: GoogleConnectionWritePayload;
  }>): Promise<RepositoryWriteResult>;
  updateConnectionByUserId(input: Readonly<{
    userId: GoogleUserId;
    payload: GoogleConnectionWritePayload;
  }>): Promise<RepositoryWriteResult>;
}>;

type GoogleTokenCryptoAdapter = Readonly<{
  encrypt(input: Readonly<{
    token: PlaintextGoogleToken;
    userId: GoogleUserId;
    tokenType: "access" | "refresh";
  }>): string;
  decrypt(input: Readonly<{
    token: string;
    userId: GoogleUserId;
    tokenType: "access" | "refresh";
  }>): string;
}>;

export type GoogleRefreshTokenWrite =
  | Readonly<{ mode: "preserve" }>
  | Readonly<{ mode: "update"; token: PlaintextGoogleToken }>
  | Readonly<{ mode: "clear" }>;

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
}>;

export type UpdateRefreshedGoogleAccessTokenInput = Readonly<{
  userId: string;
  accessToken: PlaintextGoogleToken;
  tokenExpiryAt: string | null;
  lastVerifiedAt: string;
  updatedAt: string;
}>;

export type GoogleTokenCredentialHandle = Readonly<{
  getAccessToken(): PlaintextGoogleToken | null;
  getRefreshToken(): PlaintextGoogleToken | null;
  getTokenExpiryAt(): string | null;
  toJSON(): never;
}>;

export type GoogleTokenCredentials = GoogleTokenCredentialHandle;

const GOOGLE_TOKEN_CREDENTIAL_HANDLE_DISPLAY =
  "[GoogleTokenCredentialHandle]";
const GOOGLE_TOKEN_CREDENTIAL_SERIALIZATION_ERROR =
  "Google token credentials cannot be serialized";

export class GoogleTokenCredentialSerializationError extends Error {
  readonly code = "GOOGLE_TOKEN_CREDENTIAL_SERIALIZATION_FORBIDDEN";

  constructor() {
    super(GOOGLE_TOKEN_CREDENTIAL_SERIALIZATION_ERROR);
    this.name = "GoogleTokenCredentialSerializationError";
  }
}

export function createGoogleTokenCredentialHandle(input: Readonly<{
  accessToken: PlaintextGoogleToken | null;
  refreshToken: PlaintextGoogleToken | null;
  tokenExpiryAt: string | null;
}>): GoogleTokenCredentialHandle {
  const { accessToken, refreshToken, tokenExpiryAt } = input;
  const handle = Object.create(Object.prototype) as Record<
    PropertyKey,
    unknown
  >;

  Object.defineProperties(handle, {
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

export function createPlaintextGoogleToken(
  token: string,
): PlaintextGoogleToken {
  if (token.trim().length === 0 || isEncryptedGoogleToken(token)) {
    fail("GOOGLE_TOKEN_ENCRYPT_FAILED");
  }

  return token as PlaintextGoogleToken;
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

function assertSingleWrite(result: RepositoryWriteResult): void {
  if (!result.ok) {
    fail("GOOGLE_TOKEN_STORE_FAILED");
  }

  if (result.count !== 1) {
    fail("GOOGLE_TOKEN_UPDATE_CONFLICT");
  }
}

export function createGoogleTokenStore(dependencies: Readonly<{
  repository: GoogleTokenRepository;
  crypto: GoogleTokenCryptoAdapter;
  now: () => string;
}>) {
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
      accessToken: decryptStoredToken(
        row.accessTokenStored,
        userId,
        "access",
      ),
      refreshToken: decryptStoredToken(
        row.refreshTokenStored,
        userId,
        "refresh",
      ),
      tokenExpiryAt: null,
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
      last_user_notified_error_code:
        input.state.lastUserNotifiedErrorCode,
      updated_at: input.state.updatedAt,
    });

    const result =
      input.writeMode === "insert"
        ? await repository.insertConnection({ userId, payload })
        : await repository.updateConnectionByUserId({ userId, payload });

    assertSingleWrite(result);
  }

  async function updateRefreshedGoogleAccessToken(
    input: UpdateRefreshedGoogleAccessTokenInput,
  ): Promise<void> {
    const userId = validateUserId(input.userId);
    const accessTokenEncrypted = encryptForStore(
      input.accessToken,
      userId,
      "access",
    );
    const payload: GoogleConnectionWritePayload = Object.freeze({
      access_token_enc: accessTokenEncrypted,
      token_expiry_at: input.tokenExpiryAt,
      last_verified_at: input.lastVerifiedAt,
      updated_at: input.updatedAt,
    });
    const result = await repository.updateConnectionByUserId({
      userId,
      payload,
    });

    assertSingleWrite(result);
  }

  async function disconnectGoogleConnection(rawUserId: string): Promise<void> {
    const userId = validateUserId(rawUserId);
    const timestamp = now();
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
    });
    const result = await repository.updateConnectionByUserId({
      userId,
      payload,
    });

    assertSingleWrite(result);
  }

  return Object.freeze({
    loadGoogleTokenCredentials,
    loadGoogleRefreshTokenForCallback,
    saveGoogleCallbackConnection,
    updateRefreshedGoogleAccessToken,
    disconnectGoogleConnection,
  });
}
