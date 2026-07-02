# AutoPDF Codex作業ルール

## 目的
AutoPDFはローンチ直前のため、Codexは開発加速よりもローンチ事故防止を優先する。
Matt Pocock skills 的な /handoff / grill-with-docs / diagnose / architecture review の考え方を参考にする。

## 基本方針
- 作業前に、今回触る範囲と触らない範囲を明記する
- 変更は小さく分ける
- UI変更とロジック変更を同時に行わない
- 大規模リファクタは提案のみ。勝手に実行しない
- ローンチ前に必要な修正と、ローンチ後でよい改善を分ける

## 明示指示なしで変更禁止の領域
- Gmail OAuth callback
- refresh token保存
- Google Drive保存処理
- Stripe本番課金処理
- Stripe webhook
- Supabase RLS
- Vercel環境変数
- .env / .env.local
- src/lib/runs/*
- Free / Pro制限ロジック
- DB migration

## Gitルール
- git add . 禁止
- 必要ファイルだけ個別 add
- commit前に git status --short と git diff --stat を確認
- commit後に git status --short と git log -5 を確認
- pushは明示指示がある場合のみ行う

## 確認ルール
- TypeScript変更後は npx.cmd tsc --noEmit を実行
- UI変更後は可能ならブラウザ確認を行う
- 本番確認が必要なものは、push後にユーザーが本番画面で確認する
- token / secret / 個人情報はログや報告に出さない

## Codexの報告形式
作業後は以下を報告する。

1. 変更ファイル一覧
2. 実装概要
3. 触っていない重要領域
4. tsc / build / ブラウザ確認結果
5. git status
6. commit hash
7. 次にやるべきこと
8. 次チャットに貼れる handoff

## grill-with-docs 的な使い方
認証・課金・保存処理・Free制限・外部API・env に関わる作業では、実装前に既存docsと実装の矛盾や曖昧な点を列挙する。
不明点がある場合は、勝手に実装せず確認する。

## diagnose 的な使い方
不具合調査では、いきなり修正せず、まず原因候補・確認コマンド・影響範囲を出す。
原因が特定できてから最小修正に進む。

## handoff 的な使い方
作業が終わったら、次のChatGPT/Codexセッションに貼れる短い引き継ぎを出す。
