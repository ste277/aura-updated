# CLEAN01-01: Baseline Integrity

**Checkout:** `/Users/stephen/Desktop/Claude/auraschedule-math-core`, branch `main`, HEAD `f35d35a`. `AURA_GOV_02_RE4_CLEAN_01/` did not exist beforehand.

| Package | Manifest SHA-256 | Entries | Verified |
|---|---|---|---|
| `AURA_GOV_02_RE4_FIX01/` | `fc18957febbe4e17bacb3d01e1e7b463eafdee940bed3c892f3946033a442beb` | 22 | 22/22 OK |
| `AURA_GOV_02_R2E/` | `f7cfecdb78face5e95abc75a2e955086fccc57b1b6bcf3eb5802d7d230a0c0eb` | 120 | 120/120 OK |
| `AURA_GOV_02_RE4/` | `470722ae29b999bf6fbdfd089216dbaf4d64ce93b8abaeaea939e3b2fd93eb3d` | 11 | 11/11 OK |
| `AURA_GOV_02_RE4_RERUN_01/` | `a8adb876b016a221b4c814e56e43c76de2240eba0d0840e9cedf2c33a48a8656` (= expected) | 12 | 12/12 OK |

**Pinned v2 harness** `AURA_GOV_02_RE4_FIX01/r2d_prototype.zsh`: `4b7e48900fb09b2b9bddda6e2306f284233178e59b5ebc2fd247fd32b2510d95` (= expected).

**No integrity mismatch.** No earlier evidence was modified.

**Commands this ticket ran:**
- `shasum -a 256 [-c]` on the manifests and harness;
- `grep`/`sed`/`awk` on source and documents;
- one read-only system query, `/usr/bin/profiles status -type enrollment` (rc 0). Its output, with the MDM server path redacted, is captured in `evidence/clean01_mdm_enrollment_redacted.txt` and covered by this package's manifest.

**Not run:** no process scan, no `ps`/`pgrep`, no signal, no `security`.
