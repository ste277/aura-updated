# REV01-01: Baseline Integrity

**Checkout:** `/Users/stephen/Desktop/Claude/auraschedule-math-core`, `main`, `f35d35a`. `AURA_GOV_02_T1_6_REV_01/` did not exist beforehand.

| Package / document | Manifest SHA-256 (prefix) | Verified |
|---|---|---|
| `AURA_GOV_02_R2C/` | `2687291fab918c0d…` | 9/9 OK |
| `AURA_GOV_02_R2D/` (contains R2D-02 and R2D-08) | `bfa4107d166459f9…` | 10/10 OK |
| `AURA_GOV_02_R2E/` | `f7cfecdb78face5e…` | 120/120 OK |
| `AURA_GOV_02_RE4/` | `470722ae29b999bf…` | 11/11 OK |
| `AURA_GOV_02_RE4_FIX01/` | `fc18957febbe4e17…` | 22/22 OK |
| `AURA_GOV_02_RE4_RERUN_01/` | `a8adb876b016a221…` | 12/12 OK |
| `AURA_GOV_02_RE4_CLEAN_01/` | `b619d969bfb12a45…` | 10/10 OK |

| Authoritative item | SHA-256 | Matches its manifest |
|---|---|---|
| R2D-02 `R2D_02_TIER1_CONTROL_SPEC.md` | `c11a4c39ece3b35dd11774a3e58ad8c236f9e8a8b4cf91a26aad609ea3cf5364` | ✓ |
| R2D-08 `R2D_08_OWNER_AUTHORIZATION_CHECKLIST.md` | `36a934d9e89f9cd985702a754662b9df8f6db636bf944379d7dc0165c2699cef` | ✓ |
| Pinned v2 harness `AURA_GOV_02_RE4_FIX01/r2d_prototype.zsh` | `4b7e48900fb09b2b9bddda6e2306f284233178e59b5ebc2fd247fd32b2510d95` | ✓ |

**V3-01 status: NOT AVAILABLE.** No `AURA_GOV_02_RE4_V3*` package, artifact or manifest exists in the workspace. It is treated as **not started or not delivered**, not as complete.

**Commands this ticket ran:** `shasum` (manifest verification) and `grep`/`sed` on documents. There was no system query, process scan, signal or `security` call. Nothing historical was modified.
