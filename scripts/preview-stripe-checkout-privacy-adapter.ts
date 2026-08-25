// @ts-expect-error Node's built-in TypeScript runner requires the explicit suffix.
import * as PrivacyHarness from "./preview-stripe-checkout-privacy-harness.ts";

const { executePrivacySafeCheckoutHarness } = PrivacyHarness;
type PrivacySafeHarnessResult = PrivacyHarness.PrivacySafeHarnessResult;

const HARNESS_ENV = Object.freeze({
  supabaseUrl: "AUTOPDF_PREVIEW_HARNESS_SUPABASE_URL",
  anonKey: "AUTOPDF_PREVIEW_HARNESS_SUPABASE_ANON_KEY",
  serviceRoleKey: "AUTOPDF_PREVIEW_HARNESS_SUPABASE_SERVICE_ROLE_KEY",
} as const);

type AdapterErrorCode =
  | "HARNESS_CREDENTIAL_MISSING"
  | "HARNESS_CREDENTIAL_URL_INVALID"
  | "HARNESS_CREDENTIAL_IDENTITY_MISMATCH"
  | "HARNESS_PRODUCTION_IDENTITY_FORBIDDEN"
  | "HARNESS_SESSION_INVALID"
  | "HARNESS_FIXTURE_NOT_FOUND"
  | "HARNESS_FIXTURE_MULTIPLE"
  | "HARNESS_FIXTURE_OWNER_MISMATCH"
  | "HARNESS_FIXTURE_STATE_INVALID"
  | "HARNESS_FIXTURE_PREPARE_FAILED"
  | "HARNESS_FIXTURE_CLEANUP_SCOPE_MISSING"
  | "HARNESS_FIXTURE_CLEANUP_FAILED"
  | "HARNESS_CONCURRENCY_REQUIRED"
  | "HARNESS_CONCURRENCY_RESULT_UNSAFE";

type HarnessEnvironment = Readonly<Record<string, string | undefined>>;

export type PreviewHarnessCredentialSet = Readonly<{
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}>;

export type PreviewHarnessOwnerHandle = string & {
  readonly __ownerHandle: unique symbol;
};
export type PreviewHarnessArtifactHandle = string & {
  readonly __artifactHandle: unique symbol;
};

type AuthSession = Readonly<{
  ownerHandle: PreviewHarnessOwnerHandle;
  cookieHeader: string;
}>;

export type PreviewHarnessIdentityResult = Readonly<{
  urlMatchesExpectedPreview: boolean;
  anonKeyMatchesExpectedPreview: boolean;
  serviceRoleKeyMatchesExpectedPreview: boolean;
  productionIdentity: boolean;
}>;

export type PreviewHarnessFixtureRow = Readonly<{
  ownerHandle: PreviewHarnessOwnerHandle;
  plan: "free" | "pro" | "pro_plus" | "unknown";
  billingStatus: "none" | "active" | "trialing" | "other";
  paid: boolean;
  activeOrTrialingSubscriptionCount: number;
  activeCheckoutAttemptCount: number;
  customerCount: number;
  checkoutSessionCount: number;
  subscriptionCount: number;
}>;

type PostState = Readonly<{
  activeAttemptMax: number;
  activeAttemptCount: number;
  customerCreatedCount: number;
  sessionCreatedCount: number;
  subscriptionCreatedCount: number;
  productionOperations: number;
  liveOperations: number;
  billingProfilePaidMutation: boolean;
  fixtureFree: boolean;
  fixtureUnsubscribed: boolean;
}>;

export type PreviewHarnessAdapterDependencies = Readonly<{
  verifyIdentity(
    credentials: PreviewHarnessCredentialSet,
  ): Promise<PreviewHarnessIdentityResult>;
  acquireSession(
    credentials: PreviewHarnessCredentialSet,
  ): Promise<AuthSession>;
  inspectFixture(input: {
    credentials: PreviewHarnessCredentialSet;
    ownerHandle: PreviewHarnessOwnerHandle;
  }): Promise<readonly PreviewHarnessFixtureRow[]>;
  prepareFixture(input: {
    credentials: PreviewHarnessCredentialSet;
    ownerHandle: PreviewHarnessOwnerHandle;
  }): Promise<Readonly<{ artifactHandle: PreviewHarnessArtifactHandle }>>;
  cleanupFixture(input: {
    credentials: PreviewHarnessCredentialSet;
    ownerHandle: PreviewHarnessOwnerHandle;
    artifactHandle: PreviewHarnessArtifactHandle;
  }): Promise<void>;
  inspectPostState(input: {
    credentials: PreviewHarnessCredentialSet;
    ownerHandle: PreviewHarnessOwnerHandle;
  }): Promise<PostState>;
}>;

