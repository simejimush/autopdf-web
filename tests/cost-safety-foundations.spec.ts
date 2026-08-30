import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const COST_SAFETY_DIR = resolve(process.cwd(), "src/lib/cost-safety");

type LoadedModule = Record<string, unknown>;

function loadCostSafetyModule(fileName: string): LoadedModule {
  const cache = new Map<string, LoadedModule>();

  function load(targetFileName: string): LoadedModule {
    const cached = cache.get(targetFileName);
    if (cached) return cached;

    const source = readFileSync(
      resolve(COST_SAFETY_DIR, targetFileName),
      "utf8",
    );
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: targetFileName,
    }).outputText;
    const loadedModule = { exports: {} as LoadedModule };

    cache.set(targetFileName, loadedModule.exports);

    runInNewContext(compiled, {
      exports: loadedModule.exports,
      module: loadedModule,
      require(specifier: string) {
        if (specifier === "server-only") return {};
        if (specifier === "@/lib/cost-safety/limits") return load("limits.ts");
        throw new Error(`Unexpected cost safety dependency: ${specifier}`);
      },
      Buffer,
      Math,
      Number,
      Object,
      String,
      process: { env: {} },
    });

    return loadedModule.exports;
  }

  return load(fileName);
}

const limits = loadCostSafetyModule("limits.ts") as Record<string, number>;
const deadline = loadCostSafetyModule("deadline.ts") as {
  getExecutionDeadlineMs(value: unknown): number | null;
  getAllowedStageTimeoutMs(input: {
    executionStartedAtMs: unknown;
    currentTimeMs: unknown;
    stageRemainingMs: unknown;
  }): number | null;
};
const sizeLimits = loadCostSafetyModule("sizeLimits.ts") as {
  getUtf8ByteLength(value: unknown): number | null;
  isRawEmailBodyWithinLimit(value: unknown): boolean;
  areAttachmentMetadataWithinLimits(input: {
    count: unknown;
    declaredByteSizes: readonly unknown[];
    totalDeclaredBytes: unknown;
  }): boolean;
  isGeneratedPdfWithinLimit(value: unknown): boolean;
  isTotalDriveWriteWithinLimit(value: unknown): boolean;
  isUserMonthlyDriveWriteWithinLimit(input: {
    currentBytes: unknown;
    reservedBytes: unknown;
    requestedBytes: unknown;
  }): boolean;
  isSystemMonthlyDriveWriteWithinLimit(input: {
    currentBytes: unknown;
    reservedBytes: unknown;
    requestedBytes: unknown;
  }): boolean;
};
const killSwitch = loadCostSafetyModule("killSwitch.ts") as {
  parseExecutionDisabled(value: unknown): boolean;
  readExecutionDisabledFromEnv(
    environment: Readonly<Record<string, string | undefined>>,
  ): boolean;
};

test("defines every Phase 2B cost safety limit exactly", () => {
  expect(limits).toMatchObject({
    PRO_MONTHLY_PROCESSED_EMAIL_LIMIT: 500,
    DAILY_PROCESSED_EMAIL_LIMIT: 30,
    USER_RUNS_PER_MINUTE_LIMIT: 5,
    USER_RUNS_PER_TEN_MINUTES_LIMIT: 20,
    USER_CONCURRENT_EXECUTION_LIMIT: 1,
    SYSTEM_CONCURRENT_EXECUTION_LIMIT: 5,
    EXECUTION_LEASE_TTL_MS: 75_000,
    SYSTEM_EXECUTIONS_PER_TEN_MINUTES_LIMIT: 50,
    SYSTEM_EXECUTIONS_PER_HOUR_LIMIT: 100,
    SYSTEM_EXECUTIONS_PER_UTC_DAY_LIMIT: 500,
    SYSTEM_EXECUTIONS_PER_UTC_MONTH_LIMIT: 1_000,
    CRON_RULES_PER_USER_INVOCATION_LIMIT: 100,
    CRON_RULES_PER_SYSTEM_INVOCATION_LIMIT: 500,
    RAW_EMAIL_BODY_LIMIT_BYTES: 100 * 1_024,
    ATTACHMENT_COUNT_LIMIT: 5,
    SINGLE_ATTACHMENT_LIMIT_BYTES: 10 * 1_024 * 1_024,
    TOTAL_ATTACHMENT_LIMIT_BYTES: 25 * 1_024 * 1_024,
    GENERATED_PDF_LIMIT_BYTES: 10 * 1_024 * 1_024,
    TOTAL_DRIVE_WRITE_PER_EMAIL_LIMIT_BYTES: 35 * 1_024 * 1_024,
    USER_MONTHLY_DRIVE_WRITE_LIMIT_BYTES: 1 * 1_024 * 1_024 * 1_024,
    SYSTEM_MONTHLY_DRIVE_WRITE_LIMIT_BYTES: 5 * 1_024 * 1_024 * 1_024,
    EXECUTION_ABSOLUTE_DEADLINE_MS: 60_000,
    GMAIL_CUMULATIVE_TIMEOUT_MS: 15_000,
    OPENAI_TIMEOUT_MS: 8_000,
    DRIVE_CUMULATIVE_TIMEOUT_MS: 30_000,
    DB_FINALIZATION_RESERVE_MS: 3_000,
    RETRY_SAFE_MAX_RETRIES: 1,
    OPENAI_MAX_RETRIES: 0,
    UNKNOWN_EXTERNAL_WRITE_MAX_RETRIES: 0,
    OPENAI_MAX_INPUT_TOKENS: 4_000,
    OPENAI_MAX_OUTPUT_TOKENS: 20,
    OPENAI_MAX_CALLS_PER_EMAIL: 1,
  });
});

