import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const BASELINE_NAME = "20260528090000_create_autopdf_core_baseline.sql";
const AI_USAGE_NAME = "20260529090000_create_ai_usage_logs.sql";
const HARDENING_NAME = "20260530090000_harden_autopdf_core_security.sql";
const CREDENTIAL_NAME = "20260726090000_add_google_credential_version.sql";
const RECONCILIATION_NAME =
  "20260807064701_reconcile_production_core_security.sql";
const REFRESH_LEASE_NAME = "20260809180000_add_google_refresh_lease.sql";
const RLS_AUTO_ENABLE_ACL_NAME =
  "20260810044303_harden_rls_auto_enable_acl.sql";

function readMigration(name: string): string {
  return readFileSync(resolve(MIGRATIONS_DIR, name), "utf8");
}

function normalizedSql(name: string): string {
  return readMigration(name).replace(/\r\n/g, "\n").toLowerCase();
}

function expectTransactionalWithTimeouts(sql: string): void {
  expect(sql.trimStart()).toMatch(/^(?:--[^\n]*\n)*\s*begin;/);
  expect(sql.trimEnd()).toMatch(/commit;$/);
  expect(sql).toContain("set local lock_timeout");
  expect(sql).toContain("set local statement_timeout");
}

test("fixes the AutoPDF migration filename and dependency order", () => {
  const migrationNames = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  expect(migrationNames).toEqual([
    BASELINE_NAME,
    AI_USAGE_NAME,
    HARDENING_NAME,
    CREDENTIAL_NAME,
    RECONCILIATION_NAME,
    REFRESH_LEASE_NAME,
    RLS_AUTO_ENABLE_ACL_NAME,
  ]);
  expect(normalizedSql(BASELINE_NAME)).not.toContain("credential_version");
  expect(normalizedSql(HARDENING_NAME)).toContain(
    "credential_version must not exist before autopdf hardening",
  );
  expect(normalizedSql(CREDENTIAL_NAME)).toContain(
    "add column credential_version bigint",
  );
  expect(normalizedSql(CREDENTIAL_NAME)).not.toContain(
    "add column if not exists credential_version",
  );
});

test("hardens only the known rls_auto_enable function ACL", () => {
  const sql = normalizedSql(RLS_AUTO_ENABLE_ACL_NAME);

  expectTransactionalWithTimeouts(sql);
  expect(sql).toContain("do $rls_auto_enable_acl_preflight$");
  expect(sql).toContain("do $rls_auto_enable_acl_postcondition$");
  expect(sql).toContain("6998ea6b4c2480f5d2e34b5dcf3f8d36");
  expect(
    sql.match(
      /revoke execute on function public\.rls_auto_enable\(\) from public;/g,
    ),
  ).toHaveLength(1);

  for (const role of [
    "public",
    "anon",
    "authenticated",
    "service_role",
    "postgres",
  ]) {
    expect(sql).toContain(
      "has_function_privilege('" + role + "', target_function, 'execute')",
    );
  }

  expect(sql).toContain("ensure_rls");
  expect(sql).toContain(
    "array['create table', 'create table as', 'select into']::text[]",
  );
  expect(sql).not.toMatch(/^\s*grant\b/im);
  expect(sql).not.toMatch(/^\s*(create|alter|drop)\s+function\b/im);
  expect(sql).not.toMatch(/^\s*(create|alter|drop)\s+event\s+trigger\b/im);
  expect(sql).not.toMatch(/^\s*(create|alter|drop)\s+policy\b/im);
  expect(sql).not.toMatch(
    /^\s*(create|alter|drop|grant|revoke)\s+.*\bon\s+table\b/im,
  );
  expect(sql).not.toMatch(
    /\b(enable|disable|force)\s+row\s+level\s+security\b/,
  );
  expect(sql).not.toMatch(/access_token_enc|refresh_token_enc|client_secret/);
});

