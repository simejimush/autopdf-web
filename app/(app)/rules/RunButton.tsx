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
    <>
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
        {loading ? (
          <>
            実行中
            <span className="runLoadingDots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </>
        ) : (
          "実行"
        )}
      </Button>

      <style>{`
        .runLoadingDots {
          display: inline-flex;
          gap: 1px;
          margin-left: 1px;
          width: 12px;
        }

        .runLoadingDots span {
          animation: runDotBlink 1.1s ease-in-out infinite;
          opacity: 0.25;
        }

        .runLoadingDots span:nth-child(1) {
          animation-delay: 0s;
        }

        .runLoadingDots span:nth-child(2) {
          animation-delay: 0.18s;
        }

        .runLoadingDots span:nth-child(3) {
          animation-delay: 0.36s;
        }

        @keyframes runDotBlink {
          0%,
          80%,
          100% {
            opacity: 0.25;
          }

          40% {
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}
