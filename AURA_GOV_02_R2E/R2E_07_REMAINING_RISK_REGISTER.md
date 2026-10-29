# R2E-07: Remaining Risk Register (after R2E-FINAL)

**Key:** "mock-verified" means the harness *logic* behaves correctly against a simulator. It is **not** evidence about real macOS Keychain behaviour. Every item that depends on real behaviour stays **OPEN** until authorized Tier 2 execution.

## Carried R2C/R2D risks
| ID | Risk | Sev | Status |
|---|---|---|---|
| RC-1 | "Always Allow" persistently trusts `/usr/bin/security` | P1 | **OPEN.** L10 logic is mock-verified; real containment by locking is unverified. |
| RC-2 | Historical run-2 exposure (person vs automation) | P1 | **OPEN (historical)**; not addressable by R2E |
| RC-3 | Unlock and item dialogs, and concurrent dialogs, can't be told apart | P1 | **OPEN.** L5 and L15 owner recording is implemented. **L12 is only partial** (RE-9). Distinguishability is unmeasured. |
| RC-4 | No non-mutating lock-state probe | P1 | **OPEN.** L1 selection and calibration, and L8 phase-B reset detection, are mock-verified. Real qualification of `info`/`attr`/`dump` is unknown. |
| RC-5 / RC-11 | Password-entry dialogs; phishing | P1 | **OPEN.** `l` and `O` answers mean STOP (mock-verified). Detection relies on the owner's report. |
| RC-6 | A crash leaves the keychain unlocked | P1 | **OPEN.** The L7 watchdog/observer logic is mock-verified on every path. The real watchdog relock and real `ps` identity are unverified (RE-4b). |
| RC-7 | Passphrase custody | P1 | **OPEN (procedural).** The real tty prompt path is untested (RE-2). |
| RC-18 | Compromised session or admin | Accepted | Owner acknowledgement still required (R2D-08 §C) |
| RC-19 | Plaintext `ALTER ROLE` residual (R-1) | P1 | **OPEN**; out of scope (R-1 HOLD) |
| RC-20 | UI automation present but undetected | P1 | **OPEN.** The T1-6 name scan is mock-verified only (RE-4); the control is attestation plus name scan. |
| RC-24 | TOCTOU between checks and use | P2 | Partly reduced (re-checks after every group); a same-user race remains |

## R2E risks (implementation and mock-validation scope)
| ID | Risk | Sev | Status / minimum closure |
|---|---|---|---|
| RE-1 | Real `security -i` tokenisation of `-T ''` / `-w`, and its exit codes. L4 now depends on the rc. | P1 for execution | **OPEN — REQUIRES REAL ENV.** Fail-closed: a non-`(0)` ACL means STOP, and rc=0 on a locked write means FAIL. If real `-i` never returned 0, the L4 rc check would be vacuous and only the `mdat` and presence checks would remain. |
| RE-2 | Whether `create-keychain` / `unlock-keychain` without a password argument prompt on the tty | P2 | **OPEN — REAL ENV.** Fails closed. |
| RE-3 | A probe candidate raises a dialog when locked | P2 | Owner reports; a dialog disqualifies the probe (mock-verified) |
| RE-4 | **The real process-table scan (T1-6) has never run on this Mac.** `sandbox-exec` refuses the setuid `/bin/ps`, so the `-axo` table is **fully simulated**. The T1-6 results validate the parsing and exclusion *logic* only. | P1 for execution | **OPEN.** **Minimum closure:** a separately authorized, read-only, unsandboxed dry run of the T1-6 scan alone, with no `security` call. Run it once with a denylisted app open (expect STOP) and once with none (expect clean). Keep the raw output. |
| RE-4b | Watchdog/harness identity relies on real `/bin/ps -ww -o command=/ppid=` output. The mock emulates it with `pgrep`. | P2 | **OPEN — REAL ENV.** Fail-closed (observer INCONCLUSIVE; watchdog left to fire). Close it in the RE-4 dry run against a test-owned dummy process. |
| RE-5 | The free-disk check (≥ 500 MB) is not mock-tested | P3 | Code inspection only |
| RE-6 | `ps` column truncation. The earlier `*r2d_watchdog*` match was exposed; the earlier claim "unaffected" was **overstated**. | P2 | Fixed (`-ww` everywhere); real behaviour is covered by RE-4/4b |
| RE-7 | Lock state stays `unknown` unless L1 qualifies a probe; then L7, L8 and L9 are INCONCLUSIVE at best | P1 | By design; INCONCLUSIVE is never PASS (mock-verified) |
| RE-8 | Mock answers or hooks leaking into a REAL run | P3 | **Closed in code:** REAL mode refuses every `R2D_*` variable (static test, review RV-2) |
| RE-9 | **L12 partial.** `dlg` doesn't capture "names `security`" or "names keychain/item" (R2D-03) | P2 | **OPEN.** Add these two owner questions and update the answer scripts before Tier 2, or accept the gap explicitly |
| RE-10 | Whether real `security lock-keychain -- <kc>` accepts `--` (watchdog) | P2 | **OPEN — REAL ENV.** If rejected, L7 reports FAIL (fail-closed). |
| RE-11 | Real formats: `dump-keychain -a` vs the ACL parser; the `show-keychain-info` string; `mdat` readability; `pmset -g log` " Sleep " matching | P2 | **OPEN — REAL ENV.** All fail closed (STOP or INCONCLUSIVE). |
| RE-12 | L8 single trial; real securityd timer granularity and eager vs lazy relock unknown; "deadline recomputed from last access" not characterized | P2 | **OPEN — REAL ENV.** Recommend 2 trials at Tier 2. |
| RE-13 | Runner `kern_hit` puts `$REALKC` into a regex unescaped (review N-7) | P3 | Accepted; safe for the current path. Fix before reuse. |
| RE-14 | Sandbox differences. The mach-lookup deny has no functional control; securityd may leave files in the run dir (then `rmdir` fails → UNVERIFIED, fail-safe); the type-ahead flush is untested | P3 | Accepted at mock scope |
| RE-15 | The mock raises no dialogs, so every owner-observation path is scripted | P2 | Inherent; Tier 2 only |

## Gate status (unchanged by R2E)
- **Real-Keychain testing:** HOLD.
- **Prototype execution:** HOLD.
- **R-2, R-1, B4, B5, B6:** HOLD.
- **Rotation:** HOLD.
- **Production security approval:** HOLD.
- **Production merge freeze:** active.
