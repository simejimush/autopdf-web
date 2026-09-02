import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import { NextResponse } from "next/server";
import ts from "typescript";

const ROUTE_PATH = resolve(process.cwd(), "app/api/cron/route.ts");
const VERCEL_CONFIG_PATH = resolve(process.cwd(), "vercel.json");
const SECRET = "test-secret-never-return";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_USER_ID = "55555555-5555-4555-8555-555555555555";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const SECOND_RULE_ID = "77777777-7777-4777-8777-777777777777";
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const LEASE_ID_HASH = "a".repeat(64);

type Candidate = { ruleId: string; userId: string };

function makeCandidate(index: number, userId = USER_ID): Candidate {
  return {
    ruleId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    userId,
  };
}

function loadRoute(options?: {
  candidates?: readonly Candidate[];
  candidateError?: Error;
  guardErrorFor?: string;
  guardErrorCode?: string;
  executeErrorFor?: string;
  overflowRuleIds?: readonly string[];
  cronSecret?: string;
  omitCronSecret?: boolean;
  executionDisabled?: string;
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
    candidateRpc: 0,
    overflow: [] as string[],
    repository: [] as Array<{
      userId: string;
      ruleId: string;
      trigger: string;
    }>,
    execute: [] as Array<{
      ruleId: string;
      userId: string;
      runId: string;
      leaseIdHash: string;
      trigger: string;
    }>,
    logs: [] as unknown[][],
    warns: [] as unknown[][],
    errors: [] as unknown[][],
  };
  const loadedModule = {
    exports: {} as { GET: (request: Request) => Promise<Response> },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "next/server") return { NextResponse };
    if (specifier === "@/lib/cost-safety/killSwitch") {
      return {
        readExecutionDisabledFromEnv: (
          environment: Record<string, string | undefined>,
        ) => environment.AUTOPDF_EXECUTION_DISABLED !== "false",
      };
    }
    if (specifier === "@/lib/runs/guardedExecutionRepository") {
      return {
        async listCronCandidates() {
          calls.candidateRpc++;
          if (options?.candidateError) throw options.candidateError;
          return options?.candidates ?? [{ ruleId: RULE_ID, userId: USER_ID }];
        },
      };
    }
    if (specifier === "@/lib/rules/freePlanLimit") {
      return {
        async getFreePlanOverflowRuleIds(userId: string) {
          calls.overflow.push(userId);
          return options?.overflowRuleIds ?? [];
        },
      };
    }
    if (specifier === "@/lib/cost-safety/executionGuard") {
      return {
        async claimExecutionGuard(input: {
          userId: string;
          ruleId: string;
          trigger: string;
        }) {
          calls.repository.push(input);
          if (options?.guardErrorFor === input.ruleId) {
            return {
              claimed: false,
              errorCode: options.guardErrorCode ?? "GUARD_STORE_FAILED",
            };
          }
          return {
            claimed: true,
            runId: input.ruleId === RULE_ID ? RUN_ID : SECOND_RULE_ID,
            leaseIdHash: LEASE_ID_HASH,
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
          leaseIdHash: string;
          trigger: string;
        }) {
          calls.execute.push(input);
          if (options?.executeErrorFor === input.ruleId)
            throw new Error("raw execute detail");
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
  const environment: Record<string, string | undefined> =
    options?.omitCronSecret
      ? {}
      : { CRON_SECRET: options?.cronSecret ?? SECRET };
  if (!options?.omitCronSecret) {
    environment.AUTOPDF_EXECUTION_DISABLED =
      options && "executionDisabled" in options
        ? options.executionDisabled
        : "false";
  }
  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    URL,
    process: { env: environment },
    console: {
      log(...args: unknown[]) {
        calls.logs.push(args);
      },
      warn(...args: unknown[]) {
        calls.warns.push(args);
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
  if (options?.querySecret) url.searchParams.set("secret", options.querySecret);
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
  const text = await response.clone().text();
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
  expect(route.calls.candidateRpc).toBe(0);
  expect(route.calls.repository).toHaveLength(0);
  expect(route.calls.execute).toHaveLength(0);
  expect(text).not.toContain(SECRET);
  expect(JSON.stringify(route.calls)).not.toContain(SECRET);
}

test("rejects missing, malformed, mismatched, and missing-secret authorization", async () => {
  for (const authorization of [
    undefined,
    SECRET,
    `Basic ${SECRET}`,
    "Bearer",
    "Bearer wrong-secret",
  ]) {
    await expectUnauthorized(loadRoute(), request({ authorization }));
  }
  await expectUnauthorized(
    loadRoute({ omitCronSecret: true }),
    authorizedRequest(),
  );
  for (const cronSecret of ["", "   "])
    await expectUnauthorized(loadRoute({ cronSecret }), authorizedRequest());
  await expectUnauthorized(loadRoute(), request({ querySecret: SECRET }));
});

test("entry kill switch stops Cron before candidate, guard, run, and provider work", async () => {
  for (const executionDisabled of [undefined, "", "true", "False", " false "]) {
    const route = loadRoute({ executionDisabled });
    const response = await route.GET(authorizedRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Cron disabled" });
    expect(route.calls.candidateRpc).toBe(0);
    expect(route.calls.overflow).toHaveLength(0);
    expect(route.calls.repository).toHaveLength(0);
    expect(route.calls.execute).toHaveLength(0);
    expect(JSON.stringify(route.calls)).not.toContain(SECRET);
  }
});

test("only the canonical enabled value reaches the finite candidate RPC", async () => {
  const route = loadRoute({ executionDisabled: "false" });
  const response = await route.GET(authorizedRequest());
  expect(response.status).toBe(200);
  expect(route.calls.candidateRpc).toBe(1);
  expect(route.calls.repository).toEqual([
    { userId: USER_ID, ruleId: RULE_ID, trigger: "cron" },
  ]);
});

test("uses candidate RPC, preserves empty completion, and never selects all rules", async () => {
  const route = loadRoute({ candidates: [] });
  const response = await route.GET(authorizedRequest());
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
  expect(route.calls.candidateRpc).toBe(1);
  expect(route.calls.overflow).toHaveLength(0);
  expect(route.calls.repository).toHaveLength(0);
  expect(route.calls.execute).toHaveLength(0);
  expect(route.source).not.toContain('.select("*")');
  expect(route.source).not.toContain("supabaseAdmin");
  expect(route.source).not.toContain("createCronRun");
  expect(route.source).not.toContain('.from("runs")');
});

test("accepts the 500 candidate boundary and preserves Free overflow skipping", async () => {
  const candidates = Array.from({ length: 500 }, (_, index) =>
    makeCandidate(index),
  );
  const route = loadRoute({
    candidates,
    overflowRuleIds: [candidates[0].ruleId],
  });
  const response = await route.GET(authorizedRequest());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(route.calls.candidateRpc).toBe(1);
  expect(route.calls.overflow).toEqual([USER_ID]);
  expect(route.calls.repository).toHaveLength(499);
  expect(route.calls.execute).toHaveLength(499);
  expect(body).toMatchObject({
    total_rules: 500,
    enabled_rules: 500,
    runnable_rules: 499,
    free_overflow_skipped: 1,
    ok: 499,
    ng: 0,
  });
});

test("systemic guard rejections stop the invocation after one claim and no execution", async () => {
  for (const errorCode of ["SYSTEM_LIMIT_EXCEEDED", "GUARD_STORE_FAILED"]) {
    const route = loadRoute({
      candidates: [
        { ruleId: RULE_ID, userId: USER_ID },
        { ruleId: SECOND_RULE_ID, userId: SECOND_USER_ID },
      ],
      guardErrorFor: RULE_ID,
      guardErrorCode: errorCode,
    });
    const response = await route.GET(authorizedRequest());
    expect(response.status).toBe(200);
    expect(route.calls.repository).toEqual([
      { userId: USER_ID, ruleId: RULE_ID, trigger: "cron" },
    ]);
    expect(route.calls.execute).toHaveLength(0);
    expect(await response.json()).toMatchObject({
      ok: 0,
      ng: 1,
      results: [{ id: RULE_ID, ok: false, error: errorCode }],
    });
    expect(
      route.calls.errors.filter((args) =>
        String(args[0]).includes(
          "Stopping after systemic execution guard rejection",
        ),
      ),
    ).toHaveLength(1);
  }
});

test("user-level guard rejections do not stop other users", async () => {
  const route = loadRoute({
    candidates: [
      { ruleId: RULE_ID, userId: USER_ID },
      { ruleId: SECOND_RULE_ID, userId: SECOND_USER_ID },
    ],
    guardErrorFor: RULE_ID,
    guardErrorCode: "USER_RATE_LIMIT_EXCEEDED",
  });
  const response = await route.GET(authorizedRequest());
  expect(response.status).toBe(200);
  expect(route.calls.repository).toHaveLength(2);
  expect(route.calls.execute).toEqual([
    {
      ruleId: SECOND_RULE_ID,
      userId: SECOND_USER_ID,
      runId: SECOND_RULE_ID,
      leaseIdHash: LEASE_ID_HASH,
      trigger: "cron",
    },
  ]);
  expect(await response.json()).toMatchObject({ ok: 1, ng: 1 });
});

test("candidate and execution failures do not expose raw details", async () => {
  const candidateRaw = "raw candidate database detail";
  const candidateRoute = loadRoute({ candidateError: new Error(candidateRaw) });
  const candidateResponse = await candidateRoute.GET(authorizedRequest());
  const candidateText = await candidateResponse.clone().text();
  expect(candidateResponse.status).toBe(500);
  expect(await candidateResponse.json()).toEqual({
    error: "Failed to fetch cron candidates",
  });
  expect(candidateText).not.toContain(candidateRaw);
  expect(JSON.stringify(candidateRoute.calls)).not.toContain(candidateRaw);

  const executeRaw = "raw execute detail";
  const executeRoute = loadRoute({ executeErrorFor: RULE_ID });
  const executeResponse = await executeRoute.GET(authorizedRequest());
  const executeText = await executeResponse.clone().text();
  expect(executeResponse.status).toBe(200);
  expect(await executeResponse.json()).toMatchObject({
    ok: 0,
    ng: 1,
    results: [{ id: RULE_ID, ok: false, error: "UNKNOWN" }],
  });
  expect(executeText).not.toContain(executeRaw);
  expect(JSON.stringify(executeRoute.calls)).not.toContain(executeRaw);
});

test("tracked configuration does not contain Cron query authentication", () => {
  const config = JSON.parse(readFileSync(VERCEL_CONFIG_PATH, "utf8"));
  expect(config.crons).toEqual([{ path: "/api/cron", schedule: "0 0 * * *" }]);
  const safeDirectory = process.cwd().replaceAll("\\", "/");
  const trackedFiles = execFileSync(
    "git",
    ["-c", `safe.directory=${safeDirectory}`, "ls-files", "-z"],
    { cwd: process.cwd(), encoding: "utf8" },
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
