import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

import { evaluateGoogleRefreshCanaryGate } from "../src/lib/google/refreshCanaryCore";
import { GoogleTokenStoreError } from "../src/lib/google/tokenStoreCore";

const ROUTE_PATH = resolve(
  process.cwd(),
  "app/api/google/refresh-canary/route.ts",
);
const USER_ID = "44444444-4444-4444-8444-444444444444";
const ALLOWED_HOST = "autopdf-preview.example.test";

function loadRoute(options?: {
  user?: { id: string } | null;
  authError?: object | null;
  vercelEnv?: string;
  enabled?: string;
  allowedHost?: string;
  refreshError?: Error;
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
  const calls = { getUser: 0, refresh: [] as string[], from: 0 };
  const loadedModule = {
    exports: {} as { POST: (request: Request) => Promise<Response> },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextResponse };
    if (specifier === "@/lib/google/refreshCanaryCore") {
      return { evaluateGoogleRefreshCanaryGate };
    }
    if (specifier === "@/lib/google/tokenStoreCore") {
      return { GoogleTokenStoreError };
    }
    if (specifier === "@/lib/google/auth") {
      return {
        async refreshGoogleCredentialsForCanary(userId: string) {
          calls.refresh.push(userId);
          if (options?.refreshError) throw options.refreshError;
          return {
            operationId: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
            previousCredentialVersion: "4",
            resultCredentialVersion: "5",
            refreshTokenRotated: false,
          };
        },
      };
    }
    if (specifier === "@/lib/supabase/server") {
      return {
        async createSupabaseServerClient() {
          return {
            auth: {
              async getUser() {
                calls.getUser += 1;
                return {
                  data: { user: options?.user ?? null },
                  error: options?.authError ?? null,
                };
              },
            },
            from() {
              calls.from += 1;
              throw new Error("Direct DB access is forbidden");
            },
          };
        },
      };
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    URL,
    process: {
      env: {
        VERCEL_ENV: options?.vercelEnv ?? "preview",
        GOOGLE_REFRESH_CANARY_ENABLED: options?.enabled ?? "true",
        GOOGLE_REFRESH_CANARY_ALLOWED_HOST:
          options?.allowedHost ?? ALLOWED_HOST,
      },
    },
  });

  return { POST: loadedModule.exports.POST, calls, source };
}

function request(host = ALLOWED_HOST) {
  return new Request(`https://${host}/api/google/refresh-canary`, {
    method: "POST",
  });
}

test("authentication is required before every canary gate", async () => {
  const route = loadRoute({
    user: null,
    vercelEnv: "production",
    enabled: "false",
    allowedHost: "invalid host",
  });
  const response = await route.POST(request());

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    ok: false,
    error_code: "AUTH_REQUIRED",
  });
  expect(route.calls.refresh).toEqual([]);
  expect(route.calls.from).toBe(0);
});

for (const testCase of [
  {
    name: "production",
    options: { vercelEnv: "production" },
    status: 404,
    code: "PREVIEW_ONLY",
  },
  {
    name: "disabled flag",
    options: { enabled: "false" },
    status: 503,
    code: "CANARY_DISABLED",
  },
  {
    name: "missing host config",
    options: { allowedHost: "" },
    status: 503,
    code: "CANARY_HOST_NOT_CONFIGURED",
  },
] as const) {
  test(`${testCase.name} fails closed before refresh`, async () => {
    const route = loadRoute({ user: { id: USER_ID }, ...testCase.options });
    const response = await route.POST(request());
    expect(response.status).toBe(testCase.status);
    expect(await response.json()).toEqual({
      ok: false,
      error_code: testCase.code,
    });
    expect(route.calls.refresh).toEqual([]);
  });
}

test("an exact configured host delegates once for the authenticated user", async () => {
  const route = loadRoute({ user: { id: USER_ID } });
  const response = await route.POST(request());
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(route.calls.refresh).toEqual([USER_ID]);
  expect(body).toEqual({
    ok: true,
    state: "completed",
    operationId: "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa",
    previousCredentialVersion: "4",
    resultCredentialVersion: "5",
    refreshTokenRotated: false,
  });
});

test("host mismatch and wildcard-like config fail before refresh", async () => {
  for (const [allowedHost, requestHost, code] of [
    [ALLOWED_HOST, "other-preview.example.test", "CANARY_HOST_FORBIDDEN"],
    ["*.example.test", ALLOWED_HOST, "CANARY_HOST_NOT_CONFIGURED"],
    [
      "https://autopdf-preview.example.test",
      ALLOWED_HOST,
      "CANARY_HOST_NOT_CONFIGURED",
    ],
  ] as const) {
    const route = loadRoute({ user: { id: USER_ID }, allowedHost });
    const response = await route.POST(request(requestHost));
    expect(await response.json()).toEqual({ ok: false, error_code: code });
    expect(route.calls.refresh).toEqual([]);
  }
});

test("operation conflicts return fixed metadata without raw error details", async () => {
  const route = loadRoute({
    user: { id: USER_ID },
    refreshError: new GoogleTokenStoreError("GOOGLE_REFRESH_OUTCOME_UNKNOWN"),
  });
  const response = await route.POST(request());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    ok: false,
    error_code: "REFRESH_OUTCOME_UNKNOWN",
  });
});

test("route is POST-only and contains no forbidden downstream workflow", () => {
  const { source } = loadRoute();
  expect(source).toContain("export async function POST");
  expect(source).not.toContain("export async function GET");
  for (const forbidden of [
    "gmail",
    "drive",
    "pdf",
    "processed_emails",
    "rules",
    "runs",
    "refresh_token_enc",
    ".from(",
  ]) {
    expect(source.toLowerCase()).not.toContain(forbidden);
  }
});
