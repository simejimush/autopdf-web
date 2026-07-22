import { GoogleTokenCryptoError } from "@/lib/security/googleTokenCrypto";

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  return String(error ?? "").toLowerCase();
}

export function normalizeRunErrorCode(error: unknown): string {
  if (error instanceof GoogleTokenCryptoError) {
    return error.code;
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    [
      "GOOGLE_TOKEN_KEY_MISSING",
      "GOOGLE_TOKEN_KEY_INVALID",
      "GOOGLE_TOKEN_KEY_ID_UNKNOWN",
      "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
      "GOOGLE_TOKEN_DECRYPT_FAILED",
      "GOOGLE_TOKEN_INPUT_INVALID",
      "GOOGLE_TOKEN_ENCRYPT_FAILED",
      "GOOGLE_TOKEN_STORE_FAILED",
      "GOOGLE_TOKEN_UPDATE_CONFLICT",
      "GOOGLE_TOKEN_ROW_NOT_FOUND",
      "GOOGLE_TOKEN_ROW_DUPLICATE",
      "GOOGLE_TOKEN_INVALID",
      "GOOGLE_PERMISSION_DENIED",
    ].includes(error.code)
  ) {
    return error.code;
  }

  const text = toErrorText(error);

  if (
    text.includes("invalid authentication credentials") ||
    text.includes("invalid_grant") ||
    text.includes("token has been expired") ||
    text.includes("unauthorized")
  ) {
    return "GOOGLE_TOKEN_INVALID";
  }

  if (
    text.includes("insufficient permissions") ||
    text.includes("permission denied") ||
    text.includes("forbidden")
  ) {
    return "GOOGLE_PERMISSION_DENIED";
  }

  if (
    text.includes("gmail query") ||
    text.includes("invalid query") ||
    text.includes("bad request")
  ) {
    return "GMAIL_QUERY_INVALID";
  }

  if (
    text.includes("file not found") ||
    text.includes("folder not found") ||
    text.includes("no such file")
  ) {
    return "DRIVE_FOLDER_INVALID";
  }

  if (
    text.includes("rate limit") ||
    text.includes("quota exceeded") ||
    text.includes("too many requests")
  ) {
    return "RATE_LIMIT";
  }

  if (
    text.includes("backend error") ||
    text.includes("temporarily unavailable") ||
    text.includes("internal error") ||
    text.includes("timeout")
  ) {
    return "TEMPORARY_UNAVAILABLE";
  }

  if (text.includes("row-level security") || text.includes("rls")) {
    return "DB_RLS_DENIED";
  }

  if (text.includes("duplicate key") || text.includes("constraint")) {
    return "DB_CONSTRAINT";
  }

  return "UNKNOWN";
}
