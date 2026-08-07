"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/lib/ui/Button";
import {
  formatManualRunErrorToast,
  formatManualRunToast,
  type ManualRunToastInput,
} from "@/lib/ui/manualRunToast";

function cx(...xs: Array<string | undefined | false>) {
  return xs.filter(Boolean).join(" ");
}

type ManualRunHistoryItem = {
  id?: unknown;
  status?: unknown;
  processed_count?: unknown;
  saved_count?: unknown;
  skipped_count?: unknown;
  error_code?: unknown;
};

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toNullableNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

async function loadManualRunToastInput(
  ruleId: string,
  runId: string,
): Promise<ManualRunToastInput | null> {
  try {
    const res = await fetch(
      `/api/runs/latest?ruleId=${encodeURIComponent(ruleId)}`,
      { cache: "no-store" },
    );

    if (!res.ok) return null;

    const data = await res.json().catch(() => null);
    const items = Array.isArray(data?.items)
      ? (data.items as ManualRunHistoryItem[])
      : [];
    const run = items.find((item) => item.id === runId);

    if (!run) return null;

    return {
      status: toNullableString(run.status),
      processedCount: toNullableNumber(run.processed_count),
      savedCount: toNullableNumber(run.saved_count),
      skippedCount: toNullableNumber(run.skipped_count),
      errorCode: toNullableString(run.error_code),
    };
  } catch {
    return null;
  }
}

export default function RunButton({
  ruleId,
  disabled,
  isFreeOverflow = false,
  className,
}: {
  ruleId: string;
  disabled: boolean;
  isFreeOverflow?: boolean;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        disabled={loading || (disabled && !isFreeOverflow)}
        className={cx("btnRun", className)}
        onClick={async () => {
          if (isFreeOverflow) {
            toast.error(
              "Freeプランでは4件目以降のルールは実行できません。Proに戻すと実行できます。",
            );
            return;
          }

          setLoading(true);

          try {
            const res = await fetch(`/api/rules/${ruleId}/run`, {
              method: "POST",
            });

            const data = await res.json().catch(() => null);

            if (!res.ok) {
              const errorCode =
                toNullableString(data?.error_code) ??
                toNullableString(data?.errorCode) ??
                toNullableString(data?.code);
              toast.error(formatManualRunErrorToast(errorCode));
              return;
            }

            const runId = toNullableString(data?.runId);
            const runInput = runId
              ? await loadManualRunToastInput(ruleId, runId)
              : null;

            const result = runInput
              ? formatManualRunToast(runInput)
              : data?.ok === false
                ? {
                    type: "error" as const,
                    message: formatManualRunErrorToast(),
                  }
                : {
                    type: "success" as const,
                    message: "実行が完了しました",
                  };

            if (result.type === "error") {
              toast.error(result.message);
            } else {
              toast.success(result.message);
            }

            router.refresh();
          } catch {
            toast.error(formatManualRunErrorToast());
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
