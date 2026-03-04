"use client";

import * as React from "react";
import { Button } from "@/lib/ui/Button";

function cx(...xs: Array<string | undefined | false | null>) {
  return xs.filter(Boolean).join(" ");
}

export default function CopyButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [ok, setOk] = React.useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 900);
    } catch {}
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onCopy}
      className={cx(ok ? "btnCopySuccess" : "btnOutline", className)}
      title="検索条件をコピー"
    >
      {ok ? "コピー済み" : "コピー"}
    </Button>
  );
}
