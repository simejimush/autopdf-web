"use client";

import { useEffect, useState } from "react";
import styles from "./RulesPage.module.css";

const STORAGE_KEY = "autopdf.rules.notice.dismissed";

export default function RulesAutoRunNotice() {
  const [isReady, setIsReady] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    try {
      setIsDismissed(localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      setIsDismissed(false);
    }
    setIsReady(true);
  }, []);

  if (!isReady || isDismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // The notice can still be dismissed for the current page view.
    }
    setIsDismissed(true);
  };

  return (
    <div className={styles.autoRunNotice}>
      <p className={styles.autoRunNoticeText}>
        有効なルールは自動実行の対象になります。すぐ確認したい場合は「実行」ボタンから手動実行できます。
      </p>
      <button
        type="button"
        className={styles.autoRunNoticeClose}
        onClick={handleDismiss}
        aria-label="案内を閉じる"
      >
        ×
      </button>
    </div>
  );
}
