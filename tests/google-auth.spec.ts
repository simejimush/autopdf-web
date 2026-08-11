import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import { createGoogleAuthCore } from "../src/lib/google/authCore";
import {
  createGoogleTokenCredentialHandle,
  createGoogleCredentialVersion,
  createGoogleRefreshLeaseIdHash,
  GoogleTokenStoreError,
  type GoogleTokenCredentials,
} from "../src/lib/google/tokenStoreCore";
import { createGoogleRefreshOperationId } from "../src/lib/google/refreshOperationCore";

const AUTH_PATH = resolve(process.cwd(), "src/lib/google/auth.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_0 = createGoogleCredentialVersion(0);
const VERSION_1 = createGoogleCredentialVersion(1);
const LEASE_HASH = createGoogleRefreshLeaseIdHash("a".repeat(64));
const LEASE = Object.freeze({
  getIdHash: () => LEASE_HASH,
  toJSON: (): never => {
    throw new Error("lease serialization forbidden");
  },
});

function credentials(options?: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiry?: string | null;
  status?: string | null;
}): GoogleTokenCredentials {
  return createGoogleTokenCredentialHandle({
    accessToken: (options?.accessToken === undefined
      ? "stored-access"
      : options.accessToken) as never,
    refreshToken: (options?.refreshToken === undefined
      ? "stored-refresh"
      : options.refreshToken) as never,
    tokenExpiryAt:
      options?.expiry === undefined
        ? "2999-01-01T00:00:00.000Z"
        : options.expiry,
    status: options?.status === undefined ? "connected" : options.status,
    scopes: "gmail.readonly drive.file",
    credentialVersion: VERSION_0,
  });
}

