# AutoPDF Phase 3 migration / Preview plan

この文書は、Phase 3で残るrace / idempotency課題と、Preview baseline / DB security rolloutの承認用設計である。migration、静的・契約テスト、手順書はrepositoryへ実装済みだが、DB適用、migration history repair、env変更、外部サービス操作は未実施である。

## 1. 現在の判定

- migration不要で安全に完結できる既知のCritical / High修正はfeature branchへ反映済み
- Google credential、Stripe event順序、同一rule実行、Drive保存予約、Free quota、Stripe Checkoutの完全対策には共有DB状態が必要
- Production DDLはtracked migrationだけでは再現できないため、全migrationはPreviewで実DDL preflight後に確定する
- baseline / hardening実装後・DB適用前の判定は`READY_FOR_PREVIEW_BASELINE_MIGRATION_APPLY_APPROVAL`

## 1.1 Production schema inventoryで確認したgrant問題

Productionの既存grant集合には、`authenticated`のtable-level権限が含まれていた。Postgresではtable-level権限を残したままcolumn grant/revokeを追加しても列制限にならないため、次をDB境界で保証できない状態だった。

- `user_profiles`のplan / billing列をauthenticatedから更新不能にすること
- `google_connections`のtoken列・内部通知列をauthenticatedのSELECT対象外にすること

hardening migrationは、変更前に既存policy / table grant / column grantのfingerprintを検証し、未知形状なら停止する。既知形状だけを明示的に`REVOKE ALL`し、その後に必要なtable / column grantを再付与する。grantだけに依存せず、own-row RLSも同時に固定する。

## 1.2 実装済みbaseline / hardening package

適用順はfilename順に固定する。

1. `20260528090000_create_autopdf_core_baseline.sql`
2. `20260529090000_create_ai_usage_logs.sql`
3. `20260530090000_harden_autopdf_core_security.sql`
4. `20260726090000_add_google_credential_version.sql`
5. `20260807064701_reconcile_production_core_security.sql`
6. `20260809180000_add_google_refresh_lease.sql`
7. `20260810044303_harden_rls_auto_enable_acl.sql`
8. `20260811041554_add_google_refresh_operations.sql`
9. `20260811083110_harden_rls_auto_enable_acl_forward.sql`

core baselineは、対象5 tableが1つでも存在すればDDL前に停止する空Preview DB専用migrationである。Productionでは絶対に実行しない。Productionの既存schemaやrowをbaselineへ合わせる処理、row dataのコピー、`runs.user_id`のbackfillは行わない。

hardeningはPreview / Production共通だが、6 tableの列・default・NOT NULL、constraint、index、RLS、policy、grant、trigger、functionを変更前に検証する。`credential_version`が既に存在する場合、`runs.user_id IS NULL`が1件でもある場合、または未知driftがある場合はtransaction全体を停止する。

### 1.2.1 migration safety contract

- `20260529090000_create_ai_usage_logs.sql`は明示的なtransaction、`lock_timeout`、`statement_timeout`を持つ。最初のDDLより前にpreflightを実行し、`ai_usage_logs` tableまたは同名PK/indexが1つでも存在する場合は、完全一致かどうかにかかわらず停止する。空Preview baseline chain専用とし、部分schemaや未知driftを`IF NOT EXISTS`で黙認しない。
- AI usage migrationは作成直後にRLSを有効化し、hardening前の既知policyを作成する。Supabase projectごとのdefault privilege差を除くため、`PUBLIC`、`anon`、`authenticated`、`service_role`のtable権限を明示的にrevokeする。次のhardening migrationが既知policyを検証・削除し、最終的な`service_role SELECT, INSERT`だけを付与する。
- `20260726090000_add_google_credential_version.sql`も明示transactionと両timeoutを持つ。DDL前preflightでcolumn不在または完全一致だけを許可する。完全一致は`bigint NOT NULL DEFAULT 0`、validated nonnegative CHECK、NULL/負値rowなし、未知constraintなしを意味し、この場合はDDLを実行しない。
- `credential_version`が不在の場合だけ、column追加、既存rowの0 backfill、CHECK追加・validate、NOT NULL化を同一transaction内で行う。nullable、default違い、型違い、constraint名衝突、未validated/異なるCHECK、NULL/負値rowなどの部分shapeはDDL前にfail-closedとする。
- `20260809180000_add_google_refresh_lease.sql`は、2列・validated pair/digest CHECK・server-clock claim RPC・owner/security/grantがすべて不在、またはすべて完全一致するshapeだけを許可する。片側だけの列、wrong constraint、unknown dependency、wrong function/grantはDDL前に停止し、row、token、`credential_version`、RLS、policy、table grantを変更しない。
- 今回のACL lineage remediationではPreview / Production DBへのmigration適用、history repair、schema/data変更を行わない。Productionへcore baselineを適用してはならない。

