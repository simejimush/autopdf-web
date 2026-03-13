"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMyProfileAction } from "@/app/actions/profile";
import styles from "./SettingsPage.module.css";

type Props = {
  displayName: string;
  email: string;
};

export default function ProfileEditButton({ displayName, email }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(displayName === "未設定" ? "" : displayName);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    setName(displayName === "未設定" ? "" : displayName);
  }, [displayName]);

  async function onSubmit(formData: FormData) {
    startTransition(async () => {
      await updateMyProfileAction(formData);
      window.dispatchEvent(new Event("profile-updated"));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        className={styles.secondaryBtn}
        onClick={() => setOpen(true)}
      >
        編集
      </button>

      {open ? (
        <div
          className={styles.modalOverlay}
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-edit-title"
          >
            <div className={styles.modalHeader}>
              <div>
                <h3 id="profile-edit-title" className={styles.modalTitle}>
                  表示名を編集
                </h3>
                <p className={styles.modalDesc}>
                  表示名を保存すると、設定画面や右上メニューの表示に反映されます。
                </p>
              </div>

              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                disabled={isPending}
              >
                ×
              </button>
            </div>

            <form action={onSubmit}>
              <div className={styles.modalBody}>
                <div className={styles.formRow}>
                  <label htmlFor="display_name" className={styles.inputLabel}>
                    表示名
                  </label>
                  <input
                    id="display_name"
                    name="display_name"
                    className={styles.input}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例：吉良 吉影"
                    maxLength={80}
                    disabled={isPending}
                  />
                </div>

                <div className={styles.formRow}>
                  <label htmlFor="email_view" className={styles.inputLabel}>
                    メールアドレス
                  </label>
                  <input
                    id="email_view"
                    className={styles.input}
                    value={email}
                    readOnly
                  />
                </div>

                <input type="hidden" name="company_name" value="" />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  キャンセル
                </button>

                <button
                  type="submit"
                  className={styles.primaryBtn}
                  disabled={isPending}
                >
                  {isPending ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
