import { expect, test } from "@playwright/test";
import { createGoogleRefreshOperationId } from "../src/lib/google/refreshOperationCore";
import { createGoogleRefreshOperationRepository } from "../src/lib/google/refreshOperationRepository";
import {
  createGoogleCredentialVersion,
  createGoogleRefreshLeaseIdHash,
} from "../src/lib/google/tokenStoreCore";

const USER_ID = "44444444-4444-4444-8444-444444444444";
const VERSION = createGoogleCredentialVersion(24);
const OPERATION_ID = createGoogleRefreshOperationId(USER_ID, VERSION);
const LEASE_HASH = createGoogleRefreshLeaseIdHash("a".repeat(64));

test("repository sends only scoped operation identity and lease digest", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = createGoogleRefreshOperationRepository(async () => ({
    async rpc(name, args) {
      calls.push({ name, args: { ...args } });
      return {
        data: [{ operation_state: "prepared", credential_version: VERSION }],
        error: null,
      };
    },
  }));
  await repository.prepare({
    userId: USER_ID,
    operationId: OPERATION_ID,
    expectedCredentialVersion: VERSION,
    leaseIdHash: LEASE_HASH,
  });
  expect(calls).toEqual([
    {
      name: "prepare_google_refresh_operation",
      args: {
        p_user_id: USER_ID,
        p_operation_id: OPERATION_ID,
        p_expected_credential_version: VERSION,
        p_lease_id_hash: LEASE_HASH,
      },
    },
  ]);
  expect(JSON.stringify(calls)).not.toContain("refresh-token");
});

test("repository rejects RPC errors, malformed rows, and unknown states safely", async () => {
  for (const result of [
    { data: null, error: { message: "raw database error" } },
    { data: [], error: null },
    {
      data: [{ operation_state: "unsafe", credential_version: null }],
      error: null,
    },
  ]) {
    const repository = createGoogleRefreshOperationRepository(async () => ({
      async rpc() {
        return result;
      },
    }));
    await expect(
      repository.inspect(USER_ID, OPERATION_ID),
    ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_STORE_FAILED" });
  }
});

test("repository parses completed credential version for idempotent replay", async () => {
  const repository = createGoogleRefreshOperationRepository(async () => ({
    async rpc() {
      return {
        data: [{ operation_state: "completed", credential_version: "25" }],
        error: null,
      };
    },
  }));
  await expect(repository.inspect(USER_ID, OPERATION_ID)).resolves.toEqual({
    state: "completed",
    credentialVersion: createGoogleCredentialVersion(25),
  });
});
