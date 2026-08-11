import {
  GoogleTokenStoreError,
  type EncryptedGoogleToken,
  type GoogleCredentialVersion,
  type GoogleRefreshLeaseIdHash,
} from "@/lib/google/tokenStoreCore";
import {
  parseGoogleRefreshOperationVersion,
  type GoogleRefreshOperationId,
  type GoogleRefreshOperationState,
} from "@/lib/google/refreshOperationCore";

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

export type GoogleRefreshOperationSupabaseClient = Readonly<{
  rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ): PromiseLike<QueryResult>;
}>;

type OperationResult = Readonly<{
  state: GoogleRefreshOperationState;
  credentialVersion: GoogleCredentialVersion | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOperationResult(result: QueryResult): OperationResult {
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED");
  }
  const row = result.data[0];
  if (!isRecord(row) || typeof row.operation_state !== "string") {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED");
  }
  const states = new Set<GoogleRefreshOperationState>([
    "prepared",
    "retryable",
    "provider_call_started",
    "completed",
    "failed_terminal",
    "outcome_unknown",
    "resolved",
  ]);
  if (!states.has(row.operation_state as GoogleRefreshOperationState)) {
    throw new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED");
  }
  return Object.freeze({
    state: row.operation_state as GoogleRefreshOperationState,
    credentialVersion:
      row.credential_version === null || row.credential_version === undefined
        ? null
        : parseGoogleRefreshOperationVersion(row.credential_version),
  });
}

export function createGoogleRefreshOperationRepository(
  getClient: () => Promise<GoogleRefreshOperationSupabaseClient>,
) {
  async function rpc(
    functionName: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<OperationResult> {
    try {
      const client = await getClient();
      return parseOperationResult(await client.rpc(functionName, args));
    } catch (error) {
      if (error instanceof GoogleTokenStoreError) throw error;
      throw new GoogleTokenStoreError("GOOGLE_TOKEN_STORE_FAILED");
    }
  }

  return Object.freeze({
    prepare(
      input: Readonly<{
        userId: string;
        operationId: GoogleRefreshOperationId;
        expectedCredentialVersion: GoogleCredentialVersion;
        leaseIdHash: GoogleRefreshLeaseIdHash;
      }>,
    ) {
      return rpc("prepare_google_refresh_operation", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_expected_credential_version: input.expectedCredentialVersion,
        p_lease_id_hash: input.leaseIdHash,
      });
    },
    markProviderStarted(
      input: Readonly<{
        userId: string;
        operationId: GoogleRefreshOperationId;
        expectedCredentialVersion: GoogleCredentialVersion;
        leaseIdHash: GoogleRefreshLeaseIdHash;
      }>,
    ) {
      return rpc("mark_google_refresh_provider_started", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_expected_credential_version: input.expectedCredentialVersion,
        p_lease_id_hash: input.leaseIdHash,
      });
    },
    finalize(
      input: Readonly<{
        userId: string;
        operationId: GoogleRefreshOperationId;
        expectedCredentialVersion: GoogleCredentialVersion;
        leaseIdHash: GoogleRefreshLeaseIdHash;
        accessTokenEncrypted: EncryptedGoogleToken;
        refreshTokenEncrypted: EncryptedGoogleToken | null;
        refreshTokenPresent: boolean;
        tokenExpiryAt: string;
        timestamp: string;
      }>,
    ) {
      return rpc("finalize_google_refresh_operation", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_expected_credential_version: input.expectedCredentialVersion,
        p_lease_id_hash: input.leaseIdHash,
        p_access_token_enc: input.accessTokenEncrypted,
        p_refresh_token_enc: input.refreshTokenEncrypted,
        p_refresh_token_present: input.refreshTokenPresent,
        p_token_expiry_at: input.tokenExpiryAt,
        p_timestamp: input.timestamp,
      });
    },
    transition(
      input: Readonly<{
        userId: string;
        operationId: GoogleRefreshOperationId;
        expectedCredentialVersion: GoogleCredentialVersion;
        leaseIdHash: GoogleRefreshLeaseIdHash;
        targetState: "retryable" | "failed_terminal" | "outcome_unknown";
        errorCode: string;
      }>,
    ) {
      return rpc("transition_google_refresh_operation", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_expected_credential_version: input.expectedCredentialVersion,
        p_lease_id_hash: input.leaseIdHash,
        p_target_state: input.targetState,
        p_error_code: input.errorCode,
      });
    },
    inspect(userId: string, operationId: GoogleRefreshOperationId) {
      return rpc("get_google_refresh_operation", {
        p_user_id: userId,
        p_operation_id: operationId,
      });
    },
  });
}
