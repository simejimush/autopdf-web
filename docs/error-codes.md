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

---

## 10. 監視 / 通知運用ルール

error_code は「原因の識別」だけでなく、監視・通知の起点としても使用する。  
今後の監視実装では、各 error_code に対して以下の観点で扱いを統一する。

### 追加で持つ運用属性

- severity  
  エラーの重要度。以下の4段階で扱う。
  - critical: すぐに対応が必要。サービス停止や広範囲影響の可能性あり
  - high: ユーザー影響が大きい。早めの対応が必要
  - medium: 個別影響はあるが緊急性は高くない
  - low: 想定内または軽微。監視対象だが即対応は不要

- admin_notify  
  管理者へ通知するか。Slack通知の判定に使用する。

- user_notify  
  ユーザーへ通知するか。メール通知の判定に使用する。

- reauth_required  
  ユーザーの再接続（Google再認証）が必要か。アプリ内バナー表示や再接続導線に使用する。

### 基本ルール

- severity が `critical` または `high` のものは、原則として管理者通知対象とする
- `reauth_required = yes` のものは、原則としてユーザー通知対象とする
- `GMAIL_EMPTY_RESULT` のような想定内ケースは通知しない
- 通知要否は error_message ではなく error_code ベースで判定する

### 主要エラーの運用方針

| error_code               | severity | admin_notify | user_notify | reauth_required | 備考                                         |
| ------------------------ | -------- | -----------: | ----------: | --------------: | -------------------------------------------- |
| GOOGLE_TOKEN_INVALID     | critical |          yes |         yes |             yes | Google再接続が必要                           |
| GOOGLE_TOKEN_MISSING     | high     |          yes |          no |              no | 実装/保存不備の可能性                        |
| GOOGLE_PERMISSION_DENIED | high     |          yes |         yes |             yes | 権限不足。再接続または再同意が必要な場合あり |
| GOOGLE_API_ERROR         | medium   |          yes |          no |              no | 一時障害の可能性あり                         |
| GMAIL_QUERY_INVALID      | medium   |          yes |          no |              no | ルール設定不備                               |
| GMAIL_FETCH_FAILED       | medium   |          yes |          no |              no | Gmail取得失敗                                |
| GMAIL_EMPTY_RESULT       | low      |           no |          no |              no | 想定内。通常は通知しない                     |
| DRIVE_FOLDER_INVALID     | high     |          yes |          no |              no | 保存先設定不備                               |
| DRIVE_UPLOAD_FAILED      | high     |          yes |          no |              no | アップロード失敗                             |
| DRIVE_PERMISSION_DENIED  | high     |          yes |         yes |              no | 保存先権限不足。ユーザー確認が必要           |
| DB_RLS_DENIED            | critical |          yes |          no |              no | セキュリティ/実装上の重大問題                |
| DB_CONSTRAINT            | high     |          yes |          no |              no | データ整合性エラー                           |
| DB_INSERT_FAILED         | high     |          yes |          no |              no | DB書き込み失敗                               |
| DB_UPDATE_FAILED         | high     |          yes |          no |              no | DB更新失敗                                   |
| RULE_NOT_FOUND           | medium   |          yes |          no |              no | 参照不整合の可能性                           |
| RULE_DISABLED            | low      |           no |          no |              no | 想定内。通常は通知しない                     |
| RUN_ALREADY_RUNNING      | low      |           no |          no |              no | 想定内の競合回避                             |
| RATE_LIMIT               | medium   |          yes |          no |              no | リトライ設計前提                             |
| TEMPORARY_UNAVAILABLE    | medium   |          yes |          no |              no | 一時障害                                     |
| TIMEOUT                  | high     |          yes |          no |              no | 処理時間超過                                 |
| UNKNOWN                  | critical |          yes |          no |              no | 原因未分類。最優先で確認                     |

### 補足

- 上記は監視MVP時点の初期方針とする
- 実運用で通知過多になった場合は、error_code 単位で通知条件を見直す
- user_notify = yes の場合でも、同一ユーザーへの重複通知は抑制を検討する
