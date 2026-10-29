( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  # R-2 owner verification: macOS Keychain access control for an item with an EMPTY trusted-application list.
  # Uses a THROWAWAY keychain file and a DUMMY random value. Touches nothing else. Never prints the value.
  [[ -n $ZSH_VERSION ]] || { echo 'R2: run with zsh -f'; exit 1; }
  D=$(umask 077; /usr/bin/mktemp -d) || exit 1
  KC="$D/r2verify.keychain-db"; KP='r2-throwaway'
  cleanup() { /usr/bin/security delete-keychain "$KC" >/dev/null 2>&1; /bin/rm -rf "$D"; V=''; R=''; }
  trap cleanup EXIT; trap 'exit 130' INT TERM HUP
  /usr/bin/security create-keychain -p "$KP" "$KC" && /usr/bin/security set-keychain-settings "$KC" || exit 1
  V=$(LC_ALL=C /usr/bin/tr -dc 'A-Za-z0-9' </dev/urandom | /usr/bin/head -c 40)
  printf "add-generic-password -a r2acct -s R2-VERIFY-ITEM -T '' -w %s %s\n" "$V" "$KC" | /usr/bin/security -i >/dev/null 2>&1
  acl() { /usr/bin/security dump-keychain -a "$KC" 2>/dev/null | /usr/bin/awk '/"svce"<blob>="R2-VERIFY-ITEM"/{f=1} f && /authorizations.*decrypt/{d=1;next} f && d && /applications/{print; exit}'; }
  rd() { local t0=$SECONDS; R=$(/usr/bin/security find-generic-password -a r2acct -s R2-VERIFY-ITEM -w "$KC" 2>/dev/null); local rc=$?
         printf '%s: rc=%s secs=%s value_returned=%s matches=%s\n' "$1" "$rc" "$((SECONDS-t0))" "$([ -n "$R" ] && echo yes || echo no)" "$([[ -n $R && $R == $V ]] && echo yes || echo no)"; R=''; }
  echo "R2 throwaway keychain password (if a dialog asks for it): $KP"
  echo "R2-0 ACL decrypt entry: $(acl)"
  echo; echo 'R2-1: a dialog will appear. Click DENY.'; rd 'R2-1 (expect rc!=0, value_returned=no)'
  echo; echo 'R2-2: a dialog will appear. Click ALLOW (type the throwaway password above if asked). Do NOT click Always Allow.'; rd 'R2-2 (expect rc=0, matches=yes)'
  echo; echo 'R2-3: immediately reading again. If a dialog appears, click DENY. If NO dialog appears, note it.'; rd 'R2-3 (expect a dialog again; rc!=0)'
  echo "R2-3b ACL decrypt entry after Allow: $(acl)   (expect: applications (0))"
  echo; echo 'R2-3c: bulk dump with secrets (security dump-keychain -d). If a dialog appears, click DENY.'
  t0=$SECONDS; O=$(/usr/bin/security dump-keychain -d "$KC" 2>/dev/null </dev/null); [[ -n $O && $O == *$V* ]] && n=1 || n=0; O=''; echo "R2-3c: secret_in_dump=$n secs=$((SECONDS-t0))   (expect 0 with the dialog denied)"
  echo; echo 'R2-6 (concurrency): TWO reads start at once. Expect TWO dialogs that look identical. Click DENY on both.'
  ( rd 'R2-6a' ) & ( rd 'R2-6b' ) & wait
  echo; echo 'R2-4 (hazard demonstration): a dialog will appear. Click ALWAYS ALLOW this one time.'; rd 'R2-4 (expect rc=0)'
  echo 'R2-5: reading again with no user action expected.'; rd 'R2-5 (if rc=0 with secs=0 and NO dialog: Always Allow makes later reads silent)'
  echo "R2-5b ACL decrypt entry after Always Allow: $(acl)   (expect: applications (1) = security, i.e. now OPEN)"
  echo; echo 'OWNER OBSERVATIONS to report (type them in your reply, not here):'
  echo '  O1: did the dialog require a password (which one: throwaway shown above / login password / none)?'
  echo '  O2: which application did the dialog name (expect: security)? Did it name the item?'
  echo '  O3: in R2-6, could the two dialogs be told apart?'
  echo; echo 'R2 DONE - throwaway keychain will be deleted. Report the R2-* lines (they contain no secret).'
)
