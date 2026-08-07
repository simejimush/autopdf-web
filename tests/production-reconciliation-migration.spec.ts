import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260807064701_reconcile_production_core_security.sql",
);
const FIXTURE = resolve(
  process.cwd(),
  "tests/fixtures/production-core-schema.sql",
);

function sql(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n").toLowerCase();
}

test("pins both the Production inventory and the repository fresh-chain shape", () => {
  const migration = sql(MIGRATION);

  for (const hash of [
    "be7359073eb586a78719707797669451",
    "a4931778b3b93138c17390f78fc12211",
    "d8e362a16b3ffbbc83875466e018e1b7",
    "ced70ec501e6ab1f5a18c5d76544e65f",
    "1c9a5348a4a425a82b25502008a6bc90",
    "96f8298e5ea506cb9b5704668171d627",
    "a5103a6e78330392062e4237db29457f",
    "9c9ce0dc61feae565fad9181be673b00",
    "318ff7fe95549e85ca43d48978fcad3e",
    "af84373b43e48e0e8bc37a1fbbd7f9c7",
    "ea43b3b4c701e1b930d8d2339f9e5181",
    "5606b97859f237247b9f8ff59406c8b5",
  ]) {
    expect(migration).toContain(hash);
  }
  expect(migration).toContain("unknown autopdf schema");
  expect(migration).toContain(
    "unexpected autopdf reconciled column fingerprint",
  );
  expect(migration).toContain("516febf044addbb583fa455bf7297200");
  expect(migration).toContain("6840235007827fb50fa25d30c6b4a23a");
  expect(migration).toContain("unknown autopdf constraint objects");
  expect(migration).toContain("unknown autopdf index objects");
  expect(migration).toContain("unknown autopdf policy objects");
  expect(migration).toContain("unknown autopdf trigger objects");
  expect(migration).toContain("unknown autopdf grant principals");
  expect(migration).toContain("unexpected signup profile function semantics");
  expect(migration).toContain("unexpected set_updated_at function semantics");
  expect(migration).toContain("unexpected moddatetime function provenance");
  expect(migration).toContain("unknown autopdf function grant principals");
});

test("is transactional, bounded, and preflights data before the first mutation", () => {
  const migration = sql(MIGRATION);
  const preflightEnd = migration.indexOf("$reconciliation_preflight$;");
  const firstMutation = migration.indexOf("do $add_missing_constraints$");

  expect(migration.trimStart()).toMatch(/^(?:--[^\n]*\n)*\s*begin;/);
  expect(migration.trimEnd()).toMatch(/commit;$/);
  expect(migration).toContain("set local lock_timeout = '5s'");
  expect(migration).toContain("set local statement_timeout = '120s'");
  expect(migration).toContain("in share row exclusive mode");
  expect(preflightEnd).toBeGreaterThan(0);
  expect(firstMutation).toBeGreaterThan(preflightEnd);
  for (const refusal of [
    "refuses null or orphaned ownership",
    "refuses negative counters",
    "refuses duplicate processed email keys",
    "unexpected google credential version shape",
  ]) {
    expect(migration.indexOf(refusal)).toBeLessThan(firstMutation);
  }
});

test("adds only the missing ownership, audit, and lookup metadata", () => {
  const migration = sql(MIGRATION);
  const executableSql = migration.replace(
    /as \$function\$[\s\S]*?\$function\$;/g,
    "as $function$<function body>$function$;",
  );

  for (const name of [
    "rules_user_id_fkey",
    "processed_emails_user_id_fkey",
    "processed_emails_rule_msg_uniq",
    "rules_consecutive_failures_nonnegative",
    "rules_run_count_nonnegative",
    "runs_processed_count_nonnegative",
    "runs_saved_count_nonnegative",
    "runs_skipped_count_nonnegative",
  ]) {
    expect(migration).toContain(name);
  }
  expect(migration).toContain("not valid");
  expect(migration).toContain("validate constraint");
  expect(migration).toContain("rules_user_created_idx");
  expect(migration).toContain("processed_emails_user_saved_idx");
  expect(migration).toContain(
    "alter table public.runs alter column user_id set not null",
  );
  expect(migration).not.toMatch(/\bcreate\s+table\b/);
  expect(migration).not.toMatch(
    /\bdrop\s+(table|column|constraint|trigger|policy|function|schema)\b/,
  );
  expect(executableSql).not.toMatch(
    /\b(insert\s+into|update|delete\s+from|truncate)\s+public\.(google_connections|rules|runs|processed_emails|user_profiles|ai_usage_logs)\b/,
  );
});

