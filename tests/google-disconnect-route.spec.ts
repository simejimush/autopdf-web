import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";
import { GoogleTokenStoreError } from "../src/lib/google/tokenStoreCore";

const ROUTE_PATH = resolve(process.cwd(), "app/api/google/disconnect/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";

function loadRoute(options?: {
  user?: { id: string } | null;
  authError?: object | null;
  disconnectError?: Error;
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
  const calls = { getUser: 0, from: 0, disconnect: [] as string[] };
  const loadedModule = {
    exports: {} as { POST: () => Promise<Response> },
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
    if (specifier === "@/lib/google/tokenStore") {
      return {
        async disconnectGoogleConnection(userId: string) {
          calls.disconnect.push(userId);
          if (options?.disconnectError) throw options.disconnectError;
        },
      };
    }
    if (specifier === "@/lib/google/tokenStoreCore") {
      return { GoogleTokenStoreError };
    }
    throw new Error(`Unexpected dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    URL,
    process: { env: { APP_URL: "https://app.example.test" } },
  });

  return { POST: loadedModule.exports.POST, calls, source };
}

test("unauthenticated disconnect preserves login redirect", async () => {
  const route = loadRoute({ user: null });
  const response = await route.POST();

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/login",
  );
  expect(route.calls.disconnect).toEqual([]);
  expect(route.calls.from).toBe(0);
});

test("authenticated disconnect delegates one user-scoped clear", async () => {
  const route = loadRoute({ user: { id: USER_ID } });
  const response = await route.POST();

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/settings?google=disconnected",
  );
  expect(route.calls.disconnect).toEqual([USER_ID]);
  expect(route.calls.from).toBe(0);
});

test("disconnect failure is fixed and does not expose raw DB details", async () => {
  const secret = "raw-disconnect-db-error-secret";
  const route = loadRoute({
    user: { id: USER_ID },
    disconnectError: new Error(secret),
  });
  const response = await route.POST();

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/settings?google=disconnect_failed",
  );
  expect(await response.clone().text()).not.toContain(secret);
  expect(route.calls.disconnect).toEqual([USER_ID]);
});

test("active refresh returns a dedicated safe retry signal", async () => {
  const route = loadRoute({
    user: { id: USER_ID },
    disconnectError: new GoogleTokenStoreError(
      "GOOGLE_TOKEN_REFRESH_IN_PROGRESS",
    ),
  });
  const response = await route.POST();

  expect(response.headers.get("location")).toBe(
    "https://app.example.test/settings?google=refresh_in_progress",
  );
  expect(route.calls.disconnect).toEqual([USER_ID]);
});

test("disconnect route has no direct token or DB write path", () => {
  const { source } = loadRoute();
  expect(source).not.toContain("access_token_enc");
  expect(source).not.toContain("refresh_token_enc");
  expect(source).not.toContain('.from("google_connections")');
  expect(source).not.toContain("preflightGoogleTokenEncryptionWrite");
});
