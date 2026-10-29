# REV01-05: Eligibility Options

| | **A. Preserve the prohibition** | **B. Explicit authorized managed-device mode** | **C. Separate test environment** |
|---|---|---|---|
| **Security benefit** | Strongest and simplest. No allowance logic to spoof; the current spec is unchanged. | Bounded: identity-bound allowance of the specific managed agent only; every other refusal kept; fail-closed. **Not equivalent to CLEAN.** | Strong code-path evidence with no managed agent present. The spec is unchanged. |
| **What it gives up** | This Mac can never run the protected prototype | Accepts the remote-operator (T4-like) and privileged (T6) residuals by **human decision** | Results describe the separate host, not this Mac |
| **Authorization** | None new | Formal R2D-02 amendment approved by owner **and** security owner; **administrator attestations** (REV01-06 §2); explicit risk acceptance; independent review; implementation ticket | Owner, plus administrator or policy if company devices or VMs on this Mac are involved |
| **Technical prerequisites** | — | V3-01 (structural logging, no-signal timeout, file-less read, re-scans), **plus** a separately authorized managed-mode implementation (identity binding, distinct outcome, explicit activation) | V3-01; a host description; no AI tools on the host |
| **Roadmap effect** | Tier 2 on this Mac is permanently blocked; it needs C, or a different personal Mac | Tier 2 on this Mac becomes **possible** after spec, administrator and implementation gates | Tier 2 is possible on the separate host |
| **Residual risk** | None new | Unknown RMM capabilities; the evidence of the administrator attestation; identity-binding limits for root processes | Host-representativeness |

## Recommendation
- **Option C is preferred for evidence quality.**
- **Option B is supportable only as a documented risk acceptance, not as security equivalence.** The amendment drafted in REV01-06 is the minimum safe form.
- If the security owner cannot be named, or the administrator attestations cannot be obtained, **retain Option A**, and use C for testing.

The options are not ranked by which one "passes".
