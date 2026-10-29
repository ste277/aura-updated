# R2D locked-keychain prototype harness (AURA-GOV-02-R2E). THROWAWAY keychain + SYNTHETIC values only.
# Launch ONLY via the R2D-06 bootstrap (hash-then-execute-from-memory) in a fresh `env -i ... /bin/zsh -f` window.
# Arguments (after $0 = r2d_prototype):  --test=<IDs>   (comma list of: G1 L6 L7 L8 L9 L10 L11 L13 L14 L15 L16POST)
#   --probe=info|attr|dump   --observe=<kc>,<wd_pid>,<harness_pid>,<N>,<probe>,<sig_locked>,<sig_unlocked>,<mode>  (L7 observer)
# Each flag at most once; --observe excludes --test. REAL mode refuses every R2D_* variable (mock/test hooks).
# Mock mode (self-tests only): environment R2D_MOCK_DIR=<dir> containing mock `security`, `csrutil`, `ps`, `pmset`;
#   R2D_MOCK_ANSWERS=<file> supplies owner answers. Mock mode never uses /usr/bin/security.
zmodload zsh/datetime zsh/system || { print -r -- 'R2D: zsh modules unavailable'; exit 1; }
export LC_ALL=C LC_NUMERIC=C; umask 077
typeset -g MOCK=${R2D_MOCK_DIR:-} ANSF=${R2D_MOCK_ANSWERS:-} MODE=REAL
[[ -n $MOCK ]] && MODE=SIMULATED-MOCK
mockok() {  # $1 tool name: regular, non-symlink, executable zsh script with the R2E mock marker, outside system dirs
  local f="$MOCK/$1" r; r=${f:A}
  [[ -f $f && ! -L $f && -x $f && ! -L $MOCK ]] || return 1
  case $r in /usr/*|/bin/*|/sbin/*|/System/*|/Library/*|/Applications/*|/opt/*) return 1;; esac
  [[ $(/usr/bin/head -n 1 -- "$f") == '#!/bin/zsh -f' && $(/usr/bin/sed -n 2p -- "$f") == "# MOCK $1 for R2E"* ]]; }
if [[ -n $MOCK ]]; then
  for x in security csrutil ps pmset; do mockok $x || { print -r -- "R2D: mock $x missing or not a genuine R2E mock - refused"; exit 1; }; done
  SEC="$MOCK/security"; CSRUTIL="$MOCK/csrutil"; PSB="$MOCK/ps"; PMSET="$MOCK/pmset"
else
  [[ -z ${(M)${(k)parameters}:#R2D_*} ]] || { print -r -- 'R2D: REAL mode refuses R2D_* test/mock variables - launch with env -i via the bootstrap'; exit 1; }
  ANSF=''; SEC=/usr/bin/security; CSRUTIL=/usr/bin/csrutil; PSB=/bin/ps; PMSET=/usr/bin/pmset
fi
ME=$sysparams[pid]; TD=${TMPDIR:-/tmp}; TD=${TD%/}
LOCKD="$TD/r2d-lock"; EVD="$HOME/aura-r2b-evidence"
TESTS=''; OBS=''; PROBE=''
typeset -i nT=0 nO=0 nP=0
for a in "$@"; do case $a in --test=*) TESTS=${a#--test=}; (( nT++ ));; --observe=*) OBS=${a#--observe=}; (( nO++ ));; --probe=info|--probe=attr|--probe=dump) PROBE=${a#--probe=}; (( nP++ ));; *) print -r -- "R2D: unknown argument"; exit 1;; esac; done
(( nT <= 1 && nO <= 1 && nP <= 1 )) || { print -r -- 'R2D: duplicate argument refused'; exit 1; }
(( nO == 0 || nT == 0 )) || { print -r -- 'R2D: --observe and --test are mutually exclusive'; exit 1; }
/bin/mkdir -p -m 700 "$EVD" || exit 1
LOG="$EVD/r2d-$(/bin/date -u +%Y%m%dT%H%M%SZ)-$ME${MOCK:+-mock}.log"; : > "$LOG" || exit 1
log() { builtin print -r -- "$*" | /usr/bin/tee -a "$LOG"; }
say() { { builtin print -r -- "$*" >/dev/tty; } 2>/dev/null || builtin print -r -- "$*"; }
now() { builtin print -r -- $EPOCHREALTIME; }
typeset -g KC='' D='' HAVELOCK=0 CLEANED=0 VERDICT='STOPPED' SIG_L='' SIG_U='' WDPID='' SL0='' DK0='' VA='' VB='' VC='' PIDS=''
typeset -g ANSFD='' WDN=60 L8T=60
typeset -g RES='' ANS='' DLG='' OBSW=900
[[ -n $MOCK ]] && { WDN=${R2D_WD_N:-60}; L8T=${R2D_L8_T:-60}; OBSW=${R2D_OBS_WAIT:-900}; }   # timing overrides honoured in MOCK mode only

# ---------------- owner input (validated; EOF/whitespace never confirmation; invalid never logged) ----------------
[[ -n $ANSF ]] && { exec {ANSFD}<"$ANSF" || exit 1; }
ask() {   # $1 prompt  $2 regex  -> sets global ANS; STOPs the harness (main shell) on EOF/invalid
  local x _
  if [[ -n $ANSFD ]]; then
    IFS= read -r -u $ANSFD x || { VERDICT='STOPPED (invalid owner input)'; log "R2D STOP: no input (EOF) - not treated as confirmation"; exit 2; }
  else
    while read -t 0 -k 1 -u 3 _ 2>/dev/null; do :; done 3</dev/tty
    builtin print -n -- "$1 " >/dev/tty
    IFS= read -r x </dev/tty || { VERDICT='STOPPED (invalid owner input)'; log "R2D STOP: no input (EOF) - not treated as confirmation"; exit 2; }
  fi
  [[ $x =~ $2 ]] || { VERDICT='STOPPED (invalid owner input)'; log "R2D STOP: INVALID input (len=${#x}) - not logged"; exit 2; }
  ANS=$x
}
stop() { log "R2D STOP: $*"; exit 2; }

# ---------------- T1-8 keychain-path guard: every keychain-targeting call goes through sec_kc ----------------
kc_ok() { [[ -n $KC && $KC != *[[:space:]]* && $KC != *..* && $KC != *[\*\?\[\]]* && ${KC:t} == r2d.keychain-db && ${KC:h:h} == "$TD" && ${KC:h:t} =~ '^r2d-run\.[A-Za-z0-9]{8}$' ]]; }
sec_kc() {   # usage: sec_kc <subcommand> [opts...]   -> appends "$KC" as the final argument
  kc_ok || { log "R2D STOP: T1-8 keychain path guard (empty or unexpected path) - call refused"; exit 2; }
  case $1 in create-keychain|set-keychain-settings|show-keychain-info|unlock-keychain|lock-keychain|delete-keychain|dump-keychain|find-generic-password|delete-generic-password) ;;
    *) log "R2D STOP: T1-8 subcommand not allowed: $1"; exit 2;; esac
  "$SEC" "$@" "$KC"
}
sec_i() {    # security -i with ONE command line; the line must end with the guarded keychain path
  kc_ok || { log "R2D STOP: T1-8 keychain path guard (sec_i)"; exit 2; }
  [[ $1 == add-generic-password\ * && $1 == *" $KC" ]] || { log "R2D STOP: T1-8 sec_i command refused"; exit 2; }
  builtin print -r -- "$1" | "$SEC" -i >/dev/null 2>&1
}
sec_global() { # read-only global queries only
  case "$1 $2" in 'list-keychains -d'|'default-keychain -d') ;; *) log "R2D STOP: global call refused: $1"; exit 2;; esac
  case $3 in user|system|common|dynamic) ;; *) log "R2D STOP: bad domain"; exit 2;; esac
  "$SEC" "$1" -d "$3" 2>/dev/null | /usr/bin/tr -d ' "' | /usr/bin/tr '\n' ','
}
glob_state() { local s='' d; for d in user dynamic common system; do s+="$d=$(sec_global list-keychains -d $d);"; done
  for d in user system; do s+="default_$d=$(sec_global default-keychain -d $d);"; done; builtin print -r -- "$s"; }

# ---------------- T1-2 ACL inspection (record-exact: acct + svce; identity lines) ----------------
acl_of() {   # $1 svce -> "applications (N): | requirement ..." ; OPEN(duplicate) if >1 record
  sec_kc dump-keychain -a 2>/dev/null | /usr/bin/awk -v S="$1" '
    function fin() { if (acc && svc) { n++; res = out } acc=0; svc=0; d=0; g=0; out="" }
    /^keychain: / { fin() }
    index($0, "\"acct\"<blob>=\"r2dacct\"") { acc=1 }
    index($0, "\"svce\"<blob>=\"" S "\"") { svc=1 }
    /authorizations.*decrypt/ { d=1; next }
    d && !g && /applications/ { a=$0; sub(/^[ \t]+/, "", a); out=a; g=1; next }
    d && g && /requirement:|^ +\// { r=$0; sub(/^[ \t]+/, "", r); out=out " | " r; next }
    d && g && /entry [0-9]+:/ { d=0 }
    END { fin(); if (n == 0) print "UNPARSED"; else if (n > 1) print "OPEN(duplicate)"; else print res }'
}
acl_class() { case $1 in 'applications (0):'*) builtin print restricted;; UNPARSED) builtin print UNPARSED;; *) builtin print OPEN;; esac; }

# ---------------- children / timing ----------------
track() { PIDS+=" $1"; }
is_wd() {   # $1 pid $2 N $3 expected parent: exact PID, exact argv tail "r2d_watchdog N <KC> <SEC>", parent = harness
  [[ $1 == <-> && -n $KC ]] && kill -0 $1 2>/dev/null || return 1
  [[ $($PSB -ww -o command= -p $1 2>/dev/null) == *" r2d_watchdog $2 $KC $SEC" ]] || return 1
  [[ $($PSB -ww -o ppid= -p $1 2>/dev/null | /usr/bin/tr -d ' ') == $3 ]]; }
# ---------------- teardown (T1-7) ----------------
cleanup() {
  [ $CLEANED -eq 1 ] && return; CLEANED=1; VA=''; VB=''; VC=''
  local p ok=1
  for p in ${=PIDS}; do
    if kill -0 $p 2>/dev/null && [[ $($PSB -ww -o ppid= -p $p 2>/dev/null | /usr/bin/tr -d ' ') == $ME ]]; then /usr/bin/pkill -P $p 2>/dev/null; kill $p 2>/dev/null; wait $p 2>/dev/null; fi
  done
  if [[ -n $WDPID ]] && is_wd $WDPID $WDN $ME; then kill -KILL $WDPID 2>/dev/null; wait $WDPID 2>/dev/null; is_wd $WDPID $WDN $ME && ok=0; fi
  [[ -n $OBS ]] && KC=''   # observer never locks/deletes the harness keychain
  if kc_ok && [[ -e $KC ]]; then sec_kc lock-keychain >/dev/null 2>&1; log "teardown: post-lock state=$(pstate)"; sec_kc delete-keychain >/dev/null 2>&1; fi
  [[ -n $KC && -e $KC ]] && ok=0
  if [[ -n $D ]]; then /bin/rm -f "$D/ra" "$D/rb" "$D/oa" 2>/dev/null; /bin/rmdir "$D" 2>/dev/null; [[ -d $D ]] && ok=0; fi
  if [[ -n $SL0 ]]; then [[ $(glob_state) == "$SL0" ]] || ok=0; fi
  [ $HAVELOCK -eq 1 ] && /bin/rmdir "$LOCKD" 2>/dev/null
  if [[ -n $OBS && $ok -eq 1 ]]; then log 'R2D CLEANUP: VERIFIED (observer: performed no keychain lock/delete; nothing of its own to clean)'
  elif [ $ok -eq 1 ]; then log 'R2D CLEANUP: VERIFIED (children reaped; keychain locked+deleted; temp dir removed; search lists and defaults unchanged)'
  else log "R2D CLEANUP: UNVERIFIED - HOLD. Manual recovery: see R2D-07 (dir=${D:-none})"; fi
  log "R2D VERDICT: [$MODE] $VERDICT"; log "R2D LOG: $LOG"
  /usr/bin/grep -q '^R2D VERDICT:' "$LOG" 2>/dev/null || say 'R2D WARNING: log did not record the verdict - keep this terminal output'
}
trap cleanup EXIT
trap 'log "R2D: interrupted - Cancel any dialog still open"; VERDICT="STOPPED (interrupted)"; exit 130' INT TERM HUP

# ---------------- header / T1-4 hash ----------------
HASH=UNPINNED
if [[ -n ${ZSH_EXECUTION_STRING:-} ]]; then HASH=$(builtin print -rn -- "$ZSH_EXECUTION_STRING" | /usr/bin/env -i /usr/bin/shasum -a 256 | /usr/bin/cut -d' ' -f1); fi
log "R2D start $(/bin/date -u +%FT%TZ) harness_sha256=$HASH mode=$MODE macOS=$(/usr/bin/sw_vers -productVersion) pid=$ME"
[[ -z $MOCK && $HASH == UNPINNED ]] && stop 'T1-4: harness not launched via the hash-verified bootstrap (UNPINNED)'
log "Manual recovery if this run crashes: R2D-07 (look for $TD/r2d-run.* ; lock dir $LOCKD)"

# ---------------- observer mode (L7) ----------------
probe() {   # $1 probe name -> class string; never a dialog by L1 criteria
  local o rc
  case $1 in
    info) o=$(sec_kc show-keychain-info 2>&1); rc=$?;;
    attr) o=$(sec_kc find-generic-password -a r2dacct -s R2D-A 2>&1); rc=$?;;
    dump) o=$(sec_kc dump-keychain 2>&1); rc=$?;;
    *) builtin print -r -- 'NOPROBE'; return;;
  esac
  builtin print -r -- "rc=$rc:$(builtin print -rn -- "$o" | /usr/bin/env -i /usr/bin/shasum -a 256 | /usr/bin/cut -c1-12)"
}
if [[ -n $OBS ]]; then
  typeset -a f; f=("${(@s:,:)OBS}"); (( ${#f} == 8 )) || stop 'observer: bad --observe argument (kc,wdpid,harnesspid,N,probe,siglocked,sigunlocked,mode)'
  [[ $f[8] == $MODE ]] || stop "observer: mode mismatch (harness=$f[8] observer=$MODE) - evidence must not mix modes"
  KC=$f[1]; kc_ok || stop 'observer: T1-8 path guard'
  [[ $f[2] == <-> && $f[3] == <-> && $f[4] == <-> ]] || stop 'observer: bad pid/N'
  [[ $f[5] == (info|attr|dump) ]] || stop 'observer: bad probe'
  kill -0 $f[3] 2>/dev/null && [[ $($PSB -ww -o command= -p $f[3] 2>/dev/null) == *'R2D locked-keychain prototype harness'* ]] || { VERDICT='L7 INCONCLUSIVE (harness not running at observer start - residual timing unknown)'; stop 'observer: harness pid not alive'; }
  is_wd $f[2] $f[4] $f[3] || { VERDICT='L7 INCONCLUSIVE (watchdog not alive before kill)'; stop 'observer: watchdog not alive or identity mismatch (pid/argv/parent)'; }
  log "L7-OBS watchdog_alive=yes pid=$f[2] parent=$f[3] argv=exact; waiting up to ${OBSW}s for harness pid $f[3] to disappear (owner: kill -9 $f[3])"
  typeset t0 e p1 p2 c1 c2; e=$(( $(now) + OBSW )); while kill -0 $f[3] 2>/dev/null; do (( $(now) < e )) || { VERDICT="L7 INCONCLUSIVE (harness not killed within ${OBSW}s)"; stop 'observer: wait bound reached'; }; sleep 0.2; done; t0=$(now)
  log "L7-OBS harness_gone_at=$t0"
  e=$(( t0 + 5 )); while (( $(now) < e )); do sleep 0.2; done
  p1=$(probe $f[5]); if [[ $p1 == $f[6] ]]; then c1=locked; elif [[ $p1 == $f[7] ]]; then c1=unlocked; else c1=unknown; fi
  log "L7-OBS t+5 probe=$p1 state=$c1"
  e=$(( t0 + f[4] + 10 )); while (( $(now) < e )); do sleep 0.5; done
  p2=$(probe $f[5]); if [[ $p2 == $f[6] ]]; then c2=locked; elif [[ $p2 == $f[7] ]]; then c2=unlocked; else c2=unknown; fi
  log "L7-OBS t+N+10 probe=$p2 state=$c2"
  typeset wdg=no; kill -0 $f[2] 2>/dev/null || wdg=yes; log "L7-OBS watchdog_gone_by_deadline=$wdg"
  if [[ $c2 == unlocked ]]; then VERDICT='L7 FAIL (still unlocked after watchdog deadline)'
  elif [[ $c2 != locked ]]; then VERDICT='L7 INCONCLUSIVE (probe signature unknown)'
  elif (( f[4] > 5 )) && [[ $c1 != unlocked ]]; then VERDICT='L7 INCONCLUSIVE (relocked before the watchdog deadline - cause not attributable to the watchdog)'
  elif [[ $wdg != yes ]]; then VERDICT='L7 INCONCLUSIVE (watchdog still alive after its deadline)'
  else VERDICT='L7 PASS (relocked by watchdog after harness kill)'; fi
  log "L7 RESULT: $VERDICT residual_t+5=$c1. Post-L7 cleanup = R2D-07 manual recovery."
  exit 0
fi

# ---------------- Tier 1 preflight ----------------
[[ -n $TESTS ]] || stop 'no --test selected'
[[ $TESTS =~ '^[A-Z0-9]+(,[A-Z0-9]+)*$' ]] || stop 'malformed --test list'
typeset -a TA TU; TA=(${(s:,:)TESTS}); TU=(${(u)TA}); (( ${#TU} == ${#TA} )) || stop 'duplicate test id'
for t in ${(s:,:)TESTS}; do case $t in G1|L6|L7|L8|L9|L10|L11|L13|L14|L15|L16POST) ;; *) stop "unknown test $t";; esac; done
FREE_KB=$(/bin/df -k "$HOME" | /usr/bin/awk 'NR==2{print $4}'); (( ${FREE_KB:-0} >= 512000 )) || stop 'less than 500 MB free'
/bin/mkdir "$LOCKD" 2>/dev/null && HAVELOCK=1 || stop "another R2D run holds $LOCKD"
SIPL=$("$CSRUTIL" status 2>&1); [[ $SIPL == 'System Integrity Protection status: enabled.' ]] || stop 'T1-9: SIP not exactly enabled'
log 'T1-9 SIP: enabled'
# T1-6 process scan by executable NAME, excluding this harness and its children
DENY='cua_node|codex|chatgpt|claude|claude helper|zoom.us|splashtop|islonline|isl online|superops|teamviewer|anydesk|rustdesk|screenconnect|screensharingd|ardagent|hammerspoon|keyboard maestro|keyboardmaestro|bettertouchtool|osascript'
HIT=$("$PSB" -ww -axo pid=,ppid=,comm= 2>/dev/null | /usr/bin/awk -v me=$ME -v deny="$DENY" '
  { pid=$1; ppid=$2; $1=""; $2=""; sub(/^  /,""); n=$0; sub(/.*\//,"",n); l=tolower(n)
    if (pid==me || ppid==me) next
    if (l ~ ("^(" deny ")")) print n }' | /usr/bin/sort -u | /usr/bin/tr '\n' ';')
[[ -z $HIT ]] || stop "T1-6: UI-automation / remote-control process running: $HIT"
ask 'T1-6: Is EVERY toggle in Privacy & Security > Accessibility OFF? y/n:' '^[yn]$'; a=$ANS; [[ $a == y ]] || stop 'T1-6: Accessibility not attested OFF'
ask 'T1-6: Are Screen Sharing, Remote Management and Remote Login OFF (General > Sharing)? y/n:' '^[yn]$'; a=$ANS; [[ $a == y ]] || stop 'T1-6: Sharing not attested OFF'
ask 'T1-6: Are ChatGPT/Codex/Claude apps quit and no remote-support session active? y/n:' '^[yn]$'; a=$ANS; [[ $a == y ]] || stop 'T1-6: not attested'
log 'T1-6: process scan clean; attestations y/y/y'
SL0=$(glob_state); log "T1-1 baseline captured (domains user/dynamic/common/system + defaults)"
[[ $SL0 == *default_user=*login.keychain-db* ]] || stop 'T1-1: default user keychain is not login'

# ---------------- L0 create ----------------
D=$(/usr/bin/mktemp -d "$TD/r2d-run.XXXXXXXX") || stop 'mktemp failed'
KC="$D/r2d.keychain-db"; kc_ok && [[ ! -e $KC ]] || stop 'unexpected keychain path'
[[ $(glob_state) == *$KC* ]] && stop 'T1-1: target keychain present in a search list before creation'
gen() { LC_ALL=C /usr/bin/tr -dc 'A-Za-z0-9' </dev/urandom | /usr/bin/head -c 40; }
setkc() { sec_kc set-keychain-settings -l -t "$1" || stop 'set-keychain-settings failed'
  local s; s=$(sec_kc show-keychain-info 2>&1 | /usr/bin/sed 's/.*" //'); [[ $s == "lock-on-sleep timeout=${1}s" ]] || stop "settings not exactly lock-on-sleep timeout=${1}s ($s)"; log "  settings: $s"; }
create() {
  say 'L0: create the throwaway keychain. Type your THROWAWAY passphrase (lowercase words) twice at the prompts. Secure Keyboard Entry ON.'
  [[ -n $MOCK && ${R2D_TEST_EMPTY_KC:-} == 1 ]] && KC=''   # mock-only negative-test hook (T1-8)
  sec_kc create-keychain || stop 'create-keychain failed'
  [[ $(glob_state) == *$KC* ]] && stop 'T1-1: target keychain appeared in a search list'
  setkc ${1:-3600}
  VA=$(gen); VB=$(gen); VC=$(gen)
  sec_i "add-generic-password -a r2dacct -s R2D-A -T '' -w $VA $KC" || stop 'add item A failed'
  [[ ${2:-} == B ]] && { sec_i "add-generic-password -a r2dacct -s R2D-B -w $VB $KC" || stop 'add item B failed'; }
  [[ ${3:-} == C ]] && { sec_i "add-generic-password -a r2dacct -s R2D-C -T /usr/bin/security -w $VC $KC" || stop 'add item C failed'; }
  local aa=$(acl_of R2D-A); log "L0 ACL A: $aa"; [[ $(acl_class "$aa") == restricted ]] || stop 'T1-2: item A not applications (0)'
  sec_kc lock-keychain || stop 'lock failed'; log 'L0: created, items added, ACL A restricted, LOCKED'
  calibrate
  [[ $(glob_state) == "$SL0" ]] || stop 'T1-1: global keychain state changed'
}
unlock_ctl() { say "$1: controlled UNLOCK - type the throwaway passphrase at the prompt"; sec_kc unlock-keychain; }
lock_ctl() { sec_kc lock-keychain; }
dlg() {   # owner dialog record -> sets global DLG="type=.. pw=.. act=.."; STOPs on login password / unexpected dialog
  local t p c
  ask "  Dialog type? U=unlock-keychain A=item-access O=other N=none:" '^[UAON]$'; t=$ANS
  ask "  Password asked? k=this keychain l=Mac LOGIN n=none:" '^[kln]$'; p=$ANS
  ask "  Your action? C=Cancel D=Deny A=Allow W=Always-Allow N=none:" '^[CDAWN]$'; c=$ANS
  [[ $p == l ]] && { VERDICT='STOPPED (login password requested - security finding)'; stop 'a dialog asked for the Mac LOGIN password'; }
  [[ $t == O ]] && { VERDICT='STOPPED (unexpected dialog)'; stop 'unexpected dialog type O'; }
  DLG="type=$t pw=$p act=$c"
}
readA() { local R rc; R=$(sec_kc find-generic-password -a r2dacct -s "$1" -w 2>/dev/null); rc=$?
  local v=$VA; [[ $1 == R2D-B ]] && v=$VB; [[ $1 == R2D-C ]] && v=$VC
  [[ -n $R && $R == $v ]] && builtin print -r -- "rc=$rc secret_returned=yes" || builtin print -r -- "rc=$rc secret_returned=no"; R=''; }
group_acl_check() { unlock_ctl "$1-ACL" || stop 'controlled unlock failed'; local a=$(acl_of R2D-A); log "$1 ACL A after (controlled unlock): $a"; lock_ctl || stop 'lock failed'
  [[ $(acl_class "$a") == restricted ]] || { VERDICT="FAIL ($1: ACL changed)"; stop "SECURITY FINDING: $1 ACL changed"; }; }
arm_watchdog() { /usr/bin/nohup /bin/zsh -f -c 'trap "" HUP INT TERM; sleep $1; exec "$3" lock-keychain -- "$2"' r2d_watchdog "$1" "$KC" "$SEC" >/dev/null 2>&1 &
  WDPID=$!; log "watchdog armed pid=$WDPID N=$1"; }
pstate() { if [[ -z $PROBE || -z $SIG_L ]]; then builtin print -r -- 'unknown(no-calibrated-probe)'; return; fi
  local s; s=$(probe $PROBE); if [[ $s == $SIG_L ]]; then builtin print -r -- locked; elif [[ $s == $SIG_U ]]; then builtin print -r -- unlocked; else builtin print -r -- "unknown($s)"; fi; }
calibrate() { [[ -n $PROBE ]] || { SIG_L=''; SIG_U=''; log 'calibration: no --probe= supplied - lock state unverifiable in this run'; return 0; }
  SIG_L=$(probe $PROBE); unlock_ctl calibrate || stop 'unlock failed'; SIG_U=$(probe $PROBE); lock_ctl || stop 'lock failed'
  if [[ $SIG_L == $SIG_U ]]; then log "calibration: probe $PROBE does NOT distinguish states - lock state unverifiable"; SIG_L=''; SIG_U=''
  else log "calibration: probe=$PROBE locked_sig=$SIG_L unlocked_sig=$SIG_U"; fi; }
must_be_locked() { local st; st=$(pstate); if [[ $st == unlocked ]]; then VERDICT="FAIL ($1: keychain unlocked without passphrase entry)"; stop "SECURITY FINDING $1: unlocked after Cancel/Deny"; fi; }

# ---------------- L1 probe selection (non-mutating; deterministic; no dialog) ----------------
L1() {
  local c i s sigL sigU ok best='' dl du
  for c in info attr dump; do
    sigL=''; sigU=''; ok=1
    for i in 1 2 3; do s=$(probe $c); [[ -z $sigL ]] && sigL=$s; [[ $s == $sigL ]] || ok=0; done
    ask "L1[$c locked]: did ANY dialog appear during these 3 probes? y/n (if yes: Cancel it):" '^[yn]$'; dl=$ANS; [[ $dl == y ]] && ok=0
    unlock_ctl "L1[$c]" || stop 'unlock failed'
    for i in 1 2 3; do s=$(probe $c); [[ -z $sigU ]] && sigU=$s; [[ $s == $sigU ]] || ok=0; done
    ask "L1[$c unlocked]: did ANY dialog appear? y/n:" '^[yn]$'; du=$ANS; [[ $du == y ]] && ok=0
    lock_ctl || stop 'lock failed'
    [[ $sigL == $sigU ]] && ok=0
    log "L1 candidate=$c locked_sig=$sigL unlocked_sig=$sigU dialogs_locked=$dl dialogs_unlocked=$du qualifies=$([ $ok -eq 1 ] && echo yes || echo no)"
    [[ $ok -eq 1 && -z $best ]] && best=$c
  done
  if [[ -n $best ]]; then PROBE=$best; calibrate; log "L1 RESULT: PASS probe=$best (pass --probe=$best to later invocations; idle-timer criterion evaluated in L8)"
  else log 'L1 RESULT: INCONCLUSIVE - no qualifying probe; functional oracle (item B) required for L7-L10'; fi
}
L2() { log "L2 probe_before=$(pstate)"; say 'L2: read of item A while LOCKED - Cancel/Deny whatever dialog appears.'
  local r; r=$(readA R2D-A); dlg; log "L2 RESULT: $r $DLG probe_after=$(pstate)"; must_be_locked L2
  if [[ $r == *secret_returned=yes* && $DLG != *act=A* && $DLG != *act=W* ]]; then VERDICT='FAIL (L2 secret while locked without passphrase)'; stop 'SECURITY FINDING L2'; fi; }
L3() { say 'L3: bulk dump while LOCKED - Cancel/Deny EVERY dialog.'
  local O rc m=no n; O=$(sec_kc dump-keychain -d 2>/dev/null); rc=$?; [[ -n $O && $O == *$VA* ]] && m=yes; O=''
  ask 'L3: how many dialogs (0-9)?' '^[0-9]$'; n=$ANS; dlg
  log "L3 RESULT: rc=$rc secret_in_output=$m dialogs=$n $DLG probe_after=$(pstate)"; must_be_locked L3
  if [[ $m == yes ]]; then VERDICT='FAIL (L3 dump disclosed while locked)'; stop 'SECURITY FINDING L3'; fi; }
mdat() { sec_kc find-generic-password -a r2dacct -s R2D-A 2>/dev/null | /usr/bin/sed -n 's/.*"mdat"<timedate>=[^"]*"\([0-9Z]*\).*/\1/p'; }
L4() { say 'L4: overwrite then delete of item A while LOCKED - Cancel every dialog.'
  local m0='' m1 nv rc1 rc2 d1 d2 ex st
  [[ $PROBE == attr && -n $SIG_L ]] && m0=$(mdat)   # a locked attribute read only when L1 qualified attr as dialog-free
  if [[ -z $m0 ]]; then unlock_ctl L4-baseline || stop 'unlock failed'; m0=$(mdat); lock_ctl || stop 'lock failed'; log "L4 baseline mdat (controlled unlock)=${m0:-unreadable}"; fi
  sleep 1.1   # mdat has 1-second resolution: a write after this cannot share the baseline's second
  st=$(pstate); log "L4 state_before_write=$st"
  case $st in locked) ;; unknown\(no-calibrated-probe\)) log 'L4 NOTE: locked state by construction only (lock_ctl || stop 'lock failed' rc=0; no calibrated probe)';;
    *) VERDICT="L4 INCONCLUSIVE (pre-write state $st)"; stop 'L4: locked state not established';; esac
  nv=$(gen); sec_i "add-generic-password -U -a r2dacct -s R2D-A -w $nv $KC"; rc1=$?; nv=''; dlg; d1=$DLG
  sec_kc delete-generic-password -a r2dacct -s R2D-A >/dev/null 2>&1; rc2=$?; dlg; d2=$DLG
  unlock_ctl L4-verify || stop 'unlock failed'; m1=$(mdat); sec_kc find-generic-password -a r2dacct -s R2D-A >/dev/null 2>&1; ex=$?; lock_ctl || stop 'lock failed'
  log "L4 RESULT: overwrite_rc=$rc1 [$d1] delete_rc=$rc2 [$d2] mdat_before=${m0:-unreadable-locked} mdat_after=${m1:-unreadable} item_present_rc=$ex"
  if (( rc1 == 0 )); then VERDICT='FAIL (L4 overwrite accepted while locked)'; stop 'SECURITY FINDING L4 overwrite rc=0'; fi
  if (( rc2 == 0 || ex != 0 )); then VERDICT='FAIL (L4 item deleted while locked)'; stop 'SECURITY FINDING L4 delete'; fi
  if [[ -n $m0 && -z $m1 ]]; then VERDICT='L4 INCONCLUSIVE (mdat unreadable after the attempt)'; log 'L4 NOTE: overwrite check INCONCLUSIVE (no after-value)'; return; fi
  if [[ -n $m0 && $m0 != $m1 ]]; then VERDICT='FAIL (L4 item modified while locked)'; stop 'SECURITY FINDING L4 overwrite'; fi
  if [[ -z $m0 ]]; then VERDICT='L4 INCONCLUSIVE (no baseline mdat - modification check not possible)'; log 'L4 NOTE: overwrite check INCONCLUSIVE (no baseline)'
  else log 'L4 NOTE: write/delete refused (rc!=0) and mdat unchanged at its 1-second resolution; mdat equality alone is NOT proof of no modification (value not re-read, to avoid an extra item dialog)'; fi; }
