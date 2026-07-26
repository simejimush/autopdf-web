import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";
import { normalizeFileNameFormatForPlan } from "../src/lib/rules/fileNameFormat";
import { normalizeRuleSubjectKeywords } from "../src/lib/rules/ruleCreationRepositoryCore";

const ROUTE_PATH = resolve(process.cwd(), "app/api/rules/[id]/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

function currentRule() {
  return {
    id: RULE_ID,
    user_id: USER_ID,
    is_active: true,
    drive_folder_id: "drive-folder-id",
    gmail_query: "from:billing@example.com",
    gmail_label_id: null,
    subject_keywords: "既存",
  };
}

function updatedRule(update: Record<string, unknown>) {
  return { ...currentRule(), ...update };
}

function jsonRequest(body: unknown) {
  return new Request(`https://app.example/api/rules/${RULE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loadRoute(options?: {
  user?: { id: string } | null;
  currentResult?: QueryResult;
  updateResult?:
    | QueryResult
    | ((update: Record<string, unknown>) => QueryResult);
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
    profileReads: 0,
    currentSelects: [] as string[],
    currentEq: [] as Array<{ column: string; value: string }>,
    currentSingle: 0,
    updates: [] as Array<Record<string, unknown>>,
    updateEq: [] as Array<{ column: string; value: string }>,
    updateSelects: [] as string[],
    updateSingle: 0,
    overflowChecks: [] as Array<{ userId: string; ruleId: string }>,
  };
  const loadedModule = {
    exports: {} as {
      PATCH: (
        request: Request,
        context: { params: Promise<{ id: string }> },
      ) => Promise<Response>;
    },
  };

  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextResponse };
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
          };
        },
      };
    }
    if (specifier === "@/lib/supabase/admin") {
      return {
        supabaseAdmin: {
          from(table: string) {
            if (table === "user_profiles") {
              return {
                select() {
                  calls.profileReads += 1;
                  return {
                    eq() {
                      return {
                        async maybeSingle() {
                          return { data: { plan: "free" }, error: null };
                        },
                      };
                    },
                  };
                },
              };
            }
            if (table === "rules") {
              return {
                select(columns: string) {
                  calls.currentSelects.push(columns);
                  const filters: Array<{ column: string; value: string }> = [];
                  const builder = {
                    eq(column: string, value: string) {
                      filters.push({ column, value });
                      calls.currentEq.push({ column, value });
                      return builder;
                    },
                    async single() {
                      calls.currentSingle += 1;
                      return (
                        options?.currentResult ?? {
                          data: currentRule(),
                          error: null,
                        }
                      );
                    },
                  };
                  return builder;
                },
                update(update: Record<string, unknown>) {
                  calls.updates.push(update);
                  const builder = {
                    eq(column: string, value: string) {
                      calls.updateEq.push({ column, value });
                      return builder;
                    },
                    select(columns: string) {
                      calls.updateSelects.push(columns);
                      return builder;
                    },
                    async single() {
                      calls.updateSingle += 1;
                      const configured = options?.updateResult;
                      return typeof configured === "function"
                        ? configured(update)
                        : (configured ?? {
                            data: updatedRule(update),
                            error: null,
                          });
                    },
                  };
                  return builder;
                },
              };
            }
            throw new Error(`Unexpected table: ${table}`);
          },
        },
      };
    }
    if (specifier === "@/lib/rules/freePlanLimit") {
      return {
        async isFreePlanOverflowRule(input: {
          userId: string;
          ruleId: string;
        }) {
          calls.overflowChecks.push(input);
          return { isOverflow: false };
        },
      };
    }
    if (specifier === "@/lib/billing/resolveEffectivePlan") {
      return { resolveEffectivePlan: () => "free" };
    }
    if (specifier === "@/lib/rules/fileNameFormat") {
      return { normalizeFileNameFormatForPlan };
    }
    if (specifier === "@/lib/rules/ruleCreationRepositoryCore") {
      return { normalizeRuleSubjectKeywords };
    }
    throw new Error(`Unexpected route dependency: ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
  });

  return { PATCH: loadedModule.exports.PATCH, calls };
}

