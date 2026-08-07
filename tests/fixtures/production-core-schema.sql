-- Anonymous structural fixture for the 2026-08-07 AutoPDF Production catalog.
-- All identifiers and row values below are local-only synthetic values.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$ select null::uuid $$;

create extension if not exists pgcrypto;
create extension if not exists moddatetime with schema public;

create table public.google_connections (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'connected'::text,
  scopes text null,
  access_token_enc text null,
  refresh_token_enc text null,
  token_expiry_at timestamptz null,
  last_verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz null,
  last_error_at timestamptz null,
  last_error_code text null,
  reauth_required boolean not null default false,
  last_user_notified_at timestamptz null,
  last_user_notified_error_code text null,
  constraint google_connections_pkey primary key (id),
  constraint google_connections_user_id_key unique (user_id),
  constraint google_connections_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade
);

create table public.rules (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  is_enabled boolean not null default false,
  gmail_label_id text null,
  unread_only boolean not null default true,
  lookback_days integer null,
  drive_folder_id text not null,
  subfolder_mode text not null default 'none'::text,
  filename_mode text not null default 'date_subject'::text,
  run_mode text not null default 'auto_daily'::text,
  consecutive_failures integer not null default 0,
  auto_disabled_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  subject_keywords text null,
  gmail_query text null,
  file_name_format text null default 'date_subject'::text,
  filename_template text null default '{date}_{subject}.pdf'::text,
  is_active boolean null default true,
  run_timing text null default 'manual'::text,
  run_count integer null default 0,
  query_label text null,
  constraint rules_pkey primary key (id),
  constraint lookback_days_allowed
    check (lookback_days is null or lookback_days = any (array[7, 30]))
);

create table public.runs (
  id uuid not null default gen_random_uuid(),
  user_id uuid null,
  rule_id uuid not null,
  trigger text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  processed_count integer not null default 0,
  saved_count integer not null default 0,
  drive_folder_id text null,
  message text null,
  error_code text null,
  updated_at timestamptz null default now(),
  skipped_count integer not null default 0,
  constraint runs_pkey primary key (id),
  constraint runs_rule_id_fkey
    foreign key (rule_id) references public.rules (id) on delete cascade,
  constraint runs_status_check
    check (status = any (array['running'::text, 'success'::text, 'error'::text]))
);

create table public.processed_emails (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  rule_id uuid not null,
  gmail_message_id text not null,
  created_at timestamptz not null default now(),
  drive_file_id text null,
  drive_web_view_link text null,
  saved_at timestamptz null,
  drive_file_name text null,
  constraint processed_emails_pkey primary key (id),
  constraint processed_emails_rule_id_fkey
    foreign key (rule_id) references public.rules (id) on delete cascade
);

create table public.user_profiles (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  display_name text null,
  company_name text null,
  industry text null,
  employee_size text null,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  plan text not null default 'free'::text,
  billing_provider text null,
  billing_customer_id text null,
  billing_subscription_id text null,
  billing_status text null,
  current_period_end timestamptz null,
  plan_updated_at timestamptz null,
  cancel_at_period_end boolean null default false,
  constraint user_profiles_pkey primary key (id),
  constraint user_profiles_user_id_key unique (user_id),
  constraint user_profiles_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade,
  constraint user_profiles_plan_check
    check (plan = any (array['free'::text, 'pro'::text])),
  constraint user_profiles_billing_provider_check
    check (billing_provider is null or billing_provider = any (array['stripe'::text, 'paddle'::text])),
  constraint user_profiles_billing_status_check
    check (billing_status is null or billing_status = any (array[
      'trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text,
      'unpaid'::text, 'incomplete'::text, 'incomplete_expired'::text
    ]))
);

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
  estimated_cost_usd numeric(10,6) null,
  status text not null default 'success'::text,
  error_code text null,
  created_at timestamptz not null default now(),
  constraint ai_usage_logs_pkey primary key (id)
);

create unique index processed_emails_rule_msg_uniq
  on public.processed_emails (rule_id, gmail_message_id);
create index processed_emails_user_idx on public.processed_emails (user_id);
create index processed_emails_rule_idx on public.processed_emails (rule_id);
create index runs_status_updated_at_idx on public.runs (status, updated_at desc);
create index runs_user_started_idx on public.runs (user_id, started_at desc);
create index runs_rule_id_started_at_idx on public.runs (rule_id, started_at desc);
create index user_profiles_user_id_idx on public.user_profiles (user_id);
create index ai_usage_logs_feature_created_idx
  on public.ai_usage_logs (feature, created_at desc);
create index ai_usage_logs_run_idx on public.ai_usage_logs (run_id);
create index ai_usage_logs_user_created_idx
  on public.ai_usage_logs (user_id, created_at desc);

