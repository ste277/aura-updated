# REL-04 R17 evidence (39261 → 39262)

- `baseline-r16-e94a863/` — the reviewer's 39260 probes (startup, conflict, receipt), unmodified, on the unchanged R16 production build: G7, G8 and G9 reproduce; the startup ready-state control passes.
- `reviewer-probes-on-r17/` — the same probes plus timeline and 429-separate on the R17 build (`aff9259`).
- `local-r17/` — R17 jsdom suite (26/26), R17 Chromium + PostgreSQL suite (11/11), R16 (15/15) and R15 (15/15) browser suites on the R17 build, and the manual page negative control with the stale-read fence removed (25/26).
- `local-math-core-aff9259/`, `local-db-aff9259/` — clean-tree sweeps of the CI math-core (273/273) and DB (86/86) jobs.
- Chromium 151.0.7922.34, Node v26.5.0, PostgreSQL 16 (disposable, port 55497, 56 migrations).
