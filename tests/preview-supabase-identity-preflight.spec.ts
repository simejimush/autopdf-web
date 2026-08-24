import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { PREVIEW_HARNESS_PROCESS_ENV_NAMES } from "../scripts/preview-stripe-checkout-privacy-adapter";
import {
  PREVIEW_HARNESS_EXPECTED_IDENTITY_ENV_NAME,
  PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES,
  PreviewSupabaseIdentityPreflightError,
  runPreviewSupabaseIdentityPreflight,
  runPreviewSupabaseIdentityPreflightCli,
} from "../scripts/preview-supabase-identity-preflight";

const PREVIEW_ORIGIN = "https://synthetic-preview.supabase.co";
const PRODUCTION_ORIGIN = "https://synthetic-production.supabase.co";
const DEVELOPMENT_ORIGIN = "https://synthetic-development.supabase.co";
const ANON_KEY = syntheticLegacyKey("anon", "synthetic-anon-material");
const SERVICE_ROLE_KEY = syntheticLegacyKey(
  "service_role",
  "synthetic-service-material",
);
const SENSITIVE_MARKERS = [
  PREVIEW_ORIGIN,
  PRODUCTION_ORIGIN,
  DEVELOPMENT_ORIGIN,
  ANON_KEY,
  SERVICE_ROLE_KEY,
  originHash(PREVIEW_ORIGIN),
];

function base64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function syntheticLegacyKey(role: string, signature: string) {
  return `${base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({ role }),
  )}.${base64Url(signature)}`;
}

function originHash(origin: string) {
  return createHash("sha256").update(origin, "utf8").digest("hex");
}

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    [PREVIEW_HARNESS_EXPECTED_IDENTITY_ENV_NAME]: originHash(PREVIEW_ORIGIN),
    [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.supabaseUrl]:
      PREVIEW_ORIGIN,
    [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.anonKey]: ANON_KEY,
    [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.serviceRoleKey]:
      SERVICE_ROLE_KEY,
    ...overrides,
  };
}

function credentialFetch(statuses: number[] = [200, 200]) {
  const calls: Array<Readonly<{ url: URL; init?: RequestInit }>> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    calls.push({ url, init });
    return new Response("synthetic-provider-body-must-not-be-reported", {
      status: statuses[calls.length - 1] ?? 500,
    });
  };
  return { calls, fetchImpl };
}

async function expectSafeFailure(input: {
  env: Record<string, string | undefined>;
  code: string;
  expectedNetworkCalls?: number;
}) {
  const network = credentialFetch();
  let caught: unknown;
  try {
    await runPreviewSupabaseIdentityPreflight(input.env, network.fetchImpl);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PreviewSupabaseIdentityPreflightError);
  expect(caught).toMatchObject({ code: input.code });
  const safeError = caught as Error;
  for (const marker of SENSITIVE_MARKERS) {
    expect(safeError.message).not.toContain(marker);
    expect(safeError.stack ?? "").not.toContain(marker);
  }
  expect(network.calls).toHaveLength(input.expectedNetworkCalls ?? 0);
}

test("preflight credential env names exactly match the runtime adapter", () => {
  expect(PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES).toEqual(
    PREVIEW_HARNESS_PROCESS_ENV_NAMES,
  );
});

test("valid synthetic Preview credentials pass with two metadata reads", async () => {
  const network = credentialFetch();
  const result = await runPreviewSupabaseIdentityPreflight(
    environment(),
    network.fetchImpl,
  );

  expect(result).toEqual({
    verdict: "READY_FOR_PREVIEW_HARNESS_CREDENTIALS",
    required_env_present: true,
    expected_origin_match: true,
    anon_credential_valid: true,
    service_role_credential_valid: true,
    credential_set_consistent: true,
    production_identity: false,
    development_identity: false,
    credential_read_operations: 2,
    external_write_operations: 0,
    database_write_operations: 0,
    stripe_operations: 0,
    auth_session_operations: 0,
    fixture_operations: 0,
    privacy_exposure_count: 0,
  });
  expect(network.calls).toHaveLength(2);
  for (const call of network.calls) {
    expect(call.url.origin).toBe(PREVIEW_ORIGIN);
    expect(call.url.pathname).toBe("/auth/v1/settings");
    expect(call.init?.method).toBe("GET");
    expect(call.init?.redirect).toBe("error");
    const headers = new Headers(call.init?.headers);
    expect(headers.has("apikey")).toBe(true);
    expect(headers.has("authorization")).toBe(false);
  }
  const serialized = JSON.stringify(result);
  for (const marker of SENSITIVE_MARKERS) {
    expect(serialized).not.toContain(marker);
  }
});

