# AURA-PALM-01-G3: Scholarly Review Waiver (content-only guide)

**Status: APPROVED by the Product Owner, 2026-11-24** (decision D1; verbatim text in `AURA_PALM_01_GOVERNANCE_RECORDS.md` §6).
- **Not a review:** no independent scholarly review has been completed. This waiver does not describe one, and does not record the Product Owner as a scholarly reviewer.
- **Not publication:** the approval record (§6) is committed on PR #385 only. Publication is **not authorised** (D7).
- **Prepared by** Claude (AI), 2026-11-24, for the Product Owner. The preparer adds no decision of its own.

**Scope:** the **content-only educational Palmistry guide** only (`packages/palmistry`, `components/PalmistryView`, `PalmHandDiagram`). It does **not** cover:
- palm scanning, camera or image input, MediaPipe or the hand model;
- personalised readings or predictions;
- privacy or data-protection requirements;
- any other Aura content.

## 1. What changes

| Before | After (if §5 is approved) |
|---|---|
| G3 v1.1 §11: an external **Primary scholarly reviewer** must approve the content before the approval record changes (decision 2.4, "Qualified human review … is required before public launch") | External scholarly review is **no longer an internal publication prerequisite** for the content-only MVP. The unresolved scholarly uncertainties (§3) are carried as **explicit Product Owner risk acceptance** (§4) |
| G3-C waiver §4, owner's words: "Scholarly review, editorial review … remain mandatory" | Superseded **for scholarly review only**. Editorial review is kept: the Product Owner performs the editorial and cultural review of the exact final content (§2) |
| **Unchanged** | Attribution and applicable licence obligations (G3-C waiver §2.3: CC BY-SA 4.0 attribution to Zysk, Iyer courtesy citation, ShareAlike if it applies). Separate publication authorisation (HR2 item M, public-release gate). Build exclusion and CI bundle check until the approval record changes. Counsel or a scholar may still be engaged voluntarily at any time |

**What this modifies:** decision 2.4 ("AI-generated or AI-reviewed content is not sufficient for publication approval") for this guide. Publication approval would rest on the Product Owner's own review of the final content (§2), **not** on AI review. AI checks (§3) remain inputs, not approval.

## 2. Product Owner editorial and cultural review (required)

The Product Owner reviews the **exact final user-facing content** in `AURA_PALM_01_G3_FINAL_CONTENT_REVIEW.md` against its checklist (§G).
- The review is bound to the content commit and file hashes stated there. Any later wording change needs a fresh owner confirmation.
- It is an owner review, not an independent or expert review. It is recorded as such (§6).
- Not completed: it is complete only when the owner confirms it explicitly.

## 3. Open scholarly questions Q1–Q14: actual dispositions (2026-11-24)