alter table public.google_connections enable row level security;
alter table public.rules enable row level security;
alter table public.runs enable row level security;
alter table public.processed_emails enable row level security;
alter table public.user_profiles enable row level security;
alter table public.ai_usage_logs enable row level security;

create policy users_can_insert_own_google_connections
  on public.google_connections for insert to public
  with check (auth.uid() = user_id);
create policy users_can_select_own_google_connections
  on public.google_connections for select to public
  using (auth.uid() = user_id);
create policy users_can_update_own_google_connections
  on public.google_connections for update to public
  using (auth.uid() = user_id);
create policy users_can_select_own_processed_emails
  on public.processed_emails for select to public
  using (auth.uid() = user_id);

create policy "delete own rules" on public.rules for delete to public
  using (auth.uid() = user_id);
create policy users_can_delete_own_rules on public.rules for delete to public
  using (auth.uid() = user_id);
create policy "insert own rules" on public.rules for insert to public
  with check (auth.uid() = user_id);
create policy users_can_insert_own_rules on public.rules for insert to public
  with check (auth.uid() = user_id);
create policy "select own rules" on public.rules for select to public
  using (auth.uid() = user_id);
create policy users_can_select_own_rules on public.rules for select to public
  using (auth.uid() = user_id);
create policy "update own rules" on public.rules for update to public
  using (auth.uid() = user_id);
create policy users_can_update_own_rules on public.rules for update to public
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy runs_insert_own on public.runs for insert to authenticated
  with check (auth.uid() = user_id);
create policy users_can_select_own_runs on public.runs for select to public
  using (auth.uid() = user_id);
create policy users_can_update_own_runs on public.runs for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy user_profiles_delete_own on public.user_profiles for delete to public
  using (auth.uid() = user_id);
create policy user_profiles_insert_own on public.user_profiles for insert to public
  with check (auth.uid() = user_id);
create policy user_profiles_select_own on public.user_profiles for select to public
  using (auth.uid() = user_id);
create policy user_profiles_update_own on public.user_profiles for update to public
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can insert own ai usage logs"
  on public.ai_usage_logs for insert to authenticated
  with check (auth.uid() = user_id);
create policy "Users can read own ai usage logs"
  on public.ai_usage_logs for select to authenticated
  using (auth.uid() = user_id);

grant all on table public.google_connections to anon, authenticated, service_role;
grant all on table public.rules to anon, authenticated, service_role;
grant all on table public.runs to anon, authenticated, service_role;
grant all on table public.processed_emails to anon, authenticated, service_role;
grant all on table public.user_profiles to anon, authenticated, service_role;
grant all on table public.ai_usage_logs to service_role;

create function public.handle_new_user_create_profile()
returns trigger language plpgsql security definer
as $$
begin
  insert into public.user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create function public.set_updated_at()
returns trigger language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function public.update_runs_updated_at()
returns trigger language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

grant execute on function public.handle_new_user_create_profile()
  to public, anon, authenticated, service_role;
grant execute on function public.set_updated_at()
  to public, anon, authenticated, service_role;
grant execute on function public.update_runs_updated_at()
  to public, anon, authenticated, service_role;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_user_create_profile();
create trigger set_updated_at_on_rules
before update on public.rules
for each row execute function public.moddatetime('updated_at');
create trigger trg_rules_set_updated_at
before update on public.rules
for each row execute function public.set_updated_at();
create trigger trg_set_updated_at
before update on public.rules
for each row execute function public.set_updated_at();
create trigger trigger_update_runs_updated_at
before update on public.runs
for each row execute function public.update_runs_updated_at();
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
insert into public.user_profiles (user_id, display_name) values
  ('10000000-0000-4000-8000-000000000001', 'Fixture One'),
  ('10000000-0000-4000-8000-000000000002', 'Fixture Two')
on conflict (user_id) do update
set display_name = excluded.display_name;
insert into public.google_connections (user_id, status) values
  ('10000000-0000-4000-8000-000000000001', 'connected');
insert into public.rules (
  id, user_id, drive_folder_id, gmail_query, query_label,
  file_name_format, is_active, run_timing
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'fixture-folder', 'from:fixture@example.invalid', 'Fixture rule',
  'date_subject', true, 'manual'
);
insert into public.runs (
  id, user_id, rule_id, trigger, status, processed_count,
  saved_count, skipped_count, message
) values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'manual', 'success', 1, 1, 0, 'Fixture run'
);
insert into public.processed_emails (
  user_id, rule_id, gmail_message_id, drive_file_name, saved_at
) values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'fixture-message', 'fixture.pdf', now()
);
insert into public.ai_usage_logs (
  user_id, rule_id, run_id, feature, model, input_tokens,
  output_tokens, total_tokens, estimated_cost_usd
) values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'fixture', 'fixture-model', 1, 1, 2, 0.000001
);