L5() { say 'L5: TWO concurrent reads of item A while LOCKED - Cancel/Deny every dialog.'
  local pa pb ra rb n dd
  ( readA R2D-A > "$D/ra" ) & pa=$!; track $pa; ( readA R2D-A > "$D/rb" ) & pb=$!; track $pb
  wait $pa; wait $pb; ra=$(/bin/cat "$D/ra"); rb=$(/bin/cat "$D/rb")
  log "L5 RESULT a: $ra ; b: $rb (pids $pa $pb)"
  ask 'L5: how many dialogs (0-2)?' '^[0-2]$'; n=$ANS; ask 'L5: distinguishable? y/n/-:' '^[yn-]$'; dd=$ANS; dlg
  log "L5 OWNER dialogs=$n distinguishable=$dd $DLG probe_after=$(pstate)"; must_be_locked L5
  if [[ "$ra$rb" == *secret_returned=yes* ]]; then VERDICT='FAIL (L5 concurrent secret while locked)'; stop 'SECURITY FINDING L5'; fi; }
L6() { create 3600 B; unlock_ctl L6 || stop 'unlock failed'; local t0 t1 r1 d1 r2 s2 r3 d3; t0=$(now)
  say 'L6(a): read of item A (no trusted app) while UNLOCKED - click DENY.'; r1=$(readA R2D-A); dlg; d1=$DLG
  r2=$(readA R2D-B); ask 'L6(b): read of item B - did ANY dialog appear? y/n:' '^[yn]$'; s2=$ANS
  lock_ctl || stop 'lock failed'; t1=$(now)
  say 'L6(c): read of item B while LOCKED - CANCEL the unlock dialog.'; r3=$(readA R2D-B); dlg; d3=$DLG
  log "L6 RESULT: (a) $r1 $d1 ; (b) $r2 dialog=$s2 ; (c) $r3 $d3 ; unlocked_window_s=$(printf '%.2f' $((t1-t0)))"
  if [[ $r1 == *secret_returned=yes* && $d1 != *act=A* ]]; then VERDICT='FAIL (L6a secret without Allow)'; stop 'SECURITY FINDING L6a'; fi
  if [[ $r3 == *secret_returned=yes* && $d3 != *act=A* ]]; then VERDICT='FAIL (L6c secret while locked)'; stop 'SECURITY FINDING L6c'; fi; }
