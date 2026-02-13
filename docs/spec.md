AutoPDF v1 仕様書（spec.md）
1. 目的

Gmailの対象メールを検索し、PDF化してGoogle Driveへ保存する。
v1は 手動Runで確実に動く ことを完成条件とする。

2. v1の完成定義（Definition of Done）

ルール（Rule）が1つ以上作成できる

「Run」操作でGmail検索が実行される

対象メールがPDFとして生成される

PDFがGoogle Driveの指定フォルダに保存される

実行結果がrunsに記録され、UIで確認できる

同じメールを重複してPDF化しない（重複防止）

3. スコープ外（v1ではやらない）

自動スケジュール実行（cron）

複数ルール（1 user = 複数 rule）

高度な検索UI（OR/カンマ補助UIなど）

OCR/AI分類

Driveのフォルダ自動生成の高度化（取引先別など）

4. 用語

Rule: Gmail検索条件、保存先Driveフォルダ等を保持する設定

Run: Ruleを実行した記録（成功/失敗、件数、メッセージ等）

Gmail query: Gmailの検索演算子を含む検索文字列

Drive folder: PDF保存先フォルダID

5. ユーザーフロー（v1）

Googleログイン

Rule作成（Gmail query / Drive folder / lookback_days 等）

/rules 一覧から Run を押す

実行結果を一覧で確認（status / 件数 / message / finished_at）

6. 機能要件（v1）
6.1 Gmail検索

Ruleの gmail_query をそのままGmail検索に使用する

lookback_days がある場合は期間を絞る（内部実装は自由。ただし意図通りに）

6.2 PDF生成

対象メール本文をPDF化できること（添付ファイルPDF化は v1は必須にしない）

PDFの最低品質：読めること（見た目最適化は後回し）

6.3 Google Drive保存

Ruleの drive_folder_id 配下に保存する

ファイル名規則（暫定）：

YYYY-MM-DD_<subject>_<gmailMessageId>.pdf

文字数が長い場合はsubjectを短縮してよい

6.4 重複防止

同一メール（gmailMessageId）を2回保存しない

既に保存済みならスキップし、runsのmessageに件数を残す

6.5 実行ログ（runs）

Run開始〜終了が記録される

status: success / error

message: 例「processed=3 saved=3 skipped=1」

7. UI要件（v1）
/rules 一覧

Rule一覧が表示される

Runボタンがある

最新Runの status / finished_at / message を表示（あれば）

/rules/new, /rules/[id]

Ruleの作成・編集ができる

8. 未決事項（今後決める）

添付ファイルの扱い（PDF化対象）

保存済み判定のDB設計（どのテーブルに持つか）

PDFのフォーマット最適化（ヘッダ/フッタ/本文整形）

エラーコード体系（error_code）