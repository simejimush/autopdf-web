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

type SenderStrength = "weak" | "strong";

type SenderCandidate = {
  value: string;
  strength: SenderStrength;
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

function extractSubjectKeywordsFromQuery(query: string): string[] {
  const match = query.match(/subject:\(([^)]+)\)/i);
  if (!match?.[1]) return [];

  return match[1]
    .split(/\s+OR\s+/i)
    .map((s) => s.replace(/^"+|"+$/g, "").trim())
    .filter(Boolean);
}

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
  const handleApplyAiQuery = (nextQuery: string) => {
    const normalized = String(nextQuery ?? "").trim();
    if (!normalized) return;

    setRule((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        gmail_query: normalized,
      };
    });

    setAiOpen(false);
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
      setCurrentQuery(generated);
      setToast("Gmail検索条件に反映しました");
      setTimeout(() => {
        setToast(null);
      }, 3000);
      setToastTick((v) => v + 1);
    } finally {
      setAiLoading(false);
    }
  }

  // フォーム項目
  const [isActive, setIsActive] = useState<boolean>(true);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [subjectKeywordsText, setSubjectKeywordsText] = useState("");

  const keywords = useMemo(
    () => parseKeywords(subjectKeywordsText),
    [subjectKeywordsText],
  );

  const [currentQuery, setCurrentQuery] = useState<string | null>(null);

  const generatedQuery = useMemo(
    () => buildGmailQueryFromKeywords(keywords),
    [keywords],
  );

  const previewQuery = currentQuery ?? generatedQuery;

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
        setCurrentQuery(normalizeQuery(normalized.gmail_query));
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
        gmail_query: currentQuery ?? generatedQuery,
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
                    件名キーワードを入力すると、Gmail検索条件を自動生成します。
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
                  onChange={(e) => {
                    setSubjectKeywordsText(e.target.value);
                    setCurrentQuery(null);
                  }}
                  placeholder="例: 請求書, 領収書, 明細"
                  autoComplete="off"
                />
                <span className={styles.help}>
                  カンマ区切り。入力すると件名に含まれるメールだけを対象にします。
                </span>
              </label>

              <div className={styles.field}>
                <div className={`${styles.fieldLabel} ${styles.fieldLabelRow}`}>
                  <span>Gmail検索条件（保存される値）</span>

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

        {aiOpen && (
          <div
            className={styles.modalOverlay}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setAiOpen(false);
              }
            }}
          >
            <div className={styles.aiModal}>
              <div className={styles.aiModalHeader}>
                <div className={styles.aiModalTitle}>
                  Gmail検索条件をAIで作成
                </div>
                <button
                  type="button"
                  className={styles.aiModalClose}
                  onClick={() => setAiOpen(false)}
                  aria-label="閉じる"
                >
                  ×
                </button>
              </div>

              <p className={styles.aiModalText}>
                どんなメールを対象にするか、自然な文章で入力してください。
              </p>

              <textarea
                className={styles.aiTextarea}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例：件名に「請求書」がある未読メール"
                rows={4}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !aiLoading
                  ) {
                    e.preventDefault();
                    generateQuery();
                  }
                }}
              />

              <div className={styles.aiExamples}>
                <div className={styles.aiExamplesTitle}>例：</div>

                <button
                  type="button"
                  className={styles.aiExample}
                  onClick={() =>
                    setAiPrompt(
                      "AmazonのPDF請求書を1週間以内で未読、広告は除く",
                    )
                  }
                >
                  AmazonのPDF請求書を1週間以内で未読、広告は除く
                </button>

                <button
                  type="button"
                  className={styles.aiExample}
                  onClick={() => setAiPrompt("楽天の領収書メール")}
                >
                  楽天の領収書メール
                </button>

                <button
                  type="button"
                  className={styles.aiExample}
                  onClick={() => setAiPrompt("StripeのCSV明細")}
                >
                  StripeのCSV明細
                </button>

                <button
                  type="button"
                  className={styles.aiExample}
                  onClick={() => setAiPrompt("Googleの見積書")}
                >
                  Googleの見積書
                </button>
              </div>

              <div className={styles.aiPreviewBox}>
                <div className={styles.aiPreviewLabel}>生成結果</div>
                <code className={styles.aiPreviewCode}>
                  {aiResult || "ここにGmail検索条件が表示されます"}
                </code>
              </div>

              <div className={styles.aiModalActions}>
                {toast && (
                  <div
                    key={toastTick}
                    className={styles.aiAppliedMsg}
                    role="status"
                    aria-live="polite"
                  >
                    <span className={styles.aiAppliedIcon} aria-hidden="true">
                      ✓
                    </span>
                    <span className={styles.aiAppliedText}>{toast}</span>
                  </div>
                )}

                <button
                  type="button"
                  className={styles.aiGhostButton}
                  onClick={() => setAiOpen(false)}
                >
                  閉じる
                </button>

                <button
                  type="button"
                  className={styles.aiPrimaryButton}
                  onClick={generateQuery}
                  disabled={aiLoading}
                >
                  {aiLoading ? "生成中..." : "生成"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
