import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260726090000_add_google_credential_version.sql",
);

test("credential version migration is transactional and re-runnable", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8").toLowerCase();

  expect(sql.trimStart()).toMatch(/^begin;/);
  expect(sql.trimEnd()).toMatch(/commit;$/);
  expect(sql).toContain("add column if not exists credential_version bigint");
  expect(sql).toContain("actual_type is distinct from 'bigint'");
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
