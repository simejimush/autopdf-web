# AutoPDF Database Schema

AutoPDF の Supabase (PostgreSQL) のテーブル構造とインデックス。

---

# 1. google_connections

Google OAuth 接続情報  
Gmail / Google Drive API 用トークン保存。

| column                        | type        | description                                              |
| ----------------------------- | ----------- | -------------------------------------------------------- |
| id                            | uuid        | PK                                                       |
| user_id                       | uuid        | auth.users.id                                            |
| status                        | text        | 接続状態                                                 |
| scopes                        | text        | OAuth scopes                                             |
| access_token_enc              | text        | 暗号化アクセストークン                                   |
| refresh_token_enc             | text        | 暗号化リフレッシュトークン                               |
| credential_version            | bigint      | credential更新CAS用version（0以上、default 0、NOT NULL） |
| token_expiry_at               | timestamptz | アクセストークン期限                                     |
| last_verified_at              | timestamptz | 最終接続確認                                             |
| last_success_at               | timestamptz | 最終成功時刻                                             |
| last_error_at                 | timestamptz | 最終エラー時刻                                           |
| last_error_code               | text        | 最終エラーコード                                         |
| reauth_required               | boolean     | 再認証が必要か                                           |
| last_user_notified_at         | timestamptz | 最終ユーザー通知時刻                                     |
| last_user_notified_error_code | text        | 最終ユーザー通知エラーコード                             |
| created_at                    | timestamptz | 作成日時                                                 |
| updated_at                    | timestamptz | 更新日時                                                 |

### Index

google_connections_pkey (id)

google_connections_user_id_key  
(user_id UNIQUE)

```

---

# 2. rules

ユーザーが作成する **自動PDF生成ルール**

| column               | type        | description            |
| -------------------- | ----------- | ---------------------- |
| id                   | uuid        | PK                     |
| user_id              | uuid        | ルール所有ユーザー     |
| is_enabled           | boolean     | 有効状態               |
| gmail_label_id       | text        | Gmail label            |
| unread_only          | boolean     | 未読のみ               |
| lookback_days        | integer     | 過去検索日数           |
| drive_folder_id      | text        | 保存先Google Drive     |
| subfolder_mode       | text        | サブフォルダ設定       |
| filename_mode        | text        | ファイル名モード       |
| run_mode             | text        | 実行モード             |
| consecutive_failures | integer     | 連続失敗数             |
| auto_disabled_at     | timestamptz | 自動停止日時           |
| subject_keywords     | text        | 件名キーワード         |
| gmail_query          | text        | Gmail検索クエリ        |
| query_label          | text        | UI表示用ルール名       |
| file_name_format     | text        | ファイル名形式         |
| filename_template    | text        | ファイル名テンプレート |
| is_active            | boolean     | UI用有効状態           |
| run_timing           | text        | cron / manual          |
| run_count            | integer     | 実行回数               |
| created_at           | timestamptz | 作成日時               |
| updated_at           | timestamptz | 更新日時               |

### Index

```

rules_pkey (id)

rules_user_created_idx
(user_id, created_at DESC)

```

---

# 3. runs

ルール実行履歴ログ

| column          | type        | description     |
| --------------- | ----------- | --------------- |
| id              | uuid        | PK              |
| user_id         | uuid        | 実行ユーザー    |
| rule_id         | uuid        | rules.id        |
| trigger         | text        | manual / cron   |
| status          | text        | success / error |
| started_at      | timestamptz | 実行開始        |
| finished_at     | timestamptz | 実行終了        |
| processed_count | integer     | 処理メール数    |
| saved_count     | integer     | 保存PDF数       |
| skipped_count   | integer     | スキップ数      |
| drive_folder_id | text        | 保存先          |
| message         | text        | 実行メッセージ  |
| error_code      | text        | エラーコード    |
| updated_at      | timestamptz | 更新日時        |

備考:

- `saved_count` は実行結果表示用の保存数。添付ファイル保存も含む場合があるため、Freeプランの月間PDF保存上限の集計元には使わない。

### Index

```

runs_pkey (id)

runs_status_updated_at_idx
(status, updated_at DESC)

runs_user_started_idx
(user_id, started_at DESC)

runs_rule_id_started_at_idx
(rule_id, started_at DESC)

