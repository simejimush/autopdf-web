import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "@playwright/test";
import ts from "typescript";

const SOURCE_PATH = resolve(
  process.cwd(),
  "src/lib/cost-safety/executionGuard.ts",
);
const USER_ID = "44444444-4444-4444-8444-444444444444";
const RULE_ID = "66666666-6666-4666-8666-666666666666";

function loadGuard(options: {
  claimResult?: unknown;
  claimError?: Error;
  slackError?: Error;
}) {
  const source = readFileSync(SOURCE_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const calls = {
    claims: [] as unknown[],
    slack: [] as unknown[],
    errors: [] as unknown[][],
  };
  const loadedModule = {
    exports: {} as {
      claimExecutionGuard(input: {
        userId: string;
        ruleId: string;
        trigger: "manual" | "cron";
      }): Promise<unknown>;
    },
  };
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/runs/guardedExecutionRepository") {
      return {
        async claimGuardedExecution(input: unknown) {
          calls.claims.push(input);
          if (options.claimError) throw options.claimError;
          return options.claimResult;
        },
      };
    }
    if (specifier === "@/lib/runs/getRunErrorMessage") {
      return {
        getRunErrorMessage() {
          return {
            title: "Safe title",
            message: "Safe message",
            action: "Retry",
          };
        },
      };
    }
    if (specifier === "@/lib/monitoring/notifySlack") {
      return {
        async notifySlack(input: unknown) {
          calls.slack.push(input);
          if (options.slackError) throw options.slackError;
        },
      };
    }
    throw new Error(`Unexpected dependency ${specifier}`);
  };

  runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    require: localRequire,
    Set,
    Object,
    Date,
    Error,
    console: {
      error(...args: unknown[]) {
        calls.errors.push(args);
      },
    },
  });
  return { ...loadedModule.exports, calls, source };
}

const input = { userId: USER_ID, ruleId: RULE_ID, trigger: "manual" as const };

test("only system limit and guard infrastructure failure notify administrators", async () => {
  for (const errorCode of [
    "SYSTEM_LIMIT_EXCEEDED",
    "GUARD_STORE_FAILED",
    "USER_RATE_LIMIT_EXCEEDED",
    "EXECUTION_CONCURRENCY_LIMIT",
    "RUN_ALREADY_RUNNING",
  ]) {
    const guard = loadGuard({
      claimResult: { claimed: false, errorCode },
    });
    await expect(guard.claimExecutionGuard(input)).resolves.toEqual({
      claimed: false,
      errorCode,
    });
    expect(guard.calls.slack).toHaveLength(
      ["SYSTEM_LIMIT_EXCEEDED", "GUARD_STORE_FAILED"].includes(errorCode)
        ? 1
        : 0,
    );
  }
});

test("repository failure maps to GUARD_STORE_FAILED without fallback or raw output", async () => {
  const raw = "raw DB connection details";
  const guard = loadGuard({ claimError: new Error(raw) });
  await expect(guard.claimExecutionGuard(input)).resolves.toEqual({
    claimed: false,
    errorCode: "GUARD_STORE_FAILED",
  });
  expect(guard.calls.claims).toEqual([input]);
  expect(guard.calls.slack).toHaveLength(1);
  expect(JSON.stringify(guard.calls.errors)).not.toContain(raw);
  expect(guard.source).not.toContain("createManualRun");
  expect(guard.source).not.toContain("createCronRun");
});

test("Slack failure stays secondary to the primary guard result", async () => {
  const raw = "raw Slack response";
  const guard = loadGuard({
    claimResult: { claimed: false, errorCode: "SYSTEM_LIMIT_EXCEEDED" },
    slackError: new Error(raw),
  });
  await expect(guard.claimExecutionGuard(input)).resolves.toEqual({
    claimed: false,
    errorCode: "SYSTEM_LIMIT_EXCEEDED",
  });
  expect(JSON.stringify(guard.calls.errors)).not.toContain(raw);
});
