-- AutoPDF: ai_usage_logs table for the empty Preview baseline chain.
-- Purpose:
-- - Reproduce ai_usage_logs schema managed manually on Supabase UI
-- - Fail before DDL when any prior or partial ai_usage_logs shape exists
-- Notes:
-- - Do not add anon grant
-- - authenticated table grant is intentionally NOT added here (existing behavior reproduction)

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $ai_usage_logs_preflight$
declare
  conflicting_relations text[];
begin
  select coalesce(array_agg(c.relname order by c.relname), array[]::text[])
    into conflicting_relations
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any (array[
      'ai_usage_logs',
      'ai_usage_logs_pkey',
      'ai_usage_logs_feature_created_idx',
      'ai_usage_logs_run_idx',
      'ai_usage_logs_user_created_idx'
    ]::text[]);

  if pg_catalog.cardinality(conflicting_relations) <> 0 then
    raise exception
      'AutoPDF ai_usage_logs migration requires a completely absent shape; conflicting relations: %',
      pg_catalog.array_to_string(conflicting_relations, ', ');
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'ai_usage_logs'
  ) then
    raise exception 'AutoPDF ai_usage_logs migration refuses existing policies';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name = 'ai_usage_logs'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) or exists (
    select 1
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'ai_usage_logs'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ) then
    raise exception 'AutoPDF ai_usage_logs migration refuses existing grants';
  end if;
end
$ai_usage_logs_preflight$;

create extension if not exists pgcrypto;

create table public.ai_usage_logs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  rule_id uuid null,
  run_id uuid null,
  feature text not null,
  provider text not null default 'openai'::text,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric null,
  status text not null default 'success'::text,
  error_code text null,
  created_at timestamptz not null default now(),
  constraint ai_usage_logs_pkey primary key (id)
);

create index ai_usage_logs_feature_created_idx
  on public.ai_usage_logs (feature, created_at desc);

create index ai_usage_logs_run_idx
  on public.ai_usage_logs (run_id);

create index ai_usage_logs_user_created_idx
  on public.ai_usage_logs (user_id, created_at desc);

alter table public.ai_usage_logs enable row level security;

create policy "Users can insert own ai usage logs"
  on public.ai_usage_logs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can read own ai usage logs"
  on public.ai_usage_logs
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Supabase project defaults can differ. Keep this intermediate migration
-- deterministic and fail closed until the hardening migration grants the
-- final service_role privileges and removes direct client policies.
revoke all on table public.ai_usage_logs
  from public, anon, authenticated, service_role;

commit;
