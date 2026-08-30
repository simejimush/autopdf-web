begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  lease_table_exists boolean := pg_catalog.to_regclass('public.rule_execution_leases') is not null;
  system_index_exists boolean := pg_catalog.to_regclass('public.runs_system_started_at_idx') is not null;
  claim_exists boolean := pg_catalog.to_regprocedure(
    'public.claim_guarded_execution(uuid,uuid,text,text,timestamp with time zone)'
  ) is not null;
  finalize_exists boolean := pg_catalog.to_regprocedure(
    'public.finalize_guarded_execution(uuid,uuid,uuid,text,text,integer,integer,integer,text,text,timestamp with time zone)'
  ) is not null;
  cron_exists boolean := pg_catalog.to_regprocedure(
    'public.list_cron_candidates()'
  ) is not null;
  present_count integer;
begin
  if pg_catalog.to_regclass('public.rules') is null
    or pg_catalog.to_regclass('public.runs') is null then
    raise exception 'execution guard requires canonical rules and runs tables';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.rules'::pg_catalog.regclass
      and a.attname = 'id'
      and a.atttypid = 'uuid'::pg_catalog.regtype
      and not a.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.rules'::pg_catalog.regclass
      and a.attname = 'user_id'
      and a.atttypid = 'uuid'::pg_catalog.regtype
      and not a.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.runs'::pg_catalog.regclass
      and a.attname in ('id', 'user_id', 'rule_id')
      and a.atttypid = 'uuid'::pg_catalog.regtype
      and not a.attisdropped
    group by a.attrelid
    having pg_catalog.count(*) = 3
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.runs'::pg_catalog.regclass
      and a.attname = 'started_at'
      and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
      and not a.attisdropped
  ) then
    raise exception 'execution guard canonical identity columns are missing or drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.rules'::pg_catalog.regclass
      and (
        (a.attname in ('is_active', 'is_enabled') and a.atttypid = 'boolean'::pg_catalog.regtype)
        or (a.attname = 'created_at' and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype)
      )
      and not a.attisdropped
    group by a.attrelid
    having pg_catalog.count(*) = 3
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.runs'::pg_catalog.regclass
      and (
        (a.attname in ('trigger', 'status', 'message', 'error_code') and a.atttypid = 'text'::pg_catalog.regtype)
        or (a.attname = 'finished_at' and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype)
        or (a.attname in ('processed_count', 'saved_count', 'skipped_count') and a.atttypid = 'integer'::pg_catalog.regtype)
      )
      and not a.attisdropped
    group by a.attrelid
    having pg_catalog.count(*) = 8
  ) then
    raise exception 'execution guard canonical runtime columns are missing or drifted';
  end if;

  present_count :=
    lease_table_exists::integer +
    system_index_exists::integer +
    claim_exists::integer +
    finalize_exists::integer +
    cron_exists::integer;

  if present_count not in (0, 5) then
    raise exception 'execution guard objects are partially present';
  end if;

  if lease_table_exists then
    if (select pg_catalog.count(*)
        from pg_catalog.pg_attribute a
        where a.attrelid = 'public.rule_execution_leases'::pg_catalog.regclass
          and a.attnum > 0
          and not a.attisdropped) <> 7
      or not exists (
        select 1
        from pg_catalog.pg_attribute a
        where a.attrelid = 'public.rule_execution_leases'::pg_catalog.regclass
          and (
            (a.attname in ('rule_id', 'user_id', 'run_id') and a.atttypid = 'uuid'::pg_catalog.regtype)
            or (a.attname = 'lease_id_hash' and a.atttypid = 'text'::pg_catalog.regtype)
            or (a.attname in ('acquired_at', 'expires_at', 'heartbeat_at') and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype)
          )
          and a.attnotnull
          and not a.attisdropped
        group by a.attrelid
        having pg_catalog.count(*) = 7
      )
      or (select pg_catalog.count(*)
          from pg_catalog.pg_constraint c
          where c.conrelid = 'public.rule_execution_leases'::pg_catalog.regclass
            and c.conname in (
              'rule_execution_leases_pkey',
              'rule_execution_leases_run_id_key',
              'rule_execution_leases_hash_format_check',
              'rule_execution_leases_expiry_check',
              'rule_execution_leases_heartbeat_check'
            )
            and c.convalidated) <> 5 then
      raise exception 'execution guard lease table shape is drifted';
    end if;
  end if;

  if system_index_exists and not exists (
    select 1
    from pg_catalog.pg_indexes i
    where i.schemaname = 'public'
      and i.indexname = 'runs_system_started_at_idx'
      and pg_catalog.lower(i.indexdef) like '%on public.runs using btree (started_at desc)%'
  ) then
    raise exception 'execution guard system index is drifted';
  end if;
