begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $google_refresh_operation_ambiguity_preflight$
declare
  function_names text[] := array[
    'prepare_google_refresh_operation',
    'finalize_google_refresh_operation',
    'transition_google_refresh_operation'
  ];
  function_signatures text[] := array[
    'public.prepare_google_refresh_operation(uuid,uuid,bigint,text)',
    'public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
    'public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text)'
  ];
  identity_arguments text[] := array[
    'p_user_id uuid, p_operation_id uuid, p_expected_credential_version bigint, p_lease_id_hash text',
    'p_user_id uuid, p_operation_id uuid, p_expected_credential_version bigint, p_lease_id_hash text, p_access_token_enc text, p_refresh_token_enc text, p_refresh_token_present boolean, p_token_expiry_at timestamp with time zone, p_timestamp timestamp with time zone',
    'p_user_id uuid, p_operation_id uuid, p_expected_credential_version bigint, p_lease_id_hash text, p_target_state text, p_error_code text'
  ];
  old_source_hashes text[] := array[
    '2e6b325769cfdff42355fd83e8853b5f',
    'eba6ee2683ed43ecccb07b03195f3318',
    '90f9478a3f055fa2e7b33202f65f37a5'
  ];
  new_source_hashes text[] := array[
    '4fad0f538c686b71e1e708ec7442e924',
    '1aa755e1ec0c27e517dfb45001c1b8c5',
    '6fca572601ada25cc9600885e69b711d'
  ];
  target_function oid;
  function_count integer;
  function_row record;
  execute_acl_count integer;
  unexpected_execute_acl_count integer;
  all_old boolean := true;
  all_new boolean := true;
  function_index integer;
