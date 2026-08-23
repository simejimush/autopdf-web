import { expect, test } from "@playwright/test";
import {
  executePrivacySafeCheckoutHarness,
  PrivacySafeHarnessError,
  runPrivacySafeCheckoutHarness,
} from "../scripts/preview-stripe-checkout-privacy-harness";

const CREDENTIAL_MARKER = "synthetic-session-cookie-marker";
const AUTHORIZATION_MARKER = "synthetic-authorization-marker";
const EMAIL_MARKER = "synthetic-fixture-email-marker";
const USER_ID_MARKER = "synthetic-user-id-marker";
const STRIPE_ID_MARKER = "synthetic-stripe-id-marker";
const SENSITIVE_MARKERS = [
  CREDENTIAL_MARKER,
  AUTHORIZATION_MARKER,
  EMAIL_MARKER,
  USER_ID_MARKER,
  STRIPE_ID_MARKER,
];
const RESULT_KEYS = [
  "active_attempt_count",
  "authenticated",
  "customer_created_count",
  "live_operations",
  "loser_count",
  "production_operations",
  "request_count",
  "session_created_count",
  "status_class",
  "subscription_created_count",
  "winner_count",
];

function createDependencies(overrides: Record<string, unknown> = {}) {
  return {
    argv: [] as string[],
    requestCount: 2,
    checkoutUrl: new URL("https://preview.invalid/api/stripe/checkout"),
    acquireSession: async () => ({ cookieHeader: CREDENTIAL_MARKER }),
    fetchImpl: async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(input.toString()).toBe(
        "https://preview.invalid/api/stripe/checkout",
      );
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("cookie")).toBe(CREDENTIAL_MARKER);
      return new Response(null, { status: 200 });
    },
    inspectPostState: async () => ({
      activeAttemptCount: 0,
      customerCreatedCount: 0,
      sessionCreatedCount: 0,
      subscriptionCreatedCount: 0,
      productionOperations: 0,
      liveOperations: 0,
    }),
    ...overrides,
  };
}

function captureStreams() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: (value: string) => {
        stdout += value;
      },
      stderr: (value: string) => {
        stderr += value;
      },
    },
    output: () => ({ stdout, stderr }),
  };
}

function expectNoSensitiveOutput(...values: string[]) {
  for (const value of values) {
    for (const marker of SENSITIVE_MARKERS) {
      expect(value).not.toContain(marker);
    }
  }
}

test("credential stays in process memory and never reaches stdout or stderr", async () => {
  const capture = captureStreams();
  const exitCode = await runPrivacySafeCheckoutHarness(
    createDependencies(),
    capture.streams,
  );
  const output = capture.output();

  expect(exitCode).toBe(0);
  expect(output.stderr).toBe("");
  expectNoSensitiveOutput(output.stdout, output.stderr);
});

test("credential-bearing thrown errors are replaced before message, stack, or stderr", async () => {
  const dependencies = createDependencies({
    acquireSession: async () => {
      throw new Error(
        `${CREDENTIAL_MARKER}:${AUTHORIZATION_MARKER}:${EMAIL_MARKER}`,
      );
    },
  });

  await expect(executePrivacySafeCheckoutHarness(dependencies)).rejects.toEqual(
    expect.objectContaining({
      name: "PrivacySafeHarnessError",
      message: "HARNESS_AUTHENTICATION_FAILED",
    }),
  );
  try {
    await executePrivacySafeCheckoutHarness(dependencies);
  } catch (error) {
    expect(error).toBeInstanceOf(PrivacySafeHarnessError);
    const safeError = error as Error;
    expectNoSensitiveOutput(safeError.message, safeError.stack ?? "");
  }

  const capture = captureStreams();
  const exitCode = await runPrivacySafeCheckoutHarness(
    dependencies,
    capture.streams,
  );
  expect(exitCode).toBe(1);
  expect(capture.output().stdout).toBe("");
  expectNoSensitiveOutput(capture.output().stderr);
});

test("command arguments are rejected without inspecting or reporting credentials", async () => {
  let authenticated = false;
  const capture = captureStreams();
  const exitCode = await runPrivacySafeCheckoutHarness(
    createDependencies({
      argv: [`--cookie=${CREDENTIAL_MARKER}`],
      acquireSession: async () => {
        authenticated = true;
        return { cookieHeader: CREDENTIAL_MARKER };
      },
    }),
    capture.streams,
  );

  expect(exitCode).toBe(1);
  expect(authenticated).toBe(false);
  expect(capture.output().stdout).toBe("");
  expectNoSensitiveOutput(capture.output().stderr);
});

test("successful output contains only the fixed sanitized allowlist", async () => {
  const result = await executePrivacySafeCheckoutHarness(
    createDependencies({
      fetchImpl: async (_input: URL | RequestInfo, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("cookie")).toBe(
          CREDENTIAL_MARKER,
        );
        return new Response(
          JSON.stringify({
            email: EMAIL_MARKER,
            user_id: USER_ID_MARKER,
            customer: STRIPE_ID_MARKER,
          }),
          {
            status: 409,
            headers: {
              authorization: AUTHORIZATION_MARKER,
              "set-cookie": CREDENTIAL_MARKER,
            },
          },
        );
      },
    }),
  );

  expect(Object.keys(result).sort()).toEqual(RESULT_KEYS);
  expect(result).toMatchObject({
    authenticated: true,
    request_count: 2,
    status_class: "conflict",
    winner_count: 0,
    loser_count: 2,
  });
  expectNoSensitiveOutput(JSON.stringify(result));
});

test("HTTP errors never dump raw response bodies or headers", async () => {
  const capture = captureStreams();
  const exitCode = await runPrivacySafeCheckoutHarness(
    createDependencies({
      fetchImpl: async () =>
        new Response(
          `${CREDENTIAL_MARKER}:${EMAIL_MARKER}:${STRIPE_ID_MARKER}`,
          {
            status: 500,
            headers: {
              authorization: AUTHORIZATION_MARKER,
              "set-cookie": CREDENTIAL_MARKER,
            },
          },
        ),
    }),
    capture.streams,
  );

  expect(exitCode).toBe(1);
  expect(capture.output().stdout).toBe("");
  expectNoSensitiveOutput(capture.output().stderr);
  expect(capture.output().stderr).toContain(
    "HARNESS_CHECKOUT_RESPONSE_REJECTED",
  );
});
