import { expect, test } from "@playwright/test";
import {
  createStripeSafetyRepository,
  type StripeSafetyClient,
} from "../src/lib/billing/stripeSafetyRepositoryCore";

test("Checkout claim returns one durable attempt and hides RPC errors", async () => {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client: StripeSafetyClient = {
    async rpc(name, params) {
      calls.push({ name, params });
      return {
        data: {
          disposition: "claimed",
          attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        error: null,
      };
    },
  };
  const repository = createStripeSafetyRepository(async () => client);
  const claim = await repository.claimCheckout(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  );

  expect(claim.disposition).toBe("claimed");
  expect(claim.attemptId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  expect(claim.leaseHash).toMatch(/^[a-f0-9]{32}$/);
  expect(calls[0].name).toBe("claim_stripe_checkout_attempt");
  expect(calls[0].params).not.toHaveProperty("email");
});

test("duplicate webhook dispositions never request finalization", async () => {
  const names: string[] = [];
  const repository = createStripeSafetyRepository(async () => ({
    async rpc(name) {
      names.push(name);
      return { data: { disposition: "duplicate" }, error: null };
    },
  }));
  const claim = await repository.claimWebhook({
    eventId: "evt_duplicate",
    eventType: "customer.subscription.updated",
    providerCreatedAt: "2026-08-15T00:00:00.000Z",
  });

  expect(claim.disposition).toBe("duplicate");
  expect(names).toEqual(["claim_stripe_webhook_event"]);
});

test("raw database errors are replaced with a stable internal error", async () => {
  const repository = createStripeSafetyRepository(async () => ({
    async rpc() {
      return { data: null, error: { message: "raw database details" } };
    },
  }));
  await expect(
    repository.claimCheckout("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ).rejects.toThrow("STRIPE_SAFETY_RPC_FAILED");
});

test("Checkout failure transition rejects a lost CAS", async () => {
  const repository = createStripeSafetyRepository(async () => ({
    async rpc() {
      return { data: false, error: null };
    },
  }));

  await expect(
    repository.failCheckout({
      userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      leaseHash: "c".repeat(32),
      errorCode: "STRIPE_PROVIDER_FAILED",
      retryable: true,
    }),
  ).rejects.toThrow("STRIPE_CHECKOUT_FAILURE_CAS_LOST");
});

test("Webhook failure transition rejects a lost CAS", async () => {
  const repository = createStripeSafetyRepository(async () => ({
    async rpc() {
      return { data: false, error: null };
    },
  }));

  await expect(
    repository.failWebhook({
      eventId: "evt_safe",
      leaseHash: "c".repeat(32),
      errorCode: "STRIPE_PROVIDER_FAILED",
      retryable: true,
    }),
  ).rejects.toThrow("STRIPE_WEBHOOK_FAILURE_CAS_LOST");
});

test("Webhook finalization rejects an unknown disposition", async () => {
  const repository = createStripeSafetyRepository(async () => ({
    async rpc() {
      return { data: { disposition: "unexpected_success" }, error: null };
    },
  }));

  await expect(
    repository.finalizeWebhook({
      eventId: "evt_safe",
      leaseHash: "c".repeat(32),
      userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      customerId: "customer_safe",
      subscriptionId: "subscription_safe",
      plan: "pro",
      billingStatus: "active",
      currentPeriodEnd: "2026-09-15T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    }),
  ).rejects.toThrow("STRIPE_WEBHOOK_FINALIZE_INVALID");
});