async function patch(route: ReturnType<typeof loadRoute>, body: unknown) {
  return route.PATCH(jsonRequest(body), {
    params: Promise.resolve({ id: RULE_ID }),
  });
}

async function expectError(
  response: Response,
  status: number,
  error_code: string,
  message: string,
) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ ok: false, error_code, message });
}

test("subject keywords update as canonical nullable text for the authenticated owner", async () => {
  for (const value of [
    " 請求書, 領収書\n見積書 ",
    [" 請求書 ", "領収書\n見積書"],
  ]) {
    const route = loadRoute();
    const response = await patch(route, { subject_keywords: value });

    expect(response.status).toBe(200);
    expect(route.calls.updates).toEqual([
      { subject_keywords: "請求書,領収書,見積書", is_active: true },
    ]);
    expect(route.calls.currentEq).toEqual([
      { column: "id", value: RULE_ID },
      { column: "user_id", value: USER_ID },
    ]);
    expect(route.calls.updateEq).toEqual([
      { column: "id", value: RULE_ID },
      { column: "user_id", value: USER_ID },
    ]);
    expect(route.calls.currentSingle).toBe(1);
    expect(route.calls.updateSingle).toBe(1);
  }
});

test("omitting subject keywords preserves the existing stored value", async () => {
  const route = loadRoute({
    currentResult: {
      data: { ...currentRule(), subject_keywords: ["legacy", "array"] },
      error: null,
    },
  });

  expect(
    (await patch(route, { query_label: "更新", is_active: false })).status,
  ).toBe(200);
  expect(route.calls.updates).toEqual([
    { query_label: "更新", is_active: false },
  ]);
  expect(route.calls.updates[0]).not.toHaveProperty("subject_keywords");
});

test("empty subject keyword inputs normalize to database null", async () => {
  for (const value of [null, "", "  \n,  ", [], ["", " "]]) {
    const route = loadRoute();
    const response = await patch(route, {
      subject_keywords: value,
      is_active: false,
    });

    expect(response.status).toBe(200);
    expect(route.calls.updates).toEqual([
      { subject_keywords: null, is_active: false },
    ]);
  }
});

test("invalid and oversized subject keyword inputs fail with 400 before database access", async () => {
  const invalidValues = [
    123,
    true,
    { keyword: "請求書" },
    ["請求書", 123],
    Array.from({ length: 101 }, () => "x"),
    "x".repeat(1_001),
    Array.from({ length: 11 }, () => "x".repeat(1_000)),
  ];

  for (const value of invalidValues) {
    const route = loadRoute();
    await expectError(
      await patch(route, { subject_keywords: value }),
      400,
      "VALIDATION_ERROR",
      "件名キーワードの形式が不正です。",
    );
    expect(route.calls.profileReads).toBe(0);
    expect(route.calls.currentSingle).toBe(0);
    expect(route.calls.updates).toHaveLength(0);
  }
});

test("another user's rule is rejected without attempting an update", async () => {
  const route = loadRoute({
    currentResult: {
      data: null,
      error: { code: "PGRST116", detail: OTHER_USER_ID },
    },
  });

  await expectError(
    await patch(route, { subject_keywords: "請求書" }),
    404,
    "NOT_FOUND",
    "ルールが見つかりません。",
  );
  expect(route.calls.currentEq).toContainEqual({
    column: "user_id",
    value: USER_ID,
  });
  expect(route.calls.updates).toHaveLength(0);
});

test("zero-row and multiple-row update results both fail closed", async () => {
  for (const error of [
    { code: "PGRST116", reason: "zero rows" },
    { code: "PGRST116", reason: "multiple rows" },
  ]) {
    const route = loadRoute({
      updateResult: { data: null, error },
    });

    await expectError(
      await patch(route, { subject_keywords: "請求書", is_active: false }),
      500,
      "DB_UPDATE_FAILED",
      "ルールの更新に失敗しました。",
    );
    expect(route.calls.updateEq).toEqual([
      { column: "id", value: RULE_ID },
      { column: "user_id", value: USER_ID },
    ]);
    expect(route.calls.updateSelects).toEqual(["*"]);
    expect(route.calls.updateSingle).toBe(1);
  }
});
