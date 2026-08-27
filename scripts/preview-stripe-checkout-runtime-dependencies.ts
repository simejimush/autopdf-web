import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import Stripe from "stripe";

// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import { EXPECTED_PREVIEW_STRIPE_ACCOUNT_SHA256 } from "../src/lib/billing/controlledStripeEventCore.ts";

// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as PrivacyAdapter from "./preview-stripe-checkout-privacy-adapter.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as FixtureContract from "./preview-stripe-checkout-fixture-contract.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as Runtime from "./preview-stripe-checkout-runtime.ts";
// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as SupabasePreflight from "./preview-supabase-identity-preflight.ts";

const { createPreviewCheckoutHarnessAdapter } = PrivacyAdapter;
const { effectiveFixturePlan, fixtureBillingStatus } = FixtureContract;
const {
  PreviewSupabaseIdentityPreflightError,
  runPreviewSupabaseIdentityPreflight,
} = SupabasePreflight;
type PreviewHarnessArtifactHandle = PrivacyAdapter.PreviewHarnessArtifactHandle;
type PreviewHarnessFixtureRow = PrivacyAdapter.PreviewHarnessFixtureRow;
type PreviewHarnessOwnerHandle = PrivacyAdapter.PreviewHarnessOwnerHandle;
type PreviewCheckoutRuntimeBaseline = Runtime.PreviewCheckoutRuntimeBaseline;
type PreviewCheckoutRuntimeDependencies =
  Runtime.PreviewCheckoutRuntimeDependencies;
type PreviewCheckoutRuntimePreflightStageCode =
  Runtime.PreviewCheckoutRuntimePreflightStageCode;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
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

type CookieEntry = Readonly<{ name: string; value: string }>;

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

type StripeSnapshot = Readonly<{
  customerIds: ReadonlySet<string>;
  sessionIds: ReadonlySet<string>;
  subscriptionIds: ReadonlySet<string>;
  activeOrTrialingSubscriptionCount: number;
}>;

type FixtureState = Readonly<{
  profile: ProfileRow;
  attempts: readonly AttemptRow[];
  stripe: StripeSnapshot;
}>;

export type PreviewCheckoutRuntimePorts = Readonly<{
  fetchImpl: typeof fetch;
  expectedStripeAccountHash: string;
  createStripe(secretKey: string): Stripe;
  createAdminClient(url: string, serviceRoleKey: string): SupabaseClient;
  authenticate(input: {
    url: string;
    anonKey: string;
    cookieHeader: string;
    fetchImpl: typeof fetch;
  }): Promise<
    Readonly<{ user: User; cookieHeader: string; protectionCookie: string }>
  >;
}>;

class RealRuntimeDependencyError extends Error {
  constructor() {
    super("REAL_RUNTIME_DEPENDENCY_FAILED");
    this.name = "RealRuntimeDependencyError";
  }
}

function fail(): never {
  throw new RealRuntimeDependencyError();
}

function failPreflightStage(
  stageCode: PreviewCheckoutRuntimePreflightStageCode,
): never {
  throw new Runtime.PreviewCheckoutRuntimePreflightStageError(stageCode);
}

async function runPreflightStage<T>(
  stageCode: PreviewCheckoutRuntimePreflightStageCode,
  operation: () => T | Promise<T>,
) {
  try {
    return await operation();
  } catch {
    failPreflightStage(stageCode);
  }
}

