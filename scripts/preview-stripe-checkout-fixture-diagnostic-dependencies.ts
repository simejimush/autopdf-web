import { createHash, timingSafeEqual } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { EXPECTED_PREVIEW_STRIPE_ACCOUNT_SHA256 } from "../src/lib/billing/controlledStripeEventCore.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as FixtureContract from "./preview-stripe-checkout-fixture-contract.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as Diagnostic from "./preview-stripe-checkout-fixture-diagnostic.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES } from "./preview-stripe-checkout-runtime.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as SupabasePreflight from "./preview-supabase-identity-preflight.ts";

const { effectiveFixturePlan, unknownFixtureObservation } = FixtureContract;
const { PreviewCheckoutFixtureDiagnosticError } = Diagnostic;
const {
  PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES,
  runPreviewSupabaseIdentityPreflight,
} = SupabasePreflight;
type FixtureCountClassification = FixtureContract.FixtureCountClassification;
type PreviewCheckoutFixtureObservation =
  FixtureContract.PreviewCheckoutFixtureObservation;
type PreviewCheckoutFixtureDiagnosticDependencies =
  Diagnostic.PreviewCheckoutFixtureDiagnosticDependencies;
type PreviewCheckoutAttemptsReadFailureClassification =
  FixtureContract.PreviewCheckoutAttemptsReadFailureClassification;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPABASE_AUTH_COOKIE_PATTERN = /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/;
const ACTIVE_ATTEMPT_STATUSES = [
  "creating",
  "customer_ready",
  "retryable_failed",
  "session_ready",
] as const;
const PROFILE_SELECT =
  "user_id, plan, billing_provider, billing_customer_id, billing_subscription_id, billing_status, current_period_end, cancel_at_period_end" as const;
const ATTEMPT_SELECT =
  "attempt_id, user_id, status, lease_hash, stripe_customer_id, stripe_session_id" as const;

type HarnessEnvironment = Readonly<Record<string, string | undefined>>;
type ProfileRow = Readonly<{
  user_id: string;
  plan: "free" | "pro" | "pro_plus" | null;
  billing_provider: string | null;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  billing_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}>;
type AttemptRow = Readonly<{
  attempt_id: string;
  user_id: string;
  status: (typeof ACTIVE_ATTEMPT_STATUSES)[number];
  lease_hash: string | null;
  stripe_customer_id: string | null;
  stripe_session_id: string | null;
}>;

export type PreviewCheckoutFixtureDiagnosticPorts = Readonly<{
  fetchImpl: typeof fetch;
  createAdminClient(url: string, serviceRoleKey: string): SupabaseClient;
  createStripe(secretKey: string): Stripe;
  expectedStripeAccountHash: string;
}>;

const DEFAULT_PORTS: PreviewCheckoutFixtureDiagnosticPorts = Object.freeze({
  fetchImpl: fetch,
  createAdminClient: (url, serviceRoleKey) =>
    createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  createStripe: (secretKey) => new Stripe(secretKey),
  expectedStripeAccountHash: EXPECTED_PREVIEW_STRIPE_ACCOUNT_SHA256,
});

function fail(
  code:
    | "FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED"
    | "FIXTURE_DIAGNOSTIC_PROFILE_READ_FAILED"
    | "FIXTURE_DIAGNOSTIC_ATTEMPTS_READ_FAILED"
    | "FIXTURE_DIAGNOSTIC_BOTH_DB_READS_FAILED"
    | "FIXTURE_DIAGNOSTIC_STRIPE_READ_FAILED",
  attemptsReadFailure?: PreviewCheckoutAttemptsReadFailureClassification,
): never {
  throw new PreviewCheckoutFixtureDiagnosticError(code, attemptsReadFailure);
}

