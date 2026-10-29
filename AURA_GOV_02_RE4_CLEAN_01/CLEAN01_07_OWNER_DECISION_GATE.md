# CLEAN01-07: Owner Decision Gate

## Classification: **CONDITIONAL**
A potentially acceptable approach exists: **Option B**, a separately authorized isolated environment, after a v3 instrumentation ticket. Its authorization prerequisites are unresolved. Option A is **not currently feasible**. Even a later FEASIBLE classification would not authorize execution.

## Decisions required before any future live CLEAN test
**Owner:**
1. **SuperOps stance.** Confirm that, under R2D-02 T1-6(b), an MDM/RMM-enrolled host is **disqualified** for the Keychain prototype; this is the recommended reading. The only alternative is a formal, documented exception, approved by the owner **and** the security owner, with an administrator statement about RMM remote-session controls. An exception is **not recommended**, because it weakens a written control. *The owner must name who holds the "security owner" role (it is not named in the R2D documents). Any administrator input needed for this decision is for the owner to obtain; this workstream does not contact the administrator.*
2. **Requirement scope.** Decide whether scanner CLEAN plus attestations is sufficient, or whether environment assurance is also required (CLEAN01-02, UNRESOLVED).
3. **Authorize a v3 ticket** (code and mock tests only):
   - RR-2 per-read row-count and exit-status logging on every outcome;
   - FX-3 job-table-gated or no-signal timeout;
   - FX-4 file-less or private-directory read;
   - FX-5 re-scan before every create or unlock;
   - optional FX-1 Team-ID / executable-path checks.

   Then re-pin and run the full mock suite.
4. **Choose the host for a real CLEAN:**
   - (i) a dedicated unmanaged Mac;
   - (ii) a macOS VM;
   - (iii) defer (Option D).

   Approve its written description (OS version, absence of MDM/RMM, how prohibited apps are absent).
5. **Decide where any future Tier 2 Keychain run would take place**, given that the managed Mac is blocked.

**Any Option B run** still needs, in addition: a separate execution ticket; **R2D-08 §B** execution authorization and attestations; an owner-run session with no Claude, Codex or ChatGPT running on that host; and the stop at the first attestation (CLEAN01-04 FX-7).

**Administrator (whoever runs the SuperOps tenant), only if the chosen route involves this Mac or a company device:**
- Whether a VM on this Mac, or a second test device, is permitted.
- Whether an approved test environment exists.
- What remote-session capability the RMM has (for decision 1 or 2).

*This ticket did not contact the administrator, and an AI review is not administrator or human authorization.*

**Still on HOLD:** the clean-host leg, all Keychain-dependent operations, R-1, B4, B5, B6 and Tier 2.
