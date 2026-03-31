import { getRuleStatus } from "@/lib/rules/status";
import RunButton from "./RunButton";
import CopyButton from "./CopyButton";
import RuleToggle from "./RuleToggle";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import styles from "./RulesPage.module.css";
import { Badge, CardPad, CardHeader } from "@/lib/ui";
import { Button } from "@/lib/ui/Button";
import Link from "next/link";
import DeleteButton from "./DeleteButton";
import NewRuleButton from "./_components/NewRuleButton";

type RunLite = {
  id: string;
  status: string;
  message: string | null;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
  saved_count: number | null;
  skipped_count?: number | null;
  processed_count: number | null;
};

type Rule = {
  id: string;
  is_active: boolean;
  run_timing: string | null;
  drive_folder_id: string | null;
  gmail_query: string | null;
  query_label?: string | null;
  updated_at: string | null;
  created_at?: string | null;
  runs?: never;
};

const LABEL = {
  rules: "ルール",
  runTiming: "実行タイミング",
  gmailQuery: "Gmail検索条件",
  driveFolder: "保存先",
  lastRun: "最終実行結果",
  updated: "更新",
  newRule: "＋ ルールを作成",
  edit: "編集",
  empty: "まだルールがありません",
  ready: "準備完了",
  disabled: "無効",
  needsSetup: "未設定",
  success: "成功",
  error: "エラー",
  sort: "並び順",
  searchPlaceholder: "ルールを検索",
  search: "検索",
  clear: "クリア",
};

type SortKey = "updated_desc" | "updated_asc" | "label_asc";

function formatRunStatus(status?: string | null) {
  if (status === "success") return "成功";
  if (status === "error") return "失敗";
  if (status === "running") return "実行中";
  return "未実行";
}

function formatRunDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRunSummary(
  run:
    | {
        processed_count?: number | null;
        skipped_count?: number | null;
        saved_count?: number | null;
      }
    | null
    | undefined,
) {
  if (!run) return "実行履歴なし";

  const saved = run.saved_count ?? 0;
  const skipped = run.skipped_count ?? 0;
  const processed = run.processed_count ?? 0;

  return `保存 ${saved}件・除外 ${skipped}件・処理 ${processed}件`;
}

function normalizeQuery(q: unknown) {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s || s === "-") return null;
  return s;
}

function truncate(s: string, max = 80) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function fmtTokyo(iso: string | null | undefined) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  } catch {
    return iso;
  }
}

function statusJa(s: string) {
  if (s === "ready") return LABEL.ready;
  if (s === "disabled") return LABEL.disabled;
  if (s === "needs_setup") return LABEL.needsSetup;
  if (s === "success") return LABEL.success;
  if (s === "error") return LABEL.error;
  return s;
}

function reasonsTextOf(status: unknown) {
  if (
    status &&
    typeof status === "object" &&
    "reasons" in status &&
    Array.isArray((status as any).reasons)
  ) {
    const arr = (status as any).reasons as string[];
    return arr.length ? arr.join(" / ") : "";
  }
  return "";
}

function badgeTone(
  status: ReturnType<typeof getRuleStatus>,
): "ok" | "err" | "muted" {
  if (status.status === "ready") return "ok";
  if (status.status === "needs_setup") return "err";
  return "muted";
}

function toTimeValue(value?: string | null) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function normalizeLabel(label?: string | null) {
  return (label ?? "").trim().toLocaleLowerCase("ja");
}

function normalizeSortKey(value?: string): SortKey {
  if (value === "updated_asc") return "updated_asc";
  if (value === "label_asc") return "label_asc";
  return "updated_desc";
}

function sortRules(rules: Rule[], sort: SortKey) {
  const copied = [...rules];

  copied.sort((a, b) => {
    if (sort === "label_asc") {
      return normalizeLabel(a.query_label).localeCompare(
        normalizeLabel(b.query_label),
        "ja",
      );
    }

    const aTime = toTimeValue(a.updated_at ?? a.created_at ?? null);
    const bTime = toTimeValue(b.updated_at ?? b.created_at ?? null);

    if (sort === "updated_asc") {
      return aTime - bTime;
    }

    return bTime - aTime;
  });

  return copied;
}

