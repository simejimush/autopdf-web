begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration_preflight$
declare
  drift text[];
begin
  if to_regclass('public.user_profiles') is null
     or to_regclass('public.rules') is null then
    raise exception 'stripe safety migration blocked: dependency schema drift';
  end if;

  select pg_catalog.array_agg(
           pg_catalog.format('%s.%s', expected.table_name, expected.column_name)
           order by expected.table_name, expected.column_name
         )
    into drift
  from (values
    ('user_profiles', 'id', 'uuid', array[true]::boolean[]),
    ('user_profiles', 'user_id', 'uuid', array[true]::boolean[]),
    ('user_profiles', 'plan', 'text', array[true]::boolean[]),
    ('user_profiles', 'billing_provider', 'text', array[false]::boolean[]),
    ('user_profiles', 'billing_customer_id', 'text', array[false]::boolean[]),
    ('user_profiles', 'billing_subscription_id', 'text', array[false]::boolean[]),
    ('user_profiles', 'billing_status', 'text', array[false]::boolean[]),
    ('user_profiles', 'current_period_end', 'timestamp with time zone', array[false]::boolean[]),
    ('user_profiles', 'cancel_at_period_end', 'boolean', array[true, false]::boolean[]),
    ('user_profiles', 'plan_updated_at', 'timestamp with time zone', array[false]::boolean[]),
    ('user_profiles', 'updated_at', 'timestamp with time zone', array[true]::boolean[]),
    ('rules', 'id', 'uuid', array[true]::boolean[]),
    ('rules', 'user_id', 'uuid', array[true]::boolean[]),
    ('rules', 'is_active', 'boolean', array[true, false]::boolean[]),
    ('rules', 'created_at', 'timestamp with time zone', array[true]::boolean[]),
    ('rules', 'updated_at', 'timestamp with time zone', array[true]::boolean[])
  ) as expected(table_name, column_name, data_type, allowed_not_null)
  left join pg_catalog.pg_class relation
    on relation.oid = pg_catalog.to_regclass(
      pg_catalog.format('public.%I', expected.table_name)
    )
  left join pg_catalog.pg_attribute attribute
    on attribute.attrelid = relation.oid
   and attribute.attname = expected.column_name
   and attribute.attnum > 0
   and not attribute.attisdropped
  where attribute.attname is null
     or pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
          <> expected.data_type
     or not (attribute.attnotnull = any (expected.allowed_not_null));
  if drift is not null then
    raise exception 'stripe safety migration blocked: dependency schema drift';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('user_profiles', 'rules')
      and (
        relation.relkind not in ('r', 'p')
        or pg_catalog.pg_get_userbyid(relation.relowner) <> 'postgres'
        or not relation.relrowsecurity
        or relation.relforcerowsecurity
      )
  ) then
    raise exception 'stripe safety migration blocked: dependency schema drift';
  end if;

  select pg_catalog.array_agg(
           pg_catalog.format('%s.%s', relation.relname, constraint_row.conname)
           order by relation.relname, constraint_row.conname
         )
    into drift
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname in ('user_profiles', 'rules')
    and constraint_row.conname not in (
      'user_profiles_pkey', 'user_profiles_user_id_key',
      'user_profiles_user_id_fkey', 'user_profiles_plan_check',
      'user_profiles_billing_provider_check',
      'user_profiles_billing_status_check',
      'rules_pkey', 'rules_user_id_fkey', 'lookback_days_allowed',
      'rules_lookback_days_positive',
      'rules_consecutive_failures_nonnegative',
      'rules_run_count_nonnegative'
    );
  if drift is not null
     or exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
       where relation.oid in ('public.user_profiles'::regclass, 'public.rules'::regclass)
         and not constraint_row.convalidated
     ) then
    raise exception 'stripe safety migration blocked: dependency constraint drift';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_attribute column_row
      on column_row.attrelid = constraint_row.conrelid
     and constraint_row.conkey = array[column_row.attnum]::smallint[]
    where constraint_row.conrelid = 'public.user_profiles'::regclass
      and constraint_row.conname = 'user_profiles_pkey'
      and constraint_row.contype = 'p'
      and column_row.attname = 'id'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_attribute column_row
      on column_row.attrelid = constraint_row.conrelid
     and constraint_row.conkey = array[column_row.attnum]::smallint[]
    where constraint_row.conrelid = 'public.user_profiles'::regclass
      and constraint_row.conname = 'user_profiles_user_id_key'
      and constraint_row.contype = 'u'
      and column_row.attname = 'user_id'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_attribute source_column
      on source_column.attrelid = constraint_row.conrelid
     and constraint_row.conkey = array[source_column.attnum]::smallint[]
    join pg_catalog.pg_attribute target_column
      on target_column.attrelid = constraint_row.confrelid
     and constraint_row.confkey = array[target_column.attnum]::smallint[]
    where constraint_row.conrelid = 'public.user_profiles'::regclass
      and constraint_row.conname = 'user_profiles_user_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.confdeltype = 'c'
      and source_column.attname = 'user_id'
      and target_column.attname = 'id'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_attribute source_column
      on source_column.attrelid = constraint_row.conrelid
     and constraint_row.conkey = array[source_column.attnum]::smallint[]
    join pg_catalog.pg_attribute target_column
      on target_column.attrelid = constraint_row.confrelid
     and constraint_row.confkey = array[target_column.attnum]::smallint[]
    where constraint_row.conrelid = 'public.rules'::regclass
      and constraint_row.conname = 'rules_user_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.confdeltype = 'c'
      and source_column.attname = 'user_id'
      and target_column.attname = 'id'
  ) then
    raise exception 'stripe safety migration blocked: dependency constraint drift';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.user_profiles'::regclass
      and constraint_row.conname = 'user_profiles_plan_check'
      and constraint_row.contype = 'c'
      and pg_catalog.lower(pg_catalog.regexp_replace(
        pg_catalog.pg_get_constraintdef(constraint_row.oid, false),
        '[[:space:]]', '', 'g'
      )) in (
        'check((plan=any(array[''free''::text,''pro''::text])))',
        'check((plan=any(array[''free''::text,''pro''::text,''pro_plus''::text])))'
      )
  ) then
    raise exception 'stripe safety migration blocked: dependency constraint drift';
  end if;

  select pg_catalog.array_agg(
           pg_catalog.format('%s.%s', indexes.tablename, indexes.indexname)
           order by indexes.tablename, indexes.indexname
         )
    into drift
  from pg_catalog.pg_indexes indexes
  where indexes.schemaname = 'public'
    and indexes.tablename in ('user_profiles', 'rules')
    and indexes.indexname not in (
      'user_profiles_pkey', 'user_profiles_user_id_key',
      'user_profiles_user_id_idx', 'rules_pkey', 'rules_user_created_idx'
    );
  if drift is not null
     or not exists (
       select 1
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_attribute user_id_column
         on user_id_column.attrelid = index_row.indrelid
        and user_id_column.attname = 'user_id'
       join pg_catalog.pg_attribute created_at_column
         on created_at_column.attrelid = index_row.indrelid
        and created_at_column.attname = 'created_at'
       where index_row.indexrelid = 'public.rules_user_created_idx'::regclass
         and index_row.indrelid = 'public.rules'::regclass
         and index_row.indisvalid and index_row.indisready
         and not index_row.indisunique
         and index_row.indpred is null
         and array(
           select key_part
           from pg_catalog.unnest(index_row.indkey::smallint[])
             with ordinality as key_parts(key_part, position)
           order by position
         ) = array[user_id_column.attnum, created_at_column.attnum]::smallint[]
         and array(
           select option_part
           from pg_catalog.unnest(index_row.indoption::smallint[])
             with ordinality as option_parts(option_part, position)
           order by position
         ) = array[0, 3]::smallint[]
     ) then
    raise exception 'stripe safety migration blocked: dependency index drift';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in ('user_profiles', 'rules')
      and privilege.grantee in ('PUBLIC', 'anon')
  ) or exists (
    select 1
    from information_schema.column_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in ('user_profiles', 'rules')
      and privilege.grantee in ('PUBLIC', 'anon')
  ) or exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'user_profiles'
      and privilege.grantee = 'authenticated'
  ) or exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'rules'
      and privilege.grantee = 'authenticated'
      and (privilege.privilege_type <> 'SELECT' or privilege.is_grantable <> 'NO')
  ) or exists (
    select 1
    from information_schema.column_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'user_profiles'
      and privilege.grantee = 'authenticated'
      and privilege.column_name in (
        'plan', 'billing_provider', 'billing_customer_id',
        'billing_subscription_id', 'billing_status', 'current_period_end',
        'cancel_at_period_end', 'plan_updated_at', 'updated_at'
      )
      and privilege.privilege_type <> 'SELECT'
  ) then
    raise exception 'stripe safety migration blocked: dependency ACL drift';
  end if;

  if exists (
    select privilege.column_name, privilege.privilege_type
      from information_schema.column_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'user_profiles'
        and privilege.grantee = 'authenticated'
        and privilege.is_grantable = 'NO'
      except
      select expected.column_name, expected.privilege_type
      from (values
        ('user_id', 'SELECT'), ('display_name', 'SELECT'),
        ('company_name', 'SELECT'), ('industry', 'SELECT'),
        ('employee_size', 'SELECT'), ('marketing_opt_in', 'SELECT'),
        ('plan', 'SELECT'), ('billing_provider', 'SELECT'),
        ('billing_customer_id', 'SELECT'),
        ('billing_subscription_id', 'SELECT'), ('billing_status', 'SELECT'),
        ('current_period_end', 'SELECT'),
        ('cancel_at_period_end', 'SELECT'), ('user_id', 'INSERT'),
        ('display_name', 'UPDATE'), ('company_name', 'UPDATE'),
        ('industry', 'UPDATE'), ('employee_size', 'UPDATE'),
        ('marketing_opt_in', 'UPDATE')
      ) as expected(column_name, privilege_type)
  ) or exists (
    select expected.column_name, expected.privilege_type
      from (values
        ('user_id', 'SELECT'), ('display_name', 'SELECT'),
        ('company_name', 'SELECT'), ('industry', 'SELECT'),
        ('employee_size', 'SELECT'), ('marketing_opt_in', 'SELECT'),
        ('plan', 'SELECT'), ('billing_provider', 'SELECT'),
        ('billing_customer_id', 'SELECT'),
        ('billing_subscription_id', 'SELECT'), ('billing_status', 'SELECT'),
        ('current_period_end', 'SELECT'),
        ('cancel_at_period_end', 'SELECT'), ('user_id', 'INSERT'),
        ('display_name', 'UPDATE'), ('company_name', 'UPDATE'),
        ('industry', 'UPDATE'), ('employee_size', 'UPDATE'),
        ('marketing_opt_in', 'UPDATE')
      ) as expected(column_name, privilege_type)
      except
      select privilege.column_name, privilege.privilege_type
      from information_schema.column_privileges privilege
      where privilege.table_schema = 'public'
        and privilege.table_name = 'user_profiles'
        and privilege.grantee = 'authenticated'
        and privilege.is_grantable = 'NO'
  ) or (
    select pg_catalog.count(*)
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = 'rules'
      and privilege.grantee = 'authenticated'
      and privilege.privilege_type = 'SELECT'
      and privilege.is_grantable = 'NO'
  ) <> 1 then
    raise exception 'stripe safety migration blocked: dependency ACL drift';
  end if;

  select pg_catalog.array_agg(
           pg_catalog.format('%s.%s', expected.table_name, expected.privilege_type)
           order by expected.table_name, expected.privilege_type
         )
    into drift
  from (values
    ('user_profiles', 'SELECT'), ('user_profiles', 'INSERT'),
    ('user_profiles', 'UPDATE'),
    ('rules', 'SELECT'), ('rules', 'INSERT'), ('rules', 'UPDATE'),
    ('rules', 'DELETE')
  ) as expected(table_name, privilege_type)
  where not exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name = expected.table_name
      and privilege.grantee = 'service_role'
      and privilege.privilege_type = expected.privilege_type
      and privilege.is_grantable = 'NO'
  );
  if drift is not null or exists (
    select 1
    from information_schema.table_privileges privilege
    where privilege.table_schema = 'public'
      and privilege.table_name in ('user_profiles', 'rules')
      and privilege.grantee = 'service_role'
      and (
        privilege.is_grantable <> 'NO'
        or (privilege.table_name = 'user_profiles'
            and privilege.privilege_type not in ('SELECT', 'INSERT', 'UPDATE'))
        or (privilege.table_name = 'rules'
            and privilege.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
      )
  ) then
    raise exception 'stripe safety migration blocked: dependency ACL drift';
  end if;

  if to_regclass('public.stripe_webhook_events') is not null
     or to_regclass('public.stripe_checkout_attempts') is not null then
    raise exception 'stripe safety migration blocked: unexpected pre-existing table';
  end if;

  if to_regclass('public.user_profiles_billing_customer_unique_idx') is not null
     or to_regclass('public.user_profiles_billing_subscription_unique_idx') is not null
     or to_regclass('public.stripe_webhook_events_status_updated_idx') is not null
     or to_regclass('public.stripe_checkout_attempts_one_active_user_idx') is not null
     or to_regclass('public.stripe_checkout_attempts_user_created_idx') is not null then
    raise exception 'stripe safety migration blocked: unexpected pre-existing index';
  end if;

  if to_regprocedure('public.claim_stripe_webhook_event(text,text,timestamptz,timestamptz,text)') is not null
     or to_regprocedure('public.fail_stripe_webhook_event(text,text,text,boolean,timestamptz)') is not null
     or to_regprocedure('public.finalize_stripe_webhook_event(text,text,uuid,text,text,text,text,timestamptz,boolean,timestamptz)') is not null
     or to_regprocedure('public.claim_stripe_checkout_attempt(uuid,text,timestamptz)') is not null
     or to_regprocedure('public.record_stripe_checkout_customer(uuid,uuid,text,text,timestamptz)') is not null
     or to_regprocedure('public.record_stripe_checkout_session(uuid,uuid,text,text,timestamptz)') is not null
     or to_regprocedure('public.expire_stripe_checkout_session(uuid,uuid,text,timestamptz)') is not null
     or to_regprocedure('public.fail_stripe_checkout_attempt(uuid,uuid,text,text,boolean,timestamptz)') is not null then
    raise exception 'stripe safety migration blocked: unexpected pre-existing function';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name in ('billing_last_event_created_at', 'billing_last_event_id')
  ) then
    raise exception 'stripe safety migration blocked: unexpected partial user_profiles shape';
  end if;

  if exists (
    select billing_customer_id
    from public.user_profiles
    where billing_customer_id is not null
    group by billing_customer_id
    having count(*) > 1
  ) or exists (
    select billing_subscription_id
    from public.user_profiles
    where billing_subscription_id is not null
    group by billing_subscription_id
    having count(*) > 1
  ) then
    raise exception 'stripe safety migration blocked: duplicate Stripe ownership reference';
  end if;
