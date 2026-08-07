# Production schema reconciliation inventory

Inventory date: 2026-08-07. This document contains catalog metadata and
aggregate preflight results only. It contains no Production row identifiers,
email addresses, tokens, ciphertext, secrets, or business data.

## Scope and fixed anchors

- Supabase project: `AutoPDF` (`dcbfgwvcwjxbxuwtfcnm`, Tokyo)
- Live application commit before rollout: `850603a...`
- Staged application commit: `a441b5e...`
- Production migration ledger: absent/empty
- Repository reconciliation SQL:
  `20260807064701_reconcile_production_core_security.sql`
- The baseline migration is Preview-only and must never execute on Production.

## Production catalog inventory

All seven tables are owned by `postgres`, have RLS enabled, and do not force
RLS. `auth.users` exists and is the ownership parent where a foreign key is
present.

Defaults below are catalog-normalized expressions. `null` means nullable.

### `google_connections`

Columns:

| Column                        | Type        | Null | Default             |
| ----------------------------- | ----------- | ---- | ------------------- |
| id                            | uuid        | no   | `gen_random_uuid()` |
| user_id                       | uuid        | no   | —                   |
| status                        | text        | no   | `'connected'`       |
| scopes                        | text        | yes  | —                   |
| access_token_enc              | text        | yes  | —                   |
| refresh_token_enc             | text        | yes  | —                   |
| token_expiry_at               | timestamptz | yes  | —                   |
| last_verified_at              | timestamptz | yes  | —                   |
| created_at                    | timestamptz | no   | `now()`             |
| updated_at                    | timestamptz | no   | `now()`             |
| last_success_at               | timestamptz | yes  | —                   |
| last_error_at                 | timestamptz | yes  | —                   |
| last_error_code               | text        | yes  | —                   |
| reauth_required               | boolean     | no   | `false`             |
| last_user_notified_at         | timestamptz | yes  | —                   |
| last_user_notified_error_code | text        | yes  | —                   |

Constraints/indexes: primary key `google_connections_pkey`, unique
`google_connections_user_id_key`, and cascading `user_id -> auth.users.id`
foreign key. There are no non-constraint indexes. `credential_version` and its
CHECK constraint are absent.

Policies: insert/select/update own-row policies, currently granted to `PUBLIC`;
the update policy has no `WITH CHECK`. Grants: table `ALL` to `anon`,
`authenticated`, and `service_role`. No trigger.

### `rules`

Columns:

| Column               | Type        | Null | Default                  |
| -------------------- | ----------- | ---- | ------------------------ |
| id                   | uuid        | no   | `gen_random_uuid()`      |
| user_id              | uuid        | no   | —                        |
| is_enabled           | boolean     | no   | `false`                  |
| gmail_label_id       | text        | yes  | —                        |
| unread_only          | boolean     | no   | `true`                   |
| lookback_days        | integer     | yes  | —                        |
| drive_folder_id      | text        | no   | —                        |
| subfolder_mode       | text        | no   | `'none'`                 |
| filename_mode        | text        | no   | `'date_subject'`         |
| run_mode             | text        | no   | `'auto_daily'`           |
| consecutive_failures | integer     | no   | `0`                      |
| auto_disabled_at     | timestamptz | yes  | —                        |
| created_at           | timestamptz | no   | `now()`                  |
| updated_at           | timestamptz | no   | `now()`                  |
| subject_keywords     | text        | yes  | —                        |
| gmail_query          | text        | yes  | —                        |
| file_name_format     | text        | yes  | `'date_subject'`         |
| filename_template    | text        | yes  | `'{date}_{subject}.pdf'` |
| is_active            | boolean     | yes  | `true`                   |
| run_timing           | text        | yes  | `'manual'`               |
| run_count            | integer     | yes  | `0`                      |
| query_label          | text        | yes  | —                        |

Constraints/indexes: primary key plus Production-specific
`lookback_days_allowed` (`NULL`, 7, or 30). The `user_id` foreign key,
nonnegative counter checks, and `rules_user_created_idx` are absent.

Policies: two same-command own-row policy names for each of DELETE, INSERT,
SELECT, and UPDATE (eight total), all currently granted to `PUBLIC`; one update
policy has no `WITH CHECK`. Grants: table `ALL` to `anon`, `authenticated`, and
`service_role`.

