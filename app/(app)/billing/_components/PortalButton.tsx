"use client";

import { useState } from "react";
import { Button } from "@/lib/ui/Button";

export default function PortalButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.url) {
        alert(json?.error ?? "ポータルを開けませんでした");
        return;
      }

      window.location.href = json.url;
    } catch {
      alert("ポータルを開けませんでした");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      size="md"
      variant="outline"
      disabled={loading}
      className={className}
    >
      {loading ? "移動中..." : "解約・請求を管理する"}
    </Button>
  );
}
