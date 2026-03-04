// autopdf-web/app/(app)/rules/page.tsx
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

type RunLite = {
  id: string;
  status: string;
  message: string | null;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
  saved_count: number;
  processed_count: number;
};

type Rule = {
  id: string;
  is_active: boolean;
  run_timing: string | null;
  drive_folder_id: string | null;
  gmail_query: string | null;
  updated_at: string | null;
  runs?: never;
};

const LABEL = {
  rules: "ルール",
  runTiming: "実行タイミング",
  gmailQuery: "検索条件",
  driveFolder: "保存先フォルダ",
  lastRun: "最終実行",
  updated: "更新日時",
  newRule: "＋ ルールを作成",
  edit: "編集",
  empty: "まだルールがありません",
  ready: "準備完了",
  disabled: "無効",
  needsSetup: "未設定",
  success: "成功",
  error: "エラー",
};

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

export default async function RulesPage() {
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

  let json: { data: Rule[]; error?: string };
  try {
    json = await res.json();
  } catch {
    json = { data: [], error: "Invalid JSON response" };
  }

  const rules = json.data ?? [];

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
              <span className={styles.count}>{rules.length}</span>
            </div>
            <p className={styles.sub}>自動実行のルールを管理します。</p>
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
        </div>

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
            {rules.map((r) => {
              const q = normalizeQuery(r.gmail_query);
              const displayQuery = q ?? "(generated)";

              const st = getRuleStatus(r);
              const reasonsText = reasonsTextOf(st);
              const isMissing = st.status === "needs_setup";
              const lastRun = latestByRule[r.id] ?? null;

              const lastRunText = lastRun
                ? [
                    statusJa(lastRun.status),
                    lastRun.finished_at ? fmtTokyo(lastRun.finished_at) : null,

                    // 成功系（processed/skipped/saved）
                    lastRun.message && /processed=\d+/.test(lastRun.message)
                      ? truncate(
                          lastRun.message
                            .replace(/processed=(\d+)/, "処理$1件")
                            .replace(/skipped=(\d+)/, "・スキップ$1件")
                            .replace(/saved=(\d+)/, "・保存$1件"),
                          60,
                        )
                      : null,

                    // エラー系
                    lastRun.message && !/processed=\d+/.test(lastRun.message)
                      ? truncate(
                          lastRun.message.includes(
                            "invalid authentication credentials",
                          )
                            ? "Google認証が無効です（再接続してください）"
                            : lastRun.message.includes(
                                  "insufficient permissions",
                                )
                              ? "Googleの権限が不足しています"
                              : lastRun.message.toLowerCase().includes("quota")
                                ? "Google APIの利用上限を超えました"
                                : lastRun.message,
                          60,
                        )
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "-";

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
                  className={`${styles.card} ${isMissing ? styles.dim : ""}`}
                >
                  <CardHeader className={styles.cardHeader}>
                    <div className={styles.leftTop}>
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

                  <div className={styles.metaGrid}>
                    <div className={styles.metaItem}>
                      <div className={styles.metaKey}>{LABEL.runTiming}</div>
                      <div className={`${styles.metaVal} ${styles.mono}`}>
                        {r.run_timing ?? "-"}
                      </div>
                    </div>

                    <div className={styles.metaItem}>
                      <div className={styles.metaKey}>{LABEL.updated}</div>
                      <div className={`${styles.metaVal} ${styles.muted}`}>
                        {fmtTokyo(r.updated_at)}
                      </div>
                    </div>

                    <div className={`${styles.metaItem} ${styles.metaWide}`}>
                      <div className={styles.metaKey}>{LABEL.gmailQuery}</div>
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
                      <div className={styles.metaKey}>{LABEL.driveFolder}</div>
                      <div
                        className={`${styles.metaVal} ${styles.mono} ${styles.clamp2}`}
                        title={r.drive_folder_id ?? ""}
                      >
                        {r.drive_folder_id ? r.drive_folder_id : "-"}
                      </div>
                    </div>

                    <div className={styles.metaItem}>
                      <div className={styles.metaKey}>{LABEL.lastRun}</div>
                      <div className={`${styles.metaVal} ${styles.clamp2}`}>
                        <Badge tone={lastRunTone} title={lastRunTitle}>
                          {lastRunText}
                        </Badge>
                      </div>
                    </div>
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