Triggers: three distinct BEFORE UPDATE triggers are present and must be
preserved: `set_updated_at_on_rules` calls extension function `moddatetime`,
while `trg_rules_set_updated_at` and `trg_set_updated_at` call
`public.set_updated_at`. All set the same `updated_at` value.

### `runs`

Columns:

| Column          | Type        | Null | Default             |
| --------------- | ----------- | ---- | ------------------- |
| id              | uuid        | no   | `gen_random_uuid()` |
| user_id         | uuid        | yes  | —                   |
| rule_id         | uuid        | no   | —                   |
| trigger         | text        | no   | —                   |
| status          | text        | no   | —                   |
| started_at      | timestamptz | no   | `now()`             |
| finished_at     | timestamptz | yes  | —                   |
| processed_count | integer     | no   | `0`                 |
| saved_count     | integer     | no   | `0`                 |
| drive_folder_id | text        | yes  | —                   |
| message         | text        | yes  | —                   |
| error_code      | text        | yes  | —                   |
| updated_at      | timestamptz | yes  | `now()`             |
| skipped_count   | integer     | no   | `0`                 |

Constraints/indexes: primary key, cascading `rule_id` foreign key, and
Production-specific `runs_status_check` (`running`, `success`, `error`). Three
repository-compatible status/user/rule time indexes exist. Nonnegative counter
checks are absent; `user_id` is nullable and has no direct foreign key.

Policies: authenticated insert/update and a PUBLIC select policy, all own-row.
Grants: table `ALL` to `anon`, `authenticated`, and `service_role`. Trigger
`trigger_update_runs_updated_at` calls `public.update_runs_updated_at`.

### `processed_emails`

Columns:

| Column              | Type        | Null | Default             |
| ------------------- | ----------- | ---- | ------------------- |
| id                  | uuid        | no   | `gen_random_uuid()` |
| user_id             | uuid        | no   | —                   |
| rule_id             | uuid        | no   | —                   |
| gmail_message_id    | text        | no   | —                   |
| created_at          | timestamptz | no   | `now()`             |
| drive_file_id       | text        | yes  | —                   |
| drive_web_view_link | text        | yes  | —                   |
| saved_at            | timestamptz | yes  | —                   |
| drive_file_name     | text        | yes  | —                   |

Constraints/indexes: primary key and cascading `rule_id` foreign key. Unique
index `processed_emails_rule_msg_uniq` enforces the idempotency key but is not
attached as a named table constraint. User/rule indexes exist; the
user/saved-at index and `user_id` foreign key are absent.

Policy: one PUBLIC own-row select policy. Grants: table `ALL` to `anon`,
`authenticated`, and `service_role`. No trigger.

### `user_profiles`

Columns:

| Column                  | Type        | Null | Default             |
| ----------------------- | ----------- | ---- | ------------------- |
| id                      | uuid        | no   | `gen_random_uuid()` |
| user_id                 | uuid        | no   | —                   |
| display_name            | text        | yes  | —                   |
| company_name            | text        | yes  | —                   |
| industry                | text        | yes  | —                   |
| employee_size           | text        | yes  | —                   |
| marketing_opt_in        | boolean     | no   | `false`             |
| created_at              | timestamptz | no   | `now()`             |
| updated_at              | timestamptz | no   | `now()`             |
| plan                    | text        | no   | `'free'`            |
| billing_provider        | text        | yes  | —                   |
| billing_customer_id     | text        | yes  | —                   |
| billing_subscription_id | text        | yes  | —                   |
| billing_status          | text        | yes  | —                   |
| current_period_end      | timestamptz | yes  | —                   |
| plan_updated_at         | timestamptz | yes  | —                   |
| cancel_at_period_end    | boolean     | yes  | `false`             |

Constraints/indexes: primary key, unique user, cascading user foreign key,
user index, plus Production plan, billing-provider, and billing-status checks.
The Production plan check currently permits `free` and `pro`.

Policies: PUBLIC own-row DELETE/INSERT/SELECT/UPDATE policies. Grants: table
`ALL` to `anon`, `authenticated`, and `service_role`. Trigger
`trg_user_profiles_updated_at` calls `public.set_updated_at`.

### `ai_usage_logs`

Columns:

