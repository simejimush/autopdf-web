export type UserFacingRunError = {
  title: string;
  message: string;
  action?: string;
};

export function getRunErrorMessage(
  errorCode?: string | null,
): UserFacingRunError {
  switch (errorCode) {
    case "AUTH_REQUIRED":
      return {
        title: "ログインが必要です",
        message: "セッションが切れている可能性があります。",
        action: "再度ログインしてください。",
      };

    case "FORBIDDEN":
      return {
        title: "このルールを実行できません",
        message: "アクセス権限を確認できませんでした。",
        action: "ログイン中のアカウントを確認してください。",
      };

    case "GOOGLE_TOKEN_INVALID":
      return {
        title: "Googleの認証が切れています",
        message: "GmailまたはGoogle Driveへの接続に必要な認証情報が無効です。",
        action: "Googleアカウントを再接続してください。",
      };

    case "GOOGLE_PERMISSION_DENIED":
      return {
        title: "Googleの権限が不足しています",
        message: "必要なアクセス権限が許可されていません。",
        action: "Googleアカウントを再接続して権限を許可してください。",
      };

    case "GMAIL_QUERY_INVALID":
      return {
        title: "Gmail検索条件に問題があります",
        message: "検索条件の書き方が正しくない可能性があります。",
        action: "検索条件を見直してから再実行してください。",
      };

    case "DRIVE_FOLDER_INVALID":
      return {
        title: "保存先フォルダを確認してください",
        message:
          "指定したGoogle Driveフォルダが見つからないか、アクセスできません。",
        action: "保存先フォルダを確認してから再実行してください。",
      };

    case "RATE_LIMIT":
      return {
        title: "アクセスが集中しています",
        message: "Google側の利用制限により一時的に処理できませんでした。",
        action: "少し時間をおいてから再実行してください。",
      };

    case "TEMPORARY_UNAVAILABLE":
      return {
        title: "一時的なエラーが発生しました",
        message: "外部サービス側の一時的な不具合の可能性があります。",
        action: "時間をおいてから再実行してください。",
      };

    case "DB_RLS_DENIED":
      return {
        title: "データにアクセスできませんでした",
        message: "権限確認中にエラーが発生しました。",
        action: "改善しない場合は管理者確認が必要です。",
      };

    case "DB_CONSTRAINT":
      return {
        title: "データ保存中に問題が発生しました",
        message: "保存処理が正常に完了しませんでした。",
        action: "時間をおいて再実行してください。",
      };

    default:
      return {
        title: "処理に失敗しました",
        message: "データは失われていません。",
        action: "時間をおいて再実行してください。",
      };
  }
}
