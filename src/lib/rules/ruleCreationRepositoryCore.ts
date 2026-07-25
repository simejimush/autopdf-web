import {
  FILE_NAME_FORMATS,
  type FileNameFormat,
} from "@/lib/rules/fileNameFormat";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const RULE_CREATION_SELECT =
  "id, user_id, is_active, run_timing, drive_folder_id, gmail_query, query_label, file_name_format, updated_at";

export type RuleCreationRepositoryErrorCode =
  | "RULE_STORE_INPUT_INVALID"
  | "RULE_STORE_FAILED"
  | "RULE_STORE_RESULT_MISSING"
  | "RULE_STORE_RESULT_DUPLICATE";

const SAFE_ERROR_MESSAGES: Readonly<
  Record<RuleCreationRepositoryErrorCode, string>
> = Object.freeze({
  RULE_STORE_INPUT_INVALID: "Rule creation input is invalid",
  RULE_STORE_FAILED: "Rule creation failed",
  RULE_STORE_RESULT_MISSING: "Created rule was not returned",
  RULE_STORE_RESULT_DUPLICATE: "Rule creation returned multiple rows",
});

export class RuleCreationRepositoryError extends Error {
  readonly code: RuleCreationRepositoryErrorCode;

  constructor(code: RuleCreationRepositoryErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "RuleCreationRepositoryError";
    this.code = code;
  }
}

export type RuleCreationValues = Readonly<{
  driveFolderId: string;
  gmailQuery: string | null;
  queryLabel: string | null;
  subjectKeywords: string | null;
  fileNameFormat: FileNameFormat;
  isActive: boolean;
  runTiming: string;
}>;

export type RuleCreationInsertPayload = Readonly<{
  user_id: string;
  drive_folder_id: string;
  gmail_query: string | null;
  query_label: string | null;
  subject_keywords: string | null;
  file_name_format: FileNameFormat;
  is_active: boolean;
  run_timing: string;
}>;

export type CreatedRule = Readonly<{
  id: string;
  is_active: boolean;
  run_timing: string;
  drive_folder_id: string;
  gmail_query: string | null;
  query_label: string | null;
  file_name_format: FileNameFormat;
  updated_at: string;
}>;

type RuleCreationWriteResult = Readonly<{
  data: unknown;
  error: unknown;
}>;

export type RuleCreationSupabaseClient = Readonly<{
  from(table: "rules"): Readonly<{
    insert(payload: readonly [RuleCreationInsertPayload]): Readonly<{
      select(
        columns: typeof RULE_CREATION_SELECT,
      ): PromiseLike<RuleCreationWriteResult>;
    }>;
  }>;
}>;

function fail(code: RuleCreationRepositoryErrorCode): never {
  throw new RuleCreationRepositoryError(code);
}

function normalizeKeywordParts(parts: readonly string[]): string | null {
  const normalized = parts
    .flatMap((part) => part.split(/[\n,]/g))
    .map((part) => part.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized.join(",") : null;
}

export function normalizeRuleSubjectKeywords(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeKeywordParts([value]);
  }

  if (Array.isArray(value)) {
    return normalizeKeywordParts(
      value.filter((part): part is string => typeof part === "string"),
    );
  }

  return null;
}

function isNullableCanonicalString(value: unknown): value is string | null {
  return (
    value === null || (typeof value === "string" && value.trim() === value)
  );
}

function validateInput(
  input: Readonly<{
    userId: string;
    values: RuleCreationValues;
  }>,
): void {
  const { values } = input;

  if (
    !values ||
    typeof values !== "object" ||
    !UUID_PATTERN.test(input.userId) ||
    typeof values.driveFolderId !== "string" ||
    values.driveFolderId.length === 0 ||
    values.driveFolderId.trim() !== values.driveFolderId ||
    !isNullableCanonicalString(values.gmailQuery) ||
    !isNullableCanonicalString(values.queryLabel) ||
    normalizeRuleSubjectKeywords(values.subjectKeywords) !==
      values.subjectKeywords ||
    !FILE_NAME_FORMATS.includes(values.fileNameFormat) ||
    typeof values.isActive !== "boolean" ||
    typeof values.runTiming !== "string" ||
    values.runTiming.trim() !== values.runTiming
  ) {
    fail("RULE_STORE_INPUT_INVALID");
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function toCreatedRule(row: unknown, userId: string): CreatedRule {
  if (!row || typeof row !== "object") {
    fail("RULE_STORE_FAILED");
  }

  const record = row as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    !UUID_PATTERN.test(record.id) ||
    record.user_id !== userId ||
    typeof record.is_active !== "boolean" ||
    typeof record.run_timing !== "string" ||
    typeof record.drive_folder_id !== "string" ||
    !isNullableString(record.gmail_query) ||
    !isNullableString(record.query_label) ||
    !FILE_NAME_FORMATS.includes(record.file_name_format as FileNameFormat) ||
    typeof record.updated_at !== "string"
  ) {
    fail("RULE_STORE_FAILED");
  }

  return Object.freeze({
    id: record.id,
    is_active: record.is_active,
    run_timing: record.run_timing,
    drive_folder_id: record.drive_folder_id,
    gmail_query: record.gmail_query,
    query_label: record.query_label,
    file_name_format: record.file_name_format as FileNameFormat,
    updated_at: record.updated_at,
  });
}

export function createRuleCreationRepository(
  getClient: () =>
    | RuleCreationSupabaseClient
    | Promise<RuleCreationSupabaseClient>,
) {
  async function createRuleForUser(
    input: Readonly<{
      userId: string;
      values: RuleCreationValues;
    }>,
  ): Promise<CreatedRule> {
    validateInput(input);

    const payload: RuleCreationInsertPayload = Object.freeze({
      user_id: input.userId,
      drive_folder_id: input.values.driveFolderId,
      gmail_query: input.values.gmailQuery,
      query_label: input.values.queryLabel,
      subject_keywords: input.values.subjectKeywords,
      file_name_format: input.values.fileNameFormat,
      is_active: input.values.isActive,
      run_timing: input.values.runTiming,
    });

    let result: RuleCreationWriteResult;
    try {
      const client = await getClient();
      result = await client
        .from("rules")
        .insert([payload])
        .select(RULE_CREATION_SELECT);
    } catch {
      fail("RULE_STORE_FAILED");
    }

    if (result.error || !Array.isArray(result.data)) {
      fail("RULE_STORE_FAILED");
    }

    if (result.data.length === 0) {
      fail("RULE_STORE_RESULT_MISSING");
    }

    if (result.data.length !== 1) {
      fail("RULE_STORE_RESULT_DUPLICATE");
    }

    return toCreatedRule(result.data[0], input.userId);
  }

  return Object.freeze({ createRuleForUser });
}
