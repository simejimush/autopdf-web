// autopdf-web/src/lib/ui/globalBanner.ts
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
        ctaHref: "/settings",
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
        ctaLabel: "ルールへ",
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
  const {
    isGoogleConnected,
    activeRuleCount,
    lastRunStatus,
    lastRunErrorCode,
    lastRunMessage,
    pathname,
  } = input;

  // 1) Google未接続は最優先で赤
  if (!isGoogleConnected) {
    return {
      variant: "error",
      title: "Googleが未接続です",
      body: "Gmail/Drive連携が必要です。まずはGoogle接続を完了してください。",
      ctaLabel: "Google接続",
      ctaHref: "/settings",
    };
  }

  // 2) 直近エラーがあるなら赤
  if (lastRunStatus === "error") {
    return { variant: "error", ...errorCopy(lastRunErrorCode, lastRunMessage) };
  }

  // 3) 有効ルールが0なら黄
  if (activeRuleCount === 0) {
    return {
      variant: "warning",
      title: "有効なルールがありません",
      body: "ルールをONにすると自動保存が始まります。",
      ctaLabel: "ルールを作成",
      ctaHref: "/rules/new",
    };
  }

  // 4) まだ一度も実行してないなら黄
  if (!lastRunStatus) {
    return {
      variant: "warning",
      title: "まだ一度も実行されていません",
      body: "手動実行で動作確認すると安心です。",
      ctaLabel: "ルールへ",
      ctaHref: "/rules",
    };
  }

  // 5) successはページでミニ化（/rulesでは本文・ボタン無し）
  const isRulesPage = !!pathname?.startsWith("/rules");

  if (isRulesPage) {
    return {
      variant: "success",
      title: "自動保存は正常です",
    };
  }

  // 6) 基本の成功バナー
  return {
    variant: "success",
    title: "自動保存は正常です",
    body: "最新の処理状態はルール画面で確認できます。",
    ctaLabel: "ルールへ",
    ctaHref: "/rules",
  };
}
