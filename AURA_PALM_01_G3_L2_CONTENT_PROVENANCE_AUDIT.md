# AURA-PALM-01-G3-L2: Content Provenance Audit and Copyright Risk Reduction

**Date:** 2026-11-11 · **Type:** audit and remediation planning only. No content, code, illustration or PDF was changed.
**Baseline:** frozen PDF v1.1 (SHA-256 `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88`, verified). Content `origin/main` @ `1741a95` (re-fetched; unchanged).

> **This is not legal advice or legal clearance.** Statements about licence effect are design intent for a qualified reviewer to confirm. External legal review is deferred, not waived. Publication: HOLD. Merge freeze: ACTIVE.

**Path naming.** To avoid a clash with G3-L1 (where "Path A/B" meant internal vs external review), this audit uses:
- **L2-A:** independent baseline.
- **L2-B:** licence route.
- **L2-C:** legal review retained.

---

## 1. Executive summary

**Verdict: CONDITIONAL GO.** A viable remediation path exists, but it needs an owner decision, specific human reviews, and amendment of earlier governance records.

| Finding | Result |
|---|---|
| Strings analysed | 49 content strings (matrix §2), 7 UI strings, 22 citations, 2 visual assets, plus 24 further user-facing strings added after review (§2.3) |
| KEEP (independently supportable, or Aura/owner-authored) | **33 strings** |
| Depend, wholly or partly, on Zysk 2025 (CC BY-SA 4.0) for content Aura knows only through Zysk's translation or reporting | **16 strings** (rows 2, 6, 7, 11, 12, 13, 16, 17, 18, 22, 23, 26, 30, 34, 38, 39). Recommended: **RETAIN WITH LICENSE** |
| Current state | **L2-C** (L1/L2 unresolved) |
| Recommended target | **L2-B, licence route, with scope (a): the whole user-facing Palmistry text set.** Aura voluntarily licenses this text under CC BY-SA 4.0 and keeps the Zysk attribution |
| Design intent of L2-B | If the licensed text is the Adapted Material, licensing all of it under CC BY-SA 4.0 is *intended* to meet §3(b) whether or not any part counts as an adaptation, so L1 wouldn't need a determination. **The internal CC-qualified reviewer must confirm this; it is not a legal conclusion.** |
| L2-A (independent baseline) | Not achievable today without (i) a protectability/rights view on Zysk's edited Sanskrit text, or a PD-verified edition, and (ii) a clean-room Sanskritist (§10) |
| External legal review | May become **optional** for L1/L2 **only** by a written owner decision at gate L2-D, which would **supersede** earlier records (§1.1). N3 then becomes an owner risk-acceptance item, unless the owner keeps counsel for it |

### 1.1 Relationship to earlier decisions (supersession, if L2-D adopts the licence route)

| Earlier record | Currently says | Would change to |
|---|---|---|
| G3-C `AURA_PALM_01_G3_C_REVIEWER_REQUIREMENTS.md` §1A, rows L1 and N3 | "None. Counsel is required"; N3 fallback "None" | L1/L2: internal CC-qualified reviewer confirms the L2-B notice and scope; counsel optional. N3: owner written risk acceptance or counsel |
| G3-L1 actions LA-01, LA-03, LA-05 | Engage external counsel for L1, L2, N3 | Conditional: only if the owner selects L2-C, or wants assurance |
| G3-L1 audit §14 "Path B (external legal review)" | Recommended | Superseded for L1/L2 by L2-B if adopted |

**These records stand unchanged until the owner records L2-D.** At that point they must be amended in the same change, and the amendment cited. Nothing is amended by this audit.

## 2. Source dependency matrix (49 content strings)

**Abbreviations:**
- **BS:** Bṛhatsaṃhitā.
- **Iyer:** N. Chidambaram Iyer, 1884 translation.
- **ŚKA:** Śārdūlakarṇāvadāna palmistry chapter.
- **ST:** Sāmudrikatilaka.
- **HS:** Hastasañjīvana.
- **Zysk:** Zysk 2025, CC BY-SA 4.0.
- **RL:** RETAIN WITH LICENSE.

**Classification rule (applied uniformly after review):** any string that states what the ŚKA, ST or HS says is Zysk-dependent and classed **RL**. This applies even when the statement is a short cross-reference or comparison, because Aura's only access to those texts is through Zysk. KEEP is used only where the content is Aura/owner-authored, or fully supported by PD BS material, or is a fact or credited idea from scholarship. **The facts/ideas assumption is for the internal CC reviewer to confirm.** Under scope (a), all of these strings are licensed anyway.

