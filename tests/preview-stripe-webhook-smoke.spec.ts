import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import {
  OperatorError,
  buildControlledEvent,
  classifyStripeMode,
  loadOperatorConfig,
  parseOperatorMode,
  prepareSignedRequest,
  runOperator,
  validateEventType,
  validateFixture,
  validatePreviewTarget,
  validateStaleCreated,
} from "../scripts/preview-stripe-webhook-smoke";

const previewHost = "autopdf-web-git-codex-stripe-safety-clean-safe.vercel.app";
const previewUrl = `https://${previewHost}/api/stripe/webhook`;
const hostHash = createHash("sha256").update(previewHost).digest("hex");
const stripeKey = `sk_${"test"}_operator-placeholder`;
const signingSecret = `webhook-${"secret"}-placeholder`;
const bypassSecret = `bypass-${"secret"}-placeholder`;
const customerId = `cus_${"a".repeat(12)}`;
const subscriptionId = `sub_${"b".repeat(12)}`;

function environment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    AUTOPDF_PREVIEW_STRIPE_SMOKE_ENABLE: "CONTROLLED_PREVIEW_STRIPE_WEBHOOK",
    AUTOPDF_PREVIEW_STRIPE_WEBHOOK_URL: previewUrl,
    AUTOPDF_PREVIEW_STRIPE_HOST_SHA256: hostHash,
    AUTOPDF_PREVIEW_STRIPE_SECRET_KEY: stripeKey,
    AUTOPDF_PREVIEW_STRIPE_WEBHOOK_SECRET: signingSecret,
    AUTOPDF_PREVIEW_VERCEL_BYPASS_SECRET: bypassSecret,
    AUTOPDF_PREVIEW_STRIPE_CUSTOMER_ID: customerId,
    AUTOPDF_PREVIEW_STRIPE_SUBSCRIPTION_ID: subscriptionId,
    AUTOPDF_PREVIEW_STRIPE_BASELINE_CREATED: "2000000000",
    AUTOPDF_PREVIEW_STRIPE_STALE_CREATED: "1900000000",
    ...overrides,
  };
}

function expectOperatorCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error("expected operator failure");
  } catch (error) {
    expect(error).toBeInstanceOf(OperatorError);
    expect((error as OperatorError).code).toBe(code);
  }
}

test("only the explicit Preview branch host and webhook path are accepted", () => {
  expect(validatePreviewTarget(previewUrl, hostHash).hostname).toBe(
    previewHost,
  );
  expectOperatorCode(
    () =>
      validatePreviewTarget(
        "https://autopdf-web.vercel.app/api/stripe/webhook",
        hostHash,
      ),
    "OPERATOR_PRODUCTION_TARGET_REJECTED",
  );
  expectOperatorCode(
    () =>
      validatePreviewTarget(
        "https://unknown.example/api/stripe/webhook",
        hostHash,
      ),
    "OPERATOR_PREVIEW_TARGET_REJECTED",
  );
  expectOperatorCode(
    () => validatePreviewTarget("not-a-url", hostHash),
    "OPERATOR_TARGET_URL_INVALID",
  );
  expectOperatorCode(
    () =>
      validatePreviewTarget(
        "http://localhost:3000/api/stripe/webhook",
        hostHash,
      ),
    "OPERATOR_PREVIEW_TARGET_REJECTED",
  );
  expectOperatorCode(
    () => validatePreviewTarget(`${previewUrl}?bypass=forbidden`, hostHash),
    "OPERATOR_PREVIEW_TARGET_REJECTED",
  );
});

test("Stripe mode and execution arguments fail closed", () => {
  expect(classifyStripeMode(stripeKey)).toBe("test");
  expect(classifyStripeMode(`sk_${"live"}_placeholder`)).toBe("live");
  expect(classifyStripeMode("unknown-placeholder")).toBe("unknown");
  expect(parseOperatorMode(["--dry-run"])).toBe("dry_run");
  expect(parseOperatorMode(["--execute"])).toBe("execute");
  expectOperatorCode(
    () => parseOperatorMode(["--webhook-secret=forbidden"]),
    "OPERATOR_ARGUMENT_INVALID",
  );
});

