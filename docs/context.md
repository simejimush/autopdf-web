# AutoPDF context（重要ファイル厳選）

## 入口 / 設定（全体挙動に効く）

- app/layout.tsx: ルートレイアウト
- app/page.tsx: ログイン後に見えるトップ（今の簡易トップ）
- app/globals.css: 全体CSS
- app/(app)/layout.tsx: ログイン後エリアの共通レイアウト
- app/(app)/AppTopbar.tsx: 上部UI（右上メニュー等）
- middleware.ts: 認証/リダイレクト（全ページ影響）
- next.config.ts: Next設定
- vercel.json: Cron設定（/api/cron のスケジュール）

## 認証 / Google OAuth（Preview→本番に飛ぶ問題の核心）

- app/login/page.tsx: ログイン開始（ここが入口）
- app/auth/callback/route.ts: 認証コールバック（アプリ側）
- app/api/google/connect/route.ts: Google接続開始
- app/api/google/callback/route.ts: Googleコールバック受け取り
- src/lib/google/auth.ts: OAuthクライアント/トークン管理
- src/lib/supabase/server.ts: サーバー側Supabase client
- src/lib/supabase/client.ts: クライアント側Supabase client
- src/lib/supabase/admin.ts: Admin（service_role）系

## ルールUI（あなたが今一番触ってる画面）

- app/(app)/rules/page.tsx: ルール一覧
- app/(app)/rules/RulesPage.module.css: ルール一覧CSS
- app/(app)/rules/[id]/page.tsx: ルール編集
- app/(app)/rules/[id]/RuleEditPage.module.css: 編集CSS
- app/(app)/rules/RunButton.tsx: 実行ボタン
- app/(app)/rules/CopyButton.tsx: コピーボタン
- app/(app)/rules/RuleToggle.tsx: ON/OFFトグル

## 実行系API（自動化の中核）

- app/api/cron/route.ts: 定期実行エンドポイント
- app/api/rules/[id]/run/route.ts: ルール手動実行API

## PDF / Gmail / Drive（コア機能）

- src/lib/google/gmail.ts: Gmail検索/取得
- src/lib/google/drive.ts: Driveアップロード
- src/lib/pdf/emailToPdf.ts: PDF生成

## 開発ルール（AIへの指示）

このプロジェクトでは以下を必ず守る

- Tailwindは使用していない
- CSS Modulesを使用
- UI文言は基本日本語
- 大きなリファクタは禁止（局所修正）
- 「丸ごと置き換え」か「差分指定」を明確に
