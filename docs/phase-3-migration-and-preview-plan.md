# AutoPDF Phase 3 migration / Preview plan

この文書は、Phase 3で残るrace / idempotency課題の承認用設計である。migrationファイル、DB適用、env変更、外部サービス操作はこの文書の範囲外とする。

## 1. 現在の判定

- migration不要で安全に完結できる既知のCritical / High修正はfeature branchへ反映済み
- Google credential、Stripe event順序、同一rule実行、Drive保存予約、Free quota、Stripe Checkoutの完全対策には共有DB状態が必要
- Production DDLはtracked migrationだけでは再現できないため、全migrationはPreviewで実DDL preflight後に確定する
- migration承認前の判定は`BLOCKED_PENDING_MIGRATION_APPROVAL`

## 2. 共通migration原則

- すべてのユーザー所有行に`user_id`を持たせ、既存RLS境界を維持する
- service role関数を追加する場合も、入力の`user_id`、対象identity、更新件数を関数内で検証する
- 0件、複数件、不正shapeを成功扱いしない
- token、email、Stripe識別子、Gmail本文を監査messageへ保存しない
- expand → backfill → dual-read/write → enforce → cleanupの順で適用する
- 各migrationを独立commit・独立rollback単位にし、一括適用しない
- rollbackは新規書込みを先に停止してから行い、旧コードが新列を無視できる期間を確保する

## 3. M1 Google credential version

### 問題と影響

refresh、callback、disconnectが同じ`google_connections`行を更新し、古いcredentialが新しいcredentialやdisconnect状態を上書きできる。credential喪失または切断済みtokenの復活につながるCritical課題である。

### schema案

- `google_connections.credential_version bigint not null default 0`
- 既存`user_id UNIQUE`を維持
- version単独indexは不要。CASは既存user unique lookupと組み合わせる
- health、通知、表示更新では`credential_version`を変更しない

### transaction / write契約

- credential SELECTでversionを必須取得
- callback、disconnect、credential validation failure、refresh保存だけがversionを更新
- UPDATE条件は`user_id + expected status + expected credential_version`
- payloadへ`credential_version = expected + 1`を含め、credentialと同じUPDATEで保存
- 0件は競合、複数件は整合性異常
- token値や暗号文をWHERE・ログに使用しない

### backfill / compatibility

- 追加時default 0で既存行をbackfill
- 旧コードは新列を無視できる
- deploy 1で列追加、deploy 2でread/CAS、十分な観測後にdefault・not null契約を再確認

### rollback

- CASコードを旧writeへ戻してから列を残置するのが第一rollback
- 列削除は観測期間後の別migrationとし、緊急rollbackでは削除しない

### Preview検証・必須テスト

- refresh対callback、refresh対disconnect、callback対disconnectを並列実行
- stale versionは0件、winnerだけversionが1増加
- health／notifyではversion不変
- refresh token preserve／rotationを同一CASで確認
- token・version値がresponseやログへ出ないことを確認

### 監視

- `GOOGLE_TOKEN_UPDATE_CONFLICT`件数
- credential save失敗率
- reconnect後のtoken invalid増加

## 4. M2 Google refresh lease

### 問題と依存関係

M1は古いDB書込みを拒否するが、2つのGoogle refreshがprovider側で同時にrefresh token rotationした場合のcredential喪失を完全には防げない。M1に依存する。

### schema案

- `google_connections.refresh_lease_id_hash text null`
- `google_connections.refresh_lease_expires_at timestamptz null`
- lease本体は暗号学的乱数とし、DBにはhashだけを保存
- expiry検索が必要な運用workerを導入するまで専用indexは不要

### transaction契約

- provider refresh前に`user_id + credential_version + connected + lease expired/null`でclaim
- claimとversion確認を同一UPDATEで行う
- ownerだけがcredential保存とlease clearを行う
- crash時は短いexpiry後に再claim可能
- retryは最大1回、無制限loop禁止

### rollback / recovery

- lease取得コードを無効化し、lease列は残置
- stuck leaseはexpiryで自動回復。手動clearはuser限定・監査付き

### テスト・監視

- 同じuserの並列claimで1件だけ成功
- 別userは独立
- expired lease回復、owner不一致clear拒否
- refresh API呼出しがclaim後だけであること
- lease conflict率、expired recovery件数

## 5. M3 Stripe webhook ledger and ordering

### 問題と影響

event IDとprovider event時刻を保存していないため、再送を重複処理し、古いupdated/deleted eventが新しいsubscription状態を巻き戻せる。誤プラン反映につながるCritical課題である。

### schema案

`stripe_webhook_events`:

