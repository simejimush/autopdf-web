import { createHash } from "node:crypto";

import {
  createGoogleCredentialVersion,
  GoogleTokenStoreError,
  type GoogleCredentialVersion,
  type GoogleRefreshLeaseHandle,
} from "@/lib/google/tokenStoreCore";

declare const googleRefreshOperationIdBrand: unique symbol;

export type GoogleRefreshOperationId = string & {
  readonly [googleRefreshOperationIdBrand]: true;
};

export type GoogleRefreshOperationState =
  | "prepared"
  | "retryable"
  | "provider_call_started"
  | "completed"
  | "failed_terminal"
  | "outcome_unknown"
  | "resolved";

export type GoogleRefreshOperationHandle = Readonly<{
  operationId: GoogleRefreshOperationId;
  lease: GoogleRefreshLeaseHandle;
}>;

export type GoogleRefreshPrepareResult =
  | Readonly<{ state: "prepared"; handle: GoogleRefreshOperationHandle }>
  | Readonly<{
      state: "completed";
      resultCredentialVersion: GoogleCredentialVersion;
    }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createGoogleRefreshOperationId(
  userId: string,
  credentialVersion: GoogleCredentialVersion,
): GoogleRefreshOperationId {
  if (!UUID_PATTERN.test(userId)) {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_INPUT_INVALID");
  }
  const digest = createHash("sha256")
    .update(
      `autopdf-google-refresh-operation-v1|${userId}|${credentialVersion}`,
    )
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as GoogleRefreshOperationId;
}

export function parseGoogleRefreshOperationVersion(
  value: unknown,
): GoogleCredentialVersion {
  try {
    return createGoogleCredentialVersion(value as string | number);
  } catch {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED");
  }
}
