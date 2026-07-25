import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

const ROUTE_PATH = resolve(process.cwd(), "app/api/cron/route.ts");
const SECRET = "test-secret-never-return";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_RULE_ID = "77777777-7777-4777-8777-777777777777";
const RUN_ID = "88888888-8888-4888-8888-888888888888";

type Rule = {
  id?: string;
  user_id?: string | null;
  is_active?: boolean;
};

function loadRoute(options?: {
  rules?: Rule[];
  ruleError?: { message: string } | null;
  repositoryErrorFor?: string;
  repositoryError?: unknown;
  executeErrorFor?: string;
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
    ruleSelect: [] as string[],
    directRunInsert: [] as unknown[],
    overflow: [] as string[],
    repository: [] as Array<{ userId: string; ruleId: string }>,
    execute: [] as Array<{
      ruleId: string;
      userId: string;
      runId: string;
      trigger: string;
    }>,
    errors: [] as unknown[][],
  };
  const loadedModule = {
    exports: {} as { GET: (request: Request) => Promise<Response> },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextResponse };
    if (specifier === "@/lib/supabase/admin") {
      return {
        supabaseAdmin: {
          from(table: string) {
            if (table === "rules") {
              return {
                async select(columns: string) {
                  calls.ruleSelect.push(columns);
                  return {
                    data: options?.rules ?? [
                      { id: RULE_ID, user_id: USER_ID, is_active: true },
                    ],
                    error: options?.ruleError ?? null,
                  };
                },
              };
            }
            if (table === "runs") {
              return {
                insert(payload: unknown) {
                  calls.directRunInsert.push(payload);
                  throw new Error("direct runs insert is forbidden");
                },
              };
            }
            throw new Error(`Unexpected table ${table}`);
          },
        },
      };
    }
    if (specifier === "@/lib/rules/freePlanLimit") {
      return {
        async getFreePlanOverflowRuleIds(userId: string) {
          calls.overflow.push(userId);
          return [];
        },
      };
    }
    if (specifier === "@/lib/runs/cronRunRepository") {
      return {
        async createCronRun(input: { userId: string; ruleId: string }) {
          calls.repository.push(input);
          if (options?.repositoryErrorFor === input.ruleId) {
            throw (
              options.repositoryError ?? {
                code: "RUN_STORE_FAILED",
                message: "raw repository detail",
              }
            );
          }
          return {
            id: input.ruleId === RULE_ID ? RUN_ID : SECOND_RULE_ID,
            status: "running",
            started_at: "2026-08-03T00:00:00.000Z",
          };
        },
      };
    }
    if (specifier === "@/lib/runs/executeRule") {
      return {
        async executeRule(input: {
          ruleId: string;
          userId: string;
          runId: string;
          trigger: string;
        }) {
          calls.execute.push(input);
          if (options?.executeErrorFor === input.ruleId) {
            throw new Error("raw execute detail");
          }
          return {
            ok: true,
            processedCount: 0,
            savedCount: 0,
            skippedCount: 0,
            errorCode: null,
            message: "No matching emails",
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
    URL,
    process: { env: { CRON_SECRET: SECRET } },
    console: {
      log() {},
      error(...args: unknown[]) {
        calls.errors.push(args);
      },
    },
  });

  return { GET: loadedModule.exports.GET, calls, source };
}

function request(secret = SECRET) {
  return new Request(
    `https://example.invalid/api/cron?secret=${encodeURIComponent(secret)}`,
  );
}

test("rejects a mismatched secret before rule or run access", async () => {
  const route = loadRoute();
  const response = await route.GET(request("wrong-secret"));
  const text = await response.clone().text();

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
  expect(route.calls.ruleSelect).toHaveLength(0);
  expect(route.calls.repository).toHaveLength(0);
  expect(route.calls.execute).toHaveLength(0);
  expect(text).not.toContain(SECRET);
});

test("preserves rule selection and delegates owned identities before execution", async () => {
  const route = loadRoute();
  const response = await route.GET(request());
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toEqual({
    message: "Cron finished",
    total_rules: 1,
    enabled_rules: 1,
    runnable_rules: 1,
    free_overflow_skipped: 0,
    ok: 1,
    ng: 0,
    results: [
      {
        id: RULE_ID,
        ok: true,
        runId: RUN_ID,
        message: "No matching emails",
      },
    ],
  });
  expect(route.calls.ruleSelect).toEqual(["*"]);
  expect(route.calls.repository).toEqual([
    { userId: USER_ID, ruleId: RULE_ID },
  ]);
  expect(route.calls.execute).toEqual([
    {
      ruleId: RULE_ID,
      userId: USER_ID,
      runId: RUN_ID,
      trigger: "cron",
    },
  ]);
  expect(route.calls.directRunInsert).toHaveLength(0);
  expect(route.source).not.toContain('.from("runs")');
  expect(route.source).not.toContain(".insert({");
});

test("repository failure is safe, stops that rule, and continues other rules", async () => {
  const rawError = "raw repository detail";
  const route = loadRoute({
    rules: [
      { id: RULE_ID, user_id: USER_ID, is_active: true },
      { id: SECOND_RULE_ID, user_id: USER_ID, is_active: true },
    ],
    repositoryErrorFor: RULE_ID,
    repositoryError: { code: "RUN_STORE_FAILED", message: rawError },
  });
  const response = await route.GET(request());
  const text = await response.clone().text();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(route.calls.repository).toHaveLength(2);
  expect(route.calls.execute).toEqual([
    {
      ruleId: SECOND_RULE_ID,
      userId: USER_ID,
      runId: SECOND_RULE_ID,
      trigger: "cron",
    },
  ]);
  expect(body).toMatchObject({ ok: 1, ng: 1 });
  expect(body.results[0]).toEqual({
    id: RULE_ID,
    ok: false,
    error: "RUN_STORE_FAILED",
  });
  expect(text).not.toContain(rawError);
  expect(text).not.toContain(SECRET);
  expect(JSON.stringify(route.calls.errors)).not.toContain(rawError);
});

test("malformed and duplicate rule rows fail closed before repository access", async () => {
  for (const rules of [
    [{ id: "bad", user_id: USER_ID, is_active: true }],
    [{ id: RULE_ID, user_id: "bad", is_active: true }],
    [
      { id: RULE_ID, user_id: USER_ID, is_active: true },
      { id: RULE_ID, user_id: USER_ID, is_active: true },
    ],
  ]) {
    const route = loadRoute({ rules });
    const response = await route.GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(route.calls.repository).toHaveLength(0);
    expect(route.calls.execute).toHaveLength(0);
    expect(route.calls.overflow).toHaveLength(0);
    expect(body.ng).toBe(rules.length);
    expect(body.results).toEqual(
      rules.map((rule) => ({
        id: rule.id === RULE_ID ? RULE_ID : "(unknown)",
        ok: false,
        error: "RUN_STORE_INPUT_INVALID",
      })),
    );
  }
});

test("rule-query and thrown execution failures do not expose raw errors", async () => {
  const ruleRaw = "raw rules database detail";
  const failedQuery = loadRoute({ ruleError: { message: ruleRaw } });
  const queryResponse = await failedQuery.GET(request());
  const queryText = await queryResponse.clone().text();
  expect(queryResponse.status).toBe(500);
  expect(await queryResponse.json()).toEqual({
    error: "Failed to fetch rules",
  });
  expect(queryText).not.toContain(ruleRaw);
  expect(JSON.stringify(failedQuery.calls.errors)).not.toContain(ruleRaw);

  const executeRaw = "raw execute detail";
  const failedExecute = loadRoute({ executeErrorFor: RULE_ID });
  const executeResponse = await failedExecute.GET(request());
  const text = await executeResponse.clone().text();
  expect(executeResponse.status).toBe(200);
  expect(await executeResponse.json()).toMatchObject({
    ok: 0,
    ng: 1,
    results: [{ id: RULE_ID, ok: false, error: "UNKNOWN" }],
  });
  expect(text).not.toContain(executeRaw);
  expect(JSON.stringify(failedExecute.calls.errors)).not.toContain(executeRaw);
});