end
$migration_preflight$;

alter table public.user_profiles
  add column billing_last_event_created_at timestamptz null,
  add column billing_last_event_id text null;

create unique index user_profiles_billing_customer_unique_idx
  on public.user_profiles (billing_customer_id)
  where billing_customer_id is not null;

create unique index user_profiles_billing_subscription_unique_idx
  on public.user_profiles (billing_subscription_id)
  where billing_subscription_id is not null;

create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  provider_created_at timestamptz not null,
  user_id uuid null references auth.users (id) on delete set null,
  subscription_fingerprint text null,
  status text not null,
  attempt_count integer not null default 1,
  processing_lease_hash text null,
  processing_expires_at timestamptz null,
  error_code text null,
  received_at timestamptz not null default pg_catalog.now(),
  processed_at timestamptz null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint stripe_webhook_events_status_check check (
    status in ('processing', 'processed', 'stale', 'retryable_failed', 'terminal_failed')
  ),
  constraint stripe_webhook_events_attempt_count_check check (attempt_count > 0),
  constraint stripe_webhook_events_error_code_check check (
    error_code is null or error_code ~ '^[A-Z0-9_]{1,80}$'
  )
);

create index stripe_webhook_events_status_updated_idx
  on public.stripe_webhook_events (status, updated_at desc);

