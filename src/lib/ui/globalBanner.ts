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
    case "google_oauth_invalid":
      return {
        title: "Google接続が無効になっています",
        body: "再接続が必要です。接続し直すと自動保存が再開します。",
        ctaLabel: "Googleを再接続",
        ctaHref: "/api/google/connect",
      };

    case "gmail_query_invalid":
      return {
        title: "Gmail検索条件に問題があります",
        body: "ルールの検索クエリを見直してください。",
        ctaLabel: "ルールを確認",
        ctaHref: "/rules",
      };

    case "drive_permission_denied":
      return {
        title: "Google Driveへの保存権限がありません",
        body: "保存先フォルダの権限、または接続スコープを確認してください。",
        ctaLabel: "設定を確認",
        ctaHref: "/rules",
      };

    case "rate_limited":
      return {
        title: "一時的に制限されています",
        body: "しばらくしてから再実行してください（Google側の制限の可能性）。",
        ctaLabel: "ルールを確認",
        ctaHref: "/rules",
      };

    default:
      return {
        title: "自動保存でエラーが発生しました",
        body: message ?? "詳細は /rules の最終実行ログを確認してください。",
        ctaLabel: "エラーを確認",
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
