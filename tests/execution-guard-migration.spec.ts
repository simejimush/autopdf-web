import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260830220000_add_cost_safety_execution_guard.sql",
);
const sql = readFileSync(MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n");
const normalized = sql.toLowerCase();
const limitsSource = readFileSync(
  resolve(process.cwd(), "src/lib/cost-safety/limits.ts"),
  "utf8",
);

function readLimit(name: string): number {
  const raw = limitsSource.match(
    new RegExp(`export const ${name} = ([\\d_]+);`),
  )?.[1];
  if (!raw) throw new Error(`Missing numeric limit ${name}`);
  return Number(raw.replaceAll("_", ""));
}

const EXECUTION_LEASE_TTL_MS = readLimit("EXECUTION_LEASE_TTL_MS");
const SYSTEM_CONCURRENT_EXECUTION_LIMIT = readLimit(
  "SYSTEM_CONCURRENT_EXECUTION_LIMIT",
);
const SYSTEM_EXECUTIONS_PER_HOUR_LIMIT = readLimit(
  "SYSTEM_EXECUTIONS_PER_HOUR_LIMIT",
);
const SYSTEM_EXECUTIONS_PER_TEN_MINUTES_LIMIT = readLimit(
  "SYSTEM_EXECUTIONS_PER_TEN_MINUTES_LIMIT",
);
const SYSTEM_EXECUTIONS_PER_UTC_DAY_LIMIT = readLimit(
  "SYSTEM_EXECUTIONS_PER_UTC_DAY_LIMIT",
);
const SYSTEM_EXECUTIONS_PER_UTC_MONTH_LIMIT = readLimit(
  "SYSTEM_EXECUTIONS_PER_UTC_MONTH_LIMIT",
);
const USER_CONCURRENT_EXECUTION_LIMIT = readLimit(
  "USER_CONCURRENT_EXECUTION_LIMIT",
);
const USER_RUNS_PER_MINUTE_LIMIT = readLimit("USER_RUNS_PER_MINUTE_LIMIT");
const USER_RUNS_PER_TEN_MINUTES_LIMIT = readLimit(
  "USER_RUNS_PER_TEN_MINUTES_LIMIT",
);

test("Migration A is transactional, bounded, and preflights before mutation", () => {
  expect(normalized.trimStart()).toMatch(/^begin;/);
  expect(normalized.trimEnd()).toMatch(/commit;$/);
  expect(normalized).toContain("set local lock_timeout = '5s'");
  expect(normalized).toContain("set local statement_timeout = '60s'");
  expect(normalized.indexOf("do $preflight$")).toBeLessThan(
    normalized.indexOf(
      "create table if not exists public.rule_execution_leases",
    ),
  );
  expect(normalized).toContain("execution guard objects are partially present");
  expect(normalized).toContain(
    "execution guard canonical identity columns are missing or drifted",
  );
});

test("creates only the execution lease shape, constraints, and non-duplicate indexes", () => {
  expect(normalized).toContain(
    "create table if not exists public.rule_execution_leases",
  );
  for (const column of [
    "rule_id uuid not null",
    "user_id uuid not null",
    "run_id uuid not null",
    "lease_id_hash text not null",
    "acquired_at timestamp with time zone not null",
    "expires_at timestamp with time zone not null",
    "heartbeat_at timestamp with time zone not null",
  ]) {
    expect(normalized).toContain(column);
  }
  expect(normalized).toContain("primary key (rule_id)");
  expect(normalized).toContain("unique (run_id)");
  expect(normalized).toContain("lease_id_hash ~ '^[0-9a-f]{64}$'");
  expect(normalized).toContain("on public.rule_execution_leases (expires_at)");
  expect(normalized).toContain(
    "on public.rule_execution_leases (user_id, acquired_at desc)",
  );
  expect(normalized).toContain("on public.runs (started_at desc)");
  expect(normalized).not.toMatch(/foreign key|\breferences\b/);
  expect(normalized).not.toContain("processed_emails");
  expect(normalized).not.toContain("quota_counter");
});

test("claim RPC atomically fixes every execution-attempt and concurrency limit", () => {
  expect(normalized).toContain(
    "create or replace function public.claim_guarded_execution(",
  );
  expect(normalized).toContain("pg_advisory_xact_lock");
  expect(normalized).toContain("autopdf_execution_guard_v1");
  expect(normalized).toContain(
    `interval '${EXECUTION_LEASE_TTL_MS / 1000} seconds'`,
  );
  expect(normalized).toContain(
    `interval '10 minutes') >= ${SYSTEM_EXECUTIONS_PER_TEN_MINUTES_LIMIT}`,
  );
  expect(normalized).toContain(
    `interval '1 hour') >= ${SYSTEM_EXECUTIONS_PER_HOUR_LIMIT}`,
  );
  expect(normalized).toContain(
    `v_utc_day_start) >= ${SYSTEM_EXECUTIONS_PER_UTC_DAY_LIMIT}`,
  );
  expect(normalized).toContain(
    `v_utc_month_start) >= ${SYSTEM_EXECUTIONS_PER_UTC_MONTH_LIMIT}`,
  );
  expect(normalized).toContain(
    `interval '1 minute') >= ${USER_RUNS_PER_MINUTE_LIMIT}`,
  );
  expect(normalized).toContain(
    `interval '10 minutes') >= ${USER_RUNS_PER_TEN_MINUTES_LIMIT}`,
  );
  expect(USER_CONCURRENT_EXECUTION_LIMIT).toBe(1);
  expect(normalized).toContain("where l.user_id = p_user_id");
  expect(normalized).toContain(
    `from public.rule_execution_leases) >= ${SYSTEM_CONCURRENT_EXECUTION_LIMIT}`,
  );
  expect(normalized).toContain(
    "delete from public.rule_execution_leases l\n  where l.expires_at <= p_now",
  );
  expect(normalized.indexOf("insert into public.runs")).toBeGreaterThan(
    normalized.indexOf("'execution_concurrency_limit'::text"),
  );
  for (const outcome of [
    "SYSTEM_LIMIT_EXCEEDED",
    "USER_RATE_LIMIT_EXCEEDED",
    "EXECUTION_CONCURRENCY_LIMIT",
    "RUN_ALREADY_RUNNING",
    "GUARD_STORE_FAILED",
    "CLAIMED",
  ]) {
    expect(sql).toContain(outcome);
  }
});

test("finalize RPC binds every identity and rolls terminal update and release together", () => {
  expect(normalized).toContain(
    "create or replace function public.finalize_guarded_execution(",
  );
  expect(normalized).toContain("and l.user_id = p_user_id");
  expect(normalized).toContain("and l.run_id = p_run_id");
  expect(normalized).toContain("and l.lease_id_hash = p_lease_id_hash");
  expect(normalized).toContain("and r.status = 'running'");
  expect(normalized).toContain("if v_updated_count <> 1 then");
  expect(normalized).toContain("if v_deleted_count <> 1 then");
  expect(normalized).toContain(
    "raise exception 'guarded lease release rejected'",
  );
});

test("Cron candidate RPC is deterministic and bounded without runtime cutover", () => {
  expect(normalized).toContain(
    "create or replace function public.list_cron_candidates()",
  );
  expect(normalized).toContain("partition by r.user_id");
  expect(normalized).toContain("order by r.created_at asc, r.id asc");
  expect(normalized).toContain("where ranked.user_rank <= 100");
  expect(normalized).toContain("limit 500");
});

test("new table and RPCs are service-role-only with fixed security boundaries", () => {
  expect(normalized).toContain(
    "alter table public.rule_execution_leases enable row level security",
  );
  expect(normalized).toContain(
    "alter table public.rule_execution_leases force row level security",
  );
  expect(normalized).toContain("security definer\nset search_path = ''");
  expect(normalized).toContain("owner to postgres");
  expect(normalized).toContain(
    "from public, anon, authenticated, service_role",
  );
  expect((normalized.match(/to service_role;/g) ?? []).length).toBe(3);
  expect(normalized).not.toMatch(
    /grant execute[\s\S]*to (?:anon|authenticated|public)/,
  );
});
