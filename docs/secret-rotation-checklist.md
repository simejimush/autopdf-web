# secret-rotation-checklist.md

## 目的

AutoPDF で使用している重要 secret / credential を、安全な順番でローテーションするための実務チェックリスト。

このファイルは、`docs/incident-response.md` に従って「ローテーション実施」が必要と判断されたときに使う。

---

## 基本ルール

### 原則

必ず以下の順で実施する。

1. 新しい credential を外部サービス側で発行
2. Vercel の環境変数を更新
3. production を再デプロイ
4. 本番動作確認
5. 旧 credential を無効化
6. 必要に応じて preview / old deployment も確認

### 注意

- **旧 credential を先に無効化しない**
- **Vercel の env 更新だけでは既存 deployment には反映されない**
- **再デプロイ後の動作確認が済むまで完了扱いにしない**
- **old deployment / preview deployment に古い env が残る可能性を意識する**

---

## 優先順位

### 最優先

1. `SUPABASE_SERVICE_ROLE_KEY`
2. `CRON_SECRET`
3. `GOOGLE_CLIENT_SECRET`
4. `STRIPE_SECRET_KEY`
5. `STRIPE_WEBHOOK_SECRET`

### 次点

- メール送信系 API キー
- 通知系 API キー
- その他 server-only secret

### 基本的に後回しでよい

- `NEXT_PUBLIC_*`
- 公開 URL
- Supabase anon key

---

## 事前チェック

### Incident 情報

- [ ] `docs/incident-response.md` を確認した
- [ ] incident レベル（Level 1 / 2 / 3）を判断した
- [ ] 今回ローテーション対象の secret を決めた
- [ ] 自動処理停止の要否を判断した
- [ ] 必要なら `/api/cron` を停止した

### Vercel 側

- [ ] Vercel から直接通知の有無を確認した
- [ ] Activity Log を確認した
- [ ] 不審な env 更新 / 権限変更 / メンバー追加 / deployment がないか見た
- [ ] production project を誤っていないことを確認した

### 記録

- [ ] 実施者名を記録する
- [ ] 開始時刻を記録する
- [ ] 変更対象を記録する

---

## 共通チェックリスト

各 secret ごとに、以下を必ず実施する。

### A. 新しい credential 発行前

- [ ] 現在の env 名を確認した
- [ ] その secret を参照しているコード / route / webhook を把握した
- [ ] ローテーション後の確認画面 / API を把握した

### B. 新しい credential 発行

- [ ] 外部サービス側で新しい credential を発行した
- [ ] 値を安全に保管した
- [ ] コピーミスがないことを確認した

### C. Vercel 更新

- [ ] Vercel Project Settings > Environment Variables を開いた
- [ ] production の対象 env を更新した
- [ ] 必要なら preview / development の扱いも確認した
- [ ] 値の貼り間違いがないことを確認した

### D. 再デプロイ

- [ ] production を再デプロイした
- [ ] deployment 成功を確認した
- [ ] 想定外エラーが出ていないことを確認した

### E. 動作確認

- [ ] 本番で relevant な機能を確認した
- [ ] エラーログ増加がないことを確認した
- [ ] `/admin/errors` に重大エラーが増えていないことを確認した

### F. 旧 credential 無効化

- [ ] 新しい credential で本番動作確認済み
- [ ] 旧 credential を無効化した
- [ ] 無効化後も本番が正常なことを再確認した

---

## 1. `SUPABASE_SERVICE_ROLE_KEY`

### 役割

server-side の高権限 DB 操作に使用する重要 secret。

### リスク

漏えい時の影響が大きい。最優先でローテーションする。

### 事前確認

- [ ] `supabaseAdmin` を使っている route / server code を把握した
- [ ] 管理系 API がどこで service role を使うか把握した
- [ ] 本番 DB に対する server-side 書き込みがどこで走るか把握した

### 実施

- [ ] Supabase 側で新しい service role key を発行 / 確認した
- [ ] Vercel の `SUPABASE_SERVICE_ROLE_KEY` を更新した
- [ ] production を再デプロイした

### 動作確認

- [ ] server-side API が 500 になっていない
- [ ] ルール一覧 / ルール保存 / 実行履歴取得に問題がない
- [ ] 管理画面 `/admin/errors` が正常表示される
- [ ] DB 書き込みが必要な主要 API が動く
- [ ] 失敗 run が急増していない

### 完了

- [ ] 旧 key を無効化した
- [ ] 無効化後も本番正常

---

## 2. `CRON_SECRET`

### 役割

cron エンドポイント保護に使用する secret。

### リスク

漏えいすると、自動実行系 endpoint を外部から叩かれる可能性がある。

### 事前確認

- [ ] `/api/cron` の認証方式を確認した
- [ ] 必要なら cron を一時停止した
- [ ] Vercel Cron などスケジュール側の設定確認ポイントを把握した

### 実施

- [ ] 新しいランダム secret を生成した
- [ ] Vercel の `CRON_SECRET` を更新した
- [ ] production を再デプロイした

### 動作確認

- [ ] `/api/cron` が認証エラーにならず正常実行できる
- [ ] 想定外の 401 / 403 / 500 が出ない
- [ ] 定期実行後の run が正常記録される
- [ ] PDF 保存処理が正常

### 完了

- [ ] 旧 secret を無効化した
- [ ] cron を再開した
- [ ] 再開後初回実行が正常

