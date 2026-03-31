"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AiQueryModal from "../_components/AiQueryModal";

type SenderStrength = "weak" | "strong";

type SenderCandidate = {
  value: string;
  strength: SenderStrength;
};

function extractFolderId(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const m1 = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];

  const m2 = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];

  if (trimmed.startsWith("http")) return trimmed;

  return trimmed;
}

export default function NewRulePage() {
  const router = useRouter();

  const [driveFolderId, setDriveFolderId] = useState("");
  const [gmailQuery, setGmailQuery] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryLabel, setQueryLabel] = useState("");

  const [aiOpen, setAiOpen] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const normalizedQuery = gmailQuery.trim();

      if (!driveFolderId.trim()) {
        throw new Error("保存先フォルダID（必須）を入力してください");
      }

      if (!normalizedQuery) {
        throw new Error("Gmail検索条件を入力してください");
      }

      const payload = {
        drive_folder_id: driveFolderId.trim(),
        gmail_query: normalizedQuery,
        query_label: queryLabel.trim() || null,
        subject_keywords: null,
        is_active: isActive,
      };

      console.log("NEW RULE payload", payload);
      console.log("driveFolderId", driveFolderId);
      console.log("gmailQuery", gmailQuery);
      console.log("normalizedQuery", normalizedQuery);

      const res = await fetch("/api/rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}) as any);
        throw new Error(json?.error ?? `Failed to create rule (${res.status})`);
      }

      router.push("/rules");
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <main style={page}>
        <div style={container}>
          <div style={header}>
            <div>
              <h1 style={title}>ルール作成</h1>
              <p style={subtitle}>
                保存先フォルダと、対象メールの条件を設定します。
              </p>
            </div>

            <div style={headerActions}>
              <button
                type="button"
                onClick={() => router.push("/rules")}
                disabled={loading}
                style={ghostButton}
              >
                戻る
              </button>
              <button
                type="submit"
                form="newRuleForm"
                disabled={loading}
                style={primaryButton}
              >
                {loading ? "作成中..." : "作成"}
              </button>
            </div>
          </div>

          {error && <div style={errorBox}>エラー: {error}</div>}

          <form id="newRuleForm" onSubmit={onSubmit} style={form}>
            <section style={card}>
              <div style={cardHeader}>
                <div>
                  <div style={cardTitle}>検索条件の説明</div>
                  <div style={cardDesc}>
                    一覧画面で表示される説明文です（任意）
                  </div>
                </div>
              </div>

              <label style={field}>
                <input
                  value={queryLabel}
                  onChange={(e) => setQueryLabel(e.target.value)}
                  placeholder="AmazonのPDF請求書を1週間以内で未読"
                  autoComplete="off"
                  style={input}
                />
              </label>
            </section>
            <section style={card}>
              <div style={cardHeader}>
                <div>
                  <div style={cardTitle}>基本設定</div>
                  <div style={cardDesc}>ルールの有効/無効を設定します。</div>
                </div>
              </div>

              <div style={row}>
                <div style={label}>有効</div>
                <div style={valueLine}>
                  <label style={toggle}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    <span style={toggleText}>{isActive ? "ON" : "OFF"}</span>
                  </label>
                </div>
              </div>
            </section>

            <section style={card}>
              <div style={cardHeader}>
                <div>
                  <div style={cardTitle}>保存先</div>
                  <div style={cardDesc}>
                    PDFの保存先となるGoogle Driveフォルダを指定します。
                  </div>
                </div>
              </div>

              <label style={field}>
                <span style={fieldLabel}>
                  保存先フォルダID <span style={required}>必須</span>
                </span>
                <input
                  value={driveFolderId}
                  onChange={(e) =>
                    setDriveFolderId(extractFolderId(e.target.value))
                  }
                  placeholder="例: 1CGAvmhGiiOjGEulmP6MtXhE0yubKhlgF"
                  autoComplete="off"
                  required
                  style={input}
                />
                <span style={help}>
                  フォルダURLの <code>/folders/</code> の後ろの文字列です。
                </span>
              </label>
            </section>

            <section style={card}>
              <div style={cardHeader}>
                <div>
                  <div style={cardTitle}>メール条件</div>
                </div>
              </div>

              <label style={field}>
                <div style={fieldLabelRow}>
                  <span style={fieldLabel}>
                    Gmail検索条件 <span style={required}>必須</span>
                  </span>

                  <div style={inlineActions}>
                    <button
                      type="button"
                      onClick={() => setAiOpen(true)}
                      style={aiButton}
                    >
                      ✨ AI生成
                    </button>

                    <a
                      href="https://support.google.com/mail/answer/7190"
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Gmail検索の書き方（Google公式）"
                      style={helpLink}
                    >
                      ?
                    </a>
                  </div>
                </div>

                <textarea
                  value={gmailQuery}
                  onChange={(e) => setGmailQuery(e.target.value)}
                  placeholder="例: label:INBOX is:unread newer_than:7d subject:(請求書)"
                  rows={5}
                  spellCheck={false}
                  style={textarea}
                />
              </label>
            </section>

            <div style={footerActions}>
              <button
                type="button"
                onClick={() => router.push("/rules")}
                disabled={loading}
                style={ghostButton}
              >
                戻る
              </button>
              <button type="submit" disabled={loading} style={primaryButton}>
                {loading ? "作成中..." : "作成"}
              </button>
            </div>
          </form>
        </div>
      </main>

      <AiQueryModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onApply={(result) => {
          setGmailQuery(result);
        }}
      />
    </>
  );
}

