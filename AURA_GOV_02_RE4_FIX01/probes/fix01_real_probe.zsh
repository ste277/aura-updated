#!/bin/zsh -f
# FIX01 real-environment validation of the v2 T1-6 scanner. READ-ONLY process inspection + ONE bounded test-owned dummy.
# Runs the EXACT v2 scanner functions extracted from the hash-pinned v2 harness (the harness itself is NOT executed).
# Never invokes security, never touches a keychain, never signals any process except the dummy (exact-identity gated).
# Unrelated processes' command lines are never printed or stored (names of denylist matches only).
# Usage: fix01_real_probe.zsh <v2 harness> <expected sha256> <evidence-dir> <temp-dir-that-must-not-exist>
emulate -L zsh; zmodload zsh/datetime zsh/zselect
H=${1:?}; EXPECT=${2:?}; OUT=${3:?}; T=${4:?}
[[ $T == /private/tmp/claude-501/*/scratchpad/fix01_tmp_* ]] || { print -r -- 'BLOCKED: temp dir must be a scratchpad fix01_tmp_* path'; exit 3; }
L=$OUT/fix01_real_run.log; [[ -d $OUT && -w $OUT ]] && : > $L || { print -r -- 'BLOCKED: evidence dir not writable'; exit 3; }
integer NP=0 NF=0 NI=0
log() { print -r -- "$*" >> $L; }
res() { log "$1  [$2] $3"; case $1 in PASS) (( NP++ ));; FAIL) (( NF++ ));; *) (( NI++ ));; esac; }
chk() { local id=$1 d=$2; shift 2; if "$@"; then res PASS $id "$d"; else res FAIL $id "$d"; fi; }
T_0=$EPOCHREALTIME
log "# FIX01 real probe $(/bin/date -u +%FT%TZ) macOS=$(/usr/bin/sw_vers -productVersion) build=$(/usr/bin/sw_vers -buildVersion) driver_pid=$$ uid=$(/usr/bin/id -u)"
log "probe_sha256=$(/usr/bin/shasum -a 256 $0 | /usr/bin/cut -d' ' -f1)"
HH=$(/usr/bin/shasum -a 256 $H | /usr/bin/cut -d' ' -f1); log "harness_v2_sha256=$HH"
[[ $HH == $EXPECT ]] || { log 'BLOCKED: harness hash mismatch'; exit 3; }
[[ ! -e $T ]] || { log 'BLOCKED: temp dir exists'; exit 3; }
SCN=$(/usr/bin/awk '/^DENYT=\(/{f=1} /^t16_scan$/{exit} f{print}' $H)
log "extract v2 scanner lines=${#${(f)SCN}} sha256=$(print -rn -- "$SCN" | /usr/bin/shasum -a 256 | /usr/bin/cut -c1-16)"
chk A-1 'extracted scanner block present (DENYT, ps_read, ps_parse, deny_hit, t16_scan)' eval '[[ $SCN == *"ps_read()"* && $SCN == *"ps_parse()"* && $SCN == *"deny_hit()"* && $SCN == *"t16_scan()"* ]]'
chk A-2 'extracted block contains no "security", no Keychains path, no pkill/killall' eval '[[ $SCN != *security* && $SCN != *Keychains* && $SCN != *pkill* && $SCN != *killall* ]]'
/bin/mkdir -m 700 -- "${T:?}" || exit 3
TD=$T; ME=$$; SCANMIN=20; SCANTO=10; SCANF=''; NROWS=0
now() { builtin print -r -- $EPOCHREALTIME; }
eval "$SCN"
# ---- R-1 real table, harness-equivalent settings ----
PSB=/bin/ps; t16_scan; log "R-1 real scan: SCAN=$SCAN rows=$NROWS why='$SCANWHY' hits=[$HIT]"
chk R-1a 'real scan completes with a validated table (not UNKNOWN)' eval '[[ $SCAN != UNKNOWN && $NROWS -ge 20 ]]'
chk R-1b 'real scan DETECTS the running prohibited apps (Claude) -> STOP' eval '[[ $SCAN == DETECTED && ${(L)HIT} == *claude* ]]'
chk R-1c 'both identity sources contribute on the real table (ucomm: and comm: hits)' eval '[[ $HIT == *ucomm:* && $HIT == *comm:* ]]'
# ---- R-2 one bounded dummy: real /bin/zsh, argv[0] spoofed to a denylisted-looking name ----
A0=/fix01/osascript-fix01dummy
ARGV0=$A0 /bin/zsh -f -c 'zmodload zsh/zselect; zselect -t 2500' fix01_dummy FIX01-MARKER &
DP=$!; DS=$EPOCHREALTIME; zselect -t 50
EXPC="$A0 -f -c zmodload zsh/zselect; zselect -t 2500 fix01_dummy FIX01-MARKER"
dc=$(/bin/ps -ww -o comm= -p $DP 2>/dev/null); du=$(/bin/ps -ww -o ucomm= -p $DP 2>/dev/null); dcmd=$(/bin/ps -ww -o command= -p $DP 2>/dev/null); dpp=$(/bin/ps -o ppid= -p $DP 2>/dev/null)
log "R-2 dummy pid=$DP ppid=${dpp//[[:space:]]/} exe=/bin/zsh argv0=$A0 : comm='$dc' ucomm='${du//[[:space:]]/}' command='$dcmd'"
chk R-2a 'dummy alive with the exact expected argv and parent = driver' eval '[[ $dcmd == $EXPC && ${dpp//[[:space:]]/} == $$ ]]'
chk R-2b 'REAL: comm reports the caller-chosen argv[0]' eval '[[ $dc == $A0 ]]'
chk R-2c 'REAL: ucomm reports the kernel name of the executed file (zsh), NOT argv[0]' eval '[[ ${du//[[:space:]]/} == zsh ]]'
ME=1; t16_scan; h2=$HIT; s2=$SCAN; ME=$$   # ME=1: a real row, so the dummy (parent = driver) is not excluded
log "R-2 scan with ME=1 (dummy not a child of ME): SCAN=$s2 hits=[$h2]"
chk R-2d 'v2 scan reports the spoofed argv[0] via comm (conservative STOP on a denylisted argv[0])' eval '[[ $s2 == DETECTED && ";$h2;" == *";comm:osascript-fix01dummy;"* ]]'
chk R-2e 'v2 scan does NOT attribute the dummy to ucomm (its real executable is zsh)' eval '[[ $s2 == DETECTED && ";$h2;" != *"ucomm:osascript-fix01"* ]]'
t16_scan; h3=$HIT; s3=$SCAN
chk R-2f 'v2 scan excludes the dummy when it is the scanning process child (ppid==ME in both reads)' eval '[[ $s3 == DETECTED && ";$h3;" != *osascript-fix01dummy* ]]'
# ---- R-3 fail-closed against real failures (no extra long-lived processes) ----
PSB=/usr/bin/false; t16_scan; log "R-3a PSB=/usr/bin/false: SCAN=$SCAN why='$SCANWHY'"
chk R-3a 'real command failure (exit 1) -> UNKNOWN' eval '[[ $SCAN == UNKNOWN && $SCANWHY == *"exit status 1"* ]]'
PSB=$T/no-such-ps; t16_scan; log "R-3b PSB=<nonexistent>: SCAN=$SCAN why='$SCANWHY'"
chk R-3b 'missing scanner binary (exec failure) -> UNKNOWN' eval '[[ $SCAN == UNKNOWN && $SCANWHY == *"exit status 127"* ]]'
PSB=/usr/bin/true; t16_scan; log "R-3c PSB=/usr/bin/true (rc 0, no output): SCAN=$SCAN why='$SCANWHY'"
chk R-3c 'successful exit with EMPTY output -> UNKNOWN (never CLEAN)' eval '[[ $SCAN == UNKNOWN && $SCANWHY == *"empty output"* ]]'
PSB=/bin/ps; SCANMIN=1000000; t16_scan; log "R-3d SCANMIN=1000000: SCAN=$SCAN why='$SCANWHY'"; SCANMIN=20
chk R-3d 'real table below the plausibility floor -> UNKNOWN' eval '[[ $SCAN == UNKNOWN && $SCANWHY == *"implausible row count"* ]]'
ME=4000000; t16_scan; log "R-3e ME=<pid not in table>: SCAN=$SCAN why='$SCANWHY'"; ME=$$
chk R-3e 'own pid absent from the real table -> UNKNOWN' eval '[[ $SCAN == UNKNOWN && $SCANWHY == *"own pid"* ]]'
chk R-3f 'no scan temp file left after any read' eval '[[ -z $(print -l $T/r2d-scan.*(N)) ]]'
# ---- E. dummy exit (natural, bounded) ----
e=$(( DS + 40 )); while kill -0 $DP 2>/dev/null; do (( EPOCHREALTIME < e )) || break; zselect -t 20; done
wait $DP 2>/dev/null; drc=$?; alive=0; kill -0 $DP 2>/dev/null && alive=1; sig=no
if (( alive )); then
  if [[ $(/bin/ps -ww -o command= -p $DP 2>/dev/null) == $EXPC && ${$(/bin/ps -o ppid= -p $DP 2>/dev/null)//[[:space:]]/} == $$ ]]; then kill -TERM $DP; sig=TERM; zselect -t 100
  else log 'E identity NOT confirmed - dummy NOT signalled'; fi; fi
log "E dummy exit: alive_after_bound=$alive exit_status=$drc after=$(( EPOCHREALTIME - DS ))s signal_sent=$sig (no other process signalled)"
chk E-1 'dummy exited naturally with the zselect timeout status (1), no signal sent' eval '[[ $alive == 0 && $drc == 1 && $sig == no ]]'
po=$(/bin/ps -ww -o pid= -p $DP 2>/dev/null); prc=$?
chk E-2 'after exit: ps rc=1 and no record' eval '[[ $prc == 1 && -z ${po//[[:space:]]/} ]]'
ME=1; PSB=/bin/ps; t16_scan; chk E-3 'after exit: v2 scan (validated, ME=1) no longer reports the dummy' eval '[[ $SCAN != UNKNOWN && $HIT != *osascript-fix01dummy* ]]'
/bin/rmdir -- "${T:?}"
chk F-1 'temp dir removed (exact guarded path)' eval '[[ ! -e $T ]]'
/usr/bin/pgrep -f FIX01-MARKER >/dev/null; pr=$?
chk F-2 'no process carrying the FIX01 marker remains (pgrep rc=1 exactly)' eval '[[ $pr == 1 ]]'
log "elapsed=$(( EPOCHREALTIME - T_0 ))s"
log "TOTAL PASS=$NP FAIL=$NF INFO=$NI"
(( NF == 0 ))
