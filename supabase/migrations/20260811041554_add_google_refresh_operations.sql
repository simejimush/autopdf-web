begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $google_refresh_operations_preflight$
declare
  existing_columns integer;
  mismatched_columns integer;
  matching_constraints integer;
  matching_indexes integer;
begin
  if to_regclass('public.google_connections') is null then
    raise exception 'Google refresh operations require public.google_connections';
  end if;

  if to_regclass('public.google_refresh_operations') is not null then
    select count(*) into existing_columns
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'google_refresh_operations';

    with expected(column_name, data_type, is_nullable) as (
      values
        ('operation_id', 'uuid', 'NO'),
        ('user_id', 'uuid', 'NO'),
        ('state', 'text', 'NO'),
        ('expected_credential_version', 'bigint', 'NO'),
        ('result_credential_version', 'bigint', 'YES'),
        ('lease_id_hash', 'text', 'NO'),
        ('lease_expires_at', 'timestamp with time zone', 'NO'),
        ('provider_call_started_at', 'timestamp with time zone', 'YES'),
        ('finished_at', 'timestamp with time zone', 'YES'),
        ('resolved_at', 'timestamp with time zone', 'YES'),
        ('error_code', 'text', 'YES'),
        ('run_id', 'uuid', 'YES'),
        ('created_at', 'timestamp with time zone', 'NO'),
        ('updated_at', 'timestamp with time zone', 'NO')
    ), actual as (
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'google_refresh_operations'
    )
    select count(*) into mismatched_columns
    from expected
    full join actual on actual.column_name = expected.column_name
    where expected.column_name is null
       or actual.column_name is null
       or actual.data_type <> expected.data_type
       or actual.is_nullable <> expected.is_nullable;

    if existing_columns <> 14 or mismatched_columns <> 0 then
      raise exception 'google_refresh_operations has an unexpected or partial shape';
    end if;

    select count(*) into matching_constraints
    from pg_constraint
      where conrelid = 'public.google_refresh_operations'::regclass
        and conname in (
          'google_refresh_operations_pkey',
          'google_refresh_operations_user_id_fkey',
          'google_refresh_operations_run_id_fkey',
          'google_refresh_operations_state_check',
          'google_refresh_operations_expected_version_check',
          'google_refresh_operations_result_version_check',
          'google_refresh_operations_lease_hash_check',
          'google_refresh_operations_state_shape_check'
        )
        and (
          (conname = 'google_refresh_operations_pkey' and contype = 'p')
          or (conname in (
            'google_refresh_operations_user_id_fkey',
            'google_refresh_operations_run_id_fkey'
          ) and contype = 'f')
          or (conname in (
            'google_refresh_operations_state_check',
            'google_refresh_operations_expected_version_check',
            'google_refresh_operations_result_version_check',
            'google_refresh_operations_lease_hash_check',
            'google_refresh_operations_state_shape_check'
          ) and contype = 'c')
        )
        and convalidated;

    select count(*) into matching_indexes
    from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'google_refresh_operations_pkey',
          'google_refresh_operations_user_created_idx',
          'google_refresh_operations_one_active_per_user'
        )
        and (
          indexname = 'google_refresh_operations_pkey'
          or (indexname = 'google_refresh_operations_user_created_idx'
            and indexdef ilike '%(user_id, created_at desc)%')
          or (indexname = 'google_refresh_operations_one_active_per_user'
            and indexdef like '%UNIQUE INDEX%'
            and indexdef ilike '%(user_id)%'
            and indexdef ilike '%where%'
            and indexdef like '%prepared%'
            and indexdef like '%provider_call_started%'
            and indexdef like '%outcome_unknown%')
        );

    if matching_constraints <> 8 or matching_indexes <> 3 then
      raise exception 'google_refresh_operations constraints or indexes are partial';
    end if;
  elsif to_regprocedure('public.prepare_google_refresh_operation(uuid,uuid,bigint,text)') is not null
     or to_regprocedure('public.mark_google_refresh_provider_started(uuid,uuid,bigint,text)') is not null
     or to_regprocedure('public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamp with time zone,timestamp with time zone)') is not null
     or to_regprocedure('public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text)') is not null
     or to_regprocedure('public.get_google_refresh_operation(uuid,uuid)') is not null then
    raise exception 'Orphaned Google refresh operation function detected';
  end if;
end
$google_refresh_operations_preflight$;

