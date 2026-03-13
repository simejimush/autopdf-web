# AutoPDF Run Flow

ルール実行時の処理フロー  
実装: `src/lib/runs/executeRule.ts`

---

## 1 ルール取得

rules テーブルから対象ルールを取得

取得するカラム

- gmail_query
- drive_folder_id

rule が存在しない場合はエラー

---

## 2 Gmail検索

Gmail API を使用してメール検索

使用クエリ

rule.gmail_query

取得件数

maxResults = 1

返却

messageIds[]

---

## 3 メールが見つからない場合

messageIds が空の場合

runs テーブルを更新

status = success

processed_count = 0  
saved_count = 0  
skipped_count = 0  

message

処理終了

---

## 4 メール取得

Gmail API

messages.get

取得データ

- subject
- from
- date
- snippet
- bodyText
- messageId

---

## 5 PDF生成

`emailToPdfBytes()` を使用

入力

- subject
- from
- date
- snippet
- bodyText
- messageId
- generatedAt

出力

pdfBytes

---

## 6 ファイル名生成

subject を安全な文字列に変換

---

## 7 Drive保存

Google Drive API

`uploadPdfToDrive()`

保存先

rule.drive_folder_id

---

## 8 runs 更新（成功）

runs テーブル更新

status = success

processed_count = 1  
saved_count = 1  
skipped_count = 0  

message

finished_at 更新

---

## 9 エラー処理

例外発生時

runs 更新

status = error

error_code

message

エラーメッセージ

finished_at 更新