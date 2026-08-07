export const KNOWN_RUN_ERROR_CODES = [
  "GOOGLE_TOKEN_KEY_MISSING",
  "GOOGLE_TOKEN_KEY_INVALID",
  "GOOGLE_TOKEN_KEY_ID_UNKNOWN",
  "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
  "GOOGLE_TOKEN_DECRYPT_FAILED",
  "GOOGLE_TOKEN_INPUT_INVALID",
  "GOOGLE_TOKEN_ENCRYPT_FAILED",
  "GOOGLE_TOKEN_WRITE_DISABLED",
  "GOOGLE_TOKEN_STORE_FAILED",
  "GOOGLE_TOKEN_UPDATE_CONFLICT",
  "GOOGLE_TOKEN_ROW_NOT_FOUND",
  "GOOGLE_TOKEN_ROW_DUPLICATE",
  "GOOGLE_CONNECTION_NOT_FOUND",
  "GOOGLE_REFRESH_TOKEN_MISSING",
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_PERMISSION_DENIED",
  "GOOGLE_TOKEN_REFRESH_FAILED",
  "DRIVE_UPLOAD_FAILED",
  "DB_INSERT_FAILED",
  "FREE_MONTHLY_LIMIT_EXCEEDED",
  "UNKNOWN",
] as const;

export type KnownRunErrorCode = (typeof KNOWN_RUN_ERROR_CODES)[number];

const KNOWN_RUN_ERROR_CODE_SET = new Set<string>(KNOWN_RUN_ERROR_CODES);

function getExplicitErrorCode(error: unknown): unknown {
  if (typeof error === "string") {
    return error;
  }

  if (!error || typeof error !== "object") {
    return undefined;
  }

  try {
    return "code" in error ? error.code : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeRunErrorCode(error: unknown): KnownRunErrorCode {
  const code = getExplicitErrorCode(error);

  if (typeof code === "string" && KNOWN_RUN_ERROR_CODE_SET.has(code)) {
    return code as KnownRunErrorCode;
  }

  return "UNKNOWN";
}
