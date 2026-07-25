const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const POSTGRES_UNIQUE_VIOLATION = "23505";

export const PROCESSED_EMAIL_SELECT = "id, user_id, rule_id, gmail_message_id";

export type ProcessedEmailRepositoryErrorCode =
  | "PROCESSED_EMAIL_INPUT_INVALID"
  | "PROCESSED_EMAIL_STORE_FAILED"
  | "PROCESSED_EMAIL_RESULT_MISSING"
  | "PROCESSED_EMAIL_RESULT_DUPLICATE"
  | "PROCESSED_EMAIL_RESULT_MISMATCH"
  | "PROCESSED_EMAIL_ALREADY_EXISTS";

const SAFE_ERROR_MESSAGES: Readonly<
  Record<ProcessedEmailRepositoryErrorCode, string>
> = Object.freeze({
  PROCESSED_EMAIL_INPUT_INVALID: "Processed email input is invalid",
  PROCESSED_EMAIL_STORE_FAILED: "Processed email storage failed",
  PROCESSED_EMAIL_RESULT_MISSING: "Stored processed email was not returned",
  PROCESSED_EMAIL_RESULT_DUPLICATE:
    "Processed email storage returned multiple rows",
  PROCESSED_EMAIL_RESULT_MISMATCH:
    "Stored processed email did not match its input",
  PROCESSED_EMAIL_ALREADY_EXISTS: "Processed email already exists",
});

export class ProcessedEmailRepositoryError extends Error {
  readonly code: ProcessedEmailRepositoryErrorCode;

  constructor(code: ProcessedEmailRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "ProcessedEmailRepositoryError";
    this.code = code;
  }
}

export type ProcessedEmailInsertPayload = Readonly<{
  user_id: string;
  rule_id: string;
  gmail_message_id: string;
  drive_file_id: string | null;
  drive_web_view_link: string | null;
  drive_file_name: string;
  saved_at: string;
}>;

export type StoredProcessedEmail = Readonly<{
  id: string;
}>;

type ProcessedEmailWriteResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type ProcessedEmailSupabaseClient = Readonly<{
  from(table: "processed_emails"): Readonly<{
    insert(payload: ProcessedEmailInsertPayload): Readonly<{
      select(
        columns: typeof PROCESSED_EMAIL_SELECT,
      ): PromiseLike<ProcessedEmailWriteResult>;
    }>;
  }>;
}>;

type RecordProcessedEmailInput = Readonly<{
  userId: string;
  ruleId: string;
  gmailMessageId: string;
  drive: Readonly<{
    fileId: string | null;
    webViewLink: string | null;
    fileName: string;
  }>;
}>;

function fail(code: ProcessedEmailRepositoryErrorCode): never {
  throw new ProcessedEmailRepositoryError(code);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    Number.isFinite(Date.parse(value))
  );
}

function isBoundedNonEmptyString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

function isNullableBoundedString(value: unknown, maxLength: number) {
  return value === null || isBoundedNonEmptyString(value, maxLength);
}

function isNullableHttpsUrl(value: unknown) {
  if (value === null) {
    return true;
  }

  if (!isBoundedNonEmptyString(value, 4096)) {
    return false;
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validateInput(input: RecordProcessedEmailInput): void {
  if (!UUID_PATTERN.test(input.userId) || !UUID_PATTERN.test(input.ruleId)) {
    fail("PROCESSED_EMAIL_INPUT_INVALID");
  }

  if (!isBoundedNonEmptyString(input.gmailMessageId, 1024)) {
    fail("PROCESSED_EMAIL_INPUT_INVALID");
  }

  if (!input.drive || typeof input.drive !== "object") {
    fail("PROCESSED_EMAIL_INPUT_INVALID");
  }

  if (
    !isNullableBoundedString(input.drive.fileId, 2048) ||
    !isNullableHttpsUrl(input.drive.webViewLink) ||
    !isBoundedNonEmptyString(input.drive.fileName, 255)
  ) {
    fail("PROCESSED_EMAIL_INPUT_INVALID");
  }
}

function getPostgresErrorCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}

function toStoredProcessedEmail(
  row: unknown,
  input: RecordProcessedEmailInput,
): StoredProcessedEmail {
  if (!row || typeof row !== "object") {
    fail("PROCESSED_EMAIL_STORE_FAILED");
  }

  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || !UUID_PATTERN.test(record.id)) {
    fail("PROCESSED_EMAIL_STORE_FAILED");
  }

  if (
    record.user_id !== input.userId ||
    record.rule_id !== input.ruleId ||
    record.gmail_message_id !== input.gmailMessageId
  ) {
    fail("PROCESSED_EMAIL_RESULT_MISMATCH");
  }

  return Object.freeze({ id: record.id });
}

export function createProcessedEmailRepository(
  dependencies: Readonly<{
    getClient: () =>
      | ProcessedEmailSupabaseClient
      | Promise<ProcessedEmailSupabaseClient>;
    now: () => string;
  }>,
) {
  async function recordProcessedEmail(
    input: RecordProcessedEmailInput,
  ): Promise<StoredProcessedEmail> {
    validateInput(input);

    let savedAt: string;
    try {
      savedAt = dependencies.now();
    } catch {
      fail("PROCESSED_EMAIL_STORE_FAILED");
    }

    if (!isIsoTimestamp(savedAt)) {
      fail("PROCESSED_EMAIL_STORE_FAILED");
    }

    const payload: ProcessedEmailInsertPayload = Object.freeze({
      user_id: input.userId,
      rule_id: input.ruleId,
      gmail_message_id: input.gmailMessageId,
      drive_file_id: input.drive.fileId,
      drive_web_view_link: input.drive.webViewLink,
      drive_file_name: input.drive.fileName,
      saved_at: savedAt,
    });

    let result: unknown;
    try {
      const client = await dependencies.getClient();
      result = await client
        .from("processed_emails")
        .insert(payload)
        .select(PROCESSED_EMAIL_SELECT);
    } catch {
      fail("PROCESSED_EMAIL_STORE_FAILED");
    }

    if (!result || typeof result !== "object") {
      fail("PROCESSED_EMAIL_STORE_FAILED");
    }

    const writeResult = result as ProcessedEmailWriteResult;
    if (writeResult.error) {
      if (
        getPostgresErrorCode(writeResult.error) === POSTGRES_UNIQUE_VIOLATION
      ) {
        fail("PROCESSED_EMAIL_ALREADY_EXISTS");
      }
      fail("PROCESSED_EMAIL_STORE_FAILED");
    }

    if (!Array.isArray(writeResult.data)) {
      fail("PROCESSED_EMAIL_STORE_FAILED");
    }

    if (writeResult.data.length === 0) {
      fail("PROCESSED_EMAIL_RESULT_MISSING");
    }

    if (writeResult.data.length !== 1) {
      fail("PROCESSED_EMAIL_RESULT_DUPLICATE");
    }

    return toStoredProcessedEmail(writeResult.data[0], input);
  }

  return Object.freeze({ recordProcessedEmail });
}
