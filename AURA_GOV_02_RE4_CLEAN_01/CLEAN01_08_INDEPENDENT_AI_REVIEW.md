# CLEAN01-08: Independent AI Review

**Reviewer:** a fresh-context agent, static and read-only (it ran only `shasum` and read files; no `ps`, `profiles`, `security` or harness). It independently recomputed all four manifest hashes and verifications (22/22, 120/120, 11/11, 12/12) and the v2 harness hash (`4b7e4890…`). All match.

**This AI review is not administrator or human authorization.**

| ID | Sev | Finding | Correction applied |
|---|---|---|---|
| CR-1 | P2 | "Not feasible on this Mac" omitted the legitimate administrator route (unenroll, or remove/pause the RMM) | CLEAN01-03 §2 (iii) and CLEAN01-06 now describe **Option A′** as the administrator's decision, not proposed and not a test step |
| CR-2 | P2 | FX-3 job-table premise wrong: zsh keeps the job entry after reaping; `zsh/parameter` and `zsh/zselect` are not loaded | CLEAN01-04 FX-3: **no-signal timeout is now primary**; job-state gating is secondary, with the caveats |
| CR-3 | P2 | FX-7 minimum evidence lacked a stop point. After CLEAN plus "y" attestations, the harness reaches `glob_state` (a `security` call). It also must state that AI tools can't be on the test host. | CLEAN01-04 FX-7: the tester answers **`n` at the first attestation** (stop before line 229); the host must have no Claude, Codex or ChatGPT; owner-run |
| CR-4 | P2 | MDM-enrollment fact not evidenced in the package | Captured as `evidence/clean01_mdm_enrollment_redacted.txt` (read-only `profiles status`, server path redacted) and included in the manifest. CLEAN01-03 notes the infeasibility conclusion **does not depend on it** (the KeepAlive root daemon is enough). |
| CR-5 | P3 | Parent-exclusion wording imprecise | CLEAN01-02 item 4 corrected |
| CR-6 | P3 | L8 duration understated | CLEAN01-04 FX-5: ≥ 150 s in REAL mode; L10 re-attests, does not re-scan |
| CR-7 | P3 | FX-4: window also between `mktemp` and the redirect; R2D docs point recovery to `$TMPDIR` rather than `/tmp`; coproc still needs a timeout | CLEAN01-04 FX-4 updated (window, documentation defect, coproc caveat) |
| CR-8 | P3 | Team-ID candidate overclaims (`lsof` can't read root processes without root); browser-extension sentence confusing | CLEAN01-04 FX-1 qualified and reworded |
| CR-9 | P3 | Unsourced claims (VM licensing; "root-level capability") | Licensing is now "to be checked by the owner (not verified)"; root capability is labelled an *inference* |
| CR-10 | P3 | Gate gaps: security-owner role not named; administrator input for decision 1; R2D-08 §B for any Option B run; package manifest | CLEAN01-07 updated; `SHA256SUMS` added |

**Checked and found sound:**
- the CLEAN semantics and line references (186–218);
- "scanner CLEAN ≠ environment assurance";
- the requirement reading (R2D-02 line 12, R2D-03 line 56, RC-18/RC-20), with the ambiguity left UNRESOLVED for the owner;
- no circumvention proposed (the denylist change is rejected); admin rights not treated as authorization;
- no authorization implied, and HOLD items preserved;
- RR-2/6/7 recommendations carry counts only, with no arguments;
- a balanced options comparison; Option A is rejected for weakening controls, not for failing;
- no sensitive arguments; the Team ID is a public signing identity.

**Reviewer verdict: CONDITIONAL PASS** (no P0/P1). The author's CONDITIONAL classification is justified. CR-1 to CR-4 were to be fixed before the gate goes to the owner, and they have been.
