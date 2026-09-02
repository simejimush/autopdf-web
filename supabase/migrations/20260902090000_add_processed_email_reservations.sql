begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
declare
  v_new_column_count integer;
  v_function_count integer;
  v_index_exists boolean := pg_catalog.to_regclass(
    'public.processed_emails_reservation_state_idx'
  ) is not null;
  v_expected_columns constant text[] := array[
    'processing_status', 'reservation_run_id', 'reservation_id_hash',
    'reserved_at', 'reservation_expires_at', 'drive_write_started_at',
    'completed_at', 'reserved_bytes', 'written_bytes'
  ];
  v_expected_functions constant text[] := array[
    'reserve_processed_email', 'mark_processed_email_drive_started',
    'complete_processed_email'
  ];
  v_function_signatures constant text[] := array[
    'public.reserve_processed_email(uuid,uuid,uuid,text,text,text,bigint)',
    'public.mark_processed_email_drive_started(uuid,uuid,uuid,text,text)',
    'public.complete_processed_email(uuid,uuid,uuid,text,text,text,text,text,bigint)'
  ];
  v_function_results constant text[] := array[
    'TABLE(outcome text, reservation_expires_at timestamp with time zone)',
    'TABLE(outcome text)',
    'TABLE(outcome text)'
  ];
  v_function_source_hashes constant text[] := array[
    '27f16c86f139dee10a49493fd1e94873',
    'ff21b290517c56114ccd7645c52fecb7',
    '327868a4342a782a262a3202ba9b2063'
  ];
  v_function_index integer;
  v_function_oid oid;
  v_function_row record;