function supabasePreflightStageCode(error: unknown) {
  if (!(error instanceof PreviewSupabaseIdentityPreflightError)) {
    return "PREFLIGHT_SUPABASE_CONFIGURATION_FAILED" as const;
  }
  if (error.code === "PREFLIGHT_ANON_CREDENTIAL_INVALID") {
    return "PREFLIGHT_SUPABASE_ANON_CREDENTIAL_FAILED" as const;
  }
  if (error.code === "PREFLIGHT_SERVICE_ROLE_CREDENTIAL_INVALID") {
    return "PREFLIGHT_SUPABASE_SERVICE_ROLE_CREDENTIAL_FAILED" as const;
  }
  if (
    error.code === "PREFLIGHT_EXPECTED_HASH_INVALID" ||
    error.code === "PREFLIGHT_SUPABASE_URL_INVALID" ||
    error.code === "PREFLIGHT_EXPECTED_ORIGIN_MISMATCH"
  ) {
    return "PREFLIGHT_SUPABASE_ORIGIN_TRUST_ROOT_FAILED" as const;
  }
  return "PREFLIGHT_SUPABASE_CONFIGURATION_FAILED" as const;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeHashMatch(calculated: string, expected: string) {
  return timingSafeEqual(
    Buffer.from(calculated, "hex"),
    Buffer.from(expected, "hex"),
  );
}

function parseCookieHeader(value: string) {
  const entries: CookieEntry[] = [];
  const names = new Set<string>();
  for (const segment of value.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) fail();
    const name = segment.slice(0, separator).trim();
    const cookieValue = segment.slice(separator + 1).trim();
    if (
      !COOKIE_NAME_PATTERN.test(name) ||
      cookieValue.length === 0 ||
      /[\r\n\0;]/.test(cookieValue) ||
      names.has(name)
    ) {
      fail();
    }
    names.add(name);
    entries.push({ name, value: cookieValue });
  }
  if (!entries.some((entry) => SUPABASE_AUTH_COOKIE_PATTERN.test(entry.name))) {
    fail();
  }
  return entries;
}

function serializeCookies(entries: readonly CookieEntry[]) {
  return entries.map(({ name, value }) => `${name}=${value}`).join("; ");
}

async function authenticateCookieSession(input: {
  url: string;
  anonKey: string;
  cookieHeader: string;
  fetchImpl: typeof fetch;
}) {
  const cookieMap = new Map(
    parseCookieHeader(input.cookieHeader).map((entry) => [
      entry.name,
      entry.value,
    ]),
  );
  const client = createServerClient(input.url, input.anonKey, {
    global: { fetch: input.fetchImpl },
    cookies: {
      getAll() {
        return [...cookieMap].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          if (cookie.value) cookieMap.set(cookie.name, cookie.value);
          else cookieMap.delete(cookie.name);
        }
      },
    },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || !UUID_PATTERN.test(user.id) || user.is_anonymous)
    fail();

  const entries = [...cookieMap].map(([name, value]) => ({ name, value }));
  const protectionEntries = entries.filter(
    (entry) => !SUPABASE_AUTH_COOKIE_PATTERN.test(entry.name),
  );
  return Object.freeze({
    user,
    cookieHeader: serializeCookies(entries),
    protectionCookie: serializeCookies(protectionEntries),
  });
}

const DEFAULT_PORTS: PreviewCheckoutRuntimePorts = Object.freeze({
  fetchImpl: fetch,
  expectedStripeAccountHash: EXPECTED_PREVIEW_STRIPE_ACCOUNT_SHA256,
  createStripe: (secretKey) => new Stripe(secretKey),
  createAdminClient: (url, serviceRoleKey) =>
    createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }),
  authenticate: authenticateCookieSession,
});

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

async function loadProfile(admin: SupabaseClient, ownerId: string) {
  const { data, error } = await admin
    .from("user_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", ownerId)
    .limit(2);
  if (
    error ||
    !Array.isArray(data) ||
    data.length !== 1 ||
    !isProfileRow(data[0])
  ) {
    fail();
  }
  if (data[0].user_id !== ownerId) fail();
  return data[0];
}

async function loadActiveAttempts(admin: SupabaseClient, ownerId: string) {
  const { data, error } = await admin
    .from("stripe_checkout_attempts")
    .select(ATTEMPT_SELECT)
    .eq("user_id", ownerId)
    .in("status", [...ACTIVE_ATTEMPT_STATUSES])
    .order("created_at", { ascending: false })
    .limit(2);
  if (
    error ||
    !Array.isArray(data) ||
    data.length > 1 ||
    !data.every((row) => isAttemptRow(row, ownerId))
  ) {
    fail();
  }
  return data as unknown as AttemptRow[];
}

function assertCustomer(customer: Stripe.Customer, ownerId: string) {
  if (customer.livemode || customer.metadata.user_id !== ownerId) fail();
}

