# REV01-07: Security Owner and Approvals

**Existing definition:** none. A search of R2C, R2D, R2E, RE-4, FIX01, RERUN-01 and CLEAN-01 for "security owner" finds the role only in CLEAN-01's own recommendations. It is **undefined** in the authoritative documents.

## Proposed role: Security Owner (AURA-GOV-02)
| Responsibility | Detail |
|---|---|
| Risk acceptance | Formally accepts or rejects residual risks (for example R-M1 to R-M5, RC-18, RC-20) and any spec exception |
| Specification authority | Co-approves amendments to Tier 1 controls (T1-1…T1-9) with the owner |
| Gate decisions | Co-signs execution gates that touch real Keychains |
| Revocation | Can revoke any exception or mode at any time |
| Independence | Must not be the person who performs the run being approved. Does **not** perform technical reviews of their own decisions. |

**Required approval authority.** Authority to accept security risk for this device and its data under whatever organizational policy applies. That policy is **UNKNOWN** for a managed device.

**Separation of duties:**
- **Technical review** (independent AI or human review) assesses correctness and residuals, and **cannot accept risk or authorize**.
- **Risk acceptance** belongs to the security owner (plus the owner).
- **Operational authorization** is the owner's, plus the administrator's attestation for managed devices.

**Role holder: UNRESOLVED.**
- The project owner is **not** appointed automatically; their testing-authority statement (REV01-02) is relevant but does not fill this role.
- An AI reviewer **cannot** hold it.

**Appointing authority: UNRESOLVED.** Organizational policy for a managed device is **UNKNOWN**; the appointing authority may be organizational, not the project owner. **The owner, who performs the runs, cannot hold the role** (independence rule above).

**Decision field:** Security owner = ________ ; appointing authority = ________ ; date ________.
