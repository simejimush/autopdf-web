import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

const ROUTE_PATH = resolve(
  process.cwd(),
  "app/api/google-connections/upsert/route.ts",
);

type AuthResult = {
  data: { user: { id: string } | null };
  error: { message: string } | null;
};

function loadRoute(options: {
  authResult?: AuthResult;
  authError?: Error;
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
  const calls = { getUser: 0, from: 0 };
  const loadedModule = {
    exports: {} as { POST: (request: Request) => Promise<Response> },
  };

  const localRequire = (specifier: string) => {
    if (specifier === "next/server") {
      return { NextResponse };
    }

    if (specifier === "@/lib/supabase/server") {
      return {
        async createSupabaseServerClient() {
          if (options.authError) {
            throw options.authError;
          }

          return {
            auth: {
              async getUser() {
                calls.getUser += 1;
                return options.authResult;
              },
            },
            from() {
              calls.from += 1;
              throw new Error("DB access is forbidden");
            },
          };
        },
      };
    }

    throw new Error(`Unexpected route dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
  });

  return { POST: loadedModule.exports.POST, calls, source };
}

function unreadableRequest() {
  const calls = { json: 0, text: 0, body: 0 };
  const request = {
    async json() {
      calls.json += 1;
      throw new Error("request.json() must not be called");
    },
    async text() {
      calls.text += 1;
      throw new Error("request.text() must not be called");
    },
    get body() {
      calls.body += 1;
      throw new Error("request.body must not be read");
    },
  } as unknown as Request;

  return { request, calls };
}

async function expectFixedResponse(
  response: Response,
  status: number,
  body: { error: string },
) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(body);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
}

test("unauthenticated requests return a fixed 401 without side effects", async () => {
  const route = loadRoute({
    authResult: { data: { user: null }, error: null },
  });
  const body = unreadableRequest();

  await expectFixedResponse(
    await route.POST(body.request),
    401,
    { error: "Unauthorized" },
  );
  expect(route.calls).toEqual({ getUser: 1, from: 0 });
  expect(body.calls).toEqual({ json: 0, text: 0, body: 0 });
  expect(route.source).not.toContain("tokenStore");
});

test("authenticated requests return a fixed 410 without side effects", async () => {
  const route = loadRoute({
    authResult: {
      data: { user: { id: "44444444-4444-4444-8444-444444444444" } },
      error: null,
    },
  });
  const body = unreadableRequest();

  await expectFixedResponse(await route.POST(body.request), 410, {
    error: "Gone",
  });
  expect(route.calls).toEqual({ getUser: 1, from: 0 });
  expect(body.calls).toEqual({ json: 0, text: 0, body: 0 });
  expect(route.source).not.toContain("tokenStore");
});

test("auth failures return a fixed 401 without exposing the raw error", async () => {
  const rawAuthError = "raw-auth-error-with-sensitive-details";
  const route = loadRoute({
    authResult: {
      data: { user: null },
      error: { message: rawAuthError },
    },
  });

  const response = await route.POST(unreadableRequest().request);
  const responseBody = await response.clone().text();

  await expectFixedResponse(response, 401, { error: "Unauthorized" });
  expect(responseBody).not.toContain(rawAuthError);
  expect(route.calls).toEqual({ getUser: 1, from: 0 });
});
