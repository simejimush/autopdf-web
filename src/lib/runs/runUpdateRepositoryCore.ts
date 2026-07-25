const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export const RUN_UPDATE_SELECT = "id, user_id, status";

export type RunUpdateRepositoryErrorCode =
  | "RUN_UPDATE_INPUT_INVALID"
  | "RUN_UPDATE_FAILED"
  | "RUN_UPDATE_RESULT_MISSING"
  | "RUN_UPDATE_RESULT_DUPLICATE"
  | "RUN_UPDATE_RESULT_MISMATCH";

const SAFE_ERROR_MESSAGES: Readonly<
  Record<RunUpdateRepositoryErrorCode, string>
> = Object.freeze({
  RUN_UPDATE_INPUT_INVALID: "Run update input is invalid",
  RUN_UPDATE_FAILED: "Run update failed",
  RUN_UPDATE_RESULT_MISSING: "Updated run was not returned",
  RUN_UPDATE_RESULT_DUPLICATE: "Run update returned multiple rows",
  RUN_UPDATE_RESULT_MISMATCH: "Updated run did not match its input",
});

export class RunUpdateRepositoryError extends Error {
  readonly code: RunUpdateRepositoryErrorCode;

  constructor(code: RunUpdateRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "RunUpdateRepositoryError";
    this.code = code;
  }
}

export type RunSuccessUpdate = Readonly<{
  status: "success";
  processedCount: number;
  savedCount: number;
  skippedCount: number;
  message: string;
}>;

export type RunErrorUpdate = Readonly<{
  status: "error";
  errorCode: string;
  message: string;
  resetCounts: boolean;
}>;

export type RunFinalization = RunSuccessUpdate | RunErrorUpdate;

export type RunUpdatePayload = Readonly<{
  status: "success" | "error";
  finished_at: string;
  message: string;
  processed_count?: number;
  saved_count?: number;
  skipped_count?: number;
  error_code?: string;
}>;

type RunUpdateResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type RunUpdateSupabaseClient = Readonly<{
  from(table: "runs"): Readonly<{
    update(payload: RunUpdatePayload): Readonly<{
      eq(
        column: "id",
        value: string,
      ): Readonly<{
        eq(
          column: "user_id",
          value: string,
        ): Readonly<{
          select(
            columns: typeof RUN_UPDATE_SELECT,
          ): PromiseLike<RunUpdateResult>;
        }>;
      }>;
    }>;
  }>;
}>;

function fail(code: RunUpdateRepositoryErrorCode): never {
  throw new RunUpdateRepositoryError(code);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) {
    return false;
  }

  return Number.isFinite(Date.parse(value));
}

function isValidCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isValidMessage(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateInput(
  input: Readonly<{
    runId: string;
    userId: string;
    finalization: RunFinalization;
  }>,
): void {
  if (!UUID_PATTERN.test(input.runId) || !UUID_PATTERN.test(input.userId)) {
    fail("RUN_UPDATE_INPUT_INVALID");
  }

  const finalization = input.finalization as unknown as Record<string, unknown>;
  if (!finalization || typeof finalization !== "object") {
    fail("RUN_UPDATE_INPUT_INVALID");
  }

  if (!isValidMessage(finalization.message)) {
    fail("RUN_UPDATE_INPUT_INVALID");
  }

  if (finalization.status === "success") {
    if (
      !isValidCount(finalization.processedCount) ||
      !isValidCount(finalization.savedCount) ||
      !isValidCount(finalization.skippedCount)
    ) {
      fail("RUN_UPDATE_INPUT_INVALID");
    }
    return;
  }

  if (
    finalization.status !== "error" ||
    typeof finalization.errorCode !== "string" ||
    !ERROR_CODE_PATTERN.test(finalization.errorCode) ||
    typeof finalization.resetCounts !== "boolean"
  ) {
    fail("RUN_UPDATE_INPUT_INVALID");
  }
}

function buildPayload(
  finalization: RunFinalization,
  finishedAt: string,
): RunUpdatePayload {
  if (finalization.status === "success") {
    return Object.freeze({
      status: "success",
      processed_count: finalization.processedCount,
      saved_count: finalization.savedCount,
      skipped_count: finalization.skippedCount,
      message: finalization.message,
      finished_at: finishedAt,
    });
  }

  if (finalization.resetCounts) {
    return Object.freeze({
      status: "error",
      error_code: finalization.errorCode,
      processed_count: 0,
      saved_count: 0,
      skipped_count: 0,
      message: finalization.message,
      finished_at: finishedAt,
    });
  }

  return Object.freeze({
    status: "error",
    error_code: finalization.errorCode,
    message: finalization.message,
    finished_at: finishedAt,
  });
}

function verifyUpdatedRow(
  row: unknown,
  input: Readonly<{
    runId: string;
    userId: string;
    finalization: RunFinalization;
  }>,
): void {
  if (!row || typeof row !== "object") {
    fail("RUN_UPDATE_FAILED");
  }

  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || !UUID_PATTERN.test(record.id)) {
    fail("RUN_UPDATE_FAILED");
  }

  if (
    record.id !== input.runId ||
    record.user_id !== input.userId ||
    record.status !== input.finalization.status
  ) {
    fail("RUN_UPDATE_RESULT_MISMATCH");
  }
}

export function createRunUpdateRepository(
  dependencies: Readonly<{
    getClient: () => RunUpdateSupabaseClient | Promise<RunUpdateSupabaseClient>;
    now: () => string;
  }>,
) {
  async function finalizeRunForUser(
    input: Readonly<{
      runId: string;
      userId: string;
      finalization: RunFinalization;
    }>,
  ): Promise<void> {
    validateInput(input);

    let finishedAt: string;
    try {
      finishedAt = dependencies.now();
    } catch {
      fail("RUN_UPDATE_FAILED");
    }

    if (!isIsoTimestamp(finishedAt)) {
      fail("RUN_UPDATE_FAILED");
    }

    const payload = buildPayload(input.finalization, finishedAt);

    let result: unknown;
    try {
      const client = await dependencies.getClient();
      result = await client
        .from("runs")
        .update(payload)
        .eq("id", input.runId)
        .eq("user_id", input.userId)
        .select(RUN_UPDATE_SELECT);
    } catch {
      fail("RUN_UPDATE_FAILED");
    }

    if (!result || typeof result !== "object") {
      fail("RUN_UPDATE_FAILED");
    }

    const writeResult = result as RunUpdateResult;
    if (writeResult.error || !Array.isArray(writeResult.data)) {
      fail("RUN_UPDATE_FAILED");
    }

    if (writeResult.data.length === 0) {
      fail("RUN_UPDATE_RESULT_MISSING");
    }

    if (writeResult.data.length !== 1) {
      fail("RUN_UPDATE_RESULT_DUPLICATE");
    }

    verifyUpdatedRow(writeResult.data[0], input);
  }

  return Object.freeze({ finalizeRunForUser });
}
