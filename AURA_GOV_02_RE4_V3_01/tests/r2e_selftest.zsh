#!/bin/zsh -f
# AURA-GOV-02-R2E mock-only self-test runner.
# Every harness run happens under a sandbox-exec tripwire that DENIES exec of /usr/bin/security,
# with a mock toolchain (R2D_MOCK_DIR), an isolated HOME and TMPDIR per scenario, and scripted owner answers.
# Nothing here creates, unlocks, locks or deletes a real keychain. Usage: r2e_selftest.zsh <empty-work-dir> [filter]
emulate -L zsh; zmodload zsh/datetime; setopt extended_glob
R=${0:A:h:h}; H=$R/r2d_prototype.zsh; MOCKSRC=$R/mock
W=${1:?usage: r2e_selftest.zsh <work-dir> [filter]}; FILTER=${2:-}
[[ -d $W && -z $(ls -A $W) ]] || { print -r -- "work dir must exist and be empty"; exit 1; }
REALKC=${HOME:?}/Library/Keychains   # the real user's keychain dir: DENIED to every harness run (never read here)
PROF="(version 1)(allow default)(deny process-exec (literal \"/usr/bin/security\"))(deny process-exec (literal \"/bin/ps\"))(deny mach-lookup (global-name \"com.apple.SecurityServer\") (global-name \"com.apple.securityd\") (global-name \"com.apple.securityd.xpc\"))(deny file-read* file-write* (subpath \"$REALKC\"))"
HS=$(cat $H; print -n x); HS=${HS%x}
HHASH=$(shasum -a 256 $H | cut -d' ' -f1)
RES=$W/results.txt; integer NP=0 NF=0
{ print -r -- "# R2E self-test run $(date -u +%FT%TZ)  filter='${FILTER}'  macOS=$(sw_vers -productVersion)  $(zsh --version)"
  print -r -- "# MODE: SIMULATED-MOCK only (intended; the KERNEL_tripwire lines at the end carry the evidence)"
  print -r -- "# profile: $PROF"
  (cd $R && shasum -a 256 r2d_prototype.zsh tests/r2e_selftest.zsh mock/security mock/ps mock/pmset mock/csrutil) | sed 's/^/# sha256 /'; } > $RES
