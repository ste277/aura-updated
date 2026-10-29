# Aura Palmistry Guide: Human Review Handoff

**Status:** content **NOT approved**. Approval file: `PENDING_HUMAN_REVIEW`.
**PR:** ste277/aura-updated#338 (draft), head `0c8d0d65ae9e30b2d4f925a16aaffdd9e9127fe9`.
**Full packet:** `docs/palmistry/AURA_PALM_01_I1_CONTENT_REVIEW_PACKET.md` on the PR branch. It is self-contained, so reviewers do not need the codebase.

> This handoff organises existing material for two **human** decisions: historical accuracy, and licensing. It answers none of the open questions. AI drafting and AI technical review do **not** establish historical accuracy or licensing clearance.

---

## 1. What must be reviewed

| Item | Where in the packet |
|---|---|
| 4 traditional lines: *āyurlekhā*, *dhanamātṛlekhā*, *pitṛlekhā*, *ūrdhvarekhā* | §3 (exact wording), §4 (ledger) |
| 5 traditional marks: *yava*, *matsya*, *śaṅkha*, *chatra*, *vedī* | §3, §4 |
| Guide-level text: introduction, Indian vs Western framing, hand convention | §2 |
| Disclosure: "Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events." | §2, §6 |
| Longevity safeguard: "Aura does not estimate lifespan or predict death. This entry explains a historical idea only." No lifespan numbers anywhere. | §2, §6 |
| Source attribution and the in-app licence notice | §1, §7 |
| Final UI screenshots (6) | §9 |

## 2. Evidence available to the reviewer

The ledger tags every claim:
- **VERIFIED-TEXT:** the page or verse was read in the stated edition.
- **VIA-TRANSLATION:** English translation only; the Sanskrit was not checked.
- **ENGINEERING:** a design choice, not a source fact.
- **OPEN:** unresolved.

Sources:
- Zysk 2025, *History of Science in South Asia* 13: 240–275 (full PDF read; includes the critical edition and translation of the Śārdūlakarṇāvadāna palmistry chapter, plus excerpts of the Sāmudrikatilaka and Hastasañjīvana).
- Bṛhatsaṃhitā, chapters 68 and 70, in N. Chidambaram Iyer's 1884 translation.

**Not checked by anyone:**
- the Sanskrit of the Bṛhatsaṃhitā verses;
- Zysk 2016 (*The Indian System of Human Marks*);
- regional traditions.

## 3. Open questions, grouped (numbers refer to packet §5)

**A. Historical accuracy**
- Q7: the schematic line positions (approximate, drawn from verbal descriptions).
- Q13: public-facing dating of the Śārdūlakarṇāvadāna chapter ("after the mid-9th century").
- Q11: whether to add the lotus mark once its Sanskrit term is verified.

**B. Sanskrit terminology and translation**
- Q1: *āyurlekhā* as the display term (an editor's suggested reading in v. 3; attested in v. 6).
- Q2: the *dhanamātṛlekhā* spelling and its "mother" gloss.
- Q5: Sāmudrikatilaka 1.155, where the Sanskrit *anāmikā* (ring finger) differs from the English "forefinger".
- Q8: Bṛhatsaṃhitā verse numbering (Iyer's chapter 68 vs the Sanskrit editions' chapter 67).
- Q9: *chatra* inside the compound *gajachatra*, emended to *rājachatra*.
- Q14: Hastasañjīvana 3.2.81, where the Sanskrit *ācārya* ("preceptor") is not in Zysk's English.

**C. Interpretation and tradition-specific claims**
- Q3: whether the Sāmudrikatilaka's "family" line is *pitṛlekhā* (left open on purpose).
- Q4: whether to mention the Sarasvatī association for *pitṛlekhā*.
- Q6: how to frame the upward line's status and varṇa readings.

**D. Educational framing and disclaimers**
- Q10: whether the "Western palmistry, for comparison" notes are accurate enough to show.
- Q12: naming the tradition "Rekhāśāstra" rather than "Hasta Sāmudrika" or "Sāmudrika Śāstra".
- Also confirm the general disclosure and longevity wording in §2.

**E. Source attribution and licensing**: see §5 below.

## 4. Historical reviewer: requirements and what counts as sign-off

**Qualifications.** The reviewer should have demonstrated expertise in at least one of:
- Sanskrit technical (*śāstra*) literature, ideally *lakṣaṇa*/Sāmudrika or omen texts;
- Indian intellectual history;
- the textual history of Indian palmistry.

They must be able to read the cited passages and judge the IAST terminology. A second editorial or cultural reviewer is recommended.

**An acceptable sign-off** is a completed row in packet §8 with:
- the reviewer's name and qualification, and the date;
- a decision: *Approve*, *Approve with corrections* or *Reject*;
- a written answer, or explicit acceptance as open, for each of Q1–Q14;
- the reviewer checklist in §8 ticked.

**If corrections are requested:** an engineer applies them, and the reviewer re-confirms the changed text before approval.

## 5. Licensing decision needed (human or legal)

| Field | Detail |
|---|---|
| Source | Kenneth G. Zysk, "Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā", *HSSA* 13 (2025): 240–275, DOI 10.18732/hssa128 |
| Licence | **CC BY-SA 4.0**; copyright held by the author (stated in the article's front matter) |
| Material used | Facts and interpretations from Zysk's commentary, and the *meaning* of verses as rendered in his translations (e.g. the finger readings of Hastasañjīvana 3.2.80–82 and Sāmudrikatilaka 1.143 and 1.152–1.156; the Śārdūlakarṇāvadāna verses cited in the §4 ledger), plus IAST terms and page and verse locators. |
| Nature of use | Original paraphrase in Aura's own words. No verses, translated sentences or figures are reproduced, and the hand illustration is original. |
| Existing attribution | The in-app Sources list credits title, author, journal and DOI, with a link. It also shows "© Kenneth G. Zysk, licensed under CC BY-SA 4.0" with a licence link (`rel="license"`) and "Aura's text paraphrases this work". |
| **Open question 1** | Is paraphrasing the meaning of Zysk's verse translations an "Adapted Material" under CC BY-SA 4.0, which would trigger ShareAlike for Aura's text, or a use of unprotectable facts and ideas? |
| **Open question 2** | Does the in-app attribution, including its "indicate changes" wording, satisfy BY? |
| Other sources | The Iyer 1884 translation is expected to be public domain (please confirm). No third-party images were used. |
| Status | **No licensing clearance has been given.** |

## 6. After both sign-offs

The engineer sets `packages/palmistry/src/review-status.json` to `{"status": "APPROVED", "approvedBy": {…}}` and, in the same change, updates the tests that assert the pending state (E1–E2, K1, K3 and the guard test's D1). That single file controls:
- the runtime gate;
- the build-level exclusion;
- the CI and Vercel bundle scanners.

Merge and Production release still need separate authorization.
