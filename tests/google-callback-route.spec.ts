import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";
import { createHmac } from "node:crypto";
import {
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  GOOGLE_OAUTH_STATE_COOKIE_PATH,
  GOOGLE_OAUTH_STATE_TTL_SECONDS,
  createGoogleOAuthState,
  getGoogleOAuthStateCookieOptions,
  validateGoogleOAuthState,
} from "../src/lib/google/oauthStateCore";

const ROUTE_PATH = resolve(process.cwd(), "app/api/google/callback/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const REDIRECT_URI = "https://app.example.test/api/google/callback";
const SIGNING_SECRET = "dummy-client-secret";

type StatePayload = Readonly<{
  v: number;
  n: string;
  i: number;
  e: number;
  u: string;
  r: string;
  p?: string;
}>;

function decodeStatePayload(cookieValue: string): StatePayload {
  return JSON.parse(
    Buffer.from(cookieValue.split(".")[0], "base64url").toString("utf8"),
  ) as StatePayload;
}

function signStatePayload(payload: StatePayload): string {
  const signingKey = createHmac("sha256", SIGNING_SECRET)
    .update("autopdf|google-oauth-state|signing-key|v2")
    .digest();
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = createHmac("sha256", signingKey)
    .update("payload")
    .update("\0")
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function loadRoute(options?: {
  user?: { id: string } | null;
  preflightError?: Error;
  snapshotError?: Error;
  rowExists?: boolean;
  storedRefreshToken?: string | null;
  storedScopes?: string | null;
  storedStatus?: string | null;
  storedCredentialVersion?: string;
  exchangeOk?: boolean;
  exchangeStatus?: number;
  exchangeToken?: Record<string, unknown>;
  verifiedAccessToken?: string;
  validationRotatedRefreshToken?: string;
  verifyError?: Error;
  saveError?: Error;
  validationFailureError?: Error;
  state?: string | null;
  stateCookie?: string | null;
  stateIssuedAt?: number;
  code?: string | null;
  providerError?: string | null;
  transformStateCookie?: (cookieValue: string) => string;
}) {
  const generatedState = createGoogleOAuthState({
    userId: USER_ID,
    redirectUri: REDIRECT_URI,
    signingSecret: SIGNING_SECRET,
    ...(options?.stateIssuedAt === undefined
      ? {}
      : { now: options.stateIssuedAt }),
  });
  const requestState =
    options?.state === undefined ? generatedState.state : options.state;
  const stateCookie =
    options?.stateCookie === undefined
      ? (options?.transformStateCookie?.(generatedState.cookieValue) ??
        generatedState.cookieValue)
      : options.stateCookie;
  const codeVerifier = decodeStatePayload(generatedState.cookieValue).p!;
  const source = readFileSync(ROUTE_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: ROUTE_PATH,
  }).outputText;
  const events: string[] = [];
  const calls = {
    preflight: 0,
    snapshots: [] as string[],
    fetch: 0,
    tokenRequests: [] as Array<{
      url: string;
      codeVerifier: string | null;
      grantType: string | null;
    }>,
    credentials: [] as Array<Record<string, unknown>>,
    saves: [] as Array<Record<string, unknown>>,
    validationFailures: [] as Array<Record<string, unknown>>,
    jwtFrom: 0,
    cookieGets: [] as string[],
    logs: [] as unknown[][],
  };

  class OAuth2 {
    credentials: Record<string, unknown> = {};
    private tokensListener?: (tokens: Record<string, unknown>) => void;

    on(event: string, listener: (tokens: Record<string, unknown>) => void) {
      if (event === "tokens") this.tokensListener = listener;
      return this;
    }

    setCredentials(value: Record<string, unknown>) {
      this.credentials = { ...value };
      calls.credentials.push(value);
    }

    async getAccessToken() {
      events.push("verify");
      if (options?.verifyError) throw options.verifyError;
      this.tokensListener?.({
        ...(options?.validationRotatedRefreshToken
          ? { refresh_token: options.validationRotatedRefreshToken }
          : {}),
      });
      return { token: options?.verifiedAccessToken ?? "verified-access" };
    }
  }

  const loadedModule = {
    exports: {} as { GET: (request: Request) => Promise<Response> },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextResponse };
    if (specifier === "next/headers") {
      return {
        async cookies() {
          return {
            get(name: string) {
              calls.cookieGets.push(name);
              return stateCookie === null ? undefined : { value: stateCookie };
            },
          };
        },
      };
    }
    if (specifier === "googleapis") return { google: { auth: { OAuth2 } } };
    if (specifier === "@/lib/google/oauthStateCore") {
      return {
        GOOGLE_OAUTH_STATE_COOKIE_NAME,
        getGoogleOAuthStateCookieOptions,
        validateGoogleOAuthState,
      };
    }
    if (specifier === "@/lib/supabase/server") {
      return {
        async createSupabaseServerClient() {
          return {
            auth: {
              async getUser() {
                return {
                  data: {
                    user:
                      options?.user === undefined
                        ? { id: USER_ID }
                        : options.user,
                  },
                  error: null,
                };
              },
            },
            from(table: string) {
              calls.jwtFrom += 1;
              throw new Error(`Authenticated DB access is forbidden: ${table}`);
            },
          };
        },
      };
    }
    if (specifier === "@/lib/google/tokenStore") {
      return {
        createPlaintextGoogleToken(value: string) {
          if (!value.trim()) throw new Error("invalid dummy token");
          return value;
        },
        preflightGoogleTokenEncryptionWrite() {
          calls.preflight += 1;
          events.push("preflight");
          if (options?.preflightError) throw options.preflightError;
        },
        async loadGoogleCallbackConnectionSnapshot(userId: string) {
          calls.snapshots.push(userId);
          events.push("snapshot");
          if (options?.snapshotError) throw options.snapshotError;
          return {
            exists: () => options?.rowExists ?? false,
            getRefreshToken: () => options?.storedRefreshToken ?? null,
            getScopes: () => options?.storedScopes ?? null,
            getStatus: () => options?.storedStatus ?? "connected",
            getCredentialVersion: () =>
              (options?.rowExists ?? false)
                ? (options?.storedCredentialVersion ?? "0")
                : null,
          };
        },
        async saveGoogleCallbackConnection(input: Record<string, unknown>) {
          events.push("save");
          calls.saves.push(input);
          if (options?.saveError) throw options.saveError;
        },
        async recordGoogleCredentialValidationFailure(
          input: Record<string, unknown>,
        ) {
          events.push("validation-failure");
          calls.validationFailures.push(input);
          if (options?.validationFailureError) {
            throw options.validationFailureError;
          }
        },
      };
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  const fetchMock = async (input: string | URL, init?: RequestInit) => {
    calls.fetch += 1;
    events.push("fetch");
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.tokenRequests.push({
      url: String(input),
      codeVerifier: body.get("code_verifier"),
      grantType: body.get("grant_type"),
    });
    if (body.get("code_verifier") !== codeVerifier) {
      return {
        ok: false,
        status: 400,
        async json() {
          return { error: "invalid_grant" };
        },
      };
    }
    return {
      ok: options?.exchangeOk ?? true,
      status: options?.exchangeStatus ?? 200,
      async json() {
        return (
          options?.exchangeToken ?? {
            access_token: "exchange-access",
            refresh_token: "exchange-refresh",
            expires_in: 3600,
            scope: "gmail.readonly drive.file",
          }
        );
      },
    };
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    URL,
    URLSearchParams,
    fetch: fetchMock,
    console: { error: (...args: unknown[]) => calls.logs.push(args) },
    process: {
      env: {
        GOOGLE_CLIENT_ID: "dummy-client-id",
        GOOGLE_CLIENT_SECRET: SIGNING_SECRET,
        GOOGLE_REDIRECT_URI: REDIRECT_URI,
      },
    },
  });

  const searchParams = new URLSearchParams({ user_id: OTHER_USER_ID });
  const code = options?.code === undefined ? "dummy-code" : options.code;
  if (code !== null) searchParams.set("code", code);
  if (requestState !== null) searchParams.set("state", requestState);
  if (options?.providerError) {
    searchParams.set("error", options.providerError);
  }
  const request = new Request(
    `https://app.example.test/api/google/callback?${searchParams.toString()}`,
  );
  return {
    GET: loadedModule.exports.GET,
    request,
    calls,
    events,
    source,
    state: requestState,
    stateCookie,
    codeVerifier,
  };
}

test("initial callback preflights, validates, and inserts encrypted-store input", async () => {
  const route = loadRoute();
  const response = await route.GET(route.request);
  const setCookie = response.headers.get("set-cookie") ?? "";

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/settings?google=connected",
  );
  expect(route.events).toEqual([
    "preflight",
    "snapshot",
    "fetch",
    "verify",
    "save",
  ]);
  expect(route.calls.saves).toHaveLength(1);
  expect(route.calls.saves[0]).toMatchObject({
    userId: USER_ID,
    writeMode: "insert",
    accessToken: "verified-access",
    refreshToken: { mode: "update", token: "exchange-refresh" },
  });
  expect(route.calls.tokenRequests).toEqual([
    {
      url: "https://oauth2.googleapis.com/token",
      codeVerifier: route.codeVerifier,
      grantType: "authorization_code",
    },
  ]);
  expect(route.calls.cookieGets).toEqual([GOOGLE_OAUTH_STATE_COOKIE_NAME]);
  expect(setCookie).toContain(`${GOOGLE_OAUTH_STATE_COOKIE_NAME}=`);
  expect(setCookie).toContain("Max-Age=0");
  expect(setCookie).toContain(`Path=${GOOGLE_OAUTH_STATE_COOKIE_PATH}`);
});

