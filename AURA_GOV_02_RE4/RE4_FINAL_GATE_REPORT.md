# AURA-GOV-02-RE-4 — Final Gate Report

## Verdict: **INCONCLUSIVE**
**What was validated in the real environment:**
- The real `/bin/ps` output format is compatible with the harness parser.
- The exact harness `is_wd` code identifies a test-owned process by exact PID, exact argv tail and parent.
- It rejects lookalike, partial and reparented records.
- It detects disappearance.
- All waits were bounded.

**Why not PASS:**
- **RV4-1 (P1, open).** The harness's T1-6 scan **fails open** if `ps` fails or returns nothing.
- **RV4-2 (P2, open).** `comm` is argv[0], so the name scan can be evaded.
- **RV4-3 (P2, open).** No clean (true-negative) leg was possible, because Claude, ChatGPT for Chrome and superops are running.
- **RV4-4/5 (P2).** Probe and provenance gaps, disclosed.

Source corrections are documented, not implemented (ticket §8).

## Acceptance criteria (§10)
| Criterion | Result |
|---|---|
| R2E evidence integrity verifies | ✅ 120/120, before and after |
| T1-6 safe to exercise independently | ✅ (extracted, byte-identical; no Keychain path) |
| Real `/bin/ps` compatible with the scanner | ⚠️ Format compatible; **semantics differ (comm = argv[0])**; failure mode fails open |
| Scanner identifies the test-owned process | ✅ |
| PID, parent-PID and command-line checks | ✅ |
| Unrelated and lookalike records rejected | ✅ (synthetic and real; vacuity caveat RV4-4) |
| Polling and cleanup bounded | ✅ |
| No unrelated process signalled | ✅ |
| No test-owned process remains | ✅ |
| No real Keychain operation | ✅ |
| No unresolved P0/P1/P2 in RE-4 scope | ❌ (RV4-1 P1; RV4-2…RV4-5 P2) |
| Evidence manifest verifies | ✅ (see `SHA256SUMS`) |

## Next owner decision
Whether to authorize a **separate implementation ticket**:
1. **Fix RV4-1.** The T1-6 scan must STOP on a `ps` failure or implausible output.
2. **Fix RV4-2.** Add a `ucomm` check, and correct the RC-20 wording.
3. Re-pin the harness and re-run the R2E mock suite.
4. Repeat RE-4 with a hardened probe, including a **clean leg run by the owner** after quitting Claude, ChatGPT for Chrome and the `superops` process (which the owner should identify first).

Until then RE-4 stays INCONCLUSIVE. Every downstream gate stays HOLD.
