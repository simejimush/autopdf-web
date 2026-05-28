import { supabaseAdmin } from "@/lib/supabase/admin";

type LogAiUsageParams = {
  userId?: string | null;
  ruleId?: string | null;
  runId?: string | null;
  feature: string;
  provider?: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  status?: "success" | "error";
  errorCode?: string | null;
};

export async function logAiUsage(params: LogAiUsageParams) {
  if (!params.userId) {
    return;
  }

  try {
    const inputTokens = Number(params.inputTokens ?? 0);
    const outputTokens = Number(params.outputTokens ?? 0);
    const totalTokens = Number(
      params.totalTokens ?? inputTokens + outputTokens,
    );

    const { error } = await supabaseAdmin.from("ai_usage_logs").insert({
      user_id: params.userId,
      rule_id: params.ruleId ?? null,
      run_id: params.runId ?? null,
      feature: params.feature,
      provider: params.provider ?? "openai",
      model: params.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: params.estimatedCostUsd ?? null,
      status: params.status ?? "success",
      error_code: params.errorCode ?? null,
    });

    if (error) {
      console.warn("[logAiUsage] insert failed:", {
        message: error.message,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown AI usage log error";

    console.warn("[logAiUsage] failed:", message);
  }
}
