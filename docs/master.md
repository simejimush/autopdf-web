# AutoPDF master.md（暫定 / v0.x）

最終更新: 2026-05-05
目的: Gmailの請求書メール等を自動でPDF化し、Google Driveへ保存する。加えて、対象メールに添付された PDF / CSV / XLSX ファイルもDriveへ保存し、実行履歴と監視状態を記録する。

---

## 1. 全体アーキテクチャ

- フロント: Next.js（App Router）
- 認証/DB: Supabase（Auth / Postgres / RLS）
- 定期実行: Vercel Cron（/api/cron）
- 外部API: Google OAuth（Gmail / Drive）
- PDF生成: pdf-lib（日本語フォント埋め込み想定）
- 通知: Slack（管理者向け） / メール（ユーザー向け）

---

## 2. ユーザーフロー

1. ログイン（Supabase Auth）
2. Google接続（OAuth）
3. ルール作成（Gmail検索条件 / 保存先フォルダ 等）
4. 手動Run または Cron実行
5. メール本文PDFと、対象添付ファイル（PDF / CSV / XLSX）をDrive保存 → 実行結果をダッシュボードやルール一覧で確認
6. 必要に応じてエラー通知・再接続案内を受ける

---

## 3. 主要テーブル（概要）

- google_connections: userのGoogle接続情報、監視状態、再認証要否、通知抑制状態
- rules: ルール（gmail_query / drive_folder_id / is_active / run_timing 等）
- runs: 実行履歴（status / processed_count / saved_count / message / error_code / started_at / finished_at）
- processed_emails: 二重処理防止（message_id等）
- user_profiles: 表示名、プラン情報などのプロフィール

※カラム詳細は schema.md を参照

---

## 4. 主要ルート / 役割（ざっくり）

- /dashboard: 最近のPDF・実行状況表示
- /rules: ルール一覧/作成/編集
- /settings: Google接続状態や設定確認
- /billing: プラン確認・アップグレード・請求導線
- /api/google/connect: Google OAuth開始
- /api/google/callback: OAuth完了（トークン保存）
- /api/rules: ルールCRUD
- /api/rules/[id]/run: 手動実行
- /api/cron: 定期実行（CRON_SECRETで保護）
- /admin/errors: 管理者向けエラー一覧

---

## 5. セキュリティ方針（最低限）

- RLS: ON（user_idで制限）
- Service Role Key: サーバー側のみで使用（クライアントに出さない）
- Cron: CRON_SECRET必須、未設定時はエラー
- Googleトークン: 暗号化して保存（refresh_token_enc など）
- 認証のないAPIアクセスは401で返す
- 通知やログに秘密情報を出さない

---

## 6. 現在の課題 / TODO（要約）

- [ ] 独自ドメイン取得とメール送信ドメイン認証
- [ ] notifyUser.ts の送信先固定を本番用に戻す
- [ ] EMAIL_FROM を正式アドレスへ変更
- [ ] 本番宛先での再通知テスト
- [ ] 迷惑メール判定の再確認
- [ ] 24時間成功ゼロなどのヘルスチェック追加
- [ ] 監視系ドキュメント整理後の最終見直し
- [ ] 完成時にセキュリティ再監査（構成ファイル/ルート一覧ベース）

---

## 7. 用語

- ルール: Gmail検索条件と保存先等の定義
- Run: ルールを実行した1回分の履歴
- error_code: 失敗原因を一意に識別するコード
- reauth_required: Google再接続が必要な状態
- 監視: runs と google_connections を中心に処理停止を検知する運用

---

## 8. プラン設計（2026-03〜）

### 現状

- Freeプランのルール上限（3件）を実装済み
- 上限到達時にアップグレード導線を表示
- Stripe 連携で Pro への課金導線を実装済み
- user_profiles.plan ベースで Free / Pro を保持

### プラン構成（方針確定）

- Free
  - ルール：3件

- Pro（月額 980円）
  - ルール：無制限
  - メイン課金プラン

- Pro+（将来予定）
  - 上位プラン（未実装）

### 設計方針

- ルール数はFree→Proの課金トリガーとして使用
- Proでは制限をなくし、実用レベルを担保
- 上位プランは「処理性能・AI・ログ」などの質で差別化

※詳細は plans.md を参照

---

## 9. 監視 / 通知方針（2026-04 追加）

### 目的

AutoPDFは「一度設定したら放置運用されやすい」性質がある。  
そのため、単にエラーを記録するだけでなく、**処理停止を早く検知し、管理者とユーザーの両方が気づける状態**を作ることを重視する。

