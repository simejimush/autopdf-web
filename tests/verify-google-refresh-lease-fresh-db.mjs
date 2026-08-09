import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const repositoryRoot = resolve(import.meta.dirname, "..");
const migrationNames = [
  "20260528090000_create_autopdf_core_baseline.sql",
  "20260529090000_create_ai_usage_logs.sql",
  "20260530090000_harden_autopdf_core_security.sql",
  "20260726090000_add_google_credential_version.sql",
  "20260807064701_reconcile_production_core_security.sql",
];
const leaseMigrationName = "20260809180000_add_google_refresh_lease.sql";
const containerName = `autopdf-google-refresh-lease-pg17-${process.pid}`;
const fixturePassword = "autopdf-local-fixture-only";

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: options.input,
    windowsHide: true,
  });
  if (!options.allowFailure && result.status !== 0) {
    const detail =
      result.stderr?.trim() ||
      result.error?.message ||
      "unknown docker failure";
    throw new Error(
      `docker command failed (${args.slice(0, 3).join(" ")}): ${detail}`,
    );
  }
  return result;
}

function psql(sql, options = {}) {
  return docker(
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      ...(options.tuplesOnly ? ["-A", "-t"] : []),
    ],
    { input: sql, allowFailure: options.allowFailure },
  );
}

function migrationSql(name) {
  return readFileSync(
    resolve(repositoryRoot, "supabase", "migrations", name),
    "utf8",
  );
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = docker(
      ["exec", containerName, "pg_isready", "-U", "postgres", "-d", "postgres"],
      { allowFailure: true },
    );
    if (ready.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error("PostgreSQL 17 fixture did not become ready");
}

function spawnPsql(sql) {
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { cwd: repositoryRoot, windowsHide: true },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (value) => {
    stdout += value;
  });
  child.stderr.on("data", (value) => {
    stderr += value;
  });
  const completed = new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(`psql failed: ${stderr.trim()}`));
    });
  });
  if (sql !== undefined) child.stdin.end(sql);
  return { child, completed, output: () => stdout };
}

