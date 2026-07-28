-- AutoPDF security hardening shared by Preview and Production.
-- This migration is intentionally fail-closed. Review every preflight failure;
-- never weaken the fingerprints merely to force a Production apply.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $schema_preflight$
declare
  expected record;
  actual_type text;
  actual_not_null boolean;
  actual_default text;
  actual_count integer;
  unexpected_objects text[];
begin
  if to_regclass('auth.users') is null then
    raise exception 'AutoPDF hardening requires auth.users';
  end if;

  foreach actual_type in array array[
    'google_connections', 'rules', 'runs', 'processed_emails',
    'user_profiles', 'ai_usage_logs'
  ]::text[] loop
    if to_regclass(format('public.%I', actual_type)) is null then
      raise exception 'AutoPDF hardening requires public.%', actual_type;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.google_connections'::regclass
      and attname = 'credential_version'
      and not attisdropped
  ) then
    raise exception 'credential_version must not exist before AutoPDF hardening';
  end if;

  if exists (select 1 from public.runs where user_id is null) then
    raise exception 'runs.user_id contains null rows; backfill is forbidden';
  end if;

  if exists (select 1 from pg_catalog.pg_namespace where nspname = 'private') then
    if exists (
      select 1
      from pg_catalog.pg_namespace n
      where n.nspname = 'private'
        and pg_catalog.pg_get_userbyid(n.nspowner) <> 'postgres'
    ) or exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private'
    ) or exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
    ) then
      raise exception 'Existing private schema is not the known empty AutoPDF shape';
    end if;
  end if;

  for expected in
    select *
    from (values
      ('google_connections', 'id', 'uuid', true, '^gen_random_uuid\(\)$'),
      ('google_connections', 'user_id', 'uuid', true, '^$'),
      ('google_connections', 'status', 'text', false, '^$'),
      ('google_connections', 'scopes', 'text', false, '^$'),
      ('google_connections', 'access_token_enc', 'text', false, '^$'),
      ('google_connections', 'refresh_token_enc', 'text', false, '^$'),
      ('google_connections', 'token_expiry_at', 'timestamp with time zone', false, '^$'),
      ('google_connections', 'last_verified_at', 'timestamp with time zone', false, '^$'),
      ('google_connections', 'last_success_at', 'timestamp with time zone', false, '^$'),
      ('google_connections', 'last_error_at', 'timestamp with time zone', false, '^$'),
      ('google_connections', 'last_error_code', 'text', false, '^$'),
      ('google_connections', 'reauth_required', 'boolean', true, '^false$'),
      ('google_connections', 'last_user_notified_at', 'timestamp with time zone', false, '^$'),
      ('google_connections', 'last_user_notified_error_code', 'text', false, '^$'),
      ('google_connections', 'created_at', 'timestamp with time zone', true, '^now\(\)$'),
      ('google_connections', 'updated_at', 'timestamp with time zone', true, '^now\(\)$'),

      ('rules', 'id', 'uuid', true, '^gen_random_uuid\(\)$'),
      ('rules', 'user_id', 'uuid', true, '^$'),
      ('rules', 'is_enabled', 'boolean', true, '^true$'),
      ('rules', 'gmail_label_id', 'text', false, '^$'),
      ('rules', 'unread_only', 'boolean', true, '^false$'),
      ('rules', 'lookback_days', 'integer', true, '^7$'),
      ('rules', 'drive_folder_id', 'text', false, '^$'),
      ('rules', 'subfolder_mode', 'text', false, '^$'),
      ('rules', 'filename_mode', 'text', false, '^$'),
      ('rules', 'run_mode', 'text', false, '^$'),
      ('rules', 'consecutive_failures', 'integer', true, '^0$'),
      ('rules', 'auto_disabled_at', 'timestamp with time zone', false, '^$'),
      ('rules', 'subject_keywords', 'text', false, '^$'),
      ('rules', 'gmail_query', 'text', false, '^$'),
      ('rules', 'query_label', 'text', false, '^$'),
      ('rules', 'file_name_format', 'text', true, '^''standard''::text$'),
      ('rules', 'filename_template', 'text', false, '^$'),
      ('rules', 'is_active', 'boolean', true, '^false$'),
      ('rules', 'run_timing', 'text', true, '^''manual''::text$'),
      ('rules', 'run_count', 'integer', true, '^0$'),
      ('rules', 'created_at', 'timestamp with time zone', true, '^now\(\)$'),
      ('rules', 'updated_at', 'timestamp with time zone', true, '^now\(\)$'),

      ('runs', 'id', 'uuid', true, '^gen_random_uuid\(\)$'),
      ('runs', 'user_id', 'uuid', null, '^$'),
      ('runs', 'rule_id', 'uuid', true, '^$'),
      ('runs', 'trigger', 'text', true, '^$'),
      ('runs', 'status', 'text', true, '^''running''::text$'),
      ('runs', 'started_at', 'timestamp with time zone', true, '^now\(\)$'),
      ('runs', 'finished_at', 'timestamp with time zone', false, '^$'),
      ('runs', 'processed_count', 'integer', true, '^0$'),
      ('runs', 'saved_count', 'integer', true, '^0$'),
      ('runs', 'skipped_count', 'integer', true, '^0$'),
      ('runs', 'drive_folder_id', 'text', false, '^$'),
      ('runs', 'message', 'text', false, '^$'),
      ('runs', 'error_code', 'text', false, '^$'),
      ('runs', 'updated_at', 'timestamp with time zone', true, '^now\(\)$'),

      ('processed_emails', 'id', 'uuid', true, '^gen_random_uuid\(\)$'),
      ('processed_emails', 'user_id', 'uuid', true, '^$'),
      ('processed_emails', 'rule_id', 'uuid', true, '^$'),
      ('processed_emails', 'gmail_message_id', 'text', true, '^$'),
      ('processed_emails', 'drive_file_id', 'text', false, '^$'),
      ('processed_emails', 'drive_web_view_link', 'text', false, '^$'),
      ('processed_emails', 'drive_file_name', 'text', false, '^$'),
      ('processed_emails', 'created_at', 'timestamp with time zone', true, '^now\(\)$'),
      ('processed_emails', 'saved_at', 'timestamp with time zone', true, '^now\(\)$'),

      ('user_profiles', 'id', 'uuid', true, '^gen_random_uuid\(\)$'),
      ('user_profiles', 'user_id', 'uuid', true, '^$'),
      ('user_profiles', 'display_name', 'text', false, '^$'),
      ('user_profiles', 'company_name', 'text', false, '^$'),
      ('user_profiles', 'industry', 'text', false, '^$'),
      ('user_profiles', 'employee_size', 'text', false, '^$'),
      ('user_profiles', 'marketing_opt_in', 'boolean', true, '^false$'),
      ('user_profiles', 'plan', 'text', true, '^''free''::text$'),
      ('user_profiles', 'billing_provider', 'text', false, '^$'),
      ('user_profiles', 'billing_customer_id', 'text', false, '^$'),
      ('user_profiles', 'billing_subscription_id', 'text', false, '^$'),
      ('user_profiles', 'billing_status', 'text', false, '^$'),
      ('user_profiles', 'current_period_end', 'timestamp with time zone', false, '^$'),
      ('user_profiles', 'cancel_at_period_end', 'boolean', true, '^false$'),
      ('user_profiles', 'plan_updated_at', 'timestamp with time zone', false, '^$'),
      ('user_profiles', 'created_at', 'timestamp with time zone', true, '^now\(\)$'),
      ('user_profiles', 'updated_at', 'timestamp with time zone', true, '^now\(\)$'),

      ('ai_usage_logs', 'id', 'uuid', true, '^gen_random_uuid\(\)$'),
      ('ai_usage_logs', 'user_id', 'uuid', true, '^$'),
      ('ai_usage_logs', 'rule_id', 'uuid', false, '^$'),
      ('ai_usage_logs', 'run_id', 'uuid', false, '^$'),
      ('ai_usage_logs', 'feature', 'text', true, '^$'),
      ('ai_usage_logs', 'provider', 'text', true, '^''openai''::text$'),
      ('ai_usage_logs', 'model', 'text', true, '^$'),
      ('ai_usage_logs', 'input_tokens', 'integer', true, '^0$'),
      ('ai_usage_logs', 'output_tokens', 'integer', true, '^0$'),
      ('ai_usage_logs', 'total_tokens', 'integer', true, '^0$'),
      ('ai_usage_logs', 'estimated_cost_usd', 'numeric', false, '^$'),
      ('ai_usage_logs', 'status', 'text', true, '^''success''::text$'),
      ('ai_usage_logs', 'error_code', 'text', false, '^$'),
      ('ai_usage_logs', 'created_at', 'timestamp with time zone', true, '^now\(\)$')
    ) as columns(table_name, column_name, data_type, must_be_not_null, default_pattern)
  loop
    select pg_catalog.format_type(a.atttypid, a.atttypmod),
           a.attnotnull,
           coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')
      into actual_type, actual_not_null, actual_default
    from pg_catalog.pg_attribute a
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = format('public.%I', expected.table_name)::regclass
      and a.attname = expected.column_name
      and not a.attisdropped;

    if actual_type is null
      or actual_type <> expected.data_type
      or (expected.must_be_not_null is not null and actual_not_null <> expected.must_be_not_null)
      or actual_default !~ expected.default_pattern then
      raise exception 'Unexpected column shape: %.%', expected.table_name, expected.column_name;
    end if;
  end loop;

  for expected in
    select * from (values
      ('google_connections', 16), ('rules', 22), ('runs', 14),
      ('processed_emails', 9), ('user_profiles', 17), ('ai_usage_logs', 14)
    ) as counts(table_name, expected_count)
  loop
    select count(*) into actual_count
    from pg_catalog.pg_attribute
    where attrelid = format('public.%I', expected.table_name)::regclass
      and attnum > 0 and not attisdropped;
    if actual_count <> expected.expected_count then
      raise exception 'Unexpected column set on public.%', expected.table_name;
    end if;
  end loop;

  select array_agg(format('%s.%s', n.nspname, c.relname) order by n.nspname, c.relname)
    into unexpected_objects
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any (array[
      'google_connections', 'rules', 'runs', 'processed_emails',
      'user_profiles', 'ai_usage_logs'
    ]::text[])
    and (c.relkind not in ('r', 'p') or not c.relrowsecurity);
  if unexpected_objects is not null then
    raise exception 'Expected RLS-enabled tables: %', array_to_string(unexpected_objects, ', ');
  end if;
