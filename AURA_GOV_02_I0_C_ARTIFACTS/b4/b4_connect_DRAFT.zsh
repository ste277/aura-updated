( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  D='<DIRECT-HOST>'
  MODE='state'
  W="$HOME/aura-b4"
  [[ -n $D && -z ${D//[a-z0-9.-]/} && $D != *..* && $D != *.-* && $D != *-.* && $D =~ '^ep-[a-z0-9-]+\.[a-z0-9.-]+\.aws\.neon\.tech$' && $D != *-pooler.* ]] || { echo 'B4 GUARD: DIRECT HOST INVALID - not connecting'; exit 1; }
  [[ $MODE == state || $MODE == grants ]] || { echo 'B4 GUARD: MODE INVALID - not connecting'; exit 1; }
  cd "$W" 2>/dev/null || { echo 'B4 GUARD: FILE DIRECTORY MISSING - not connecting'; exit 1; }
  /usr/bin/shasum -a 256 -c >/dev/null 2>&1 <<'HASHES' || { echo 'B4 GUARD: FILE HASH MISMATCH - not connecting'; exit 1; }
f1ffb0ff428c7c23aa7258a2cef6a0733eb9a86fb794b46e3d358cd70dec6a95  b4_settings.sql
643f0b5971d5c51fd9d0a1f5de58ee80fcb8261862305f2402246c1dc74566c3  b4_assert_common.sql
b2e2f6720c51a5641fec91242cfd4bb164a0393d0bdc945466285e08d61cebfc  b4_assert_pre.sql
aea3371267a323c19201ea3c0e65267a8446e8f30b5dbb3ac64e294f1270d478  b4_assert_post.sql
d1f1e67883d35e67de4e209aa319aef3a1094fdb782a6e8505321b580fc37c98  b4_state.sql
62a17842d3f97f454e8e015051bd69e8a803962e9d5742b4cf37bf2934501bd4  b4_grants_DRAFT.sql
HASHES
  F="$W/b4_state.sql"; [[ $MODE == grants ]] && F="$W/b4_grants_DRAFT.sql"
  printf 'B4 GUARD: OK endpoint=%s mode=%s\n' "${D%%.*}" "$MODE"
  unset PGPASSWORD PGPASSFILE PGUSER PGHOST PGHOSTADDR PGPORT PGDATABASE PGOPTIONS PGSERVICE PGSERVICEFILE PGSSLMODE PGSSLROOTCERT PGCHANNELBINDING PGSSLNEGOTIATION PGSSLCERT PGSSLKEY PGSSLCRL PGSSLCRLDIR PGREQUIREAUTH PGGSSENCMODE PGSSLSNI PGTARGETSESSIONATTRS SSL_CERT_FILE SSL_CERT_DIR DATABASE_URL OPENSSL_CONF OPENSSL_MODULES OPENSSL_ENGINES PGSYSCONFDIR PGLOCALEDIR
  unset -m 'DYLD_*' 'OPENSSL_*' 2>/dev/null
  PSQL_HISTORY=/dev/null /opt/homebrew/bin/psql -X -n "host=$D dbname=neondb user=neondb_owner sslmode=verify-full sslrootcert=system channel_binding=require application_name=aura_b4_$MODE" -f "$F"
  echo "B4 PSQL EXIT CODE: $?" )