async function waitForText(processHandle, text) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (processHandle.output().includes(text)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Timed out waiting for PostgreSQL barrier: ${text}`);
}

async function waitForBlockedClaims() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = psql(
      `select count(*) from pg_catalog.pg_stat_activity
       where datname = current_database()
         and query like '%lease-claim-barrier-%'
         and wait_event_type = 'Lock';`,
      { tuplesOnly: true },
    );
    if (Number(result.stdout.trim()) >= 2) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error("Two claim sessions did not reach the database lock barrier");
}

function claimSql(userId, digest, marker) {
  return `set role service_role;
    select count(*)
    from public.claim_google_credential_refresh_lease(
      '${userId}'::uuid,
      'connected'::text,
      0::bigint,
      '${digest}'::text
    ) /* ${marker} */;`;
}

let started = false;
try {
  const start = docker([
    "run",
    "--rm",
    "--pull=never",
    "-d",
    "--name",
    containerName,
    "-e",
    `POSTGRES_PASSWORD=${fixturePassword}`,
    "postgres:17",
  ]);
  if (!start.stdout.trim()) throw new Error("PostgreSQL fixture did not start");
  started = true;
  waitForPostgres();

  psql(`
    do $fixture_roles$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
        create role supabase_admin login superuser;
      end if;
    end
    $fixture_roles$;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select null::uuid $$;
    create extension if not exists pgcrypto;
    create extension if not exists moddatetime with schema public;
    alter function public.moddatetime() owner to supabase_admin;
    revoke all on function public.moddatetime()
      from public, anon, authenticated, postgres, service_role, supabase_admin;
    grant execute on function public.moddatetime()
      to public, anon, authenticated, postgres, service_role, supabase_admin;
  `);

  for (const name of migrationNames) psql(migrationSql(name));

  psql(`
    insert into auth.users (id) values
      ('44444444-4444-4444-8444-444444444444'),
      ('55555555-5555-4555-8555-555555555555');
    insert into public.google_connections (
      user_id, status, access_token_enc, refresh_token_enc, credential_version
    ) values
      ('44444444-4444-4444-8444-444444444444', 'connected',
       'fixture-access-a', 'fixture-refresh-a', 0),
      ('55555555-5555-4555-8555-555555555555', 'connected',
       'fixture-access-b', 'fixture-refresh-b', 0);
  `);

  psql(migrationSql(leaseMigrationName));
  psql(migrationSql(leaseMigrationName));

  psql(`
    do $verify_schema$
    declare
      claim_function oid := to_regprocedure(
        'public.claim_google_credential_refresh_lease(uuid,text,bigint,text)'
      );
    begin
      if claim_function is null then raise exception 'claim function missing'; end if;
      if not exists (
        select 1 from pg_attribute
        where attrelid = 'public.google_connections'::regclass
          and attname = 'refresh_lease_id_hash'
          and format_type(atttypid, atttypmod) = 'text'
          and not attnotnull
      ) then raise exception 'lease hash column mismatch'; end if;
      if not exists (
        select 1 from pg_attribute
        where attrelid = 'public.google_connections'::regclass
          and attname = 'refresh_lease_expires_at'
          and format_type(atttypid, atttypmod) = 'timestamp with time zone'
          and not attnotnull
      ) then raise exception 'lease expiry column mismatch'; end if;
      if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.google_connections'::regclass
          and conname = 'google_connections_refresh_lease_pair'
          and convalidated
      ) then raise exception 'pair constraint mismatch'; end if;
      if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.google_connections'::regclass
          and conname = 'google_connections_refresh_lease_hash_format'
          and convalidated
      ) then raise exception 'digest constraint mismatch'; end if;
      if exists (
           select 1
           from pg_catalog.pg_proc p
           cross join lateral pg_catalog.aclexplode(
             coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
           ) privilege
           where p.oid = claim_function
             and privilege.grantee = 0
             and privilege.privilege_type = 'EXECUTE'
         )
         or has_function_privilege('anon', claim_function, 'EXECUTE')
         or has_function_privilege('authenticated', claim_function, 'EXECUTE')
         or not has_function_privilege('service_role', claim_function, 'EXECUTE') then
        raise exception 'claim function privilege mismatch';
      end if;
      if exists (
        select 1 from public.google_connections
        where credential_version <> 0
           or access_token_enc not like 'fixture-access-%'
           or refresh_token_enc not like 'fixture-refresh-%'
           or refresh_lease_id_hash is not null
           or refresh_lease_expires_at is not null
      ) then raise exception 'migration changed fixture data'; end if;
    end
    $verify_schema$;

    do $malformed_rejection$
    begin
      begin
        update public.google_connections
        set refresh_lease_id_hash = repeat('a', 64),
            refresh_lease_expires_at = null
        where user_id = '44444444-4444-4444-8444-444444444444';
        raise exception 'hash/null pair was accepted';
      exception when check_violation then null;
      end;
      begin
        update public.google_connections
        set refresh_lease_id_hash = null,
            refresh_lease_expires_at = statement_timestamp()
        where user_id = '44444444-4444-4444-8444-444444444444';
        raise exception 'null/expiry pair was accepted';
      exception when check_violation then null;
      end;
      begin
        update public.google_connections
        set refresh_lease_id_hash = repeat('A', 64),
            refresh_lease_expires_at = statement_timestamp()
        where user_id = '44444444-4444-4444-8444-444444444444';
        raise exception 'uppercase digest was accepted';
      exception when check_violation then null;
      end;
      begin
        update public.google_connections
        set refresh_lease_id_hash = repeat('g', 64),
            refresh_lease_expires_at = statement_timestamp()
        where user_id = '44444444-4444-4444-8444-444444444444';
        raise exception 'nonhex digest was accepted';
      exception when check_violation then null;
      end;
    end
    $malformed_rejection$;
  `);

  const barrier = spawnPsql();
  barrier.child.stdin.write(`begin;
    lock table public.google_connections in share mode;
    select 'BARRIER_READY';\n`);
  await waitForText(barrier, "BARRIER_READY");

  const claimA = spawnPsql(
    claimSql(
      "44444444-4444-4444-8444-444444444444",
      "a".repeat(64),
      "lease-claim-barrier-a",
    ),
  );
  const claimB = spawnPsql(
    claimSql(
      "44444444-4444-4444-8444-444444444444",
      "b".repeat(64),
      "lease-claim-barrier-b",
    ),
  );
  await waitForBlockedClaims();
  barrier.child.stdin.end("commit;\n");
  await barrier.completed;
  const sameUserResults = await Promise.all([
    claimA.completed,
    claimB.completed,
  ]);
  if (sameUserResults.sort().join(",") !== "0,1") {
    throw new Error(`same-user claim cardinality mismatch: ${sameUserResults}`);
  }

  psql(`update public.google_connections
        set refresh_lease_id_hash = null, refresh_lease_expires_at = null;`);
  const differentUsers = await Promise.all([
    spawnPsql(
      claimSql(
        "44444444-4444-4444-8444-444444444444",
        "c".repeat(64),
        "different-user-a",
      ),
    ).completed,
    spawnPsql(
      claimSql(
        "55555555-5555-4555-8555-555555555555",
        "d".repeat(64),
        "different-user-b",
      ),
    ).completed,
  ]);
  if (differentUsers.sort().join(",") !== "1,1") {
    throw new Error(`different-user claim mismatch: ${differentUsers}`);
  }

  psql(`
    update public.google_connections
    set refresh_lease_id_hash = repeat('e', 64),
        refresh_lease_expires_at = '2099-01-01T00:00:00Z'
    where user_id = '44444444-4444-4444-8444-444444444444';
  `);
  const activeResult = psql(
    claimSql(
      "44444444-4444-4444-8444-444444444444",
      "f".repeat(64),
      "active-future-reject",
    ),
    { tuplesOnly: true },
  ).stdout.trim();
  if (activeResult !== "0") throw new Error("active future lease was stolen");

  psql(`
    update public.google_connections
    set refresh_lease_expires_at = statement_timestamp() - interval '1 second'
    where user_id = '44444444-4444-4444-8444-444444444444';
  `);
  const expiredResult = psql(
    claimSql(
      "44444444-4444-4444-8444-444444444444",
      "f".repeat(64),
      "expired-reclaim",
    ),
    { tuplesOnly: true },
  ).stdout.trim();
  if (expiredResult !== "1") throw new Error("expired lease was not reclaimed");

  console.log(
    "fresh-db apply=pass replay=pass malformed=pass same-user=1/0 different-users=1/1 expiry=pass",
  );
} finally {
  if (started) docker(["stop", containerName], { allowFailure: true });
}