### 1.2.2 RLS auto-enable ACL migration lineage

- Previewでは`20260810044303_harden_rls_auto_enable_acl.sql`が旧SQLで適用済みである。repositoryも同じ旧source（SHA-256 `CAA4291B7F0FD6F704C36473C99E7263F12E5E6CC79D726A81D19059EC42E198`）を保持し、適用済みversionの意味を変更しない。Previewには後続の`20260811083110_harden_rls_auto_enable_acl_forward.sql`だけを別承認で適用する。
- Productionでは`20260810044303`は未適用であり、`public.rls_auto_enable()`と`ensure_rls`も不存在である。旧migrationはhelper存在を要求するため直接適用しない。適用直前のmetadata-only preflightで不存在を再確認し、別の明示承認で同versionをmigration historyへbaseline/repairした後、新forward migrationを適用する。history repairとmigration applyは同一の暗黙承認に含めない。
- 新forward migrationは、helper/triggerが両方不存在ならgrant/revokeやobject作成を行わずno-opとする。両方がexpected shapeで存在する場合は、初期`PUBLIC EXECUTE`をowner-only ACLへhardeningし、既にharden済みならreplay-safeに成功する。partial state、extra binding、function/trigger/ACL driftは最初のmutationより前にfail-closedとする。
- Phase 3で正式サポートするfresh replayは、helper-present Supabase baselineからのfull chainと、reconciliationおよびmigration history baseline済みのProduction-compatible chainである。helper/trigger不存在かつmigration historyが0件の任意DBへ全migrationを直接replayする経路は正式サポート外とし、squashed baseline/bootstrap redesignはこのPhaseでは行わない。

Previewへの次回read-only確認へ進む前に、9 migrationの順序、working tree、commit SHA、静的migration test、全Playwright、TypeScript、対象ESLint、Prettier、diffを再確認する。実DB適用は、そのread-only確認と別の明示承認後に限る。

## 1.3 Preview適用手順（人間承認後のみ）

事前条件:

1. 人間が対象project referenceを確認し、Productionと別のPreview projectであることを記録する
2. Preview DBが空であり、Production user / token / billing / Gmail / Drive rowをコピーしていないことを確認する
3. Preview専用OAuth / Stripe test / Cron停止 / notification sinkを確認する
4. 適用直前commit SHAとmigration一覧をrollback anchorとして保存する
5. `supabase migration list`と`supabase db push --dry-run`で、上記4 migrationだけが同じ順序でpendingであることを確認する

人間の明示承認後だけ`supabase db push`を1回実行する。新規link、link変更、CLI install、remote history repairはこの操作に含めない。dry-runに別migration、既存core table、Production参照が出た場合は適用しない。

適用後はrow値を表示せず、`information_schema.columns`、`pg_constraint`、`pg_indexes`、`pg_policies`、`information_schema.table_privileges`、`information_schema.column_privileges`、`pg_trigger`、`pg_proc`のmetadataだけで検証する。data確認が必要な項目は、`runs.user_id IS NULL`やcredential version不正値のaggregate countだけとし、token、email、billing ID、Gmail本文を取得しない。

## 1.4 Production適用手順（今回の承認範囲外）

Productionではbaselineを実行しない。将来、次をそれぞれ別承認で行う。

1. metadata-only snapshotを再取得し、repositoryに固定した既知shapeと一致することを確認する
2. baselineおよび既存手動DDLに対応するmigration history repairを行う（実DDLは実行しない）
3. hardening migrationを適用し、metadata-only post-apply verificationを行う
4. credential migrationを適用し、schema確認後にCAS applicationをdeployする

history repairはhardening適用承認に含めない。未知policy / grant / trigger / function、NULL owner、constraint/index driftが1件でもあれば`BLOCKED_MIGRATION_IMPLEMENTATION_CONFLICT`として停止する。