function assertSession(session: Stripe.Checkout.Session, ownerId: string) {
  if (
    session.livemode ||
    session.client_reference_id !== ownerId ||
    session.mode !== "subscription"
  ) {
    fail();
  }
}

function assertSubscription(
  subscription: Stripe.Subscription,
  ownerId: string,
) {
  if (subscription.livemode || subscription.metadata.user_id !== ownerId)
    fail();
}

async function inspectStripe(input: {
  stripe: Stripe;
  ownerId: string;
  customerCandidates: readonly string[];
  sessionCandidates: readonly string[];
  subscriptionCandidates: readonly string[];
}) {
  const customerIds = new Set<string>();
  const sessionIds = new Set<string>();
  const subscriptionIds = new Set<string>();
  let activeOrTrialingSubscriptionCount = 0;

  const customers = await input.stripe.customers.search({
    query: `metadata['user_id']:'${input.ownerId}'`,
    limit: 10,
  });
  if (customers.has_more) fail();
  for (const customer of customers.data) {
    assertCustomer(customer, input.ownerId);
    customerIds.add(customer.id);
  }

  for (const candidate of input.customerCandidates.filter(Boolean)) {
    if (customerIds.has(candidate)) continue;
    const customer = await input.stripe.customers.retrieve(candidate);
    if (customer.deleted) fail();
    assertCustomer(customer, input.ownerId);
    customerIds.add(customer.id);
  }

  for (const customerId of customerIds) {
    const [sessions, subscriptions] = await Promise.all([
      input.stripe.checkout.sessions.list({ customer: customerId, limit: 10 }),
      input.stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
      }),
    ]);
    if (sessions.has_more || subscriptions.has_more) fail();
    for (const session of sessions.data) {
      assertSession(session, input.ownerId);
      sessionIds.add(session.id);
    }
    for (const subscription of subscriptions.data) {
      assertSubscription(subscription, input.ownerId);
      subscriptionIds.add(subscription.id);
      if (
        subscription.status === "active" ||
        subscription.status === "trialing"
      ) {
        activeOrTrialingSubscriptionCount += 1;
      }
    }
  }

  for (const candidate of input.sessionCandidates.filter(Boolean)) {
    if (sessionIds.has(candidate)) continue;
    const session = await input.stripe.checkout.sessions.retrieve(candidate);
    assertSession(session, input.ownerId);
    sessionIds.add(session.id);
  }

  for (const candidate of input.subscriptionCandidates.filter(Boolean)) {
    if (subscriptionIds.has(candidate)) continue;
    const subscription = await input.stripe.subscriptions.retrieve(candidate);
    assertSubscription(subscription, input.ownerId);
    subscriptionIds.add(subscription.id);
    if (
      subscription.status === "active" ||
      subscription.status === "trialing"
    ) {
      activeOrTrialingSubscriptionCount += 1;
    }
  }

  return Object.freeze({
    customerIds,
    sessionIds,
    subscriptionIds,
    activeOrTrialingSubscriptionCount,
  });
}

async function loadFixtureState(input: {
  admin: SupabaseClient;
  stripe: Stripe;
  ownerId: string;
}) {
  const [profile, attempts] = await Promise.all([
    loadProfile(input.admin, input.ownerId),
    loadActiveAttempts(input.admin, input.ownerId),
  ]);
  const stripe = await inspectStripe({
    stripe: input.stripe,
    ownerId: input.ownerId,
    customerCandidates: [
      profile.billing_customer_id ?? "",
      ...attempts.map((attempt) => attempt.stripe_customer_id ?? ""),
    ],
    sessionCandidates: attempts.map(
      (attempt) => attempt.stripe_session_id ?? "",
    ),
    subscriptionCandidates: [profile.billing_subscription_id ?? ""],
  });
  return Object.freeze({ profile, attempts, stripe });
}

