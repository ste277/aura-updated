# REV01-06: Proposed T1-6 Amendment — "Authorized Managed-Device Mode" (DRAFT ONLY)

> **Status: DRAFT. NOT EFFECTIVE.**
> - It does not edit R2D-02, which stays authoritative and unchanged (`c11a4c39…`).
> - It does **not** remove SuperOps from the denylist.
> - It does not change the v2 harness or any v3 candidate.
> - It takes effect only with the approvals in §12 **and** a separately authorized implementation ticket that comes after V3-01.
>
> Revised after independent review (REV01-09: TR-1…TR-13).

## 1. Scope
- **Adds** an opt-in eligibility mode to T1-6, for one named, managed Mac.
- **Unchanged:** the default behaviour (refuse on any listed process), every other T1 control, and R2D-08 §B.

## 2. Managed-device eligibility (all required)
1. **Device and agent inventory (TR-6).** The approval record identifies the device by a **hash of its hardware serial**. The serial itself is never stored in repository evidence (TR-8). The record also contains a **complete inventory, signed by the administrator, of every managed, monitoring and remote agent** on the device: SuperOps components, any other endpoint agent such as "Scrut" (named in R2C T6), MDM.
   - **Any running agent outside that inventory gives UNKNOWN and STOP**, whether or not it is denylisted.
   - Only inventoried agents that also pass identity binding (§3) can be allowed.
2. **Administrator attestation** (written, dated, from the tenant administrator; **obtained by the owner**, since this workstream does not contact the administrator) covering:
   - (a) testing on this device is permitted;
   - (b) the RMM's remote-session capabilities, and how a session is indicated to the local user;
   - (c) **for each stated run window (start and end time, in hours)**, that no remote session, remote script or policy push will be started (TR-4);
   - (d) the scope of telemetry and log collection;
   - (e) how the attestation was issued and delivered (provenance, TR-5).
3. **Owner and security owner** have both signed the record, and accepted residuals R-M1 to R-M6 (§10).
4. **Validity.** The record expires after **at most 7 days**, but **each run must start and end inside an attested run window** (TR-4).

## 3. Allowed vs prohibited conditions, and identity binding
| Allowed: kept running, never modified or signalled | Prohibited during a run: STOP |
|---|---|
| Inventoried SuperOps RMM components and MDM, operating normally | Any active or scheduled remote session, remote shell or script, policy push |
| — | Any other denylisted process (Claude, Codex, ChatGPT, other remote-support tools, `osascript`, …) |
| — | Any agent not in the inventory (§2.1) |
| — | Any `superops`-named process that fails identity binding |
| — | Any Accessibility toggle ON; Sharing services ON (T1-6(a) unchanged) |

