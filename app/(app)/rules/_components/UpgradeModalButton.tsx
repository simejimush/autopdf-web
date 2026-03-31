"use client";

import { useEffect, useState } from "react";
import { Button } from "@/lib/ui/Button";
import styles from "../RulesPage.module.css";

type Props = {
  open?: boolean;
};

export default function UpgradeModalButton({ open = false }: Props) {
  const [isOpen, setIsOpen] = useState(open);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <>
      <Button
        variant="solid"
        size="sm"
        className={styles.upgradeBtn}
        onClick={() => setIsOpen(true)}
      >
        Proにアップグレード
      </Button>

      {isOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setIsOpen(false)}
          role="presentation"
        >
          <div
            className={styles.modalCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby="upgrade-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <div className={styles.modalEyebrow}>Freeプラン上限</div>
                <h2 id="upgrade-modal-title" className={styles.modalTitle}>
                  Proでルールを無制限に作成
                </h2>
              </div>

              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setIsOpen(false)}
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.modalLead}>
                Freeプランではルールは3件までです。
                Proにすると、ルール数の制限なく運用できます。
              </p>

              <div className={styles.planCard}>
                <div className={styles.planName}>Pro</div>
                <div className={styles.planPrice}>月額 980円</div>
                <ul className={styles.planList}>
                  <li>ルール数 無制限</li>
                  <li>自動実行あり</li>
                  <li>PDF生成あり</li>
                  <li>Google Drive保存あり</li>
                </ul>
              </div>

              <div className={styles.modalNote}>
                決済導線は次のステップで接続します。今はUI確認用です。
              </div>
            </div>

            <div className={styles.modalActions}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                閉じる
              </Button>

              <Button
                variant="solid"
                size="sm"
                className={styles.modalPrimary}
                onClick={() => setIsOpen(false)}
              >
                Proではじめる
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
