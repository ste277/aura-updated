\ir b4_assert_common.sql
DO $b4post$
DECLARE
  r oid := (SELECT oid FROM pg_roles WHERE rolname = current_setting('b4.role'));
  o oid := (SELECT oid FROM pg_roles WHERE rolname = current_setting('b4.owner'));
  db oid := (SELECT oid FROM pg_database WHERE datname = current_database());
  apps text[]; t text[]; e text[];
BEGIN
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO apps
    FROM unnest(current_setting('b4.tables')::text[]) x WHERE x <> '_prisma_migrations';

  -- POST-1 shared dependencies on the role: only ACL entries, only in this database, exactly
  --        one per app table + schema public + two default-ACL rows; nothing else anywhere
  IF EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = r
               AND (deptype <> 'a' OR dbid <> db)) THEN
    RAISE EXCEPTION 'B4 STOP: POST-1a unexpected dependency kind or database'; END IF;
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO t FROM (
    SELECT CASE s.classid
             WHEN 'pg_class'::regclass THEN 'rel:' || (SELECT c.relname FROM pg_class c WHERE c.oid = s.objid AND c.relnamespace = 'public'::regnamespace)
             WHEN 'pg_namespace'::regclass THEN 'nsp:' || (SELECT n.nspname FROM pg_namespace n WHERE n.oid = s.objid)
             WHEN 'pg_default_acl'::regclass THEN 'defacl:' || (SELECT d.defaclrole::regrole || '/' || d.defaclnamespace::regnamespace || '/' || d.defaclobjtype::text
                                                               FROM pg_default_acl d WHERE d.oid = s.objid)
             ELSE 'other:' || s.classid::regclass::text END AS x
    FROM pg_shdepend s WHERE s.refclassid = 'pg_authid'::regclass AND s.refobjid = r AND s.dbid = db) q;
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO e FROM (
    SELECT 'rel:' || a AS x FROM unnest(apps) a
    UNION ALL SELECT 'nsp:public'
    UNION ALL SELECT 'defacl:' || current_setting('b4.owner') || '/public/r'
    UNION ALL SELECT 'defacl:' || current_setting('b4.owner') || '/public/S') q;
  IF t IS DISTINCT FROM e THEN RAISE EXCEPTION 'B4 STOP: POST-1b ACL dependency set differs'; END IF;

  -- POST-2 direct ACL on each app table: exactly SELECT, INSERT, UPDATE, DELETE; grantor owner; not grantable
  IF EXISTS (
    SELECT 1 FROM unnest(apps) a
    WHERE (SELECT coalesce(array_agg(x.privilege_type::text ORDER BY x.privilege_type::text COLLATE "C"), '{}')
             FROM pg_class c, aclexplode(c.relacl) x
            WHERE c.relnamespace = 'public'::regnamespace AND c.relname = a AND x.grantee = r
              AND x.grantor = o AND NOT x.is_grantable)
          IS DISTINCT FROM '{DELETE,INSERT,SELECT,UPDATE}'::text[]
       OR (SELECT count(*) FROM pg_class c, aclexplode(c.relacl) x
            WHERE c.relnamespace = 'public'::regnamespace AND c.relname = a AND x.grantee = r) <> 4) THEN
    RAISE EXCEPTION 'B4 STOP: POST-2a app-table direct ACL not exact'; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute t2 JOIN pg_class c ON c.oid = t2.attrelid, aclexplode(t2.attacl) x
             WHERE c.relnamespace = 'public'::regnamespace AND x.grantee = r) THEN
    RAISE EXCEPTION 'B4 STOP: POST-2b column-level ACL for role'; END IF;

  -- POST-3 effective privileges: S/I/U/D on every app table and nothing more; nothing on _prisma_migrations
  IF EXISTS (SELECT 1 FROM unnest(apps) a JOIN pg_class c ON c.relname = a AND c.relnamespace = 'public'::regnamespace
             WHERE NOT (has_table_privilege(r, c.oid, 'SELECT') AND has_table_privilege(r, c.oid, 'INSERT')
                        AND has_table_privilege(r, c.oid, 'UPDATE') AND has_table_privilege(r, c.oid, 'DELETE'))
                OR has_table_privilege(r, c.oid, 'TRUNCATE,REFERENCES,TRIGGER')) THEN
    RAISE EXCEPTION 'B4 STOP: POST-3a app-table effective privileges'; END IF;
  IF has_table_privilege(r, 'public."_prisma_migrations"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_any_column_privilege(r, 'public."_prisma_migrations"', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'B4 STOP: POST-3b _prisma_migrations reachable'; END IF;
  IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
        AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) <> cardinality(apps) THEN
    RAISE EXCEPTION 'B4 STOP: POST-3c reachable relation count differs'; END IF;

  -- POST-4 schema public: direct USAGE only, not grantable, granted by the schema owner
  IF (SELECT coalesce(array_agg(x.privilege_type::text || ':' || x.is_grantable::text || ':' || (x.grantor = n.nspowner)::text), '{}')
        FROM pg_namespace n, aclexplode(n.nspacl) x WHERE n.nspname = 'public' AND x.grantee = r)
     IS DISTINCT FROM '{USAGE:false:true}'::text[] THEN
    RAISE EXCEPTION 'B4 STOP: POST-4 schema public ACL for role'; END IF;

  -- POST-5 default ACLs: baseline plus exactly the six new rows
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO t FROM (
    SELECT format('%s|%s|%s|%s|%s', d.defaclrole::regrole, d.defaclnamespace::regnamespace, d.defaclobjtype,
                  CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END, a.privilege_type) AS x
    FROM pg_default_acl d, aclexplode(d.defaclacl) a) s;
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO e FROM (
    SELECT x FROM unnest(current_setting('b4.defacl')::text[]) x
    UNION ALL SELECT format('%s|public|r|%s|%s', current_setting('b4.owner'), current_setting('b4.role'), p)
      FROM unnest('{SELECT,INSERT,UPDATE,DELETE}'::text[]) p
    UNION ALL SELECT format('%s|public|S|%s|%s', current_setting('b4.owner'), current_setting('b4.role'), p)
      FROM unnest('{USAGE,SELECT}'::text[]) p) q;
  IF t IS DISTINCT FROM e THEN RAISE EXCEPTION 'B4 STOP: POST-5 default ACLs not baseline plus six'; END IF;
  PERFORM set_config('b4.post_ok', '1', true);
END
$b4post$;
\if :ERROR
\else
\echo 'B4 POST-GRANT STATE: PASS'
\endif
