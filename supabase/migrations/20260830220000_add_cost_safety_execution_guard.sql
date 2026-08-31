begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  lease_table_exists boolean := pg_catalog.to_regclass('public.rule_execution_leases') is not null;
  lease_expires_index_exists boolean := pg_catalog.to_regclass('public.rule_execution_leases_expires_idx') is not null;
  lease_user_index_exists boolean := pg_catalog.to_regclass('public.rule_execution_leases_user_acquired_idx') is not null;
  system_index_exists boolean := pg_catalog.to_regclass('public.runs_system_started_at_idx') is not null;
  claim_exists boolean := pg_catalog.to_regprocedure(
    'public.claim_guarded_execution(uuid,uuid,text,text)'
  ) is not null;
  finalize_exists boolean := pg_catalog.to_regprocedure(
    'public.finalize_guarded_execution(uuid,uuid,uuid,text,text,integer,integer,integer,text,text)'
  ) is not null;
  cron_exists boolean := pg_catalog.to_regprocedure(
    'public.list_cron_candidates()'
  ) is not null;
  function_names constant text[] := array[
    'claim_guarded_execution',
    'finalize_guarded_execution',
    'list_cron_candidates'
  ];
  function_signatures constant text[] := array[
    'public.claim_guarded_execution(uuid,uuid,text,text)',
    'public.finalize_guarded_execution(uuid,uuid,uuid,text,text,integer,integer,integer,text,text)',
    'public.list_cron_candidates()'
  ];
  function_identity_arguments constant text[] := array[
    'p_user_id uuid, p_rule_id uuid, p_trigger text, p_lease_id_hash text',
    'p_run_id uuid, p_user_id uuid, p_rule_id uuid, p_lease_id_hash text, p_status text, p_processed_count integer, p_saved_count integer, p_skipped_count integer, p_message text, p_error_code text',
    ''
  ];
  function_results constant text[] := array[
    'TABLE(outcome text, run_id uuid, lease_expires_at timestamp with time zone)',
    'TABLE(outcome text, run_id uuid, status text)',
    'TABLE(rule_id uuid, user_id uuid)'
  ];
  function_languages constant text[] := array['plpgsql', 'plpgsql', 'sql'];
  function_volatility constant "char"[] := array['v', 'v', 's']::"char"[];
  function_source_hashes constant text[] := array[
    '707dea2c3e22fe3cdeb45ea17e697a97',
    'acb72251d3979a718d8305c939445caf',
    '9d1a6fee8f6ed41fe69edefe6653af31'
  ];
  present_count integer;
  function_count integer;
  function_index integer;
  target_function oid;
  function_row record;
  execute_acl_count integer;
  unexpected_execute_acl_count integer;
  rule_id_attnum smallint;
  user_id_attnum smallint;
  run_id_attnum smallint;
  lease_hash_attnum smallint;
  acquired_at_attnum smallint;
  expires_at_attnum smallint;
  heartbeat_at_attnum smallint;
  runs_started_at_attnum smallint;
