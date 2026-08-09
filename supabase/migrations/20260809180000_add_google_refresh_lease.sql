begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $google_refresh_lease_preflight$
declare
  target_table regclass;
  lease_id_attnum smallint;
  lease_id_type text;
  lease_id_not_null boolean;
  lease_id_default text;
  expires_attnum smallint;
  expires_type text;
  expires_not_null boolean;
  expires_default text;
  pair_constraint record;
  digest_constraint record;
  claim_function oid;
  claim_function_definition text;
  unexpected_dependencies text[];
begin
  target_table := to_regclass('public.google_connections');
  if target_table is null then
    raise exception 'AutoPDF refresh lease migration requires public.google_connections';
  end if;

  lock table public.google_connections in access exclusive mode;

  select a.attnum, format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    into lease_id_attnum, lease_id_type, lease_id_not_null, lease_id_default
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = target_table
    and a.attname = 'refresh_lease_id_hash'
    and not a.attisdropped;

  select a.attnum, format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    into expires_attnum, expires_type, expires_not_null, expires_default
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = target_table
    and a.attname = 'refresh_lease_expires_at'
    and not a.attisdropped;

  claim_function := to_regprocedure(
    'public.claim_google_credential_refresh_lease(uuid,text,bigint,text)'
  );

  if lease_id_attnum is null and expires_attnum is null then
    if claim_function is not null
       or exists (
         select 1
         from pg_catalog.pg_constraint c
         where c.conrelid = target_table
           and c.conname in (
             'google_connections_refresh_lease_pair',
             'google_connections_refresh_lease_hash_format'
           )
       ) then
      raise exception 'google_connections refresh lease schema is partially present';
    end if;
    return;
  end if;

  if lease_id_attnum is null or expires_attnum is null then
    raise exception 'google_connections refresh lease columns must be both absent or both present';
  end if;

  if lease_id_type is distinct from 'text'
     or lease_id_not_null
     or lease_id_default is not null then
    raise exception 'google_connections.refresh_lease_id_hash must be nullable text without a default';
  end if;
  if expires_type is distinct from 'timestamp with time zone'
     or expires_not_null
     or expires_default is not null then
    raise exception 'google_connections.refresh_lease_expires_at must be nullable timestamptz without a default';
  end if;

  select c.contype, c.convalidated, c.conkey,
         pg_catalog.pg_get_expr(c.conbin, c.conrelid) as definition
    into pair_constraint
  from pg_catalog.pg_constraint c
  where c.conrelid = target_table
    and c.conname = 'google_connections_refresh_lease_pair';

  if pair_constraint is null
     or pair_constraint.contype <> 'c'
     or not pair_constraint.convalidated
     or pair_constraint.conkey <> array[lease_id_attnum, expires_attnum]::smallint[]
     or lower(regexp_replace(
       pair_constraint.definition, '[()[:space:]]', '', 'g'
     )) <> 'refresh_lease_id_hashisnullandrefresh_lease_expires_atisnullorrefresh_lease_id_hashisnotnullandrefresh_lease_expires_atisnotnull' then
    raise exception 'google_connections refresh lease pair constraint is missing or unexpected';
  end if;

  select c.contype, c.convalidated, c.conkey,
         pg_catalog.pg_get_expr(c.conbin, c.conrelid) as definition
    into digest_constraint
  from pg_catalog.pg_constraint c
  where c.conrelid = target_table
    and c.conname = 'google_connections_refresh_lease_hash_format';

  if digest_constraint is null
     or digest_constraint.contype <> 'c'
     or not digest_constraint.convalidated
     or digest_constraint.conkey <> array[lease_id_attnum]::smallint[]
     or lower(regexp_replace(
       digest_constraint.definition, '[()[:space:]]', '', 'g'
     )) <> 'refresh_lease_id_hashisnullorrefresh_lease_id_hash~''^[0-9a-f]{64}$''::text' then
    raise exception 'google_connections refresh lease hash constraint is missing or unexpected';
  end if;

  select array_agg(dependency_name order by dependency_name)
    into unexpected_dependencies
  from (
    select 'constraint:' || c.conname as dependency_name
    from pg_catalog.pg_constraint c
    where c.conrelid = target_table
      and (lease_id_attnum = any (c.conkey) or expires_attnum = any (c.conkey))
      and c.conname not in (
        'google_connections_refresh_lease_pair',
        'google_connections_refresh_lease_hash_format'
      )
    union all
    select 'index:' || i.relname
    from pg_catalog.pg_index x
    join pg_catalog.pg_class i on i.oid = x.indexrelid
    where x.indrelid = target_table
      and (
        lease_id_attnum = any (x.indkey)
        or expires_attnum = any (x.indkey)
        or pg_catalog.pg_get_indexdef(x.indexrelid) ~ '\mrefresh_lease_(id_hash|expires_at)\M'
      )
  ) dependencies;

  if unexpected_dependencies is not null then
    raise exception
      'Unexpected google refresh lease dependencies: %',
      pg_catalog.array_to_string(unexpected_dependencies, ', ');
  end if;

  if claim_function is null then
    raise exception 'google refresh lease claim function is missing';
  end if;

  select pg_catalog.pg_get_functiondef(claim_function)
    into claim_function_definition;

  if not exists (
       select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_roles r on r.oid = p.proowner
       join pg_catalog.pg_language l on l.oid = p.prolang
       where p.oid = claim_function
         and r.rolname = 'postgres'
         and l.lanname = 'plpgsql'
         and p.prokind = 'f'
         and p.provolatile = 'v'
         and not p.prosecdef
         and p.proretset
         and p.proconfig @> array['search_path=""']::text[]
     )
     or claim_function_definition !~ 'statement_timestamp\(\)'
     or claim_function_definition !~ 'interval ''90 seconds'''
     or claim_function_definition !~* 'UPDATE public.google_connections'
     or claim_function_definition ~* '\mEXECUTE\M' then
    raise exception 'google refresh lease claim function contract is unexpected';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_proc p
       cross join lateral pg_catalog.aclexplode(
         coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
       ) privilege
       where p.oid = claim_function
         and privilege.grantee = 0
         and privilege.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', claim_function, 'EXECUTE')
     or has_function_privilege('authenticated', claim_function, 'EXECUTE')
     or not has_function_privilege('service_role', claim_function, 'EXECUTE') then
    raise exception 'google refresh lease claim function grants are unexpected';
  end if;
