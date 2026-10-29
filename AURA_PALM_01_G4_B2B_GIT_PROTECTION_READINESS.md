# AURA-PALM-01-G4-B2B — Git Protection Readiness (Task E)

**Status:** READY for owner installation (A-10). **Not installed.** The research worktree's `core.hooksPath` is unset; the real repository config, the real `~/.gitconfig` and the research worktree's hook setting were hashed before and after testing and were unchanged.

## 1. Installer review and changes
| Check | B2A installer | B2B installer |
|---|---|---|
| Targets only the intended worktree | Accepted **any** path, with no validation | Must be the **top level** of a git worktree that **contains the guard**. Missing path, non-repository, subdirectory and repository-without-guard are all refused. |
| Hook source | Pointed `core.hooksPath` at the *installer's own* checkout, so running it from worktree A against worktree B would wire B to A's files | Points at the **target worktree's own** `research/palm-scan-g4a/scripts/git-guard/hooks` |
| Global Git config | Not modified | Not modified. The installer never uses `--global` or `--system`. Verified by an isolated `GIT_CONFIG_GLOBAL` and by hashing the real `~/.gitconfig`. |
| Shared repository config | Always set `extensions.worktreeConfig=true` | Sets it **only if not already true**. It is already `true` in the real repository (set before this ticket), so installing there writes only that worktree's `config.worktree`. |
| Overwrite protection | None | Refuses if a **different** per-worktree `hooksPath` is already set. Re-running is idempotent. |
| Removal | Undocumented; no script | New `uninstall-worktree-hook.sh` unsets only the hooksPath it set, refuses anything foreign, and is idempotent |
| Preconditions | — | Refuses if `node` is missing (the hook itself also fails closed without node) |

## 2. Test results (`sh test/git-hook-installer.test.sh`: 31 passed, 0 failed; throwaway repo with a main checkout and two linked worktrees)
| Requirement | Result |
|---|---|
| Targets only the intended worktree | PASS. After install, the research worktree blocks a synthetic JPEG. The **same** commit in the main checkout and in another worktree is **not** intercepted. The shared repository config holds no hooksPath. |
| Does not modify global config | PASS (isolated global config unchanged; real `~/.gitconfig` unchanged) |
| Blocks staged sensitive artifacts | PASS: synthetic JPEG, annotation JSON. Also the B2A guard suite (`sh test/git-guard.test.sh`: **10 passed, 0 failed**) covers JPEG renamed `.txt`, HEIC magic in `.bin`, `.sparseimage`, and consent-like text. |
| Forced additions | PASS: `git add -f eval/m.json` despite `.gitignore` is blocked |
| Renamed files | PASS: `git mv` of a committed image disguised as `.txt` to a `.md` name is inspected by content and blocked |
| Ordinary source changes remain possible | PASS |
| Installation and removal documented and working | PASS: install → blocked; uninstall → the same commit succeeds; uninstall again → `NOTHING_TO_REMOVE` |
| Real repository untouched | PASS: real repo config hash, real `~/.gitconfig` hash, and research-worktree hooksPath (`unset`) unchanged |

## 3. Owner procedure (A-10; not run by this ticket)
Install:
```bash
sh ~/Desktop/Claude/auraschedule-math-core/.claude/worktrees/palm-g4a-scan/research/palm-scan-g4a/scripts/git-guard/install-worktree-hook.sh ~/Desktop/Claude/auraschedule-math-core/.claude/worktrees/palm-g4a-scan
```
Verify:
```bash
git -C ~/Desktop/Claude/auraschedule-math-core/.claude/worktrees/palm-g4a-scan config --worktree --get core.hooksPath
```
Expected: the worktree's own `…/research/palm-scan-g4a/scripts/git-guard/hooks`. ST-OWNER-3 (optional): stage a synthetic gradient JPEG in that worktree and confirm `commit BLOCKED`, then unstage it with `git restore --staged <file>`.

Remove:
```bash
sh ~/Desktop/Claude/auraschedule-math-core/.claude/worktrees/palm-g4a-scan/research/palm-scan-g4a/scripts/git-guard/uninstall-worktree-hook.sh ~/Desktop/Claude/auraschedule-math-core/.claude/worktrees/palm-g4a-scan
```

## 4. Bypasses and limits (hooks do NOT guarantee prevention)
Demonstrated in tests:
- `git commit --no-verify`
- `git -c core.hooksPath=… commit`

Not demonstrated, but known:
- Commits from the main checkout or any other worktree. The scope limit is intentional, and it also means **those checkouts are unprotected**.
- Fresh clones.
- GUI clients and editors that commit through libgit2.
- Plumbing commands (`commit-tree`, `update-index`).
- Encrypted or archived images (zip, PDF).
- Consent detection is heuristic.

**The primary control is unchanged:** participant data lives only on the encrypted volume, outside every repository path, and the harness refuses any other location. Recommended (governance decision, not implemented): a CI job that runs `pre-commit.mjs` logic on PR diffs, as a required branch-protection check.
