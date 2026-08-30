import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

const ROUTE_PATH = resolve(process.cwd(), "app/api/rules/[id]/run/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const LEASE_ID_HASH = "a".repeat(64);

function unreadableRequest() {
  const calls = { json: 0, text: 0, body: 0 };
  const request = {
    async json() {
      calls.json += 1;
      throw new Error("request.json must not be read");
    },
    async text() {
      calls.text += 1;
      throw new Error("request.text must not be read");
    },
    get body() {
      calls.body += 1;
      throw new Error("request.body must not be read");
    },
    user_id: OTHER_USER_ID,
    rule_id: "attacker-rule-id",
    status: "success",
  } as unknown as Parameters<ReturnType<typeof loadRoute>["POST"]>[0];

  return { request, calls };
}

function loadRoute(options?: {
  user?: { id: string } | null;
  authError?: { message: string } | null;
  rule?: { id: string; user_id: string } | null;
  ruleError?: { message: string } | null;
  overflow?: boolean;
  guardErrorCode?: string;
  executeResult?: { ok: boolean; message: string };
  executeError?: Error;
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
    order: [] as string[],
    getUser: 0,
    ruleSelect: [] as string[],
    ruleEq: [] as Array<{ column: string; value: string }>,
    jwtRunInsert: [] as unknown[],
    overflow: [] as Array<{ userId: string; ruleId: string }>,
    repository: [] as Array<{ userId: string; ruleId: string }>,
    execute: [] as Array<{
      ruleId: string;
      userId: string;
      runId: string;
      leaseIdHash: string;
      trigger: string;
    }>,
  };
  const loadedModule = {
    exports: {} as {
      POST: (
        request: unknown,
        context: { params: Promise<{ id: string }> },
      ) => Promise<Response>;
    },
  };

  const localRequire = (specifier: string) => {
    if (specifier === "next/server") {
      return { NextResponse };
    }
    if (specifier === "@/lib/supabase/server") {
      return {
        async createSupabaseServerClient() {
          return {
            auth: {
              async getUser() {
                calls.getUser += 1;
                return {
                  data: {
                    user:
                      options?.user === undefined
                        ? { id: USER_ID }
                        : options.user,
                  },
                  error: options?.authError ?? null,
                };
              },
            },
            from(table: string) {
              if (table === "rules") {
                return {
                  select(columns: string) {
                    calls.ruleSelect.push(columns);
                    return {
                      eq(column: string, value: string) {
                        calls.ruleEq.push({ column, value });
                        return {
                          eq(secondColumn: string, secondValue: string) {
                            calls.ruleEq.push({
                              column: secondColumn,
                              value: secondValue,
                            });
                            return {
                              async maybeSingle() {
                                calls.order.push("rule_lookup");
                                return {
                                  data:
                                    options?.rule === undefined
                                      ? { id: RULE_ID, user_id: USER_ID }
                                      : options.rule,
                                  error: options?.ruleError ?? null,
                                };
                              },
                            };
                          },
                        };
                      },
                    };
                  },
                };
              }
              if (table === "runs") {
                return {
                  insert(payload: unknown) {
                    calls.jwtRunInsert.push(payload);
                    throw new Error(
                      "authenticated JWT runs insert is forbidden",
                    );
                  },
                };
              }
              throw new Error(`Unexpected table: ${table}`);
            },
          };
        },
      };
    }
    if (specifier === "@/lib/rules/freePlanLimit") {
      return {
        async isFreePlanOverflowRule(input: {
          userId: string;
          ruleId: string;
        }) {
          calls.order.push("overflow_check");
          calls.overflow.push(input);
          return {
            isOverflow: options?.overflow ?? false,
            overflowRuleIds: [],
          };
        },
      };
    }
    if (specifier === "@/lib/cost-safety/executionGuard") {
      return {
        async claimExecutionGuard(input: { userId: string; ruleId: string }) {
          calls.order.push("guard_claim");
          calls.repository.push(input);
          if (options?.guardErrorCode) {
            return { claimed: false, errorCode: options.guardErrorCode };
          }
          return {
            claimed: true,
            runId: RUN_ID,
            leaseIdHash: LEASE_ID_HASH,
          };
        },
      };
    }
    if (specifier === "@/lib/runs/getRunErrorMessage") {
      return {
        getRunErrorMessage() {
          return { title: "safe", message: "safe", action: "Retry later" };
        },
      };
    }
    if (specifier === "@/lib/runs/executeRule") {
      return {
        async executeRule(input: {
          ruleId: string;
          userId: string;
          runId: string;
          leaseIdHash: string;
          trigger: string;
        }) {
          calls.order.push("execute_rule");
          calls.execute.push(input);
          if (options?.executeError) {
            throw options.executeError;
          }
          return (
            options?.executeResult ?? { ok: true, message: "Run complete" }
          );
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

function context(id = RULE_ID) {
  return { params: Promise.resolve({ id }) };
}

test("unauthenticated manual runs remain a fixed 401 without side effects", async () => {
  const route = loadRoute({ user: null });
  const body = unreadableRequest();
  const response = await route.POST(body.request, context());

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
  expect(route.calls.ruleSelect).toHaveLength(0);
  expect(route.calls.repository).toHaveLength(0);
  expect(route.calls.execute).toHaveLength(0);
  expect(body.calls).toEqual({ json: 0, text: 0, body: 0 });
});

test("invalid route rule IDs remain a fixed 400", async () => {
  const route = loadRoute();
  const response = await route.POST(
    unreadableRequest().request,
    context("bad"),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid rule id" });
  expect(route.calls.ruleSelect).toHaveLength(0);
  expect(route.calls.repository).toHaveLength(0);
});

test("rule lookup fixes both route ID and authenticated ownership", async () => {
  const route = loadRoute({ rule: null });
  const response = await route.POST(unreadableRequest().request, context());

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Rule not found" });
  expect(route.calls.ruleSelect).toEqual(["id, user_id"]);
  expect(route.calls.ruleEq).toEqual([
    { column: "id", value: RULE_ID },
    { column: "user_id", value: USER_ID },
  ]);
  expect(route.calls.repository).toHaveLength(0);
  expect(route.calls.execute).toHaveLength(0);
});

test("mismatched rule rows fail closed before run creation", async () => {
  for (const rule of [
    { id: RULE_ID, user_id: OTHER_USER_ID },
    {
      id: "77777777-7777-4777-8777-777777777777",
      user_id: USER_ID,
    },
  ]) {
    const route = loadRoute({ rule });
    const response = await route.POST(unreadableRequest().request, context());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Rule not found" });
    expect(route.calls.repository).toHaveLength(0);
    expect(route.calls.execute).toHaveLength(0);
  }
});

test("rule lookup failures retain the existing fixed 500", async () => {
  const route = loadRoute({ ruleError: { message: "raw rule DB error" } });
  const response = await route.POST(unreadableRequest().request, context());

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Failed to fetch rule" });
  expect(route.calls.repository).toHaveLength(0);
});

test("Free overflow rules remain blocked before run creation", async () => {
  const route = loadRoute({ overflow: true });
  const response = await route.POST(unreadableRequest().request, context());

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error:
      "Freeプランでは4件目以降のルールは実行できません。Proに戻すと実行できます。",
    code: "FREE_PLAN_RULE_LIMIT_EXCEEDED",
  });
  expect(route.calls.repository).toHaveLength(0);
  expect(route.calls.execute).toHaveLength(0);
});

test("owned IDs create the run before exact executeRule delegation", async () => {
  const route = loadRoute();
  const body = unreadableRequest();
  const response = await route.POST(body.request, context());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    runId: RUN_ID,
    message: "Run complete",
  });
  expect(route.calls.repository).toEqual([
    { userId: USER_ID, ruleId: RULE_ID, trigger: "manual" },
  ]);
  expect(route.calls.execute).toEqual([
    {
      ruleId: RULE_ID,
      userId: USER_ID,
      runId: RUN_ID,
      leaseIdHash: LEASE_ID_HASH,
      trigger: "manual",
    },
  ]);
  expect(route.calls.order).toEqual([
    "rule_lookup",
    "overflow_check",
    "guard_claim",
    "execute_rule",
  ]);
  expect(route.calls.jwtRunInsert).toHaveLength(0);
  expect(body.calls).toEqual({ json: 0, text: 0, body: 0 });
  expect(route.source).not.toContain("supabaseAdmin");
  expect(route.source).not.toContain('.from("runs")');
  expect(route.source).not.toContain("console.");
});

test("guard store failures stop execution without legacy fallback", async () => {
  const route = loadRoute({ guardErrorCode: "GUARD_STORE_FAILED" });
  const response = await route.POST(unreadableRequest().request, context());

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Retry later",
    code: "GUARD_STORE_FAILED",
  });
  expect(route.calls.repository).toHaveLength(1);
  expect(route.calls.execute).toHaveLength(0);
  expect(route.source).not.toContain("createManualRun");
});

test("every expected guard rejection stops before execution", async () => {
  for (const [errorCode, status] of [
    ["SYSTEM_LIMIT_EXCEEDED", 429],
    ["USER_RATE_LIMIT_EXCEEDED", 429],
    ["EXECUTION_CONCURRENCY_LIMIT", 409],
    ["RUN_ALREADY_RUNNING", 409],
  ] as const) {
    const route = loadRoute({ guardErrorCode: errorCode });
    const response = await route.POST(unreadableRequest().request, context());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code: errorCode });
    expect(route.calls.execute).toHaveLength(0);
  }
});

test("executeRule failure results preserve the existing successful HTTP response", async () => {
  const route = loadRoute({
    executeResult: { ok: false, message: "Safe execution failure" },
  });
  const response = await route.POST(unreadableRequest().request, context());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: false,
    runId: RUN_ID,
    message: "Safe execution failure",
  });
  expect(route.calls.execute).toHaveLength(1);
});

test("thrown executeRule failures retain the existing fixed catch response", async () => {
  const route = loadRoute({ executeError: new Error("raw execute details") });
  const response = await route.POST(unreadableRequest().request, context());

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Internal Server Error" });
  expect(route.calls.repository).toHaveLength(1);
  expect(route.calls.execute).toHaveLength(1);
});
