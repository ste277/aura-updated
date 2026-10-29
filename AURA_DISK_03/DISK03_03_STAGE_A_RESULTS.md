# AURA-DISK-03 — 03 Stage A Results (canaries)

Four smallest M1 worktrees, retired one at a time with `raw/retire.sh retire <name>`, followed by an independent `raw/retire.sh postverify <name>`.

Each removal did the following:
1. Ran the full gate: canonical path, registration, HEAD and branch, ancestry to `1741a95`, 0 unique commits, 0 reflog-only commits, `git status` exactly the 2 expected symlinks, ignored set equal to preflight, outside-symlink set equal to preflight, no mount, no process cwd/open file/executable/cmdline.
2. Checked that each link is a symlink, resolves exactly to main's directory and sits inside the worktree, then ran `unlink`. The shared-target fingerprint was re-checked after each unlink.
3. Ran plain `git worktree remove` (no `--force`).
4. Verified: not registered, directory absent, admin dir absent, branch ref = original HEAD, shared targets = pre-step fingerprint, main HEAD and tracked status unchanged.

| # | Worktree | Branch | HEAD | Preflight MiB | Gate | Symlinks | Removal | Branch kept (= HEAD) | Registration | Free Δ MiB | Time | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `day-constructor-v1-pr-d` | `feat/day-constructor-v1-pr-d` | `b0f40019b934` | 9.3 | PASS (2× incl. dry-run) | 2 unlinked (→ main `node_modules`, `apps/web/node_modules`); targets unchanged | removed, plain `git worktree remove` rc=0 | yes | absent | n/a | 16:40:44 | RETIRED log line missing (parser bug); outcome re-verified by POSTVERIFY |
| 2 | `day-constructor-v1-pr-e1` | `feat/day-constructor-v1-pr-e1` | `2952c3199bc3` | 9.4 | PASS (2× incl. dry-run) | 2 unlinked (→ main `node_modules`, `apps/web/node_modules`); targets unchanged | removed, plain `git worktree remove` rc=0 | yes | absent | 10 | 16:41:26 |  |
| 3 | `day-constructor-v1-pr-e2` | `feat/day-constructor-v1-pr-e2` | `f812a1fca097` | 9.4 | PASS (2× incl. dry-run) | 2 unlinked (→ main `node_modules`, `apps/web/node_modules`); targets unchanged | removed, plain `git worktree remove` rc=0 | yes | absent | 10 | 16:41:29 |  |
| 4 | `day-constructor-v1-pr-e3` | `feat/day-constructor-v1-pr-e3` | `26b2dc2b7842` | 9.5 | PASS (2× incl. dry-run) | 2 unlinked (→ main `node_modules`, `apps/web/node_modules`); targets unchanged | removed, plain `git worktree remove` rc=0 | yes | absent | 10 | 16:41:31 |  |

## Stage A checkpoint — PASS (16:42:03)
- Registered worktrees: 117 = baseline 121 − these 4. Every surviving worktree's HEAD is unchanged.
- No local ref missing. No prunable or locked entries. Admin dirs (116) = linked worktrees (116).
- Main shared dependencies identical to baseline. Both stub dirs present and unchanged.

**Deviation (canary 1):** the `RETIRED` log line for `day-constructor-v1-pr-d` was not written. The free-space helper parsed the wrong `diskutil` field, and the shell aborted on the following arithmetic. Every post-removal safety check in the script runs *before* that line, and none raised a STOP. The helper was fixed, and the outcome was re-verified against the **baseline** (not just the pre-step state) by `postverify`: absent, unregistered, branch kept, shared targets and main unchanged. This was logged as `DEVIATION` at 16:41:18. No Git or filesystem anomaly occurred.

A first Stage A checkpoint attempt (16:41:52) logged FAIL. The cause was the operator's shell (zsh) passing the four names as one argument, so the script expected 120 worktrees. The diff it printed showed only the four retired paths missing. The checkpoint was re-run with the names as separate arguments and passed. No state changed between the two runs.