begin
  if pg_catalog.to_regrole('postgres') is null
    or pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('service_role') is null then
    raise exception 'processed email reservation requires canonical Supabase roles';
  end if;

  if pg_catalog.to_regclass('public.processed_emails') is null
    or pg_catalog.to_regclass('public.rule_execution_leases') is null
    or pg_catalog.to_regclass('public.user_profiles') is null then
    raise exception 'processed email reservation requires canonical tables';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = 'public.processed_emails'::pg_catalog.regclass
      and c.relkind = 'r'
      and c.relrowsecurity
      and not c.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
  )
    or pg_catalog.has_table_privilege('anon', 'public.processed_emails',
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or not pg_catalog.has_table_privilege('authenticated', 'public.processed_emails', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.processed_emails',
      'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or not pg_catalog.has_table_privilege('service_role', 'public.processed_emails', 'SELECT, INSERT')
    or pg_catalog.has_table_privilege('service_role', 'public.processed_emails',
      'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
    raise exception 'processed_emails owner, RLS, or ACL drifted';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'processed_emails'
  ) <> 1
    or not exists (
      select 1
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'processed_emails'
        and p.policyname in (
          'processed_emails_select_own',
          'users_can_select_own_processed_emails'
        )
        and p.permissive = 'PERMISSIVE'
        and p.roles = array['authenticated']::name[]
        and p.cmd = 'SELECT'
        and pg_catalog.lower(pg_catalog.regexp_replace(
          coalesce(p.qual, ''), '[()[:space:]]', '', 'g'
        )) in (
          'auth.uid=user_id',
          'selectauth.uid=user_id',
          'selectauth.uidasuid=user_id'
        )
        and p.with_check is null
    ) then
    raise exception 'processed_emails policy drifted';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid = 'public.processed_emails'::pg_catalog.regclass
      and (
        acl.grantor <> pg_catalog.to_regrole('postgres')
        or acl.is_grantable
        or acl.grantee not in (
          pg_catalog.to_regrole('postgres'),
          pg_catalog.to_regrole('authenticated'),
          pg_catalog.to_regrole('service_role')
        )
        or (acl.grantee = pg_catalog.to_regrole('authenticated') and acl.privilege_type <> 'SELECT')
        or (acl.grantee = pg_catalog.to_regrole('service_role') and acl.privilege_type not in ('SELECT', 'INSERT'))
      )
  ) then
    raise exception 'processed_emails contains an unknown grant';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
      and c.conname = 'processed_emails_rule_msg_uniq'
      and c.contype = 'u' and c.convalidated
      and pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (rule_id, gmail_message_id)'
  ) then
    raise exception 'processed_emails unique identity constraint drifted';
  end if;

  select pg_catalog.count(*) into v_new_column_count
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
    and a.attname = any(v_expected_columns)
    and not a.attisdropped;

  select pg_catalog.count(*) into v_function_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any(v_expected_functions);

  if v_new_column_count = 0 and v_function_count = 0 and not v_index_exists then
    if not exists (
      select 1 from pg_catalog.pg_proc p
      where p.oid = 'public.finalize_guarded_execution(uuid,uuid,uuid,text,text,integer,integer,integer,text,text)'::pg_catalog.regprocedure
        and pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) = 'acb72251d3979a718d8305c939445caf'
    ) then
      raise exception 'Migration A finalize_guarded_execution body drifted';
    end if;
    return;
  end if;

  if v_new_column_count <> 9 or v_function_count <> 3 or not v_index_exists then
    raise exception 'processed email reservation objects are partially present';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = 'public.finalize_guarded_execution(uuid,uuid,uuid,text,text,integer,integer,integer,text,text)'::pg_catalog.regprocedure
      and pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) = 'b80a254194f691579e373b3d45774db6'
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef
      and p.proconfig is not distinct from array['search_path=""']::text[]
  ) then
    raise exception 'processed email finalize_guarded_execution body or metadata drifted';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_attribute a
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname = any(v_expected_columns) and not a.attisdropped) <> 9
    or not exists (
      select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname = 'processing_status' and a.atttypid = 'text'::pg_catalog.regtype
        and a.attnotnull and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '''completed''::text'
    )
    or not exists (
      select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname in ('reserved_bytes', 'written_bytes')
        and a.atttypid = 'bigint'::pg_catalog.regtype and a.attnotnull
        and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '0'
      group by a.attrelid having pg_catalog.count(*) = 2
    )
    or not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname in ('reservation_run_id') and a.atttypid = 'uuid'::pg_catalog.regtype
        and not a.attnotnull and not a.atthasdef
    )
    or not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname in ('reservation_id_hash') and a.atttypid = 'text'::pg_catalog.regtype
        and not a.attnotnull and not a.atthasdef
    )
    or not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname in ('reserved_at', 'reservation_expires_at', 'drive_write_started_at', 'completed_at')
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and not a.attnotnull and not a.atthasdef
      group by a.attrelid having pg_catalog.count(*) = 4
    ) then
    raise exception 'processed email reservation columns drifted';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_index x
    join pg_catalog.pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'public.processed_emails'::pg_catalog.regclass
      and i.relname = 'processed_emails_reservation_state_idx'
      and x.indisvalid and x.indisready and x.indislive
      and not x.indisunique and not x.indisprimary
      and pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_indexdef(x.indexrelid)), '[[:space:]]', '', 'g') =
        'createindexprocessed_emails_reservation_state_idxonpublic.processed_emailsusingbtree(processing_status,reservation_expires_at)'
  ) then
    raise exception 'processed email reservation index drifted';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_constraint c
      where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
        and c.conname in (
          'processed_emails_processing_status_check',
          'processed_emails_reservation_hash_check',
          'processed_emails_byte_accounting_check',
          'processed_emails_processing_shape_check'
        ) and c.contype = 'c' and c.convalidated) <> 4
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
        and c.conname = 'processed_emails_processing_status_check'
        and pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(c.conbin, c.conrelid, true), '[()[:space:]]', '', 'g'
        )) = 'processing_status=any(array[''reserved''::text,''completed''::text,''released''::text,''outcome_unknown''::text])'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
        and c.conname = 'processed_emails_reservation_hash_check'
        and pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(c.conbin, c.conrelid, true), '[()[:space:]]', '', 'g'
        )) = 'reservation_id_hashisnullorreservation_id_hash~''^[0-9a-f]{64}$''::text'
    )
    or not exists (
      select 1 from pg_catalog.pg_constraint c
      where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
        and c.conname = 'processed_emails_byte_accounting_check'
        and pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(c.conbin, c.conrelid, true), '[()[:space:]]', '', 'g'
        )) = 'reserved_bytes>=0andwritten_bytes>=0andwritten_bytes<=reserved_bytes'
    ) then
    raise exception 'processed email reservation constraints drifted';
  end if;

  for v_function_index in 1..3 loop
    v_function_oid := pg_catalog.to_regprocedure(v_function_signatures[v_function_index]);
    select pg_catalog.pg_get_userbyid(p.proowner) as owner,
      l.lanname as language, p.prokind, p.provolatile, p.prosecdef,
      p.proisstrict, p.proleakproof, p.proparallel, p.proconfig, p.proacl,
      pg_catalog.pg_get_function_result(p.oid) as function_result,
      pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) as source_hash
    into v_function_row
    from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = v_function_oid;

    if v_function_oid is null or v_function_row.owner <> 'postgres'
      or v_function_row.language <> 'plpgsql' or v_function_row.prokind <> 'f'
      or v_function_row.provolatile <> 'v' or not v_function_row.prosecdef
      or v_function_row.proisstrict or v_function_row.proleakproof
      or v_function_row.proparallel <> 'u'
      or v_function_row.proconfig is distinct from array['search_path=""']::text[]
      or v_function_row.function_result <> v_function_results[v_function_index]
      or v_function_row.source_hash <> v_function_source_hashes[v_function_index]
      or v_function_row.proacl is null
      or (select pg_catalog.count(*) from pg_catalog.aclexplode(v_function_row.proacl)) <> 2
      or exists (
        select 1 from pg_catalog.aclexplode(v_function_row.proacl) acl
        where acl.privilege_type <> 'EXECUTE' or acl.is_grantable
          or acl.grantor <> pg_catalog.to_regrole('postgres')
          or acl.grantee not in (
            pg_catalog.to_regrole('postgres'), pg_catalog.to_regrole('service_role')
          )
      )
      or not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
      raise exception 'processed email reservation RPC metadata, body, or ACL drifted';
    end if;
  end loop;
end
$preflight$;

alter table public.processed_emails
  add column if not exists processing_status text not null default 'completed',
  add column if not exists reservation_run_id uuid,
  add column if not exists reservation_id_hash text,
  add column if not exists reserved_at timestamp with time zone,
  add column if not exists reservation_expires_at timestamp with time zone,
  add column if not exists drive_write_started_at timestamp with time zone,
  add column if not exists completed_at timestamp with time zone,
  add column if not exists reserved_bytes bigint not null default 0,
  add column if not exists written_bytes bigint not null default 0;

update public.processed_emails
set completed_at = saved_at
where completed_at is null;

do $constraints$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.processed_emails'::pg_catalog.regclass and conname = 'processed_emails_processing_status_check') then
    alter table public.processed_emails add constraint processed_emails_processing_status_check
      check (processing_status in ('reserved', 'completed', 'released', 'outcome_unknown'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.processed_emails'::pg_catalog.regclass and conname = 'processed_emails_reservation_hash_check') then
    alter table public.processed_emails add constraint processed_emails_reservation_hash_check
      check (reservation_id_hash is null or reservation_id_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.processed_emails'::pg_catalog.regclass and conname = 'processed_emails_byte_accounting_check') then
    alter table public.processed_emails add constraint processed_emails_byte_accounting_check
      check (reserved_bytes >= 0 and written_bytes >= 0 and written_bytes <= reserved_bytes);
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.processed_emails'::pg_catalog.regclass and conname = 'processed_emails_processing_shape_check') then
    alter table public.processed_emails add constraint processed_emails_processing_shape_check check (
      (processing_status = 'completed' and completed_at is not null
        and reservation_run_id is null and reservation_id_hash is null
        and reservation_expires_at is null and drive_write_started_at is null
        and written_bytes = reserved_bytes)
      or
      (processing_status = 'reserved' and completed_at is null
        and reservation_run_id is not null and reservation_id_hash is not null
        and reserved_at is not null and reservation_expires_at > reserved_at
        and written_bytes = 0)
      or
      (processing_status = 'released' and completed_at is null
        and reservation_run_id is null and reservation_id_hash is null
        and reserved_at is null and reservation_expires_at is null
        and drive_write_started_at is null and reserved_bytes = 0 and written_bytes = 0)
      or
      (processing_status = 'outcome_unknown' and completed_at is null
        and reservation_run_id is not null and reservation_id_hash is not null
        and reserved_at is not null and reservation_expires_at > reserved_at
        and drive_write_started_at is not null and written_bytes = 0)
    );
  end if;
end
$constraints$;

create index if not exists processed_emails_reservation_state_idx
  on public.processed_emails (processing_status, reservation_expires_at);

create or replace function public.reserve_processed_email(
  p_run_id uuid,
  p_user_id uuid,
  p_rule_id uuid,
  p_execution_lease_id_hash text,
  p_gmail_message_id text,
  p_reservation_id_hash text,
  p_reserved_bytes bigint
)
returns table (outcome text, reservation_expires_at timestamp with time zone)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamp with time zone;
  v_day_start timestamp with time zone;
  v_month_start timestamp with time zone;
  v_expires_at timestamp with time zone;
  v_existing public.processed_emails%rowtype;
  v_monthly_limit integer;
  v_count integer;
  v_user_bytes bigint;
  v_system_bytes bigint;
begin
  if p_run_id is null or p_user_id is null or p_rule_id is null
    or p_execution_lease_id_hash !~ '^[0-9a-f]{64}$'
    or p_reservation_id_hash !~ '^[0-9a-f]{64}$'
    or p_gmail_message_id is null or pg_catalog.btrim(p_gmail_message_id) = ''
    or pg_catalog.length(p_gmail_message_id) > 512
    or p_reserved_bytes is null or p_reserved_bytes < 1 or p_reserved_bytes > 36700160 then
    return query select 'RESERVATION_STORE_FAILED'::text, null::timestamp with time zone;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('autopdf_processed_email_reservation_v1', 0)
  );
  v_now := pg_catalog.statement_timestamp();
  v_day_start := pg_catalog.date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  v_month_start := pg_catalog.date_trunc('month', v_now at time zone 'UTC') at time zone 'UTC';

  if not exists (
    select 1 from public.rule_execution_leases l
    where l.run_id = p_run_id and l.user_id = p_user_id and l.rule_id = p_rule_id
      and l.lease_id_hash = p_execution_lease_id_hash and l.expires_at > v_now
  ) then
    return query select 'RESERVATION_STORE_FAILED'::text, null::timestamp with time zone;
    return;
  end if;

  update public.processed_emails p set
    processing_status = case when p.drive_write_started_at is null then 'released' else 'outcome_unknown' end,
    reservation_run_id = case when p.drive_write_started_at is null then null else p.reservation_run_id end,
    reservation_id_hash = case when p.drive_write_started_at is null then null else p.reservation_id_hash end,
    reserved_at = case when p.drive_write_started_at is null then null else p.reserved_at end,
    reservation_expires_at = case when p.drive_write_started_at is null then null else p.reservation_expires_at end,
    reserved_bytes = case when p.drive_write_started_at is null then 0 else p.reserved_bytes end
  where p.processing_status = 'reserved' and p.reservation_expires_at <= v_now;

  select p.* into v_existing from public.processed_emails p
  where p.rule_id = p_rule_id and p.gmail_message_id = p_gmail_message_id
  for update;

  if found and v_existing.processing_status = 'completed' then
    return query select 'COMPLETED'::text, null::timestamp with time zone;
    return;
  elsif found and v_existing.processing_status = 'outcome_unknown' then
    return query select 'OUTCOME_UNKNOWN'::text, v_existing.reservation_expires_at;
    return;
  elsif found and v_existing.processing_status = 'reserved' then
    return query select 'ACTIVE_RESERVATION'::text, v_existing.reservation_expires_at;
    return;
  end if;

  select case
    when u.billing_status in ('active', 'trialing') then 500
    when u.billing_status = 'canceled' and u.current_period_end > v_now then 500
    else 10
  end into v_monthly_limit
  from public.user_profiles u where u.user_id = p_user_id;
  v_monthly_limit := coalesce(v_monthly_limit, 10);

  select pg_catalog.count(*) into v_count from public.processed_emails p
  where p.user_id = p_user_id and (
    (p.processing_status = 'completed' and p.completed_at >= v_day_start)
    or (p.processing_status in ('reserved', 'outcome_unknown') and p.reserved_at >= v_day_start)
  );
  if v_count >= 30 then
    return query select 'DAILY_PROCESSED_EMAIL_LIMIT_EXCEEDED'::text, null::timestamp with time zone;
    return;
  end if;

  select pg_catalog.count(*) into v_count from public.processed_emails p
  where p.user_id = p_user_id and (
    (p.processing_status = 'completed' and p.completed_at >= v_month_start)
    or (p.processing_status in ('reserved', 'outcome_unknown') and p.reserved_at >= v_month_start)
  );
  if v_count >= v_monthly_limit then
    return query select case when v_monthly_limit = 10
      then 'FREE_MONTHLY_LIMIT_EXCEEDED' else 'MONTHLY_PROCESSED_EMAIL_LIMIT_EXCEEDED' end,
      null::timestamp with time zone;
    return;
  end if;

  select coalesce(pg_catalog.sum(case when p.processing_status = 'completed'
      then p.written_bytes else p.reserved_bytes end), 0)
    into v_user_bytes from public.processed_emails p
  where p.user_id = p_user_id
    and ((p.processing_status = 'completed' and p.completed_at >= v_month_start)
      or (p.processing_status in ('reserved', 'outcome_unknown') and p.reserved_at >= v_month_start));
  select coalesce(pg_catalog.sum(case when p.processing_status = 'completed'
      then p.written_bytes else p.reserved_bytes end), 0)
    into v_system_bytes from public.processed_emails p
  where (p.processing_status = 'completed' and p.completed_at >= v_month_start)
    or (p.processing_status in ('reserved', 'outcome_unknown') and p.reserved_at >= v_month_start);
  if v_user_bytes + p_reserved_bytes > 1073741824
    or v_system_bytes + p_reserved_bytes > 5368709120 then
    return query select 'DRIVE_BYTE_LIMIT_EXCEEDED'::text, null::timestamp with time zone;
    return;
  end if;

  v_expires_at := v_now + interval '75 seconds';
  if v_existing.id is null then
    insert into public.processed_emails (
      user_id, rule_id, gmail_message_id, processing_status,
      reservation_run_id, reservation_id_hash, reserved_at,
      reservation_expires_at, reserved_bytes, completed_at
    ) values (
      p_user_id, p_rule_id, p_gmail_message_id, 'reserved',
      p_run_id, p_reservation_id_hash, v_now, v_expires_at,
      p_reserved_bytes, null
    );
  else
    update public.processed_emails p set
      user_id = p_user_id, processing_status = 'reserved',
      reservation_run_id = p_run_id, reservation_id_hash = p_reservation_id_hash,
      reserved_at = v_now, reservation_expires_at = v_expires_at,
      drive_write_started_at = null, completed_at = null,
      reserved_bytes = p_reserved_bytes, written_bytes = 0,
      drive_file_id = null, drive_web_view_link = null, drive_file_name = null
    where p.id = v_existing.id and p.processing_status = 'released';
  end if;
  return query select 'RESERVED'::text, v_expires_at;
end
$function$;

create or replace function public.mark_processed_email_drive_started(
  p_run_id uuid, p_user_id uuid, p_rule_id uuid,
  p_gmail_message_id text, p_reservation_id_hash text
)
returns table (outcome text)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  if p_run_id is null or p_user_id is null or p_rule_id is null
    or p_gmail_message_id is null
    or p_reservation_id_hash !~ '^[0-9a-f]{64}$' then
    return query select 'MARK_REJECTED'::text;
    return;
  end if;
  update public.processed_emails p set drive_write_started_at = pg_catalog.statement_timestamp()
  where p.user_id = p_user_id and p.rule_id = p_rule_id
    and p.gmail_message_id = p_gmail_message_id
    and p.processing_status = 'reserved' and p.reservation_run_id = p_run_id
    and p.reservation_id_hash = p_reservation_id_hash
    and p.reservation_expires_at > pg_catalog.statement_timestamp()
    and p.drive_write_started_at is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return query select 'MARK_REJECTED'::text;
    return;
  end if;
  return query select 'MARKED'::text;
end
$function$;

create or replace function public.complete_processed_email(
  p_run_id uuid, p_user_id uuid, p_rule_id uuid,
  p_gmail_message_id text, p_reservation_id_hash text,
  p_drive_file_id text, p_drive_web_view_link text, p_drive_file_name text,
  p_written_bytes bigint
)
returns table (outcome text)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_updated integer;
begin
  if p_run_id is null or p_user_id is null or p_rule_id is null
    or p_gmail_message_id is null or p_reservation_id_hash !~ '^[0-9a-f]{64}$'
    or p_drive_file_id is null or pg_catalog.btrim(p_drive_file_id) = ''
    or p_drive_file_name is null or pg_catalog.btrim(p_drive_file_name) = ''
    or p_written_bytes is null or p_written_bytes < 0 then
    return query select 'COMPLETE_REJECTED'::text;
    return;
  end if;
  update public.processed_emails p set
    processing_status = 'completed', drive_file_id = p_drive_file_id,
    drive_web_view_link = p_drive_web_view_link, drive_file_name = p_drive_file_name,
    saved_at = pg_catalog.statement_timestamp(), completed_at = pg_catalog.statement_timestamp(),
    reservation_run_id = null, reservation_id_hash = null,
    reservation_expires_at = null, drive_write_started_at = null,
    reserved_bytes = p_written_bytes, written_bytes = p_written_bytes
  where p.user_id = p_user_id and p.rule_id = p_rule_id
    and p.gmail_message_id = p_gmail_message_id
    and p.processing_status = 'reserved' and p.reservation_run_id = p_run_id
    and p.reservation_id_hash = p_reservation_id_hash
    and p_written_bytes <= p.reserved_bytes;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    return query select 'COMPLETE_REJECTED'::text;
    return;
  end if;
  return query select 'COMPLETED'::text;
end
$function$;

create or replace function public.finalize_guarded_execution(
  p_run_id uuid, p_user_id uuid, p_rule_id uuid, p_lease_id_hash text,
  p_status text, p_processed_count integer, p_saved_count integer,
  p_skipped_count integer, p_message text, p_error_code text
)
returns table (outcome text, run_id uuid, status text)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_updated_count integer;
  v_deleted_count integer;
  v_now timestamp with time zone;
begin
  v_now := pg_catalog.statement_timestamp();
  if p_run_id is null or p_user_id is null or p_rule_id is null
    or p_lease_id_hash is null or p_lease_id_hash !~ '^[0-9a-f]{64}$'
    or p_status is null or p_status not in ('success', 'error')
    or p_message is null or pg_catalog.btrim(p_message) = ''
    or (p_status = 'success' and (p_processed_count is null or p_processed_count < 0
      or p_saved_count is null or p_saved_count < 0
      or p_skipped_count is null or p_skipped_count < 0 or p_error_code is not null))
    or (p_status = 'error' and (p_processed_count is not null or p_saved_count is not null
      or p_skipped_count is not null or p_error_code is null
      or p_error_code !~ '^[A-Z][A-Z0-9_]*$')) then
    return query select 'FINALIZE_REJECTED'::text, null::uuid, null::text;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('autopdf_processed_email_reservation_v1', 0)
  );
  perform 1 from public.rule_execution_leases l
  where l.rule_id = p_rule_id and l.user_id = p_user_id and l.run_id = p_run_id
    and l.lease_id_hash = p_lease_id_hash for update;
  if not found then
    return query select 'FINALIZE_REJECTED'::text, null::uuid, null::text;
    return;
  end if;

  if p_status = 'success' and exists (
    select 1 from public.processed_emails p
    where p.reservation_run_id = p_run_id and p.processing_status = 'reserved'
  ) then
    return query select 'FINALIZE_REJECTED'::text, null::uuid, null::text;
    return;
  end if;

  if p_status = 'error' then
    if p_error_code = 'DRIVE_UPLOAD_OUTCOME_UNKNOWN' then
      update public.processed_emails p set processing_status = 'outcome_unknown'
      where p.reservation_run_id = p_run_id and p.user_id = p_user_id
        and p.rule_id = p_rule_id and p.processing_status = 'reserved'
        and p.drive_write_started_at is not null;
    else
      update public.processed_emails p set
        processing_status = 'released', reservation_run_id = null,
        reservation_id_hash = null, reserved_at = null,
        reservation_expires_at = null, drive_write_started_at = null,
        reserved_bytes = 0, written_bytes = 0
      where p.reservation_run_id = p_run_id and p.user_id = p_user_id
        and p.rule_id = p_rule_id and p.processing_status = 'reserved';
    end if;
  end if;

  update public.runs r set status = p_status, finished_at = v_now,
    processed_count = case when p_status = 'success' then p_processed_count else r.processed_count end,
    saved_count = case when p_status = 'success' then p_saved_count else r.saved_count end,
    skipped_count = case when p_status = 'success' then p_skipped_count else r.skipped_count end,
    message = p_message, error_code = case when p_status = 'error' then p_error_code else null end
  where r.id = p_run_id and r.user_id = p_user_id and r.rule_id = p_rule_id
    and r.status = 'running';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then raise exception 'guarded run finalization rejected'; end if;

  delete from public.rule_execution_leases l
  where l.rule_id = p_rule_id and l.user_id = p_user_id and l.run_id = p_run_id
    and l.lease_id_hash = p_lease_id_hash;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1 then raise exception 'guarded lease release rejected'; end if;
  return query select 'FINALIZED'::text, p_run_id, p_status;
end
$function$;

alter function public.reserve_processed_email(uuid, uuid, uuid, text, text, text, bigint) owner to postgres;
alter function public.mark_processed_email_drive_started(uuid, uuid, uuid, text, text) owner to postgres;
alter function public.complete_processed_email(uuid, uuid, uuid, text, text, text, text, text, bigint) owner to postgres;
alter function public.finalize_guarded_execution(uuid, uuid, uuid, text, text, integer, integer, integer, text, text) owner to postgres;

revoke all on function public.reserve_processed_email(uuid, uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.mark_processed_email_drive_started(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_processed_email(uuid, uuid, uuid, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.reserve_processed_email(uuid, uuid, uuid, text, text, text, bigint) to service_role;
grant execute on function public.mark_processed_email_drive_started(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.complete_processed_email(uuid, uuid, uuid, text, text, text, text, text, bigint) to service_role;

commit;
