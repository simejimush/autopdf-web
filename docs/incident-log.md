# incident-log.md

## 目的

外部サービスの security incident、障害、credential 漏えい疑い、または自サービス側の重大トラブルについて、
「何が起きたか」「何を確認したか」「どう判断したか」「何を対応したか」を継続的に記録する。

このファイルは、以下の用途で使う。

- 初動確認内容の記録
- 停止 / 継続判断の根拠保存
- secret ローテーション実施履歴の保存
- postmortem の下書き
- 次回同種 incident 時の再利用

関連ファイル:

- `docs/incident-response.md`
- `docs/secret-rotation-checklist.md`
- `docs/incident-codex-prompt.md`

---

# Incident Entries

---

## 2026-04 Vercel security incident

- 記録日: 2026-04-20
- incident 名: Vercel April 2026 Security Incident
- 発生元: Vercel
- 公式 bulletin: https://vercel.com/kb/bulletin/vercel-april-2026-security-incident
- 対応レベル判定: Level 1〜2 の間（初動確認ベース）
- 記録者: 自分

### 1. 概要

Vercel が、一部内部システムへの unauthorized access を含む security incident を公表。
影響対象は限定された一部顧客とされ、該当顧客には直接連絡すると案内されている。

AutoPDF は Vercel を利用しているため、影響有無の初動確認を実施した。

### 2. 人間確認済み事実

- Vercel から AutoPDF 側への直接通知は来ていない
- Vercel は影響対象を限定された一部顧客としている
- Vercel は Activity Log 確認を推奨している
- Vercel は sensitive ではない secret 系 env var の優先ローテーションを推奨している
- AutoPDF は以下を利用している
  - Vercel
  - Supabase
  - Google OAuth / Gmail / Drive
  - Stripe

### 3. AutoPDF で影響確認対象とした重要領域

- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `GOOGLE_CLIENT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `SLACK_ERROR_WEBHOOK_URL`

関連機能:

- `/api/cron`
- Google 接続 / 再接続
- Gmail → PDF → Google Drive 保存
- Stripe checkout / portal / webhook
- `/admin/errors`
- server-side の `supabaseAdmin` 利用処理

### 4. 実施した確認

#### 4-1. Codex による read-only 調査

実施内容:

- repo 内の incident-response 関連ファイル確認
- 関連 env / route / server-side 処理の棚卸し
- 影響範囲の高 / 中 / 低分類
- ローテーション優先順位の整理
- 動作確認対象画面 / API の整理

Codex 調査で整理できた主な対象:

- 高優先 env:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CRON_SECRET`
  - `GOOGLE_CLIENT_SECRET`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
- 高影響機能:
  - `/api/cron`
  - 実行本体（Gmail取得 → PDF生成 → Drive保存）
  - Stripe webhook 同期
  - `supabaseAdmin` を使う更新系処理

#### 4-2. Vercel Activity 確認

確認場所:

- `Settings` → `Activity`

確認観点:

- env add / edit / delete
- secret add / delete
- shared env update
- project / settings 異常変更
- 不審な操作履歴の有無

確認結果:

- env 変更履歴は確認できた
- 表示範囲で確認した env 変更はすべて自分自身の操作
- 覚えのない env 更新 / 削除は見当たらなかった

表示上で確認した主な env:

- `GOOGLE_CLIENT_SECRET`
- `CRON_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`

判断:

- 少なくとも Activity 上では、第三者による env 変更の痕跡は確認できなかった

#### 4-3. Members 確認

確認場所:

- `Settings` → `Members`

確認観点:

- 知らないメンバー追加がないか
- Owner / Admin が増えていないか
- `Pending Invitations` に不審な招待がないか
- 2FA が有効か

確認結果:

- Members は本人 1 名のみ
- Role は Owner
- 2FA 有効
- `Pending Invitations` は空

判断:

- メンバー追加や権限変更の不審点は確認できなかった

### 5. 今回未確認のもの

- Vercel 側で自社 project が本当に限定対象顧客に含まれていたか
- old deployment / preview deployment における古い env の残存有無
- Domain 周辺の追加確認
- 外部サービス側のより詳細な監査ログ
  - Supabase
  - Google
  - Stripe
  - メール送信基盤

### 6. 判断

現時点では以下のように判断した。

- 直接通知なし
- Activity 上で不審な env 変更なし
- Members / Pending Invitations 異常なし
- 2FA 有効
- 覚えのない操作履歴は見当たらない

そのため、

- **緊急停止は不要**
- **今回の Vercel incident に AutoPDF が直撃された証拠は現時点で見えていない**
- **必要なら後日、予防的に高権限 secret のローテーションを検討する**

### 7. 予防ローテーション候補

優先順位:

1. `SUPABASE_SERVICE_ROLE_KEY`
2. `CRON_SECRET`
3. `GOOGLE_CLIENT_SECRET`
4. `STRIPE_SECRET_KEY`
5. `STRIPE_WEBHOOK_SECRET`

理由:

- server-side 高権限 secret と自動実行経路の保護を優先すべきため

### 8. 緊急対応の実施有無

- 本番停止: 実施せず
- cron 停止: 実施せず
- secret ローテーション: 未実施
- ユーザー告知: 未実施

### 9. 今後の対応候補

- 高権限 secret の予防ローテーションを行うか検討
- `docs/incident-response.md` に沿った確認フローを次回以降も継続
- `docs/secret-rotation-checklist.md` を使って、実ローテーション時の順序ミスを防ぐ
- 必要なら `/api/cron` に incident 時の一時停止フラグ追加を検討
- incident 時の確認結果を今後もこのファイルに追記していく

### 10. 学び / メモ

- Vercel の `Logs` は Runtime Logs であり、Activity とは別
- Hobby では Runtime Logs は短時間保持でも、Activity から操作履歴は確認できる
- 今回は Codex に read-only 調査をさせたことで、確認対象の env / route / 機能を早く整理できた
- 初動では「全部止める」より、「env / members / 高権限 secret」を優先確認する方が実用的

### 11. この incident の最終ステータス

- ステータス: 初動確認完了
- 現在の結論: 緊急対応不要 / 継続監視
- 次回必要アクション: 予防ローテーションを後日検討

---

## incident 追記テンプレート

以下をコピーして次回以降の incident 記録に使う。

```md
## YYYY-MM incident title

- 記録日:
- incident 名:
- 発生元:
- 公式 bulletin / URL:
- 対応レベル判定:
- 記録者:

### 1. 概要

### 2. 人間確認済み事実

### 3. 影響確認対象とした重要領域

### 4. 実施した確認

#### 4-1. AI / Codex / Claude による調査

#### 4-2. 管理画面での確認

#### 4-3. 外部サービス側の確認

### 5. 未確認事項

### 6. 判断

### 7. ローテーション候補 / 実施内容

### 8. 緊急対応の実施有無

### 9. 今後の対応候補

### 10. 学び / メモ

### 11. この incident の最終ステータス
```