test("credentials stay environment-only and failures expose fixed codes", () => {
  const missingSecret = environment({
    AUTOPDF_PREVIEW_STRIPE_WEBHOOK_SECRET: undefined,
  });
  try {
    loadOperatorConfig(missingSecret, ["--dry-run"]);
    throw new Error("expected operator failure");
  } catch (error) {
    expect(error).toBeInstanceOf(OperatorError);
    expect((error as OperatorError).code).toBe(
      "OPERATOR_WEBHOOK_SECRET_REQUIRED",
    );
    expect(String(error)).not.toContain(signingSecret);
    expect(String(error)).not.toContain(bypassSecret);
  }
  expectOperatorCode(
    () =>
      loadOperatorConfig(
        environment({
          AUTOPDF_PREVIEW_STRIPE_SECRET_KEY: `sk_${"live"}_placeholder`,
        }),
        ["--dry-run"],
      ),
    "OPERATOR_STRIPE_TEST_MODE_REQUIRED",
  );
});

test("event construction is unique, supported, linked, and explicitly stale", () => {
  const config = loadOperatorConfig(environment(), ["--dry-run"]);
  const first = buildControlledEvent(config, () => "a".repeat(32));
  const second = buildControlledEvent(config, () => "b".repeat(32));
  expect(first.id).not.toBe(second.id);
  expect(first.type).toBe("customer.subscription.updated");
  expect(first.created).toBeLessThan(config.baselineCreated);
  expect(first.data.object.customer).toBe(customerId);
  expect(first.data.object.id).toBe(subscriptionId);
  expectOperatorCode(
    () => validateEventType("customer.subscription.deleted"),
    "OPERATOR_EVENT_TYPE_REJECTED",
  );
  expectOperatorCode(
    () => validateStaleCreated(2_000_000_000, 2_000_000_000),
    "OPERATOR_EVENT_NOT_STALE",
  );
  expectOperatorCode(
    () => validateFixture("invalid", subscriptionId),
    "OPERATOR_FIXTURE_CUSTOMER_INVALID",
  );
  expectOperatorCode(
    () => validateFixture(customerId, "invalid"),
    "OPERATOR_FIXTURE_SUBSCRIPTION_INVALID",
  );
});

test("generated signature is accepted by the current Stripe contract", () => {
  const config = loadOperatorConfig(environment(), ["--dry-run"]);
  const prepared = prepareSignedRequest(config, () => "c".repeat(32));
  const stripe = new Stripe(stripeKey);
  const verified = stripe.webhooks.constructEvent(
    prepared.payload,
    prepared.signature,
    signingSecret,
  );
  expect(verified.type).toBe("customer.subscription.updated");
  expect(prepared.eventIdHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(prepared)).not.toContain(signingSecret);
  expect(prepared.eventIdHash).not.toContain(
    firstRawIdentifier(prepared.payload),
  );
});

test("dry-run performs no network, database, or provider write", async () => {
  let networkRequests = 0;
  const blockedFetch: typeof fetch = async () => {
    networkRequests += 1;
    throw new Error("network must not run");
  };
  const result = await runOperator(environment(), ["--dry-run"], blockedFetch);
  expect(result.ok).toBe(true);
  expect(result.mode).toBe("dry_run");
  expect(result.target_classification).toBe("preview");
  expect(result.stripe_mode).toBe("test");
  expect(result.network_requests).toBe(0);
  expect(result.database_writes).toBe(0);
  expect(result.stripe_writes).toBe(0);
  expect(networkRequests).toBe(0);
  const serialized = JSON.stringify(result);
  for (const sensitive of [
    stripeKey,
    signingSecret,
    bypassSecret,
    customerId,
    subscriptionId,
  ]) {
    expect(serialized).not.toContain(sensitive);
  }
});

test("execute requires a second explicit approval gate before network", async () => {
  let networkRequests = 0;
  const blockedFetch: typeof fetch = async () => {
    networkRequests += 1;
    throw new Error("network must not run");
  };
  await expect(
    runOperator(environment(), ["--execute"], blockedFetch),
  ).rejects.toMatchObject({ code: "OPERATOR_EXECUTION_APPROVAL_REQUIRED" });
  expect(networkRequests).toBe(0);
});

test("fixture-owner identity mismatch stops before fixture or webhook access", async () => {
  let networkRequests = 0;
  const accountMismatchFetch: typeof fetch = async () => {
    networkRequests += 1;
    return new Response(
      JSON.stringify({ id: ["acct", "mismatch"].join("_") }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  await expect(
    runOperator(
      environment({
        AUTOPDF_PREVIEW_STRIPE_EXECUTE: "APPROVED_CONTROLLED_PREVIEW_WEBHOOK",
      }),
      ["--execute"],
      accountMismatchFetch,
    ),
  ).rejects.toMatchObject({
    code: "OPERATOR_STRIPE_ACCOUNT_IDENTITY_MISMATCH",
  });
  expect(networkRequests).toBe(1);
});

function firstRawIdentifier(payload: string) {
  const event = JSON.parse(payload) as { id: string };
  return event.id;
}