test("measures raw email bodies by UTF-8 bytes at ASCII and multibyte boundaries", () => {
  const exactAscii = "a".repeat(100 * 1_024);
  const exactMultibyte = "あ".repeat(34_133) + "a";

  expect(sizeLimits.getUtf8ByteLength("あ")).toBe(3);
  expect(sizeLimits.getUtf8ByteLength("😀")).toBe(4);
  expect(sizeLimits.getUtf8ByteLength({})).toBeNull();
  expect(sizeLimits.isRawEmailBodyWithinLimit(exactAscii)).toBe(true);
  expect(sizeLimits.isRawEmailBodyWithinLimit(exactAscii + "a")).toBe(false);
  expect(sizeLimits.isRawEmailBodyWithinLimit(exactMultibyte)).toBe(true);
  expect(sizeLimits.isRawEmailBodyWithinLimit(exactMultibyte + "あ")).toBe(
    false,
  );
});

test("rejects unsafe attachment metadata and preserves exact byte boundaries", () => {
  const mib = 1_024 * 1_024;

  expect(
    sizeLimits.areAttachmentMetadataWithinLimits({
      count: 0,
      declaredByteSizes: [],
      totalDeclaredBytes: 0,
    }),
  ).toBe(true);
  expect(
    sizeLimits.areAttachmentMetadataWithinLimits({
      count: 5,
      declaredByteSizes: [10 * mib, 5 * mib, 5 * mib, 5 * mib, 0],
      totalDeclaredBytes: 25 * mib,
    }),
  ).toBe(true);

  for (const input of [
    { count: 6, declaredByteSizes: [0, 0, 0, 0, 0, 0], totalDeclaredBytes: 0 },
    {
      count: 1,
      declaredByteSizes: [10 * mib + 1],
      totalDeclaredBytes: 10 * mib + 1,
    },
    {
      count: 3,
      declaredByteSizes: [10 * mib, 10 * mib, 5 * mib + 1],
      totalDeclaredBytes: 25 * mib + 1,
    },
    { count: 1, declaredByteSizes: [-1], totalDeclaredBytes: -1 },
    { count: 1, declaredByteSizes: [1.5], totalDeclaredBytes: 1.5 },
    {
      count: 1,
      declaredByteSizes: [Number.NaN],
      totalDeclaredBytes: Number.NaN,
    },
    {
      count: 1,
      declaredByteSizes: [Number.POSITIVE_INFINITY],
      totalDeclaredBytes: Number.POSITIVE_INFINITY,
    },
    {
      count: 1,
      declaredByteSizes: [Number.MAX_SAFE_INTEGER + 1],
      totalDeclaredBytes: Number.MAX_SAFE_INTEGER + 1,
    },
    { count: 1, declaredByteSizes: [1], totalDeclaredBytes: 0 },
  ]) {
    expect(sizeLimits.areAttachmentMetadataWithinLimits(input)).toBe(false);
  }
});