const page: React.CSSProperties = {
  padding: "24px 16px 40px",
};

const container: React.CSSProperties = {
  maxWidth: 880,
  margin: "0 auto",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 20,
};

const title: React.CSSProperties = {
  margin: 0,
  fontSize: 28,
  lineHeight: 1.2,
  fontWeight: 800,
  color: "#0f172a",
};

const subtitle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#64748b",
  fontSize: 14,
  lineHeight: 1.6,
};

const headerActions: React.CSSProperties = {
  display: "flex",
  gap: 12,
};

const form: React.CSSProperties = {
  display: "grid",
  gap: 18,
};

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

const cardHeader: React.CSSProperties = {
  marginBottom: 16,
};

const cardTitle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: "#0f172a",
};

const cardDesc: React.CSSProperties = {
  marginTop: 6,
  fontSize: 14,
  lineHeight: 1.6,
  color: "#64748b",
};

const row: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const label: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#334155",
};

const valueLine: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const toggle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
};

const toggleText: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#0f172a",
};

const field: React.CSSProperties = {
  display: "grid",
  gap: 8,
};

const fieldLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#0f172a",
};

const fieldLabelRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const inlineActions: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const required: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 12,
  fontWeight: 700,
  color: "#4f46e5",
  background: "rgba(79, 70, 229, 0.08)",
  padding: "2px 8px",
  borderRadius: 999,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.14)",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  lineHeight: 1.5,
  boxSizing: "border-box",
};

const textarea: React.CSSProperties = {
  width: "100%",
  minHeight: 140,
  padding: "14px 16px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  lineHeight: 1.6,
  resize: "vertical",
  boxSizing: "border-box",
};

const help: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: "#64748b",
};

const primaryButton: React.CSSProperties = {
  padding: "11px 16px",
  borderRadius: 12,
  border: "1px solid #1d4ed8",
  background: "#2563eb",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButton: React.CSSProperties = {
  padding: "11px 16px",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const aiButton: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const helpLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 999,
  background: "rgba(37, 99, 235, 0.12)",
  color: "#1d4ed8",
  fontSize: 13,
  fontWeight: 800,
  textDecoration: "none",
};

const footerActions: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 12,
  marginTop: 6,
};

const errorBox: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#b91c1c",
  fontSize: 14,
};

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 1000,
};

const aiModal: React.CSSProperties = {
  width: "100%",
  maxWidth: 640,
  background: "#ffffff",
  borderRadius: 20,
  boxShadow: "0 24px 80px rgba(15, 23, 42, 0.18)",
  border: "1px solid rgba(15, 23, 42, 0.08)",
  padding: 20,
};

const aiModalHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
};

const aiModalTitle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  color: "#0f172a",
};

const aiModalClose: React.CSSProperties = {
  border: "none",
  background: "transparent",
  fontSize: 24,
  lineHeight: 1,
  cursor: "pointer",
  color: "#64748b",
};

const aiModalText: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 14,
  lineHeight: 1.6,
  color: "#475569",
};

const aiTextarea: React.CSSProperties = {
  width: "100%",
  minHeight: 120,
  padding: "14px 16px",
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.14)",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  lineHeight: 1.6,
  resize: "vertical",
  boxSizing: "border-box",
};

const aiExamples: React.CSSProperties = {
  marginTop: 16,
  display: "grid",
  gap: 8,
};

const aiExamplesTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#475569",
};

const aiExample: React.CSSProperties = {
  border: "none",
  background: "transparent",
  textAlign: "left",
  padding: 0,
  color: "#313131",
  fontSize: 12,
  cursor: "pointer",
};

const aiPreviewBox: React.CSSProperties = {
  marginTop: 16,
  padding: 14,
  borderRadius: 14,
  background: "#eef7ff",
  border: "1px solid rgba(15, 23, 42, 0.08)",
};

const aiPreviewLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#475569",
  marginBottom: 8,
};

const aiPreviewCode: React.CSSProperties = {
  display: "block",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 14,
  lineHeight: 1.6,
  color: "#0f172a",
};

const aiModalActions: React.CSSProperties = {
  marginTop: 18,
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  flexWrap: "wrap",
};

const aiGhostButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  color: "#0f172a",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const aiPrimaryButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid #1d4ed8",
  background: "#2563eb",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};
