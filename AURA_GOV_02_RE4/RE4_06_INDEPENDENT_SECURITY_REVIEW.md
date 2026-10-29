# RE4-06: Independent Security Review

**Reviewer:** a fresh-context review agent, static and read-only. It ran no probe, `ps`, `pgrep` or signal.

**What it verified itself:**
- The harness hash.
- The extracted `is_wd` (lines 95–98) and T1-6 (lines 177–181) are **byte-identical** to the harness.
- `PSB=/bin/ps` on every real-path check.
- No `security` invocation anywhere.
- Exactly one harmless dummy in the evidence run.

| ID | Sev | Finding | Status |
|---|---|---|---|
| RV4-1 | **P1** | T1-6 fails **open** when `ps` fails or is empty (rc and stderr discarded; empty means clean) | **OPEN.** Source fix proposed (RE4-04 #1). Not implemented under RE-4. |
| RV4-2 | **P2** | `comm=` is argv[0], so the name scan can be evaded by renaming | **OPEN.** Fix proposed (`ucomm=`, plus RC-20 wording) |
| RV4-3 | **P2** | RE-4's minimum closure is unmet: no clean leg (Claude, ChatGPT for Chrome and superops are running); raw table not retained | **OPEN.** Needs owner action outside this session |
| RV4-4 | **P2** | The probe's rejection checks can pass vacuously if the dummy dies, as seen in attempt 2 | **OPEN** (probe design). Attempt 3 is supported by live bracketing controls. |
| RV4-5 | **P2** | Provenance: the probe hash is not logged in-run; criteria changed between attempts; attempt 1 is unevidenced and its probe version not preserved; attempt 2 copied a binary | **PARTLY ADDRESSED** by disclosure (RE4-01, RE4-03) and by recording the probe hash in RE4-01. Attempt-1 evidence cannot be recovered. |
| RV4-6 | P3 | Observer harness-identity check (line 146) not exercised against real `ps` | Open; fails closed |
| RV4-7 | P3 | Separate snapshots between the identity check and the signal; teardown `pkill -P` has no identity check | Open; fix proposed |
| RV4-8 | P3 | Some negated checks would also pass on a tool error (`pgrep` rc 2/3, broken `ps`) | Open (probe) |
| RV4-9 | P3 | Username and session UUID in the dummy path; software names | Accepted |
| RV4-10 | P3 | Over-broad prefix matching, unescaped `.`, grandchildren not excluded | Fail-safe; hygiene fix proposed |

**Per-group verdicts:**
| Group | Verdict |
|---|---|
| RE4-01 | PASS |
| RE4-02 / RE4-03 | PASS (attempt 3 only) |
| RE4-04 | PASS (synthetic logic; incomplete without failed-`ps` input) |
| RE4-05 | CONDITIONAL |
| RE4-06 | PASS |
| RE4-07 | PASS |
| B, C, F | PASS |

**Reviewer's overall recommendation: INCONCLUSIVE.** The real observations are genuine. PASS is blocked by the open P1 (RV4-1), the P2s and the missing clean leg. No source issue is marked fixed.