for (const missing of [
  PREVIEW_HARNESS_EXPECTED_IDENTITY_ENV_NAME,
  PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.supabaseUrl,
  PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.anonKey,
  PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.serviceRoleKey,
]) {
  test(`missing ${missing} fails before network access`, async () => {
    await expectSafeFailure({
      env: environment({ [missing]: undefined }),
      code: "PREFLIGHT_REQUIRED_ENV_MISSING",
    });
  });
}

for (const [caseName, malformedHash] of [
  ["empty", ""],
  ["short", "0".repeat(63)],
  ["long", "0".repeat(65)],
  ["uppercase", "G".repeat(64)],
  ["leading whitespace", ` ${"0".repeat(64)}`],
  ["trailing whitespace", `${"0".repeat(64)}\n`],
] as const) {
  test(`malformed expected hash (${caseName}) fails before network access`, async () => {
    await expectSafeFailure({
      env: environment({
        [PREVIEW_HARNESS_EXPECTED_IDENTITY_ENV_NAME]: malformedHash,
      }),
      code:
        malformedHash.length === 0
          ? "PREFLIGHT_REQUIRED_ENV_MISSING"
          : "PREFLIGHT_EXPECTED_HASH_INVALID",
    });
  });
}

test("URL hash mismatch fails before credential network verification", async () => {
  await expectSafeFailure({
    env: environment({
      [PREVIEW_HARNESS_EXPECTED_IDENTITY_ENV_NAME]: "0".repeat(64),
    }),
    code: "PREFLIGHT_EXPECTED_ORIGIN_MISMATCH",
  });
});

for (const [caseName, invalidUrl] of [
  ["http", "http://synthetic-preview.supabase.co"],
  ["path", `${PREVIEW_ORIGIN}/rest/v1`],
  ["query", `${PREVIEW_ORIGIN}?unsafe=true`],
  ["userinfo", "https://user@synthetic-preview.supabase.co"],
] as const) {
  test(`unsafe Supabase URL (${caseName}) fails before network access`, async () => {
    await expectSafeFailure({
      env: environment({
        [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.supabaseUrl]:
          invalidUrl,
      }),
      code: "PREFLIGHT_SUPABASE_URL_INVALID",
    });
  });
}

test("credentials cannot override an origin hash mismatch", async () => {
  await expectSafeFailure({
    env: environment({
      [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.anonKey]:
        "sb_publishable_x",
      [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.serviceRoleKey]:
        "sb_secret_x",
      [PREVIEW_HARNESS_EXPECTED_IDENTITY_ENV_NAME]: "f".repeat(64),
    }),
    code: "PREFLIGHT_EXPECTED_ORIGIN_MISMATCH",
  });
});

test("invalid or wrong-kind anon credential fails safely", async () => {
  for (const anonKey of ["invalid-anon", SERVICE_ROLE_KEY]) {
    await expectSafeFailure({
      env: environment({
        [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.anonKey]: anonKey,
      }),
      code: "PREFLIGHT_ANON_CREDENTIAL_INVALID",
    });
  }
});

test("invalid anon response stops before service credential verification", async () => {
  const network = credentialFetch([401]);
  await expect(
    runPreviewSupabaseIdentityPreflight(environment(), network.fetchImpl),
  ).rejects.toMatchObject({ code: "PREFLIGHT_ANON_CREDENTIAL_INVALID" });
  expect(network.calls).toHaveLength(1);
});

