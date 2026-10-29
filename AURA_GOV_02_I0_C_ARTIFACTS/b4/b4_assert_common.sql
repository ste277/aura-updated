DO $b4common$
DECLARE
  v_role  text := current_setting('b4.role');
  v_owner text := current_setting('b4.owner');
  r oid; o oid; t text[]; e text[];
BEGIN
  SELECT oid INTO r FROM pg_roles WHERE rolname = v_role;
  SELECT oid INTO o FROM pg_roles WHERE rolname = v_owner;
  IF r IS NULL OR o IS NULL THEN RAISE EXCEPTION 'B4 STOP: C-0 role or owner missing'; END IF;

  -- C-1 identity: admin session, exact database, exact server version, primary, direct (non-pooler) host
  IF NOT (session_user = v_owner AND current_user = v_owner
          AND current_database() = current_setting('b4.db')
          AND current_setting('server_version_num') = current_setting('b4.vnum')
          AND NOT pg_is_in_recovery()
          AND current_setting('b4.host') ~ current_setting('b4.host_re')
          AND current_setting('b4.host') !~ '-pooler') THEN
    RAISE EXCEPTION 'B4 STOP: C-1 identity'; END IF;

  -- C-2 role attributes exact (B3 baseline)
  IF (SELECT count(*) FROM pg_roles WHERE oid = r AND NOT rolsuper AND rolinherit AND NOT rolcreaterole
        AND NOT rolcreatedb AND rolcanlogin AND NOT rolreplication AND NOT rolbypassrls
        AND rolconnlimit = -1 AND rolvaliduntil IS NULL AND rolconfig IS NULL) <> 1 THEN
    RAISE EXCEPTION 'B4 STOP: C-2 role attributes'; END IF;

  -- C-3 no outgoing membership (direct or indirect, incl. predefined roles such as pg_maintain)
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r)
     OR EXISTS (SELECT 1 FROM pg_roles x WHERE x.oid <> r AND pg_has_role(r, x.oid, 'MEMBER')) THEN
    RAISE EXCEPTION 'B4 STOP: C-3 outgoing membership'; END IF;

  -- C-4 incoming membership: exactly the approved PG16+ creator row; reverse options; self-grant setting
  IF (SELECT count(*) FROM pg_auth_members WHERE roleid = r) <> 1
     OR (SELECT count(*) FROM pg_auth_members WHERE roleid = r AND member = o AND admin_option
           AND NOT inherit_option AND NOT set_option AND grantor = 10) <> 1
     OR NOT pg_has_role(o, r, 'MEMBER') OR pg_has_role(o, r, 'USAGE') OR pg_has_role(o, r, 'SET')
     OR current_setting('createrole_self_grant') <> '' THEN
    RAISE EXCEPTION 'B4 STOP: C-4 incoming membership'; END IF;

  -- C-5 ownership: the role owns nothing in any database (shared dependency catalog)
  IF EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = r AND deptype = 'o') THEN
    RAISE EXCEPTION 'B4 STOP: C-5 ownership'; END IF;

  -- C-6 object inventory in schema public
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C"), '{}') INTO t
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p');
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO e FROM unnest(current_setting('b4.tables')::text[]) x;
  IF t IS DISTINCT FROM e THEN RAISE EXCEPTION 'B4 STOP: C-6a table inventory differs'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
               AND ((c.relkind IN ('r','p') AND c.relowner <> o) OR c.relkind IN ('S','v','m','f','c') OR c.relispartition)) THEN
    RAISE EXCEPTION 'B4 STOP: C-6b table owner or unexpected relation kind'; END IF;
  SELECT coalesce(array_agg(y.typname::text ORDER BY y.typname::text COLLATE "C"), '{}') INTO t
    FROM pg_type y WHERE y.typnamespace = 'public'::regnamespace AND y.typtype = 'e';
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO e FROM unnest(current_setting('b4.enums')::text[]) x;
  IF t IS DISTINCT FROM e
     OR EXISTS (SELECT 1 FROM pg_type y WHERE y.typnamespace = 'public'::regnamespace AND y.typtype = 'e' AND y.typowner <> o)
     OR EXISTS (SELECT 1 FROM pg_type y WHERE y.typnamespace = 'public'::regnamespace
                  AND (y.typtype IN ('d','r','m') OR (y.typtype = 'b' AND y.typcategory <> 'A'))) THEN
    RAISE EXCEPTION 'B4 STOP: C-6c type inventory'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'B4 STOP: C-6d routines in public'; END IF;

  -- C-7 PUBLIC privileges unchanged: none on public relations (incl. PG17 MAINTAIN) or columns;
  --     schema public = USAGE only; database = CONNECT, TEMPORARY only; no PUBLIC default ACL
  IF EXISTS (SELECT 1 FROM pg_class c,
               aclexplode(coalesce(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 's' ELSE 'r' END)::"char", c.relowner))) a
             WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_attribute t2 JOIN pg_class c ON c.oid = t2.attrelid, aclexplode(t2.attacl) a
                WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = 0) THEN
    RAISE EXCEPTION 'B4 STOP: C-7a PUBLIC relation or column privilege'; END IF;
  IF (SELECT coalesce(array_agg(a.privilege_type::text ORDER BY a.privilege_type::text COLLATE "C"), '{}')
        FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
       WHERE n.nspname = 'public' AND a.grantee = 0) IS DISTINCT FROM '{USAGE}'::text[] THEN
    RAISE EXCEPTION 'B4 STOP: C-7b PUBLIC schema privileges'; END IF;
  IF (SELECT coalesce(array_agg(a.privilege_type::text ORDER BY a.privilege_type::text COLLATE "C"), '{}')
        FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
       WHERE d.datname = current_database() AND a.grantee = 0) IS DISTINCT FROM '{CONNECT,TEMPORARY}'::text[] THEN
    RAISE EXCEPTION 'B4 STOP: C-7c PUBLIC database privileges'; END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'B4 STOP: C-7d PUBLIC default ACL'; END IF;

  -- C-8 runtime prerequisites that come from PUBLIC defaults (must hold before and after)
  IF NOT (has_database_privilege(r, current_database(), 'CONNECT')
          AND NOT has_database_privilege(r, current_database(), 'CREATE')
          AND has_schema_privilege(r, 'public', 'USAGE')
          AND NOT has_schema_privilege(r, 'public', 'CREATE')
          AND has_function_privilege(r, 'pg_advisory_xact_lock(bigint)', 'EXECUTE')
          AND has_function_privilege(r, 'hashtext(text)', 'EXECUTE')
          AND has_function_privilege(r, 'now()', 'EXECUTE')
          AND has_function_privilege(r, 'clock_timestamp()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'B4 STOP: C-8a database, schema or function prerequisites'; END IF;
  IF EXISTS (SELECT 1 FROM pg_type y WHERE y.typnamespace = 'public'::regnamespace AND y.typtype = 'e'
               AND NOT has_type_privilege(r, y.oid, 'USAGE')) THEN
    RAISE EXCEPTION 'B4 STOP: C-8b enum USAGE'; END IF;

  -- C-9 isolation: no access to neon_auth; no executable SECURITY DEFINER routine outside system schemas
  IF EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'neon_auth' AND has_schema_privilege(r, n.oid, 'USAGE')) THEN
    RAISE EXCEPTION 'B4 STOP: C-9a neon_auth access'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
               AND has_schema_privilege(r, n.oid, 'USAGE')
               AND has_function_privilege(r, p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'B4 STOP: C-9b executable SECURITY DEFINER routine'; END IF;

  -- C-10 no relation outside schema public is reachable (any privilege, any non-system schema)
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname NOT IN ('pg_catalog','information_schema','public')
               AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp%'
               AND c.relkind IN ('r','p','v','m','f','S')
               AND (has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    OR (c.relkind <> 'S' AND has_any_column_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))) THEN
    RAISE EXCEPTION 'B4 STOP: C-10 relation outside public reachable'; END IF;

  -- C-11 PG17-native MAINTAIN check on every non-system relation (nested IF: never planned on PG16)
  IF current_setting('server_version_num')::int >= 170000 THEN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg\_toast%'
                 AND c.relkind IN ('r','p','v','m','f','S') AND has_table_privilege(r, c.oid, 'MAINTAIN')) THEN
      RAISE EXCEPTION 'B4 STOP: C-11 MAINTAIN reachable'; END IF;
  END IF;

  -- C-12 the admin session can actually perform the grants: owns the database, can grant on schema public
  IF (SELECT datdba FROM pg_database WHERE datname = current_database()) <> o
     OR NOT has_schema_privilege(o, 'public', 'USAGE WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'B4 STOP: C-12 admin cannot grant on schema public'; END IF;

  PERFORM set_config('b4.common_ok', '1', true);
END
$b4common$;
\if :ERROR
\else
\echo 'B4 COMMON ASSERTIONS: PASS'
\endif
