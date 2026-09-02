import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const path = resolve(
  process.cwd(),
  "supabase/migrations/20260902090000_add_processed_email_reservations.sql",
);
const sql = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const normalized = sql.toLowerCase();
const preflight = normalized.match(
  /do \$preflight\$([\s\S]*?)\$preflight\$;/,
)?.[1];

if (!preflight) {
  throw new Error("Migration B preflight block is missing");
}

test("Migration B is bounded, transactional, and preflights before mutation", () => {
  expect(normalized.trimStart()).toMatch(/^begin;/);
  expect(normalized.trimEnd()).toMatch(/commit;$/);
  expect(normalized).toContain("set local lock_timeout = '5s'");
  expect(normalized).toContain("set local statement_timeout = '60s'");
  expect(normalized.indexOf("do $preflight$")).toBeLessThan(
    normalized.indexOf("alter table public.processed_emails"),
  );
  expect(normalized).toContain(
    "processed email reservation objects are partially present",
  );
  expect(normalized).toContain("processed_emails contains an unknown grant");
  expect(normalized).toContain("processed_emails policy drifted");
  expect(normalized).toContain(
    "processed email reservation constraints drifted",
  );
  expect(normalized).toContain(
    "migration a finalize_guarded_execution body drifted",
  );
  expect(normalized).toContain(
    "processed email finalize_guarded_execution body or metadata drifted",
  );
  expect(normalized).not.toContain("drop table");
  expect(normalized).not.toContain("drop column");
});

test("accepts only the canonical enabled and non-FORCE processed_emails RLS shape", () => {
  expect(preflight).toContain("and c.relrowsecurity");
  expect(preflight).toContain("and not c.relforcerowsecurity");
  expect(preflight).not.toMatch(/and\s+c\.relforcerowsecurity/);
});

test("fails closed when processed_emails RLS is disabled", () => {
  expect(preflight).toMatch(
    /if not exists \([\s\S]*and c\.relrowsecurity[\s\S]*\)\s+or/,
  );
});

test("fails closed when processed_emails unexpectedly has FORCE RLS", () => {
  expect(preflight).toMatch(/and not c\.relforcerowsecurity/);
});

test("fails closed on processed_emails owner, policy, or grant drift", () => {
  expect(preflight).toContain(
    "pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'",
  );
  expect(preflight).toContain("from pg_catalog.pg_policies p");
  expect(preflight).toContain("p.policyname in (");
  expect(preflight).toContain("'processed_emails_select_own'");
  expect(preflight).toContain("'users_can_select_own_processed_emails'");
  expect(preflight).toContain("p.permissive = 'permissive'");
  expect(preflight).toContain("p.roles = array['authenticated']::name[]");
  expect(preflight).toContain("p.cmd = 'select'");
  expect(preflight).toContain("'selectauth.uid=user_id'");
  expect(preflight).toContain("p.with_check is null");
  expect(preflight).toContain("processed_emails policy drifted");
  expect(preflight).toContain("processed_emails contains an unknown grant");
  expect(preflight).toContain("or acl.is_grantable");
  expect(preflight).toContain(
    "pg_catalog.has_table_privilege('anon', 'public.processed_emails'",
  );
});

test("does not mutate processed_emails RLS mode", () => {
  expect(normalized).not.toMatch(
    /alter table public\.processed_emails\s+(enable|disable|force|no force) row level security/,
  );
});

test("adds the canonical reservation state without weakening identity or RLS", () => {
  for (const fragment of [
    "processing_status text not null default 'completed'",
    "reservation_run_id uuid",
    "reservation_id_hash text",
    "reserved_at timestamp with time zone",
    "reservation_expires_at timestamp with time zone",
    "drive_write_started_at timestamp with time zone",
    "completed_at timestamp with time zone",
    "reserved_bytes bigint not null default 0",
    "written_bytes bigint not null default 0",
  ]) {
    expect(normalized).toContain(fragment);
  }
  expect(normalized).toContain("set completed_at = saved_at");
  expect(normalized).toContain(
    "processing_status in ('reserved', 'completed', 'released', 'outcome_unknown')",
  );
  expect(normalized).toContain("written_bytes <= reserved_bytes");
  expect(normalized).toContain("processed_emails_rule_msg_uniq");
  expect(normalized).toContain("c.relrowsecurity");
  expect(normalized).toContain("not c.relforcerowsecurity");
  expect(normalized).toContain("pg_catalog.pg_get_expr(c.conbin");
  expect(normalized).toContain("pg_catalog.aclexplode(v_function_row.proacl)");
});

