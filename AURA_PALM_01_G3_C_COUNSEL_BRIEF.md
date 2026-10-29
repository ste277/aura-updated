# Legal Review Brief: Aura Palmistry Guide (Copyright and Creative Commons)

> **DRAFT. NOT SENT.** Prepared for the product owner's approval under ticket AURA-PALM-01-G3-C. Send only to appointed counsel, through the channel and under the confidentiality arrangement recorded in `AURA_PALM_01_G3_C_DISTRIBUTION_CHECKLIST.md`. Bracketed `[…]` items are owner inputs still needed.

**To:** [Appointed counsel: name, firm]
**From:** [Product owner / authorized sender], on behalf of Aura
**Date:** [send date]
**Reference:** Aura Palmistry, Reviewer C (licensing), review document G3 v1.1, SHA-256 `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88`

**Confidential.** This brief and its attachment are unpublished draft material, provided only for your legal review. Please don't share them further without written authorization. Nothing here grants any right to publish or reuse the material.

---

## A. Product context

- **Aura** is a personal-planning app with features based on Indian traditional timekeeping (Panchang, Muhurtham). It is a web application; iOS and Android shells load the same web app.
- **The Palmistry guide** is a small, read-only educational section of Aura. Users read an introduction, then select one of four lines on an original schematic drawing of a hand, or one of five traditional marks, to read how historical Indian texts interpreted it, with sources. It does not read the user's hand, use photos, personalise anything or make predictions.
- **Audience:** general adult users, mostly in India and the Indian diaspora (as stated in the internal review packet; [owner to confirm]).
- **Commercial use:** [Owner to confirm: business model (free / paid / subscription / advertising), whether the Palmistry guide is inside a paid tier, and target markets beyond India and the US]. Treat the guide as part of a commercial product.
- **Status:** unpublished. It is excluded from all public builds until approval, and no publication decision has been made. Your review is one of several required gates.

## B. Materials under review

