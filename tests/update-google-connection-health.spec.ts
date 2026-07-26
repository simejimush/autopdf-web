import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";

const MODULE_PATH = resolve(
  process.cwd(),
  "src/lib/monitoring/updateGoogleConnectionHealth.ts",
);
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const ROW_ID = "88888888-8888-4888-8888-888888888888";

function loadModule(options?: { result?: unknown; queryError?: Error }) {
  const source = readFileSync(MODULE_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: MODULE_PATH,
  }).outputText;
  const calls = {
    from: [] as string[],
    update: [] as Array<Record<string, unknown>>,
    eq: [] as Array<{ column: string; value: string }>,
    select: [] as string[],
    logs: [] as unknown[][],
  };
  const loadedModule = {
    exports: {} as {
      updateGoogleConnectionHealth(input: {
        userId: string;
        event: "success" | "error";
        errorCode?: string | null;
      }): Promise<boolean>;
    },
  };
  const localRequire = (specifier: string) => {
    if (specifier !== "@/lib/supabase/admin") {
      throw new Error(`Unexpected dependency: ${specifier}`);
    }
    return {
      supabaseAdmin: {
        from(table: string) {
          calls.from.push(table);
          return {
            update(payload: Record<string, unknown>) {
              calls.update.push(payload);
              return {
                eq(column: string, value: string) {
                  calls.eq.push({ column, value });
                  return {
                    async select(columns: string) {
                      calls.select.push(columns);
                      if (options?.queryError) throw options.queryError;
                      return options && "result" in options
                        ? options.result
                        : {
                            data: [{ id: ROW_ID, user_id: USER_ID }],
                            error: null,
                          };
                    },
                  };
                },
              };
            },
          };
        },
      },
    };
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    Date,
    Set,
    console: {
      error(...args: unknown[]) {
        calls.logs.push(args);
      },
    },
  });

  return {
    updateGoogleConnectionHealth:
      loadedModule.exports.updateGoogleConnectionHealth,
    calls,
  };
}

test("success health update is owner-scoped and requires exactly one row", async () => {
  const harness = loadModule();

  await expect(
    harness.updateGoogleConnectionHealth({
      userId: USER_ID,
      event: "success",
    }),
  ).resolves.toBe(true);

  expect(harness.calls.from).toEqual(["google_connections"]);
  expect(harness.calls.eq).toEqual([{ column: "user_id", value: USER_ID }]);
  expect(harness.calls.select).toEqual(["id, user_id"]);
  expect(harness.calls.update[0]).toMatchObject({
    reauth_required: false,
    last_error_code: null,
  });
  expect(harness.calls.update[0]).not.toHaveProperty("status");
  expect(harness.calls.update[0]).not.toHaveProperty("access_token_enc");
  expect(harness.calls.update[0]).not.toHaveProperty("refresh_token_enc");
});

test("error health update preserves the existing reauth policy", async () => {
  for (const [errorCode, expectedReauth] of [
    ["GOOGLE_TOKEN_INVALID", true],
    ["GOOGLE_PERMISSION_DENIED", true],
    ["UNKNOWN", false],
  ] as const) {
    const harness = loadModule();
    await expect(
      harness.updateGoogleConnectionHealth({
        userId: USER_ID,
        event: "error",
        errorCode,
      }),
    ).resolves.toBe(true);

    expect(harness.calls.update[0]).toMatchObject({
      last_error_code: errorCode,
      ...(expectedReauth ? { reauth_required: true } : {}),
    });
    if (!expectedReauth) {
      expect(harness.calls.update[0]).not.toHaveProperty("reauth_required");
    }
  }
});

test("zero, multiple, malformed, mismatched, and DB failures are not successful", async () => {
  const rawSecret = "raw-health-db-secret";
  const cases = [
    { result: { data: [], error: null } },
    {
      result: {
        data: [
          { id: ROW_ID, user_id: USER_ID },
          { id: "99999999-9999-4999-8999-999999999999", user_id: USER_ID },
        ],
        error: null,
      },
    },
    { result: { data: null, error: null } },
    { result: { data: [{ id: ROW_ID }], error: null } },
    {
      result: {
        data: [{ id: ROW_ID, user_id: OTHER_USER_ID }],
        error: null,
      },
    },
    { result: { data: [{ id: ROW_ID, user_id: USER_ID }], error: rawSecret } },
    { queryError: new Error(rawSecret) },
  ];

  for (const options of cases) {
    const harness = loadModule(options);
    await expect(
      harness.updateGoogleConnectionHealth({
        userId: USER_ID,
        event: "success",
      }),
    ).resolves.toBe(false);

    const serializedLogs = JSON.stringify(harness.calls.logs);
    expect(serializedLogs).toContain("GOOGLE_CONNECTION_HEALTH_UPDATE_FAILED");
    expect(serializedLogs).not.toContain(rawSecret);
    expect(serializedLogs).not.toContain(USER_ID);
    expect(serializedLogs).not.toContain(OTHER_USER_ID);
  }
});