test("reserve RPC atomically owns identity, count, and byte quotas on the DB clock", () => {
  expect(normalized).toContain(
    "create or replace function public.reserve_processed_email(",
  );
  expect(normalized).toContain("autopdf_processed_email_reservation_v1");
  expect(normalized).toContain("v_now := pg_catalog.statement_timestamp()");
  expect(normalized).not.toContain("p_now");
  expect(normalized).toContain("at time zone 'utc'");
  expect(normalized).toContain("v_count >= 30");
  expect(normalized).toContain("then 500");
  expect(normalized).toContain("else 10");
  expect(normalized).toContain("1073741824");
  expect(normalized).toContain("5368709120");
  for (const outcome of [
    "reserved",
    "completed",
    "active_reservation",
    "outcome_unknown",
    "daily_processed_email_limit_exceeded",
    "free_monthly_limit_exceeded",
    "monthly_processed_email_limit_exceeded",
    "drive_byte_limit_exceeded",
  ]) {
    expect(normalized).toContain(`'${outcome}'`);
  }
});

test("only expired reservations with no Drive start become reclaimable", () => {
  expect(normalized).toContain(
    "case when p.drive_write_started_at is null then 'released' else 'outcome_unknown' end",
  );
  expect(normalized).toContain(
    "p.processing_status = 'reserved' and p.reservation_expires_at <= v_now",
  );
  expect(normalized).toContain(
    "v_existing.processing_status = 'outcome_unknown'",
  );
});

test("Drive start and completion enforce reservation ownership and cardinality", () => {
  expect(normalized).toContain(
    "create or replace function public.mark_processed_email_drive_started(",
  );
  expect(normalized).toContain(
    "create or replace function public.complete_processed_email(",
  );
  expect(normalized).toContain("and p.reservation_run_id = p_run_id");
  expect(normalized).toContain(
    "and p.reservation_id_hash = p_reservation_id_hash",
  );
  expect(normalized).toContain("if v_updated <> 1 then");
  expect(normalized).toContain("p_written_bytes <= p.reserved_bytes");
  expect(normalized).toContain("reserved_bytes = p_written_bytes");
});

test("guarded finalize atomically retains unknown writes and releases safe failures", () => {
  expect(normalized).toContain(
    "create or replace function public.finalize_guarded_execution(",
  );
  expect(normalized).toContain(
    "if p_error_code = 'drive_upload_outcome_unknown' then",
  );
  expect(normalized).toContain("processing_status = 'outcome_unknown'");
  expect(normalized).toContain("processing_status = 'released'");
  expect(normalized).toContain("if p_status = 'success' and exists");
  expect(normalized).toContain("for update;");
});

test("new RPCs are fixed-search-path service-role-only functions", () => {
  for (const name of [
    "reserve_processed_email",
    "mark_processed_email_drive_started",
    "complete_processed_email",
  ]) {
    expect(normalized).toContain(`create or replace function public.${name}(`);
    expect(normalized).toContain(`revoke all on function public.${name}(`);
    expect(normalized).toContain(`grant execute on function public.${name}(`);
  }
  expect(sql.match(/security definer/g)).toHaveLength(4);
  expect(sql.match(/set search_path = ''/g)).toHaveLength(4);
  expect(normalized).not.toMatch(/grant execute[\s\S]{0,200}to authenticated/);
});

test("canonical replay fingerprints match every new RPC body", () => {
  const declared = sql
    .match(
      /v_function_source_hashes constant text\[\] := array\[([\s\S]*?)\];/,
    )?.[1]
    .match(/[0-9a-f]{32}/g);
  const created = [
    ...sql.matchAll(
      /create or replace function public\.(reserve_processed_email|mark_processed_email_drive_started|complete_processed_email)\([\s\S]*?as \$function\$([\s\S]*?)\$function\$;/g,
    ),
  ].map((match) => createHash("md5").update(match[2]).digest("hex"));
  expect(created).toHaveLength(3);
  expect(declared).toEqual(created);
});