function fixtureRow(
  state: FixtureState,
  ownerHandle: PreviewHarnessOwnerHandle,
) {
  const plan = effectiveFixturePlan(state.profile);
  return Object.freeze({
    ownerHandle,
    plan,
    billingStatus: fixtureBillingStatus(state.profile),
    paid: plan !== "free",
    activeOrTrialingSubscriptionCount:
      state.stripe.activeOrTrialingSubscriptionCount,
    activeCheckoutAttemptCount: state.attempts.length,
    customerCount: state.stripe.customerIds.size,
    checkoutSessionCount: state.stripe.sessionIds.size,
    subscriptionCount: state.stripe.subscriptionIds.size,
  } satisfies PreviewHarnessFixtureRow);
}

function paidFieldsMatch(before: ProfileRow, after: ProfileRow) {
  return (
    before.plan === after.plan &&
    before.billing_subscription_id === after.billing_subscription_id &&
    before.billing_status === after.billing_status &&
    before.current_period_end === after.current_period_end &&
    before.cancel_at_period_end === after.cancel_at_period_end
  );
}

async function verifyDeploymentGate(input: {
  appOrigin: string;
  protectionCookie: string;
  fetchImpl: typeof fetch;
}) {
  const headers = new Headers({
    origin: input.appOrigin,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
  });
  if (input.protectionCookie) headers.set("cookie", input.protectionCookie);
  const response = await input.fetchImpl(
    new URL("/api/internal/stripe-preview-smoke", input.appOrigin),
    {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    fail();
  }
  if (
    response.status !== 401 ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).error_code !== "AUTH_REQUIRED"
  ) {
    fail();
  }
}

export async function enforceSafeCheckoutResponse(response: Response) {
  if (response.status !== 409) return response;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return new Response(null, { status: 500 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).error_code !==
      "STRIPE_CHECKOUT_IN_PROGRESS"
  ) {
    return new Response(null, { status: 500 });
  }
  return response;
}

