# REL-04 R15 evidence (ticket 39257)

Implementation `e6a6a6678bf6300362e15cf398343a246807a7e2` (tree `7b7bfc5…`). The handover is `docs/android/AURA_ANDROID_REL_04_R15_INDEPENDENT_VERIFICATION_HANDOVER.md`.

| Path | Content |
|---|---|
| `witnesses/` | The reviewer's unchanged 39255 G3 probe, run against a production build of R14 `6c69d7d`. Only its local connection asserts were adapted (`review-r14-home.local.diff`). Result: 2 rows, so the fresh-id duplicate reproduces. |
| `local-math-core/` | `runSweep.mjs` over every math-core CI command on `e6a6a66` (clean tree): **262/262**. Includes the R15 contract suite **63/63** and R4–R14. |
| `local-chromium/` | `rel04Chromium`: **30/30** (CH16; CH15 plus diagnostics). |
| `local-app/` | Production build with a disposable PG16 (54 migrations). R5 app rendering, `habitLogIdempotencyDb` (incl. R15 binding) and `rel04ActivityOperationHomeChromiumDb` **15/15**: **3/3** commands. |
| `local-db/` | The Day Constructor job on a fresh PG16, incl. Weekly Plan Review: **77/77**. |
| `migrate-*.log` | Migration logs for the fresh databases. |
| `ch15-diag.local.jsonl` | CH15 diagnostic observation from the local run (macOS arm64). |
| `ci-46036623125/` | CI run 46036623125 on `e6a6a66`, integration `2c9f15c`: **9/9 jobs, 471/471 steps, attempt 1**. Contains `run.json`, the CH15 CI diagnostics, and the job logs for app rendering, Chromium and math-core. `full-job-logs.SHA256SUMS` covers all 9 job logs, which are kept off-repo in `~/Desktop/Claude/AuraEvidence/REL-04-R15-CI-46036623125/`. |

The preserved 39255 evidence is in `../rel04-r14-independent-39255/` (59/59 verified). The 39255 disposition and the 39256 specification are in `../`.

Checksums: `shasum -a 256 -c SHA256SUMS` (run from this directory).