| # | Material | Where |
|---|---|---|
| B1 | The review document (32 pages) with the exact user-visible text (Sections 3–4), citations (Section 5), the licensing checklist L1–L8 (Section 9) and screenshots (Section 10) | Attachment: `AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf` (SHA-256 above) |
| B2 | Main modern source: Kenneth G. Zysk, "Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā", *History of Science in South Asia* 13 (2025): 240–275, DOI 10.18732/hssa128 | Public: https://journals.library.ualberta.ca/hssa/index.php/hssa/article/view/128 |
| B3 | Licence of B2: **CC BY-SA 4.0**. Article page metadata: "Copyright (c) 2025 Kenneth Zysk", rights URI https://creativecommons.org/licenses/by-sa/4.0. PDF front matter: "Copyright of all the articles rest with the respective authors. Articles are published under the provisions of the Creative Commons Attribution-ShareAlike 4.0 license." Journal terms: others may share "with an acknowledgement of the work's authorship and initial publication in this journal". No warranty-disclaimer notice is supplied. | Public pages (fetched 2026-11-11) |
| B4 | Secondary source: Varāhamihira, *Bṛhatsaṃhitā*, English translation by N. Chidambaram Iyer (published 1884; hosted on wisdomlib.org from a modern reprint). Secondary evidence (a reprint preface by the translator's brother, quoted on a bookseller listing) states the translator died in **January 1892**. Not confirmed from a primary record. | Public |
| B5 | Source-to-Aura comparisons | **Annex A** |
| B6 | Text-overlap analysis results | **Annex B** |
| B7 | Authorship and provenance of Aura's text and drawings | **Annex C** |
| B8 | In-app attribution as implemented | **Annex D** |

**Not provided:** Aura's source code (available on request, subject to separate authorization).

## B2. Internal pre-assessment (not legal advice)

An internal licensing audit (AI-prepared, with a separate AI review; **not a human or legal review**) rated three items **unresolved**:
- C1 (adaptation / ShareAlike);
- C2 (consequences, conditional on C1);
- C3 (AI-generated content).

It found no high risk elsewhere. Publication of the guide is **on hold** pending your opinion and other gates. Nothing in that audit is a legal conclusion, and you should not rely on it as one.

## C. Legal questions

Please distinguish throughout between:
- protected expression;
- general ideas, historical concepts and facts;
- the meaning of public-domain texts;
- independently authored explanation.

### C1 (L1): Is it an adaptation, and does ShareAlike apply?

**Question.** Does Aura's existing paraphrased palmistry content constitute "Adapted Material" of the CC BY-SA 4.0 licensed source (B2), such that the ShareAlike conditions in §3(b) are triggered?

**Background:**
- CC BY-SA 4.0 §1(a) defines Adapted Material as material "derived from or based upon the Licensed Material … translated, altered, arranged, transformed, or otherwise modified **in a manner requiring permission** under the Copyright and Similar Rights held by the Licensor".
- §1(i) limits the Licensed Rights to rights "that apply to Your use".
- §2(a)(2) excludes uses covered by exceptions and limitations.

**How Aura used B2.** Aura's text was written in new words. It reports:
- what public-domain Sanskrit texts say, as rendered in Zysk's English translations;
- dates and attributions from Zysk's scholarship;
- two scholarly observations credited to Zysk by name.

No sentences, verses or figures were copied (Annex B). **The closest case** is the "upward line" entry (Annex A, row A1), which restates the finger-to-social-role meanings of two verses.

**Please advise:**
- (a) Whether each category in Annex A (A1–A6) uses protected expression of B2, or only facts, ideas and the meaning of public-domain texts.
- (b) Whether selecting and arranging information drawn from B2 creates any protected-expression concern.
- (c) Your conclusion and its confidence, for India and the US.

**These overlap results are evidence for your review. They are not a determination of infringement, non-infringement or adaptation status.**

### C2 (L2): Consequences if ShareAlike applies

If you conclude that any Aura content is Adapted Material, please advise in writing:

1. Which specific Aura passages are affected (by Annex A row or by PDF section).
2. Which CC BY-SA 4.0 obligations apply: §3(a) attribution and §3(b) ShareAlike.
3. The required licence notice(s) and where they must appear.
4. The required attribution wording, including the journal's acknowledgement request (B3).
5. The required disclosure of modifications.
6. Whether the affected material must be distributed under CC BY-SA 4.0 or a BY-SA-compatible licence.
7. Whether obligations extend beyond the affected Palmistry text (other app content, code, the app as a whole). Please don't assume they do.
8. The implications for commercial distribution. CC BY-SA permits commercial use, but §3(b)(3) prohibits offering or imposing additional or different terms, or applying effective technological measures, on Adapted Material that restrict exercise of the rights granted under the Adapter's License. This matters for app terms of service (none exist today) and for native app-store distribution.
9. Whether replacing or independently rewriting the affected passages would remove the obligations, and what independence that would require (for example, re-deriving from the public-domain Sanskrit or other sources).
10. The minimum remediation needed before publication.

Please separate **legal conclusions** from **business choices**: whether to accept BY-SA for the affected text, rewrite it, or seek permission is the product owner's decision.

### C3 (N3): AI-generated text and illustrations

Most of the Palmistry text and both illustrations were generated by an AI system (Annex C). Please advise, for India and the US:

1. Whether, and to what extent, copyright subsists in:
   - (i) AI-generated text;
   - (ii) AI-generated text selected, directed or edited by a human;
   - (iii) AI-generated drawings (vector code);
   - (iv) human-created or substantially modified drawings (none exist today);
   - (v) material derived from third-party references.
2. Who owns any such rights. Note that Aura's repository records the owner as committer, "co-authored" by the AI system.
3. Aura's right to use the material commercially, including under the AI provider's terms. [Owner to supply the applicable AI provider terms; not reviewed.]
4. Third-party rights risk: could AI output reproduce third-party material without anyone knowing? Annex B is the evidence available.
5. How AI authorship interacts with C1/C2. If Aura holds no copyright in some text, can it license that text under CC BY-SA if C2 requires it, and does that matter?
6. What provenance documentation Aura should keep (Annex C lists what exists and what's missing).

We don't assume that AI-generated content is automatically protected, or automatically free of third-party rights.

### C4: India and US jurisdiction

Please answer C1–C3 for **India and the United States**, using the matrix in Annex E. If you can't advise on one jurisdiction, please recommend where qualified local advice is needed. Please also tell us whether other jurisdictions should be considered: the licensor is affiliated with the University of Copenhagen, Denmark [owner/counsel to confirm residence], and the journal is published in Canada, and users may be in the EU/UK.

### C5: Related licensing items (optional opinion)

Your opinion is welcome on the following. Each keeps its own closure requirement in Aura's records:
- **L3:** is the in-app attribution (Annex D) sufficient under §3(a), including the journal's request?
- **L4:** is "Aura's text paraphrases this work" an adequate indication of modification?
- **L6:** compare the drawings (PDF Screenshots 03, 05, 06) with Zysk's figures (B2, Appendix II) for any derivation concern.

L5 (public-domain status of the 1884 translation), L7 (Sanskrit terms and locators) and L8 (the name "Palmistry" and the emoji icons) are low-risk and non-blocking. Comment only if you see an issue.

## D. Requested deliverable

A written opinion containing:
1. Conclusions on C1, C2 (if applicable), C3 and C4, each with supporting rationale.
2. A risk classification per conclusion (for example low / medium / high).
3. Required remediation before publication, if any, and any recommended remediation.
4. Unresolved questions, including any jurisdiction needing local advice.
5. Any assumptions you relied on, and any further facts you need from us.

Please reference document version G3 v1.1 / SHA-256 `d5fb7a1e…19a88` in your opinion.

**Deadline:** [agreed date]

## E. Confidentiality and use

- Private review only. No public distribution, and no onward sharing without written authorization.
- This brief grants no right to publish or reuse the material.
- [Confidentiality basis to be agreed at engagement: engagement letter / NDA / privilege, as counsel advises. A private channel alone does not create a binding confidentiality obligation.]

---

## Annex A: Source-to-Aura comparisons (representative, all categories)

Source quotations are short and come from B2 (© Kenneth G. Zysk, CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/) and B4 (1884). They are reproduced only to support legal review. The Aura text is the current unpublished wording.

| Row | Aura entry | Aura text (current) | Source text | Type of use |
|---|---|---|---|---|
| **A1** (closest case) | Upward line, "In this tradition" | "The Hastasañjīvana pairs each finger with a social role of its time: the forefinger with a king or minister, the middle finger with a general, the ring finger with a wealthy merchant or leader, and the little finger with renown. The Sāmudrikatilaka gives a similar scheme, including a king, army commander or preceptor for the middle finger." | Zysk tr. HS 3.2.81–82: "If it reached to the forefinger, he is a king or a king's minister; if it reached to the middle finger, he is a renowned army general." / "…to the refuge of Śiva (i.e., the ring finger), he is a rich merchant or military leader; and when the upward-going line reached the little finger, he is supported and is famous." Zysk tr. ST 1.152: "…reached the middle finger, it indicated a king, commander of an army, or a preceptor." | Restates the meaning and structure of translated verses in different words |
| A2 | Longevity line, "In this tradition" | "In this tradition, the line was associated with length of life, read from how far it reached toward the forefinger." | Zysk commentary on v. 3: "…the longevity line (āyūrekhā), which is the top-most line, closest to the fingers, which originates at the little finger…" Iyer 68.50: "Lines reaching the root of the forefinger indicate the age of the person to be 100…" | Concept and fact; Aura deliberately omits the numbers |
| A3 | Prosperity line | "An early Buddhist palmistry chapter … links the middle line with wealth and names it after a lunar asterism." | Zysk tr. v. 6: "(The line) that appears in between … should be known by the name of an asterism; and it is for the sake of man's wealth." | Summary of meaning |
| A4 | Barleycorn | "Historically, this mark was interpreted as a sign of prosperity. The Bṛhatsaṃhitā also links a barleycorn at the thumb's root with sons." | Iyer 68.42: "If, in the middle of the thumb, there be lines of the shape of a barley, the person will be rich; if the same be found at the root of the thumb, he will have sons." Zysk tr. v. 22: "…the barleycorn portends wealth" | Meaning of a PD translation and a CC BY-SA translation |
| A5 | Fish / Altar | Fish: "The Bṛhatsaṃhitā links two fish marks with feeding many people, and the early Buddhist chapter links the fish with drink, food and wealth." Altar: "Historically, this mark was associated with performing sacrificial rites." | Iyer 68.44: "…two marks of the shape of the fish in the middle of the palm, the person will daily feed many people." Iyer 68.48: "…of the shape of a Vedī (sacrificial altar), the person will perform sacrificial rites." Zysk tr. v. 22: "The fish portends drink … the Vedī-altar portends sacrifice" | Meaning; short functional phrases overlap |
| A6 | Credited scholarly observations | "Zysk notes that the fish appears twice in the early Buddhist chapter, which suggests two source traditions were merged." / "Zysk notes the verse stresses the princely or warrior class." / The palmistry chapter dated "after the mid-9th century". | Zysk's commentary (ideas and dating) | Ideas credited by name |

The full current wording of every entry is in PDF Section 4, with citations under each entry. The claim-by-claim citation ledger is PDF Section 5.3.

## Annex B: Text-overlap analysis (evidence, not a legal conclusion)

**Method.** Text was normalised (lower-case, diacritics stripped). The test found the longest run of consecutive identical words shared between each of 53 Aura strings and:
- the full text of B2;
- Iyer's chapters 68 and 70;
- Wikipedia "Palmistry", "Samudrika Shastra" and "Cheiro";
- a practitioner essay;
- two wisdomlib pages.

A second, separate AI agent re-ran the test and reached the same results within extraction differences. **Annexes A and B were prepared by AI agents and checked by another AI agent. Neither has been verified by a human expert.**

**Results:**
- **Maximum 11 consecutive words shared with any source:** "the right hand of men and the left hand of women", a conventional phrase stating a historical practice.
- All other matches are 6 words or fewer of conventional anatomical wording (for example "at the base of the thumb", "in the middle of the palm").
- **Maximum 3 consecutive words shared with Wikipedia.** No shared run of 4 or more words with the essay or the wisdomlib pages.
- **No third-party images are used.**

**Limitation.** The test detects verbatim and near-verbatim reuse only. It can't detect paraphrase of structure, selection or arrangement, which is the C1 question.

## Annex C: Authorship and provenance

| Item | What the records show | Evidence available | Missing |
|---|---|---|---|
| Owner-authored text | These strings appear verbatim in the product owner's written instructions (10 Nov 2026). The instruction text is taken to be the owner's own writing; that has not been independently established: the guide subtitle, the lead paragraph, the general disclosure, the Explore card description, and the first sentence of the longevity disclosure ("Aura does not estimate lifespan or predict death."). | Instruction records with timestamps | — |
| AI-generated text | All other entry text, context notes, Western comparisons and notes, drafted by an AI coding assistant (Claude) from the owner's product decisions. Revised in later AI passes after AI reviews. | Session transcripts; repository history (commits list the owner as author, "Co-Authored-By" the AI) | **No record of human line-editing** of the AI-drafted text. Human contribution is direction and decisions, and the strings above. |
| AI-generated drawings | The hand diagram and five mark symbols were written as vector (SVG) code by the AI on 10 Nov 2026 (created 06:03Z; edited 06:22Z after viewing screenshots of Aura's own UI only). They were based on verbal descriptions in the sources. No image of Zysk's figures was opened, rendered or extracted during research or drafting. | Transcripts (main and sub-agent); repository history | **No human visual comparison yet** (L6) |
| Third-party references | Zysk's figures (B2, Appendix II) come from various holders, including a 2002 book (fig. 5). Their rights are not established, and they are **not used**. | Zysk PDF | — |
| AI provider terms | — | — | **Owner to supply** |

## Annex D: In-app attribution (as implemented)

In the guide's Sources list, against the Zysk entry:

> Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā. Kenneth G. Zysk. 2025 (scholarly edition). History of Science in South Asia 13 (2025): 240–275. DOI 10.18732/hssa128. Source link © Kenneth G. Zysk, licensed under CC BY-SA 4.0; Aura's text paraphrases this work.

"Source link" links to the article page, and "CC BY-SA 4.0" links to the licence. Below the list: "All descriptions are Aura's own paraphrases. No translations or diagrams are reproduced." (PDF Section 9.1; Screenshot 07.)

## Annex E: India / US question matrix

| Topic | India: questions | United States: questions |
|---|---|---|
| Ownership principles | Who is the author and owner of AI-assisted text and drawings? | Same; and how does the human-authorship requirement apply to Aura's circumstances? |
| AI-generated works | Is AI output protectable, and if so, who is the author? | To what extent is AI-generated material protectable, and does human selection or arrangement qualify? |
| Derivative works / adaptations | Does restating a translation's meaning in new words infringe the translator's rights or count as an adaptation? | Same, under the derivative-work and idea/expression doctrines |
| Translation rights | Do Zysk's translations of PD Sanskrit have separate protection, and how far does it extend? | Same |
| Duration | Confirm the PD status of the 1884 Iyer translation (death January 1892, per secondary evidence) | Confirm PD status (published 1884) |
| Commercial publication | Is anything specific to commercial apps relevant? | Same |
| CC licence interpretation | How would courts read "Adapted Material" and ShareAlike? | Same |
| Cross-border distribution | Which law governs online content made available to users in India by a provider in another country (provider location: [owner to confirm])? Is advice needed for the EU/UK, Denmark (licensor's affiliation) or Canada (publisher)? | Same |
| Exceptions and limitations | Any relevant fair-dealing exception (education, criticism, review)? | Fair use relevance, if any |
