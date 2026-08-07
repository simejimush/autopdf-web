-- AutoPDF one-time Production reconciliation and fresh-chain compatibility check.
--
-- Production rollout contract:
-- 1. Execute this exact file once against the legacy Production schema before
--    adopting repository migration history.
-- 2. Verify the postconditions, then mark the baseline, AI usage, hardening,
--    and this reconciliation version as applied in one separately approved
--    migration-history repair.
-- 3. Apply the still-pending credential_version migration separately.
--
-- Fresh databases reach this migration after baseline, AI usage, hardening,
-- and credential_version. That already-hardened shape is accepted and replayed
-- without changing table data.
--
-- This migration intentionally preserves known Production business defaults,
-- CHECK constraints, policy names, and updated_at triggers. It never recreates
-- a table and never inserts, updates, deletes, or copies application rows.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

lock table
  public.google_connections,
  public.rules,
  public.runs,
  public.processed_emails,
  public.user_profiles,
  public.ai_usage_logs
in share row exclusive mode;

do $reconciliation_preflight$
declare
  target_tables constant text[] := array[
    'google_connections', 'rules', 'runs', 'processed_emails',
    'user_profiles', 'ai_usage_logs'
  ]::text[];
  columns_hash text;
  constraints_hash text;
  indexes_hash text;
  policies_hash text;
  triggers_hash text;
  grants_hash text;
  function_source text;
  function_owner text;
  function_language text;
  function_return_type text;
  function_security_definer boolean;
  function_config text[];
  function_identity_arguments text;
  signup_function regprocedure;
  credential_attnum smallint;
  credential_type text;
  credential_not_null boolean;
  credential_default text;
  credential_constraint_count integer;
  unexpected text[];