function requiredEnvironment(environment: HarnessEnvironment, name: string) {
  const value = environment[name];
  if (!value) fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashesMatch(actual: string, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isProfileRow(value: unknown): value is ProfileRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.user_id === "string" &&
    UUID_PATTERN.test(row.user_id) &&
    (row.plan === null ||
      row.plan === "free" ||
      row.plan === "pro" ||
      row.plan === "pro_plus") &&
    isNullableString(row.billing_provider) &&
    isNullableString(row.billing_customer_id) &&
    isNullableString(row.billing_subscription_id) &&
    isNullableString(row.billing_status) &&
    isNullableString(row.current_period_end) &&
    (row.cancel_at_period_end === null ||
      typeof row.cancel_at_period_end === "boolean")
  );
}

function isAttemptRow(value: unknown, ownerId: string): value is AttemptRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.attempt_id === "string" &&
    UUID_PATTERN.test(row.attempt_id) &&
    row.user_id === ownerId &&
    ACTIVE_ATTEMPT_STATUSES.includes(row.status as never) &&
    isNullableString(row.lease_hash) &&
    isNullableString(row.stripe_customer_id) &&
    isNullableString(row.stripe_session_id)
  );
}

function countClassification(
  count: number,
  overflow = false,
): FixtureCountClassification {
  if (overflow) return "overflow";
  return count === 0 ? "zero" : "nonzero";
}

function parseCookieHeader(raw: string) {
  const entries = raw.split(";").map((segment) => {
    const separator = segment.indexOf("=");
    if (separator <= 0) fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
    return {
      name: segment.slice(0, separator).trim(),
      value: segment.slice(separator + 1).trim(),
    };
  });
  if (
    !entries.some(
      ({ name, value }) => SUPABASE_AUTH_COOKIE_PATTERN.test(name) && value,
    )
  ) {
    fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
  }
  return entries;
}

async function authenticate(input: {
  supabaseUrl: string;
  anonKey: string;
  cookieHeader: string;
  fetchImpl: typeof fetch;
}) {
  const cookies = new Map(
    parseCookieHeader(input.cookieHeader).map(({ name, value }) => [
      name,
      value,
    ]),
  );
  const client = createServerClient(input.supabaseUrl, input.anonKey, {
    global: { fetch: input.fetchImpl },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: () => undefined,
    },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || !UUID_PATTERN.test(user.id) || user.is_anonymous) {
    fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
  }
  return user.id;
}

type FixtureDbReadResult = Readonly<{
  error: unknown;
  status?: unknown;
}>;

const TRANSPORT_ATTEMPTS_READ_FAILURE = Object.freeze({
  failure_kind: "TRANSPORT",
  http_status_class: "UNKNOWN",
  provider_code_class: "UNKNOWN",
} as const satisfies PreviewCheckoutAttemptsReadFailureClassification);

const UNKNOWN_ATTEMPTS_READ_FAILURE = Object.freeze({
  failure_kind: "UNKNOWN",
  http_status_class: "UNKNOWN",
  provider_code_class: "UNKNOWN",
} as const satisfies PreviewCheckoutAttemptsReadFailureClassification);

function classifyHttpStatus(
  status: unknown,
): PreviewCheckoutAttemptsReadFailureClassification["http_status_class"] {
  if (typeof status !== "number" || !Number.isSafeInteger(status)) {
    return "UNKNOWN";
  }
  if (status >= 400 && status <= 499) return "4XX";
  if (status >= 500 && status <= 599) return "5XX";
  return "OTHER";
}

function classifyProviderCode(
  code: string,
): PreviewCheckoutAttemptsReadFailureClassification["provider_code_class"] {
  switch (code) {
    case "42703":
      return "POSTGRES_UNDEFINED_COLUMN";
    case "42P01":
      return "POSTGRES_UNDEFINED_TABLE";
    case "42501":
      return "POSTGRES_INSUFFICIENT_PRIVILEGE";
    case "PGRST204":
      return "POSTGREST_COLUMN_NOT_FOUND";
    case "PGRST205":
      return "POSTGREST_TABLE_NOT_FOUND";
    default:
      return "UNKNOWN";
  }
}

