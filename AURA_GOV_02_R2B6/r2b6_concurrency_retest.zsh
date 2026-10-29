( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  # R2B-6 standalone concurrency retest. FRESH throwaway keychain + FRESH synthetic value. Deny-only: no Allow, no Always Allow,
  # no password entry. Two concurrent `security find-generic-password -w` reads of the SAME item; both should be denied.
  # Usage:  zsh -f r2b6_concurrency_retest.zsh                     interactive owner run (requires explicit owner approval)
  #         zsh -f r2b6_concurrency_retest.zsh --selftest=<case>   MOCK readers: NO Keychain read, NO dialog
  #             cases: deny | leak | rc0nosecret | hang
  [[ -n $ZSH_VERSION ]] || { echo 'R2B6: run with zsh -f'; exit 1; }
  zmodload zsh/datetime zsh/system || { echo 'R2B6: zsh modules unavailable'; exit 1; }
  export LC_NUMERIC=C; umask 077
  MOCK=''; case "${1:-}" in --selftest=deny|--selftest=leak|--selftest=rc0nosecret|--selftest=hang) MOCK=${1#--selftest=};; '') ;; *) echo 'R2B6: unknown argument'; exit 1;; esac
  SEC=/usr/bin/security; ME=$sysparams[pid]
  EVD="$HOME/aura-r2b-evidence"; /bin/mkdir -p -m 700 "$EVD" || exit 1
  LOG="$EVD/r2b6-$(/bin/date -u +%Y%m%dT%H%M%SZ)${MOCK:+-mock-$MOCK}.log"; : > "$LOG" || exit 1
  log() { print -r -- "$*" | /usr/bin/tee -a "$LOG"; }
  sl() { $SEC list-keychains -d user 2>/dev/null | /usr/bin/tr -d ' "' | /usr/bin/tr '\n' ','; }
  dk() { $SEC default-keychain -d user 2>/dev/null | /usr/bin/tr -d ' "'; }
  now() { print -r -- $EPOCHREALTIME; }
  V=''; D=''; KC=''; LOCK="${TMPDIR:-/tmp}/r2b6.lock"; HAVELOCK=0; PA=''; PB=''; CLEANED=0; VERDICT='STOPPED'
  cleanup() {
    [ $CLEANED -eq 1 ] && return; CLEANED=1; V=''
    local p ok=1
    for p in $PA $PB; do                                    # only our own recorded reader subshells (children of this shell)
      if kill -0 "$p" 2>/dev/null && [[ $(/bin/ps -o ppid= -p "$p" 2>/dev/null | /usr/bin/tr -d ' ') == "$ME" ]]; then
        /usr/bin/pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; wait "$p" 2>/dev/null
      fi
    done
    if [[ -n $KC ]]; then $SEC delete-keychain "$KC" >/dev/null 2>&1; [[ -e $KC ]] && ok=0; fi
    if [[ -n $D ]]; then /bin/rm -f "$D/ra" "$D/rb" "$D/ea" "$D/eb" "$KC" 2>/dev/null; /bin/rmdir "$D" 2>/dev/null; [[ -d $D ]] && ok=0; fi
    [[ $(sl) == "$SL0" && $(dk) == "$DK0" ]] || ok=0
    [ $HAVELOCK -eq 1 ] && /bin/rmdir "$LOCK" 2>/dev/null
    if [ $ok -eq 1 ]; then log 'R2B6 CLEANUP: VERIFIED (readers reaped; keychain file and temp dir removed; search list and default keychain unchanged)'
    else log "R2B6 CLEANUP: UNVERIFIED - HOLD. Manual recovery: check that \"$D\" no longer exists (delete it only if it contains r2b6.keychain-db), and that 'security list-keychains -d user' and 'security default-keychain -d user' match the values logged at start"; fi
    log "R2B6 VERDICT: $VERDICT"
    log "R2B6 LOG: $LOG"
    /usr/bin/grep -q '^R2B6 VERDICT:' "$LOG" 2>/dev/null || print -r -- 'R2B6 WARNING: the log file did not record the verdict (disk full?) - copy this terminal output as evidence' >/dev/tty
  }
  trap cleanup EXIT
  trap 'log "R2B6: interrupted - click Deny on any dialog still open"; VERDICT="STOPPED (interrupted)"; exit 130' INT TERM HUP
  stop() { log "R2B6 STOP: $*"; exit 2; }
  ask() {   # $1 prompt, $2 anchored regex; flushes type-ahead; invalid input is never logged (length only) and STOPs
    local x _
    while read -t 0 -k 1 -u 3 _ 2>/dev/null; do :; done 3</dev/tty
    print -n -- "$1 " >/dev/tty
    IFS= read -r x </dev/tty || { log "R2B6 STOP: no input (EOF) - not treated as confirmation" >/dev/tty; exit 2; }
    [[ $x =~ $2 ]] || { log "R2B6 STOP: INVALID input (len=${#x}) - not logged" >/dev/tty; exit 2; }
    print -r -- "$x"
  }
  acl() {
    $SEC dump-keychain -a "$KC" 2>/dev/null | /usr/bin/awk '
      /^keychain: / { f=0 }
      index($0, "\"svce\"<blob>=\"R2B6-ITEM\"") && !done { f=1 }
      f && /authorizations.*decrypt/ { d=1; next }
      f && d && /applications/ { a=$0; sub(/^[ \t]+/, "", a); out=a; g=1; next }
      f && d && g && /requirement:|^ +\//  { r=$0; sub(/^[ \t]+/, "", r); out=out " | " r; next }
      f && d && g && /entry [0-9]+:/ { done=1; f=0 }
      END { print (out == "" ? "UNPARSED" : out) }'
  }

  # ---------- preflight ----------
  SL0=$(sl); DK0=$(dk)
  if [[ -n $MOCK ]]; then ML="MOCK-$MOCK (no Keychain read, no dialog)"; else ML=INTERACTIVE; fi
  log "R2B6 start $(/bin/date -u +%FT%TZ) mode=$ML macOS=$(/usr/bin/sw_vers -productVersion)"
  FREE_KB=$(/bin/df -k "$HOME" | /usr/bin/awk 'NR==2{print $4}'); [ "${FREE_KB:-0}" -ge 512000 ] || { print -r -- "R2B6 STOP: less than 500 MB free on the home volume - free space first (evidence could be lost)" >/dev/tty; exit 1; }
  log "R2B6-0 search_list_entries=$(print -r -- $SL0 | /usr/bin/tr ',' '\n' | /usr/bin/grep -c .) default_keychain=$([[ $DK0 == */login.keychain-db ]] && echo login || echo OTHER)"
  /bin/mkdir "$LOCK" 2>/dev/null && HAVELOCK=1 || stop "another R2B6 run holds $LOCK (remove it only if no R2B6 run is active)"
  others=$(/bin/ps -axo command= | /usr/bin/grep -E 'r2b_isolated\.zsh|r2_verify\.zsh' | /usr/bin/grep -vc grep)
  [ "${others:-0}" -eq 0 ] || stop 'another Keychain test script (r2b_isolated / r2_verify) is running'
  if /usr/bin/pgrep -f 'cua_node|Codex Computer Use' >/dev/null 2>&1; then stop 'a UI-automation agent process (cua_node / Codex Computer Use) is running - quit it first'; fi
  if [[ -z $MOCK ]]; then
    a=$(ask 'Is Codex Computer Use (and every other UI-automation / Accessibility agent) switched OFF? y/n:' '^[yn]$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
    [[ $a == y ]] || stop 'owner did not confirm UI automation is off'
  fi
  D=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/r2b6.XXXXXXXX") || stop 'mktemp failed'
  KC="$D/r2b6.keychain-db"
  [[ $KC == ${TMPDIR:-/tmp}/r2b6.*/r2b6.keychain-db && ! -e $KC ]] || stop 'unexpected keychain path or it already exists'
  KP=$(LC_ALL=C /usr/bin/tr -dc 'A-Za-z0-9' </dev/urandom | /usr/bin/head -c 24)
  $SEC create-keychain -p "$KP" "$KC" >/dev/null 2>&1 || stop 'create-keychain failed'
  KP=''
  $SEC set-keychain-settings -t 3600 "$KC" || stop 'set-keychain-settings failed'
  ks=$($SEC show-keychain-info "$KC" 2>&1 | /usr/bin/sed 's/.*" //'); [[ $ks == 'timeout=3600s' ]] || stop "keychain settings not timeout=3600s ($ks)"
  V=$(LC_ALL=C /usr/bin/tr -dc 'A-Za-z0-9' </dev/urandom | /usr/bin/head -c 40)
  print -r -- "add-generic-password -a r2b6acct -s R2B6-ITEM -T '' -w $V $KC" | $SEC -i >/dev/null 2>&1
  n=$($SEC dump-keychain "$KC" 2>/dev/null | /usr/bin/grep -c '"svce"<blob>="R2B6-ITEM"'); [ "$n" = 1 ] || stop "expected exactly 1 synthetic item, found $n"
  A0=$(acl); log "R2B6-0 keychain=<private temp>/r2b6.keychain-db settings=$ks item=r2b6acct/R2B6-ITEM (value never displayed) ACL_before: $A0"
  [[ $A0 == 'applications (0):'* ]] || stop 'initial ACL is not applications (0)'
  [[ $(sl) == "$SL0" && $(dk) == "$DK0" ]] || stop 'search list or default keychain changed during setup'

  # ---------- concurrent readers ----------
  reader() {   # $1 = slot; runs in its own subshell; writes ONLY non-secret facts to $D/r$1
    local t0 t1 rc m ec=mock R=''
    t0=$(now)
    if [[ -z $MOCK ]]; then
      local ef="$D/e$1"; R=$($SEC find-generic-password -a r2b6acct -s R2B6-ITEM -w "$KC" 2>"$ef"); rc=$?
      if /usr/bin/grep -qiE 'cancel' "$ef" 2>/dev/null; then ec=canceled; elif /usr/bin/grep -qiE 'denied|not allowed|authoriz' "$ef" 2>/dev/null; then ec=denied; elif [ -s "$ef" ]; then ec=other; else ec=none; fi
      /bin/rm -f "$ef"
    else
      case "$MOCK" in
        deny) sleep 0.4; rc=128;;
        leak) sleep 0.4; if [[ $1 == a ]]; then R=$V; rc=0; else rc=128; fi;;
        rc0nosecret) sleep 0.4; if [[ $1 == b ]]; then rc=0; else rc=128; fi;;
        hang) sleep 60; rc=128;;
      esac
    fi
    t1=$(now)
    [[ -n $R && $R == $V ]] && m=yes || m=no; R=''
    print -r -- "slot=$1 self_pid=$sysparams[pid] start=$t0 end=$t1 rc=$rc secret_returned=$m stderr_class=$ec" > "$D/r$1"
    return $rc
  }
  print
  log 'R2B6-1: Two Keychain authorization dialogs may appear. Click DENY on every dialog. Never click Allow or Always Allow. Do not type any password.'
  GO=$(ask 'Press Enter to launch the two concurrent reads (type nothing else):' '^$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
  ( reader a ) & PA=$!
  ( reader b ) & PB=$!
  log "R2B6-1 launched reader_a_pid=$PA reader_b_pid=$PB"
  wait $PA; RCA=$?; wait $PB; RCB=$?; PA_DONE=$PA; PB_DONE=$PB; PA=''; PB=''
  ra=$(/bin/cat "$D/ra" 2>/dev/null); rb=$(/bin/cat "$D/rb" 2>/dev/null)
  # results are logged BEFORE any owner question, so they survive any later STOP
  log "R2B6-1 RESULT a: $ra wait_rc=$RCA parent_pid=$PA_DONE"
  log "R2B6-1 RESULT b: $rb wait_rc=$RCB parent_pid=$PB_DONE"
  [[ -n $ra && -n $rb ]] || { VERDICT='INCONCLUSIVE (reader result missing)'; stop 'a reader result file is missing - results cannot be attributed'; }
  fld() { print -r -- "$1" | /usr/bin/tr ' ' '\n' | /usr/bin/sed -n "s/^$2=//p"; }
  [[ $(fld "$ra" slot) == a && $(fld "$rb" slot) == b && $(fld "$ra" self_pid) == $PA_DONE && $(fld "$rb" self_pid) == $PB_DONE ]] \
    || { VERDICT='INCONCLUSIVE (attribution)'; stop 'reader results cannot be attributed to the launched processes'; }
  [[ $(fld "$ra" rc) == $RCA && $(fld "$rb" rc) == $RCB ]] || { VERDICT='INCONCLUSIVE (exit-code mismatch)'; stop 'recorded rc differs from wait status'; }
  sa=$(fld "$ra" start); ea=$(fld "$ra" end); sb=$(fld "$rb" start); eb=$(fld "$rb" end)
  OVL=$(( sa < eb && sb < ea ? 1 : 0 )); log "R2B6-1 concurrency: start_gap_s=$(printf '%.3f' $(( sb > sa ? sb - sa : sa - sb ))) overlapping=$([ $OVL -eq 1 ] && echo yes || echo no)"
  A1=$(acl); log "R2B6-1 ACL_after: $A1"
  SA=$(fld "$ra" secret_returned); SB=$(fld "$rb" secret_returned)

  # ---------- owner observations (separate, validated prompts) ----------
  ND=$(ask 'How many Keychain dialogs appeared? Enter 0, 1, or 2:' '^[012]$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
  DN=$(ask 'Did you click DENY on every dialog that appeared? Enter y or n:' '^[yn]$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
  O1=$(ask 'Did every dialog name the application "security"? Enter y, n, or - (no dialog):' '^[yn-]$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
  O2=$(ask 'Did every dialog name the item R2B6-ITEM (or this test keychain)? Enter y, n, or -:' '^[yn-]$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
  O3=$(ask 'Did any dialog ask for your Mac LOGIN password (not a keychain password)? Enter y or n:' '^[yn]$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
  O5=$(ask 'Did a dialog ask for a KEYCHAIN password (you did not type it)? Enter y, n, or -:' '^[yn-]$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
  O4=$(ask 'Could you tell the two dialogs apart (e.g. different wording)? Enter y, n, or - (fewer than 2):' '^[yn-]$') || { VERDICT='STOPPED (invalid owner input)'; exit 2; }
  log "R2B6-2 OWNER: dialogs=$ND all_denied=$DN app_security=$O1 item_expected=$O2 login_password_requested=$O3 keychain_password_requested=$O5 distinguishable=$O4"

  # ---------- classification ----------
  if [[ $SA == yes || $SB == yes ]]; then
    if [[ $DN == y ]]; then VERDICT='FAIL (secret returned although every dialog was denied)'; stop 'SECURITY FINDING: a reader returned the secret'; fi
    VERDICT='INCONCLUSIVE (owner did not deny every dialog; a secret was returned)'; stop 'secret returned after a non-deny action - not a valid run'
  fi
  [[ $A1 == 'applications (0):'* ]] || { VERDICT='FAIL (ACL changed)'; stop 'SECURITY FINDING: ACL changed'; }
  [[ $(sl) == "$SL0" && $(dk) == "$DK0" ]] || { VERDICT='FAIL (search list or default keychain changed)'; stop 'global keychain state changed'; }
  [[ $O3 == y ]] && { VERDICT='STOPPED (login password requested - security finding)'; stop 'a dialog requested the Mac login password'; }
  [[ $O2 == n || $O1 == n ]] && { VERDICT='STOPPED (dialog named an unexpected app or item)'; stop 'dialog attribution mismatch'; }
  if [[ $ND == 2 && $DN == y && $RCA == 128 && $RCB == 128 && $SA == no && $SB == no && $OVL -eq 1 && $O1 == y && $O2 == y ]]; then
    VERDICT='PASS (two concurrent reads, two dialogs, both denied, both failed, no secret, ACL unchanged)'
  else
    VERDICT="INCONCLUSIVE (dialogs=$ND all_denied=$DN rc_a=$RCA rc_b=$RCB overlapping=$OVL app_security=$O1 item_expected=$O2; PASS needs 2/y/128/128/1/y/y)"
  fi
  log "R2B6 RESULT: $VERDICT"
)