"AI-checked" means checked by Claude against the PDF of Zysk 2025 (sha256 `bc1490f6…`, downloaded 2026-11-24 from the journal's own site). It is not expert verification.

| Q | Topic | Disposition (actual) | Shown to users | Material? |
|---|---|---|---|---|
| Q1 | āyurlekhā as display term (editor's reading in v. 3) | **Open, not answered.** Current wording kept | Context note says the term appears in v. 6 and is an editor's suggested reading in v. 3 | Yes |
| Q2 | dhanamātṛlekhā form and "mother" gloss | **Open, not answered.** Current wording kept | Context note says the name comes from later diagrams with varying spellings | Yes |
| Q3 | ST 1.143 "family" line = father line? | **Open.** AI-checked: ST 1.143 says the first three lines "pertain to the family, material wealth, and longevity" (Zysk 2025, p. 265). Neither verse nor commentary identifies the family line with the father line. **Wording changed** from "awaits expert review" to a neutral statement | "… the cited passage does not say whether its "family" line is this father line." | No (stated as uncertain) |
| Q4 | Mention the Sarasvatī label? | **Open.** AI-checked: Zysk p. 243 reports the father's line on figs. 1–2 and Sarasvatī on fig. 3. Kept | Interpretation mentions it | No |
| Q5 | ST 1.155: ring finger (Sanskrit) vs forefinger (English) | **Open.** AI-checked: the Sanskrit has *…rekhānāmikāṅgulīm…* (anāmikā, ring finger) and Zysk's English says "forefinger" (p. 265). **Wording changed** to a neutral statement; Aura does not choose | "… the Sanskrit names the ring finger while the English translation says forefinger; Aura does not choose between them." | Yes (which reading is right is unresolved) |
| Q6 | Framing of social roles; varṇa | **Partly addressed by owner direction:** A1 general paragraph (`ec81a27`) and W3 (names varṇa). Not scholar-reviewed | Upward-line text and context note | Yes |
| Q7 | Schematic line positions | **Open, not answered.** Caption says positions are approximate | Diagram caption | No |
| Q8 | Bṛhatsaṃhitā numbering (Iyer ch. 68 vs editions' 67) | **Open, not answered.** Iyer numbering kept, with "Sanskrit editions: 67.42" on yava | Source locators | No |
| Q9 | chatra as display term (gajachatra / rājachatra) | **Open, not answered.** Context note states the emendation | Parasol context note | Yes |
| Q10 | Western comparison mapping | **Open, not answered.** Notes are labelled as approximate comparisons | Four "Western palmistry, for comparison" notes | No |
| Q11 | Lotus mark | **Not included** (term unverified). No change | — | No |
| Q12 | "Rekhāśāstra" as the name of the tradition | **Open, not answered.** Kept (Zysk's usage, pp. 241, 243) | About: tradition | No |
| Q13 | "after the mid-9th century" phrasing | **Open, not answered.** Kept (Zysk p. 240) | Intro and entries | No |
| Q14 | "preceptor" in HS 3.2.81 | **Moot for user text** since A1: no finger-by-finger roles are shown. AI-checked: the Sanskrit has *tathācaryaḥ* and the English gives only "renowned army general" (p. 264) | Not shown | No |

**Known research limits (unchanged):**
- the Sanskrit of the Bṛhatsaṃhitā verses was not checked;
- three of six sources were read only through Zysk 2025;
- Zysk 2016 (*The Indian System of Human Marks*) and regional traditions were not consulted.

## 4. Residual scholarly risks (for owner acceptance)

| Risk | Note |
|---|---|
| **S-1 Unreviewed terminology and readings:** Q1, Q2, Q5, Q6, Q9 may be wrong or imprecise | Each is shown with its uncertainty where the text makes a claim. Remedy: correct or remove the detail if a reader or scholar raises it |
| **S-2 Unverified Sanskrit (Bṛhatsaṃhitā):** claims rest on Iyer's 1884 translation | Tagged VIA-TRANSLATION in the v1.1 ledger |
| **S-3 Single secondary source:** Śārdūlakarṇāvadāna, Sāmudrikatilaka, Hastasañjīvana and the diagrams are read only through Zysk 2025 | Attributed to Zysk in every locator |
| **S-4 Narrow coverage:** no regional or other traditions; Zysk 2016 not consulted | The guide says it describes what these texts said, and that interpretations differ |
| **S-5 AI-only checking:** the citation ledger and today's checks were done by AI, with no human expert check | Recorded as AI checks, not verification |
| **S-6 Cultural sensitivity:** varṇa, royal status and gendered readings (barleycorn "sons", hand convention) are reviewed only by the Product Owner | W1 and W3 add framing; owner checklist §G covers them |
| **S-7 No independence:** the reviewer of record is the Product Owner, not an independent expert | Recorded as such in the approval record (§6) |

## 5. Product Owner acceptance (PROPOSED wording, for explicit approval)

> I elect to remove mandatory external scholarly review as an internal prerequisite for publishing the content-only Aura Palmistry guide.
> I acknowledge that no independent scholarly review of the guide has been completed, and that open questions Q1–Q13 remain unanswered by a scholar.
> I accept the residual scholarly risks S-1 to S-7 in §4 of AURA-PALM-01-G3-SCHOLAR-WAIVER.md.
> I will personally complete the editorial and cultural review of the exact final content before the approval record is changed. That review is a Product Owner review, not an independent scholarly review.
> This decision does not waive attribution or applicable licence obligations, and does not authorize publication, which still requires separate authorization.
> This decision does not extend to palm scanning, real photograph collection, personalized readings or privacy and data protection requirements.

| Field | Value |
|---|---|
| Final decision (APPROVE / AMEND / REJECT), owner's words | "APPROVED. I approve the wording in §5 of `AURA-PALM-01-G3-SCHOLAR-WAIVER.md` and accept residual scholarly risks S-1–S-7. I acknowledge that no independent scholarly review has been completed. This approval applies exclusively to the content-only educational Palmistry guide." (D1) |
| Approved by / date | Product Owner / 2026-11-24 (chat session; verbatim in `AURA_PALM_01_GOVERNANCE_RECORDS.md` §6) |
| Final content editorial and cultural review confirmed (owner's words, content commit) | "APPROVED without further content changes. I have personally reviewed the final content and illustrations against checklist H1–H10 and approve the exact content at `f723942`, with the hashes recorded in the final-content review document. This is Product Owner editorial and cultural approval, not independent scholarly approval." (D2) |

## 6. Approval record (applied 2026-11-24 on PR #385, after D1 and D2)

Inspection (2026-11-24):
- the runtime gate (`isPalmistryAvailable`), the build exclusion (`palmistry-build-exclusion.js`) and the Vercel guard test **only** check `status === "APPROVED"`;
- `approvedBy` is typed `{ reviewer, date }` in `content.ts`, and is not displayed in the UI.

So no gate or safeguard needs to change. The smallest accurate change, in its own reviewed commit after both approvals:

```json
{
  "status": "APPROVED",
  "approvedBy": {
    "reviewer": "Product Owner",
    "role": "PRODUCT_OWNER_EDITORIAL_AND_CULTURAL_REVIEW",
    "independentScholarlyReview": false,
    "basis": "AURA-PALM-01-G3-SCHOLAR-WAIVER.md §5; AURA-PALM-01-G3-C-WAIVER.md §4",
    "contentCommit": "<reviewed content commit>",
    "date": "<date of owner confirmation>"
  }
}
```

The same commit would:
- widen the `approvedBy` type in `content.ts` to these fields;
- replace the pending-state checks with checks that pin this exact record:
  - `palm01I1Content` E1, E2, K1 and K3;
  - `palm01P4VercelGuard` D1;
  - `palmG5I1PrivacyGate` C5.

  The new checks would assert `role` is the Product Owner role and `independentScholarlyReview === false`, so the record can never read as a scholarly sign-off.
- leave the fixture-based build-exclusion and bundle-check tests, and the image-input exclusion, **unchanged**.

**As applied:** `contentCommit` is `f723942` and `date` is `2026-11-24`. The real-state checks above were updated as listed. Two further real-state checks pinned the pending state and were updated in the same commit, since the list above missed them:
- `palm01I1ExploreJsdom`: A13 (approved, so visible in production) and B4 (preview notice hidden).
- `palm01I1Content`: K7 (the default read keeps the real module) and K10 (next.config wiring, now proven through the approval-state cache key, with the image-input replacement still present).

The pending → excluded path stays covered by K4 and the fixture-tree tests. No fixture-based negative test, build exclusion, bundle check or image-input exclusion was changed. The `content.ts` change is the type line only, so its sha256 changed; no user-facing text changed (`AURA_PALM_01_G3_FINAL_CONTENT_REVIEW.md` header).

The G3 v1.1 PDF §11 **Primary scholarly reviewer** fields stay **blank and unsigned**. They are not filled with the Product Owner's name.