function classifyAttemptsResultFailure(
  result: FixtureDbReadResult,
): PreviewCheckoutAttemptsReadFailureClassification {
  if (result.status === 0) return TRANSPORT_ATTEMPTS_READ_FAILURE;
  try {
    if (
      !result.error ||
      typeof result.error !== "object" ||
      Array.isArray(result.error) ||
      !("code" in result.error) ||
      typeof result.error.code !== "string"
    ) {
      return UNKNOWN_ATTEMPTS_READ_FAILURE;
    }
    return Object.freeze({
      failure_kind: "POSTGREST",
      http_status_class: classifyHttpStatus(result.status),
      provider_code_class: classifyProviderCode(result.error.code),
    });
  } catch {
    return UNKNOWN_ATTEMPTS_READ_FAILURE;
  }
}

export async function resolveFixtureDiagnosticDbReads<
  TProfile extends FixtureDbReadResult,
  TAttempts extends FixtureDbReadResult,
>(input: {
  profileRead(): PromiseLike<TProfile>;
  attemptsRead(): PromiseLike<TAttempts>;
}): Promise<Readonly<{ profileResult: TProfile; attemptResult: TAttempts }>> {
  const [profileSettled, attemptsSettled] = await Promise.allSettled([
    Promise.resolve().then(input.profileRead),
    Promise.resolve().then(input.attemptsRead),
  ]);
  const profileRejected = profileSettled.status === "rejected";
  const attemptsRejected = attemptsSettled.status === "rejected";

  if (profileRejected && attemptsRejected) {
    fail(
      "FIXTURE_DIAGNOSTIC_BOTH_DB_READS_FAILED",
      TRANSPORT_ATTEMPTS_READ_FAILURE,
    );
  }
  if (profileRejected) fail("FIXTURE_DIAGNOSTIC_PROFILE_READ_FAILED");
  if (attemptsRejected) {
    fail(
      "FIXTURE_DIAGNOSTIC_ATTEMPTS_READ_FAILED",
      TRANSPORT_ATTEMPTS_READ_FAILURE,
    );
  }

  const profileResult = profileSettled.value;
  const attemptResult = attemptsSettled.value;
  const profileErrored = Boolean(profileResult.error);
  const attemptsErrored = Boolean(attemptResult.error);

  if (profileErrored && attemptsErrored) {
    fail(
      "FIXTURE_DIAGNOSTIC_BOTH_DB_READS_FAILED",
      classifyAttemptsResultFailure(attemptResult),
    );
  }
  if (profileErrored) fail("FIXTURE_DIAGNOSTIC_PROFILE_READ_FAILED");
  if (attemptsErrored) {
    fail(
      "FIXTURE_DIAGNOSTIC_ATTEMPTS_READ_FAILED",
      classifyAttemptsResultFailure(attemptResult),
    );
  }

  return Object.freeze({ profileResult, attemptResult });
}

async function inspectDb(input: { admin: SupabaseClient; ownerId: string }) {
  const { profileResult, attemptResult } =
    await resolveFixtureDiagnosticDbReads({
      profileRead: () => loadProfiles(input.admin, input.ownerId),
      attemptsRead: () => loadAttempts(input.admin, input.ownerId),
    });
  const profiles = Array.isArray(profileResult.data) ? profileResult.data : [];
  const attemptsArray = Array.isArray(attemptResult.data);
  const attempts: unknown[] = attemptsArray ? (attemptResult.data ?? []) : [];
  const profile =
    profiles.length === 1 &&
    isProfileRow(profiles[0]) &&
    profiles[0].user_id === input.ownerId
      ? profiles[0]
      : undefined;
  const attemptsValid =
    attemptsArray && attempts.every((row) => isAttemptRow(row, input.ownerId));
  return { profiles, profile, attempts, attemptsValid };
}

function loadProfiles(admin: SupabaseClient, ownerId: string) {
  return admin
    .from("user_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", ownerId)
    .limit(2);
}

function loadAttempts(admin: SupabaseClient, ownerId: string) {
  return admin
    .from("stripe_checkout_attempts")
    .select(ATTEMPT_SELECT)
    .eq("user_id", ownerId)
    .in("status", [...ACTIVE_ATTEMPT_STATUSES])
    .order("created_at", { ascending: false })
    .limit(2);
}

