( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  D='<DIRECT-HOST>'
  [[ -n $D && -z ${D//[a-z0-9.-]/} && $D != *..* && $D != *.-* && $D != *-.* && $D =~ '^ep-[a-z0-9-]+\.[a-z0-9.-]+\.aws\.neon\.tech$' && $D != *-pooler.* ]] || { echo 'B3 GUARD: DIRECT HOST INVALID - not connecting'; exit 1; }
  H="${D%%.*}-pooler.${D#*.}"
  [[ -n $H && $H =~ '^ep-[a-z0-9-]+-pooler\.[a-z0-9.-]+\.aws\.neon\.tech$' && "${H%%-pooler.*}" == "${D%%.*}" && "${H#*.}" == "${D#*.}" ]] || { echo 'B3 GUARD: POOLED HOST INVALID - not connecting'; exit 1; }
  printf 'B3 GUARD: OK endpoint=%s pooled_host=%s\n' "${D%%.*}" "$H"
  unset PGPASSWORD PGPASSFILE PGUSER PGHOST PGHOSTADDR PGPORT PGDATABASE PGOPTIONS PGSERVICE PGSERVICEFILE PGSSLMODE PGSSLROOTCERT PGCHANNELBINDING PGSSLNEGOTIATION PGSSLCERT PGSSLKEY PGSSLCRL PGSSLCRLDIR PGREQUIREAUTH PGGSSENCMODE PGSSLSNI PGTARGETSESSIONATTRS SSL_CERT_FILE SSL_CERT_DIR DATABASE_URL
  PSQL_HISTORY=/dev/null /opt/homebrew/bin/psql -X -n "host=$H dbname=neondb user=aura_app_2026_11 sslmode=verify-full sslrootcert=system channel_binding=require" )