begin
  if to_regclass('auth.users') is null then
    raise exception 'AutoPDF reconciliation requires auth.users';
  end if;

  select array_agg(name order by name)
    into unexpected
  from unnest(target_tables) as required(name)
  where to_regclass(format('public.%I', required.name)) is null;
  if unexpected is not null then
    raise exception 'AutoPDF reconciliation missing required tables: %',
      pg_catalog.array_to_string(unexpected, ', ');
  end if;

  select array_agg(c.relname order by c.relname)
    into unexpected
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any (target_tables)
    and (
      c.relkind not in ('r', 'p')
      or pg_catalog.pg_get_userbyid(c.relowner) <> 'postgres'
      or not c.relrowsecurity
      or c.relforcerowsecurity
    );
  if unexpected is not null then
    raise exception 'Unexpected AutoPDF table owner, kind, or RLS state: %',
      pg_catalog.array_to_string(unexpected, ', ');
  end if;

  select pg_catalog.md5(pg_catalog.string_agg(
           format('%s.%s:%s:%s:%s', c.relname, a.attname,
             pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
             coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')),
           '|' order by c.relname, a.attnum))
    into columns_hash
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a
    on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public' and c.relname = any (target_tables);

  select pg_catalog.md5(pg_catalog.string_agg(
           format('%s.%s:%s:%s:%s', c.relname, x.conname, x.contype,
             x.convalidated, pg_catalog.pg_get_constraintdef(x.oid, false)),
           '|' order by c.relname, x.conname))
    into constraints_hash
  from pg_catalog.pg_constraint x
  join pg_catalog.pg_class c on c.oid = x.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any (target_tables);

  select pg_catalog.md5(pg_catalog.string_agg(
           format('%s.%s:%s', tablename, indexname, indexdef),
           '|' order by tablename, indexname))
    into indexes_hash
  from pg_catalog.pg_indexes
  where schemaname = 'public' and tablename = any (target_tables);

  select pg_catalog.md5(pg_catalog.string_agg(
           format('%s.%s:%s:%s:%s:%s:%s', tablename, policyname,
             permissive, pg_catalog.array_to_string(roles, ','), cmd,
             coalesce(qual, ''), coalesce(with_check, '')),
           '|' order by tablename, policyname))
    into policies_hash
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = any (target_tables);

  select pg_catalog.md5(pg_catalog.string_agg(
           format('%s.%s:%s:%s.%s:%s', n.nspname, c.relname, t.tgname,
             pn.nspname, p.proname,
             pg_catalog.pg_get_triggerdef(t.oid, true)),
           '|' order by n.nspname, c.relname, t.tgname))
    into triggers_hash
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
  where not t.tgisinternal
    and ((n.nspname = 'public' and c.relname = any (target_tables))
      or (n.nspname = 'auth' and c.relname = 'users'));

  with grants as (
    select 'table'::text as kind, table_schema, table_name,
           ''::text as column_name, grantee, privilege_type, is_grantable
    from information_schema.table_privileges
    where table_schema = 'public' and table_name = any (target_tables)
    union all
    select 'column', table_schema, table_name, column_name,
           grantee, privilege_type, is_grantable
    from information_schema.column_privileges
    where table_schema = 'public' and table_name = any (target_tables)
  )
  select pg_catalog.md5(pg_catalog.string_agg(
           format('%s:%s.%s.%s:%s:%s:%s', kind, table_schema, table_name,
             column_name, grantee, privilege_type, is_grantable),
           '|' order by kind, table_schema, table_name, column_name,
             grantee, privilege_type, is_grantable))
    into grants_hash
  from grants;

  -- The hashes contain metadata only. They pin the read-only Production
  -- inventory captured on 2026-08-07 and prevent guessed cleanup on drift.
  if columns_hash = 'be7359073eb586a78719707797669451'
    and constraints_hash = 'a4931778b3b93138c17390f78fc12211'
    and indexes_hash = 'd8e362a16b3ffbbc83875466e018e1b7'
    and policies_hash = 'ced70ec501e6ab1f5a18c5d76544e65f'
    and triggers_hash = '1c9a5348a4a425a82b25502008a6bc90'
    and grants_hash = '96f8298e5ea506cb9b5704668171d627'
  then
    perform pg_catalog.set_config('autopdf.reconciliation_shape', 'legacy', true);
  elsif columns_hash = 'a5103a6e78330392062e4237db29457f'
    and constraints_hash = '9c9ce0dc61feae565fad9181be673b00'
    and indexes_hash = '318ff7fe95549e85ca43d48978fcad3e'
    and policies_hash = 'af84373b43e48e0e8bc37a1fbbd7f9c7'
    and triggers_hash = 'ea43b3b4c701e1b930d8d2339f9e5181'
    and grants_hash = '5606b97859f237247b9f8ff59406c8b5'
  then
    -- Read-only fingerprint of the repository migration chain in Preview.
    perform pg_catalog.set_config('autopdf.reconciliation_shape', 'fresh', true);
  else
    -- Replay and fresh-chain paths must already have every reconciliation
    -- postcondition. A later block performs the complete assertion again.
    if columns_hash not in (
        '516febf044addbb583fa455bf7297200',
        '6840235007827fb50fa25d30c6b4a23a',
        'a5103a6e78330392062e4237db29457f'
      )
    then
      raise exception 'Unexpected AutoPDF reconciled column fingerprint';
    end if;

    if to_regprocedure('private.handle_new_user_create_profile()') is null
      or to_regprocedure('public.handle_new_user_create_profile()') is not null
      or exists (
        select 1 from public.runs where user_id is null
      )
      or not exists (
        select 1 from pg_catalog.pg_constraint
        where conrelid = 'public.rules'::regclass
          and conname = 'rules_user_id_fkey' and convalidated
      )
      or not exists (
        select 1 from pg_catalog.pg_constraint
        where conrelid = 'public.processed_emails'::regclass
          and conname = 'processed_emails_user_id_fkey' and convalidated
      )
    then
      raise exception 'Unknown AutoPDF schema; reconciliation fingerprint mismatch';
    end if;

    select array_agg(format('%s.%s', tablename, policyname)
                     order by tablename, policyname)
      into unexpected
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (target_tables)
      and policyname <> all (array[
        'Users can insert own ai usage logs',
        'Users can read own ai usage logs',
        'google_connections_select_own',
        'users_can_insert_own_google_connections',
        'users_can_select_own_google_connections',
        'users_can_update_own_google_connections',
        'processed_emails_select_own',
        'users_can_select_own_processed_emails',
        'delete own rules', 'insert own rules', 'select own rules',
        'update own rules',
        'rules_select_own',
        'users_can_delete_own_rules',
        'users_can_insert_own_rules',
        'users_can_select_own_rules',
        'users_can_update_own_rules',
        'runs_insert_own', 'runs_select_own',
        'users_can_select_own_runs', 'users_can_update_own_runs',
        'user_profiles_delete_own', 'user_profiles_insert_own',
        'user_profiles_select_own', 'user_profiles_update_own'
      ]::text[]);
    if unexpected is not null then
      raise exception 'Unknown AutoPDF policy objects: %',
        pg_catalog.array_to_string(unexpected, ', ');
    end if;

    select array_agg(format('%s.%s', n.nspname, t.tgname)
                     order by n.nspname, t.tgname)
      into unexpected
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and ((n.nspname = 'public' and c.relname = any (target_tables))
        or (n.nspname = 'auth' and c.relname = 'users'))
      and t.tgname <> all (array[
        'on_auth_user_created_create_profile',
        'set_updated_at_on_rules', 'trg_rules_set_updated_at',
        'trg_set_updated_at', 'trigger_update_runs_updated_at',
        'trg_user_profiles_updated_at',
        'rules_set_updated_at', 'runs_set_updated_at',
        'user_profiles_set_updated_at'
      ]::text[]);
    if unexpected is not null then
      raise exception 'Unknown AutoPDF trigger objects: %',
        pg_catalog.array_to_string(unexpected, ', ');
    end if;

    select array_agg(format('%s.%s', c.relname, x.conname)
                     order by c.relname, x.conname)
      into unexpected
    from pg_catalog.pg_constraint x
    join pg_catalog.pg_class c on c.oid = x.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (target_tables)
      and x.conname <> all (array[
        'ai_usage_logs_pkey',
        'google_connections_pkey', 'google_connections_user_id_key',
        'google_connections_user_id_fkey',
        'google_connections_credential_version_nonnegative',
        'rules_pkey', 'rules_user_id_fkey', 'lookback_days_allowed',
        'rules_lookback_days_positive',
        'rules_consecutive_failures_nonnegative',
        'rules_run_count_nonnegative',
        'runs_pkey', 'runs_rule_id_fkey', 'runs_status_check',
        'runs_processed_count_nonnegative', 'runs_saved_count_nonnegative',
        'runs_skipped_count_nonnegative',
        'processed_emails_pkey', 'processed_emails_rule_id_fkey',
        'processed_emails_user_id_fkey', 'processed_emails_rule_msg_uniq',
        'user_profiles_pkey', 'user_profiles_user_id_key',
        'user_profiles_user_id_fkey', 'user_profiles_plan_check',
        'user_profiles_billing_provider_check',
        'user_profiles_billing_status_check'
      ]::text[]);
    if unexpected is not null then
      raise exception 'Unknown AutoPDF constraint objects: %',
        pg_catalog.array_to_string(unexpected, ', ');
    end if;

    select array_agg(format('%s.%s', tablename, indexname)
                     order by tablename, indexname)
      into unexpected
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = any (target_tables)
      and indexname <> all (array[
        'ai_usage_logs_pkey', 'ai_usage_logs_feature_created_idx',
        'ai_usage_logs_run_idx', 'ai_usage_logs_user_created_idx',
        'google_connections_pkey', 'google_connections_user_id_key',
        'rules_pkey', 'rules_user_created_idx',
        'runs_pkey', 'runs_status_updated_at_idx',
        'runs_user_started_idx', 'runs_rule_id_started_at_idx',
        'processed_emails_pkey', 'processed_emails_rule_msg_uniq',
        'processed_emails_user_idx', 'processed_emails_rule_idx',
        'processed_emails_user_saved_idx',
        'user_profiles_pkey', 'user_profiles_user_id_key',
        'user_profiles_user_id_idx'
      ]::text[]);
    if unexpected is not null then
      raise exception 'Unknown AutoPDF index objects: %',
        pg_catalog.array_to_string(unexpected, ', ');
    end if;

    select array_agg(distinct grantee::text order by grantee::text)
      into unexpected
    from (
      select grantee
      from information_schema.table_privileges
      where table_schema = 'public' and table_name = any (target_tables)
      union all
      select grantee
      from information_schema.column_privileges
      where table_schema = 'public' and table_name = any (target_tables)
    ) grants
    where grantee not in (
      'postgres', 'PUBLIC', 'anon', 'authenticated', 'service_role'
    );
    if unexpected is not null then
      raise exception 'Unknown AutoPDF grant principals: %',
        pg_catalog.array_to_string(unexpected, ', ');
    end if;

    perform pg_catalog.set_config('autopdf.reconciliation_shape', 'replay', true);
  end if;

  -- Function source text is not fingerprinted byte-for-byte because harmless
  -- dollar-quote and whitespace differences are not stable across dumps.
  -- Validate the security-relevant semantics before replacing or preserving
  -- any function instead.
  if to_regprocedure('public.handle_new_user_create_profile()') is not null
    and to_regprocedure('private.handle_new_user_create_profile()') is not null
  then
    raise exception 'Duplicate signup functions block AutoPDF reconciliation';
  end if;
  signup_function := coalesce(
    to_regprocedure('public.handle_new_user_create_profile()'),
    to_regprocedure('private.handle_new_user_create_profile()')
  );
  if signup_function is null then
    raise exception 'Missing signup profile function';
  end if;

  select p.prosrc,
         pg_catalog.pg_get_userbyid(p.proowner), l.lanname,
         pg_catalog.format_type(p.prorettype, null), p.prosecdef, p.proconfig
    into function_source, function_owner, function_language,
         function_return_type, function_security_definer, function_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = signup_function;
  if function_owner <> 'postgres'
    or function_language <> 'plpgsql'
    or function_return_type <> 'trigger'
    or not function_security_definer
    or lower(regexp_replace(function_source, '[[:space:]]', '', 'g'))
      <> 'begininsertintopublic.user_profiles(user_id)values(new.id)onconflict(user_id)donothing;returnnew;end;'
    or (signup_function = to_regprocedure('public.handle_new_user_create_profile()')
        and function_config is not null)
    or (signup_function = to_regprocedure('private.handle_new_user_create_profile()')
        and coalesce(function_config, array[]::text[])
          <> array['search_path=""']::text[])
  then
    raise exception 'Unexpected signup profile function semantics';
  end if;

  select p.prosrc,
         pg_catalog.pg_get_userbyid(p.proowner), l.lanname,
         pg_catalog.format_type(p.prorettype, null), p.prosecdef, p.proconfig
    into function_source, function_owner, function_language,
         function_return_type, function_security_definer, function_config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = to_regprocedure('public.set_updated_at()');
  if not found
    or function_owner <> 'postgres'
    or function_language <> 'plpgsql'
    or function_return_type <> 'trigger'
    or function_security_definer
    or lower(regexp_replace(function_source, '[[:space:]]', '', 'g')) not in (
      'beginnew.updated_at=now();returnnew;end;',
      'beginnew.updated_at:=now();returnnew;end;',
      'beginnew.updated_at=pg_catalog.now();returnnew;end;',
      'beginnew.updated_at:=pg_catalog.now();returnnew;end;'
    )
  then
    raise exception 'Unexpected set_updated_at function semantics';
  end if;

  if to_regprocedure('public.update_runs_updated_at()') is not null then
    select p.prosrc, pg_catalog.pg_get_userbyid(p.proowner), l.lanname,
           pg_catalog.format_type(p.prorettype, null), p.prosecdef
      into function_source, function_owner, function_language,
           function_return_type, function_security_definer
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = 'public.update_runs_updated_at()'::regprocedure;
    if function_owner <> 'postgres'
      or function_language <> 'plpgsql'
      or function_return_type <> 'trigger'
      or function_security_definer
      or lower(regexp_replace(function_source, '[[:space:]]', '', 'g')) not in (
        'beginnew.updated_at=now();returnnew;end;',
        'beginnew.updated_at:=now();returnnew;end;',
        'beginnew.updated_at=pg_catalog.now();returnnew;end;',
        'beginnew.updated_at:=pg_catalog.now();returnnew;end;'
      )
    then
      raise exception 'Unexpected runs updated_at function semantics';
    end if;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moddatetime'
  ) then
    select pg_catalog.pg_get_userbyid(p.proowner), l.lanname,
           pg_catalog.format_type(p.prorettype, null), p.prosecdef,
           pg_catalog.pg_get_function_identity_arguments(p.oid)
      into function_owner, function_language, function_return_type,
           function_security_definer, function_identity_arguments
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join pg_catalog.pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.proname = 'moddatetime';

    if not found
      or to_regprocedure('public.moddatetime()') is null
      or function_identity_arguments <> ''
      or function_owner not in ('postgres', 'supabase_admin')
      or function_language <> 'c'
      or function_return_type <> 'trigger'
      or function_security_definer
      or (
        select count(*)
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'moddatetime'
      ) <> 1
    then
      raise exception 'Unexpected moddatetime function identity or security';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_depend d
      join pg_catalog.pg_extension e on e.oid = d.refobjid
      where d.classid = 'pg_catalog.pg_proc'::regclass
        and d.objid = to_regprocedure('public.moddatetime()')
        and d.refclassid = 'pg_catalog.pg_extension'::regclass
        and d.deptype = 'e' and e.extname = 'moddatetime'
    ) then
      raise exception 'Unexpected moddatetime function provenance';
    end if;
  end if;

  select array_agg(distinct coalesce(r.rolname, 'PUBLIC') order by
                     coalesce(r.rolname, 'PUBLIC'))
    into unexpected
  from pg_catalog.pg_proc p
  cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) acl
  left join pg_catalog.pg_roles r on r.oid = acl.grantee
  where p.oid in (
      signup_function,
      'public.set_updated_at()'::regprocedure,
      to_regprocedure('public.update_runs_updated_at()'),
      to_regprocedure('public.moddatetime()')
    )
    and not (
      (
        p.oid <> to_regprocedure('public.moddatetime()')
        and coalesce(r.rolname, 'PUBLIC') in (
          'postgres', 'PUBLIC', 'anon', 'authenticated', 'service_role'
        )
      )
      or (
        p.oid = to_regprocedure('public.moddatetime()')
        and coalesce(r.rolname, 'PUBLIC') =
          pg_catalog.pg_get_userbyid(p.proowner)
        and coalesce(r.rolname, 'PUBLIC') in ('postgres', 'supabase_admin')
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
      )
    );
  if unexpected is not null then
    raise exception 'Unknown AutoPDF function grant principals: %',
      pg_catalog.array_to_string(unexpected, ', ');
  end if;

  if exists (select 1 from public.runs where user_id is null)
    or exists (
      select 1 from public.rules r
      left join auth.users u on u.id = r.user_id
      where u.id is null
    )
    or exists (
      select 1 from public.processed_emails p
      left join auth.users u on u.id = p.user_id
      where u.id is null
    )
    or exists (
      select 1 from public.runs r
      left join auth.users u on u.id = r.user_id
      where r.user_id is not null and u.id is null
    )
    or exists (
      select 1 from public.processed_emails p
      left join public.rules r on r.id = p.rule_id
      where r.id is null
    )
    or exists (
      select 1 from public.runs x
      left join public.rules r on r.id = x.rule_id
      where r.id is null
    )
  then
    raise exception 'AutoPDF reconciliation refuses NULL or orphaned ownership';
  end if;

  if exists (select 1 from public.rules where consecutive_failures < 0)
    or exists (select 1 from public.rules where run_count < 0)
    or exists (select 1 from public.runs where processed_count < 0)
    or exists (select 1 from public.runs where saved_count < 0)
    or exists (select 1 from public.runs where skipped_count < 0)
  then
    raise exception 'AutoPDF reconciliation refuses negative counters';
  end if;

  if exists (
    select 1 from public.processed_emails
    group by rule_id, gmail_message_id having count(*) > 1
  ) then
    raise exception 'AutoPDF reconciliation refuses duplicate processed email keys';
  end if;

  select a.attnum, pg_catalog.format_type(a.atttypid, a.atttypmod),
         a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    into credential_attnum, credential_type, credential_not_null,
         credential_default
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.google_connections'::regclass
    and a.attname = 'credential_version' and not a.attisdropped;

  if credential_attnum is not null then
    select count(*) into credential_constraint_count
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.google_connections'::regclass
      and c.conname = 'google_connections_credential_version_nonnegative'
      and c.contype = 'c' and c.convalidated
      and c.conkey = array[credential_attnum]::smallint[]
      and regexp_replace(pg_catalog.pg_get_expr(c.conbin, c.conrelid),
            '[()[:space:]]', '', 'g') = 'credential_version>=0';

    if credential_type <> 'bigint'
      or not credential_not_null
      or regexp_replace(coalesce(credential_default, ''),
           '[()[:space:]'']', '', 'g') not in ('0', '0::bigint')
      or credential_constraint_count <> 1
      or exists (select 1 from public.google_connections where credential_version < 0)
    then
      raise exception 'Unexpected google credential version shape';
    end if;
  elsif exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.google_connections'::regclass
      and conname = 'google_connections_credential_version_nonnegative'
  ) then
    raise exception 'Orphaned google credential version constraint';
  end if;
