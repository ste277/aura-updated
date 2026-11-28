# REL-04 R18 evidence (39265 → 39266)

- `baseline-r17-ab3c15b/` — the reviewer's 39262 probes (contradictory, check-again), unmodified, on the unchanged R17 production build: G10 and G11 reproduce.
- `reviewer-probes-on-r18/` — the same probes on the R18 build: check-again 3/3; contradictory sends no new id (1 row, copy kept) and fails only its `retryVisible > 0` condition, which 39265 forbids for an untrusted identity.
- `local-r18/` — R18 jsdom (27/27), R18 Chromium + PostgreSQL (7/7), R17 (11/11), R16 (15/15) and R15 (15/15) browser suites on the R18 build.
- `local-math-core-11dad48/` (276/276), `local-db-11dad48/` (89/89), `local-chromium-11dad48/` (30/30) — clean-tree sweeps of the CI jobs.
- Chromium 151.0.7922.34, Node v26.5.0, PostgreSQL 16 (disposable, port 55497).
