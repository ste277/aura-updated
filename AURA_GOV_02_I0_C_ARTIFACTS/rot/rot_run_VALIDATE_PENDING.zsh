( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  D_HOST='ep-orange-resonance-auzwf5t5.c-10.us-east-1.aws.neon.tech'
  MODE='validate_pending'
  KC_FILE="$HOME/Library/Keychains/login.keychain-db"
  KC_T="-T ''"
  ADMIN='neondb_owner'
  DB='neondb'
  TLS='sslmode=verify-full sslrootcert=system channel_binding=require gssencmode=disable'
  W="$HOME/aura-rot"
  PSQL_REAL='/opt/homebrew/Cellar/postgresql@16/16.14/bin/psql'; PSQL_SHA='e78541607d31dee69a55beaaace4d3862dfc44cd15ad7caffc281e3808ee7b2b'; LIBPQ_REAL='/opt/homebrew/Cellar/postgresql@16/16.14/lib/libpq.5.dylib'; LIBPQ_SHA='c0e17e448215c2a8f60baf3e4d509e3f8f47535b54aab4542ff1733bb5c61c22'
  KC_ACCT='aura_app_2026_11'; KC_SVC='AURA-Neon-aura_app_2026_11-Production'; KC_PEND='AURA-Neon-aura_app_2026_11-PENDING'
  [[ -n $ZSH_VERSION ]] || { echo 'ROT GUARD: must run under zsh - nothing done'; exit 1; }
  [[ -n $D_HOST && -z ${D_HOST//[a-z0-9.-]/} && $D_HOST != *..* && $D_HOST != *-pooler.* ]] || { echo 'ROT GUARD: DIRECT HOST INVALID - nothing done'; exit 1; }
  [[ $MODE == rotate || $MODE == validate || $MODE == validate_pending ]] || { echo 'ROT GUARD: MODE INVALID - nothing done'; exit 1; }
  cd "$W" 2>/dev/null || { echo 'ROT GUARD: FILE DIRECTORY MISSING - nothing done'; exit 1; }
  /usr/bin/shasum -a 256 -c >/dev/null 2>&1 <<'HASHES' || { echo 'ROT GUARD: FILE HASH MISMATCH - nothing done'; exit 1; }
179d0e10b4bdab45fe062f5399c318f0e90f7bec0f7d49e98eab56931e603eec  rot_settings.sql
3aa0d889c9396bd5e97931f880039301dc71f64fdabb6647c96e679a977c71fa  rot_gate.sql
9686ac95ddf527a3f220ce38fc96f118330f40f88a08fd1bc7de8559c736066c  rot_apply.sql
372c079e0ffa15de2e74f0b7c68c7444213e308bea7e15062de3694c76550340  rot_validate.sql
0347dfe0adf09fe18559b91bfa0624efe05e9c88fff2780637fba24451f4df2b  rot_validate_core.sql
19e34d1b61315a7a5ae7ac93ce4e052fecabbabbcbeb38494fcdd05eb2caba1e  b3_checks.sql
HASHES
  /usr/bin/grep -qxF "\\set rot_direct_host '$D_HOST'" rot_settings.sql || { echo 'ROT GUARD: HOST DOES NOT MATCH THE PINNED rot_direct_host - nothing done'; exit 1; }
  [ -f "$KC_FILE" ] || { echo 'ROT GUARD: KEYCHAIN FILE MISSING - nothing done'; exit 1; }
  [[ $(/usr/bin/shasum -a 256 "$PSQL_REAL" 2>/dev/null) == "$PSQL_SHA  $PSQL_REAL" && $(/usr/bin/shasum -a 256 "$LIBPQ_REAL" 2>/dev/null) == "$LIBPQ_SHA  $LIBPQ_REAL" ]] || { echo 'ROT GUARD: PSQL OR LIBPQ BINARY DOES NOT MATCH THE PINNED HASH - nothing done'; exit 1; }
  /usr/bin/shasum -a 256 -c >/dev/null 2>&1 <<'PINS' || { echo 'ROT GUARD: A PSQL LIBRARY DOES NOT MATCH ITS PINNED HASH - nothing done'; exit 1; }
6ca8278ccca353a10b5e4d2beb0ad3df32c0d3323d4c42063786b4a755c06071  /opt/homebrew/Cellar/gettext/1.0/lib/libintl.8.dylib
775aad8f9ab3cc7f8440109f3761a8130415d93e54c07013217b891d2bf54888  /opt/homebrew/Cellar/krb5/1.22.2_2/lib/libcom_err.3.0.dylib
4c3db81f0ddb2f718c59234e00e11553619dd43a1ed44463951021c086c85f0c  /opt/homebrew/Cellar/krb5/1.22.2_2/lib/libgssapi_krb5.2.2.dylib
013c1b35460362984207bfeb6f0f5c5d9bf4f1182ce07a8e974645be8df5dd16  /opt/homebrew/Cellar/krb5/1.22.2_2/lib/libk5crypto.3.1.dylib
43ccf54244b6eea96dec1e3f685cbf5426ccd01528022ba9467f48105c9fe7f3  /opt/homebrew/Cellar/krb5/1.22.2_2/lib/libkrb5.3.3.dylib
70d0febc3ebbe022f8dff4cfda47288815c1733461f6069347b8f5858f9eb634  /opt/homebrew/Cellar/krb5/1.22.2_2/lib/libkrb5support.1.1.dylib
cf354769aff4fefb6d2691d1fb6c29da31f1426363444586a6fa7934fbeffaeb  /opt/homebrew/Cellar/openssl@3/3.6.3/lib/libcrypto.3.dylib
2eed8515d898ee02502019821ca2ae922eec4b44046d99596b5c3a49074afbac  /opt/homebrew/Cellar/openssl@3/3.6.3/lib/libssl.3.dylib
e78541607d31dee69a55beaaace4d3862dfc44cd15ad7caffc281e3808ee7b2b  /opt/homebrew/Cellar/postgresql@16/16.14/bin/psql
c0e17e448215c2a8f60baf3e4d509e3f8f47535b54aab4542ff1733bb5c61c22  /opt/homebrew/Cellar/postgresql@16/16.14/lib/libpq.5.dylib
0d291e55cfd00f109a2d16c8f0700a8352c4e233d4c83ca8e856218e0888cc03  /opt/homebrew/Cellar/readline/8.3.6/lib/libreadline.8.3.dylib
PINS
  G=/usr/bin/grep; P=''; Q=''; KEEP=''; FD=''; rc='not-run'; FIN=0
  kcread() { /usr/bin/security find-generic-password -a "$KC_ACCT" -s "$1" -w "$KC_FILE" 2>/dev/null; }
  kchas() { /usr/bin/security find-generic-password -a "$KC_ACCT" -s "$1" "$KC_FILE" >/dev/null 2>&1; }
  kcdel() { /usr/bin/security delete-generic-password -a "$KC_ACCT" -s "$1" "$KC_FILE" >/dev/null 2>&1; }
  kcput() { printf 'add-generic-password -a %s -s %s -l %s %s -w %s %s\n' "$KC_ACCT" "$1" "$1" "$KC_T" "$2" "$KC_FILE" | /usr/bin/security -i >/dev/null 2>&1 || echo "ROT KEYCHAIN: write of $1 reported an error"; }
  kcacl() { kchas "$1" || { echo absent; return; }
    /usr/bin/security dump-keychain -a "$KC_FILE" 2>/dev/null | /usr/bin/awk -v A="$KC_ACCT" -v S="$1" '
      function fin() { if (acc && svc) { n++; if (apps != "applications (0):") open = 1 } acc = 0; svc = 0; d = 0; apps = "" }
      /^keychain: / { fin() }
      index($0, "\"acct\"<blob>=\"" A "\"") { acc = 1 }
      index($0, "\"svce\"<blob>=\"" S "\"") { svc = 1 }
      /authorizations.*decrypt/ { d = 1; next }
      d && apps == "" && /applications/ { apps = $1 " " $2; sub(/^[ \t]+/, "", apps) }
      END { fin(); if (n == 1 && !open) print "restricted"; else if (n == 0) print "OPEN(unparsed)"; else if (n > 1) print "OPEN(duplicate)"; else print "OPEN" }'; }
  kcmdat() { /usr/bin/security find-generic-password -a "$KC_ACCT" -s "$1" "$KC_FILE" 2>/dev/null | /usr/bin/sed -n 's/.*"mdat"<timedate>=[^"]*"\([0-9Z]*\).*/\1/p'; }
  ask() { [ -n "$KC_T" ] && echo "ROT KEYCHAIN PROMPT ($1): macOS will ask to allow 'security' to read $2 - click ALLOW (never Always Allow). More than one dialog for this step, or any dialog at another time: Deny ALL and STOP."; }
  valid() {
    printf '%s' "$1" | $G -Eq '^[A-Za-z0-9]{40}$' || return 1
    printf '%s' "$1" | $G -q '[a-z]' || return 1
    printf '%s' "$1" | $G -q '[A-Z]' || return 1
    printf '%s' "$1" | $G -q '[0-9]' || return 1
    printf '%s' "$1" | $G -Eq '(.)\1\1'; [ $? -eq 1 ] || return 1
  }
  promote() {
    if ! valid "$KEEP"; then echo 'ROT KEYCHAIN: PROMOTION FAILED - no in-memory value; PENDING retained; STOP'; return 1; fi
    kcdel "$KC_SVC"; kcput "$KC_SVC" "$KEEP"
    ask 'verify LIVE' "$KC_SVC"; Q=$(kcread "$KC_SVC")
    if [[ -n $Q && $Q == $KEEP ]]; then
      kcdel "$KC_PEND"
      if kchas "$KC_PEND"; then echo 'ROT KEYCHAIN: promoted to LIVE (verified) but PENDING NOT removed; STOP'; else echo 'ROT KEYCHAIN: PENDING promoted to LIVE (readback verified); PENDING removed (verified)'; fi
    else echo 'ROT KEYCHAIN: PROMOTION FAILED - LIVE readback mismatch or denied; PENDING retained; STOP'; fi
    Q=''
  }
  finalize() {
    [ $FIN -eq 1 ] && return; FIN=1
    if [ -n "$FD" ] && [ -f "$FD/out" ]; then
      if [[ $MODE == rotate ]]; then
        if $G -q '^ROT RESULT: ALTER SUCCEEDED - SQLSTATE 00000' "$FD/out"; then promote
        else echo 'ROT KEYCHAIN: ALTER not confirmed - PENDING retained, LIVE untouched; STOP'; fi
      elif [[ $MODE == validate_pending ]]; then
        if $G -q '^B3 RESULT: PASS' "$FD/out" && $G -q '^ROT END: secrets cleared' "$FD/out"; then promote
        else echo 'ROT KEYCHAIN: PENDING not validated - nothing promoted; STOP'; fi
      fi
    fi
    [ -n "$FD" ] && { /bin/rm -f "$FD/out"; /bin/rmdir "$FD" 2>/dev/null; }
    P=''; Q=''; KEEP=''
    la=$(kcacl "$KC_SVC"); pa=$(kcacl "$KC_PEND")
    printf 'ROT FINAL: mode=%s psql_exit=%s keychain_LIVE=%s keychain_PENDING=%s LIVE_mdat=%s\n' "$MODE" "$rc" "$la" "$pa" "$(kcmdat "$KC_SVC")"
    if [ -n "$KC_T" ] && { [ "$la" = OPEN ] || [ "$pa" = OPEN ]; }; then echo 'ROT FINAL: STOP - a keychain item is OPEN (Always Allow was granted or ACL changed)'; fi
  }
  trap finalize EXIT
  trap 'rc=interrupted; exit 130' INT TERM HUP
  if [[ $MODE == rotate ]]; then
    kchas "$KC_PEND" && { echo 'ROT GUARD: a PENDING keychain item exists (unresolved previous run) - nothing done; STOP'; exit 1; }
    for i in 1 2 3 4 5 6 7 8 9 10; do
      P=$(LC_ALL=C /usr/bin/tr -dc 'A-Za-z0-9' </dev/urandom | /usr/bin/head -c 40)
      valid "$P" && break; P=''
    done
    [ -n "$P" ] || { echo 'ROT: generation failed - nothing changed'; exit 1; }
    kcput "$KC_PEND" "$P"; ask 'verify PENDING' "$KC_PEND"; Q=$(kcread "$KC_PEND")
    [[ -n $Q && $Q == $P ]] || { P=''; Q=''; echo 'ROT: keychain store/readback FAILED - nothing sent, password NOT changed'; exit 1; }
    Q=''; KEEP=$P
    echo 'ROT: new password generated and stored as PENDING in the keychain (readback verified; never displayed)'
    SQLF="$W/rot_apply.sql"
  elif [[ $MODE == validate_pending ]]; then
    ask 'load PENDING' "$KC_PEND"; P=$(kcread "$KC_PEND"); valid "$P" || { P=''; echo 'ROT: PENDING value missing, invalid or denied - nothing sent'; exit 1; }
    KEEP=$P
    echo 'ROT: PENDING password loaded from the keychain (never displayed)'
    SQLF="$W/rot_validate.sql"
  else
    ask 'load LIVE' "$KC_SVC"; P=$(kcread "$KC_SVC"); valid "$P" || { P=''; echo 'ROT: LIVE value missing, invalid or denied - nothing sent'; exit 1; }
    echo 'ROT: LIVE password loaded from the keychain (never displayed)'
    SQLF="$W/rot_validate.sql"
  fi
  FD=$(umask 077; /usr/bin/mktemp -d) || { P=''; exit 1; }
  printf 'ROT GUARD: OK endpoint=%s mode=%s - enter the %s password at the psql prompt\n' "${D_HOST%%.*}" "$MODE" "$ADMIN"
  printf '%s\n' "$P" | /usr/bin/env -i HOME="$HOME" TERM="$TERM" PATH=/usr/bin:/bin PSQL_HISTORY=/dev/null "$PSQL_REAL" -X -n "host=$D_HOST dbname=$DB user=$ADMIN $TLS application_name=aura_rot_$MODE" -v fifo=/dev/stdin -f "$SQLF" 2>&1 | /usr/bin/tee "$FD/out"
  rc=${pipestatus[2]}
  P=''
  exit 0 )