```

---

# 4. processed_emails

Gmailメールの二重処理防止テーブル

| column              | type        | description      |
| ------------------- | ----------- | ---------------- |
| id                  | uuid        | PK               |
| user_id             | uuid        | 所有ユーザー     |
| rule_id             | uuid        | rules.id         |
| gmail_message_id    | text        | Gmail message id |
| drive_file_id       | text        | 保存されたPDF    |
| drive_web_view_link | text        | Drive URL        |
| drive_file_name     | text        | 保存された本文PDFファイル名 |
| created_at          | timestamptz | 作成日時         |
| saved_at            | timestamptz | 保存日時         |

### Index

```

processed_emails_pkey (id)

processed_emails_rule_msg_uniq
(rule_id, gmail_message_id UNIQUE)

processed_emails_user_idx
(user_id)

processed_emails_rule_idx
(rule_id)

processed_emails_user_saved_idx
(user_id, saved_at DESC)

```

用途

- Gmail メールの **二重処理防止**
- 保存済み本文PDFの追跡
- ダッシュボードの「最近保存したPDF」表示
- Freeプランの月間PDF保存上限は、`user_id` と `saved_at` の当月範囲で本文PDF保存成功件数を集計する
- `drive_file_name` は新規保存分から記録する。過去データでは null の場合がある

---

# 5. user_profiles

ユーザープロフィール

| column           | type        | description   |
| ---------------- | ----------- | ------------- |
| id               | uuid        | PK            |
| user_id          | uuid        | auth.users.id |
| display_name     | text        | 表示名        |
| company_name     | text        | 会社名        |
| industry         | text        | 業種          |
| employee_size    | text        | 従業員数      |
| marketing_opt_in | boolean     | マーケ同意    |
| created_at       | timestamptz | 作成日時      |
| updated_at       | timestamptz | 更新日時      |
| plan                    | text        | プラン種別（free / pro / pro_plus） ※default: free |
| billing_provider        | text        | 課金provider          |
| billing_customer_id     | text        | Stripe customer ID    |
| billing_subscription_id | text        | Stripe subscription ID |
| billing_status          | text        | subscription状態      |
| current_period_end      | timestamptz | 現在の課金期間終了    |
| cancel_at_period_end    | boolean     | 期間終了時解約        |
| plan_updated_at         | timestamptz | 課金情報の最終更新    |

#### planについて

- free: 無料プラン
- pro: 有料プラン（メイン）
- pro_plus: 上位プラン（将来用）

### Index

```

user_profiles_pkey (id)

user_profiles_user_id_key
(user_id UNIQUE)

user_profiles_user_id_idx
(user_id)

```

---

# 6. ai_usage_logs

AI利用量・コスト監視ログ。`/admin/ai-usage` の表示元テーブル。

| column             | type        | description                            |
| ------------------ | ----------- | -------------------------------------- |
| id                 | uuid        | PK                                     |
| user_id            | uuid        | 利用ユーザー                           |
| rule_id            | uuid        | 関連ルールID（任意）                   |
| run_id             | uuid        | 関連run ID（任意）                     |
| feature            | text        | AI機能名（例: document_type_detection） |
| provider           | text        | プロバイダ（default: openai）          |
| model              | text        | 利用モデル名                           |
| input_tokens       | integer     | 入力トークン数                         |
| output_tokens      | integer     | 出力トークン数                         |
| total_tokens       | integer     | 合計トークン数                         |
| estimated_cost_usd | numeric     | 推定コスト（USD）                      |
| status             | text        | success / error                        |
| error_code         | text        | エラーコード（失敗時）                 |
| created_at         | timestamptz | 作成日時                               |

### Index

```

ai_usage_logs_pkey
(id)

ai_usage_logs_feature_created_idx
(feature, created_at DESC)

ai_usage_logs_run_idx
(run_id)

ai_usage_logs_user_created_idx
(user_id, created_at DESC)

```

### RLS / Policies

- RLS: enabled
- authenticated policy: なし
- authenticated grant: なし
- service_role grant: `SELECT`, `INSERT`

備考:

- `20260529090000_create_ai_usage_logs.sql`は手動作成された既存shapeを再現する中間migration
- `20260530090000_harden_autopdf_core_security.sql`が既知policyを検証後に削除し、server-side repositoryだけへ限定する

---

# Table Relationships

```

