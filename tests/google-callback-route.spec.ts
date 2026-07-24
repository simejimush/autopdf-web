import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

const ROUTE_PATH = resolve(process.cwd(), "app/api/google/callback/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";

function loadRoute(options?: {
  user?: { id: string } | null;
  preflightError?: Error;
  snapshotError?: Error;
  rowExists?: boolean;
  storedRefreshToken?: string | null;
  storedScopes?: string | null;
  exchangeOk?: boolean;
  exchangeStatus?: number;
  exchangeToken?: Record<string, unknown>;
  verifiedAccessToken?: string;
  validationRotatedRefreshToken?: string;
  verifyError?: Error;
  saveError?: Error;
  metadataError?: object | null;
}) {
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
    credentials: [] as Array<Record<string, unknown>>,
    saves: [] as Array<Record<string, unknown>>,
    metadataUpserts: [] as Array<Record<string, unknown>>,
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
    if (specifier === "googleapis") return { google: { auth: { OAuth2 } } };
    if (specifier === "@/lib/supabase/server") {
      return {
        async createSupabaseServerClient() {
          return {
            auth: {
              async getUser() {
                return {
                  data: { user: options?.user ?? { id: USER_ID } },
                  error: null,
                };
              },
            },
            from(table: string) {
              expect(table).toBe("google_connections");
              return {
                async upsert(payload: Record<string, unknown>) {
                  calls.metadataUpserts.push(payload);
                  return { error: options?.metadataError ?? null };
                },
              };
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
          };
        },
        async saveGoogleCallbackConnection(input: Record<string, unknown>) {
          events.push("save");
          calls.saves.push(input);
          if (options?.saveError) throw options.saveError;
        },
      };
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  const fetchMock = async () => {
    calls.fetch += 1;
    events.push("fetch");
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
        GOOGLE_CLIENT_SECRET: "dummy-client-secret",
        GOOGLE_REDIRECT_URI: "https://app.example.test/api/google/callback",
      },
    },
  });

  const request = new Request(
    `https://app.example.test/api/google/callback?code=dummy-code&state=${USER_ID}`,
  );
  return { GET: loadedModule.exports.GET, request, calls, events, source };
}

test("initial callback preflights, validates, and inserts encrypted-store input", async () => {
  const route = loadRoute();
  const response = await route.GET(route.request);

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
    expect(route.calls.metadataUpserts).toHaveLength(1);
    expect(route.calls.metadataUpserts[0]).not.toHaveProperty(
      "access_token_enc",
    );
    expect(route.calls.metadataUpserts[0]).not.toHaveProperty(
      "refresh_token_enc",
    );
  }
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

test("callback has no direct token column read or write", () => {
  const { source } = loadRoute();
  expect(source).not.toContain('.select("refresh_token_enc")');
  expect(source).not.toContain("access_token_enc:");
  expect(source).not.toContain("refresh_token_enc:");
  expect(source).not.toContain("token.access_token =");
  expect(source).toContain("saveGoogleCallbackConnection");
});
