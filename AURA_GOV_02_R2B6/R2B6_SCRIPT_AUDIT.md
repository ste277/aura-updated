# R2B6: Audit of the original R2B-6 implementation (read-only)

- **Audited:** `AURA_GOV_02_R2B/r2b_isolated.zsh`, sha256 `72d13e72318f5ca52ad47545eabf04087b594b1ec38f019d3104b59b15a91430`. Preserved and unmodified; `AURA_GOV_02_R2B/SHA256SUMS` 7/7 OK.
- **Evidence:** `~/aura-r2b-evidence/r2b-20261112T071432Z.log` and `~/aura-r2b-evidence/r2b-20261112T071207Z.log`.

| # | Question | Finding (line in `r2b_isolated.zsh`) |
|---|---|---|
| 1 | How the two readers are launched | L130–131: `( umask 077; rd6 R2B-6a > "$D/r6a" ) & P6A=$!` and the same for `b`. Each runs `security find-generic-password -a r2bacct -s R2B-ITEM -w "$KC"` (L128) |
| 2 | Concurrent? | Yes. Both are backgrounded before `wait $P6A $P6B` (L132). Start times aren't compared, so overlap isn't evidenced |
| 3 | Same item, same keychain? | Yes. Both use `-a r2bacct -s R2B-ITEM` and the same `$KC` |
| 4 | PID tracking | `$!` into `P6A`/`P6B`; used only for cleanup kill (L24). Not recorded in evidence, and not cross-checked against the reader's own PID |
| 5 | Exit-code capture | Inside `rd6` as `rc=$?` and written to `$D/r6a`/`r6b`. `wait $P6A $P6B` discards the per-process status. No cross-check |
| 6 | Secret detection | `[[ -n $R && $R == $V ]]` inside the reader subshell; only `secret_returned=yes/no` is written. Sound |
| 7 | Invalid input | `ask` (validated regex) STOPs on mismatch. **Root cause of the lost evidence:** L134 asked for one combined answer (`^[0-2] [yn]$`, e.g. `2 y`). The owner entered `2`, which STOPped. **The reader results (`$r6`, L133) were only logged on L135, after the prompt**, so the STOP and cleanup deleted `$D/r6a`/`r6b` unlogged |
| 8 | Pending input consumed by later prompts? | `ask` flushes type-ahead (`read -t 0 -k 1`) before each prompt, so stray keystrokes are discarded rather than consumed. The owner's second `2` was entered after the STOP and went to the shell, which is harmless |
| 9 | Interruption and cleanup | `trap cleanup EXIT` plus INT/TERM/HUP. Cleanup kills `P6A`/`P6B` and their children, deletes the keychain, and verifies file, directory, search list and default. Verified in the log (`CLEANUP: VERIFIED`) |
| 10 | Reusable safely? | **Not as-is for this ticket.** It must not be modified in place (preserved evidence), its R2B-6 block depends on R2B-1…5 having run (including an Allow at R2B-2), and the combined prompt is the defect. **A standalone script was written instead** |

**Reconciliation note (earlier run `…071207Z`):**
- That run STOPped at R2B-1 on the answer "a dialog asked for the LOGIN password".
- The next run (`…071432Z`) recorded the same dialog as asking for the **throwaway keychain** password at every step.
- The most likely cause is ambiguous question wording ("your LOGIN password" vs "keychain password"). **UNVERIFIED.**
- The new script asks explicitly: "Mac LOGIN password (not a keychain password)", and requires **no password entry at all**.

**Previously recorded R2B results** (`…071432Z`), not repeated here:
- R2B-1 Deny: `rc=128`, no secret.
- R2B-2 Allow: `rc=0`, secret.
- R2B-3 Deny: `rc=128`.
- R2B-4 bulk dump: `rc=0`, **4 dialogs**, all denied, **no secret**.
- R2B-5 Deny: `rc=128`.
- ACL `applications (0)` after every step.
- Every dialog named `security` and the item, and asked for the throwaway keychain password.
