begin;

set local lock_timeout = '5s';

alter table public.google_connections
  add column if not exists credential_version bigint;

do $$
declare
  actual_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into actual_type
  from pg_attribute a
  where a.attrelid = 'public.google_connections'::regclass
    and a.attname = 'credential_version'
    and not a.attisdropped;

  if actual_type is distinct from 'bigint' then
    raise exception 'google_connections.credential_version must be bigint';
  end if;
end
$$;

alter table public.google_connections
  alter column credential_version set default 0;

update public.google_connections
set credential_version = 0
where credential_version is null;

do $$
declare
  existing_type "char";
  existing_expression text;
begin
  select c.contype, pg_get_expr(c.conbin, c.conrelid)
    into existing_type, existing_expression
    from pg_constraint c
    where c.conrelid = 'public.google_connections'::regclass
      and c.conname = 'google_connections_credential_version_nonnegative';

  if existing_type is null then
    alter table public.google_connections
      add constraint google_connections_credential_version_nonnegative
      check (credential_version >= 0) not valid;
  elsif existing_type <> 'c'
    or regexp_replace(existing_expression, '[()[:space:]]', '', 'g')
      <> 'credential_version>=0' then
    raise exception
      'google_connections credential version constraint has an unexpected definition';
  end if;
end
$$;

alter table public.google_connections
  validate constraint google_connections_credential_version_nonnegative;

alter table public.google_connections
  alter column credential_version set not null;

commit;
