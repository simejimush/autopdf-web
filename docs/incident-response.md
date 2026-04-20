# incident-response.md

## 目的

AutoPDF において、Vercel / Supabase / Google / Stripe / メール送信基盤などの外部サービスに関するセキュリティ incident、障害、または credential 漏えい疑いが発生した際に、被害を最小化し、復旧までの対応を標準化する。

この手順書は、特に以下のようなケースを対象とする。

- Vercel などのインフラ提供元から security bulletin が出た
- 認証情報（secret, token, API key, webhook secret）の漏えいが疑われる
- 不審なデプロイ、権限変更、環境変数変更が見つかった
- 自動実行や外部 API 呼び出しが不正利用されるおそれがある
- 重要な連携（Google / Stripe / Supabase）が異常動作している

---

## 基本方針

1. まず事実確認を行う  
   推測で断定しない。通知、ログ、変更履歴、影響範囲を先に確認する。

2. 全面停止ではなく、危険な処理だけを止める  
   閲覧系 UI はできるだけ残し、自動処理・書き込み処理・外部 API 実行など高リスク機能を優先停止する。

3. 高権限 secret から優先して保護する  
   すべてを同時に回すのではなく、影響が大きいものから順にローテーションする。

4. credential の更新は安全な順で行う  
   原則は以下。  
   `新しい credential 発行 → Vercel に登録 → 再デプロイ → 動作確認 → 旧 credential 無効化`  
   Vercel は環境変数変更が既存 deployment に自動反映されないため、再デプロイが必要。

5. ユーザーへの案内は短く、正確に行う  
   影響が未確定の段階では断定しない。必要な行動がある場合のみ明示する。

---

## 対応レベル

### Level 1: 情報収集のみ

以下を満たす場合。

- 提供元からの通知なし
- Activity Log に不審な操作なし
- 不審なデプロイなし
- 権限変更なし
- 外部サービス側ログにも異常なし

対応方針:

- 緊急停止は不要
- 監視強化
- 高権限 secret の予防ローテーションを検討

---

### Level 2: 予防的対応が必要

以下のいずれかを満たす場合。

- 提供元 incident の内容が secret / token / env var に関係する
- Vercel 上に高権限 secret を保存している
- Sensitive ではない環境変数に重要 secret を入れていた可能性がある
- Activity Log に直接の侵害証跡はないが、影響を否定できない

対応方針:

- 高権限 secret を優先ローテーション
- 必要に応じて cron / 自動処理を一時停止
- サービス内告知を検討

Vercel は、今回の 2026年4月 incident bulletin で、影響は限定された一部顧客としつつ、secret を含む環境変数については Sensitive でない場合に優先ローテーションを推奨している。

---

### Level 3: 侵害疑いが強い / 実害の可能性あり

以下のいずれかを満たす場合。

- 提供元から直接通知あり
- Activity Log に不審な env 変更、権限変更、メンバー追加、不審デプロイがある
- Stripe / Supabase / Google 側でも異常アクセスが見える
- 利用者影響が既に出ている
- 重要 credential の漏えいが強く疑われる

対応方針:

- 危険機能を即停止
- 高権限 secret を即ローテーション
- 必要に応じて告知
- 復旧確認完了まで自動処理を再開しない

---

## 初動チェックリスト（最初の 15 分）

### 1. 事実確認

- [ ] 提供元から直接通知が来ていないか確認
- [ ] 公式 security bulletin を確認
- [ ] Vercel Activity Log を確認
- [ ] 最新 production deployment の実行者と時刻を確認
- [ ] チームメンバー追加・権限変更の有無を確認
- [ ] Project Settings の変更履歴を確認
- [ ] 外部サービス（Supabase / Stripe / Google / メール送信基盤）の dashboard / logs を確認

### 2. 影響資産の棚卸し

- [ ] Vercel に保存している secret 一覧を確認
- [ ] どの secret が本番で実際に使われているか確認
- [ ] どの credential が高権限か分類
- [ ] 旧 deployment / preview deployment にも古い env が残っていないか確認

### 3. 停止判断

- [ ] 自動実行を止める必要があるか判断
- [ ] 外部 API への書き込みを止める必要があるか判断
- [ ] 読み取り専用 UI は継続できるか判断

---

## AutoPDF の優先保護対象

### 最優先で扱う secret

1. `SUPABASE_SERVICE_ROLE_KEY`
2. `CRON_SECRET`
3. `GOOGLE_CLIENT_SECRET`
4. `STRIPE_SECRET_KEY`
5. `STRIPE_WEBHOOK_SECRET`

### 次点

- メール送信系 API キー
- 通知系 API キー
- 管理系の内部 token
- その他 server-only の秘密情報

### 基本的に優先度が低いもの

- `NEXT_PUBLIC_*`
- 公開 URL
- Supabase anon key

備考:

- 公開前提の値は今回のような incident 対応の中心ではない
- ただし、設定改ざんや不審なデプロイ確認は別途必要

---

## 停止対象の原則

### 停止候補

- `/api/cron`
- 定期実行による自動 PDF 生成
- 外部 API に書き込むバッチ処理
- 管理者向け危険操作
- 大量処理系エンドポイント

### できるだけ維持したい機能

- ログイン
- ダッシュボード閲覧
- ルール一覧の閲覧
- 設定画面の閲覧
- サポート導線
- 告知バナー表示

原則:

- 「読むだけ」は残す
- 「外部へ書く / 自動で動く / 高権限で実行する」は止めやすくする