async function inspectStripe(input: {
  stripe: Stripe;
  ownerId: string;
  profile: ProfileRow;
  attempts: readonly AttemptRow[];
}) {
  const customerIds = new Set<string>();
  const sessionIds = new Set<string>();
  const subscriptionIds = new Set<string>();
  let activeOrTrialingCount = 0;
  let testModeOnly = true;
  let ownerMatch = true;
  let withinBound = true;
  let customerOverflow = false;
  let sessionOverflow = false;
  let subscriptionOverflow = false;

  try {
    const customers = await input.stripe.customers.search({
      query: `metadata['user_id']:'${input.ownerId}'`,
      limit: 10,
    });
    customerOverflow = customers.has_more;
    withinBound &&= !customers.has_more;
    for (const customer of customers.data) {
      testModeOnly &&= !customer.livemode;
      ownerMatch &&= customer.metadata.user_id === input.ownerId;
      customerIds.add(customer.id);
    }

    const customerCandidates = [
      input.profile.billing_customer_id,
      ...input.attempts.map((attempt) => attempt.stripe_customer_id),
    ].filter((value): value is string => Boolean(value));
    for (const candidate of customerCandidates) {
      if (customerIds.has(candidate)) continue;
      const customer = await input.stripe.customers.retrieve(candidate);
      if (customer.deleted) {
        ownerMatch = false;
        continue;
      }
      testModeOnly &&= !customer.livemode;
      ownerMatch &&= customer.metadata.user_id === input.ownerId;
      customerIds.add(customer.id);
    }

    for (const customerId of customerIds) {
      const [sessions, subscriptions] = await Promise.all([
        input.stripe.checkout.sessions.list({
          customer: customerId,
          limit: 10,
        }),
        input.stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 10,
        }),
      ]);
      sessionOverflow ||= sessions.has_more;
      subscriptionOverflow ||= subscriptions.has_more;
      withinBound &&= !sessions.has_more && !subscriptions.has_more;
      for (const session of sessions.data) {
        testModeOnly &&= !session.livemode;
        ownerMatch &&=
          session.client_reference_id === input.ownerId &&
          session.mode === "subscription";
        sessionIds.add(session.id);
      }
      for (const subscription of subscriptions.data) {
        testModeOnly &&= !subscription.livemode;
        ownerMatch &&= subscription.metadata.user_id === input.ownerId;
        subscriptionIds.add(subscription.id);
        if (
          subscription.status === "active" ||
          subscription.status === "trialing"
        ) {
          activeOrTrialingCount += 1;
        }
      }
    }

    for (const candidate of input.attempts
      .map((attempt) => attempt.stripe_session_id)
      .filter((value): value is string => Boolean(value))) {
      if (sessionIds.has(candidate)) continue;
      const session = await input.stripe.checkout.sessions.retrieve(candidate);
      testModeOnly &&= !session.livemode;
      ownerMatch &&=
        session.client_reference_id === input.ownerId &&
        session.mode === "subscription";
      sessionIds.add(session.id);
    }

    const subscriptionCandidate = input.profile.billing_subscription_id;
    if (subscriptionCandidate && !subscriptionIds.has(subscriptionCandidate)) {
      const subscription = await input.stripe.subscriptions.retrieve(
        subscriptionCandidate,
      );
      testModeOnly &&= !subscription.livemode;
      ownerMatch &&= subscription.metadata.user_id === input.ownerId;
      subscriptionIds.add(subscription.id);
      if (
        subscription.status === "active" ||
        subscription.status === "trialing"
      ) {
        activeOrTrialingCount += 1;
      }
    }
  } catch {
    fail("FIXTURE_DIAGNOSTIC_STRIPE_READ_FAILED");
  }

  return {
    customerCount: countClassification(customerIds.size, customerOverflow),
    checkoutSessionCount: countClassification(sessionIds.size, sessionOverflow),
    subscriptionCount: countClassification(
      subscriptionIds.size,
      subscriptionOverflow,
    ),
    activeOrTrialingSubscriptionCount: countClassification(
      activeOrTrialingCount,
      subscriptionOverflow,
    ),
    stripeObjectsTestModeOnly:
      withinBound || !testModeOnly ? testModeOnly : "unknown",
    stripeOwnerMatch: withinBound || !ownerMatch ? ownerMatch : "unknown",
    stripeListWithinBound: withinBound,
  } as const;
}

