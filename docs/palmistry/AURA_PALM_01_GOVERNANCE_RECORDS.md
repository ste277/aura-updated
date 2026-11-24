# Aura Palmistry (content-only guide): Governance Records

**Compiled 2026-11-24** by Claude (AI) for the Product Owner, in PR #385. This file transcribes earlier records. It is **not backdated**, and it creates no approval that was not given at the time. "Owner confirmation" fields left blank mean the owner has not yet confirmed that a transcription is authoritative.

## 1. Status summary

| # | Record | Status | Where |
|---|---|---|---|
| R1 | Licensing counsel waiver (Product Owner licensing risk acceptance) | **APPROVED 2026-11-24** | `AURA-PALM-01-G3-C-WAIVER.md` §4 (commit `4a1b9c9`) |
| R2 | AI account used on 2026-11-10: individual Claude Max subscription (Anthropic Consumer Terms) | **CONFIRMED BY OWNER 2026-11-24** | G3-C waiver §4 and §5 |
| R3 | Scholarly review waiver | **PROPOSED, NOT APPROVED** | `AURA-PALM-01-G3-SCHOLAR-WAIVER.md` §5 |
| R4 | Product Owner editorial and cultural review of the final content | **NOT DONE** (pending owner) | `AURA_PALM_01_G3_FINAL_CONTENT_REVIEW.md` §G |
| R5 | MVP product decisions 2.1–2.7 (GF-1) | **Historical decision, transcribed below.** Owner confirmation of the transcription: pending | §2 |
| R6 | PR #338 merge authorisation (GF-2) and M1/M2 milestone record (GF-3) | **Historical authorisation, transcribed below.** Owner confirmation of the transcription: pending | §3 |
| R7 | HR2 item M amendment: separate merge, staging and public-release gates | **RECORDED 2026-11-23** (owner's words) | `AURA_PALM_HR2_OWNER_DECISIONS.md`, "Item M amendment (C21)"; summary in §4 |
| R8 | HR2 applicability to the content-only guide | **PROPOSED, NOT DECIDED** | §4 |
| R9 | Publication authorisation (public-release gate) | **NOT GIVEN** | — |
| R10 | `review-status.json` | `PENDING_HUMAN_REVIEW`, `approvedBy: null` (unchanged) | `packages/palmistry/src/review-status.json` |

**Changes to the G3 v1.1 publication sequence (PDF §12):**
- Step 3 (licensing reviewer): replaced by R1.
- Step 2 (scholarly sign-off): would be replaced by R3 + R4 **if** R3 is approved.
- Step 1 (governance records): this file, pending the owner's confirmation of the R5 and R6 transcriptions.
- Steps 4–6 (re-confirm corrections, record the approval in a reviewed change, separate publication authorisation): unchanged.

## 2. MVP product decisions 2.1–2.7 (GF-1)

| Field | Value |
|---|---|
| Issued | 2026-11-10, about 05:57 UTC, as §2 of the owner's ticket AURA-PALM-01-I1 |
| Evidence | The I1 ticket as preserved in the Claude Code session "Palmistry discovery and feasibility audit" (local transcript, message 2026-11-10T05:57:37Z). The 2026-11-10 transcripts are also held in the encrypted evidence image (sha256 `038dc178…`, G3-C waiver §5) |
| Owner confirmation that this transcription is authoritative | *(blank: pending)* |

**Verbatim decision text (I1 ticket §2):**

```text
2. Product Decisions
The following decisions are approved for the implementation baseline.
2.1 Tradition
Indian-first.
Use classical Indian palmistry as the primary framework.
Do not simply translate Western palmistry labels into Sanskrit.
Western comparisons may appear only when historically useful and explicitly distinguished.
2.2 Longevity
Include the historical concept of āyurlekhā.
Clearly explain:
Aura does not estimate lifespan or predict death.
Do not generate numerical lifespan estimates.
2.3 Hand-selection conventions
Historical men-right / women-left conventions may be mentioned as historical context.
Do not enforce gender-based hand selection.
Do not infer a user's gender.
2.4 Expert review
Qualified human review of historical terminology, source interpretation, and cultural accuracy is required before public launch.
AI-generated or AI-reviewed content is not sufficient for publication approval.
2.5 Launch gating
Develop on an isolated feature branch.
Do not expose the feature through Production.
No new feature-flag framework is required.
A merge into `main` is not authorized.
2.6 Analytics
Minimal non-sensitive educational events are permitted only after confirming the existing analytics contract.
Do not collect palm observations, inferred characteristics, or personal images.
2.7 Licensing
Use original paraphrases.
Do not reproduce copyrighted translations, published diagrams, or substantial source passages.
Preserve source attribution and record applicable licensing considerations.
```

**Later changes:**

| Decision | Change | Evidence |
|---|---|---|
| 2.5 "A merge into `main` is not authorized" | Superseded **for the PR #338 merge only** by ticket M2 (§3). "Do not expose the feature through Production" still holds: production builds exclude the content until approval | M2 ticket |
| Explore placement | PALM-01-G1-PD1 (2026-11-11): the card stays directly on Explore | `AURA_PALM_01_G1_GOVERNANCE_REPORT.md` §1A |
| 2.4 Expert review | Licensing part: counsel no longer required (R1). **Scholarly part: unchanged unless R3 is approved.** | R1, R3 |
| 2.7 Licensing | Unchanged. G3-C waiver §2.3 keeps the attribution and licence obligations | R1 |

## 3. PR #338 merge authorisation (GF-2) and M1/M2 record (GF-3)

| Field | Value |
|---|---|
| Evidence | (E1) The owner's tickets and the session's reports in the same local session transcript. (E2) The GitHub timeline of PR `ste277/aura-updated#338` |
| Owner confirmation that this transcription is authoritative | *(blank: pending)* |

| Milestone | Record |
|---|---|
| **M1** (ticket 2026-11-10T10:22:21Z, E1) | Read-only merge preflight and independent review; merge not authorised. The outcome, "GO: READY FOR CONTROLLED MERGE AUTHORIZATION", is quoted in the M2 ticket. No separate M1 report file exists |
| **M2** (ticket 2026-11-10T10:47:51Z, E1) | **Authorised (verbatim):** "Mandatory manual merge checks, normal GitHub merge, automatic deployment observation, post-merge verification and independent review." **Not authorised (verbatim):** "Palmistry publication, content approval, licensing sign-off, branch-protection changes, manual Production deployment or unrelated code changes." Reviewed head `0c8d0d65…` |
| GitHub (E2) | `ready_for_review` 2026-11-10T11:00:12Z; `merged` 11:00:15Z, by the repository owner's account. Merge commit `afbe5204…`. 0 GitHub reviews |
| M2 outcome (E1, 11:07Z) | **POST-MERGE BLOCKED.** The content stayed unpublished, and the approval file was unchanged. The automatic Production deployment failed on database reachability before the build ran |
| M3 (ticket 2026-11-10T11:14Z) | Production recovered and verified, with the content unpublished (`AURA_PALM_01_M3_PRODUCTION_RECOVERY.md`, local report) |

**Recording gaps (not remedied):**
- The M2 authorisation is not in the GitHub PR history.
- The PR #338 description still reads "Draft. Do not merge".
- A PR comment pointing here would be an outward-facing action, so it needs separate authorisation.

## 4. HR2

**Recorded (R7, 2026-11-23):** item M is split into three independent gates. In the owner's words:
- **Merge gate:** "Does not authorize feature activation."
- **Staging gate:** "Requires the applicable HR2 Stage 1–4, V1, A and R decisions."
- **Public-release gate:** "Requires applicable licensing, consent, privacy and accuracy approvals" and "explicit authorization before exposing Palmistry content or scanning functionality."

Stages 1–4, V1, A and R are **undecided**. Stage 2 is **NOT VERIFIED**.

**Proposed, not decided (R8):** which HR2 controls apply to the content-only guide. The C23 proposal (`AURA_PALM_C23_NEXT_ACTIONS.md` §4):
- **apply:** Stage 1 (the build gate as a trust boundary), the build-boundary R findings (C6-S1, R2-N5, S1C-F4), the content controls (`review-status.json`, the build exclusion, the CI bundle check) and the item M gates;
- **scanning-only:** Stages 2–4, V1 and the scanning-related R findings, including R1-F2. These gate any camera or image release, not the content-only guide.

No owner decision is recorded. Until one is, staging the guide follows the recorded item M text: all applicable HR2 decisions are required.

## 5. What is not recorded here

- No scholarly, editorial or licensing **reviewer** sign-off. The v1.1 PDF §11 fields stay blank.
- No content approval and no publication authorisation.
- No GitHub comment, message or external distribution.
