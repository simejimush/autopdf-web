import "server-only";

import {
  ATTACHMENT_COUNT_LIMIT,
  GENERATED_PDF_LIMIT_BYTES,
  RAW_EMAIL_BODY_LIMIT_BYTES,
  SINGLE_ATTACHMENT_LIMIT_BYTES,
  SYSTEM_MONTHLY_DRIVE_WRITE_LIMIT_BYTES,
  TOTAL_ATTACHMENT_LIMIT_BYTES,
  TOTAL_DRIVE_WRITE_PER_EMAIL_LIMIT_BYTES,
  USER_MONTHLY_DRIVE_WRITE_LIMIT_BYTES,
} from "@/lib/cost-safety/limits";

function isNonNegativeByteCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isByteReservationWithinLimit(input: {
  currentBytes: unknown;
  reservedBytes: unknown;
  requestedBytes: unknown;
  limitBytes: number;
}): boolean {
  if (
    !isNonNegativeByteCount(input.currentBytes) ||
    !isNonNegativeByteCount(input.reservedBytes) ||
    !isNonNegativeByteCount(input.requestedBytes)
  ) {
    return false;
  }

  const total = input.currentBytes + input.reservedBytes + input.requestedBytes;

  return Number.isSafeInteger(total) && total <= input.limitBytes;
}

export function getUtf8ByteLength(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const byteLength = Buffer.byteLength(value, "utf8");

  return Number.isSafeInteger(byteLength) ? byteLength : null;
}

export function isRawEmailBodyWithinLimit(value: unknown): boolean {
  const byteLength = getUtf8ByteLength(value);
  return byteLength !== null && byteLength <= RAW_EMAIL_BODY_LIMIT_BYTES;
}

export function areAttachmentMetadataWithinLimits(input: {
  count: unknown;
  declaredByteSizes: readonly unknown[];
  totalDeclaredBytes: unknown;
}): boolean {
  if (
    !isNonNegativeByteCount(input.count) ||
    !Array.isArray(input.declaredByteSizes) ||
    !isNonNegativeByteCount(input.totalDeclaredBytes) ||
    input.count !== input.declaredByteSizes.length ||
    input.count > ATTACHMENT_COUNT_LIMIT
  ) {
    return false;
  }

  let summedBytes = 0;

  for (const size of input.declaredByteSizes) {
    if (!isNonNegativeByteCount(size) || size > SINGLE_ATTACHMENT_LIMIT_BYTES) {
      return false;
    }

    summedBytes += size;

    if (!Number.isSafeInteger(summedBytes)) {
      return false;
    }
  }

  return (
    summedBytes === input.totalDeclaredBytes &&
    summedBytes <= TOTAL_ATTACHMENT_LIMIT_BYTES
  );
}

export function isGeneratedPdfWithinLimit(byteLength: unknown): boolean {
  return (
    isNonNegativeByteCount(byteLength) &&
    byteLength <= GENERATED_PDF_LIMIT_BYTES
  );
}

export function isTotalDriveWriteWithinLimit(byteLength: unknown): boolean {
  return (
    isNonNegativeByteCount(byteLength) &&
    byteLength <= TOTAL_DRIVE_WRITE_PER_EMAIL_LIMIT_BYTES
  );
}

export function isUserMonthlyDriveWriteWithinLimit(input: {
  currentBytes: unknown;
  reservedBytes: unknown;
  requestedBytes: unknown;
}): boolean {
  return isByteReservationWithinLimit({
    ...input,
    limitBytes: USER_MONTHLY_DRIVE_WRITE_LIMIT_BYTES,
  });
}

export function isSystemMonthlyDriveWriteWithinLimit(input: {
  currentBytes: unknown;
  reservedBytes: unknown;
  requestedBytes: unknown;
}): boolean {
  return isByteReservationWithinLimit({
    ...input,
    limitBytes: SYSTEM_MONTHLY_DRIVE_WRITE_LIMIT_BYTES,
  });
}
