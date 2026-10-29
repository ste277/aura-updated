#!/bin/zsh -f
# AURA-GOV-02-RE-4 real-environment process-scan probe. READ-ONLY process inspection plus ONE bounded test-owned dummy.
# Runs the EXACT T1-6 and is_wd() code extracted from the hash-pinned harness (the harness itself is NOT executed).
# Never invokes security, never touches a keychain, never signals any process other than the dummy (and only after
# exact-identity verification). Unrelated processes' command lines are never printed or stored.
# Usage: re4_probe.zsh <harness> <evidence-dir> <temp-dir-that-must-not-exist>
emulate -L zsh; zmodload zsh/datetime zsh/zselect
H=${1:?}; OUT=${2:?}; T=${3:?}
[[ $T == /private/tmp/claude-501/*/scratchpad/re4_tmp_* ]] || { print -r -- 'BLOCKED: temp dir must be a scratchpad re4_tmp_* path'; exit 3; }
EXPECT=b9dd4d431a2864d31a55a017f1cf9f9ae551e9b9081881f4f90dd1ef0bf7c254
L=$OUT/re4_run.log; [[ -d $OUT && -w $OUT ]] && : > $L || { print -r -- "BLOCKED: evidence dir not writable"; exit 3; }; integer NP=0 NF=0 NI=0
log() { print -r -- "$*" >> $L; }
res() { log "$1  [$2] $3"; case $1 in PASS) (( NP++ ));; FAIL) (( NF++ ));; *) (( NI++ ));; esac; }
chk() { local id=$1 d=$2; shift 2; if "$@"; then res PASS $id "$d"; else res FAIL $id "$d"; fi; }
T_0=$EPOCHREALTIME
log "# RE-4 probe $(/bin/date -u +%FT%TZ) macOS=$(/usr/bin/sw_vers -productVersion) build=$(/usr/bin/sw_vers -buildVersion) $(/bin/zsh --version) driver_pid=$$ driver_ppid=$PPID uid=$(/usr/bin/id -u)"
# ---- A. pin and extract ----
HH=$(/usr/bin/shasum -a 256 $H | /usr/bin/cut -d' ' -f1); log "harness_sha256=$HH"
[[ $HH == $EXPECT ]] || { log "BLOCKED: harness hash mismatch"; exit 3; }
[[ ! -e $T ]] || { log "BLOCKED: temp dir exists"; exit 3; }
ISWD=$(/usr/bin/awk '/^is_wd\(\) \{/{f=1} f{print} f&&/== \$3 \]\]; \}$/{exit}' $H)
T16=$(/usr/bin/awk '/^DENY=/{f=1} f{print} f&&/\/usr\/bin\/sort -u/{exit}' $H)
log "extract is_wd lines=$(print -r -- "$ISWD" | /usr/bin/wc -l | /usr/bin/tr -d ' ') sha256=$(print -rn -- "$ISWD" | /usr/bin/shasum -a 256 | /usr/bin/cut -c1-16)"
log "extract T1-6 lines=$(print -r -- "$T16" | /usr/bin/wc -l | /usr/bin/tr -d ' ') sha256=$(print -rn -- "$T16" | /usr/bin/shasum -a 256 | /usr/bin/cut -c1-16)"
chk A-1 'extracted is_wd is exactly 4 lines and T1-6 exactly 5 lines' eval '[[ $(print -r -- "$ISWD" | /usr/bin/wc -l) -eq 4 && $(print -r -- "$T16" | /usr/bin/wc -l) -eq 5 ]]'
chk A-2 'extracted code contains no literal "security", no keychain dir, no signal other than kill -0' eval '[[ "$ISWD$T16" != *security* && "$ISWD$T16" != *Keychains* ]] && ! print -r -- "$ISWD$T16" | /usr/bin/grep -E "kill +-[^0]|pkill|killall" >/dev/null'
eval "$ISWD"
t16() { local HIT DENY; eval "$T16"; print -r -- "$HIT"; }
PSB=/bin/ps
# ---- B. real /bin/ps format ----
O=$(/bin/ps -ww -axo pid=,ppid=,comm= 2>/dev/null); rc=$?
n=$(print -r -- "$O" | /usr/bin/wc -l | /usr/bin/tr -d ' ')
good=$(print -r -- "$O" | /usr/bin/grep -cE '^ *[0-9]+ +[0-9]+ +[^ ]')
abs=$(print -r -- "$O" | /usr/bin/grep -cE '^ *[0-9]+ +[0-9]+ +/')
mx=$(print -r -- "$O" | /usr/bin/awk '{ if (length($0)>m) m=length($0) } END{print m}')
lead=$(print -r -- "$O" | /usr/bin/grep -cE '^ ')
log "B-1 cmd='/bin/ps -ww -axo pid=,ppid=,comm=' rc=$rc lines=$n format_ok=$good comm_absolute_path=$abs comm_not_absolute=$(( n - abs )) leading_space_lines=$lead max_line_len=$mx (listing itself NOT stored)"
chk B-1 'real -axo: rc=0, every line is "<pid> <ppid> <comm>"' eval '[[ $rc == 0 && $n -gt 0 && $good == $n ]]'
O=''
O2=$(/bin/ps -ww -o pid=,ppid=,comm= -p 999999 2>/dev/null); rc2=$?; E2=$(/bin/ps -ww -o pid=,ppid=,comm= -p 999999 2>&1 >/dev/null)
log "B-2 cmd='/bin/ps -ww -o pid=,ppid=,comm= -p 999999' rc=$rc2 stdout_len=${#O2} stdout_nonspace=${#${O2//[[:space:]]/}} stderr_len=${#E2}"
chk B-2 'absent PID: non-zero rc and no record on stdout (whitespace-only at most)' eval '[[ $rc2 != 0 && -z ${O2//[[:space:]]/} ]]'
# ---- C. the single dummy: the REAL /bin/zsh (no copy; a copied platform binary is SIGKILLed by macOS - attempt 2),
#      started with argv[0] set via zsh's ARGV0 so its name matches the denylist prefix "osascript" ----
/bin/mkdir -m 700 "${T:?}" || exit 3
A0=/re4/osascript-re4dummy                     # argv[0] STRING ONLY - no such file
KC="$T/r2d-run.RE4DUMMY/r2d.keychain-db"     # STRING ONLY - never created; not a keychain
SEC="$T/no-such-tool/RE4-MARKER"              # STRING ONLY - stands where the real watchdog has its security path
NW=7; LIFE=3000                                # dummy lives 30 s (zselect, centiseconds); no fork, no network, no files
ARGV0=$A0 /bin/zsh -f -c 'zmodload zsh/zselect; zselect -t 3000' r2d_watchdog $NW $KC $SEC &   # same argv shape as the real watchdog
DP=$!; DSTART=$EPOCHREALTIME
log "C-1 dummy started pid=$DP expected_parent=$$ exe=/bin/zsh argv0=$A0 lifetime_cs=$LIFE"
zselect -t 50
EXP="$A0 -f -c zmodload zsh/zselect; zselect -t 3000 r2d_watchdog $NW $KC $SEC"
c_ww=$(/bin/ps -ww -o command= -p $DP 2>/dev/null); r1=$?
c_no=$(/bin/ps -o command= -p $DP 2>/dev/null); r2=$?
c_w1=$(/bin/ps -w -o command= -p $DP 2>/dev/null)
pp=$(/bin/ps -ww -o ppid= -p $DP 2>/dev/null); r3=$?
row=$(/bin/ps -ww -o pid=,ppid=,comm= -p $DP 2>/dev/null)
st=$(/bin/ps -o stat= -p $DP 2>/dev/null)
log "C-2 command= (-ww) rc=$r1 len=${#c_ww} value=$c_ww"
log "C-3 command= (no -w, stdout=pipe) rc=$r2 len=${#c_no} ; (-w) len=${#c_w1}"
log "C-4 ppid= raw='$pp' rc=$r3 ; row='$row' ; stat='$st'"
chk C-2 'real -ww command= of the dummy equals the exact expected argv' eval '[[ $c_ww == $EXP ]]'
if [[ ${#c_no} -lt ${#c_ww} ]]; then res INFO C-3 "without -ww the command is TRUNCATED to ${#c_no} chars (-ww is required)"; else res INFO C-3 "without -ww the command was NOT truncated (len ${#c_no}) when stdout is a pipe"; fi
chk C-4 'real ppid= (leading spaces stripped) equals the driver pid' eval '[[ ${pp//[[:space:]]/} == $$ ]]'
chk C-5 'real row parses: pid, ppid' eval '[[ ${${=row}[1]} == $DP && ${${=row}[2]} == $$ ]]'
COMM=${${=row}[3]}; log "C-6 comm reported for the dummy: '$COMM' (exec path /bin/zsh, argv[0] $A0)"
if [[ $COMM == $A0 ]]; then res INFO C-6 'comm= reports argv[0] (caller-controlled), NOT the executable path'; elif [[ $COMM == /bin/zsh ]]; then res INFO C-6 'comm= reports the executable path'; else res INFO C-6 "comm= reports neither ($COMM)"; fi
# ---- D. scanner validation (EXACT harness code, real /bin/ps) ----
chk RE4-01 'is_wd(dummy, N=7, parent=driver) -> MATCH' is_wd $DP $NW $$
chk RE4-02a 'is_wd with parent=1 -> reject' eval '! is_wd $DP $NW 1'
chk RE4-02b 'is_wd with parent=driver_ppid -> reject' eval '! is_wd $DP $NW $PPID'
chk RE4-03a 'is_wd with wrong N (8) -> reject' eval '! is_wd $DP 8 $$'
chk RE4-03b 'is_wd with N=7x (non-exact) -> reject' eval '! is_wd $DP 7x $$'
K0=$KC; S0=$SEC
KC=${K0%-db}; chk RE4-03c 'partial keychain path (prefix) -> reject' eval '! is_wd $DP $NW $$'
KC="$T/r2d-run.OTHER000/r2d.keychain-db"; chk RE4-03d 'different keychain path -> reject' eval '! is_wd $DP $NW $$'
KC=$K0; SEC=${S0%-MARKER}; chk RE4-03e 'partial security path (prefix) -> reject' eval '! is_wd $DP $NW $$'
SEC=$S0; KC=''; chk RE4-03f 'empty KC -> reject' eval '! is_wd $DP $NW $$'
KC=$K0
chk RE4-07a 'malformed pid "12a" -> reject before any lookup' eval '! is_wd 12a $NW $$'
chk RE4-07b 'empty pid -> reject' eval '! is_wd "" $NW $$'
# T1-6 on the REAL table
ME=$$; h1=$(t16); ME=999999; h2=$(t16)
log "D-1 T1-6 real scan (ME=driver) hits=[$h1]"
log "D-2 T1-6 real scan (ME=999999, exclusion disabled) hits=[$h2]"
chk RE4-01b 'T1-6 real scan finds the denylisted-named dummy when it is NOT the harness child' eval '[[ ";$h2" == *";osascript-re4dummy;"* ]]'
chk RE4-02c 'T1-6 real scan EXCLUDES the dummy when its parent is the harness (ppid==ME)' eval '[[ ";$h1" != *";osascript-re4dummy;"* ]]'
chk RE4-01c 'T1-6 real scan detects the running Claude processes (expected STOP while this session runs)' eval '[[ ${(L)h1} == *claude* ]]'
# synthetic, non-executing parser inputs (zsh functions as PSB: no extra processes)
fake_axo() { print -r -- "$FAKE"; }
FAKE=$'  10     1 /Applications/X.app/Contents/MacOS/notclaude\n  11     1 /x/Claude\n  12     1 /x/osascript\n  13 424242 /x/osascript\n  14     1 /usr/bin/zsh\n  15     1 /x/Claude Helper (Renderer)\n  16     1 /x/my-osascript\n  17     1 osascript\n garbage\n  18     1 /x/TeamViewer\n  19     1 /x/claudette\n424242   1 /x/osascript'
PSB=fake_axo; ME=424242; hs=$(t16); PSB=/bin/ps
log "D-3 T1-6 synthetic hits=[$hs]"
chk RE4-04a 'synthetic: Claude, Claude Helper, osascript (path and bare), TeamViewer detected' eval '[[ ";$hs" == *";Claude;"* && ";$hs" == *";Claude Helper (Renderer);"* && ";$hs" == *";osascript;"* && ";$hs" == *";TeamViewer;"* ]]'
chk RE4-04b 'synthetic: notclaude, my-osascript, zsh, malformed line NOT detected' eval '[[ ";$hs" != *notclaude* && ";$hs" != *my-osascript* && ";$hs" != *";zsh;"* && ";$hs" != *garbage* ]]'
PSB=fake_axo; FAKE=$'  13 424242 /x/osascript\n424242   1 /x/osascript'; ME=424242; hx=$(t16); PSB=/bin/ps
chk RE4-04c 'synthetic: harness pid itself and its child (ppid==ME) excluded' eval '[[ -z $hx ]]'
PSB=fake_axo; FAKE=$'  13 424242 /x/osascript\n  20    13 /x/osascript'; ME=424242; hg=$(t16); PSB=/bin/ps
log "D-4 T1-6 synthetic grandchild hits=[$hg]"
if [[ -n $hg ]]; then res INFO RE4-04d 'synthetic: a GRANDCHILD of the harness is NOT excluded (only pid==ME or ppid==ME) - fail-safe STOP'; fi
if [[ ";$hs" == *";claudette;"* ]]; then res INFO RE4-04e 'synthetic: prefix match also hits "claudette" (over-broad, fail-safe STOP)'; fi
fake_cmd() { case "$*" in *command=*) print -r -- "$FCMD";; *ppid=*) print -r -- "$FPP";; esac; }
PSB=fake_cmd; FPP=" $$"
FCMD=''; chk RE4-07c 'synthetic: missing command record -> reject' eval '! is_wd $DP $NW $$'
FCMD=${EXP[1,80]}; chk RE4-07d 'synthetic: truncated command (80 cols) -> reject' eval '! is_wd $DP $NW $$'
FCMD="$EXP extra"; chk RE4-07e 'synthetic: trailing extra argument -> reject' eval '! is_wd $DP $NW $$'
FCMD="$EXP-x"; chk RE4-07f 'synthetic: lookalike suffix on security path -> reject' eval '! is_wd $DP $NW $$'
FCMD="/bin/zsh -c x r2d_watch $NW $KC $SEC"; chk RE4-04f 'synthetic: partial name r2d_watch -> reject' eval '! is_wd $DP $NW $$'
FCMD="/bin/zsh -c x xr2d_watchdog $NW $KC $SEC"; chk RE4-04g 'synthetic: lookalike token xr2d_watchdog -> reject' eval '! is_wd $DP $NW $$'
FCMD=$EXP; FPP=''; chk RE4-07g 'synthetic: missing ppid record -> reject' eval '! is_wd $DP $NW $$'
FPP='     1'; chk RE4-07h 'synthetic: reparented to launchd (ppid 1) -> reject' eval '! is_wd $DP $NW $$'
FPP="${$}0"; chk RE4-07i 'synthetic: ppid with an extra digit -> reject' eval '! is_wd $DP $NW $$'
FPP=" $$ "; chk RE4-07j 'synthetic control: exact record with padded ppid -> MATCH' is_wd $DP $NW $$
PSB=/bin/ps
# ---- E. disappearance (natural exit, bounded) ----
BOUND=45; e=$(( DSTART + BOUND ))
while kill -0 $DP 2>/dev/null; do (( EPOCHREALTIME < e )) || break; zselect -t 20; done
wait $DP 2>/dev/null; drc=$?; alive=0; kill -0 $DP 2>/dev/null && alive=1
log "E-1 dummy natural exit: alive=$alive exit_status=$drc after=$(( EPOCHREALTIME - DSTART ))s bound=${BOUND}s"
signalled=no
if (( alive )); then   # only if the natural exit did not happen within the bound: exact-identity checked signal
  if [[ $(/bin/ps -ww -o command= -p $DP 2>/dev/null) == $EXP && ${$(/bin/ps -ww -o ppid= -p $DP 2>/dev/null)//[[:space:]]/} == $$ ]]; then
    kill -TERM $DP; signalled=TERM; integer i; for i in {1..50}; do kill -0 $DP 2>/dev/null || break; zselect -t 10; done
  else log "E-1 identity NOT confirmed - dummy NOT signalled"; fi
fi
log "E-2 signal sent to dummy: $signalled (no other process was signalled at any point)"
chk RE4-05a 'dummy exited by itself within its bound (no signal needed)' eval '[[ $signalled == no && $alive == 0 ]]'
po=$(/bin/ps -ww -o pid=,ppid=,comm= -p $DP 2>/dev/null); prc=$?
log "E-3 after exit: '/bin/ps -ww -o pid=,ppid=,comm= -p $DP' rc=$prc output_len=${#po}"
chk RE4-05b 'after exit: real ps returns non-zero and no record' eval '[[ $prc != 0 && -z $po ]]'
chk RE4-05c 'after exit: is_wd rejects (no false liveness)' eval '! is_wd $DP $NW $$'
ME=999999; h3=$(t16); chk RE4-05d 'after exit: T1-6 real scan no longer reports the dummy' eval '[[ ";$h3" != *";osascript-re4dummy;"* ]]'
el=$(( EPOCHREALTIME - T_0 )); log "RE4-06 total probe elapsed=${el}s; every wait loop bounded (dummy 45 s, signal wait 5 s)"
chk RE4-06 'probe finished within 90 s overall' eval '(( el < 90 ))'
# ---- F. cleanup of this ticket's temp artifacts only (exact, guarded paths) ----
/bin/rmdir -- "${T:?}"
chk F-1 'temp dir removed (exact guarded paths only)' eval '[[ ! -e $T ]]'
chk F-2 'no process carrying the RE4 marker remains' eval '! /usr/bin/pgrep -f RE4-MARKER >/dev/null'
log "TOTAL PASS=$NP FAIL=$NF INFO=$NI"
(( NF == 0 ))
