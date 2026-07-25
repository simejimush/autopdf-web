import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";
import {
  normalizeFileNameFormatForPlan,
  type FileNameFormatPlan,
} from "../src/lib/rules/fileNameFormat";
import { normalizeRuleSubjectKeywords } from "../src/lib/rules/ruleCreationRepositoryCore";

const ROUTE_PATH = resolve(process.cwd(), "app/api/rules/route.ts");
const USER_ID = "44444444-4444-4444-8444-444444444444";
const ATTACKER_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";

function createdRule() {
  return {
    id: RULE_ID,
    is_active: true,
    run_timing: "manual",
    drive_folder_id: "drive-folder-id",
    gmail_query: "from:billing@example.com",
    query_label: "請求メール",
    file_name_format: "standard",
    updated_at: "2026-08-02T00:00:00.000Z",
  };
}

function jsonRequest(body: unknown) {
  return new Request("https://app.example/api/rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loadRoute(options?: {
  user?: { id: string } | null;
  authError?: { message: string } | null;
  profile?: Record<string, unknown> | null;
  profileError?: { message: string } | null;
  effectivePlan?: FileNameFormatPlan;
  ruleCount?: number | null;
  countError?: { message: string } | null;
  repositoryError?: Error;
  created?: ReturnType<typeof createdRule>;
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
    getUser: 0,
    profileSelect: [] as string[],
    profileEq: [] as Array<{ column: string; value: string }>,
    countSelect: [] as Array<{
      columns: string;
      options: Record<string, unknown> | undefined;
    }>,
    countEq: [] as Array<{ column: string; value: string }>,
    jwtInsert: [] as unknown[],
    repository: [] as Array<Record<string, unknown>>,
    planInputs: [] as unknown[],
    fileNameInputs: [] as Array<{ value: unknown; plan: FileNameFormatPlan }>,
  };
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
              if (table === "user_profiles") {
                return {
                  select(columns: string) {
                    calls.profileSelect.push(columns);
                    return {
                      eq(column: string, value: string) {
                        calls.profileEq.push({ column, value });
                        return {
                          async maybeSingle() {
                            return {
                              data: options?.profile ?? { plan: "free" },
                              error: options?.profileError ?? null,
                            };
                          },
                        };
                      },
                    };
                  },
                };
              }
              if (table === "rules") {
                return {
                  select(
                    columns: string,
                    selectOptions?: Record<string, unknown>,
                  ) {
                    calls.countSelect.push({
                      columns,
                      options: selectOptions,
                    });
                    return {
                      async eq(column: string, value: string) {
                        calls.countEq.push({ column, value });
                        return {
                          count: options?.ruleCount ?? 0,
                          error: options?.countError ?? null,
                        };
                      },
                    };
                  },
                  insert(payload: unknown) {
                    calls.jwtInsert.push(payload);
                    throw new Error("authenticated JWT insert is forbidden");
                  },
                };
              }
              throw new Error(`Unexpected table: ${table}`);
            },
          };
        },
      };
    }
    if (specifier === "@/lib/billing/resolveEffectivePlan") {
      return {
        resolveEffectivePlan(input: unknown) {
          calls.planInputs.push(input);
          return options?.effectivePlan ?? "free";
        },
      };
    }
    if (specifier === "@/lib/rules/fileNameFormat") {
      return {
        normalizeFileNameFormatForPlan(
          value: unknown,
          plan: FileNameFormatPlan,
        ) {
          calls.fileNameInputs.push({ value, plan });
          return normalizeFileNameFormatForPlan(value, plan);
        },
      };
    }
    if (specifier === "@/lib/rules/ruleCreationRepositoryCore") {
      return { normalizeRuleSubjectKeywords };
    }
    if (specifier === "@/lib/rules/ruleCreationRepository") {
      return {
        async createRuleForUser(input: Record<string, unknown>) {
          calls.repository.push(input);
          if (options?.repositoryError) {
            throw options.repositoryError;
          }
          return options?.created ?? createdRule();
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

async function expectErrorResponse(
  response: Response,
  status: number,
  error_code: string,
  message: string,
) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ ok: false, error_code, message });
}

test("unauthenticated creation remains a fixed 401 without reads or writes", async () => {
  const route = loadRoute({ user: null });

  await expectErrorResponse(
    await route.POST(jsonRequest({ drive_folder_id: "drive-folder-id" })),
    401,
    "AUTH_REQUIRED",
    "ログインしてください。",
  );
  expect(route.calls.profileSelect).toHaveLength(0);
  expect(route.calls.countSelect).toHaveLength(0);
  expect(route.calls.repository).toHaveLength(0);
});

test("authenticated user ownership and canonical values reach the repository", async () => {
  const route = loadRoute();
  const response = await route.POST(
    jsonRequest({
      user_id: ATTACKER_USER_ID,
      id: "attacker-rule-id",
      drive_folder_id: "  drive-folder-id  ",
      gmail_query: "  from:billing@example.com  ",
      query_label: "  請求メール  ",
      subject_keywords: [" 請求書 ", "", "領収書\n見積書"],
      file_name_format: "standard",
      is_active: true,
    }),
  );

  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ ok: true, data: createdRule() });
  expect(route.calls.repository).toEqual([
    {
      userId: USER_ID,
      values: {
        driveFolderId: "drive-folder-id",
        gmailQuery: "from:billing@example.com",
        queryLabel: "請求メール",
        subjectKeywords: "請求書,領収書,見積書",
        fileNameFormat: "standard",
        isActive: true,
        runTiming: "manual",
      },
    },
  ]);
  expect(route.calls.profileEq).toEqual([
    { column: "user_id", value: USER_ID },
  ]);
  expect(route.calls.countEq).toEqual([{ column: "user_id", value: USER_ID }]);
  expect(route.calls.jwtInsert).toHaveLength(0);
  expect(route.source).not.toContain("supabaseAdmin");
  expect(route.source).not.toContain(".insert(");
});

