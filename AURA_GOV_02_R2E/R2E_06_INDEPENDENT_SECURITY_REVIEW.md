# R2E-06: Independent Security Review

**Reviewer:**
- A separate fresh-context review agent with no access to the implementer's reasoning.
- Read-only and static. It executed only `cat`, `diff`, `grep`, `stat` and `shasum`, and it ran no harness, no suite, no `security`, no REAL mode and no `ps`.

**Rounds:**
1. Full review of 14 areas → **HOLD**.
2. Re-review of the RV fixes → **CONDITIONAL PASS**.
3. Confirmation of the N fixes and of the final-run provenance → **PASS for the mock gate, conditional on doc corrections**. Those corrections are now made in R2E-01 and R2E-07.

## Round 1 findings and resolution
| ID | Sev | Finding | Resolution |
|---|---|---|---|
| RV-1 | P0 (latent) | The mock guard compared path strings only: `R2D_MOCK_DIR=/usr/bin/`, `../` or a symlinked/copied binary could run the real `security` under a mock label | **FIXED.** `mockok` checks resolved path, non-symlink, marker; 6 negative variants |
| RV-2 | P1 | `R2D_MOCK_ANSWERS` was honoured in REAL mode | **FIXED.** REAL refuses all `R2D_*` and clears ANSF (static test) |
| RV-3 | P1 | L8 could PASS when the relock happened before T/2 | **FIXED.** PASS needs `pm=unlocked`; new early-lock scenario |
| RV-4 | P1 | Kernel tripwire failed open and had never run on current code; the text layer is blind to suppressed stderr | **FIXED.** Runs every time; rc + header + in-window positive control |
| RV-5 | P2 | The sandbox denied exec of the literal path only | **FIXED (mock scope).** mach-lookup and Keychains-dir denies, with controls |
| RV-6 | P2 | T1-8 path guard accepted `..` and glob characters | **FIXED.** Strict structure; 5 negative paths |
| RV-7 | P2 | Malformed/duplicate IDs and conflicting flags fell through | **FIXED.** Regex, uniqueness, single flags, exclusivity |
| RV-8 | P2 | L4: risky locked read; pre-state; resolution; unreadable after-value | **FIXED** (a–d) |
| RV-9 | P2 | Only COMPLETED verdicts were tagged with the mode; the observer could mix modes | **FIXED.** All verdicts tagged; observer 8th field |
| RV-10 | P2 | L7 PASS was attributed to the watchdog without evidence | **FIXED.** Needs an unlocked residual and the watchdog gone |
| RV-11 | P2 | Runner kill could hit a reused PID; possible unbounded wait; FIFOs not removed in the trap | **FIXED** |
| RV-12 | P2 | L12 "names security / names item" not implemented, yet docs claimed it | **DOC-CORRECTED.** Recorded as gap RE-9 (not implemented) |
| RV-13 | P2 | No provenance in results | **FIXED.** Hash header, plus a copied evidence dir |
| RV-14 | P3 | The leak detector was blind to rejected values | **FIXED** |
| RV-15 | P3 | Classifier quirks | **FIXED.** Both word orders tested |
| RV-16 | P3 | Nits (header, observer cleanup text, post-lock probe, labels, python path, mock ps wording) | **FIXED** |
| RV-17 | P2 | Mock-to-real gaps | **REQUIRES REAL ENV.** Carried in R2E-07 |

## Round 2 / 3 findings
| ID | Sev | Finding | Resolution |
|---|---|---|---|
| N-1 | P2 | The kernel tripwire did not watch the new mach/Keychains denies | **FIXED.** Confirmed |
| N-2 | P3 | Unchecked `lock_ctl` outside L4 | **FIXED.** 12 checked call sites |
| N-3 | P3 | Unquoted `$TD` pattern | **FIXED** |
| N-4 | P3 | Trailing-slash symlink dir; check-then-use of the mock | **ACCEPTED** (harmless at mock scope; content checks still apply) |
| N-5 | P3 | Duplicate scenario prefix | **FIXED** |
| N-6 | P3 | The header asserted the result before the evidence | **FIXED** |
| N-7 | P3 | `$REALKC` is placed in a regex unescaped | **ACCEPTED, NOT FIXED.** The current home path has no regex metacharacters, and changing the runner would invalidate the pinned evidence run. Fix before reuse on another account (RE-13). |

**Reruns after corrections:**
- r2e_rv1: 624/11. All 11 were test-fixture issues plus one harness bug; all fixed.
- r2e_rv2: 634/0. This was round 2's input.
- r2e_FINAL: 638/0. This was round 3's input. The reviewer confirmed that all six header hashes match the files, that the run was unfiltered, and that the kernel file holds only the header and the dummy control.

## Reviewer's final recommendation
> PASS for the mock-validation gate, conditional on the doc corrections. Real-Keychain behaviour remains open until authorised Tier 2 execution.

**The implementer reports the ticket-defined verdict as CONDITIONAL PASS.** Ticket §15 reserves an unconditional PASS for the case without material assurance limitations, and material real-environment limitations remain (R2E-07).