end
$reconciliation_preflight$;

-- Add only missing ownership and audit constraints. Known Production CHECK
-- constraints remain in place and are never dropped or weakened.
do $add_missing_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rules'::regclass
      and conname = 'rules_user_id_fkey'
  ) then
    alter table public.rules
      add constraint rules_user_id_fkey
      foreign key (user_id) references auth.users (id)
      on delete cascade not valid;
    alter table public.rules validate constraint rules_user_id_fkey;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.processed_emails'::regclass
      and conname = 'processed_emails_user_id_fkey'
  ) then
    alter table public.processed_emails
      add constraint processed_emails_user_id_fkey
      foreign key (user_id) references auth.users (id)
      on delete cascade not valid;
    alter table public.processed_emails
      validate constraint processed_emails_user_id_fkey;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.processed_emails'::regclass
      and conname = 'processed_emails_rule_msg_uniq'
  ) then
    alter table public.processed_emails
      add constraint processed_emails_rule_msg_uniq
      unique using index processed_emails_rule_msg_uniq;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rules'::regclass
      and conname = 'rules_consecutive_failures_nonnegative'
  ) then
    alter table public.rules
      add constraint rules_consecutive_failures_nonnegative
      check (consecutive_failures >= 0) not valid;
    alter table public.rules
      validate constraint rules_consecutive_failures_nonnegative;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.rules'::regclass
      and conname = 'rules_run_count_nonnegative'
  ) then
    alter table public.rules
      add constraint rules_run_count_nonnegative
      check (run_count >= 0) not valid;
    alter table public.rules validate constraint rules_run_count_nonnegative;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.runs'::regclass
      and conname = 'runs_processed_count_nonnegative'
  ) then
    alter table public.runs
      add constraint runs_processed_count_nonnegative
      check (processed_count >= 0) not valid;
    alter table public.runs validate constraint runs_processed_count_nonnegative;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.runs'::regclass
      and conname = 'runs_saved_count_nonnegative'
  ) then
    alter table public.runs
      add constraint runs_saved_count_nonnegative
      check (saved_count >= 0) not valid;
    alter table public.runs validate constraint runs_saved_count_nonnegative;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.runs'::regclass
      and conname = 'runs_skipped_count_nonnegative'
  ) then
    alter table public.runs
      add constraint runs_skipped_count_nonnegative
      check (skipped_count >= 0) not valid;
    alter table public.runs validate constraint runs_skipped_count_nonnegative;
  end if;
