"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/lib/ui/Button";
function cx(...xs: Array<string | undefined | false>) {
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
  const router = useRouter();

  return (
    <Button
      variant="primary"
      size="sm"
      disabled={loading || disabled}
      className={cx("btnRun", className)}
      onClick={async () => {
        setLoading(true);

        try {
          const res = await fetch(`/api/rules/${ruleId}/run`, {
            method: "POST",
          });

          const data = await res.json();

          if (!res.ok) {
            alert(data.error ?? "Run failed");
            return;
          }

          alert(data.message ?? "Run finished");
          router.refresh();
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? "実行中…" : "実行"}
    </Button>
  );
}
