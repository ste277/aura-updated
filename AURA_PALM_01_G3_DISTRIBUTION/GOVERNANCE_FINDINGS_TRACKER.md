# AURA-PALM-01-G3: Outstanding Governance Findings Tracker

**Status of all findings: OPEN.** Evidence has been found for each, but none is closed: closure needs the product owner's confirmation and a recorded, separately authorized change.
**Unchanged:** PALM-01-G1-PD1 (keep the Palmistry card directly on Explore) stays approved.

## Evidence sources consulted (read-only, 2026-11-11)

| ID | Source | Notes |
|---|---|---|
| E1 | Claude Code session "Palmistry discovery and feasibility audit" (local transcript `b1121d49-…jsonl`), which holds the owner's pasted tickets and the session's reports | Read locally; nothing exported or uploaded |
| E2 | GitHub PR `ste277/aura-updated#338`: metadata and timeline (`gh pr view`, `gh api …/timeline`) | Read-only |
| E3 | Repository code on `origin/main` @ `1741a95` (`packages/palmistry/src/content.ts` comments) | Read-only |
| E4 | Local untracked reports: `AURA_PALM_01_D1_DISCOVERY_REPORT.md`, `AURA_PALM_01_M3_PRODUCTION_RECOVERY.md`, `AURA_PALM_01_P5_REVIEW_HANDOFF.md` | Read-only |

## Correction to the G1 audit

G1 (§1) used the milestone labels from the G1 ticket ("M1 = PR #338", "M2 = Integration"). The original tickets in E1 show a different structure:

| Milestone | Actual ticket title (E1) | Ticket time (UTC) | Recorded outcome |
|---|---|---|---|
| D1 | Palmistry Discovery, Traditional Knowledge Research and Explore Integration | 2026-11-10 05:42 | Report file exists (E4) |
| I1 | Indian Palmistry: Educational Explore MVP (holds **Product Decisions 2.1–2.7**) | 05:57 | PR #338 opened 06:28 |
| P1–P6 | Publication preflight, exclusion, CI and handoff tickets | 06:53–09:56 | Reported in PR #338 body; P5 handoff file (E4) |
| **M1** | Controlled Merge Preflight & Final Technical Verification (read-only; merge **not** authorized) | 10:22 | Per the M2 ticket header: "GO: READY FOR CONTROLLED MERGE AUTHORIZATION". **No report file.** |
| **M2** | **Controlled Merge & Production Verification** (merge **authorized**) | 10:47 | Session report at 11:07: **"POST-MERGE BLOCKED"**. The merge succeeded and content stayed unpublished, but the automatic Production deployment failed (database unreachable). **No report file.** |
| M3 | Production Database Connectivity Recovery & Controlled Redeployment | 11:14 | Report file exists (E4): "DEPLOYED AND VERIFIED, CONTENT UNPUBLISHED" |

As a result, two G1 findings were stated too strongly: G1-P2-02 said "no decision record" and G1-P2-03 said "merge authorization not recorded". The records **exist in the owner's tickets (E1)**, but **not in the repository or on GitHub**. The traceability gap remains, and that is what the proposals below address. An erratum has been appended to `AURA_PALM_01_G1_GOVERNANCE_REPORT.md`.

---

## GF-1 (G1-P2-02): MVP scope decisions not recorded in the repository

| Field | Detail |
|---|---|
| Finding | The code cites "product decision 2.1 / 2.2 / 2.3 / 2.4 / 2.7" (E3), but no decision record exists in the repository |
| Evidence found | The I1 ticket (E1, 2026-11-10T05:57:37Z) contains "2. Product Decisions. The following decisions are approved for the implementation baseline": **2.1 Tradition** (Indian-first), **2.2 Longevity** (explain *āyurlekhā*; no lifespan estimates), **2.3 Hand-selection conventions** (history only; no gender inference), **2.4 Expert review** (qualified human review required before public launch), **2.5 Launch gating** (feature branch; no Production exposure; merge "not authorized" at I1 time, **later superseded by the M2 authorization**), **2.6 Analytics** (minimal non-sensitive events), **2.7 Licensing** (original paraphrase; attribution). These answer the 7 open decisions listed in D1 §I. |
| Gap | The decisions live only in a chat transcript, which is not version-controlled and not visible to reviewers or future maintainers |
| Reconciliation proposal | (1) The product owner confirms that the I1 §2 text is the authoritative MVP decision set. (2) Create `docs/palmistry/AURA_PALM_01_PRODUCT_DECISIONS.md` that transcribes 2.1–2.7 **verbatim**, cites E1 with its timestamp, notes that 2.5 was superseded by M2, and is dated as **transcribed on its creation date (not backdated)**. (3) Commit it only under a separately authorized docs change (commits and PRs are not authorized under G3, and the merge freeze is active). |
| Status | **OPEN: evidence found, awaiting owner confirmation** |
| Closure criteria | Owner confirmation recorded, and the decision record committed under an authorized change |

