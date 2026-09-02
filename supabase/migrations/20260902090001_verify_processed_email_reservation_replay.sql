begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = '';

do $processed_email_reservation_replay_verification$
declare
  v_status_constraint_count integer;
  v_status_expression text;
  v_expected_columns constant text[] := array[
    'processing_status', 'reservation_run_id', 'reservation_id_hash',
    'reserved_at', 'reservation_expires_at', 'drive_write_started_at',
    'completed_at', 'reserved_bytes', 'written_bytes'
  ];
  v_function_signatures constant text[] := array[
    'public.reserve_processed_email(uuid,uuid,uuid,text,text,text,bigint)',
    'public.mark_processed_email_drive_started(uuid,uuid,uuid,text,text)',
    'public.complete_processed_email(uuid,uuid,uuid,text,text,text,text,text,bigint)',
    'public.finalize_guarded_execution(uuid,uuid,uuid,text,text,integer,integer,integer,text,text)'
  ];
  v_function_results constant text[] := array[
    'TABLE(outcome text, reservation_expires_at timestamp with time zone)',
    'TABLE(outcome text)',
    'TABLE(outcome text)',
    'TABLE(outcome text, run_id uuid, status text)'
  ];
  v_function_source_hashes constant text[] := array[
    '27f16c86f139dee10a49493fd1e94873',
    'ff21b290517c56114ccd7645c52fecb7',
    '327868a4342a782a262a3202ba9b2063',
    'b80a254194f691579e373b3d45774db6'
  ];
  v_function_index integer;
  v_function_oid oid;
  v_function_row record;
