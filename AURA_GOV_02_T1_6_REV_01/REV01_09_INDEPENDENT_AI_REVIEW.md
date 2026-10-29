# REV01-09: Independent AI Review

**Reviewer:** a fresh-context agent, static and read-only (`shasum`, `cat`, `grep`, `sed` only; no `ps`, `profiles`, `codesign`, `security` or harness; nobody contacted).

**What it recomputed itself:** all seven manifests (R2C 9/9, R2D 10/10, R2E 120/120, RE4 11/11, FIX01 22/22, RERUN 12/12, CLEAN 10/10), the hashes of R2D-02, R2D-08 and the v2 harness, and that no V3 directory exists.

**This review is not human approval and does not authorize execution.**

## Round 1 (13 findings, no P0/P1) and round 2 (re-review of the corrections)
| ID | Sev | Finding | Correction | Re-review |
|---|---|---|---|---|
| TR-1 | P2 | `comm`/`ppid=1`/`ucomm` presented as identity; all are spoofable | §3: identity = `user=root` (daemon) or `lsof txt` + Team ID (tray); the others are consistency checks only; spoof mock cases added | FIXED |
| TR-2 | P2 | Tray agent launch source unchecked | LaunchAgent check; single instance; R-M2b | FIXED |
| TR-3 | P2 | An activated mode with zero agents could report CLEAN | CLEAN only when the mode is off; absent agents give UNKNOWN; mock added | FIXED |
| TR-4 | P2 | A 7-day attestation is too broad for "no remote session" | Per-run windows in hours; record ≤ 7 days | FIXED |
| TR-5 | P2 | Attestation authenticity not a residual | Provenance required; **R-M6** added; the owner obtains it | FIXED |
| TR-6 | P2 | Other agents (Scrut) not inventoried | Signed full inventory; un-inventoried agent gives UNKNOWN | FIXED |
| TR-7 | P3 | No explicit no-signal guarantee | "Never signalled"; V3-01 no-signal timeout is a hard prerequisite | FIXED |
| TR-8 | P3 | Serial could leak into evidence | Serial stored as a hash; record kept outside the repository | FIXED |
| TR-9 | P3 | "R2E-proven redaction" overstated | R2E-04 line 12 cited; leftover "redacted" wording corrected after round 2 | PARTIAL, then corrected (**not re-reviewed**) |
| TR-10 | P3 | Inference stated as a finding | Labelled *Inference* | FIXED |
| TR-11 | P3 | R2C manifest hash missing | `2687291f…` added | FIXED |
| TR-12 | P3 | Appointing authority unspecified | UNRESOLVED; the owner cannot hold the role | FIXED |
| TR-13 | P3 | Activation-record permissions and confirmation echo | 0600 record in a 0700 directory; phrase echoes hash, expiry and window | FIXED |
| TR-14 | P3 (round 2) | REV01-06 cited a non-existent REV01-09 | Resolved by this file | **Not re-reviewed** |
| TR-15 | P3 (round 2) | "Re-attest … (which gives STOP)" ambiguous | Crossing into a new window means STOP; no in-run re-attestation | **Not re-reviewed** |
| TR-16 | P3 (round 2) | REV01-08 binding summary incomplete | Summary expanded | **Not re-reviewed** |

**Fixes not re-reviewed:** TR-9 (leftover wording), TR-14, TR-15 and TR-16. All are editorial P3 items with no effect on security or authorization (per the reviewer).

**Reviewer's final recommendation: PASS for the package as a decision-ready amendment proposal.** No P0/P1, and no authorizing language. SuperOps stays denylisted, managed mode stays out of V3-01, and the approval fields are blank.

**External dependencies remain:** the security owner and appointing authority; the administrator attestation and inventory; V3-01 not delivered; no managed-mode implementation ticket. Until these are resolved, **Option A or C is the default**.
