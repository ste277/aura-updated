# CLEAN01-05: RERUN-01 Residual Findings

## RR-2 — No runtime row-count or exit-status evidence (P3, open)
**Recommended instrumentation (future v3, separate ticket; the pinned v2 is not modified).** In `ps_parse` and `t16_scan`, log on **every** outcome one names-free line per read and one summary line, for example:
- `T1-6 read ucomm: rc=0 rows=474 pid1=yes own=yes dups=0 malformed=0`
- `T1-6 read comm: …`
- `T1-6 outcome=DETECTED|CLEAN|UNKNOWN hits=<n> excluded_self=<n> excluded_children=<n>`

These lines carry only counts. **Hit names** are logged only on DETECTED, as today, and there are **no command lines or arguments**.

Add T7 assertions that these lines exist for each outcome, re-pin the harness and re-run the full mock suite.

A probe-only alternative would call the extracted `ps_read`/`ps_parse` directly and log the counts. That is a *separate* snapshot from the one `t16_scan` takes, so it is weaker evidence and **not recommended** as the closure.

## RR-6 — Timeout path not exercised on the real host (P3, open)
- **Existing evidence:** mock `T7_ps_timeout` (hung mock ps, 2 s bound: UNKNOWN, bounded, ps killed).
- **Recommendation:** first fix FX-3 (job-table gated or no-signal timeout). Then accept the mock evidence for the code path.
- A real-host exercise would need a test-owned slow stand-in for `ps`, which is a process-termination experiment. That needs its own authorization and is **not required** to rely on the fail-closed result, because a timeout can only produce UNKNOWN.

## RR-7 — Private probe directory says nothing about real `/tmp` (P3, open)
- **Recommendation:** close it **by design**, not by testing. Remove the file (FX-4 option 1) or adopt a private directory, then cover it with a mock regression test.
- No live substitution test is recommended.
