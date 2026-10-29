# V3-04: Structural Diagnostics (RR-2)

Final run (`evidence/synthetic_run_final/`); every scenario below **PASS**.

**Line formats** (names-free; checked against a strict regex in `T8_diag_clean`):
- `T1-6 diag scan=<n> read=<1|2> col=<ucomm|comm> rc=<n|none> rows=<n> pid1=<yes|no> own=<yes|no> dup=<n> malformed=<n> timeout=<yes|no> valid=<yes|no>`
- `T1-6 diag scan=<n> result=<CLEAN|DETECTED|UNKNOWN> hits=<n> scanner_pid=<pid> excluded_self=<0|1> excluded_children=<n> why=<reason|none>`
- `T1-6 gate op=<dialog op> scan=<n> result=<…>`

| Scenario | Shows |
|---|---|
| T8_diag_clean | Per-read fields for both columns; the result line carries scanner PID and exclusion counts; `why=none` on CLEAN; no paths or arguments |
| T8_diag_unknown_rc | `rc=1 valid=no`, then `result=UNKNOWN … why=ucomm read: ps exit status 1`; the second read is never attempted |
| T8_diag_counts | `dup=1 malformed=1`; the reason is the first structural failure |
| T8_overflow | Above `SCANMAX` gives UNKNOWN |
| T8_logfail_preflight / _result / _gate / _gateline | A failed diagnostic write at any of the 4 call sites gives UNKNOWN and STOP (the protected op is blocked at gates) |
| T7_ps_* (16 cases) | Each structural failure gives UNKNOWN, with the reason in the diagnostic line |
