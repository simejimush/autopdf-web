"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRuleStatus } from "@/lib/rules/status";
import styles from "./RuleEditPage.module.css";
import AiQueryModal from "../_components/AiQueryModal";

type Rule = {
  id: string;
  is_active: boolean;
  run_timing: string | null;
  drive_folder_id: string | null;
  gmail_query: string | null;
  subject_keywords?: any;
  updated_at: string | null;
  query_label: string | null;
};

type SenderStrength = "weak" | "strong";

type SenderCandidate = {
  value: string;
  strength: SenderStrength;
};

function normalizeQuery(q: unknown) {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s || s === "-") return "";
  return s;
}

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

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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

const loadingText: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const loadingDots: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  position: "relative",
  width: 28,
  height: 8,
};

const loadingDotBase: React.CSSProperties = {
  position: "absolute",
  top: 0,
  width: 8,
  height: 8,
  borderRadius: "999px",
  background: "#ffffff",
  animation: "ap-dot-flashing 1s infinite linear alternate",
};

export default function RuleEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const ruleId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rule, setRule] = useState<Rule | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTick, setToastTick] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const [isActive, setIsActive] = useState<boolean>(true);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [gmailQuery, setGmailQuery] = useState("");
  const [queryLabel, setQueryLabel] = useState("");
  const [dirty, setDirty] = useState(false);
  const [queryWarnings, setQueryWarnings] = useState<string[]>([]);

  const [copiedId, setCopiedId] = useState(false);
  const [copiedQuery, setCopiedQuery] = useState(false);

  const handleApplyAiQuery = (nextQuery: string) => {
    const normalized = String(nextQuery ?? "").trim();
    if (!normalized) return;

    setGmailQuery(normalized);
    setQueryWarnings(validateGmailQuery(normalized));
    setAiOpen(false);
    setDirty(true);
    setToast("Gmail検索条件に反映しました");
    setTimeout(() => {
      setToast(null);
    }, 3000);
    setToastTick((v) => v + 1);
  };

  function generateQuery() {
    const text = aiPrompt.trim();

    if (!text) {
      setAiResult("");
      return;
    }

    setAiLoading(true);

    try {
      const normalizedText = text
        .replace(/[　\t\r\n]+/g, " ")
        .replace(/１週間/g, "1週間")
        .replace(/一週間/g, "1週間")
        .replace(/今週中/g, "今週")
        .replace(/七日/g, "7日")
        .replace(/３日/g, "3日")
        .replace(/三日/g, "3日")
        .replace(/３日以内/g, "3日以内")
        .replace(/三日以内/g, "3日以内")
        .replace(/１か月/g, "1か月")
        .replace(/一か月/g, "1か月")
        .replace(/１ヶ月/g, "1ヶ月")
        .replace(/一ヶ月/g, "1ヶ月")
        .replace(/今日中/g, "今日")
        .replace(/本日/g, "今日")
        .replace(/きょう/g, "今日")
        .replace(/きのう/g, "昨日")
        .replace(/未開封/g, "未読")
        .replace(/ＰＤＦ/gi, "PDF")
        .replace(/ｐｄｆ/gi, "PDF")
        .replace(/エクセル/g, "Excel")
        .replace(/excel/gi, "Excel")
        .replace(/アマゾン/g, "Amazon")
        .replace(/ヤフー/g, "Yahoo")
        .replace(/ペイパル/g, "PayPal")
        .replace(/ストライプ/g, "Stripe")
        .replace(/グーグル/g, "Google")
        .replace(/ラクテン/g, "楽天")
        .replace(/\s+/g, " ")
        .trim();

      const fromParts: string[] = [];
      const subjectParts: string[] = [];
      const fileParts: string[] = [];
      const periodParts: string[] = [];
      const stateParts: string[] = [];
      const attachmentParts: string[] = [];
      const excludes: string[] = [];

      const senderAliasMap: Array<[string, SenderCandidate]> = [
        ["Amazon", { value: "amazon", strength: "weak" }],
        ["amazon", { value: "amazon", strength: "weak" }],
        ["楽天", { value: "rakuten", strength: "weak" }],
        ["rakuten", { value: "rakuten", strength: "weak" }],
        ["Yahoo", { value: "yahoo", strength: "weak" }],
        ["yahoo", { value: "yahoo", strength: "weak" }],
        ["Google", { value: "google", strength: "weak" }],
        ["google", { value: "google", strength: "weak" }],
        ["Stripe", { value: "stripe", strength: "weak" }],
        ["stripe", { value: "stripe", strength: "weak" }],
        ["PayPal", { value: "paypal", strength: "weak" }],
        ["paypal", { value: "paypal", strength: "weak" }],
        ["BASE", { value: "base", strength: "weak" }],
        ["base", { value: "base", strength: "weak" }],
        ["STORES", { value: "stores", strength: "weak" }],
        ["stores", { value: "stores", strength: "weak" }],
        ["メルカリ", { value: "mercari", strength: "weak" }],
        ["mercari", { value: "mercari", strength: "weak" }],
      ];

      const docKeywordMap: Array<[string, string]> = [
        ["請求書", "請求書"],
        ["invoice", "請求書"],
        ["領収書", "領収書"],
        ["receipt", "領収書"],
        ["見積", "見積"],
        ["見積書", "見積"],
        ["estimate", "見積"],
        ["quotation", "見積"],
        ["quote", "見積"],
        ["明細", "明細"],
        ["statement", "明細"],
        ["納品書", "納品書"],
        ["delivery note", "納品書"],
        ["発注書", "発注書"],
        ["purchase order", "発注書"],
        ["order", "発注書"],
      ];

      const normalizeSenderValue = (raw: string): SenderCandidate | null => {
        const cleaned = raw.trim().replace(/[、。,．）」)]$/, "");
        for (const [alias, candidate] of senderAliasMap) {
          if (cleaned.toLowerCase() === alias.toLowerCase()) return candidate;
        }
        if (!cleaned) return null;
        return { value: cleaned, strength: "weak" };
      };

      const pushUnique = (arr: string[], value: string) => {
        if (!value) return;
        if (!arr.includes(value)) arr.push(value);
      };

      let senderCandidate: SenderCandidate | null = null;

      const fromPatterns = [
        /from\s+([^\s]+)/i,
        /差出人が\s*([^\s]+)/,
        /差出人は\s*([^\s]+)/,
        /送信元が\s*([^\s]+)/,
        /送信元は\s*([^\s]+)/,
        /差出人:\s*([^\s]+)/i,
        /送信元:\s*([^\s]+)/i,
      ];

      for (const pattern of fromPatterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          const candidate = normalizeSenderValue(match[1]);
          if (candidate) {
            senderCandidate = candidate;
            pushUnique(fromParts, `from:${candidate.value}`);
          }
          break;
        }
      }

      if (fromParts.length === 0) {
        for (const [alias, candidate] of senderAliasMap) {
          const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const senderContextPatterns = [
            new RegExp(`${escaped}の`, "i"),
            new RegExp(`${escaped}から`, "i"),
            new RegExp(`${escaped}より`, "i"),
            new RegExp(`${escaped}で`, "i"),
            new RegExp(
              `${escaped}.*(届いた|来た|きた|送られてきた|からの)`,
              "i",
            ),
            new RegExp(
              `${escaped}\\s*(請求書|領収書|明細|見積|見積書|納品書|発注書|メール)`,
              "i",
            ),
          ];

          if (senderContextPatterns.some((p) => p.test(normalizedText))) {
            senderCandidate = candidate;
            pushUnique(fromParts, `from:${candidate.value}`);
            break;
          }
        }
      }

      const subjectPatterns = [
        /件名に[「"']?([^」"'\n]+)[」"']?/,
        /件名が[「"']?([^」"'\n]+)[」"']?/,
        /タイトルに[「"']?([^」"'\n]+)[」"']?/,
        /タイトルが[「"']?([^」"'\n]+)[」"']?/,
        /subject\s*(?:が|は|=)?\s*[「"']?([^」"'\n]+)[」"']?/i,
      ];

      for (const pattern of subjectPatterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          let raw = match[1].trim().replace(/[、。,．）」)]$/, "");

          const cutMarkers = ["がある"];
          for (const marker of cutMarkers) {
            const idx = raw.indexOf(marker);
            if (idx > 0) {
              raw = raw.slice(0, idx).trim();
              break;
            }
          }

          if (raw) {
            pushUnique(subjectParts, `subject:(${raw})`);
            break;
          }
        }
      }

      const hasStrongFileSignal =
        fileParts.length > 0 ||
        attachmentParts.length > 0 ||
        normalizedText.includes("PDF") ||
        normalizedText.toLowerCase().includes("pdf") ||
        normalizedText.includes("Excel") ||
        normalizedText.includes("エクセル") ||
        normalizedText.includes("スプレッドシート") ||
        normalizedText.toLowerCase().includes("xlsx") ||
        normalizedText.toLowerCase().includes("xls") ||
        normalizedText.toLowerCase().includes("word") ||
        normalizedText.includes("ワード") ||
        normalizedText.toLowerCase().includes("docx") ||
        normalizedText.toLowerCase().includes("doc") ||
        normalizedText.includes("画像") ||
        normalizedText.includes("写真") ||
        normalizedText.toLowerCase().includes("jpg") ||
        normalizedText.toLowerCase().includes("jpeg") ||
        normalizedText.toLowerCase().includes("png") ||
        normalizedText.includes("CSV") ||
        normalizedText.toLowerCase().includes("csv") ||
        normalizedText.includes("添付") ||
        normalizedText.includes("添付ファイル") ||
        normalizedText.includes("ファイル付き");

      const shouldKeepDocSubject = (opts: {
        hasStrongFileSignal: boolean;
        sender: SenderCandidate | null;
        normalizedText: string;
      }) => {
        const explicitSubjectMention =
          opts.normalizedText.includes("件名に") ||
          opts.normalizedText.includes("件名が") ||
          opts.normalizedText.toLowerCase().includes("subjectに") ||
          opts.normalizedText.toLowerCase().includes("subjectが");

        if (explicitSubjectMention) return true;
        if (opts.hasStrongFileSignal) return false;
        return true;
      };

      if (
        subjectParts.length === 0 &&
        shouldKeepDocSubject({
          hasStrongFileSignal,
          sender: senderCandidate,
          normalizedText,
        })
      ) {
        for (const [keyword, subjectValue] of docKeywordMap) {
          if (normalizedText.toLowerCase().includes(keyword.toLowerCase())) {
            pushUnique(subjectParts, `subject:(${subjectValue})`);
          }
        }
      }

      if (normalizedText.includes("未読")) pushUnique(stateParts, "is:unread");
      else if (normalizedText.includes("既読"))
        pushUnique(stateParts, "is:read");

      if (normalizedText.includes("今日")) {
        pushUnique(periodParts, "newer_than:1d");
      } else if (normalizedText.includes("昨日")) {
        pushUnique(periodParts, "newer_than:2d");
      } else if (normalizedText.includes("3日以内")) {
        pushUnique(periodParts, "newer_than:3d");
      } else if (
        normalizedText.includes("1週間") ||
        normalizedText.includes("7日以内") ||
        normalizedText.includes("7日")
      ) {
        pushUnique(periodParts, "newer_than:7d");
      } else if (normalizedText.includes("今週")) {
        pushUnique(periodParts, "newer_than:7d");
      } else if (
        normalizedText.includes("1か月") ||
        normalizedText.includes("1ヶ月") ||
        normalizedText.includes("30日以内") ||
        normalizedText.includes("30日") ||
        normalizedText.includes("今月")
      ) {
        pushUnique(periodParts, "newer_than:30d");
      }

      if (
        normalizedText.includes("添付") ||
        normalizedText.includes("添付ファイル") ||
        normalizedText.includes("ファイル付き")
      ) {
        pushUnique(attachmentParts, "has:attachment");
      }

      if (
        normalizedText.includes("添付なしは除く") ||
        normalizedText.includes("添付がないものは除く") ||
        normalizedText.includes("添付なしを除く")
      ) {
        pushUnique(attachmentParts, "has:attachment");
      }

      if (
        normalizedText.includes("PDF") ||
        normalizedText.toLowerCase().includes("pdf")
      ) {
        pushUnique(fileParts, "filename:pdf");
        pushUnique(attachmentParts, "has:attachment");
      }

      if (
        normalizedText.includes("Excel") ||
        normalizedText.includes("エクセル") ||
        normalizedText.includes("スプレッドシート") ||
        normalizedText.toLowerCase().includes("xlsx") ||
        normalizedText.toLowerCase().includes("xls")
      ) {
        pushUnique(fileParts, "filename:xlsx");
        pushUnique(attachmentParts, "has:attachment");
      }

      if (
        normalizedText.toLowerCase().includes("word") ||
        normalizedText.includes("ワード") ||
        normalizedText.toLowerCase().includes("docx") ||
        normalizedText.toLowerCase().includes("doc")
      ) {
        pushUnique(fileParts, "filename:docx");
        pushUnique(attachmentParts, "has:attachment");
      }

      if (
        normalizedText.includes("CSV") ||
        normalizedText.toLowerCase().includes("csv")
      ) {
        pushUnique(fileParts, "filename:csv");
        pushUnique(attachmentParts, "has:attachment");
      }

      if (
        normalizedText.includes("画像") ||
        normalizedText.includes("写真") ||
        normalizedText.toLowerCase().includes("jpg") ||
        normalizedText.toLowerCase().includes("jpeg") ||
        normalizedText.toLowerCase().includes("png")
      ) {
        pushUnique(fileParts, "filename:jpg");
        pushUnique(attachmentParts, "has:attachment");
      }

      if (
        normalizedText.includes("広告は除く") ||
        normalizedText.includes("広告を除く") ||
        normalizedText.includes("プロモーションは除く") ||
        normalizedText.includes("プロモーションを除く")
      ) {
        pushUnique(excludes, "-category:promotions");
      }

      if (
        normalizedText.includes("ソーシャルは除く") ||
        normalizedText.includes("ソーシャルを除く")
      ) {
        pushUnique(excludes, "-category:social");
      }

      if (
        normalizedText.includes("フォーラムは除く") ||
        normalizedText.includes("フォーラムを除く")
      ) {
        pushUnique(excludes, "-category:forums");
      }

      const finalParts = [
        ...fromParts,
        ...subjectParts,
        ...fileParts,
        ...periodParts,
        ...stateParts,
        ...attachmentParts,
        ...excludes,
      ];

      const generated = finalParts.join(" ") || "label:INBOX";

      setAiResult(generated);
    } finally {
      setAiLoading(false);
    }
  }

  function validateGmailQuery(query: string): string[] {
    const warnings: string[] = [];
    const q = query.trim();

    if (!q) return warnings;

    // よくある演算子
    const knownOps = [
      "from:",
      "subject:",
      "label:",
      "filename:",
      "has:",
      "newer_than:",
      "older_than:",
      "is:",
      "to:",
      "cc:",
      "bcc:",
    ];

    // タイポ検出（簡易）
    const typoMap: Record<string, string> = {
      "subjec:": "subject:",
      "form:": "from:",
      "lavel:": "label:",
      "filenam:": "filename:",
      attachement: "attachment",
    };

    for (const typo in typoMap) {
      if (q.includes(typo)) {
        warnings.push(`"${typo}" は "${typoMap[typo]}" の可能性があります`);
      }
    }

    // 括弧チェック
    const open = (q.match(/\(/g) || []).length;
    const close = (q.match(/\)/g) || []).length;
    if (open !== close) {
      warnings.push("括弧の数が一致していません");
    }

    // 明らかに変なトークン（コロン付きだけど未知）
    const tokens = q.split(/\s+/);
    for (const t of tokens) {
      if (t.includes(":")) {
        const isKnown = knownOps.some((op) => t.startsWith(op));
        if (!isKnown) {
          warnings.push(`"${t}" は無効な演算子の可能性があります`);
        }
      }
    }

    return warnings;
  }

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
        const status = getRuleStatus(found);
        const normalized =
          status.status === "needs_setup"
            ? { ...found, is_active: false }
            : found;

        setRule(normalized);
        setIsActive(!!normalized.is_active);
        setDriveFolderId(normalized.drive_folder_id ?? "");
        setGmailQuery(normalizeQuery(normalized.gmail_query));
        setQueryLabel(normalized.query_label ?? "");
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

      const normalizedQuery = gmailQuery.trim();

      if (!normalizedQuery) {
        throw new Error("Gmail検索条件を入力してください");
      }

      const payload = {
        drive_folder_id: driveFolderId.trim(),
        subject_keywords: null,
        gmail_query: normalizedQuery,
        query_label: queryLabel.trim() || null,
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

      setDirty(false);
      router.push("/rules");
      router.refresh();
      return;
    } catch (e: any) {
      setError(e?.message ?? "Unexpected error");
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <style>{`
      @keyframes ap-dot-flashing {
        0% { opacity: 0.25; transform: scale(0.85); }
        50% { opacity: 1; transform: scale(1); }
        100% { opacity: 0.25; transform: scale(0.85); }
      }
    `}</style>
      <div className={styles.container}>
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
                const form = document.getElementById(
                  "ruleEditForm",
                ) as HTMLFormElement | null;
                form?.requestSubmit();
              }}
              disabled={saving || loading || !rule}
            >
              {saving ? (
                <span style={loadingText}>
                  <span>保存中</span>
                  <span style={loadingDots} aria-hidden="true">
                    <span
                      style={{
                        ...loadingDotBase,
                        left: 0,
                        animationDelay: "0s",
                      }}
                    />
                    <span
                      style={{
                        ...loadingDotBase,
                        left: 10,
                        animationDelay: "0.2s",
                      }}
                    />
                    <span
                      style={{
                        ...loadingDotBase,
                        left: 20,
                        animationDelay: "0.4s",
                      }}
                    />
                  </span>
                </span>
              ) : dirty ? (
                "保存（未保存あり）"
              ) : (
                "保存"
              )}
            </button>
          </div>
        </div>

        {loading && <div className={styles.notice}>読み込み中...</div>}
        {error && <div className={styles.error}>エラー: {error}</div>}

        {!loading && rule && (
          <form id="ruleEditForm" onSubmit={onSave} className={styles.form}>
            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>検索条件の説明</div>
                  <div className={styles.cardDesc}>
                    一覧画面で表示される説明文です（任意）
                  </div>
                </div>
              </div>

              <label className={styles.field}>
                <input
                  className={styles.input}
                  value={queryLabel}
                  onChange={(e) => {
                    setQueryLabel(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="AmazonのPDF請求書を1週間以内で未読"
                />
              </label>
            </section>
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
                      onChange={(e) => {
                        setIsActive(e.target.checked);
                        setDirty(true);
                      }}
                    />
                    <span className={styles.toggleUi} />
                    <span className={styles.toggleText}>
                      {isActive ? "ON" : "OFF"}
                    </span>
                  </label>
                </div>
              </div>
            </section>

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
                  onChange={(e) => {
                    setDriveFolderId(extractFolderId(e.target.value));
                    setDirty(true);
                  }}
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

            <section className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardTitle}>メール条件</div>
                </div>
              </div>

              <div className={styles.field}>
                <div className={`${styles.fieldLabel} ${styles.fieldLabelRow}`}>
                  <span>
                    Gmail検索条件 <span className={styles.required}>必須</span>
                  </span>

                  <button
                    type="button"
                    className={styles.aiButton}
                    onClick={() => setAiOpen(true)}
                  >
                    ✨ AI生成
                  </button>

                  <a
                    href="https://support.google.com/mail/answer/7190"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Gmail検索の書き方（Google公式）"
                    className={styles.helpLink}
                  >
                    ?
                  </a>
                </div>

                <textarea
                  className={styles.textarea}
                  value={gmailQuery}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGmailQuery(val);
                    setDirty(true);
                    setQueryWarnings(validateGmailQuery(val));
                  }}
                  placeholder="例: label:INBOX is:unread newer_than:7d subject:(請求書)"
                  rows={4}
                  spellCheck={false}
                  aria-label="Gmail検索条件"
                />

                {queryWarnings.length > 0 && (
                  <div className={styles.warningBox}>
                    {queryWarnings.map((w, i) => (
                      <div key={i} className={styles.warningText}>
                        ⚠ {w}
                      </div>
                    ))}
                  </div>
                )}

                <span className={styles.help}>
                  「AI生成」、または Gmail の検索演算子を直接入力できます。 例:
                  label:INBOX is:unread newer_than:7d subject:(請求書)
                </span>
              </div>
            </section>

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
                {saving ? (
                  <span style={loadingText}>
                    <span>保存中</span>
                    <span style={loadingDots} aria-hidden="true">
                      <span
                        style={{
                          ...loadingDotBase,
                          left: 0,
                          animationDelay: "0s",
                        }}
                      />
                      <span
                        style={{
                          ...loadingDotBase,
                          left: 10,
                          animationDelay: "0.2s",
                        }}
                      />
                      <span
                        style={{
                          ...loadingDotBase,
                          left: 20,
                          animationDelay: "0.4s",
                        }}
                      />
                    </span>
                  </span>
                ) : dirty ? (
                  "保存（未保存あり）"
                ) : (
                  "保存"
                )}
              </button>
            </div>
          </form>
        )}

        <AiQueryModal
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          onApply={(result) => {
            handleApplyAiQuery(result);
          }}
        />
      </div>
    </main>
  );
}
