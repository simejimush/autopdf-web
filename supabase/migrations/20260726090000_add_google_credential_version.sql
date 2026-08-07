begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $credential_version_preflight$
declare
  target_table regclass;
  column_number smallint;
  actual_type text;
  actual_not_null boolean;
  actual_default text;
  matching_constraint_count integer;
  unexpected_constraints text[];
  has_null boolean;
  has_negative boolean;
begin
  target_table := to_regclass('public.google_connections');
  if target_table is null then
    raise exception 'AutoPDF credential migration requires public.google_connections';
  end if;

  lock table public.google_connections in access exclusive mode;

  select a.attnum, format_type(a.atttypid, a.atttypmod), a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    into column_number, actual_type, actual_not_null, actual_default
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = target_table
    and a.attname = 'credential_version'
    and not a.attisdropped;

  if column_number is null then
    if exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = target_table
        and c.conname = 'google_connections_credential_version_nonnegative'
    ) then
      raise exception
        'AutoPDF credential migration refuses an orphaned credential_version constraint';
    end if;
    return;
  end if;

  if actual_type is distinct from 'bigint' then
    raise exception 'google_connections.credential_version must be bigint';
  end if;

  execute
    'select exists (select 1 from public.google_connections where credential_version is null), '
    'exists (select 1 from public.google_connections where credential_version < 0)'
    into has_null, has_negative;

  if has_negative then
    raise exception 'google_connections.credential_version contains negative rows';
  end if;
  if has_null then
    raise exception 'google_connections.credential_version contains NULL rows';
  end if;
  if not actual_not_null then
    raise exception 'google_connections.credential_version must be NOT NULL';
  end if;
  if regexp_replace(coalesce(actual_default, ''), '[()[:space:]'']', '', 'g')
      not in ('0', '0::bigint') then
    raise exception 'google_connections.credential_version must default to 0';
  end if;

  select count(*)
    into matching_constraint_count
  from pg_catalog.pg_constraint c
  where c.conrelid = target_table
    and c.conname = 'google_connections_credential_version_nonnegative'
    and c.contype = 'c'
    and c.convalidated
    and c.conkey = array[column_number]::smallint[]
    and regexp_replace(
      pg_catalog.pg_get_expr(c.conbin, c.conrelid),
      '[()[:space:]]', '', 'g'
    ) = 'credential_version>=0';

  if matching_constraint_count <> 1 then
    raise exception
      'google_connections credential version constraint must be present, validated, and nonnegative';
  end if;

  select array_agg(c.conname order by c.conname)
    into unexpected_constraints
  from pg_catalog.pg_constraint c
  where c.conrelid = target_table
    and column_number = any (c.conkey)
    and c.conname <> 'google_connections_credential_version_nonnegative';

  if unexpected_constraints is not null then
    raise exception
      'Unexpected credential_version constraints: %',
      pg_catalog.array_to_string(unexpected_constraints, ', ');
  end if;
end
$credential_version_preflight$;

do $credential_version_apply$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.google_connections'::regclass
      and a.attname = 'credential_version'
      and not a.attisdropped
  ) then
    alter table public.google_connections
      add column credential_version bigint;

    alter table public.google_connections
      alter column credential_version set default 0;

    update public.google_connections
    set credential_version = 0
    where credential_version is null;

    alter table public.google_connections
      add constraint google_connections_credential_version_nonnegative
      check (credential_version >= 0) not valid;

    alter table public.google_connections
      validate constraint google_connections_credential_version_nonnegative;

    alter table public.google_connections
      alter column credential_version set not null;
  end if;
end
$credential_version_apply$;

commit;
