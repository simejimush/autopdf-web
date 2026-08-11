import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const originalSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260811041554_add_google_refresh_operations.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");
const remediation = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260811134704_protect_google_refresh_finalize_lease_ownership.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");
const sql = remediation.toLowerCase();

test("preserves the already-applied operation migration source", () => {
  expect(createHash("sha256").update(originalSource).digest("hex")).toBe(
    "c0ecf2f4672db67c0ad0c432beb5e7d46723abb2b7883f1bdadbe3a1261d69e4",
  );
});

test("is transactional, bounded, forward-only, and fail-closed before mutation", () => {
  const topLevelSql = sql
    .replace(/as \$prepare\$[\s\S]*?\$prepare\$;/, "[prepare body]")
    .replace(/as \$finalize\$[\s\S]*?\$finalize\$;/, "[finalize body]")
    .replace(/as \$transition\$[\s\S]*?\$transition\$;/, "[transition body]");
  const preflightEnd = sql.indexOf(
    "$google_refresh_operation_ambiguity_preflight$;",
  );
  const mutation = sql.indexOf(
    "create or replace function public.prepare_google_refresh_operation",
  );
  expect(sql.trimStart()).toMatch(/^begin;/);
  expect(sql.trimEnd()).toMatch(/commit;$/);
  expect(sql).toContain("set local lock_timeout = '5s'");
  expect(sql).toContain("set local statement_timeout = '30s'");
  expect(preflightEnd).toBeGreaterThan(0);
  expect(mutation).toBeGreaterThan(preflightEnd);
  expect(sql).toContain("function_count <> 1");
  expect(sql).toContain("identity drifted");
  expect(sql).toContain("metadata drifted");
  expect(sql).toContain("body drifted");
  expect(sql).toContain("acl drifted");
  expect(sql).toContain("extension_owned");
  expect(sql).toContain("eba6ee2683ed43ecccb07b03195f3318");
  expect(sql).toContain("2e6b325769cfdff42355fd83e8853b5f");
  expect(sql).toContain("90f9478a3f055fa2e7b33202f65f37a5");
  expect(sql).toContain("4fad0f538c686b71e1e708ec7442e924");
  expect(sql).toContain("1aa755e1ec0c27e517dfb45001c1b8c5");
  expect(sql).toContain("6fca572601ada25cc9600885e69b711d");
  expect(sql).toContain("bodies drifted or are partially remediated");
  expect(topLevelSql).not.toMatch(
    /^\s*(alter|update|insert|delete)\s+public\.google_/m,
  );
  expect(topLevelSql).not.toMatch(
    /^\s*(create|alter|drop)\s+table\s+public\.google_/m,
  );
});

test("qualifies prepare and transition columns that collide with table outputs", () => {
  expect(sql).toContain(
    "connection.credential_version = p_expected_credential_version",
  );
  expect(sql).toContain(
    "and connection.refresh_lease_id_hash = current_operation.lease_id_hash",
  );
  expect(sql).toContain(
    "and operation.expected_credential_version = p_expected_credential_version",
  );
  expect(sql).toContain(
    "returning connection.credential_version into claimed_version",
  );
  expect(sql).toContain(
    "set status = case when p_target_state = 'retryable' then connection.status else 'error' end",
  );
});

test("requires late finalize to retain the exact connection lease", () => {
  const fallback = sql.match(
    /if saved_version is null then([\s\S]*?)return query select 'outcome_unknown'/,
  )?.[1];
  expect(fallback).toContain(
    "credential_version = p_expected_credential_version",
  );
  expect(fallback).toContain("refresh_lease_id_hash = p_lease_id_hash");
  expect(fallback).toContain("update public.google_connections as connection");
  expect(fallback).toContain(
    "connection.credential_version = p_expected_credential_version",
  );
  expect(fallback).toContain(
    "connection.refresh_lease_id_hash = p_lease_id_hash",
  );
  expect(sql).toContain(
    "and connection.refresh_lease_id_hash = p_lease_id_hash",
  );
});

test("preserves invoker metadata and normalizes the exact execute ACL", () => {
  expect(sql).toContain(
    "language plpgsql volatile security invoker set search_path = ''",
  );
  expect(sql).toContain("function_row.owner <> 'postgres'");
  expect(sql).toContain("function_row.prosecdef");
  expect(sql).toContain(
    "function_row.proconfig is distinct from array['search_path=\"\"']::text[]",
  );
  expect(sql).toContain("execute_acl_count <> 2");
  expect(sql).toContain("unexpected_execute_acl_count <> 0");
  expect(sql).toContain("from public, anon, authenticated, service_role");
  expect(sql).toContain("to postgres, service_role");
  expect(sql).toContain("remediation postcondition failed");
  expect(sql).toContain("google_refresh_operation_ambiguity_postcondition");
});
