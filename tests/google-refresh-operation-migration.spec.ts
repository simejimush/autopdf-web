import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260811041554_add_google_refresh_operations.sql",
  ),
  "utf8",
).toLowerCase();

test("operation migration is user-scoped, RLS protected, and service-role only for writes", () => {
  expect(migration).toContain("user_id uuid not null");
  expect(migration).toContain(
    "foreign key (user_id) references public.google_connections (user_id)",
  );
  expect(migration).toContain(
    "alter table public.google_refresh_operations enable row level security",
  );
  expect(migration).toContain(
    "alter table public.google_refresh_operations force row level security",
  );
  expect(migration).toContain(
    "revoke all on table public.google_refresh_operations\n  from public, anon, authenticated, service_role",
  );
  expect(migration).toContain(
    "grant select, insert, update on table public.google_refresh_operations to service_role",
  );
  expect(migration).not.toContain(
    "grant insert on table public.google_refresh_operations to authenticated",
  );
  expect(migration).toContain("and contype = 'p'");
  expect(migration).toContain("and contype = 'f'");
  expect(migration).toContain("and contype = 'c'");
  expect(migration).toContain("and indexdef like '%unique index%'");
});

test("operation migration durably separates pre-provider retry from unknown outcome", () => {
  expect(migration).toContain("provider_call_started_at timestamptz");
  expect(migration).toContain("'outcome_unknown'");
  expect(migration).toContain(
    "if current_operation.state = 'provider_call_started' then",
  );
  expect(migration).toContain(
    "set state = 'outcome_unknown', error_code = 'google_refresh_outcome_unknown'",
  );
  expect(migration).toContain(
    "if current_operation.state in ('failed_terminal', 'resolved') then",
  );
  expect(migration).toContain(
    "where state in ('prepared', 'provider_call_started', 'outcome_unknown')",
  );
  expect(migration).toContain(
    "set state = 'resolved', resolved_at = claim_timestamp",
  );
  expect(migration).toContain(
    "and expected_credential_version < p_expected_credential_version",
  );
});

test("finalization keeps credential CAS and operation completion in one RPC transaction", () => {
  expect(migration).toContain(
    "create or replace function public.finalize_google_refresh_operation",
  );
  expect(migration).toContain(
    "and connection.credential_version = p_expected_credential_version",
  );
  expect(migration).toContain(
    "and connection.refresh_lease_id_hash = p_lease_id_hash",
  );
  expect(migration).toContain(
    "declare next_version bigint := p_expected_credential_version + 1",
  );
  expect(migration).toContain("credential_version = next_version");
  expect(migration).toContain(
    "refresh_token_enc = case when p_refresh_token_present\n        then p_refresh_token_enc else connection.refresh_token_enc end",
  );
  expect(migration).toContain(
    "set state = 'completed', result_credential_version = saved_version",
  );
  expect(migration).toContain(
    "set status = 'error', reauth_required = true,\n        last_error_code = 'google_refresh_outcome_unknown'",
  );
});

test("RPC surface uses explicit search path and excludes public clients", () => {
  for (const functionName of [
    "prepare_google_refresh_operation",
    "mark_google_refresh_provider_started",
    "finalize_google_refresh_operation",
    "transition_google_refresh_operation",
    "get_google_refresh_operation",
  ]) {
    expect(migration).toContain(
      `create or replace function public.${functionName}`,
    );
    expect(migration).toContain(
      `revoke execute on function public.${functionName}`,
    );
    expect(migration).toContain(
      `grant execute on function public.${functionName}`,
    );
  }
  expect(migration).toContain("security invoker set search_path = ''");
  expect(migration).not.toMatch(
    /grant execute on function[\s\S]*?to authenticated/,
  );
});
