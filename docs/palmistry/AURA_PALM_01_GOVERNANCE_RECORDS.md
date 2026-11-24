# Aura Palmistry (content-only guide): Governance Records

**Compiled 2026-11-24** by Claude (AI) for the Product Owner, in PR #385. This file transcribes earlier records. It is **not backdated**, and it creates no approval that was not given at the time.

**Updated 2026-11-24:** the Product Owner's consolidated approval (D1–D7) was given in the chat session on 2026-11-24 and is transcribed verbatim in §6. Status: **CONTENT-ONLY MVP — OWNER APPROVED, PUBLICATION AUTHORIZATION PENDING.**

## 1. Status summary

| # | Record | Status | Where |
|---|---|---|---|
| R1 | Licensing counsel waiver (Product Owner licensing risk acceptance) | **APPROVED 2026-11-24** | `AURA-PALM-01-G3-C-WAIVER.md` §4 (commit `4a1b9c9`) |
| R2 | AI account used on 2026-11-10: individual Claude Max subscription (Anthropic Consumer Terms) | **CONFIRMED BY OWNER 2026-11-24** | G3-C waiver §4 and §5 |
| R3 | Scholarly review waiver | **APPROVED 2026-11-24** by the Product Owner (D1). No independent scholarly review has been completed | `AURA-PALM-01-G3-SCHOLAR-WAIVER.md` §5; §6 below |
| R4 | Product Owner editorial and cultural review of the final content | **APPROVED 2026-11-24** without further content changes, content commit `f723942` (D2). Product Owner approval, not independent scholarly approval | `AURA_PALM_01_G3_FINAL_CONTENT_REVIEW.md` §H; §6 below |
| R5 | MVP product decisions 2.1–2.7 (GF-1) | **Historical decision, transcribed below. Transcription CONFIRMED by the owner 2026-11-24 (D3)** | §2 |
| R6 | PR #338 merge authorisation (GF-2) and M1/M2 milestone record (GF-3) | **Historical authorisation, transcribed below. Transcription CONFIRMED by the owner 2026-11-24 (D3).** Recording gaps preserved | §3 |
| R7 | HR2 item M amendment: separate merge, staging and public-release gates | **RECORDED 2026-11-23** (owner's words) | `AURA_PALM_HR2_OWNER_DECISIONS.md`, "Item M amendment (C21)"; summary in §4 |
| R8 | HR2 applicability to the content-only guide | **APPROVED 2026-11-24** (D4): content-only versus scanner split adopted | §4; §6 |
| R8a | HR2 Stage 1, content-only guide | **ACCEPTED 2026-11-24** (D5), scoped exclusively to the content-only guide as a defence-in-depth build safeguard; no comprehensive detection guarantee | §4; §6 |
| R8b | Build-boundary findings C6-S1, R2-N5, S1C-F4, content-only guide | **ACCEPTED 2026-11-24 as recorded limitations** (D6). **Not remediated.** Does not extend to the scanner workstream | §4; §6 |
| R9 | Publication authorisation (public-release gate) | **NOT AUTHORIZED AT THIS STAGE** (D7). PR #385 must not be merged until the publication decision is given | §6 |
| R10 | `review-status.json` | **`APPROVED`**, Product Owner record (`role: PRODUCT_OWNER_EDITORIAL_AND_CULTURAL_REVIEW`, `independentScholarlyReview: false`, `contentCommit: f723942`, `date: 2026-11-24`), committed on PR #385 only. Not on `main` | `packages/palmistry/src/review-status.json` |

**Changes to the G3 v1.1 publication sequence (PDF §12):**
- Step 3 (licensing reviewer): replaced by R1.
- Step 2 (scholarly sign-off): replaced by R3 + R4 (both approved 2026-11-24). The PDF §11 scholarly reviewer fields stay blank and unsigned.
- Step 1 (governance records): this file; R5 and R6 transcriptions confirmed 2026-11-24.
- Steps 4–5 (re-confirm corrections, record the approval in a reviewed change): the approval-record commit on PR #385.
- Step 6 (separate publication authorisation): **not given** (R9).

## 2. MVP product decisions 2.1–2.7 (GF-1)

| Field | Value |
|---|---|
| Issued | 2026-11-10, about 05:57 UTC, as §2 of the owner's ticket AURA-PALM-01-I1 |
| Evidence | The I1 ticket as preserved in the Claude Code session "Palmistry discovery and feasibility audit" (local transcript, message 2026-11-10T05:57:37Z). The 2026-11-10 transcripts are also held in the encrypted evidence image (sha256 `038dc178…`, G3-C waiver §5) |
| Owner confirmation that this transcription is authoritative | "I confirm the GF-1, GF-2 and GF-3 historical records in `AURA_PALM_01_GOVERNANCE_RECORDS.md`." (D3, 2026-11-24) |

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
| 2.4 Expert review | Licensing part: counsel no longer required (R1). Scholarly part: replaced for this guide by the scholar waiver (R3) and the Product Owner's editorial and cultural review (R4), 2026-11-24. No independent scholarly review has been completed | R1, R3, R4 |
| 2.7 Licensing | Unchanged. G3-C waiver §2.3 keeps the attribution and licence obligations | R1 |

## 3. PR #338 merge authorisation (GF-2) and M1/M2 record (GF-3)

| Field | Value |
|---|---|
| Evidence | (E1) The owner's tickets and the session's reports in the same local session transcript. (E2) The GitHub timeline of PR `ste277/aura-updated#338` |
| Owner confirmation that this transcription is authoritative | "I confirm the GF-1, GF-2 and GF-3 historical records in `AURA_PALM_01_GOVERNANCE_RECORDS.md`." (D3, 2026-11-24) |

| Milestone | Record |
|---|---|
| **M1** (ticket 2026-11-10T10:22:21Z, E1) | Read-only merge preflight and independent review; merge not authorised. The outcome, "GO: READY FOR CONTROLLED MERGE AUTHORIZATION", is quoted in the M2 ticket. No separate M1 report file exists |
| **M2** (ticket 2026-11-10T10:47:51Z, E1) | **Authorised (verbatim):** "Mandatory manual merge checks, normal GitHub merge, automatic deployment observation, post-merge verification and independent review." **Not authorised (verbatim):** "Palmistry publication, content approval, licensing sign-off, branch-protection changes, manual Production deployment or unrelated code changes." Reviewed head `0c8d0d65…` |
| GitHub (E2) | `ready_for_review` 2026-11-10T11:00:12Z; `merged` 11:00:15Z, by the repository owner's account. Merge commit `afbe5204…`. 0 GitHub reviews |
| M2 outcome (E1, 11:07Z) | **POST-MERGE BLOCKED.** The content stayed unpublished, and the approval file was unchanged. The automatic Production deployment failed on database reachability before the build ran |
| M3 (ticket 2026-11-10T11:14Z) | Production recovered and verified, with the content unpublished (`AURA_PALM_01_M3_PRODUCTION_RECOVERY.md`, local report) |

**Recording gaps (not remedied; preserved at the owner's direction, D3: "Preserve the documented historical recording gaps. Do not fabricate retrospective approvals or reviewer signatures."):**
- The M2 authorisation is not in the GitHub PR history.
- The PR #338 description still reads "Draft. Do not merge".
- A PR comment pointing here would be an outward-facing action, so it needs separate authorisation.

## 4. HR2

**Recorded (R7, 2026-11-23):** item M is split into three independent gates. In the owner's words:
- **Merge gate:** "Does not authorize feature activation."
- **Staging gate:** "Requires the applicable HR2 Stage 1–4, V1, A and R decisions."
- **Public-release gate:** "Requires applicable licensing, consent, privacy and accuracy approvals" and "explicit authorization before exposing Palmistry content or scanning functionality."

For the **scanner workstream**, Stages 2–4, V1, A and the scanning R findings stay **undecided**. Stage 2 is **NOT VERIFIED**. R1-F2 and the other unresolved scanner findings keep their existing status.

**Approved 2026-11-24 (R8, D4):** the C23 split (`AURA_PALM_C23_NEXT_ACTIONS.md` §4) is adopted for the content-only guide:
- **apply:** Stage 1 (the build gate as a trust boundary), the build-boundary R findings (C6-S1, R2-N5, S1C-F4), the content controls (`review-status.json`, the build exclusion, the CI bundle check) and the item M gates;
- **scanning-only:** Stages 2–4, V1 and the scanning-related R findings, including R1-F2. These gate any camera or image release, not the content-only guide.

**Content-only guide, decided 2026-11-24:**
- Stage 1: ACCEPTED, scoped to the content-only guide (D5).
- C6-S1, R2-N5, S1C-F4: ACCEPTED as recorded limitations, **not remediated** (D6). The owner adds: "Verify the actual release artifact before any subsequent Production promotion."
- Item M gates retained: staging the guide still needs a separate staging authorisation; publication needs a separate public-release authorisation (D7: not given).
- D4: "This decision does not waive any scanner-specific security, privacy, consent, accuracy or licensing requirements."

## 5. What is not recorded here

- No independent scholarly or licensing **reviewer** sign-off. The v1.1 PDF §11 scholarly reviewer fields stay **blank and unsigned**; the Product Owner is not recorded as a scholarly reviewer.
- No publication, staging or merge authorisation for PR #385.
- No GitHub comment, message or external distribution.

## 6. Product Owner consolidated approval, 2026-11-24 (verbatim)

Given by the Product Owner in the Claude Code chat session on 2026-11-24 (received about 14:00 UTC). Transcribed exactly by Claude (AI), which adds no decision of its own.

```text
AURA-PALM-01-G3 — Consolidated Product Owner Approval
PR: #385
Reviewed PR head: `332c0df4f81d462c8868a09e3fd53387e6491b4a`
Reviewed content commit: `f723942`
D1 — Scholarly review waiver
APPROVED.
I approve the wording in §5 of `AURA-PALM-01-G3-SCHOLAR-WAIVER.md` and accept residual scholarly risks S-1–S-7.
I acknowledge that no independent scholarly review has been completed.
This approval applies exclusively to the content-only educational Palmistry guide.
D2 — Editorial and cultural review
APPROVED without further content changes.
I have personally reviewed the final content and illustrations against checklist H1–H10 and approve the exact content at `f723942`, with the hashes recorded in the final-content review document.
This is Product Owner editorial and cultural approval, not independent scholarly approval.
D3 — Historical governance records
CONFIRMED.
I confirm the GF-1, GF-2 and GF-3 historical records in `AURA_PALM_01_GOVERNANCE_RECORDS.md`.
Preserve the documented historical recording gaps. Do not fabricate retrospective approvals or reviewer signatures.
D4 — HR2 applicability
APPROVED.
Adopt the proposed content-only versus scanner applicability split.
Retain the following controls for the content-only guide:

* Stage 1 build boundary.
* Applicable build-boundary findings.
* Content approval record.
* Build exclusion and CI bundle checks.
* Unconditional Production image-input exclusion.
* Item M merge, staging and public-release gates.

Stages 2–4, V1, A and scanner-specific findings remain in the separate scanner workstream.
Stage 2 remains NOT VERIFIED.
R1-F2 and all other unresolved scanner findings retain their existing status.
This decision does not waive any scanner-specific security, privacy, consent, accuracy or licensing requirements.
D5 — HR2 Stage 1
ACCEPTED, scoped exclusively to the content-only guide as a defence-in-depth build safeguard.
No comprehensive detection guarantee is claimed.
The documented limitations of the build-verification mechanism are acknowledged.
D6 — Build-boundary limitations
ACCEPTED as recorded limitations for the content-only guide:

* C6-S1 — Empty or partial build output may pass the scanner.
* R2-N5 — Docker artifacts are not scanned.
* S1C-F4 — The packaging step is outside the verification boundary.

Do not record these findings as remediated.
This acceptance does not extend to the scanner workstream.
Verify the actual release artifact before any subsequent Production promotion.
D7 — Publication
NOT AUTHORIZED AT THIS STAGE.
Publication requires separate, explicit Product Owner authorization.
Because merging an APPROVED review record into main makes the guide eligible for inclusion in subsequent Production builds, PR #385 must not be merged until the publication decision is given.
Next-step implementation authorization
You are authorized to:

1. Record these Product Owner decisions in the existing governance documents, preserving the exact approval wording and actual approval date.
2. Commit the approval record to PR #385 using the proposed Product Owner role and `independentScholarlyReview: false`.
3. Update the approval-record type and relevant tests as proposed in §6 of the scholarly waiver.
4. Preserve existing publication safeguards, fixture-based negative tests and unconditional Production image-input exclusion.
5. Verify the reviewed user-facing content and illustrations remain unchanged. Account explicitly for any content module hash change caused solely by the authorized approval-record type update.
6. Run the complete CI suite.
7. Verify that the approved-state build contains the educational guide but excludes camera access, photo upload, MediaPipe, personalized readings and prediction functionality.
8. Report the exact new PR head, changed files, CI results and release readiness.

Preserve all applicable attribution and licensing obligations.
Keep the independent scholarly reviewer fields blank and unsigned.
Keep PR #385 in draft, with Auto-fix and Auto-merge disabled.
Do not merge, stage, deploy, promote or publish.
Do not change Production environment variables, deployment settings or publication safeguards.
Do not introduce another audit or remediation phase unless a material defect is discovered.
Target status: CONTENT-ONLY MVP — OWNER APPROVED, PUBLICATION AUTHORIZATION PENDING.
Stop after completing the approval-record commit and CI verification. Await my separate publication authorization.
```
