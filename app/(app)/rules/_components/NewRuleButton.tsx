"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/lib/ui/Button";
import styles from "../RulesPage.module.css";

type Props = {
  isLimitReached: boolean;
  isGoogleConnected?: boolean;
  className?: string;
  label: string;
};

export default function NewRuleButton({
  isLimitReached,
  isGoogleConnected = true,
  className,
  label,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const isDisabled = !isGoogleConnected;

  useEffect(() => {
    if (!isOpen) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

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
        size="md"
        className={className}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        title={
          isDisabled ? "Google接続を完了するとルールを作成できます" : undefined
        }
        onClick={() => {
          if (isDisabled) return;

          if (isLimitReached) {
            setIsOpen(true);
          } else {
            window.location.href = "/rules/new";
          }
        }}
      >
        {label}
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
                Freeプランではルールは3件までです。Proにすると、ルール数の制限なく運用できます。
              </p>

              <div className={styles.planCardLite}>
                <div className={styles.planNameLite}>Pro</div>
                <div className={styles.planPriceLite}>月額 980円</div>
                <ul className={styles.planListLite}>
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

              <Link href="/billing" className={styles.modalPrimaryLink}>
                Proではじめる
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
