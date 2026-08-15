import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260815102644_stripe_safety_contracts.sql",
  ),
  "utf8",
).toLowerCase();

test("Stripe safety migration is transactional, bounded, and fail-closed", () => {
  expect(migration.trimStart()).toMatch(/^begin;/);
  expect(migration.trimEnd()).toMatch(/commit;$/);
  expect(migration).toContain("set local lock_timeout = '5s'");
  expect(migration).toContain("set local statement_timeout = '30s'");
  expect(migration).toContain("unexpected pre-existing table");
  expect(migration).toContain("unexpected partial user_profiles shape");
  expect(migration).toContain("duplicate stripe ownership reference");
  expect(migration).not.toMatch(/\b(create|add)\b[^;]*\bif not exists\b/);
});

test("dependency schema drift is rejected before the first mutation", () => {
  const firstMutation = migration.indexOf("alter table public.user_profiles");
  const dependencyGuard = migration.indexOf(
    "stripe safety migration blocked: dependency schema drift",
  );
  expect(dependencyGuard).toBeGreaterThan(-1);
  expect(dependencyGuard).toBeLessThan(firstMutation);
  for (const dependency of [
    "('user_profiles', 'billing_customer_id', 'text'",
    "('user_profiles', 'billing_subscription_id', 'text'",
    "('user_profiles', 'billing_status', 'text'",
    "('user_profiles', 'cancel_at_period_end', 'boolean'",
    "('rules', 'user_id', 'uuid'",
    "('rules', 'is_active', 'boolean'",
    "('rules', 'created_at', 'timestamp with time zone'",
  ]) {
    expect(migration).toContain(dependency);
  }
  expect(migration).toContain("dependency constraint drift");
  expect(migration).toContain("dependency index drift");
  expect(migration).toContain("rules_user_created_idx");
  expect(migration).toContain(
    "constraint_row.confrelid = 'auth.users'::regclass",
  );
});

test("dependency index comparison normalizes catalog array bounds and preserves order", () => {
  const firstMutation = migration.indexOf("alter table public.user_profiles");
  const indexGuardStart = migration.indexOf(
    "from pg_catalog.pg_index index_row",
  );
  const indexGuardEnd = migration.indexOf(
    "stripe safety migration blocked: dependency index drift",
  );
  const indexGuard = migration.slice(indexGuardStart, indexGuardEnd);

  expect(indexGuardStart).toBeGreaterThan(-1);
  expect(indexGuardEnd).toBeGreaterThan(indexGuardStart);
  expect(indexGuardEnd).toBeLessThan(firstMutation);
  expect(indexGuard).toContain(
    "pg_catalog.unnest(index_row.indkey::smallint[])",
  );
  expect(indexGuard).toContain(
    "with ordinality as key_parts(key_part, position)",
  );
  expect(indexGuard).toContain(
    "array[user_id_column.attnum, created_at_column.attnum]::smallint[]",
  );
  expect(indexGuard).toContain(
    "pg_catalog.unnest(index_row.indoption::smallint[])",
  );
  expect(indexGuard).toContain(
    "with ordinality as option_parts(option_part, position)",
  );
  expect(indexGuard).toContain("array[0, 3]::smallint[]");
  expect(indexGuard).not.toContain("index_row.indkey::smallint[] = array[");
  expect(indexGuard).not.toContain("index_row.indoption::smallint[] = array[");

  const normalize = (value: { lowerBound: number; elements: number[] }) => [
    ...value.elements,
  ];
  const postgresKeys = { lowerBound: 0, elements: [2, 21] };
  const expectedKeys = { lowerBound: 1, elements: [2, 21] };
  const expectedOptions = { lowerBound: 1, elements: [0, 3] };

  expect(normalize(postgresKeys)).toEqual(normalize(expectedKeys));
  expect(normalize({ lowerBound: 0, elements: [21, 2] })).not.toEqual(
    normalize(expectedKeys),
  );
  expect(normalize({ lowerBound: 0, elements: [0, 0] })).not.toEqual(
    normalize(expectedOptions),
  );
});

test("dependency ACL drift is rejected before the first mutation", () => {
  const firstMutation = migration.indexOf("alter table public.user_profiles");
  const aclGuard = migration.indexOf(
    "stripe safety migration blocked: dependency acl drift",
  );
  expect(aclGuard).toBeGreaterThan(-1);
  expect(aclGuard).toBeLessThan(firstMutation);
  expect(migration).toContain("privilege.grantee in ('public', 'anon')");
  expect(migration).toContain("privilege.grantee = 'authenticated'");
  expect(migration).toContain("privilege.grantee = 'service_role'");
  expect(migration).toContain("privilege.is_grantable = 'no'");
});

test("webhook ledger deduplicates, leases, rejects stale events, and finalizes atomically", () => {
  expect(migration).toContain("event_id text primary key");
  expect(migration).toContain("on conflict (event_id) do nothing");
  expect(migration).toContain("processing_expires_at > p_now");
  expect(migration).toContain(
    "billing_last_event_created_at > v_event.provider_created_at",
  );
  expect(migration).toContain("status = 'stale'");
  expect(migration).toContain("status = 'retryable_failed'");
  expect(migration).toContain("status = 'terminal_failed'");
  expect(migration).toContain("update public.user_profiles");
  expect(migration).toContain("update public.stripe_webhook_events");
  expect(migration).toContain("stripe_owner_not_found");
  expect(migration).toContain("stripe_owner_not_unique");
});

test("Checkout claims serialize a user and preserve one stable attempt", () => {
  expect(migration).toContain("pg_advisory_xact_lock");
  expect(migration).toContain("stripe_checkout_attempts_one_active_user_idx");
  expect(migration).toContain("retry_until <= p_now");
  expect(migration).toContain("lease_expires_at > p_now");
  expect(migration).toContain("record_stripe_checkout_customer");
  expect(migration).toContain("record_stripe_checkout_session");
  expect(migration).toContain("fail_stripe_checkout_attempt");
  expect(migration).toContain("expire_stripe_checkout_session");
  expect(migration).toContain("v_event.attempt_count >= 10");
});

test("new Stripe state is user-owned, RLS protected, and service-role only", () => {
  for (const table of ["stripe_webhook_events", "stripe_checkout_attempts"]) {
    expect(migration).toContain(
      `alter table public.${table} enable row level security`,
    );
    expect(migration).toContain(
      `alter table public.${table} force row level security`,
    );
    expect(migration).toContain(
      `revoke all on table public.${table} from public, anon, authenticated, service_role`,
    );
  }
  expect(migration).toContain(
    "user_id uuid not null references auth.users (id) on delete cascade",
  );
  expect(migration).not.toMatch(/grant execute[^;]+to (anon|authenticated)/);
  expect(migration).not.toMatch(/disable row level security/);
});