export type PreviewHarnessExecutionResult = PrivacySafeHarnessResult &
  Readonly<{
    fixture_fresh: true;
    fixture_free: true;
    fixture_unsubscribed: true;
    active_attempt_max: number;
    billing_profile_paid_mutation: false;
  }>;

export class PreviewHarnessAdapterError extends Error {
  constructor(readonly code: AdapterErrorCode) {
    super(code);
    this.name = "PreviewHarnessAdapterError";
  }
}

function fail(code: AdapterErrorCode): never {
  throw new PreviewHarnessAdapterError(code);
}

function loadCredentialSet(environment: HarnessEnvironment) {
  const supabaseUrl = environment[HARNESS_ENV.supabaseUrl];
  const anonKey = environment[HARNESS_ENV.anonKey];
  const serviceRoleKey = environment[HARNESS_ENV.serviceRoleKey];
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    fail("HARNESS_CREDENTIAL_MISSING");
  }

  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    fail("HARNESS_CREDENTIAL_URL_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname !== "/"
  ) {
    fail("HARNESS_CREDENTIAL_URL_INVALID");
  }

  return Object.freeze({
    supabaseUrl,
    anonKey,
    serviceRoleKey,
  });
}

function isSafeCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateFixtureRows(
  rows: readonly PreviewHarnessFixtureRow[],
  ownerHandle: PreviewHarnessOwnerHandle,
) {
  if (rows.length === 0) fail("HARNESS_FIXTURE_NOT_FOUND");
  if (rows.length !== 1) fail("HARNESS_FIXTURE_MULTIPLE");
  const fixture = rows[0];
  if (fixture.ownerHandle !== ownerHandle) {
    fail("HARNESS_FIXTURE_OWNER_MISMATCH");
  }
  if (
    fixture.plan !== "free" ||
    fixture.billingStatus !== "none" ||
    fixture.paid ||
    !isSafeCount(fixture.activeOrTrialingSubscriptionCount) ||
    !isSafeCount(fixture.activeCheckoutAttemptCount) ||
    !isSafeCount(fixture.customerCount) ||
    !isSafeCount(fixture.checkoutSessionCount) ||
    !isSafeCount(fixture.subscriptionCount) ||
    fixture.activeOrTrialingSubscriptionCount !== 0 ||
    fixture.activeCheckoutAttemptCount !== 0 ||
    fixture.customerCount !== 0 ||
    fixture.checkoutSessionCount !== 0 ||
    fixture.subscriptionCount !== 0
  ) {
    fail("HARNESS_FIXTURE_STATE_INVALID");
  }
}

function createStartBarrierFetch(
  fetchImpl: typeof fetch,
  participants: number,
) {
  let arrived = 0;
  let release: (() => void) | undefined;
  const boundary = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async (input: URL | RequestInfo, init?: RequestInit) => {
    arrived += 1;
    if (arrived === participants) release?.();
    await boundary;
    return fetchImpl(input, init);
  };
}

