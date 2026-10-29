# R2C: Independent Review (fresh-context AI, read-only)

- **Verdict: AGREE WITH CHANGES (no P0).** All findings were applied before the final report. There were no unresolved disagreements.
- **Reviewer's method:** files only, plus `shasum`/`grep`/`cat`/arithmetic. No `security` command, no script execution, no modification.
- **What the reviewer re-checked:**
  - **Hashes:** the logs (`cfb0f7bf…`, `fdfce7ca…`); the manifests (R2B 7/7, R2B6 6/6, I0-C 27/27); the scripts (`72d13e72…`, `e7e7efa6…`, `47e8c39d…`); 0 forty-character tokens in the logs.
  - **R2B-6 numbers recomputed:** durations 8.192 s / 12.772 s; start gap 1.127 ms; overlap 8.1913 s; end gap 4.580 s. The R2C doc truncates the milliseconds, which is harmless.
  - **All R2B-1…5 values** (secs 18.32 / 447.31 / 4.80 / 3.76 / 7.69; dump `rc=0` with dialogs=4; `password_requested=t`; ACL `(0)`).
  - **The R2B6 PASS logic** (L145–149) requires everything the doc claims.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| P1-1 | P1 | The risk register claimed "None is silently closed", but RK-3/6/8/9/13 were unmapped, RK-7 was folded away, RK-10 mislabelled, and the launcher TOCTOU residual dropped | **Fixed:** an RK→RC mapping table; new rows RC-20 (automation), RC-21/22/23, RC-24 (TOCTOU); RC-19 relabelled `=RK-10`; T11 added to the threat model |
| P1-2 | P1 | Architecture contradiction: D-B2 option (ii) (trust `security`) vs §C "never acceptable" | **Fixed:** §C now says "unacceptable unless D-B2 selects (ii) with explicit, recorded owner acceptance" |
| P1-3 | P1 | "Design changes before an isolated prototype" conflicted with D-* items that only a prototype can settle | **Fixed:** two tiers. **Tier 1 design-only** (D-A1, D-C1/2, D-D1–4, D-G1) applies before the prototype; **Tier 2** (D-B1/2/3, locked reads, sleep lock, kill/relock, isolated Always Allow, locked password prompts) is measured by the prototype. Production adoption requires every D-* closed |
| P2-1 | P2 | Provenance wording unverifiable as written | **Fixed:** restated as checkable facts (field absence in older scripts and mock logs; mtime 07:48:31Z; manifest predates the run; R-P3d) |
| P2-2 | P2 | Property 8 / RC-5 overstated "keychain password on every read" | **Fixed:** scoped to observed single reads (owner-reported, n=1, unlocked); primary basis R2B-1…5 plus run-2 facts; the `071207Z` discrepancy listed; re-measure when locked |
| P2-3 | P2 | Property 3 stated as established | **Fixed:** "observed effect; cause strongly supported" |
| P2-4 | P2 | Property 4 omitted trust changes by holders of the keychain password (K7) | **Fixed:** in property 4, T4 and the run-2 alternatives |
| P2-5 | P2 | K4/K5 attributed to the login keychain | **Fixed:** measured in throwaway keychains; login keychain expected, UNVERIFIED (property 10, RC-8) |
| P2-6 | P2 | "No dialog answered" called proven without its premise | **Fixed:** "proven given the owner-confirmed premise that Allow/Always Allow needed the password"; R2-3c `secs` still unavailable |
| P2-7 | P2 | Bulk-dump refutation over-scoped | **Fixed:** scoped (unlocked, `-T ''`, all ~4 denied, one answer; partial allow unknown; `rc` can't signal denial) |
| P2-8 | P2 | The first in-run R2B-6 attempt was missing | **Fixed:** "executed, outcome unknown, no persistence possible" |
| P3 | P3 | Log modes (all five `r2b-*` are 644); the "Lock state" bullet split; relock watchdog; out-of-scope alternatives (signed helper, hardware custody); T9 severity aligned to P1; "writes need the password" tagged partly established | **Fixed** |

**Decisions (reviewer):**
- Decision 1 CONDITIONAL PASS: **agree**, with added conditions (n=1, owner-reported dialogs, the `071207Z` discrepancy, R2B-6 satisfied by a separate retest).
- Decision 2 HOLD, design changes required: **agree**.
- Decision 3 RECOMMEND WITH CONDITIONS: **agree after P1-3** (now applied).
- Design readiness REQUIRES DESIGN CHANGES: **agree**.
