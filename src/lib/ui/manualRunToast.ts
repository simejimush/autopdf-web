import { getRunErrorMessage } from "@/lib/runs/getRunErrorMessage";

export type ManualRunToastInput = {
  status?: string | null;
  processedCount?: number | null;
  savedCount?: number | null;
  skippedCount?: number | null;
  errorCode?: string | null;
};

export type ManualRunToast = {
  type: "success" | "error";
  message: string;
};

const GENERIC_MANUAL_RUN_ERROR =
  "実行に失敗しました。時間をおいて再度お試しください。";

function normalizeCount(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function formatManualRunErrorToast(errorCode?: string | null) {
  if (!errorCode) return GENERIC_MANUAL_RUN_ERROR;

  const copy = getRunErrorMessage(errorCode);
  return copy.action ? `${copy.title}。${copy.action}` : `${copy.title}。`;
}

export function formatManualRunToast(
  input: ManualRunToastInput,
): ManualRunToast {
  if (input.status !== "success") {
    return {
      type: "error",
      message: formatManualRunErrorToast(input.errorCode),
    };
  }

  const processed = normalizeCount(input.processedCount);
  const saved = normalizeCount(input.savedCount);
  const skipped = normalizeCount(input.skippedCount);

  if (saved > 0 && skipped > 0) {
    return {
      type: "success",
      message: `PDFを${saved}件保存し、${skipped}件をスキップしました`,
    };
  }

  if (saved > 0) {
    return {
      type: "success",
      message: `PDFを${saved}件Google Driveに保存しました`,
    };
  }

  if (skipped > 0) {
    return {
      type: "success",
      message: `処理済みのメールを${skipped}件スキップしました`,
    };
  }

  return {
    type: "success",
    message:
      processed === 0 ? "対象のメールはありませんでした" : "実行が完了しました",
  };
}