end
$add_missing_constraints$;

do $add_missing_indexes$
begin
  if to_regclass('public.rules_user_created_idx') is null then
    create index rules_user_created_idx
      on public.rules (user_id, created_at desc);
  end if;
  if to_regclass('public.processed_emails_user_saved_idx') is null then
    create index processed_emails_user_saved_idx
      on public.processed_emails (user_id, saved_at desc);
  end if;
end
$add_missing_indexes$;

alter table public.runs alter column user_id set not null;

create schema if not exists private authorization postgres;
revoke all on schema private from public, anon, authenticated, service_role;

do $move_signup_function$
begin
  if to_regprocedure('public.handle_new_user_create_profile()') is not null then
    if to_regprocedure('private.handle_new_user_create_profile()') is not null then
      raise exception 'Duplicate signup functions block AutoPDF reconciliation';
    end if;
    alter function public.handle_new_user_create_profile() set schema private;
  end if;
end
$move_signup_function$;

create or replace function private.handle_new_user_create_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

alter function private.handle_new_user_create_profile() owner to postgres;
revoke all on function private.handle_new_user_create_profile()
  from public, anon, authenticated, service_role;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$function$;

alter function public.set_updated_at() owner to postgres;
revoke all on function public.set_updated_at()
  from public, anon, authenticated;