| # | Content ID | Current wording (exact) | Concept | Source dependency | Rights status | Risk | Recommendation | Rationale | Proposed source | Review required | Publication impact |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ayurlekha.description | The uppermost of the main lines, closest to the fingers. The texts describe it as starting below the little finger and running toward the base of the forefinger. | Position of the longevity line | BS 70.13 (Iyer); Zysk commentary on ŚKA v.3 | PD support verified for the position (Iyer 70.13); Zysk used for facts | LOW | KEEP | Start and end of the line are stated in PD Iyer 70.13. "Uppermost of the main lines" comes from ŚKA/diagrams via Zysk (positional fact, low risk); "closest to the fingers" is functional wording. Covered by RL scope (a) in any case | Iyer 70.13; Kern 1865 Skt | Scholarly (re-cite) | Non-blocking |
| 2 | ayurlekha.interpretation | In this tradition, the line was associated with length of life, read from how far it reached toward the forefinger. The Bṛhatsaṃhitā and a later Buddhist palmistry chapter (compiled after the mid-9th century) both describe this idea. | Line read for length of life | BS 68.50 (Iyer); ŚKA vv.3, 6 (Zysk) | Core idea PD (Iyer 68.50); ŚKA clause known only via Zysk | UNRESOLVED (ŚKA clause) | RETAIN WITH LICENSE | The BS idea is PD-supported, but the claim that the ŚKA "also describes this idea" depends on Zysk's translation: the same class as rows 22/26/30/34. Covered by RL scope (a) | Iyer 68.50 + RL | Licensing; Scholarly (re-cite) | Blocking until RL adopted |
| 3 | ayurlekha.contextNote | The sources disagree on how the line was measured, which shows this was a scheme of interpretation, not a measurement. The term āyurlekhā appears in verse 6 of the early Buddhist chapter (and is an editor's suggested reading in verse 3); later diagrams label the line āyur-. | Measurement disagreement; attestation of the term | Zysk edition and commentary (philological facts) | Facts from scholarship; no PD alternative | LOW (facts) | KEEP | Statements of fact about texts and a modern edition; credited to sources; no expression reused (max overlap 5 words) | Retain Zysk citation (attribution kept) | Scholarly; Licensing | Non-blocking |
| 4 | ayurlekha.westernComparison | Western palmistry calls a crease in roughly this position the "heart line" and reads it differently. It is not the Western "life line". | Western comparison (positional mapping) | Aura analysis + general Western palmistry knowledge | Aura/general | LOW | KEEP | Aura's own comparative statement; no source expression (max 3-word Wikipedia overlap) | — | Scholarly (Q10) | Non-blocking |
| 5 | ayurlekha.tradition | Indian (classical) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 6 | dhanamatrlekha.description | A line in the middle of the palm, between the longevity line above and the father or knowledge line below. | Position of the middle line | ŚKA v.6 (Zysk); diagrams | ŚKA route via Zysk only | UNRESOLVED (low expression risk) | RETAIN WITH LICENSE | An anatomical position, but it is known only from ŚKA v.6 and diagrams as reported by Zysk. Same source class as row 7. Covered by RL scope (a) | RL | Licensing | Blocking until RL adopted |
| 7 | dhanamatrlekha.interpretation | An early Buddhist palmistry chapter (after the mid-9th century) links the middle line with wealth and names it after a lunar asterism. Later hand diagrams label it the "prosperity-mother" line. | Middle line linked with wealth and named after an asterism; diagram label | ŚKA v.6 (meaning via Zysk tr. only); diagram labels as described by Zysk | **No verified PD route.** ŚKA Sanskrit is PD, but accessible editions (Mukhopadhyaya 1954; Cowell–Neil 1886 coverage unverified) are UNRESOLVED; the only English is Zysk (CC BY-SA) | UNRESOLVED | RETAIN WITH LICENSE | Restates the meaning of a verse known to Aura only through Zysk's translation. Independent rewrite needs a PD-verified Sanskrit source, not yet available. Removal would empty a core line entry. Voluntary CC BY-SA licensing resolves the adaptation question by construction. REWRITE (independent Sanskritist) is the alternative once a PD edition is verified | Alt: Sanskritist reading of PD manuscripts / PD-verified edition | Licensing; Scholarly if rewritten | Blocking until RL adopted or REWRITE done |
| 8 | dhanamatrlekha.contextNote | The compound name comes from the later diagrams, whose spellings vary. Which asterism the early text means is uncertain (possibly Dhaniṣṭhā). Historically "wealth" meant fortune in general, not a forecast of anyone's finances. | Name from diagrams; asterism uncertain; "wealth" framing | Zysk commentary (facts) + Aura framing (W2) | Facts | LOW (facts) | KEEP | Facts credited to the source; W2 pending (unsourced framing sentence) | Retain Zysk citation | Scholarly; Editorial (W2) | Non-blocking |
| 9 | dhanamatrlekha.westernComparison | Western palmistry calls a crease in a similar place the "head line" and gives it a different meaning. | Western comparison (positional mapping) | Aura analysis + general Western palmistry knowledge | Aura/general | LOW | KEEP | Aura's own comparative statement; no source expression (max 3-word Wikipedia overlap) | — | Scholarly (Q10) | Non-blocking |
| 10 | dhanamatrlekha.tradition | Indian (early Buddhist text; later diagrams) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 11 | pitrlekha.description | A line that rises from the base of the thumb near the wrist. The 12th-century Sāmudrikatilaka describes the first lines of the palm as reaching between the thumb and forefinger. | Position of the father/knowledge line; ST 1.143 description | ŚKA v.2 (Zysk); ST 1.143 (Zysk tr. only) | ST/ŚKA route: UNRESOLVED (no PD-verified edition) | UNRESOLVED | RETAIN WITH LICENSE | Second sentence closely tracks Zysk's translation of ST 1.143 ("reaching between the thumb and forefinger"). Position sentence is a fact | Alt: rewrite ST sentence from a PD-verified ST edition, or drop it | Licensing; Scholarly if rewritten | Blocking until RL/REWRITE |
| 12 | pitrlekha.interpretation | The early Buddhist palmistry chapter calls this a line of knowledge. Later hand diagrams name it the father's line, and one links it with Sarasvatī, the goddess of learning. | Called a line of knowledge; diagrams: father's line, Sarasvatī | ŚKA v.2 (jñāna, via Zysk); diagram labels via Zysk commentary | UNRESOLVED (as above) | UNRESOLVED | RETAIN WITH LICENSE | Meaning of a PD verse known only through Zysk; single-word glosses. Low expression risk, but provenance runs only through the CC BY-SA work | Alt: Sanskritist confirmation from PD source | Licensing; Scholarly if rewritten | Blocking until RL/REWRITE |
| 13 | pitrlekha.contextNote | The sources say little about how this line was read in detail. It was a traditional label, not a measure of intelligence, ancestry or character. The 12th-century Sāmudrikatilaka groups three lines as concerning family, wealth and longevity; whether its "family" line is this father line awaits expert review. | Little detail; not a measure of intelligence; ST 1.143 three lines (family, wealth, longevity) | Aura framing + ST 1.143 (Zysk tr.) | ST list via Zysk only | UNRESOLVED | RETAIN WITH LICENSE | The ST clause restates the list in Zysk's translation ("family, material wealth, and longevity"). The rest is Aura framing | Alt: drop the ST clause or rewrite from PD-verified ST | Licensing; Scholarly | Blocking until RL/REWRITE |
| 14 | pitrlekha.westernComparison | Western palmistry calls a crease curving round the thumb the "life line". In the Indian texts, the line linked with life is the longevity line at the top of the palm instead. | Western comparison (positional mapping) | Aura analysis + general Western palmistry knowledge | Aura/general | LOW | KEEP | Aura's own comparative statement; no source expression (max 3-word Wikipedia overlap) | — | Scholarly (Q10) | Non-blocking |
| 15 | pitrlekha.tradition | Indian (early Buddhist text; later diagrams) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 16 | urdhvarekha.description | A line rising from the wrist toward the fingers. Its course varies: the texts describe it ending at different fingers. | Line from wrist toward fingers; course varies | BS 70.12 (Iyer: middle finger only); HS/ST (Zysk) for varying endings | Partly PD (wrist to middle finger); "ending at different fingers" via Zysk only | UNRESOLVED (clause) | RETAIN WITH LICENSE | Iyer 70.12 supports only the wrist-to-middle-finger course. The varying endings come from HS/ST via Zysk, the same source as row 17. Covered by RL scope (a) | Iyer 70.12 + RL | Licensing; Scholarly | Blocking until RL adopted |
| 17 | urdhvarekha.interpretation | Later treatises read this line by the finger it reaches. The Hastasañjīvana pairs each finger with a social role of its time: the forefinger with a king or minister, the middle finger with a general, the ring finger with a wealthy merchant or leader, and the little finger with renown. The Sāmudrikatilaka gives a similar scheme, including a king, army commander or preceptor for the middle finger. | Finger-by-finger social roles (HS 3.2.81–82; ST 1.152–156) | HS and ST via Zysk tr. only | HS: Pratāpa Muni ed. 1929 (US PD by date; India UNRESOLVED); Miśra 2002 protected. ST: edition UNRESOLVED | UNRESOLVED | RETAIN WITH LICENSE | The closest case (G3-L1 §5.3): restates the structure and meaning of Zysk's translations. Options: RL (resolves L1 by construction); REWRITE from a PD-verified HS/ST edition by a qualified Sanskritist; or REMOVE the finger scheme and keep only the PD-supported BS 70.12 idea (line to the middle finger = royal status). Removal loses product depth | Alt: Pratāpa Muni 1929 (after rights check) + Sanskritist; fallback BS 70.12 | Licensing; Scholarly; Editorial (if removed/rewritten) | Blocking until RL/REWRITE/REMOVE |
| 18 | urdhvarekha.contextNote | The drawing shows one possible course, ending at the middle finger. These readings describe the status categories of medieval society; the Sāmudrikatilaka (1.154) even varies them by social class. For Sāmudrikatilaka 1.155, the Sanskrit names the ring finger while the English translation says forefinger, an open question for expert review. | Drawing note; medieval status categories; ST 1.154 by social class; ST 1.155 discrepancy | Aura framing; ST 1.154 (Zysk tr.); fact about Zysk's translation (1.155) | ST 1.154 via Zysk only; the 1.155 note is a fact about a published translation | UNRESOLVED (ST 1.154 clause) | RETAIN WITH LICENSE | The 1.155 note is commentary on Zysk's translation (fact, attributed). The 1.154 clause restates translated meaning. W3 is pending | Alt: drop or rewrite the ST 1.154 clause | Licensing; Scholarly; Editorial (W3) | Blocking until RL/REWRITE |
| 19 | urdhvarekha.westernComparison | Western palmistry splits similar vertical lines into a "fate line" and a "sun line". The Indian treatises treat them as one upward line read by where it ends. | Western comparison (positional mapping) | Aura analysis + general Western palmistry knowledge | Aura/general | LOW | KEEP | Aura's own comparative statement; no source expression (max 3-word Wikipedia overlap) | — | Scholarly (Q10) | Non-blocking |
| 20 | urdhvarekha.tradition | Indian (12th- and 17th-century treatises) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 21 | yava.description | A small mark shaped like a grain of barley, usually described on or at the base of the thumb. | Barley-grain mark on/at base of thumb | BS 68.42 (Iyer) | PD | LOW | KEEP | Supported by PD Iyer 68.42 | Iyer 68.42 | Scholarly (re-cite) | Non-blocking |
| 22 | yava.interpretation | Historically, this mark was interpreted as a sign of prosperity. The Bṛhatsaṃhitā also links a barleycorn at the thumb's root with sons. An early Buddhist palmistry chapter (after the mid-9th century) uses its position on the thumb in omens about the time of birth. | Prosperity; sons at thumb root; ŚKA birth-time omens | BS 68.42 (Iyer: PD) + ŚKA vv.9–15, 22 (Zysk) | BS parts PD; ŚKA clause via Zysk only | UNRESOLVED (ŚKA clause) | RETAIN WITH LICENSE | The first two sentences are fully PD-supported (Iyer 68.42: "rich", "sons"). The ŚKA birth-time clause restates Zysk-translated content. W1 is pending | Iyer 68.42 for the BS parts; alt: drop the ŚKA clause | Licensing; Scholarly; Editorial (W1) | Blocking until RL/REWRITE |
| 23 | yava.contextNote | Interpretations vary across sources, and the early Buddhist chapter alone gives several different readings. | Interpretations vary; ŚKA gives several readings | ŚKA vv.9–15 (Zysk) | Statement about ŚKA content known via Zysk only | UNRESOLVED (low expression risk) | RETAIN WITH LICENSE | A general statement, but about ŚKA content known only through Zysk. Covered by RL scope (a) | RL | Licensing | Blocking until RL adopted |
| 24 | yava.tradition | Indian (classical) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 25 | matsya.description | A mark shaped like a fish. The Bṛhatsaṃhitā places it in the middle of the palm; some later diagrams draw it just above the wrist. | Fish mark; BS mid-palm; later diagrams above wrist | BS 68.44 (Iyer); diagram position as described by Zysk | PD + fact | LOW | KEEP | BS position is PD; the diagram position is a fact (attributed) | Iyer 68.44 | Scholarly (re-cite) | Non-blocking |
| 26 | matsya.interpretation | The texts associate the fish with abundance. The Bṛhatsaṃhitā links two fish marks with feeding many people, and the early Buddhist chapter links the fish with drink, food and wealth. | Abundance; BS two fish feed many; ŚKA drink, food, wealth | BS 68.44 (Iyer: PD) + ŚKA vv.15, 22 (Zysk) | ŚKA clause via Zysk only | UNRESOLVED (ŚKA clause) | RETAIN WITH LICENSE | The BS clause is PD-supported; the ŚKA clause restates Zysk-translated content | Iyer 68.44; alt: drop the ŚKA clause | Licensing; Scholarly | Blocking until RL/REWRITE |
| 27 | matsya.contextNote | The sources disagree on the fish's meaning and its position. Zysk notes that the fish appears twice in the early Buddhist chapter, which suggests two source traditions were merged. | Disagreement; Zysk's two-traditions observation | Zysk commentary (idea, credited by name) | Idea, credited | LOW | KEEP | A scholarly idea credited to Zysk by name; ideas are not expression; attribution kept | Retain Zysk citation | Licensing (attribution) | Non-blocking |
| 28 | matsya.tradition | Indian (classical) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 29 | shankha.description | A mark shaped like a conch shell. The sources do not fix one position on the palm. | Conch mark; no fixed position | Aura summary | Fact | LOW | KEEP | General | — | — | Non-blocking |
| 30 | shankha.interpretation | The conch is one of the "royal" marks. The Bṛhatsaṃhitā lists it among signs of kingship, and the early Buddhist chapter names a king as one whose palms show a conch together with a parasol, a wheel and an elephant's foot. | Royal mark; BS kingship; ŚKA king with conch, parasol, wheel, elephant's foot | BS 68.45, 70.10 (Iyer: PD) + ŚKA v.21 (Zysk) | ŚKA clause via Zysk only | UNRESOLVED (ŚKA clause) | RETAIN WITH LICENSE | The BS part is PD-supported; the ŚKA clause lists the items in Zysk's translation of v.21 | Iyer 68.45, 70.10; alt: drop the ŚKA clause | Licensing; Scholarly | Blocking until RL/REWRITE |
| 31 | shankha.contextNote | Royal marks reflect ideals of kingship in early Indian society; the conch is also a familiar symbol in Indian art and ritual. Zysk notes the verse stresses the princely or warrior class. | Royal ideals; conch symbolism; Zysk's princely/warrior note | Aura framing + Zysk commentary (credited) | Idea, credited | LOW | KEEP | Framing plus a credited idea | Retain Zysk citation | Licensing (attribution) | Non-blocking |
| 32 | shankha.tradition | Indian (classical) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 33 | chatra.description | A mark shaped like a parasol or umbrella, the traditional canopy held over royalty. The sources do not fix one position on the palm. | Parasol mark; no fixed position | Aura summary; BS ("umbrella") | Fact | LOW | KEEP | General | Iyer 68.45 | — | Non-blocking |
| 34 | chatra.interpretation | Like the conch, the parasol belongs to the royal marks. The Bṛhatsaṃhitā lists it among signs of kingship for men and queenship for women, and the early Buddhist chapter pairs it with the conch as a king's mark. | Royal mark; BS kingship/queenship; ŚKA pairs with conch | BS 68.45, 70.10 (Iyer: PD) + ŚKA v.21 (Zysk) | ŚKA clause via Zysk only | UNRESOLVED (ŚKA clause) | RETAIN WITH LICENSE | As for the conch | Iyer 68.45, 70.10; alt: drop the ŚKA clause | Licensing; Scholarly | Blocking until RL/REWRITE |
| 35 | chatra.contextNote | In verse 21 the manuscripts read an "elephant parasol"; the 1954 editor emended this to "king's parasol". The term appears there inside that compound. | Manuscript reading "elephant parasol"; 1954 emendation | Zysk apparatus (philological facts) | Facts from a modern edition | LOW (facts) | KEEP | States textual facts with glosses of Sanskrit compounds; attributed | Retain Zysk citation | Scholarly; Licensing | Non-blocking |
| 36 | chatra.tradition | Indian (classical) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 37 | vedi.description | A mark shaped like a Vedic sacrificial altar. The Bṛhatsaṃhitā places it at the root of the thumb. | Altar mark at the thumb root | BS 68.48 (Iyer) | PD | LOW | KEEP | PD-supported | Iyer 68.48 | Scholarly (re-cite) | Non-blocking |
| 38 | vedi.interpretation | Historically, this mark was associated with performing sacrificial rites. Both the Bṛhatsaṃhitā and the early Buddhist chapter describe it this way. | Associated with sacrificial rites (BS and ŚKA) | BS 68.48 (Iyer: PD); ŚKA v.22 (Zysk) | Meaning PD-supported; ŚKA clause via Zysk | UNRESOLVED (ŚKA clause) | RETAIN WITH LICENSE | The meaning is in PD Iyer 68.48, but "both … and the early Buddhist chapter describe it" depends on Zysk's v.22. Covered by RL scope (a) | Iyer 68.48 + RL | Licensing; Scholarly (re-cite) | Blocking until RL adopted |
| 39 | vedi.contextNote | The meaning reflects the ritual life of early India. The two sources agree on the association; only the Bṛhatsaṃhitā gives a position. | Ritual life; sources agree; only BS gives position | Aura framing; comparison relies on ŚKA v.22 via Zysk | Comparison depends on Zysk | UNRESOLVED (low expression risk) | RETAIN WITH LICENSE | "The two sources agree" is a comparison resting on ŚKA content known only via Zysk. Covered by RL scope (a) | RL | Licensing | Blocking until RL adopted |
| 40 | vedi.tradition | Indian (classical) | Tradition label | Aura label | Aura | LOW | KEEP | Aura classification label | — | — | Non-blocking |
| 41 | intro.lead | Explore how historical Indian texts described lines and symbols on the palm. Select a feature to learn about its traditional interpretation and the sources behind it. | Guide purpose | Owner-authored (ticket) | Owner | LOW | KEEP | Owner's own text | — | — | Non-blocking |
| 42 | intro.tradition | Indian texts on reading the hand, which scholars group under Rekhāśāstra ("the study of lines"), belong to a wider tradition of reading marks on the whole body. Early descriptions of the hand appear in the Bṛhatsaṃhitā (6th century) and in a Buddhist text whose palmistry chapter was compiled after the mid-9th century. Fuller treatises followed in the 12th and 17th centuries. | Rekhāśāstra; dates of texts | Zysk (scholarly usage and dates: facts) | Facts | LOW (facts) | KEEP | Dates and terminology as facts, credited; Q12/Q13 with Reviewer A | Retain Zysk citation | Scholarly | Non-blocking |
| 43 | intro.linesAndMarks | The texts read two kinds of features: lines, which they apply to everyone, and shaped marks such as a fish or a parasol, which mostly signal royal or high status. Interpretations differ between texts, and Aura shows those differences rather than resolving them. | Lines vs marks; royal marks | Aura synthesis | Aura | LOW | KEEP | Synthesis | — | Scholarly | Non-blocking |
| 44 | intro.westernDifference | Western palmistry, as popularised in 19th-century Europe, uses different names (heart, head, life and fate lines) and planetary "mounts". Its labels do not translate the Indian terms: the same crease can carry a different name and meaning in each system. | Western palmistry differs | General knowledge (Wikipedia-informed; max 3-word overlap) | Facts | LOW | KEEP | General facts; no expression reused | — | Scholarly (Q10) | Non-blocking |
| 45 | intro.limits | These are descriptions of what historical texts said, in the social world they came from. They are not claims about you. | Limits | Aura | Aura | LOW | KEEP | Aura framing | — | Editorial | Non-blocking |
| 46 | disclosure.general | Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events. | General disclosure | Owner-authored | Owner | LOW | KEEP | Owner's own text | — | Editorial (W4) | Non-blocking |
| 47 | disclosure.longevity | Aura does not estimate lifespan or predict death. This entry explains a historical idea only. | Longevity disclosure | Owner (first sentence) + Aura | Owner/Aura | LOW | KEEP | Own text | — | Editorial | Non-blocking |
| 48 | disclosure.diagram | A schematic drawing, not a real hand. Line positions follow how the sources describe them and are approximate. Real hands vary, and no hand needs to show every feature. | Diagram caption | Aura | Aura | LOW | KEEP | Own text | — | Editorial | Non-blocking |
| 49 | disclosure.hand | Indian palmistry texts traditionally examined the right hand of men and the left hand of women. The drawing shows a right hand only to illustrate; Aura does not ask which hand you use or infer anything about you. | Men right / women left convention | Iyer footnote to BS 70.10 (PD); Zysk p.241 | PD support | LOW | KEEP | Supported by the Iyer footnote to 70.10, seen only in the wisdomlib transcription of a modern reprint: check it against the 1884 original. Shares an 11-word conventional phrase with Zysk; Reviewer B may reword (optional) | Iyer footnote 70.10 | Editorial (optional) | Non-blocking |

### 2.1 UI strings (7, as inventoried in G2)

| ID | Wording | Provenance | Recommendation |
|---|---|---|---|
| card.kicker | "Palmistry" | Owner ticket | KEEP |
| card.action | "Learn the lines of the hand" | Aura | KEEP |
| card.description | "Explore traditional Indian interpretations of palm lines and symbols." | Owner ticket | KEEP |
| card.footer | "Traditional knowledge · no photo needed" | Aura | KEEP |
| marks note | "Marks are shown as symbols, not placed on a hand: …" | Aura | KEEP |
| sources footnote | "All descriptions are Aura's own paraphrases. No translations or diagrams are reproduced." | Aura | KEEP. Under L2-B it must sit alongside the Aura licence notice (plan R-3) |
| review notice | "Preview content: awaiting review by a qualified scholar before public release." | Aura | KEEP (shown only until approval) |

### 2.2 Citations (22)

All stay. Remediation adds PD primary citations (Iyer 1884 original edition / Kern 1865) for BS-supported statements, and **keeps** Zysk citations and the licence notice. Under CC BY-SA §3(a)(1), a citation or link **without** the licence notice is not enough; the existing notice must remain.

### 2.3 Additional user-facing strings (added after independent review)

| Strings | Provenance | Dependency | Recommendation |
|---|---|---|---|
| Entry titles (9): "Longevity line", **"Prosperity line (mother line)"**, **"Father line (knowledge line)"**, "Upward line" (owner), "Barleycorn", "Fish", "Conch shell", "Parasol", "Altar" | Aura (+ owner for "Upward line") | The glosses "(mother line)" and "(knowledge line)" and "Prosperity" come from diagram labels and ŚKA v.2, known only via Zysk | KEEP for plain English names; **RL** for the two glossed titles (covered by scope a) |
| `traditionalName` values (9 IAST terms) | Sanskrit terms | Facts (L7) | KEEP |
| intro.title "Discover the traditions of Indian palmistry" | Owner ticket | — | KEEP |
| Attribution badges (4): "Classical source", "Later tradition", "Modern interpretation", "Source uncertain"; tradition-confidence labels | Aura | — | KEEP |
| UI labels: "Where", "In this tradition", "Context and uncertainty", "Western palmistry, for comparison", "Sources", "Overview", "About this guide", "About this tradition", "Indian and Western palmistry", "Which hand?", "Traditional marks", "Lines", "Marks", "All features", "Selected", "Back to overview", "Back to Explore", "Choose a line or mark from the list below.", "That feature isn't available.", "Palmistry content is unavailable", "Please check back later.", "Showing: …" | Aura | — | KEEP |

**Scope (a) covers all of the above. Scope (b) (licensing only specific strings) is withdrawn** (§3).

## 3. L1/L2 risk assessment

| Category | Strings | L1 risk | L2 consequence |
|---|---|---|---|
| Aura- or owner-authored | 21 | LOW | None (licensed under scope a) |
| PD-BS-supported meaning (Iyer/Kern) | 6 | LOW (independent PD route) | None from BS |
| Facts/credited ideas from Zysk's scholarship | 6 | LOW on the facts/ideas assumption | Attribution kept; licensed under scope a |
| **Content known only via Zysk** | **16** | **UNRESOLVED** | ShareAlike would apply if they are adaptations; scope (a) licensing is intended to satisfy it |

**Why scope (b) is withdrawn.**
- §3(b)(1) applies the Adapter's License to the Adapted Material as a whole.
- The dependent clauses are spread across sentences and entries. Licensing selected clauses risks under-licensing and is impractical to mark.
- Scope (a), the whole user-facing Palmistry text set, avoids both problems and removes the need for the facts/ideas assumption.

**Remediation consequences (none is a legal determination):**
- **KEEP:** Zysk attribution kept where Zysk facts remain.
- **REWRITE (independent):** removes dependency only through a documented independent route (§10, L2-A). **Rewording Zysk-derived text from Zysk is not independent.**
- **REMOVE:** removes the dependency for that clause, at a product cost (§6).
- **RETAIN WITH LICENSE, scope (a).** Intended obligations, for the reviewer to confirm:
  - (i) keep the Zysk attribution (§3(a)(1): creator, © notice, licence notice, source link; modification indicated, with L4 wording review);
  - (ii) an Aura CC BY-SA 4.0 notice and licence link on the Palmistry text (§3(b)(2));
  - (iii) no additional terms or effective technological measures on that text (§3(b)(3); see also §2(a)(5)(C));
  - (iv) **the grant is irrevocable (§2(a)(1))**, so anyone, including competitors, may reuse the licensed text commercially, with attribution and ShareAlike.
- **Who licenses.** Aura must be able to grant the licence. Owner-authored text: the owner. AI-generated text: may carry no copyright (N3), in which case the "licence" mainly functions as a notice. Any contractor text: needs rights confirmation. The reviewer should sign off on the notice wording given this uncertainty.
- **Incompatible licences:** none found. **Additional permission:** not needed for L2-B (CC BY-SA permits commercial use). Needed only to use these strings under other terms.

## 4. Public-domain source verification

| Source | Author / edition | Status | India | US | Expression reused? | Reliability | Verdict |
|---|---|---|---|---|---|---|---|
| BS (Sanskrit) | Varāhamihira; ed. **H. Kern, Bibliotheca Indica, Calcutta 1865** (archive.org scan) | Work PD; Kern (1833–1917) | PD | PD | No | High | **VERIFIED PD** |
| Iyer, *Brihat Samhita* tr. | N. Chidambaram Iyer; South Indian Press, Madura, 1884 (digitised original at Wellcome); wisdomlib transcribes a modern reprint (ISBN 9788171104215) | US: PD (published 1884). Elsewhere: translator's death January 1892 (secondary) | PD if the death date is correct | PD | No (max 6-word functional overlap) | Medium (numbering differs: Iyer ch. 68 = Skt ch. 67) | **PD very likely; confirm the date; cite and check the 1884 original** (the 70.10 footnote was seen only in the reprint transcription) |
| Kern, English tr. (JRAS 1870–75) | H. Kern | PD | PD | PD | n/a | Coverage of chs. 68/70 unverified | **UNRESOLVED coverage** |
| ŚKA (Sanskrit), ed. S. Mukhopadhyaya, Visvabharati 1954 | Editor's dates unknown | Work PD; **whether a critical edition's text is copyrightable is itself unassessed** | If copyrightable: likely protected (life+60) | If copyrightable and protected in India on 1996-01-01, **URAA restoration makes US formalities irrelevant; protection would run to about 2049. Likely protected, not "unknown"** | — | Zysk calls it "over-emended" | **UNRESOLVED (likely protected if copyrightable)** |
| ŚKA in Cowell–Neil *Divyāvadāna* (1886) | Cowell, Neil | PD | PD | PD | — | Coverage of the palmistry chapter **unverified** | **UNRESOLVED coverage** |
| ŚKA / ST / HS Sanskrit as printed in Zysk 2025 | Zysk's critical edition (ŚKA) and excerpts (ST, HS) | CC BY-SA 4.0 (edition); underlying verses PD | Licensed | Licensed | — | High | Usable under CC BY-SA. Whether a clean-room translation from it is an adaptation of Zysk's *edition* needs a protectability view (§10) |
| ST editions | Edition used by Zysk not identified (R. Miśra 1956 listed) | UNRESOLVED | UNRESOLVED | UNRESOLVED | — | — | **UNRESOLVED** |
| HS, ed. Pratāpa Muni, Indore 1929 | Editor's dates unknown | **US: PD** (published 1929; a URAA-restored term can't exceed 95 years from publication, so it ended in 2024). India: unknown | UNRESOLVED | PD | — | Medium–high | **US PD / India UNRESOLVED** |
| HS, ed. S. Miśra, Delhi 2002 | — | Protected | Protected | Protected | — | — | **Do not use** |
| Dale, *Indian Palmistry* (1895, Gutenberg) | Mrs J. B. Dale | US PD | Likely PD | PD | — | **Low**: Victorian, Western-influenced | **Not recommended** |

