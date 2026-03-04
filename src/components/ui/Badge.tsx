// autopdf-web/src/components/ui/Badge.tsx
import * as React from "react";
import styles from "./ui.module.css";

type Tone = "default" | "ok" | "err" | "muted";

export type BadgeProps = {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
  title?: string;
};

function cx(...args: Array<string | undefined | false>) {
  return args.filter(Boolean).join(" ");
}

export function Badge({ children, tone = "default", dot = false, className, title }: BadgeProps) {
  return (
    <span
      className={cx(
        styles.badge,
        tone === "ok" && styles.badgeOk,
        tone === "err" && styles.badgeErr,
        tone === "muted" && styles.badgeMuted,
        className
      )}
      title={title}
    >
      {dot && <span className={styles.badgeDot} aria-hidden="true" />}
      {children}
    </span>
  );
}
