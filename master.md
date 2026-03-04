# AutoPDF master.md（暫定 / v0.x）

最終更新: 2026-02-24
目的: Gmailの請求書メール等を自動でPDF化し、Google Driveへ保存。実行履歴をSupabaseに記録。

---

## 1. 全体アーキテクチャ

- フロント: Next.js（App Router）
- 認証/DB: Supabase（Auth / Postgres / RLS）
- 定期実行: Vercel Cron（/api/cron）
- 外部API: Google OAuth（Gmail / Drive）
- PDF生成: pdf-lib（日本語フォント埋め込み想定）

---

## 2. ユーザーフロー

1. ログイン（Supabase Auth）
2. Google接続（OAuth）
3. ルール作成（Gmail検索条件 / 保存先フォルダ 等）
4. 手動Run または Cron実行
5. PDF保存 → 実行結果をダッシュボードで確認

---

## 3. 主要テーブル（覚えてる範囲でOK）

- google_connections: userのGoogle接続情報（refresh_token等）
- rules: ルール（gmail_query / drive_folder_id / is_active / run_timing 等）
- runs: 実行履歴（status / processed_count / saved_count / message / error_code / started_at / finished_at）
- processed_emails: 二重処理防止（message_id等）

※カラム詳細はここでは書かなくてOK（必要になったら追記）

---

## 4. 主要ルート / 役割（ざっくり）

- /me: セッション確認・接続状態確認
- /dashboard: 最近のPDF・実行状況表示
- /rules: ルール一覧/作成/編集
- /api/google/connect: Google OAuth開始
- /api/google/callback: OAuth完了（トークン保存）
- /api/rules: ルールCRUD
- /api/rules/[id]/run: 手動実行
- /api/cron: 定期実行（CRON_SECRETで保護）

---

## 5. セキュリティ方針（最低限）

- RLS: ON（user_idで制限）
- Service Role Key: サーバー側のみで使用（クライアントに出さない）
- Cron: CRON_SECRET必須、未設定時はエラー
- Googleトークン: 暗号化して保存（refresh_token_enc など）

---

## 6. 現在の課題 / TODO（メモでOK）

- [ ] エラー時の表示/ログを改善（ユーザーにわかりやすく）
- [ ] runs増加時の検索高速化（UIが重くならない）
- [ ] 料金/プランとマイページ要件（後で実装）
- [ ] 完成時にセキュリティ再監査（構成ファイル/ルート一覧ベース）

---

## 7. 用語

- ルール: Gmail検索条件と保存先等の定義
- Run: ルールを実行した1回分の履歴
