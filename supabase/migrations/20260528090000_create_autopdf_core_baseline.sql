-- AutoPDF core baseline for a brand-new, empty Preview Supabase database only.
-- NEVER apply this migration to Production or to a database containing any core table.
-- It contains schema only: no Production identifiers, rows, tokens, or billing data.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $baseline_preflight$
declare
  existing_tables text[];
begin
  if to_regclass('auth.users') is null then
    raise exception 'AutoPDF baseline requires auth.users';
  end if;

  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'AutoPDF baseline requires gen_random_uuid()';
  end if;

  select coalesce(array_agg(c.relname order by c.relname), array[]::text[])
    into existing_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname = any (array[
      'google_connections',
      'rules',
      'runs',
      'processed_emails',
      'user_profiles'
    ]::text[]);

  if pg_catalog.cardinality(existing_tables) <> 0 then
    raise exception
      'AutoPDF Preview baseline refuses a partial or existing core schema: %',
      pg_catalog.array_to_string(existing_tables, ', ');
  end if;
end
$baseline_preflight$;

create table public.google_connections (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  status text null,
  scopes text null,
  access_token_enc text null,
  refresh_token_enc text null,
  token_expiry_at timestamptz null,
  last_verified_at timestamptz null,
  last_success_at timestamptz null,
  last_error_at timestamptz null,
  last_error_code text null,
  reauth_required boolean not null default false,
  last_user_notified_at timestamptz null,
  last_user_notified_error_code text null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint google_connections_pkey primary key (id),
  constraint google_connections_user_id_key unique (user_id),
  constraint google_connections_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade
);

create table public.rules (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  is_enabled boolean not null default true,
  gmail_label_id text null,
  unread_only boolean not null default false,
  lookback_days integer not null default 7,
  drive_folder_id text null,
  subfolder_mode text null,
  filename_mode text null,
  run_mode text null,
  consecutive_failures integer not null default 0,
  auto_disabled_at timestamptz null,
  subject_keywords text null,
  gmail_query text null,
  query_label text null,
  file_name_format text not null default 'standard'::text,
  filename_template text null,
  is_active boolean not null default false,
  run_timing text not null default 'manual'::text,
  run_count integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint rules_pkey primary key (id),
  constraint rules_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade,
  constraint rules_lookback_days_positive check (lookback_days > 0),
  constraint rules_consecutive_failures_nonnegative check (consecutive_failures >= 0),
  constraint rules_run_count_nonnegative check (run_count >= 0)
);

create index rules_user_created_idx
  on public.rules (user_id, created_at desc);

create table public.runs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  rule_id uuid not null,
  trigger text not null,
  status text not null default 'running'::text,
  started_at timestamptz not null default pg_catalog.now(),
  finished_at timestamptz null,
  processed_count integer not null default 0,
  saved_count integer not null default 0,
  skipped_count integer not null default 0,
  drive_folder_id text null,
  message text null,
  error_code text null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint runs_pkey primary key (id),
  constraint runs_rule_id_fkey
    foreign key (rule_id) references public.rules (id) on delete cascade,
  constraint runs_processed_count_nonnegative check (processed_count >= 0),
  constraint runs_saved_count_nonnegative check (saved_count >= 0),
  constraint runs_skipped_count_nonnegative check (skipped_count >= 0)
);

create index runs_status_updated_at_idx
  on public.runs (status, updated_at desc);

create index runs_user_started_idx
  on public.runs (user_id, started_at desc);

create index runs_rule_id_started_at_idx
  on public.runs (rule_id, started_at desc);

create table public.processed_emails (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  rule_id uuid not null,
  gmail_message_id text not null,
  drive_file_id text null,
  drive_web_view_link text null,
  drive_file_name text null,
  created_at timestamptz not null default pg_catalog.now(),
  saved_at timestamptz not null default pg_catalog.now(),
  constraint processed_emails_pkey primary key (id),
  constraint processed_emails_rule_msg_uniq unique (rule_id, gmail_message_id),
  constraint processed_emails_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade,
  constraint processed_emails_rule_id_fkey
    foreign key (rule_id) references public.rules (id) on delete cascade
);

create index processed_emails_user_idx
  on public.processed_emails (user_id);

create index processed_emails_rule_idx
  on public.processed_emails (rule_id);

create index processed_emails_user_saved_idx
  on public.processed_emails (user_id, saved_at desc);

create table public.user_profiles (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  display_name text null,
  company_name text null,
  industry text null,
  employee_size text null,
  marketing_opt_in boolean not null default false,
  plan text not null default 'free'::text,
  billing_provider text null,
  billing_customer_id text null,
  billing_subscription_id text null,
  billing_status text null,
  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  plan_updated_at timestamptz null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint user_profiles_pkey primary key (id),
  constraint user_profiles_user_id_key unique (user_id),
  constraint user_profiles_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete cascade,
  constraint user_profiles_plan_check check (plan = any (array['free'::text, 'pro'::text, 'pro_plus'::text]))
);

create index user_profiles_user_id_idx
  on public.user_profiles (user_id);

alter table public.google_connections enable row level security;
alter table public.rules enable row level security;
alter table public.runs enable row level security;
alter table public.processed_emails enable row level security;
alter table public.user_profiles enable row level security;

-- Fail closed between the baseline and the hardening migration. Supabase projects
-- may have permissive default privileges for objects created in public.
revoke all on table public.google_connections from public, anon, authenticated, service_role;
revoke all on table public.rules from public, anon, authenticated, service_role;
revoke all on table public.runs from public, anon, authenticated, service_role;
revoke all on table public.processed_emails from public, anon, authenticated, service_role;
revoke all on table public.user_profiles from public, anon, authenticated, service_role;

commit;
