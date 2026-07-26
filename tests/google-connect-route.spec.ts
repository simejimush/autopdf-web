import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";
import {
  createGoogleOAuthState,
  getGoogleOAuthStateCookieOptions,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  GOOGLE_OAUTH_STATE_COOKIE_PATH,
  GOOGLE_OAUTH_STATE_TTL_SECONDS,
} from "../src/lib/google/oauthStateCore";

const ROUTE_PATH = resolve(process.cwd(), "app/api/google/connect/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";

function loadRoute(options?: {
  user?: { id: string } | null;
  preflightError?: Error;
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
  const calls = { getUser: 0, preflight: 0, logs: [] as unknown[][] };
  const loadedModule = {
    exports: {} as { GET: () => Promise<Response> },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextResponse };
    if (specifier === "@/lib/supabase/server") {
      return {
        async createSupabaseServerClient() {
          return {
            auth: {
              async getUser() {
                calls.getUser += 1;
                return { data: { user: options?.user ?? null } };
              },
            },
          };
        },
      };
    }
    if (specifier === "@/lib/google/tokenStore") {
      return {
        preflightGoogleTokenEncryptionWrite() {
          calls.preflight += 1;
          if (options?.preflightError) throw options.preflightError;
        },
      };
    }
    if (specifier === "@/lib/google/oauthStateCore") {
      return {
        createGoogleOAuthState,
        getGoogleOAuthStateCookieOptions,
        GOOGLE_OAUTH_STATE_COOKIE_NAME,
        GOOGLE_OAUTH_STATE_COOKIE_PATH,
        GOOGLE_OAUTH_STATE_TTL_SECONDS,
      };
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    URL,
    console: { error: (...args: unknown[]) => calls.logs.push(args) },
    process: {
      env: {
        APP_URL: "https://app.example.test",
        GOOGLE_CLIENT_ID: "dummy-client-id",
        GOOGLE_CLIENT_SECRET: "dummy-client-secret",
        GOOGLE_REDIRECT_URI: "https://app.example.test/api/google/callback",
      },
    },
  });

  return { GET: loadedModule.exports.GET, calls, source };
}

test("unauthenticated connect preserves login redirect without preflight", async () => {
  const route = loadRoute({ user: null });
  const response = await route.GET();

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/login",
  );
  expect(route.calls).toMatchObject({ getUser: 1, preflight: 0 });
});

test("authenticated connect preflights before returning the OAuth redirect", async () => {
  const route = loadRoute({ user: { id: USER_ID } });
  const response = await route.GET();
  const location = new URL(response.headers.get("location")!);
  const setCookie = response.headers.get("set-cookie") ?? "";

  expect(route.calls.preflight).toBe(1);
  expect(location.origin).toBe("https://accounts.google.com");
  expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(location.searchParams.get("state")).not.toBe(USER_ID);
  expect(location.toString()).not.toContain(USER_ID);
  expect(location.searchParams.get("access_type")).toBe("offline");
  expect(location.searchParams.get("prompt")).toBe("consent");
  expect(setCookie).toContain(`${GOOGLE_OAUTH_STATE_COOKIE_NAME}=`);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("SameSite=lax");
  expect(setCookie).toContain(`Path=${GOOGLE_OAUTH_STATE_COOKIE_PATH}`);
  expect(setCookie).toContain(`Max-Age=${GOOGLE_OAUTH_STATE_TTL_SECONDS}`);
  expect(setCookie).not.toContain(USER_ID);
});

test("authenticated connect creates a fresh state for every attempt", async () => {
  const route = loadRoute({ user: { id: USER_ID } });
  const first = new URL((await route.GET()).headers.get("location")!);
  const second = new URL((await route.GET()).headers.get("location")!);

  expect(first.searchParams.get("state")).not.toBe(
    second.searchParams.get("state"),
  );
});

test("preflight failure fails closed without exposing the raw error", async () => {
  const secret = "raw-keyring-error-with-secret-material";
  const route = loadRoute({
    user: { id: USER_ID },
    preflightError: new Error(secret),
  });
  const response = await route.GET();
  const responseText = await response.clone().text();

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/settings?google=env_missing",
  );
  expect(responseText).not.toContain(secret);
  expect(JSON.stringify(route.calls.logs)).not.toContain(secret);
  expect(route.calls.preflight).toBe(1);
});

test("connect contains no token write or user-bound preflight input", () => {
  const { source } = loadRoute();
  expect(source).not.toContain("access_token_enc");
  expect(source).not.toContain("refresh_token_enc");
  expect(source).not.toContain("saveGoogleCallbackConnection");
  expect(source).toContain("preflightGoogleTokenEncryptionWrite()");
});