test("reconnect without a new refresh dual-reads and re-encrypts the stored token", async () => {
  const route = loadRoute({
    rowExists: true,
    storedRefreshToken: "legacy-or-decrypted-refresh",
    storedScopes: "stored.scope",
    exchangeToken: { access_token: "exchange-access", expires_in: 3600 },
  });

  await route.GET(route.request);

  expect(route.calls.credentials[0]).toEqual({
    refresh_token: "legacy-or-decrypted-refresh",
  });
  expect(route.calls.saves[0]).toMatchObject({
    writeMode: "update",
    expectedStatus: "connected",
    expectedCredentialVersion: "0",
    refreshToken: {
      mode: "update",
      token: "legacy-or-decrypted-refresh",
    },
    state: { scopes: "stored.scope" },
  });
});

test("a newly returned refresh token replaces the old token in one save", async () => {
  const route = loadRoute({
    rowExists: true,
    storedRefreshToken: "old-refresh",
    exchangeToken: {
      access_token: "exchange-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    },
  });

  await route.GET(route.request);

  expect(route.calls.credentials[0]).toEqual({ refresh_token: "new-refresh" });
  expect(route.calls.saves[0]).toMatchObject({
    writeMode: "update",
    refreshToken: { mode: "update", token: "new-refresh" },
  });
});

test("validation token events are folded into the single callback save", async () => {
  const route = loadRoute({
    rowExists: true,
    storedRefreshToken: "old-refresh",
    exchangeToken: { access_token: "exchange-access", expires_in: 3600 },
    validationRotatedRefreshToken: "event-rotated-refresh",
  });

  await route.GET(route.request);

  expect(route.calls.saves).toHaveLength(1);
  expect(route.calls.saves[0]).toMatchObject({
    refreshToken: { mode: "update", token: "event-rotated-refresh" },
  });
});

test("missing or invalid refresh fails validation without token save", async () => {
  for (const exchangeToken of [
    { access_token: "exchange-access", expires_in: 3600 },
    {
      access_token: "exchange-access",
      refresh_token: "   ",
      expires_in: 3600,
    },
  ]) {
    const route = loadRoute({ exchangeToken });
    const response = await route.GET(route.request);

    expect(response.headers.get("location")).toBe(
      "https://app.example.test/settings?google=token_invalid",
    );
    expect(route.calls.saves).toEqual([]);
    expect(route.calls.validationFailures).toEqual([
      { userId: USER_ID, writeMode: "insert" },
    ]);
    expect(route.calls.jwtFrom).toBe(0);
  }
});

test("validation failure updates an existing row through the token store", async () => {
  const route = loadRoute({
    rowExists: true,
    storedRefreshToken: "stored-refresh",
    verifyError: new Error("provider-validation-failed"),
  });
  const response = await route.GET(route.request);

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/settings?google=token_invalid",
  );
  expect(route.calls.validationFailures).toEqual([
    {
      userId: USER_ID,
      writeMode: "update",
      expectedStatus: "connected",
      expectedCredentialVersion: "0",
    },
  ]);
  expect(JSON.stringify(route.calls.validationFailures)).not.toContain(
    OTHER_USER_ID,
  );
  expect(route.calls.jwtFrom).toBe(0);
});