function loadAuth(options?: {
  storedCredentials?: GoogleTokenCredentials;
  loadError?: Error;
  preflightError?: Error;
  refreshError?: unknown;
  refreshedAccessToken?: string;
  rotatedRefreshToken?: string;
  refreshedExpiry?: number;
  updateError?: Error;
}) {
  const source = readFileSync(AUTH_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: AUTH_PATH,
  }).outputText;
  const calls = {
    loads: [] as string[],
    canaryLoads: [] as string[],
    preflight: 0,
    refresh: 0,
    claims: 0,
    releases: 0,
    updates: [] as Array<Record<string, unknown>>,
    clients: [] as Array<{ credentials: Record<string, unknown> }>,
    clientOptions: [] as unknown[],
  };

  class OAuth2 {
    credentials: Record<string, unknown> = {};
    private tokensListener?: (tokens: Record<string, unknown>) => void;

    constructor(options?: unknown) {
      calls.clients.push(this);
      calls.clientOptions.push(options);
    }

    setCredentials(value: Record<string, unknown>) {
      this.credentials = { ...value };
    }

    on(event: string, listener: (tokens: Record<string, unknown>) => void) {
      if (event === "tokens") this.tokensListener = listener;
      return this;
    }

    async getAccessToken() {
      calls.refresh += 1;
      if (options?.refreshError) throw options.refreshError;
      this.tokensListener?.({
        access_token: options?.refreshedAccessToken ?? "refreshed-access",
        ...(options?.rotatedRefreshToken
          ? { refresh_token: options.rotatedRefreshToken }
          : {}),
      });
      this.credentials = {
        ...this.credentials,
        access_token: options?.refreshedAccessToken ?? "refreshed-access",
        expiry_date:
          options?.refreshedExpiry ?? Date.parse("2999-01-01T00:00:00.000Z"),
        ...(options?.rotatedRefreshToken
          ? { refresh_token: options.rotatedRefreshToken }
          : {}),
      };
      return { token: this.credentials.access_token };
    }
  }

  const loadedModule = {
    exports: {} as {
      getOAuthClientForUser: (userId: string) => Promise<OAuth2>;
      refreshGoogleCredentialsForCanary: (userId: string) => Promise<{
        operationId: string;
        previousCredentialVersion: string;
        resultCredentialVersion: string;
        refreshTokenRotated: boolean;
      }>;
      GoogleOAuthError: new (code: string) => Error & { code: string };
    },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "googleapis") return { google: { auth: { OAuth2 } } };
    if (specifier === "@/lib/google/authCore") return { createGoogleAuthCore };
    if (specifier === "@/lib/google/tokenStoreCore") {
      return { GoogleTokenStoreError };
    }
    if (specifier === "@/lib/google/tokenStore") {
      return {
        createPlaintextGoogleToken: (value: string) => value,
        async loadGoogleTokenCredentials(userId: string) {
          calls.loads.push(userId);
          if (options?.loadError) throw options.loadError;
          return options?.storedCredentials ?? credentials();
        },
        async loadGoogleRefreshCanaryCredentials(userId: string) {
          calls.canaryLoads.push(userId);
          if (options?.loadError) throw options.loadError;
          return options?.storedCredentials ?? credentials();
        },
        preflightGoogleTokenEncryptionWrite() {
          calls.preflight += 1;
          if (options?.preflightError) throw options.preflightError;
        },
      };
    }
    if (specifier === "@/lib/google/refreshOperation") {
      return {
        async prepareGoogleRefreshOperation() {
          calls.claims += 1;
          return {
            state: "prepared",
            handle: {
              operationId: createGoogleRefreshOperationId(USER_ID, VERSION_0),
              lease: LEASE,
            },
          };
        },
        async markGoogleRefreshProviderStarted() {},
        async transitionGoogleRefreshOperation() {
          calls.releases += 1;
        },
        async finalizeGoogleRefreshOperation(input: Record<string, unknown>) {
          calls.updates.push(input);
          if (options?.updateError) throw options.updateError;
          return VERSION_1;
        },
      };
    }
    if (specifier === "@/lib/google/refreshOperationCore") {
      return { createGoogleRefreshOperationId };
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    process: {
      env: {
        GOOGLE_CLIENT_ID: "dummy-client-id",
        GOOGLE_CLIENT_SECRET: "dummy-client-secret",
      },
    },
  });

  return {
    getOAuthClientForUser: loadedModule.exports.getOAuthClientForUser,
    refreshGoogleCredentialsForCanary:
      loadedModule.exports.refreshGoogleCredentialsForCanary,
    GoogleOAuthError: loadedModule.exports.GoogleOAuthError,
    calls,
    source,
  };
}

test("canary forces exactly one operation-safe refresh even for usable credentials", async () => {
  const auth = loadAuth();
  const result = await auth.refreshGoogleCredentialsForCanary(USER_ID);

  expect(auth.calls.canaryLoads).toEqual([USER_ID]);
  expect(auth.calls.loads).toEqual([]);
  expect(auth.calls.claims).toBe(1);
  expect(auth.calls.preflight).toBe(1);
  expect(auth.calls.refresh).toBe(1);
  expect(auth.calls.updates).toHaveLength(1);
  expect(result).toEqual({
    operationId: createGoogleRefreshOperationId(USER_ID, VERSION_0),
    previousCredentialVersion: "0",
    resultCredentialVersion: "1",
    refreshTokenRotated: false,
  });
});

test("usable stored credentials return an OAuth client without refresh write", async () => {
  const auth = loadAuth();
  const client = await auth.getOAuthClientForUser(USER_ID);

  expect(auth.calls.loads).toEqual([USER_ID]);
  expect(auth.calls.preflight).toBe(0);
  expect(auth.calls.refresh).toBe(0);
  expect(auth.calls.updates).toEqual([]);
  expect(client.credentials).toMatchObject({
    access_token: "stored-access",
    refresh_token: "stored-refresh",
  });
});

