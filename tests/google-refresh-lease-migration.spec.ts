import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260809180000_add_google_refresh_lease.sql",
);
const TOKEN_STORE_PATH = resolve(process.cwd(), "src/lib/google/tokenStore.ts");
const AUTH_PATH = resolve(process.cwd(), "src/lib/google/auth.ts");

function sql() {
  return readFileSync(MIGRATION_PATH, "utf8").toLowerCase();
}

test("refresh lease migration is transactional and bounded", () => {
  const migration = sql();
  expect(migration.trimStart()).toMatch(/^begin;/);
  expect(migration.trimEnd()).toMatch(/commit;$/);
  expect(migration).toContain("set local lock_timeout = '5s'");
  expect(migration).toContain("set local statement_timeout = '120s'");
  expect(migration).toContain(
    "lock table public.google_connections in access exclusive mode",
  );
});

test("preflight accepts only both-absent or the exact constrained replay shape", () => {
  const migration = sql();
  const preflight = migration.indexOf("do $google_refresh_lease_preflight$");
  const apply = migration.indexOf("do $google_refresh_lease_apply$");
  const ddl = migration.indexOf("alter table public.google_connections", apply);
  expect(preflight).toBeGreaterThan(0);
  expect(apply).toBeGreaterThan(preflight);
  expect(ddl).toBeGreaterThan(apply);
  expect(migration.indexOf("must be both absent or both present")).toBeLessThan(
    apply,
  );
  expect(migration).toContain("must be nullable text without a default");
  expect(migration).toContain("must be nullable timestamptz without a default");
  expect(migration).toContain(
    "refresh lease pair constraint is missing or unexpected",
  );
  expect(migration).toContain(
    "refresh lease hash constraint is missing or unexpected",
  );
  expect(migration).toContain("claim function contract is unexpected");
  expect(migration).toContain("claim function grants are unexpected");
  expect(migration).toContain("unexpected google refresh lease dependencies");
  expect(migration).not.toContain("add column if not exists");
});

test("absent shape adds nullable columns and validated pair and digest checks", () => {
  const migration = sql();
  const apply = migration.slice(
    migration.indexOf("do $google_refresh_lease_apply$"),
  );
  expect(apply).toMatch(
    /add column refresh_lease_id_hash text null,\s*add column refresh_lease_expires_at timestamptz null/,
  );
  expect(apply).toContain("google_connections_refresh_lease_pair check");
  expect(apply).toContain("google_connections_refresh_lease_hash_format check");
  expect(apply).toContain("refresh_lease_id_hash ~ '^[0-9a-f]{64}$'");
  expect(apply).not.toContain("not valid");
});

test("claim RPC uses one server timestamp, fixed TTL, invoker rights, and static SQL", () => {
  const migration = sql();
  const body = migration.match(
    /as \$claim_function\$([\s\S]+?)\$claim_function\$;/,
  );
  expect(body).not.toBeNull();
  expect(body![1]).toContain(
    "claim_timestamp timestamptz := statement_timestamp()",
  );
  expect(body![1]).toContain("interval '90 seconds'");
  expect(body![1]).toContain("update public.google_connections");
  expect(body![1]).toContain("connection.user_id = p_user_id");
  expect(body![1]).toContain(
    "connection.credential_version = p_expected_credential_version",
  );
  expect(body![1]).not.toMatch(/\bexecute\b/);
  expect(migration).toContain("security invoker");
  expect(migration).toContain("volatile");
  expect(migration).not.toMatch(/p_(claimed_at|expires_at|ttl)/);
});

test("runtime timeout and documented lease TTL stay consistent with the RPC", () => {
  const tokenStore = readFileSync(TOKEN_STORE_PATH, "utf8");
  const auth = readFileSync(AUTH_PATH, "utf8");
  const migration = sql();
  const ttlSeconds = Number(
    tokenStore.match(/GOOGLE_REFRESH_LEASE_TTL_SECONDS\s*=\s*(\d+)/)?.[1],
  );
  const timeoutMs = Number(
    auth
      .match(/GOOGLE_REFRESH_PROVIDER_TIMEOUT_MS\s*=\s*([\d_]+)/)?.[1]
      ?.replaceAll("_", ""),
  );

  expect(ttlSeconds).toBe(90);
  expect(timeoutMs).toBe(30_000);
  expect(timeoutMs).toBeLessThan(ttlSeconds * 1_000);
  expect(migration).toContain(`interval '${ttlSeconds} seconds'`);
});

test("RPC is service-role only and migration preserves credential and RLS surfaces", () => {
  const migration = sql();
  expect(migration).toContain("owner to postgres");
  expect(migration).toContain("from public, anon, authenticated");
  expect(migration).toContain("to service_role");
  expect(migration).not.toMatch(/access_token_enc|refresh_token_enc/);
  expect(migration).not.toMatch(/drop\s+(column|constraint|table)/);
  expect(migration).not.toMatch(/disable\s+row\s+level\s+security/);
  expect(migration).not.toMatch(/\b(create|alter|drop)\s+policy\b/);
  expect(migration).not.toMatch(/\b(grant|revoke)\b[^;]*\bon table\b/);
});