| Column             | Type          | Null | Default             |
| ------------------ | ------------- | ---- | ------------------- |
| id                 | uuid          | no   | `gen_random_uuid()` |
| user_id            | uuid          | no   | —                   |
| rule_id            | uuid          | yes  | —                   |
| run_id             | uuid          | yes  | —                   |
| feature            | text          | no   | —                   |
| provider           | text          | no   | `'openai'`          |
| model              | text          | no   | —                   |
| input_tokens       | integer       | no   | `0`                 |
| output_tokens      | integer       | no   | `0`                 |
| total_tokens       | integer       | no   | `0`                 |
| estimated_cost_usd | numeric(10,6) | yes  | —                   |
| status             | text          | no   | `'success'`         |
| error_code         | text          | yes  | —                   |
| created_at         | timestamptz   | no   | `now()`             |

Primary key and the three expected feature/run/user indexes exist. There are no
foreign keys. Authenticated insert/select own-row policies exist. Only
`service_role` currently has table `ALL`.

### Functions, auth dependency, extensions, and grants

- `auth.users` has one non-internal AFTER INSERT trigger,
  `on_auth_user_created_create_profile`.
- It calls `public.handle_new_user_create_profile`, a `SECURITY DEFINER`
  function that inserts only `user_profiles.user_id` with conflict-ignore.
- The signup function has no fixed search path and is executable by
  `PUBLIC`/`anon`/`authenticated`/`service_role`.
- `public.set_updated_at` and `public.update_runs_updated_at` are invoker
  trigger functions that assign `now()`; both are broadly executable.
- `moddatetime` and `pgcrypto` extensions exist in `public`/`extensions` as
  currently installed. Reconciliation does not remove either extension.
- Existing table and column grants are cataloged by the anonymous fixture;
  reconciliation revokes broad grants and restores the repository's
  least-privilege hardening contract.
- Function owners, language, security mode, return type, allowed body semantics,
  search-path settings, ACL principals, and extension provenance are checked
  fail-closed. Raw function source is not hashed because dump whitespace and
  dollar-quote formatting are not stable metadata.
- The only Supabase-managed ACL exception is the exact legacy EXECUTE ACL on
  the zero-argument `public.moddatetime()` extension function. It must contain
  exactly one non-grantable entry, granted by `supabase_admin`, for each of
  `PUBLIC`, `anon`, `authenticated`, `postgres`, `service_role`, and the owner
  `supabase_admin`. Its C language, trigger return type, SECURITY INVOKER mode,
  signature, owner, and extension membership must also match. The migration
  preserves this ACL because its Production execution role does not own the
  extension function. The explicit `postgres` entry preserves maintenance-role
  trigger recreation even if inherited application-role grants are later
  narrowed. Any extra principal, different grantor, grant option, or reuse of
  `supabase_admin` on another function fails before DDL.
- Table and column privileges, including principals and grantability, are also
  fingerprinted; an unknown grantee stops reconciliation before DDL.

## Drift classification

| Difference                                                                                     | Class                               | Decision                                                               |
| ---------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Core tables, PKs, core columns, RLS enabled                                                    | A — ALREADY_EQUIVALENT              | Preserve                                                               |
| AI usage table and three indexes                                                               | A                                   | Preserve; history-only candidate                                       |
| Idempotency unique index                                                                       | A                                   | Attach existing index as constraint; do not rebuild                    |
| Missing rule/processed owner FKs                                                               | B — SAFE_TO_ADD                     | Add NOT VALID, then validate after orphan preflight                    |
| Missing counter checks                                                                         | B                                   | Add NOT VALID, then validate after negative-value preflight            |
| Missing two lookup indexes                                                                     | B                                   | Add with bounded transaction/lock                                      |
| Broad grants and PUBLIC policy roles                                                           | C — SAFE_TO_TIGHTEN                 | Revoke and restore repository least privilege; alter policies in place |
| Signup function exposure/search path                                                           | C                                   | Move function to `private`, replace only its body, revoke execute      |
| `runs.user_id` nullable                                                                        | D — REQUIRES_DATA_PREFLIGHT         | Set NOT NULL only after aggregate null/orphan preflight                |
| Existing rule/check defaults and billing checks                                                | E — MUST_PRESERVE_PRODUCTION_OBJECT | No drop or rewrite in reconciliation                                   |
| Duplicate rule triggers and Production policy names                                            | E                                   | Preserve names and objects; narrow access only                         |
| `ai_usage_logs.numeric(10,6)` versus repository `numeric`                                      | E                                   | Preserve; runtime writes remain compatible                             |
| Any catalog fingerprint, object name, owner, RLS, or data preflight mismatch at execution time | F — UNKNOWN_STOP                    | Abort before DDL and re-inventory                                      |