- `event_id text primary key`
- `event_type text not null`
- `provider_created_at timestamptz not null`
- `user_id uuid null`
- `subscription_id_hash text null`
- `status text not null default 'received'`
- `attempt_count integer not null default 0`
- `received_at timestamptz not null default now()`
- `processed_at timestamptz null`
- `safe_error_code text null`
- index: `(status, received_at)`、`(user_id, provider_created_at desc)`

`user_profiles`または専用subscription state:

- `billing_last_event_created_at timestamptz null`
- `billing_last_event_id text null`

Stripe IDをログへ出さず、必要な照合値は既存billing列またはhashで扱う。

### transaction契約

- 署名検証後にevent IDをunique INSERT
- duplicate eventは既存processed結果を返し、profileを再更新しない
- owner解決、順序判定、profile update、ledger processed化を1 transaction/RPCへ集約
- `event.created`が古い場合はprofileを更新せずstaleとして完了
- 同一秒eventはevent IDだけで業務順序を推測しない。subscriptionの現在状態をStripeからreconcileするworker設計を併用する
- webhook route内の同期reconcileを必須にせず、retry可能なstatusを残す

### backfill / compatibility

- ledgerは新規eventから開始。既存eventのbackfillは行わない
- 現在profile状態をbaselineとして`billing_last_event_created_at`はdeploy時刻では埋めない
- ledger導入後の最初のeventはowner照合後に受理し、必要ならStripe test環境でcurrent-state reconcileする

### rollback / recovery

- 新ledger writeを停止して旧handlerへ戻し、ledgerは監査用に残置
- failed eventはattempt上限とsafe error codeで再処理
- Productionで古いeventを手動再送する前にcurrent subscriptionを確認する

### テスト・監視

- 同一event再送、逆順updated/deleted、別owner、0/複数owner
- ledger insertとprofile updateのtransaction rollback
- signature invalid時はledger/DBアクセス0回
- duplicate、stale、failed、retry件数を監視

## 6. M4 rule execution lock / lease

### 問題と影響

手動Run、Cron、重複Cronが同じruleを同時実行でき、同じGmail messageをDriveへ重複保存できるHigh課題である。

### schema案

`rule_execution_leases`:

- `rule_id uuid primary key`
- `user_id uuid not null`
- `run_id uuid not null unique`
- `lease_id_hash text not null`
- `acquired_at timestamptz not null default now()`
- `expires_at timestamptz not null`
- `heartbeat_at timestamptz not null`
- index: `(expires_at)`、`(user_id, acquired_at desc)`
- FKはProduction DDL preflight後に`rules`/`runs`の削除契約と合わせて決定

### transaction契約

- run作成とlease claimを同じtransaction/RPCで行う
- active leaseがあれば新runを作らず既存`RUN_ALREADY_RUNNING`相当で安全停止
- terminal finalize時にlease owner/run identityを照合して解放
- crash時はexpiry後に次実行がclaim可能

### backfill / compatibility

- backfill不要
- 旧running runにはleaseを自動生成せず、stale run recovery導入時に分類

### rollback / recovery / tests

- claim使用を停止しテーブルを残置
- 同一rule並列、別rule、別user、expired lease、owner不一致releaseをテスト
- lease conflict、expiry recovery、実行時間分布を監視

## 7. M5 processed_emails reservation

### 問題と影響

現在のunique INSERTはDrive upload後であり、並列処理が両方uploadしてから片方だけDB conflictになる。重複PDFと孤児DriveファイルにつながるHigh課題である。

### schema案

既存`processed_emails`へ追加する案:

- `processing_status text not null default 'completed'`
- `reservation_id_hash text null`
- `reserved_at timestamptz null`
- `reservation_expires_at timestamptz null`
- `completed_at timestamptz null`
- 既存`(rule_id, gmail_message_id) UNIQUE`を維持
- index: `(processing_status, reservation_expires_at)`

Production DDLでDrive列がnot nullの場合は、同一unique keyを持つ専用`processed_email_reservations`テーブルへ分離する。

### transaction契約

- Drive前にunique reservation INSERT
- winnerだけupload
- upload成功後、reservation ownerがDrive情報とcompleted状態を同一UPDATEで保存
- loserはDrive APIを呼ばない
- crash reservationはexpiry後にclaim可能。既にDrive file IDがある場合は再uploadしない

### backfill / compatibility

- 既存行を`completed`、`completed_at = saved_at`としてbackfill
- 旧readerはcompleted行だけと同等になるようdeploy順を組む

### rollback / tests / monitoring

- reservation pathを停止し追加列/テーブルを残置
- 並列reservation、unique violation、crash recovery、owner mismatch、partial uploadをテスト
- pending/stale reservation、orphan recovery、duplicate conflictを監視

