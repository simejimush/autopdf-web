# AutoPDF 公開前チェック 2026-06-13

## 環境

- 環境: production
- URL: https://autopdf-web.vercel.app
- プラン状態: Free
- ルール数: 2件
- 今月のPDF保存: 1 / 10件
- 最新コミット: e2b1bd7 Improve dashboard summary mobile layout

## 実施済みチェック

### 1. ログイン / Google接続

- 本番URL表示: OK
- Google認証画面への遷移: OK
- 認証後の戻り: OK
- ログイン後画面: OK
- Google再接続: OK
- 接続後表示: 接続済み
- ダッシュボード表示: OK
- ルール画面表示: OK
- 設定画面表示: OK
- Freeバッジ表示: OK
- Google接続状態の反映: OK
- 最終確認 / 接続情報更新: 日本時間表示OK

メモ:

- Google OAuth画面で「このアプリはGoogleで確認されていません」が表示される。
- これはOAuth consent screen / verification が未完了のため。
- 開発者テストでは続行OK。
- 一般公開前には Google Cloud 側の OAuth consent screen / verification 対応が必要。

### 2. ルール作成 / 編集 / 削除 / 検索

- ルール作成画面表示: OK
- 空欄バリデーション: OK
- 保存先のみ入力時のGmail検索条件エラー: OK
- ルール作成: OK
- 作成後 /rules 遷移: OK
- 初回案内モーダル: OK
- 詳細表示: OK
- 詳細表示時の横ズレ: 修正済み
- 編集画面表示: OK
- 編集保存: OK
- 複製導線: OK
- 3件表示: OK
- 検索: OK
- 並び順: OK
- Freeプランのルール3件上限: OK
  - ルールコピー時: Proプラン誘導トースト表示
  - +ルールを作成時: Proプラン誘導モーダル表示
- 削除: OK

### 3. 手動実行

テストメール件名:

- AutoPDFテスト請求書

対象ルール:

- test1 edited

Gmail検索条件:

- subject:"AutoPDFテスト請求書" newer_than:7d

確認結果:

- 初回はGoogle認証切れで失敗
- Google OAuth callback token検証修正後に再接続して再実行
- 成功
- 処理1件
- 保存2件
- 除外0件
- Google Driveに本文PDF + 添付PDFの2件保存確認済み
- PDFファイルを開けることも確認済み

ダッシュボード反映:

- 処理件数: 1
- 保存成功数: 2
- 今月のPDF保存: 1 / 10件
- 最近保存したPDF: 1件表示

重複実行確認:

- 同じルールを再実行
- 成功
- 保存0件
- 除外1件
- 処理0件
- 今月PDF保存は 1 / 10件 のまま
- 重複保存防止OK

UXメモ:

- ダッシュボードの「保存成功数」は本文PDF + 添付PDFで2件
- 「最近保存したPDF」は本文PDFのみ1件表示
- 仕様としては成立しているが、ユーザーには誤解される可能性あり
- 後で「最近保存したPDF」の補足として「本文PDFのみ表示しています」または「本文PDFのみ表示しています。添付ファイルはGoogle Driveで確認できます。」を追加する候補

### 4. Free制限

- Freeプラン表示: OK
- 今月のPDF保存 1 / 10件表示: OK
- 広告枠表示: OK
- ルール3件上限: OK
- 4件目作成ブロック / Pro誘導: OK
- 該当メールなし実行でFree枠を消費しない: OK
- 上限到達時の実装確認:
  - checkFreeMonthlyPdfSaveLimit(params.userId) を呼んでいる
  - 上限NG時は runs.status=error
  - error_code=FREE_MONTHLY_LIMIT_EXCEEDED
  - processed_count / saved_count / skipped_count は 0
  - Drive保存処理へ進む前に return
  - tokenやsecretのログ出力なし

### 5. 広告枠 / Free表示

Free状態で広告枠表示:

- /dashboard: OK
- /rules: OK
- /settings: OK

広告枠を表示しない画面:

- /billing: OK

/billing Free状態:

- 現在のプラン: Free
- 契約状態: 未契約
- 今月のPDF保存数: 1 / 10件
- Proアップグレード導線: 表示あり
- 広告枠: 表示なし

### 6. Billing / Checkout入口 / キャンセル戻り

Checkout入口:

- Stripe Checkout画面へ遷移: OK
- 商品: AutoPDF Pro を定期購入
- 金額: ¥980 / 月
- 説明: GmailのメールをPDF化してGoogle Driveに保存するProプラン
- 支払い方法: カード / Link
- 国: 日本

キャンセル / 戻り:

- /billing に戻る: OK
- 現在のプラン: Free のまま
- 契約状態: 未契約
- 今月のPDF保存数: 1 / 10件 のまま
- Pro導線: 表示あり
- 広告枠: 表示なし