Replay accepts only the cataloged reconciled column fingerprints, with or
without the separately applied `credential_version` migration. Additional,
missing, or reshaped columns stop before reconciliation DDL.

Read-only aggregate preflights found zero NULL run owners, negative counters,
ownership/rule orphans, and duplicate processed-email keys. All current rule
rows have NULL `lookback_days`; this is valid under the Production-specific
check. These are observations, not persisted fixture data, and must be repeated
inside the write transaction.

## Migration decisions

1. `20260530090000_harden_autopdf_core_security.sql` is not reusable on the
   legacy Production schema. Its exact preflight rejects the Production column,
   constraint, policy, and trigger fingerprints. It also intentionally replaces
   policies/triggers, which conflicts with the preservation requirement here.
2. A Production-specific reconciliation migration is required. The existing
   hardening file remains unchanged for fresh databases.
3. Baseline, AI usage, and hardening can become history-only entries only after
   reconciliation has applied and its postconditions pass. Baseline is a
   logical adoption anchor because all core tables/required columns already
   exist; its own SQL must never run. AI usage is an adoption anchor because the
   table, PK, RLS, policies, grants, and three indexes exist, with the compatible
   Production numeric typemod preserved. Hardening is a superseded-effect entry:
   reconciliation must first establish its security/grant contract.
4. The reconciliation version is marked applied only after the exact reviewed
   file was executed successfully out-of-band and postconditions were checked.
5. `20260726090000_add_google_credential_version.sql` is not history-only. It is
   the only real repository migration that remains pending after ledger repair.

## Approved-order blueprint

Each numbered write step requires its own explicit rollout approval unless an
approval explicitly covers the complete atomic phase.

1. Re-run the read-only fingerprints and aggregate preflights. A mismatch stops.
2. Execute the exact reconciliation SQL once. It runs in one transaction with
   5-second lock and 120-second statement timeouts. A failed preflight or
   postcondition rolls back the entire transaction.
3. Read-only verify table data counts/checksums selected for the approved run,
   RLS, grants, policies, triggers, functions, constraints, and indexes.
4. Repair migration history as applied for baseline, AI usage, hardening, and
   reconciliation. Do not mark the credential migration applied.
5. Run migration dry-run with `--include-all`; it must report only
   `20260726090000_add_google_credential_version.sql` pending.
6. Apply the credential migration in its own approved phase. Its preconditions
   are: reconciliation postconditions pass, keyring/current key ID are present,
   old decrypt keys remain available, and token writes remain interlocked until
   application and schema are compatible.
7. Only after DB and environment gates pass may the staged application be
   promoted. Cron rotation/authentication and enablement remain separate rollout
   gates.

Rollback before commit is automatic transaction rollback. After a successful
DDL commit, rollback is application-level: keep the old live deployment/domain
anchor, do not promote staged code, and diagnose forward. The reconciliation
intentionally contains no destructive reverse migration.

## Verification boundary

`tests/fixtures/production-core-schema.sql` is an anonymous structural fixture.
The migration contract suite statically verifies fail-closed fingerprints,
ordering, no destructive SQL, preservation, grants, credential separation, and
postconditions.

The migration and fixture were also verified on disposable PostgreSQL 17.6:

- Production-like fixture apply, reconciliation apply, and replay succeeded.
- Replay preserved the complete schema dump hash and all anonymous row hashes.
- Orphan, negative counter, duplicate key, unknown constraint, trigger, policy,
  grant principal, and column-drift cases all failed with no metadata or data
  change.
- A conflicting table lock failed after the configured five-second lock
  timeout, rolled back, and left no idle transaction.
- The fresh repository migration chain and the post-reconciliation credential
  migration both succeeded.
- Local ledger simulation left only the credential migration pending after the
  four history-equivalent versions were recorded.

Production execution must still repeat the fingerprint and aggregate
preflights immediately before DDL; local verification is not a substitute for
that gate.
