\set ON_ERROR_STOP off
\set QUIET on
\pset pager off
\set QUIET off
\set ECHO none
\set ECHO_HIDDEN off
\set VERBOSITY terse
\set SHOW_CONTEXT never
\unset newpw
\unset SHELL_ERROR
\unset alter_error
\unset alter_sqlstate
\unset rot_ci
\unset rot_pooled
\unset rot_host_ok
\unset rot_conn_ok
\unset rot_gate_ok
\unset rot_tu
\ir rot_settings.sql
\ir rot_gate.sql
\if :{?rot_gate_ok}
\else
  \set rot_gate_ok false
\endif
\if :rot_gate_ok
\echo 'ROT GATE: PASS - pinned direct host, admin identity, database, version, logging settings, role baseline'
\if :{?fifo}
  \set newpw `/usr/bin/awk 'NR==1 && length($0)==40 && $0 !~ /[^A-Za-z0-9]/ {v=$0} END {if (NR==1 && v!="") {print v; exit 0} else exit 1}' :'fifo'`
  \if :{?SHELL_ERROR}
    \if :SHELL_ERROR
      \echo 'ROT RESULT: NOT RECEIVED - nothing changed'
    \elif :{?newpw}
      \echo 'ROT RESULT: password received from the keychain feeder - validating only (no ALTER)'
      \ir rot_validate_core.sql
    \else
      \echo 'ROT RESULT: NO PASSWORD VARIABLE - nothing changed'
    \endif
  \else
    \echo 'ROT RESULT: NO SHELL_ERROR - nothing changed'
  \endif
\else
  \echo 'ROT RESULT: NO FIFO PATH SET - nothing changed'
\endif
\else
  \echo 'ROT GATE: STOP - pre-ALTER gate failed; nothing read, nothing changed'
\endif
\unset newpw
\unset rot_ci
\unset fifo
\unset alter_error
\unset alter_sqlstate
\echo 'ROT END: secrets cleared'
