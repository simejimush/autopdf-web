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
const operationMigrationName =
  "20260811041554_add_google_refresh_operations.sql";
const remediationMigrationName =
  "20260811134704_protect_google_refresh_finalize_lease_ownership.sql";
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

function prepareOperationSql(operationId, digest, marker) {
  return `set role service_role;
    select operation_state || '|' || coalesce(credential_version::text, '')
    from public.prepare_google_refresh_operation(
      '66666666-6666-4666-8666-666666666666'::uuid,
      '${operationId}'::uuid,
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

  psql(`
    update public.google_connections
    set status = 'connected', reauth_required = false,
        last_error_code = null, last_error_at = null,
        refresh_lease_id_hash = null, refresh_lease_expires_at = null;
    insert into auth.users (id) values
      ('66666666-6666-4666-8666-666666666666'),
      ('77777777-7777-4777-8777-777777777777'),
      ('88888888-8888-4888-8888-888888888888'),
      ('99999999-9999-4999-8999-999999999999');
    insert into public.google_connections (
      user_id, status, access_token_enc, refresh_token_enc, credential_version
    ) values
      ('66666666-6666-4666-8666-666666666666', 'connected',
       'fixture-access-c', 'fixture-refresh-c', 0),
      ('77777777-7777-4777-8777-777777777777', 'connected',
       'fixture-access-d', 'fixture-refresh-d', 0),
      ('88888888-8888-4888-8888-888888888888', 'connected',
       'fixture-access-e', 'fixture-refresh-e', 0),
      ('99999999-9999-4999-8999-999999999999', 'connected',
       'fixture-access-f', 'fixture-refresh-f', 0);
  `);

  psql(migrationSql(operationMigrationName));
  psql(migrationSql(remediationMigrationName));
  psql(migrationSql(remediationMigrationName));

  const operationBarrier = spawnPsql();
  operationBarrier.child.stdin.write(`begin;
    lock table public.google_connections in share mode;
    select 'OPERATION_BARRIER_READY';\n`);
  await waitForText(operationBarrier, "OPERATION_BARRIER_READY");
  const operationA = spawnPsql(
    prepareOperationSql(
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      "6".repeat(64),
      "lease-claim-barrier-operation-a",
    ),
  );
  const operationB = spawnPsql(
    prepareOperationSql(
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
      "7".repeat(64),
      "lease-claim-barrier-operation-b",
    ),
  );
  await waitForBlockedClaims();
  operationBarrier.child.stdin.end("commit;\n");
  await operationBarrier.completed;
  const operationResults = await Promise.all([
    operationA.completed,
    operationB.completed,
  ]);
  if (
    operationResults.sort().join(",") !== "prepared|0,provider_call_started|"
  ) {
    throw new Error(`same-user operation claim mismatch: ${operationResults}`);
  }

  psql(`
    do $prepare_mark_lifecycle$
    declare
      state_result text;
      version_result bigint;
    begin
      if (select count(*) from public.google_refresh_operations
          where user_id = '66666666-6666-4666-8666-666666666666'
            and state in ('prepared', 'provider_call_started')) <> 1 then
        raise exception 'active operation uniqueness was not preserved';
      end if;
      if not exists (
        select 1
        from public.google_connections as connection
        join public.google_refresh_operations as operation
          on operation.user_id = connection.user_id
         and operation.lease_id_hash = connection.refresh_lease_id_hash
        where connection.user_id = '66666666-6666-4666-8666-666666666666'
          and operation.state = 'prepared'
      ) then raise exception 'active lease ownership was not preserved'; end if;

      select operation_state, credential_version
        into state_result, version_result
      from public.prepare_google_refresh_operation(
        '88888888-8888-4888-8888-888888888888',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0, repeat('8', 64)
      );
      if state_result <> 'prepared' or version_result <> 0 then
        raise exception 'fresh prepare mismatch';
      end if;

      select operation_state, credential_version
        into state_result, version_result
      from public.prepare_google_refresh_operation(
        '88888888-8888-4888-8888-888888888888',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1, repeat('8', 64)
      );
      if state_result <> 'failed_terminal' or version_result is not null then
        raise exception 'prepare credential mismatch was accepted';
      end if;

      select operation_state, credential_version
        into state_result, version_result
      from public.mark_google_refresh_provider_started(
        '88888888-8888-4888-8888-888888888888',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 0, repeat('8', 64)
      );
      if state_result <> 'failed_terminal' or version_result is not null then
        raise exception 'mark accepted wrong operation';
      end if;

      select operation_state, credential_version
        into state_result, version_result
      from public.mark_google_refresh_provider_started(
        '88888888-8888-4888-8888-888888888888',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0, repeat('8', 64)
      );
      if state_result <> 'provider_call_started' or version_result <> 0 then
        raise exception 'mark expected transition mismatch';
      end if;
      select operation_state, credential_version
        into state_result, version_result
      from public.mark_google_refresh_provider_started(
        '88888888-8888-4888-8888-888888888888',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0, repeat('8', 64)
      );
      if state_result <> 'failed_terminal' or version_result is not null then
        raise exception 'duplicate mark was accepted';
      end if;

      update public.google_refresh_operations
      set lease_expires_at = statement_timestamp() - interval '1 second'
      where operation_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      update public.google_connections
      set refresh_lease_expires_at = statement_timestamp() - interval '1 second'
      where user_id = '88888888-8888-4888-8888-888888888888';
      select operation_state, credential_version
        into state_result, version_result
      from public.prepare_google_refresh_operation(
        '88888888-8888-4888-8888-888888888888',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 0, repeat('8', 64)
      );
      if state_result <> 'outcome_unknown' or version_result is not null then
        raise exception 'expired provider operation did not fail closed';
      end if;

      select operation_state, credential_version
        into state_result, version_result
      from public.prepare_google_refresh_operation(
        '99999999-9999-4999-8999-999999999999',
        'ffffffff-ffff-4fff-8fff-ffffffffffff', 0, repeat('9', 64)
      );
      if state_result <> 'prepared' or version_result <> 0 then
        raise exception 'retryable fixture prepare mismatch';
      end if;
      update public.google_refresh_operations
      set state = 'retryable', error_code = 'GOOGLE_TOKEN_WRITE_DISABLED',
          lease_expires_at = statement_timestamp() - interval '1 second'
      where operation_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      update public.google_connections
      set refresh_lease_expires_at = statement_timestamp() - interval '1 second'
      where user_id = '99999999-9999-4999-8999-999999999999';
      select operation_state, credential_version
        into state_result, version_result
      from public.prepare_google_refresh_operation(
        '99999999-9999-4999-8999-999999999999',
        'ffffffff-ffff-4fff-8fff-ffffffffffff', 0, repeat('a', 64)
      );
      if state_result <> 'prepared' or version_result <> 0 then
        raise exception 'expired retryable operation was not prepared';
      end if;
      if not exists (
        select 1 from public.google_connections
        where user_id = '99999999-9999-4999-8999-999999999999'
          and refresh_lease_id_hash = repeat('a', 64)
      ) then raise exception 'new lease was not acquired after expiry'; end if;
    end
    $prepare_mark_lifecycle$;
  `);

  psql(`
    do $transition_contract$
    declare
      active_operation uuid;
      active_lease text;
      state_result text;
      version_result bigint;
    begin
      select operation_id, lease_id_hash
        into active_operation, active_lease
      from public.google_refresh_operations
      where user_id = '66666666-6666-4666-8666-666666666666'
        and state = 'prepared';
      if active_operation is null then
        raise exception 'concurrent operation winner missing';
      end if;

      begin
        perform * from public.transition_google_refresh_operation(
          '66666666-6666-4666-8666-666666666666', active_operation,
          0, active_lease, 'retryable', 'WRONG_ERROR_CODE'
        );
        raise exception 'invalid transition/error pair accepted';
      exception when invalid_parameter_value then null;
      end;

      select operation_state, credential_version
        into state_result, version_result
      from public.transition_google_refresh_operation(
        '66666666-6666-4666-8666-666666666666', active_operation,
        0, active_lease, 'retryable', 'GOOGLE_TOKEN_WRITE_DISABLED'
      );
      if state_result <> 'retryable' or version_result <> 0 then
        raise exception 'valid retryable transition mismatch';
      end if;

      perform * from public.prepare_google_refresh_operation(
        '66666666-6666-4666-8666-666666666666', active_operation,
        0, active_lease
      );
      perform * from public.mark_google_refresh_provider_started(
        '66666666-6666-4666-8666-666666666666', active_operation,
        0, active_lease
      );
      select operation_state, credential_version
        into state_result, version_result
      from public.transition_google_refresh_operation(
        '66666666-6666-4666-8666-666666666666', active_operation,
        0, active_lease, 'failed_terminal', 'GOOGLE_TOKEN_INVALID'
      );
      if state_result <> 'failed_terminal' or version_result <> 0 then
        raise exception 'valid terminal transition mismatch';
      end if;
      select operation_state, credential_version
        into state_result, version_result
      from public.transition_google_refresh_operation(
        '66666666-6666-4666-8666-666666666666', active_operation,
        0, active_lease, 'failed_terminal', 'GOOGLE_TOKEN_INVALID'
      );
      if state_result <> 'failed_terminal' or version_result <> 0 then
        raise exception 'terminal transition replay mismatch';
      end if;

      select operation_state, credential_version
        into state_result, version_result
      from public.transition_google_refresh_operation(
        '99999999-9999-4999-8999-999999999999',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        1, repeat('a', 64), 'retryable', 'GOOGLE_TOKEN_WRITE_DISABLED'
      );
      if state_result <> 'outcome_unknown' or version_result is not null then
        raise exception 'transition accepted wrong credential version';
      end if;
      select operation_state, credential_version
        into state_result, version_result
      from public.transition_google_refresh_operation(
        '99999999-9999-4999-8999-999999999999',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        0, repeat('b', 64), 'retryable', 'GOOGLE_TOKEN_WRITE_DISABLED'
      );
      if state_result <> 'outcome_unknown' or version_result is not null then
        raise exception 'transition accepted wrong lease ownership';
      end if;

      perform * from public.mark_google_refresh_provider_started(
        '99999999-9999-4999-8999-999999999999',
        'ffffffff-ffff-4fff-8fff-ffffffffffff', 0, repeat('a', 64)
      );
      select operation_state, credential_version
        into state_result, version_result
      from public.transition_google_refresh_operation(
        '99999999-9999-4999-8999-999999999999',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        0, repeat('a', 64), 'outcome_unknown', 'GOOGLE_REFRESH_OUTCOME_UNKNOWN'
      );
      if state_result <> 'outcome_unknown' or version_result <> 0 then
        raise exception 'outcome_unknown transition mismatch';
      end if;
      select operation_state, credential_version
        into state_result, version_result
      from public.transition_google_refresh_operation(
        '99999999-9999-4999-8999-999999999999',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        0, repeat('a', 64), 'outcome_unknown', 'GOOGLE_REFRESH_OUTCOME_UNKNOWN'
      );
      if state_result <> 'outcome_unknown' or version_result <> 0 then
        raise exception 'outcome_unknown replay mismatch';
      end if;

      update public.google_connections
      set status = 'connected', reauth_required = false,
          last_error_code = null, last_error_at = null,
          credential_version = 1,
          refresh_lease_id_hash = null, refresh_lease_expires_at = null
      where user_id = '99999999-9999-4999-8999-999999999999';
      select operation_state, credential_version
        into state_result, version_result
      from public.prepare_google_refresh_operation(
        '99999999-9999-4999-8999-999999999999',
        'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 1, repeat('b', 64)
      );
      if state_result <> 'prepared' or version_result <> 1 then
        raise exception 'new-version prepare mismatch';
      end if;
      if not exists (
        select 1 from public.google_refresh_operations
        where operation_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
          and state = 'resolved'
      ) then raise exception 'older outcome_unknown was not resolved'; end if;

      select operation_state, credential_version
        into state_result, version_result
      from public.get_google_refresh_operation(
        '99999999-9999-4999-8999-999999999999',
        'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
      );
      if state_result <> 'prepared' or version_result is not null then
        raise exception 'get operation result mismatch';
      end if;
      if exists (
        select 1 from public.get_google_refresh_operation(
          '99999999-9999-4999-8999-999999999999',
          'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'
        )
      ) then raise exception 'get operation returned absent row'; end if;
    end
    $transition_contract$;
  `);

  psql(`
    do $late_finalize_new_lease$
    declare
      state_result text;
      version_result bigint;
    begin
      select operation_state, credential_version
        into state_result, version_result
      from public.prepare_google_refresh_operation(
        '44444444-4444-4444-8444-444444444444',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, repeat('1', 64)
      );
      if state_result <> 'prepared' or version_result <> 0 then
        raise exception 'late-finalize L1 prepare mismatch';
      end if;

      perform * from public.mark_google_refresh_provider_started(
        '44444444-4444-4444-8444-444444444444',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, repeat('1', 64)
      );
      update public.google_connections
      set refresh_lease_expires_at = statement_timestamp() - interval '1 second'
      where user_id = '44444444-4444-4444-8444-444444444444';
      perform * from public.claim_google_credential_refresh_lease(
        '44444444-4444-4444-8444-444444444444', 'connected', 0, repeat('2', 64)
      );

      select operation_state, credential_version
        into state_result, version_result
      from public.finalize_google_refresh_operation(
        '44444444-4444-4444-8444-444444444444',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0, repeat('1', 64),
        'fixture-late-access', 'fixture-late-refresh', true,
        statement_timestamp() + interval '1 hour', statement_timestamp()
      );
      if state_result <> 'outcome_unknown' or version_result is not null then
        raise exception 'late-finalize outcome mismatch';
      end if;
      if not exists (
        select 1 from public.google_refresh_operations
        where operation_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
          and state = 'outcome_unknown'
      ) then raise exception 'late operation state mismatch'; end if;
      if not exists (
        select 1 from public.google_connections
        where user_id = '44444444-4444-4444-8444-444444444444'
          and status = 'connected' and not reauth_required
          and credential_version = 0
          and refresh_lease_id_hash = repeat('2', 64)
          and refresh_lease_expires_at > statement_timestamp()
          and access_token_enc = 'fixture-access-a'
          and refresh_token_enc = 'fixture-refresh-a'
      ) then raise exception 'late finalize clobbered new lease'; end if;
    end
    $late_finalize_new_lease$;

    do $normal_finalize$
    declare
      state_result text;
      version_result bigint;
    begin
      perform * from public.prepare_google_refresh_operation(
        '55555555-5555-4555-8555-555555555555',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 0, repeat('3', 64)
      );
      perform * from public.mark_google_refresh_provider_started(
        '55555555-5555-4555-8555-555555555555',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 0, repeat('3', 64)
      );
      select operation_state, credential_version
        into state_result, version_result
      from public.finalize_google_refresh_operation(
        '55555555-5555-4555-8555-555555555555',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 0, repeat('3', 64),
        'fixture-final-access', 'fixture-final-refresh', true,
        statement_timestamp() + interval '1 hour', statement_timestamp()
      );
      if state_result <> 'completed' or version_result <> 1 then
        raise exception 'normal finalize result mismatch';
      end if;
      if not exists (
        select 1 from public.google_connections
        where user_id = '55555555-5555-4555-8555-555555555555'
          and credential_version = 1
          and access_token_enc = 'fixture-final-access'
          and refresh_token_enc = 'fixture-final-refresh'
          and refresh_lease_id_hash is null
          and refresh_lease_expires_at is null
      ) then raise exception 'normal finalize credential mismatch'; end if;
      select operation_state, credential_version
        into state_result, version_result
      from public.prepare_google_refresh_operation(
        '55555555-5555-4555-8555-555555555555',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 0, repeat('3', 64)
      );
      if state_result <> 'completed' or version_result <> 1 then
        raise exception 'completed replay mismatch';
      end if;
    end
    $normal_finalize$;

    do $acl_contract$
    declare function_name text;
    declare function_oid oid;
    begin
      foreach function_name in array array[
        'prepare_google_refresh_operation(uuid,uuid,bigint,text)',
        'mark_google_refresh_provider_started(uuid,uuid,bigint,text)',
        'finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamp with time zone,timestamp with time zone)',
        'transition_google_refresh_operation(uuid,uuid,bigint,text,text,text)',
        'get_google_refresh_operation(uuid,uuid)'
      ] loop
        function_oid := to_regprocedure('public.' || function_name);
        if function_oid is null
           or has_function_privilege('anon', function_oid, 'EXECUTE')
           or has_function_privilege('authenticated', function_oid, 'EXECUTE')
           or not has_function_privilege('service_role', function_oid, 'EXECUTE') then
          raise exception 'operation RPC ACL mismatch: %', function_name;
        end if;
      end loop;
      if has_table_privilege('anon', 'public.google_refresh_operations', 'SELECT')
         or has_table_privilege('authenticated', 'public.google_refresh_operations', 'INSERT')
         or not has_table_privilege('service_role', 'public.google_refresh_operations', 'SELECT,INSERT,UPDATE')
         or has_table_privilege('service_role', 'public.google_refresh_operations', 'DELETE') then
        raise exception 'operation table ACL mismatch';
      end if;
    end
    $acl_contract$;
  `);

  const deniedSql = [
    `set role anon;
     select * from public.get_google_refresh_operation(
       '99999999-9999-4999-8999-999999999999',
       'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');`,
    `set role authenticated;
     select * from public.prepare_google_refresh_operation(
       '99999999-9999-4999-8999-999999999999',
       'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 1, repeat('c', 64));`,
    `set role authenticated;
     select operation_id from public.google_refresh_operations;`,
    `set role authenticated;
     insert into public.google_refresh_operations (
       operation_id, user_id, state, expected_credential_version,
       lease_id_hash, lease_expires_at
     ) values (
       'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
       '99999999-9999-4999-8999-999999999999', 'prepared', 1,
       repeat('c', 64), statement_timestamp() + interval '90 seconds'
     );`,
  ];
  for (const denied of deniedSql) {
    if (psql(denied, { allowFailure: true }).status === 0) {
      throw new Error(`ACL/RLS operation unexpectedly succeeded: ${denied}`);
    }
  }
  const serviceRoleGet = psql(
    `set role service_role;
     select operation_state from public.get_google_refresh_operation(
       '99999999-9999-4999-8999-999999999999',
       'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa');`,
    { tuplesOnly: true },
  ).stdout.trim();
  if (serviceRoleGet !== "prepared") {
    throw new Error(`service_role get operation mismatch: ${serviceRoleGet}`);
  }

  psql(`
    create function public.fixture_reject_completed_operation()
    returns trigger language plpgsql as $$
    begin
      if new.state = 'completed' then raise exception 'fixture rollback'; end if;
      return new;
    end $$;
    create trigger fixture_reject_completed_operation
      before update on public.google_refresh_operations
      for each row execute function public.fixture_reject_completed_operation();
    select * from public.prepare_google_refresh_operation(
      '77777777-7777-4777-8777-777777777777',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 0, repeat('5', 64));
    select * from public.mark_google_refresh_provider_started(
      '77777777-7777-4777-8777-777777777777',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 0, repeat('5', 64));
  `);
  const rollbackFinalize = psql(
    `select * from public.finalize_google_refresh_operation(
      '77777777-7777-4777-8777-777777777777',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 0, repeat('5', 64),
      'fixture-rollback-access', 'fixture-rollback-refresh', true,
      statement_timestamp() + interval '1 hour', statement_timestamp());`,
    { allowFailure: true },
  );
  if (rollbackFinalize.status === 0)
    throw new Error("rollback trigger did not abort finalize");
  psql(`
    do $verify_rollback$
    begin
      if not exists (
        select 1 from public.google_connections
        where user_id = '77777777-7777-4777-8777-777777777777'
          and credential_version = 0
          and access_token_enc = 'fixture-access-d'
          and refresh_token_enc = 'fixture-refresh-d'
          and refresh_lease_id_hash = repeat('5', 64)
      ) or not exists (
        select 1 from public.google_refresh_operations
        where operation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
          and state = 'provider_call_started'
          and result_credential_version is null
      ) then raise exception 'finalize rollback was not atomic'; end if;
    end
    $verify_rollback$;
    drop trigger fixture_reject_completed_operation on public.google_refresh_operations;
    drop function public.fixture_reject_completed_operation();
  `);

  psql(`
    create function public.fixture_reject_connection_transition()
    returns trigger language plpgsql as $$
    begin
      if new.user_id = '77777777-7777-4777-8777-777777777777' then
        raise exception 'fixture connection rollback';
      end if;
      return new;
    end $$;
    create trigger fixture_reject_connection_transition
      before update on public.google_connections
      for each row execute function public.fixture_reject_connection_transition();
  `);
  const rollbackTransition = psql(
    `select * from public.transition_google_refresh_operation(
      '77777777-7777-4777-8777-777777777777',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 0, repeat('5', 64),
      'failed_terminal', 'GOOGLE_TOKEN_INVALID');`,
    { allowFailure: true },
  );
  if (rollbackTransition.status === 0) {
    throw new Error("connection trigger did not abort transition");
  }
  psql(`
    do $verify_transition_rollback$
    begin
      if not exists (
        select 1 from public.google_refresh_operations
        where operation_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
          and state = 'provider_call_started'
          and error_code is null
      ) or not exists (
        select 1 from public.google_connections
        where user_id = '77777777-7777-4777-8777-777777777777'
          and status = 'connected' and not reauth_required
          and credential_version = 0
          and refresh_lease_id_hash = repeat('5', 64)
      ) then raise exception 'transition rollback was not atomic'; end if;
    end
    $verify_transition_rollback$;
    drop trigger fixture_reject_connection_transition on public.google_connections;
    drop function public.fixture_reject_connection_transition();
  `);

  const driftCases = [
    "alter function public.prepare_google_refresh_operation(uuid,uuid,bigint,text) security definer;",
    "alter function public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text) set search_path = public;",
    "alter function public.finalize_google_refresh_operation(uuid,uuid,bigint,text,text,text,boolean,timestamptz,timestamptz) owner to service_role;",
    "grant execute on function public.prepare_google_refresh_operation(uuid,uuid,bigint,text) to anon;",
    `do $body_drift$
     declare function_body text;
     begin
       select prosrc into function_body
       from pg_proc
       where oid = 'public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text)'::regprocedure;
       execute format(
         'create or replace function public.transition_google_refresh_operation(p_user_id uuid,p_operation_id uuid,p_expected_credential_version bigint,p_lease_id_hash text,p_target_state text,p_error_code text) returns table (operation_state text, credential_version bigint) language plpgsql volatile security invoker set search_path = %L as %L',
         '', function_body || E'\\n-- fixture body drift'
       );
     end
     $body_drift$;`,
    "drop function public.transition_google_refresh_operation(uuid,uuid,bigint,text,text,text);",
  ];
  for (const drift of driftCases) {
    psql(drift);
    const rejected = psql(migrationSql(remediationMigrationName), {
      allowFailure: true,
    });
    if (rejected.status === 0)
      throw new Error(`remediation accepted drift: ${drift}`);
    psql(migrationSql(operationMigrationName));
    psql(migrationSql(remediationMigrationName));
  }

  const originalPrepareDefinition = migrationSql(operationMigrationName).match(
    /create or replace function public\.prepare_google_refresh_operation\([\s\S]*?\$prepare\$;/,
  )?.[0];
  if (!originalPrepareDefinition) {
    throw new Error("original prepare function definition was not found");
  }
  psql(originalPrepareDefinition);
  const partialRejected = psql(migrationSql(remediationMigrationName), {
    allowFailure: true,
  });
  if (partialRejected.status === 0) {
    throw new Error("remediation accepted partial function remediation");
  }
  psql(migrationSql(operationMigrationName));
  psql(migrationSql(remediationMigrationName));

  console.log(
    "fresh-db apply=pass replay=pass malformed=pass same-user=1/0 different-users=1/1 expiry=pass operation-concurrency=pass prepare=pass mark=pass transitions=pass get=pass late-finalize=pass normal-finalize=pass rollback=pass acl-rls=pass drift-partial=pass",
  );
} finally {
  if (started) docker(["stop", containerName], { allowFailure: true });
}
