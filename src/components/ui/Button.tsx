// autopdf-web/src/components/ui/Button.tsx
"use client";

import * as React from "react";
import styles from "./ui.module.css";

type Variant = "primary" | "default" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

function cx(...args: Array<string | undefined | false>) {
  return args.filter(Boolean).join(" ");
}

export function Button({
  variant = "default",
  size = "md",
  className,
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx(
        styles.btn,
        size === "sm" && styles.sm,
        size === "md" && styles.md,
        size === "lg" && styles.lg,
        variant === "primary" && styles.primary,
        variant === "ghost" && styles.ghost,
        variant === "danger" && styles.danger,
        className,
      )}
      {...props}
    />
  );
}