test("missing, mismatched, and expired state stop before provider or database work", async () => {
  const cases = [
    loadRoute({ state: null }),
    loadRoute({ state: "x".repeat(43) }),
    loadRoute({ stateCookie: null }),
    loadRoute({
      stateIssuedAt: Date.now() - GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000 - 1_000,
    }),
  ];

  for (const route of cases) {
    const response = await route.GET(route.request);
    expect(response.headers.get("location")).toContain("google=state_invalid");
    expect(route.calls.preflight).toBe(0);
    expect(route.calls.snapshots).toEqual([]);
    expect(route.calls.fetch).toBe(0);
    expect(route.calls.saves).toEqual([]);
    expect(route.calls.validationFailures).toEqual([]);
    expect(route.calls.jwtFrom).toBe(0);
  }
});

test("missing, invalid, old, and tampered verifier envelopes stop before all side effects", async () => {
  const transforms = [
    (cookieValue: string) => {
      const payload = decodeStatePayload(cookieValue);
      return signStatePayload({ ...payload, p: undefined });
    },
    (cookieValue: string) =>
      signStatePayload({ ...decodeStatePayload(cookieValue), p: "" }),
    (cookieValue: string) =>
      signStatePayload({
        ...decodeStatePayload(cookieValue),
        p: `${"x".repeat(42)}=`,
      }),
    (cookieValue: string) =>
      signStatePayload({ ...decodeStatePayload(cookieValue), v: 1 }),
    (cookieValue: string) => {
      const [, signature] = cookieValue.split(".");
      const encodedPayload = Buffer.from(
        JSON.stringify({
          ...decodeStatePayload(cookieValue),
          p: "z".repeat(43),
        }),
      ).toString("base64url");
      return `${encodedPayload}.${signature}`;
    },
  ];

  for (const transformStateCookie of transforms) {
    const route = loadRoute({ transformStateCookie });
    const response = await route.GET(route.request);

    expect(response.headers.get("location")).toContain("google=state_invalid");
    expect(route.calls.preflight).toBe(0);
    expect(route.calls.snapshots).toEqual([]);
    expect(route.calls.fetch).toBe(0);
    expect(route.calls.tokenRequests).toEqual([]);
    expect(route.calls.saves).toEqual([]);
    expect(route.calls.validationFailures).toEqual([]);
    expect(route.calls.jwtFrom).toBe(0);
  }
});

