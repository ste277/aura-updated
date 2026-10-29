# AURA-PALM-01-G4-B2B — Owner Decision Matrix (Task F)

**No approvals are inferred. As of 2026-11-11, no item is APPROVED.** Decision definitions are taken verbatim in substance from `AURA_PALM_01_G4_B2_OWNER_DECISION_REGISTER.md` and `AURA_PALM_01_G4_B1_OWNER_APPROVAL_CHECKLIST.md`. Engineering readiness is **not** a legal determination. **Legal review requirements remain unresolved.**

Status values: APPROVED / REJECTED / AWAITING_OWNER / LEGAL_REVIEW_REQUIRED. "Engineering readiness" says only whether the technical side is prepared.

## 1. Label reconciliation
The ticket's shorthand differs from the register for two items. The **register definitions govern**:

| ID | Ticket label | Register definition (governing) |
|---|---|---|
| A-04 | "Encrypted storage … verification" (grouped with A-03) | **Backup policy and Time Machine exclusion.** Storage *verification* is tracked here as ST-OWNER-1/2 under A-03. |
| A-08 | "External encrypted-volume harness acceptance" | **Approve research-tool changes before annotation** (uncertain/unsuitable fields; skin tone transcribed from consent only) **plus** the harness/manifest data-path changes. B2A and B2B code changes fall under this item. |

## 2. Matrix
| # | Decision (register) | Status | Engineering readiness after B2B | What the owner must do | Blocks collection? |
|---|---|---|---|---|---|
| A-01 | Approve consent form text; fill every [OWNER] field (entity, contact, access list, retention, withdrawal period, publication scope) | **LEGAL_REVIEW_REQUIRED** (entity, formalities) + AWAITING_OWNER (fields) | Draft exists (B1); not approved | Fill fields; assign version; obtain review | Yes (P-2) |
| A-02 | Qualified privacy/legal review (biometric status, consent formalities, DPIA/ethics) **or** documented risk acceptance | **LEGAL_REVIEW_REQUIRED** | n/a (not an engineering matter) | Commission review or sign a written risk acceptance | Yes (P-1) |
| A-03 | Storage location and two encrypted images (or paper consent) | AWAITING_OWNER | **Ready.** Setup guide complete; guard negative cases verified on real disposable images; positive case simulated only. ST-OWNER-1/2 **BLOCKED — AWAITING_OWNER_STORAGE** | Approve; run Setup Guide §0–9; record ST-OWNER-1 (`OK VERIFIED-ENCRYPTED`) and ST-OWNER-2 | Yes (P-3) |
| A-04 | Backup policy; Time Machine exclusion | AWAITING_OWNER | Commands prepared (Setup Guide §11) | Choose none / one encrypted offline copy; decide exclusion | Yes (P-3) |
| A-05 | Metadata stripping tool | AWAITING_OWNER | **Ready:** ImageMagick + `verify_clean.sh` (installed; nothing new). 24/24 metadata and 39/39 orientation tests pass | Approve tool; run the P-4 synthetic dry run on the real volume (Setup Guide §7). **Proposed addendum (new):** confirm **JPEG-only intake** for the first dataset (code default), or explicitly approve `--allow-heic` for iPhone HEIC | Yes (P-4) |
| A-06 | Code-to-person key | AWAITING_OWNER (⚖ confirm acceptability) | CONSENT volume `keymap/` is optional in the setup guide | Decide key / no key; legal confirmation | Yes (P-8) |
| A-07 | Skin-tone self-report and C7 handling | **LEGAL_REVIEW_REQUIRED** + AWAITING_OWNER | Schema supports self-report only (no inference); frozen criteria unchanged (SHA `bcc8f204…43a9`) | Keep or drop; choose C7 option (a) or (b) before results | Yes (P-8) |
| A-08 | Research-tool changes (annotation fields) + harness data-path changes | AWAITING_OWNER | **Implemented and tested (synthetic)** in B2A + B2B. All untracked, uncommitted. B2B adds: mount-point check, JPEG-only default, HEIC fail-closed, temp confinement, guarded image loading in `annotate.html`, hardened hook installer | Review and approve the change set | Yes (P-5) |
| A-09 | Treat "uncertain" creases as MINOR (criteria change-log entry, pre-results) | AWAITING_OWNER | Reports flag uncertain/unsuitable counts as **pending**; scoring unchanged | Approve or reject **before any results** | Yes (P-8) |
| A-10 | Local pre-commit hook | AWAITING_OWNER | **Ready:** installer and uninstaller hardened; 31/31 + 10/10 tests; not installed | Approve; optionally install (Git Protection Readiness §3) and run ST-OWNER-3 | Yes (P-8) |
| A-11 | Confirm FileVault; no cloud sync of `~/AuraResearch`; phone cloud photo sync off (or dedicated phone) | AWAITING_OWNER (phones) | FileVault **On** and no cloud clients (B2 evidence). Phone settings **unverified** | Confirm phone settings for every capture device | Yes (P-6) |
| A-12 | Acknowledge AI-access safeguards S-1 to S-8 | AWAITING_OWNER (acknowledgment pending) | Code compliant. B2B browser tests used **synthetic images only**; the same AI-driven procedure is prohibited for real data | Sign the acknowledgment | Yes (P-7) |
| A-13 | Name recruiter, annotators (A1/A2) and access list | AWAITING_OWNER | n/a | Name roles (not in shared docs) | Yes (P-8) |
| A-14 | Dates: collection window, annotation, evaluation, retention end | AWAITING_OWNER | n/a | Set dates | Yes (P-8) |

