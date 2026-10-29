# RR01-01: Baseline and Hashes

| Check | Expected | Observed | Result |
|---|---|---|---|
| Checkout | — | `/Users/stephen/Desktop/Claude/auraschedule-math-core`, `main`, `f35d35a` | ✓ |
| FIX01 `SHA256SUMS` hash | `fc18957febbe4e17bacb3d01e1e7b463eafdee940bed3c892f3946033a442beb` | same | ✓ |
| FIX01 entries | 22 | 22/22 OK | ✓ |
| v2 harness `AURA_GOV_02_RE4_FIX01/r2d_prototype.zsh` | `4b7e48900fb09b2b9bddda6e2306f284233178e59b5ebc2fd247fd32b2510d95` (FIX01 manifest entry) | same | ✓ |
| R2E manifest | 120 entries, `f7cfecdb…` | 120/120 OK | ✓ |
| RE-4 manifest | 11 entries, `470722ae…` | 11/11 OK | ✓ |

The v1 hash (`b9dd4d43…`) was **not** used as the baseline. Every integrity check passed, so execution was allowed to proceed.

| Artifact created by this ticket | SHA-256 |
|---|---|
| `probes/rr01_stop_probe.zsh` | `9a6b809f8586f004dde190cba2266959a2e7f961309260ef7be40c6b217f0cb9` (also logged by the probe at run time) |
| Extracted v2 T1-6 block (harness lines 177–224, 48 lines) | `730c09f022d9f5a0f0b15bdd60c0e5d3d06b14a2f6b0efbe0c222834c7df6b20` (independently recomputed by the reviewer) |
