# Error Codes（AutoPDF）

このファイルは`runs.error_code`のRuntime正式コードと、関連するInternal / Reservedコードを区別して記録する。

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

## A. Runtime正式コード

`src/lib/runs/normalizeRunErrorCode.ts`の`KNOWN_RUN_ERROR_CODES`をsource of truthとする。以下の20件だけが、現在のruntimeで完全一致により保持され、`runs.error_code`へ正式に記録され得るコードである。全件について`getRunErrorMessage()`が固定の安全文言または`UNKNOWN` fallbackを返す。

### Google token暗号化

- `GOOGLE_TOKEN_KEY_MISSING`
- `GOOGLE_TOKEN_KEY_INVALID`
- `GOOGLE_TOKEN_KEY_ID_UNKNOWN`
- `GOOGLE_TOKEN_FORMAT_UNSUPPORTED`
- `GOOGLE_TOKEN_DECRYPT_FAILED`

### Google token保存

- `GOOGLE_TOKEN_INPUT_INVALID`
- `GOOGLE_TOKEN_ENCRYPT_FAILED`
- `GOOGLE_TOKEN_WRITE_DISABLED`
- `GOOGLE_TOKEN_STORE_FAILED`
- `GOOGLE_TOKEN_UPDATE_CONFLICT`
- `GOOGLE_TOKEN_ROW_NOT_FOUND`
- `GOOGLE_TOKEN_ROW_DUPLICATE`

### Google OAuth

- `GOOGLE_CONNECTION_NOT_FOUND`
- `GOOGLE_REFRESH_TOKEN_MISSING`
- `GOOGLE_TOKEN_INVALID`
- `GOOGLE_PERMISSION_DENIED`
- `GOOGLE_TOKEN_REFRESH_FAILED`

### Run実行

- `DB_INSERT_FAILED`
- `FREE_MONTHLY_LIMIT_EXCEEDED`

### Fallback

- `UNKNOWN`

### 正規化契約

- 既知コードの文字列、またはErrorオブジェクトの文字列`code`が完全一致した場合だけ、そのコードを保持する
- `null`、`undefined`、空文字、空白のみ、非文字列、未知コードは`UNKNOWN`にする
- `error.name`や`error.message`本文からコードを推測しない
- typo、lowercase、部分一致を補正しない
- alias変換を行わない

---

## B. Internal repository / credentialコード

以下はrepository、credential handle、またはAPI境界の安全停止用コードであり、現在のRuntime正式コードではない。呼び出し元でRuntime正式コードへ明示変換されない限り、そのまま`runs.error_code`へ保存しない。

Google token暗号化・保存層のうちRuntime正式コードへ採用済みのコードはAに掲載し、ここでは重複掲載しない。

### Run作成repository

- `RUN_STORE_INPUT_INVALID`
- `RUN_STORE_FAILED`
- `RUN_STORE_RESULT_MISSING`
- `RUN_STORE_RESULT_DUPLICATE`
- `RUN_STORE_RESULT_MISMATCH`

### Run更新repository

- `RUN_UPDATE_INPUT_INVALID`
- `RUN_UPDATE_FAILED`
- `RUN_UPDATE_RESULT_MISSING`
- `RUN_UPDATE_RESULT_DUPLICATE`
- `RUN_UPDATE_RESULT_MISMATCH`

### processed_emails repository

- `PROCESSED_EMAIL_INPUT_INVALID`
- `PROCESSED_EMAIL_STORE_FAILED`
- `PROCESSED_EMAIL_RESULT_MISSING`
- `PROCESSED_EMAIL_RESULT_DUPLICATE`
- `PROCESSED_EMAIL_RESULT_MISMATCH`
- `PROCESSED_EMAIL_ALREADY_EXISTS`
- `PROCESSED_EMAIL_LOOKUP_INPUT_INVALID`
- `PROCESSED_EMAIL_LOOKUP_FAILED`
- `PROCESSED_EMAIL_LOOKUP_DUPLICATE`
- `PROCESSED_EMAIL_LOOKUP_MISMATCH`

### Rules repository

- `RULE_STORE_INPUT_INVALID`
- `RULE_STORE_FAILED`
- `RULE_STORE_RESULT_MISSING`
- `RULE_STORE_RESULT_DUPLICATE`

### Billing repository

