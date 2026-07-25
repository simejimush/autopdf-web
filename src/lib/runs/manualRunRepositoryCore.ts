const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MANUAL_RUN_SELECT =
  "id, user_id, rule_id, trigger, status, started_at";

export type ManualRunRepositoryErrorCode =
  | "RUN_STORE_INPUT_INVALID"
  | "RUN_STORE_FAILED"
  | "RUN_STORE_RESULT_MISSING"
  | "RUN_STORE_RESULT_DUPLICATE"
  | "RUN_STORE_RESULT_MISMATCH";

const SAFE_ERROR_MESSAGES: Readonly<
  Record<ManualRunRepositoryErrorCode, string>
> = Object.freeze({
  RUN_STORE_INPUT_INVALID: "Manual run input is invalid",
  RUN_STORE_FAILED: "Manual run creation failed",
  RUN_STORE_RESULT_MISSING: "Created manual run was not returned",
  RUN_STORE_RESULT_DUPLICATE: "Manual run creation returned multiple rows",
  RUN_STORE_RESULT_MISMATCH: "Created manual run did not match its input",
});

export class ManualRunRepositoryError extends Error {
  readonly code: ManualRunRepositoryErrorCode;

  constructor(code: ManualRunRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "ManualRunRepositoryError";
    this.code = code;
  }
}

export type ManualRunInsertPayload = Readonly<{
  user_id: string;
  rule_id: string;
  trigger: "manual";
  status: "running";
  processed_count: 0;
  saved_count: 0;
  skipped_count: 0;
  message: "Run started";
  started_at: string;
}>;

export type CreatedManualRun = Readonly<{
  id: string;
  status: "running";
  started_at: string;
}>;

type ManualRunWriteResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type ManualRunSupabaseClient = Readonly<{
  from(table: "runs"): Readonly<{
    insert(payload: ManualRunInsertPayload): Readonly<{
      select(
        columns: typeof MANUAL_RUN_SELECT,
      ): PromiseLike<ManualRunWriteResult>;
    }>;
  }>;
}>;

function fail(code: ManualRunRepositoryErrorCode): never {
  throw new ManualRunRepositoryError(code);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

function validateInput(
  input: Readonly<{
    userId: string;
    ruleId: string;
  }>,
): void {
  if (!UUID_PATTERN.test(input.userId) || !UUID_PATTERN.test(input.ruleId)) {
    fail("RUN_STORE_INPUT_INVALID");
  }
}

function toCreatedManualRun(
  row: unknown,
  input: Readonly<{ userId: string; ruleId: string }>,
): CreatedManualRun {
  if (!row || typeof row !== "object") {
    fail("RUN_STORE_FAILED");
  }

  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || !UUID_PATTERN.test(record.id)) {
    fail("RUN_STORE_FAILED");
  }

  if (
    record.user_id !== input.userId ||
    record.rule_id !== input.ruleId ||
    record.trigger !== "manual" ||
    record.status !== "running" ||
    !isIsoTimestamp(record.started_at)
  ) {
    fail("RUN_STORE_RESULT_MISMATCH");
  }

  return Object.freeze({
    id: record.id,
    status: "running",
    started_at: record.started_at,
  });
}

export function createManualRunRepository(
  dependencies: Readonly<{
    getClient: () => ManualRunSupabaseClient | Promise<ManualRunSupabaseClient>;
    now: () => string;
  }>,
) {
  async function createManualRun(
    input: Readonly<{
      userId: string;
      ruleId: string;
    }>,
  ): Promise<CreatedManualRun> {
    validateInput(input);

    let startedAt: string;
    try {
      startedAt = dependencies.now();
    } catch {
      fail("RUN_STORE_FAILED");
    }

    if (!isIsoTimestamp(startedAt)) {
      fail("RUN_STORE_FAILED");
    }

    const payload: ManualRunInsertPayload = Object.freeze({
      user_id: input.userId,
      rule_id: input.ruleId,
      trigger: "manual",
      status: "running",
      processed_count: 0,
      saved_count: 0,
      skipped_count: 0,
      message: "Run started",
      started_at: startedAt,
    });

    let result: ManualRunWriteResult;
    try {
      const client = await dependencies.getClient();
      result = await client
        .from("runs")
        .insert(payload)
        .select(MANUAL_RUN_SELECT);
    } catch {
      fail("RUN_STORE_FAILED");
    }

    if (result.error || !Array.isArray(result.data)) {
      fail("RUN_STORE_FAILED");
    }

    if (result.data.length === 0) {
      fail("RUN_STORE_RESULT_MISSING");
    }

    if (result.data.length !== 1) {
      fail("RUN_STORE_RESULT_DUPLICATE");
    }

    return toCreatedManualRun(result.data[0], input);
  }

  return Object.freeze({ createManualRun });
}
