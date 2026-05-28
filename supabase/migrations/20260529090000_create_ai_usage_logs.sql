-- AutoPDF: ai_usage_logs table (idempotent-friendly migration)
-- Purpose:
-- - Reproduce ai_usage_logs schema managed manually on Supabase UI
-- - Avoid failing on existing environments as much as possible
-- Notes:
-- - Do not add anon grant
-- - authenticated table grant is intentionally NOT added here (existing behavior reproduction)

create extension if not exists pgcrypto;

create table if not exists public.ai_usage_logs (
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

create index if not exists ai_usage_logs_feature_created_idx
  on public.ai_usage_logs (feature, created_at desc);

create index if not exists ai_usage_logs_run_idx
  on public.ai_usage_logs (run_id);

create index if not exists ai_usage_logs_user_created_idx
  on public.ai_usage_logs (user_id, created_at desc);

alter table public.ai_usage_logs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_usage_logs'
      and policyname = 'Users can insert own ai usage logs'
  ) then
    create policy "Users can insert own ai usage logs"
      on public.ai_usage_logs
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_usage_logs'
      and policyname = 'Users can read own ai usage logs'
  ) then
    create policy "Users can read own ai usage logs"
      on public.ai_usage_logs
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