## GF-2 (G1-P2-03): PR #338 merge authorization record

| Field | Detail |
|---|---|
| Finding | PR #338 was merged while its description said "Draft. Do not merge", with no GitHub review recorded |
| Evidence found | **M1 ticket** (E1, 10:22:21Z): read-only preflight; merge explicitly not authorized. **M2 ticket** (E1, 10:47:51Z): authorized "Mandatory manual merge checks, normal GitHub merge, automatic deployment observation, post-merge verification and independent review", against reviewed head `0c8d0d65…`; publication, content approval and licensing sign-off **not** authorized. **GitHub timeline** (E2): `ready_for_review` at 11:00:12Z, then `merged` at 11:00:15Z, both by the repository owner's account; merge commit `afbe5204`. **M2 session report** (E1, 11:07Z): normal merge locked to `0c8d0d6`, all pre-merge gates passed, failures limited to known issue #323. |
| Gap | The authorization exists in the owner's ticket, but GitHub shows only the act of merging. The PR description still says "Do not merge", which was accurate when written (I1/P stages) but now contradicts the record. There is no GitHub review, because the review gates ran as tickets and AI reviews. |
| Reconciliation proposal | (1) The product owner confirms that the M2 ticket was their authorization. (2) Add an entry to the decision record proposed in GF-1 (or a separate `AURA_PALM_01_M1_M2_MERGE_RECORD.md`) quoting the M2 authorization scope and the GitHub timeline. (3) Optionally, under **separate authorization** because it is an outward-facing GitHub action, post a PR comment pointing to that record. Do **not** edit history or add a retrospective "approval" review. |
| Status | **OPEN: evidence found, awaiting owner confirmation** |
| Closure criteria | Owner confirmation, and the record committed under an authorized change |

## GF-3: M2 milestone record missing

| Field | Detail |
|---|---|
| Finding | No M2 report file exists. (G1 had wrongly treated M2 as "Integration"; see the correction above.) |
| Evidence found | The M2 ticket and its session report (E1, 11:07Z): **"AURA-PALM-01-M2: POST-MERGE BLOCKED"**. Pre-merge gates passed; merge `afbe520` done; Palmistry not visible in Production; approval file unchanged; the automatic Production deployment failed on database reachability before the build. M3 then recovered and verified Production (E4). M1 also has no report file. |
| Gap | The M1 and M2 outcomes exist only in the transcript |
| Reconciliation proposal | Create `AURA_PALM_01_M1_M2_MERGE_RECORD.md` that summarises M1 (GO, ready for merge authorization) and M2 (merge done; POST-MERGE BLOCKED; resolved by M3), each citing E1 timestamps and the GitHub evidence. Infrastructure identifiers that need not be shared should be redacted. Commit under a separately authorized docs change. |
| Status | **OPEN: evidence found, awaiting owner confirmation** |
| Closure criteria | Owner confirmation, and the record committed under an authorized change |

## Related (tracked, not in G3 scope)

| ID | Item | Status |
|---|---|---|
| GF-4 (G1-P2-05) | D1, M3, P5, G1, G2 and G3 reports are untracked local files | OPEN: needs an owner decision on where to version them (a docs commit needs separate authorization) |
| G1-P2-04 | `main` CI persistently red (Day Constructor DB tests, issue #323) | OPEN, unrelated to Palmistry |
| PD1 | Explore placement | **APPROVED, unchanged** |

## Update 2026-11-11 (ticket G3-PDF-v1.1)

- The evidence was re-verified against the transcript and GitHub: I1 decisions at 05:57:37Z; M2 authorization at 10:47:51Z; M2 outcome "POST-MERGE BLOCKED" reported at 11:07:08Z; M3 ticket at 11:14:30Z; PR #338 `ready_for_review` at 11:00:12Z and `merged` at 11:00:15Z, with 0 reviews and only a bot comment.
- The PDF's Section 12 was corrected in v1.1 to match.
- **Proposed documentation corrections** (drafts for a separately authorized reconciliation, not committed): `proposed_governance/PROPOSED_AURA_PALM_01_PRODUCT_DECISIONS.md` (GF-1) and `proposed_governance/PROPOSED_AURA_PALM_01_M1_M2_MERGE_RECORD.md` (GF-2, GF-3).
- **GF-1, GF-2 and GF-3 all remain OPEN.**
