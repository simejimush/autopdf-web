import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

const ROUTE_PATH = resolve(process.cwd(), "app/api/cron/route.ts");
const VERCEL_CONFIG_PATH = resolve(process.cwd(), "vercel.json");
const SECRET = "dummy-cron-secret-for-tests-only";

function loadRoute(options?: {
  cronSecret?: string;
  omitCronSecret?: boolean;
  allowCronWork?: boolean;
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
  const calls = {
    from: [] as string[],
    ruleSelect: [] as string[],
    overflow: 0,
    execute: 0,
    logs: [] as unknown[][],
    errors: [] as unknown[][],
  };
  const loadedModule = {
    exports: {} as { GET: (request: Request) => Promise<Response> },
  };

  const localRequire = (specifier: string) => {
    if (specifier === "next/server") {
      return { NextResponse };
    }

    if (specifier === "@/lib/supabase/admin") {
      return {
        supabaseAdmin: {
          from(table: string) {
            calls.from.push(table);
            if (!options?.allowCronWork) {
              throw new Error("DB access is forbidden before Cron auth");
            }
            if (table !== "rules") {
              throw new Error(`Unexpected table ${table}`);
            }
            return {
              async select(columns: string) {
                calls.ruleSelect.push(columns);
                return { data: [], error: null };
              },
            };
          },
        },
      };
    }

    if (specifier === "@/lib/rules/freePlanLimit") {
      return {
        async getFreePlanOverflowRuleIds() {
          calls.overflow += 1;
          throw new Error("Rule limit lookup is unexpected for empty rules");
        },
      };
    }

    if (specifier === "@/lib/runs/executeRule") {
      return {
        async executeRule() {
          calls.execute += 1;
          throw new Error("Rule execution is unexpected for empty rules");
        },
      };
    }

    throw new Error(`Unexpected route dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    process: {
      env: options?.omitCronSecret
        ? {}
        : { CRON_SECRET: options?.cronSecret ?? SECRET },
    },
    console: {
      log(...args: unknown[]) {
        calls.logs.push(args);
      },
      error(...args: unknown[]) {
        calls.errors.push(args);
      },
    },
  });

  return { GET: loadedModule.exports.GET, calls, source };
}

function request(options?: { authorization?: string; querySecret?: string }) {
  const url = new URL("https://example.invalid/api/cron");
  if (options?.querySecret) {
    url.searchParams.set("secret", options.querySecret);
  }

  return new Request(url, {
    headers: options?.authorization
      ? { Authorization: options.authorization }
      : undefined,
  });
}

function authorizedRequest() {
  return request({ authorization: `Bearer ${SECRET}` });
}

async function expectUnauthorized(
  route: ReturnType<typeof loadRoute>,
  cronRequest: Request,
) {
  const response = await route.GET(cronRequest);
  const responseText = await response.clone().text();

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
  expect(route.calls.from).toEqual([]);
  expect(route.calls.ruleSelect).toEqual([]);
  expect(route.calls.overflow).toBe(0);
  expect(route.calls.execute).toBe(0);
  expect(responseText).not.toContain(SECRET);
  expect(JSON.stringify(route.calls.logs)).not.toContain(SECRET);
  expect(JSON.stringify(route.calls.errors)).not.toContain(SECRET);
}

test("rejects a request without Authorization before side effects", async () => {
  await expectUnauthorized(loadRoute(), request());
});

test("rejects malformed Bearer authorization before side effects", async () => {
  for (const authorization of [SECRET, `Basic ${SECRET}`, "Bearer"]) {
    await expectUnauthorized(loadRoute(), request({ authorization }));
  }
});

test("rejects a mismatched secret before side effects", async () => {
  await expectUnauthorized(
    loadRoute(),
    request({ authorization: "Bearer wrong-dummy-secret" }),
  );
});

test("fails closed when CRON_SECRET is missing, empty, or whitespace", async () => {
  await expectUnauthorized(
    loadRoute({ omitCronSecret: true }),
    authorizedRequest(),
  );

  for (const cronSecret of ["", "   "]) {
    await expectUnauthorized(loadRoute({ cronSecret }), authorizedRequest());
  }
});

test("rejects legacy query authentication without Authorization", async () => {
  await expectUnauthorized(loadRoute(), request({ querySecret: SECRET }));
});

test("accepts the exact Bearer value and preserves the success response", async () => {
  const route = loadRoute({ allowCronWork: true });
  const response = await route.GET(authorizedRequest());
  const responseText = await response.clone().text();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    message: "Cron finished",
    total_rules: 0,
    enabled_rules: 0,
    runnable_rules: 0,
    free_overflow_skipped: 0,
    ok: 0,
    ng: 0,
    results: [],
  });
  expect(route.calls.from).toEqual(["rules"]);
  expect(route.calls.ruleSelect).toEqual(["*"]);
  expect(route.calls.overflow).toBe(0);
  expect(route.calls.execute).toBe(0);
  expect(responseText).not.toContain(SECRET);
  expect(JSON.stringify(route.calls.logs)).not.toContain(SECRET);
  expect(JSON.stringify(route.calls.errors)).not.toContain(SECRET);
});

test("tracked sources reject Cron query authentication", () => {
  const config = JSON.parse(readFileSync(VERCEL_CONFIG_PATH, "utf8"));
  expect(config.crons).toEqual([{ path: "/api/cron", schedule: "0 0 * * *" }]);

  const queryReaderPattern =
    /searchParams\.get\(\s*["'](?:secret|token)["']\s*\)/i;
  expect(readFileSync(ROUTE_PATH, "utf8")).not.toMatch(queryReaderPattern);

  const safeDirectory = process.cwd().replaceAll("\\", "/");
  const trackedFiles = execFileSync(
    "git",
    ["-c", `safe.directory=${safeDirectory}`, "ls-files", "-z"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.startsWith(".env"))
    .filter((path) => /\.(?:[cm]?[jt]sx?|json|md|ya?ml|toml)$/.test(path));
  const legacyCronQueryPattern = new RegExp(
    ["/api/cron", "\\?", "[^\\s\\\"']*", "(?:secret|token)="].join(""),
    "i",
  );
  const unsafeFiles = trackedFiles.filter((path) =>
    legacyCronQueryPattern.test(
      readFileSync(resolve(process.cwd(), path), "utf8"),
    ),
  );

  expect(unsafeFiles).toEqual([]);
});
