\set exp_role 'aura_app_2026_11'
\set exp_owner 'neondb_owner'
\set exp_db 'neondb'
\set exp_vnum 170011
\set exp_host_re '^ep-[a-z0-9-]+-pooler[.][a-z0-9.-]+[.]aws[.]neon[.]tech$'
\set exp_tables 25
\set ON_ERROR_STOP on
\pset pager off
\set ECHO none
\set ECHO_HIDDEN off
\set VERBOSITY terse
\set SHOW_CONTEXT never
\unset b3_ok
\conninfo
\echo 'B3 HOST CHECK (client side):'
SELECT (:'HOST' ~ :'exp_host_re') AS host_is_pooler;
BEGIN TRANSACTION READ ONLY;
\echo 'B3-1 identity:'
SELECT session_user, current_user, current_database() AS db,
       current_setting('server_version') AS server_version,
       current_setting('transaction_read_only') AS tx_read_only;
\echo 'B3-2 role attributes (expect f t f f t f f -1 NULL NULL):'
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls,
       rolconnlimit, rolvaliduntil, rolconfig FROM pg_roles WHERE rolname = current_user;
\echo 'B3-3 outgoing memberships (expect 0 rows):'
SELECT r.rolname FROM pg_roles r WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER');
\echo 'B3-4 incoming memberships (expect exactly 1 row: owner t f f t):'
SELECT m.member::regrole AS member, m.admin_option, m.inherit_option, m.set_option, (m.grantor = 10) AS grantor_is_bootstrap
FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = current_user;
\echo 'B3-5 ownership (expect 0 0 0 0):'
SELECT (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = current_user) AS rel,
       (SELECT count(*) FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = current_user) AS nsp,
       (SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = current_user) AS proc,
       (SELECT count(*) FROM pg_type t JOIN pg_roles r ON r.oid = t.typowner WHERE r.rolname = current_user) AS typ;
\echo 'B3-6 effective privileges before B4 (expect tables/columns/sequences 0, schema_create f, db_create f):'
SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) AS public_tables,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
           AND has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS tables_any_priv,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
           AND has_any_column_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')) AS tables_any_column_priv,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'S'
           AND has_sequence_privilege(current_user, c.oid, 'USAGE,SELECT,UPDATE')) AS sequences_any_priv,
       has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
       has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
       has_database_privilege(current_user, current_database(), 'CONNECT') AS db_connect,
       has_database_privilege(current_user, current_database(), 'CREATE') AS db_create,
       has_database_privilege(current_user, current_database(), 'TEMP') AS db_temp;
\echo 'B3-6b direct ACL entries for this role in any catalog (expect 0):'
SELECT (SELECT (SELECT count(*) FROM pg_class x, aclexplode(x.relacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_attribute x, aclexplode(x.attacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_namespace x, aclexplode(x.nspacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_proc x, aclexplode(x.proacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_type x, aclexplode(x.typacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_default_acl x, aclexplode(x.defaclacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_database x, aclexplode(x.datacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_language x, aclexplode(x.lanacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_tablespace x, aclexplode(x.spcacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_foreign_data_wrapper x, aclexplode(x.fdwacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_foreign_server x, aclexplode(x.srvacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_largeobject_metadata x, aclexplode(x.lomacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_parameter_acl x, aclexplode(x.paracl) a WHERE a.grantee = r.oid)
       FROM pg_roles r WHERE r.rolname = current_user) AS direct_acl_entries;
\echo 'B3-7 verdict inputs:'
SELECT (
  :'HOST' ~ :'exp_host_re'
  AND session_user = :'exp_role' AND current_user = :'exp_role'
  AND current_database() = :'exp_db'
  AND current_setting('server_version_num')::int = :exp_vnum
  AND current_setting('transaction_read_only') = 'on'
  AND (SELECT count(*) FROM pg_roles WHERE rolname = current_user
         AND NOT rolsuper AND rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND rolcanlogin
         AND NOT rolreplication AND NOT rolbypassrls AND rolconnlimit = -1
         AND rolvaliduntil IS NULL AND rolconfig IS NULL) = 1
  AND (SELECT count(*) FROM pg_roles r WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER')) = 0
  AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = current_user) = 1
  AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = current_user
         AND m.member::regrole::text = :'exp_owner' AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
         AND m.grantor = 10) = 1
  AND (SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = current_user) = 0
  AND (SELECT count(*) FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = current_user) = 0
  AND (SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = current_user) = 0
  AND (SELECT count(*) FROM pg_type t JOIN pg_roles r ON r.oid = t.typowner WHERE r.rolname = current_user) = 0
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
          AND (has_table_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               OR has_any_column_privilege(current_user, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))) = 0
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'
          AND has_sequence_privilege(current_user, c.oid, 'USAGE,SELECT,UPDATE')) = 0
  AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
  AND NOT has_database_privilege(current_user, current_database(), 'CREATE')
  AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p')) = :exp_tables
  AND (SELECT (SELECT count(*) FROM pg_class x, aclexplode(x.relacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_attribute x, aclexplode(x.attacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_namespace x, aclexplode(x.nspacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_proc x, aclexplode(x.proacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_type x, aclexplode(x.typacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_default_acl x, aclexplode(x.defaclacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_database x, aclexplode(x.datacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_language x, aclexplode(x.lanacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_tablespace x, aclexplode(x.spcacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_foreign_data_wrapper x, aclexplode(x.fdwacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_foreign_server x, aclexplode(x.srvacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_largeobject_metadata x, aclexplode(x.lomacl) a WHERE a.grantee = r.oid)
            + (SELECT count(*) FROM pg_parameter_acl x, aclexplode(x.paracl) a WHERE a.grantee = r.oid)
       FROM pg_roles r WHERE r.rolname = current_user) = 0
) AS b3_ok \gset
ROLLBACK;
\if :{?b3_ok}
  \if :b3_ok
    \echo 'B3 RESULT: PASS - login, identity, attributes, memberships, ownership, table count and pre-B4 privileges match'
  \else
    \echo 'B3 RESULT: STOP - at least one check differs; send the B3-1..B3-6b output'
  \endif
\else
  \echo 'B3 RESULT: STOP - verdict not computed'
\endif
\unset b3_ok
\echo 'B3 END'