## 5. Illustration provenance assessment

| Asset | Original? | Protected reference adapted? | Source-specific arrangement? | Would replacement reduce risk? | Attribution? | Recommendation |
|---|---|---|---|---|---|---|
| Hand diagram | Yes: SVG written by the AI on 2026-11-10 06:03Z (edited 06:22Z) from verbal descriptions | No evidence (no image opened or extracted; main and sub-agent transcripts). **This is carried forward from G3-L1; no new evidence** | Anatomical arrangement + verbal descriptions (BS PD; Zysk commentary); Aura's numbering and style | Not indicated | No | **KEEP; L6 human comparison** must cover Zysk figs. 1–5 **and their underlying sources**: fig. 2 from Pratāpa Muni 1929; **fig. 5 from S. Miśra 2002 (protected, possibly outside Zysk's CC grant)**; figs. 3–4 manuscripts; fig. 1 exhibition catalogue (1998) |
| Five mark glyphs | Yes (generic shapes) | No | No | No | No | KEEP |
| Screenshots 01–07 | Aura UI | OS emoji artwork | — | — | — | Internal review only |

## 6. Cultural and product impact

| Option | Educational purpose | Terminology | Accuracy | Disclaimers | Cultural sensitivity | Clarity | MVP scope | Business |
|---|---|---|---|---|---|---|---|---|
| **RL, scope (a) (recommended)** | Preserved | Preserved | Unchanged (Reviewer A reviews) | Unchanged | Unchanged (Reviewer B) | Adds one licence notice | Unchanged | **Irrevocable open licence of the Palmistry text: competitors may reuse it** |
| REWRITE (clean-room) | Preserved | Preserved / refined | New wording needs A+B re-review | Unchanged | Re-review | Unchanged | Unchanged | Aura keeps its usual rights (subject to N3); cost and time of Sanskritist work |
| REMOVE (fallback) | **Reduced**: prosperity and father lines largely empty; finger scheme and ŚKA comparisons lost | Preserved | Less depth | Unchanged | Neutral | Simpler | Thinner MVP | — |

