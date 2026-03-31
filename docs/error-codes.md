# Error Codes（AutoPDF）

このファイルは runs.error_code に記録するコード一覧。

目的：

- エラーの原因を一意に識別する
- UI / ログ / サポート対応を統一する
- 曖昧な message 依存を防ぐ

---

## 命名ルール

- すべて大文字 + スネークケース
- プレフィックスで分類（AUTH / GOOGLE / GMAIL / DRIVE / DB / SYSTEM）
- 「原因」を表す（結果ではない）

---

## 1. 認証 / 認可

- AUTH_REQUIRED  
  未ログイン（セッションなし）

- FORBIDDEN  
  他ユーザーのリソースにアクセス

---

## 2. Google OAuth / トークン

- GOOGLE_TOKEN_INVALID  
  トークン無効 / 期限切れ

- GOOGLE_TOKEN_MISSING  
  トークン未保存

- GOOGLE_PERMISSION_DENIED  
  スコープ不足 / アクセス拒否

- GOOGLE_API_ERROR  
  Google API一般エラー（詳細不明）

---

## 3. Gmail

- GMAIL_QUERY_INVALID  
  クエリ形式エラー

- GMAIL_FETCH_FAILED  
  メール取得失敗

- GMAIL_EMPTY_RESULT  
  該当メールなし（※正常扱いでもOK）

---

## 4. Google Drive

- DRIVE_FOLDER_INVALID  
  フォルダID不正 / 存在しない

- DRIVE_UPLOAD_FAILED  
  アップロード失敗

- DRIVE_PERMISSION_DENIED  
  書き込み権限なし

---

## 5. DB / Supabase

- DB_RLS_DENIED  
  RLS違反

- DB_CONSTRAINT  
  一意制約 / 外部キーエラー

- DB_INSERT_FAILED  
  INSERT失敗

- DB_UPDATE_FAILED  
  UPDATE失敗

---

## 6. 実行処理（Run）

- RULE_NOT_FOUND  
  ルールが存在しない

- RULE_DISABLED  
  無効ルール

- RUN_ALREADY_RUNNING  
  二重実行防止

---

## 7. システム / インフラ

- RATE_LIMIT  
  API制限超過

- TEMPORARY_UNAVAILABLE  
  一時的障害（リトライ可能）

- TIMEOUT  
  処理タイムアウト

- UNKNOWN  
  想定外エラー（fallback）

---

## 8. 運用ルール（重要）

- error_code は必ず設定する（空禁止）
- message は人間向け短文（機密情報NG）
- 詳細はログに出す（console / monitoring）

例：

status: error  
error_code: GOOGLE_TOKEN_INVALID  
message: "Google接続が無効です。再接続してください"

---

## 9. 将来拡張

- 必要に応じて追加OK（削除は慎重に）
- 既存コードは互換性維持