test("Free rule count limit remains three across all rules", async () => {
  const route = loadRoute({ ruleCount: 3, effectivePlan: "free" });

  await expectErrorResponse(
    await route.POST(jsonRequest({ drive_folder_id: "drive-folder-id" })),
    403,
    "RULE_LIMIT_EXCEEDED",
    "Freeプランではルールは3件までです。",
  );
  expect(route.calls.countSelect).toEqual([
    { columns: "*", options: { count: "exact", head: true } },
  ]);
  expect(route.calls.repository).toHaveLength(0);
});

test("Pro creation remains unlimited and keeps AI filename format", async () => {
  const route = loadRoute({ ruleCount: 99, effectivePlan: "pro" });
  const response = await route.POST(
    jsonRequest({
      drive_folder_id: "drive-folder-id",
      gmail_query: "from:billing@example.com",
      file_name_format: "ai_sender_doc",
      is_active: true,
    }),
  );

  expect(response.status).toBe(201);
  expect(route.calls.repository[0]).toMatchObject({
    userId: USER_ID,
    values: { fileNameFormat: "ai_sender_doc" },
  });
});

test("Free AI filename formats remain gated to standard", async () => {
  const route = loadRoute({ effectivePlan: "free" });
  const response = await route.POST(
    jsonRequest({
      drive_folder_id: "drive-folder-id",
      gmail_query: "from:billing@example.com",
      file_name_format: "ai_doc_sender",
    }),
  );

  expect(response.status).toBe(201);
  expect(route.calls.repository[0]).toMatchObject({
    values: { fileNameFormat: "standard" },
  });
});

test("unknown filename formats retain standard normalization", async () => {
  const route = loadRoute({ effectivePlan: "pro" });
  const response = await route.POST(
    jsonRequest({
      drive_folder_id: "drive-folder-id",
      gmail_query: "from:billing@example.com",
      file_name_format: "attacker-format",
    }),
  );

  expect(response.status).toBe(201);
  expect(route.calls.repository[0]).toMatchObject({
    values: { fileNameFormat: "standard" },
  });
});

test("drive folder validation remains a fixed 400", async () => {
  const route = loadRoute();

  await expectErrorResponse(
    await route.POST(jsonRequest({ drive_folder_id: "  " })),
    400,
    "VALIDATION_ERROR",
    "保存先フォルダIDは必須です。",
  );
  expect(route.calls.repository).toHaveLength(0);
});

test("trimmed empty optional strings preserve the existing create contract", async () => {
  const route = loadRoute();
  const response = await route.POST(
    jsonRequest({
      drive_folder_id: "drive-folder-id",
      gmail_query: "  ",
      query_label: "  ",
      run_timing: "  ",
      is_active: true,
    }),
  );

  expect(response.status).toBe(201);
  expect(route.calls.repository[0]).toMatchObject({
    values: {
      gmailQuery: "",
      queryLabel: "",
      runTiming: "",
      isActive: false,
    },
  });
});

test("repository failures preserve the existing DB insert contract safely", async () => {
  const rawError = "raw repository database details";
  const driveFolderId = "private-drive-folder-id";
  const route = loadRoute({ repositoryError: new Error(rawError) });
  const response = await route.POST(
    jsonRequest({
      user_id: ATTACKER_USER_ID,
      drive_folder_id: driveFolderId,
      gmail_query: "from:billing@example.com",
    }),
  );
  const text = await response.clone().text();

  await expectErrorResponse(
    response,
    500,
    "DB_INSERT_FAILED",
    "ルールの作成に失敗しました。",
  );
  expect(text).not.toContain(rawError);
  expect(text).not.toContain(USER_ID);
  expect(text).not.toContain(ATTACKER_USER_ID);
  expect(text).not.toContain(driveFolderId);
  expect(route.calls.jwtInsert).toHaveLength(0);
  expect(route.source).not.toContain("console.");
});

test("profile read failures preserve the existing fixed response", async () => {
  const route = loadRoute({
    profileError: { message: "raw profile details" },
  });

  await expectErrorResponse(
    await route.POST(jsonRequest({ drive_folder_id: "drive-folder-id" })),
    500,
    "DB_READ_FAILED",
    "ユーザー情報の取得に失敗しました。",
  );
  expect(route.calls.countSelect).toHaveLength(0);
  expect(route.calls.repository).toHaveLength(0);
});

test("rule count failures preserve the existing fixed response", async () => {
  const route = loadRoute({
    countError: { message: "raw count details" },
  });

  await expectErrorResponse(
    await route.POST(jsonRequest({ drive_folder_id: "drive-folder-id" })),
    500,
    "DB_READ_FAILED",
    "ルール数の確認に失敗しました。",
  );
  expect(route.calls.repository).toHaveLength(0);
});
