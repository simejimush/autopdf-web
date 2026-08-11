import "server-only";

import {
  createRefreshLeaseHandle,
  encryptGoogleTokenForStore,
} from "@/lib/google/tokenStore";
import {
  createGoogleRefreshOperationId,
  type GoogleRefreshOperationHandle,
  type GoogleRefreshPrepareResult,
} from "@/lib/google/refreshOperationCore";
import { createGoogleRefreshOperationRepository } from "@/lib/google/refreshOperationRepository";
import {
  GoogleTokenStoreError,
  type GoogleCredentialVersion,
  type PlaintextGoogleToken,
} from "@/lib/google/tokenStoreCore";

const repository = createGoogleRefreshOperationRepository(async () => {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  return supabaseAdmin;
});

export async function prepareGoogleRefreshOperation(
  userId: string,
  expectedCredentialVersion: GoogleCredentialVersion,
): Promise<GoogleRefreshPrepareResult> {
  const operationId = createGoogleRefreshOperationId(
    userId,
    expectedCredentialVersion,
  );
  const lease = createRefreshLeaseHandle();
  const result = await repository.prepare({
    userId,
    operationId,
    expectedCredentialVersion,
    leaseIdHash: lease.getIdHash(),
  });
  if (result.state === "completed" && result.credentialVersion !== null) {
    return Object.freeze({
      state: "completed",
      resultCredentialVersion: result.credentialVersion,
    });
  }
  if (result.state === "provider_call_started") {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_REFRESH_IN_PROGRESS");
  }
  if (result.state === "outcome_unknown") {
    throw new GoogleTokenStoreError("GOOGLE_REFRESH_OUTCOME_UNKNOWN");
  }
  if (result.state !== "prepared") {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_UPDATE_CONFLICT");
  }
  return Object.freeze({
    state: "prepared",
    handle: Object.freeze({ operationId, lease }),
  });
}

export async function markGoogleRefreshProviderStarted(
  userId: string,
  expectedCredentialVersion: GoogleCredentialVersion,
  handle: GoogleRefreshOperationHandle,
): Promise<void> {
  const result = await repository.markProviderStarted({
    userId,
    operationId: handle.operationId,
    expectedCredentialVersion,
    leaseIdHash: handle.lease.getIdHash(),
  });
  if (result.state !== "provider_call_started") {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_UPDATE_CONFLICT");
  }
}

export async function finalizeGoogleRefreshOperation(
  input: Readonly<{
    userId: string;
    expectedCredentialVersion: GoogleCredentialVersion;
    handle: GoogleRefreshOperationHandle;
    accessToken: PlaintextGoogleToken;
    refreshToken?: PlaintextGoogleToken;
    tokenExpiryAt: string;
    timestamp: string;
  }>,
): Promise<GoogleCredentialVersion> {
  const accessTokenEncrypted = encryptGoogleTokenForStore(
    input.accessToken,
    input.userId,
    "access",
  );
  const refreshTokenEncrypted = input.refreshToken
    ? encryptGoogleTokenForStore(input.refreshToken, input.userId, "refresh")
    : null;
  try {
    const result = await repository.finalize({
      userId: input.userId,
      operationId: input.handle.operationId,
      expectedCredentialVersion: input.expectedCredentialVersion,
      leaseIdHash: input.handle.lease.getIdHash(),
      accessTokenEncrypted,
      refreshTokenEncrypted,
      refreshTokenPresent: input.refreshToken !== undefined,
      tokenExpiryAt: input.tokenExpiryAt,
      timestamp: input.timestamp,
    });
    if (result.state === "completed" && result.credentialVersion !== null) {
      return result.credentialVersion;
    }
  } catch {
    try {
      const inspected = await repository.inspect(
        input.userId,
        input.handle.operationId,
      );
      if (
        inspected.state === "completed" &&
        inspected.credentialVersion !== null
      ) {
        return inspected.credentialVersion;
      }
    } catch {
      // The durable provider-start state remains fail-closed.
    }
  }
  throw new GoogleTokenStoreError("GOOGLE_REFRESH_OUTCOME_UNKNOWN");
}

export async function transitionGoogleRefreshOperation(
  input: Readonly<{
    userId: string;
    expectedCredentialVersion: GoogleCredentialVersion;
    handle: GoogleRefreshOperationHandle;
    targetState: "retryable" | "failed_terminal" | "outcome_unknown";
    errorCode: string;
  }>,
): Promise<void> {
  const result = await repository.transition({
    userId: input.userId,
    operationId: input.handle.operationId,
    expectedCredentialVersion: input.expectedCredentialVersion,
    leaseIdHash: input.handle.lease.getIdHash(),
    targetState: input.targetState,
    errorCode: input.errorCode,
  });
  if (result.state !== input.targetState) {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED");
  }
}
