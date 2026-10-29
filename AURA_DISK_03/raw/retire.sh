#!/bin/bash
# AURA-DISK-03 guarded retirement. Usage:
#   retire.sh baseline              -> capture baseline files
#   retire.sh check  <name>         -> read-only per-worktree gate (exit 1 on any discrepancy)
#   retire.sh retire <name>         -> gate, then M1/M2 removal, then post-checks (exit 1 = STOP)
# Never uses --force, rm, prune, or trailing-slash deletes.
set -u
export GIT_OPTIONAL_LOCKS=0
ROOT=/Users/stephen/Desktop/Claude/auraschedule-math-core
E=$ROOT/AURA_DISK_03/raw
PF=$ROOT/AURA_DISK_02/raw/pf.tsv
PFSYM=$ROOT/AURA_DISK_02/raw/pfsym.tsv
OM=1741a95a3bc5c364f71a743442a8e31557756c33
LOG=$E/exec_log.tsv
cd "$ROOT" || exit 2

field() { awk -F'\t' -v n="$1" -v c="$2" 'NR==1{for(i=1;i<=NF;i++) h[$i]=i; next} $1==n{print $h[c]}' "$PF"; }

shared_fp() {  # fingerprint of shared targets (no secret content recorded: env file hashed only)
  for d in "$ROOT/node_modules" "$ROOT/apps/web/node_modules" "$ROOT/.claude/worktrees/apps" "$ROOT/.claude/worktrees/agent-a8da33ba4e882df81"; do
    printf '%s\t%s\t%s\n' "$d" "$(stat -f '%i %p %m' "$d" 2>/dev/null || echo MISSING)" "$(find "$d" 2>/dev/null | LC_ALL=C sort | shasum -a 256 | cut -c1-16)"
  done
  printf '%s\t%s\t%s\n' "$ROOT/apps/web/.env.local" "$(stat -f '%i %p %m %z' "$ROOT/apps/web/.env.local")" "$(shasum -a 256 "$ROOT/apps/web/.env.local" | cut -c1-16)"
}
main_state() { printf 'HEAD %s\n' "$(git rev-parse HEAD)"; git status --porcelain=v1 --untracked-files=no; }
free_bytes() { diskutil apfs list | awk '/Capacity Not Allocated/{for(i=1;i<=NF;i++) if($i ~ /^[0-9]+$/){print $i; exit}}'; }
log() { printf '%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" "$2" "$3" >> "$LOG"; }
fail() { log "$1" STOP "$2"; echo "STOP [$1]: $2"; exit 1; }

check() {
  N=$1; P=$(field "$N" path); B=$(field "$N" branch_now); H=$(field "$N" head_now)
  [ -n "$P" ] || fail "$N" "not in approved preflight list"
  [ -d "$P" ] && [ ! -L "$P" ] || fail "$N" "path missing or is a symlink"
  [ "$(cd "$P" && pwd -P)" = "$P" ] || fail "$N" "canonical path differs"
  blk=$(git worktree list --porcelain | awk -v p="worktree $P" '$0==p{f=1;next} f&&/^$/{exit} f{print}')
  [ -n "$blk" ] || fail "$N" "not registered"
  [ "$(printf '%s\n' "$blk" | awk '/^HEAD /{print $2}')" = "$H" ] || fail "$N" "HEAD changed"
  [ "$(printf '%s\n' "$blk" | awk '/^branch /{print $2}')" = "refs/heads/$B" ] || fail "$N" "branch changed"
  printf '%s\n' "$blk" | grep -qE '^(locked|prunable)' && fail "$N" "locked/prunable"
  [ "$(git rev-parse -q --verify "refs/heads/$B")" = "$H" ] || fail "$N" "branch ref != HEAD"
  git merge-base --is-ancestor "$H" "$OM" || fail "$N" "HEAD not in approved origin/main"
  [ "$(git rev-list --count "$H" --not "$OM")" = 0 ] || fail "$N" "unique commits"
  for c in $(git -C "$P" reflog --format=%H HEAD 2>/dev/null | sort -u); do
    [ -n "$(git for-each-ref --contains "$c" --count=1)" ] || fail "$N" "reflog-only commit $c"
  done
  ST=$(git -C "$P" status --porcelain=v1 --untracked-files=all)
  EXP_U=$(field "$N" untracked_symlinks)
  if [ -n "$EXP_U" ]; then EXPST=$'?? apps/web/node_modules\n?? node_modules'; else EXPST=""; fi
  [ "$ST" = "$EXPST" ] || fail "$N" "status differs from baseline: $(printf '%s' "$ST" | tr '\n' ';')"
  IG=$(git -C "$P" status --porcelain=v1 --ignored=matching --untracked-files=all | grep '^!!' | cut -c4- | sed 's|/$||' | tr '\n' ';')
  [ "$IG" = "$(field "$N" ignored_entries)" ] || fail "$N" "ignored entries differ: $IG"
  # outside-pointing symlinks must equal preflight set exactly
  NOW=$(find "$P" -type l 2>/dev/null | while IFS= read -r l; do t=$(readlink "$l"); d=$(cd "$(dirname "$l")" && cd "$(dirname "$t")" 2>/dev/null && pwd -P); r="$d/$(basename "$t")"; case "$r" in ("$P"/*) ;; (*) printf '%s\t%s\n' "${l#$P/}" "$r";; esac; done | LC_ALL=C sort)
  WAS=$(awk -F'\t' -v n="$N" '$1==n{print $2"\t"$4}' "$PFSYM" | LC_ALL=C sort)
  [ "$NOW" = "$WAS" ] || fail "$N" "outside symlink set differs"
  mount | grep -qF "$P" && fail "$N" "mount under path"
  [ -z "$(lsof -a -d cwd -Fn 2>/dev/null | grep -F "n$P")" ] || fail "$N" "process cwd in worktree"
  [ -z "$(lsof +D "$P" -Fp 2>/dev/null)" ] || fail "$N" "open file in worktree"
  [ -z "$(lsof -d txt -Fn 2>/dev/null | grep -F "n$P/")" ] || fail "$N" "executable from worktree"
  ps -axo command= | grep -F "$P" | grep -v -e grep -e retire.sh >/dev/null && fail "$N" "process cmdline references worktree"
  log "$N" CHECK_OK "branch=$B head=$H"
}

retire() {
  N=$1; check "$N"
  P=$(field "$N" path); B=$(field "$N" branch_now); H=$(field "$N" head_now)
  FP0=$(shared_fp); MS0=$(main_state); F0=$(free_bytes)
  if [ -n "$(field "$N" untracked_symlinks)" ]; then
    for rel in node_modules apps/web/node_modules; do
      L="$P/$rel"; EXPT="$ROOT/$rel"
      test -L "$L" || fail "$N" "$rel not a symlink"
      R=$(cd "$(dirname "$L")" && cd "$(dirname "$(readlink "$L")")" && pwd -P)/$(basename "$(readlink "$L")")
      [ "$R" = "$EXPT" ] || fail "$N" "$rel resolves to $R not $EXPT"
      case "$L" in "$P"/*) ;; *) fail "$N" "symlink outside worktree";; esac
      log "$N" UNLINK "$rel -> $(readlink "$L") (resolved $R)"
      unlink "$L" || fail "$N" "unlink failed $rel"
      [ "$(shared_fp)" = "$FP0" ] || fail "$N" "SHARED TARGET CHANGED after unlink $rel"
    done
  fi
  OUT=$(git worktree remove "$P" 2>&1); RC=$?
  if [ $RC -ne 0 ]; then
    if [ -n "$(field "$N" untracked_symlinks)" ] && [ -d "$P" ]; then
      [ -e "$P/node_modules" ] || ln -s "$ROOT/node_modules" "$P/node_modules"
      [ -e "$P/apps/web/node_modules" ] || ln -s "$ROOT/apps/web/node_modules" "$P/apps/web/node_modules"
      log "$N" ROLLBACK "symlinks recreated"
    fi
    fail "$N" "git worktree remove refused rc=$RC: $(printf '%s' "$OUT" | tr '\n' ' ')"
  fi
  git worktree list --porcelain | grep -qxF "worktree $P" && fail "$N" "still registered"
  [ -e "$P" ] && fail "$N" "directory still exists"
  [ -d "$ROOT/.git/worktrees/$N" ] && fail "$N" "admin dir remains"
  [ "$(git rev-parse -q --verify "refs/heads/$B")" = "$H" ] || fail "$N" "BRANCH LOST OR MOVED"
  [ "$(shared_fp)" = "$FP0" ] || fail "$N" "SHARED TARGETS CHANGED"
  [ "$(main_state)" = "$MS0" ] || fail "$N" "MAIN CHECKOUT CHANGED"
  sleep 1; F1=$(free_bytes)
  log "$N" RETIRED "branch $B @${H:0:12} kept; free_before=$F0 free_after=$F1 delta=$((F1-F0))"
  echo "RETIRED $N delta=$(( (F1-F0)/1048576 )) MiB"
}

baseline() {
  git worktree list --porcelain > "$E/baseline_worktree_list.txt"
  main_state > "$E/baseline_main_state.txt"
  git status --porcelain=v1 > "$E/baseline_main_status_full.txt"
  git for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags refs/stash > "$E/baseline_refs.txt"
  git for-each-ref --format='%(refname) %(objectname)' refs/remotes > "$E/baseline_remote_refs.txt"
  printf 'origin/main %s\n' "$(git rev-parse origin/main)" > "$E/baseline_origin_main.txt"
  git merge-base --is-ancestor "$(git rev-parse HEAD)" "$OM" && echo "main HEAD is ancestor of origin/main" >> "$E/baseline_origin_main.txt"
  shared_fp > "$E/baseline_shared_fp.tsv"
  diskutil apfs list | grep -E 'Container Reference|Capacity Ceiling|Capacity In Use|Not Allocated' | head -4 > "$E/baseline_diskutil.txt"
  df -k / >> "$E/baseline_diskutil.txt"
  du -sk "$ROOT/.claude/worktrees" > "$E/baseline_du_worktrees.txt"
  printf 'ts\tworktree\tevent\tdetail\n' > "$LOG"
  log BASELINE OK "free=$(free_bytes)"
}

postverify() {  # read-only re-verification of an already-retired worktree
  N=$1; P=$(field "$N" path); B=$(field "$N" branch_now); H=$(field "$N" head_now)
  git worktree list --porcelain | grep -qxF "worktree $P" && fail "$N" "POSTVERIFY still registered"
  [ -e "$P" ] && fail "$N" "POSTVERIFY dir exists"
  [ -d "$ROOT/.git/worktrees/$N" ] && fail "$N" "POSTVERIFY admin dir remains"
  [ "$(git rev-parse -q --verify "refs/heads/$B")" = "$H" ] || fail "$N" "POSTVERIFY branch lost"
  [ "$(shared_fp)" = "$(cat "$E/baseline_shared_fp.tsv")" ] || fail "$N" "POSTVERIFY shared targets differ from baseline"
  [ "$(main_state)" = "$(cat "$E/baseline_main_state.txt")" ] || fail "$N" "POSTVERIFY main state differs from baseline"
  log "$N" POSTVERIFY_OK "absent, unregistered, branch $B @${H:0:12} kept, shared targets + main = baseline"
  echo "POSTVERIFY_OK $N"
}
case "$1" in baseline) baseline;; check) check "$2";; retire) retire "$2";; postverify) postverify "$2";; free) free_bytes;; *) echo usage; exit 2;; esac
