# CLEAN01-03: Managed-Device Feasibility

## Facts (read-only; sources given)
| Fact | Source |
|---|---|
| **The Mac is MDM-enrolled:** `Enrolled via DEP: No`, `MDM enrollment: Yes (User Approved)`, MDM server `https://usmdm.superops.ai/…` (tenant path redacted) | `/usr/bin/profiles status -type enrollment`, run by this ticket (rc 0); redacted output in `evidence/clean01_mdm_enrollment_redacted.txt` |
| SuperOps RMM components run persistently: a root daemon (`com.superopsrmm.rmm`, KeepAlive, RunAtLoad), a user tray agent and update managers | FIX01 survey (`AURA_GOV_02_RE4_FIX01/evidence/fix01_survey.log` S-5…S-7) |
| Binary `/Library/superopsrmm/bin/superops`, Developer ID **Superops Inc. (4SPX8Y4YUX)**, root-owned | FIX01 survey S-6 |
| `superops` **is** in the v2 denylist (`DENYT`), and R2D-02 T1-6(b) names SuperOps as a refusal condition | v2 harness line 182; `R2D_02_TIER1_CONTROL_SPEC.md` line 12 |
| The real scans returned DETECTED with `superops` matched in both `comm` and `ucomm` | RE-4, FIX01-05, RERUN-01 |

**"User Approved" without DEP** means a person approved the enrollment on this Mac. It does **not** tell us whether the device is organization-owned or personally owned, or what policy governs it.

**Unknown, and not determinable read-only without contacting the administrator (prohibited):**
- who administers the SuperOps tenant;
- whether the enrollment is an organizational requirement;
- whether unattended remote sessions are possible;
- whether a VM or a second test host is permitted;
- whether any approved test environment exists.

## Assessment
1. **Managed-device restrictions apply.** *Inference* (from a root-owned, KeepAlive RMM daemon plus MDM enrollment; not verified with the administrator): the MDM/RMM operator can probably act on this Mac with root-level capability. The local owner's admin rights **do not** amount to organizational authorization.
2. **A genuine scanner CLEAN is not achievable on this Mac under current restrictions without action by the administrator.** This conclusion does **not** depend on the MDM fact: the FIX01 survey alone shows the root `superops` daemon with KeepAlive and RunAtLoad. A CLEAN would require one of:
   - **(i)** the user stopping or unloading it, which is **prohibited** interference with managed software;
   - **(ii)** removing `superops` from the denylist, which **weakens a written control** and would also "pass" a host with an active RMM channel;
   - **(iii) Option A′:** the **administrator** legitimately unenrolling the Mac or removing or pausing the RMM agent. That is not circumvention, but it requires the administrator's decision and organizational authorization, and it changes a managed device's state.

   (i) and (ii) are unacceptable. (iii) is **not proposed** by this ticket, which may not contact the administrator, and is **not recommended** as a way to run a test. It remains a decision only the administrator can take. **Removing SuperOps from the denylist to obtain CLEAN is not proposed.**
3. **Wider implication.** Under the current spec, the Keychain prototype (Tier 2) can **never** pass T1-6 on this Mac while it is enrolled. That is the control working as designed, not a defect.
4. **An isolated environment could give equivalent *code-path* evidence**: real `/bin/ps`, real CLEAN. It gives no evidence about *this* host. See CLEAN01-06.
