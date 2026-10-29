\ir b4_assert_common.sql
DO $b4pre$
DECLARE
  r oid := (SELECT oid FROM pg_roles WHERE rolname = current_setting('b4.role'));
  t text[]; e text[];
BEGIN
  -- PRE-1 no ACL/policy dependency on the role anywhere (no direct grant of any kind, any database)
  IF EXISTS (SELECT 1 FROM pg_shdepend WHERE refclassid = 'pg_authid'::regclass AND refobjid = r) THEN
    RAISE EXCEPTION 'B4 STOP: PRE-1 role already referenced by an ACL, policy or ownership'; END IF;

  -- PRE-2 no default ACL names the role; default ACLs exactly the recorded baseline
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO t FROM (
    SELECT format('%s|%s|%s|%s|%s', d.defaclrole::regrole, d.defaclnamespace::regnamespace, d.defaclobjtype,
                  CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END, a.privilege_type) AS x
    FROM pg_default_acl d, aclexplode(d.defaclacl) a) s;
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO e FROM unnest(current_setting('b4.defacl')::text[]) x;
  IF t IS DISTINCT FROM e THEN RAISE EXCEPTION 'B4 STOP: PRE-2 default ACLs differ from baseline'; END IF;

  -- PRE-3 no privilege on any public relation, column or sequence (MAINTAIN covered by C-3, C-7a and PRE-1)
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f','S')
               AND (has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    OR (c.relkind <> 'S' AND has_any_column_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')))) THEN
    RAISE EXCEPTION 'B4 STOP: PRE-3 role already has a relation privilege'; END IF;
  PERFORM set_config('b4.pre_ok', '1', true);
END
$b4pre$;
\if :ERROR
\else
\echo 'B4 PRE-GRANT BASELINE: PASS'
\endif