begin
  if pg_catalog.to_regrole('postgres') is null
    or pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('service_role') is null then
    raise exception 'execution guard requires canonical Supabase roles';
  end if;

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
      and a.attnotnull
      and not a.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.rules'::pg_catalog.regclass
      and a.attname = 'user_id'
      and a.atttypid = 'uuid'::pg_catalog.regtype
      and a.attnotnull
      and not a.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.runs'::pg_catalog.regclass
      and a.attname in ('id', 'user_id', 'rule_id')
      and a.atttypid = 'uuid'::pg_catalog.regtype
      and a.attnotnull
      and not a.attisdropped
    group by a.attrelid
    having pg_catalog.count(*) = 3
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid
     and d.adnum = a.attnum
    where a.attrelid = 'public.runs'::pg_catalog.regclass
      and a.attname = 'started_at'
      and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
      and a.attnotnull
      and a.atthasdef
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'now()'
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
        or (a.attname = 'created_at' and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype and a.attnotnull)
      )
      and not a.attisdropped
    group by a.attrelid
    having pg_catalog.count(*) = 3
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.runs'::pg_catalog.regclass
      and (
        (a.attname in ('trigger', 'status') and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
        or (a.attname in ('message', 'error_code') and a.atttypid = 'text'::pg_catalog.regtype and not a.attnotnull)
        or (a.attname = 'finished_at' and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype and not a.attnotnull)
        or (a.attname in ('processed_count', 'saved_count', 'skipped_count') and a.atttypid = 'integer'::pg_catalog.regtype and a.attnotnull)
      )
      and not a.attisdropped
    group by a.attrelid
    having pg_catalog.count(*) = 8
  ) then
    raise exception 'execution guard canonical runtime columns are missing or drifted';
  end if;

  present_count :=
    lease_table_exists::integer +
    lease_expires_index_exists::integer +
    lease_user_index_exists::integer +
    system_index_exists::integer +
    claim_exists::integer +
    finalize_exists::integer +
    cron_exists::integer;

  select pg_catalog.count(*)
    into function_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any (function_names);

  select a.attnum into runs_started_at_attnum
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.runs'::pg_catalog.regclass
    and a.attname = 'started_at'
    and not a.attisdropped;

  if present_count = 0 and function_count = 0 then
    if exists (
      select 1
      from pg_catalog.pg_index x
      where x.indrelid = 'public.runs'::pg_catalog.regclass
        and x.indisvalid
        and x.indisready
        and x.indnatts = 1
        and x.indnkeyatts = 1
        and x.indkey::smallint[] = array[runs_started_at_attnum]::smallint[]
        and x.indoption::smallint[] = array[3]::smallint[]
        and x.indpred is null
        and x.indexprs is null
    ) then
      raise exception 'execution guard equivalent runs system index has an unexpected name';
    end if;
    return;
  end if;

  if present_count <> 7 or function_count <> 3 then
    raise exception 'execution guard objects are partially present';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'public.rule_execution_leases'::pg_catalog.regclass
      and c.relkind = 'r'
      and c.relpersistence = 'p'
      and c.relrowsecurity
      and c.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
      and not exists (
        select 1
        from pg_catalog.aclexplode(
          pg_catalog.coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
        ) acl
        where acl.grantee <> c.relowner
      )
  )
    or pg_catalog.has_table_privilege('anon', 'public.rule_execution_leases', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or pg_catalog.has_table_privilege('authenticated', 'public.rule_execution_leases', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or pg_catalog.has_table_privilege('service_role', 'public.rule_execution_leases', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or exists (
      select 1 from pg_catalog.pg_policy p
      where p.polrelid = 'public.rule_execution_leases'::pg_catalog.regclass
    ) then
    raise exception 'execution guard lease table owner, RLS, policy, or ACL drifted';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and a.attnum > 0
        and not a.attisdropped) <> 7
    or exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and a.attnum > 0
        and not a.attisdropped
        and (
          not a.attnotnull
          or a.atthasdef
          or a.attidentity <> ''
          or a.attgenerated <> ''
          or (a.attname in ('rule_id', 'user_id', 'run_id') and a.atttypid <> 'uuid'::pg_catalog.regtype)
          or (a.attname = 'lease_id_hash' and a.atttypid <> 'text'::pg_catalog.regtype)
          or (a.attname in ('acquired_at', 'expires_at', 'heartbeat_at') and a.atttypid <> 'timestamp with time zone'::pg_catalog.regtype)
          or a.attname not in ('rule_id', 'user_id', 'run_id', 'lease_id_hash', 'acquired_at', 'expires_at', 'heartbeat_at')
        )
    ) then
    raise exception 'execution guard lease table columns drifted';
  end if;

  select
    max(a.attnum) filter (where a.attname = 'rule_id'),
    max(a.attnum) filter (where a.attname = 'user_id'),
    max(a.attnum) filter (where a.attname = 'run_id'),
    max(a.attnum) filter (where a.attname = 'lease_id_hash'),
    max(a.attnum) filter (where a.attname = 'acquired_at'),
    max(a.attnum) filter (where a.attname = 'expires_at'),
    max(a.attnum) filter (where a.attname = 'heartbeat_at')
  into
    rule_id_attnum, user_id_attnum, run_id_attnum, lease_hash_attnum,
    acquired_at_attnum, expires_at_attnum, heartbeat_at_attnum
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.rule_execution_leases'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.rule_execution_leases'::pg_catalog.regclass) <> 5
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and c.conname = 'rule_execution_leases_pkey'
        and c.contype = 'p'
        and c.convalidated
        and c.conkey = array[rule_id_attnum]::smallint[]
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and c.conname = 'rule_execution_leases_run_id_key'
        and c.contype = 'u'
        and c.convalidated
        and c.conkey = array[run_id_attnum]::smallint[]
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and c.conname = 'rule_execution_leases_hash_format_check'
        and c.contype = 'c'
        and c.convalidated
        and c.conkey = array[lease_hash_attnum]::smallint[]
        and pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(c.conbin, c.conrelid, true), '[()[:space:]]', '', 'g'
        )) = 'lease_id_hash~''^[0-9a-f]{64}$''::text'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and c.conname = 'rule_execution_leases_expiry_check'
        and c.contype = 'c'
        and c.convalidated
        and c.conkey @> array[acquired_at_attnum, expires_at_attnum]::smallint[]
        and c.conkey <@ array[acquired_at_attnum, expires_at_attnum]::smallint[]
        and pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(c.conbin, c.conrelid, true), '[()[:space:]]', '', 'g'
        )) = 'expires_at>acquired_at'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and c.conname = 'rule_execution_leases_heartbeat_check'
        and c.contype = 'c'
        and c.convalidated
        and c.conkey @> array[acquired_at_attnum, expires_at_attnum, heartbeat_at_attnum]::smallint[]
        and c.conkey <@ array[acquired_at_attnum, expires_at_attnum, heartbeat_at_attnum]::smallint[]
        and pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(c.conbin, c.conrelid, true), '[()[:space:]]', '', 'g'
        )) = 'heartbeat_at>=acquired_atandheartbeat_at<=expires_at'
    ) then
    raise exception 'execution guard lease table constraints drifted';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_index x
      where x.indrelid = 'public.rule_execution_leases'::pg_catalog.regclass) <> 4
    or not exists (
      select 1
      from pg_catalog.pg_index x
      join pg_catalog.pg_class i on i.oid = x.indexrelid
      where x.indrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and i.relname = 'rule_execution_leases_expires_idx'
        and x.indisvalid and x.indisready and x.indislive
        and not x.indisunique and not x.indisprimary
        and x.indpred is null and x.indexprs is null
        and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(x.indexrelid)), '[[:space:]]', '', 'g') =
          'createindexrule_execution_leases_expires_idxonpublic.rule_execution_leasesusingbtree(expires_at)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_index x
      join pg_catalog.pg_class i on i.oid = x.indexrelid
      where x.indrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and i.relname = 'rule_execution_leases_user_acquired_idx'
        and x.indisvalid and x.indisready and x.indislive
        and not x.indisunique and not x.indisprimary
        and x.indpred is null and x.indexprs is null
        and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(x.indexrelid)), '[[:space:]]', '', 'g') =
          'createindexrule_execution_leases_user_acquired_idxonpublic.rule_execution_leasesusingbtree(user_id,acquired_atdesc)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_index x
      join pg_catalog.pg_class i on i.oid = x.indexrelid
      where x.indrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and i.relname = 'rule_execution_leases_pkey'
        and x.indisvalid and x.indisready and x.indislive
        and x.indisunique and x.indisprimary
        and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(x.indexrelid)), '[[:space:]]', '', 'g') =
          'createuniqueindexrule_execution_leases_pkeyonpublic.rule_execution_leasesusingbtree(rule_id)'
    )
    or not exists (
      select 1
      from pg_catalog.pg_index x
      join pg_catalog.pg_class i on i.oid = x.indexrelid
      where x.indrelid = 'public.rule_execution_leases'::pg_catalog.regclass
        and i.relname = 'rule_execution_leases_run_id_key'
        and x.indisvalid and x.indisready and x.indislive
        and x.indisunique and not x.indisprimary
        and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(x.indexrelid)), '[[:space:]]', '', 'g') =
          'createuniqueindexrule_execution_leases_run_id_keyonpublic.rule_execution_leasesusingbtree(run_id)'
    ) then
    raise exception 'execution guard lease table indexes drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index x
    join pg_catalog.pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'public.runs'::pg_catalog.regclass
      and i.relname = 'runs_system_started_at_idx'
      and x.indisvalid and x.indisready and x.indislive
      and not x.indisunique and not x.indisprimary
      and x.indpred is null and x.indexprs is null
      and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(x.indexrelid)), '[[:space:]]', '', 'g') =
        'createindexruns_system_started_at_idxonpublic.runsusingbtree(started_atdesc)'
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_index x
    where x.indrelid = 'public.runs'::pg_catalog.regclass
      and x.indisvalid
      and x.indisready
      and x.indnatts = 1
      and x.indnkeyatts = 1
      and x.indkey::smallint[] = array[runs_started_at_attnum]::smallint[]
      and x.indoption::smallint[] = array[3]::smallint[]
      and x.indpred is null
      and x.indexprs is null
  ) <> 1 then
    raise exception 'execution guard system index is drifted';
  end if;

  for function_index in 1..pg_catalog.array_length(function_names, 1) loop
    target_function := pg_catalog.to_regprocedure(function_signatures[function_index]);

    select
      pg_catalog.pg_get_userbyid(p.proowner) as owner,
      l.lanname as language,
      p.prokind, p.provolatile, p.prosecdef, p.proisstrict, p.proleakproof,
      p.proparallel, p.proconfig, p.proacl,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_catalog.pg_get_function_result(p.oid) as function_result,
      pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) as source_hash,
      exists (
        select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      ) as extension_owned
    into function_row
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = target_function;

    if target_function is null
      or function_row.owner <> 'postgres'
      or function_row.language <> function_languages[function_index]
      or function_row.prokind <> 'f'
      or function_row.provolatile <> function_volatility[function_index]
      or not function_row.prosecdef
      or function_row.proisstrict
      or function_row.proleakproof
      or function_row.proparallel <> 'u'
      or function_row.proconfig is distinct from array['search_path=""']::text[]
      or function_row.identity_arguments <> function_identity_arguments[function_index]
      or function_row.function_result <> function_results[function_index]
      or function_row.source_hash <> function_source_hashes[function_index]
      or function_row.extension_owned then
      raise exception 'public.% canonical function metadata or body drifted', function_names[function_index];
    end if;

    select
      pg_catalog.count(*),
      pg_catalog.count(*) filter (
        where acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantor <> pg_catalog.to_regrole('postgres')
          or acl.grantee not in (
            pg_catalog.to_regrole('postgres'),
            pg_catalog.to_regrole('service_role')
          )
      )
    into execute_acl_count, unexpected_execute_acl_count
    from pg_catalog.aclexplode(function_row.proacl) acl;

    if function_row.proacl is null
      or execute_acl_count <> 2
      or unexpected_execute_acl_count <> 0
      or not pg_catalog.has_function_privilege('postgres', target_function, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', target_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', target_function, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', target_function, 'EXECUTE') then
      raise exception 'public.% canonical function ACL drifted', function_names[function_index];
    end if;
  end loop;
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

alter table public.rule_execution_leases owner to postgres;
alter table public.rule_execution_leases enable row level security;
alter table public.rule_execution_leases force row level security;

revoke all on table public.rule_execution_leases
  from public, anon, authenticated, service_role;

create or replace function public.claim_guarded_execution(
  p_user_id uuid,
  p_rule_id uuid,
  p_trigger text,
  p_lease_id_hash text
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
  v_now timestamp with time zone;
  v_lease_expires_at timestamp with time zone;
  v_utc_day_start timestamp with time zone;
  v_utc_month_start timestamp with time zone;
begin
  if p_user_id is null
    or p_rule_id is null
    or p_trigger is null
    or p_trigger not in ('manual', 'cron')
    or p_lease_id_hash is null
    or p_lease_id_hash !~ '^[0-9a-f]{64}$' then
    return query select 'GUARD_STORE_FAILED'::text, null::uuid, null::timestamp with time zone;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('autopdf_execution_guard_v1', 0)
  );

  v_now := pg_catalog.statement_timestamp();

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
  where l.expires_at <= v_now;

  v_utc_day_start := (
    pg_catalog.date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC'
  );
  v_utc_month_start := (
    pg_catalog.date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC'
  );

  if (select pg_catalog.count(*) from public.runs r where r.started_at >= v_now - interval '10 minutes') >= 50
    or (select pg_catalog.count(*) from public.runs r where r.started_at >= v_now - interval '1 hour') >= 100
    or (select pg_catalog.count(*) from public.runs r where r.started_at >= v_utc_day_start) >= 500
    or (select pg_catalog.count(*) from public.runs r where r.started_at >= v_utc_month_start) >= 1000 then
    return query select 'SYSTEM_LIMIT_EXCEEDED'::text, null::uuid, null::timestamp with time zone;
    return;
  end if;

  if (select pg_catalog.count(*) from public.runs r where r.user_id = p_user_id and r.started_at >= v_now - interval '1 minute') >= 5
    or (select pg_catalog.count(*) from public.runs r where r.user_id = p_user_id and r.started_at >= v_now - interval '10 minutes') >= 20 then
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
    p_user_id, p_rule_id, p_trigger, 'running', 0, 0, 0, 'Run started', v_now
  )
  returning id into v_run_id;

  v_lease_expires_at := v_now + interval '75 seconds';

  insert into public.rule_execution_leases (
    rule_id, user_id, run_id, lease_id_hash,
    acquired_at, expires_at, heartbeat_at
  ) values (
    p_rule_id, p_user_id, v_run_id, p_lease_id_hash,
    v_now, v_lease_expires_at, v_now
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
  p_error_code text
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
  v_now timestamp with time zone;
begin
  v_now := pg_catalog.statement_timestamp();

  if p_run_id is null
    or p_user_id is null
    or p_rule_id is null
    or p_lease_id_hash is null
    or p_lease_id_hash !~ '^[0-9a-f]{64}$'
    or p_status is null
    or p_status not in ('success', 'error')
    or p_message is null
    or pg_catalog.btrim(p_message) = ''
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
    finished_at = v_now,
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

alter function public.claim_guarded_execution(uuid, uuid, text, text)
  owner to postgres;
alter function public.finalize_guarded_execution(uuid, uuid, uuid, text, text, integer, integer, integer, text, text)
  owner to postgres;
alter function public.list_cron_candidates()
  owner to postgres;

revoke all on function public.claim_guarded_execution(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.finalize_guarded_execution(uuid, uuid, uuid, text, text, integer, integer, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.list_cron_candidates()
  from public, anon, authenticated;

grant execute on function public.claim_guarded_execution(uuid, uuid, text, text)
  to service_role;
grant execute on function public.finalize_guarded_execution(uuid, uuid, uuid, text, text, integer, integer, integer, text, text)
  to service_role;
grant execute on function public.list_cron_candidates()
  to service_role;

commit;