ok()  { print -r -- "PASS  [$CUR] $1" >> $RES; (( NP++ )); }
bad() { print -r -- "FAIL  [$CUR] $1" >> $RES; (( NF++ )); }
chk() { local d=$1; shift; if "$@"; then ok "$d"; else bad "$d"; fi; }
want() { [[ -z $FILTER || $1 == ${~FILTER} ]]; }
T_START=$EPOCHREALTIME; OWNED=''; : > $W/kills.txt
# a PID is killed only if it is test-owned (recorded here) AND its argv is an R2D harness/watchdog/decoy of this run
FIFOS=''
is_ours() {  # recorded PID AND (direct child of this runner with an R2D/R2E argv, OR a watchdog whose argv names this work dir)
  local a pp; a=$(/bin/ps -ww -o command= -p $1 2>/dev/null); [[ -n $a ]] || return 1     # exact-PID query only (no table listing)
  pp=$(/bin/ps -o ppid= -p $1 2>/dev/null); pp=${pp//[[:space:]]/}
  if [[ $pp == $$ ]]; then [[ $a == *(R2D locked-keychain prototype harness|r2e_decoy|r2d_watchdog)* ]]; return; fi
  [[ $a == *" r2d_watchdog "*"$W/"* ]]; }
killown() { is_ours $1 || { print -r -- "$(date -u +%FT%TZ) [$CUR] NOT killed pid $1 (not provably test-owned) ($2)" >> $W/kills.txt; return 1; }
  print -r -- "$(date -u +%FT%TZ) [$CUR] kill -9 test-owned pid $1 ($2)" >> $W/kills.txt; kill -9 $1 2>/dev/null; }
bwait() {   # $1 pid  $2 seconds -> 0 and BWRC=exit status if it ended in time; else kill -9 (test-owned only), BWRC=124, return 1
  local e=$(( EPOCHREALTIME + $2 ))
  while kill -0 $1 2>/dev/null; do (( EPOCHREALTIME < e )) || { killown $1 "timeout ${2}s" && gone $1 30 && wait $1 2>/dev/null; BWRC=124; return 1; }; sleep 0.1; done
  wait $1 2>/dev/null; BWRC=$?; return 0; }
gone() { local i; for i in {1..${2:-50}}; do kill -0 $1 2>/dev/null || return 0; sleep 0.1; done; return 1; }
reap_all() { local p; for p in ${=OWNED}; do kill -0 $p 2>/dev/null && killown $p 'runner exit' && gone $p 20; done; rm -f ${=FIFOS}; }
trap reap_all EXIT; trap 'exit 130' INT TERM HUP

# ---------- scenario plumbing ----------
scen() { CUR=$1; SD=$W/$1; mkdir -p $SD/mock $SD/home $SD/tmp; cp $MOCKSRC/* $SD/mock/; chmod 700 $SD/mock/*
  M=$SD/mock; HM=$SD/home; TT=$SD/tmp; : > $SD/ans; ENVS=(); }
answers() { rm -f $SD/ans; print -rl -- "$@" > $SD/ans; }
base_env() { REPLY_ENV=(HOME=$HM TMPDIR=$TT/ TERM=dumb R2D_MOCK_DIR=$M R2D_MOCK_ANSWERS=$SD/ans R2D_MOCK_RUNNER_PID=$$ $ENVS); }
run() {   # args... -> RC, LOGF
  base_env
  sandbox-exec -p $PROF /usr/bin/env -i $REPLY_ENV /bin/zsh -f -c "$HS" r2d_prototype "$@" </dev/null >$SD/out 2>&1 &
  local p=$!; LASTP=$p; OWNED+=" $p"; bwait $p ${RUNMAX:-240}; RC=$BWRC
  [[ $RC == 124 && -z ${EXPECT_TIMEOUT:-} ]] && bad "runner: harness exceeded ${RUNMAX:-240}s bound (killed pid $p)"
  LOGF=$(print -l $HM/aura-r2b-evidence/r2d-*-mock.log(N.om) | head -1)
}
L()   { [[ -n $LOGF ]] && grep -qF -- "$1" $LOGF; }
nL()  { ! L "$1"; }
calls_none() { [[ ! -s $M/calls.log ]]; }
calls_has()  { [[ -f $M/calls.log ]] && grep -qE -- "$1" $M/calls.log; }
no_residue() { [[ -z $(print -l $TT/r2d-run.*(N)) && ! -e $TT/r2d-lock ]]; }
kc_args_ok() { [[ ! -f $M/calls.log ]] && return 0   # last arg must be exactly <scenario TMPDIR>/r2d-run.<8 alnum>/r2d.keychain-db
  ! awk -v tt="$TT" '{ $1=""; sub(/^ /,"") } $1=="list-keychains"||$1=="default-keychain"||$1=="-i" {next}
    { p=$NF; pre=tt "/r2d-run."; ok = (substr(p,1,length(pre))==pre); r=substr(p,length(pre)+1)
      if (ok && r ~ /^[A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9][A-Za-z0-9]\/r2d\.keychain-db$/) next; bad=1; print }
    END{exit !bad}' $M/calls.log; }
no_secret() { local v f; [[ -f $M/secrets.seen ]] || return 0
  for v in ${(f)"$(<$M/secrets.seen)"}; do for f in $HM/aura-r2b-evidence/*(N.) $SD/out $M/calls.log(N); do grep -qF -- "$v" $f && return 1; done; done; return 0; }
generic() {   # assertions every harness scenario must satisfy
  chk 'tripwire: no denied exec of real security (stderr text layer)' trip_clean
  chk 'no synthetic secret value in log, stdout or mock argv log' no_secret
  chk 'every keychain-targeting call carries the guarded r2d path (T1-8)' kc_args_ok
  chk 'log records exactly one CLEANUP line (idempotent teardown)' eval '[[ $(grep -c "^R2D CLEANUP:" $LOGF) == 1 ]]'
  chk 'log records the VERDICT line' L 'R2D VERDICT:'
}
# tripwire layer 1 (stderr text) - a security exec denial in any captured output; missing stdout evidence = NOT clean
trip_hit() { grep -qsiE '(/security([^-_A-Za-z0-9.]|$).*operation not permitted|operation not permitted.*/security([^-_A-Za-z0-9.]|$))' "$@"; }
trip_clean() { [[ -r $SD/out ]] || return 1; local f; f=($SD/out $SD/obs.out(N) ${LOGF:+$LOGF}); ! trip_hit $f; }
# tripwire layer 2 (kernel sandbox log; independent of stderr redirection) - exec denials naming /usr/bin/security
FOREIGN='(identityservice)'   # system daemons seen denied by THEIR OWN sandboxes (not ours); everything else counts (fail-closed)
kern_hit() { grep -E -e 'deny\([0-9]+\) process-exec[*]? /usr/bin/security$' -e 'deny\([0-9]+\) mach-lookup com\.apple\.(SecurityServer|securityd)' -e "deny\([0-9]+\) file-[a-z*-]+ ${REALKC}(/|$)" "$@" | grep -vE "Sandbox: ${FOREIGN}\([0-9]+\) deny" | grep -q .; }
T_START_LOCAL=$(date '+%Y-%m-%d %H:%M:%S')
ANS_PRE=(y y y)
ANS_G1=($ANS_PRE n n n n n n  U k C  1 U k C  U k C U k C  2 n U k C)

# ---------- 0. tripwire self-check (uses a dummy executable, never real security) ----------
if want 'T0*'; then scen T0_tripwire
  print -r -- '#!/bin/sh' > $SD/dummy_exec; print -r -- 'echo RAN' >> $SD/dummy_exec; chmod 700 $SD/dummy_exec
  o=$(sandbox-exec -p "(version 1)(allow default)(deny process-exec (literal \"$SD/dummy_exec\"))" $SD/dummy_exec 2>&1); rc=$?
  chk 'sandbox-exec deny-exec profile blocks a denied literal path (rc!=0, did not run)' eval '[[ $rc != 0 && $o != *RAN* ]]'
  chk 'profile used for all runs denies /usr/bin/security literally' eval '[[ $PROF == *"(deny process-exec (literal \"/usr/bin/security\"))"* ]]'
  # classifier unit tests (synthetic lines; no real security involved)
  tl() { print -r -- "$1" > $SD/tl.txt; trip_hit $SD/tl.txt; }; kl() { print -r -- "$1" > $SD/kl.txt; kern_hit $SD/kl.txt; }
  chk 'text: zsh exec denial of /usr/bin/security is detected' tl 'zsh:1: operation not permitted: /usr/bin/security'
  chk 'text: sandbox-exec execvp denial of security is detected' tl "sandbox-exec: execvp() of '/usr/bin/security' failed: Operation not permitted"
  chk 'text: env exec denial of security is detected' tl 'env: /usr/bin/security: Operation not permitted'
  chk 'text: blocked setuid /bin/ps is NOT classified as a security denial' eval '! tl "zsh:1: operation not permitted: /bin/ps"'
  chk 'text: unrelated permission error is NOT classified' eval '! tl "rm: /x/y: Operation not permitted"'
  chk 'text: a path merely containing security- is NOT classified' eval '! tl "zsh:1: operation not permitted: /opt/security-scanner"'
  chk 'text: path-first order "/x/security-notes: Operation not permitted" is NOT classified' eval '! tl "cat: /x/security-notes: Operation not permitted"'
  chk 'text: path-first order "/usr/bin/security: Operation not permitted" IS classified' tl '/usr/bin/security: Operation not permitted'
  chk 'kernel: deny(1) process-exec* /usr/bin/security is detected' kl 'kernel[0:1] (Sandbox) Sandbox: zsh(42) deny(1) process-exec* /usr/bin/security'
  chk 'kernel: deny of /bin/ps is NOT classified' eval '! kl "kernel[0:1] (Sandbox) Sandbox: zsh(42) deny(1) process-exec* /bin/ps"'
  chk 'kernel: denied mach-lookup to SecurityServer IS classified' kl 'kernel[0:1] (Sandbox) Sandbox: zsh(42) deny(1) mach-lookup com.apple.SecurityServer'
  chk 'kernel: denied mach-lookup to securityd.xpc IS classified' kl 'kernel[0:1] (Sandbox) Sandbox: zsh(42) deny(1) mach-lookup com.apple.securityd.xpc'
  chk 'kernel: denied read of the real Keychains dir IS classified' kl "kernel[0:1] (Sandbox) Sandbox: zsh(42) deny(1) file-read-data $REALKC/login.keychain-db"
  chk 'kernel: a SYSTEM daemon denied by its OWN sandbox (identityservice) is NOT attributed to this run' eval '! kl "kernel[0:1] (Sandbox) Sandbox: identityservice(659) deny(1) mach-lookup com.apple.securityd.systemkeychain"'
  chk 'kernel: our zsh denied the same lookup IS classified' kl 'kernel[0:1] (Sandbox) Sandbox: zsh(42) deny(1) mach-lookup com.apple.securityd.systemkeychain'
  chk 'kernel: an UNLISTED process name (e.g. ls) is classified - attribution fails closed' kl 'kernel[0:1] (Sandbox) Sandbox: ls(42) deny(1) mach-lookup com.apple.SecurityServer'
  chk 'kernel: denied mach-lookup to an unrelated service is NOT classified' eval '! kl "kernel[0:1] (Sandbox) Sandbox: zsh(42) deny(1) mach-lookup com.apple.foo"'
  chk 'kernel: file-read of /usr/bin/security (not exec) is NOT classified' eval '! kl "kernel[0:1] (Sandbox) Sandbox: zsh(42) deny(1) file-read-data /usr/bin/security"'
  SD0=$SD; SD=$SD/nonexistent; chk 'missing stdout evidence fails safe (trip_clean false)' eval '! trip_clean'; SD=$SD0
  # live positive control with a DUMMY binary named security (never the real one), stderr suppressed
  mkdir -p $SD/bin; print -r -- '#!/bin/sh' > $SD/bin/security; print -r -- 'echo RAN' >> $SD/bin/security; chmod 700 $SD/bin/security
  TC=$(date '+%Y-%m-%d %H:%M:%S'); o=$(sandbox-exec -p "(version 1)(allow default)(deny process-exec (literal \"$SD/bin/security\"))" /bin/zsh -f -c "$SD/bin/security 2>/dev/null; print rc=\$?")
  chk 'live: denied dummy did not run even with stderr suppressed (text layer sees nothing)' eval '[[ $o == rc=127 ]]'
  sleep 2; /usr/bin/log show --start "$TC" --style compact --predicate "eventMessage CONTAINS \"$SD/bin/security\"" 2>/dev/null | sed "s#$SD/bin/security#/usr/bin/security#" > $SD/kern.txt
  chk 'live: kernel layer catches the stderr-suppressed denial (dummy path, mapped)' kern_hit $SD/kern.txt
  chk 'profile also denies securityd mach-lookup and the real Keychains dir (string check)' eval '[[ $PROF == *com.apple.SecurityServer* && $PROF == *com.apple.securityd* && $PROF == *"(subpath \"$REALKC\")"* ]]'
  chk 'full profile is valid (sandbox-exec runs /usr/bin/true)' sandbox-exec -p $PROF /usr/bin/true
  mkdir -p $SD/fakekc; print -r -- x > $SD/fakekc/f
  chk 'subpath file-read deny works (dummy dir, same rule form)' eval '! sandbox-exec -p "(version 1)(allow default)(deny file-read* file-write* (subpath \"$SD/fakekc\"))" /bin/cat $SD/fakekc/f >/dev/null 2>&1'
  chk 'harness has no literal security path outside the REAL-mode assignment' eval '[[ $(grep -c "/usr/bin/security" $H) == $(grep -cE "SEC=/usr/bin/security|!= /usr/bin/security|-T /usr/bin/security|never uses /usr/bin/security" $H) ]]'
fi

# ---------- 1. Tier 1 controls ----------
if want 'T1*'; then
scen T1_00_positive_G1; answers $ANS_G1; run --test=G1
  chk 'G1 completes (rc=0)' eval '[[ $RC == 0 ]]'
  chk 'mode recorded as MOCK' L 'mode=SIMULATED-MOCK'
  chk 'T1-9 SIP enabled logged' L 'T1-9 SIP: enabled'
  chk 'T1-6 scan + attestations logged' L 'T1-6: process scan clean; attestations y/y/y'
  chk 'T1-1 baseline captured' L 'T1-1 baseline captured'
  chk 'T1-2 ACL A restricted with identity line' L 'L0 ACL A: applications (0):'
  chk 'settings verified exactly' L 'settings: lock-on-sleep timeout=3600s'
  chk 'L1 selects attr probe (simulated)' L 'L1 RESULT: PASS probe=attr'
  chk 'L1 rejects info probe (no state difference)' L 'L1 candidate=info'
  chk 'G1 ACL A unchanged after group' L 'G1 ACL A after (controlled unlock): applications (0):'
  chk 'cleanup VERIFIED' L 'R2D CLEANUP: VERIFIED'
  chk 'verdict labelled SIMULATED-MOCK' L 'R2D VERDICT: [SIMULATED-MOCK] COMPLETED'
  chk 'no residue (run dir + lock dir removed)' no_residue
  chk 'set-keychain-settings always passed -l and -t' eval '! grep "set-keychain-settings" $M/calls.log | grep -vq -- "-l -t"'
  generic

scen T1_01_searchlist_inject; answers $ANS_PRE; ENVS=(MOCK_SL_INJECT=1); run --test=L11
  chk 'STOP when target appears in a search list' L 'R2D STOP: T1-1: target keychain appeared in a search list'
  chk 'cleanup UNVERIFIED (global state differs; no automatic correction)' L 'R2D CLEANUP: UNVERIFIED'
  chk 'no search-list write attempted' eval '! calls_has "list-keychains -s|list-keychains -d user -s"'
  generic

scen T1_02_default_not_login; answers $ANS_PRE; ENVS=(MOCK_DEFAULT_OTHER=1); run --test=G1
  chk 'STOP when default user keychain is not login' L 'R2D STOP: T1-1: default user keychain is not login'
  chk 'no create-keychain issued' eval '! calls_has create-keychain'
  chk 'only read-only global queries issued' eval '! grep -vqE "^[0-9:]+ (list-keychains|default-keychain) -d " $M/calls.log'
  chk 'no residue' no_residue; generic

scen T1_03_acl_A_open; answers $ANS_PRE; ENVS=(MOCK_ACL_A_OPEN=1); run --test=L14
  chk 'STOP when item A ACL is not applications (0)' L 'R2D STOP: T1-2: item A not applications (0)'
  chk 'keychain deleted on STOP' eval 'calls_has "delete-keychain"'; chk 'no residue' no_residue; generic

scen T1_04_acl_A_duplicate; answers $ANS_PRE; ENVS=(MOCK_DUP_A=1); run --test=L14
  chk 'duplicate A records classified OPEN(duplicate) -> STOP' eval 'L "L0 ACL A: OPEN(duplicate)" && L "R2D STOP: T1-2"'; generic

scen T1_05_path_guard_empty; answers $ANS_PRE; ENVS=(R2D_TEST_EMPTY_KC=1); run --test=L14
  chk 'T1-8 refuses keychain call with empty path' L 'R2D STOP: T1-8 keychain path guard'
  chk 'no create-keychain reached mock' eval '! calls_has create-keychain'; chk 'no residue' no_residue; generic

scen T1_06_sip_disabled; answers $ANS_PRE; ENVS=('MOCK_SIP_LINE=System Integrity Protection status: disabled.'); run --test=G1
  chk 'STOP on SIP disabled' L 'R2D STOP: T1-9'; chk 'zero security calls' calls_none; chk 'no residue' no_residue; generic

scen T1_07_sip_custom; answers $ANS_PRE; ENVS=($'MOCK_SIP_LINE=System Integrity Protection status: enabled (Custom Configuration).\n\nConfiguration:\n\tDebugging Restrictions: disabled') ; run --test=G1
  chk 'STOP on SIP Custom Configuration' L 'R2D STOP: T1-9'; chk 'zero security calls' calls_none; generic

scen T1_08_proc_teamviewer; answers $ANS_PRE; ENVS=(MOCK_PS_EXTRA=TeamViewer); run --test=G1
  chk 'STOP on denylisted process' L 'R2D STOP: T1-6: UI-automation / remote-control process running: comm:TeamViewer;ucomm:TeamViewer'
  chk 'zero security calls' calls_none; generic

scen T1_09_proc_space_name; answers $ANS_PRE; ENVS=('MOCK_PS_EXTRA=Keyboard Maestro Engine'); run --test=G1
  chk 'STOP on denylisted name containing spaces' L 'R2D STOP: T1-6'; chk 'zero security calls' calls_none; generic

scen T1_10_proc_self_excluded; answers $ANS_PRE; ENVS=(MOCK_PS_SELF_EXTRA=osascript); run --test=L14
  chk 'harness PID itself excluded from scan' L 'T1-6: process scan clean'; generic

scen T1_11_proc_child_excluded; answers $ANS_PRE n; ENVS=(MOCK_PS_CHILD_EXTRA=osascript MOCK_PS_CHILD_PPID=harness); run --test=L14
  chk 'direct child of harness excluded from scan' L 'T1-6: process scan clean'; generic

scen T1_12_proc_unrelated_osascript; answers $ANS_PRE; ENVS=(MOCK_PS_CHILD_EXTRA=osascript MOCK_PS_CHILD_PPID=1); run --test=L14
  chk 'unrelated osascript detected' L 'R2D STOP: T1-6: UI-automation / remote-control process running: comm:osascript;ucomm:osascript'; chk 'zero security calls' calls_none; generic

for i a in 1 'y n' 2 'n' 3 'y y n'; do
scen T1_13_attest_no_$i; answers ${=a}; run --test=G1
  chk "attestation 'n' at question $i -> STOP" eval 'L "R2D STOP: T1-6"'; chk 'zero security calls' calls_none; generic
done

scen T1_14_eof; run --test=G1
  chk 'EOF at first prompt -> STOP, not confirmation' L 'R2D STOP: no input (EOF) - not treated as confirmation'; chk 'zero security calls' calls_none; generic
for i a in 1 'zzqq9' 2 ' y' 3 'y ' 4 '' 5 'Y' 6 'yy'; do
scen T1_15_invalid_$i; answers "$a"; run --test=G1
  chk "invalid input [${(q)a}] -> STOP INVALID" L 'R2D STOP: INVALID input'
  chk 'invalid value not logged' eval '[[ $a != zzqq9 ]] || ! grep -q zzqq9 $LOGF'; chk 'zero security calls' calls_none; generic
done

scen T1_16_lock_held; mkdir $TT/r2d-lock; answers $ANS_PRE; run --test=G1
  chk 'STOP when lock dir held' L "R2D STOP: another R2D run holds"; chk 'foreign lock dir not removed' eval '[[ -d $TT/r2d-lock ]]'
  chk 'zero security calls' calls_none; generic; rmdir $TT/r2d-lock

scen T1_17_unknown_test; answers $ANS_PRE; run --test=G1,L99
  chk 'unknown test id -> STOP before preflight' L 'R2D STOP: unknown test L99'; chk 'zero security calls' calls_none; generic
scen T1_18_no_test; run
  chk 'no --test -> STOP' L 'R2D STOP: no --test selected'; chk 'zero security calls' calls_none
scen T1_19_unknown_arg; run --bogus
  chk 'unknown argument -> exit 1' eval '[[ $RC == 1 ]] && grep -q "unknown argument" $SD/out'; chk 'zero security calls' calls_none

scen T1_20_unpinned_static   # STATIC (the harness is NOT executed in REAL mode): REAL-mode stops precede every security use
  sec_first=$(grep -nE '^\[\[ -n \$OBS|^(SIPL|SL0|HIT)=|^if \[\[ -n \$OBS' $H | head -1 | cut -d: -f1)
  env_stop=$(grep -n "REAL mode refuses R2D_" $H | head -1 | cut -d: -f1); pin_stop=$(grep -n "stop 'T1-4: harness not launched" $H | head -1 | cut -d: -f1)
  chk 'REAL-mode R2D_* refusal precedes the T1-4 UNPINNED stop' eval '(( env_stop > 0 && env_stop < pin_stop ))'
  chk 'T1-4 UNPINNED stop precedes observer mode and every preflight security call' eval '(( pin_stop > 0 && pin_stop < sec_first ))'

scen T1_21_mockdir_is_usrbin; run_env=(HOME=$HM TMPDIR=$TT/ TERM=dumb R2D_MOCK_DIR=/usr/bin)
  sandbox-exec -p $PROF /usr/bin/env -i $run_env /bin/zsh -f -c "$HS" r2d_prototype --test=G1 </dev/null >$SD/out 2>&1; RC=$?
  chk 'R2D_MOCK_DIR=/usr/bin refused (mock security would be the real binary)' eval '[[ $RC == 1 ]] && grep -q "not a genuine R2E mock - refused" $SD/out'
  for md in /usr//bin /usr/bin/../bin /usr/bin/; do
    sandbox-exec -p $PROF /usr/bin/env -i HOME=$HM TMPDIR=$TT/ TERM=dumb R2D_MOCK_DIR=$md /bin/zsh -f -c "$HS" r2d_prototype --test=G1 </dev/null >$SD/out 2>&1; RC=$?
    chk "R2D_MOCK_DIR=$md refused" eval '[[ $RC == 1 ]] && grep -q "not a genuine R2E mock" $SD/out'; done
  mkdir -p $SD/m_link $SD/m_copy; cp $M/{csrutil,ps,pmset} $SD/m_link/; ln -s $M/security $SD/m_link/security
  cp $M/{csrutil,ps,pmset} $SD/m_copy/; cp /bin/echo $SD/m_copy/security; ln -s $M $SD/m_dirlink
  for md in $SD/m_link $SD/m_copy $SD/m_dirlink; do
    sandbox-exec -p $PROF /usr/bin/env -i HOME=$HM TMPDIR=$TT/ TERM=dumb R2D_MOCK_DIR=$md /bin/zsh -f -c "$HS" r2d_prototype --test=G1 </dev/null >$SD/out 2>&1; RC=$?
    chk "mock dir ${md:t} (symlinked tool / foreign binary / symlinked dir) refused" eval '[[ $RC == 1 ]] && grep -q "not a genuine R2E mock" $SD/out'; done
  chk 'no mock call log from any refused variant' eval '[[ ! -s $M/calls.log ]]'

scen T1_25_args_ids   # RV-7: malformed / duplicate / conflicting arguments refused with zero security calls
  for a in '--test=,' '--test=G1,' '--test=g1' '--test=G1,,L7' '--test=G1,G1'; do answers $ANS_PRE; rm -f $M/calls.log; run $a
    chk "refused: $a (STOP, zero security calls)" eval '[[ $RC == 2 ]] && L "R2D STOP:" && nL "T1-9" && calls_none'; done
  for a in '--test=G1 --test=L7' '--probe=attr --probe=info --test=G1' '--test=G1 --observe=x'; do rm -f $M/calls.log; run ${=a}
    chk "refused before logging: $a" eval '[[ $RC == 1 ]] && calls_none && grep -qE "duplicate argument|mutually exclusive" $SD/out'; done

scen T1_24_real_env_refusal_static   # RV-2 (static; REAL mode is not executed): every R2D_* variable is refused in REAL mode
  chk 'REAL branch refuses any R2D_* parameter' grep -qF '[[ -z ${(M)${(k)parameters}:#R2D_*} ]] || {' $H
  chk 'REAL branch clears the answers-file variable before use' grep -qF "ANSF=''; SEC=/usr/bin/security" $H

scen T1_22_settings_replaced; answers $ANS_PRE; ENVS=(MOCK_SETTINGS_IGNORE_L=1); run --test=L11
  chk 'settings string verified exactly (lock-on-sleep missing -> STOP)' L 'R2D STOP: settings not exactly lock-on-sleep timeout=3600s'; chk 'no residue' no_residue; generic

scen T1_23_unlock_fails; answers $ANS_PRE; ENVS=(MOCK_UNLOCK_ALWAYS_FAIL=1); run --test=G1 --probe=attr
  chk 'unlock failure -> STOP, keychain stays locked and is deleted' eval 'L "R2D STOP: unlock failed" && L "R2D CLEANUP: VERIFIED"'; chk 'no residue' no_residue; generic
fi

# ---------- 2. Tier 2 mock scenarios ----------
if want 'T2*'; then
scen T2_G1_probe_flag; answers $ANS_G1; run --test=G1 --probe=attr
  chk 'calibration at creation with --probe=attr' L 'calibration: probe=attr locked_sig='
  chk 'L2 records locked state after Cancel' L 'probe_after=locked'; chk 'cleanup VERIFIED' L 'R2D CLEANUP: VERIFIED'; generic
scen T2_L1_none; answers $ANS_G1; ENVS=(MOCK_ATTR_LOCKSIG=0 MOCK_DUMP_LOCKSIG=0); run --test=G1
  chk 'L1 INCONCLUSIVE when no probe distinguishes' L 'L1 RESULT: INCONCLUSIVE'
  chk 'state reported unknown (never by-construction)' L 'probe_after=unknown(no-calibrated-probe)'; generic
scen T2_L1_dialog; answers $ANS_PRE n n y n n n U k C 1 U k C U k C U k C 2 n U k C; run --test=G1
  chk 'L1 candidate disqualified when owner reports a dialog' L 'L1 candidate=attr'; chk 'L1 picks dump instead' L 'L1 RESULT: PASS probe=dump'; generic
scen T2_L2_leak; answers $ANS_G1; ENVS=(MOCK_LEAK_LOCKED=1); run --test=G1
  chk 'L2 FAIL when secret returned while locked' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L2 secret while locked without passphrase)'; chk 'no secret in log' no_secret; chk 'no residue' no_residue; generic
