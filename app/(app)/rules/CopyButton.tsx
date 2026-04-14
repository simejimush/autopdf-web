"use client";

import * as React from "react";
import { Button } from "@/lib/ui/Button";
import { useRouter } from "next/navigation";

export default function CopyButton({ ruleId }: { ruleId: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  async function onCopy() {
    if (loading) return;

    setLoading(true);

    try {
      const res = await fetch(`/api/rules/${ruleId}/duplicate`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("複製に失敗しました");
      }

      router.refresh();
    } catch (e) {
      console.error(e);
      alert("複製に失敗しました");
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onCopy}
      disabled={loading}
    >
      {loading ? "複製中..." : "コピー"}
    </Button>
  );
}