---

## credential ローテーション手順

### 共通ルール

必ず以下の順で行う。

1. 新しい credential を外部サービス側で発行
2. Vercel の環境変数を更新
3. 再デプロイ
4. 本番動作確認
5. 旧 credential を無効化
6. 必要に応じて preview / old deployment も整理

Vercel は、環境変数変更が既存 deployment に反映されず、新しい deployment が必要であること、また古い deployment には古い値が残りうることを案内している。

---

## AutoPDF 推奨ローテーション順

### 1. `SUPABASE_SERVICE_ROLE_KEY`

理由:

- 影響範囲が最も大きい
- server-side で強権限を持つ
- 漏えい時の被害が深刻

手順:

- [ ] Supabase 側で新しい service role key を確認 / 発行
- [ ] Vercel 環境変数を更新
- [ ] production 再デプロイ
- [ ] server-side DB 処理確認
- [ ] 旧 key を無効化

---

### 2. `CRON_SECRET`

理由:

- 自動実行悪用に直結しやすい
- 外部から内部ジョブを叩かれるリスクがある

手順:

- [ ] 新しい secret 生成
- [ ] Vercel 更新
- [ ] production 再デプロイ
- [ ] cron 動作確認
- [ ] 旧 secret 無効化

---

### 3. `GOOGLE_CLIENT_SECRET`

理由:

- Google OAuth 連携に関わる
- 認証まわりへの影響が大きい

手順:

- [ ] Google Cloud Console で client secret を再発行
- [ ] Vercel 更新
- [ ] production 再デプロイ
- [ ] Google 再接続 / callback 動作確認
- [ ] 旧 secret 無効化

備考:

- 提供元 incident が Google Workspace OAuth アプリ由来の場合は、Google 側の承認済みアプリも確認する
- Vercel は 2026年4月 bulletin で IOC として特定の Google OAuth App ID を公開し、確認を推奨している。

---

### 4. `STRIPE_SECRET_KEY`

理由:

- 課金機能への影響が大きい
- server-side secret のため優先度高

手順:

- [ ] Stripe Dashboard で新しい secret key 発行
- [ ] Vercel 更新
- [ ] production 再デプロイ
- [ ] Checkout / Portal / API 動作確認
- [ ] 旧 key 無効化

---

### 5. `STRIPE_WEBHOOK_SECRET`

理由:

- webhook の正当性検証に使用
- ローテーション時は webhook 動作確認が必須

手順:

- [ ] Stripe webhook endpoint 側で新しい signing secret を取得
- [ ] Vercel 更新
- [ ] production 再デプロイ
- [ ] webhook 受信確認
- [ ] 旧 secret 無効化

---

## Activity Log 確認観点

Vercel は security bulletin で Activity Log の確認を案内している。

確認ポイント:

- [ ] 環境変数の追加 / 更新 / 削除
- [ ] チームメンバー追加
- [ ] 権限変更
- [ ] Project Settings 変更
- [ ] production deployment の不審な実行
- [ ] preview deployment の異常増加
- [ ] 覚えのない token / integration 追加

---

## サービス内告知テンプレート

### 影響未確認段階

> 現在、外部インフラ提供元に関するセキュリティ incident の公表を受け、当サービスでも影響確認を進めています。現時点でお客様データへの影響は確認されていません。必要に応じて一部機能を一時的に制限する場合があります。

### 予防対応中

> 安全性確保のため、一部の認証情報を予防的に更新しています。更新中は一部の自動処理を一時停止する場合があります。

### 実害確認時

> セキュリティ上の懸念を確認したため、影響範囲の調査と認証情報の更新を進めています。安全確認が完了するまで、一部機能を制限しています。お客様に必要な対応がある場合は別途ご案内します。

原則:

- 断定しすぎない
- 影響範囲が確定する前に不要な不安を煽らない
- ユーザーが行動すべきことがある場合だけ明示する

---

## 復旧判定チェックリスト

以下をすべて満たしたら復旧判定とする。

- [ ] Activity Log に追加の不審操作なし
- [ ] 高権限 secret ローテーション完了
- [ ] production 再デプロイ完了
- [ ] old deployment / preview deployment の影響確認完了
- [ ] `/api/cron` の初回実行正常
- [ ] 主要 API の疎通確認正常
- [ ] Google 接続動作正常
- [ ] Stripe checkout / webhook 正常
- [ ] Supabase server-side 処理正常
- [ ] エラーログ急増なし
- [ ] `/admin/errors` で重大エラー増加なし
- [ ] 告知が必要な場合は掲載済み

---

## 事後レビュー（postmortem）項目

incident 対応後は必ず以下を記録する。

- 発生日
- 検知経路
- 何が起きたか
- 影響範囲
- 何を止めたか
- どの credential をローテーションしたか
- 復旧完了時刻
- ユーザー影響
- 改善点
- 今後追加する監視 / 停止スイッチ / 手順書の更新内容

---

## 今後の改善候補

- cron 停止フラグを env または DB で即時切替できるようにする
- 自動 PDF 生成停止フラグを追加する
- `/admin/errors` に incident 期間フィルタを追加する
- 重要 credential 一覧を別 md に明文化する
- 本番運用用の「緊急確認チェックリスト」を 1ページに要約する
- 告知バナーの表示切り替えを管理者 UI から行えるようにする

---

## 参考

- Vercel Security Bulletin: April 2026 Security Incident
- Vercel: Rotating Secrets Guide
