# R2E-04: L4 and L8 Security Assertions

## L4: overwrite and delete of item A while locked
**Sequence (harness `L4()`):**
1. **Baseline `mdat`.**
   - Read while locked only if L1 qualified `attr` as dialog-free; the review found that this read might otherwise raise an unlock dialog.
   - Otherwise take it through a controlled unlock, followed by a lock whose return code is checked.
   - The baseline is logged.
2. **Wait 1.1 s.** Real `mdat` has 1-second resolution, so no later write can share the baseline's second.
3. **Pre-write state.** It must be `locked` by the calibrated probe. If no probe was calibrated, the harness logs "locked by construction only (lock_ctl rc=0)". Any other state means INCONCLUSIVE and STOP.
4. **Controlled, isolated attempts.**
   - First the overwrite: `security -i` with `add-generic-password -U … <run keychain>`, given a fresh synthetic value. The value is never logged and is cleared right after.
   - Then `delete-generic-password`.
   - The owner records each dialog.
5. **Controlled unlock, then read back.** Read `mdat` and test the item for presence; then lock with the return code checked.

**Decision rules (fail-closed):**
| Observation | Verdict |
|---|---|
| Overwrite rc = 0 | **FAIL** (overwrite accepted while locked) |
| Delete rc = 0, or item absent afterwards | **FAIL** (deleted while locked) |
| `mdat` after ≠ baseline | **FAIL** (modified while locked) |
| No baseline, or no after-value | **INCONCLUSIVE** (never PASS) |
| Otherwise | "RECORDED". The log states explicitly: *mdat equality alone is NOT proof of no modification*. |

**Mock evidence (all PASS):**
| Scenario | Fault | Result |
|---|---|---|
| T2_L4_write | Locked write and delete both succeed | FAIL, caught by the rc check |
| T2_L4_overwrite_only | Only the overwrite succeeds | FAIL |
| T2_L4_silent_write | rc=128, but `mdat` changed | FAIL (modified) |
| T2_L4_no_baseline | No `mdat` attribute | INCONCLUSIVE |
| T2_L4_pass_note | Normal path | Locked before the write, no FAIL, note logged |

The mock now uses 1-second `mdat` resolution, the same as real.

**Limitations (Task F):**
- An unchanged `mdat` is not proof of no change. The value is not re-read, because that would add an item-access dialog.
- Real `security -i` exit codes are unverified (RE-1). If real `-i` always returned 0, L4 would false-FAIL (fail-closed). If it never returned 0, the rc check would be vacuous and only the `mdat` and presence checks would remain.
- Whether `mdat` is readable on real macOS through `find-generic-password` attributes is unverified (RE-11).
- The real dialog behaviour of the locked attempts is unmeasured.

## L8: lock timeout and whether the probe resets the idle timer
**Setup:** `set-keychain-settings -l -t T`, verified exactly. Mock T = 8 s; REAL T = 60 s. Offset `off` = T/4 if T < 60, else 15 s.

**Phases:**
- **Phase A (no probe while idle).** Controlled unlock (this resets the idle timer, so t0 is taken after it). Wait T+off, then probe once. This measures whether the timeout relocks.
- **Phase B (one probe at T/2).** Controlled unlock, then probe at T/2 (`pm`), then probe at T+off (`p2`).
  - If the T/2 probe reset the idle timer, relock would move to ≈ 1.5T > T+off, so `p2` would be `unlocked`.
  - The design needs `off` < T/2: 2 < 4 in mock, 15 < 30 in REAL.

**Verdicts:**
| Condition | Verdict |
|---|---|
| p1 unlocked | **FAIL** |
| No calibrated probe | INCONCLUSIVE |
| `pm` ≠ unlocked (relocked before T/2, so a reset is not measurable) | INCONCLUSIVE (review RV-3) |
| p1 locked and p2 locked | **PASS** (labelled "single trial") |
| p1 locked and p2 unlocked | **PARTIAL**: the probe resets the idle timer, so the L1 idle criterion FAILs |

**Mock evidence (all PASS):**
| Scenario | Result |
|---|---|
| T2_L8_pass | PASS |
| T2_L8_probe_resets | PARTIAL |
| T2_L8_early_lock | INCONCLUSIVE |
| T2_L8_noprobe | INCONCLUSIVE |
| T2_L8_no_autolock | FAIL |

**Limitations (Task G):** these results are limited to the simulated environment.
- **Single trial.** Repeatability on real hardware is not established; two trials are recommended at Tier 2 (RE-12).
- **Timer granularity unknown.** Real securityd timer granularity, and whether it relocks eagerly or lazily on access, are unknown. Tolerances are justified only by the mock's integer-second clock (margin 2 s).
- **Phase A has a gap.** It cannot show that the relock happened *after* T, only that it happened by T+off. Phase B's `pm=unlocked` is the only evidence that no early relock occurred.
- **R2D-03 requirement not implemented.** The "deadline recomputed from last access" characterization is not implemented; PARTIAL reports the reset qualitatively.
- **A probe that changes the measured behaviour is never declared safe.** The PARTIAL verdict records an L1 FAIL for that probe.
