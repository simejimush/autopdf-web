# AutoPDF API Spec

最終更新: 2026-XX-XX

このドキュメントは AutoPDF の API 仕様をまとめたもの。
実装変更があった場合は必ず更新する。

---

# 共通ルール

## 認証

ログイン必須APIは未ログインの場合

401 Unauthorized

を返す。

## 入力不正

入力検証エラーは

400 Bad Request

を返す。

## サーバーエラー

想定外エラーは

500 Internal Server Error

---

# API一覧

## GET /me

### 目的

ログインユーザー情報と接続状態確認

### 認証

必要

### レスポンス例

{
"user": {
"id": "uuid",
"email": "user@example.com
"
},
"googleConnected": true
}

---

## GET /api/google/connect

### 目的

Google OAuth開始

### 認証

必要

### 動作

Google OAuthページへリダイレクト

---

## GET /api/google/callback

### 目的

Google OAuth完了処理

### 認証

不要（OAuthフロー）

### 処理

- authorization code取得
- access_token取得
- refresh_token保存
- google_connections 更新

---

## GET /api/rules

### 目的

ユーザーのルール一覧取得

### 認証

必要

### レスポンス例

[
{
"id": "uuid",
"gmail_query": "label:INBOX is:unread",
"drive_folder_id": "...",
"is_active": true
}
]

---

## POST /api/rules

### 目的

ルール作成

### 認証

必要

### 入力

{
"gmail_query": "...",
"drive_folder_id": "...",
"run_timing": "manual | daily"
}

---

## POST /api/rules/[id]/run

### 目的

ルール手動実行

### 認証

必要

### 処理

1. runs作成
2. Gmail検索
3. PDF生成
4. Drive保存
5. runs更新

---

## GET /api/cron

### 目的

定期実行

### 認証

CRON_SECRET 必須

### 処理

有効ルールを順番に実行

---

# エラーハンドリング

APIは以下を守る

- AUTH_REQUIRED
- FORBIDDEN
- GMAIL_QUERY_INVALID
- DRIVE_FOLDER_INVALID
- GOOGLE_TOKEN_INVALID
- RATE_LIMIT

エラー時は

runs.status = error

を記録する