create table if not exists public.google_refresh_operations (
  operation_id uuid not null,
  user_id uuid not null,
  state text not null,
  expected_credential_version bigint not null,
  result_credential_version bigint null,
  lease_id_hash text not null,
  lease_expires_at timestamptz not null,
  provider_call_started_at timestamptz null,
  finished_at timestamptz null,
  resolved_at timestamptz null,
  error_code text null,
  run_id uuid null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint google_refresh_operations_pkey primary key (operation_id),
  constraint google_refresh_operations_user_id_fkey
    foreign key (user_id) references public.google_connections (user_id) on delete cascade,
  constraint google_refresh_operations_run_id_fkey
    foreign key (run_id) references public.runs (id) on delete set null,
  constraint google_refresh_operations_state_check check (
    state in (
      'prepared', 'retryable', 'provider_call_started', 'completed',
      'failed_terminal', 'outcome_unknown', 'resolved'
    )
  ),
  constraint google_refresh_operations_expected_version_check
    check (expected_credential_version >= 0),
  constraint google_refresh_operations_result_version_check
    check (result_credential_version is null or result_credential_version >= 0),
  constraint google_refresh_operations_lease_hash_check
    check (lease_id_hash ~ '^[0-9a-f]{64}$'),
  constraint google_refresh_operations_state_shape_check check (
    (state in ('prepared', 'retryable')
      and provider_call_started_at is null
      and result_credential_version is null
      and finished_at is null)
    or (state in ('provider_call_started', 'outcome_unknown', 'failed_terminal')
      and provider_call_started_at is not null
      and result_credential_version is null)
    or (state = 'completed'
      and provider_call_started_at is not null
      and finished_at is not null
      and result_credential_version = expected_credential_version + 1)
    or (state = 'resolved' and resolved_at is not null)
  )
);

create index if not exists google_refresh_operations_user_created_idx
  on public.google_refresh_operations (user_id, created_at desc);

create unique index if not exists google_refresh_operations_one_active_per_user
  on public.google_refresh_operations (user_id)
  where state in ('prepared', 'provider_call_started', 'outcome_unknown');

alter table public.google_refresh_operations enable row level security;
alter table public.google_refresh_operations force row level security;

revoke all on table public.google_refresh_operations
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.google_refresh_operations to service_role;

drop policy if exists google_refresh_operations_select_own
  on public.google_refresh_operations;
create policy google_refresh_operations_select_own
  on public.google_refresh_operations for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.prepare_google_refresh_operation(
  p_user_id uuid,
  p_operation_id uuid,
  p_expected_credential_version bigint,
  p_lease_id_hash text
)
returns table (operation_state text, credential_version bigint)
language plpgsql
volatile
security invoker
set search_path = ''
as $prepare$
declare
  claim_timestamp timestamptz := statement_timestamp();
  current_operation public.google_refresh_operations%rowtype;
  claimed_version bigint;
begin
  if p_expected_credential_version < 0
     or p_lease_id_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid Google refresh operation input' using errcode = '22023';
  end if;

  select * into current_operation
  from public.google_refresh_operations
  where operation_id = p_operation_id and user_id = p_user_id
  for update;

  if found then
    if current_operation.expected_credential_version <> p_expected_credential_version then
      return query select 'failed_terminal'::text, null::bigint;
      return;
    end if;
    if current_operation.state = 'completed' then
      return query select 'completed'::text, current_operation.result_credential_version;
      return;
    end if;
    if current_operation.state = 'outcome_unknown' then
      return query select 'outcome_unknown'::text, null::bigint;
      return;
    end if;
    if current_operation.state in ('failed_terminal', 'resolved') then
      return query select 'failed_terminal'::text, null::bigint;
      return;
    end if;
    if current_operation.state = 'provider_call_started' then
      if current_operation.lease_expires_at <= claim_timestamp then
        update public.google_refresh_operations
        set state = 'outcome_unknown', error_code = 'GOOGLE_REFRESH_OUTCOME_UNKNOWN',
            finished_at = claim_timestamp, updated_at = claim_timestamp
        where operation_id = p_operation_id and user_id = p_user_id;
        update public.google_connections
        set status = 'error', reauth_required = true,
            last_error_code = 'GOOGLE_REFRESH_OUTCOME_UNKNOWN',
            last_error_at = claim_timestamp, updated_at = claim_timestamp,
            refresh_lease_id_hash = null, refresh_lease_expires_at = null
        where user_id = p_user_id
          and credential_version = p_expected_credential_version
          and refresh_lease_id_hash = current_operation.lease_id_hash;
        return query select 'outcome_unknown'::text, null::bigint;
      else
        return query select 'provider_call_started'::text, null::bigint;
      end if;
      return;
    end if;
    if current_operation.state = 'prepared'
       and current_operation.lease_expires_at > claim_timestamp then
      return query select 'provider_call_started'::text, null::bigint;
      return;
    end if;
  end if;

  update public.google_connections as connection
  set refresh_lease_id_hash = p_lease_id_hash,
      refresh_lease_expires_at = claim_timestamp + interval '90 seconds'
  where connection.user_id = p_user_id
    and connection.status = 'connected'
    and connection.credential_version = p_expected_credential_version
    and (
      (connection.refresh_lease_id_hash is null and connection.refresh_lease_expires_at is null)
      or connection.refresh_lease_expires_at <= claim_timestamp
    )
  returning connection.credential_version into claimed_version;

  if claimed_version is null then
    return query select 'provider_call_started'::text, null::bigint;
    return;
  end if;

  update public.google_refresh_operations
  set state = 'resolved', resolved_at = claim_timestamp,
      updated_at = claim_timestamp
  where user_id = p_user_id
    and state = 'outcome_unknown'
    and expected_credential_version < p_expected_credential_version;

  if current_operation.operation_id is null then
    insert into public.google_refresh_operations (
      operation_id, user_id, state, expected_credential_version,
      lease_id_hash, lease_expires_at
    ) values (
      p_operation_id, p_user_id, 'prepared', p_expected_credential_version,
      p_lease_id_hash, claim_timestamp + interval '90 seconds'
    );
  else
    update public.google_refresh_operations
    set state = 'prepared', lease_id_hash = p_lease_id_hash,
        lease_expires_at = claim_timestamp + interval '90 seconds',
        error_code = null, updated_at = claim_timestamp
    where operation_id = p_operation_id and user_id = p_user_id
      and state in ('prepared', 'retryable');
  end if;

  return query select 'prepared'::text, claimed_version;
