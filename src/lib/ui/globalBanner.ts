//src\lib\ui\globalBanner.ts
export type GlobalBannerVariant = "error" | "warning" | "success" | "info";

export type GlobalBanner = {
  variant: GlobalBannerVariant;
  title: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
};

type Input = {
  isGoogleConnected: boolean;
  activeRuleCount: number;
  lastRunStatus?: "success" | "error" | "running" | "skipped" | null;
  lastRunErrorCode?: string | null;
  lastRunMessage?: string | null;
  pathname?: string;
};

function errorCopy(errorCode?: string | null, message?: string | null) {
  switch (errorCode) {
    case "GOOGLE_TOKEN_INVALID":
    case "GOOGLE_PERMISSION_DENIED":
    case "google_oauth_invalid":
      return {
        title: "Google連携の再接続が必要です",
        body: "Googleの認証が切れています。Googleアカウントを再接続してください。",
        ctaLabel: "Googleを再接続",
        ctaHref: "/api/google/connect",
      };

    case "GMAIL_QUERY_INVALID":
    case "gmail_query_invalid":
      return {
        title: "Gmail検索条件に問題があります",
        body: "ルールの検索クエリを見直してください。",
        ctaLabel: "ルールを確認",
        ctaHref: "/rules",
      };

    case "DRIVE_PERMISSION_DENIED":
    case "DRIVE_FOLDER_INVALID":
    case "drive_permission_denied":
      return {
        title: "Google Driveへの保存設定に問題があります",
        body: "保存先フォルダの権限、または保存先設定を確認してください。",
        ctaLabel: "ルールを確認",
        ctaHref: "/rules",
      };

    case "RATE_LIMIT":
    case "rate_limited":
      return {
        title: "一時的に制限されています",
        body: "しばらくしてから再実行してください（Google側の制限の可能性があります）。",
        ctaLabel: "ルールを確認",
        ctaHref: "/rules",
      };

    default:
      return {
        title: "自動保存でエラーが発生しました",
        body: message ?? "詳細はルールの最終実行ログを確認してください。",
        ctaLabel: "ルールを確認",
        ctaHref: "/rules",
      };
  }
}

export function buildGlobalBanner(input: Input): GlobalBanner | null {
  const { isGoogleConnected, lastRunStatus, lastRunErrorCode, lastRunMessage } =
    input;

  // 1) Google未接続は最優先
  if (!isGoogleConnected) {
    return {
      variant: "error",
      title: "Googleが未接続です",
      body: "Gmail/Drive連携が必要です。まずはGoogle接続を完了してください。",
      ctaLabel: "Google接続",
      ctaHref: "/api/google/connect",
    };
  }

  // 2) 実行エラーのみ表示
  if (lastRunStatus === "error") {
    return {
      variant: "error",
      ...errorCopy(lastRunErrorCode, lastRunMessage),
    };
  }

  // 3) それ以外は表示しない
  return null;
}
