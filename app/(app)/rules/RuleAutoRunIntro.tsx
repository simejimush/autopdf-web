"use client";

import { useEffect, useState } from "react";
import styles from "./RulesPage.module.css";

const STORAGE_KEY = "autopdf_hide_rule_auto_run_intro";

function clearCreatedQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("created");

  const nextUrl =
    url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "");

  window.history.replaceState(null, "", nextUrl);
}

export default function RuleAutoRunIntro() {
  const [open, setOpen] = useState(false);
  const [hideNextTime, setHideNextTime] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("created") !== "1") return;

    const hidden = localStorage.getItem(STORAGE_KEY) === "1";
    clearCreatedQuery();

    if (!hidden) {
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  const handleClose = () => {
    if (hideNextTime) {
      localStorage.setItem(STORAGE_KEY, "1");
    }

    clearCreatedQuery();
    setOpen(false);
  };

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <section
        className={styles.modalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-auto-run-intro-title"
      >
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalEyebrow}>ルール作成</div>
            <h2 id="rule-auto-run-intro-title" className={styles.modalTitle}>
              ルールを作成しました
            </h2>
          </div>

          <button
            type="button"
            className={styles.modalClose}
            onClick={handleClose}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.modalLead}>
            有効なルールは、自動実行時に条件に合うメールを確認してPDF保存します。
            <br />
            作成後すぐに確認したい場合は、「実行」ボタンから手動実行できます。
            <br />
            実行結果は「実行履歴」で確認できます。
          </p>

          <label className={styles.introCheckbox}>
            <input
              type="checkbox"
              checked={hideNextTime}
              onChange={(event) => setHideNextTime(event.target.checked)}
            />
            <span>次回からこの案内を表示しない</span>
          </label>
        </div>

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.modalButton}
            onClick={handleClose}
          >
            閉じる
          </button>
        </div>
      </section>
    </div>
  );
}
