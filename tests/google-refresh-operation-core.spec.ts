import { expect, test } from "@playwright/test";
import {
  createGoogleRefreshOperationId,
  parseGoogleRefreshOperationVersion,
} from "../src/lib/google/refreshOperationCore";
import { createGoogleCredentialVersion } from "../src/lib/google/tokenStoreCore";

const USER_A = "44444444-4444-4444-8444-444444444444";
const USER_B = "55555555-5555-4555-8555-555555555555";

test("operation id is stable for the same user and credential version", () => {
  const version = createGoogleCredentialVersion(24);
  const first = createGoogleRefreshOperationId(USER_A, version);
  const second = createGoogleRefreshOperationId(USER_A, version);
  expect(first).toBe(second);
  expect(first).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("operation id is separated by user and credential version", () => {
  const version24 = createGoogleCredentialVersion(24);
  expect(createGoogleRefreshOperationId(USER_A, version24)).not.toBe(
    createGoogleRefreshOperationId(USER_B, version24),
  );
  expect(createGoogleRefreshOperationId(USER_A, version24)).not.toBe(
    createGoogleRefreshOperationId(USER_A, createGoogleCredentialVersion(25)),
  );
});

test("invalid operation identity inputs fail with fixed safe errors", () => {
  expect(() =>
    createGoogleRefreshOperationId(
      "invalid-user",
      createGoogleCredentialVersion(24),
    ),
  ).toThrowError(/Google token store input is invalid/);
  expect(() =>
    parseGoogleRefreshOperationVersion("not-a-version"),
  ).toThrowError(/Google token storage failed/);
});