## 3. Pre-collection checklist (Collection Authorization §5)
| # | Requirement | Status |
|---|---|---|
| P-1 | A-02 legal review, or written owner risk acceptance | ☐ Open, LEGAL_REVIEW_REQUIRED |
| P-2 | A-01 consent form approved, fields filled, version assigned | ☐ Open |
| P-3 | A-03/A-04 storage created by the owner; permissions and Spotlight off verified | ☐ Open. Guide ready; ST-OWNER-1/2 BLOCKED — AWAITING_OWNER_STORAGE |
| P-4 | A-05 tool confirmed; synthetic dry run in the volume prints CLEAN | ☐ Open. Procedure ready (Setup Guide §7) |
| P-5 | A-08 research-code changes made and verified | ◐ **Made and verified on synthetic data**; awaiting owner approval and the real-volume run |
| P-6 | A-11 phone cloud photo sync off confirmed | ☐ Open |
| P-7 | A-12 safeguards acknowledged | ☐ Open |
| P-8 | A-06, A-07, A-09, A-10, A-13, A-14 decided | ☐ Open |
| §6 | Privacy risk acceptance R-01 to R-15 and unresolved legal questions | ☐ Open |
| §7 | Owner authorization of G4-B3 collection | ☐ **Not granted** |

## 4. Owner-only verification rows
| ID | Test | Status |
|---|---|---|
| ST-OWNER-1 | `node scripts/check-dataset-root.mjs /Volumes/PALM_G4B_DATA` → `OK VERIFIED-ENCRYPTED` | BLOCKED — AWAITING_OWNER_STORAGE |
| ST-OWNER-2 | Server on the real volume reports `verified encrypted volume`; `/eval` header `verified-encrypted` | BLOCKED — AWAITING_OWNER_STORAGE |
| ST-OWNER-3 | Hook installed by the owner; a synthetic blocked commit refused in the real worktree | AWAITING_OWNER (optional; A-10) |

## 5. Unresolved legal questions (unchanged; not answered by engineering)
1. Jurisdictions, and whether palm photos or landmarks are biometric or special-category data.
2. Consent formalities; DPIA or ethics review.
3. Controller identity and data-protection contact.
4. Lawfulness of the retention and withdrawal periods, including backups.
5. Status of the skin-tone self-report.
6. Whether withdrawal by code without a key is acceptable.
