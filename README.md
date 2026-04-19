# AutoPDF

AutoPDF は、**Gmail のメールを自動で PDF 化し、Google Drive に保存する SaaS** です。  
請求書・領収書などのメール処理を自動化し、実行履歴やエラー状態も追跡できる構成を目指しています。

---

## 概要

主な流れは以下です。

1. ログイン
2. Google アカウント接続
3. ルール作成
4. 手動実行または Cron 実行
5. Gmail 取得 → PDF 生成 → Google Drive 保存
6. 実行結果やエラーを確認

---

## 技術スタック

- Next.js（App Router）
- Supabase（Auth / Postgres / RLS）
- Google OAuth / Gmail API / Google Drive API
- Vercel（Hosting / Cron）
- pdf-lib

---

## 主な機能

- Gmail 検索条件ベースのルール作成
- メール本文の PDF 化
- Google Drive への自動保存
- 手動 Run / Cron 実行
- runs テーブルによる実行履歴管理
- `/admin/errors` による管理者向けエラー一覧
- Slack による管理者通知
- Google 再接続が必要な場合のユーザー通知メール

---

## セットアップ

### 1. 依存関係をインストール

```bash
npm install
2. 開発サーバーを起動
npm run dev
3. ブラウザで確認

npm run dev 実行後、ターミナルに表示された URL をブラウザで開きます。
例:

http://localhost:3000
http://localhost:3001

※ 3000 番ポートが使用中の場合は 3001 などに変わることがあります。

主要ルート
/dashboard
最近の PDF・実行状況表示
/rules
ルール一覧 / 作成 / 編集
/settings
Google 接続状態や設定確認
/billing
プラン確認・アップグレード・請求導線
/admin/errors
管理者向けエラー一覧
/api/google/connect
Google OAuth 開始
/api/google/callback
OAuth 完了
/api/rules
ルール CRUD
/api/rules/[id]/run
手動実行
/api/cron
定期実行
ディレクトリ概要
app/
Next.js App Router
app/(app)/
ログイン後 UI
app/api/
API エンドポイント
src/lib/google/
Google OAuth / Gmail / Drive 連携
src/lib/runs/
実行処理の共通ロジック
src/lib/monitoring/
監視 / 通知関連ロジック
src/lib/pdf/
PDF 生成ロジック
docs/
設計・仕様・運用ドキュメント
ドキュメント一覧
docs/context.md
重要ファイル案内
docs/ARCHITECTURE.md
全体構造
docs/schema.md
DB 構造
docs/run-flow.md
実行フロー
docs/error-codes.md
error_code 定義と通知方針
docs/monitoring.md
監視 / 通知の実務仕様
docs/plans.md
プラン設計
docs/security.md
セキュリティ観点
docs/dev-rules.md
開発運用ルール
docs/quality-rules.md
品質ルール
開発ルール

このプロジェクトでは、安全性・監査可能性・保守性を優先します。

参照先:

AGENTS.md
docs/quality-rules.md
docs/dev-rules.md
補足
監視の中心は runs と error_code
Google 接続切れ系は reauth_required を使って扱う
通知失敗が本処理全体を巻き込まない設計を優先する
現状メモ
Free / Pro の課金導線あり
Free はルール 3 件まで
Pro はルール無制限
ユーザー通知メールは暫定運用あり
独自ドメイン認証後にメール送信設定を本番化予定
```