No new interpretations or features. **Reviewer A:** re-citations, any REWRITE. **Reviewer B:** licence-notice wording and placement, any REWRITE or REMOVE.

## 7. Remaining licensing obligations under L2-B (design intent, for the reviewer to confirm)

1. Keep the Zysk attribution (all §3(a)(1) elements; L3/L4 confirmation). A citation or link alone is insufficient.
2. An Aura CC BY-SA 4.0 notice with a licence link covering the whole user-facing Palmistry text set.
3. No additional terms or effective technological measures on that text. **Check now, before release, not later:** app terms (none today) and the native iOS/Android shells' store terms and DRM (they load the web app; confirm no store-level restriction attaches to the content).
4. The irrevocable grant is accepted by the owner in writing.
5. Iyer/Kern: none if PD; confirm the Iyer date and check the 1884 original for the 70.10 footnote.
6. N3: owner risk acceptance or counsel.

## 8. Required human reviews

| Review | Who | For |
|---|---|---|
| Licensing confirmation | **Internal licensing reviewer with CC BY-SA 4.0 expertise** | L2-B design intent (scope a), notice wording, §3(b)(3) checks, who-licenses question; L3, L4, L6; L5, L7, L8 |
| Scholarly | Reviewer A | Re-citations, concordance, any REWRITE; Q1–Q14 |
| Editorial / cultural | Reviewer B | Notice wording and placement; any REWRITE or REMOVE; W1–W4 |
| Legal (optional only if L2-D says so) | External counsel | L2-C, or assurance on L2-B scope or N3 |