end
$schema_preflight$;

do $constraint_index_preflight$
declare
  unexpected text[];
  missing text[];
  expected record;
  actual_type "char";
  actual_definition text;
begin
  select array_agg(c.conname order by c.conname) into unexpected
  from pg_catalog.pg_constraint c
  where c.conrelid = any (array[
      'public.google_connections'::regclass, 'public.rules'::regclass,
      'public.runs'::regclass, 'public.processed_emails'::regclass,
      'public.user_profiles'::regclass, 'public.ai_usage_logs'::regclass
    ]::oid[])
    and c.conname <> all (array[
      'google_connections_pkey', 'google_connections_user_id_key', 'google_connections_user_id_fkey',
      'rules_pkey', 'rules_user_id_fkey', 'rules_lookback_days_positive',
      'rules_consecutive_failures_nonnegative', 'rules_run_count_nonnegative',
      'runs_pkey', 'runs_rule_id_fkey', 'runs_processed_count_nonnegative',
      'runs_saved_count_nonnegative', 'runs_skipped_count_nonnegative',
      'processed_emails_pkey', 'processed_emails_rule_msg_uniq',
      'processed_emails_user_id_fkey', 'processed_emails_rule_id_fkey',
      'user_profiles_pkey', 'user_profiles_user_id_key', 'user_profiles_user_id_fkey',
      'user_profiles_plan_check', 'ai_usage_logs_pkey'
    ]::text[]);
  if unexpected is not null then
    raise exception 'Unexpected AutoPDF constraints: %', array_to_string(unexpected, ', ');
  end if;

  select array_agg(name order by name) into missing
  from unnest(array[
    'google_connections_pkey', 'google_connections_user_id_key', 'google_connections_user_id_fkey',
    'rules_pkey', 'rules_user_id_fkey', 'runs_pkey', 'runs_rule_id_fkey',
    'processed_emails_pkey', 'processed_emails_rule_msg_uniq',
    'processed_emails_user_id_fkey', 'processed_emails_rule_id_fkey',
    'user_profiles_pkey', 'user_profiles_user_id_key', 'user_profiles_user_id_fkey',
    'ai_usage_logs_pkey'
  ]::text[]) as required(name)
  where not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname = required.name
      and c.conrelid = any (array[
        'public.google_connections'::regclass, 'public.rules'::regclass,
        'public.runs'::regclass, 'public.processed_emails'::regclass,
        'public.user_profiles'::regclass, 'public.ai_usage_logs'::regclass
      ]::oid[])
  );
  if missing is not null then
    raise exception 'Missing AutoPDF constraints: %', array_to_string(missing, ', ');
  end if;

  for expected in
    select * from (values
      ('public.google_connections', 'google_connections_pkey', 'p', '^PRIMARY KEY \(id\)$'),
      ('public.google_connections', 'google_connections_user_id_key', 'u', '^UNIQUE \(user_id\)$'),
      ('public.google_connections', 'google_connections_user_id_fkey', 'f', '^FOREIGN KEY \(user_id\) REFERENCES auth.users\(id\) ON DELETE CASCADE$'),
      ('public.rules', 'rules_pkey', 'p', '^PRIMARY KEY \(id\)$'),
      ('public.rules', 'rules_user_id_fkey', 'f', '^FOREIGN KEY \(user_id\) REFERENCES auth.users\(id\) ON DELETE CASCADE$'),
      ('public.runs', 'runs_pkey', 'p', '^PRIMARY KEY \(id\)$'),
      ('public.runs', 'runs_rule_id_fkey', 'f', '^FOREIGN KEY \(rule_id\) REFERENCES rules\(id\) ON DELETE CASCADE$'),
      ('public.processed_emails', 'processed_emails_pkey', 'p', '^PRIMARY KEY \(id\)$'),
      ('public.processed_emails', 'processed_emails_rule_msg_uniq', 'u', '^UNIQUE \(rule_id, gmail_message_id\)$'),
      ('public.processed_emails', 'processed_emails_user_id_fkey', 'f', '^FOREIGN KEY \(user_id\) REFERENCES auth.users\(id\) ON DELETE CASCADE$'),
      ('public.processed_emails', 'processed_emails_rule_id_fkey', 'f', '^FOREIGN KEY \(rule_id\) REFERENCES rules\(id\) ON DELETE CASCADE$'),
      ('public.user_profiles', 'user_profiles_pkey', 'p', '^PRIMARY KEY \(id\)$'),
      ('public.user_profiles', 'user_profiles_user_id_key', 'u', '^UNIQUE \(user_id\)$'),
      ('public.user_profiles', 'user_profiles_user_id_fkey', 'f', '^FOREIGN KEY \(user_id\) REFERENCES auth.users\(id\) ON DELETE CASCADE$'),
      ('public.ai_usage_logs', 'ai_usage_logs_pkey', 'p', '^PRIMARY KEY \(id\)$')
    ) as definitions(table_name, constraint_name, constraint_type, definition_pattern)
  loop
    select c.contype, pg_catalog.pg_get_constraintdef(c.oid, false)
      into actual_type, actual_definition
    from pg_catalog.pg_constraint c
    where c.conrelid = expected.table_name::regclass
      and c.conname = expected.constraint_name;
    if actual_type is null
      or actual_type <> expected.constraint_type
      or actual_definition !~ expected.definition_pattern then
      raise exception 'Unexpected constraint fingerprint: %', expected.constraint_name;
    end if;
  end loop;

  select array_agg(indexname order by indexname) into unexpected
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and tablename = any (array[
      'google_connections', 'rules', 'runs', 'processed_emails',
      'user_profiles', 'ai_usage_logs'
    ]::text[])
    and indexname <> all (array[
      'google_connections_pkey', 'google_connections_user_id_key',
      'rules_pkey', 'rules_user_created_idx',
      'runs_pkey', 'runs_status_updated_at_idx', 'runs_user_started_idx', 'runs_rule_id_started_at_idx',
      'processed_emails_pkey', 'processed_emails_rule_msg_uniq',
      'processed_emails_user_idx', 'processed_emails_rule_idx', 'processed_emails_user_saved_idx',
      'user_profiles_pkey', 'user_profiles_user_id_key', 'user_profiles_user_id_idx',
      'ai_usage_logs_pkey', 'ai_usage_logs_feature_created_idx',
      'ai_usage_logs_run_idx', 'ai_usage_logs_user_created_idx'
    ]::text[]);
  if unexpected is not null then
    raise exception 'Unexpected AutoPDF indexes: %', array_to_string(unexpected, ', ');
  end if;

  select array_agg(name order by name) into missing
  from unnest(array[
    'google_connections_pkey', 'google_connections_user_id_key',
    'rules_pkey', 'rules_user_created_idx',
    'runs_pkey', 'runs_status_updated_at_idx', 'runs_user_started_idx', 'runs_rule_id_started_at_idx',
    'processed_emails_pkey', 'processed_emails_rule_msg_uniq',
    'processed_emails_user_idx', 'processed_emails_rule_idx', 'processed_emails_user_saved_idx',
    'user_profiles_pkey', 'user_profiles_user_id_key', 'user_profiles_user_id_idx',
    'ai_usage_logs_pkey', 'ai_usage_logs_feature_created_idx',
    'ai_usage_logs_run_idx', 'ai_usage_logs_user_created_idx'
  ]::text[]) as required(name)
  where not exists (
    select 1 from pg_catalog.pg_indexes i
    where i.schemaname = 'public' and i.indexname = required.name
  );
  if missing is not null then
    raise exception 'Missing AutoPDF indexes: %', array_to_string(missing, ', ');
  end if;

  for expected in
    select * from (values
      ('rules_user_created_idx', '\(user_id, created_at DESC\)$'),
      ('runs_status_updated_at_idx', '\(status, updated_at DESC\)$'),
      ('runs_user_started_idx', '\(user_id, started_at DESC\)$'),
      ('runs_rule_id_started_at_idx', '\(rule_id, started_at DESC\)$'),
      ('processed_emails_user_idx', '\(user_id\)$'),
      ('processed_emails_rule_idx', '\(rule_id\)$'),
      ('processed_emails_user_saved_idx', '\(user_id, saved_at DESC\)$'),
      ('user_profiles_user_id_idx', '\(user_id\)$'),
      ('ai_usage_logs_feature_created_idx', '\(feature, created_at DESC\)$'),
      ('ai_usage_logs_run_idx', '\(run_id\)$'),
      ('ai_usage_logs_user_created_idx', '\(user_id, created_at DESC\)$')
    ) as definitions(index_name, definition_pattern)
  loop
    select pg_catalog.pg_get_indexdef(c.oid)
      into actual_definition
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = expected.index_name;
    if actual_definition is null or actual_definition !~ expected.definition_pattern then
      raise exception 'Unexpected index fingerprint: %', expected.index_name;
    end if;
  end loop;