- `BILLING_PROFILE_INPUT_INVALID`
- `BILLING_PROFILE_STORE_FAILED`
- `BILLING_PROFILE_ROW_NOT_FOUND`
- `BILLING_PROFILE_ROW_DUPLICATE`

### Stripe webhook repository

- `STRIPE_WEBHOOK_INPUT_INVALID`
- `STRIPE_WEBHOOK_OWNER_NOT_FOUND`
- `STRIPE_WEBHOOK_OWNER_DUPLICATE`
- `STRIPE_WEBHOOK_OWNER_CONFLICT`
- `STRIPE_WEBHOOK_PROFILE_READ_FAILED`
- `STRIPE_WEBHOOK_PROFILE_UPDATE_FAILED`
- `STRIPE_WEBHOOK_PROFILE_UPDATE_NOT_FOUND`
- `STRIPE_WEBHOOK_PROFILE_UPDATE_DUPLICATE`

### Credential handle

- `GOOGLE_TOKEN_CREDENTIAL_SERIALIZATION_FORBIDDEN`

---

## C. Reserved / futureコード

以下は既存の運用方針として予約するが、現在のbranchではRuntime正式コードとして生成・保持されない。削除はせず、将来実装する場合はnormalizer、message mapping、testsを同じコミットで更新する。

`getRunErrorMessage()`に安全文言が存在するコードやnotification setに含まれるコードでも、`KNOWN_RUN_ERROR_CODES`にない限りRuntime正式コードではない。

### 認証 / 認可

- `AUTH_REQUIRED`
- `FORBIDDEN`

### Google OAuth / token

- `GOOGLE_TOKEN_MISSING`
- `GOOGLE_API_ERROR`

### Gmail

- `GMAIL_QUERY_INVALID`
- `GMAIL_FETCH_FAILED`
- `GMAIL_EMPTY_RESULT`

### Google Drive

- `DRIVE_FOLDER_INVALID`
- `DRIVE_UPLOAD_FAILED`
- `DRIVE_PERMISSION_DENIED`

### DB / Supabase

- `DB_RLS_DENIED`
- `DB_CONSTRAINT`
- `DB_UPDATE_FAILED`

### Run実行

- `RULE_NOT_FOUND`
- `RULE_DISABLED`
- `RUN_ALREADY_RUNNING`

### システム / インフラ

- `RATE_LIMIT`
- `TEMPORARY_UNAVAILABLE`
- `TIMEOUT`

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

### 現行実装の通知対象set

- Slack通知: `GOOGLE_TOKEN_INVALID`, `GOOGLE_PERMISSION_DENIED`, `DRIVE_FOLDER_INVALID`, `DRIVE_UPLOAD_FAILED`, `DB_INSERT_FAILED`, `UNKNOWN`
- ユーザー通知: `GOOGLE_TOKEN_INVALID`, `GOOGLE_PERMISSION_DENIED`
- `reauth_required`: `GOOGLE_TOKEN_INVALID`, `GOOGLE_PERMISSION_DENIED`
- Reservedコードがsetに含まれていても、それだけでRuntime正式コードとして生成されることを意味しない

### 主要エラーの運用方針

以下は既存の運用方針表であり、Runtime正式コードとReserved / futureコードの両方を含む。現在の生成可否はA / Cの分類、実際の通知対象は上記setをsource of truthとする。severity、admin_notify、user_notify、reauth_requiredの方針値は変更しない。

<!-- prettier-ignore -->
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
| FREE_MONTHLY_LIMIT_EXCEEDED | low   |           no |          no |              no | Freeプランの月間PDF保存上限                  |
| RATE_LIMIT               | medium   |          yes |          no |              no | リトライ設計前提                             |
| TEMPORARY_UNAVAILABLE    | medium   |          yes |          no |              no | 一時障害                                     |
| TIMEOUT                  | high     |          yes |          no |              no | 処理時間超過                                 |
| UNKNOWN                  | critical |          yes |          no |              no | 原因未分類。最優先で確認                     |

### 補足

- 上記は監視MVP時点の初期方針とする
- 実運用で通知過多になった場合は、error_code 単位で通知条件を見直す
- user_notify = yes の場合でも、同一ユーザーへの重複通知は抑制を検討する
- 現行実装の初期ユーザー通知対象は `GOOGLE_TOKEN_INVALID` / `GOOGLE_PERMISSION_DENIED` の2つに限定する