scen T2_L2_unlocked_after_cancel; answers $ANS_G1; ENVS=(MOCK_READ_UNLOCKS=1); run --test=G1
  chk 'probe disagreement (unlocked after Cancel) -> FAIL STOP' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L2: keychain unlocked without passphrase entry)'; generic
scen T2_L2_login_pw; answers $ANS_PRE n n n n n n U l C; run --test=G1
  chk 'login-password dialog -> STOP' L 'R2D VERDICT: [SIMULATED-MOCK] STOPPED (login password requested - security finding)'; chk 'no residue' no_residue; generic
scen T2_L2_other_dialog; answers $ANS_PRE n n n n n n O n C; run --test=G1
  chk 'unexpected dialog type O -> STOP' L 'R2D VERDICT: [SIMULATED-MOCK] STOPPED (unexpected dialog)'; generic
scen T2_L3_leak; answers $ANS_G1; ENVS=(MOCK_LEAK_DUMP=1); run --test=G1
  chk 'L3 FAIL when dump discloses while locked' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L3 dump disclosed while locked)'; chk 'no secret in log' no_secret; generic
scen T2_L4_write; answers $ANS_G1; ENVS=(MOCK_LOCKED_WRITE_OK=1); run --test=G1
  chk 'L4 FAIL when write/delete succeed while locked (overwrite rc=0 caught first)' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L4 overwrite accepted while locked)'; generic
scen T2_L4_overwrite_only; answers $ANS_G1; ENVS=(MOCK_LOCKED_OVERWRITE_OK=1); run --test=G1
  chk 'L4 FAIL when only the overwrite is accepted while locked' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L4 overwrite accepted while locked)'; generic
scen T2_L4_silent_write; answers $ANS_G1; ENVS=(MOCK_SILENT_WRITE=1); run --test=G1
  chk 'L4 FAIL when write reports refusal but mdat changed' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L4 item modified while locked)'; generic
scen T2_L4_no_baseline; answers $ANS_G1; ENVS=(MOCK_ATTR_NO_MDAT=1); run --test=G1
  chk 'L4 INCONCLUSIVE (not PASS) when no baseline mdat is readable' L 'L4 INCONCLUSIVE (no baseline mdat'; generic
scen T2_L4_pass_note; answers $ANS_G1; run --test=G1 --probe=attr
  chk 'L4 normal path: locked before write, no FAIL, and the mdat-not-proof note is logged' eval 'L "L4 state_before_write=locked" && L "mdat equality alone is NOT proof" && nL "FAIL (L4"'; generic
scen T2_L5_leak; answers $ANS_G1; ENVS=(MOCK_LEAK_LOCKED=1 MOCK_LEAK_FROM=2); run --test=G1
  chk 'L2 passes then L5 FAIL on concurrent leak' eval 'L "L2 RESULT: rc=128 secret_returned=no" && L "R2D VERDICT: [SIMULATED-MOCK] FAIL (L5 concurrent secret while locked)"'
  chk 'concurrent reader temp files removed' no_residue; generic
scen T2_L6_normal; answers $ANS_PRE A k D n U k C; run --test=L6 --probe=attr
  chk 'L6 characterization recorded' eval 'L "L6 RESULT: (a) rc=128 secret_returned=no" && L "(b) rc=0 secret_returned=yes dialog=n"'
  chk 'L6 verdict RECORDED (characterization)' L 'L6: L6 RECORDED'; generic
scen T2_L6_allow_without_click; answers $ANS_PRE A k D n U k C; ENVS=(MOCK_ALLOW=1); run --test=L6
  chk 'L6a FAIL when secret returned though owner Denied' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L6a secret without Allow)'; generic
scen T2_L8_pass; answers $ANS_PRE; ENVS=(R2D_L8_T=8); run --test=L8 --probe=attr
  chk 'L8 PASS (timeout relock; probe does not reset idle timer)' L 'L8 PASS (timeout relock; probe at T/2 does not reset idle timer - single trial)'; generic
scen T2_L8_probe_resets; answers $ANS_PRE; ENVS=(R2D_L8_T=8 MOCK_PROBE_RESETS=1); run --test=L8 --probe=attr
  chk 'L8 detects a probe that resets the idle timer' L 'L8 PARTIAL (timeout relock PASS; probe RESETS idle timer'; generic
scen T2_L8_early_lock; answers $ANS_PRE; ENVS=(R2D_L8_T=8 MOCK_EARLY_LOCK=1); run --test=L8 --probe=attr
  chk 'L8 relock before T/2 -> INCONCLUSIVE (probe reset not measurable), never PASS' eval 'L "L8 INCONCLUSIVE (keychain not unlocked at T/2" && nL "L8 PASS"'; generic
scen T2_L8_noprobe; answers $ANS_PRE; ENVS=(R2D_L8_T=8); run --test=L8
  chk 'L8 INCONCLUSIVE without calibrated probe' L 'L8 INCONCLUSIVE (no calibrated probe)'; generic
scen T2_L8_no_autolock; answers $ANS_PRE; ENVS=(R2D_L8_T=8 MOCK_NO_AUTOLOCK=1); run --test=L8 --probe=attr
  chk 'L8 FAIL when timeout does not relock' L 'R2D VERDICT: [SIMULATED-MOCK] L8 FAIL (still unlocked after timeout)'; generic
scen T2_L9_pass; answers $ANS_PRE ''; ENVS=(MOCK_SLEEP=1 MOCK_SLEEP_LOCKS=1); run --test=L9 --probe=attr
  chk 'L9 PASS when sleep evidenced and locked' L 'L9 PASS (locked after sleep)'; generic
scen T2_L9_fail; answers $ANS_PRE ''; ENVS=(MOCK_SLEEP=1); run --test=L9 --probe=attr
  chk 'L9 FAIL when unlocked after sleep' L 'R2D VERDICT: [SIMULATED-MOCK] L9 FAIL (unlocked after sleep)'; generic
scen T2_L9_nosleep; answers $ANS_PRE ''; run --test=L9 --probe=attr
  chk 'L9 INCONCLUSIVE when no sleep evidenced' L 'L9 INCONCLUSIVE (no sleep evidenced)'; generic
scen T2_L9_enter_text; answers $ANS_PRE 'x'; run --test=L9 --probe=attr
  chk 'L9 Enter prompt rejects typed text' L 'R2D STOP: INVALID input'; generic
scen T2_L10_pass; answers $ANS_PRE y A k W n U k C; ENVS=(MOCK_ALWAYS=1); run --test=L10 --probe=attr
  chk 'L10 ACL becomes (1) com.apple.security after Always Allow' L 'ACL=applications (1): | requirement: identifier "com.apple.security" and anchor apple'
  chk 'L10 PASS (simulated)' L 'L10 PASS (locked + trusted read returned no secret without passphrase)'; generic
scen T2_L10_fail; answers $ANS_PRE y A k W n U k C; ENVS=(MOCK_ALWAYS=1 MOCK_LEAK_LOCKED=1); run --test=L10 --probe=attr
  chk 'L10 FAIL when trusted read returns secret while locked' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L10 lock does not contain Always Allow)'; chk 'no secret in log' no_secret; generic