async function terminateAttempt(input: {
  admin: SupabaseClient;
  ownerId: string;
  attempt: AttemptRow;
}) {
  const { data, error } = await input.admin
    .from("stripe_checkout_attempts")
    .update({
      status: "terminal_failed",
      lease_hash: null,
      lease_expires_at: null,
      error_code: "PREVIEW_CONCURRENCY_SMOKE_CLEANUP",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("attempt_id", input.attempt.attempt_id)
    .eq("user_id", input.ownerId)
    .in("status", [...ACTIVE_ATTEMPT_STATUSES])
    .select("attempt_id");
  if (error || !Array.isArray(data) || data.length !== 1) fail();
}

async function restoreProfile(input: {
  admin: SupabaseClient;
  ownerId: string;
  baseline: ProfileRow;
  current: ProfileRow;
}) {
  if (
    input.current.billing_customer_id === input.baseline.billing_customer_id &&
    input.current.billing_provider === input.baseline.billing_provider
  ) {
    return;
  }
  const query = input.admin
    .from("user_profiles")
    .update({
      billing_provider: input.baseline.billing_provider,
      billing_customer_id: input.baseline.billing_customer_id,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.ownerId);
  if (input.current.billing_customer_id) {
    query.eq("billing_customer_id", input.current.billing_customer_id);
  }
  const { data, error } = await query.select("user_id");
  if (error || !Array.isArray(data) || data.length !== 1) fail();
}

function baselineResult(state: FixtureState): PreviewCheckoutRuntimeBaseline {
  const plan = effectiveFixturePlan(state.profile);
  return Object.freeze({
    activeCheckoutAttemptCount: state.attempts.length,
    customerCount: state.stripe.customerIds.size,
    checkoutSessionCount: state.stripe.sessionIds.size,
    subscriptionCount: state.stripe.subscriptionIds.size,
    effectivePlan: plan,
    billingStatus: fixtureBillingStatus(state.profile),
    paid: plan !== "free",
  });
}

export function createRealPreviewCheckoutRuntimeDependencies(
  ports: PreviewCheckoutRuntimePorts = DEFAULT_PORTS,
): PreviewCheckoutRuntimeDependencies {
  return Object.freeze({
    async runPreflight({ config, environment }) {
      try {
        await runPreviewSupabaseIdentityPreflight(environment, ports.fetchImpl);
      } catch (error) {
        failPreflightStage(supabasePreflightStageCode(error));
      }

      const credentials = await runPreflightStage(
        "PREFLIGHT_SUPABASE_CONFIGURATION_FAILED",
        () => {
          const supabaseUrl = environment.AUTOPDF_PREVIEW_HARNESS_SUPABASE_URL;
          const anonKey = environment.AUTOPDF_PREVIEW_HARNESS_SUPABASE_ANON_KEY;
          const serviceRoleKey =
            environment.AUTOPDF_PREVIEW_HARNESS_SUPABASE_SERVICE_ROLE_KEY;
          if (!supabaseUrl || !anonKey || !serviceRoleKey) fail();
          return { supabaseUrl, anonKey, serviceRoleKey };
        },
      );

      const authentication = await runPreflightStage(
        "PREFLIGHT_SUPABASE_AUTH_FAILED",
        () =>
          ports.authenticate({
            url: credentials.supabaseUrl,
            anonKey: credentials.anonKey,
            cookieHeader: config.authCookie,
            fetchImpl: ports.fetchImpl,
          }),
      );
      await runPreflightStage("PREFLIGHT_OWNER_IDENTITY_FAILED", () => {
        if (
          !safeHashMatch(
            sha256(authentication.user.id),
            config.expectedOwnerHash,
          )
        ) {
          fail();
        }
      });

      await runPreflightStage("PREFLIGHT_PREVIEW_DEPLOYMENT_FAILED", () =>
        verifyDeploymentGate({
          appOrigin: config.appOrigin,
          protectionCookie: authentication.protectionCookie,
          fetchImpl: ports.fetchImpl,
        }),
      );

      const stripe = await runPreflightStage(
        "PREFLIGHT_STRIPE_ACCOUNT_FAILED",
        async () => {
          const stripeClient = ports.createStripe(config.stripeSecretKey);
          const account = await stripeClient.accounts.retrieve();
          if (
            !account.id ||
            sha256(account.id) !== ports.expectedStripeAccountHash
          ) {
            fail();
          }
          return stripeClient;
        },
      );

      const admin = await runPreflightStage(
        "PREFLIGHT_HARNESS_ADAPTER_FAILED",
        () =>
          ports.createAdminClient(
            credentials.supabaseUrl,
            credentials.serviceRoleKey,
          ),
      );
      const ownerId = authentication.user.id;
      const ownerHandle = ownerId as PreviewHarnessOwnerHandle;
      let baseline: FixtureState | undefined;
      let latestPostState: FixtureState | undefined;
      let artifactHandle: PreviewHarnessArtifactHandle | undefined;
      let cleanupResult:
        | Readonly<{
            complete: true;
            activeAttemptFinal: 0;
            fixtureFree: true;
            fixtureUnsubscribed: true;
            unnecessaryArtifactCount: 0;
          }>
        | undefined;

      const adapter = await createPreviewCheckoutHarnessAdapter({
        environment,
        dependencies: {
          async verifyIdentity() {
            return {
              urlMatchesExpectedPreview: true,
              anonKeyMatchesExpectedPreview: true,
              serviceRoleKeyMatchesExpectedPreview: true,
              productionIdentity: false,
            };
          },
          async acquireSession() {
            return {
              ownerHandle,
              cookieHeader: authentication.cookieHeader,
            };
          },
          async inspectFixture() {
            const state = await loadFixtureState({
              admin,
              stripe,
              ownerId,
            });
            baseline ??= state;
            return [fixtureRow(state, ownerHandle)];
          },
          async prepareFixture() {
            if (!baseline) fail();
            artifactHandle = randomUUID() as PreviewHarnessArtifactHandle;
            return { artifactHandle };
          },
          async inspectPostState() {
            if (!baseline) fail();
            const state = await loadFixtureState({
              admin,
              stripe,
              ownerId,
            });
            latestPostState = state;
            const customerDelta =
              state.stripe.customerIds.size - baseline.stripe.customerIds.size;
            const sessionDelta =
              state.stripe.sessionIds.size - baseline.stripe.sessionIds.size;
            const subscriptionDelta =
              state.stripe.subscriptionIds.size -
              baseline.stripe.subscriptionIds.size;
            return {
              activeAttemptMax: state.attempts.length,
              activeAttemptCount: state.attempts.length,
              customerCreatedCount: customerDelta,
              sessionCreatedCount: sessionDelta,
              subscriptionCreatedCount: subscriptionDelta,
              productionOperations: 0,
              liveOperations: 0,
              billingProfilePaidMutation: !paidFieldsMatch(
                baseline.profile,
                state.profile,
              ),
              fixtureFree: effectiveFixturePlan(state.profile) === "free",
              fixtureUnsubscribed:
                state.stripe.subscriptionIds.size === 0 &&
                state.profile.billing_subscription_id === null,
            };
          },
          async cleanupFixture(input) {
            if (
              !baseline ||
              !artifactHandle ||
              input.artifactHandle !== artifactHandle ||
              input.ownerHandle !== ownerHandle
            ) {
              fail();
            }
            const state =
              latestPostState ??
              (await loadFixtureState({ admin, stripe, ownerId }));
            if (
              state.attempts.length > 1 ||
              state.stripe.customerIds.size > 1
            ) {
              fail();
            }

            const attempt = state.attempts[0];
            const sessionId = attempt?.stripe_session_id;
            if (sessionId) {
              const session =
                await stripe.checkout.sessions.retrieve(sessionId);
              assertSession(session, ownerId);
              if (session.status === "open") {
                const expired =
                  await stripe.checkout.sessions.expire(sessionId);
                if (expired.status !== "expired") fail();
              } else if (session.status !== "expired") {
                fail();
              }
            }
            if (attempt) await terminateAttempt({ admin, ownerId, attempt });

            await restoreProfile({
              admin,
              ownerId,
              baseline: baseline.profile,
              current: state.profile,
            });

            const customerId = [...state.stripe.customerIds][0];
            if (customerId) {
              const deleted = await stripe.customers.del(customerId);
              if (!deleted.deleted) fail();
            }

            const finalState = await loadFixtureState({
              admin,
              stripe,
              ownerId,
            });
            if (
              finalState.attempts.length !== 0 ||
              finalState.stripe.customerIds.size !== 0 ||
              finalState.stripe.sessionIds.size !== 0 ||
              finalState.stripe.subscriptionIds.size !== 0 ||
              !paidFieldsMatch(baseline.profile, finalState.profile) ||
              effectiveFixturePlan(finalState.profile) !== "free"
            ) {
              fail();
            }
            cleanupResult = Object.freeze({
              complete: true,
              activeAttemptFinal: 0,
              fixtureFree: true,
              fixtureUnsubscribed: true,
              unnecessaryArtifactCount: 0,
            });
          },
        },
      }).catch(() => failPreflightStage("PREFLIGHT_HARNESS_ADAPTER_FAILED"));

      return Object.freeze({
        previewDeploymentIdentityMatch: true,
        previewSupabaseIdentityMatch: true,
        stripeMode: "test" as const,
        expectedStripeAccountMatch: true,
        ownerIdentityMatch: true,
        productionIdentity: false,
        developmentIdentity: false,
        harness: Object.freeze({
          async inspectBaseline() {
            await adapter.verifyFixture();
            if (!baseline) fail();
            return baselineResult(baseline);
          },
          async prepareFixture() {
            await adapter.prepareFixture();
          },
          executeConcurrency: () =>
            adapter.executeConcurrency({
              checkoutUrl: new URL("/api/stripe/checkout", config.appOrigin),
              requestCount: config.requestCount,
              fetchImpl: async (target, init) => {
                const headers = new Headers(init?.headers);
                headers.set("origin", config.appOrigin);
                const response = await ports.fetchImpl(target, {
                  ...init,
                  headers,
                });
                return enforceSafeCheckoutResponse(response);
              },
            }),
          async cleanupCreatedArtifacts() {
            await adapter.cleanupCreatedFixtureArtifacts();
            if (!cleanupResult) fail();
            return cleanupResult;
          },
        }),
      });
    },
  });
}
