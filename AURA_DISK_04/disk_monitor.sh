#!/bin/bash
# AURA-DISK-04 read-only disk-space monitor.
# Run manually only:  bash AURA_DISK_04/disk_monitor.sh
# It ONLY reads: diskutil, df, du, git worktree list. It deletes nothing, modifies no Git metadata,
# clears no caches, stops no processes, writes no files, and installs nothing.
# Thresholds are PROPOSED maintenance guidance (DISK04_05), not approved policy.
set -u
export GIT_OPTIONAL_LOCKS=0
ROOT=${AURA_ROOT:-/Users/stephen/Desktop/Claude/auraschedule-math-core}

# Bind to the APFS container that holds "/" (not simply the first container listed).
cont=$(diskutil info / 2>/dev/null | awk -F': *' '/APFS Container:/{print $2; exit}' | tr -d ' ')
free_b=""
if [ -n "${cont:-}" ]; then
  free_b=$(diskutil apfs list 2>/dev/null | awk -v c="$cont" '
    /APFS Container Reference:/{inblk=($NF==c)}
    inblk && /Capacity Not Allocated/{for(i=1;i<=NF;i++) if($i ~ /^[0-9]+$/){print $i; exit}}')
fi
if [ -z "${free_b:-}" ]; then free_b=$(( $(df -k / | awk 'NR==2{print $4}') * 1024 )); src="df -k / (fallback)"; else src="diskutil apfs list: container ${cont} Capacity Not Allocated"; fi
df_avail_kb=$(df -k / | awk 'NR==2{print $4}')
wt_kb=$(du -sk "$ROOT/.claude/worktrees" 2>/dev/null | cut -f1)
wt_n=$(git -C "$ROOT" worktree list --porcelain 2>/dev/null | grep -c '^worktree ')

gb()  { awk -v b="$1" 'BEGIN{printf "%.2f", b/1e9}'; }
gib() { awk -v b="$1" 'BEGIN{printf "%.2f", b/1073741824}'; }
gb_int=$(awk -v b="$free_b" 'BEGIN{printf "%d", b/1e9}')
if   [ "$gb_int" -ge 25 ]; then cat="NORMAL (>= 25 GB): normal development; no cleanup required"
elif [ "$gb_int" -ge 20 ]; then cat="OBSERVE (20-25 GB): observe disk trend"
elif [ "$gb_int" -ge 15 ]; then cat="ASSESS (15-20 GB): begin a fresh read-only storage assessment"
else                            cat="PRIORITIZE (< 15 GB): prioritize storage review before large builds"
fi

echo "AURA disk monitor (read-only)"
echo "  time:                $(date '+%Y-%m-%dT%H:%M:%S%z')"
echo "  free space:          ${free_b} B = $(gb "$free_b") GB = $(gib "$free_b") GiB   [${src}]"
echo "  df -k / available:   $(( df_avail_kb * 1024 )) B = $(gb $(( df_avail_kb * 1024 ))) GB = $(gib $(( df_avail_kb * 1024 ))) GiB"
echo "  .claude/worktrees:   $(( ${wt_kb:-0} * 1024 )) B = $(gb $(( ${wt_kb:-0} * 1024 ))) GB = $(gib $(( ${wt_kb:-0} * 1024 ))) GiB"
echo "  git worktrees:       ${wt_n} registered (incl. main checkout)"
echo "  proposed category:   ${cat}"
echo "  note: thresholds are proposed guidance; any cleanup needs a fresh inventory and a separate approved ticket."
