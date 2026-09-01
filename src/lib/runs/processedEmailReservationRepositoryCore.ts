const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export const PROCESSED_EMAIL_RESERVATION_REJECTION_CODES = [
  "ACTIVE_RESERVATION",
  "OUTCOME_UNKNOWN",
  "DAILY_PROCESSED_EMAIL_LIMIT_EXCEEDED",
  "FREE_MONTHLY_LIMIT_EXCEEDED",
  "MONTHLY_PROCESSED_EMAIL_LIMIT_EXCEEDED",
  "DRIVE_BYTE_LIMIT_EXCEEDED",
] as const;

export type ProcessedEmailReservationRejectionCode =
  (typeof PROCESSED_EMAIL_RESERVATION_REJECTION_CODES)[number];

export class ProcessedEmailReservationRepositoryError extends Error {
  readonly code = "PROCESSED_EMAIL_RESERVATION_STORE_FAILED";

  constructor() {
    super("Processed email reservation storage failed");
    this.name = "ProcessedEmailReservationRepositoryError";
  }
}

type RpcResult = Readonly<{ data: unknown; error: unknown }>;

export type ProcessedEmailReservationSupabaseClient = Readonly<{
  rpc(
    functionName:
      | "reserve_processed_email"
      | "mark_processed_email_drive_started"
      | "complete_processed_email",
    parameters: Readonly<Record<string, unknown>>,
  ): PromiseLike<RpcResult>;
}>;

export type ProcessedEmailReservation =
  | Readonly<{
      reserved: true;
      reservationIdHash: string;
      reservationExpiresAt: string;
    }>
  | Readonly<{ reserved: false; completed: true }>
  | Readonly<{
      reserved: false;
      completed: false;
      errorCode: ProcessedEmailReservationRejectionCode;
    }>;

type ReservationIdentity = Readonly<{
  runId: string;
  userId: string;
  ruleId: string;
  gmailMessageId: string;
}>;

function fail(): never {
  throw new ProcessedEmailReservationRepositoryError();
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maximum
  );
}

function validateIdentity(input: ReservationIdentity): void {
  if (
    !UUID_PATTERN.test(input.runId) ||
    !UUID_PATTERN.test(input.userId) ||
    !UUID_PATTERN.test(input.ruleId) ||
    !isBoundedString(input.gmailMessageId, 512)
  ) {
    fail();
  }
}

function getOnlyRow(result: RpcResult): Record<string, unknown> {
  if (result.error || !Array.isArray(result.data) || result.data.length !== 1) {
    fail();
  }
  const row = result.data[0];
  if (!row || typeof row !== "object") fail();
  return row as Record<string, unknown>;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function createProcessedEmailReservationRepository(
  dependencies: Readonly<{
    getClient: () =>
      | ProcessedEmailReservationSupabaseClient
      | Promise<ProcessedEmailReservationSupabaseClient>;
    createReservationIdHash: () => string;
  }>,
) {
  async function callRpc(
    name:
      | "reserve_processed_email"
      | "mark_processed_email_drive_started"
      | "complete_processed_email",
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    try {
      const client = await dependencies.getClient();
      return getOnlyRow(await client.rpc(name, parameters));
    } catch (error) {
      if (error instanceof ProcessedEmailReservationRepositoryError) {
        throw error;
      }
      fail();
    }
  }

  async function reserveProcessedEmail(
    input: ReservationIdentity &
      Readonly<{ executionLeaseIdHash: string; reservedBytes: number }>,
  ): Promise<ProcessedEmailReservation> {
    validateIdentity(input);
    if (
      !HASH_PATTERN.test(input.executionLeaseIdHash) ||
      !Number.isSafeInteger(input.reservedBytes) ||
      input.reservedBytes < 1
    ) {
      fail();
    }

    let reservationIdHash: string;
    try {
      reservationIdHash = dependencies.createReservationIdHash();
    } catch {
      fail();
    }
    if (!HASH_PATTERN.test(reservationIdHash)) fail();

    const row = await callRpc("reserve_processed_email", {
      p_run_id: input.runId,
      p_user_id: input.userId,
      p_rule_id: input.ruleId,
      p_execution_lease_id_hash: input.executionLeaseIdHash,
      p_gmail_message_id: input.gmailMessageId,
      p_reservation_id_hash: reservationIdHash,
      p_reserved_bytes: input.reservedBytes,
    });

    if (
      row.outcome === "RESERVED" &&
      isIsoTimestamp(row.reservation_expires_at)
    ) {
      return Object.freeze({
        reserved: true,
        reservationIdHash,
        reservationExpiresAt: row.reservation_expires_at,
      });
    }
    if (row.outcome === "COMPLETED" && row.reservation_expires_at === null) {
      return Object.freeze({ reserved: false, completed: true });
    }
    if (
      typeof row.outcome === "string" &&
      PROCESSED_EMAIL_RESERVATION_REJECTION_CODES.includes(
        row.outcome as ProcessedEmailReservationRejectionCode,
      )
    ) {
      return Object.freeze({
        reserved: false,
        completed: false,
        errorCode: row.outcome as ProcessedEmailReservationRejectionCode,
      });
    }
    fail();
  }

  async function markProcessedEmailDriveStarted(
    input: ReservationIdentity & Readonly<{ reservationIdHash: string }>,
  ): Promise<void> {
    validateIdentity(input);
    if (!HASH_PATTERN.test(input.reservationIdHash)) fail();
    const row = await callRpc("mark_processed_email_drive_started", {
      p_run_id: input.runId,
      p_user_id: input.userId,
      p_rule_id: input.ruleId,
      p_gmail_message_id: input.gmailMessageId,
      p_reservation_id_hash: input.reservationIdHash,
    });
    if (row.outcome !== "MARKED") fail();
  }

  async function completeProcessedEmail(
    input: ReservationIdentity &
      Readonly<{
        reservationIdHash: string;
        driveFileId: string;
        driveWebViewLink: string | null;
        driveFileName: string;
        writtenBytes: number;
      }>,
  ): Promise<void> {
    validateIdentity(input);
    if (
      !HASH_PATTERN.test(input.reservationIdHash) ||
      !isBoundedString(input.driveFileId, 2048) ||
      !isBoundedString(input.driveFileName, 255) ||
      (input.driveWebViewLink !== null &&
        !isBoundedString(input.driveWebViewLink, 4096)) ||
      !Number.isSafeInteger(input.writtenBytes) ||
      input.writtenBytes < 0
    ) {
      fail();
    }
    const row = await callRpc("complete_processed_email", {
      p_run_id: input.runId,
      p_user_id: input.userId,
      p_rule_id: input.ruleId,
      p_gmail_message_id: input.gmailMessageId,
      p_reservation_id_hash: input.reservationIdHash,
      p_drive_file_id: input.driveFileId,
      p_drive_web_view_link: input.driveWebViewLink,
      p_drive_file_name: input.driveFileName,
      p_written_bytes: input.writtenBytes,
    });
    if (row.outcome !== "COMPLETED") fail();
  }

  return Object.freeze({
    reserveProcessedEmail,
    markProcessedEmailDriveStarted,
    completeProcessedEmail,
  });
}