create table public.stripe_checkout_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  lease_hash text null,
  lease_expires_at timestamptz null,
  retry_until timestamptz not null,
  stripe_customer_id text null,
  stripe_session_id text null,
  error_code text null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz null,
  constraint stripe_checkout_attempts_status_check check (
    status in ('creating', 'customer_ready', 'session_ready', 'retryable_failed', 'terminal_failed')
  ),
  constraint stripe_checkout_attempts_error_code_check check (
    error_code is null or error_code ~ '^[A-Z0-9_]{1,80}$'
  ),
  constraint stripe_checkout_attempts_lease_check check (
    (lease_hash is null and lease_expires_at is null)
    or (lease_hash is not null and lease_expires_at is not null)
  )
);

create unique index stripe_checkout_attempts_one_active_user_idx
  on public.stripe_checkout_attempts (user_id)
  where status in ('creating', 'customer_ready', 'retryable_failed', 'session_ready');

create index stripe_checkout_attempts_user_created_idx
  on public.stripe_checkout_attempts (user_id, created_at desc);

alter table public.stripe_webhook_events enable row level security;
alter table public.stripe_webhook_events force row level security;
alter table public.stripe_checkout_attempts enable row level security;
alter table public.stripe_checkout_attempts force row level security;

revoke all on table public.stripe_webhook_events from public, anon, authenticated, service_role;
revoke all on table public.stripe_checkout_attempts from public, anon, authenticated, service_role;
grant select, insert, update on table public.stripe_webhook_events to service_role;
grant select, insert, update on table public.stripe_checkout_attempts to service_role;

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_provider_created_at timestamptz,
  p_now timestamptz,
  p_lease_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event public.stripe_webhook_events%rowtype;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 255
     or p_event_type is null or length(p_event_type) not between 1 and 120
     or p_provider_created_at is null or p_now is null
     or p_lease_hash is null or length(p_lease_hash) not between 32 and 128 then
    raise exception 'invalid webhook claim input';
  end if;

  insert into public.stripe_webhook_events (
    event_id, event_type, provider_created_at, status, processing_lease_hash, processing_expires_at
  ) values (
    p_event_id, p_event_type, p_provider_created_at, 'processing', p_lease_hash, p_now + interval '5 minutes'
  )
  on conflict (event_id) do nothing;

  select * into v_event
  from public.stripe_webhook_events
  where event_id = p_event_id
  for update;

  if v_event.event_type <> p_event_type or v_event.provider_created_at <> p_provider_created_at then
    return jsonb_build_object('disposition', 'conflict');
  end if;

  if v_event.status in ('processed', 'stale', 'terminal_failed') then
    return jsonb_build_object('disposition', 'duplicate', 'status', v_event.status);
  end if;

  if v_event.attempt_count >= 10 then
    update public.stripe_webhook_events
    set status = 'terminal_failed', processing_lease_hash = null,
        processing_expires_at = null, error_code = 'STRIPE_WEBHOOK_RETRY_LIMIT',
        processed_at = p_now, updated_at = p_now
    where event_id = p_event_id;
    return jsonb_build_object('disposition', 'duplicate', 'status', 'terminal_failed');
  end if;

  if v_event.status = 'processing'
     and v_event.processing_lease_hash <> p_lease_hash
     and v_event.processing_expires_at > p_now then
    return jsonb_build_object('disposition', 'in_progress');
  end if;

  if v_event.status <> 'processing' or v_event.processing_lease_hash <> p_lease_hash then
    update public.stripe_webhook_events
    set status = 'processing',
        attempt_count = attempt_count + 1,
        processing_lease_hash = p_lease_hash,
        processing_expires_at = p_now + interval '5 minutes',
        error_code = null,
        updated_at = p_now
    where event_id = p_event_id;
  end if;

  return jsonb_build_object('disposition', 'claimed');