scen T2_L10_not_granted; answers $ANS_PRE y A k C; run --test=L10
  chk 'L10 INCONCLUSIVE when Always Allow not granted' L 'L10 INCONCLUSIVE'; generic
scen T2_L10_reattest_no; answers $ANS_PRE n; run --test=L10
  chk 'L10 STOP when automation-off not re-attested' L 'R2D STOP: L10 automation not re-attested'; chk 'no keychain created' eval '! calls_has create-keychain'; generic
scen T2_L11_pass; answers $ANS_PRE; run --test=L11
  chk 'L11 detector flags B and C with identity' eval 'L "B=[OPEN] applications (1): | requirement: identifier \"com.apple.security\"" && L "C=[OPEN]"'
  chk 'L11 RECORDED (no FAIL)' L 'L11: L11 RECORDED'; generic
scen T2_L11_miss; answers $ANS_PRE; ENVS=(MOCK_ACL_C_HIDE=1); run --test=L11
  chk 'L11 FAIL when detector misses C' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L11 detector)'; generic
scen T2_L13_pass; answers $ANS_PRE; ENVS=(MOCK_UNLOCK_FAIL_FIRST=1); run --test=L13
  chk 'L13 wrong passphrase rejected, correct accepted' eval 'L "L13 wrong_passphrase rc=51" && L "L13 correct_passphrase rc=0"'; generic
scen T2_L13_fail; answers $ANS_PRE; run --test=L13
  chk 'L13 FAIL if wrong passphrase accepted' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L13 wrong passphrase accepted)'; generic
scen T2_L14; answers $ANS_PRE n; run --test=L14 --probe=attr
  chk 'L14 recorded' L 'L14 RESULT: second_unlock_rc=0 prompted=n probe=unlocked'; generic
scen T2_L15; answers $ANS_PRE 2 U k C A k D; run --test=L15 --probe=attr
  chk 'L15 records two dialogs in sequence' L 'L15 RESULT: rc=128 secret_returned=no dialogs=2 first=[type=U pw=k act=C] second=[type=A pw=k act=D]'; generic
scen T2_L15_leak; answers $ANS_PRE 2 U k C A k D; ENVS=(MOCK_LEAK_LOCKED=1); run --test=L15
  chk 'L15 FAIL on secret after Deny' L 'R2D VERDICT: [SIMULATED-MOCK] FAIL (L15 secret after Deny)'; generic
scen T2_multi; answers $ANS_PRE n A k D n U k C; run --test=L14,L6 --probe=attr
  chk 'multi-group run: per-group teardown + combined verdict' eval 'L "L14 group teardown: keychain deleted" && L "L6 group teardown: keychain deleted" && L "R2D VERDICT: [SIMULATED-MOCK] COMPLETED L14: L14 RECORDED"'
  chk 'no residue' no_residue; generic
fi

# ---------- 3. signals / cleanup ----------
spawn() { # bg harness with default signal dispositions; answers via FIFO held open by the runner
  base_env; rm -f $SD/ans; mkfifo $SD/ans
  /usr/bin/python3 -I -c 'import os,signal,sys
for s in (signal.SIGINT,signal.SIGQUIT,signal.SIGHUP,signal.SIGTERM): signal.signal(s,signal.SIG_DFL)
os.execv(sys.argv[1],sys.argv[1:])' /usr/bin/sandbox-exec -p $PROF /usr/bin/env -i $REPLY_ENV /bin/zsh -f -c "$HS" r2d_prototype "$@" </dev/null >$SD/out 2>&1 &
  BGPID=$!; OWNED+=" $BGPID"; exec {AFD}<>$SD/ans; FIFOS+=" $SD/ans"; }
unspawn() { exec {AFD}>&- 2>/dev/null; rm -f $SD/ans; }
waitlog() { local i; for i in {1..200}; do LOGF=$(print -l $HM/aura-r2b-evidence/r2d-*-mock.log(N.om) | head -1); [[ -n $LOGF ]] && grep -qF -- "$1" $LOGF && return 0; sleep 0.1; done; return 1; }
if want 'T3*'; then
for sig in INT TERM HUP; do
scen T3_signal_$sig; spawn --test=G1 --probe=attr; print -rl -- y y y >&$AFD
  waitlog 'calibration: probe=attr'; sleep 0.5
  chk "$sig: harness pid in log matches launched pid" L "pid=$BGPID"
  kill -$sig $BGPID; bwait $BGPID 30; RC=$BWRC; unspawn
  chk "$sig: trap logged interruption" L 'R2D: interrupted'
  chk "$sig: verdict STOPPED (interrupted)" L 'R2D VERDICT: [SIMULATED-MOCK] STOPPED (interrupted)'
  chk "$sig: cleanup VERIFIED (keychain locked+deleted)" eval 'L "R2D CLEANUP: VERIFIED" && calls_has "delete-keychain"'
  chk "$sig: no residue" no_residue; generic
done
fi