end
$prepare$;

create or replace function public.mark_google_refresh_provider_started(
  p_user_id uuid, p_operation_id uuid,
  p_expected_credential_version bigint, p_lease_id_hash text
)
returns table (operation_state text, credential_version bigint)
language plpgsql volatile security invoker set search_path = ''
as $mark$
declare changed_id uuid;
begin
  update public.google_refresh_operations as operation
  set state = 'provider_call_started',
      provider_call_started_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where operation.operation_id = p_operation_id
    and operation.user_id = p_user_id
    and operation.state = 'prepared'
    and operation.expected_credential_version = p_expected_credential_version
    and operation.lease_id_hash = p_lease_id_hash
    and exists (
      select 1 from public.google_connections as connection
      where connection.user_id = p_user_id
        and connection.status = 'connected'
        and connection.credential_version = p_expected_credential_version
        and connection.refresh_lease_id_hash = p_lease_id_hash
    )
  returning operation.operation_id into changed_id;
  if changed_id is null then
    return query select 'failed_terminal'::text, null::bigint;
  else
    return query select 'provider_call_started'::text, p_expected_credential_version;
  end if;
end
$mark$;

create or replace function public.finalize_google_refresh_operation(
  p_user_id uuid, p_operation_id uuid,
  p_expected_credential_version bigint, p_lease_id_hash text,
  p_access_token_enc text, p_refresh_token_enc text,
  p_refresh_token_present boolean, p_token_expiry_at timestamptz,
  p_timestamp timestamptz
)
returns table (operation_state text, credential_version bigint)
language plpgsql volatile security invoker set search_path = ''
as $finalize$
declare next_version bigint := p_expected_credential_version + 1;
declare saved_version bigint;
begin
  if p_access_token_enc is null or btrim(p_access_token_enc) = ''
     or (p_refresh_token_present and (p_refresh_token_enc is null or btrim(p_refresh_token_enc) = '')) then
    raise exception 'Invalid encrypted Google refresh result' using errcode = '22023';
  end if;

  update public.google_connections as connection
  set access_token_enc = p_access_token_enc,
      refresh_token_enc = case when p_refresh_token_present
        then p_refresh_token_enc else connection.refresh_token_enc end,
      token_expiry_at = p_token_expiry_at,
      last_verified_at = p_timestamp,
      updated_at = p_timestamp,
      credential_version = next_version,
      refresh_lease_id_hash = null,
      refresh_lease_expires_at = null
  where connection.user_id = p_user_id
    and connection.status = 'connected'
    and connection.credential_version = p_expected_credential_version
    and connection.refresh_lease_id_hash = p_lease_id_hash
    and exists (
      select 1 from public.google_refresh_operations as operation
      where operation.operation_id = p_operation_id
        and operation.user_id = p_user_id
        and operation.state = 'provider_call_started'
        and operation.expected_credential_version = p_expected_credential_version
        and operation.lease_id_hash = p_lease_id_hash
    )
  returning connection.credential_version into saved_version;

  if saved_version is null then
    update public.google_refresh_operations
    set state = 'outcome_unknown', error_code = 'GOOGLE_REFRESH_OUTCOME_UNKNOWN',
        finished_at = statement_timestamp(), updated_at = statement_timestamp()
    where operation_id = p_operation_id and user_id = p_user_id
      and state = 'provider_call_started';
    update public.google_connections
    set status = 'error', reauth_required = true,
        last_error_code = 'GOOGLE_REFRESH_OUTCOME_UNKNOWN',
        last_error_at = statement_timestamp(), updated_at = statement_timestamp(),
        refresh_lease_id_hash = null, refresh_lease_expires_at = null
    where user_id = p_user_id
      and credential_version = p_expected_credential_version;
    return query select 'outcome_unknown'::text, null::bigint;
    return;
  end if;

  update public.google_refresh_operations
  set state = 'completed', result_credential_version = saved_version,
      finished_at = statement_timestamp(), error_code = null,
      updated_at = statement_timestamp()
  where operation_id = p_operation_id and user_id = p_user_id
    and state = 'provider_call_started'
    and expected_credential_version = p_expected_credential_version
    and lease_id_hash = p_lease_id_hash;
  if not found then
    raise exception 'Google refresh operation finalize lost ownership';
  end if;
  return query select 'completed'::text, saved_version;
