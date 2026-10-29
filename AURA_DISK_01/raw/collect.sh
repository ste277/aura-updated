#!/bin/bash
# Read-only collector. GIT_OPTIONAL_LOCKS=0 prevents git status from refreshing/writing the index.
export GIT_OPTIONAL_LOCKS=0
ROOT=/Users/stephen/Desktop/Claude/auraschedule-math-core
OUT=$1
cd "$ROOT" || exit 1
MAIN=$(git rev-parse main)
printf 'path\tname\tbranch\thead\tmodified\tstaged\tuntracked\tignored_entries\tconflicts\thead_in_main\tahead_main\tbehind_main\tunique_not_other_local\tunique_not_remote\tupstream\tupstream_track\tlast_commit_iso\tlast_commit_subject\tlocked\tprunable\tevidence_dirs\tuntracked_sample\n' > "$OUT"
git worktree list --porcelain | awk '
/^worktree /{if(p)print p"\t"h"\t"b"\t"l"\t"pr; p=substr($0,10); h=""; b="(detached)"; l="no"; pr="no"}
/^HEAD /{h=$2}
/^branch /{b=$2}
/^locked/{l="yes"}
/^prunable/{pr="yes"}
END{print p"\t"h"\t"b"\t"l"\t"pr}' | while IFS=$'\t' read -r P H B L PR; do
  N=$(basename "$P"); [ "$P" = "$ROOT" ] && N=MAIN
  BR=${B#refs/heads/}
  ST=$(git -C "$P" status --porcelain=v1 --ignored=matching --untracked-files=all 2>/dev/null)
  MOD=$(printf '%s\n' "$ST" | grep -cE '^.[MDTR]')
  STG=$(printf '%s\n' "$ST" | grep -cE '^[MADRCT]')
  CON=$(printf '%s\n' "$ST" | grep -cE '^(UU|AA|DD|AU|UA|DU|UD)')
  UNT=$(printf '%s\n' "$ST" | grep -c '^??')
  IGN=$(printf '%s\n' "$ST" | grep -c '^!!')
  SAMPLE=$(printf '%s\n' "$ST" | grep '^??' | cut -c4- | head -5 | tr '\n' '|')
  if git merge-base --is-ancestor "$H" "$MAIN" 2>/dev/null; then INM=yes; else INM=no; fi
  AHEAD=$(git rev-list --count "$MAIN..$H" 2>/dev/null)
  BEHIND=$(git rev-list --count "$H..$MAIN" 2>/dev/null)
  if [ "$BR" = "(detached)" ]; then EXCL=""; else EXCL="refs/heads/$BR"; fi
  OTHER=$(git for-each-ref --format='%(refname)' refs/heads refs/tags | grep -vxF "${EXCL:-__none__}")
  UNL=$(git rev-list --count "$H" --not $OTHER 2>/dev/null)
  UNR=$(git rev-list --count "$H" --not --remotes 2>/dev/null)
  UP=""; TRK=""
  if [ "$BR" != "(detached)" ]; then
    UP=$(git for-each-ref --format='%(upstream:short)' "refs/heads/$BR")
    TRK=$(git for-each-ref --format='%(upstream:track)' "refs/heads/$BR")
  fi
  LC=$(git log -1 --format=%cI "$H" 2>/dev/null)
  SUBJ=$(git log -1 --format=%s "$H" 2>/dev/null | tr '\t' ' ' | cut -c1-90)
  EV=$(cd "$P" && ls -1d AURA_* *EVIDENCE* *evidence* *REPORT* reports artifacts 2>/dev/null | sort -u | head -8 | tr '\n' '|')
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
   "$P" "$N" "$BR" "$H" "$MOD" "$STG" "$UNT" "$IGN" "$CON" "$INM" "$AHEAD" "$BEHIND" "$UNL" "$UNR" "$UP" "$TRK" "$LC" "$SUBJ" "$L" "$PR" "$EV" "$SAMPLE" >> "$OUT"
done
