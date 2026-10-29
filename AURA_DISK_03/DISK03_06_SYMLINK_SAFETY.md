# AURA-DISK-03 — 06 Symlink Safety

## 1. Actions taken
**76 `unlink` operations**: exactly 2 per M1 worktree × 38. Zero for the 2 M2 worktrees. Each is logged as `UNLINK` in `raw/exec_log.tsv` with the raw link value and the resolved target.

| Link | Raw `readlink` value | Count | Resolved target | Count |
|---|---|---|---|---|
| `node_modules` | `/Users/stephen/Desktop/Claude/auraschedule-math-core/node_modules` | 28 | main `node_modules` | **38** |
| `node_modules` | `../../../node_modules` | 10 | ↑ | |
| `apps/web/node_modules` | `/Users/stephen/Desktop/Claude/auraschedule-math-core/apps/web/node_modules` | 29 | main `apps/web/node_modules` | **38** |
| `apps/web/node_modules` | `../../../../../apps/web/node_modules` | 9 | ↑ | |

Every resolved target equalled the expected shared directory exactly.

## 2. Per-link procedure (`raw/retire.sh`, function `retire`)
1. `test -L` — the path is a symbolic link, not a directory.
2. Resolve the target by `cd`-ing into the link's directory and then into `dirname(readlink)` with `pwd -P`. This resolves the path **without following it for deletion**.
3. Require the resolved path to equal `$ROOT/node_modules` or `$ROOT/apps/web/node_modules` exactly. Otherwise stop before unlinking.
4. Require the link path to sit inside the approved worktree path.
5. `unlink "<worktree>/<rel>"`. There is no trailing slash, and the command removes only a directory entry; it cannot recurse.
6. Recompute the shared-target fingerprint (inode, mode, mtime, hash of recursive listing) and require it to equal the pre-step fingerprint. Otherwise stop.

The rollback branch (recreating the two links if `git worktree remove` refused) was **never triggered**.

## 3. Forbidden operations — confirmed absent
- `raw/retire.sh` contains no `--force`, `rm`, `rmdir`, `prune`, `gc`, `clean`, `reset` or trailing-slash delete. The only match for these words is the header comment stating they are never used.
- No recursive deletion was used as a substitute for `git worktree remove`. Git's own removal deleted each directory and unlinked the links inside it (including `.next/standalone/node_modules` → main or the stub) without following them.

## 4. Target integrity
- After every single unlink and every single removal, the shared fingerprint was compared with the pre-step value. After every `postverify` and at the end, it was compared with the **baseline** value. Result: identical on every comparison.
- Covered targets: main `node_modules`, main `apps/web/node_modules`, main `apps/web/.env.local` (hash prefix only), `.claude/worktrees/apps` (stub, link target of 8 Tier A build outputs), `.claude/worktrees/agent-a8da33ba4e882df81` (stub).

## 5. Tooling deviations (no effect on targets)

| Time | Event | Effect |
|---|---|---|
| 16:39 (pre-run) | Script failed to parse (`case` inside `$( )`) | Exited before doing anything. Fixed |
| 16:39:57 (pre-run) | Dry-run gate STOP: `git status --ignored=matching` refused with `--untracked-files=no` | Read-only gate. Nothing modified. Switched to the preflight's exact flags (`--untracked-files=all`) |
| 16:40:44 | Canary 1: free-space helper mis-parsed `diskutil`, script aborted at the final log line | All safety post-checks had already passed. Re-verified by `postverify`; logged `DEVIATION` |
| 16:41:52, 16:44:13 | Checkpoint FAIL, because zsh passed the name list as one argument | Read-only. Re-run with separate arguments → PASS |

The baseline log line also records `free=Allocated:` from the same parser bug. The authoritative baseline free space is in `raw/baseline_diskutil.txt` (24,899,829,760 B).
