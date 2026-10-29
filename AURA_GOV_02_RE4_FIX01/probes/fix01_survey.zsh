#!/bin/zsh -f
# FIX01 read-only survey: real comm vs ucomm behaviour and superops identification.
# Reads the process table and file metadata only. Signals nothing, modifies nothing, never invokes security.
# Unrelated processes' arguments are never printed; only counts and denylist-matching NAMES are output.
emulate -L zsh
DENYRE='^(cua_node|codex|chatgpt|claude|zoom\.us|splashtop|islonline|isl online|superops|teamviewer|anydesk|rustdesk|screenconnect|screensharingd|ardagent|hammerspoon|keyboard maestro|keyboardmaestro|bettertouchtool|osascript)'
U=$(/bin/ps -ww -axo pid=,ppid=,ucomm= 2>/dev/null); ru=$?
C=$(/bin/ps -ww -axo pid=,ppid=,comm= 2>/dev/null); rc=$?
print -r -- "S-1 '/bin/ps -ww -axo pid=,ppid=,ucomm=' rc=$ru lines=${#${(f)U}} ; '/bin/ps -ww -axo pid=,ppid=,comm=' rc=$rc lines=${#${(f)C}}"
typeset -A UC CC
for l in ${(f)U}; do [[ $l =~ '^ *([0-9]+) +([0-9]+) +(.*)$' ]] && UC[$match[1]]=$match[3]; done
for l in ${(f)C}; do [[ $l =~ '^ *([0-9]+) +([0-9]+) +(.*)$' ]] && CC[$match[1]]=$match[3]; done
integer mx=0 both=0 diff=0 tr16=0
for p in ${(k)UC}; do (( ${#UC[$p]} > mx )) && mx=${#UC[$p]}; done
for p in ${(k)UC}; do [[ -n ${CC[$p]-} ]] || continue; (( both++ )); b=${CC[$p]:t}
  if [[ ${b[1,16]} != ${UC[$p]} ]]; then (( diff++ )); fi; (( ${#b} > 16 )) && (( tr16++ )); done
print -r -- "S-2 ucomm max_len=$mx ; pids in both tables=$both ; basename(comm)[1,16] != ucomm for $diff ; comm basenames longer than 16 chars: $tr16"
print -r -- "S-3 denylist-prefix matches (lowercased NAMES only; count per column):"
for p in ${(k)UC}; do n=${(L)UC[$p]}; [[ $n =~ $DENYRE ]] && print -r -- "  ucomm: ${UC[$p]}"; done | /usr/bin/sort | /usr/bin/uniq -c
for p in ${(k)CC}; do n=${(L)${CC[$p]:t}}; [[ $n =~ $DENYRE ]] && print -r -- "  comm-basename: ${CC[$p]:t}"; done | /usr/bin/sort | /usr/bin/uniq -c
integer only_c=0 only_u=0
for p in ${(k)CC}; do n=${(L)${CC[$p]:t}}; u=${(L)${UC[$p]-}}; if [[ $n =~ $DENYRE && ! $u =~ $DENYRE ]]; then (( only_c++ )); print -r -- "  comm-only match: comm=${CC[$p]:t} ucomm=${UC[$p]-<none>}"; fi; done
for p in ${(k)UC}; do u=${(L)UC[$p]}; n=${(L)${CC[$p]:t}}; if [[ $u =~ $DENYRE && ! $n =~ $DENYRE ]]; then (( only_u++ )); print -r -- "  ucomm-only match: ucomm=${UC[$p]} comm=${CC[$p]:t}"; fi; done
print -r -- "S-4 matches only in comm=$only_c ; only in ucomm=$only_u"
# ---- superops: read-only identification ----
print -r -- "S-5 superops processes (pid ppid user ucomm exec-path):"
for p in ${(k)UC}; do
  [[ ${(L)UC[$p]} == superops* || ${(L)${CC[$p]:t}} == superops* ]] || continue
  usr=$(/bin/ps -o user= -p $p 2>/dev/null); pp=$(/bin/ps -o ppid= -p $p 2>/dev/null)
  print -r -- "  pid=$p ppid=${pp//[[:space:]]/} user=${usr//[[:space:]]/} ucomm=${UC[$p]} comm=${CC[$p]}"
  txt=$(/usr/sbin/lsof -nP -p $p -a -d txt -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p' | /usr/bin/head -1); print -r -- "    lsof txt (first): ${txt:-<unavailable: lsof rc=$? (other-user process needs root)>}"
done
SP=''; for p in ${(k)CC}; do [[ ${(L)${CC[$p]:t}} == superops* && ${CC[$p]} == /* ]] && { SP=${CC[$p]}; break; }; done
if [[ -n $SP && -f $SP ]]; then
  print -r -- "S-6 exec path (from comm, i.e. argv[0]; verified as an existing file): $SP"
  /usr/bin/codesign -dv --verbose=2 -- "$SP" 2>&1 | /usr/bin/grep -E '^(Executable|Identifier|Format|Authority|TeamIdentifier|Timestamp|Signed Time|Runtime Version|CodeDirectory)' | /usr/bin/sed 's/^/    /'
  print -r -- "    codesign --verify rc: $(/usr/bin/codesign --verify --strict -- "$SP" >/dev/null 2>&1; print $?)"
  print -r -- "    spctl assess: $(/usr/sbin/spctl --assess --type execute -- "$SP" 2>&1 | /usr/bin/head -1)"
  /bin/ls -l -- "$SP" | /usr/bin/awk '{print "    owner="$3" group="$4" mode="$1}'
else print -r -- "S-6 exec path not established from comm (argv[0] not an absolute existing path)"; fi
print -r -- "S-7 launchd job definitions mentioning superops (labels and Program only; arguments NOT printed):"
for d in /Library/LaunchDaemons /Library/LaunchAgents $HOME/Library/LaunchAgents; do
  for f in $d/*(N.); do /usr/bin/grep -qi superops -- "$f" 2>/dev/null || continue
    lb=$(/usr/bin/plutil -extract Label raw -o - -- "$f" 2>/dev/null); pg=$(/usr/bin/plutil -extract Program raw -o - -- "$f" 2>/dev/null)
    a0=$(/usr/bin/plutil -extract ProgramArguments.0 raw -o - -- "$f" 2>/dev/null)
    print -r -- "  $f label=${lb:-?} Program=${pg:-<none>} ProgramArguments[0]=${a0:-<none>} RunAtLoad=$(/usr/bin/plutil -extract RunAtLoad raw -o - -- "$f" 2>/dev/null) KeepAlive=$(/usr/bin/plutil -extract KeepAlive raw -o - -- "$f" 2>/dev/null | /usr/bin/head -1)"
  done
done
print -r -- "S-8 done (no process signalled, nothing modified)"
