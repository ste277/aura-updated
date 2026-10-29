#!/bin/zsh -f
# AURA-GOV-02-RE-4-RERUN-01 STOP-leg probe. Real /bin/ps, naturally running processes only, NO dummy process.
# Executes the EXACT pinned v2 T1-6 block - scanner AND its CLEAN/DETECTED/UNKNOWN case with the stop() call -
# extracted from the hash-verified v2 harness (the harness itself is not executed, not modified).
# Every Keychain-reaching harness function is replaced by a TRIPWIRE stub; a SENTINEL marks "continued past T1-6".
# Never invokes security, never touches a keychain, never signals anything except (only on a 10 s timeout) its own ps child.
# Unrelated command lines are never recorded: only denylisted NAMES and aggregate counts.
# Usage: rr01_stop_probe.zsh <v2 harness> <expected sha256> <evidence dir> <private temp dir that must not exist>
emulate -L zsh; zmodload zsh/datetime zsh/system; umask 077
H=${1:?}; EXPECT=${2:?}; OUT=${3:?}; T=${4:?}
[[ $T == /private/tmp/claude-501/*/scratchpad/rr01_tmp_* ]] || { print -r -- 'HOLD: temp dir must be a scratchpad rr01_tmp_* path'; exit 3; }
L=$OUT/rr01_stop_run.log; [[ -d $OUT && -w $OUT ]] && : > $L || { print -r -- 'HOLD: evidence dir not writable'; exit 3; }
log() { builtin print -r -- "$*" >> $L; }
log "# RR01 STOP-leg probe $(/bin/date -u +%FT%TZ) macOS=$(/usr/bin/sw_vers -productVersion) build=$(/usr/bin/sw_vers -buildVersion) driver_pid=$$ uid=$(/usr/bin/id -u)"
log "probe_sha256=$(/usr/bin/shasum -a 256 $0 | /usr/bin/cut -d' ' -f1)"
HH=$(/usr/bin/shasum -a 256 $H | /usr/bin/cut -d' ' -f1); log "harness_v2_sha256=$HH expected=$EXPECT"
[[ $HH == $EXPECT ]] || { log 'HOLD: harness hash mismatch - not executed'; exit 3; }
[[ ! -e $T ]] || { log 'HOLD: temp dir exists - not executed'; exit 3; }
BLK=$(/usr/bin/awk '/^# T1-6 process scan \(FIX01/{f=1} f{print} f&&/^esac$/{exit}' $H)
log "extract: lines=${#${(f)BLK}} sha256=$(builtin print -rn -- "$BLK" | /usr/bin/shasum -a 256 | /usr/bin/cut -d' ' -f1)"
[[ $BLK == *'t16_scan'$'\n''case $SCAN in'* && $BLK == *'DETECTED) stop '* && $BLK == *'*) VERDICT='* ]] || { log 'HOLD: extracted block lacks scanner+case+stop'; exit 3; }
[[ $BLK != *security* && $BLK != *sec_* && $BLK != *glob_state* && $BLK != *Keychains* && $BLK != *pkill* && $BLK != *killall* ]] || { log 'HOLD: extracted block references a protected operation'; exit 3; }
# names-only snapshot of denylist-relevant processes (for the before/after state check); counts only otherwise
snap() { local o; o=$(/bin/ps -ww -axo pid=,ucomm= 2>/dev/null)
  log "$1 total_rows=${#${(f)o}}"
  builtin print -r -- "$o" | /usr/bin/awk '{p=$1; $1=""; sub(/^ /,""); sub(/ +$/,""); l=tolower($0); if (l ~ /^(claude|chatgpt|codex|superops|osascript|teamviewer|anydesk|zoom\.us|screenconnect|splashtop|rustdesk|hammerspoon|bettertouchtool|keyboard ?maestro|ardagent|screensharingd)/) print p" "$0}' | /usr/bin/sort -n > $OUT/rr01_${1}_denylisted_names.txt
  log "$1 denylisted_name_rows=$(/usr/bin/wc -l < $OUT/rr01_${1}_denylisted_names.txt | /usr/bin/tr -d ' ')"; }
snap before
/bin/mkdir -m 700 -- "${T:?}" || exit 3
log "private temp dir created mode=$(/usr/bin/stat -f %Lp -- "${T:?}")"
# ---- the STOP leg: exact harness block in a subshell that stands in for the harness process ----
(
  ME=$sysparams[pid]; TD=$T; PSB=/bin/ps; SCANMIN=20; SCANTO=10; SCANF=''; NROWS=0; VERDICT=STOPPED
  now() { builtin print -r -- $EPOCHREALTIME; }
  stop() { log "R2D STOP: $*"; log "VERDICT: $VERDICT"; log "stop() called -> exit 2 (harness would now run teardown with KC/SL0/WDPID/PIDS empty)"; exit 2; }
  for f in sec_kc sec_i sec_global glob_state create ask unlock_ctl lock_ctl; do functions[$f]="log 'TRIPWIRE: $f called'; exit 99"; done
  log "scan process (stands for the harness) pid=$ME parent=$$ ; SCANMIN=$SCANMIN SCANTO=${SCANTO}s TD=private-0700"
  t_s=$EPOCHREALTIME
  eval "$BLK"
  log "SENTINEL: execution continued past T1-6 (SCAN=$SCAN) - the next harness step would be the attestations and glob_state"
  exit 0
) ; RC=$?
log "STOP-leg subshell exit status=$RC (2 = stop() called; 0 = continued past T1-6; 99 = protected function reached)"
leftover=$(builtin print -l -- "$T"/r2d-scan.*(N)); log "scan temp files left in private dir: ${leftover:-none}"
/bin/rmdir -- "${T:?}" && log 'private temp dir removed (exact guarded path)'
snap after
/usr/bin/cmp -s $OUT/rr01_before_denylisted_names.txt $OUT/rr01_after_denylisted_names.txt && log 'state: denylisted process set (pid+name) IDENTICAL before and after' || log 'state: denylisted process set CHANGED between snapshots (see files)'
exit $RC