---

### 監視レイヤー

監視は以下の3レイヤーで考える。

#### 1. システムエラー

例:

- API 500
- DB書き込み失敗
- 想定外例外
- Cron異常終了

対応:

- runs に error_code / message を記録
- 管理者へ通知
- 原因調査できるログを残す

#### 2. ビジネスエラー

例:

- Gmail取得失敗
- Drive保存失敗
- Google接続切れ
- 保存先フォルダ不正
- 検索条件不正

対応:

- runs に記録
- 内容に応じて管理者通知
- 再接続が必要なものはユーザー通知

#### 3. ユーザー個別エラー

例:

- 特定ユーザーだけGoogle接続が切れている
- 特定ルールだけ失敗する
- 長期間成功していない

対応:

- 管理画面やログで追跡可能にする
- ユーザーへ再接続や設定確認を案内する

---

### 通知方針

#### 管理者通知

- Slack を最優先の通知先とする
- 重大エラーや継続失敗を即通知する
- 通知内容は user_id / rule_id / error_code / trigger / 発生時刻 を最小単位とする

#### ユーザー通知

- Google再接続が必要な場合はメール通知する
- 初期段階ではメールを標準とし、LINE等は後回しとする
- 初期の通知対象は `GOOGLE_TOKEN_INVALID` / `GOOGLE_PERMISSION_DENIED`
- メール本文は短くし、「何が止まっているか」「何をすればよいか」を明確にする

#### アプリ内通知

- 再接続が必要な場合はログイン後に赤バナーで案内する
- メールを見逃した場合の補助導線として扱う

---

### 監視の中心データ

監視の中心は `runs` とする。

最低限、以下を必ず記録する。

- status
- error_code
- message
- started_at
- finished_at

また、Google接続状態の監視や通知抑制のため、`google_connections` 側にも状態管理用の情報を持つ。

主な監視用項目:

- last_success_at
- last_error_at
- last_error_code
- reauth_required
- last_user_notified_at
- last_user_notified_error_code

---

### 異常判定の考え方

単に「OAuth状態を見る」だけでなく、**ユーザー視点で処理が止まっているか**を重視する。

重要な判定例:

- 有効ルールがあるのに、過去24時間成功がゼロ
- `GOOGLE_TOKEN_INVALID` が発生している
- 同一ルールが連続失敗している
- 重要 error_code が複数ユーザーで同日に発生している

---

### 現在地（2026-04 時点）

以下は完了または暫定完了している。

- runs記録の強化
- error_code の通知優先度整理
- 管理者向けSlack通知
- 管理者用エラー一覧ページ（/admin/errors）
- Google接続切れ時のユーザーメール通知（暫定完了）

以下は今後の項目。

- Cronによるヘルスチェック強化
- 必要に応じて Sentry 等を追加
- 独自ドメイン認証後のメール通知本番化

---

### 設計原則

- エラーは握りつぶさず、必ず記録する
- 通知判定は message ではなく error_code ベースで行う
- 手動RunとCronで監視ロジックを分けない
- 通知処理はRouteに直書きせず、共通関数へ寄せる
- 通知失敗が本処理全体を巻き込んで失敗しないようにする
- 監視の詳細実務は monitoring.md にまとめる

---

## 10. メール添付ファイルのDrive保存（2026-05 追加）

### 概要

ルール実行時に、Gmail検索条件に一致したメール本文をPDF化してGoogle Driveへ保存する従来処理に加えて、対象メールに添付された業務ファイルもDriveへ保存する。

これにより、AutoPDFは単なる「メール本文PDF化」だけでなく、Gmailに届く請求書・領収書・明細などの添付書類も自動整理できるサービスとして拡張された。

### 保存対象

初期実装で保存対象とする添付ファイルは以下。

- PDF
- CSV
- XLSX

現時点では、画像・ZIP・DOCX・その他不明なmime typeは対象外とする。

### 保存仕様

ルール実行時の基本挙動は以下。

- メール本文は従来どおりPDF化して保存する
- 許可対象の添付ファイルがある場合は、添付ファイルも同じDrive保存先へ保存する
- 例: PDF添付メールの場合
  - メール本文PDF: 1件
  - 添付PDF: 1件
  - `runs.saved_count = 2`

### ファイル名

添付ファイルは、本文PDFと区別できるように以下のような形式で保存する。

```txt
{メール件名}_{gmail_message_id}_attachment-{番号}_{元の添付ファイル名}

例:

next week's pricing_15c8e5a84b840e37_attachment-1_06 11 17 pricing.pdf
```
