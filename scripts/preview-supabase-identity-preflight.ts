import { createHash, timingSafeEqual } from "node:crypto";

export const PREVIEW_HARNESS_EXPECTED_IDENTITY_ENV_NAME =
  "AUTOPDF_PREVIEW_HARNESS_EXPECTED_SUPABASE_ORIGIN_SHA256";

export const PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES = Object.freeze({
  supabaseUrl: "AUTOPDF_PREVIEW_HARNESS_SUPABASE_URL",
  anonKey: "AUTOPDF_PREVIEW_HARNESS_SUPABASE_ANON_KEY",
  serviceRoleKey: "AUTOPDF_PREVIEW_HARNESS_SUPABASE_SERVICE_ROLE_KEY",
} as const);

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]+$/;
const SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]+$/;
const CREDENTIAL_CHECK_PATH = "/auth/v1/settings";

type HarnessEnvironment = Readonly<Record<string, string | undefined>>;
type CredentialKind = "anon" | "service_role";
type SafeFetch = typeof fetch;

type PreviewHarnessCredentialSet = Readonly<{
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}>;

type PreviewHarnessIdentityResult = Readonly<{
  urlMatchesExpectedPreview: boolean;
  anonKeyMatchesExpectedPreview: boolean;
  serviceRoleKeyMatchesExpectedPreview: boolean;
  productionIdentity: boolean;
}>;

type PreflightErrorCode =
  | "PREFLIGHT_ARGUMENT_FORBIDDEN"
  | "PREFLIGHT_REQUIRED_ENV_MISSING"
  | "PREFLIGHT_EXPECTED_HASH_INVALID"
  | "PREFLIGHT_SUPABASE_URL_INVALID"
  | "PREFLIGHT_EXPECTED_ORIGIN_MISMATCH"
  | "PREFLIGHT_ANON_CREDENTIAL_INVALID"
  | "PREFLIGHT_SERVICE_ROLE_CREDENTIAL_INVALID";

export type PreviewSupabaseIdentityPreflightResult = Readonly<{
  verdict: "READY_FOR_PREVIEW_HARNESS_CREDENTIALS";
  required_env_present: true;
  expected_origin_match: true;
  anon_credential_valid: true;
  service_role_credential_valid: true;
  credential_set_consistent: true;
  production_identity: false;
  development_identity: false;
  credential_read_operations: 2;
  external_write_operations: 0;
  database_write_operations: 0;
  stripe_operations: 0;
  auth_session_operations: 0;
  fixture_operations: 0;
  privacy_exposure_count: 0;
}>;

export class PreviewSupabaseIdentityPreflightError extends Error {
  readonly code: PreflightErrorCode;

  constructor(code: PreflightErrorCode) {
    super(code);
    this.name = "PreviewSupabaseIdentityPreflightError";
    this.code = code;
  }
}

function fail(code: PreflightErrorCode): never {
  throw new PreviewSupabaseIdentityPreflightError(code);
}

function requiredEnvironment(environment: HarnessEnvironment, name: string) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    fail("PREFLIGHT_REQUIRED_ENV_MISSING");
  }
  return value;
}