end
$preflight$;

create table if not exists public.rule_execution_leases (
  rule_id uuid not null,
  user_id uuid not null,
  run_id uuid not null,
  lease_id_hash text not null,
  acquired_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  heartbeat_at timestamp with time zone not null,
  constraint rule_execution_leases_pkey primary key (rule_id),
  constraint rule_execution_leases_run_id_key unique (run_id),
  constraint rule_execution_leases_hash_format_check
    check (lease_id_hash ~ '^[0-9a-f]{64}$'),
  constraint rule_execution_leases_expiry_check
    check (expires_at > acquired_at),
  constraint rule_execution_leases_heartbeat_check
    check (heartbeat_at >= acquired_at and heartbeat_at <= expires_at)
);

create index if not exists rule_execution_leases_expires_idx
  on public.rule_execution_leases (expires_at);

create index if not exists rule_execution_leases_user_acquired_idx
  on public.rule_execution_leases (user_id, acquired_at desc);

create index if not exists runs_system_started_at_idx
  on public.runs (started_at desc);

alter table public.rule_execution_leases enable row level security;
alter table public.rule_execution_leases force row level security;

revoke all on table public.rule_execution_leases
  from public, anon, authenticated, service_role;

create or replace function public.claim_guarded_execution(
  p_user_id uuid,
  p_rule_id uuid,
  p_trigger text,
  p_lease_id_hash text,
  p_now timestamp with time zone
)
returns table (
  outcome text,
  run_id uuid,
  lease_expires_at timestamp with time zone
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_run_id uuid;
  v_lease_expires_at timestamp with time zone;
  v_utc_day_start timestamp with time zone;
  v_utc_month_start timestamp with time zone;
begin
  if p_user_id is null
    or p_rule_id is null
    or p_trigger is null
    or p_trigger not in ('manual', 'cron')
    or p_lease_id_hash is null
    or p_lease_id_hash !~ '^[0-9a-f]{64}$'
    or p_now is null then
    return query select 'GUARD_STORE_FAILED'::text, null::uuid, null::timestamp with time zone;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('autopdf_execution_guard_v1', 0)
  );

  if not exists (
    select 1
    from public.rules r
    where r.id = p_rule_id
      and r.user_id = p_user_id
  ) then
    return query select 'GUARD_STORE_FAILED'::text, null::uuid, null::timestamp with time zone;
    return;
  end if;

  delete from public.rule_execution_leases l
  where l.expires_at <= p_now;

  v_utc_day_start := (
    pg_catalog.date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC'
  );
  v_utc_month_start := (
    pg_catalog.date_trunc('month', p_now at time zone 'UTC') at time zone 'UTC'
  );

  if (select pg_catalog.count(*) from public.runs r where r.started_at >= p_now - interval '10 minutes') >= 50
    or (select pg_catalog.count(*) from public.runs r where r.started_at >= p_now - interval '1 hour') >= 100
    or (select pg_catalog.count(*) from public.runs r where r.started_at >= v_utc_day_start) >= 500
    or (select pg_catalog.count(*) from public.runs r where r.started_at >= v_utc_month_start) >= 1000 then
    return query select 'SYSTEM_LIMIT_EXCEEDED'::text, null::uuid, null::timestamp with time zone;
    return;
  end if;

  if (select pg_catalog.count(*) from public.runs r where r.user_id = p_user_id and r.started_at >= p_now - interval '1 minute') >= 5
    or (select pg_catalog.count(*) from public.runs r where r.user_id = p_user_id and r.started_at >= p_now - interval '10 minutes') >= 20 then
    return query select 'USER_RATE_LIMIT_EXCEEDED'::text, null::uuid, null::timestamp with time zone;
    return;
  end if;

  if exists (
    select 1 from public.rule_execution_leases l where l.rule_id = p_rule_id
  ) then
    return query select 'RUN_ALREADY_RUNNING'::text, null::uuid, null::timestamp with time zone;
    return;
  end if;

  if exists (
    select 1 from public.rule_execution_leases l where l.user_id = p_user_id
  ) or (select pg_catalog.count(*) from public.rule_execution_leases) >= 5 then
    return query select 'EXECUTION_CONCURRENCY_LIMIT'::text, null::uuid, null::timestamp with time zone;
    return;
  end if;

  insert into public.runs (
    user_id, rule_id, trigger, status, processed_count, saved_count,
    skipped_count, message, started_at
  ) values (
    p_user_id, p_rule_id, p_trigger, 'running', 0, 0, 0, 'Run started', p_now
  )
  returning id into v_run_id;

  v_lease_expires_at := p_now + interval '75 seconds';

  insert into public.rule_execution_leases (
    rule_id, user_id, run_id, lease_id_hash,
    acquired_at, expires_at, heartbeat_at
  ) values (
    p_rule_id, p_user_id, v_run_id, p_lease_id_hash,
    p_now, v_lease_expires_at, p_now
  );

  return query select 'CLAIMED'::text, v_run_id, v_lease_expires_at;