## 8. M6 Free monthly quota reservation

### 問題と影響

countと保存が非atomicで、残り1件を複数処理が同時に通過できる。migrationなしのDrive直前再確認は競合窓を縮めるだけで、High課題は残る。

### schema案

`monthly_pdf_quota`:

- `user_id uuid not null`
- `month_start date not null`
- `reserved_count integer not null default 0`
- `completed_count integer not null default 0`
- `updated_at timestamptz not null default now()`
- primary key `(user_id, month_start)`
- CHECKでcountを0以上に限定

quota reservation identityはM5のprocessed reservationと関連付ける。必要なら別`monthly_pdf_quota_reservations`に`reservation_id_hash UNIQUE`を持たせる。

### transaction契約

- Freeだけ、M5 reservationとquota incrementを1 transaction/RPCで行う
- `completed + reserved < 10`の場合だけclaim
- Drive失敗・lease expiryでreservedをrelease
- completed化はprocessed email完成と同一transaction
- Pro/Pro+はquota rowを変更しない

### backfill / compatibility

- 当月processed_emailsをuser単位集計してcompleted_countへbackfill
- backfill中は旧countをsource of truthとし、cutover直前に差分再集計

### rollback / tests / monitoring

- 新claim停止後、旧count checkへ戻し、quota tableは監査用に残置
- 残り1件の並列claim、release、月境界、plan変更をテスト
- reserved/completed差、stale reservation、拒否率を監視

## 9. M7 Stripe Checkout idempotency

### 問題と影響

customer不存在確認、customer作成、profile保存、open session確認、session作成が分離しており、複数customer/session/subscriptionと誤課金につながるCritical課題である。

### schema案

`stripe_checkout_attempts`:

- `id uuid primary key`
- `user_id uuid not null`
- `attempt_key_hash text not null unique`
- `status text not null default 'creating_customer'`
- `stripe_customer_id text null`
- `checkout_session_id text null`
- `created_at timestamptz not null default now()`
- `expires_at timestamptz not null`
- `completed_at timestamptz null`
- partial unique: userごとのactive attemptを1件に限定
- index: `(status, expires_at)`

### transaction / Stripe契約

- DBでactive attemptをclaimしてからStripe APIを呼ぶ
- Stripe idempotency keyはattempt IDから導出した非機密値を使い、email/token/secretを含めない
- customer保存は`billing_customer_id is null` CAS。競合時はwinnerを1回再読込
- session作成もattempt固有idempotency keyを使用
- open session再利用とattempt状態更新を統一
- 無制限retry禁止

### backfill / compatibility

- backfill不要。既存billing customerを持つuserはそれを優先
- active subscription確認は引き続き実施

### rollback / recovery / tests

- 新attempt作成停止後、既存active attemptを期限切れまで保持
- orphan customer/sessionはStripe test環境でreconcileし、識別子をログへ出さない
- 同時POST、DB claim conflict、Stripe timeout、customer save conflict、expired attemptをテスト
- active attempt、orphan recovery、duplicate prevention件数を監視

## 10. M8 notification outbox

### 問題と影響

cooldown read、email送信、state updateが非atomicで、並列処理から重複メールが送られるMedium課題である。現在のsnapshot CASは古いstate上書きを防ぐが送信済み副作用は戻せない。

### schema案

`notification_outbox`:

- `id uuid primary key`
- `user_id uuid not null`
- `notification_type text not null`
- `error_code text not null`
- `cooldown_bucket timestamptz not null`
- `status text not null default 'pending'`
- `lease_id_hash text null`
- `lease_expires_at timestamptz null`
- `attempt_count integer not null default 0`
- `sent_at timestamptz null`
- `safe_error_code text null`
- unique `(user_id, notification_type, cooldown_bucket)`
- index `(status, lease_expires_at)`

### transaction / compatibility

- run処理はoutbox INSERTだけを行い、メール送信worker失敗でrunを巻き込まない
- workerがlease claim後にuser IDでAuth lookupし、成功後だけsent化
- recipient emailは保存せず送信時に解決
- 既存notification timestampはsent成功後の互換更新として維持

### rollback / tests / monitoring

- worker停止、pending行保持、旧直接送信へ戻す場合は重複窓を明示
- unique抑制、lease、provider failure、Auth user欠落をテスト
- pending age、attempt、sent、failedを監視

## 11. M9 stale run recovery

### 問題と依存関係

プロセス停止で`runs.status=running`が残り、監査不能またはM4 leaseの再実行判断と不整合になるHigh課題である。M4導入後に実施する。

### schema案

