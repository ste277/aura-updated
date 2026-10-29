\set ON_ERROR_STOP off
\pset pager off
\set ECHO none
\set ECHO_HIDDEN off
\set VERBOSITY terse
\set SHOW_CONTEXT never
\unset newpw
\unset SHELL_ERROR
\unset alter_error
\unset alter_sqlstate
\if :{?fifo}
  \set newpw `/usr/bin/awk 'NR==1 && length($0)==40 && $0 !~ /[^A-Za-z0-9]/ {v=$0} END {if (NR==1 && v!="") {print v; exit 0} else exit 1}' :'fifo'`
  \if :{?SHELL_ERROR}
    \if :SHELL_ERROR
      \echo 'APPLY RESULT: NOT RECEIVED - nothing changed'
    \elif :{?newpw}
      ALTER ROLE aura_app_2026_11 WITH PASSWORD :'newpw';
      \set alter_error :ERROR
      \set alter_sqlstate :SQLSTATE
      \unset newpw
      SELECT 1 AS overwrite_activity;
      \if :alter_error
        \echo 'APPLY RESULT: ALTER FAILED - password NOT changed - SQLSTATE' :alter_sqlstate
      \else
        \echo 'APPLY RESULT: ALTER SUCCEEDED - SQLSTATE' :alter_sqlstate '- confirm no NOTICE above'
      \endif
    \else
      \echo 'APPLY RESULT: NO PASSWORD VARIABLE - nothing changed'
    \endif
  \else
    \echo 'APPLY RESULT: NO SHELL_ERROR - nothing changed'
  \endif
\else
  \echo 'APPLY RESULT: NO FIFO PATH SET - nothing changed'
\endif
\unset newpw
\unset fifo
\unset alter_error
\unset alter_sqlstate
\echo 'APPLY END: newpw cleared'
