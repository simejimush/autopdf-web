import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const MIGRATION_B = "20260902090000_add_processed_email_reservations.sql";
const REMEDIATION =
  "20260902090001_verify_processed_email_reservation_replay.sql";
const EXPECTED_MIGRATION_B_SHA256 =
  "ae13122337218c2c66e6f673c17d8f812f327b6f7bf403ae93abd4d0d5a768f6";
const EXPECTED_STATUS_FINGERPRINT =
  "processing_status=anyarray['reserved','completed','released','outcome_unknown']";

const migrationBSource = readFileSync(
  resolve(process.cwd(), "supabase/migrations", MIGRATION_B),
  "utf8",
).replace(/\r\n/g, "\n");
const remediationSource = readFileSync(
  resolve(process.cwd(), "supabase/migrations", REMEDIATION),
  "utf8",
).replace(/\r\n/g, "\n");
const sql = remediationSource.toLowerCase();

function normalizeStatusCheck(expression: string): string {
  return expression
    .toLowerCase()
    .replaceAll("::text", "")
    .replace(/[()\s]/g, "");
}

function isCanonicalStatusCheck(expression: string): boolean {
  return normalizeStatusCheck(expression) === EXPECTED_STATUS_FINGERPRINT;
}

test("preserves the applied Migration B source SHA", () => {
  expect(createHash("sha256").update(migrationBSource).digest("hex")).toBe(
    EXPECTED_MIGRATION_B_SHA256,
  );
});

test("keeps Migration B immutable and adds only a later lineage verifier", () => {
  expect(MIGRATION_B.localeCompare(REMEDIATION)).toBeLessThan(0);
  expect(remediationSource).not.toBe(migrationBSource);
  expect(sql).toContain("requires migration b postcondition");
});

test("accepts the observed PostgreSQL 17 status CHECK deparse", () => {
  expect(
    isCanonicalStatusCheck(
      "processing_status = ANY (ARRAY['reserved'::text, 'completed'::text, 'released'::text, 'outcome_unknown'::text])",
    ),
  ).toBe(true);
});

test("accepts harmless parenthesis and whitespace differences", () => {
  expect(
    isCanonicalStatusCheck(
      " (( processing_status = ANY (( ARRAY[ 'reserved'::text, 'completed'::text, 'released'::text, 'outcome_unknown'::text ] ))) ) ",
    ),
  ).toBe(true);
});

test("rejects a missing status", () => {
  expect(
    isCanonicalStatusCheck(
      "processing_status = ANY (ARRAY['reserved'::text, 'completed'::text, 'released'::text])",
    ),
  ).toBe(false);
});

test("rejects an extra status", () => {
  expect(
    isCanonicalStatusCheck(
      "processing_status = ANY (ARRAY['reserved'::text, 'completed'::text, 'released'::text, 'outcome_unknown'::text, 'retrying'::text])",
    ),
  ).toBe(false);
});

test("rejects a wrong status", () => {
  expect(
    isCanonicalStatusCheck(
      "processing_status = ANY (ARRAY['reserved'::text, 'completed'::text, 'failed'::text, 'outcome_unknown'::text])",
    ),
  ).toBe(false);
});

test("rejects a CHECK over the wrong column", () => {
  expect(
    isCanonicalStatusCheck(
      "status = ANY (ARRAY['reserved'::text, 'completed'::text, 'released'::text, 'outcome_unknown'::text])",
    ),
  ).toBe(false);
});

test("requires the named status CHECK to be validated", () => {
  expect(sql).toContain(
    "c.conname = 'processed_emails_processing_status_check'",
  );
  expect(sql).toContain("and c.contype = 'c'");
  expect(sql).toContain("and c.convalidated");
  expect(sql).toContain("v_status_expression is distinct from");
});

test("rejects duplicate or unknown CHECK constraints", () => {
  expect(sql).toContain("v_status_constraint_count <> 4");
  for (const constraint of [
    "processed_emails_processing_status_check",
    "processed_emails_reservation_hash_check",
    "processed_emails_byte_accounting_check",
    "processed_emails_processing_shape_check",
  ]) {
    expect(sql).toContain(`'${constraint}'`);
  }
  expect(sql).toContain("check constraint set drifted");
});