## 9. Independent review findings

See §13.

## 10. Recommended path

**Current: L2-C. Recommended target: L2-B, scope (a).**

- **L2-A (independent baseline):** possible later through either route:
  - **(i)** a clean-room Sanskritist working only from the Sanskrit text (including the Sanskrit printed in Zysk 2025, which is CC BY-SA, *or* a PD-verified edition), **never consulting Zysk's translation**. This needs a view on whether translating from Zysk's *edited* text is itself an adaptation of the edition. That is a narrower question than L1, but still a reviewer or legal judgement.
  - **(ii)** PD verification of an alternative edition. The 1954 ŚKA edition is likely protected if copyrightable. For HS, the 1929 edition is PD in the US and unresolved in India.

  This was more feasible than the first draft stated, but it is still conditional.
- **L2-B (licence route):** recommended. Obligations are documentable (§7). Reviewer: an internal CC-qualified licensing reviewer. External review optional only by a written owner decision (§1.1 supersession).
- **L2-C (legal review retained):** the default **until** the owner records L2-D, and the outcome if the owner declines L2-B.

## 11. Publication blockers

| # | Blocker | Closes when |
|---|---|---|
| PB-1 | **16 Zysk-dependent strings** (L1/L2) | L2-D adopts L2-B scope (a), the internal CC reviewer confirms the notice and scope, and the change is separately authorized and implemented. **Or** an L2-A rewrite is completed and re-reviewed. **Or** REMOVE (separate content authorization) |
| PB-2 | Owner decision L2-D: L2-B vs L2-C; irrevocability accepted; supersession of G3-C §1A and LA-01/03/05 recorded | Written owner decision + record amendments |
| PB-3 | N3: owner risk acceptance or counsel | Written decision |
| PB-4 | L3, L4, L6 confirmations (L6 to include the underlying figure sources, §5) | Internal licensing reviewer or counsel records them |

