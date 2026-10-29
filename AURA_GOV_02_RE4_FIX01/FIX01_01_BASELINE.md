# FIX01-01: Baseline

| Item | Value |
|---|---|
| Checkout | `/Users/stephen/Desktop/Claude/auraschedule-math-core`, branch `main`, HEAD `f35d35a` (verified) |
| Git status | 108 pre-existing untracked or modified entries, all preserved. `AURA_GOV_02_R2E/` and `AURA_GOV_02_RE4/` were untracked; `AURA_GOV_02_RE4_FIX01/` did not exist. |
| R2E manifest | `SHA256SUMS` hash `f7cfecdb…`; **120/120 OK** |
| RE-4 manifest | `SHA256SUMS` hash `470722ae…`; **11/11 OK** |
| Original harness | `AURA_GOV_02_R2E/r2d_prototype.zsh` `b9dd4d431a2864d31a55a017f1cf9f9ae551e9b9081881f4f90dd1ef0bf7c254`, **unchanged** |
| Inputs reviewed | RE4_FINAL_GATE_REPORT, RE4_04 (scanner compatibility), RE4_06 (RV4-1 P1, RV4-2/3 P2), RE4_07; the R2E harness, mocks and runner |

**Decision: build v2 alongside the original, not in place.** The R2E harness is pinned by its manifest, and editing it would break that evidence. So v2 is built in this directory from byte-identical copies (copy hashes were verified equal to the originals before editing):
- `r2d_prototype.zsh`
- `mock/{security,ps,pmset,csrutil}`
- `tests/r2e_selftest.zsh`

R2E and RE-4 are left untouched.