## 1.5 Rollback

- Preview baseline適用中の失敗は各migration transactionでrollbackされる。空Preview projectの再作成・reset・deleteは別承認とし、自動実行しない
- hardening適用後の権限rollbackは、適用前metadata snapshotを元にしたforward migrationを別レビューで作る。Productionで即時の手動grant変更をしない
- signup / updated_at trigger問題はtrafficを止め、既知snapshotとのdiffを取り、別migrationで戻す
- credential migration後はCAS applicationを先にrollbackし、列とconstraintは残置する
- いずれのrollbackでもProduction rowをPreviewへコピーせず、token / billing / user rowをログや手順書へ貼らない

## 2. 共通migration原則

- すべてのユーザー所有行に`user_id`を持たせ、既存RLS境界を維持する
- service role関数を追加する場合も、入力の`user_id`、対象identity、更新件数を関数内で検証する
- 0件、複数件、不正shapeを成功扱いしない
- token、email、Stripe識別子、Gmail本文を監査messageへ保存しない
- expand → backfill → dual-read/write → enforce → cleanupの順で適用する
- 各migrationを独立commit・独立rollback単位にし、一括適用しない
- rollbackは新規書込みを先に停止してから行い、旧コードが新列を無視できる期間を確保する

## 3. M1 Google credential version

### 実装状態（2026-07-26）

- migration: `supabase/migrations/20260726090000_add_google_credential_version.sql`
- application CAS: repository / token store / refresh / callback / disconnectへ実装済み
- local verification: 対象テスト、TypeScript、ESLint、Prettier、diff check合格
- 未実施: Supabase local / Preview / Productionへのmigration適用、remote migration、push、Preview実DB並列試験
- deploy順は必ず「migration適用 → schema検証 → CAS application deploy」とする。列追加前にCAS applicationをdeployしない

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
- versionはJavaScript `number`へ丸めず、正規化済み10進文字列として扱う
- Postgres `bigint`上限、負数、非整数、先頭0付き、不正shapeを拒否する
- INSERTはversion 0で初期化し、既存行のcredential mutationだけを`expected + 1`へ更新する
- `RETURNING id, credential_version`を検証し、更新されたversionが期待値と一致する1行だけを成功とする

### backfill / compatibility

- nullable列追加後、既存NULLを0へbackfillし、非負CHECKをvalidateしてからdefault 0 / NOT NULLを保証
- 旧コードは新列を無視できる
- legacy plaintext tokenのdual-readと暗号化keyring契約は変更しない
- 既存constraint名が別定義で存在する場合や列型がbigint以外の場合はmigrationをfail-closedにする

### rollback

- CASコードを旧writeへ戻してから列を残置するのが第一rollback
- 列削除は観測期間後の別migrationとし、緊急rollbackでは削除しない

### Preview検証・必須テスト

- refresh対callback、refresh対disconnect、callback対disconnectを並列実行
- stale versionは0件、winnerだけversionが1増加
- health／notifyではversion不変
- refresh token preserve／rotationを同一CASで確認
- token・version値がresponseやログへ出ないことを確認

local testでは次を固定済み:

- 同一versionを読んだ2 refreshは1件だけ成功し、loserは`GOOGLE_TOKEN_UPDATE_CONFLICT`
- callback / reconnect後およびdisconnect後の古いrefreshは0件競合
- access-only refreshは保存済みrefresh token列を変更せず、rotation時は2 tokenを同一CASで更新
- owner不一致、0件、複数件、不正RETURNING shape、DB失敗、version不正値・overflowをfail-closed
- 保存失敗時は未保存credentialからOAuth clientを返さない

### 監視

- `GOOGLE_TOKEN_UPDATE_CONFLICT`件数
- credential save失敗率
- reconnect後のtoken invalid増加

### migration apply設計パッケージ（未実行）

前提:

1. 人間が対象をProductionと異なるPreview Supabase projectと確認する
2. Preview DBにProductionデータが複製されていないことを確認する
3. 現行application SHAとschema snapshotをrollback anchorとして保存する
4. Cron、通知、実ユーザーGoogle処理を停止したPreviewで行う

CLIが既にPreview projectへ安全にlink済みである場合だけ、次を人間承認後に実行する。project linkの新規作成・変更は別承認とする。

