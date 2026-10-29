# AURA-PALM-01-G3-C: Counsel Engagement Readiness Report

**Date:** 2026-11-11 · **Scope:** preparation and documentation only. No one was contacted, nothing was distributed, and nothing changed in the app, the PDF or the governance records.

## 1. Executive summary

**Verdict: CONDITIONAL GO.** The counsel package is substantially ready:
- a brief with the exact L1, L2, AI-content and India/US questions, quotation-checked annexes and confidentiality terms;
- Reviewer C qualification requirements, with a blocker and closer table;
- private-distribution controls.

**It cannot be sent until:**
- counsel is selected and engaged on a written confidentiality basis;
- the owner supplies four inputs: the commercial model and markets, confirmation of the audience and provider location, the AI provider's terms, and the deadline and sender details;
- distribution is explicitly authorized.

The independent AI review returned ACCEPT WITH CHANGES (no P0). All its findings are fixed.

## 2. Evidence inventory

| Evidence | Location (verified) | Used for |
|---|---|---|
| Frozen review PDF v1.1 | `AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf`; reference `AURA_PALM_01_G3_DISTRIBUTION/reference/v1.1/` | Attachment; content |
| G3-L1 audit and actions | `AURA_PALM_01_G3_L1_LICENSING_AUDIT.md`, `AURA_PALM_01_G3_L1_LICENSING_ACTIONS.md` | Questions, classifications |
| v1.1 QA report, change summary | `AURA_PALM_01_G3_DISTRIBUTION/PDF_v1.1_QA_REPORT.md`, `…/PDF_v1.0_TO_v1.1_CHANGE_SUMMARY.md`. **These are in the distribution folder, not the repo root as the ticket listed.** | Integrity |
| Review tracker, manifest, governance tracker | `AURA_PALM_01_G3_REVIEW_TRACKER.md`, `AURA_PALM_01_G3_DISTRIBUTION/DISTRIBUTION_MANIFEST.md`, `…/GOVERNANCE_FINDINGS_TRACKER.md` | Tracking, separation |
| Content and attribution code | `origin/main` @ `1741a95`: `packages/palmistry/src/content.ts`, `sources.ts`, `apps/web/components/PalmistryView.tsx`, `PalmHandDiagram.tsx` | Annexes A and D |
| Public sources | Zysk 2025 PDF and journal page (CC BY-SA 4.0); Iyer 1884 (wisdomlib); CC BY-SA 4.0 legal code | Annexes A and B; licence facts |
| Provenance | I1/D1 session transcript and its subagent transcripts; git history | Annex C (owner-authored strings verified against the transcript) |

## 3. Frozen PDF integrity

**PASS.** SHA-256 `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88` for both the working and reference copies. Checked at the start and again at the end of G3-C, and also by the independent reviewer. Not modified.

## 4. L1/L2 question completeness

| Required element (ticket §4) | In brief |
|---|---|
| Exact source identification | B2 |
| Licence and version | B3 (CC BY-SA 4.0, with verbatim evidence) |
| Relevant source passages | Annex A (verbatim, checked) |
| Corresponding Aura passages | Annex A |
| Nature of paraphrasing | Annex A "Type of use"; C1 |
| Attribution already present | Annex D |
| Overlap results (max 11 words, conventional phrase; max 3 words with Wikipedia; no third-party images) | Annex B, stated as **evidence, not a determination** |
| Intended commercial use | §A, **[owner input outstanding]** |
| G3-L1 findings | B2 "Internal pre-assessment" (labelled non-legal) |
| L2 items 1–10 | C2.1–C2.10. Doesn't assume app-wide ShareAlike or a commercial prohibition; legal conclusions kept separate from owner decisions |

## 5. AI ownership questions

C3 covers:
- protection of AI text and drawings;
- human authorship;
- ownership and rights of use;
- third-party risk;
- commercial use;
- provenance documentation;
- India vs US.

It distinguishes the five categories and doesn't assume protection or freedom from third-party rights.

**Provenance gaps given to counsel:**
- no record of human line-editing of the AI text;
- no human visual comparison of the drawings yet (L6);
- the AI provider's terms are not yet supplied;
- owner authorship of the ticket text is assumed, not independently established.

## 6. India and US coverage

Brief C4 and the Annex E matrix cover ownership, AI works, derivative works, translation rights, duration, commercial publication, CC interpretation, cross-border distribution and exceptions. All are framed as questions, not settled law. Counsel is asked to recommend local advice where needed, and whether other jurisdictions matter: the licensor is affiliated with the University of Copenhagen, the journal is published in Canada, and users may be in the EU/UK.

## 7. Reviewer C qualification requirements

