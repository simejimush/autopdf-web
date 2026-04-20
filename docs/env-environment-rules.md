# env-environment-rules.md

## 目的

AutoPDF において、`Development` / `Preview` / `Production` の環境変数を混同せず、安全に機能追加・検証・本番運用を行うためのルールを定義する。

このファイルは特に以下の事故を防ぐために使う。

- Preview で本番 Stripe を誤って使う
- Preview で本番 Google OAuth を誤って使う
- Preview で本番 cron / 自動実行が動く
- 本番通知が Preview から飛ぶ
- `.env.local` と Vercel env の役割が曖昧になる

---

## 基本方針

AutoPDF では当面、以下の 3 環境で運用する。

1. **Development**
   - ローカル開発用
   - `.env.local` を使用
   - `npm run dev` で確認する

2. **Preview**
   - Vercel Preview Deployment 用
   - `main` 以外のブランチを push して確認する
   - UI 確認、軽い結合確認、危険変更の事前確認に使う

3. **Production**
   - 本番環境
   - `main` へ反映されたものだけをデプロイする
   - 実運用データと本番外部サービスを使う

Vercel では `Production` / `Preview` / `Development` の環境単位で環境変数を分けて管理できる。

---

## 運用ルール

### 1. ブランチ運用

- `main` = Production 専用
- 機能追加・修正は `feature/...` ブランチで行う
- `feature/...` を push したら Preview で確認する
- OK なら `main` にマージする
- `main` に入ったものだけ Production に出す

### 2. `.env.local` の役割

`.env.local` は Development 専用とする。

用途:

- ローカルでの開発
- ローカルでの API 動作確認
- ローカルでの UI 表示確認

ルール:

- `.env.local` は Git に入れない
- 本番用の secret をそのまま貼らない
- 本番と同じ値を使う必要がないものはローカル専用値にする
- 値の共有が必要なときは `.env.example` にキー名だけを残す

### 3. Preview の役割

Preview は staging 代わりに使う。

用途:

- UI 崩れ確認
- 導線確認
- ダークモード確認
- ルール作成 / 編集画面確認
- 危険な env 変更前の事前確認
- 軽い結合確認

ルール:

- Preview で本番の危険操作を直接走らせない
- Preview で本番通知を飛ばさない
- Preview で本番 cron を常時動かさない
- Preview で本番 Stripe live key を使わない
- Preview で本番 Google OAuth client を使わない

### 4. Production の役割

Production は実運用専用とする。

ルール:

- `main` からのみ反映
- 実ユーザー向け
- 実運用データを扱う
- ローンチ後の検証は原則 Preview で先に行う
- 本番で直接試験的変更をしない

---

## 環境ごとの原則

### Development

- 値は `.env.local`
- ローカルでのみ使う
- `APP_URL=http://localhost:3000`
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`
- `CRON_SECRET` はローカル専用の簡易値でも可
- 通知系 env は空でも可
- Stripe は test を使う
- Google OAuth は必要なら開発用 client を使う

### Preview

- 値は Vercel Preview Environment Variables
- 本番とは分離する
- Stripe は test 用
- Google OAuth は preview 用 client を使う
- cron は原則停止、または限定的に動かす
- 通知先は preview 用に分ける
- `APP_URL` / `NEXT_PUBLIC_APP_URL` は preview URL 前提で整える

### Production

- 値は Vercel Production Environment Variables
- 実 secret を入れる
- Stripe は live
- Google OAuth は本番 client
- cron は本番 secret
- 通知先は本番運用先
- 実ユーザー影響のある値のみ配置

---

## env の分類ルール

### A. 公開系

例:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`

ルール:

- クライアントに露出してよい前提
- ただし環境ごとに URL や接続先は分ける
- Production と Preview で値が違ってもよい

### B. server-only secret

例:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `SLACK_ERROR_WEBHOOK_URL`

ルール:

- `.env.local` または Vercel env のみに置く
- Git に入れない
- Preview / Production で必ず分離する
- incident 時は優先ローテーション対象にする

### C. 構成値

例:

- `APP_URL`
- `GOOGLE_REDIRECT_URI`
- `STRIPE_PRICE_ID_PRO`
- `EMAIL_FROM`

ルール:

- secret ではないが環境で値が変わる
- Preview / Production で混ざると事故りやすい
- 値の意味を明確にして運用する

---

## AutoPDF で Preview / Production を分けるべき env

### 最優先で分けるもの

- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_PRO`
- `CRON_SECRET`
- `APP_URL`
- `NEXT_PUBLIC_APP_URL`

### 可能なら分けるもの

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `SLACK_ERROR_WEBHOOK_URL`

### 分離理由

- Google OAuth 誤接続防止
- Stripe 本番課金事故防止
- cron 誤実行防止
- 通知誤送信防止
- service role 事故の切り分け容易化

---

## AutoPDF 推奨値の考え方

### Development の例

```env
APP_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=test123
```
