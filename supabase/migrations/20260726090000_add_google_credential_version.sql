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
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.google_connections'::regclass
      and conname = 'google_connections_credential_version_nonnegative'
  ) then
    alter table public.google_connections
      add constraint google_connections_credential_version_nonnegative
      check (credential_version >= 0) not valid;
  end if;
end
$$;

alter table public.google_connections
  validate constraint google_connections_credential_version_nonnegative;

alter table public.google_connections
  alter column credential_version set not null;

commit;