---

## 3. `GOOGLE_CLIENT_SECRET`

### 役割

Google OAuth 連携に使用する client secret。

### リスク

Google 接続機能に影響する。再接続や callback 動作に注意が必要。

### 事前確認

- [ ] Google Cloud Console の対象 project を確認した
- [ ] OAuth client を誤っていないことを確認した
- [ ] callback URL 設定を確認した
- [ ] 接続確認に使うテストアカウントを決めた

### 実施

- [ ] Google Cloud Console で新しい client secret を発行した
- [ ] Vercel の `GOOGLE_CLIENT_SECRET` を更新した
- [ ] production を再デプロイした

### 動作確認

- [ ] Google 接続開始が正常
- [ ] callback が正常
- [ ] Settings から再接続できる
- [ ] Gmail / Drive 連携が通る
- [ ] 既存ユーザーの再接続導線に問題がない

### 追加確認

- [ ] 必要なら Google 側で承認済みアプリを確認した
- [ ] incident に関連する不審 OAuth app の混入がないか確認した

### 完了

- [ ] 旧 secret を無効化した
- [ ] 無効化後も接続 / 再接続正常

---

## 4. `STRIPE_SECRET_KEY`

### 役割

Stripe の server-side API 呼び出しに使用する secret key。

### リスク

課金機能、Checkout、Portal、課金状態同期に影響する。

### 事前確認

- [ ] 今回が test / live のどちらか確認した
- [ ] 対象 Stripe account を誤っていないことを確認した
- [ ] Billing 関連の確認導線を把握した

### 実施

- [ ] Stripe Dashboard で新しい secret key を発行した
- [ ] Vercel の `STRIPE_SECRET_KEY` を更新した
- [ ] production を再デプロイした

### 動作確認

- [ ] `/billing` が正常表示
- [ ] Checkout セッション作成が成功
- [ ] Portal 遷移が成功
- [ ] 課金 API が 500 にならない
- [ ] billing success / cancel 導線が正常

### 完了

- [ ] 旧 key を無効化した
- [ ] 無効化後も billing 関連正常

---

## 5. `STRIPE_WEBHOOK_SECRET`

### 役割

Stripe webhook の署名検証に使用する secret。

### リスク

課金状態同期の信頼性に直結する。

### 事前確認

- [ ] 対象 webhook endpoint を確認した
- [ ] production endpoint を誤っていないことを確認した
- [ ] webhook テスト方法を確認した

### 実施

- [ ] Stripe webhook endpoint から新しい signing secret を取得した
- [ ] Vercel の `STRIPE_WEBHOOK_SECRET` を更新した
- [ ] production を再デプロイした

### 動作確認

- [ ] Stripe webhook 受信が成功
- [ ] 署名エラーが出ていない
- [ ] `user_profiles.plan` や billing 状態更新が正常
- [ ] webhook route が 400 / 500 連発していない

### 完了

- [ ] 旧 secret を無効化した
- [ ] 無効化後も webhook 正常

---

## 6. メール送信系 API キー

### 対象例

- 監視通知メール
- システムエラー通知
- ユーザー向け連絡メール

### 実施

- [ ] 新しい API キーを発行した
- [ ] Vercel 環境変数を更新した
- [ ] production を再デプロイした

### 動作確認

- [ ] テストメール送信成功
- [ ] 管理者通知メール成功
- [ ] エラー通知導線が正常

### 完了

- [ ] 旧 key を無効化した
- [ ] 無効化後も送信正常

---

## 動作確認まとめ

### 最低限確認する画面 / 機能

- [ ] ログイン
- [ ] ダッシュボード表示
- [ ] ルール一覧表示
- [ ] ルール作成 / 編集 / 保存
- [ ] Google 接続
- [ ] 手動実行
- [ ] PDF 保存
- [ ] `/api/cron`
- [ ] `/admin/errors`
- [ ] `/billing`
- [ ] Checkout
- [ ] Stripe webhook

---

## ローテーション記録

### 実施情報

- 実施日:
- 実施者:
- incident 名 / URL:
- 対応レベル:

### 今回ローテーションしたもの

- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `CRON_SECRET`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] メール送信系 API キー
- [ ] その他:

### 各 secret の記録

| Secret 名                 | 新 credential 発行 | Vercel 更新 | 再デプロイ | 動作確認 | 旧 credential 無効化 | 備考 |
| ------------------------- | ------------------ | ----------- | ---------- | -------- | -------------------- | ---- |
| SUPABASE_SERVICE_ROLE_KEY |                    |             |            |          |                      |      |
| CRON_SECRET               |                    |             |            |          |                      |      |
| GOOGLE_CLIENT_SECRET      |                    |             |            |          |                      |      |
| STRIPE_SECRET_KEY         |                    |             |            |          |                      |      |
| STRIPE_WEBHOOK_SECRET     |                    |             |            |          |                      |      |

### 終了確認

- [ ] すべての対象 secret の更新完了
- [ ] 旧 credential 無効化完了
- [ ] 本番動作確認完了
- [ ] incident-response.md の復旧判定条件を満たした
- [ ] postmortem 記録を残した

---

## メモ

- 旧 credential を先に消さない
- preview / old deployment の扱いも忘れない
- 作業後は必ず `/admin/errors` と最新 run を見る
- 不安がある場合は cron を止めたまま先に server-side secret を回す
