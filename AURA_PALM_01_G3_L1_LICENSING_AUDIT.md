# AURA-PALM-01-G3-L1: Palmistry Licensing Evidence Audit

**Date:** 2026-11-11 · **Type:** Read-only audit and documentation · **Prepared by:** Claude Code (Opus 5.5) for the product owner
**Baseline:** `AURA_PALM_01_G3_HUMAN_REVIEW_PACKAGE_v1.1.pdf`, SHA-256 `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88` (verified before starting; matches its reference copy). v1.0 (`988533d7…`) is kept as superseded evidence. Content revision `origin/main` @ `1741a95` (re-fetched; no Palmistry change).

> **This is not legal advice and not a licensing sign-off.** It records evidence and identifies questions that need a qualified human, and in two cases a lawyer. Nothing was changed, sent or published. Distribution: HOLD. Publication: HOLD. Merge freeze: ACTIVE.

---

## 1. Executive summary

**Verdict: CONDITIONAL GO, human review with restrictions.**

- **Controlled review distribution** of the frozen v1.1 PDF to named reviewers carries **low** licensing risk, under the conditions in §16.
- **Publication stays blocked** on four items (§11). The central one is a legal question that evidence cannot settle: is Aura's paraphrase of the meaning of Zysk's CC BY-SA 4.0 translations "Adapted Material", which would trigger ShareAlike (L1/L2)? The other three are the Adapter's License decision if it is, counsel's view on AI-generated content (N3), and Reviewer C's confirmation of attribution, modification notice and drawing originality (L3, L4, L6).
- **Recommendation:** Reviewer C should follow **Path B, external legal review** for L1, L2 and N3. An internal reviewer with Creative Commons expertise could close L3–L8 alone.

What the evidence shows:

1. **Licence verified.** The core modern source, Zysk 2025, is **CC BY-SA 4.0**, verified from the journal's article metadata (`DC.Rights`) and the PDF's front matter. Copyright belongs to the author. Commercial use is permitted by that licence, with conditions.
2. **No reproduction of source wording found.** An automated overlap test compared all 53 Aura content strings with the full text of Zysk 2025, Iyer's Bṛhatsaṃhitā chapters 68 and 70, three Wikipedia articles, a practitioner essay and two wisdomlib pages. **No string shares more than 11 consecutive words with any source.** The single 11-word match is the stock factual phrase "the right hand of men and the left hand of women". Every other match is 6 words or fewer of anatomical phrasing ("at the base of the thumb").
3. **The closest case is a paraphrase of a translation.** The *ūrdhvarekhā* text restates the meaning of Zysk's translation of Hastasañjīvana 3.2.81–82 and Sāmudrikatilaka 1.152–156 in Aura's own words. Whether that is an unprotected use of facts and ideas or an adaptation of the translation's expression is a legal judgement (§5).
4. **No third-party image is used.** The transcript shows the hand drawing and mark symbols were written directly as SVG code on 2026-11-10 (06:03Z), with no reference image opened or extracted.
5. **Documentation gaps, none blocking review:**
   - Background sources used in discovery (Wikipedia, also CC BY-SA; a wisdomlib study; a practitioner essay) are not in the source register.
   - The Iyer translator's death date rests on secondary evidence: a reprint preface, quoted by a bookseller, states he died in January 1892. Not yet confirmed from a primary or authority record.
   - Ownership of AI-generated text and drawings is unassessed (N3).

## 2. Source inventory and evidence ledger

Evidence codes:
- **E-J:** journal article page metadata, fetched 2026-11-11.
- **E-P:** Zysk 2025 PDF front matter (SHA-256 `bc1490f6…0cf9`).
- **E-L:** official CC BY-SA 4.0 legal code from creativecommons.org.
- **E-O:** overlap test (§8.2).
- **E-T:** I1/D1 session transcript (`b1121d49…jsonl`) **and its subagent transcripts**. The D1 web-fetch subagents returned text only; every image in the main transcript appears at or after 06:21:41Z, and all are screenshots of Aura's own app.
- **E-R:** repository files on `origin/main`.
- **E-W:** wisdomlib pages.
- **E-S:** web search.