```bash
supabase db push --dry-run
supabase db push
```

空Preview DBでのdry-run期待結果は、1.2の4 migrationだけが同じ順序でpendingであり、他の未追跡DDLやProduction参照がないこと。baseline / AI usage / hardeningを既に検証済みのPreviewでM1だけを個別適用する場合に限り、`20260726090000_add_google_credential_version.sql`だけがpendingとなる。apply後はいずれも再実行対象に残らないことを確認する。

適用後のschema検証SQL（値・tokenは表示しない）:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'google_connections'
  and column_name = 'credential_version';

select
  count(*) filter (where credential_version is null) as null_versions,
  count(*) filter (where credential_version < 0) as negative_versions
from public.google_connections;

select conname, contype, convalidated
from pg_constraint
where conrelid = 'public.google_connections'::regclass
  and conname = 'google_connections_credential_version_nonnegative';
```

期待結果:

- columnは`bigint` / `NO` / default `0`
- `null_versions = 0`、`negative_versions = 0`
- 非負CHECKは`contype = c`、`convalidated = true`
- 事前snapshotと比較して既存`user_id UNIQUE`、RLS、policy、grantに差分なし
- schema確認後にCAS applicationをdeployし、Preview専用credentialで並列refresh / reconnect / disconnect smokeを行う

### rollback手順

第一rollbackはapplicationだけをCAS導入前のanchor SHAへ戻し、`credential_version`列とconstraintは残置する。旧applicationは追加列を無視できるため、緊急時に列をdropしない。

1. CAS applicationへの新規trafficを停止する
2. applicationをCAS導入前の既知SHAへ戻す
3. callback / refresh / disconnectのエラー率とGoogle接続状態を確認する
4. `credential_version`列は監査・再切替用に残す

列削除は十分な観測後の別migration・別承認とする。必要な場合も、CAS applicationが完全に停止し旧applicationへ戻ったことを確認してから、constraint削除 → column削除の順で行う。Production/Previewでの破壊的rollback SQLはこの承認範囲では実行しない。

## 4. M2 Google refresh lease

### 問題と依存関係

M1は古いDB書込みを拒否するが、2つのGoogle refreshがprovider側で同時にrefresh token rotationした場合のcredential喪失を完全には防げない。M1に依存する。

### schema案

- `google_connections.refresh_lease_id_hash text null`
- `google_connections.refresh_lease_expires_at timestamptz null`
- lease本体は暗号学的乱数とし、DBにはhashだけを保存
- raw lease secretはserver processの非serializable handle内だけに保持し、32-byte CSPRNG secretのSHA-256 digestだけをDB条件へ渡す
- pair CHECKは両方NULLまたは両方non-NULLだけを許可し、digest CHECKはlowercase SHA-256 hex 64文字だけを許可する
- expiry検索が必要な運用workerを導入するまで専用indexは不要

### transaction契約

- provider refresh前に`user_id + credential_version + expected status + lease null/expired`でclaim
- `SECURITY INVOKER` RPCが`statement_timestamp()`を一度だけ取得し、active/expired判定と90秒expiry生成を同一UPDATEで行う。application時刻やapplication supplied expiryはsecurity boundaryに使わない
- RPCの`EXECUTE`は`service_role`だけに付与し、`PUBLIC` / `anon` / `authenticated`には付与しない
- ownerだけがcredential保存とlease clearを行う
- 成功時はtoken暗号化保存、`credential_version + 1`、lease/expiry clearをowner hash付きの1 UPDATEで行う
- Google provider callは30秒timeout・SDK retry 0、lease TTLは90秒とする。provider呼出し後の失敗・process crashはleaseをexpiryまで保持し、別requestによる不明結果の即時再実行を防ぐ
- encryption preflight失敗はprovider呼出し前なので、owner/status/version/hash付きUPDATEで安全にreleaseする
- lease conflictはprovider 0回、credential write 0回、retry 0回でfail-closedとし、自動retry loopは持たない

### rollback / recovery

- lease取得コードを無効化し、lease列は残置
- stuck leaseはexpiryで自動回復。手動clearはuser限定・監査付き
- callback/reconnectは既存rowの場合だけprovider前に同じleaseをclaimする。初回connect insertは競合rowがないため対象外とする。validation failureはowner付き更新、disconnectはactive lease中のmutation拒否とexpiry後回復を行う
- 初回callbackのduplicate provider callはconnection rowがまだ存在しないため、このgeneric leaseでは別schemaを追加して解決しない。unique insert、authorization codeのone-time semantics、固定失敗redirectを維持する既知のresidual riskとする
- Production rolloutはmigration firstとする。旧artifactはnullable列/RPCを無視して動作できるが、新artifactをmigration前に出してはならない。またproviderへ到達可能な旧artifact・Cron・in-flight requestをdrainするまでlease保護完了とは判定しない

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

## 13. 将来のshared-state migration依存順

以下は将来課題を実装する場合の依存順であり、scoped Phase 3のProduction rolloutで一括適用するmigration一覧ではない。各項目は別phase、別レビュー、別承認で扱う。

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

## 16. Scoped integration判定（2026-08-04）

mainへのcode mergeとProductionへのmigration、env、credential、deployment適用は別の承認ゲートとする。scoped integration branchにはGoogle token encryption Phase 3に必要な変更だけを含め、無関係なrule subject修正、Stripe webhook ownership hardening、旧branch全体のPreview記録commitは含めない。

### A. MUST_FIX_BEFORE_MAIN_MERGE

- branch scope分離のみ。scoped integration branchの構成と、除外対象が混入していないことの検証を完了してからmain mergeを承認する

### B. MAY_MERGE_BUT_MUST_FIX_BEFORE_PRODUCTION

- Production migration historyと実schemaの整合確認。core baselineは空Preview DB専用であり、Productionへ適用しない
- Production専用token keyring、write interlock、暗号化self-testを含むenv契約の確認
- Cronの`Authorization: Bearer`切替、Vercel Cron設定との整合、`CRON_SECRET` rotationを停止状態で実施

### C. ACCEPTED_LIMITATION_FOR_INITIAL_ROLLOUT

- M2 Google refresh lease
- M4 rule execution lease
- M5 Drive保存前のprocessed email予約
- M6 atomic quota reservation
- M8 notification outbox
- M9 stale run recovery

これらは逐次Preview smokeの合格範囲を超える並行実行・障害回復上の制約である。初期rolloutでは下記の運用制約と監視を必須とし、別phaseで解消する。

### D. OUT_OF_SCOPE_SEPARATE_PHASE

- M3 Stripe event ordering
- M7 Checkout idempotency
- OAuth state DB ledgerによる厳密なsingle-use
- Cronの`select("*")`解消

## 17. Preview smoke実績（2026-08-04）

- Productionとは別のSupabase Preview project、Google Cloud project、OAuth client、Vercel Preview envを使用し、Productionは変更していない
- Google OAuth接続に成功し、connectionは`status=connected`、`credential_version=0`、`reauth_required=false`。token fieldsは暗号化済み
- profileのdisplay name更新に成功し、Supabaseへの反映を確認した
- 初回manual Runは成功し、`processed_count=1`、`saved_count=1`、`skipped_count=0`。Drive PDFは1件、`processed_emails`は1件
- 同一メール・同一ruleの逐次2回目も成功し、`processed_count=0`、`saved_count=0`、`skipped_count=1`
- 2回目後もDrive PDFは1件、`processed_emails`は1件のままで、重複保存・重複DB rowはない
- success runはいずれも`error_code=NULL`で、runs、processed_emails、Drive保存結果の整合を確認した

このsmokeは逐次実行の成功と冪等性を確認したものであり、同一ruleの並行実行、同時token refresh、process停止後のrecoveryを保証しない。

## 18. 条件付きProduction rollout制約

- Cron停止状態から開始し、Bearer credentialとVercel Cron設定の切替完了後にだけ有効化する
- manual Runの並行実行を避け、二重クリック、複数tab、同一ruleへの並行API呼出しを行わない
- credential conflict、Drive/processed email duplicate、stale `running`を監視する
- 異常時にCronを停止し、manual RunとOAuth token writeを停止できる運用手順を用意する
- migration、env、credential rotation、deployment、smoke、rollbackは順番に別承認する
- rollbackはapplicationを既知のanchor SHAへ戻し、expand済みの非破壊的DB列・tableは原則残置する。破壊的rollback SQLは別承認とする

scoped branchの検証合格後はmain mergeを承認可能とするが、Production deploymentは上記B項目とrollout手順の承認・完了まで実施しない。
