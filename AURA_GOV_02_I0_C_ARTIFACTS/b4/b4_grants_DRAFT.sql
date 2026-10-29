-- DRAFT: NOT AUTHORIZED FOR EXECUTION. Requires separate owner authorization.
\set ON_ERROR_STOP on
\ir b4_settings.sql
\conninfo
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
DO $b4rw$ BEGIN IF current_setting('transaction_read_only') <> 'off' THEN RAISE EXCEPTION 'B4 STOP: transaction is read-only'; END IF; END $b4rw$;
\echo 'B4 PHASE 1: pre-grant baseline (inside the transaction)'
\ir b4_assert_pre.sql
\echo 'B4 PHASE 2: approved grant set (section 11.5a, identifiers bound from b4_settings.sql)'
\set ECHO queries
GRANT USAGE ON SCHEMA public TO :"exp_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"exp_role";
REVOKE ALL ON public."_prisma_migrations" FROM :"exp_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"exp_owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"exp_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"exp_owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"exp_role";
\set ECHO none
\echo 'B4 PHASE 3: post-grant assertions (before COMMIT)'
\ir b4_assert_post.sql
\echo 'B4 PHASE 4: all assertions passed; committing (irreversible without compensating REVOKE)'
COMMIT;
\echo 'B4 PHASE 5: re-verifying committed state in a new read-only transaction'
BEGIN TRANSACTION READ ONLY;
\ir b4_assert_post.sql
ROLLBACK;
\echo 'B4 RESULT: COMMITTED AND VERIFIED'
