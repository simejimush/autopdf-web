"use client";

import styles from "./RunResultCard.module.css";

type RunResult = {
  status?: string | null;
  processed_count?: number | null;
  saved_count?: number | null;
  message?: string | null;
  finished_at?: string | null;
};

function fmtTokyo(dateLike?: string | null) {
  if (!dateLike) return "";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateLike));
  } catch {
    return "";
  }
}

export default function RunResultCard({ run }: { run: RunResult | null }) {
  if (!run) return null;

  const isSuccess = run.status === "success";
  const processed = Number(run.processed_count ?? 0);
  const saved = Number(run.saved_count ?? 0);
  const skipped = Math.max(0, processed - saved);
  const date = fmtTokyo(run.finished_at);

  if (isSuccess) {
    return (
      <div className={styles.row}>
        <span className={styles.badge}>実行成功</span>
        {date && <span className={styles.meta}>{date}</span>}
        <span className={styles.meta}>
          保存 {saved}件・除外 {skipped}件・処理 {processed}件
        </span>
      </div>
    );
  }

  return (
    <div className={styles.error}>
      <span className={styles.errorBadge}>実行失敗</span>
      <span className={styles.errorText}>
        {run.message ?? "実行に失敗しました"}
      </span>
    </div>
  );
}