### 7. 後片付け

- テスト用 limit test 3 を削除
- ルール数: 2件
- 残っているルール:
  - test1 edited
  - test2
- +ルールを作成: 表示あり
- Free広告枠: 表示あり

### 8. ダークモード表示確認

- /settings: OK
- /dashboard: OK
- /rules 通常表示: OK
- /rules 詳細表示: OK
- ヘッダー、カード、ボタン、広告枠、Freeバッジの可読性: OK
- レイアウト崩れ: なし

### 9. モバイル幅 / レスポンシブ確認

/dashboard:

- 初回確認で稼働ステータス小カードが細いグリッド表示になり、スマホ幅で不自然な改行を確認
- 修正実施:
  - commit: e2b1bd7 Improve dashboard summary mobile layout
  - src/components/dashboard/StatusSummaryCard.tsx
  - src/components/dashboard/StatusSummaryCard.module.css
  - PC幅は既存同等の4列
  - スマホ幅では1列・横幅100%
- 本番反映後に確認OK

/rules:

- ヘッダー: OK
- Freeバッジ: OK
- ルール2件の縦表示: OK
- 実行ボタン / 三点メニュー: OK
- 削除ボタン: OK
- 検索・並び順UI: 折り返し表示OK
- 詳細表示: OK
- Gmail検索条件 / 保存先: 読める
- 広告枠: OK
- 横スクロール・大きな崩れ: なし

/settings:

- Google連携カード: OK
- アカウントカード: OK
- 通知設定カード: OK
- プラン・請求カード: OK
- 広告枠: OK
- 表示設定 / ダークモード: OK
- 横はみ出し: なし
- 操作不能な崩れ: なし

### 10. ライトモード復帰

- ダークモードOFF後、ライト表示に戻ることを確認: OK

### 11. ログアウト / 再ログイン

- ログアウト: OK
- 未ログイン状態でログイン画面へ戻る: OK
- 再ログイン: OK
- 再ログイン後 dashboard / rules / settings 表示: OK
- Google接続状態が接続済みのまま: OK

### 12. 最終git状態

- working tree clean
- main と origin/main 同期済み
- 最新コミット:
  - e2b1bd7 Improve dashboard summary mobile layout
  - af9ccc0 Validate Google token on callback
  - da8ae94 Stabilize scrollbar layout
  - 5a3de55 Show settings timestamps in JST
  - 534777a Document free limit and rule intro guidance

## 今回の公開前チェック中に行った修正

### 1. /settings の時刻表示を日本時間に修正

- commit: 5a3de55 Show settings timestamps in JST
- 最終確認 / 接続情報更新が日本時間で表示されることを確認済み

### 2. 詳細表示時の横ズレを修正

- commit: da8ae94 Stabilize scrollbar layout
- app/globals.css に scrollbar-gutter: stable; を追加
- /rules の詳細開閉で横ズレが直ったことを本番反映後に確認済み

### 3. Google OAuth callback で token検証を追加

- commit: af9ccc0 Validate Google token on callback
- callback時に保存予定の refresh token で getAccessToken() を検証
- 検証成功時だけ connected 扱い
- 検証失敗時は GOOGLE_TOKEN_INVALID / reauth_required=true
- token値はログ出力しない
- tsc成功済み

### 4. /dashboard スマホ幅の稼働ステータス表示改善

- commit: e2b1bd7 Improve dashboard summary mobile layout
- スマホ幅で稼働ステータス小カードを1列・横幅100%に変更
- PC表示は既存同等
- tsc成功済み
- 本番反映後確認OK

## 未対応 / リリース前に別途確認すること

### Stripe本番アカウント最終状態

- 2026-07-02 に人間側で Stripe本番アカウントの現在の要対応項目がないことを確認済み
- Stripe本人確認 / タスク一覧 / 決済停止表示 / 入金停止表示について、リリース前のStripe本番アカウント最終確認はOK扱い
- secret / token / 個人情報 / Stripeの具体的な識別子は記録していない

### Google OAuth

- OAuth consent screen / verification 対応
- 一般ユーザー公開前に「このアプリはGoogleで確認されていません」表示への対応が必要

### Stripe

- Stripe領収書 / 請求書メールの日本語化
- 独自ドメイン設定後、APP_URL / NEXT_PUBLIC_APP_URL / Stripe webhook URL の切替要否確認

### UX改善候補

- ダッシュボード「最近保存したPDF」に、本文PDFのみ表示である補足を追加する候補
- スマホ幅の /rules 検索・並び順UIは操作可能だが少し詰まっているため、将来改善候補

## 判定

アプリ側の主要公開前チェックは一通りOK。
ただし、一般公開前には Google OAuth verification と Stripe領収書 / 請求書メールの日本語化、独自ドメイン設定後のURL切替要否確認が必要。