L7() { create 3600; [[ -n $SIG_L ]] || { VERDICT='L7 INCONCLUSIVE (needs a calibrated --probe=)'; stop 'L7 requires --probe= with a distinguishing probe'; }
  unlock_ctl L7 || stop 'unlock failed'; arm_watchdog $WDN
  log "L7 READY harness_pid=$ME watchdog_pid=$WDPID keychain=$KC"
  log "L7 OBSERVER ARGS: --observe=$KC,$WDPID,$ME,$WDN,$PROBE,$SIG_L,$SIG_U,$MODE"
  say "L7: in a SECOND fresh window launch the observer via the bootstrap with the OBSERVER ARGS line above"
  say "L7: then kill THIS harness by exact PID from that window:  kill -9 $ME"
  VERDICT='L7 (awaiting kill)'
  while :; do sleep 1; done; }
wait_until() { while (( $(now) < $1 )); do sleep 0.25; done; }
L8() { create 3600; local T=$L8T off t0 p1 p2 pm; (( off = T < 60 ? T/4 : 15 )); setkc $T
  [[ -n $SIG_L ]] || log 'L8: no calibrated probe - result will be INCONCLUSIVE'
  unlock_ctl L8a || stop 'unlock failed'; t0=$(now); wait_until $(( t0 + T + off )); p1=$(pstate)
  log "L8a (no probe while idle) state_at_T+$off=$p1"
  unlock_ctl L8b || stop 'unlock failed'; t0=$(now); wait_until $(( t0 + T / 2 )); pm=$(pstate)
  wait_until $(( t0 + T + off )); p2=$(pstate); log "L8b (one probe at T/2=$pm) state_at_T+$off=$p2"; lock_ctl || stop 'lock failed'
  log "L8 RESULT: timeout_relock=$p1 probe_resets_idle_timer=$([[ $p2 == unlocked ]] && echo yes || { [[ $p2 == locked ]] && echo no || echo unknown; })"
  if [[ $p1 == unlocked ]]; then VERDICT='L8 FAIL (still unlocked after timeout)'; stop 'L8 FAIL'
  elif [[ -z $SIG_L ]]; then VERDICT='L8 INCONCLUSIVE (no calibrated probe)'
  elif [[ $pm != unlocked ]]; then VERDICT="L8 INCONCLUSIVE (keychain not unlocked at T/2 (state=$pm) - probe reset not measurable)"
  elif [[ $p1 == locked && $p2 == locked ]]; then VERDICT='L8 PASS (timeout relock; probe at T/2 does not reset idle timer - single trial)'
  elif [[ $p1 == locked && $p2 == unlocked ]]; then VERDICT='L8 PARTIAL (timeout relock PASS; probe RESETS idle timer - L1 idle criterion FAIL)'
  else VERDICT="L8 INCONCLUSIVE (unrecognised probe states p1=$p1 p2=$p2)"; fi; }
