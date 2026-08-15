export type RpcResult = Readonly<{ data: unknown; error: unknown }>;

export type StripeSafetyClient = Readonly<{
  rpc(name: string, params: Record<string, unknown>): Promise<RpcResult>;
}>;

type CheckoutClaim = Readonly<{
  disposition:
    | "claimed"
    | "busy"
    | "session_ready"
    | "terminal_failed"
    | "owner_invalid";
  attemptId?: string;
  customerId?: string;
  sessionId?: string;
  leaseHash: string;
}>;

type WebhookClaim = Readonly<{
  disposition: "claimed" | "duplicate" | "in_progress" | "conflict";
  leaseHash: string;
}>;

type WebhookFinalizeDisposition =
  | "processed"
  | "stale"
  | "retryable_failed"
  | "terminal_failed"
  | "lost_claim";

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("STRIPE_SAFETY_RPC_INVALID_RESPONSE");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function leaseHash() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function createStripeSafetyRepository(
  getClient: () => Promise<StripeSafetyClient>,
) {
  async function rpc(name: string, params: Record<string, unknown>) {
    const client = await getClient();
    const result = await client.rpc(name, params);
    if (result.error) throw new Error("STRIPE_SAFETY_RPC_FAILED");
    return result.data;
  }

  return {
    async claimCheckout(userId: string): Promise<CheckoutClaim> {
      const lease = leaseHash();
      const row = objectValue(
        await rpc("claim_stripe_checkout_attempt", {
          p_user_id: userId,
          p_lease_hash: lease,
          p_now: new Date().toISOString(),
        }),
      );
      const disposition = requiredString(
        row.disposition,
        "STRIPE_CHECKOUT_CLAIM_INVALID",
      ) as CheckoutClaim["disposition"];
      if (
        ![
          "claimed",
          "busy",
          "session_ready",
          "terminal_failed",
          "owner_invalid",
        ].includes(disposition)
      ) {
        throw new Error("STRIPE_CHECKOUT_CLAIM_INVALID");
      }
      return {
        disposition,
        attemptId: optionalString(row.attempt_id),
        customerId: optionalString(row.customer_id),
        sessionId: optionalString(row.session_id),
        leaseHash: lease,
      };
    },

    async recordCheckoutCustomer(input: {
      userId: string;
      attemptId: string;
      leaseHash: string;
      customerId: string;
    }) {
      const saved = await rpc("record_stripe_checkout_customer", {
        p_user_id: input.userId,
        p_attempt_id: input.attemptId,
        p_lease_hash: input.leaseHash,
        p_customer_id: input.customerId,
        p_now: new Date().toISOString(),
      });
      if (saved !== true) throw new Error("STRIPE_CHECKOUT_CUSTOMER_CAS_LOST");
    },

    async recordCheckoutSession(input: {
      userId: string;
      attemptId: string;
      leaseHash: string;
      sessionId: string;
    }) {
      const saved = await rpc("record_stripe_checkout_session", {
        p_user_id: input.userId,
        p_attempt_id: input.attemptId,
        p_lease_hash: input.leaseHash,
        p_session_id: input.sessionId,
        p_now: new Date().toISOString(),
      });
      if (saved !== true) throw new Error("STRIPE_CHECKOUT_SESSION_CAS_LOST");
    },

    async expireCheckoutSession(input: {
      userId: string;
      attemptId: string;
      sessionId: string;
    }) {
      const closed = await rpc("expire_stripe_checkout_session", {
        p_user_id: input.userId,
        p_attempt_id: input.attemptId,
        p_session_id: input.sessionId,
        p_now: new Date().toISOString(),
      });
      if (closed !== true) throw new Error("STRIPE_CHECKOUT_EXPIRE_CAS_LOST");
    },

    async failCheckout(input: {
      userId: string;
      attemptId: string;
      leaseHash: string;
      errorCode: string;
      retryable: boolean;
    }) {
      const failed = await rpc("fail_stripe_checkout_attempt", {
        p_user_id: input.userId,
        p_attempt_id: input.attemptId,
        p_lease_hash: input.leaseHash,
        p_error_code: input.errorCode,
        p_retryable: input.retryable,
        p_now: new Date().toISOString(),
      });
      if (failed !== true) throw new Error("STRIPE_CHECKOUT_FAILURE_CAS_LOST");
    },

    async claimWebhook(input: {
      eventId: string;
      eventType: string;
      providerCreatedAt: string;
    }): Promise<WebhookClaim> {
      const lease = leaseHash();
      const row = objectValue(
        await rpc("claim_stripe_webhook_event", {
          p_event_id: input.eventId,
          p_event_type: input.eventType,
          p_provider_created_at: input.providerCreatedAt,
          p_now: new Date().toISOString(),
          p_lease_hash: lease,
        }),
      );
      const disposition = requiredString(
        row.disposition,
        "STRIPE_WEBHOOK_CLAIM_INVALID",
      ) as WebhookClaim["disposition"];
      if (
        !["claimed", "duplicate", "in_progress", "conflict"].includes(
          disposition,
        )
      ) {
        throw new Error("STRIPE_WEBHOOK_CLAIM_INVALID");
      }
      return { disposition, leaseHash: lease };
    },

    async finalizeWebhook(input: {
      eventId: string;
      leaseHash: string;
      userId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      plan: "free" | "pro" | "pro_plus";
      billingStatus: string | null;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
    }) {
      const row = objectValue(
        await rpc("finalize_stripe_webhook_event", {
          p_event_id: input.eventId,
          p_lease_hash: input.leaseHash,
          p_user_id: input.userId,
          p_customer_id: input.customerId,
          p_subscription_id: input.subscriptionId,
          p_plan: input.plan,
          p_billing_status: input.billingStatus,
          p_current_period_end: input.currentPeriodEnd,
          p_cancel_at_period_end: input.cancelAtPeriodEnd,
          p_now: new Date().toISOString(),
        }),
      );
      const disposition = requiredString(
        row.disposition,
        "STRIPE_WEBHOOK_FINALIZE_INVALID",
      );
      if (
        ![
          "processed",
          "stale",
          "retryable_failed",
          "terminal_failed",
          "lost_claim",
        ].includes(disposition)
      ) {
        throw new Error("STRIPE_WEBHOOK_FINALIZE_INVALID");
      }
      return disposition as WebhookFinalizeDisposition;
    },

    async failWebhook(input: {
      eventId: string;
      leaseHash: string;
      errorCode: string;
      retryable: boolean;
    }) {
      const failed = await rpc("fail_stripe_webhook_event", {
        p_event_id: input.eventId,
        p_lease_hash: input.leaseHash,
        p_error_code: input.errorCode,
        p_retryable: input.retryable,
        p_now: new Date().toISOString(),
      });
      if (failed !== true) throw new Error("STRIPE_WEBHOOK_FAILURE_CAS_LOST");
    },
  };
}
