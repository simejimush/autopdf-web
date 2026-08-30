import { logAiUsage } from "@/lib/ai/logAiUsage";
import {
  OPENAI_MAX_INPUT_TOKENS,
  OPENAI_MAX_OUTPUT_TOKENS,
  OPENAI_TIMEOUT_MS,
} from "@/lib/cost-safety/limits";

type DetectDocumentTypeParams = {
  userId?: string | null;
  ruleId?: string | null;
  runId?: string | null;
  subject?: string | null;
  from?: string | null;
  bodyText?: string | null;
  attachmentFilenames?: string[];
  timeoutMs?: number;
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

const OPENAI_INPUT_ENVELOPE_BYTES = OPENAI_MAX_INPUT_TOKENS * 2;

function clipUtf8Text(value: string, maxBytes: number) {
  let result = "";
  let usedBytes = 0;

  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (usedBytes + characterBytes > maxBytes) break;
    result += character;
    usedBytes += characterBytes;
  }

  return result;
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

  const subject = clipUtf8Text(params.subject ?? "", 600);
  const from = clipUtf8Text(params.from ?? "", 400);
  const bodyText = clipUtf8Text(
    params.bodyText ?? "",
    OPENAI_INPUT_ENVELOPE_BYTES,
  );
  const attachmentFilenames = (params.attachmentFilenames ?? [])
    .map((name) => clipUtf8Text(name, 240))
    .slice(0, 5);
  const aiInput = clipUtf8Text(
    JSON.stringify({ subject, from, bodyText, attachmentFilenames }),
    OPENAI_INPUT_ENVELOPE_BYTES,
  );

  const requestTimeoutMs = Math.min(
    params.timeoutMs ?? OPENAI_TIMEOUT_MS,
    OPENAI_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

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
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        input: [
          {
            role: "system",
            content:
              "あなたはメール書類の分類器です。次の候補から最も近い1つだけを日本語で返してください: 領収書, 請求書, 見積書, 納品書, 明細, 書類。説明や記号は不要です。",
          },
          {
            role: "user",
            content: aiInput,
          },
        ],
      }),
      signal: controller.signal,
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
    console.warn("[detectDocumentTypeWithAi] failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });

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
  } finally {
    clearTimeout(timeout);
  }
}