**Should close before publication, not blocking (P2):** L5 (Iyer date; 1884-original check), L7, L8.

**Separate gates (unchanged):** Reviewer A/B sign-offs; governance GF-1 to GF-3 (open); approval-record change; publication authorization.

**STOP-condition record:** public-domain status of the ŚKA, ST and HS editions cannot currently be substantiated. Next action: the owner chooses L2-B (recommended), commissions L2-A (clean-room + protectability view), or accepts REMOVE.

## 12. Final verdict

### **CONDITIONAL GO**

A viable remediation path (L2-B, scope a) is documented with evidence.

**Conditions:**
- the owner's L2-D decision, including irrevocability and supersession of earlier records;
- N3 risk decision;
- the internal CC-qualified reviewer's confirmations;
- Reviewer A/B review of any changed text;
- separate implementation authorization (L2-I).

External legal review: **deferred, not waived**. Publication: **HOLD**.

---

## 13. Independent review (AI)

**Reviewer:** a separate AI agent, read-only.
- Verified all 49 current-wording cells verbatim, the PDF checksum and a clean repository.
- Spot-checked Iyer 68.42/44/45/48/50 and 70.10/12/13 (all support the claimed meanings) and the RL rows against Zysk.
- Confirmed the PD date analysis for Kern, Iyer and Pratāpa Muni (US).