test("state cannot cross users or authenticated browser sessions", async () => {
  const otherUser = loadRoute({ user: { id: OTHER_USER_ID } });
  const otherSession = loadRoute({ stateCookie: null });

  for (const route of [otherUser, otherSession]) {
    const response = await route.GET(route.request);
    expect(response.headers.get("location")).toContain("google=state_invalid");
    expect(route.calls.fetch).toBe(0);
    expect(route.calls.saves).toEqual([]);
  }
});

test("consumed state cannot be reused in the browser flow", async () => {
  const first = loadRoute();
  const firstResponse = await first.GET(first.request);
  expect(firstResponse.headers.get("location")).toContain("google=connected");
  expect(firstResponse.headers.get("set-cookie")).toContain("Max-Age=0");

  const replay = loadRoute({ state: first.state, stateCookie: null });
  const replayResponse = await replay.GET(replay.request);
  expect(replayResponse.headers.get("location")).toContain(
    "google=state_invalid",
  );
  expect(replay.calls.fetch).toBe(0);
  expect(replay.calls.saves).toEqual([]);
});

test("provider errors still require valid state before error handling", async () => {
  const invalid = loadRoute({
    state: "x".repeat(43),
    code: null,
    providerError: "access_denied",
  });
  const invalidResponse = await invalid.GET(invalid.request);
  expect(invalidResponse.headers.get("location")).toContain(
    "google=state_invalid",
  );
  expect(invalid.calls.fetch).toBe(0);
  expect(invalid.calls.tokenRequests).toEqual([]);
  expect(invalid.calls.snapshots).toEqual([]);

  const valid = loadRoute({ code: null, providerError: "access_denied" });
  const validResponse = await valid.GET(valid.request);
  expect(validResponse.headers.get("location")).toContain(
    "google=access_denied",
  );
  expect(valid.calls.fetch).toBe(0);
  expect(valid.calls.snapshots).toEqual([]);
});

