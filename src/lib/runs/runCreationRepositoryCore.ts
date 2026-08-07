const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const RUN_CREATION_SELECT =
  "id, user_id, rule_id, trigger, status, started_at";

export type RunTrigger = "manual" | "cron";

export type RunCreationRepositoryErrorCode =
  | "RUN_STORE_INPUT_INVALID"
  | "RUN_STORE_FAILED"
  | "RUN_STORE_RESULT_MISSING"
  | "RUN_STORE_RESULT_DUPLICATE"
  | "RUN_STORE_RESULT_MISMATCH";

const SAFE_ERROR_MESSAGES: Readonly<
  Record<RunCreationRepositoryErrorCode, string>
> = Object.freeze({
  RUN_STORE_INPUT_INVALID: "Run input is invalid",
  RUN_STORE_FAILED: "Run creation failed",
  RUN_STORE_RESULT_MISSING: "Created run was not returned",
  RUN_STORE_RESULT_DUPLICATE: "Run creation returned multiple rows",
  RUN_STORE_RESULT_MISMATCH: "Created run did not match its input",
});

export class RunCreationRepositoryError extends Error {
  readonly code: RunCreationRepositoryErrorCode;

  constructor(code: RunCreationRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "RunCreationRepositoryError";
    this.code = code;
  }
}

export type RunCreationInsertPayload<TTrigger extends RunTrigger> = Readonly<{
  user_id: string;
  rule_id: string;
  trigger: TTrigger;
  status: "running";
  processed_count: 0;
  saved_count: 0;
  skipped_count: 0;
  message: "Run started";
  started_at: string;
}>;

export type CreatedRun = Readonly<{
  id: string;
  status: "running";
  started_at: string;
}>;

type RunCreationWriteResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type RunCreationSupabaseClient<TTrigger extends RunTrigger> = Readonly<{
  from(table: "runs"): Readonly<{
    insert(payload: RunCreationInsertPayload<TTrigger>): Readonly<{
      select(
        columns: typeof RUN_CREATION_SELECT,
      ): PromiseLike<RunCreationWriteResult>;
    }>;
  }>;
}>;

function fail(code: RunCreationRepositoryErrorCode): never {
  throw new RunCreationRepositoryError(code);
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

function toCreatedRun<TTrigger extends RunTrigger>(
  row: unknown,
  input: Readonly<{ userId: string; ruleId: string }>,
  trigger: TTrigger,
): CreatedRun {
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
    record.trigger !== trigger ||
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

export function createRunCreationRepository<TTrigger extends RunTrigger>(
  dependencies: Readonly<{
    getClient: () =>
      | RunCreationSupabaseClient<TTrigger>
      | Promise<RunCreationSupabaseClient<TTrigger>>;
    now: () => string;
    trigger: TTrigger;
  }>,
) {
  async function createRun(
    input: Readonly<{
      userId: string;
      ruleId: string;
    }>,
  ): Promise<CreatedRun> {
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

    const payload: RunCreationInsertPayload<TTrigger> = Object.freeze({
      user_id: input.userId,
      rule_id: input.ruleId,
      trigger: dependencies.trigger,
      status: "running",
      processed_count: 0,
      saved_count: 0,
      skipped_count: 0,
      message: "Run started",
      started_at: startedAt,
    });

    let result: RunCreationWriteResult;
    try {
      const client = await dependencies.getClient();
      result = await client
        .from("runs")
        .insert(payload)
        .select(RUN_CREATION_SELECT);
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

    return toCreatedRun(result.data[0], input, dependencies.trigger);
  }

  return Object.freeze({ createRun });
}