test("enforces PDF, total write, and monthly byte reservation boundaries", () => {
  const mib = 1_024 * 1_024;
  const gib = 1_024 * 1_024 * 1_024;

  expect(sizeLimits.isGeneratedPdfWithinLimit(10 * mib)).toBe(true);
  expect(sizeLimits.isGeneratedPdfWithinLimit(10 * mib + 1)).toBe(false);
  expect(sizeLimits.isTotalDriveWriteWithinLimit(35 * mib)).toBe(true);
  expect(sizeLimits.isTotalDriveWriteWithinLimit(35 * mib + 1)).toBe(false);
  expect(
    sizeLimits.isUserMonthlyDriveWriteWithinLimit({
      currentBytes: gib - 1,
      reservedBytes: 0,
      requestedBytes: 1,
    }),
  ).toBe(true);
  expect(
    sizeLimits.isUserMonthlyDriveWriteWithinLimit({
      currentBytes: gib - 1,
      reservedBytes: 0,
      requestedBytes: 2,
    }),
  ).toBe(false);
  expect(
    sizeLimits.isSystemMonthlyDriveWriteWithinLimit({
      currentBytes: 5 * gib - 1,
      reservedBytes: 0,
      requestedBytes: 1,
    }),
  ).toBe(true);
  expect(
    sizeLimits.isSystemMonthlyDriveWriteWithinLimit({
      currentBytes: 5 * gib,
      reservedBytes: 0,
      requestedBytes: 1,
    }),
  ).toBe(false);
  expect(
    sizeLimits.isUserMonthlyDriveWriteWithinLimit({
      currentBytes: 0,
      reservedBytes: -1,
      requestedBytes: 1,
    }),
  ).toBe(false);
});

test("keeps the finalization reserve inside the absolute execution deadline", () => {
  expect(deadline.getExecutionDeadlineMs(0)).toBe(60_000);
  expect(deadline.getExecutionDeadlineMs(-1)).toBeNull();
  expect(deadline.getExecutionDeadlineMs(Number.NaN)).toBeNull();
  expect(deadline.getExecutionDeadlineMs(Number.POSITIVE_INFINITY)).toBeNull();
  expect(deadline.getExecutionDeadlineMs(1.5)).toBeNull();

  expect(
    deadline.getAllowedStageTimeoutMs({
      executionStartedAtMs: 0,
      currentTimeMs: 0,
      stageRemainingMs: 15_000,
    }),
  ).toBe(15_000);
  expect(
    deadline.getAllowedStageTimeoutMs({
      executionStartedAtMs: 0,
      currentTimeMs: 0,
      stageRemainingMs: 60_000,
    }),
  ).toBe(57_000);
  expect(
    deadline.getAllowedStageTimeoutMs({
      executionStartedAtMs: 0,
      currentTimeMs: 55_000,
      stageRemainingMs: 15_000,
    }),
  ).toBe(2_000);

  for (const input of [
    { executionStartedAtMs: 0, currentTimeMs: 57_000, stageRemainingMs: 1 },
    { executionStartedAtMs: 0, currentTimeMs: 60_001, stageRemainingMs: 1 },
    { executionStartedAtMs: 10, currentTimeMs: 9, stageRemainingMs: 1 },
    { executionStartedAtMs: Number.NaN, currentTimeMs: 0, stageRemainingMs: 1 },
    {
      executionStartedAtMs: 0,
      currentTimeMs: Number.POSITIVE_INFINITY,
      stageRemainingMs: 1,
    },
    { executionStartedAtMs: 0, currentTimeMs: 0, stageRemainingMs: 0 },
  ]) {
    expect(deadline.getAllowedStageTimeoutMs(input)).toBeNull();
  }
});

test("allows execution only for the exact unpadded lowercase false value", () => {
  expect(killSwitch.parseExecutionDisabled("false")).toBe(false);

  for (const value of [
    undefined,
    null,
    "",
    "true",
    "False",
    "FALSE",
    "0",
    "no",
    " false ",
    "arbitrary",
    0,
  ]) {
    expect(killSwitch.parseExecutionDisabled(value)).toBe(true);
  }

  expect(
    killSwitch.readExecutionDisabledFromEnv({
      AUTOPDF_EXECUTION_DISABLED: "false",
    }),
  ).toBe(false);
  expect(killSwitch.readExecutionDisabledFromEnv({})).toBe(true);
});
