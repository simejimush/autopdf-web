import { expect, test } from "@playwright/test";
import { getRunErrorMessage } from "../src/lib/runs/getRunErrorMessage";
import {
  KNOWN_RUN_ERROR_CODES,
  normalizeRunErrorCode,
} from "../src/lib/runs/normalizeRunErrorCode";

const ADDED_RUN_ERROR_CODES = [
  "GOOGLE_CONNECTION_NOT_FOUND",
  "GOOGLE_REFRESH_TOKEN_MISSING",
  "GOOGLE_TOKEN_REFRESH_FAILED",
  "DRIVE_UPLOAD_FAILED",
  "DB_INSERT_FAILED",
  "FREE_MONTHLY_LIMIT_EXCEEDED",
] as const;

test("preserves every known run error code exactly", () => {
  for (const code of KNOWN_RUN_ERROR_CODES) {
    expect(normalizeRunErrorCode(code)).toBe(code);
    expect(normalizeRunErrorCode({ code })).toBe(code);
  }
});

test("preserves run error codes added from current implementation paths", () => {
  for (const code of ADDED_RUN_ERROR_CODES) {
    expect(
      normalizeRunErrorCode(Object.assign(new Error("safe"), { code })),
    ).toBe(code);
  }
});

test("normalizes absent, empty, non-string, and unknown values to UNKNOWN", () => {
  for (const value of [
    null,
    undefined,
    "",
    "   ",
    1,
    true,
    [],
    {},
    { code: null },
    { code: 401 },
    "GOOGLE_TOKEN_INVALD",
    "google_token_invalid",
    "prefix_GOOGLE_TOKEN_INVALID_suffix",
  ]) {
    expect(normalizeRunErrorCode(value)).toBe("UNKNOWN");
  }
});

test("does not infer codes from an error name or message", () => {
  const error = new Error(
    "GOOGLE_TOKEN_INVALID invalid_grant permission denied rate limit",
  );
  error.name = "GOOGLE_TOKEN_REFRESH_FAILED";

  expect(normalizeRunErrorCode(error)).toBe("UNKNOWN");
});

test("returns fixed safe messages for added codes and preserves UNKNOWN fallback", () => {
  const fallback = getRunErrorMessage("UNKNOWN");

  for (const code of ADDED_RUN_ERROR_CODES) {
    const result = getRunErrorMessage(code);
    expect(result.title.trim()).not.toBe("");
    expect(result.message.trim()).not.toBe("");
    expect(result).not.toEqual(fallback);
    expect(JSON.stringify(result)).not.toContain(code);
  }

  expect(getRunErrorMessage(null)).toEqual(fallback);
  expect(getRunErrorMessage("NOT_A_RUN_ERROR_CODE")).toEqual(fallback);
});