export function createRealPreviewCheckoutFixtureDiagnosticDependencies(
  ports: PreviewCheckoutFixtureDiagnosticPorts = DEFAULT_PORTS,
): PreviewCheckoutFixtureDiagnosticDependencies {
  return Object.freeze({
    async inspect({ environment }): Promise<PreviewCheckoutFixtureObservation> {
      try {
        await runPreviewSupabaseIdentityPreflight(environment, ports.fetchImpl);
      } catch {
        fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
      }

      const supabaseUrl = requiredEnvironment(
        environment,
        PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.supabaseUrl,
      );
      const anonKey = requiredEnvironment(
        environment,
        PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.anonKey,
      );
      const serviceRoleKey = requiredEnvironment(
        environment,
        PREVIEW_HARNESS_PREFLIGHT_CREDENTIAL_ENV_NAMES.serviceRoleKey,
      );
      const authCookie = requiredEnvironment(
        environment,
        PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.authCookie,
      );
      const expectedOwnerHash = requiredEnvironment(
        environment,
        PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.expectedOwnerHash,
      );
      const stripeSecretKey = requiredEnvironment(
        environment,
        PREVIEW_CHECKOUT_RUNTIME_ENV_NAMES.stripeSecretKey,
      );
      if (!stripeSecretKey.startsWith("sk_test_")) {
        fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
      }

      let ownerId: string;
      let stripe: Stripe;
      try {
        ownerId = await authenticate({
          supabaseUrl,
          anonKey,
          cookieHeader: authCookie,
          fetchImpl: ports.fetchImpl,
        });
        if (!hashesMatch(sha256(ownerId), expectedOwnerHash)) {
          fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
        }
        stripe = ports.createStripe(stripeSecretKey);
        const account = await stripe.accounts.retrieve();
        if (
          !account.id ||
          !hashesMatch(sha256(account.id), ports.expectedStripeAccountHash)
        ) {
          fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
        }
      } catch (error) {
        if (error instanceof PreviewCheckoutFixtureDiagnosticError) throw error;
        fail("FIXTURE_DIAGNOSTIC_PREFLIGHT_FAILED");
      }

      const admin = ports.createAdminClient(supabaseUrl, serviceRoleKey);
      const db = await inspectDb({ admin, ownerId });
      const profileValid = Boolean(db.profile);
      const attemptsValid = db.attemptsValid;
      const baseObservation = unknownFixtureObservation({
        dbReadSucceeded: true,
        ownerProfileUniqueAndValid: profileValid,
        effectivePlanFree: db.profile
          ? effectiveFixturePlan(db.profile) === "free"
          : "unknown",
        billingStatusNone: db.profile
          ? db.profile.billing_status === null
          : "unknown",
        paidEffectiveFalse: db.profile
          ? effectiveFixturePlan(db.profile) === "free"
          : "unknown",
        activeCheckoutAttemptCount: attemptsValid
          ? countClassification(db.attempts.length)
          : "unknown",
      });
      if (!db.profile || !attemptsValid) return baseObservation;

      let stripeObservation: Awaited<ReturnType<typeof inspectStripe>>;
      try {
        stripeObservation = await inspectStripe({
          stripe,
          ownerId,
          profile: db.profile,
          attempts: db.attempts as AttemptRow[],
        });
      } catch (error) {
        if (
          error instanceof PreviewCheckoutFixtureDiagnosticError &&
          error.code === "FIXTURE_DIAGNOSTIC_STRIPE_READ_FAILED"
        ) {
          return Object.freeze({
            ...baseObservation,
            stripeReadSucceeded: false,
          });
        }
        throw error;
      }
      return Object.freeze({
        ...baseObservation,
        stripeReadSucceeded: true,
        ...stripeObservation,
      });
    },
  });
}