# ---------- 4. L7 crash / watchdog / observer ----------
obs_run() { base_env; sandbox-exec -p $PROF /usr/bin/env -i $REPLY_ENV /bin/zsh -f -c "$HS" r2d_prototype "$@" </dev/null >$SD/obs.out 2>&1 & OBSPID=$!; OWNED+=" $OBSPID"; }
obslog() { OLOG=($HM/aura-r2b-evidence/r2d-*-$OBSPID-mock.log(N)); OLOG=${OLOG[1]:-$SD/no-observer-log}; }
owait() { local i; for i in {1..${2:-150}}; do grep -qF -- "$1" $SD/obs.out 2>/dev/null && return 0; kill -0 $OBSPID 2>/dev/null || { grep -qF -- "$1" $SD/obs.out 2>/dev/null; return; }; sleep 0.1; done; return 1; }
pcmd() { /bin/ps -ww -o command= -p $1 2>/dev/null; }   # exact PID argv (no setuid ps)
l7_setup() { # $1 N -> harness armed; sets HLOG OA WD KCP
  ENVS=(R2D_WD_N=$1 R2D_OBS_WAIT=${2:-60}); spawn --test=L7 --probe=attr; print -rl -- y y y >&$AFD
  waitlog 'L7 OBSERVER ARGS:'; HLOG=$LOGF; OA=$(sed -n 's/^L7 OBSERVER ARGS: //p' $HLOG)
  WD=$(sed -n 's/^watchdog armed pid=\([0-9]*\).*/\1/p' $HLOG); OWNED+=" $WD"; KCP=${${OA#--observe=}%%,*}; }
recover() {  # R2D-07 manual recovery with the MOCK toolchain only (explicit paths); every step checked
  local d r=0; for d in $TT/r2d-run.*(N/); do
    R2D_MOCK_DIR=$M $M/security lock-keychain $d/r2d.keychain-db || r=1
    R2D_MOCK_DIR=$M $M/security delete-keychain $d/r2d.keychain-db || r=1
    rm -f $d/ra $d/rb; rmdir $d || r=1; done
  [[ -d $TT/r2d-lock ]] && { kill -0 $1 2>/dev/null && r=1 || rmdir $TT/r2d-lock; }
  [[ -z $(print -l $M/state/*r2d.keychain-db(N)) ]] || r=1; return $r; }
if want 'T4*'; then
scen T4_L7_pass; l7_setup 12
  chk 'watchdog: exact PID argv ends "r2d_watchdog 12 <run keychain> <mock security>"' eval '[[ $(pcmd $WD) == *" r2d_watchdog 12 $KCP $M/security" ]]'
  chk 'watchdog parent is the harness pid' eval '/usr/bin/pgrep -P $BGPID | grep -qx $WD'
  obs_run $OA; owait 'L7-OBS watchdog_alive=yes'
  chk 'observer confirmed watchdog alive (exact pid + argv + parent) before kill' eval 'grep -q "L7-OBS watchdog_alive=yes pid=$WD parent=$BGPID argv=exact" $SD/obs.out'
  kill -9 $BGPID; bwait $BGPID 10; unspawn
  chk 'observer finished within its bound' bwait $OBSPID 60; obslog
  chk 'observer saw unlocked residual at t+5 (N=12 > 5)' eval 'grep -q "L7-OBS t+5 probe=.* state=unlocked" $OLOG'
  chk 'observer saw locked at t+N+10 -> L7 PASS (simulated)' eval 'grep -qF "R2D VERDICT: [SIMULATED-MOCK] L7 PASS (relocked by watchdog after harness kill)" $OLOG'
  chk 'V3R-4: both observer probes were gated by fresh scans in the observer process' eval '[[ $(grep -c "^T1-6 gate op=find-generic-password scan=[0-9]* result=CLEAN" $OLOG) -ge 2 ]]'
  chk 'watchdog exited after firing' gone $WD 50
  chk 'observer did not lock/delete the keychain (no delete-keychain in argv log)' eval '! calls_has delete-keychain'
  chk 'crash residue present as expected (run dir + lock dir)' eval '[[ -n $(print -l $TT/r2d-run.*(N)) && -d $TT/r2d-lock ]]'
  chk 'observer log: one CLEANUP line, no secret' eval '[[ $(grep -c "^R2D CLEANUP:" $OLOG) == 1 ]] && no_secret'
  # recovery: stale lock removed only because the logged harness PID is gone; then L16POST counts the residue
  ! kill -0 $BGPID 2>/dev/null && rmdir $TT/r2d-lock; answers $ANS_PRE; rm -f $HLOG; run --test=L16POST
  chk 'L16POST reports the crash residue' L 'L16 RESULT: leftover_run_dirs=1'
  chk 'R2D-07 manual recovery (mock toolchain, explicit paths) succeeds' recover $BGPID; rm -f $LOGF; answers $ANS_PRE; run --test=L16POST
  chk 'after manual recovery L16POST reports zero residue' L 'L16 RESULT: leftover_run_dirs=0'; chk 'no residue' no_residue

scen T4_L7_watchdog_dead; l7_setup 12
  kill -9 $WD; chk 'killed watchdog is gone (reaped by harness)' gone $WD 50
  obs_run $OA; chk 'observer exits within bound (no hang)' bwait $OBSPID 30; obslog
  chk 'observer INCONCLUSIVE when watchdog not alive' eval 'grep -qF "R2D VERDICT: [SIMULATED-MOCK] L7 INCONCLUSIVE (watchdog not alive before kill)" $OLOG'
  chk 'observer STOP left the harness keychain in place' eval '[[ -n $(print -l $TT/r2d-run.*/r2d.keychain-db(N)) ]]'
  kill -9 $BGPID; bwait $BGPID 10; unspawn; chk 'recovered' recover $BGPID; chk 'recovered: no residue' no_residue

scen T4_L7_decoy; l7_setup 12
  /bin/zsh -f -c 'sleep 60; :' r2d_watchdog 12 $KCP $M/security & DEC=$!; OWNED+=" $DEC"   # same argv, NOT a child of the harness
  sleep 0.3; chk 'decoy has the identical argv tail' eval '[[ $(pcmd $DEC) == *" r2d_watchdog 12 $KCP $M/security" ]]'
  obs_run ${OA/,$WD,/,$DEC,}; bwait $OBSPID 30; obslog
  chk 'decoy with identical argv but wrong parent -> INCONCLUSIVE (not PASS)' eval 'grep -qF "R2D VERDICT: [SIMULATED-MOCK] L7 INCONCLUSIVE (watchdog not alive before kill)" $OLOG && ! grep -q "L7 PASS" $OLOG'
  obs_run ${OA/,$WD,$BGPID,12,/,$WD,$BGPID,13,}; bwait $OBSPID 30; obslog
  chk 'real watchdog pid but wrong N in args -> argv mismatch -> INCONCLUSIVE' eval 'grep -qF "R2D VERDICT: [SIMULATED-MOCK] L7 INCONCLUSIVE (watchdog not alive before kill)" $OLOG'
  /bin/zsh -f -c 'exit 0' & DP=$!; wait $DP
  obs_run ${OA/,$WD,$BGPID,/,$WD,$DP,}; bwait $OBSPID 30; obslog
  chk 'harness pid not alive at observer start -> INCONCLUSIVE (residual timing unknown)' eval 'grep -qF "R2D VERDICT: [SIMULATED-MOCK] L7 INCONCLUSIVE (harness not running at observer start" $OLOG'
  kill -9 $DEC 2>/dev/null; wait $DEC 2>/dev/null; kill -9 $WD; gone $WD 50; kill -9 $BGPID; bwait $BGPID 10; unspawn
  chk 'recovered' recover $BGPID; chk 'recovered: no residue' no_residue

scen T4_L7_obs_wait_bound; l7_setup 60 3
  obs_run $OA; owait 'L7-OBS watchdog_alive=yes'
  chk 'observer gives up after its wait bound when the harness is never killed (exits <= 15s)' bwait $OBSPID 15; obslog
  chk 'bounded wait -> INCONCLUSIVE, never PASS' eval 'grep -qF "R2D VERDICT: [SIMULATED-MOCK] L7 INCONCLUSIVE (harness not killed within 3s)" $OLOG'
  kill -9 $WD; gone $WD 50; kill -9 $BGPID; bwait $BGPID 10; unspawn; chk 'recovered' recover $BGPID; chk 'recovered: no residue' no_residue

scen T4_L7_lock_fails; l7_setup 3
  : > $M/lock_noop; obs_run $OA; owait 'L7-OBS watchdog_alive=yes'; kill -9 $BGPID; bwait $BGPID 10; unspawn; bwait $OBSPID 40; obslog
  chk 'L7 FAIL when still unlocked after the watchdog deadline' eval 'grep -qF "R2D VERDICT: [SIMULATED-MOCK] L7 FAIL (still unlocked after watchdog deadline)" $OLOG'
  rm -f $M/lock_noop; gone $WD 50; chk 'recovered' recover $BGPID; chk 'recovered: no residue' no_residue

scen T4_teardown_cancels_watchdog; l7_setup 60
  kill -TERM $BGPID; bwait $BGPID 20; unspawn
  chk 'TERM -> trap teardown; CLEANUP VERIFIED' L 'R2D CLEANUP: VERIFIED'
  chk 'teardown cancelled the TERM-ignoring watchdog (exact pid/argv/parent, KILL)' gone $WD 30
  chk 'teardown deleted the keychain' calls_has delete-keychain; chk 'no residue' no_residue; generic

scen T4_L7_noprobe; answers $ANS_PRE; run --test=L7
  chk 'L7 requires a calibrated probe -> INCONCLUSIVE STOP with verified cleanup' eval 'L "R2D VERDICT: [SIMULATED-MOCK] L7 INCONCLUSIVE (needs a calibrated --probe=)" && L "R2D CLEANUP: VERIFIED"'
  chk 'no watchdog armed' eval '! L "watchdog armed"'; chk 'no residue' no_residue; generic

scen T4_observer_badpath; run --observe=/etc/passwd,1,1,3,attr,a,b,SIMULATED-MOCK
  chk 'observer T1-8 guard refuses non-r2d path' L 'R2D STOP: observer: T1-8 path guard'; chk 'zero security calls' calls_none
scen T4_observer_badargs; run --observe=a,b
  chk 'observer refuses malformed arguments' L 'R2D STOP: observer: bad --observe argument'; chk 'zero security calls' calls_none
  run --observe=$TT/r2d-run.1Ul8KsKP,1,1,3,attr,a,b
  chk 'observer refuses the old 7-field form (mode field required)' L 'R2D STOP: observer: bad --observe argument'; chk 'zero security calls' calls_none
scen T4_observer_pathguard   # RV-6: traversal / wrong run-dir name / glob chars refused before any security call
  mkdir -p $TT/r2d-run.AAAAAAAA $TT/x
  for kp in "$TT/r2d-run.AAAAAAAA/../x/r2d.keychain-db" "$TT/r2d-run.short/r2d.keychain-db" "$TT/r2d-run.AAAAAAAA/sub/r2d.keychain-db" "$TT/r2d-run.AAAA*AAA/r2d.keychain-db" "/tmp/r2d-run.AAAAAAAA/r2d.keychain-db"; do
    rm -f $M/calls.log; run --observe=$kp,1,1,3,attr,a,b,SIMULATED-MOCK
    chk "path guard refuses ${kp#$TT/}" eval 'L "R2D STOP: observer: T1-8 path guard" && calls_none'; done
  rmdir $TT/r2d-run.AAAAAAAA $TT/x
scen T4_observer_mode_mismatch; l7_setup 12
  obs_run ${OA%,SIMULATED-MOCK},REAL; bwait $OBSPID 20; obslog
  chk 'observer refuses evidence from a different mode (harness=REAL vs observer=SIMULATED-MOCK)' eval 'grep -q "R2D STOP: observer: mode mismatch" $OLOG && ! grep -q "L7-OBS" $OLOG'
  kill -9 $WD; gone $WD 50; kill -9 $BGPID; bwait $BGPID 10; unspawn; chk 'recovered' recover $BGPID; chk 'recovered: no residue' no_residue
scen T4_L7_early_relock; l7_setup 12   # RV-10: relock by another cause (simulated sleep) must not be credited to the watchdog
  obs_run $OA; owait 'L7-OBS watchdog_alive=yes'; kill -9 $BGPID; bwait $BGPID 10; unspawn
  for f in $M/state/*/locked(N); do print 1 > $f; done
  bwait $OBSPID 60; obslog
  chk 'relocked before the watchdog deadline -> INCONCLUSIVE, not PASS' eval 'grep -q "L7 INCONCLUSIVE (relocked before the watchdog deadline" $OLOG && ! grep -q "L7 PASS" $OLOG'
  gone $WD 50; chk 'recovered' recover $BGPID; chk 'recovered: no residue' no_residue
fi

# ---------- 6. runner / named-pipe regression (original failure: writer blocked on a FIFO with no reader) ----------
if want 'T6*'; then
scen T6_fifo_old_pattern_hangs   # demonstrates the ORIGINAL failure mode, bounded: open-for-write on a reader-less FIFO
  rm -f $SD/ans; mkfifo $SD/ans; chk 'precondition: answers path is a FIFO' eval '[[ -p $SD/ans ]]'
  /bin/zsh -f -c 'exec 3>$1; print x >&3' r2e_decoy_fifo_writer $SD/ans & FW=$!; OWNED+=" $FW"
  chk 'old pattern (write-only open, no reader) blocks: detected by the bound, killed by exact pid' eval '! bwait $FW 2 && grep -q "kill -9 test-owned pid $FW" $W/kills.txt'
  rm -f $SD/ans
scen T6_fifo_reader_dies_early   # harness exits BEFORE opening the answers FIFO; runner must not block
  spawn --bogus; print -rl -- y y y >&$AFD
  chk 'runner opened and wrote the FIFO without blocking (O_RDWR)' eval 'true'
  chk 'early-exiting harness ends within bound with rc=1 (unknown argument)' eval 'bwait $BGPID 10 && [[ $BWRC == 1 ]]'
  unspawn; chk 'FIFO removed after the scenario' eval '[[ ! -e $SD/ans ]]'
scen T6_fifo_stale   # a stale FIFO left at the answers path is replaced by a regular file
  rm -f $SD/ans; mkfifo $SD/ans; chk 'precondition: stale FIFO present' eval '[[ -p $SD/ans ]]'; answers $ANS_PRE n; chk 'stale FIFO replaced by a regular answers file' eval '[[ -f $SD/ans && ! -p $SD/ans ]]'
  run --test=L14 --probe=attr; chk 'run completes (rc=0) - no hang on the stale path' eval '[[ $RC == 0 ]]'; generic
scen T6_run_bound   # a harness that never returns is bounded and killed by exact PID, then recovered
  answers $ANS_PRE; RUNMAX=4 EXPECT_TIMEOUT=1; ENVS=(R2D_WD_N=60); run --test=L7 --probe=attr; RUNMAX='' EXPECT_TIMEOUT=''
  chk 'non-returning run is cut at the bound (RC=124) and the kill is recorded with its pid' eval '[[ $RC == 124 ]] && grep -q "\[T6_run_bound\] kill -9 test-owned pid" $W/kills.txt'
  WD=$(sed -n 's/^watchdog armed pid=\([0-9]*\).*/\1/p' $LOGF); [[ -n $WD ]] && { OWNED+=" $WD"; killown $WD 'T6 cleanup'; gone $WD 30; }
  chk 'recovered' recover $LASTP; chk 'no residue' no_residue
fi

# ---------- 5. bootstrap / launcher integrity (R2D-06) ----------
mkboot() { # $1 expected hash  $2 file  rest: args  -> the bootstrap line exactly as R2D-06 + args
  print -r -- "H=$1; S=\$(/bin/cat $2; builtin print -n x); S=\${S%x}; if [[ \$S != *\$'\\0'* && \$S != *\$'\\r'* && \$(builtin print -rn -- \"\$S\" | /usr/bin/env -i /usr/bin/shasum -a 256) == \"\$H  -\" ]]; then /bin/zsh -f -c \"\$S\" r2d_prototype ${(j: :)@[3,-1]}; builtin print -r -- \"R2D BOOTSTRAP: harness exited rc=\$?\"; else builtin print -r -- 'R2D BOOTSTRAP: HASH MISMATCH or NUL/CR - not executed'; fi"; }
fresh() { /usr/bin/env -i HOME=$SD/home TERM=xterm-256color /bin/zsh -f -c "$1" 2>&1; }
if want 'T5*'; then
scen T5_bootstrap; D1=$SD/dummy.zsh
  print -r -- "print -r -- RAN > $SD/marker; exit 7" > $D1; h1=$(shasum -a 256 $D1 | cut -d' ' -f1)
  o=$(fresh "$(mkboot $h1 $D1)")
  chk 'correct hash executes and reports the real exit status (rc=7, not MISMATCH)' eval '[[ $o == *"harness exited rc=7"* && -f $SD/marker ]]'
  rm -f $SD/marker; print -rn -- "print -r -- RAN > $SD/marker; exit 8" > $D1; print >> $D1
  o=$(fresh "$(mkboot $h1 $D1)")
  chk 'one-byte change -> HASH MISMATCH, not executed' eval '[[ $o == *"HASH MISMATCH"* && ! -f $SD/marker ]]'
  D2=$SD/nl.zsh; print -rn -- $'exit 0\n\n\n' > $D2; h2=$(shasum -a 256 $D2 | cut -d' ' -f1)
  o=$(fresh "$(mkboot $h2 $D2)"); chk 'trailing newlines preserved (hash matches shasum of file)' eval '[[ $o == *"harness exited rc=0"* ]]'
  D3=$SD/nul.zsh; print -rn -- $'exit 0\0' > $D3; h3=$(shasum -a 256 $D3 | cut -d' ' -f1)
  o=$(fresh "$(mkboot $h3 $D3)"); chk 'NUL byte rejected even with a matching hash' eval '[[ $o == *"HASH MISMATCH or NUL/CR"* ]]'
  D4=$SD/cr.zsh; print -rn -- $'exit 0\r\n' > $D4; h4=$(shasum -a 256 $D4 | cut -d' ' -f1)
  o=$(fresh "$(mkboot $h4 $D4)"); chk 'CR byte rejected even with a matching hash' eval '[[ $o == *"HASH MISMATCH or NUL/CR"* ]]'
  # post-read replacement: content is executed from memory
  D5=$SD/swap.zsh; print -r -- "print -r -- v1 > $SD/swapmark" > $D5; h5=$(shasum -a 256 $D5 | cut -d' ' -f1)
  o=$(fresh "H=$h5; S=\$(/bin/cat $D5; builtin print -n x); S=\${S%x}; builtin print -r -- 'print -r -- v2 > $SD/swapmark' > $D5; if [[ \$(builtin print -rn -- \"\$S\" | /usr/bin/env -i /usr/bin/shasum -a 256) == \"\$H  -\" ]]; then /bin/zsh -f -c \"\$S\" r2d_prototype; fi")
  chk 'file replaced after read: the verified in-memory content runs (v1), not the replacement' eval '[[ $(<$SD/swapmark) == v1 ]]'
  # PERL5OPT / PERL5LIB injection into shasum (Perl) is neutralised by env -i
  mkdir -p $SD/evil; print -r -- "package Evil; BEGIN { print \"$h1  -\\n\"; exit 0 } 1;" > $SD/evil/Evil.pm
  inj=$(print -rn -- tampered | PERL5LIB=$SD/evil PERL5OPT=-MEvil /usr/bin/shasum -a 256)
  chk 'control: PERL5OPT injection DOES forge shasum output without env -i' eval '[[ $inj == "$h1  -" ]]'
  o=$(/usr/bin/env -i HOME=$SD/home PERL5LIB=$SD/evil PERL5OPT=-MEvil /bin/zsh -f -c "$(mkboot $h1 $D1)" 2>&1)
  chk 'bootstrap with PERL5OPT/PERL5LIB exported still detects the tampered file (env -i)' eval '[[ $o == *"HASH MISMATCH"* ]]'
  # builtin print vs a hijacking print function
  ORIG=$(<$SD/nl.zsh)
  o=$(fresh "print() { builtin print -rn -- 'exit 0'; }; H=$h1; S=\$(/bin/cat $D1; builtin print -n x); S=\${S%x}; a=\$(print -rn -- \"\$S\" | /usr/bin/env -i /usr/bin/shasum -a 256); b=\$(builtin print -rn -- \"\$S\" | /usr/bin/env -i /usr/bin/shasum -a 256); [[ \$a != \$b ]] && builtin print -r -- HIJACK_DIFFERS")
  chk 'a print() function changes the hashed bytes; builtin print is immune' eval '[[ $o == *HIJACK_DIFFERS* ]]'
  # fresh env -i ... zsh -f window ignores startup files
  mkdir -p $SD/fh; print -r -- "print -r -- SOURCED > $SD/zmark; print() { :; }" > $SD/fh/.zshenv; cp $SD/fh/.zshenv $SD/fh/.zshrc
  o=$(/usr/bin/env -i HOME=$SD/fh TERM=xterm-256color /bin/zsh -f -c 'whence -w print')
  chk 'zsh -f with temp HOME: .zshenv/.zshrc not sourced, print stays builtin' eval '[[ $o == "print: builtin" && ! -f $SD/zmark ]]'
  /usr/bin/env -i HOME=$SD/fh TERM=xterm-256color /bin/zsh -c 'true' >/dev/null 2>&1
  chk 'control: without -f the dummy .zshenv IS sourced' eval '[[ -f $SD/zmark ]]'

scen T5_bootstrap_harness; answers $ANS_PRE n; base_env
  o=$(sandbox-exec -p $PROF /usr/bin/env -i $REPLY_ENV /bin/zsh -f -c "$(mkboot $HHASH $H --test=L14 --probe=attr)" </dev/null 2>&1); print -r -- "$o" > $SD/out
  LOGF=$(print -l $HM/aura-r2b-evidence/r2d-*-mock.log(N) | head -1)
  chk 'harness via bootstrap: logged harness_sha256 equals file sha256' L "harness_sha256=$HHASH"
  chk 'bootstrap reports harness rc=0' eval '[[ $o == *"harness exited rc=0"* ]]'; generic
scen T5_bootstrap_harness_rc2; answers $ANS_PRE; base_env
  o=$(sandbox-exec -p $PROF /usr/bin/env -i $REPLY_ENV /bin/zsh -f -c "$(mkboot $HHASH $H --test=L99)" </dev/null 2>&1); print -r -- "$o" > $SD/out
  chk 'harness STOP via bootstrap reported as rc=2 (not HASH MISMATCH)' eval '[[ $o == *"harness exited rc=2"* && $o != *MISMATCH* ]]'
fi


# ---------- 7. FIX01: fail-closed T1-6 scanner (UNKNOWN / DETECTED / CLEAN) ----------
t7_unknown() {  # $1 scenario  $2 expected reason fragment  rest: ENVS
  scen $1; X7=$2; answers $ANS_PRE; ENVS=(${@[3,-1]}); run --test=G1
  chk "UNKNOWN -> STOP: $2" eval 'L "R2D STOP: T1-6: process scan UNKNOWN (" && L "$X7" && L "not treated as clean"'
  chk 'never CLEAN, never reaches attestations or keychain calls' eval 'nL "process scan CLEAN" && nL "T1-6: process scan clean; attestations" && calls_none'
  chk 'verdict records the UNKNOWN stop' L 'STOPPED (T1-6 process scan UNKNOWN)'
  chk 'no scan temp file left' eval '[[ -z $(print -l $TT/r2d-scan.*(N)) ]]'; chk 'no residue' no_residue; generic; }
t7_detect() {   # $1 scenario  $2 expected hit (fixed string)  rest: ENVS
  scen $1; X7=$2; answers $ANS_PRE; ENVS=(${@[3,-1]}); run --test=G1
  chk "DETECTED -> STOP: $2" eval 'L "R2D STOP: T1-6: UI-automation / remote-control process running:" && L "$X7"'
  chk 'no keychain call after DETECTED' calls_none; chk 'no residue' no_residue; generic; }
if want 'T7*'; then
t7_unknown T7_ps_rc_nonzero        'ucomm read: ps exit status 1'       MOCK_PS_RC=1
t7_unknown T7_ps_rc_comm_only      'comm read: ps exit status 3'        MOCK_PS_RC=3 MOCK_PS_RC_COL=comm
t7_unknown T7_ps_empty             'ucomm read: empty output'           MOCK_PS_EMPTY=1
t7_unknown T7_ps_empty_comm        'comm read: empty output'            MOCK_PS_EMPTY=comm
t7_unknown T7_ps_malformed         'malformed row'                      MOCK_PS_MALFORMED=1
t7_unknown T7_ps_blank_line        'malformed row'                      MOCK_PS_BLANKLINE=1
t7_unknown T7_ps_partial_rows      'implausible row count 1'            MOCK_PS_TRUNC=1
t7_unknown T7_ps_partial_comm      'comm read: implausible row count 1' MOCK_PS_TRUNC=comm
t7_unknown T7_ps_output_then_fail  'ucomm read: ps exit status 1'       MOCK_PS_RC=1 MOCK_PS_EXTRA=Safari
t7_unknown T7_ps_missing_column    'malformed row'                      MOCK_PS_MISSINGCOL=1
t7_unknown T7_ps_bad_pid           'malformed row'                      MOCK_PS_BADPID=1
t7_unknown T7_ps_bad_ppid          'malformed row'                      MOCK_PS_BADPPID=1
t7_unknown T7_ps_duplicate_pid     'duplicate pid'                      MOCK_PS_DUPPID=1
t7_unknown T7_ps_no_launchd        'pid 1 (launchd) row missing'        MOCK_PS_NOLAUNCHD=1 MOCK_PS_EXTRA=Safari
t7_unknown T7_ps_own_row_missing   'own pid'                            MOCK_PS_PARTIAL=1 MOCK_PS_EXTRA=Safari
t7_unknown T7_ps_implausible_count 'implausible row count'              R2D_SCAN_MIN=50
scen T7_ps_timeout; answers $ANS_PRE; ENVS=(MOCK_PS_HANG=1 MOCK_PS_HANG_S=4 R2D_SCAN_TO=2); T0=$EPOCHREALTIME; run --test=G1; TD7=$(( EPOCHREALTIME - T0 ))
  chk 'hung ps -> UNKNOWN (timeout, no signal) -> STOP' eval 'L "R2D STOP: T1-6: process scan UNKNOWN (ucomm read: timeout after 2s (no signal sent))"'
  chk 'bounded: whole run ends well inside 20 s with a 2 s scan bound' eval '(( TD7 < 20 ))'
  chk 'diagnostics record the timeout (rc=none timeout=yes valid=no)' L 'col=ucomm rc=none rows=0 pid1=no own=no dup=0 malformed=0 timeout=yes valid=no'
  HP=$(<$M/hang.pid 2>/dev/null)
  chk 'NO signal: the hung mock ps (pid from its own hang.pid) is still running right after the harness exited' eval '[[ $HP == <-> ]] && kill -0 $HP 2>/dev/null && [[ $(/bin/ps -ww -o command= -p $HP) == *"$M/ps -ww -axo"* ]]'
  chk 'the abandoned read ends by itself (no signal from the harness) within 15 s' eval 'for i in {1..150}; do kill -0 $HP 2>/dev/null || break; sleep 0.1; done; ! kill -0 $HP 2>/dev/null'
  chk 'never CLEAN' eval 'nL "process scan CLEAN" && calls_none'; generic
t7_detect T7_known_prohibited      'ucomm:TeamViewer'                   MOCK_PS_EXTRA=TeamViewer
t7_detect T7_comm_spoofed_benign   'ucomm:osascript'                    MOCK_PS_SPOOF_COMM=osascript
  chk 'spoofed argv[0] (benign-tool) is not what triggered: kernel name did' eval 'nL "comm:benign-tool"'
t7_detect T7_comm_only_denylisted  'comm:osascript-fake'                MOCK_PS_COMM_ONLY=osascript-fake
t7_detect T7_multiple_matches      'ucomm:AnyDesk;ucomm:TeamViewer'     MOCK_PS_MULTI=1
  chk 'all matching processes reported (osascript once, deduplicated)' eval 'L "comm:osascript" && L "ucomm:osascript" && [[ $(grep -o "ucomm:osascript" $LOGF | wc -l) -le 2 ]]'
t7_detect T7_grandchild_detected   'osascript-grand'                    MOCK_PS_GRANDCHILD=1
  chk 'direct child of the harness is excluded, grandchild is NOT' eval 'nL "osascript-child" && L "osascript-grand"'
t7_detect T7_parent_disagreement   'osascript-race'                     MOCK_PS_DISAGREE=1
  chk 'reads disagree on the parent -> not excluded (conservative)' L 'osascript-race'
t7_detect T7_ucomm_truncation      'ucomm:Keyboard Maestro'             'MOCK_PS_EXTRA=Keyboard Maestro Engine'
scen T7_misleading_names; answers $ANS_PRE n; ENVS=(MOCK_PS_MISLEAD=1); run --test=L14 --probe=attr
  chk 'names merely containing a denylisted word (notes-about-claude, myosascript) or a denylisted APP DIRECTORY are not DETECTED' L 'T1-6: process scan CLEAN'
  chk 'run proceeds past T1-6 (rc=0)' eval '[[ $RC == 0 ]]'; generic
scen T7_clean_fixture; answers $ANS_PRE n; ENVS=(MOCK_PS_EXTRA=Safari 'MOCK_PS_CHILD_EXTRA=osascript' MOCK_PS_CHILD_PPID=harness); run --test=L14 --probe=attr
  chk 'genuine clean fixture (benign app + the harness own osascript child) -> CLEAN' eval 'L "T1-6: process scan CLEAN (ucomm+comm validated, rows=4)"'
  chk 'both columns were read (ucomm then comm)' eval '[[ $(tr "\n" , < $M/ps_cols.log) == ucomm,comm,* ]]'
  chk 'clean run continues to attestations and completes (rc=0)' eval 'L "T1-6: process scan clean; attestations y/y/y" && [[ $RC == 0 ]]'; generic
scen T7_static_no_pipeline   # STATIC (v3): no pipeline, no error masking, no temp file, no signal in the scanner block
  blk=$(awk '/^# T1-6 process scan \(v3/{f=1} /^# ---------------- observer mode/{exit} f{print}' $H)   # scanner + gate definitions only
  chk 'T1-6 block found' eval '[[ -n $blk ]]'
  chk 'no pipe, no "|| true", no "|| :" anywhere in the T1-6 block' eval '! print -r -- "$blk" | grep -vE "^ *#" | grep -qE "[^|]\|[^|]|\|\| *(true|:)"'
  chk 'no kill/pkill/killall and no mktemp/temp-file path in the scanner block' eval '! print -r -- "$blk" | grep -vE "^ *#" | grep -qE "kill|mktemp|r2d-scan|TMPDIR|\\\$TD"'
  chk 'capture is a disowned coprocess with a per-read nonce sentinel and a sysread whole-read deadline' eval '[[ $blk == *"coproc {"* && $blk == *"\"\${tag}\$?\""* && $blk == *"[[ \${jobstates[\$j]} == *:\$cpid=* ]] && { disown %\$j"* && $blk == *"exec {fd}<&p"* && $blk == *"tag=\"__R2D_PS_RC_\${nonce}=\""* && $blk == *"sysread -t \$rem -i \$fd"* && $blk == *"r2d_nonce()"* ]]'
  chk 'UNKNOWN is the default; DETECTED and UNKNOWN both stop' eval '[[ $blk == *"SCAN=UNKNOWN"* && $blk == *"DETECTED) "*stop* && $blk == *"*) "*stop* ]]'

fi

# ---------- 8. V3-01: structural diagnostics, logging failure, fresh-scan gate, isolation ----------
diagl() { grep -E '^T1-6 (diag|gate) ' $LOGF; }
if want 'T8*'; then
scen T8_diag_clean; answers $ANS_PRE n; run --test=L14 --probe=attr
  chk 'read 1 diagnostics (ucomm): rc=0 rows=2 pid1 own dup=0 malformed=0 timeout=no valid=yes' L 'T1-6 diag scan=1 read=1 col=ucomm rc=0 rows=2 pid1=yes own=yes dup=0 malformed=0 timeout=no valid=yes'
  chk 'read 2 diagnostics (comm) present' L 'T1-6 diag scan=1 read=2 col=comm rc=0 rows=2 pid1=yes own=yes dup=0 malformed=0 timeout=no valid=yes'
  chk 'final classification with scanner pid and exclusion counts' eval 'grep -qE "^T1-6 diag scan=1 result=CLEAN hits=0 scanner_pid=[0-9]+ excluded_self=1 excluded_children=0 why=none$" $LOGF'
  chk 'diagnostic lines are names-free key=value only (no paths, no arguments)' eval '! diagl | grep -vE "^T1-6 (diag scan=[0-9]+ (read=[12] col=(ucomm|comm) rc=(-?[0-9]+|none) rows=[0-9]+ pid1=(yes|no) own=(yes|no) dup=[0-9]+ malformed=[0-9]+ timeout=(yes|no) valid=(yes|no)|result=(CLEAN|DETECTED|UNKNOWN) hits=[0-9]+ scanner_pid=[0-9]+ excluded_self=[01] excluded_children=[0-9]+ why=(none|(ucomm|comm) read: [a-z0-9 ()<.]+|diagnostic log write failed))|gate op=(create-keychain|unlock-keychain|set-keychain-settings|show-keychain-info|dump-keychain|find-generic-password|delete-generic-password|add-generic-password) scan=[0-9]+ result=(CLEAN|DETECTED|UNKNOWN))$" | grep -q .'
  chk 'the why= field never carries a path or name on CLEAN' eval '! diagl | grep "^T1-6 diag scan=[0-9]* result=CLEAN" | grep -qv "why=none"'
  chk 'run completes (rc=0)' eval '[[ $RC == 0 ]]'; generic
scen T8_diag_unknown_rc; answers $ANS_PRE; ENVS=(MOCK_PS_RC=1); run --test=G1
  chk 'diagnostics: rc=1 valid=no, then result=UNKNOWN with reason' eval 'L "T1-6 diag scan=1 read=1 col=ucomm rc=1 rows=2" && L "valid=no" && grep -qE "^T1-6 diag scan=1 result=UNKNOWN hits=0 scanner_pid=[0-9]+ excluded_self=0 excluded_children=0 why=ucomm read: ps exit status 1$" $LOGF'
  chk 'second read never attempted after a failed first read' eval 'nL "read=2"'; chk 'STOP, zero keychain calls' calls_none; generic
scen T8_diag_counts; answers $ANS_PRE; ENVS=(MOCK_PS_MALFORMED=1 MOCK_PS_DUPPID=1); run --test=G1
  chk 'diagnostics count malformed and duplicate rows' L 'dup=1 malformed=1 timeout=no valid=no'
  chk 'UNKNOWN reason names the first structural failure' L 'why=ucomm read: malformed row(s) 1'; chk 'STOP, zero keychain calls' calls_none; generic
scen T8_overflow; answers $ANS_PRE; ENVS=(MOCK_PS_EXTRA=Safari R2D_SCAN_MAX=2); run --test=G1
  chk 'bounded memory: output above SCANMAX rows -> UNKNOWN' L 'process scan UNKNOWN (ucomm read: output exceeds 2 rows)'; chk 'STOP, zero keychain calls' calls_none; generic
scen T8_midline_stall; answers $ANS_PRE; ENVS=(MOCK_PS_PARTIAL_HANG=1 MOCK_PS_HANG_S=4 R2D_SCAN_TO=2); T0=$EPOCHREALTIME; run --test=G1; TD8=$(( EPOCHREALTIME - T0 ))
  chk 'ps stalls MID-LINE -> whole-read deadline still fires -> UNKNOWN timeout' L 'process scan UNKNOWN (ucomm read: timeout after 2s (no signal sent))'
  chk 'bounded: run ends inside 20 s' eval '(( TD8 < 20 ))'; HP=$(<$M/hang.pid 2>/dev/null)
  chk 'stalled mock not signalled (alive after exit) and ends by itself' eval '[[ $HP == <-> ]] && kill -0 $HP 2>/dev/null && { for i in {1..150}; do kill -0 $HP 2>/dev/null || break; sleep 0.1; done; ! kill -0 $HP 2>/dev/null; }'
  chk 'STOP, zero keychain calls' calls_none; generic
scen T8_spoof_sentinel; answers $ANS_PRE; ENVS=(MOCK_PS_SPOOF_SENTINEL=1); run --test=G1
  chk 'name with embedded newline + fake sentinels (fixed and guessed-nonce forms) -> rows malformed -> UNKNOWN, never CLEAN' eval 'L "process scan UNKNOWN (ucomm read: malformed row(s) 2)" && nL "process scan CLEAN"'
  chk 'later rows were not silently dropped (row count includes the TeamViewer row after the fake sentinels)' L 'rows=4 '
  chk 'STOP, zero keychain calls' calls_none; generic
scen T8_no_trailing_newline; answers $ANS_PRE; ENVS=(MOCK_PS_NO_NEWLINE=1); run --test=G1
  chk 'output without a final newline -> sentinel not on its own line -> no status -> UNKNOWN' L 'process scan UNKNOWN (ucomm read: no exit status (partial or aborted output))'
  chk 'diagnostics show rc=none' L 'col=ucomm rc=none'; chk 'STOP, zero keychain calls' calls_none; generic
scen T8_gate_timeout; answers $ANS_PRE; ENVS=(MOCK_PS_HANG_FROM=13 MOCK_PS_HANG_S=4 R2D_SCAN_TO=2); run --test=L14
  chk 'timeout inside the unlock gate -> UNKNOWN -> unlock blocked' eval 'L "R2D STOP: T1-6 gate unlock-keychain: process scan UNKNOWN (ucomm read: timeout after 2s (no signal sent))" && ! calls_has unlock-keychain'
  HP=$(<$M/hang.pid 2>/dev/null); chk 'gate-timeout mock not signalled; ends by itself' eval '[[ $HP == <-> ]] && { for i in {1..150}; do kill -0 $HP 2>/dev/null || break; sleep 0.1; done; ! kill -0 $HP 2>/dev/null; }'
  chk 'teardown deleted the keychain' calls_has delete-keychain; chk 'no residue' no_residue; generic
scen T8_logfail_result; answers $ANS_PRE; ENVS=(R2D_TEST_LOGFAIL_FROM=3); run --test=G1
  chk 'failure writing the RESULT diagnostic -> UNKNOWN -> STOP' eval 'L "R2D STOP: T1-6: process scan UNKNOWN (diagnostic log write failed)" && nL "process scan CLEAN" && calls_none'; generic
scen T8_logfail_gateline; answers $ANS_PRE; ENVS=(R2D_TEST_LOGFAIL_FROM=7); run --test=L14
  chk 'failure writing the GATE diagnostic -> create blocked' eval 'L "R2D STOP: T1-6 gate create-keychain: process scan UNKNOWN (diagnostic log write failed)" && ! calls_has create-keychain'; generic
scen T8_numeric_override; answers $ANS_PRE; ENVS=('R2D_SCAN_TO=a[1]'); run --test=G1
  chk 'non-numeric mock override refused before any scan or call (no arithmetic evaluation of env text)' eval '[[ $RC == 1 ]] && grep -q "non-numeric mock override refused" $SD/out && calls_none && [[ ! -s $M/ps_cols.log ]]'
scen T8_superops_present; answers $ANS_PRE; ENVS=(MOCK_PS_EXTRA=superops); run --test=G1
  chk 'SuperOps present -> DETECTED via kernel name and argv[0] (existing T1-6 refusal preserved)' L 'R2D STOP: T1-6: UI-automation / remote-control process running: comm:superops;ucomm:superops'
  chk 'result line records DETECTED with 2 hits' L 'T1-6 diag scan=1 result=DETECTED hits=2 '; chk 'STOP, zero keychain calls' calls_none; generic
scen T8_logfail_preflight; answers $ANS_PRE; ENVS=(R2D_TEST_LOGFAIL_FROM=1); run --test=G1
  chk 'diagnostic write failure -> UNKNOWN -> STOP (fail closed)' L 'R2D STOP: T1-6: process scan UNKNOWN (diagnostic log write failed) - not treated as clean'
  chk 'never CLEAN, zero keychain calls' eval 'nL "process scan CLEAN" && calls_none'; generic
scen T8_logfail_gate; answers $ANS_PRE; ENVS=(R2D_TEST_LOGFAIL_FROM=4); run --test=L14
  chk 'diagnostic failure inside the create gate -> protected op blocked' L 'R2D STOP: T1-6 gate create-keychain: process scan UNKNOWN (diagnostic log write failed)'
  chk 'create-keychain never reached the (mock) security tool' eval '! calls_has create-keychain'; chk 'no residue' no_residue; generic
scen T8_clean_then_detected_create; answers $ANS_PRE; ENVS=(MOCK_PS_LATE_FROM=3); run --test=L14
  chk 'preflight CLEAN, then a fresh scan before create finds TeamViewer -> blocked' eval 'L "T1-6: process scan CLEAN" && L "R2D STOP: T1-6 gate create-keychain: UI-automation / remote-control process running: comm:TeamViewer;ucomm:TeamViewer"'
  chk 'verdict names the gate' L 'STOPPED (T1-6 gate create-keychain DETECTED)'
  chk 'create-keychain never reached the (mock) security tool' eval '! calls_has create-keychain'; generic
scen T8_clean_then_detected_unlock; answers $ANS_PRE; ENVS=(MOCK_PS_LATE_FROM=13); run --test=L14
  chk 'create allowed by its own fresh CLEAN; the later unlock gate sees DETECTED -> blocked' eval 'L "T1-6 gate op=create-keychain scan=2 result=CLEAN" && L "R2D STOP: T1-6 gate unlock-keychain: UI-automation"'
  chk 'earlier CLEAN not reused: create reached security, unlock did not' eval 'calls_has create-keychain && ! calls_has unlock-keychain'
  chk 'teardown still deleted the keychain' calls_has delete-keychain; chk 'no residue' no_residue; generic
scen T8_clean_then_unknown_unlock; answers $ANS_PRE; ENVS=(MOCK_PS_LATE_RC_FROM=13); run --test=L14
  chk 'later scan UNKNOWN -> unlock blocked' eval 'L "R2D STOP: T1-6 gate unlock-keychain: process scan UNKNOWN (ucomm read: ps exit status 3)" && ! calls_has unlock-keychain'
  chk 'verdict names the gate' L 'STOPPED (T1-6 gate unlock-keychain UNKNOWN)'; chk 'no residue' no_residue; generic
scen T8_repeated_fresh_G1; answers $ANS_G1; run --test=G1 --probe=attr
  chk 'G1 completes (rc=0)' eval '[[ $RC == 0 ]]'
  NG=$(grep -c '^T1-6 gate op=' $LOGF); NQ=$(wc -l < $M/gate_seq.log | tr -d ' ')
  chk "every dialog-capable op reached security under its own gate: gate lines=$NG = gated calls=$NQ (>= 40)" eval '(( NG == NQ && NG >= 40 ))'
  chk 'no dialog-capable call without a gate id (gate=none never appears)' eval '! grep -q " gate=none " $M/gate_seq.log'
  chk 'every call used a DIFFERENT fresh gate (no reuse of an earlier CLEAN)' eval '[[ $(awk "{print \$2}" $M/gate_seq.log | sort | uniq -d | wc -l | tr -d " ") == 0 ]]'
  chk 'each call ran after its gate scan (ps call counter >= 2 x gate scan id)' eval 'awk "{split(\$2,a,\"=\"); split(\$3,b,\"=\"); if (b[2]+0 < 2*a[2]) bad=1} END{exit bad}" $M/gate_seq.log'
  chk 'all 8 dialog-capable op types are gated in G1 (create/unlock/settings/info/dump/find/delete/add)' eval '[[ $(grep -oE "^T1-6 gate op=[a-z-]+" $LOGF | sort -u | wc -l | tr -d " ") == 8 ]]'
  chk 'error paths gated: locked overwrite (add, rc!=0) and locked delete in L4 each had a gate' eval '[[ $(grep -c "^T1-6 gate op=add-generic-password" $LOGF) == 2 && $(grep -c "^T1-6 gate op=delete-generic-password" $LOGF) == 1 ]]'
  chk 'L5: exactly two secret reads (-w) tagged with two ADJACENT gate ids (gates back-to-back, no scan while a reader ran)' eval 'awk "/^find-generic-password .* w=1/{split(\$2,a,\"=\"); g[++n]=a[2]+0} END{ if (n<2) exit 1; for (i=1;i<n;i++) if ((g[i+1]-g[i])==1 || (g[i]-g[i+1])==1) ok=1; exit !ok }" $M/gate_seq.log && grep -q "^T1-6 gate op=find-generic-password" $LOGF'
  generic
scen T8_alt_path_L13; answers $ANS_PRE; run --test=L13
  chk 'L13 direct wrong-passphrase unlock (error path) is gated; every dialog-capable call gated' eval '[[ $(grep -c "^T1-6 gate op=unlock-keychain" $LOGF) -ge 2 && $(grep -c "^T1-6 gate op=" $LOGF) == $(wc -l < $M/gate_seq.log | tr -d " ") ]]'; generic
scen T8_alt_path_L14_L6; answers $ANS_PRE n A k D n U k C; run --test=L14,L6 --probe=attr
  chk 'multi-group run: every dialog-capable call across groups gated' eval '[[ $(grep -c "^T1-6 gate op=" $LOGF) == $(wc -l < $M/gate_seq.log | tr -d " ") ]]'; generic
scen T8_v3r4_bypass_attempt; answers $ANS_PRE; ENVS=(R2D_TEST_SUBSHELL_OP=1); run --test=L14
  chk 'dialog-capable op attempted from a subshell is refused and recorded (not performed)' eval 'grep -q "^R2D GATE-REFUSED op=find-generic-password" $LOGF && ! grep -q "^find-generic-password " $M/gate_seq.log'
  chk 'the parent notices at its next gate and STOPs the run' eval 'L "R2D STOP: V3R-4: a dialog-capable op was attempted outside the harness process - run stopped" && L "STOPPED (gate bypass attempt detected)"'
  chk 'no unlock happened after the bypass attempt' eval '! calls_has unlock-keychain'; chk 'no residue' no_residue; generic
scen T8_v3r4_bypass_bg; answers $ANS_PRE; ENVS=(R2D_TEST_SUBSHELL_OP=bg); run --test=L14
  chk 'background ( ) & form: dialog-capable op refused (not performed) and the run STOPs' eval 'grep -q "^R2D GATE-REFUSED op=find-generic-password" $LOGF && ! grep -q "^find-generic-password " $M/gate_seq.log && L "STOPPED (gate bypass attempt detected)"'; chk 'no residue' no_residue; generic
scen T8_v3r4_bypass_pipe; answers $ANS_PRE; ENVS=(R2D_TEST_SUBSHELL_OP=pipe); run --test=L14
  chk 'pipeline form: dialog-capable op refused (not performed) and the run STOPs' eval 'grep -q "^R2D GATE-REFUSED op=find-generic-password" $LOGF && ! grep -q "^find-generic-password " $M/gate_seq.log && L "STOPPED (gate bypass attempt detected)"'; chk 'no residue' no_residue; generic
scen T8_nonce_samples   # in-suite version of the nonce check (runner side; reads /dev/urandom only)
  NZ=$(/bin/zsh -f -c 'emulate -L zsh; zmodload zsh/system; export LC_ALL=C; eval "$(awk "/^r2d_nonce\\(\\) \\{/{f=1} f{print} f&&/builtin print -r -- \\\$\\{\\(L\\)out\\}; \\}\$/{exit}" $1)"; typeset -A seen; integer bad=0 dup=0; for i in {1..500}; do n=$(r2d_nonce); [[ $n =~ "^[0-9a-f]{16}\$" ]] || (( bad++ )); [[ -n ${seen[$n]-} ]] && (( dup++ )); seen[$n]=1; done; print -r -- "$bad $dup"' x $H)
  chk "500 harness nonces: all 16-hex, none repeated (malformed/dup = $NZ)" eval '[[ $NZ == "0 0" ]]'
scen T8_v3r4_detected_mid_run; answers $ANS_G1; ENVS=(MOCK_PS_LATE_FROM=21); run --test=G1 --probe=attr
  chk 'state turns DETECTED mid-run -> the next dialog-capable op (whatever it is) is blocked' eval 'grep -qE "^R2D STOP: T1-6 gate (create-keychain|unlock-keychain|set-keychain-settings|show-keychain-info|dump-keychain|find-generic-password|delete-generic-password|add-generic-password): UI-automation" $LOGF'
  BL=$(grep -oE "^T1-6 gate op=[a-z-]+ scan=[0-9]+ result=DETECTED" $LOGF | sed "s/.*scan=\([0-9]*\).*/\1/")
  chk "blocked op (gate scan $BL) never reached security; earlier ops did" eval '[[ -n $BL ]] && ! grep -q " gate=$BL " $M/gate_seq.log && [[ -s $M/gate_seq.log ]]'
  chk 'teardown deleted the keychain' calls_has delete-keychain; chk 'no residue' no_residue; generic
scen T8_static_choke_point   # STATIC: the gate cannot be bypassed by another entry point or by error handling
  chk 'every reference to SEC (comments stripped) is one of the 7 audited lines: 2 assignments, sec_kc non-dialog call, secx, sec_global, is_wd compare, watchdog arg' eval '[[ $(sed "s/[[:space:]]#.*$//" $H | grep -vE "^ *#" | grep -cE "\\\$\\{?SEC\\}?([^A-Za-z_]|$)|(^|[^A-Za-z_])SEC=") == 7 ]]'
  chk 'no backtick command substitution and no eval of SEC anywhere in the harness' eval '! grep -vE "^ *#" $H | grep -q "\`" && ! grep -qE "eval.*SEC" $H'
  chk 'sec_kc routes every dialog-capable op through main_only + t16_gate + secx' eval 'grep -qF "if dlgop \"\$1\"; then main_only \"\$1\" || exit 86; t16_gate \"\$1\"; secx" $H'
  chk 'dialog-capable inventory is exactly the 7 sec_kc ops (+ sec_i add)' eval 'grep -qF "dlgop() { case \$1 in create-keychain|unlock-keychain|set-keychain-settings|show-keychain-info|dump-keychain|find-generic-password|delete-generic-password) return 0;; esac; return 1; }" $H && grep -qF "main_only add-generic-password || exit 86; t16_gate add-generic-password" $H'
  chk 'sec_kc and sec_cap gate in the main shell before invoking secx' eval '[[ $(grep -cE "main_only \"\\\$1\" \|\| exit 86; t16_gate" $H) == 2 ]]'
  chk 'sec_bg_pair: main_only, then two gates back-to-back, then the readers' eval 'grep -qF "t16_gate find-generic-password; ga=\$SCANID; t16_gate find-generic-password; gb=\$SCANID" $H && awk "/^sec_bg_pair\\(\\)/{f=1} f&&/main_only find-generic-password \\|\\| exit 86/{m=1} f&&/t16_gate find-generic-password; ga=/{if(m) ok=1} f&&/BGB=/{exit} END{exit !ok}" $H'
  chk 'no keychain helper captured in a subshell except the mock-only bypass hook' eval '[[ $(grep -nE "\\\$\\((sec_kc|sec_i|probe|readA|acl_of|mdat|pstate)" $H | grep -vcE "R2D_TEST_SUBSHELL_OP|^[0-9]+:    1\) : \"\\\$\(sec_kc find-generic-password -a r2dacct -s R2D-A 2>/dev/null\)\";;\$") == 0 ]]'
  chk 'sec_i and sec_global cannot create or unlock (allow-lists)' eval 'grep -q "\[\[ \$1 == add-generic-password" $H && grep -q "list-keychains -d.|.default-keychain -d" $H'
  chk 'no create/unlock inside a command substitution' eval '! grep -nE "\\\$\\((sec_kc (create|unlock)|unlock_ctl|create )" $H | grep -q .'
  chk 'the gate refuses to run outside the harness process and stops (exit) on DETECTED/UNKNOWN' eval 'grep -q "sysparams\[pid\] == \$ME \]\] || {" $H && awk "/^t16_decide\\(\\)/{f=1} f{print} f&&/esac; }/{exit}" $H | grep -c stop | grep -qx 2'
  chk 'mock isolation: profile denies exec of real /bin/ps and /usr/bin/security' eval '[[ $PROF == *"(deny process-exec (literal \"/bin/ps\"))"* && $PROF == *"(deny process-exec (literal \"/usr/bin/security\"))"* ]]'
fi

# ---------- 9. final cleanup audit (whole work dir; test-owned resources only) ----------
if [[ -z $FILTER ]]; then CUR=FINAL_cleanup
  live=''; for p in ${=OWNED}; do kill -0 $p 2>/dev/null && live+=" $p"; done
  chk 'no test-owned process (harness/observer/watchdog/decoy/writer) still alive' eval '[[ -z $live ]]'
  wl=''; for p in ${=OWNED}; do [[ $(/bin/ps -ww -o command= -p $p 2>/dev/null) == *r2d_watchdog*"$W/"* ]] && wl+=" $p"; done
  chk 'no recorded watchdog of this work dir still running (exact-PID checks of recorded PIDs only)' eval '[[ -z $wl ]]'
  chk 'no named pipe left anywhere in the work dir' eval '[[ -z $(find $W -type p) ]]'
  chk 'no r2d-run.* directory left in any scenario TMPDIR' eval '[[ -z $(print -l $W/*/tmp/r2d-run.*(N)) ]]'
  chk 'no r2d-lock directory left in any scenario TMPDIR' eval '[[ -z $(print -l $W/*/tmp/r2d-lock(N)) ]]'
  chk 'no r2d-scan.* temp file left in any scenario TMPDIR' eval '[[ -z $(print -l $W/*/tmp/r2d-scan.*(N)) ]]'
  chk 'no simulated keychain (mock state or keychain file) left' eval '[[ -z $(print -l $W/*/mock/state/*r2d.keychain-db(N) $W/**/r2d.keychain-db(N)) ]]'
  leak=0; for sf in $W/*/mock/secrets.seen(N); do for v in ${(f)"$(<$sf)"}; do
    grep -rqF --exclude=secrets.seen -- "$v" $W/*/home $W/*/out $W/*/obs.out(N) $W/*/mock/calls.log(N) && leak=1; done; done
  chk 'no synthetic secret value in any log, stdout or argv log across all scenarios' eval '(( leak == 0 ))'
  print -r -- "kills recorded: $(grep -c . $W/kills.txt)" >> $RES
fi
# ---------- 10. kernel tripwire (every run, filtered or not; fail-closed) ----------
CUR=KERNEL_tripwire; KD=$W/kctl; mkdir -p $KD/bin; print -r -- '#!/bin/sh' > $KD/bin/security; print -r -- 'echo RAN' >> $KD/bin/security; chmod 700 $KD/bin/security
sandbox-exec -p "(version 1)(allow default)(deny process-exec (literal \"$KD/bin/security\"))" /bin/zsh -f -c "$KD/bin/security 2>/dev/null"
sleep 3; /usr/bin/log show --start "$T_START_LOCAL" --style compact --predicate "eventMessage CONTAINS \"Sandbox\" AND (eventMessage CONTAINS \"/usr/bin/security\" OR eventMessage CONTAINS \"com.apple.SecurityServer\" OR eventMessage CONTAINS \"com.apple.securityd\" OR eventMessage CONTAINS \"$REALKC\" OR eventMessage CONTAINS \"$KD/bin/security\")" > $W/kernel_sandbox_security.txt 2> $W/kernel_log.err; KRC=$?
chk 'kernel log query succeeded (rc=0, header line present)' eval '[[ $KRC == 0 && $(head -1 $W/kernel_sandbox_security.txt) == Timestamp* ]]'
chk 'positive control: a stderr-suppressed dummy denial inside the run window is visible' grep -qF -- "process-exec* $KD/bin/security" $W/kernel_sandbox_security.txt
chk 'zero sandbox denials of security exec, securityd mach-lookup or real Keychains access during the whole run window' eval '! kern_hit $W/kernel_sandbox_security.txt'
print -r -- "kernel window start (local): $T_START_LOCAL ; matched lines: $(( $(grep -c . $W/kernel_sandbox_security.txt) - 1 ))" >> $RES
print -r -- "ELAPSED_S=${$(( EPOCHREALTIME - T_START ))%.*}" >> $RES
print -r -- "TOTAL PASS=$NP FAIL=$NF" >> $RES
cat $RES; (( NF == 0 ))
