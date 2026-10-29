#!/bin/bash
# Read-only storage collector. du on macOS does not follow symlinks by default (-P).
export GIT_OPTIONAL_LOCKS=0
ROOT=/Users/stephen/Desktop/Claude/auraschedule-math-core
OUT=$1; IGN=$2
cd "$ROOT" || exit 1
printf 'name\ttotal_kb\tgitdir_kb\tnode_modules_real_kb\tnext_build_kb\tother_ignored_kb\tuntracked_kb\tsource_kb\tnm_symlinks\n' > "$OUT"
printf 'name\tentry\tkb\n' > "$IGN"
git worktree list --porcelain | grep '^worktree ' | cut -c10- | while read -r P; do
  N=$(basename "$P"); [ "$P" = "$ROOT" ] && N=MAIN
  if [ "$N" = MAIN ]; then
    TOT=$(( $(du -sk "$P" | cut -f1) - $(du -sk "$P/.claude/worktrees" | cut -f1) ))
  else
    TOT=$(du -sk "$P" | cut -f1)
  fi
  GD=0; [ -d "$P/.git" ] && GD=$(du -sk "$P/.git" | cut -f1)
  NM=0; NEXT=0; OIG=0; UNT=0; SL=""
  while IFS= read -r line; do
    code=${line:0:2}; e=${line:3}; e=${e%/}
    [ "$N" = MAIN ] && case "$e" in .claude|.claude/*) continue;; esac
    f="$P/$e"
    if [ -L "$f" ]; then SL="$SL$e->$(readlink "$f");"; continue; fi
    k=$(du -sk "$f" 2>/dev/null | cut -f1); k=${k:-0}
    if [ "$code" = "!!" ]; then
      printf '%s\t%s\t%s\n' "$N" "$e" "$k" >> "$IGN"
      case "$e" in *node_modules) NM=$((NM+k));; *.next|*.next-dev|*.next/*|*.next-dev/*) NEXT=$((NEXT+k));; *) OIG=$((OIG+k));; esac
    else
      UNT=$((UNT+k))
    fi
  done < <(git -C "$P" status --porcelain=v1 --ignored=matching --untracked-files=normal 2>/dev/null | grep -E '^(\?\?|!!)')
  SRC=$((TOT-GD-NM-NEXT-OIG-UNT))
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$N" "$TOT" "$GD" "$NM" "$NEXT" "$OIG" "$UNT" "$SRC" "$SL" >> "$OUT"
done