do $secure_preserved_trigger_functions$
begin
  if to_regprocedure('public.update_runs_updated_at()') is not null then
    alter function public.update_runs_updated_at() set search_path = '';
    revoke all on function public.update_runs_updated_at()
      from public, anon, authenticated;
  end if;
  if to_regprocedure('public.moddatetime()') is not null then
    revoke all on function public.moddatetime()
      from public, anon, authenticated;
  end if;
end
$secure_preserved_trigger_functions$;

-- Preserve every known Production policy object and name. Narrow all policy
-- roles to authenticated and normalize ownership predicates. Write policies
-- remain inert because authenticated receives no table-level write grants on
-- those tables below.
do $narrow_known_policies$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname, cmd
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'google_connections', 'rules', 'runs', 'processed_emails',
        'user_profiles', 'ai_usage_logs'
      )
  loop
    if policy_row.cmd in ('SELECT', 'DELETE') then
      execute format(
        'alter policy %I on public.%I to authenticated using ((select auth.uid()) = user_id)',
        policy_row.policyname, policy_row.tablename
      );
    elsif policy_row.cmd = 'INSERT' then
      execute format(
        'alter policy %I on public.%I to authenticated with check ((select auth.uid()) = user_id)',
        policy_row.policyname, policy_row.tablename
      );
    elsif policy_row.cmd = 'UPDATE' then
      execute format(
        'alter policy %I on public.%I to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
        policy_row.policyname, policy_row.tablename
      );
    else
      raise exception 'Unknown policy command on %.%',
        policy_row.tablename, policy_row.policyname;
    end if;
  end loop;
