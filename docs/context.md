# AutoPDF context（重要ファイル厳選）

## 読み方（AI / 開発者向け）

このファイルは **AutoPDFプロジェクトの重要ファイル案内**です。  
AIや新しい開発者は以下の順で読むと構造を理解しやすいです。

1. docs/context.md（このファイル）
2. docs/ARCHITECTURE.md（全体設計）
3. docs/schema.md（DB構造）
4. docs/run-flow.md（処理フロー）
5. docs/security.md（セキュリティ観点）

---

## 主要ディレクトリ（構造理解用）

- `app/` : Next.js App Router
- `app/(app)/` : ログイン後UI（dashboard / rules / settings）
- `app/api/` : APIエンドポイント
- `src/lib/google/` : Google OAuth / Gmail / Drive連携
- `src/lib/supabase/` : Supabase client / server / admin
- `src/lib/pdf/` : PDF生成ロジック
- `docs/` : 設計・仕様・運用ドキュメント

※ node_modules / .next などの生成物は除外

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

---

# Gmail検索条件生成ロジック（AI生成）

## フェーズ3仕様

# Gmail検索条件生成 改善フェーズ3 仕様メモ

## 現状の前提

- sender strength の土台は導入済み
- ただし sender strength はまだ生成挙動に使わない
- senderAliasMap の strength は全件 weak のまま運用する
- 安全側を優先し、既存挙動を大きく壊さないことを最優先とする

## 現在の基本仕様

- pdf / csv は strong file signal とみなす
- strong file signal がある時は、docKeywordMap 由来 subject を基本抑制する
- unread / newer_than などの状態条件は通常どおり保持する
- sender が取れる場合は from:xxx を付与する

## 現時点で許容する挙動

- 「見積書」が内部的に `subject:(見積)` に正規化されるのは許容
- 「添付ファイル付き」は現時点では `has:attachment` を優先し、subject 付与は必須にしない
- pdf が含まれていても、「件名に」「件名が」など明示的な subject 指定がある場合は subject を残してよい

## フェーズ3で固定したい追加仕様

- `shouldKeepDocSubject()` は「明示的に件名指定している表現」を優先して true にできるようにする
- 初回対象は以下のような明示表現に限定する
  - 件名に
  - 件名が
  - subjectに
  - subjectが
- 上記に一致する場合、pdf / csv が含まれていても docKeywordMap 由来 subject を保持してよい
- それ以外は現行どおり、strong file signal がある時は subject を基本抑制する

## 今回まだやらないこと

- sender strength を from 生成ロジックに反映すること
- sender の複数候補に優先順位を導入すること
- senderAliasMap をドメイン別・ブランド別に本格段階化すること
- generateQuery 全体の大規模リファクタ

# Gmail検索条件生成 改善フェーズ3 修正方針メモ

## 目的

`shouldKeepDocSubject()` を最小変更で強化し、
「件名に領収書があるPDFメール」のような明示的 subject 指定を安全に扱えるようにする。

## 修正方針

1. 変更対象は `shouldKeepDocSubject()` 周辺に限定する
2. sender 周りの処理には触らない
3. file signal 判定の既存仕様は変えない
4. 明示的 subject 指定の特例だけ追加する
5. 既存の OK ケースを壊さないことを最優先にする

## 実装イメージ

- 入力文に以下の明示表現が含まれるか判定する
  - 件名に
  - 件名が
  - subjectに
  - subjectが
- 明示表現がある場合は `shouldKeepDocSubject()` を true にする
- 明示表現がない場合は現行仕様を維持する

## この方針で改善したいケース

- 件名に領収書があるPDFメール
  - 現状: `subject:(領収書) filename:pdf has:attachment`
  - この挙動は維持対象
- 件名に請求書がある未読メール
  - 現状: `subject:(請求書) is:unread`
  - この挙動は維持対象

## この方針で変えないケース

- StripeのCSV明細
  - `from:stripe filename:csv has:attachment`
- Googleから届いた見積書PDF
  - `from:google filename:pdf has:attachment`
- 請求書PDF
  - `filename:pdf has:attachment`

## テスト観点

### 維持確認

- Amazon請求書
- StripeのCSV明細
- 件名に請求書がある未読メール
- Googleから届いた見積書PDF
- 7日以内のStripe請求書

### 特例確認

- 件名に領収書があるPDFメール
- 件名に請求書があるCSVメール
- 件名が見積書のPDF
- subjectに納品書があるメール

## 完了条件

- 既存の主要OKケースを壊さない
- 明示的 subject 指定ケースのみ安全に保持できる
- sender / file signal の既存挙動に副作用を出さない

## 監視 / 通知 / 運用（今後の重要導線）

※ 監視機能を実装したら、この章を更新すること  
※ AutoPDFでは「処理停止を早く検知する」ことが重要

### 管理者向け監視UI

- app/(app)/admin/errors/page.tsx: 最新エラー一覧 / user_id / rule_id / error_code / 発生時刻の確認画面
- app/(app)/admin/errors/AdminErrorsPage.module.css: 管理画面CSS

### 監視の共通ロジック

- src/lib/monitoring/normalizeRunError.ts: 例外 → error_code / message への正規化
- src/lib/monitoring/notifySlack.ts: 管理者向けSlack通知
- src/lib/monitoring/notifyUser.ts: ユーザー向けメール通知
- src/lib/monitoring/healthcheck.ts: 「24時間成功ゼロ」などのヘルスチェック判定
- src/lib/monitoring/monitoringTypes.ts: 監視用の型定義（必要なら追加）

### 実行系と監視の接点

- app/api/rules/[id]/run/route.ts: 手動実行から監視共通処理を呼ぶ入口
- app/api/cron/route.ts: 定期実行 / ヘルスチェック / 通知起点
- src/lib/runs/ または src/lib/execution/: runs記録と通知判定を共通化する層（実装時に整理）

### 状態保持で重要になるテーブル

- runs: 実行成否 / error_code / message / started_at / finished_at
- google_connections: 接続状態 / last_success_at / last_error_code / reauth_required などの監視用状態
- rules: 有効ルール有無の判定に使用