export async function createPreviewCheckoutHarnessAdapter(input: {
  environment: HarnessEnvironment;
  dependencies: PreviewHarnessAdapterDependencies;
}) {
  const credentials = loadCredentialSet(input.environment);

  let identity: PreviewHarnessIdentityResult;
  try {
    identity = await input.dependencies.verifyIdentity(credentials);
  } catch {
    fail("HARNESS_CREDENTIAL_IDENTITY_MISMATCH");
  }
  if (identity.productionIdentity) {
    fail("HARNESS_PRODUCTION_IDENTITY_FORBIDDEN");
  }
  if (
    !identity.urlMatchesExpectedPreview ||
    !identity.anonKeyMatchesExpectedPreview ||
    !identity.serviceRoleKeyMatchesExpectedPreview
  ) {
    fail("HARNESS_CREDENTIAL_IDENTITY_MISMATCH");
  }

  let sessionPromise: Promise<AuthSession> | undefined;
  let createdArtifactHandle: PreviewHarnessArtifactHandle | undefined;
  async function acquireValidatedSession() {
    sessionPromise ??= input.dependencies
      .acquireSession(credentials)
      .catch(() => fail("HARNESS_SESSION_INVALID"));
    const session = await sessionPromise;
    if (!session.cookieHeader || !session.ownerHandle) {
      fail("HARNESS_SESSION_INVALID");
    }
    return session;
  }

  async function verifyFixture() {
    const session = await acquireValidatedSession();
    let rows: readonly PreviewHarnessFixtureRow[];
    try {
      rows = await input.dependencies.inspectFixture({
        credentials,
        ownerHandle: session.ownerHandle,
      });
    } catch {
      fail("HARNESS_FIXTURE_STATE_INVALID");
    }
    validateFixtureRows(rows, session.ownerHandle);
    return Object.freeze({
      fixture_fresh: true,
      fixture_free: true,
      fixture_unsubscribed: true,
    } as const);
  }

  return Object.freeze({
    verifyFixture,
    async prepareFixture() {
      const session = await acquireValidatedSession();
      let prepared: Readonly<{
        artifactHandle: PreviewHarnessArtifactHandle;
      }>;
      try {
        prepared = await input.dependencies.prepareFixture({
          credentials,
          ownerHandle: session.ownerHandle,
        });
      } catch {
        fail("HARNESS_FIXTURE_PREPARE_FAILED");
      }
      if (!prepared.artifactHandle) fail("HARNESS_FIXTURE_PREPARE_FAILED");
      createdArtifactHandle = prepared.artifactHandle;
      return verifyFixture();
    },
    async cleanupCreatedFixtureArtifacts() {
      if (!createdArtifactHandle) {
        fail("HARNESS_FIXTURE_CLEANUP_SCOPE_MISSING");
      }
      const session = await acquireValidatedSession();
      try {
        await input.dependencies.cleanupFixture({
          credentials,
          ownerHandle: session.ownerHandle,
          artifactHandle: createdArtifactHandle,
        });
      } catch {
        fail("HARNESS_FIXTURE_CLEANUP_FAILED");
      }
      const fixture = await verifyFixture();
      createdArtifactHandle = undefined;
      return fixture;
    },
    async executeConcurrency(options: {
      checkoutUrl: URL;
      requestCount: number;
      fetchImpl: typeof fetch;
    }): Promise<PreviewHarnessExecutionResult> {
      if (
        !Number.isSafeInteger(options.requestCount) ||
        options.requestCount < 2 ||
        options.requestCount > 4
      ) {
        fail("HARNESS_CONCURRENCY_REQUIRED");
      }
      const fixture = await verifyFixture();
      const session = await acquireValidatedSession();
      let observedPostState: PostState | undefined;
      const result = await executePrivacySafeCheckoutHarness({
        argv: [],
        requestCount: options.requestCount,
        checkoutUrl: options.checkoutUrl,
        acquireSession: async () => ({ cookieHeader: session.cookieHeader }),
        fetchImpl: createStartBarrierFetch(
          options.fetchImpl,
          options.requestCount,
        ),
        inspectPostState: async () => {
          observedPostState = await input.dependencies.inspectPostState({
            credentials,
            ownerHandle: session.ownerHandle,
          });
          return observedPostState;
        },
      });
      if (
        !observedPostState ||
        result.winner_count !== 1 ||
        result.loser_count < 1 ||
        !isSafeCount(observedPostState.activeAttemptMax) ||
        observedPostState.activeAttemptMax > 1 ||
        result.active_attempt_count > 1 ||
        result.customer_created_count > 1 ||
        result.session_created_count > 1 ||
        result.subscription_created_count !== 0 ||
        result.production_operations !== 0 ||
        result.live_operations !== 0 ||
        observedPostState.billingProfilePaidMutation ||
        !observedPostState.fixtureFree ||
        !observedPostState.fixtureUnsubscribed
      ) {
        fail("HARNESS_CONCURRENCY_RESULT_UNSAFE");
      }
      return Object.freeze({
        ...fixture,
        ...result,
        active_attempt_max: observedPostState.activeAttemptMax,
        billing_profile_paid_mutation: false,
      });
    },
  });
}

export const PREVIEW_HARNESS_PROCESS_ENV_NAMES = HARNESS_ENV;