end
$narrow_known_policies$;

do $revoke_known_column_grants$
declare
  grant_row record;
begin
  for grant_row in
    select table_schema, table_name, column_name, grantee, privilege_type
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name in (
        'google_connections', 'rules', 'runs', 'processed_emails',
        'user_profiles', 'ai_usage_logs'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  loop
    execute format('revoke %s (%I) on table %I.%I from %I',
      grant_row.privilege_type, grant_row.column_name,
      grant_row.table_schema, grant_row.table_name, grant_row.grantee);
  end loop;
end
$revoke_known_column_grants$;

revoke all on table public.google_connections from public, anon, authenticated, service_role;
revoke all on table public.rules from public, anon, authenticated, service_role;
revoke all on table public.runs from public, anon, authenticated, service_role;
revoke all on table public.processed_emails from public, anon, authenticated, service_role;
revoke all on table public.user_profiles from public, anon, authenticated, service_role;
revoke all on table public.ai_usage_logs from public, anon, authenticated, service_role;

grant select (
  id, user_id, status, scopes, last_verified_at, last_success_at,
  last_error_at, last_error_code, reauth_required, updated_at
) on table public.google_connections to authenticated;
grant select on table public.rules to authenticated;
grant select on table public.runs to authenticated;
grant select on table public.processed_emails to authenticated;
grant select (
  user_id, display_name, company_name, industry, employee_size,
  marketing_opt_in, plan, billing_provider, billing_customer_id,
  billing_subscription_id, billing_status, current_period_end,
  cancel_at_period_end
) on table public.user_profiles to authenticated;
grant insert (user_id) on table public.user_profiles to authenticated;
grant update (
  display_name, company_name, industry, employee_size, marketing_opt_in
) on table public.user_profiles to authenticated;

grant select, insert, update, delete on table public.google_connections to service_role;
grant select, insert, update, delete on table public.rules to service_role;
grant select, insert, update on table public.runs to service_role;
grant select, insert on table public.processed_emails to service_role;
grant select, insert, update on table public.user_profiles to service_role;
grant select, insert on table public.ai_usage_logs to service_role;

do $reconciliation_postcondition$
declare
  bad text[];
  signup_definition text;
  update_definition text;
  missing_policy text[];
begin
  if to_regprocedure('public.handle_new_user_create_profile()') is not null
    or to_regprocedure('private.handle_new_user_create_profile()') is null
  then
    raise exception 'Signup function was not isolated in private schema';
  end if;

  signup_definition := pg_catalog.pg_get_functiondef(
    'private.handle_new_user_create_profile()'::regprocedure
  );
  if signup_definition !~* 'security[[:space:]]+definer'
    or signup_definition !~* 'set[[:space:]]+search_path[[:space:]]+to[[:space:]]+'''''
    or signup_definition !~* 'insert[[:space:]]+into[[:space:]]+public.user_profiles'
    or signup_definition ~* '\m(update|delete|truncate)\M'
  then
    raise exception 'Unexpected private signup function postcondition';
  end if;

  update_definition := pg_catalog.pg_get_functiondef(
    'public.set_updated_at()'::regprocedure
  );
  if update_definition ~* 'security[[:space:]]+definer'
    or update_definition !~* 'set[[:space:]]+search_path[[:space:]]+to[[:space:]]+'''''
    or update_definition !~* 'new.updated_at[[:space:]]*:?=[[:space:]]*pg_catalog.now\(\)'
  then
    raise exception 'Unexpected updated_at function postcondition';
  end if;

  select array_agg(format('%s.%s', tablename, policyname)
                   order by tablename, policyname)
    into bad
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in (
      'google_connections', 'rules', 'runs', 'processed_emails',
      'user_profiles', 'ai_usage_logs'
    )
    and (
      roles <> array['authenticated']::name[]
      or permissive <> 'PERMISSIVE'
      or cmd not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      or (cmd in ('SELECT', 'DELETE') and
          lower(regexp_replace(coalesce(qual, ''), '[()[:space:]]', '', 'g'))
            not in (
              'auth.uid=user_id', 'selectauth.uid=user_id',
              'selectauth.uidasuid=user_id'
            ))
      or (cmd = 'INSERT' and
          lower(regexp_replace(coalesce(with_check, ''), '[()[:space:]]', '', 'g'))
            not in (
              'auth.uid=user_id', 'selectauth.uid=user_id',
              'selectauth.uidasuid=user_id'
            ))
      or (cmd = 'UPDATE' and (
          lower(regexp_replace(coalesce(qual, ''), '[()[:space:]]', '', 'g'))
            not in (
              'auth.uid=user_id', 'selectauth.uid=user_id',
              'selectauth.uidasuid=user_id'
            )
          or lower(regexp_replace(coalesce(with_check, ''), '[()[:space:]]', '', 'g'))
            not in (
              'auth.uid=user_id', 'selectauth.uid=user_id',
              'selectauth.uidasuid=user_id'
            )))
    );
  if bad is not null then
    raise exception 'Unexpected policy postcondition: %',
      pg_catalog.array_to_string(bad, ', ');
  end if;

  select array_agg(format('%s.%s', required.table_name, required.command)
                   order by required.table_name, required.command)
    into missing_policy
  from (values
    ('google_connections', 'SELECT'),
    ('rules', 'SELECT'),
    ('runs', 'SELECT'),
    ('processed_emails', 'SELECT'),
    ('user_profiles', 'SELECT'),
    ('user_profiles', 'INSERT'),
    ('user_profiles', 'UPDATE')
  ) as required(table_name, command)
  where not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = required.table_name
      and p.cmd = required.command
  );
  if missing_policy is not null then
    raise exception 'Missing required RLS policy commands: %',
      pg_catalog.array_to_string(missing_policy, ', ');
  end if;

  if (
    select count(*) from pg_catalog.pg_trigger t
    where not t.tgisinternal
      and t.tgrelid = 'auth.users'::regclass
  ) <> 1 or not exists (
    select 1
    from pg_catalog.pg_trigger t
    where not t.tgisinternal
      and t.tgrelid = 'auth.users'::regclass
      and t.tgname = 'on_auth_user_created_create_profile'
      and t.tgfoid = 'private.handle_new_user_create_profile()'::regprocedure
  ) then
    raise exception 'Unexpected auth.users trigger postcondition';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where not tgisinternal and tgrelid = 'public.rules'::regclass
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where not tgisinternal and tgrelid = 'public.runs'::regclass
  ) or not exists (
    select 1 from pg_catalog.pg_trigger
    where not tgisinternal and tgrelid = 'public.user_profiles'::regclass
  ) then
    raise exception 'Missing preserved updated_at triggers';
  end if;

  if exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public'
      and table_name in (
        'google_connections', 'rules', 'runs', 'processed_emails',
        'user_profiles', 'ai_usage_logs'
      )
      and grantee in ('PUBLIC', 'anon')
  ) then
    raise exception 'PUBLIC or anon retained AutoPDF table privileges';
  end if;

  if exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public'
      and table_name in ('google_connections', 'user_profiles', 'ai_usage_logs')
      and grantee = 'authenticated'
  ) or exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public'
      and table_name in ('rules', 'runs', 'processed_emails')
      and grantee = 'authenticated'
      and privilege_type <> 'SELECT'
  ) then
    raise exception 'Authenticated retained unsafe table privileges';
  end if;

  select array_agg(format('%s.%s', required.table_name, required.privilege_type)
                   order by required.table_name, required.privilege_type)
    into bad
  from (values
    ('google_connections', 'SELECT'), ('google_connections', 'INSERT'),
    ('google_connections', 'UPDATE'), ('google_connections', 'DELETE'),
    ('rules', 'SELECT'), ('rules', 'INSERT'), ('rules', 'UPDATE'),
    ('rules', 'DELETE'),
    ('runs', 'SELECT'), ('runs', 'INSERT'), ('runs', 'UPDATE'),
    ('processed_emails', 'SELECT'), ('processed_emails', 'INSERT'),
    ('user_profiles', 'SELECT'), ('user_profiles', 'INSERT'),
    ('user_profiles', 'UPDATE'),
    ('ai_usage_logs', 'SELECT'), ('ai_usage_logs', 'INSERT')
  ) as required(table_name, privilege_type)
  where not exists (
    select 1 from information_schema.table_privileges p
    where p.table_schema = 'public'
      and p.grantee = 'service_role'
      and p.table_name = required.table_name
      and p.privilege_type = required.privilege_type
  );
  if bad is not null then
    raise exception 'Missing service_role privileges: %',
      pg_catalog.array_to_string(bad, ', ');
  end if;

  if exists (select 1 from public.runs where user_id is null)
    or not (
      select a.attnotnull from pg_catalog.pg_attribute a
      where a.attrelid = 'public.runs'::regclass
        and a.attname = 'user_id' and not a.attisdropped
    )
  then
    raise exception 'runs.user_id postcondition failed';
  end if;

  select array_agg(required.name order by required.name)
    into bad
  from unnest(array[
    'rules_user_id_fkey', 'processed_emails_user_id_fkey',
    'processed_emails_rule_msg_uniq',
    'rules_consecutive_failures_nonnegative', 'rules_run_count_nonnegative',
    'runs_processed_count_nonnegative', 'runs_saved_count_nonnegative',
    'runs_skipped_count_nonnegative'
  ]::text[]) as required(name)
  where not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conname = required.name and c.convalidated
      and c.conrelid in (
        'public.rules'::regclass, 'public.runs'::regclass,
        'public.processed_emails'::regclass
      )
  );
  if bad is not null then
    raise exception 'Missing reconciliation constraints: %',
      pg_catalog.array_to_string(bad, ', ');
  end if;

  if to_regclass('public.rules_user_created_idx') is null
    or to_regclass('public.processed_emails_user_saved_idx') is null
  then
    raise exception 'Missing reconciliation indexes';
  end if;
end
$reconciliation_postcondition$;

commit;
