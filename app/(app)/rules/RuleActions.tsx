"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/lib/ui/Button";
import CopyButton from "./CopyButton";
import RunButton from "./RunButton";
import styles from "./RulesPage.module.css";

type Props = {
  ruleId: string;
  disabled: boolean;
  isFreeOverflow?: boolean;
  editLabel: string;
};

export default function RuleActions({
  ruleId,
  disabled,
  isFreeOverflow = false,
  editLabel,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;

      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.actions}>
      <RunButton
        ruleId={ruleId}
        disabled={disabled}
        isFreeOverflow={isFreeOverflow}
      />

      <div
        ref={menuRef}
        className={[styles.actionMenu, open ? styles.actionMenuOpen : ""].join(
          " ",
        )}
      >
        <button
          type="button"
          className={styles.actionMenuButton}
          aria-label="その他の操作"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span
            className={`material-symbols-outlined ${styles.actionMenuIcon}`}
          >
            more_horiz
          </span>
        </button>

        {open ? (
          <div className={styles.actionMenuPanel}>
            <Link href={`/rules/${ruleId}`} className={styles.actionMenuLink}>
              <Button
                variant="outline"
                size="sm"
                className={styles.actionMenuItem}
              >
                {editLabel}
              </Button>
            </Link>

            <CopyButton ruleId={ruleId} isFreeOverflow={isFreeOverflow} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
