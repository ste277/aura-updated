# V3-10: Independent AI Review

**AI review is not human security-owner approval.** All reviews were static and read-only: no harness, runner, `ps`/`pgrep` listing, signal or `security` call.

## Review 1 (V3-01 candidate, before CLOSE): CONDITIONAL PASS, no P0/P1
| ID | Sev | Finding | Resolution |
|---|---|---|---|
| V3R-1 | P2 | `read -t` was not bounded once a line had started (mid-line stall hang) | `sysread` with a whole-read deadline; test T8_midline_stall |
| V3R-2 | P2 | Fixed sentinel spoofable through a newline in a name (a regression vs v2) | Per-read nonce; exact final line; T8_spoof_sentinel and T8_no_trailing_newline |
| V3R-3 | P2 | Mock and runner listed the whole live process table (`pgrep -lf .`) | Exact-PID or known-parent queries only |
| V3R-4 | P2 | Dialog-capable ops other than create/unlock were not gated | **Owner-approved**; all 8 op types gated in the main shell, with refusal plus ledger for subshells |
| V3R-5 | P3 | Test gaps and weak static checks | Strengthened (V3-07/V3-08) |
| V3R-6 | P3 | RR-2 fields incomplete | Scanner PID and exclusion counts added |
| V3R-7 | P3 | Environment text evaluated as arithmetic | Numeric validation |
| V3R-8 | P3 | Orphan lifetime | Documented |

## Review 2 (fresh, final candidate after the V3R fixes and V3R-4): CONDITIONAL PASS, no P0/P1
| ID | Sev | Finding | Resolution |
|---|---|---|---|
| FR-1 | P2 | L5 background readers still exposed to the zsh crash (a scan ran while reader A was alive) | `sec_bg_pair`: both gates first, then both readers |
| FR-2 | P2 | `disown %+` not tied to the coprocess PID | Disown by `$jobstates` PID match; L5 requires well-formed reader results, otherwise INCONCLUSIVE |
| FR-3 | P2 | No complete run on the current files; in-repo evidence stale | Final unfiltered run 1092/0 on the exact hashes; evidence refreshed |
| FR-4 | P2 | Kernel tripwire attribution allow-list failed open | Inverted: only named foreign daemons are excluded |
| FR-5 | P3 | Gate ledger not consulted in teardown | Teardown overrides the verdict on any refusal (see FR-5' in V3-09) |
| FR-6 | P3 | Vacuous or narrow assertions; no runtime test of `&`/pipe bypass; nonce test not in the suite | Bypass bg and pipe tests; nonce in-suite; L5 adjacency check (partial, see FR-6') |
| FR-7 | P3 | Nonce comment; no byte-range guard | Fixed |
| FR-8 | P3 | `sec_i` accepted embedded newlines | LF and CR rejected |
| FR-9 | P3 | Silent disown failure; coprocess fds | Documented |

## Targeted re-review (FR fixes): CONDITIONAL PASS, no new P0/P1/P2
- FR-1, 2, 4, 5, 7, 8: **FIXED**.
- FR-6: **PARTIAL** (L5 check label stronger than what it proves).
- FR-3: open at review time, closed afterwards by the final run (`5197b041…`, 1092/0).
- Its specific answers:
  - the `jobstates` match cannot pick the wrong job;
  - reader tagging is sound and conservative;
  - the inverted `kern_hit` still passes the positive control and now fails safe.
- New P3 items: FR-5' (verdict override hides an earlier FAIL in the VERDICT line) and FR-6'.

**Fixes not independently re-reviewed:** none of the security-relevant code changed after the targeted re-review. The final full run's numbers came after it; the reviewer was told not to assess the run in progress.
