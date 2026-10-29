# AURA-GOV-02-RE-4-FIX-01 — Final Gate Report

## Verdict: **CONDITIONAL PASS**
The core fixes are validated. Documented, non-blocking limitations remain (FX-1 name-only detection; RV4-3 clean leg).

| §9 PASS criterion | Result |
|---|---|
| RV4-1 demonstrably fixed | ✅ v2 is fail-closed: 16 mock UNKNOWN scenarios plus timeout; real R-3a…e |
| UNKNOWN/STOP on failures and implausible output | ✅ |
| RV4-2 mitigated with verified macOS identity behaviour | ✅ Real R-2c: `ucomm` = executed file, independent of argv[0]; both names scanned. Residual FX-1 (P2). |
| Existing R2E regression tests pass | ✅ All T0–T6 R2E scenarios pass on v2 |
| New adversarial tests pass | ✅ T7: 249/249 |
| Real-process parser checks pass | ✅ 22/22 |
| No unresolved P0/P1 affecting the remediation | ✅ (open items are P2 residual and P3) |
| Independent review completed | ✅ CONDITIONAL PASS |
| Evidence checksums verified | ✅ `SHA256SUMS` |

**Why not PASS:** identity is still name-based (FX-1), and no real CLEAN run exists (RV4-3).

## Boundaries
- **Not run or touched:** the full prototype; any real `security` command; any Keychain; any credential request; any signal to an unrelated process; Claude, ChatGPT and SuperOps (all left untouched).
- **Not done:** commit, merge, push or deploy.
- **Still HOLD:** R-1, B4, B5, B6, Tier 2 and prototype execution.
- **No RE-4 rerun is authorized by this report.**

## Recommendation for a separately authorized RE-4 rerun
Pin harness **v2 `4b7e4890…`**, then run two legs:
1. **STOP leg** (as now): expect DETECTED.
2. **Clean leg**, owner-run: Claude, Codex/ChatGPT (including ChatGPT for Chrome) quit, and SuperOps accounted for by the Mac's administrator. Expect a real **CLEAN** with `rows ≥ 20`. Keep a redacted pid/ppid/name table.

Optionally, first close the FX-3 timeout-reuse issue and add the FX-1 tokens and path or Team-ID matching under their own ticket.
