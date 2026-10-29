# V3-01: Baseline Integrity

**Tickets:** AURA-GOV-02-RE-4-V3-01, completed under V3-01-CLOSE.
**Checkout:** `/Users/stephen/Desktop/Claude/auraschedule-math-core`, `main`, `f35d35a`. 118 untracked or modified entries at the start of CLOSE, including this workstream's own untracked packages. Nothing was committed.

| Package | Entries verified | Manifest SHA-256 (prefix) |
|---|---|---|
| R2C | 9/9 | `2687291fab918c0d` |
| R2D | 10/10 | `bfa4107d166459f9` |
| R2E | 120/120 | `f7cfecdb78face5e` |
| RE-4 | 11/11 | `470722ae29b999bf` |
| FIX01 | 22/22 | `fc18957febbe4e17` |
| RERUN-01 | 12/12 | `a8adb876b016a221` |
| CLEAN-01 | 10/10 | `b619d969bfb12a45` |
| T1-6-REV-01 | 10/10 | `f2a7307d9e58b04e` (= expected) |

- **v2 harness:** `AURA_GOV_02_RE4_FIX01/r2d_prototype.zsh` = `4b7e48900fb09b2b9bddda6e2306f284233178e59b5ebc2fd247fd32b2510d95`. Unchanged; verified at the start and the end.
- **Isolation:** the v3 candidate lives only in `AURA_GOV_02_RE4_V3_01/`. It was created from byte-identical copies of the FIX01 harness, mocks and runner (verified with `diff` of their hashes).
- **Denylist:** `superops` is still in v3's `DENYT`. There is **no** managed-device code (`grep -ci managed` = 0).
- **Snapshots:** pre-review `…/scratchpad/v3_pre_review/` and pre-V3R-4 `…/scratchpad/v3_pre_v3r4.zsh` exist. They are historical context only; the final evidence is in this directory.

**No live process scan, no real Keychain operation, no `security` call.**
- The suite's sandbox denies exec of `/bin/ps` and `/usr/bin/security`.
- One host-wide `ps` listing was **written into a verification command by mistake and stopped before it ran** (V3-08 §Incidents).