L9() { create 3600; unlock_ctl L9 || stop 'unlock failed'; local t0 sl; t0=$(/bin/date '+%Y-%m-%d %H:%M:%S')
  say 'L9: put the Mac to sleep (Apple menu > Sleep) for >=10 s, wake it, log in at the macOS LOCK SCREEN (expected - not a STOP), then press Enter here.'
  ask 'Press Enter after wake (type nothing else):' '^$'
  sl=$("$PMSET" -g log 2>/dev/null | /usr/bin/awk -v t="$t0" '$0 >= t && / Sleep /' | /usr/bin/wc -l | /usr/bin/tr -d ' ')
  local st; st=$(pstate); log "L9 RESULT: sleep_entries_since_unlock=$sl state_after_wake=$st"
  if (( sl == 0 )); then VERDICT='L9 INCONCLUSIVE (no sleep evidenced)'
  elif [[ $st == locked ]]; then VERDICT='L9 PASS (locked after sleep)'
  elif [[ $st == unlocked ]]; then VERDICT='L9 FAIL (unlocked after sleep)'; stop 'L9 FAIL'
  else VERDICT='L9 INCONCLUSIVE (no calibrated probe)'; fi; }
L10() { ask 'L10: re-confirm ALL Accessibility toggles OFF and no automation running? y/n:' '^[yn]$'; [[ $ANS == y ]] || stop 'L10 automation not re-attested'
  create 3600; unlock_ctl L10 || stop 'unlock failed'; local r1 d1 a1 r2 s2 r3 d3
  say 'L10: read of item A - ONLY if exactly ONE dialog naming item R2D-A and this keychain is visible: enter the throwaway passphrase and click ALWAYS ALLOW. Otherwise Cancel all.'
  r1=$(readA R2D-A); dlg; d1=$DLG; a1=$(acl_of R2D-A); log "L10 step1: $r1 $d1 ACL=$a1"
  if [[ $d1 != *act=W* ]]; then VERDICT='L10 INCONCLUSIVE (Always Allow not granted)'; stop 'L10 precondition not met'; fi
  r2=$(readA R2D-A); ask 'L10 step2 (unlocked, trusted): did ANY dialog appear? y/n:' '^[yn]$'; s2=$ANS
  lock_ctl || stop 'lock failed'; say 'L10 step3: read while LOCKED - CANCEL any dialog. Do NOT enter the passphrase.'
  r3=$(readA R2D-A); dlg; d3=$DLG
  log "L10 RESULT: step2 $r2 dialog=$s2 ; step3(locked) $r3 $d3"
  if [[ $r3 == *secret_returned=yes* ]]; then VERDICT='FAIL (L10 lock does not contain Always Allow)'; stop 'SECURITY FINDING L10'; fi
  VERDICT='L10 PASS (locked + trusted read returned no secret without passphrase)'; }
