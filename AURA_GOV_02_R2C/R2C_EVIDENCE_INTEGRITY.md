# R2C: Evidence Integrity (Phase A)

**Read-only. No Keychain operation was performed for this review.**
- No `security` command was run against any keychain.
- No script was executed.
- Only `shasum`, `grep`, `cat` and a timestamp conversion were used.

## Manifests (verified 2026-11-14)

| Package | Manifest | Result |
|---|---|---|
| `AURA_GOV_02_R2B/` | `SHA256SUMS` | **7/7 OK** (unchanged since R2B; `r2b_isolated.zsh` = `72d13e72…1430`) |
| `AURA_GOV_02_R2B6/` | `SHA256SUMS` | **6/6 OK** (`r2b6_concurrency_retest.zsh` = `e7e7efa6704b6caf2e0cb26538b93bd41b6bada1dee7e0019466e8d2bc9a335c`) |
| `AURA_GOV_02_I0_C_ARTIFACTS/` (context) | `SHA256SUMS` | 27/27 OK |

## Execution logs

| Log | sha256 | Mode | Contents check |
|---|---|---|---|
| `~/aura-r2b-evidence/r2b-20261112T071432Z.log` (R2B-1…5; R2B-6 stopped) | `fdfce7caa7463915515237d17d326a8d0da472a6f5d7352149e31ebe51c7b224` | `-rw-r--r--` (directory 0700) | 0 forty-character alphanumeric tokens; no password, token or secret patterns |
| `~/aura-r2b-evidence/r2b6-20261114T030606Z.log` (R2B-6 retest) | `cfb0f7bfc61ce2114ca59caa5350c9a6a78ce00c0757e4873ea42ea4e0581045` | `-rw-------` | 0 forty-character tokens; no `password=`, token, `npg_` or key patterns |
| `~/aura-r2b-evidence/r2b-20261112T071207Z.log` (earlier stop at R2B-1) | (context only) | `-rw-r--r--` | sanitized |

The evidence directory is `drwx------`. All five `r2b-*` logs (three self-tests and two interactive runs) are mode 644, because they were created before the R2B6 script set umask 077. The 0700 directory still restricts access to the owner. **P3:** tighten them to 600 at the owner's convenience. Not done here, because evidence is left unmodified.

## Script targeting (inspection only)
- **`r2b6_concurrency_retest.zsh`:** every `security` call uses `"$KC"`, a fresh `$TMPDIR/r2b6.*/r2b6.keychain-db`. It asserts the path and that the file doesn't pre-exist, checks the search list and default keychain before, during and after, and makes no `-s` or partition-list calls.
- **`r2b_isolated.zsh`:** the same pattern with `$TMPDIR/r2b.*/r2b-isolated.keychain-db`.
- **The original `r2_verify.zsh`** (`47e8c39d…`): an explicit throwaway keychain under `mktemp -d`.

## Provenance limitation (P3)
- The R2B-6 log does **not** record the executing script's hash. Earlier `r2b6` drafts weren't preserved, so "fields exist only in the final version" can't be checked directly.
- **What the evidence shows:**
  - the fields `macOS=`, `stderr_class=` and `keychain_password_requested=` are absent from `r2b_isolated.zsh` and `r2_verify.zsh`;
  - they are absent from every R2B6 mock log up to 07:46:31Z, and present in the mock logs from 07:48:41Z (the post-review U-series);
  - the final script's mtime is 2026-11-12T07:48:31Z, before those logs and before the R2B-6 run (2026-11-14T03:06Z);
  - the R2B6 manifest (6/6) predates the run;
  - `R2B6_INDEPENDENT_REVIEW.md` (R-P3d) records that those fields were added in the final version.
- The "corrected `mode=INTERACTIVE` label" can't be checked independently (the only earlier evidence is the mock-label bug).
- **So the log was produced by `e7e7efa6…`. That is strongly supported, not proven.**
- **Recommendation:** future scripts should log their own sha256 at start.

## Conclusion
- **Integrity: established.** The manifests and logs are intact and sanitized.
- **Provenance of the R2B-6 run: strongly supported.**
- No real Keychain access was needed or used for this review.