| ID | Title | Author / creator | Date | Reference | Edition / translation | Licence | Rights holder | Usage in Aura | Transformation | Attribution (existing → required) | Risk | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S-01 | Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā | Kenneth G. Zysk | 2025 | HSSA 13: 240–275, DOI 10.18732/hssa128 | Critical edition + English translation + commentary + App. I excerpts | **CC BY-SA 4.0 (verified)** | Kenneth G. Zysk ("Copyright (c) 2025 Kenneth Zysk") | Facts, interpretations, dates, IAST terms, locators; *meaning* of translated verses (lines, marks, *ūrdhvarekhā* finger roles); two attributed scholarly observations ("Zysk notes…") | Paraphrase (max shared run 11 words, a stock phrase) | In-app: title, author, journal, DOI, link, "© Kenneth G. Zysk, licensed under CC BY-SA 4.0" + licence link + "Aura's text paraphrases this work" → sufficient if §3(a) applies (§9) | **UNRESOLVED** (L1) | E-J, E-P, E-L, E-O, E-R |
| S-02 | Śārdūlakarṇāvadāna, palmistry chapter | Anonymous Buddhist compilation | after mid-9th c. | via S-01 | Sanskrit via Zysk's edition; 1954 edition (emendation *gajachatra* → *rājachatra*) mentioned as a fact | Underlying text public domain (pre-modern). Edition/translation: see S-01 | — | Meanings via S-01 | Paraphrase via S-01 | Cited → covered by S-01 | LOW (underlying) | E-P |
| S-03 | Bṛhatsaṃhitā, chapters 68 and 70 | Varāhamihira | 6th c. | — | Sanskrit, not checked | Public domain (pre-modern) | — | Meanings via S-04 | Paraphrase | Cited → none required | LOW | E-R |
| S-04 | Bṛhatsaṃhitā, English translation | N. Chidambaram Iyer | 1884 (preface 1 Oct 1884; South Indian Press, Madura) | wisdomlib.org pages doc229330 / doc229332 | 1884 translation | **Public domain very likely.** US: published 1884 (pre-1931), so PD. Life+60/70 jurisdictions: the translator's brother's preface to the *Brihath Jathakam* reprint, quoted on a bookseller listing (exoticindiaart.com NAH830, fetched 2026-11-11), says he died in **January 1892**. If correct, the term expired everywhere long ago (life+70 would need him alive after about 1956). **Secondary evidence; unconfirmed** | Unknown (if any) | Meanings of 68.36–50, 70.10–14; **Iyer's footnote to 70.10** (source of the right/left-hand convention) | Paraphrase (max shared run 6 words, "in the middle of the palm") | Cited → courtesy only, since no expression is reproduced | LOW (no expression reproduced; PD very likely on secondary evidence) | E-W, E-S, E-O |
| S-05 | wisdomlib.org digital edition of S-04 | wisdomlib (host) | — | URLs above | Lists ISBN 9788171104215 (a modern reprint) | **No licence stated** on the pages checked | Host / reprint publisher (unknown) | Linked as "Source link"; no text copied | None | Link only | LOW | E-W, E-O |
| S-06 | Sāmudrikatilaka (excerpts) | Durlabharāja / Jagaddeva | 1160–1175 | via S-01 App. I | Zysk translation | Underlying PD; translation CC BY-SA (S-01) | — | Meaning of 1.143, 1.152–156 | Paraphrase via S-01 | Covered by S-01 | Part of L1 | E-P |
| S-07 | Hastasañjīvana (excerpts) | Meghavijaya Gaṇi (disputed) | late 17th c. | via S-01 App. I | Zysk translation | Underlying PD; translation CC BY-SA (S-01) | — | Meaning of 3.2.80–82 (*ūrdhvarekhā*) | Paraphrase via S-01 | Covered by S-01 | Part of L1 | E-P |
| S-08 | Hand diagrams, Zysk figs. 1–5 | Various | Fig. 1 undated (Spanish collection); fig. 2 1929 print; figs. 3–4 1732–48 MSS (Zysk collection; Banaras Hindu University); **fig. 5 from S. Miśra 2002** | S-01 App. II | — | **Not established.** The images may carry rights of their holding institutions or publishers, which the article's CC licence may not cover (fig. 5 is from a 2002 book) | Holding institutions / publishers | **Not reproduced.** Line labels described as facts | None (no image use) | Cited (figs. 1–3) → none required | LOW for current use | E-P, E-T |
| S-09 | Wikipedia: "Palmistry", "Samudrika Shastra", "Cheiro" | Wikipedia contributors | 2026 revisions | en.wikipedia.org | — | CC BY-SA 4.0 (Wikipedia text) | Contributors | Background research in D1 (Western palmistry history, scientific status) | Facts only. App strings share at most **3** consecutive words with these articles; the review PDF shares **0** runs of 7+ words | **Not in the source register** → none required for facts; record as research provenance | LOW (documentation) | E-O, D1 §B.2 |
| S-10 | "Palmistry Is Not in the Vedas…" | K. George (practitioner essay) | 2026 | Substack | — | Unknown | Author | D1 "pointer only" | **0 shared 4-word runs** | None → record as research provenance | LOW | E-O |
| S-11 | wisdomlib study on Meghavijaya's commentary; "Samudratilaka" definition | wisdomlib | — | wisdomlib.org | — | Unknown | Host / authors | Authorship caveat ("some catalogues treat him as the commentator…") in the Sources list | Fact; **0 shared 4-word runs** | None → record as research provenance | LOW | E-O, E-R |
| S-12 | Western chiromancy literature (d'Arpentigny 1839, Heron-Allen 1883, Cheiro, Benham 1900) | Various | 1839–1900 | via S-09 | — | Old works likely PD; not consulted directly | — | General statements ("popularised in 19th-century Europe", heart/head/life/fate lines, "mounts") | Facts | None | LOW | D1 §B.2 |
| S-13 | Zysk 2016, *The Indian System of Human Marks* (Brill) | K. G. Zysk | 2016 | — | — | Commercial publisher | Brill / author | **Not consulted**; named only as a research gap in the PDF | None | n/a | n/a | E-R |
| S-14 | Gārgīyajyotiṣa; Bhaviṣyapurāṇa; Garuḍapurāṇa | — | Early centuries CE to Purāṇic | Named in D1 §B.2 (S3, S4, S7) via Zysk/Wikipedia | — | PD (pre-modern) | — | **Named only; not read, not used** in content or PDF | None | None | n/a | D1 §B.2 |
| S-15 | wisdomlib Sanskrit Bṛhatsaṃhitā pages | wisdomlib | — | wisdomlib.org | — | Unknown | Host | **Not accessed** (HTTP 403 during research); not used | None | None | n/a | PDF §5.3 note |
| S-16 | K. C. Sen 1965 and other works named in Zysk's bibliography | Various | — | via S-01 | — | Not checked | Various | **Named only (not read, not used)** | None | None | n/a | E-P |
| A-01 | Schematic hand with 4 lines (inline SVG) | AI-generated (Claude Code, I1 session) | Created 2026-11-10 06:03:47Z; edited 06:22:48Z after viewing screenshots of Aura's own UI only | `apps/web/components/PalmHandDiagram.tsx` | — | Aura's own, subject to N3 | Aura (ownership of AI output not assessed) | Diagram | Original; informed by verbal descriptions | n/a | LOW infringement / N3 open | E-T, E-R |
| A-02 | 5 mark symbols (inline SVG) | Same | Same | Same file | — | Same | Same | Mark gallery | Original geometric glyphs | n/a | LOW / N3 | E-T |
| A-03 | Review screenshots 01–07 | Captured from Aura's local dev builds (01–05 at `aa56547`, 06–07 on 2026-11-11) | 2026 | `AURA_PALM_01_G1_REVIEW_PACKAGE_screenshots/`, `AURA_PALM_01_G2_REVIEW_SCREENSHOTS/` | — | Aura's UI; contain OS-rendered emoji and system text | Aura; emoji artwork belongs to the OS vendor | Review PDF only | — | n/a | LOW (internal review) | E-R |
| A-04 | Explore-card icons ✋ 📜 | Unicode characters | — | `ExploreView.tsx` | — | No asset shipped; rendered by the viewer's OS | — | App UI | — | n/a | LOW | E-R |
| A-05 | Fonts embedded in the review PDF (Arial family, Arial Unicode MS); also a **non-embedded** standard Helvetica reference (Type 1, generator default, no visible text) | Monotype (macOS system fonts); Helvetica is a viewer-supplied standard font | — | v1.1 PDF | — | Arial: embedding flag fsType 8 ("Editable"), which permits embedding; subsetted. Helvetica: not embedded, no licensing effect | Monotype | PDF typography | — | n/a | LOW | `pdffonts`, fontTools |

**Not used:** Zysk's figures, any Iyer or Zysk sentences, Wikipedia text, and photographs or third-party images in the app.

## 3. Licence verification matrix

| Source | Licence claimed in repo | Verified licence | Commercial use | Attribution required | Notice/URI required | Modification disclosure | ShareAlike |
|---|---|---|---|---|---|---|---|
| S-01 Zysk 2025 | CC BY-SA 4.0 | **CC BY-SA 4.0** (E-J `DC.Rights` "https://creativecommons.org/licenses/by-sa/4.0"; E-P "published under the provisions of the Creative Commons Attribution-ShareAlike 4.0 license") | Yes | Yes, **if** Aura's use needs permission (§3(a)) | Yes (§3(a)(1)(C)) | Yes (§3(a)(1)(B)) | Only for **Adapted Material** Aura shares (§3(b)) |
| S-02/S-06/S-07 underlying texts | PD | PD (pre-modern), not edition-specific | Yes | No | No | No | No |
| S-03 Bṛhatsaṃhitā | PD | PD | Yes | No | No | No | No |
| S-04 Iyer 1884 | PD | **Very likely PD** (US: 1884 publication; elsewhere: translator died January 1892 per secondary evidence, unconfirmed) | Yes (if PD) | No (if PD) | No | No | No |
| S-05 wisdomlib | "not relied on" | **No licence found** | n/a (no copying) | No | No | No | No |
| S-08 figures | "not reproduced" | **Not established** | n/a (no use) | n/a | n/a | n/a | n/a |
| S-09 Wikipedia | — (not recorded) | CC BY-SA 4.0 | n/a (facts only) | No for facts | No | No | No |
| A-05 Arial | — | Embeddable (fsType 8) | n/a | No | No | No | No |

The Zysk article front matter contains no separate warranty-disclaimer notice. §3(a)(1)(A)(iv) asks Aura to retain such a notice only "if it is supplied by the Licensor".

The journal's copyright terms (article page, fetched 2026-11-11) allow sharing "with an acknowledgement of the work's authorship and initial publication in this journal". This is a reasonable-manner request under §3(a)(1)(A)(i). The in-app citation names the author, the journal (*History of Science in South Asia* 13) and the DOI, so it appears satisfied; Reviewer C should confirm (L3).

## 4. L1–L8 finding-by-finding assessment

| ID | Original concern | Evidence | Rights issue | Current implementation | Still valid? | Required remediation | Human / legal review | Proposed closure evidence |
|---|---|---|---|---|---|---|---|---|
| **L1** | Is the paraphrase of Zysk's verse translations "Adapted Material" under CC BY-SA 4.0 (triggering ShareAlike), or a use of unprotected facts and ideas? | Licence verified. Overlap test: no string longer than 11 shared words, and the only long match is a stock phrase. The closest case is *ūrdhvarekhā*, a same-meaning restatement of Zysk's translation of PD Sanskrit in different words (§5.3). CC definition: Adapted Material requires modification "in a manner requiring permission" (E-L §1(a)). | Copyright in a translation's expression vs facts and ideas; differs by jurisdiction | Paraphrase + attribution + licence notice | **Yes, UNRESOLVED** | A legal determination. If adaptation: either license the affected passages under CC BY-SA 4.0 (L2), or re-derive them independently from PD sources with a Sanskritist (needs separate authorization), or seek Zysk's permission for different terms | **Legal (Path B)** | A written opinion from qualified counsel covering the jurisdictions where Aura publishes (at least India and the US; EU/UK if users there) |
| **L2** | If ShareAlike applies: which licence must Aura's text carry, and is that acceptable? | E-L §3(b): the Adapter's License must be BY-SA 4.0 or later, or BY-SA-compatible; include its URI; no additional terms or effective technological measures that restrict the licensed rights | Scope limited to the Adapted Material (the affected text), **not the app's code**, per the definition. Exact scope is a legal question | Not assessed | **Yes, conditional on L1** | Product decision + legal advice on the scope (which strings), the notice wording, and conflicts with any future terms of service or native-app DRM (none found today; the native shells load the web app by URL per D1) | Legal + product owner | Counsel's scope statement + product owner decision record |
| **L3** | Does the in-app attribution satisfy BY? | Code (E-R, `PalmistryView.tsx`): creator ✓, copyright notice ✓, licence notice + link ✓, URI to material (journal link + DOI) ✓, modification indication ✓ ("paraphrases"). No warranty notice was supplied by the licensor. Screenshot 07 shows the rendering. | §3(a) | Implemented | Valid until a reviewer confirms (low concern) | None expected. Reviewer confirms placement is "reasonable" (§3(a)(2)), as the notice appears only in the guide's Sources section, and that the journal's request for acknowledgement of "initial publication in this journal" is met (the journal is named). Optional: note §3(a)(3), the licensor's right to request removal of attribution | Internal licensing reviewer | Reviewer C confirms L3 against Screenshot 07 / Section 9.1 |
| **L4** | Does "Aura's text paraphrases this work" satisfy "indicate changes"? | §3(a)(1)(B) requires indicating modification; wording not specified | Notice adequacy | Implemented | Valid (low) | Optional stronger wording, e.g. "Aura's text is an original paraphrase based on this work". Decide at review; a change needs content authorization | Internal reviewer | Reviewer decision recorded |
| **L5** | Is the 1884 Iyer translation PD in target markets? | Published 1884 (catalogue/search); preface dated 1 Oct 1884; wisdomlib shows reprint ISBN 9788171104215; **secondary evidence that the translator died in January 1892** (brother's reprint preface, quoted on a bookseller page) | PD status by jurisdiction | Paraphrase only; max shared run 6 words | **Valid as a documentation gap**; reuse risk low because no expression is copied | Confirm the 1892 death date from a primary or authority record, or have the reviewer accept "no expression reproduced" + the secondary evidence as sufficient | Internal reviewer (legal only if Iyer text is ever quoted) | An authority record, or a recorded reviewer acceptance |
| **L6** | Are the hand drawing and mark symbols original and not derivative of Zysk figs. 1–5? | Transcript: SVG authored directly at 06:03Z; no image of the figures opened, rendered or extracted in D1/I1 | Derivative-work risk | Original SVG | Valid until a human visually compares (low) | Visual comparison of screenshots 03, 05, 06 with Zysk App. II | Internal reviewer | Reviewer's comparison recorded + transcript provenance excerpt filed |
| **L7** | Do Sanskrit/IAST terms, verse numbers and page locators raise any rights issue? | Single words and locators; facts | None identified | n/a | Low | None | Internal reviewer | Reviewer acceptance |
| **L8** | Any concern with the "Palmistry" name or the ✋ 📜 icons? | "Palmistry" is a generic English word; icons are Unicode characters rendered by the viewer's OS (no asset shipped) | Trademark / asset licence | n/a | Low | Optional trademark knock-out search if "Palmistry" becomes a branded product name | Internal reviewer | Reviewer acceptance |

None of L1–L8 is resolved by its absence from the PDF. Each needs the evidence listed.

**New findings (beyond L1–L8):**
- **N1:** Undeclared research sources (S-09 to S-11). LOW. Add a research-provenance appendix.
- **N2:** Rights in Zysk's figures are not established (S-08). LOW today; **HIGH if any figure is ever reproduced or traced**.
- **N3:** The text and drawings were AI-generated. Whether Aura owns copyright in them, and how that interacts with licensing them under BY-SA if L1 requires it, has not been assessed. UNRESOLVED, for counsel.
- **N4:** The review PDF contains short, attributed Zysk quotations (for example "after the middle of the ninth century CE", "renowned army general") and names CC BY-SA 4.0, but has no licence URI. LOW for controlled review; must be fixed before any *public* distribution of the PDF.
- **N5:** Screenshots contain OS-rendered emoji artwork. LOW for internal review; don't publish screenshots without checking.
- **N6:** No Aura terms of service were found. Any future terms must not restrict rights in CC BY-SA-licensed passages (relevant if L1 is decided as adaptation). NOTE.

## 5. CC BY-SA 4.0 analysis

### 5.1 Exact licence and conditions (from the official legal code, E-L)

| Element | Text / effect |
|---|---|
| Version | Attribution-ShareAlike 4.0 International |
| Scope of grant | "Licensed Rights … limited to all Copyright and Similar Rights that apply to Your use of the Licensed Material" (§1(i); corrected from "§1(h)" during G3-C review). Uses that need no permission are outside the licence. |
| Exceptions | "where Exceptions and Limitations apply to Your use, this Public License does not apply" (§2(a)(2)) |
| Adapted Material | Material "derived from or based upon the Licensed Material … translated, altered, arranged, transformed, or otherwise modified **in a manner requiring permission**" (§1(a)) |
| Attribution | §3(a)(1): (A) creator, copyright notice, licence notice, warranty-disclaimer notice (if supplied), URI to the material; (B) indicate modifications; (C) licence text or URI. §3(a)(2): may be satisfied "in any reasonable manner" |
| ShareAlike | §3(b): applies only "if You Share Adapted Material You produce". The Adapter's License must be BY-SA 4.0+ or compatible; include its URI; no additional terms or effective technological measures restricting the licensed rights |

### 5.2 Four kinds of use, distinguished

| Category | Present in Aura? | Licence consequence |
|---|---|---|
| **Citation** to a source | Yes: every entry and the Sources list | None. Citation is not use of expression and needs no permission |
| **Reuse of copyrighted expression** (verbatim or near-verbatim) | **Not in the app** (max 11-word stock phrase). The **review PDF** has short marked quotations of Zysk | If any app text were reused expression: BY conditions apply, no ShareAlike for verbatim sharing. For the PDF: the licence defines "Share" as providing material "to the public" (§1), so a private review to three named reviewers may not be Sharing at all. Even if it is, the licence permits it with attribution (the PDF names the author, journal, DOI and licence). Not concluded here |
| **Adaptation** of licensed material | **Possible**: *ūrdhvarekhā* finger roles; arguably the mark interpretations that follow Zysk's translations | **If** adaptation: BY + ShareAlike for those passages |
| **Independent original content informed by general ideas** | Most content: descriptions, disclosures, intro, context notes, Western comparisons | None from the licence. Attribution kept as scholarly practice |

### 5.3 The decisive comparison (*ūrdhvarekhā*)

| Aura (current, existing content) | Zysk translation (S-01, p. 264, HS 3.2.81–82) |
|---|---|
| "the forefinger with a king or minister, the middle finger with a general, the ring finger with a wealthy merchant or leader, and the little finger with renown" | "a king or a king's minister … a renowned army general … a rich merchant or military leader … supported and is famous" |

The meaning, and the finger-to-role structure, come from the public-domain Sanskrit. Aura's words differ ("wealthy" for "rich", "renown" for "famous", "general" for "renowned army general"). Two readings are possible:
- **Facts and ideas:** Aura reports what a PD text says, using its own wording. No permission is needed, so the licence doesn't bite.
- **Adaptation:** Aura's restatement is derived from the selection and phrasing of Zysk's translation, so it is Adapted Material.

The evidence can't decide between them. **This is the publication-blocking legal question.**

### 5.4 What ShareAlike would cover

If counsel finds adaptation:
- **Covered:** the adapted passages, plausibly the user-facing Palmistry interpretation strings and possibly the full content set. The adapter licenses "Your contributions", not other works.
- **Not covered:** Aura's application code, other features, or Aura as a whole. Nothing in the licence's definitions reaches separate works distributed alongside it.

Counsel should confirm the scope.

### 5.5 Distribution-model compatibility

| Model | Compatibility |
|---|---|
| Controlled review (named reviewers, private channel) | Compatible. Attribution is present; quotations are short and marked |
| Internal reference | Compatible |
| Public distribution of the PDF | Not authorized. Would need a §3(a)-complete notice for quoted material (add licence URI; N4) |
| Production publication in the app | Compatible **if** L1 = facts/ideas (attribution as is). If L1 = adaptation: compatible only with a BY-SA notice on the affected passages and no restrictive terms (L2, N6) |

## 6. Traditional texts and translations

| Layer | Status | Aura's reliance |
|---|---|---|
| Underlying historical material (Sanskrit texts S-02/S-03/S-06/S-07, traditional concepts, historical interpretations) | Public domain by age; underlying ideas are free to use | **Primary**: concepts, line and mark meanings, terminology |
| 1954 Śārdūlakarṇāvadāna edition | Modern edition; status not checked | Mentioned only as a fact (an emendation); nothing reproduced |
| Zysk 2025 critical edition, translation, commentary | **CC BY-SA 4.0** | Meanings, dates, scholarly observations (attributed), locators. Expression not reproduced (§8.2) |
| Iyer 1884 translation | Very likely PD (1892 death date on secondary evidence, unconfirmed) | Meanings only; expression not reproduced |
| wisdomlib digital edition (modern reprint) | No licence stated | Link only |
| Modern illustrations (Zysk figures, fig. 5 from 2002) | Not established | **Not used** |
| Rewritten explanations | Aura's own (AI-assisted; N3) | All user-facing text |

**Conclusion:** Aura relies on general traditional concepts and on the *meaning* conveyed by modern translations. It does **not** reproduce protected modern expression, by the overlap test's measure. Public-domain status was not inferred from antiquity: S-04 rests on its 1884 publication date and secondary evidence of the translator's 1892 death (unconfirmed), and S-05 and S-08 are "not established".

## 7. Illustration provenance audit

| Asset | Made for Aura? | Third-party reference? | Protected expression reproduced? | Licence permits use? | Attribution? | Disclose modification? | Replace to reduce risk? |
|---|---|---|---|---|---|---|---|
| A-01 Hand diagram | Yes (I1, 06:03Z, SVG code) | Informed by *verbal* descriptions (Zysk commentary, BS 70.13); **no image opened** (E-T) | No evidence of it; needs human visual check (L6) | n/a (own work) | No | No | Not indicated. Replacement wouldn't reduce a risk that isn't evidenced |
| A-02 Mark glyphs | Yes | Generic shapes (fish, conch, parasol, altar, barleycorn) | No | n/a | No | No | No |
| A-03 Screenshots 01–07 | Yes (own UI) | Contain OS emoji artwork and system text rendering | Emoji artwork belongs to the OS vendor (incidental, internal) | Internal review: yes. Publication: check first (N5) | No | No | Not for review use |
| A-04 Card emoji | n/a (characters) | OS-rendered | No asset shipped | Yes | No | No | No |
| A-05 PDF fonts | n/a | Monotype Arial | Embedded subsets | fsType 8 permits embedding | No | No | No |
| Zysk figs. 1–5 | — | — | **Not used** | Rights not established | — | — | **Never reproduce or trace without clearance (N2)** |

## 8. User-facing content review

### 8.1 Classification (49 content strings, 7 UI strings, 22 citations)

| Class | Where | Notes |
|---|---|---|
| 1. Factual / traditional concepts | Line and mark descriptions and positions; mark meanings; dates; IAST terms; locators | Free to use |
| 2. Original explanatory wording | Intro (lead, tradition, lines/marks, Western difference, limits), 4 disclosures/notes, context notes, Western comparisons, 7 UI strings | Aura's own wording |
| 3. Quotations | **None in the app.** Short single-word glosses ("the study of lines", "prosperity-mother", "family", "wealth") | Glosses of single terms; negligible |
| 4. Adaptations (possible) | *ūrdhvarekhā* interpretation; mark interpretations following Zysk/Iyer meanings | Subject to L1 |
| 5. Source-specific scholarly interpretations | "Zysk notes that the fish appears twice… two source traditions were merged"; "Zysk notes the verse stresses the princely or warrior class"; the dating of the chapter; the gajachatra emendation; uncertainty notes (for example "possibly Dhaniṣṭhā") | Ideas, credited to Zysk by name. Ideas aren't protected; attribution is appropriate and present |

Citations: the 22 entry citations credit S-01 to S-04 and S-06 to S-08 correctly. The Meghavijaya authorship caveat in the Sources list comes from wisdomlib (S-11) without credit. It's a fact, so this is LOW (N1).

### 8.2 Overlap test (method and result)

- **Method.** Text was normalised (lower-case, diacritics stripped, word tokens). For each of 53 Aura strings (49 content strings + intro title + 3 UI strings), the test found the longest contiguous shared word run against each source. Full Zysk 2025 text: 39 pages; extraction checked at 250–350 words per content page, with key passages present. Also tested: Iyer ch. 68 and 70 (wisdomlib), Wikipedia "Palmistry", "Samudrika Shastra" and "Cheiro", the Substack essay, and two wisdomlib pages.
- **Results.** Longest run per string, across all sources: 1 string at 11 words (the stock phrase), 5 at 6 words, 1 at 5, 5 at 4, 19 at 3, and 22 with no shared run of 3 or more words. Against Iyer: at most 6 words. Against Wikipedia: at most **3** words ("of the palm", "the 12th century", "of the early"). Against the essay and the wisdomlib study and definition pages: **0** runs of 4 or more words.
- **Review PDF v1.1:** about 5–7 runs of 7+ words shared with Zysk (the count depends on how line-split quotations extract), all bibliographic data (title, journal, DOI), the stock phrase, one marked quotation (8 words) and the Zysk 2016 title. Nothing with Iyer or Wikipedia.
- **Limitation.** This test detects verbatim and near-verbatim reuse only. It cannot detect close paraphrase of structure or selection, which is exactly the L1 question.

**Remediation recommendations (not applied):**
1. **No rewrite is indicated by the evidence so far.** Hold content changes until counsel answers L1.
2. If counsel finds adaptation, choose between licensing the affected passages under BY-SA 4.0 and re-deriving them from PD sources with a Sanskritist. Either needs separate content authorization.
3. Add a research-provenance appendix listing S-09 to S-11 (N1).

## 9. Attribution and notice requirements

| Requirement (CC BY-SA 4.0) | Applies if | Aura today | Gap |
|---|---|---|---|
| Creator identification (§3(a)(1)(A)(i)) | Use requires permission | "Kenneth G. Zysk" | None |
| Copyright notice (ii) | Same | "© Kenneth G. Zysk" | None |
| Notice referring to licence (iii) + licence URI (C) | Same | "licensed under CC BY-SA 4.0" linked to the licence | None |
| Warranty-disclaimer notice (iv) | Supplied by licensor | Not supplied in the article | None |
| URI to the material (v) | Same | Journal link + DOI | None |
| Indicate modification (B) | Same | "Aura's text paraphrases this work" | Adequacy to confirm (L4) |
| Adapter's License notice + URI (§3(b)(1)–(2)) | **Adapted Material shared** | Absent | **Required only if L1 = adaptation** |
| No restrictive terms or technological measures (§3(b)(3)) | Same | No terms of service found; web delivery | Check before adding terms or native packaging (N6) |
| Review PDF: licence URI for quoted Zysk passages | Public sharing of the PDF | Licence named; no URI | Fix before any **public** PDF distribution (N4) |

## 10. Risk register

| Risk ID | Finding | Class | Blocks review distribution? | Blocks publication? |
|---|---|---|---|---|
| R-01 | L1: ShareAlike / adaptation question | **UNRESOLVED** | No | **Yes** |
| R-02 | L2: Adapter's License scope and acceptability | **UNRESOLVED** (conditional on R-01) | No | **Yes, if R-01 = adaptation** |
| R-03 | N3: ownership of AI-generated text and drawings; effect on licensing | **UNRESOLVED** | No | Counsel to decide whether it blocks |
| R-04 | L5: Iyer PD status outside the US | LOW (no expression copied; 1892 death date on secondary evidence) | No | **No** (P2: close before publication by confirmation or reviewer acceptance) |
| R-05 | L3/L4: attribution and modification-notice adequacy | MEDIUM until reviewer confirmation. L3 on its own is low concern (all §3(a) elements present); the combined rating is MEDIUM because L4's wording adequacy is genuinely open | No | Yes, until Reviewer C confirms |
| R-06 | L6: drawing originality (human visual check pending) | LOW (evidence of independent creation) | No | Yes, until the reviewer confirms |
| R-07 | N2: rights in Zysk figures (fig. 5 from 2002) | LOW now; HIGH if ever reproduced | No | No |
| R-08 | N1: undeclared research sources | LOW (documentation) | No | No (recommended fix) |
| R-09 | N4: review PDF lacks licence URI for short quotations | LOW | No (controlled review) | n/a; blocks *public* PDF distribution |
| R-10 | N5: emoji artwork in screenshots | LOW | No | n/a (screenshots aren't published) |
| R-11 | L7: terms/locators | LOW | No | **No** (P2) |
| R-12 | L8: name/icons | LOW | No | **No** (P2) |
| R-13 | A-05: embedded fonts | LOW (embedding permitted) | No | n/a |
| R-14 | N6: future terms of service / native DRM vs ShareAlike | NOTE | No | Only if R-01 = adaptation and such terms are introduced |

No HIGH risk is present today. No unresolved item was downgraded without evidence.

## 11. Publication-blocking findings

1. **R-01 / L1:** the legal determination on adaptation vs facts and ideas.
2. **R-02 / L2:** if adaptation, the product decision on licensing those passages under BY-SA 4.0 (or the alternative remedies), with counsel's scope statement.
3. **Reviewer C sign-off on L3, L4 and L6** (R-05, R-06).
4. **R-03:** counsel's view on AI-generated content, at least whether it affects R-01/R-02.

Separately, publication also still needs the scholarly and editorial sign-offs, the governance records, approval-record authorization and explicit publication authorization. These are outside this audit.

**Should close before publication, not blocking (P2):** L5 (R-04: confirm the 1892 date or reviewer acceptance), L7 and L8 (R-11, R-12: reviewer acceptance).

**Non-blocking documentation improvements (P3):** N1 provenance appendix, licence URI in any future public PDF (N4), never using Zysk figures without clearance (N2).

## 12. Recommended remediation (proposed; none applied)

| # | Action | Type |
|---|---|---|
| 1 | Engage qualified external copyright counsel for L1, L2 and N3 (scope in §14) | Legal |
| 2 | Reviewer C (internal or the same counsel) completes L3–L8 using PDF v1.1 Section 9 and Screenshot 07 | Review |
| 3 | Record research provenance (S-09 to S-11) in the governance or docs record | Documentation |
| 4 | Confirm N. Chidambaram Iyer's January 1892 death date (secondary evidence) from a primary or authority record | Documentation |
| 5 | If counsel finds adaptation: product owner decides between a BY-SA notice on the affected passages, independent re-derivation, or seeking permission. Any content change needs separate authorization and reviewer re-confirmation | Decision |
| 6 | Before any public PDF release: add the licence URI next to the Zysk quotations or the source entry | Documentation (future version) |
| 7 | Policy: never reproduce or trace Zysk's figures without separate clearance of each image | Policy |

## 13. Reviewer C qualification requirements

| Requirement | For |
|---|---|
| Copyright law expertise including **derivative works, translations and the idea/expression distinction**, in the jurisdictions where Aura publishes (at least India and the US) | L1, L2, N3 |
| Working knowledge of **Creative Commons 4.0** (Adapted Material, ShareAlike scope, compatible licences) | L1–L4 |
| Familiarity with **AI-generated content and authorship** | N3 |
| Ability to compare visual works for derivation | L6 |
| Independence: no part in drafting the content | All |
| Authority to give a written opinion Aura may rely on (counsel), or a documented internal licensing role (internal reviewer) | Sign-off |

## 14. Internal vs external legal review

**Recommendation: Path B, external legal review, scoped to L1, L2 and N3.** L3–L8 may be closed by a qualified internal licensing reviewer, or by the same counsel.

Path A criteria vs evidence:

| Path A condition | Met? |
|---|---|
| All source licences identifiable | **Mostly.** S-01 is verified; S-05 and S-08 are not established but not used; S-04 is very likely PD (death date on secondary evidence) |
| Material reuse rights documented | Yes for reuse of expression (none found) |
| **ShareAlike obligations sufficiently clear** | **No** (L1) |
| No material legal ambiguity | **No** (L1, N3) |
| Attribution and notices straightforward | Yes (§9) |

Path B triggers present: **"ShareAlike obligations materially affect distribution"**, because the answer decides whether Aura's Palmistry text must be licensed BY-SA. **"Translation or adaptation rights are ambiguous"** also applies.

**Proposed counsel brief** (to be sent only with authorization, and only the material counsel needs):
1. Is restating, in original wording, the meaning of a CC BY-SA 4.0 translation of public-domain Sanskrit verses an adaptation requiring permission?
2. If so, what must the BY-SA notice cover?
3. Does AI generation affect Aura's ability to license the text, or its ownership?
4. Is the current attribution sufficient?

This audit is not legal sign-off.

## 15. Independent review findings

A separate AI agent reviewed this document after drafting. Its findings and dispositions are recorded in §17. **An AI review is not a substitute for qualified human or legal review.**

## 16. Final recommendation for controlled review distribution

### **CONDITIONAL GO: human review with restrictions**

Licensing does not block sending the frozen v1.1 PDF to designated reviewers, under these conditions:

1. Send only to the three **designated, named** reviewers, through an approved private channel. No public posting, shared links open to others, or third-party upload services. This matches the existing manifest.
2. Send v1.1 unchanged, with the confidentiality line already in the messages. The PDF credits Zysk 2025 and names CC BY-SA 4.0.
3. Make sure Reviewer C meets §13. For L1, L2 and N3, the review must be done or backed by external counsel (§14).
4. The PDF must not be distributed publicly in its current form (N4), and the screenshots must not be published (N5).
5. The product owner's distribution authorization (gate G3) is still required. This audit does not grant it.

**Publication remains HOLD** until §11 items 1–4 are closed with the evidence in the actions checklist.

**Proposed next authorization gate:** PALM-01-G3: (a) designate reviewers, including selecting external counsel for L1/L2/N3, and (b) authorize controlled distribution of v1.1 plus a counsel brief limited to the minimum necessary material.

---

## 17. Independent review (AI)

**Reviewer:** a separate AI agent with no part in drafting. It worked read-only, re-fetched the journal page, re-ran its own overlap test (results matched within extraction differences) and checked the transcripts and subagent transcripts for illustration provenance. **It is an AI review, not qualified human or legal review.**

**Verdict: ACCEPT WITH CHANGES.** No P0. It confirmed the CONDITIONAL GO, the publication HOLD and the Path B recommendation.

| # | Finding | Class | Disposition |
|---|---|---|---|
| P1-1 | Publication-blocker status of R-04, R-11 and R-12 was inconsistent between §10, §11 and the checklist | P1 | **Fixed.** L5, L7 and L8 are now P2 (close before publication, not blocking) everywhere; §11 item 3 is limited to L3, L4 and L6 |
| P2-1 | The executive summary said "one" legal question, but §11 lists four blockers | P2 | **Fixed** in §1 |
| P2-2 | A lead for Iyer's death date (January 1892) was available | P2 | **Verified** by fetching the bookseller page, which quotes the brother's preface. Recorded as secondary evidence; R-04 rated LOW; L5 kept open until confirmed or accepted |
| P2-3 | §15 referred to an empty §17 | P2 | **Fixed** (this section) |
| P2-4 | The journal's attribution request ("authorship and initial publication in this journal") was not recorded | P2 | **Verified** on the article page; recorded in §3 and in the L3 row. Appears satisfied |
| P3-a | Named-but-unused sources missing (Gārgīyajyotiṣa, Bhaviṣyapurāṇa, Garuḍapurāṇa, wisdomlib Sanskrit pages, K. C. Sen 1965, Iyer's 70.10 footnote) | P3 | **Added** (S-14 to S-16; footnote added to S-04) |
| P3-b | Provenance record should cite the subagent transcripts and the 06:22:48Z edit | P3 | **Added** to E-T and A-01 |
| P3-c | §5.2 framing of private review sharing | P3 | **Revised** to use the licence's "Share … to the public" definition |
| P3-d | PDF overlap count differs by extraction (5 vs 7) | P3 | **Stated as approximate** in §8.2 |
| P3-e | Non-embedded Helvetica not listed | P3 | **Added** to A-05 |
| P3-f | L3 "low concern" vs R-05 MEDIUM | P3 | **Explained** in R-05 |
| Note | Mention §3(a)(3) (licensor may request removal of attribution) | — | Added to the L3 row |


**Correction (2026-11-11, G3-C review):** the scope-of-grant quotation is from CC BY-SA 4.0 §1(i), not §1(h). Fixed in §5.1 (the only occurrence).
