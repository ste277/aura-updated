SELECT regexp_replace(:'HOST', :'rot_pool_from', :'rot_pool_to') AS rot_pooled,
       (:'HOST' = :'rot_direct_host' AND :'HOST' !~ '-pooler' AND current_user = :'rot_admin') AS rot_host_ok \gset
\if :{?rot_host_ok}
  \if :rot_host_ok
    \set rot_ci 'host=' :rot_pooled ' dbname=' :rot_db ' user=' :rot_role ' ' :rot_tls ' password=' :newpw
    \unset newpw
    \echo 'ROT VALIDATE: connecting as the application role through the pooler (verified TLS, channel binding)'
    \connect :rot_ci
    \unset rot_ci
    SELECT (current_user = :'rot_role' AND session_user = :'rot_role') AS rot_conn_ok \gset
    \if :{?rot_conn_ok}
      \if :rot_conn_ok
        \echo 'ROT VALIDATE: pooled login as the application role SUCCEEDED - running B3 checks'
        \ir :rot_checks
      \else
        \echo 'ROT VALIDATE: FAILED - connected as an unexpected role; STOP'
      \endif
    \else
      \echo 'ROT VALIDATE: FAILED - pooled login did not succeed; STOP'
    \endif
  \else
    \echo 'ROT VALIDATE: NOT ATTEMPTED - admin session is not the direct Neon host as neondb_owner; STOP'
  \endif
\else
  \echo 'ROT VALIDATE: NOT ATTEMPTED - host check failed; STOP'
\endif
\unset newpw
\unset rot_ci
