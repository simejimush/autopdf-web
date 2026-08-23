import { classifyStripeMode } from "@/lib/billing/controlledStripeEventCore";
import {
  PreviewStripeSmokeError,
  authorizePreviewSmokeFixture,
  evaluatePreviewSmokeRequest,
  evaluatePreviewStripeSmokeGate,
  runPreviewStripeSmoke,
  type PreviewStripeSmokeProfile,
} from "@/lib/billing/previewStripeRuntimeSmokeCore";

export type PreviewSmokeEnvironment = Readonly<{
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_PROJECT_ID?: string;
  VERCEL_DEPLOYMENT_ID?: string;
  VERCEL_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  AUTOPDF_PREVIEW_STRIPE_SMOKE_ALLOWED_GIT_SHA?: string;
  AUTOPDF_PREVIEW_STRIPE_SMOKE_VERCEL_PROJECT_SHA256?: string;
  AUTOPDF_PREVIEW_STRIPE_SMOKE_SUPABASE_ORIGIN_SHA256?: string;
  AUTOPDF_PREVIEW_STRIPE_SMOKE_ENABLE?: string;
  AUTOPDF_PREVIEW_STRIPE_EXECUTE?: string;
  AUTOPDF_PREVIEW_STRIPE_SMOKE_OWNER_SHA256?: string;
  AUTOPDF_PREVIEW_STRIPE_SMOKE_CUSTOMER_SHA256?: string;
  AUTOPDF_PREVIEW_STRIPE_SMOKE_SUBSCRIPTION_SHA256?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}>;

type SmokeInput = Parameters<typeof runPreviewStripeSmoke>[0];

type SafeResponse = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
}>;

function response(
  status: number,
  body: Readonly<Record<string, unknown>>,
): SafeResponse {
  return { status, body };
}

function blocked(errorCode: string, status = 404) {
  return response(status, {
    ok: false,
    state: "blocked",
    error_code: errorCode,
  });
}

export function createPreviewStripeSmokeRoute(dependencies: {
  authenticate(): Promise<
    | Readonly<{ ok: false }>
    | Readonly<{
        ok: true;
        userId: string;
        profile: PreviewStripeSmokeProfile;
        loadProfileAfter(): Promise<PreviewStripeSmokeProfile | null>;
      }>
  >;
  createExecution(secretKey: string): Promise<
    Readonly<{
      provider: SmokeInput["provider"];
      processWebhook: SmokeInput["processWebhook"];
      loadBaselineCreatedAt(userId: string): Promise<string>;
    }>
  >;
}) {
  return async function handlePreviewStripeSmoke(input: {
    requestUrl: string;
    origin: string | null;
    fetchSite: string | null;
    fetchMode: string | null;
    environment: PreviewSmokeEnvironment;
  }): Promise<SafeResponse> {
    const environment = input.environment;
    const gate = evaluatePreviewStripeSmokeGate({
      vercelEnv: environment.VERCEL_ENV,
      gitBranch: environment.VERCEL_GIT_COMMIT_REF,
      gitSha: environment.VERCEL_GIT_COMMIT_SHA,
      allowedGitSha: environment.AUTOPDF_PREVIEW_STRIPE_SMOKE_ALLOWED_GIT_SHA,
      vercelProjectId: environment.VERCEL_PROJECT_ID,
      expectedVercelProjectHash:
        environment.AUTOPDF_PREVIEW_STRIPE_SMOKE_VERCEL_PROJECT_SHA256,
      deploymentId: environment.VERCEL_DEPLOYMENT_ID,
      vercelUrl: environment.VERCEL_URL,
      supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
      expectedSupabaseOriginHash:
        environment.AUTOPDF_PREVIEW_STRIPE_SMOKE_SUPABASE_ORIGIN_SHA256,
      enabled: environment.AUTOPDF_PREVIEW_STRIPE_SMOKE_ENABLE,
      execute: environment.AUTOPDF_PREVIEW_STRIPE_EXECUTE,
    });
    if (!gate.ok) return blocked(gate.errorCode);

    const requestGate = evaluatePreviewSmokeRequest({
      requestUrl: input.requestUrl,
      origin: input.origin,
      fetchSite: input.fetchSite,
      fetchMode: input.fetchMode,
      vercelUrl: environment.VERCEL_URL!,
    });
    if (!requestGate.ok) return blocked(requestGate.errorCode, 403);

    let authentication: Awaited<ReturnType<typeof dependencies.authenticate>>;
    try {
      authentication = await dependencies.authenticate();
    } catch {
      return response(503, {
        ok: false,
        state: "failed",
        error_code: "PREVIEW_SMOKE_PROFILE_READ_FAILED",
      });
    }
    if (!authentication.ok) return blocked("AUTH_REQUIRED", 401);

    const fixtureGate = authorizePreviewSmokeFixture({
      userId: authentication.userId,
      profile: authentication.profile,
      expectedOwnerHash: environment.AUTOPDF_PREVIEW_STRIPE_SMOKE_OWNER_SHA256,
      expectedCustomerHash:
        environment.AUTOPDF_PREVIEW_STRIPE_SMOKE_CUSTOMER_SHA256,
      expectedSubscriptionHash:
        environment.AUTOPDF_PREVIEW_STRIPE_SMOKE_SUBSCRIPTION_SHA256,
    });
    if (!fixtureGate.ok) return blocked(fixtureGate.errorCode, 403);

    const secretKey = environment.STRIPE_SECRET_KEY;
    const webhookSecret = environment.STRIPE_WEBHOOK_SECRET;
    if (!secretKey || classifyStripeMode(secretKey) !== "test") {
      return blocked("PREVIEW_SMOKE_STRIPE_TEST_MODE_REQUIRED", 503);
    }
    if (!webhookSecret) {
      return blocked("PREVIEW_SMOKE_WEBHOOK_SECRET_REQUIRED", 503);
    }

    try {
      const execution = await dependencies.createExecution(secretKey);
      const baselineCreatedAt = await execution.loadBaselineCreatedAt(
        authentication.userId,
      );
      const result = await runPreviewStripeSmoke({
        deploymentId: environment.VERCEL_DEPLOYMENT_ID!,
        stripeSecretKey: secretKey,
        webhookSecret,
        baselineCreatedAt,
        profileBefore: authentication.profile,
        provider: execution.provider,
        processWebhook: execution.processWebhook,
        loadProfileAfter: authentication.loadProfileAfter,
      });
      return response(200, result);
    } catch (error) {
      const errorCode =
        error instanceof PreviewStripeSmokeError
          ? error.code
          : "PREVIEW_SMOKE_FAILED";
      const status =
        errorCode === "PREVIEW_SMOKE_BILLING_STATE_CHANGED" ? 409 : 503;
      return response(status, {
        ok: false,
        state: "failed",
        error_code: errorCode,
      });
    }
  };
}
