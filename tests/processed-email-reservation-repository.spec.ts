import { expect, test } from "@playwright/test";
import {
  createProcessedEmailReservationRepository,
  ProcessedEmailReservationRepositoryError,
  type ProcessedEmailReservationSupabaseClient,
} from "../src/lib/runs/processedEmailReservationRepositoryCore";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const RULE_ID = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);
const RESERVATION_HASH = "b".repeat(64);

const INPUT = {
  runId: RUN_ID,
  userId: USER_ID,
  ruleId: RULE_ID,
  gmailMessageId: "opaque-message",
  executionLeaseIdHash: HASH,
  reservedBytes: 36_700_160,
} as const;

function result(data: unknown) {
  return Promise.resolve({ data, error: null });
}

test("same-email parallel reservation has one winner and one loser before Drive", async () => {
  let owned = false;
  let driveCalls = 0;
  const client: ProcessedEmailReservationSupabaseClient = {
    async rpc(name) {
      expect(name).toBe("reserve_processed_email");
      await Promise.resolve();
      if (owned) {
        return {
          data: [
            {
              outcome: "ACTIVE_RESERVATION",
              reservation_expires_at: "2026-09-02T00:01:15.000Z",
            },
          ],
          error: null,
        };
      }
      owned = true;
      return {
        data: [
          {
            outcome: "RESERVED",
            reservation_expires_at: "2026-09-02T00:01:15.000Z",
          },
        ],
        error: null,
      };
    },
  };
  const repository = createProcessedEmailReservationRepository({
    getClient: () => client,
    createReservationIdHash: () => RESERVATION_HASH,
  });

  const outcomes = await Promise.all([
    repository.reserveProcessedEmail(INPUT),
    repository.reserveProcessedEmail(INPUT),
  ]);
  for (const outcome of outcomes) {
    if (outcome.reserved) driveCalls += 1;
  }

  expect(outcomes.filter((outcome) => outcome.reserved)).toHaveLength(1);
  expect(
    outcomes.filter((outcome) => !outcome.reserved && !outcome.completed),
  ).toHaveLength(1);
  expect(driveCalls).toBe(1);
});

test("reserve sends fixed ownership and quota fields and preserves rejections", async () => {
  const calls: Array<{
    name: string;
    parameters: Readonly<Record<string, unknown>>;
  }> = [];
  const client: ProcessedEmailReservationSupabaseClient = {
    rpc(name, parameters) {
      calls.push({ name, parameters });
      return result([
        {
          outcome: "DRIVE_BYTE_LIMIT_EXCEEDED",
          reservation_expires_at: null,
        },
      ]);
    },
  };
  const repository = createProcessedEmailReservationRepository({
    getClient: () => client,
    createReservationIdHash: () => RESERVATION_HASH,
  });

  await expect(repository.reserveProcessedEmail(INPUT)).resolves.toEqual({
    reserved: false,
    completed: false,
    errorCode: "DRIVE_BYTE_LIMIT_EXCEEDED",
  });
  expect(calls).toEqual([
    {
      name: "reserve_processed_email",
      parameters: {
        p_run_id: RUN_ID,
        p_user_id: USER_ID,
        p_rule_id: RULE_ID,
        p_execution_lease_id_hash: HASH,
        p_gmail_message_id: "opaque-message",
        p_reservation_id_hash: RESERVATION_HASH,
        p_reserved_bytes: 36_700_160,
      },
    },
  ]);
});

test("completed duplicate stays a success/skip state", async () => {
  const repository = createProcessedEmailReservationRepository({
    getClient: () => ({
      rpc: () =>
        result([{ outcome: "COMPLETED", reservation_expires_at: null }]),
    }),
    createReservationIdHash: () => RESERVATION_HASH,
  });
  await expect(repository.reserveProcessedEmail(INPUT)).resolves.toEqual({
    reserved: false,
    completed: true,
  });
});

test("mark and complete require exact one-row ownership outcomes", async () => {
  const names: string[] = [];
  const repository = createProcessedEmailReservationRepository({
    getClient: () => ({
      rpc(name) {
        names.push(name);
        return result([
          {
            outcome:
              name === "mark_processed_email_drive_started"
                ? "MARKED"
                : "COMPLETED",
          },
        ]);
      },
    }),
    createReservationIdHash: () => RESERVATION_HASH,
  });
  await repository.markProcessedEmailDriveStarted({
    runId: RUN_ID,
    userId: USER_ID,
    ruleId: RULE_ID,
    gmailMessageId: "opaque-message",
    reservationIdHash: RESERVATION_HASH,
  });
  await repository.completeProcessedEmail({
    runId: RUN_ID,
    userId: USER_ID,
    ruleId: RULE_ID,
    gmailMessageId: "opaque-message",
    reservationIdHash: RESERVATION_HASH,
    driveFileId: "opaque-drive-id",
    driveWebViewLink: null,
    driveFileName: "safe.pdf",
    writtenBytes: 0,
  });
  expect(names).toEqual([
    "mark_processed_email_drive_started",
    "complete_processed_email",
  ]);
});

test("invalid input and abnormal RPC cardinality fail closed without raw data", async () => {
  let rpcCalls = 0;
  const repository = createProcessedEmailReservationRepository({
    getClient: () => ({
      rpc() {
        rpcCalls += 1;
        return result([]);
      },
    }),
    createReservationIdHash: () => RESERVATION_HASH,
  });
  await expect(
    repository.reserveProcessedEmail({ ...INPUT, userId: "private-user" }),
  ).rejects.toBeInstanceOf(ProcessedEmailReservationRepositoryError);
  expect(rpcCalls).toBe(0);
  await expect(repository.reserveProcessedEmail(INPUT)).rejects.toMatchObject({
    code: "PROCESSED_EMAIL_RESERVATION_STORE_FAILED",
    message: "Processed email reservation storage failed",
  });
});
