# R2C: Full R2B Reconciliation (Phase C)

**Sources:**
- `~/aura-r2b-evidence/r2b-20261112T071432Z.log` (**L**), sha256 `fdfce7ca…b224`;
- the R2B-6 log (**L6**), sha256 `cfb0f7bf…1045`;
- the original R-2 run-2 results as recorded in `AURA_GOV_02_R2B/R2B_SCRIPT_AUDIT.md` (owner-transcribed; no raw log exists for runs 1–2).

## Isolated R2B tests

| Test | Expected property | Observed (evidence) | Limitations | Supports conclusion? |
|---|---|---|---|---|
| R2B-1 single-read Deny | Denial blocks disclosure | L: `rc=128 secs=18.32 secret_returned=no owner=D`; dialog named `security` and the item; keychain password requested (`t`); ACL `(0)` after | owner-reported dialog details | **Yes** |
| R2B-2 single-read Allow | One-time Allow releases the value once, without persisting trust | L: `rc=0 secs=447.31 secret_returned=yes owner=A`, password `t`; ACL `(0)` after | long duration (owner entered the password) | **Yes** (release); persistence tested in R2B-3 |
| R2B-3 repeat Deny | Allow doesn't persist | L: a new dialog; `rc=128 secs=4.80 secret_returned=no owner=D`; ACL `(0)` | — | **Yes**: Allow is one-time |
| R2B-4 bulk dump Deny | A dump can't decrypt a protected item without authorization | L: `dump-keychain -d` `rc=0 secs=3.76 secret_in_dump=no owner=D dialogs=4`; ACL `(0)` | **4 dialogs** for one item, cause uncharacterized; **one** owner answer covered all four; the dump **exits 0** even when denied, so `rc` can't signal denial; partial-allow behaviour unknown | **Yes, scoped:** no disclosure in an unlocked throwaway keychain, `-T ''`, with all ~4 dialogs denied |
| R2B-5 post-dump Deny | The dump didn't grant trust | L: `rc=128 secs=7.69 secret_returned=no owner=D`; ACL `(0)` | — | **Yes** |
| R2B-6 concurrent Deny | Each concurrent request is independently gated | **In-run attempt** (L, last lines): executed, results never logged, STOP on invalid input; **outcome unknown**. **Retest** L6: see `R2C_R2B6_INDEPENDENT_VERIFICATION.md` (both `rc=128`, no secret, 8.19 s overlap, 2 dialogs, ACL `(0)`) | dialogs indistinguishable; satisfied by a separate retest with a different script | **Yes**: VERIFIED PASS (retest) |

## The original anomalous R-2 run 2 (`r2_verify.zsh`)

**Observed (owner-transcribed):**
- R2-1 Deny `rc=128`; R2-2 Allow `rc=0`; R2-3 Deny `rc=128`; R2-3b ACL `(0)`;
- **R2-3c bulk dump `secret_in_dump=1`**;
- R2-6a/b `rc=0 secs=0` with the secret;
- R2-4 `rc=0 secs=0`; R2-5 `rc=0 secs=0`;
- **R2-5b ACL `(1)`**.

**Classification:**

| Statement | Class |
|---|---|
| The secret was disclosed by the R2-3c dump and by later reads | **Proven** (as transcribed: the exact-match detection is sound) |
| An application was added to the trusted list between R2-3b and R2-5b | **Proven** (`(0)` → `(1)`) |
| No **Allow / Always Allow** was given at R2-6a/b, R2-4 or R2-5 | **Proven, given the owner-confirmed premise** that every Allow or Always Allow required typing the throwaway password (run 2; consistent with R2B-2). `secs=0` means under 1 s. A **Deny** can be that fast (R2B-4: four denies in 3.76 s), but those reads **succeeded**, so no Deny happened there |
| The trust was created by an **"Always Allow" on the R2-3c bulk-dump dialog** | **Strongly supported inference:** it is the only interactive window after R2-3b; R2B-4 shows a dump raises dialogs. R2-3c's `secs` value is **still unavailable**. **Alternative:** any process holding the keychain password can change trust without a dialog (K7 partition-list), and the throwaway password was **printed on screen** in run 2 |
| Who or what clicked it: the owner (against the on-screen "Deny" instruction, believing it was R2-4) or an **automation agent** (Codex Computer Use had Accessibility ON; the throwaway password was printed on screen) | **Unverified hypothesis.** Not determinable from the evidence |
| The trusted application was `/usr/bin/security` (`com.apple.security`) | **Strongly supported** (the only requester); the identity line wasn't captured in run 2 |
| A bulk dump bypasses the per-item ACL | **Refuted for:** an unlocked throwaway keychain, `-T ''`, all ~4 dialogs denied (single owner answer). Partial-allow behaviour is **unknown**, and `rc` can't signal denial |
| Run 1 (all `rc=128`, launched from the Claude app's input box) | **Unverified cause** (dialogs possibly not deliverable or auto-cancelled); no disclosure |

**Unresolved security risk:**
- A single Always Allow, given by a person or an automated agent, makes the item **silently readable by every process able to run `/usr/bin/security`**.
- The isolated tests confirm the Deny paths; they don't reduce this risk.
