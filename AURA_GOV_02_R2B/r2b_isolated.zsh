( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  # R2B isolated Keychain test. THROWAWAY keychain + SYNTHETIC value only. No "Always Allow" step.
  # Usage:  zsh -f r2b_isolated.zsh            (interactive owner run; requires explicit owner approval)
  #         zsh -f r2b_isolated.zsh --selftest (setup / ACL / cleanup only; makes NO read, raises NO dialog)
  [[ -n $ZSH_VERSION ]] || { echo 'R2B: run with zsh -f'; exit 1; }
  zmodload zsh/datetime || { echo 'R2B: zsh/datetime unavailable'; exit 1; }
  export LC_NUMERIC=C
  SELFTEST=0; [[ ${1:-} == --selftest ]] && SELFTEST=1
  SEC=/usr/bin/security
  EVD="$HOME/aura-r2b-evidence"; /bin/mkdir -p -m 700 "$EVD" || exit 1
  LOG="$EVD/r2b-$(/bin/date -u +%Y%m%dT%H%M%SZ)$([ $SELFTEST -eq 1 ] && echo -selftest).log"
  log() { print -r -- "$*" | /usr/bin/tee -a "$LOG"; }
  tty() { print -r -- "$*" >/dev/tty; }
  sl() { $SEC list-keychains -d user 2>/dev/null | /usr/bin/tr -d ' "' | /usr/bin/tr '\n' ','; }
  dk() { $SEC default-keychain -d user 2>/dev/null | /usr/bin/tr -d ' "'; }
  SL0=$(sl); DK0=$(dk)
  D=$(umask 077; /usr/bin/mktemp -d "${TMPDIR:-/tmp}/r2b.XXXXXXXX") || exit 1
  KC="$D/r2b-isolated.keychain-db"
  [[ $KC == ${TMPDIR:-/tmp}/r2b.*/r2b-isolated.keychain-db && ! -e $KC ]] || { log 'R2B STOP: unexpected keychain path'; exit 1; }
  KP="r2b-$(LC_ALL=C /usr/bin/tr -dc 'a-z0-9' </dev/urandom | /usr/bin/head -c 6)"
  V=''; R=''; O=''; P6A=''; P6B=''
  cleanup() {
    V=''; R=''; O=''
    for p in $P6A $P6B; do /usr/bin/pkill -P "$p" 2>/dev/null; kill "$p" 2>/dev/null; done
    $SEC delete-keychain "$KC" >/dev/null 2>&1
    local ok=1
    [[ -e $KC ]] && ok=0
    [[ $(sl) == "$SL0" && $(dk) == "$DK0" ]] || ok=0
    /bin/rm -f "$KC" "$D/r6a" "$D/r6b" 2>/dev/null; /bin/rmdir "$D" 2>/dev/null; [[ -d $D ]] && ok=0
    if [ $ok -eq 1 ]; then log 'R2B CLEANUP: VERIFIED (keychain file removed, temp dir removed, search list and default keychain unchanged)'
    else log 'R2B CLEANUP: UNVERIFIED - inspect manually'; fi
    log "R2B LOG: $LOG"
  }
  trap cleanup EXIT; trap 'log "R2B: interrupted - Deny any dialog still open"; exit 130' INT TERM HUP
  acl() {
    $SEC dump-keychain -a "$KC" 2>/dev/null | /usr/bin/awk '
      /^keychain: / { f=0 }
      index($0, "\"svce\"<blob>=\"R2B-ITEM\"") && !done { f=1 }
      f && /authorizations.*decrypt/ { d=1; next }
      f && d && /applications/ { a=$0; sub(/^[ \t]+/, "", a); out=a; g=1; next }
      f && d && g && /requirement:|^ +\//  { r=$0; sub(/^[ \t]+/, "", r); out=out " | " r; next }
      f && d && g && /entry [0-9]+:/ { done=1; f=0 }
      END { print (out == "" ? "UNPARSED" : out) }'
  }
  guard() {
    [[ $(sl) == "$SL0" ]] || { log 'R2B STOP: user search list changed'; exit 2; }
    [[ $(dk) == "$DK0" ]] || { log 'R2B STOP: default keychain changed'; exit 2; }
    local a; a=$(acl)
    log "  ACL: $a"
    [[ $a == 'applications (0):'* ]] || { log 'R2B STOP: ACL is no longer applications (0)'; exit 2; }
    log '  lock state: ASSUMED unlocked (created unlocked; timeout=3600s; no lock-on-sleep; not directly measured)'
  }
  # validated owner input: flush type-ahead, accept only $2 (regex); invalid input is never logged
  ask() {
    local x _
    while read -t 0 -k 1 -u 3 _ 2>/dev/null; do :; done 3</dev/tty
    print -n -- "$1 " >/dev/tty; read -r x </dev/tty
    if [[ $x =~ $2 ]]; then print -r -- "$x"; else log "R2B STOP: INVALID owner input (len=${#x}) - not logged"; exit 2; fi
  }
  enter() { ask 'Press Enter to start this step (type nothing else):' '^$' >/dev/null; }
  dlg() { # dialog details, validated tokens only
    local n s i p
    s=$(ask '  Did the dialog name the app "security"? (y/n/-=no dialog)' '^[yn-]$') || exit 2
    i=$(ask '  Did it name the item R2B-ITEM? (y/n/-)' '^[yn-]$') || exit 2
    p=$(ask '  Did it ask for a password? (n=no, t=the throwaway one, l=your LOGIN password, -=no dialog)' '^[ntl-]$') || exit 2
    [[ $p == l ]] && { log "R2B STOP: a dialog asked for the LOGIN password (unexpected for a throwaway keychain)"; exit 2; }
    print -r -- "dialog_app_security=$s dialog_item=$i password_requested=$p"
  }
  now() { print -r -- $EPOCHREALTIME; }

  log "R2B start $(/bin/date -u +%FT%TZ) mode=$([ $SELFTEST -eq 1 ] && echo selftest || echo interactive)"
  log "R2B-0 baseline: keychain=<private temp>/r2b-isolated.keychain-db  search_list_entries=$(print -r -- $SL0 | /usr/bin/tr ',' '\n' | /usr/bin/grep -c .)"
  $SEC create-keychain -p "$KP" "$KC" >/dev/null 2>&1 || { log 'R2B STOP: create-keychain failed'; exit 1; }
  $SEC set-keychain-settings -t 3600 "$KC" || { log 'R2B STOP: set-keychain-settings failed'; exit 1; }
  ks=$($SEC show-keychain-info "$KC" 2>&1 | /usr/bin/sed 's/.*" //'); log "  keychain settings: $ks"
  [[ $ks == 'timeout=3600s' ]] || { log 'R2B STOP: keychain settings are not exactly timeout=3600s (no lock-on-sleep)'; exit 1; }
  V=$(LC_ALL=C /usr/bin/tr -dc 'A-Za-z0-9' </dev/urandom | /usr/bin/head -c 40)
  print -r -- "add-generic-password -a r2bacct -s R2B-ITEM -T '' -w $V $KC" | $SEC -i >/dev/null 2>&1
  $SEC find-generic-password -a r2bacct -s R2B-ITEM "$KC" >/dev/null 2>&1 || { log 'R2B STOP: synthetic item not created'; exit 1; }
  n=$($SEC dump-keychain "$KC" 2>/dev/null | /usr/bin/grep -c '"svce"<blob>="R2B-ITEM"'); [ "$n" = 1 ] || { log "R2B STOP: expected exactly 1 synthetic item, found $n"; exit 1; }
  log '  synthetic item: account=r2bacct service=R2B-ITEM (value never displayed)'
  guard
  if [ $SELFTEST -eq 1 ]; then log 'R2B SELFTEST: setup, ACL parse and guards OK - no read performed, no dialog raised'; exit 0; fi

  tty "Throwaway keychain password (dummy; type it ONLY into a dialog that asks for it, never into this terminal): $KP"
  log 'Rules: never click "Always Allow". Keep focus on each dialog. Any dialog you were not told to expect: click Deny and answer X.'
  # one read; $1=label $2=instruction $3=expected owner action (D or A)
  step_read() {
    print; log "$1: $2"; enter
    local t0 t1 rc m who
    t0=$(now); R=$($SEC find-generic-password -a r2bacct -s R2B-ITEM -w "$KC" 2>/dev/null); rc=$?; t1=$(now)
    [[ -n $R && $R == $V ]] && m=yes || m=no; R=''
    who=$(ask 'What happened? D=dialog,I clicked Deny  A=dialog,I clicked Allow  N=no dialog  X=anything else :' '^[DdAaNnXx]$') || exit 2
    local dd; dd=$(dlg) || exit 2
    log "$1 RESULT: rc=$rc secs=$(printf '%.2f' $((t1-t0))) secret_returned=$m owner=$who $dd"
    case "$who" in
      [Xx]) log "R2B STOP: owner reported an unexpected event at $1"; exit 2;;
      [Nn]) log "R2B STOP: INCONCLUSIVE - no dialog where one was expected at $1 (rc=$rc, secret_returned=$m)"; exit 2;;
      [Aa]) [[ $3 == A ]] || { log "R2B STOP: owner clicked Allow at a Deny step $1"; exit 2; }
            [[ $m == yes ]] || { log "R2B STOP: Allow did not return the secret at $1 - later inferences invalid"; exit 2; };;
      [Dd]) [[ $3 == D ]] || { log "R2B STOP: owner clicked Deny at an Allow step $1"; exit 2; }
            [[ $m == no ]] || { log "R2B STOP: secret returned although owner clicked Deny at $1"; exit 2; };;
    esac
    guard
  }
  step_read 'R2B-1' 'single read. A dialog should appear. Click DENY.' D
  step_read 'R2B-2' 'single read. A dialog should appear. Enter the throwaway password if asked, then click ALLOW (not Always Allow).' A
  step_read 'R2B-3' 'repeat single read. A dialog should appear. Click DENY.' D

  print; log 'R2B-4: bulk dump (security dump-keychain -d). If a dialog appears, click DENY.'; enter
  t0=$(now); O=$($SEC dump-keychain -d "$KC" 2>/dev/null </dev/null); rc=$?; t1=$(now)
  [[ -n $O && $O == *$V* ]] && m=yes || m=no; O=''
  who=$(ask 'What happened? D=dialog,I clicked Deny  N=no dialog  X=anything else :' '^[DdNnXx]$') || exit 2
  nd=$(ask 'How many dialogs did you see in this step (0-9)?' '^[0-9]$') || exit 2
  dd=$(dlg) || exit 2
  log "R2B-4 RESULT: rc=$rc secs=$(printf '%.2f' $((t1-t0))) secret_in_dump=$m owner=$who dialogs=$nd $dd"
  case "$who$m" in
    [Xx]*) log 'R2B STOP: unexpected event at R2B-4'; exit 2;;
    [Nn]yes) log 'R2B STOP: bulk dump returned the secret WITHOUT any dialog - dump bypasses the per-item ACL prompt'; exit 2;;
    [Dd]yes) log 'R2B STOP: bulk dump returned the secret although the owner clicked Deny - Deny not honoured or a different dialog was answered'; exit 2;;
    [Nn]no) log 'R2B-4 NOTE: no dialog and no secret (dump skipped the protected item or the request was refused) - recorded';;
  esac
  guard

  step_read 'R2B-5' 'post-dump single read. A dialog should appear. Click DENY.' D

  print; log 'R2B-6: TWO concurrent single reads. Click DENY on every dialog.'; enter
  rd6() { local t0 t1 rc m; t0=$(now); R=$($SEC find-generic-password -a r2bacct -s R2B-ITEM -w "$KC" 2>/dev/null); rc=$?; t1=$(now)
          [[ -n $R && $R == $V ]] && m=yes || m=no; R=''; print -r -- "$1 rc=$rc secs=$(printf '%.2f' $((t1-t0))) secret_returned=$m"; }
  ( umask 077; rd6 R2B-6a > "$D/r6a" ) & P6A=$!
  ( umask 077; rd6 R2B-6b > "$D/r6b" ) & P6B=$!
  wait $P6A $P6B; P6A=''; P6B=''
  r6="$(/bin/cat "$D/r6a" "$D/r6b" | /usr/bin/tr '\n' ';')"
  nd=$(ask 'How many dialogs did you see (0-2), and were all denied (y/n)? e.g. "2 y":' '^[0-2] [yn]$') || exit 2
  log "R2B-6 RESULT: $r6 owner_dialogs_and_denied=$nd"
  [[ $r6 == *secret_returned=yes* ]] && { log 'R2B STOP: a concurrent read returned the secret although all dialogs were to be denied'; exit 2; }
  [[ $nd == *' n' ]] && { log 'R2B STOP: not all R2B-6 dialogs were denied'; exit 2; }
  guard
  print; log 'R2B DONE - no Always Allow was used. Report the R2B-* lines and the log path (they contain no secret or password).'
)