function normalizeSupabaseOrigin(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    fail("PREFLIGHT_SUPABASE_URL_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    fail("PREFLIGHT_SUPABASE_URL_INVALID");
  }
  return parsed.origin;
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashesMatch(calculatedHash: string, expectedHash: string) {
  return timingSafeEqual(
    Buffer.from(calculatedHash, "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}

function legacyJwtRole(value: string) {
  const segments = value.split(".");
  if (segments.length !== 3) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as unknown;
    if (
      typeof payload === "object" &&
      payload !== null &&
      "role" in payload &&
      typeof payload.role === "string"
    ) {
      return payload.role;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function credentialHasExpectedKind(value: string, kind: CredentialKind) {
  if (kind === "anon" && PUBLISHABLE_KEY_PATTERN.test(value)) return true;
  if (kind === "service_role" && SECRET_KEY_PATTERN.test(value)) return true;
  return legacyJwtRole(value) === kind;
}

async function credentialIsValidForOrigin(input: {
  origin: string;
  credential: string;
  kind: CredentialKind;
  fetchImpl: SafeFetch;
}) {
  if (!credentialHasExpectedKind(input.credential, input.kind)) return false;

  try {
    const response = await input.fetchImpl(
      new URL(CREDENTIAL_CHECK_PATH, input.origin),
      {
        method: "GET",
        headers: { apikey: input.credential },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

function loadConfig(environment: HarnessEnvironment) {
  const expectedHash = requiredEnvironment(
    environment,
    PREVIEW_HARNESS_EXPECTED_IDENTITY_ENV_NAME,
  );
  const credentials: PreviewHarnessCredentialSet = Object.freeze({
    supabaseUrl: requiredEnvironment(
      environment,
      PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.supabaseUrl,
    ),
    anonKey: requiredEnvironment(
      environment,
      PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.anonKey,
    ),
    serviceRoleKey: requiredEnvironment(
      environment,
      PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.serviceRoleKey,
    ),
  });
  if (!SHA256_HEX_PATTERN.test(expectedHash)) {
    fail("PREFLIGHT_EXPECTED_HASH_INVALID");
  }
  return { expectedHash, credentials };
}

export async function verifyPreviewSupabaseCredentialIdentity(input: {
  expectedOriginHash: string;
  credentials: PreviewHarnessCredentialSet;
  fetchImpl?: SafeFetch;
}): Promise<PreviewHarnessIdentityResult> {
  if (!SHA256_HEX_PATTERN.test(input.expectedOriginHash)) {
    fail("PREFLIGHT_EXPECTED_HASH_INVALID");
  }

  const origin = normalizeSupabaseOrigin(input.credentials.supabaseUrl);
  if (!hashesMatch(sha256Hex(origin), input.expectedOriginHash)) {
    fail("PREFLIGHT_EXPECTED_ORIGIN_MISMATCH");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const anonValid = await credentialIsValidForOrigin({
    origin,
    credential: input.credentials.anonKey,
    kind: "anon",
    fetchImpl,
  });
  if (!anonValid) fail("PREFLIGHT_ANON_CREDENTIAL_INVALID");

  const serviceRoleValid = await credentialIsValidForOrigin({
    origin,
    credential: input.credentials.serviceRoleKey,
    kind: "service_role",
    fetchImpl,
  });
  if (!serviceRoleValid) fail("PREFLIGHT_SERVICE_ROLE_CREDENTIAL_INVALID");

  return Object.freeze({
    urlMatchesExpectedPreview: true,
    anonKeyMatchesExpectedPreview: true,
    serviceRoleKeyMatchesExpectedPreview: true,
    productionIdentity: false,
  });
}

export async function runPreviewSupabaseIdentityPreflight(
  environment: HarnessEnvironment,
  fetchImpl: SafeFetch = fetch,
): Promise<PreviewSupabaseIdentityPreflightResult> {
  const config = loadConfig(environment);
  await verifyPreviewSupabaseCredentialIdentity({
    expectedOriginHash: config.expectedHash,
    credentials: config.credentials,
    fetchImpl,
  });

  return Object.freeze({
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
}

export async function runPreviewSupabaseIdentityPreflightCli(input: {
  environment: HarnessEnvironment;
  argv: readonly string[];
  fetchImpl?: SafeFetch;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}) {
  try {
    if (input.argv.length !== 0) fail("PREFLIGHT_ARGUMENT_FORBIDDEN");
    const result = await runPreviewSupabaseIdentityPreflight(
      input.environment,
      input.fetchImpl,
    );
    input.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const errorCode =
      error instanceof PreviewSupabaseIdentityPreflightError
        ? error.code
        : "PREFLIGHT_UNEXPECTED_ERROR";
    input.stderr.write(
      `${JSON.stringify({ verdict: "BLOCKED", error_code: errorCode })}\n`,
    );
    return 1;
  }
}