function filterRules(rules: Rule[], query: string) {
  if (!query) return rules;

  return rules.filter((r) => {
    const label = (r.query_label ?? "").toLowerCase();
    const gmail = (r.gmail_query ?? "").toLowerCase();
    const drive = (r.drive_folder_id ?? "").toLowerCase();

    return (
      label.includes(query) || gmail.includes(query) || drive.includes(query)
    );
  });
}

export default async function RulesPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string; q?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const sort = normalizeSortKey(resolvedSearchParams.sort);
  const query = (resolvedSearchParams.q ?? "").trim().toLowerCase();

  const h = await headers();

  const host = h.get("host");
  if (!host && !process.env.APP_URL && !process.env.VERCEL_URL) {
    throw new Error("Missing host/APP_URL/VERCEL_URL");
  }
  const proto =
    h.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");

  const baseUrl =
    process.env.APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `${proto}://${host}`);

  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${baseUrl}/api/rules`, {
    cache: "no-store",
    headers: { cookie },
  });

  if (res.status === 401) redirect("/login");

  let json: { data: Rule[]; plan?: string; error?: string };
  try {
    json = await res.json();
  } catch {
    json = { data: [], error: "Invalid JSON response" };
  }

  const rules = json.data ?? [];
  const plan = json.plan ?? "free";

  const RULE_LIMIT_FREE = 3;
  const isFree = plan === "free";
  const remaining = isFree ? Math.max(RULE_LIMIT_FREE - rules.length, 0) : null;
  const isLimitReached = isFree && rules.length >= RULE_LIMIT_FREE;

  const filteredRules = filterRules(rules, query);
  const sortedRules = sortRules(filteredRules, sort);

  const latestRes = await fetch(`${baseUrl}/api/runs/latest`, {
    cache: "no-store",
    headers: { cookie },
  });
  const latestJson = await latestRes.json();
  const latestByRule: Record<string, RunLite | null> = latestJson?.data ?? {};

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.hero}>
          <div>
            <div className={styles.titleRow}>
              <h1 className={styles.h1}>{LABEL.rules}</h1>
              <span className={styles.count}>{filteredRules.length}</span>
            </div>
            <p className={styles.sub}>自動実行のルールを管理します。</p>
          </div>

          <NewRuleButton
            isLimitReached={isLimitReached}
            label={LABEL.newRule}
            className={`${styles.btnNewRule} ${styles.fullWidthOnMobile}`}
          />
        </div>

        {isFree && (
          <div className={styles.upgradeInlineWrap}>
            <div className={styles.upgradeInlineCard}>
              <div className={styles.upgradeInlineText}>
                <div className={styles.upgradeInlineTitle}>
                  ルール作成は3件までです。
                </div>
                <div className={styles.upgradeInlineSub}>
                  Proプランで無制限に作成できます。
                </div>
              </div>

              <Link href="/billing" className={styles.upgradeInlineButton}>
                Proにアップグレード
              </Link>
            </div>
          </div>
        )}

        {!json.error && (
          <div className={styles.listToolbar}>
            <form method="get" className={styles.toolbarForm}>
              <input
                type="text"
                name="q"
                defaultValue={query}
                placeholder={LABEL.searchPlaceholder}
                className={styles.searchInput}
              />

              <button type="submit" className={styles.searchBtn}>
                {LABEL.search}
              </button>

              <Link href="/rules" className={styles.clearBtn}>
                {LABEL.clear}
              </Link>

              <div className={styles.sortWrap}>
                <label htmlFor="sort" className={styles.sortLabel}>
                  {LABEL.sort}
                </label>

                <select
                  id="sort"
                  name="sort"
                  defaultValue={sort}
                  className={styles.sortSelect}
                >
                  <option value="updated_desc">更新日が新しい順</option>
                  <option value="updated_asc">更新日が古い順</option>
                  <option value="label_asc">ルール名順</option>
                </select>

                <button type="submit" className={styles.sortSubmit}>
                  適用
                </button>
              </div>
            </form>
          </div>
        )}

        {json.error ? (
          <div className={styles.error} role="alert">
            <div className={styles.errorTitle}>エラー</div>
            <div className={styles.errorMsg}>{json.error}</div>
          </div>
        ) : rules.length === 0 ? (
          <CardPad className={styles.emptyCard}>
            <div className={styles.emptyTitle}>{LABEL.empty}</div>
            <div className={styles.emptySub}>
              まずはルールを作成してください。
            </div>
            <Link href="/rules/new">
              <Button
                variant="solid"
                size="md"
                className={`${styles.btnNewRule} ${styles.fullWidthOnMobile}`}
              >
                {LABEL.newRule}
              </Button>
            </Link>
          </CardPad>
        ) : (
          <div className={styles.list}>
            {sortedRules.map((r, index) => {
              const q = normalizeQuery(r.gmail_query);
              const label = r.query_label?.trim();
              const displayLabel = label && label !== "" ? label : null;
              const displayQuery = q ?? "(generated)";

              const st = getRuleStatus(r);
              const reasonsText = reasonsTextOf(st);
              const isMissing = st.status === "needs_setup";
              const lastRun = latestByRule[r.id] ?? null;

              const lastRunStatus = formatRunStatus(lastRun?.status);
              const lastRunAt = formatRunDate(
                lastRun?.finished_at ?? lastRun?.started_at,
              );
              const lastRunSummary = formatRunSummary(lastRun);

              const lastRunTitle = lastRun
                ? [
                    statusJa(lastRun.status),
                    lastRun.finished_at ? fmtTokyo(lastRun.finished_at) : null,
                    lastRun.message
                      ? lastRun.message.includes(
                          "invalid authentication credentials",
                        )
                        ? "Google認証が無効です（再接続してください）"
                        : lastRun.message.includes("insufficient permissions")
                          ? "Googleの権限が不足しています"
                          : lastRun.message
                              .replace(/processed=(\d+)/, "処理$1件")
                              .replace(/skipped=(\d+)/, "・スキップ$1件")
                              .replace(/saved=(\d+)/, "・保存$1件")
                      : null,
                    lastRun.error_code ? `code=${lastRun.error_code}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "-";

              const lastRunTone =
                lastRun?.status === "success"
                  ? "ok"
                  : lastRun?.status === "error"
                    ? "err"
                    : "muted";

              return (
                <CardPad
                  key={r.id}
                  className={[
                    styles.ruleCard,
                    isMissing
                      ? styles.ruleCardDanger
                      : !r.is_active
                        ? styles.ruleCardMuted
                        : st.status === "ready"
                          ? styles.ruleCardReady
                          : styles.ruleCardDefault,
                    isMissing ? styles.dim : "",
                  ].join(" ")}
                >
                  <CardHeader className={styles.cardHeader}>
                    <div className={styles.leftTop}>
                      <div className={styles.ruleTitle}>
                        {displayLabel
                          ? `${index + 1}. ${truncate(displayLabel)}`
                          : `${index + 1}.`}
                      </div>

                      <RuleToggle id={r.id} isActive={r.is_active} />

                      <Badge
                        tone={badgeTone(st)}
                        dot
                        title={reasonsText || undefined}
                      >
                        {statusJa(st.status)}
                      </Badge>
                    </div>

                    <div className={styles.actions}>
                      <RunButton
                        ruleId={r.id}
                        disabled={st.status !== "ready"}
                      />

                      <Link
                        href={`/rules/${r.id}`}
                        className={styles.btnEditLink}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className={styles.btnEdit}
                        >
                          {LABEL.edit}
                        </Button>
                      </Link>

                      <CopyButton text={displayQuery} />
                    </div>
                  </CardHeader>

                  <div className={styles.metaGridCompact}>
                    <div className={styles.metaItem}>
                      <div
                        className={`${styles.metaKey} ${styles.metaKeyLastRun}`}
                      >
                        <span
                          className={`material-symbols-outlined ${styles.metaIcon}`}
                        >
                          play_arrow
                        </span>
                        {LABEL.lastRun}
                      </div>

                      <div className={styles.metaBlock}>
                        <div className={styles.lastRunRow}>
                          <Badge tone={lastRunTone} title={lastRunTitle}>
                            {lastRunStatus}
                          </Badge>
                        </div>
                        <div className={styles.lastRunAt}>{lastRunAt}</div>
                        <div className={styles.lastRunSummary}>
                          {lastRunSummary}
                        </div>
                      </div>
                    </div>
                  </div>

                  <details className={styles.detailsWrap}>
                    <summary className={styles.detailsSummary}>
                      <span>詳細を表示</span>
                    </summary>

                    <div className={styles.metaGrid}>
                      <div className={styles.metaItem}>
                        <div
                          className={`${styles.metaKey} ${styles.metaKeyTiming}`}
                        >
                          <span
                            className={`material-symbols-outlined ${styles.metaIcon}`}
                          >
                            schedule
                          </span>
                          {LABEL.runTiming}
                        </div>
                        <div className={`${styles.metaVal} ${styles.mono}`}>
                          {r.run_timing === "manual"
                            ? "手動"
                            : (r.run_timing ?? "-")}
                        </div>
                      </div>

                      <div className={styles.metaItem}>
                        <div
                          className={`${styles.metaKey} ${styles.metaKeyUpdated}`}
                        >
                          <span
                            className={`material-symbols-outlined ${styles.metaIcon}`}
                          >
                            update
                          </span>
                          {LABEL.updated}
                        </div>
                        <div className={`${styles.metaVal} ${styles.muted}`}>
                          {fmtTokyo(r.updated_at)}
                        </div>
                      </div>

                      <div className={`${styles.metaItem} ${styles.metaWide}`}>
                        <div
                          className={`${styles.metaKey} ${styles.metaKeyWithHelp}`}
                        >
                          <span
                            className={`material-symbols-outlined ${styles.metaIcon}`}
                          >
                            search
                          </span>

                          {LABEL.gmailQuery}

                          <a
                            href="https://support.google.com/mail/answer/7190"
                            target="_blank"
                            rel="noreferrer"
                            className={styles.helpLink}
                            title="Gmail検索条件の書き方"
                          >
                            ?
                          </a>
                        </div>
                        <div className={styles.metaVal}>
                          {isMissing ? (
                            <span
                              className={styles.warnText}
                              title={reasonsText || undefined}
                            >
                              ⚠ {LABEL.needsSetup}
                              {reasonsText ? `（${reasonsText}）` : ""}
                            </span>
                          ) : (
                            <span
                              className={`${styles.mono} ${styles.clamp2}`}
                              title={displayQuery}
                            >
                              {displayQuery}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className={styles.metaItem}>
                        <div
                          className={`${styles.metaKey} ${styles.metaKeyDrive}`}
                        >
                          <span
                            className={`material-symbols-outlined ${styles.metaIcon}`}
                          >
                            folder
                          </span>
                          {LABEL.driveFolder}
                        </div>
                        <div
                          className={`${styles.metaVal} ${styles.mono} ${styles.clamp2}`}
                          title={r.drive_folder_id ?? ""}
                        >
                          {r.drive_folder_id ? r.drive_folder_id : "-"}
                        </div>
                      </div>
                    </div>
                  </details>

                  <div className={styles.cardFooter}>
                    <DeleteButton ruleId={r.id} />
                  </div>
                </CardPad>
              );
            })}
          </div>
        )}

        <p className={styles.footnote}>
          ※ いまは service role で取得（ログイン導線は後で置き換え）
        </p>
      </div>
    </div>
  );
}