- `runs.heartbeat_at timestamptz null`
- `runs.lease_expires_at timestamptz null`
- `runs.recovery_count integer not null default 0`
- index `(status, lease_expires_at)`

### transaction契約

- M4 lease heartbeatとrun heartbeatを同じowner/run identityで更新
- recovery workerは`running + expired`だけを固定error codeでterminal化
- `status=running` CASを維持し、既terminalを上書きしない
- Drive/processed reservation状態を確認してからretry可否を決める

### backfill / rollback / tests / monitoring

- 既存runningは自動terminal化せず、Previewでageを分類してから方針決定
- worker停止でrollbackし、列は残置
- heartbeat race、terminal競合、M4/M5状態組合せをテスト
- stale running数、recovery成功/失敗、ageを監視

## 12. Deferred lower-priority shared-state work

- OAuth stateの厳密な同時single-useには、nonce hash unique台帳とTTL cleanupが必要。現在は署名cookie、session binding、PKCE、authorization code単回性があり、優先度はLow
- Free rule作成上限の厳密化にはuser単位counterまたはtransactional claimが必要
- free downgrade時のrule無効化はactual更新行identityを検証するrepository化が候補

## 13. 推奨migration適用順

1. M1 Google credential version
2. M2 Google refresh lease
3. M3 Stripe webhook ledger/order
4. M7 Stripe Checkout idempotency
5. M4 rule execution lock/lease
6. M5 processed_emails reservation
7. M6 Free quota reservation
8. M9 stale run recovery
9. M8 notification outbox

M5とM6は同じtransaction境界を共有するため、schemaは独立migrationでもapplication cutoverは同一release候補とする。M9はM4/M5の状態契約確定後に行う。

## 14. Preview baseline

Preview限定push前に、値を表示せず次の存在・分離だけを人間が確認する。

### DB / data separation

- Preview Supabase projectがProductionと別project/referenceである
- Preview DBにProduction user/token/billingデータをコピーしない
- migrationはPreviewだけへ番号順に適用し、schema diffを保存する
- RLS/policy/grantはProduction baselineとの差分をレビューする

### Google OAuth / token

- Preview専用Google OAuth clientを使用
- Preview callback URLとredirect URIがPreview hostだけを指す
- scopeは現行と同一
- token encryption keyringはPreview専用で、Production keyを共有しない
- encryption write interlockの初期状態を確認し、暗号化self-test後だけwriteを許可
- state cookieのSecure/Path/SameSiteと10分期限をPreview HTTPSで確認

### Stripe

- Stripe test mode key/price/webhook endpointだけを使用
- Production customer/subscription/eventを参照しない
- webhook signing secretはPreview endpoint専用
- 実課金手段を使用しない

### Cron / notification

- Preview Cronは停止、または専用secretで限定手動実行
- PreviewからProduction Gmail/Drive対象を処理しない
- email/Slackは送信停止またはPreview専用sink/宛先へ分離
- 実ユーザー通知を送らない

### URL / env contract

- `APP_URL`、`NEXT_PUBLIC_APP_URL`、Google callback URLが同一Preview origin
- Production値を表示・コピーせず、キーの存在と環境分離だけを確認
- secret/tokenをbuild log、runtime log、Preview responseへ出さない

### deploy / rollback anchor

- rollback anchorはPreview deploy直前の既知commit SHAとDB schema version
- 同一SHAをbuildし、Previewへ1回だけdeploy
- migration deployはexpand migration → compatible app → enforceの順
- rollbackはappをanchor SHAへ戻し、新列/テーブルは原則残置
- destructive rollback SQLは別承認とする

## 15. Preview smoke checklist

- OAuth connect、state不正、PKCE verifier不正、callback成功、disconnect
- token暗号化保存とkey ID解決、write interlock
- Rules create/edit/delete/duplicate、subject keywords
- manual Run、Cron認証、success/error terminal CAS
- processed email duplicate、Free quota再確認
- Stripe Checkout test session、webhook署名、owner conflict、再送、逆順
- user notificationはmock/sinkだけで送信成功・失敗・cooldown CAS
- response/logにtoken、secret、email、Stripe ID、Gmail本文がない
- 全テスト、TypeScript、対象ESLint、Prettier、diff check

## 16. Productionへそのままmergeしない条件

- feature branchには独立した未リリースcommitが複数含まれる
- Production DDLの完全なtracked baselineがない
- M1/M2/M3/M4/M5/M6/M7/M9のCritical/High共有状態対策が未承認・未適用
- Preview環境分離とrollback anchorが未確認
- Stripe逆順event、同時Checkout、Google refresh rotationのPreview並列試験が未実施

Preview検証合格後も、Production投入はmigration単位・機能単位のrelease planを別途承認する。
