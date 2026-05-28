import { logAiUsage } from "@/lib/ai/logAiUsage";

type DetectDocumentTypeParams = {
  userId?: string | null;
  ruleId?: string | null;
  runId?: string | null;
  subject?: string | null;
  from?: string | null;
  bodyText?: string | null;
  attachmentFilenames?: string[];
};

const ALLOWED_DOCUMENT_TYPES = new Set([
  "領収書",
  "請求書",
  "見積書",
  "納品書",
  "明細",
  "書類",
]);

function normalizeDocumentType(value?: string | null) {
  const cleaned = (value ?? "").trim();

  if (ALLOWED_DOCUMENT_TYPES.has(cleaned)) {
    return cleaned;
  }

  return null;
}

function clipText(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function extractOutputText(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const maybeOutputText = (data as { output_text?: unknown }).output_text;

  if (typeof maybeOutputText === "string") {
    return maybeOutputText;
  }

  return null;
}

function extractUsage(data: unknown) {
  if (!data || typeof data !== "object") {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  const usage = (data as { usage?: unknown }).usage;

  if (!usage || typeof usage !== "object") {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  const inputTokens = Number(
    (usage as { input_tokens?: unknown }).input_tokens ?? 0,
  );
  const outputTokens = Number(
    (usage as { output_tokens?: unknown }).output_tokens ?? 0,
  );
  const totalTokens = Number(
    (usage as { total_tokens?: unknown }).total_tokens ??
      inputTokens + outputTokens,
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export async function detectDocumentTypeWithAi(
  params: DetectDocumentTypeParams,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = "gpt-4.1-nano";

  if (!apiKey) {
    return null;
  }

  const subject = clipText(params.subject ?? "", 300);
  const from = clipText(params.from ?? "", 200);
  const bodyText = clipText(params.bodyText ?? "", 1200);
  const attachmentFilenames = (params.attachmentFilenames ?? [])
    .map((name) => clipText(name, 120))
    .slice(0, 10);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_output_tokens: 20,
        input: [
          {
            role: "system",
            content:
              "あなたはメール書類の分類器です。次の候補から最も近い1つだけを日本語で返してください: 領収書, 請求書, 見積書, 納品書, 明細, 書類。説明や記号は不要です。",
          },
          {
            role: "user",
            content: JSON.stringify({
              subject,
              from,
              bodyText,
              attachmentFilenames,
            }),
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("[detectDocumentTypeWithAi] OpenAI request failed:", {
        status: res.status,
      });

      await logAiUsage({
        userId: params.userId,
        ruleId: params.ruleId,
        runId: params.runId,
        feature: "document_type_detection",
        provider: "openai",
        model,
        status: "error",
        errorCode: `OPENAI_HTTP_${res.status}`,
      });

      return null;
    }

    const data = await res.json();
    const outputText = extractOutputText(data);
    const usage = extractUsage(data);

    await logAiUsage({
      userId: params.userId,
      ruleId: params.ruleId,
      runId: params.runId,
      feature: "document_type_detection",
      provider: "openai",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      status: "success",
    });

    return normalizeDocumentType(outputText);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown AI classification error";

    console.warn("[detectDocumentTypeWithAi] failed:", message);

    await logAiUsage({
      userId: params.userId,
      ruleId: params.ruleId,
      runId: params.runId,
      feature: "document_type_detection",
      provider: "openai",
      model,
      status: "error",
      errorCode: "OPENAI_REQUEST_FAILED",
    });

    return null;
  }
}
