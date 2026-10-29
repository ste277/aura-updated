#!/bin/bash
# Read-only registry checkpoint: registered set must equal baseline minus exactly the retired list.
# Usage: checkpoint.sh <label> <retired-name>...
export GIT_OPTIONAL_LOCKS=0
ROOT=/Users/stephen/Desktop/Claude/auraschedule-math-core; E=$ROOT/AURA_DISK_03/raw; cd "$ROOT" || exit 2
LABEL=$1; shift
EXP=$(grep '^worktree ' "$E/baseline_worktree_list.txt" | cut -c10- | while read -r p; do skip=0; for n in "$@"; do [ "$p" = "$ROOT/.claude/worktrees/$n" ] && skip=1; done; [ $skip = 0 ] && echo "$p"; done | LC_ALL=C sort)
NOW=$(git worktree list --porcelain | grep '^worktree ' | cut -c10- | LC_ALL=C sort)
R=PASS
[ "$EXP" = "$NOW" ] || { R=FAIL; echo "registry differs:"; diff <(echo "$EXP") <(echo "$NOW"); }
# every surviving worktree: HEAD and branch identical to baseline
awk '/^worktree /{p=substr($0,10)} /^HEAD /{h=$2} /^branch /{print p" "h" "$2} /^detached/{print p" "h" detached"}' "$E/baseline_worktree_list.txt" | while read -r p h b; do
  echo "$NOW" | grep -qxF "$p" || continue
  nh=$(git worktree list --porcelain | awk -v w="worktree $p" '$0==w{f=1;next} f&&/^HEAD /{print $2; exit}')
  [ "$nh" = "$h" ] || echo "HEAD moved: $p $h -> $nh"
done > "$E/.cp_tmp"; [ -s "$E/.cp_tmp" ] && { R=FAIL; cat "$E/.cp_tmp"; }; : > "$E/.cp_tmp"
# no ref lost: every baseline local ref still present at same SHA (branches never deleted)
diff <(cut -d' ' -f1,2 "$E/baseline_refs.txt" | grep -v '^refs/stash') <(git for-each-ref --format='%(refname) %(objectname)' refs/heads refs/tags) > "$E/.cp_refs"
if [ -s "$E/.cp_refs" ]; then
  # only allowed difference: branches advanced by other active work in PRESERVE worktrees are reported, never deletions
  grep '^<' "$E/.cp_refs" | while read -r _ ref sha; do git rev-parse -q --verify "$ref" >/dev/null || echo "REF MISSING $ref"; done > "$E/.cp_miss"
  [ -s "$E/.cp_miss" ] && { R=FAIL; cat "$E/.cp_miss"; }
  echo "ref changes (non-deletion):"; grep -c '^>' "$E/.cp_refs"
fi
rm -f "$E/.cp_refs" "$E/.cp_miss" "$E/.cp_tmp" 2>/dev/null
[ "$(git worktree list --porcelain | grep -cE '^(prunable|locked)')" = 0 ] || { R=FAIL; echo "prunable/locked entries present"; }
for d in "$ROOT/.git/worktrees"/*; do [ -f "$d/gitdir" ] && [ -e "$(dirname "$(cat "$d/gitdir")")" ] || { R=FAIL; echo "admin dir without worktree: $d"; }; done
ADM=$(ls -1 "$ROOT/.git/worktrees" | wc -l | tr -d ' '); REG=$(( $(echo "$NOW" | wc -l) - 1 ))
[ "$ADM" = "$REG" ] || { R=FAIL; echo "admin dirs $ADM != linked worktrees $REG"; }
printf '%s\t%s\t%s\tregistered=%s admin=%s retired=%s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "CHECKPOINT:$LABEL" "$R" "$(echo "$NOW" | wc -l | tr -d ' ')" "$ADM" "$#" >> "$E/exec_log.tsv"
echo "CHECKPOINT $LABEL $R registered=$(echo "$NOW" | wc -l | tr -d ' ') admin=$ADM retired=$#"
[ $R = PASS ]