end
$google_refresh_lease_preflight$;

do $google_refresh_lease_apply$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.google_connections'::regclass
      and a.attname = 'refresh_lease_id_hash'
      and not a.attisdropped
  ) then
    alter table public.google_connections
      add column refresh_lease_id_hash text null,
      add column refresh_lease_expires_at timestamptz null,
      add constraint google_connections_refresh_lease_pair check (
        (
          refresh_lease_id_hash is null
          and refresh_lease_expires_at is null
        )
        or (
          refresh_lease_id_hash is not null
          and refresh_lease_expires_at is not null
        )
      ),
      add constraint google_connections_refresh_lease_hash_format check (
        refresh_lease_id_hash is null
        or refresh_lease_id_hash ~ '^[0-9a-f]{64}$'
      );

    execute $create_claim_function$
      create function public.claim_google_credential_refresh_lease(
        p_user_id uuid,
        p_expected_status text,
        p_expected_credential_version bigint,
        p_lease_id_hash text
      )
      returns table (
        id uuid,
        credential_version bigint,
        refresh_lease_expires_at timestamptz
      )
      language plpgsql
      volatile
      security invoker
      set search_path = ''
      as $claim_function$
      declare
        claim_timestamp timestamptz := statement_timestamp();
      begin
        if p_expected_credential_version < 0
           or p_lease_id_hash !~ '^[0-9a-f]{64}$' then
          raise exception 'Invalid Google refresh lease claim input'
            using errcode = '22023';
        end if;

        return query
        update public.google_connections as connection
        set refresh_lease_id_hash = p_lease_id_hash,
            refresh_lease_expires_at = claim_timestamp + interval '90 seconds'
        where connection.user_id = p_user_id
          and connection.status is not distinct from p_expected_status
          and connection.credential_version = p_expected_credential_version
          and (
            (
              connection.refresh_lease_id_hash is null
              and connection.refresh_lease_expires_at is null
            )
            or (
              connection.refresh_lease_id_hash is not null
              and connection.refresh_lease_expires_at is not null
              and connection.refresh_lease_expires_at <= claim_timestamp
            )
          )
        returning
          connection.id,
          connection.credential_version,
          connection.refresh_lease_expires_at;
      end
      $claim_function$;
    $create_claim_function$;

    alter function public.claim_google_credential_refresh_lease(
      uuid, text, bigint, text
    ) owner to postgres;
    revoke execute on function public.claim_google_credential_refresh_lease(
      uuid, text, bigint, text
    ) from public, anon, authenticated;
    grant execute on function public.claim_google_credential_refresh_lease(
      uuid, text, bigint, text
    ) to service_role;
  end if;
end
$google_refresh_lease_apply$;

do $google_refresh_lease_postcondition$
declare
  claim_function oid := to_regprocedure(
    'public.claim_google_credential_refresh_lease(uuid,text,bigint,text)'
  );
begin
  if claim_function is null
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.google_connections'::regclass
         and c.conname = 'google_connections_refresh_lease_pair'
         and c.convalidated
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.google_connections'::regclass
         and c.conname = 'google_connections_refresh_lease_hash_format'
         and c.convalidated
     )
     or exists (
       select 1
       from pg_catalog.pg_proc p
       cross join lateral pg_catalog.aclexplode(
         coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
       ) privilege
       where p.oid = claim_function
         and privilege.grantee = 0
         and privilege.privilege_type = 'EXECUTE'
     )
     or has_function_privilege('anon', claim_function, 'EXECUTE')
     or has_function_privilege('authenticated', claim_function, 'EXECUTE')
     or not has_function_privilege('service_role', claim_function, 'EXECUTE') then
    raise exception 'Google refresh lease migration postcondition failed';
  end if;
end
$google_refresh_lease_postcondition$;

commit;
