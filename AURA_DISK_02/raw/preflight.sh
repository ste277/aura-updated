#!/bin/bash
# AURA-DISK-02 read-only preflight. No writes except $OUT/$SYM.
export GIT_OPTIONAL_LOCKS=0
ROOT=/Users/stephen/Desktop/Claude/auraschedule-math-core
TIER=$1; OUT=$2; SYM=$3
cd "$ROOT" || exit 1
OM=$(git rev-parse origin/main)
MAINENV=$(shasum -a 256 apps/web/.env.local | cut -c1-64)
REG=$(git worktree list --porcelain)
printf 'name\tpath\tbranch_expected\tbranch_now\thead_expected\thead_now\tregistered\tlocked\tprunable\tbranch_ref_matches_head\thead_in_origin_main\tcommits_not_in_origin_main\treflog_only_commits\tmodified\tstaged\tuntracked_nonsymlink\tuntracked_symlinks\tignored_entries\tignored_unexpected\tenv_local\tsymlinks_total\tsymlinks_outside\tsymlinks_outside_targets_exist\tstash_refs_branch\tsize_kb\tlast_reflog\n' > "$OUT"
printf 'name\tlink\ttarget\tresolved\tlocation\ttarget_exists\n' > "$SYM"
while IFS=$'\t' read -r N P BR H SZ; do
  blk=$(printf '%s\n' "$REG" | awk -v p="worktree $P" '$0==p{f=1;next} f&&/^$/{exit} f{print}')
  REGD=no; [ -n "$blk" ] && REGD=yes
  HN=$(printf '%s\n' "$blk" | awk '/^HEAD /{print $2}')
  BN=$(printf '%s\n' "$blk" | awk '/^branch /{sub("refs/heads/","",$2);print $2}'); BN=${BN:-"(detached)"}
  LK=$(printf '%s\n' "$blk" | grep -c '^locked'); PR=$(printf '%s\n' "$blk" | grep -c '^prunable')
  BRH=$(git rev-parse -q --verify "refs/heads/$BN" 2>/dev/null); BRM=no; [ "$BRH" = "$HN" ] && BRM=yes
  INOM=no; git merge-base --is-ancestor "$HN" "$OM" 2>/dev/null && INOM=yes
  NOTOM=$(git rev-list --count "$HN" --not "$OM" 2>/dev/null)
  # commits reachable only from this worktree's HEAD reflog (lost on removal)
  RLO=0
  for c in $(git -C "$P" reflog --format=%H HEAD 2>/dev/null | sort -u); do
    if [ -z "$(git for-each-ref --contains "$c" --count=1 refs/heads refs/tags refs/remotes 2>/dev/null)" ]; then RLO=$((RLO+1)); fi
  done
  ST=$(git -C "$P" status --porcelain=v1 --ignored=matching --untracked-files=all 2>/dev/null)
  MOD=$(printf '%s\n' "$ST" | grep -cE '^.[MDTRAU]'); STG=$(printf '%s\n' "$ST" | grep -cE '^[MADRCTU]')
  UNS=0; USL=""
  while IFS= read -r f; do [ -z "$f" ] && continue; if [ -L "$P/$f" ]; then USL="$USL$f;"; else UNS=$((UNS+1)); fi; done < <(printf '%s\n' "$ST" | grep '^??' | cut -c4-)
  IGN=""; IUX=""; ENV="none"
  while IFS= read -r e; do [ -z "$e" ] && continue; e=${e%/}; IGN="$IGN$e;"
    case "$e" in
      apps/web/.next|apps/web/.next-dev|apps/web/tsconfig.tsbuildinfo|tsconfig.tsbuildinfo|node_modules|apps/web/node_modules) ;;
      apps/web/.env.local)
        if [ -L "$P/$e" ]; then ENV="symlink->$(readlink "$P/$e")"; elif [ "$(shasum -a 256 "$P/$e" | cut -c1-64)" = "$MAINENV" ]; then ENV="identical-to-main"; else ENV="DIFFERS"; IUX="$IUX$e;"; fi ;;
      *) IUX="$IUX$e;";;
    esac
  done < <(printf '%s\n' "$ST" | grep '^!!' | cut -c4-)
  ST_TOT=0; ST_OUT=0; ST_OK=yes
  while IFS= read -r l; do [ -z "$l" ] && continue; ST_TOT=$((ST_TOT+1)); t=$(readlink "$l")
    d=$(cd "$(dirname "$l")" && cd "$(dirname "$t")" 2>/dev/null && pwd -P); r="$d/$(basename "$t")"; [ -z "$d" ] && r="UNRESOLVED:$t"
    loc=inside; case "$r" in "$P"/*|"$P") ;; *) loc=outside;; esac
    ex=no; [ -e "$l" ] && ex=yes
    if [ "$loc" = outside ]; then ST_OUT=$((ST_OUT+1)); [ "$ex" = yes ] || ST_OK=no
      printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$N" "${l#$P/}" "$t" "$r" "$loc" "$ex" >> "$SYM"; fi
  done < <(find "$P" -type l 2>/dev/null)
  STB=$(git stash list --format='%gs' | grep -c "On $BN:")
  SZN=$(du -sk "$P" | cut -f1)
  RL=$(stat -f %Sm -t %Y-%m-%dT%H:%M ".git/worktrees/$N/logs/HEAD" 2>/dev/null)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
   "$N" "$P" "$BR" "$BN" "$H" "$HN" "$REGD" "$LK" "$PR" "$BRM" "$INOM" "$NOTOM" "$RLO" "$MOD" "$STG" "$UNS" "$USL" "$IGN" "${IUX:-none}" "$ENV" "$ST_TOT" "$ST_OUT" "$ST_OK" "$STB" "$SZN" "$RL" >> "$OUT"
done < "$TIER"
