"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRuleStatus } from "@/lib/rules/status";
import styles from "./RuleEditPage.module.css";

type Rule = {
  id: string;
  is_active: boolean;
  run_timing: string | null;
  drive_folder_id: string | null;
  gmail_query: string | null;
  subject_keywords?: any;
  updated_at: string | null;
};

function normalizeQuery(q: unknown) {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s || s === "-") return null;
  return s;
}

function parseKeywords(input: string) {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildGmailQueryFromKeywords(keywords: string[]) {
  const subjectPart =
    keywords.length > 0
      ? ` subject:(${keywords.map((k) => `"${k.replace(/"/g, "")}"`).join(" OR ")})`
      : "";
  return `label:INBOX is:unread newer_than:7d${subjectPart}`;
}

function extractFolderId(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";

  // 1) /folders/<id>
  const m1 = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];

  // 2) ?id=<id> や open?id=<id>
  const m2 = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return m2[1];

  // 3) URLっぽいが抽出できなかった場合は壊さない
  if (trimmed.startsWith("http")) return trimmed;

  // 4) 生ID
  return trimmed;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 古い環境用フォールバック
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

export default function RuleEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const ruleId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rule, setRule] = useState<Rule | null>(null);

  // フォーム項目
  const [isActive, setIsActive] = useState<boolean>(true);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [subjectKeywordsText, setSubjectKeywordsText] = useState("");

  const keywords = useMemo(
    () => parseKeywords(subjectKeywordsText),
    [subjectKeywordsText],
  );
  const previewQuery = useMemo(
    () => buildGmailQueryFromKeywords(keywords),
    [keywords],
  );

  const currentQuery = normalizeQuery(rule?.gmail_query);

  const [copiedId, setCopiedId] = useState(false);
  const [copiedQuery, setCopiedQuery] = useState(false);

  useEffect(() => {
    if (!ruleId) {
      setError("id is required");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/rules/${ruleId}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          data?: Rule;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(json?.error ?? `Failed to load rule (${res.status})`);
        }
        if (!json.data) {
          throw new Error("Rule not found");
        }
        if (cancelled) return;

        const found = json.data;

        // needs_setup のときは UI 側で OFF にする（既存の意図を維持）
        const status = getRuleStatus(found);
        const normalized =
          status.status === "needs_setup"
            ? { ...found, is_active: false }
            : found;

        setRule(normalized);

        // ✅ フォーム初期値をルールから反映（ここが抜けてた）
        setIsActive(!!normalized.is_active);
        setDriveFolderId(normalized.drive_folder_id ?? "");

        const sk = (normalized as any).subject_keywords;
        const initialKeywords = Array.isArray(sk) ? sk.map(String) : [];
        setSubjectKeywordsText(initialKeywords.join(", "));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unexpected error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [ruleId]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (!driveFolderId.trim()) {
        throw new Error("保存先フォルダID（必須）を入力してください");
      }

      const payload = {
        drive_folder_id: driveFolderId.trim(),
        subject_keywords: keywords.length ? keywords : null,
        gmail_query: previewQuery, // ★必ず送る（現状の仕様を維持）
        is_active: isActive,
      };

      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to update rule (${res.status})`);
      }

      router.push("/rules");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>ルール編集</h1>
            <p className={styles.subtitle}>
              保存先フォルダと、対象メールの条件を設定します。
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => router.push("/rules")}
              disabled={saving}
            >
              戻る
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => {
                // form submit を呼ぶ
                const form = document.getElementById(
                  "ruleEditForm",
                ) as HTMLFormElement | null;
                form?.requestSubmit();
              }}
              disabled={saving || loading || !rule}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        {loading && <div className={styles.notice}>読み込み中...</div>}
        {error && <div className={styles.error}>エラー: {error}</div>}

        {!loading && rule && (
          <form id="ruleEditForm" onSubmit={onSave} className={styles.form}>
            {/* Card: 基本設定 */}
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>基本設定</div>
                  <div className={styles.cardDesc}>
                    ルールIDと有効/無効を管理します。
                  </div>
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.label}>ルールID</div>
                <div className={styles.valueLine}>
                  <code className={styles.mono}>{rule.id}</code>
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={async () => {
                      const ok = await copyToClipboard(rule.id);
                      if (ok) {
                        setCopiedId(true);
                        setTimeout(() => setCopiedId(false), 900);
                      }
                    }}
                  >
                    {copiedId ? "コピーしました" : "コピー"}
                  </button>
                </div>
              </div>

              <div className={styles.row}>
                <div className={styles.label}>有効</div>
                <div className={styles.valueLine}>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    <span className={styles.toggleUi} />
                    <span className={styles.toggleText}>
                      {isActive ? "ON" : "OFF"}
                    </span>
                  </label>
                </div>
              </div>
            </section>

            {/* Card: 保存先 */}
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>保存先</div>
                  <div className={styles.cardDesc}>
                    PDFの保存先となるGoogle Driveフォルダを指定します。
                  </div>
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  保存先フォルダID <span className={styles.required}>必須</span>
                </span>
                <input
                  className={styles.input}
                  value={driveFolderId}
                  onChange={(e) =>
                    setDriveFolderId(extractFolderId(e.target.value))
                  }
                  placeholder="例: 1CGAvmhGiiOjGEulmP6MtXhE0yubKhlgF"
                  autoComplete="off"
                />
                <span className={styles.help}>
                  フォルダURLの{" "}
                  <code className={styles.monoInline}>/folders/</code>{" "}
                  の後ろの文字列です。
                </span>
              </label>
            </section>

            {/* Card: メール条件 */}
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>メール条件</div>
                  <div className={styles.cardDesc}>
                    件名キーワードからGmail検索条件（保存値）を自動生成します。
                  </div>
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  件名キーワード（任意）
                </span>
                <input
                  className={styles.input}
                  value={subjectKeywordsText}
                  onChange={(e) => setSubjectKeywordsText(e.target.value)}
                  placeholder="例: 請求書, 領収書, 明細"
                  autoComplete="off"
                />
                <span className={styles.help}>
                  カンマ区切り。入力すると件名に含まれるメールだけを対象にします。
                </span>
              </label>

              <div className={styles.field}>
                <div
                  className={styles.fieldLabel}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <span>Gmail検索条件（保存される値）</span>
                  <a
                    href="https://support.google.com/mail/answer/7190"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Gmail検索の書き方（Google公式）"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#e5e7eb",
                      color: "#374151",
                      fontSize: 12,
                      textDecoration: "none",
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    ?
                  </a>
                </div>
                <div className={styles.queryBox}>
                  <code className={styles.monoWrap}>{previewQuery}</code>
                </div>
                <div className={styles.queryActions}>
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={async () => {
                      const ok = await copyToClipboard(previewQuery);
                      if (ok) {
                        setCopiedQuery(true);
                        setTimeout(() => setCopiedQuery(false), 900);
                      }
                    }}
                  >
                    {copiedQuery ? "コピーしました" : "コピー"}
                  </button>

                  {currentQuery && currentQuery !== previewQuery && (
                    <span className={styles.muted}>
                      現在の保存値と差分があります（保存で更新）
                    </span>
                  )}
                  {!currentQuery && (
                    <span className={styles.muted}>現在の保存値：未設定</span>
                  )}
                </div>

                {/* DB値は「参考」扱いで小さく */}
                <div className={styles.dbValue}>
                  <div className={styles.dbLabel}>現在の保存値</div>
                  <div className={styles.dbText}>
                    {currentQuery ?? "未設定"}
                  </div>
                </div>
              </div>
            </section>

            {/* Footer actions (モバイル/下部用) */}
            <div className={styles.footerActions}>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => router.push("/rules")}
                disabled={saving}
              >
                戻る
              </button>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={saving}
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
