# AutoPDF PROJECT MAP（迷子防止の地図）

このファイルは「どこを触れば何が変わるか」を最短で辿るための地図。
UI/DB/API/ジョブ/認証の入口だけを載せる（詳細は各docへ）。

---

## 0. いまの前提（運用ルール）

- **本番は main ブランチ**（Vercel Production）
- Preview は feature / chore ブランチ
- 本番URL: https://autopdf-web.vercel.app

---

## 1. ページ一覧（入口）

### 認証

- `/login`
  - app/login/... （ログイン画面）
- OAuth callback
  - app/auth/callback/... （Supabase OAuth戻り先）

### アプリ本体

- `/rules`（ルール一覧・作成導線の中心）
  - app/(app)/rules/page.tsx
  - app/(app)/rules/RulesPage.module.css（主にここが効く）
- `/dashboard`（状況サマリ）
  - app/(app)/dashboard/page.tsx など
- `/me`（接続状態/検証用）
  - app/me/page.tsx（※存在するなら）

---

## 2. API 入口（Route Handlers）

### Cron（定期実行）

- `GET /api/cron`
  - app/api/cron/route.ts
  - 認証: **CRON_SECRET（Vercel env）**
  - vercel.json: `path: /api/cron`（secretは置かない）

### ルール実行（手動Run）

- `POST /api/rules/[id]/run`
  - app/api/rules/[id]/run/route.ts（※実際のパスに合わせる）
  - cronはこの処理を使い回す設計（重複実装しない）

### Google接続

- `/api/google/connect` 等
  - app/api/google/...（接続開始/コールバック/保存）

---

## 3. DB（Supabase）

テーブル（最低限ここだけ覚える）

- `rules`：ユーザーのルール
- `runs`：実行ログ（成功/失敗/件数）
- `google_connections`：Google OAuthトークン/検証時刻
- `user_profiles`：表示名/会社名など（UIの右上表示）

RLS方針

- 基本は user_id で自分の行だけ見える
- 公開APIは作らない（cronやwebhookは別認証）

---

## 4. 外部連携（Google）

- Gmail: 検索→メッセージ取得→PDF化
- Drive: PDFアップロード

重要

- Redirect URL / APP_URL は **本番/Previewでズレやすい**
- 「Previewから本番URLに飛ぶ」は APP_URL 固定なら仕様（OK）

---

## 5. UI（よく触る場所）

- /rules の見た目が崩れたらまずここ：
  - app/(app)/rules/RulesPage.module.css
- 共通UI（導入中）
  - src/lib/ui/（Button/Badge/Card 等）

---

## 6. デプロイ（Vercel）

確認する場所

- Vercel → Deployments
  - **Production Current が main の最新コミットか**
- 本番が古い時の典型原因
  - main にマージされてない / Production branch が main じゃない

---

## 7. セキュリティ最低ライン（このプロジェクトの約束）

- secret を **GitHubに置かない**
  - vercel.json / コード / docs に直書き禁止
- CRON_SECRET は Vercel env で管理し、漏れたら即ローテーション
- APIは基本 auth.getUser() + RLS を前提にする
