"use client";

import * as React from "react";
import { Badge } from "@/lib/ui";
import { formatRunMessageJa } from "@/lib/ui/runMessage";
import styles from "./RulesPage.module.css";

type RunHistoryItem = {
  id: string;
  status: string;
  message: string | null;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
  processed_count: number | null;
  saved_count: number | null;
  skipped_count: number | null;
};

function formatRunStatus(status?: string | null) {
  if (status === "success") return "成功";
  if (status === "error") return "失敗";
  if (status === "running") return "実行中";
  return "未実行";
}

function fmtTokyo(iso?: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  } catch {
    return iso;
  }
}

function toneOf(status?: string | null): "ok" | "err" | "muted" {
  if (status === "success") return "ok";
  if (status === "error") return "err";
  return "muted";
}

export default function RunHistory({ ruleId }: { ruleId: string }) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<RunHistoryItem[]>([]);

  async function load() {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/runs?ruleId=${encodeURIComponent(ruleId)}`,
        {
          cache: "no-store",
        },
      );

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(json?.error ?? "履歴の取得に失敗しました");
        return;
      }

      setItems(Array.isArray(json?.data) ? json.data : []);
      setLoaded(true);
    } catch {
      setError("履歴の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function onToggle() {
    const next = !open;
    setOpen(next);

    if (next && !loaded) {
      await load();
    }
  }

  return (
    <div className={styles.historyWrap}>
      <button
        type="button"
        className={styles.historyToggle}
        onClick={onToggle}
        aria-expanded={open}
      >
        {open ? "履歴を閉じる" : "履歴を見る"}
      </button>

      {open && (
        <div className={styles.historyPanel}>
          {loading ? (
            <div className={styles.historyLoading}>履歴を読み込み中です…</div>
          ) : error ? (
            <div className={styles.historyError}>{error}</div>
          ) : items.length === 0 ? (
            <div className={styles.historyEmpty}>実行履歴はまだありません</div>
          ) : (
            <div className={styles.historyList}>
              {items.map((item) => {
                const summary = formatRunMessageJa(item);

                return (
                  <div key={item.id} className={styles.historyItem}>
                    <div className={styles.historyHead}>
                      <Badge tone={toneOf(item.status)}>
                        {formatRunStatus(item.status)}
                      </Badge>

                      <div className={styles.historyTime}>
                        {fmtTokyo(item.finished_at ?? item.started_at)}
                      </div>
                    </div>

                    <div className={styles.historyMessage}>{summary}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
