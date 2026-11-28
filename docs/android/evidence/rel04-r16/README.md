# REL-04 R16 evidence (ticket 39259)

| Path | Content |
|---|---|
| `witnesses/r15-e6a6a66/` | The four unmodified 39258 probes on R15. Receipt and refusal run in jsdom; 429 and Calendar run on a production build with PostgreSQL. Every probe observed its fault (exit 1). |
| `witnesses/r16-3c906f9/` | The same probes on R16: all exit 0. |
| `rel04R16OperationCorrection.local.log` / `rel04R16HomeChromiumDb.local.log` | Standalone local runs (56/56, 15/15). |
| `local-*/` | `runSweep.mjs` on `3c906f9`: math-core 262/263 (the R16 jsdom wall-clock issue, fixed in the handover commit), Chromium 1/1, app rendering 4/4, Day Constructor DB 77/77. |
| `ci-46048936628/` | Hosted run on `3c906f9`, integration `ffc8c5c` (base `aab5602`): 8/9. `run.json` and the failing Day Constructor job log (MP-1 / `/api/plans` binding interaction). |

The preserved 39258 evidence is in `../rel04-r15-independent-39258/` (32/32 verified). The disposition is in `../AURA_ANDROID_REL_04_R15_INDEPENDENT_DISPOSITION_39258.md`.
| `integration/` | Local DB (85/85) and math-core (270/270) sweeps on `4dce038`, plus the clock matrix: R14 and R15 at five simulated times. |
| `ci-46052425786/`, `ci-46054358960/`, `ci-46108171358/` | The three later failed runs: `run.json` plus checksums of the off-repo job logs. |
| `ci-46112586858/` | The final run, **9/9**: `run.json` plus checksums of the off-repo job logs. |
