export type EffectivePlan = "free" | "pro" | "pro_plus";

type BillingLike = {
  plan?: string | null;
  billing_status?: string | null;
  current_period_end?: string | null;
};

function normalizePaidPlan(plan?: string | null): EffectivePlan {
  if (plan === "pro_plus") return "pro_plus";
  return "pro";
}

export function resolveEffectivePlan(
  input: BillingLike | null | undefined,
): EffectivePlan {
  const plan = input?.plan ?? "free";
  const billingStatus = input?.billing_status ?? null;
  const currentPeriodEnd = input?.current_period_end ?? null;

  if (billingStatus === "active" || billingStatus === "trialing") {
    return normalizePaidPlan(plan);
  }

  if (billingStatus === "canceled" && currentPeriodEnd) {
    const endMs = new Date(currentPeriodEnd).getTime();

    if (!Number.isNaN(endMs) && endMs > Date.now()) {
      return normalizePaidPlan(plan);
    }
  }

  return "free";
}