end
$function$;

create or replace function public.finalize_guarded_execution(
  p_run_id uuid,
  p_user_id uuid,
  p_rule_id uuid,
  p_lease_id_hash text,
  p_status text,
  p_processed_count integer,
  p_saved_count integer,
  p_skipped_count integer,
  p_message text,
  p_error_code text,
  p_now timestamp with time zone
)
returns table (
  outcome text,
  run_id uuid,
  status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_updated_count integer;
  v_deleted_count integer;
begin
  if p_run_id is null
    or p_user_id is null
    or p_rule_id is null
    or p_lease_id_hash is null
    or p_lease_id_hash !~ '^[0-9a-f]{64}$'
    or p_status is null
    or p_status not in ('success', 'error')
    or p_message is null
    or pg_catalog.btrim(p_message) = ''
    or p_now is null
    or (
      p_status = 'success'
      and (
        p_processed_count is null or p_processed_count < 0
        or p_saved_count is null or p_saved_count < 0
        or p_skipped_count is null or p_skipped_count < 0
        or p_error_code is not null
      )
    )
    or (
      p_status = 'error'
      and (
        p_processed_count is not null
        or p_saved_count is not null
        or p_skipped_count is not null
        or p_error_code is null
        or p_error_code !~ '^[A-Z][A-Z0-9_]*$'
      )
    ) then
    return query select 'FINALIZE_REJECTED'::text, null::uuid, null::text;
    return;
  end if;

  perform 1
  from public.rule_execution_leases l
  where l.rule_id = p_rule_id
    and l.user_id = p_user_id
    and l.run_id = p_run_id
    and l.lease_id_hash = p_lease_id_hash
  for update;

  if not found then
    return query select 'FINALIZE_REJECTED'::text, null::uuid, null::text;
    return;
  end if;

  update public.runs r
  set
    status = p_status,
    finished_at = p_now,
    processed_count = case when p_status = 'success' then p_processed_count else r.processed_count end,
    saved_count = case when p_status = 'success' then p_saved_count else r.saved_count end,
    skipped_count = case when p_status = 'success' then p_skipped_count else r.skipped_count end,
    message = p_message,
    error_code = case when p_status = 'error' then p_error_code else null end
  where r.id = p_run_id
    and r.user_id = p_user_id
    and r.rule_id = p_rule_id
    and r.status = 'running';

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'guarded run finalization rejected';
  end if;

  delete from public.rule_execution_leases l
  where l.rule_id = p_rule_id
    and l.user_id = p_user_id
    and l.run_id = p_run_id
    and l.lease_id_hash = p_lease_id_hash;

  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1 then
    raise exception 'guarded lease release rejected';
  end if;

  return query select 'FINALIZED'::text, p_run_id, p_status;
end
$function$;

create or replace function public.list_cron_candidates()
returns table (
  rule_id uuid,
  user_id uuid
)
language sql
stable
security definer
set search_path = ''
as $function$
  with ranked as (
    select
      r.id as rule_id,
      r.user_id,
      r.created_at,
      pg_catalog.row_number() over (
        partition by r.user_id
        order by r.created_at asc, r.id asc
      ) as user_rank
    from public.rules r
    where pg_catalog.coalesce(r.is_active, r.is_enabled, true) = true
  )
  select ranked.rule_id, ranked.user_id
  from ranked
  where ranked.user_rank <= 100
  order by ranked.created_at asc, ranked.rule_id asc
  limit 500
$function$;

alter function public.claim_guarded_execution(uuid, uuid, text, text, timestamp with time zone)
  owner to postgres;
alter function public.finalize_guarded_execution(uuid, uuid, uuid, text, text, integer, integer, integer, text, text, timestamp with time zone)
  owner to postgres;
alter function public.list_cron_candidates()
  owner to postgres;

revoke all on function public.claim_guarded_execution(uuid, uuid, text, text, timestamp with time zone)
  from public, anon, authenticated;
revoke all on function public.finalize_guarded_execution(uuid, uuid, uuid, text, text, integer, integer, integer, text, text, timestamp with time zone)
  from public, anon, authenticated;
revoke all on function public.list_cron_candidates()
  from public, anon, authenticated;

grant execute on function public.claim_guarded_execution(uuid, uuid, text, text, timestamp with time zone)
  to service_role;
grant execute on function public.finalize_guarded_execution(uuid, uuid, uuid, text, text, integer, integer, integer, text, text, timestamp with time zone)
  to service_role;
grant execute on function public.list_cron_candidates()
  to service_role;

commit;