`AURA_PALM_01_G3_C_REVIEWER_REQUIREMENTS.md` contains:
- 10 qualification checks (copyright; derivative works and translation; CC BY-SA 4.0; AI; software and app distribution; US; India; other-jurisdiction referral; visual comparison);
- conflict checks (Zysk; the journal and University of Alberta; wisdomlib; the AI provider);
- confidentiality requirements, noting that a private channel alone isn't enough;
- engagement items left for decision;
- selection criteria;
- blank assignment fields.

**New:** a §1A table preserving the G3-L1 blocker status, with the **internal licensing reviewer as fallback closer** for L3, L4 and L6.

## 8. Reviewer A/B dependencies

| Track | Can start now (after its own designation and authorization)? | Depends on counsel? |
|---|---|---|
| **Reviewer A**: scholarly / traditional sources | **Yes**, independently | Only if counsel requires rewriting. Then A re-confirms the rewritten passages |
| **Reviewer B**: editorial / cultural | **Yes**, independently | Same: B re-confirms any rewritten wording |
| **Reviewer C**: counsel (L1, L2, N3; optionally L3, L4, L6) | After selection, engagement and authorization | — |
| Internal licensing reviewer (L3–L8 if counsel doesn't cover them) | After designation | No |

```
Reviewer A ─┐
Reviewer B ─┼─(all run in parallel)──► combined findings ──► [if counsel requires rewrite: content change
Counsel (C) ─┘                                                 (separately authorized) ──► A, B, C re-confirm]
                                                         ──► approval-record change (separate authorization)
Governance GF-1..3 (separate gate) ─────────────────────────────► publication authorization (separate)
```

Reviewer C is **not** responsible for scholarly or editorial approval. Reviewers A and B are not named, contacted or assigned here.

## 9. Independent review (AI)

**Verdict: ACCEPT WITH CHANGES.** No P0, one P1, five P2, six P3. The reviewer:
- verified the checksum and repository cleanliness (no tracked changes);
- confirmed every Annex A quotation is verbatim;
- confirmed the owner-authored strings against the transcript, consistency with G3-L1, and the confidentiality controls.

| Finding | Class | Disposition |
|---|---|---|
| L3, L4 and L6 lacked a closer if counsel declines the optional C5; no blocker-status table | P1 | **Fixed:** requirements §1A table with internal-reviewer fallback; governance kept separate |
| A3 quote cut before "wealth", hiding the closest overlap | P2 | **Fixed:** full clause quoted ("for the sake of man's wealth.") |
| CC section cited as §1(h); correct is §1(i) | P2 | **Fixed** in the brief, and corrected in the G3-L1 audit with a note |
| AI-prepared evidence not labelled as such | P2 | **Fixed:** Annex B states that A and B were AI-prepared and AI-checked |
| G3-L1's own findings only implied | P2 | **Fixed:** new "B2. Internal pre-assessment (not legal advice)" |
| "Licensor based in Denmark" was an inference | P2 | **Fixed:** "affiliated with the University of Copenhagen … [to confirm]" |
| Annex B overstatement on essay/wisdomlib | P3 | Fixed ("no shared run of 4+ words") |
| "Served online from the US" assumed a fact | P3 | Fixed (neutral, with an owner-confirm bracket) |
| Audience claim unsourced | P3 | Sourced to the internal review packet and bracketed for owner confirmation |
| Pre-send cleanup missing | P3 | Added to checklist AC-3 |
| C2.8 paraphrase of §3(b)(3); "Aura's facts" | P3 | Fixed |
| Owner-ticket authorship assumed | P3 | Noted in Annex C |

An AI review is not legal advice or human legal approval.

## 10. Outstanding decisions (owner)

1. **Select and engage counsel** against the requirements doc: qualifications, India and US coverage, conflicts, a written confidentiality basis, fees and deadline.
2. **Supply the brief's inputs:** commercial model and markets; audience and provider-location confirmation; AI provider terms; sender and deadline.
3. **Decide** whether counsel also covers L3, L4 and L6, or **designate the internal licensing reviewer** for them (and for L5, L7, L8).
4. **Authorize distribution** of the brief + PDF v1.1 to the appointed counsel.
5. Separately: designate Reviewers A and B and authorize their distribution (gate G3), and decide the governance reconciliation (GF-1 to GF-3).

## 11. Recommended distribution authorization gate

**PALM-01-G3-C-D: Counsel Appointment and Controlled Disclosure.** Authorize:
- (a) the named counsel and engagement terms, including the confidentiality instrument;
- (b) the finalized brief (owner inputs filled, cleanup done, SHA-256 recorded);
- (c) transmission of exactly the brief + PDF v1.1 (`d5fb7a1e…`) through the agreed private channel, following `AURA_PALM_01_G3_C_DISTRIBUTION_CHECKLIST.md` AC-1 to AC-5.

## 12. Final verdict

### **CONDITIONAL GO**

The package is ready for counsel selection. Engagement and disclosure wait on the owner inputs and decisions in §10.

External review distribution: **HOLD**. Palmistry publication: **HOLD**. Production merge freeze: **ACTIVE**.