test("preserves Production policy and trigger objects while narrowing access", () => {
  const migration = sql(MIGRATION);

  expect(migration).toContain("alter policy %i on public.%i");
  expect(migration).toContain("to authenticated");
  expect(migration).toContain("missing required rls policy commands");
  expect(migration).toContain("missing preserved updated_at triggers");
  expect(migration).toContain(
    "alter function public.handle_new_user_create_profile() set schema private",
  );
  expect(migration).toContain(
    "t.tgfoid = 'private.handle_new_user_create_profile()'::regprocedure",
  );
  expect(migration).not.toContain("drop policy");
  expect(migration).not.toContain("drop trigger");
});

test("validates trigger functions by stable security semantics", () => {
  const migration = sql(MIGRATION);

  expect(migration).toContain("p.prosrc");
  expect(migration).toContain(
    "lower(regexp_replace(function_source, '[[:space:]]', '', 'g'))",
  );
  expect(migration).toContain(
    "begininsertintopublic.user_profiles(user_id)values(new.id)onconflict(user_id)donothing;returnnew;end;",
  );
  expect(migration).toContain("function_return_type <> 'trigger'");
  expect(migration).toContain("function_owner <> 'postgres'");
  expect(migration).not.toContain("functions_hash");
});

test("re-establishes the hardening grant contract without exposing token columns", () => {
  const migration = sql(MIGRATION);
  const authenticatedGoogleGrant = migration.match(
    /grant select \(([\s\S]*?)\) on table public\.google_connections to authenticated;/,
  )?.[1];

  expect(authenticatedGoogleGrant).toBeTruthy();
  expect(authenticatedGoogleGrant).not.toMatch(
    /access_token_enc|refresh_token_enc|token_expiry_at|credential_version/,
  );
  expect(migration).toContain(
    "revoke all on table public.google_connections from public, anon, authenticated, service_role",
  );
  expect(migration).toContain("missing service_role privileges");
  expect(migration).not.toMatch(
    /grant [^;]*(access_token_enc|refresh_token_enc)[^;]* to authenticated/,
  );
});

test("keeps credential_version as a separate pending migration", () => {
  const migration = sql(MIGRATION);

  expect(migration).toContain(
    "apply the still-pending credential_version migration separately",
  );
  expect(migration).toContain("credential_attnum is not null");
  expect(migration).not.toContain("add column credential_version");
  expect(migration).not.toContain("drop column credential_version");
});

test("uses an anonymous Production-like fixture with no credential material", () => {
  const fixture = sql(FIXTURE);

  for (const table of [
    "google_connections",
    "rules",
    "runs",
    "processed_emails",
    "user_profiles",
    "ai_usage_logs",
  ]) {
    expect(fixture).toContain(`create table public.${table}`);
  }
  expect(fixture).toContain("fixture@example.invalid");
  expect(fixture).toContain("10000000-0000-4000-8000-000000000001");
  expect(fixture).toContain("on conflict (user_id) do update");
  expect(fixture).not.toMatch(/@[a-z0-9.-]+\.(com|net|org|jp)\b/);
  expect(fixture).not.toMatch(/(access_token_enc|refresh_token_enc)\s*\)/);
  expect(fixture).not.toMatch(/bearer\s+[a-z0-9._-]+/);
});