end
$finalize$;

create or replace function public.transition_google_refresh_operation(
  p_user_id uuid, p_operation_id uuid,
  p_expected_credential_version bigint, p_lease_id_hash text,
  p_target_state text, p_error_code text
)
returns table (operation_state text, credential_version bigint)
language plpgsql volatile security invoker set search_path = ''
as $transition$
declare changed_id uuid;
begin
  if (p_target_state = 'retryable' and p_error_code <> 'GOOGLE_TOKEN_WRITE_DISABLED')
     or (p_target_state = 'failed_terminal' and p_error_code <> 'GOOGLE_TOKEN_INVALID')
     or (p_target_state = 'outcome_unknown' and p_error_code <> 'GOOGLE_REFRESH_OUTCOME_UNKNOWN')
     or p_target_state not in ('retryable', 'failed_terminal', 'outcome_unknown') then
    raise exception 'Invalid Google refresh transition' using errcode = '22023';
  end if;

  update public.google_refresh_operations
  set state = p_target_state,
      error_code = p_error_code,
      finished_at = case when p_target_state = 'retryable' then null else statement_timestamp() end,
      updated_at = statement_timestamp()
  where operation_id = p_operation_id and user_id = p_user_id
    and expected_credential_version = p_expected_credential_version
    and lease_id_hash = p_lease_id_hash
    and ((p_target_state = 'retryable' and state in ('prepared', 'retryable'))
      or (p_target_state <> 'retryable' and state in ('provider_call_started', p_target_state)))
  returning operation_id into changed_id;

  if changed_id is null then
    return query select 'outcome_unknown'::text, null::bigint;
    return;
  end if;

  update public.google_connections
  set status = case when p_target_state = 'retryable' then status else 'error' end,
      reauth_required = case when p_target_state = 'retryable' then reauth_required else true end,
      last_error_code = case when p_target_state = 'retryable' then last_error_code else p_error_code end,
      last_error_at = case when p_target_state = 'retryable' then last_error_at else statement_timestamp() end,
      updated_at = statement_timestamp(),
      refresh_lease_id_hash = null, refresh_lease_expires_at = null
  where user_id = p_user_id
    and credential_version = p_expected_credential_version
    and refresh_lease_id_hash = p_lease_id_hash;

  return query select p_target_state, p_expected_credential_version;
end
$transition$;

create or replace function public.get_google_refresh_operation(
  p_user_id uuid, p_operation_id uuid
)
returns table (operation_state text, credential_version bigint)
language sql stable security invoker set search_path = ''
as $inspect$
  select operation.state, operation.result_credential_version
  from public.google_refresh_operations as operation
  where operation.user_id = p_user_id
    and operation.operation_id = p_operation_id
$inspect$;

alter function public.prepare_google_refresh_operation(uuid,uuid,bigint,text) owner to postgres;
alter function public.mark_google_refresh_provider_started(uuid,uuid,bigint,text) owner to postgres;
alter function public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamptz,timestamptz) owner to postgres;
alter function public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text) owner to postgres;
alter function public.get_google_refresh_operation(uuid,uuid) owner to postgres;

revoke execute on function public.prepare_google_refresh_operation(uuid,uuid,bigint,text) from public, anon, authenticated;
revoke execute on function public.mark_google_refresh_provider_started(uuid,uuid,bigint,text) from public, anon, authenticated;
revoke execute on function public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text) from public, anon, authenticated;
revoke execute on function public.get_google_refresh_operation(uuid,uuid) from public, anon, authenticated;

grant execute on function public.prepare_google_refresh_operation(uuid,uuid,bigint,text) to service_role;
grant execute on function public.mark_google_refresh_provider_started(uuid,uuid,bigint,text) to service_role;
grant execute on function public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamptz,timestamptz) to service_role;
grant execute on function public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text) to service_role;
grant execute on function public.get_google_refresh_operation(uuid,uuid) to service_role;

commit;
