"use client";

import * as React from "react";
import { Button } from "@/lib/ui/Button";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function CopyButton({
  ruleId,
  isCopyBlocked = false,
}: {
  ruleId: string;
  isCopyBlocked?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  async function onCopy() {
    if (loading) return;

    if (isCopyBlocked) {
      toast.error(
        "Freeプランではルールを3件まで作成できます。コピーするにはProにアップグレードしてください。",
      );
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`/api/rules/${ruleId}/duplicate`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("複製に失敗しました");
      }

      router.refresh();
      toast.success("ルールをコピーしました（一覧の上に追加されました）");
      setLoading(false);
    } catch (e) {
      console.error(e);
      toast.error("複製に失敗しました");
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        @keyframes ap-dot-flashing {
          0% { opacity: 0.25; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.25; transform: scale(0.85); }
        }
      `}</style>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="copyButton"
        onClick={onCopy}
        disabled={loading}
      >
        {loading ? (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <span>複製中</span>
            <span
              style={{
                display: "inline-flex",
                position: "relative",
                width: 28,
                height: 8,
              }}
              aria-hidden="true"
            >
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  width: 8,
                  height: 8,
                  borderRadius: "999px",
                  background: "#ffffff",
                  animation: "ap-dot-flashing 1s infinite linear alternate",
                  animationDelay: "0s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: 10,
                  width: 8,
                  height: 8,
                  borderRadius: "999px",
                  background: "#ffffff",
                  animation: "ap-dot-flashing 1s infinite linear alternate",
                  animationDelay: "0.2s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: 20,
                  width: 8,
                  height: 8,
                  borderRadius: "999px",
                  background: "#ffffff",
                  animation: "ap-dot-flashing 1s infinite linear alternate",
                  animationDelay: "0.4s",
                }}
              />
            </span>
          </span>
        ) : (
          "コピー"
        )}
      </Button>
    </>
  );
}
