type HarnessErrorCode =
  | "HARNESS_ARGUMENT_REJECTED"
  | "HARNESS_AUTHENTICATION_FAILED"
  | "HARNESS_CHECKOUT_REQUEST_FAILED"
  | "HARNESS_CHECKOUT_RESPONSE_REJECTED"
  | "HARNESS_POST_STATE_FAILED";

export type PrivacySafeHarnessResult = Readonly<{
  authenticated: boolean;
  request_count: number;
  status_class: "success" | "conflict" | "mixed";
  winner_count: number;
  loser_count: number;
  active_attempt_count: number;
  customer_created_count: number;
  session_created_count: number;
  subscription_created_count: number;
  production_operations: number;
  live_operations: number;
}>;

type SessionMaterial = Readonly<{
  cookieHeader: string;
}>;

type PostState = Readonly<{
  activeAttemptCount: number;
  customerCreatedCount: number;
  sessionCreatedCount: number;
  subscriptionCreatedCount: number;
  productionOperations: number;
  liveOperations: number;
}>;

type HarnessDependencies = Readonly<{
  argv: readonly string[];
  requestCount: number;
  checkoutUrl: URL;
  acquireSession: () => Promise<SessionMaterial>;
  fetchImpl: typeof fetch;
  inspectPostState: () => Promise<PostState>;
}>;

type HarnessStreams = Readonly<{
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}>;

export class PrivacySafeHarnessError extends Error {
  constructor(readonly code: HarnessErrorCode) {
    super(code);
    this.name = "PrivacySafeHarnessError";
  }
}

function fail(code: HarnessErrorCode): never {
  throw new PrivacySafeHarnessError(code);
}

function isSafeCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validatePostState(state: PostState) {
  if (
    !isSafeCount(state.activeAttemptCount) ||
    !isSafeCount(state.customerCreatedCount) ||
    !isSafeCount(state.sessionCreatedCount) ||
    !isSafeCount(state.subscriptionCreatedCount) ||
    !isSafeCount(state.productionOperations) ||
    !isSafeCount(state.liveOperations)
  ) {
    fail("HARNESS_POST_STATE_FAILED");
  }
}

function classifyStatuses(statuses: readonly number[]) {
  const winnerCount = statuses.filter(
    (status) => status >= 200 && status < 300,
  ).length;
  const loserCount = statuses.filter((status) => status === 409).length;
  if (winnerCount + loserCount !== statuses.length) {
    fail("HARNESS_CHECKOUT_RESPONSE_REJECTED");
  }
  const statusClass =
    winnerCount === statuses.length
      ? "success"
      : loserCount === statuses.length
        ? "conflict"
        : "mixed";
  return { winnerCount, loserCount, statusClass } as const;
}

export async function executePrivacySafeCheckoutHarness(
  dependencies: HarnessDependencies,
): Promise<PrivacySafeHarnessResult> {
  if (dependencies.argv.length !== 0) {
    fail("HARNESS_ARGUMENT_REJECTED");
  }
  if (
    !Number.isSafeInteger(dependencies.requestCount) ||
    dependencies.requestCount < 1 ||
    dependencies.requestCount > 4 ||
    dependencies.checkoutUrl.protocol !== "https:" ||
    dependencies.checkoutUrl.username !== "" ||
    dependencies.checkoutUrl.password !== "" ||
    dependencies.checkoutUrl.port !== "" ||
    dependencies.checkoutUrl.pathname !== "/api/stripe/checkout" ||
    dependencies.checkoutUrl.search !== "" ||
    dependencies.checkoutUrl.hash !== ""
  ) {
    fail("HARNESS_ARGUMENT_REJECTED");
  }

  let session: SessionMaterial;
  try {
    session = await dependencies.acquireSession();
  } catch {
    fail("HARNESS_AUTHENTICATION_FAILED");
  }
  if (!session.cookieHeader) {
    fail("HARNESS_AUTHENTICATION_FAILED");
  }

  const requests = Array.from({ length: dependencies.requestCount }, () => {
    const headers = new Headers();
    headers.set("cookie", session.cookieHeader);
    return dependencies
      .fetchImpl(dependencies.checkoutUrl, {
        method: "POST",
        headers,
        redirect: "error",
      })
      .then((response) => response.status)
      .catch(() => fail("HARNESS_CHECKOUT_REQUEST_FAILED"));
  });
  const statuses = await Promise.all(requests);
  const classification = classifyStatuses(statuses);

  let postState: PostState;
  try {
    postState = await dependencies.inspectPostState();
  } catch {
    fail("HARNESS_POST_STATE_FAILED");
  }
  validatePostState(postState);

  return {
    authenticated: true,
    request_count: dependencies.requestCount,
    status_class: classification.statusClass,
    winner_count: classification.winnerCount,
    loser_count: classification.loserCount,
    active_attempt_count: postState.activeAttemptCount,
    customer_created_count: postState.customerCreatedCount,
    session_created_count: postState.sessionCreatedCount,
    subscription_created_count: postState.subscriptionCreatedCount,
    production_operations: postState.productionOperations,
    live_operations: postState.liveOperations,
  };
}

export async function runPrivacySafeCheckoutHarness(
  dependencies: HarnessDependencies,
  streams: HarnessStreams,
) {
  try {
    const result = await executePrivacySafeCheckoutHarness(dependencies);
    streams.stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const errorCode =
      error instanceof PrivacySafeHarnessError
        ? error.code
        : "HARNESS_CHECKOUT_REQUEST_FAILED";
    streams.stderr(`${JSON.stringify({ ok: false, error_code: errorCode })}\n`);
    return 1;
  }
}