L11() { create 3600 B C; unlock_ctl L11 || stop 'unlock failed'; local a b c
  a=$(acl_of R2D-A); b=$(acl_of R2D-B); c=$(acl_of R2D-C); lock_ctl || stop 'lock failed'
  log "L11 RESULT: A=[$(acl_class "$a")] $a ; B=[$(acl_class "$b")] $b ; C=[$(acl_class "$c")] $c"
  if ! [[ $(acl_class "$a") == restricted && $(acl_class "$b") == OPEN && $(acl_class "$c") == OPEN && $c == *com.apple.security* ]]; then VERDICT='FAIL (L11 detector)'; stop 'L11 detector did not flag exactly B and C'; fi; }
L13() { create 3600; local rc1 rc2; say 'L13: at the next prompt type a WRONG passphrase.'
  sec_kc unlock-keychain; rc1=$?; log "L13 wrong_passphrase rc=$rc1 probe=$(pstate)"
  unlock_ctl L13-correct; rc2=$?; log "L13 correct_passphrase rc=$rc2 probe=$(pstate)"; lock_ctl || stop 'lock failed'
  if (( rc1 == 0 )); then VERDICT='FAIL (L13 wrong passphrase accepted)'; stop 'L13 wrong passphrase accepted'; fi; }
L14() { create 3600; unlock_ctl L14 || stop 'unlock failed'; local rc pr; say 'L14: second unlock while already unlocked (type the passphrase if prompted)'
  sec_kc unlock-keychain; rc=$?; ask 'L14: did a prompt appear for the second unlock? y/n:' '^[yn]$'; pr=$ANS
  log "L14 RESULT: second_unlock_rc=$rc prompted=$pr probe=$(pstate)"; lock_ctl || stop 'lock failed'; }
