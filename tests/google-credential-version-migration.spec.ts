import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260726090000_add_google_credential_version.sql",
);

test("credential version migration is transactional with bounded locks", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8").toLowerCase();

  expect(sql.trimStart()).toMatch(/^begin;/);
  expect(sql.trimEnd()).toMatch(/commit;$/);
  expect(sql).toContain("set local lock_timeout = '5s'");
  expect(sql).toContain("set local statement_timeout = '120s'");
  expect(sql).toContain("add column credential_version bigint");
  expect(sql).not.toContain("add column if not exists credential_version");
});

test("credential version preflight runs before DDL and accepts only absent or exact shape", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8").toLowerCase();
  const preflight = sql.indexOf("do $credential_version_preflight$");
  const apply = sql.indexOf("do $credential_version_apply$");
  const firstDdl = sql.indexOf("alter table public.google_connections", apply);

  expect(preflight).toBeGreaterThan(0);
  expect(apply).toBeGreaterThan(preflight);
  expect(firstDdl).toBeGreaterThan(apply);
  expect(sql.indexOf("requires public.google_connections")).toBeLessThan(apply);
  expect(sql.indexOf("lock table public.google_connections")).toBeLessThan(
    apply,
  );
  expect(sql).toContain("in access exclusive mode");
  expect(sql.indexOf("orphaned credential_version constraint")).toBeLessThan(
    apply,
  );
  expect(sql).toContain("actual_type is distinct from 'bigint'");
  expect(sql).toContain("must be not null");
  expect(sql).toContain("must default to 0");
  expect(sql).toContain("c.convalidated");
  expect(sql).toContain("unexpected credential_version constraints");
  expect(sql).toContain("contains null rows");
  expect(sql).toContain("contains negative rows");
  expect(sql).toMatch(
    /if not exists \([\s\S]*?a\.attname = 'credential_version'[\s\S]*?\) then[\s\S]*?add column credential_version bigint/,
  );
});

test("credential version absent-column path backfills before enforcing shape", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8").toLowerCase();

  expect(sql).toContain("alter column credential_version set default 0");
  expect(sql).toContain("where credential_version is null");
  expect(sql).toContain("check (credential_version >= 0) not valid");
  expect(sql).toContain(
    "validate constraint google_connections_credential_version_nonnegative",
  );
  expect(sql).toContain("alter column credential_version set not null");
});

test("credential version migration preserves ownership and token data", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8").toLowerCase();

  expect(sql).not.toMatch(/access_token_enc|refresh_token_enc/);
  expect(sql).not.toMatch(/drop\s+(column|constraint|table)/);
  expect(sql).not.toMatch(/disable\s+row\s+level\s+security/);
  expect(sql).not.toMatch(/\b(create|alter|drop)\s+policy\b/);
  expect(sql).not.toMatch(/\b(grant|revoke)\b/);
});