end
$constraint_index_preflight$;

do $policy_grant_preflight$
declare
  bad_policies text[];
  bad_grants text[];
  policy_count integer;
begin
  select count(*) into policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = any (array[
      'google_connections', 'rules', 'runs', 'processed_emails',
      'user_profiles', 'ai_usage_logs'
    ]::text[]);

  select array_agg(format('%s.%s', tablename, policyname) order by tablename, policyname)
    into bad_policies
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = any (array[
      'google_connections', 'rules', 'runs', 'processed_emails',
      'user_profiles', 'ai_usage_logs'
    ]::text[])
    and (
      roles <> array['authenticated']::name[]
      or cmd not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      or permissive <> 'PERMISSIVE'
      or (
        tablename = 'ai_usage_logs'
        and not (
          (cmd = 'SELECT' and regexp_replace(coalesce(qual, ''), '[()[:space:]]', '', 'g') = 'auth.uid=user_id')
          or (cmd = 'INSERT' and regexp_replace(coalesce(with_check, ''), '[()[:space:]]', '', 'g') = 'auth.uid=user_id')
        )
      )
      or (
        tablename <> 'ai_usage_logs'
        and cmd in ('SELECT', 'DELETE')
        and regexp_replace(coalesce(qual, ''), '[()[:space:]]', '', 'g') not in ('auth.uid=user_id', 'selectauth.uid=user_id')
      )
      or (
        tablename <> 'ai_usage_logs'
        and cmd = 'INSERT'
        and regexp_replace(coalesce(with_check, ''), '[()[:space:]]', '', 'g') not in ('auth.uid=user_id', 'selectauth.uid=user_id')
      )
      or (
        tablename <> 'ai_usage_logs'
        and cmd = 'UPDATE'
        and (
          regexp_replace(coalesce(qual, ''), '[()[:space:]]', '', 'g') not in ('auth.uid=user_id', 'selectauth.uid=user_id')
          or regexp_replace(coalesce(with_check, ''), '[()[:space:]]', '', 'g') not in ('auth.uid=user_id', 'selectauth.uid=user_id')
        )
      )
    );
  if bad_policies is not null then
    raise exception 'Unknown AutoPDF policy fingerprints: %', array_to_string(bad_policies, ', ');
  end if;
  if policy_count > 24 then
    raise exception 'Unexpected AutoPDF policy count: %', policy_count;
  end if;

  select array_agg(format('%s:%s:%s', table_name, grantee, privilege_type)
                   order by table_name, grantee, privilege_type)
    into bad_grants
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = any (array[
      'google_connections', 'rules', 'runs', 'processed_emails',
      'user_profiles', 'ai_usage_logs'
    ]::text[])
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    and (
      grantee = 'PUBLIC'
      or privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    );
  if bad_grants is not null then
    raise exception 'Unknown AutoPDF table grants: %', array_to_string(bad_grants, ', ');
  end if;

  select array_agg(format('%s.%s:%s:%s', table_name, column_name, grantee, privilege_type)
                   order by table_name, column_name, grantee, privilege_type)
    into bad_grants
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = any (array[
      'google_connections', 'rules', 'runs', 'processed_emails',
      'user_profiles', 'ai_usage_logs'
    ]::text[])
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
    and (grantee = 'PUBLIC' or privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES'));
  if bad_grants is not null then
    raise exception 'Unknown AutoPDF column grants: %', array_to_string(bad_grants, ', ');
  end if;
end
$policy_grant_preflight$;

do $trigger_function_preflight$
declare
  bad_triggers text[];
  trigger_row record;
  trigger_count integer;
  function_body text;
begin
  select array_agg(format('%s.%s', event_object_table, trigger_name)
                   order by event_object_table, trigger_name)
    into bad_triggers
  from information_schema.triggers
  where (event_object_schema = 'public' and event_object_table in ('rules', 'runs', 'user_profiles'))
     or (event_object_schema = 'auth' and event_object_table = 'users')
  having bool_or(
    not (
      (event_object_schema = 'auth' and event_object_table = 'users' and action_timing = 'AFTER' and event_manipulation = 'INSERT')
      or (event_object_schema = 'public' and event_object_table in ('rules', 'runs', 'user_profiles')
          and action_timing = 'BEFORE' and event_manipulation = 'UPDATE')
    )
  );
  if bad_triggers is not null then
    raise exception 'Unknown AutoPDF trigger timing: %', array_to_string(bad_triggers, ', ');
  end if;

  for trigger_row in
    select n.nspname as table_schema, c.relname as table_name, t.tgname,
           pn.nspname as function_schema, p.proname as function_name,
           pg_catalog.pg_get_triggerdef(t.oid, true) as definition
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal
      and ((n.nspname = 'public' and c.relname in ('rules', 'runs', 'user_profiles'))
        or (n.nspname = 'auth' and c.relname = 'users'))
  loop
    if trigger_row.table_schema = 'auth' then
      if trigger_row.function_schema not in ('public', 'private')
        or trigger_row.function_name not in ('handle_new_user', 'handle_new_user_create_profile') then
        raise exception 'Unknown auth.users trigger function: %.%', trigger_row.function_schema, trigger_row.function_name;
      end if;
    elsif not (
      (trigger_row.function_schema = 'public' and trigger_row.function_name = 'set_updated_at')
      or trigger_row.function_name = 'moddatetime'
    ) then
      raise exception 'Unknown updated_at trigger function: %.%', trigger_row.function_schema, trigger_row.function_name;
    end if;
  end loop;

  select count(*) into trigger_count
  from pg_catalog.pg_trigger t
  where not t.tgisinternal and t.tgrelid = 'auth.users'::regclass;
  if trigger_count > 1 then raise exception 'Unexpected auth.users trigger count'; end if;

  select count(*) into trigger_count
  from pg_catalog.pg_trigger t
  where not t.tgisinternal and t.tgrelid = 'public.rules'::regclass;
  if trigger_count > 2 then raise exception 'Unexpected rules trigger count'; end if;

  foreach function_body in array array[
    coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('public.handle_new_user()')), ''),
    coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('public.handle_new_user_create_profile()')), '')
  ]::text[] loop
    if function_body <> '' and (
      function_body !~* 'insert[[:space:]]+into[[:space:]]+public.user_profiles'
      or function_body !~* 'new.id'
      or function_body ~* '\m(update|delete|truncate)\M'
    ) then
      raise exception 'Unknown public signup function fingerprint';
    end if;
  end loop;

  if to_regprocedure('public.set_updated_at()') is not null then
    function_body := pg_catalog.pg_get_functiondef('public.set_updated_at()'::regprocedure);
    if function_body !~* 'new.updated_at[[:space:]]*:=[[:space:]]*(pg_catalog.)?now\(\)'
      or function_body ~* 'security[[:space:]]+definer' then
      raise exception 'Unknown public.set_updated_at fingerprint';
    end if;
  end if;
