-- DRAFT: compensating action after a committed B4. NOT AUTHORIZED; requires separate owner authorization.
\set ON_ERROR_STOP on
\ir b4_settings.sql
\conninfo
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '120s';
\echo 'B4-R PHASE 1: identity and invariants'
\ir b4_assert_common.sql
\echo 'B4-R PHASE 2: compensating revokes'
\set ECHO queries
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"exp_role";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :"exp_role";
REVOKE ALL ON SCHEMA public FROM :"exp_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"exp_owner" IN SCHEMA public REVOKE ALL ON TABLES FROM :"exp_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"exp_owner" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM :"exp_role";
\set ECHO none
\echo 'B4-R PHASE 3: assert exact B3 baseline restored (before COMMIT)'
\ir b4_assert_pre.sql
COMMIT;
\echo 'B4-R RESULT: REVOKED AND BASELINE VERIFIED'
