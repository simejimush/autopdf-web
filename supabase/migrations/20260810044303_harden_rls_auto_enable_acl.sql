begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $rls_auto_enable_acl_preflight$
declare
  target_function oid;
  function_count bigint;
  function_row record;
  event_trigger_row record;
begin
  select min(p.oid::bigint)::oid, count(*)
    into target_function, function_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'rls_auto_enable';

  if function_count <> 1 then
    raise exception 'AutoPDF ACL hardening requires exactly one public.rls_auto_enable function';
  end if;

  select
    r.rolname as owner,
    l.lanname as language,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prokind,
    p.provolatile,
    p.proparallel,
    p.prosecdef,
    p.proleakproof,
    p.proisstrict,
    p.proconfig,
    p.proacl,
    pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as definition_hash
    into function_row
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = target_function;

  if function_row.owner <> 'postgres'
     or function_row.language <> 'plpgsql'
     or function_row.identity_arguments <> ''
     or function_row.result_type <> 'event_trigger'
     or function_row.prokind <> 'f'
     or function_row.provolatile <> 'v'
     or function_row.proparallel <> 'u'
     or not function_row.prosecdef
     or function_row.proleakproof
     or function_row.proisstrict
     or function_row.proconfig is distinct from array['search_path=pg_catalog']::text[]
     or function_row.proacl is not null
     or function_row.definition_hash <> '6998ea6b4c2480f5d2e34b5dcf3f8d36' then
    raise exception 'public.rls_auto_enable function identity drifted before ACL hardening';
  end if;

  if not pg_catalog.has_function_privilege('public', target_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('anon', target_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', target_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', target_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('postgres', target_function, 'EXECUTE') then
    raise exception 'public.rls_auto_enable precondition ACL is unexpected';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_depend d
    where d.objid = target_function
      and d.deptype = 'e'
  ) then
    raise exception 'public.rls_auto_enable unexpectedly belongs to an extension';
  end if;

  select
    count(*) as trigger_count,
    min(e.evtname) as trigger_name,
    min(e.evtevent) as trigger_event,
    min(e.evtenabled) as trigger_enabled,
    min(e.evttags::text) as trigger_tags,
    min(e.evtfoid::bigint)::oid as function_oid,
    min(r.rolname) as owner
    into event_trigger_row
  from pg_catalog.pg_event_trigger e
  join pg_catalog.pg_roles r on r.oid = e.evtowner
  where e.evtname = 'ensure_rls'
     or e.evtfoid = target_function;

  if event_trigger_row.trigger_count <> 1
     or event_trigger_row.trigger_name <> 'ensure_rls'
     or event_trigger_row.trigger_event <> 'ddl_command_end'
     or event_trigger_row.trigger_enabled <> 'O'
     or event_trigger_row.trigger_tags <> '{"CREATE TABLE","CREATE TABLE AS","SELECT INTO"}'
     or event_trigger_row.function_oid <> target_function
     or event_trigger_row.owner <> 'postgres' then
    raise exception 'ensure_rls event trigger identity drifted before ACL hardening';
  end if;
end
$rls_auto_enable_acl_preflight$;

revoke execute on function public.rls_auto_enable() from public;

do $rls_auto_enable_acl_postcondition$
declare
  target_function oid;
begin
  target_function := pg_catalog.to_regprocedure('public.rls_auto_enable()');

  if target_function is null
     or not exists (
       select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_roles r on r.oid = p.proowner
       join pg_catalog.pg_language l on l.oid = p.prolang
       where p.oid = target_function
         and r.rolname = 'postgres'
         and l.lanname = 'plpgsql'
         and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
         and pg_catalog.pg_get_function_result(p.oid) = 'event_trigger'
         and p.prokind = 'f'
         and p.provolatile = 'v'
         and p.proparallel = 'u'
         and p.prosecdef
         and not p.proleakproof
         and not p.proisstrict
         and p.proconfig is not distinct from array['search_path=pg_catalog']::text[]
         and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) =
             '6998ea6b4c2480f5d2e34b5dcf3f8d36'
     ) then
    raise exception 'public.rls_auto_enable function identity changed during ACL hardening';
  end if;

  if pg_catalog.has_function_privilege('public', target_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', target_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', target_function, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', target_function, 'EXECUTE')
     or not pg_catalog.has_function_privilege('postgres', target_function, 'EXECUTE') then
    raise exception 'public.rls_auto_enable ACL hardening postcondition failed';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) privilege
    where p.oid = target_function
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee <> p.proowner
  ) then
    raise exception 'public.rls_auto_enable retained an unexpected EXECUTE grantee';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_event_trigger e
    join pg_catalog.pg_roles r on r.oid = e.evtowner
    where e.evtname = 'ensure_rls'
      and e.evtevent = 'ddl_command_end'
      and e.evtenabled = 'O'
      and e.evttags = array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
      and e.evtfoid = target_function
      and r.rolname = 'postgres'
  ) then
    raise exception 'ensure_rls event trigger changed during ACL hardening';
  end if;
end
$rls_auto_enable_acl_postcondition$;

commit;
