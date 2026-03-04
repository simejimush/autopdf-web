// autopdf-web/src/components/ui/Card.tsx
import * as React from "react";
import styles from "./ui.module.css";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

function cx(...args: Array<string | undefined | false>) {
  return args.filter(Boolean).join(" ");
}

export function Card({ className, ...props }: DivProps) {
  return <div className={cx(styles.uiCard, className)} {...props} />;
}

export function CardPad({ className, ...props }: DivProps) {
  return <div className={cx(styles.uiCard, styles.uiCardPad, className)} {...props} />;
}

export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cx(styles.uiCardHeader, className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cx(styles.uiTitle, className)} {...props} />;
}

export function CardSub({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx(styles.uiSub, className)} {...props} />;
}
