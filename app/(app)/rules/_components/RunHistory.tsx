"use client";

import { useEffect, useState } from "react";
import styles from "../RulesPage.module.css";

type RunHistoryItem = {
  id: string;
  status: string | null;
  trigger: string | null;
  processed_count: number | null;
  saved_count: number | null;
  message: string | null;
  started_at: string | null;
  finished_at: string | null;
};

type ApiResponse = {
  items?: RunHistoryItem[];
  error?: string;
};

function fmtTokyo(value: string | null) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusJa(status: string | null) {
  switch (status) {
    case "success":
      return "成功";
    case "error":
      return "失敗";
    case "running":
      return "実行中";
    default:
      return status ?? "-";
  }
}

function triggerJa(trigger: string | null) {
  switch (trigger) {
    case "manual":
      return "手動";
    case "cron":
      return "自動";
    default:
      return trigger ?? "-";
  }
}

function messageJa(message: string | null) {
  if (!message) return "";

  const lower = message.toLowerCase();

  if (lower.includes("invalid authentication credentials")) {
    return "Googleの認証が切れています。Googleアカウントを再接続してください。";
  }

  if (lower.includes("insufficient permissions")) {
    return "Googleの権限が不足しています";
  }

  if (lower.includes("drive_folder_id is required")) {
    return "保存先フォルダが未設定です";
  }

  if (lower.includes("gmail_query is required")) {
    return "Gmail検索条件が未設定です";
  }

  if (lower.includes("failed to load rules")) {
    return "ルールの読み込みに失敗しました";
  }

  return message;
}

export default function RunHistory({ ruleId }: { ruleId: string }) {
  const [items, setItems] = useState<RunHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const res = await fetch(
          `/api/runs/latest?ruleId=${encodeURIComponent(ruleId)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const json: ApiResponse = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "履歴の取得に失敗しました");
        }

        if (!cancelled) {
          setItems(Array.isArray(json.items) ? json.items : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "履歴の取得に失敗しました");
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [ruleId]);

  return (
    <div className={styles.runHistoryBox}>
      <div className={styles.runHistoryHead}>実行履歴</div>

      {loading && <div className={styles.runHistoryState}>読み込み中...</div>}

      {!loading && error && (
        <div className={styles.runHistoryError}>{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className={styles.runHistoryState}>履歴はまだありません</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className={styles.runHistoryList}>
          {items.map((item) => (
            <div key={item.id} className={styles.runHistoryItem}>
              <div className={styles.runHistoryRow}>
                <span className={styles.runHistoryStatus}>
                  {statusJa(item.status)}
                </span>
                <span className={styles.runHistoryDate}>
                  {fmtTokyo(item.finished_at ?? item.started_at)}
                </span>
              </div>

              <div className={styles.runHistorySub}>
                {triggerJa(item.trigger)} / 保存 {item.saved_count ?? 0}件 /
                処理 {item.processed_count ?? 0}件
              </div>

              {item.message && (
                <div className={styles.runHistoryMsg}>
                  {messageJa(item.message)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