**This is an AI review, not legal advice.**

**Verdict: ACCEPT WITH CHANGES.** No P0.

| # | Finding | Class | Disposition |
|---|---|---|---|
| P1-1 | KEEP/RL line inconsistent: rows 2, 6, 16, 23, 38, 39 state ŚKA/HS/ST content known only via Zysk | P1 | **Fixed:** reclassified to RL; uniform classification rule stated (§2); totals now 33 KEEP / 16 RL; scope (b) withdrawn |
| P1-2 | Governance changes (counsel optional, N3 risk acceptance) not stated as superseding G3-C §1A and LA-01/03/05; "Path B" clash | P1 | **Fixed:** §1.1 supersession table (effective only on L2-D); paths renamed L2-A/B/C |
| P2-1 | Legal-conclusion phrasing; missing caveats (Adapted-Material scope, irrevocability, who licenses, DRM/ToS now, citation alone insufficient) | P2 | **Fixed:** design-intent wording; §3, §6, §7 caveats added |
| P2-2 | Mukhopadhyaya 1954 US analysis wrong (URAA) | P2 | **Fixed:** likely protected to about 2049 if copyrightable; protectability flagged |
| P2-3 | L2-A clean-room route understated | P2 | **Fixed:** §10 L2-A (i) |
| P2-4 | Inventory missed titles, traditionalNames, intro.title, badges, UI labels | P2 | **Fixed:** §2.3 (two glossed titles are Zysk-dependent; covered by scope a) |
| P2-5 | Illustration provenance carried forward without new evidence; underlying figure sources | P2 | **Fixed:** stated as carried forward; L6 scope extended to Pratāpa Muni 1929, Miśra 2002 and others |
| P3-1 | Row 1 "uppermost" from ŚKA/diagrams; row 49 footnote seen only in the reprint transcription | P3 | **Fixed:** annotations in the matrix; 1884-original check added (§4, §7) |
| P3-2 | PB-5/L7/L8 treatment inconsistent | P3 | **Fixed:** L5, L7, L8 listed together as P2, not blocking |
| P3-3 | §9/§13 placeholders | P3 | **Fixed** (this section) |