begin
  if pg_catalog.to_regclass('public.google_connections') is null
     or pg_catalog.to_regclass('public.google_refresh_operations') is null then
    raise exception 'Google refresh operation remediation requires operation tables';
  end if;

  for function_index in 1..pg_catalog.array_length(function_names, 1) loop
    select pg_catalog.count(*)
      into function_count
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = function_names[function_index];

    target_function := pg_catalog.to_regprocedure(function_signatures[function_index]);
    if function_count <> 1 or target_function is null then
      raise exception 'public.% identity drifted', function_names[function_index];
    end if;

    select
      pg_catalog.pg_get_userbyid(p.proowner) as owner,
      l.lanname as language,
      p.prokind, p.provolatile, p.prosecdef, p.proisstrict, p.proleakproof,
      p.proparallel, p.proconfig, p.proacl,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as actual_identity_arguments,
      pg_catalog.pg_get_function_result(p.oid) as function_result,
      pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) as source_hash,
      exists (
        select 1
        from pg_catalog.pg_depend as d
        where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      ) as extension_owned
    into function_row
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_language as l on l.oid = p.prolang
    where p.oid = target_function;

    if function_row.owner <> 'postgres'
       or function_row.language <> 'plpgsql'
       or function_row.prokind <> 'f'
       or function_row.provolatile <> 'v'
       or function_row.prosecdef
       or function_row.proisstrict
       or function_row.proleakproof
       or function_row.proparallel <> 'u'
       or function_row.proconfig is distinct from array['search_path=""']::text[]
       or function_row.actual_identity_arguments <> identity_arguments[function_index]
       or function_row.function_result <> 'TABLE(operation_state text, credential_version bigint)'
       or function_row.extension_owned then
      raise exception 'public.% metadata drifted', function_names[function_index];
    end if;

    select
      pg_catalog.count(*),
      pg_catalog.count(*) filter (
        where acl.privilege_type <> 'EXECUTE'
           or acl.is_grantable
           or acl.grantor <> (select oid from pg_catalog.pg_roles where rolname = 'postgres')
           or acl.grantee not in (
             select oid from pg_catalog.pg_roles where rolname in ('postgres', 'service_role')
           )
      )
    into execute_acl_count, unexpected_execute_acl_count
    from pg_catalog.aclexplode(function_row.proacl) as acl;

    if function_row.proacl is null
       or execute_acl_count <> 2
       or unexpected_execute_acl_count <> 0
       or not pg_catalog.has_function_privilege('postgres', target_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', target_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', target_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', target_function, 'EXECUTE') then
      raise exception 'public.% ACL drifted', function_names[function_index];
    end if;

    all_old := all_old and function_row.source_hash = old_source_hashes[function_index];
    all_new := all_new and function_row.source_hash = new_source_hashes[function_index];
  end loop;

  if not all_old and not all_new then
    raise exception 'Google refresh operation bodies drifted or are partially remediated';
  end if;
end
$google_refresh_operation_ambiguity_preflight$;

do $google_refresh_finalize_lease_preflight$
declare
  target_function oid;
  function_count integer;
  function_row record;
  execute_acl_count integer;
  unexpected_execute_acl_count integer;
begin
  if pg_catalog.to_regclass('public.google_connections') is null
     or pg_catalog.to_regclass('public.google_refresh_operations') is null then
    raise exception 'Google refresh finalize lease remediation requires operation tables';
  end if;

  select pg_catalog.count(*)
    into function_count
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'finalize_google_refresh_operation';

  target_function := pg_catalog.to_regprocedure(
    'public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'
  );

  if function_count <> 1
     or target_function is null then
    raise exception 'public.finalize_google_refresh_operation identity drifted';
  end if;

  select
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    l.lanname as language,
    p.prokind,
    p.provolatile,
    p.prosecdef,
    p.proisstrict,
    p.proleakproof,
    p.proparallel,
    p.proconfig,
    p.proacl,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as function_result,
    pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) as source_hash,
    exists (
      select 1
      from pg_catalog.pg_depend as d
      where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        and d.objid = p.oid
        and d.deptype = 'e'
    ) as extension_owned
  into function_row
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_language as l on l.oid = p.prolang
  where p.oid = target_function;

  if function_row.owner <> 'postgres'
     or function_row.language <> 'plpgsql'
     or function_row.prokind <> 'f'
     or function_row.provolatile <> 'v'
     or function_row.prosecdef
     or function_row.proisstrict
     or function_row.proleakproof
     or function_row.proparallel <> 'u'
     or function_row.proconfig is distinct from array['search_path=""']::text[]
     or function_row.identity_arguments <> 'p_user_id uuid, p_operation_id uuid, p_expected_credential_version bigint, p_lease_id_hash text, p_access_token_enc text, p_refresh_token_enc text, p_refresh_token_present boolean, p_token_expiry_at timestamp with time zone, p_timestamp timestamp with time zone'
     or function_row.function_result <> 'TABLE(operation_state text, credential_version bigint)'
     or function_row.extension_owned then
    raise exception 'public.finalize_google_refresh_operation metadata drifted';
  end if;

  if function_row.source_hash not in (
    'eba6ee2683ed43ecccb07b03195f3318',
    '1aa755e1ec0c27e517dfb45001c1b8c5'
  ) then
    raise exception 'public.finalize_google_refresh_operation body drifted';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where acl.privilege_type <> 'EXECUTE'
         or acl.is_grantable
         or acl.grantor <> (select oid from pg_catalog.pg_roles where rolname = 'postgres')
         or acl.grantee not in (
           select oid from pg_catalog.pg_roles where rolname in ('postgres', 'service_role')
         )
    )
  into execute_acl_count, unexpected_execute_acl_count
  from pg_catalog.aclexplode(function_row.proacl) as acl;

  if function_row.proacl is null
     or execute_acl_count <> 2
     or unexpected_execute_acl_count <> 0
     or not pg_catalog.has_function_privilege('postgres', target_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', target_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', target_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', target_function, 'EXECUTE') then
    raise exception 'public.finalize_google_refresh_operation ACL drifted';
  end if;
end
$google_refresh_finalize_lease_preflight$;

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

  select
    operation.operation_id,
    operation.user_id,
    operation.state,
    operation.expected_credential_version,
    operation.result_credential_version,
    operation.lease_id_hash,
    operation.lease_expires_at,
    operation.provider_call_started_at,
    operation.finished_at,
    operation.resolved_at,
    operation.error_code,
    operation.run_id,
    operation.created_at,
    operation.updated_at
  into current_operation
  from public.google_refresh_operations as operation
  where operation.operation_id = p_operation_id
    and operation.user_id = p_user_id
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
        update public.google_refresh_operations as operation
        set state = 'outcome_unknown', error_code = 'GOOGLE_REFRESH_OUTCOME_UNKNOWN',
            finished_at = claim_timestamp, updated_at = claim_timestamp
        where operation.operation_id = p_operation_id
          and operation.user_id = p_user_id;
        update public.google_connections as connection
        set status = 'error', reauth_required = true,
            last_error_code = 'GOOGLE_REFRESH_OUTCOME_UNKNOWN',
            last_error_at = claim_timestamp, updated_at = claim_timestamp,
            refresh_lease_id_hash = null, refresh_lease_expires_at = null
        where connection.user_id = p_user_id
          and connection.credential_version = p_expected_credential_version
          and connection.refresh_lease_id_hash = current_operation.lease_id_hash;
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

  update public.google_refresh_operations as operation
  set state = 'resolved', resolved_at = claim_timestamp,
      updated_at = claim_timestamp
  where operation.user_id = p_user_id
    and operation.state = 'outcome_unknown'
    and operation.expected_credential_version < p_expected_credential_version;

  if current_operation.operation_id is null then
    insert into public.google_refresh_operations (
      operation_id, user_id, state, expected_credential_version,
      lease_id_hash, lease_expires_at
    ) values (
      p_operation_id, p_user_id, 'prepared', p_expected_credential_version,
      p_lease_id_hash, claim_timestamp + interval '90 seconds'
    );
  else
    update public.google_refresh_operations as operation
    set state = 'prepared', lease_id_hash = p_lease_id_hash,
        lease_expires_at = claim_timestamp + interval '90 seconds',
        error_code = null, updated_at = claim_timestamp
    where operation.operation_id = p_operation_id
      and operation.user_id = p_user_id
      and operation.state in ('prepared', 'retryable');
  end if;

  return query select 'prepared'::text, claimed_version;
end
$prepare$;

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
    update public.google_refresh_operations as operation
    set state = 'outcome_unknown', error_code = 'GOOGLE_REFRESH_OUTCOME_UNKNOWN',
        finished_at = statement_timestamp(), updated_at = statement_timestamp()
    where operation.operation_id = p_operation_id
      and operation.user_id = p_user_id
      and operation.state = 'provider_call_started';
    update public.google_connections as connection
    set status = 'error', reauth_required = true,
        last_error_code = 'GOOGLE_REFRESH_OUTCOME_UNKNOWN',
        last_error_at = statement_timestamp(), updated_at = statement_timestamp(),
        refresh_lease_id_hash = null, refresh_lease_expires_at = null
    where connection.user_id = p_user_id
      and connection.credential_version = p_expected_credential_version
      and connection.refresh_lease_id_hash = p_lease_id_hash;
    return query select 'outcome_unknown'::text, null::bigint;
    return;
  end if;

  update public.google_refresh_operations as operation
  set state = 'completed', result_credential_version = saved_version,
      finished_at = statement_timestamp(), error_code = null,
      updated_at = statement_timestamp()
  where operation.operation_id = p_operation_id
    and operation.user_id = p_user_id
    and operation.state = 'provider_call_started'
    and operation.expected_credential_version = p_expected_credential_version
    and operation.lease_id_hash = p_lease_id_hash;
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

  update public.google_refresh_operations as operation
  set state = p_target_state,
      error_code = p_error_code,
      finished_at = case when p_target_state = 'retryable' then null else statement_timestamp() end,
      updated_at = statement_timestamp()
  where operation.operation_id = p_operation_id
    and operation.user_id = p_user_id
    and operation.expected_credential_version = p_expected_credential_version
    and operation.lease_id_hash = p_lease_id_hash
    and ((p_target_state = 'retryable' and operation.state in ('prepared', 'retryable'))
      or (p_target_state <> 'retryable' and operation.state in ('provider_call_started', p_target_state)))
  returning operation.operation_id into changed_id;

  if changed_id is null then
    return query select 'outcome_unknown'::text, null::bigint;
    return;
  end if;

  update public.google_connections as connection
  set status = case when p_target_state = 'retryable' then connection.status else 'error' end,
      reauth_required = case when p_target_state = 'retryable' then connection.reauth_required else true end,
      last_error_code = case when p_target_state = 'retryable' then connection.last_error_code else p_error_code end,
      last_error_at = case when p_target_state = 'retryable' then connection.last_error_at else statement_timestamp() end,
      updated_at = statement_timestamp(),
      refresh_lease_id_hash = null, refresh_lease_expires_at = null
  where connection.user_id = p_user_id
    and connection.credential_version = p_expected_credential_version
    and connection.refresh_lease_id_hash = p_lease_id_hash;

  return query select p_target_state, p_expected_credential_version;
end
$transition$;

alter function public.prepare_google_refresh_operation(
  uuid, uuid, bigint, text
) owner to postgres;
revoke execute on function public.prepare_google_refresh_operation(
  uuid, uuid, bigint, text
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_google_refresh_operation(
  uuid, uuid, bigint, text
) to postgres, service_role;

alter function public.finalize_google_refresh_operation(
  uuid, uuid, bigint, text, text, text, boolean, timestamptz, timestamptz
) owner to postgres;
revoke execute on function public.finalize_google_refresh_operation(
  uuid, uuid, bigint, text, text, text, boolean, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_google_refresh_operation(
  uuid, uuid, bigint, text, text, text, boolean, timestamptz, timestamptz
) to postgres, service_role;

alter function public.transition_google_refresh_operation(
  uuid, uuid, bigint, text, text, text
) owner to postgres;
revoke execute on function public.transition_google_refresh_operation(
  uuid, uuid, bigint, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.transition_google_refresh_operation(
  uuid, uuid, bigint, text, text, text
) to postgres, service_role;

do $google_refresh_finalize_lease_postcondition$
declare
  target_function oid := pg_catalog.to_regprocedure(
    'public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamp with time zone,timestamp with time zone)'
  );
  function_row record;
  execute_acl_count integer;
  unexpected_execute_acl_count integer;
begin
  select
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    l.lanname as language,
    p.prokind, p.provolatile, p.prosecdef, p.proisstrict, p.proleakproof,
    p.proparallel, p.proconfig, p.proacl,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as function_result,
    pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) as source_hash
  into function_row
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_language as l on l.oid = p.prolang
  where p.oid = target_function;

  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where acl.privilege_type <> 'EXECUTE'
         or acl.is_grantable
         or acl.grantor <> (select oid from pg_catalog.pg_roles where rolname = 'postgres')
         or acl.grantee not in (
           select oid from pg_catalog.pg_roles where rolname in ('postgres', 'service_role')
         )
    )
  into execute_acl_count, unexpected_execute_acl_count
  from pg_catalog.aclexplode(function_row.proacl) as acl;

  if target_function is null
     or function_row.owner <> 'postgres'
     or function_row.language <> 'plpgsql'
     or function_row.prokind <> 'f'
     or function_row.provolatile <> 'v'
     or function_row.prosecdef
     or function_row.proisstrict
     or function_row.proleakproof
     or function_row.proparallel <> 'u'
     or function_row.proconfig is distinct from array['search_path=""']::text[]
     or function_row.identity_arguments <> 'p_user_id uuid, p_operation_id uuid, p_expected_credential_version bigint, p_lease_id_hash text, p_access_token_enc text, p_refresh_token_enc text, p_refresh_token_present boolean, p_token_expiry_at timestamp with time zone, p_timestamp timestamp with time zone'
     or function_row.function_result <> 'TABLE(operation_state text, credential_version bigint)'
     or function_row.source_hash <> '1aa755e1ec0c27e517dfb45001c1b8c5'
     or execute_acl_count <> 2
     or unexpected_execute_acl_count <> 0
     or not pg_catalog.has_function_privilege('postgres', target_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', target_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', target_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', target_function, 'EXECUTE') then
    raise exception 'public.finalize_google_refresh_operation remediation postcondition failed';
  end if;
end
$google_refresh_finalize_lease_postcondition$;

do $google_refresh_operation_ambiguity_postcondition$
declare
  function_names text[] := array[
    'prepare_google_refresh_operation',
    'finalize_google_refresh_operation',
    'transition_google_refresh_operation'
  ];
  function_signatures text[] := array[
    'public.prepare_google_refresh_operation(uuid,uuid,bigint,text)',
    'public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
    'public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text)'
  ];
  identity_arguments text[] := array[
    'p_user_id uuid, p_operation_id uuid, p_expected_credential_version bigint, p_lease_id_hash text',
    'p_user_id uuid, p_operation_id uuid, p_expected_credential_version bigint, p_lease_id_hash text, p_access_token_enc text, p_refresh_token_enc text, p_refresh_token_present boolean, p_token_expiry_at timestamp with time zone, p_timestamp timestamp with time zone',
    'p_user_id uuid, p_operation_id uuid, p_expected_credential_version bigint, p_lease_id_hash text, p_target_state text, p_error_code text'
  ];
  new_source_hashes text[] := array[
    '4fad0f538c686b71e1e708ec7442e924',
    '1aa755e1ec0c27e517dfb45001c1b8c5',
    '6fca572601ada25cc9600885e69b711d'
  ];
  target_function oid;
  function_count integer;
  function_row record;
  execute_acl_count integer;
  unexpected_execute_acl_count integer;
  function_index integer;
begin
  for function_index in 1..pg_catalog.array_length(function_names, 1) loop
    select pg_catalog.count(*)
      into function_count
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = function_names[function_index];

    target_function := pg_catalog.to_regprocedure(function_signatures[function_index]);
    if function_count <> 1 or target_function is null then
      raise exception 'public.% remediation identity postcondition failed', function_names[function_index];
    end if;

    select
      pg_catalog.pg_get_userbyid(p.proowner) as owner,
      l.lanname as language,
      p.prokind, p.provolatile, p.prosecdef, p.proisstrict, p.proleakproof,
      p.proparallel, p.proconfig, p.proacl,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as actual_identity_arguments,
      pg_catalog.pg_get_function_result(p.oid) as function_result,
      pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) as source_hash,
      exists (
        select 1
        from pg_catalog.pg_depend as d
        where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      ) as extension_owned
    into function_row
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_language as l on l.oid = p.prolang
    where p.oid = target_function;

    select
      pg_catalog.count(*),
      pg_catalog.count(*) filter (
        where acl.privilege_type <> 'EXECUTE'
           or acl.is_grantable
           or acl.grantor <> (select oid from pg_catalog.pg_roles where rolname = 'postgres')
           or acl.grantee not in (
             select oid from pg_catalog.pg_roles where rolname in ('postgres', 'service_role')
           )
      )
    into execute_acl_count, unexpected_execute_acl_count
    from pg_catalog.aclexplode(function_row.proacl) as acl;

    if function_row.owner <> 'postgres'
       or function_row.language <> 'plpgsql'
       or function_row.prokind <> 'f'
       or function_row.provolatile <> 'v'
       or function_row.prosecdef
       or function_row.proisstrict
       or function_row.proleakproof
       or function_row.proparallel <> 'u'
       or function_row.proconfig is distinct from array['search_path=""']::text[]
       or function_row.actual_identity_arguments <> identity_arguments[function_index]
       or function_row.function_result <> 'TABLE(operation_state text, credential_version bigint)'
       or function_row.source_hash <> new_source_hashes[function_index]
       or function_row.extension_owned
       or function_row.proacl is null
       or execute_acl_count <> 2
       or unexpected_execute_acl_count <> 0
       or not pg_catalog.has_function_privilege('postgres', target_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', target_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', target_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', target_function, 'EXECUTE') then
      raise exception 'public.% remediation postcondition failed', function_names[function_index];
    end if;
  end loop;
end
$google_refresh_operation_ambiguity_postcondition$;

commit;