**Identity binding (TR-1, TR-2).** A name match is never sufficient.
- **Not identity evidence:** `comm` (argv[0], caller-set), `ppid=1` (reachable by double-fork) and `ucomm` (taken from the executed file's name, so a copy or symlink named `superops` controls it). These are **consistency checks only**.

| Agent | Identity evidence | Consistency checks | Limits |
|---|---|---|---|
| **Root daemon** | **`user=root`.** A non-root process cannot satisfy it, which defeats user-level spoofs. Plus the static checks: the file `/Library/superopsrmm/bin/superops` is a regular, root-owned, non-writable Mach-O; `codesign --verify --strict` passes with **Team ID `4SPX8Y4YUX`**; LaunchDaemon `com.superopsrmm.rmm` has `ProgramArguments[0]` equal to that path; exactly the inventoried instance count | `ppid=1`, `ucomm=superops`, `comm` equal to the path | The *process* can't be bound to the *file* without root. A root-level spoof is already within R2C T6 (R-M2). |
| **User tray agent** | **`lsof txt` path = `/Library/superopsrmm/bin/superops`** (readable for the same uid) **and** the same signature/Team ID checks; LaunchAgent `com.superopsrmm.systemtray` with `ProgramArguments[0]` equal to that path; **exactly one** instance for the owner's uid | `user=<owner>`, `ppid=1`, `ucomm`, `comm` | A user who launches the genuine signed binary themselves with arbitrary arguments is indistinguishable (R-M2b) |

Any deviation, or any check that cannot be performed, gives **UNKNOWN** and STOP.

## 4. Scanner outcomes
| Outcome | When | Action |
|---|---|---|
| `CLEAN` | **Only when managed mode is NOT active:** both reads validated, no denylisted name | Continue to attestations |
| `MANAGED-AUTHORIZED` (new) | Managed mode active; both reads validated; **every** hit is an inventoried, identity-bound allowed agent; **the inventoried agents are all present**; no other hit; approval record valid and inside the run window | Continue to the attestations plus the managed-device attestations (§5). **Never reported, logged or treated as CLEAN.** |
| `DETECTED` | Any other denylisted hit | STOP |
| `UNKNOWN` | Any read, validation, identity, inventory or approval check fails or can't be performed. **Also: managed mode active but the expected agents are absent or changed (TR-3)**, so a managed run can never produce CLEAN. | STOP |

## 5. Mandatory attestations (in addition to R2D-08 §B and T1-6(a)/(c))
- **Owner, at run time, for this run window:**
  - "No SuperOps remote session is active or expected."
  - "The administrator attestation covers this run window."
  - "I accept residuals R-M1 to R-M6."
- Repeated at L10. **Crossing into a new run window means STOP**: there is no in-run re-attestation, because §8 requires the same window.

## 6. Activation (no implicit activation)
- **Default:** off.
- **Activation requires all of:**
  - (a) the bootstrap argument `--managed-device=<SHA-256 of the approval record>`;
  - (b) the record at a fixed path, **owned by the owner, mode 0600 in a 0700 directory, not writable by others** (TR-13);
  - (c) its hash equal to (a);
  - (d) the owner typing a confirmation phrase that **echoes the record hash prefix and its expiry and run window** (TR-13).
- `R2D_*` environment variables cannot activate it (already refused in REAL mode, harness line 21).
- Mock mode can never satisfy a REAL approval.

## 7. Fail-closed and no-interference behaviour
- Everything in v2 and V3-01 is unchanged.
- **Additionally UNKNOWN:**
  - a missing, expired, out-of-window or mismatched record;
  - an identity or inventory failure;
  - a change in the allowed-agent PID set between scans;
  - expected agents absent.
- **The harness never sends any signal to an allowed-agent PID, or to any PID it did not start (TR-7).** The **V3-01 no-signal timeout is a hard prerequisite** for this mode.

## 8. Protected-operation boundaries
- A **fresh scan** (V3-01) runs immediately before each of: keychain create, every unlock, L7, L8, L9 and L10.
- The outcome must equal the start-of-run outcome, with the same allowed-agent PIDs, inside the same attested window. Otherwise STOP.

## 9. Evidence and audit
- **Log:**
  - the eligibility outcome;
  - the approval-record **hash**;
  - per-read counts and statuses (V3-01);
  - for each allowed agent: PID, user, path, signature/Team ID result, LaunchDaemon/LaunchAgent check.
- **Never logged:** arguments, secrets, the MDM tenant path, the hardware serial.
- The approval record is kept **outside the repository** and referenced by hash (TR-8). The run log is hash-pinned in the evidence manifest. An independent review follows each run.

## 10. Residual risks (to be accepted in writing)
| ID | Residual |
|---|---|
| R-M1 | The remote operator's capabilities rest on the administrator attestation and cannot be verified technically (T4-like) |
| R-M2 | Root daemon identity is not process-to-file bound; a root-level spoof is within R2C T6 |
| R-M2b | A user-launched genuine signed tray binary (arbitrary arguments) is indistinguishable from the real agent |
| R-M3 | Telemetry scope rests on the attestation |
| R-M4 | Name-based detection limits for all other tools (FX-1) |
| R-M5 | TOCTOU between scans (FX-5, reduced by §8) |
| R-M6 | **The attestation's authenticity and provenance cannot be verified by the harness.** A hash pins its contents, not its author (TR-5). |

## 11. Revocation (any one revokes the mode)
- The administrator withdraws the attestation, it expires, or a run falls outside an attested window.
- The agent path, Team ID, signature or inventory changes.
- Any un-inventoried agent appears.
- MDM enrollment or profile changes.
- Any remote session is observed.
- The security owner or the owner revokes it.
- Any P0/P1 finding in a review.

## 12. Approval and effective-date fields (blank: not approved)
| Role | Name | Decision | Date | Record |
|---|---|---|---|---|
| Owner | | ☐ approve ☐ reject | | |
| Security owner (REV01-07) | **UNRESOLVED** | ☐ approve ☐ reject | | |
| SuperOps tenant administrator (attestation §2.2, inventory §2.1) | | ☐ provided | | |
| Independent review of the final amendment text | | ☐ done | | |
| **Effective date** | | | | |
