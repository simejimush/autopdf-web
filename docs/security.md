# AutoPDF Security

## 認証

Supabase Auth を使用

未ログインユーザーは  
401 Unauthorized

---

## RLS

すべてのユーザーデータは  
user_id に紐づく

RLS を前提にアクセスする

---

## API保護

未認証APIは禁止

必ず user 確認を行う

---

## Cron

/api/cron は

CRON_SECRET 必須

---

## OAuth

Google OAuth を使用

保存する情報

- refresh_token
- access_token

トークンはログ出力しない

---

## 秘密情報

以下は絶対に公開しない

- Supabase service_role
- Google client_secret
- refresh_token

---

## ログ

runs テーブルに

- status
- error_code
- message

を記録する

## 依存関係ルール

- npm / pip ともにバージョン固定
- 新規ライブラリは調査してから追加
- CIで最新バージョン自動取得は禁止