test("unauthenticated callbacks consume state without provider or database work", async () => {
  const route = loadRoute({ user: null });
  const response = await route.GET(route.request);

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/login",
  );
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(route.calls.validationFailures).toEqual([]);
  expect(route.calls.fetch).toBe(0);
  expect(route.calls.snapshots).toEqual([]);
});

test("health write failure preserves the token-invalid redirect safely", async () => {
  const secret = "raw-health-db-secret";
  const route = loadRoute({
    verifyError: new Error("provider-validation-failed"),
    validationFailureError: new Error(secret),
  });
  const response = await route.GET(route.request);

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/settings?google=token_invalid",
  );
  expect(JSON.stringify(route.calls.logs)).not.toContain(secret);
  expect(route.calls.jwtFrom).toBe(0);
});

test("preflight and snapshot failures stop before Google token exchange", async () => {
  const preflight = loadRoute({
    preflightError: new Error("raw-keyring-secret"),
  });
  const preflightResponse = await preflight.GET(preflight.request);
  expect(preflightResponse.headers.get("location")).toContain("env_missing");
  expect(preflight.calls.fetch).toBe(0);
  expect(preflight.calls.snapshots).toEqual([]);

  const snapshot = loadRoute({ snapshotError: new Error("raw-db-secret") });
  const snapshotResponse = await snapshot.GET(snapshot.request);
  expect(snapshotResponse.headers.get("location")).toContain("load_failed");
  expect(snapshot.calls.fetch).toBe(0);
  expect(snapshot.calls.saves).toEqual([]);
});

test("exchange, validation, and save failures use fixed redirects without secrets", async () => {
  const cases = [
    loadRoute({
      exchangeOk: false,
      exchangeStatus: 400,
      exchangeToken: { error: "raw-provider-secret" },
    }),
    loadRoute({ verifyError: new Error("raw-google-secret") }),
    loadRoute({ saveError: new Error("raw-store-secret") }),
  ];
  const expected = ["token_failed", "token_invalid", "save_failed"];

  for (const [index, route] of cases.entries()) {
    const response = await route.GET(route.request);
    expect(response.headers.get("location")).toContain(expected[index]);
    const output = `${await response.clone().text()}${JSON.stringify(
      route.calls.logs,
    )}`;
    expect(output).not.toContain("raw-provider-secret");
    expect(output).not.toContain("raw-google-secret");
    expect(output).not.toContain("raw-store-secret");
  }
});

test("state rejection does not expose state cookie, tokens, or raw errors", async () => {
  const route = loadRoute({
    stateCookie: "tampered-cookie-with-private-nonce",
    exchangeToken: {
      access_token: "private-exchange-access-token",
      refresh_token: "private-exchange-refresh-token",
    },
  });
  const response = await route.GET(route.request);
  const output = `${response.headers.get("location")}${await response
    .clone()
    .text()}${response.headers.get("set-cookie")}${JSON.stringify(
    route.calls.logs,
  )}`;

  expect(response.headers.get("location")).toContain("google=state_invalid");
  expect(output).not.toContain(route.state ?? "not-present");
  expect(output).not.toContain("tampered-cookie-with-private-nonce");
  expect(output).not.toContain("private-exchange-access-token");
  expect(output).not.toContain("private-exchange-refresh-token");
  expect(output).not.toContain(route.codeVerifier);
  expect(route.calls.fetch).toBe(0);
  expect(route.calls.saves).toEqual([]);
});

test("callback has no direct token column read or write", () => {
  const { source } = loadRoute();
  expect(source).not.toContain('.select("refresh_token_enc")');
  expect(source).not.toContain("access_token_enc:");
  expect(source).not.toContain("refresh_token_enc:");
  expect(source).not.toContain("token.access_token =");
  expect(source).not.toContain('.from("google_connections")');
  expect(source).not.toContain(".upsert(");
  expect(source).not.toContain("supabaseAdmin");
  expect(source).not.toContain("state !== user.id");
  expect(source).toContain("validateGoogleOAuthState");
  expect(source).toContain("code_verifier: codeVerifier");
  expect(source).toContain("redirectWithConsumedOAuthState");
  expect(source).toContain("recordGoogleCredentialValidationFailure");
  expect(source).toContain("saveGoogleCallbackConnection");
});
