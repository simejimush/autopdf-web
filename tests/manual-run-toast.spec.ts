import { expect, test } from "@playwright/test";
import {
  formatManualRunErrorToast,
  formatManualRunToast,
} from "../src/lib/ui/manualRunToast";

test("saved=1 / skipped=0", () => {
  expect(
    formatManualRunToast({
      status: "success",
      processedCount: 1,
      savedCount: 1,
      skippedCount: 0,
    }),
  ).toEqual({
    type: "success",
    message: "PDFを1件Google Driveに保存しました",
  });
});

test("saved>1 / skipped=0", () => {
  expect(
    formatManualRunToast({
      status: "success",
      processedCount: 1,
      savedCount: 3,
      skippedCount: 0,
    }).message,
  ).toBe("PDFを3件Google Driveに保存しました");
});

test("saved=0 / skipped=1", () => {
  expect(
    formatManualRunToast({
      status: "success",
      processedCount: 0,
      savedCount: 0,
      skippedCount: 1,
    }).message,
  ).toBe("処理済みのメールを1件スキップしました");
});

test("saved=0 / skipped>1", () => {
  expect(
    formatManualRunToast({
      status: "success",
      processedCount: 0,
      savedCount: 0,
      skippedCount: 4,
    }).message,
  ).toBe("処理済みのメールを4件スキップしました");
});

test("saved>0 / skipped>0", () => {
  expect(
    formatManualRunToast({
      status: "success",
      processedCount: 1,
      savedCount: 2,
      skippedCount: 3,
    }).message,
  ).toBe("PDFを2件保存し、3件をスキップしました");
});

test("processed=0 / saved=0 / skipped=0", () => {
  expect(
    formatManualRunToast({
      status: "success",
      processedCount: 0,
      savedCount: 0,
      skippedCount: 0,
    }).message,
  ).toBe("対象のメールはありませんでした");
});

test("raw API/provider message is never accepted as toast input", () => {
  const rawProviderDetail = "provider failure sensitive-value-do-not-display";
  const result = formatManualRunToast({
    status: "error",
    errorCode: null,
    rawMessage: rawProviderDetail,
  } as Parameters<typeof formatManualRunToast>[0] & { rawMessage: string });

  expect(result.message).toBe(
    "実行に失敗しました。時間をおいて再度お試しください。",
  );
  expect(result.message).not.toContain(rawProviderDetail);
});

test("UNKNOWN uses safe Japanese without technical details", () => {
  const message = formatManualRunErrorToast("UNKNOWN");

  expect(message).toBe("処理に失敗しました。時間をおいて再実行してください。");
  expect(message).not.toContain("UNKNOWN");
});

test.describe("known token, OAuth, and Drive errors", () => {
  for (const errorCode of [
    "GOOGLE_TOKEN_INVALID",
    "GOOGLE_PERMISSION_DENIED",
    "DRIVE_UPLOAD_FAILED",
    "DRIVE_FOLDER_INVALID",
  ]) {
    test(`${errorCode} uses the existing safe mapping`, () => {
      const message = formatManualRunErrorToast(errorCode);

      expect(message).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(message).not.toContain(errorCode);
      expect(message).not.toMatch(/token|secret|access_token|refresh_token/i);
    });
  }
});
