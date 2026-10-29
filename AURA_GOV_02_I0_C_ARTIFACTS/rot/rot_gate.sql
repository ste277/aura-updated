SELECT (:'HOST' = :'rot_direct_host' AND :'HOST' !~ '-pooler'
        AND current_user = :'rot_admin' AND session_user = :'rot_admin' AND current_database() = :'rot_db'
        AND current_setting('server_version_num') = :'rot_vnum' AND NOT pg_is_in_recovery()
        AND current_setting('log_statement') NOT IN ('ddl','mod','all')
        AND current_setting('log_min_duration_statement') = '-1'
        AND current_setting('log_min_error_statement') = 'panic'
        AND (SELECT count(*) FROM pg_roles WHERE rolname = :'rot_role' AND NOT rolsuper AND rolinherit AND NOT rolcreaterole
               AND NOT rolcreatedb AND rolcanlogin AND NOT rolreplication AND NOT rolbypassrls AND rolconnlimit = -1
               AND rolvaliduntil IS NULL AND rolconfig IS NULL) = 1
        AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE r.rolname = :'rot_role') = 1
        AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles a ON a.oid = m.member
              WHERE r.rolname = :'rot_role' AND a.rolname = :'rot_admin' AND m.admin_option AND NOT m.inherit_option
                AND NOT m.set_option AND m.grantor = 10) = 1
        AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = :'rot_role') = 0
       ) AS rot_gate_ok \gset
DO $rottu$ BEGIN PERFORM set_config('pg_stat_statements.track_utility', 'off', false);
EXCEPTION WHEN OTHERS THEN NULL; END $rottu$;
SELECT coalesce(current_setting('pg_stat_statements.track_utility', true), 'not-loaded') AS rot_tu \gset
\echo 'ROT TRACK_UTILITY (session, best effort):' :rot_tu
