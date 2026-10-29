# R2D-09: Recommendation

## **CONDITIONAL GO** to proceed to harness **implementation** (mock-only self-tests). **NO-GO** for any prototype **execution**.

**Basis:**
- **Coverage:** the design package (R2D-01…08) accounts for every outstanding R2C P1 (R2D-04). Tier 1 controls T1-1…T1-9 are specified with reviewable mock self-tests (R2D-02). Tier 2 tests L0–L16 have measurable outcomes, evidence and STOP conditions (R2D-03).
- **No unsupported assumption:** locking is treated as **unproven** until L1–L10 measure it.
- **Independent design review:** CONDITIONAL GO. All 4 P1s and 11 P2s, plus the P3s, are folded in (R2D-10).

**Conditions for the implementation ticket:**
1. Implement `r2d_prototype.zsh` (and `r2d_observe.zsh` for L7) to R2D-02/03/06/07 exactly. **No keychain is created or unlocked and no `security` read happens during implementation.** Self-tests use mocks for every `security` call.
2. **Mandatory mock self-tests:**
   - each T1 NO-GO path (search list, ACL fixtures, `KC=''`, SIP string, process list, including the self-match exclusion);
   - the bootstrap (one-byte change, post-read replacement, trailing newline, NUL/CR, non-zero harness exit reported correctly);
   - input validation and EOF;
   - cleanup paths (normal, STOP, Ctrl-C, injected error, idempotency).
3. **Verify that the fresh-window command** (`/usr/bin/env -i HOME=$HOME TERM=xterm-256color /bin/zsh -f`) actually bypasses rc files and ZLE, using a dummy rc file only.
4. A fresh independent review of the implemented harness.
5. **Execution remains NO-GO** until the owner completes **R2D-08 section B and section C** in a separate execution authorization.

**Accepted limitation, stated separately:** no protection against an attacker with control of the owner's macOS session or with administrative privileges (RC-18). This requires the owner's explicit acknowledgement (R2D-08 C).

**Unchanged:**
- R-2 **HOLD**.
- R-1, B4, B5, B6 **HOLD**.
- The security freeze is preserved.
- No keychain access, no production modification, no commit.