auth.users
│
├── user_profiles
│
├── google_connections
│
├── rules
│ └── runs
│
└── processed_emails

```

---

# Core Processing Flow

```

Gmail
↓
rules (検索条件)
↓
cron / manual run
↓
runs (ログ)
↓
PDF生成
↓
Google Drive
↓
processed_emails (重複処理防止)

```

---

# Security

- 全テーブル **RLS enabled**
- user_id によるアクセス制御
- server API は **service role**
- `anon` / `PUBLIC` はapplication table権限なし
- authenticated policyはすべて`TO authenticated`と`(select auth.uid()) = user_id`を併用
- `user_profiles`のauthenticated `INSERT`は`user_id`だけ、`UPDATE`はプロフィール編集5列だけ
- `google_connections`のauthenticated `SELECT`は接続状態・監視列だけで、token、期限、通知内部状態を公開しない
- `rules` / `runs` / `processed_emails`はauthenticated own-row `SELECT`だけ
- `ai_usage_logs`はauthenticated直接アクセスなし

## Functions / Triggers

- signup: `private.handle_new_user_create_profile()`
  - `SECURITY DEFINER`, `SET search_path = ''`, owner `postgres`
  - `PUBLIC` / `anon` / `authenticated`の`EXECUTE`なし
  - `auth.users`の`AFTER INSERT` triggerからだけ呼び出す
  - `user_profiles(user_id)`だけを`ON CONFLICT DO NOTHING`で作成し、課金列は指定しない
- updated_at: `public.set_updated_at()`
  - `SECURITY INVOKER`, `SET search_path = ''`, owner `postgres`
  - `PUBLIC` / `anon` / `authenticated`の`EXECUTE`なし
  - `rules` / `runs` / `user_profiles`に各1本の`BEFORE UPDATE` trigger

## Migration source of truth

1. `20260528090000_create_autopdf_core_baseline.sql`（空のPreview DB専用）
2. `20260529090000_create_ai_usage_logs.sql`
3. `20260530090000_harden_autopdf_core_security.sql`
4. `20260726090000_add_google_credential_version.sql`

Productionでは1を実行しない。既存schemaのmigration history repairを別承認で行った後、3、4だけを適用する。

## Migration safety invariants

- AI usage migrationは空Preview baseline chain専用で、明示transaction、`lock_timeout`、`statement_timeout`、DDL前preflightを持つ。`public.ai_usage_logs`または同名PK/indexが既に存在すれば、部分shapeや未知driftとしてDDL前に停止する。
- AI usage migration直後の既知shapeは、14 columns、PK、3 indexes、RLS enabled、authenticated own-row SELECT/INSERT policies、application roleのtable grantなしである。次のhardening migrationがpolicyを削除し、`service_role`の`SELECT, INSERT`だけを付与する。
- credential migrationはDDL前に`credential_version`の状態を分類する。不在なら追加できる。完全一致の`bigint NOT NULL DEFAULT 0`かつvalidated nonnegative CHECKで、NULL/負値rowおよび未知constraintがなければ、適用済み相当としてDDLなしで完了する。
- nullable、default違い、型違い、constraint名衝突、異なる/未validated CHECK、NULL/負値rowは未知shapeとして停止する。不在columnの追加と0 backfillは同一transaction内で行い、token列、owner、`user_id`、CAS application契約は変更しない。
- Preview / Production DBへの適用とmigration history repairは、このschema文書の更新には含まれない。Productionではcore baselineを実行しない。

## Indexes

### runs

- runs_pkey (id)
- runs_status_updated_at_idx (status, updated_at DESC)
- runs_user_started_idx (user_id, started_at DESC)
- runs_rule_id_started_at_idx (rule_id, started_at DESC)

### google_connections

- google_connections_pkey (id)
- google_connections_user_id_key (user_id)

### rules

- rules_pkey (id)
- rules_user_created_idx (user_id, created_at DESC)

### processed_emails

- processed_emails_pkey (id)
- processed_emails_rule_msg_uniq (rule_id, gmail_message_id)
- processed_emails_user_idx (user_id)
- processed_emails_rule_idx (rule_id)
- processed_emails_user_saved_idx (user_id, saved_at DESC)
```
