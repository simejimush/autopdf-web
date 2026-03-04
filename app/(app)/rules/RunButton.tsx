"use client";

import { useState } from "react";
import { Button } from "@/lib/ui/Button";

function cx(...xs: Array<string | undefined | false | null>) {
  return xs.filter(Boolean).join(" ");
}

export default function RunButton({
  ruleId,
  disabled,
  className,
}: {
  ruleId: string;
  disabled: boolean;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      variant="primary"
      size="sm"
      disabled={loading || disabled}
      className={cx("btnRun", className)} // ← RulesPage.module.css 側で .btnRun を定義して色固定する
      onClick={async () => {
        setLoading(true);
        try {
          const res = await fetch(`/api/rules/${ruleId}/run`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) alert(data.error ?? "Run failed");
          else alert(data.message ?? "Run finished");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? "実行中…" : "実行"}
    </Button>
  );
}