test("keeps the core baseline Preview-only, transactional, and fail-closed", () => {
  const sql = normalizedSql(BASELINE_NAME);

  expectTransactionalWithTimeouts(sql);
  expect(sql).toContain("brand-new, empty preview supabase database only");
  expect(sql).toContain("never apply this migration to production");
  expect(sql).toContain("if pg_catalog.cardinality(existing_tables) <> 0");
  expect(sql).toContain(
    "autopdf preview baseline refuses a partial or existing core schema",
  );
  expect(sql).toContain("to_regclass('auth.users')");
  expect(sql).toContain("to_regprocedure('gen_random_uuid()')");
  expect(sql).not.toMatch(
    /\bdrop\s+(table|column|constraint|function|schema)\b/,
  );
  expect(sql).not.toMatch(/\bdelete\s+from\b/);
  expect(sql).not.toMatch(/\btruncate\s+(table\s+)?public\./);
  expect(sql).not.toMatch(/\binsert\s+into\b/);
  expect(sql).not.toContain("ai_usage_logs");
  expect(sql).not.toContain("credential_version");
});

test("creates the repository-compatible baseline schema and safe initial grants", () => {
  const sql = normalizedSql(BASELINE_NAME);

  for (const table of [
    "google_connections",
    "rules",
    "runs",
    "processed_emails",
    "user_profiles",
  ]) {
    expect(sql).toContain(`create table public.${table}`);
    expect(sql).toContain(
      `alter table public.${table} enable row level security`,
    );
    expect(sql).toContain(
      `revoke all on table public.${table} from public, anon, authenticated, service_role`,
    );
  }

  expect(sql).toMatch(
    /create table public\.runs \([\s\S]*?user_id uuid not null,/,
  );
  expect(sql).toContain("query_label text null");
  expect(sql).toContain(
    "file_name_format text not null default 'standard'::text",
  );
  expect(sql).toContain("skipped_count integer not null default 0");
  expect(sql).toContain("plan_updated_at timestamptz null");
  expect(sql).toContain("constraint processed_emails_rule_msg_uniq unique");
});

test("creates ai_usage_logs transactionally only from a completely absent shape", () => {
  const sql = normalizedSql(AI_USAGE_NAME);
  const firstDdl = sql.indexOf("create extension if not exists pgcrypto");

  expectTransactionalWithTimeouts(sql);
  expect(firstDdl).toBeGreaterThan(0);
  expect(sql.indexOf("do $ai_usage_logs_preflight$")).toBeLessThan(firstDdl);
  expect(sql.indexOf("requires a completely absent shape")).toBeLessThan(
    firstDdl,
  );
  for (const relation of [
    "ai_usage_logs",
    "ai_usage_logs_pkey",
    "ai_usage_logs_feature_created_idx",
    "ai_usage_logs_run_idx",
    "ai_usage_logs_user_created_idx",
  ]) {
    expect(sql.indexOf(`'${relation}'`)).toBeLessThan(firstDdl);
  }
  expect(sql.indexOf("refuses existing policies")).toBeLessThan(firstDdl);
  expect(sql.indexOf("refuses existing grants")).toBeLessThan(firstDdl);
  expect(sql).not.toContain("create table if not exists public.ai_usage_logs");
  expect(sql).not.toMatch(/create index if not exists ai_usage_logs_/);
});

test("keeps the intermediate ai_usage_logs contract deterministic and fail-closed", () => {
  const sql = normalizedSql(AI_USAGE_NAME);

  expect(sql).toContain("create table public.ai_usage_logs");
  expect(sql).toContain("constraint ai_usage_logs_pkey primary key (id)");
  expect(sql.match(/create index ai_usage_logs_/g)).toHaveLength(3);
  expect(sql).toContain(
    "alter table public.ai_usage_logs enable row level security",
  );
  expect(sql).toContain('create policy "users can insert own ai usage logs"');
  expect(sql).toContain('create policy "users can read own ai usage logs"');
  expect(sql).toContain("to authenticated");
  expect(sql).toContain("with check (auth.uid() = user_id)");
  expect(sql).toContain("using (auth.uid() = user_id)");
  expect(sql).toMatch(
    /revoke all on table public\.ai_usage_logs\s+from public, anon, authenticated, service_role;/,
  );
  expect(sql).not.toMatch(
    /\bdrop\s+(table|column|constraint|function|schema)\b/,
  );
  expect(sql).not.toMatch(/\b(delete|truncate)\b/);
  expect(sql).not.toMatch(/\b(insert|update)\s+public\.ai_usage_logs\b/);
});

test("fails hardening before mutations on unknown schema or null run owners", () => {
  const sql = normalizedSql(HARDENING_NAME);
  const firstMutation = sql.indexOf("create schema if not exists private");

  expectTransactionalWithTimeouts(sql);
  expect(firstMutation).toBeGreaterThan(0);
  expect(sql.indexOf("unexpected column shape")).toBeLessThan(firstMutation);
  expect(sql.indexOf("unexpected column set")).toBeLessThan(firstMutation);
  expect(sql.indexOf("unexpected autopdf constraints")).toBeLessThan(
    firstMutation,
  );
  expect(sql.indexOf("unexpected constraint fingerprint")).toBeLessThan(
    firstMutation,
  );
  expect(sql.indexOf("unexpected autopdf indexes")).toBeLessThan(firstMutation);
  expect(sql.indexOf("unexpected index fingerprint")).toBeLessThan(
    firstMutation,
  );
  expect(sql.indexOf("unknown autopdf policy fingerprints")).toBeLessThan(
    firstMutation,
  );
  expect(
    sql.indexOf("duplicate autopdf policy command fingerprint"),
  ).toBeLessThan(firstMutation);
  expect(sql.indexOf("unexpected autopdf policy command set")).toBeLessThan(
    firstMutation,
  );
  expect(sql.indexOf("unknown autopdf table grants")).toBeLessThan(
    firstMutation,
  );
  expect(sql.indexOf("unknown autopdf column grants")).toBeLessThan(
    firstMutation,
  );
  expect(
    sql.indexOf("unknown public signup function fingerprint"),
  ).toBeLessThan(firstMutation);
  expect(sql.indexOf("unknown moddatetime trigger argument")).toBeLessThan(
    firstMutation,
  );
  expect(
    sql.indexOf("exists (select 1 from public.runs where user_id is null)"),
  ).toBeLessThan(firstMutation);
  expect(sql).toContain("backfill is forbidden");
  expect(sql).not.toMatch(
    /\bupdate\s+public\.(google_connections|rules|runs|processed_emails|user_profiles|ai_usage_logs)\b/,
  );
});

test("limits authenticated profile columns without retaining table-level writes", () => {
  const sql = normalizedSql(HARDENING_NAME);

  expect(sql).toContain(
    "revoke all on table public.user_profiles from public, anon, authenticated, service_role",
  );
  expect(sql).toMatch(
    /grant insert \(user_id\) on table public\.user_profiles to authenticated;/,
  );
  expect(sql).toMatch(
    /grant update \(\s*display_name, company_name, industry, employee_size, marketing_opt_in\s*\) on table public\.user_profiles to authenticated;/,
  );
  expect(sql).not.toMatch(
    /grant (?:all|insert|update)(?!\s*\()[^;]*public\.user_profiles to authenticated/,
  );

  const authenticatedUpdateGrant = sql.match(
    /grant update \(([\s\S]*?)\) on table public\.user_profiles to authenticated;/,
  );
  expect(authenticatedUpdateGrant?.[1]).not.toMatch(
    /\b(plan|billing_provider|billing_customer_id|billing_subscription_id|billing_status|current_period_end|cancel_at_period_end|plan_updated_at)\b/,
  );
});

test("keeps Google token and notification internals outside authenticated SELECT", () => {
  const sql = normalizedSql(HARDENING_NAME);
  const grant = sql.match(
    /grant select \(([\s\S]*?)\) on table public\.google_connections to authenticated;/,
  );

  expect(grant?.[1]).toBeTruthy();
  for (const column of [
    "id",
    "user_id",
    "status",
    "scopes",
    "last_verified_at",
    "last_success_at",
    "last_error_at",
    "last_error_code",
    "reauth_required",
    "updated_at",
  ]) {
    expect(grant?.[1]).toMatch(new RegExp(`\\b${column}\\b`));
  }
  expect(grant?.[1]).not.toMatch(
    /access_token_enc|refresh_token_enc|token_expiry_at|created_at|last_user_notified_at|last_user_notified_error_code|credential_version/,
  );
  expect(sql).not.toMatch(
    /grant (?:all|insert|update|delete)(?!\s*\()[^;]*public\.google_connections to authenticated/,
  );
});

test("installs only authenticated own-row policies and removes AI client access", () => {
  const sql = normalizedSql(HARDENING_NAME);

  for (const policy of [
    "google_connections_select_own",
    "rules_select_own",
    "runs_select_own",
    "processed_emails_select_own",
    "user_profiles_select_own",
    "user_profiles_insert_own",
    "user_profiles_update_own",
  ]) {
    expect(sql).toContain(`create policy ${policy}`);
  }
  expect(sql.match(/create policy /g)).toHaveLength(7);
  expect(sql.match(/to authenticated/g)?.length).toBeGreaterThanOrEqual(7);
  expect(sql).not.toMatch(/create policy[\s\S]*?\bto\s+(public|anon)\b/);
  expect(sql).toContain("using ((select auth.uid()) = user_id)");
  expect(sql).toContain("with check ((select auth.uid()) = user_id)");
  expect(sql).not.toMatch(/create policy[^;]+on public\.ai_usage_logs/);
  expect(sql).not.toMatch(/grant [^;]+public\.ai_usage_logs to authenticated/);
});

test("preserves least-privilege service repositories", () => {
  const sql = normalizedSql(HARDENING_NAME);

  expect(sql).toContain(
    "grant select, insert, update, delete on table public.google_connections to service_role",
  );
  expect(sql).toContain(
    "grant select, insert, update, delete on table public.rules to service_role",
  );
  expect(sql).toContain(
    "grant select, insert, update on table public.runs to service_role",
  );
  expect(sql).toContain(
    "grant select, insert on table public.processed_emails to service_role",
  );
  expect(sql).toContain(
    "grant select, insert, update on table public.user_profiles to service_role",
  );
  expect(sql).toContain(
    "grant select, insert on table public.ai_usage_logs to service_role",
  );
});

test("locks down the signup function and normalizes its only trigger", () => {
  const sql = normalizedSql(HARDENING_NAME);
  const signupFunction = sql.match(
    /create or replace function private\.handle_new_user_create_profile\(\)([\s\S]*?)alter function private\.handle_new_user_create_profile\(\) owner to postgres;/,
  )?.[1];

  expect(sql).toContain("drop function if exists public.handle_new_user()");
  expect(sql).toContain(
    "drop function if exists public.handle_new_user_create_profile()",
  );
  expect(signupFunction).toContain("security definer");
  expect(signupFunction).toContain("set search_path = ''");
  expect(signupFunction).toContain(
    "insert into public.user_profiles (user_id)",
  );
  expect(signupFunction).toContain("values (new.id)");
  expect(signupFunction).toContain("on conflict (user_id) do nothing");
  expect(signupFunction).not.toMatch(/\b(plan|billing_|update|delete)\b/);
  expect(sql).toContain(
    "revoke all on function private.handle_new_user_create_profile() from public, anon, authenticated",
  );
  expect(sql).toMatch(
    /create trigger on_auth_user_created_create_profile\s+after insert on auth\.users\s+for each row execute function private\.handle_new_user_create_profile\(\)/,
  );
  expect(sql.match(/after insert on auth\.users/g)).toHaveLength(1);
});

test("uses one invoker updated_at trigger per mutable core table", () => {
  const sql = normalizedSql(HARDENING_NAME);
  const updatedAtFunction = sql.match(
    /create or replace function public\.set_updated_at\(\)([\s\S]*?)alter function public\.set_updated_at\(\) owner to postgres;/,
  )?.[1];

  expect(updatedAtFunction).toContain("security invoker");
  expect(updatedAtFunction).toContain("set search_path = ''");
  expect(updatedAtFunction).toContain("new.updated_at = pg_catalog.now()");
  expect(sql).toContain(
    "revoke all on function public.set_updated_at() from public, anon, authenticated",
  );
  for (const table of ["rules", "runs", "user_profiles"]) {
    expect(
      sql.match(new RegExp(`before update on public\\.${table}`, "g")),
    ).toHaveLength(1);
  }
  expect(sql).toContain(
    "alter table public.runs alter column user_id set not null",
  );
  expect(sql).not.toMatch(/drop\s+extension[^;]*moddatetime/);
});

test("does not embed or emit token, secret, row, or Production values", () => {
  const baseline = normalizedSql(BASELINE_NAME);
  const hardening = normalizedSql(HARDENING_NAME);

  expect(baseline).not.toMatch(/\bvalues\s*\(/);
  expect(baseline).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
  );
  expect(hardening).not.toMatch(/raise\s+(notice|warning|log)/);
  expect(hardening).not.toMatch(
    /(access_token_enc|refresh_token_enc)[^\n]*raise exception/,
  );
  expect(hardening).not.toMatch(
    /\b(insert|update|delete)\s+public\.ai_usage_logs\b/,
  );
});
