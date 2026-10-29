# R2B6: Final Gate Report

## Status: **PREPARED BUT NOT EXECUTED**
- **Not:** executed with complete evidence; executed but inconclusive; security failure.
- **R2B-6 gate:** pending the owner-run interactive test.
- **R-2:** remains **HOLD** regardless of the outcome.
- **R-1, B4, B5, B6:** HOLD. No rotation. Freeze maintained.

## What was done
- **Audit** (`R2B6_SCRIPT_AUDIT.md`):
  - root cause of the lost R2B-6 evidence: one combined prompt (`"2 y"`), with reader results logged only **after** it, so the STOP on `2` let cleanup delete them unlogged;
  - the original R2B artifacts are preserved (`AURA_GOV_02_R2B/SHA256SUMS` 7/7 OK);
  - also reconciled: the earlier run `…071207Z` STOPped on a "login password" answer that the next run recorded as the throwaway keychain password (probably ambiguous wording; UNVERIFIED).
- **New standalone script** `r2b6_concurrency_retest.zsh`:
  - **path:** `~/Desktop/Claude/auraschedule-math-core/AURA_GOV_02_R2B6/r2b6_concurrency_retest.zsh`;
  - **sha256** `e7e7efa6704b6caf2e0cb26538b93bd41b6bada1dee7e0019466e8d2bc9a335c`, 155 lines;
  - a fresh throwaway keychain and synthetic value; Deny-only; no password entry;
  - two concurrent readers, each with its own PID, timestamps, rc, `secret_returned` and stderr class, **logged before any question**;
  - six separate, validated questions;
  - fail-closed classification;
  - verified cleanup.
- **Self-tests:** 21 mock runs (T1–T10, U1–U10), all as designed. No real Keychain read and no dialog (`R2B6_SELF_TEST_RESULTS.md`).
- **Independent review:** READY WITH CHANGES (1 P1, 2 P2, 5 P3), **all addressed** and re-tested (`R2B6_INDEPENDENT_REVIEW.md`).

## Reconciliation with the original R2B investigation
- **Already measured** (`…071432Z`):
  - single reads are denied with `rc=128`;
  - Allow is one-time;
  - the bulk dump raised **4 dialogs** and, with all denied, returned **no secret**. This **refutes hypothesis (B)** "bulk dump bypasses the ACL", at least for a single item and with no trust granted;
  - the ACL stayed `applications (0)` throughout.
- **This retest closes the remaining gap:** per-process results for two concurrent reads.
- **The run-2 attribution** (Always Allow on the R2-3c dump dialog, against the on-screen Deny instruction, or an automation agent) remains **UNVERIFIED**. R2B evidence shows that a dump correctly raises dialogs, which is consistent with a dialog there having been answered.

## Gate definitions applied by the script

| Verdict | Requires |
|---|---|
| **PASS** | 2 dialogs; all denied; both `rc=128`; no secret; overlapping reads; ACL `(0)` after; search list and default unchanged; dialogs named `security` and the item; no login-password request |
| **FAIL** | a secret returned despite every dialog being denied; ACL changed; global keychain state changed |
| **INCONCLUSIVE** | anything short of PASS without a FAIL condition (e.g. fewer than 2 dialogs, an unexpected rc, attribution mismatch) |
| **STOPPED** | invalid or missing input, interrupt, lock held, login-password or unexpected-item dialog |

## Exact owner commands (Terminal.app), **only after explicit approval**

**Preflight:**
- Codex Computer Use **OFF**; ChatGPT and Codex quit.
- At least 500 MB free (2.1 GiB now). Freeing more space is recommended.
- Keep focus on each dialog. **Click Deny on every dialog. Never Allow or Always Allow. Type no password anywhere.**

```bash
shasum -a 256 ~/Desktop/Claude/auraschedule-math-core/AURA_GOV_02_R2B6/r2b6_concurrency_retest.zsh
```

It must print `e7e7efa6704b6caf2e0cb26538b93bd41b6bada1dee7e0019466e8d2bc9a335c`.

```bash
zsh -f ~/Desktop/Claude/auraschedule-math-core/AURA_GOV_02_R2B6/r2b6_concurrency_retest.zsh
```

**Answer each question with a single character** (separate prompts).

**Report:**
- the `R2B6-1 RESULT a/b` lines;
- the concurrency line;
- the `R2B6-2 OWNER` line;
- the `R2B6 VERDICT` and `CLEANUP` lines;
- the log path.

None of them contain secrets.