end
$trigger_function_preflight$;

create schema if not exists private authorization postgres;
revoke all on schema private from public, anon, authenticated;

do $drop_known_policies$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'google_connections', 'rules', 'runs', 'processed_emails',
        'user_profiles', 'ai_usage_logs'
      ]::text[])
  loop
    execute format('drop policy %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$drop_known_policies$;

do $revoke_known_column_grants$
declare
  grant_row record;
begin
  for grant_row in
    select table_schema, table_name, column_name, grantee, privilege_type
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = any (array[
        'google_connections', 'rules', 'runs', 'processed_emails',
        'user_profiles', 'ai_usage_logs'
      ]::text[])
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

create policy google_connections_select_own
  on public.google_connections for select to authenticated
  using ((select auth.uid()) = user_id);
create policy rules_select_own
  on public.rules for select to authenticated
  using ((select auth.uid()) = user_id);
create policy runs_select_own
  on public.runs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy processed_emails_select_own
  on public.processed_emails for select to authenticated
  using ((select auth.uid()) = user_id);
create policy user_profiles_select_own
  on public.user_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy user_profiles_insert_own
  on public.user_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy user_profiles_update_own
  on public.user_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

do $drop_known_triggers$
declare
  trigger_row record;
begin
  for trigger_row in
    select n.nspname as table_schema, c.relname as table_name, t.tgname
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and ((n.nspname = 'public' and c.relname in ('rules', 'runs', 'user_profiles'))
        or (n.nspname = 'auth' and c.relname = 'users'))
  loop
    execute format('drop trigger %I on %I.%I',
      trigger_row.tgname, trigger_row.table_schema, trigger_row.table_name);
  end loop;
end
$drop_known_triggers$;

drop function if exists public.handle_new_user();
drop function if exists public.handle_new_user_create_profile();

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
revoke all on function private.handle_new_user_create_profile() from public, anon, authenticated;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function private.handle_new_user_create_profile();

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
revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger rules_set_updated_at
before update on public.rules
for each row execute function public.set_updated_at();

create trigger runs_set_updated_at
before update on public.runs
for each row execute function public.set_updated_at();

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

alter table public.runs alter column user_id set not null;

commit;