test("invalid or wrong-kind service credential fails safely", async () => {
  for (const serviceRoleKey of ["invalid-service", ANON_KEY]) {
    await expectSafeFailure({
      env: environment({
        [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.serviceRoleKey]:
          serviceRoleKey,
      }),
      code: "PREFLIGHT_SERVICE_ROLE_CREDENTIAL_INVALID",
      expectedNetworkCalls: 1,
    });
  }
});

test("invalid service response fails after exactly two metadata reads", async () => {
  const network = credentialFetch([200, 401]);
  await expect(
    runPreviewSupabaseIdentityPreflight(environment(), network.fetchImpl),
  ).rejects.toMatchObject({
    code: "PREFLIGHT_SERVICE_ROLE_CREDENTIAL_INVALID",
  });
  expect(network.calls).toHaveLength(2);
});

for (const [identity, origin] of [
  ["Production", PRODUCTION_ORIGIN],
  ["Development", DEVELOPMENT_ORIGIN],
] as const) {
  test(`${identity} origin is rejected by the independent Preview trust root`, async () => {
    await expectSafeFailure({
      env: environment({
        [PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.supabaseUrl]: origin,
      }),
      code: "PREFLIGHT_EXPECTED_ORIGIN_MISMATCH",
    });
  });
}

test("normal Development env names are never a fallback", async () => {
  await expectSafeFailure({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: PREVIEW_ORIGIN,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    },
    code: "PREFLIGHT_REQUIRED_ENV_MISSING",
  });
});

test("CLI output is sanitized on success", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const network = credentialFetch();
  const exitCode = await runPreviewSupabaseIdentityPreflightCli({
    environment: environment(),
    argv: [],
    fetchImpl: network.fetchImpl,
    stdout: {
      write: (value: unknown) => stdout.push(String(value)),
    } as never,
    stderr: {
      write: (value: unknown) => stderr.push(String(value)),
    } as never,
  });

  expect(exitCode).toBe(0);
  expect(stderr).toEqual([]);
  expect(stdout).toHaveLength(1);
  for (const marker of SENSITIVE_MARKERS) {
    expect(stdout.join("")).not.toContain(marker);
  }
});

test("CLI rejects arguments without echoing them or making requests", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const network = credentialFetch();
  const argumentMarker = "synthetic-command-line-secret";
  const exitCode = await runPreviewSupabaseIdentityPreflightCli({
    environment: environment(),
    argv: [argumentMarker],
    fetchImpl: network.fetchImpl,
    stdout: {
      write: (value: unknown) => stdout.push(String(value)),
    } as never,
    stderr: {
      write: (value: unknown) => stderr.push(String(value)),
    } as never,
  });

  expect(exitCode).toBe(1);
  expect(stdout).toEqual([]);
  expect(network.calls).toEqual([]);
  expect(stderr.join("")).toContain("PREFLIGHT_ARGUMENT_FORBIDDEN");
  expect(stderr.join("")).not.toContain(argumentMarker);
  for (const marker of SENSITIVE_MARKERS) {
    expect(stderr.join("")).not.toContain(marker);
  }
});

test("provider response and exception details never reach CLI stderr", async () => {
  for (const fetchImpl of [
    async () =>
      new Response(`${PREVIEW_ORIGIN}:${ANON_KEY}:${SERVICE_ROLE_KEY}`, {
        status: 401,
      }),
    async () => {
      throw new Error(`${PREVIEW_ORIGIN}:${ANON_KEY}:${SERVICE_ROLE_KEY}`);
    },
  ] as (typeof fetch)[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runPreviewSupabaseIdentityPreflightCli({
      environment: environment(),
      argv: [],
      fetchImpl,
      stdout: {
        write: (value: unknown) => stdout.push(String(value)),
      } as never,
      stderr: {
        write: (value: unknown) => stderr.push(String(value)),
      } as never,
    });
    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    for (const marker of SENSITIVE_MARKERS) {
      expect(stderr.join("")).not.toContain(marker);
    }
  }
});
