"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import styles from "../RulesPage.module.css";

type RunHistoryItem = {
  id: string;
  status: string;
  message: string | null;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
  processed_count: number | null;
  saved_count: number | null;
  skipped_count?: number | null;
};

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

function formatRunSummary(run: RunHistoryItem) {
  const saved = run.saved_count ?? 0;
  const skipped = run.skipped_count ?? 0;
  const processed = run.processed_count ?? 0;
  return `保存 ${saved}件・除外 ${skipped}件・処理 ${processed}件`;
}

export default function RuleDetailsSection({
  ruleId,
  runTiming,
  updatedAt,
  displayQuery,
  driveFolderId,
}: {
  ruleId: string;
  runTiming: string | null;
  updatedAt: string | null;
  displayQuery: string;
  driveFolderId: string | null;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunHistoryItem[] | null>(null);

  async function openDetails() {
    const next = !open;
    setOpen(next);
    if (!next || runs !== null || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/runs?ruleId=${ruleId}`, {
        cache: "no-store",
      });

      const json = await res.json().catch(() => ({ data: [] }));

      if (!res.ok) {
        setError(json?.error ?? "実行履歴の取得に失敗しました");
        return;
      }

      setRuns(Array.isArray(json?.data) ? json.data : []);
    } catch {
      setError("実行履歴の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    if (deleting) return;
    const ok = window.confirm("このルールを削除しますか？");
    if (!ok) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "DELETE",
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(json?.error ?? "ルールの削除に失敗しました");
        return;
      }

      toast.success("ルールを削除しました");
      router.refresh();
    } catch {
      toast.error("ルールの削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.detailsArea}>
      <button
        type="button"
        className={styles.detailsToggle}
        onClick={openDetails}
        aria-expanded={open}
      >
        <span className={styles.detailsToggleLeft}>
          <span className={styles.detailsToggleLabel}>詳細を表示</span>
          {!open && (
            <span className={styles.detailsToggleHint}>クリックで開閉</span>
          )}
        </span>
        <span className={styles.detailsToggleIcon}>{open ? "−" : "+"}</span>
      </button>

      {open && (
        <>
          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <div className={`${styles.metaKey} ${styles.metaKeyTiming}`}>
                <span
                  className={`material-symbols-outlined ${styles.metaIcon}`}
                >
                  schedule
                </span>
                実行タイミング
              </div>
              <div className={`${styles.metaVal} ${styles.mono}`}>
                {runTiming === "manual" ? "手動" : (runTiming ?? "-")}
              </div>
            </div>

            <div className={styles.metaItem}>
              <div className={`${styles.metaKey} ${styles.metaKeyUpdated}`}>
                <span
                  className={`material-symbols-outlined ${styles.metaIcon}`}
                >
                  update
                </span>
                更新
              </div>
              <div className={`${styles.metaVal} ${styles.muted}`}>
                {updatedAt ? formatRunDate(updatedAt) : "-"}
              </div>
            </div>

            <div className={`${styles.metaItem} ${styles.metaWide}`}>
              <div className={`${styles.metaKey} ${styles.metaKeyWithHelp}`}>
                <span
                  className={`material-symbols-outlined ${styles.metaIcon}`}
                >
                  search
                </span>
                Gmail検索条件
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
                <span
                  className={`${styles.mono} ${styles.clamp2}`}
                  title={displayQuery}
                >
                  {displayQuery}
                </span>
              </div>
            </div>

            <div className={styles.metaItem}>
              <div className={`${styles.metaKey} ${styles.metaKeyDrive}`}>
                <span
                  className={`material-symbols-outlined ${styles.metaIcon}`}
                >
                  folder
                </span>
                保存先
              </div>
              <div
                className={`${styles.metaVal} ${styles.mono} ${styles.clamp2}`}
                title={driveFolderId ?? ""}
              >
                {driveFolderId ? driveFolderId : "-"}
              </div>
            </div>
          </div>

          <div className={styles.historyWrap}>
            <button
              type="button"
              className={styles.historyToggle}
              onClick={() => setOpen(false)}
            >
              履歴を閉じる
            </button>

            <div className={styles.historyPanel}>
              {loading ? (
                <div className={styles.historyLoading}>
                  実行履歴を読み込み中です…
                </div>
              ) : error ? (
                <div className={styles.historyError}>{error}</div>
              ) : runs && runs.length > 0 ? (
                <div className={styles.historyList}>
                  {runs.map((run) => (
                    <div key={run.id} className={styles.historyItem}>
                      <div className={styles.historyHead}>
                        <div className={styles.historyStatus}>
                          {formatRunStatus(run.status)}
                        </div>
                        <div className={styles.historyTime}>
                          {formatRunDate(run.finished_at ?? run.started_at)}
                        </div>
                      </div>
                      <div className={styles.historyMessage}>
                        {formatRunSummary(run)}
                      </div>
                      {run.message ? (
                        <div className={styles.historyMessage}>
                          {run.message}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.historyEmpty}>
                  実行履歴はまだありません
                </div>
              )}
            </div>
          </div>

          <div className={styles.cardFooter}>
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={onDelete}
              disabled={deleting}
            >
              {deleting ? "削除中" : "削除"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