begin
  if pg_catalog.to_regrole('postgres') is null
    or pg_catalog.to_regrole('anon') is null
    or pg_catalog.to_regrole('authenticated') is null
    or pg_catalog.to_regrole('service_role') is null then
    raise exception 'processed email reservation replay verification requires canonical Supabase roles';
  end if;

  if pg_catalog.to_regclass('public.processed_emails') is null
    or pg_catalog.to_regclass('public.rule_execution_leases') is null
    or pg_catalog.to_regclass('public.user_profiles') is null then
    raise exception 'processed email reservation replay verification requires Migration B postcondition';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'public.processed_emails'::pg_catalog.regclass
      and c.relkind = 'r'
      and c.relrowsecurity
      and not c.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
  ) then
    raise exception 'processed_emails owner, RLS, or FORCE state drifted';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.processed_emails',
      'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or not pg_catalog.has_table_privilege('authenticated', 'public.processed_emails', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.processed_emails',
      'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or not pg_catalog.has_table_privilege('service_role', 'public.processed_emails', 'SELECT, INSERT')
    or pg_catalog.has_table_privilege('service_role', 'public.processed_emails',
      'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or exists (
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
          or (acl.grantee = pg_catalog.to_regrole('authenticated')
            and acl.privilege_type <> 'SELECT')
          or (acl.grantee = pg_catalog.to_regrole('service_role')
            and acl.privilege_type not in ('SELECT', 'INSERT'))
        )
    )
    or exists (
      select 1
      from pg_catalog.pg_attribute a
      cross join lateral pg_catalog.aclexplode(a.attacl) acl
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and not a.attisdropped
    ) then
    raise exception 'processed_emails table or column ACL drifted';
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

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
      and c.conname = 'processed_emails_rule_msg_uniq'
      and c.contype = 'u'
      and c.convalidated
      and pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (rule_id, gmail_message_id)'
  ) then
    raise exception 'processed_emails unique identity constraint drifted';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
      and a.attname = any(v_expected_columns)
      and not a.attisdropped
  ) <> 9
    or not exists (
      select 1
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname = 'processing_status'
        and a.atttypid = 'text'::pg_catalog.regtype
        and a.attnotnull
        and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '''completed''::text'
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname in ('reserved_bytes', 'written_bytes')
        and a.atttypid = 'bigint'::pg_catalog.regtype
        and a.attnotnull
        and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '0'
      group by a.attrelid
      having pg_catalog.count(*) = 2
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname = 'reservation_run_id'
        and a.atttypid = 'uuid'::pg_catalog.regtype
        and not a.attnotnull and not a.atthasdef
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname = 'reservation_id_hash'
        and a.atttypid = 'text'::pg_catalog.regtype
        and not a.attnotnull and not a.atthasdef
    )
    or not exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = 'public.processed_emails'::pg_catalog.regclass
        and a.attname in (
          'reserved_at', 'reservation_expires_at',
          'drive_write_started_at', 'completed_at'
        )
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and not a.attnotnull and not a.atthasdef
      group by a.attrelid
      having pg_catalog.count(*) = 4
    ) then
    raise exception 'processed email reservation columns drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index x
    join pg_catalog.pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'public.processed_emails'::pg_catalog.regclass
      and i.relname = 'processed_emails_reservation_state_idx'
      and x.indisvalid and x.indisready and x.indislive
      and not x.indisunique and not x.indisprimary
      and pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_indexdef(x.indexrelid)),
        '[[:space:]]', '', 'g'
      ) = 'createindexprocessed_emails_reservation_state_idxonpublic.processed_emailsusingbtree(processing_status,reservation_expires_at)'
  ) then
    raise exception 'processed email reservation index drifted';
  end if;

  select pg_catalog.count(*)
  into v_status_constraint_count
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
    and c.contype = 'c';

  if v_status_constraint_count <> 4
    or (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
        and c.contype = 'c'
        and c.convalidated
        and c.conname in (
          'processed_emails_processing_status_check',
          'processed_emails_reservation_hash_check',
          'processed_emails_byte_accounting_check',
          'processed_emails_processing_shape_check'
        )
    ) <> 4 then
    raise exception 'processed email reservation CHECK constraint set drifted';
  end if;

  select pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.pg_get_expr(c.conbin, c.conrelid, true)),
      '::text', '', 'g'
    ),
    '[()[:space:]]', '', 'g'
  )
  into v_status_expression
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
    and c.conname = 'processed_emails_processing_status_check'
    and c.contype = 'c'
    and c.convalidated;

  if v_status_expression is distinct from
      'processing_status=anyarray[''reserved'',''completed'',''released'',''outcome_unknown'']' then
    raise exception 'processed email reservation status CHECK drifted';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
      and c.conname = 'processed_emails_reservation_hash_check'
      and pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.lower(pg_catalog.pg_get_expr(c.conbin, c.conrelid, true)),
          '::text', '', 'g'
        ), '[()[:space:]]', '', 'g'
      ) = 'reservation_id_hashisnullorreservation_id_hash~''^[0-9a-f]{64}$'''
  )
    or not exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
        and c.conname = 'processed_emails_byte_accounting_check'
        and pg_catalog.regexp_replace(
          pg_catalog.lower(pg_catalog.pg_get_expr(c.conbin, c.conrelid, true)),
          '[()[:space:]]', '', 'g'
        ) = 'reserved_bytes>=0andwritten_bytes>=0andwritten_bytes<=reserved_bytes'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.processed_emails'::pg_catalog.regclass
        and c.conname = 'processed_emails_processing_shape_check'
        and pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.pg_get_expr(c.conbin, c.conrelid, true)),
            '::text', '', 'g'
          ), '[()[:space:]]', '', 'g'
        ) = 'processing_status=''completed''andcompleted_atisnotnullandreservation_run_idisnullandreservation_id_hashisnullandreservation_expires_atisnullanddrive_write_started_atisnullandwritten_bytes=reserved_bytesorprocessing_status=''reserved''andcompleted_atisnullandreservation_run_idisnotnullandreservation_id_hashisnotnullandreserved_atisnotnullandreservation_expires_at>reserved_atandwritten_bytes=0orprocessing_status=''released''andcompleted_atisnullandreservation_run_idisnullandreservation_id_hashisnullandreserved_atisnullandreservation_expires_atisnullanddrive_write_started_atisnullandreserved_bytes=0andwritten_bytes=0orprocessing_status=''outcome_unknown''andcompleted_atisnullandreservation_run_idisnotnullandreservation_id_hashisnotnullandreserved_atisnotnullandreservation_expires_at>reserved_atanddrive_write_started_atisnotnullandwritten_bytes=0'
    ) then
    raise exception 'processed email reservation CHECK constraint fingerprint drifted';
  end if;

  for v_function_index in 1..4 loop
    v_function_oid := pg_catalog.to_regprocedure(v_function_signatures[v_function_index]);
    select pg_catalog.pg_get_userbyid(p.proowner) as owner,
      l.lanname as language, p.prokind, p.provolatile, p.prosecdef,
      p.proisstrict, p.proleakproof, p.proparallel, p.proconfig, p.proacl,
      pg_catalog.pg_get_function_result(p.oid) as function_result,
      pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')) as source_hash
    into v_function_row
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = v_function_oid;

    if v_function_oid is null
      or v_function_row.owner <> 'postgres'
      or v_function_row.language <> 'plpgsql'
      or v_function_row.prokind <> 'f'
      or v_function_row.provolatile <> 'v'
      or not v_function_row.prosecdef
      or v_function_row.proisstrict
      or v_function_row.proleakproof
      or v_function_row.proparallel <> 'u'
      or v_function_row.proconfig is distinct from array['search_path=""']::text[]
      or v_function_row.function_result <> v_function_results[v_function_index]
      or v_function_row.source_hash <> v_function_source_hashes[v_function_index]
      or v_function_row.proacl is null
      or (
        select pg_catalog.count(*)
        from pg_catalog.aclexplode(v_function_row.proacl)
      ) <> 2
      or exists (
        select 1
        from pg_catalog.aclexplode(v_function_row.proacl) acl
        where acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantor <> pg_catalog.to_regrole('postgres')
          or acl.grantee not in (
            pg_catalog.to_regrole('postgres'),
            pg_catalog.to_regrole('service_role')
          )
      )
      or not pg_catalog.has_function_privilege('service_role', v_function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', v_function_oid, 'EXECUTE') then
      raise exception 'processed email reservation RPC identity, metadata, body, or ACL drifted';
    end if;
  end loop;
end
$processed_email_reservation_replay_verification$;

commit;
