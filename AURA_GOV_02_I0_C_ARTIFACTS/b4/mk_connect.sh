#!/bin/bash
# regenerates b4_connect_DRAFT.zsh with the current SQL hashes embedded
cd "$(dirname "$0")"
H=$(for f in b4_settings.sql b4_assert_common.sql b4_assert_pre.sql b4_assert_post.sql b4_state.sql b4_grants_DRAFT.sql; do shasum -a 256 $f; done)
cat > b4_connect_DRAFT.zsh <<ZEOF
( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  D='<DIRECT-HOST>'
  MODE='state'
  W="\$HOME/aura-b4"
  [[ -n \$D && -z \${D//[a-z0-9.-]/} && \$D != *..* && \$D != *.-* && \$D != *-.* && \$D =~ '^ep-[a-z0-9-]+\.[a-z0-9.-]+\.aws\.neon\.tech\$' && \$D != *-pooler.* ]] || { echo 'B4 GUARD: DIRECT HOST INVALID - not connecting'; exit 1; }
  [[ \$MODE == state || \$MODE == grants ]] || { echo 'B4 GUARD: MODE INVALID - not connecting'; exit 1; }
  cd "\$W" 2>/dev/null || { echo 'B4 GUARD: FILE DIRECTORY MISSING - not connecting'; exit 1; }
  /usr/bin/shasum -a 256 -c >/dev/null 2>&1 <<'HASHES' || { echo 'B4 GUARD: FILE HASH MISMATCH - not connecting'; exit 1; }
$H
HASHES
  F="\$W/b4_state.sql"; [[ \$MODE == grants ]] && F="\$W/b4_grants_DRAFT.sql"
  printf 'B4 GUARD: OK endpoint=%s mode=%s\n' "\${D%%.*}" "\$MODE"
  unset PGPASSWORD PGPASSFILE PGUSER PGHOST PGHOSTADDR PGPORT PGDATABASE PGOPTIONS PGSERVICE PGSERVICEFILE PGSSLMODE PGSSLROOTCERT PGCHANNELBINDING PGSSLNEGOTIATION PGSSLCERT PGSSLKEY PGSSLCRL PGSSLCRLDIR PGREQUIREAUTH PGGSSENCMODE PGSSLSNI PGTARGETSESSIONATTRS SSL_CERT_FILE SSL_CERT_DIR DATABASE_URL OPENSSL_CONF OPENSSL_MODULES OPENSSL_ENGINES PGSYSCONFDIR PGLOCALEDIR
  unset -m 'DYLD_*' 'OPENSSL_*' 2>/dev/null
  PSQL_HISTORY=/dev/null /opt/homebrew/bin/psql -X -n "host=\$D dbname=neondb user=neondb_owner sslmode=verify-full sslrootcert=system channel_binding=require application_name=aura_b4_\$MODE" -f "\$F"
  echo "B4 PSQL EXIT CODE: \$?" )
ZEOF
