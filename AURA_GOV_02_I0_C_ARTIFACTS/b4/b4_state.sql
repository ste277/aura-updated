-- Read-only state classifier: NOT_APPLIED (exact B3 baseline) / APPLIED (exact post-B4) / INCONSISTENT.
-- Classification uses positive evidence flags set only at the end of each passing assertion block.
\set ON_ERROR_STOP off
\set b4_pre_ok false
\set b4_post_ok false
\ir b4_settings.sql
SET default_transaction_read_only = on;
\conninfo
BEGIN TRANSACTION READ ONLY;
\ir b4_assert_pre.sql
SELECT coalesce(current_setting('b4.common_ok', true) = '1' AND current_setting('b4.pre_ok', true) = '1', false) AS b4_pre_ok \gset
ROLLBACK;
BEGIN TRANSACTION READ ONLY;
\ir b4_assert_post.sql
SELECT coalesce(current_setting('b4.common_ok', true) = '1' AND current_setting('b4.post_ok', true) = '1', false) AS b4_post_ok \gset
ROLLBACK;
\if :b4_pre_ok
  \if :b4_post_ok
    \echo 'B4 STATE: INCONSISTENT - both checks passed; STOP'
  \else
    \echo 'B4 STATE: NOT_APPLIED - exact B3 baseline'
  \endif
\else
  \if :b4_post_ok
    \echo 'B4 STATE: APPLIED - exact post-B4 state'
  \else
    \echo 'B4 STATE: INCONSISTENT - neither baseline nor applied; STOP'
  \endif
\endif
\echo 'B4 STATE END'