test("fails closed on table owner drift", () => {
  expect(sql).toContain("pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'");
  expect(sql).toContain("owner, rls, or force state drifted");
});

test("fails closed on RLS or FORCE drift", () => {
  expect(sql).toContain("c.relrowsecurity");
  expect(sql).toContain("not c.relforcerowsecurity");
});

test("fails closed on policy drift", () => {
  expect(sql).toContain("from pg_catalog.pg_policies p");
  expect(sql).toContain("p.roles = array['authenticated']::name[]");
  expect(sql).toContain("p.cmd = 'select'");
  expect(sql).toContain("processed_emails policy drifted");
});

test("fails closed on table or column ACL drift", () => {
  expect(sql).toContain("pg_catalog.has_table_privilege");
  expect(sql).toContain("pg_catalog.aclexplode(a.attacl)");
  expect(sql).toContain("table or column acl drifted");
});

test("pins the reserve RPC identity, body, metadata, and ACL", () => {
  expect(sql).toContain(
    "public.reserve_processed_email(uuid,uuid,uuid,text,text,text,bigint)",
  );
  expect(sql).toContain("27f16c86f139dee10a49493fd1e94873");
  expect(sql).toContain("v_function_row.proconfig");
  expect(sql).toContain("pg_catalog.aclexplode(v_function_row.proacl)");
});

test("pins the finalized Migration B RPC identity and body", () => {
  expect(sql).toContain(
    "public.finalize_guarded_execution(uuid,uuid,uuid,text,text,integer,integer,integer,text,text)",
  );
  expect(sql).toContain("b80a254194f691579e373b3d45774db6");
  expect(sql).toContain("rpc identity, metadata, body, or acl drifted");
});

test("is a bounded explicit transaction with a fixed search path", () => {
  expect(sql.trimStart()).toMatch(/^begin;/);
  expect(sql.trimEnd()).toMatch(/commit;$/);
  expect(sql).toContain("set local lock_timeout = '5s'");
  expect(sql).toContain("set local statement_timeout = '30s'");
  expect(sql).toContain("set local search_path = ''");
});

test("contains no schema or data mutation", () => {
  expect(sql).not.toMatch(
    /^\s*(create|alter|drop|grant|revoke|insert|update|delete|truncate)\s+/m,
  );
  expect(sql).toContain("do $processed_email_reservation_replay_verification$");
});

test("keeps the fresh chain ordered as Migration B then remediation", () => {
  const ordered = [MIGRATION_B, REMEDIATION].sort();
  expect(ordered).toEqual([MIGRATION_B, REMEDIATION]);
  expect(migrationBSource).toContain(
    "add constraint processed_emails_processing_status_check",
  );
  expect(sql).toContain(EXPECTED_STATUS_FINGERPRINT.replaceAll("'", "''"));
});

test("supports the existing applied-B PostgreSQL 17 fingerprint", () => {
  const observed =
    "processing_status=anyarray['reserved'::text,'completed'::text,'released'::text,'outcome_unknown'::text]";
  expect(normalizeStatusCheck(observed)).toBe(EXPECTED_STATUS_FINGERPRINT);
  expect(sql).not.toContain("processing_status=any(array[");
});

test("uses narrow catalog normalization rather than a generic SQL parser", () => {
  expect(sql).toContain("pg_catalog.pg_get_expr(c.conbin, c.conrelid, true)");
  expect(sql).toContain("'::text', '', 'g'");
  expect(sql).toContain("'[()[:space:]]', '', 'g'");
  expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/);
});

test("does not embed credentials, tokens, row identifiers, or environment values", () => {
  const sensitiveMarker = new RegExp(
    [
      ["access", "token"].join("[_-]?"),
      ["refresh", "token"].join("[_-]?"),
      ["client", "secret"].join("[_-]?"),
      ["authorization", ":"].join(""),
      ["bearer", "\\s"].join(""),
    ].join("|"),
  );
  expect(sql).not.toMatch(sensitiveMarker);
  expect(sql).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
  );
  expect(sql).not.toMatch(/https?:\/\//);
});
