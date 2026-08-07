# AutoPDF Codex開発ワークフロー近代化

監査日: 2026-08-07

## 目的

AutoPDF固有の安全ルールを維持し、毎フェーズ繰り返していたGit確認、検証選択、Preview照合、報告をrepository-local Skillsへ移す。アプリの実行時仕様や外部サービス設定は変更しない。

## 監査スナップショット

- repository root: `C:\Users\xxbbd\autopdf-web`
- branch: `integration/google-token-phase-3-scoped`
- audit開始時HEAD: `3a24b90ed803aad9902c71906729674ce7e2c049`
- working tree / staged: clean / 0
- upstream: ahead 0 / behind 0
- 指示: root `AGENTS.md`、`docs/quality-rules.md`、`docs/dev-rules.md`、`docs/codex-workflow-ja.md`
- package scripts: `dev`、`build`、`start`、`lint`
- test runner: Playwright、`tests/*.spec.ts`、1 worker、Chromium
- 定型コマンド: `npx.cmd playwright test ...`、`npx.cmd tsc --noEmit`、`npx.cmd eslint ...`、`npx.cmd prettier --check ...`、`npm.cmd run build`
- GitHub: tracked `.github` directoryなし
- Vercel: `vercel.json`に既存Cron定義あり、repository内の`.vercel` link directoryなし
- Supabase: tracked local configと4 migrationあり。env/secret値は未読
- repository-local Skill: 監査開始時なし

## 現在利用できるCodex支援機能

Codexはrepository rootの`.agents/skills`からSkillを自動検出し、descriptionにより暗黙選択できる。`agents/openai.yaml`で表示名、起動例、暗黙起動方針を宣言できる。AGENTS階層、sandbox/approval、worktree/handoff、command rules、hooks、scheduled tasks、GitHub code review、Plugins/MCPも利用可能である。

この環境ではbrowser、document/PDF/presentation/spreadsheet、Sites、Supabase等のPlugin/Skillが利用可能で、個人Skillとして他repository向け安全開発Skill等も存在する。Supabase Pluginはinstalled/enabledと確認できたが、外部project一覧や識別子は取得していない。GitHub、Vercel、Codex Securityの専用Pluginは未導入である。

## 採用した構成

### `$autopdf-safe-development`

開始時Git状態、既存差分保護、権限境界、最小実装、自律的な修正再検証、個別stage、1目的commit、最終報告を定型化する。AutoPDF固有の禁止事項は複製せず、`AGENTS.md`と必須docsを正本として読む。

### `$autopdf-verify-change`

diffをUI、route、repository/domain、Manual Run/Cron、Google、Stripe、Supabase、monitoring、config、docs/Skillに分類し、必要十分なtest、TypeScript、ESLint、Prettier、build、契約確認を選ぶ。full Playwrightとbuildは変更境界またはreleaseリスクが必要な場合だけ選ぶ。

### `$autopdf-verify-vercel-preview`

明示的なpush承認を前提に、branch/HEAD/diff/checksを確認し、通常push後にlocal/remote SHA、Preview環境、Ready、Production=false、branch URL、commit URLを照合する。接続やログイン、Vercel設定変更、manual Run、Cron、OAuth、billing操作は含めない。

### `AGENTS.md`の役割

`AGENTS.md`と必須docsはarchitecture、data isolation、RLS、API、Google、監視、UI、Git、AutoPDF固有の禁止事項を保持する。Skillsはsafe development、verification、deploy verificationという反復手順を担当する。GitHub Codex reviewでも再利用できる重大なreview観点を3件だけ追加した。

## Plugin評価

| 候補           | 短縮できる作業                                                                | 権限とリスク                                                                          | 導入判断                                                                     |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| GitHub         | remote SHA、commit/PR/check/deployment statusの構造化確認、将来のCodex review | repository readが最小。PR comment、branch write、自動fixは誤pushリスクがある          | 有用だが未接続。read-only接続承認が必要                                      |
| Vercel         | deployment SHA、Environment、Ready、Preview URL、Production判定               | project/deployment readが最小。deploy、promote、env writeはProduction事故リスクが高い | Preview確認頻度が高く有用。read-only接続承認が必要                           |
| Codex Security | OAuth/Stripe/DB等の高リスクdiffの深いscan、findingの比較                      | source read、scan artifact保存、サービス認証が必要。結果は非決定的で手動確認も必要    | 高リスク変更やrelease前に限定して試行する価値あり                            |
| Supabase       | schema、migration、advisor、logの構造化read                                   | 現PluginはSQL/migration/project操作等のwrite能力も持ち、DB dataへの接触範囲が広い     | installed/enabledだが通常フローでは不使用。明示されたread-only調査だけに限定 |
| Browser        | 既存サインインを使ったPreview画面とdeployment表示確認                         | 誤クリックの余地があるため状態変更操作を禁止する必要あり                              | Vercel Plugin未接続時のread-only fallbackとして採用                          |

新規Pluginのinstall、login、OAuth、permission変更は今回行っていない。接続時はrequested scopesを画面で確認し、GitHub/Vercelはread-onlyから開始し、write権限を別承認に分離する。

## 今回採用しなかった機能

- Hooks: project trust、Windows/Linux両対応、全turnへの実行負荷、誤停止時の復旧コストが3 Skillsより大きいため見送り。
- Command rules: sandbox外コマンド制御には有用だがexperimentalで、repository設定だけでは利用者ごとの要件を統一しにくい。
- Scheduled tasks: Preview監視には使えるが、無人実行、PC負荷、外部アクセス、approval-policyが複雑。deploy待ちは現在task内の限定監視を優先する。
- `.worktreeinclude`: ignored secret/envをworktreeへコピーし得るため追加しない。Worktree自体は並行作業の分離に有効だが、同一branch制約とdisk負荷を踏まえ任意利用とする。
- package script追加: 既存コマンドを変えずSkill内で選択できるため、今回は`package.json`を変更しない。
- AutoPDF独自Plugin: 3つのrepository Skillだけで目的を満たし、配布用PluginやMCP serverは過剰である。

## 標準フロー

1. ChatGPTまたはユーザーはフェーズの目的、変更許可範囲、外部writeの可否だけを指定する。
2. Codexは`$autopdf-safe-development`でpreflight、調査、最小実装を進める。
3. `$autopdf-verify-change`がdiffから検証を選び、承認不要の失敗は修正して再検証する。
4. repository内変更は個別stageして1目的commitまで進め、push前で停止する。
5. pushが明示承認されたフェーズだけ`$autopdf-verify-vercel-preview`でpushとPreview照合を行う。

停止条件は、新しい外部権限、productionまたはDB write、secret/env、dependency、削除、大規模architecture、または安全に推定できない重要なproduct判断である。小さな実装判断やin-scope test failureでは停止しない。

## Dry-run受け入れ例

- 「toast文言だけ修正」: safe developmentとchange verificationを選択。toast spec、TypeScript、対象ESLint、Prettier、diff/secret checksを選び、interaction/runtime変更がなければbuildや全Playwrightは省略する。
- 「承認なしでPreviewへpush」: safe developmentはcommitまでで停止し、Preview Skillはpushを拒否する。
- 「承認済みbranchをPreview確認」: Preview Skillを選択し、expected SHAとProduction=falseを必須照合する。manual Runは別承認がないため実行しない。
- 「migrationを作ってremoteへ適用」: repository内migration作成自体の許可を確認し、remote apply前で必ず停止する。

従来の長い安全指示は「目的、対象branch/expected SHA、今回許可する外部操作」の提示へ縮小できる。検証コマンド一覧と最終報告項目はSkillsから供給される。
