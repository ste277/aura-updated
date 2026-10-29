# R2B6: Independent Review (fresh context, AI). **Not a substitute for the interactive test evidence.**

**Verdict: READY WITH CHANGES** (no P0). **All findings addressed** in the final script `e7e7efa6704b6caf2e0cb26538b93bd41b6bada1dee7e0019466e8d2bc9a335c`. Re-tested in U1–U10.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| R-P1 | P1 | Ctrl-D (EOF) at "Press Enter to launch" produced `x=''`, which matched `^$` and **launched the real reads**. Whitespace-only input also passed (default IFS) | **Fixed:** `IFS= read -r x </dev/tty \|\| STOP "no input (EOF)"` (U4, U5, U7, U9) |
| R-P2a | P2 | PASS was reachable with app or item answers of `-` | **Fixed:** PASS requires `O1 == y && O2 == y` (U6) |
| R-P2b | P2 | PASS accepted any non-zero rc (e.g. item-not-found or lock errors with a miscount) | **Fixed:** PASS requires `rc == 128` for both; per-reader non-secret `stderr_class` added |
| R-P3a | P3 | Mode label bug | **Fixed** (`mode=INTERACTIVE` / `MOCK-<case> (no Keychain read, no dialog)`) |
| R-P3b | P3 | `SHA256SUMS` missing | **Added** |
| R-P3c | P3 | Disk nearly full (1.0 GiB); `tee` failures unchecked | **Mitigated:** preflight ≥ 500 MB free; post-run check that the log recorded the verdict (warning otherwise). Owner should free space |
| R-P3d | P3 | Evidence gaps: keychain-password question, macOS version | **Added** |
| R-P3e | P3 | Random throwaway keychain password briefly in the `create-keychain` argv | Accepted. It's random and never shown, which also makes Allow impossible (the dialog would need it) |

**Verified fine by the reviewer:**
- **Keychain targeting:** every call uses `"$KC"`; the path is asserted; no global changes; no prior Allow.
- **Mock mode** can't be triggered except by an exact `--selftest=` argument.
- **Attribution:** `$!` equals the reader's `$sysparams[pid]`; the `security` child is reachable by `pkill -P`.
- **`wait` statuses** are correct even when a reader finishes first.
- **Overlap** computation is correct.
- **Secret** goes via stdin only; files and logs hold `yes`/`no` only; directory 700, logs 600.
- **Results are logged before** any question.
- **Cleanup** is idempotent, kills only its own children (ppid check), releases only its own lock, and does no broad deletion.
- **Classification order** can't manufacture a PASS.