L15() { create 3600; local r n d1 d2=''
  say 'L15: read of item A while LOCKED - if an UNLOCK dialog appears enter the passphrase; then DENY the item-access dialog. Record EACH dialog.'
  r=$(readA R2D-A); ask 'L15: how many dialogs (0-3)?' '^[0-3]$'; n=$ANS; dlg; d1=$DLG
  if (( n >= 2 )); then dlg; d2=$DLG; fi
  log "L15 RESULT: $r dialogs=$n first=[$d1] second=[$d2] probe_after=$(pstate)"
  if [[ $r == *secret_returned=yes* ]]; then VERDICT='FAIL (L15 secret after Deny)'; stop 'SECURITY FINDING L15'; fi; }
L16POST() { local n=0 dd; for dd in $TD/r2d-run.*(N/); do [[ $dd == $D ]] && continue; (( n++ )); log "L16 residue: $dd"; done
  local g=$(glob_state); [[ $g == *r2d* ]] && log 'L16 residue: r2d path present in a search list'
  log "L16 RESULT: leftover_run_dirs=$n search_list_r2d=$([[ $g == *r2d* ]] && echo yes || echo no) (recovery: R2D-07 manual steps)"; }
G1() { create 3600; L1; L2; L3; L4; L5; group_acl_check G1; }

# ---------------- dispatch ----------------
for t in ${(s:,:)TESTS}; do
  log "=== $t ==="; VERDICT=STOPPED; $t
  [[ $VERDICT == STOPPED ]] && VERDICT="$t RECORDED (characterization; see RESULT lines)"; RES+="$t: $VERDICT; "; VERDICT=STOPPED
  if [[ $t != L16POST ]] && kc_ok && [[ -e $KC ]]; then sec_kc lock-keychain >/dev/null 2>&1; sec_kc delete-keychain >/dev/null 2>&1; [[ -e $KC ]] && { VERDICT='CLEANUP UNVERIFIED'; stop "keychain not deleted after $t"; }; log "$t group teardown: keychain deleted"; fi
  [[ $(glob_state) == "$SL0" ]] || { VERDICT='FAIL (global keychain state changed)'; stop 'search list / default changed'; }
done
VERDICT="COMPLETED $RES"
exit 0
