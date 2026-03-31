# AutoPDF Runbook

AutoPDF SaaS の運用トラブル対応手順書。

目的

- 障害時の対応を迅速化
- よくあるトラブルの解決手順を標準化
- サポート対応の効率化

---

# 1. Gmail取得失敗

## 症状

runs.status = error  
メールが取得されない  
PDF生成が行われない

## 確認

1 runs テーブル確認

最新 run を確認
select \* from runs
order by started_at desc
limit 10

2 エラーメッセージ確認
runs.message

3 Google接続状態
google_connections

4 Gmail API quota

Google Cloud Console  
API Dashboard を確認

## 対応

| 原因           | 対応                 |
| -------------- | -------------------- |
| Google接続切れ | ユーザーに再接続依頼 |
| token期限      | 再接続               |
| API quota      | 時間を置く           |

---

# 2. Google接続エラー

## 症状

ユーザーが Google接続できない

例
invalid_client
invalid_grant
access_denied

## 確認

1 Google Cloud Console

OAuth client ID

2 redirect URI
https://xxxxx/api/google/callback

一致しているか

3 client secret

.env 設定確認

## 対応

| 原因                   | 対応        |
| ---------------------- | ----------- |
| client secret mismatch | 再設定      |
| redirect URI mismatch  | Console修正 |
| token失効              | 再接続      |

---

# 3. PDF生成失敗

## 症状

runs.message

WinAnsi cannot encode
または
PDF generation failed

## 確認

1 メール本文

特殊文字

2 PDF生成ログ

3 フォント

## 対応

| 原因                | 対応           |
| ------------------- | -------------- |
| 未対応文字          | フォント変更   |
| 長文                | truncate処理   |
| PDFライブラリエラー | ライブラリ更新 |

---

# 4. Drive保存失敗

## 症状

PDF生成成功  
Drive保存失敗

## 確認

1 Google接続
google_connections

2 Drive API quota

Google Cloud Console

3 保存レスポンス

API response

## 対応

| 原因            | 対応       |
| --------------- | ---------- |
| Drive token失効 | 再接続     |
| quota超過       | 時間を置く |
| APIエラー       | 再試行     |

---

# 5. Cron動作しない

## 症状

自動実行されない

## 確認

1 Vercel Cron logs

2 endpoint
/api/cron

3 HTTP response

200 になっているか

4 runs テーブル

新規 run が作成されているか

## 対応

| 原因            | 対応    |
| --------------- | ------- |
| Cron停止        | 再設定  |
| endpointエラー  | API修正 |
| secret mismatch | env修正 |

---

# 6. PDFが混ざる / 他ユーザーデータ

## 症状

ユーザーのPDFが混ざる

## 確認

1 runs

user_id

2 rules

rule ownership

3 processed_emails

user_id

## 対応

最優先対応

1 処理停止

cron停止

2 問題箇所特定

3 user_id境界修正

---

# 7. ユーザーからの問い合わせ対応

## よくある問い合わせ

### PDFが作成されない

確認

- Google接続
- Gmail検索条件
- runログ

### PDFが見つからない

確認

- Drive保存
- run結果

### Gmail取得されない

確認

- query
- label
- unread条件

---

# 8. 手動再実行

管理者が再実行する方法

例
POST /api/rules/[id]/run

または

UIから実行

---

# 9. データ確認

## runs

select \* from runs
order by started_at desc

## rules

select \* from rules

## processed_emails

select \* from processed_emails

---

# 10. 緊急時

以下を実施

1 Cron停止  
2 問題箇所特定  
3 ログ確認  
4 修正  
5 再デプロイ

---

# 更新ルール

トラブルが発生したら  
この runbook に追記する。