test("expired credentials refresh and persist access-only exactly once", async () => {
  const auth = loadAuth({
    storedCredentials: credentials({ expiry: "2000-01-01T00:00:00.000Z" }),
  });
  const client = await auth.getOAuthClientForUser(USER_ID);

  expect(auth.calls.preflight).toBe(1);
  expect(auth.calls.refresh).toBe(1);
  expect(auth.calls.updates).toHaveLength(1);
  expect(auth.calls.claims).toBe(1);
  expect(auth.calls.updates[0]).toMatchObject({
    userId: USER_ID,
    accessToken: "refreshed-access",
    expectedCredentialVersion: VERSION_0,
  });
  expect(auth.calls.updates[0]).not.toHaveProperty("refreshToken");
  expect(client.credentials).toMatchObject({
    access_token: "refreshed-access",
    refresh_token: "stored-refresh",
  });
  expect(auth.calls.clientOptions[0]).toMatchObject({
    transporterOptions: {
      timeout: 30_000,
      retryConfig: { retry: 0, noResponseRetries: 0 },
    },
  });
});

test("rotated refresh token is persisted atomically with access", async () => {
  const auth = loadAuth({
    storedCredentials: credentials({ expiry: null }),
    rotatedRefreshToken: "rotated-refresh",
  });

  await auth.getOAuthClientForUser(USER_ID);

  expect(auth.calls.updates).toHaveLength(1);
  expect(auth.calls.updates[0].refreshToken).toBe("rotated-refresh");
});

test("preflight and Google failures do not perform tokenStore updates", async () => {
  const preflight = loadAuth({
    storedCredentials: credentials({ expiry: null }),
    preflightError: new GoogleTokenStoreError("GOOGLE_TOKEN_WRITE_DISABLED"),
  });
  await expect(preflight.getOAuthClientForUser(USER_ID)).rejects.toMatchObject({
    code: "GOOGLE_TOKEN_WRITE_DISABLED",
  });
  expect(preflight.calls.refresh).toBe(0);
  expect(preflight.calls.updates).toEqual([]);

  const googleFailure = loadAuth({
    storedCredentials: credentials({ expiry: null }),
    refreshError: {
      response: { status: 401, data: { error: "invalid_grant" } },
    },
  });
  await expect(
    googleFailure.getOAuthClientForUser(USER_ID),
  ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INVALID" });
  expect(googleFailure.calls.updates).toEqual([]);
});

test("store failure does not return a partially refreshed OAuth client", async () => {
  const auth = loadAuth({
    storedCredentials: credentials({ expiry: null }),
    updateError: new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED"),
  });

  await expect(auth.getOAuthClientForUser(USER_ID)).rejects.toMatchObject({
    code: "GOOGLE_REFRESH_OUTCOME_UNKNOWN",
  });
  expect(auth.calls.refresh).toBe(1);
  expect(auth.calls.updates).toHaveLength(1);
  expect(auth.calls.clients).toHaveLength(1);
});

test("missing rows, inactive status, and missing refresh preserve fixed errors", async () => {
  const cases = [
    {
      auth: loadAuth({
        loadError: new GoogleTokenStoreError("GOOGLE_TOKEN_ROW_NOT_FOUND"),
      }),
      code: "GOOGLE_CONNECTION_NOT_FOUND",
    },
    {
      auth: loadAuth({ storedCredentials: credentials({ status: "error" }) }),
      code: "GOOGLE_CONNECTION_NOT_FOUND",
    },
    {
      auth: loadAuth({
        storedCredentials: credentials({ refreshToken: null }),
      }),
      code: "GOOGLE_REFRESH_TOKEN_MISSING",
    },
  ];

  for (const testCase of cases) {
    await expect(
      testCase.auth.getOAuthClientForUser(USER_ID),
    ).rejects.toMatchObject({ code: testCase.code });
    expect(testCase.auth.calls.refresh).toBe(0);
    expect(testCase.auth.calls.updates).toEqual([]);
  }
});

test("auth adapter contains no direct DB, decrypt, or plaintext write path", () => {
  const { source } = loadAuth();
  expect(source).not.toContain("supabaseAdmin");
  expect(source).not.toContain("decryptGoogleToken");
  expect(source).not.toContain("access_token_enc");
  expect(source).not.toContain("refresh_token_enc");
  expect(source).not.toContain("console.log");
});
