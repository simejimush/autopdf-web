type RunLite = {
  id: string;
  status: string;
  message: string | null;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
  saved_count: number | null;
  skipped_count: number | null;
  processed_count: number | null;
};

function messageJa(message: string | null) {
  if (!message) return "エラーが発生しました";

  const lower = message.toLowerCase();

  if (lower.includes("invalid authentication credentials")) {
    return "Google認証が無効です（再接続してください）";
  }

  if (lower.includes("insufficient permissions")) {
    return "Googleの権限が不足しています";
  }

  if (lower.includes("drive_folder_id is required")) {
    return "保存先フォルダが未設定です";
  }

  if (lower.includes("gmail_query is required")) {
    return "Gmail検索条件が未設定です";
  }

  if (lower.includes("failed to load rules")) {
    return "ルールの読み込みに失敗しました";
  }

  return message;
}

export function formatRunMessageJa(run: RunLite | null) {
  if (!run) return "実行履歴なし";

  if (run.status === "running") {
    return "実行中です";
  }

  if (run.status === "success") {
    const saved = run.saved_count ?? 0;
    const skipped = run.skipped_count ?? 0;
    const processed = run.processed_count ?? 0;
    return `保存 ${saved}件・除外 ${skipped}件・処理 ${processed}件`;
  }

  if (run.status === "error") {
    switch (run.error_code) {
      case "GOOGLE_TOKEN_INVALID":
        return "Googleの認証が切れています。Googleアカウントを再接続してください。";
      case "GOOGLE_PERMISSION_DENIED":
        return "Googleの権限が不足しています";
      case "GMAIL_QUERY_INVALID":
        return "Gmail検索条件が不正です";
      case "DRIVE_FOLDER_INVALID":
        return "保存先フォルダが見つかりません";
      case "AUTH_REQUIRED":
        return "ログインが必要です";
      case "FORBIDDEN":
        return "アクセス権限がありません";
      case "RATE_LIMIT":
        return "しばらく待ってから再実行してください";
      case "TEMPORARY_UNAVAILABLE":
        return "一時的なエラーです。再試行してください";
    }

    return messageJa(run.message);
  }

  return "実行履歴なし";
}
