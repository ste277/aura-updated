#!/bin/bash
# Replays the CI "Ephemeris / panchang tests" job (math-core-tests) locally,
# in order, continuing past failures. Usage: run-eph.sh <worktree> <steps.jsonl> <outdir>
set -u
WT="$1"; STEPS="$2"; OUT="$3"
mkdir -p "$OUT"
cd "$WT" || exit 2
WEBNM="$WT/apps/web/node_modules"
ASIDE="$WT/apps/web/.node_modules_aside_ci_replay"
# Phase 1 (steps before "Install web deps"): no apps/web/node_modules, as in CI.
[ -d "$WEBNM" ] && mv "$WEBNM" "$ASIDE"
: > "$OUT/summary.txt"
while IFS= read -r line; do
  i=$(printf '%s' "$line" | python3 -c 'import sys,json;print(json.load(sys.stdin)["i"])')
  name=$(printf '%s' "$line" | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])')
  run=$(printf '%s' "$line" | python3 -c 'import sys,json;print(json.load(sys.stdin)["run"])')
  wd=$(printf '%s' "$line" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["wd"] or "")')
  envs=$(printf '%s' "$line" | python3 -c 'import sys,json,shlex;d=json.load(sys.stdin);e=d["env"] or {};print(" ".join(f"{k}={shlex.quote(str(v))}" for k,v in e.items()))')
  if [ "$name" = "Install root deps" ]; then echo "SKIP $i $name (symlinked root deps)" >> "$OUT/summary.txt"; continue; fi
  if [ "$name" = "Install web deps" ]; then
    [ -d "$ASIDE" ] && mv "$ASIDE" "$WEBNM"
    echo "SKIP $i $name (restored npm ci install)" >> "$OUT/summary.txt"; continue
  fi
  dir="$WT"; [ -n "$wd" ] && dir="$WT/$wd"
  start=$(date +%s)
  ( cd "$dir" && eval "env $envs bash -e -c $(printf '%q' "$run")" ) > "$OUT/step-$i.log" 2>&1
  rc=$?
  dur=$(( $(date +%s) - start ))
  if [ $rc -eq 0 ]; then echo "PASS $i ${dur}s $name" >> "$OUT/summary.txt"; else echo "FAIL $i rc=$rc ${dur}s $name" >> "$OUT/summary.txt"; fi
done < <(tail -n +2 "$STEPS")
# Safety: never leave web deps moved aside.
[ -d "$ASIDE" ] && mv "$ASIDE" "$WEBNM"
echo "DONE pass=$(grep -c '^PASS' "$OUT/summary.txt") fail=$(grep -c '^FAIL' "$OUT/summary.txt")" >> "$OUT/summary.txt"
