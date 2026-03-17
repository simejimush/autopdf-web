"use client";

import { useEffect, useState } from "react";
import { generateAiQuery } from "./aiQueryGenerator";

type Props = {
  open: boolean;
  title?: string;
  initialInput?: string;
  generating?: boolean;
  onClose: () => void;
  onApply: (result: string) => void;
};

const EXAMPLES = [
  "AmazonのPDF請求書を1週間以内で未読、広告は除く",
  "楽天の領収書メール",
  "StripeのCSV明細",
  "Googleから届いた見積書PDF",
];

export default function AiQueryModal({
  open,
  title = "Gmail検索条件をAIで作成",
  initialInput = "",
  generating = false,
  onClose,
  onApply,
}: Props) {
  const [input, setInput] = useState(initialInput);
  const [result, setResult] = useState("");
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (open) {
      setInput(initialInput);
      setResult("");
      setError("");
      setLocalLoading(false);
      setPreviewCount(null);
      setPreviewLoading(false);
      setPreviewError("");
    }
  }, [open, initialInput]);

  if (!open) return null;

  const isLoading = generating || localLoading;

  async function fetchPreviewCount(query: string) {
    const trimmed = query.trim();

    if (!trimmed) {
      setPreviewCount(null);
      setPreviewError("");
      return;
    }

    setPreviewLoading(true);
    setPreviewError("");
    setPreviewCount(null);

    try {
      const res = await fetch("/api/gmail/preview-count", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: trimmed }),
      });

      const json = (await res.json().catch(() => null)) as {
        count?: number;
        error?: string;
      } | null;

      if (!res.ok) {
        if (json?.error === "GOOGLE_NOT_CONNECTED") {
          setPreviewError("Googleが未接続です");
          return;
        }

        if (json?.error === "QUERY_REQUIRED") {
          setPreviewError("検索条件が空です");
          return;
        }

        if (json?.error === "QUERY_TOO_LONG") {
          setPreviewError("検索条件が長すぎます");
          return;
        }

        if (json?.error === "GOOGLE_REFRESH_TOKEN_MISSING") {
          setPreviewError("Google接続の再設定が必要です");
          return;
        }

        if (json?.error === "GOOGLE_TOKEN_REFRESH_FAILED") {
          setPreviewError("Google接続の再設定が必要です");
          return;
        }

        setPreviewError("検索件数の取得に失敗しました");
        return;
      }

      setPreviewCount(typeof json?.count === "number" ? json.count : 0);
    } catch (e) {
      console.error(e);
      setPreviewError("検索件数の取得に失敗しました");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleGenerate() {
    const text = input.trim();
    if (!text) return;

    setError("");
    setPreviewCount(null);
    setPreviewError("");
    setLocalLoading(true);

    try {
      const generated = generateAiQuery(text);
      const query = generated.query ?? "";

      setResult(query);

      if (query) {
        onApply(query);
        await fetchPreviewCount(query);
      }
    } catch (e) {
      console.error(e);
      setError("生成に失敗しました");
      setResult("");
      setPreviewCount(null);
      setPreviewError("");
    } finally {
      setLocalLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#fff",
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 20px 60px rgba(15, 23, 42, 0.24)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            color: "#0f172a",
          }}
        >
          {title}
        </h3>

        <div style={{ marginTop: 14 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例: AmazonのPDF請求書を1週間以内で未読、広告は除く"
            style={{
              width: "100%",
              minHeight: 112,
              borderRadius: 12,
              border: "1px solid rgba(15, 23, 42, 0.12)",
              padding: 12,
              fontSize: 14,
              lineHeight: 1.6,
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: 14,
            lineHeight: 1.8,
            color: "#475569",
          }}
        >
          例:
          <div style={{ marginTop: 4, display: "grid", gap: 4 }}>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setInput(example)}
                style={{
                  textAlign: "left",
                  border: 0,
                  background: "transparent",
                  padding: 0,
                  color: "#475569",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div
            style={{
              marginBottom: 8,
              fontSize: 13,
              fontWeight: 600,
              color: "#334155",
            }}
          >
            生成結果
          </div>

          <div
            style={{
              minHeight: 72,
              background: "#eef2ff",
              border: "1px solid #e0e7ff",
              borderRadius: 10,
              padding: 14,
              fontSize: 14,
              lineHeight: 1.7,
              color: error ? "#b91c1c" : "#334155",
              whiteSpace: "pre-wrap",
            }}
          >
            {error || result || "ここに生成結果が表示されます"}
          </div>
        </div>

        {(previewLoading || previewError || previewCount !== null) && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                marginBottom: 8,
                fontSize: 13,
                fontWeight: 600,
                color: "#334155",
              }}
            >
              検索結果プレビュー
            </div>

            <div
              style={{
                minHeight: 52,
                background: "#f8fafc",
                border: "1px solid rgba(15, 23, 42, 0.08)",
                borderRadius: 10,
                padding: 14,
                fontSize: 14,
                lineHeight: 1.7,
                color: previewError
                  ? "#b91c1c"
                  : previewCount === 0
                    ? "#b91c1c"
                    : previewCount !== null && previewCount > 200
                      ? "#b45309"
                      : previewCount !== null && previewCount > 50
                        ? "#b45309"
                        : "#166534",
                whiteSpace: "pre-wrap",
              }}
            >
              {previewLoading
                ? "件数を確認中..."
                : previewError
                  ? previewError
                  : previewCount === 0
                    ? "この条件ではメールが見つかりません（0件）"
                    : previewCount !== null && previewCount > 200
                      ? `${previewCount}件見つかりました（推定）。条件が広い場合、大量のPDFが作成される可能性があります。必要に応じて条件を調整してください`
                      : previewCount !== null && previewCount > 50
                        ? `${previewCount}件見つかりました（推定）。条件を少し絞ると精度が上がる可能性があります`
                        : `${previewCount}件見つかりました（推定）`}
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 18,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "1px solid rgba(15, 23, 42, 0.12)",
              background: "#fff",
              color: "#334155",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            閉じる
          </button>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isLoading || !input.trim()}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: 0,
              background: "#2563eb",
              color: "#fff",
              fontWeight: 600,
              cursor: isLoading || !input.trim() ? "not-allowed" : "pointer",
              opacity: isLoading || !input.trim() ? 0.5 : 1,
            }}
          >
            {isLoading ? "生成中..." : "生成して反映"}
          </button>
        </div>
      </div>
    </div>
  );
}
