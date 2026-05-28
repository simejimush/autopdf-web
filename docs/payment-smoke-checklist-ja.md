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

- [ ] Free ユーザーで `/billing` を開く
- [ ] Checkout ボタンが表示される
- [ ] Checkout 開始 API が 200 を返す
- [ ] Stripe Checkout 画面へ遷移する

## 2. Checkout成功

- [ ] Stripe で決済成功する
- [ ] `billing/success` へ戻る
- [ ] `/billing` で Pro 表示になる
- [ ] header / `/settings` / `/rules` のプラン表示も Pro になる

## 3. Checkoutキャンセル

- [ ] Checkout 画面でキャンセルする
- [ ] `billing/cancel` に戻る
- [ ] プランが Free のままである
- [ ] `user_profiles` に不正な契約情報が入らない

## 4. Proユーザーの重複決済防止

- [ ] Pro ユーザーで再度 Checkout を試す
- [ ] 既存契約ありとしてブロックされる
- [ ] 新規サブスクリプションが二重作成されない

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

- [ ] 署名ヘッダー欠落で拒否される（400系）
- [ ] 不正署名で拒否される（400系）
- [ ] `user_profiles` が更新されない

## 8. Customer Portal遷移

- [ ] Pro ユーザーで `/billing` を開く
- [ ] Portal ボタンが表示される
- [ ] Portal セッション作成 API が成功する
- [ ] Stripe Customer Portal に遷移できる

## 9. Portalで解約予約

- [ ] Portal で「期間終了時解約」を設定する
- [ ] Webhook 後に `cancel_at_period_end=true` になる
- [ ] `/billing` に「解約予約中」の状態が反映される

## 10. cancel_at_period_end中の期間内Pro扱い

- [ ] `cancel_at_period_end=true` かつ `current_period_end` 未到達の状態を確認する
- [ ] UI 上は Pro 扱いを維持する
- [ ] ルール無制限・Pro 機能の制限が発生しない

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