end
$function$;

create or replace function public.fail_stripe_webhook_event(
  p_event_id text,
  p_lease_hash text,
  p_error_code text,
  p_retryable boolean,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_error_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'invalid safe error code';
  end if;

  update public.stripe_webhook_events
  set status = case when p_retryable then 'retryable_failed' else 'terminal_failed' end,
      processing_expires_at = null,
      processing_lease_hash = null,
      error_code = p_error_code,
      processed_at = case when p_retryable then null else p_now end,
      updated_at = p_now
  where event_id = p_event_id
    and status = 'processing'
    and processing_lease_hash = p_lease_hash;

  return found;
end
$function$;

create or replace function public.finalize_stripe_webhook_event(
  p_event_id text,
  p_lease_hash text,
  p_user_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_plan text,
  p_billing_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event public.stripe_webhook_events%rowtype;
  v_owner public.user_profiles%rowtype;
  v_owner_count integer;
begin
  if p_plan not in ('free', 'pro', 'pro_plus') or p_now is null then
    raise exception 'invalid webhook finalization input';
  end if;

  select * into v_event
  from public.stripe_webhook_events
  where event_id = p_event_id
  for update;

  if not found or v_event.status <> 'processing' or v_event.processing_lease_hash <> p_lease_hash then
    return jsonb_build_object('disposition', 'lost_claim');
  end if;

  if p_user_id is not null then
    select count(*) into v_owner_count
    from public.user_profiles
    where user_id = p_user_id
      and (billing_customer_id is null or billing_customer_id = p_customer_id);
  else
    select count(*) into v_owner_count
    from public.user_profiles
    where billing_customer_id = p_customer_id;
  end if;

  if v_owner_count = 0 then
    update public.stripe_webhook_events
    set status = 'retryable_failed', error_code = 'STRIPE_OWNER_NOT_FOUND',
        processing_lease_hash = null, processing_expires_at = null,
        processed_at = null, updated_at = p_now
    where event_id = p_event_id;
    return jsonb_build_object('disposition', 'retryable_failed');
  end if;

  if v_owner_count > 1 then
    update public.stripe_webhook_events
    set status = 'terminal_failed', error_code = 'STRIPE_OWNER_NOT_UNIQUE',
        processing_lease_hash = null, processing_expires_at = null,
        processed_at = p_now, updated_at = p_now
    where event_id = p_event_id;
    return jsonb_build_object('disposition', 'terminal_failed');
  end if;

  select * into v_owner
  from public.user_profiles
  where (p_user_id is not null and user_id = p_user_id
         and (billing_customer_id is null or billing_customer_id = p_customer_id))
     or (p_user_id is null and billing_customer_id = p_customer_id)
  for update;

  if v_owner.billing_last_event_created_at is not null
     and v_owner.billing_last_event_created_at > v_event.provider_created_at then
    update public.stripe_webhook_events
    set user_id = v_owner.user_id, status = 'stale', error_code = null,
        processing_lease_hash = null, processing_expires_at = null,
        processed_at = p_now, updated_at = p_now,
        subscription_fingerprint = case when p_subscription_id is null then null else md5(p_subscription_id) end
    where event_id = p_event_id;
    return jsonb_build_object('disposition', 'stale');
  end if;

  update public.user_profiles
  set plan = p_plan,
      billing_provider = 'stripe',
      billing_customer_id = coalesce(p_customer_id, billing_customer_id),
      billing_subscription_id = p_subscription_id,
      billing_status = p_billing_status,
      current_period_end = p_current_period_end,
      cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
      plan_updated_at = p_now,
      billing_last_event_created_at = v_event.provider_created_at,
      billing_last_event_id = p_event_id,
      updated_at = p_now
  where id = v_owner.id;

  if p_plan = 'free' then
    with ranked as (
      select id, row_number() over (order by created_at asc, id asc) as position
      from public.rules
      where user_id = v_owner.user_id and is_active = true
    )
    update public.rules as rules
    set is_active = false, updated_at = p_now
    from ranked
    where rules.id = ranked.id and ranked.position > 3;
  end if;

  update public.stripe_webhook_events
  set user_id = v_owner.user_id, status = 'processed', error_code = null,
      processing_lease_hash = null, processing_expires_at = null,
      processed_at = p_now, updated_at = p_now,
      subscription_fingerprint = case when p_subscription_id is null then null else md5(p_subscription_id) end
  where event_id = p_event_id;

  return jsonb_build_object('disposition', 'processed');
exception
  when unique_violation then
    update public.stripe_webhook_events
    set status = 'terminal_failed', error_code = 'STRIPE_OWNER_CONFLICT',
        processing_lease_hash = null, processing_expires_at = null,
        processed_at = p_now, updated_at = p_now
    where event_id = p_event_id and processing_lease_hash = p_lease_hash;
    return jsonb_build_object('disposition', 'terminal_failed');
end
$function$;

create or replace function public.claim_stripe_checkout_attempt(
  p_user_id uuid,
  p_lease_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.stripe_checkout_attempts%rowtype;
  v_customer_id text;
  v_profile_count integer;
begin
  if p_user_id is null or p_now is null
     or p_lease_hash is null or length(p_lease_hash) not between 32 and 128 then
    raise exception 'invalid Checkout claim input';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  select count(*), min(billing_customer_id)
  into v_profile_count, v_customer_id
  from public.user_profiles
  where user_id = p_user_id;

  if v_profile_count <> 1 then
    return jsonb_build_object('disposition', 'owner_invalid');
  end if;

  select * into v_attempt
  from public.stripe_checkout_attempts
  where user_id = p_user_id
    and status in ('creating', 'customer_ready', 'retryable_failed', 'session_ready')
  order by created_at desc
  limit 1
  for update;

  if found and v_attempt.status = 'session_ready' then
    return jsonb_build_object(
      'disposition', 'session_ready', 'attempt_id', v_attempt.attempt_id,
      'customer_id', v_attempt.stripe_customer_id, 'session_id', v_attempt.stripe_session_id
    );
  end if;

  if found and v_attempt.status <> 'retryable_failed'
     and v_attempt.lease_expires_at > p_now then
    return jsonb_build_object('disposition', 'busy');
  end if;

  if found and v_attempt.retry_until <= p_now then
    update public.stripe_checkout_attempts
    set status = 'terminal_failed', lease_hash = null, lease_expires_at = null,
        error_code = 'STRIPE_CHECKOUT_RETRY_WINDOW_EXPIRED', updated_at = p_now, completed_at = p_now
    where attempt_id = v_attempt.attempt_id;
    return jsonb_build_object('disposition', 'terminal_failed');
  end if;

  if found then
    update public.stripe_checkout_attempts
    set status = case when stripe_customer_id is null then 'creating' else 'customer_ready' end,
        lease_hash = p_lease_hash, lease_expires_at = p_now + interval '5 minutes',
        error_code = null, updated_at = p_now
    where attempt_id = v_attempt.attempt_id
    returning * into v_attempt;
  else
    insert into public.stripe_checkout_attempts (
      user_id, status, lease_hash, lease_expires_at, retry_until, stripe_customer_id
    ) values (
      p_user_id, case when v_customer_id is null then 'creating' else 'customer_ready' end,
      p_lease_hash, p_now + interval '5 minutes', p_now + interval '24 hours', v_customer_id
    ) returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'disposition', 'claimed', 'attempt_id', v_attempt.attempt_id,
    'customer_id', v_attempt.stripe_customer_id
  );
end
$function$;

create or replace function public.record_stripe_checkout_customer(
  p_user_id uuid,
  p_attempt_id uuid,
  p_lease_hash text,
  p_customer_id text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt_exists boolean;
begin
  select true into v_attempt_exists
  from public.stripe_checkout_attempts
  where attempt_id = p_attempt_id and user_id = p_user_id
    and lease_hash = p_lease_hash and lease_expires_at > p_now
    and status = 'creating'
  for update;

  if coalesce(v_attempt_exists, false) is false then return false; end if;

  update public.user_profiles
  set billing_provider = 'stripe', billing_customer_id = p_customer_id, updated_at = p_now
  where user_id = p_user_id
    and (billing_customer_id is null or billing_customer_id = p_customer_id);

  if not found then return false; end if;

  update public.stripe_checkout_attempts
  set status = 'customer_ready', stripe_customer_id = p_customer_id, updated_at = p_now
  where attempt_id = p_attempt_id and user_id = p_user_id
    and lease_hash = p_lease_hash and lease_expires_at > p_now
    and status = 'creating';

  if not found then raise exception 'Checkout customer CAS invariant failed'; end if;
  return true;
exception when unique_violation then
  return false;
end
$function$;

create or replace function public.record_stripe_checkout_session(
  p_user_id uuid,
  p_attempt_id uuid,
  p_lease_hash text,
  p_session_id text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.stripe_checkout_attempts
  set status = 'session_ready', stripe_session_id = p_session_id,
      lease_hash = null, lease_expires_at = null, error_code = null,
      updated_at = p_now, completed_at = p_now
  where attempt_id = p_attempt_id and user_id = p_user_id
    and lease_hash = p_lease_hash and lease_expires_at > p_now
    and status = 'customer_ready';
  return found;
end
$function$;

create or replace function public.fail_stripe_checkout_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_lease_hash text,
  p_error_code text,
  p_retryable boolean,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_error_code !~ '^[A-Z0-9_]{1,80}$' then
    raise exception 'invalid safe error code';
  end if;

  update public.stripe_checkout_attempts
  set status = case when p_retryable then 'retryable_failed' else 'terminal_failed' end,
      lease_hash = null, lease_expires_at = null, error_code = p_error_code,
      updated_at = p_now, completed_at = case when p_retryable then null else p_now end
  where attempt_id = p_attempt_id and user_id = p_user_id
    and lease_hash = p_lease_hash
    and status in ('creating', 'customer_ready');
  return found;
end
$function$;

create or replace function public.expire_stripe_checkout_session(
  p_user_id uuid,
  p_attempt_id uuid,
  p_session_id text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.stripe_checkout_attempts
  set status = 'terminal_failed', error_code = 'STRIPE_CHECKOUT_SESSION_EXPIRED',
      updated_at = p_now, completed_at = p_now
  where attempt_id = p_attempt_id and user_id = p_user_id
    and status = 'session_ready' and stripe_session_id = p_session_id;
  return found;
end
$function$;

alter function public.claim_stripe_webhook_event(text, text, timestamptz, timestamptz, text) owner to postgres;
alter function public.fail_stripe_webhook_event(text, text, text, boolean, timestamptz) owner to postgres;
alter function public.finalize_stripe_webhook_event(text, text, uuid, text, text, text, text, timestamptz, boolean, timestamptz) owner to postgres;
alter function public.claim_stripe_checkout_attempt(uuid, text, timestamptz) owner to postgres;
alter function public.record_stripe_checkout_customer(uuid, uuid, text, text, timestamptz) owner to postgres;
alter function public.record_stripe_checkout_session(uuid, uuid, text, text, timestamptz) owner to postgres;
alter function public.fail_stripe_checkout_attempt(uuid, uuid, text, text, boolean, timestamptz) owner to postgres;
alter function public.expire_stripe_checkout_session(uuid, uuid, text, timestamptz) owner to postgres;

revoke all on function public.claim_stripe_webhook_event(text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.fail_stripe_webhook_event(text, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_stripe_webhook_event(text, text, uuid, text, text, text, text, timestamptz, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_stripe_checkout_attempt(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_stripe_checkout_customer(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_stripe_checkout_session(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_stripe_checkout_attempt(uuid, uuid, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.expire_stripe_checkout_session(uuid, uuid, text, timestamptz) from public, anon, authenticated;

grant execute on function public.claim_stripe_webhook_event(text, text, timestamptz, timestamptz, text) to service_role;
grant execute on function public.fail_stripe_webhook_event(text, text, text, boolean, timestamptz) to service_role;
grant execute on function public.finalize_stripe_webhook_event(text, text, uuid, text, text, text, text, timestamptz, boolean, timestamptz) to service_role;
grant execute on function public.claim_stripe_checkout_attempt(uuid, text, timestamptz) to service_role;
grant execute on function public.record_stripe_checkout_customer(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.record_stripe_checkout_session(uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.fail_stripe_checkout_attempt(uuid, uuid, text, text, boolean, timestamptz) to service_role;
grant execute on function public.expire_stripe_checkout_session(uuid, uuid, text, timestamptz) to service_role;

do $migration_postcondition$
begin
  if to_regclass('public.stripe_webhook_events') is null
     or to_regclass('public.stripe_checkout_attempts') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'user_profiles'
         and column_name = 'billing_last_event_created_at'
     ) then
    raise exception 'stripe safety migration postcondition failed';
  end if;
end
$migration_postcondition$;

commit;
