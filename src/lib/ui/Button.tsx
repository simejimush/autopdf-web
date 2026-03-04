// autopdf-web/src/lib/ui/Button.tsx
import * as React from "react";
import styles from "./Button.module.css";

type Variant = "solid" | "ghost" | "outline" | "danger" | "primary" | "success";
type Size = "sm" | "md";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

function cx(...xs: Array<string | undefined | false | null>) {
  return xs.filter(Boolean).join(" ");
}

export function Button(props: ButtonProps) {
  const { className, variant = "solid", size = "md", type, ...rest } = props;

  return (
    <button
      {...rest}
      type={type ?? "button"}
      data-variant={variant}
      data-size={size}
      className={cx(styles.button, className)}
    />
  );
}