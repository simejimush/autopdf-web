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

    case "GOOGLE_CONNECTION_NOT_FOUND":
    case "GOOGLE_REFRESH_TOKEN_MISSING":
    case "GOOGLE_TOKEN_INVALID":
    case "GOOGLE_TOKEN_REFRESH_FAILED":
    case "GOOGLE_REFRESH_OUTCOME_UNKNOWN":
      return {
        title: "Googleの認証が切れています",
        message: "GmailまたはGoogle Driveへの接続に必要な認証情報が無効です。",
        action: "Googleアカウントを再接続してください。",
      };

    case "GOOGLE_TOKEN_KEY_MISSING":
    case "GOOGLE_TOKEN_KEY_INVALID":
    case "GOOGLE_TOKEN_KEY_ID_UNKNOWN":
    case "GOOGLE_TOKEN_FORMAT_UNSUPPORTED":
    case "GOOGLE_TOKEN_DECRYPT_FAILED":
      return {
        title: "Google認証情報を読み取れませんでした",
        message: "保存済みの認証情報を安全に処理できませんでした。",
        action: "再実行せず、管理者に確認してください。",
      };

    case "GOOGLE_TOKEN_INPUT_INVALID":
    case "GOOGLE_TOKEN_ENCRYPT_FAILED":
    case "GOOGLE_TOKEN_WRITE_DISABLED":
    case "GOOGLE_TOKEN_STORE_FAILED":
    case "GOOGLE_TOKEN_UPDATE_CONFLICT":
    case "GOOGLE_TOKEN_REFRESH_IN_PROGRESS":
    case "GOOGLE_TOKEN_ROW_NOT_FOUND":
    case "GOOGLE_TOKEN_ROW_DUPLICATE":
      return {
        title: "Google認証情報を保存できませんでした",
        message: "認証情報の安全な保存処理を完了できませんでした。",
        action: "再実行せず、管理者に確認してください。",
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

    case "DRIVE_UPLOAD_FAILED":
      return {
        title: "Google Driveへの保存に失敗しました",
        message: "ファイルをGoogle Driveへ安全に保存できませんでした。",
        action: "時間をおいて再実行してください。",
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

    case "DB_INSERT_FAILED":
    case "DB_CONSTRAINT":
      return {
        title: "データ保存中に問題が発生しました",
        message: "保存処理が正常に完了しませんでした。",
        action: "時間をおいて再実行してください。",
      };

    case "FREE_MONTHLY_LIMIT_EXCEEDED":
      return {
        title: "今月の保存上限に達しました",
        message: "Freeプランの今月のPDF保存上限に達しています。",
        action: "翌月まで待つか、プランの変更をご検討ください。",
      };

    case "ATTACHMENT_COUNT_LIMIT_EXCEEDED":
      return {
        title: "添付ファイル数が上限を超えています",
        message: "このメールは安全に処理できる添付ファイル数を超えています。",
        action: "添付ファイル数を確認してから再実行してください。",
      };

    case "EMAIL_SIZE_LIMIT_EXCEEDED":
      return {
        title: "メールまたはファイルのサイズが上限を超えています",
        message: "このメールは安全に処理できるサイズを超えています。",
        action: "メール本文または添付ファイルを確認してください。",
      };

    case "TIMEOUT":
      return {
        title: "処理時間の上限に達しました",
        message:
          "外部サービスの応答に時間がかかり、安全のため処理を停止しました。",
        action: "時間をおいてから再実行してください。",
      };

    case "EXECUTION_DISABLED":
      return {
        title: "自動処理は一時停止中です",
        message: "安全のため、現在はメール処理を実行できません。",
        action: "しばらくしてから再実行してください。",
      };

    case "SYSTEM_LIMIT_EXCEEDED":
      return {
        title: "現在、実行上限に達しています",
        message: "システム全体の安全上限により処理を開始できませんでした。",
        action: "時間をおいてから再実行してください。",
      };

    case "USER_RATE_LIMIT_EXCEEDED":
      return {
        title: "短時間の実行上限に達しました",
        message: "安全のため、短時間に開始できる実行数を制限しています。",
        action: "少し時間をおいてから再実行してください。",
      };

    case "EXECUTION_CONCURRENCY_LIMIT":
      return {
        title: "別の処理を実行中です",
        message: "同時に開始できる処理数の上限に達しています。",
        action: "実行中の処理が終わってから再実行してください。",
      };

    case "RUN_ALREADY_RUNNING":
      return {
        title: "このルールは実行中です",
        message: "同じルールの重複実行を安全のため停止しました。",
        action: "現在の実行が終わってから再実行してください。",
      };

    case "GUARD_STORE_FAILED":
      return {
        title: "安全確認を完了できませんでした",
        message: "実行前の安全確認に失敗したため処理を開始していません。",
        action: "時間をおいてから再実行してください。",
      };

    default:
      return {
        title: "処理に失敗しました",
        message: "データは失われていません。",
        action: "時間をおいて再実行してください。",
      };
  }
}
