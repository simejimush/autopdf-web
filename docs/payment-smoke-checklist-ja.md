# payment-smoke-checklist-ja.md

最終更新: 2026-05-29  
目的: ローンチ前に、Stripe Checkout / Customer Portal / Webhook / Free→Pro→Free戻りの決済導線を漏れなく確認する。

---

## 前提

- AutoPDF は Next.js App Router + Supabase + Stripe 構成
- Free はルール 3 件まで、Pro はルール無制限
- Stripe Checkout で Pro 購入
- Stripe Customer Portal で解約・支払い情報更新
- Stripe Webhook で `user_profiles` の以下項目を反映する  
  `plan` / `billing_status` / `billing_customer_id` / `billing_subscription_id` / `current_period_end` / `cancel_at_period_end`
- Pro から Free に戻った場合、4件目以降のルールは削除しない  
  ただし、実行・自動実行・複製・ON復帰はブロックする
- `/billing` / header / `/settings` / `/rules` でプラン表示がある

---

## 1. Checkout開始

- [x] Free ユーザーで `/billing` を開く
- [x] Checkout ボタンが表示される
- [x] Checkout 開始 API が 200 を返す
- [x] Stripe Checkout 画面へ遷移する

## 2. Checkout成功

- [x] Stripe で決済成功する
- [x] `billing/success` へ戻る
- [x]  `/billing` で Pro 表示になる
- [x]  header / `/settings` / `/rules` のプラン表示も Pro になる

## 3. Checkoutキャンセル

- [x] Checkout 画面でキャンセルする
- [x] `billing/cancel` に戻る
- [x] プランが Free のままである
- [x] `user_profiles` に不正な契約情報が入らない

## 4. Proユーザーの重複決済防止

- [x]  Pro ユーザーで再度 Checkout を試す
- [x]  既存契約ありとしてブロックされる
- [x]  新規サブスクリプションが二重作成されない

## 5. WebhookによるDB反映

- [ ] Checkout 完了イベント受信後、`user_profiles` が更新される
- [ ] 以下項目が想定値で反映される  
  `plan` / `billing_status` / `billing_customer_id` / `billing_subscription_id` / `current_period_end` / `cancel_at_period_end`
- [ ] DB 更新失敗時に 500 応答となり、監査可能なエラーが残る

## 6. Webhook二重受信時の安全性

- [ ] 同一イベントの再送を想定しても状態が壊れない
- [ ] `user_profiles` が不整合にならない
- [ ] 二重反映によるプランの揺れがない

## 7. Webhook署名不正時の拒否

- [x] 署名ヘッダー欠落で拒否される（400系）
- [x] 不正署名で拒否される（400系）
- [x] user_profiles が更新されない

## 8. Customer Portal遷移

- [x] Pro ユーザーで /billing を開く
- [x] Portal ボタンが表示される
- [x] Portal セッション作成 API が成功する
- [x] Stripe Customer Portal に遷移できる

## 9. Portalで解約予約

- [x] Portal で「期間終了時解約」を設定する
- [x] Webhook 後に cancel_at_period_end=true になる
- [x] /billing に「解約予約中」の状態が反映される

## 10. cancel_at_period_end中の期間内Pro扱い

- [x] cancel_at_period_end=true かつ current_period_end 未到達の状態を確認する
- [x] UI 上は Pro 扱いを維持する
- [x] ルール無制限・Pro 機能の制限が発生しない

## 11. 期間終了後のFree戻り

- [ ] 期間終了後の webhook 反映を確認する
- [ ] `plan=free` へ戻る
- [ ] `billing_status` が解約後状態へ更新される
- [ ] `/billing` / header / `/settings` / `/rules` が Free 表示になる

## 12. Free戻り時の4件目以降ルール制限

- [ ] 4件以上ルールを持つ Pro ユーザーを Free に戻す
- [ ] 4件目以降ルールが削除されないことを確認する
- [ ] 4件目以降ルールの以下操作がブロックされる  
  実行 / 自動実行 / 複製 / ON復帰
- [ ] 1〜3件目は通常どおり扱える

## 13. past_due時の表示と支払い情報更新導線

- [ ] `billing_status=past_due` の表示を確認する
- [ ] `/billing` で支払い問題が明確に表示される
- [ ] Customer Portal への導線が表示される
- [ ] 支払い情報更新後に状態が復帰することを確認する

## 14. billing / header / settings / rules のプラン表示一致

- [ ] Free / Pro / 解約予約中 / past_due の各状態で表示を確認する
- [ ] `/billing` / header / `/settings` / `/rules` の表示に矛盾がない
- [ ] 表示ズレがあればデータ取得元と更新タイミングを記録する

## 15. StripeとSupabase user_profiles の不整合確認

- [ ] Stripe 上の subscription/customer と `user_profiles` を突合する
- [ ] `billing_customer_id` / `billing_subscription_id` の取り違えがない
- [ ] `plan` と `billing_status` の組み合わせに矛盾がない
- [ ] 不整合があれば対象 user_id と発生条件を記録する

## 16. ローンチ前の最低限確認項目

- [ ] Free → Pro 購入成功
- [ ] Pro 重複決済防止
- [ ] Webhook 正常反映（主要6項目）
- [ ] Webhook 署名不正拒否
- [ ] Portal 遷移と解約予約
- [ ] 期間内 Pro 維持 / 期間後 Free 戻り
- [ ] Free 戻り時の 4件目以降ルール制限
- [ ] プラン表示一致（`/billing` / header / `/settings` / `/rules`）
- [ ] Stripe と `user_profiles` の突合

## 17. 後回しでよい項目

- [ ] 複数通貨・税率・請求書表示の詳細検証
- [ ] 長期運用を想定した稀な再試行シナリオの網羅
- [ ] 運用自動化（定期突合ジョブ、差分通知）の実装
- [ ] BI 向けの課金分析ダッシュボード整備

---

## 実施ログ（任意）

- 実施日:
- 実施者:
- 環境: local / preview / production
- 確認結果サマリ:
- 未解決事項:


- 実施日: 2026-05-30
- 実施者: 管理者
- 環境: production / Stripe sandbox
- 確認結果サマリ:
  - Free状態の `/billing` 表示確認OK
  - Stripe Checkout画面への遷移OK
  - Checkoutキャンセル後もFree維持OK
  - Free → Pro 購入成功OK
  - `/billing` / header / `/settings` / `/rules` のPro表示確認OK
  - Pro状態で重複決済導線が表示されないことを確認OK
  - Stripe Customer Portal遷移OK
  - Portalで期間終了時解約を設定OK
  - 当初、Stripe payloadでは `cancel_at_period_end=false` かつ `cancel_at=current_period_end` となり、AutoPDF DBに解約予約が反映されない問題を確認
  - `app/api/stripe/webhook/route.ts` を修正し、`cancel_at` と `current_period_end` が一致する場合も解約予約中として扱うよう対応
  - 修正後に `customer.subscription.updated` を再送し、`user_profiles.cancel_at_period_end=true` 反映OK
  - `/billing` で期間終了日まで利用可能な表示を確認OK
  - 解約予約中もPro扱いを維持し、4件目ルール作成・実行ボタン利用がブロックされないことを確認OK
- 未解決事項:
  - `/billing` の契約状態表示は「有効」のままだが、案内文では期間終了日まで利用可能と表示されている。将来的には「解約予約中」表示に改善するとより分かりやすい。
  - `/billing` と `/settings` で時刻表示が異なる可能性があるため、必要ならタイムゾーン表示を後で整理する。
