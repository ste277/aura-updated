# AURA-PALM-01-I1 — Palmistry Content Review Packet

**Status: AWAITING QUALIFIED HUMAN REVIEW. Not approved for public launch.**

This packet is for a qualified reviewer, ideally a Sanskritist or a scholar of Indian traditional texts, with a second editorial/cultural reviewer if available. It lists every piece of historical and cultural content in the Explore → Palmistry guide, exactly as users see it.

- The content was researched and drafted with AI assistance (AURA-PALM-01-D1, then I1).
- No human has reviewed it yet.
- AI review does **not** count as approval (product decision 2.4).

| Item | Location |
|---|---|
| Content (single source of truth) | `packages/palmistry/src/content.ts` |
| Source register | `packages/palmistry/src/sources.ts` |
| UI | `apps/web/components/PalmistryView.tsx`, `apps/web/components/PalmHandDiagram.tsx` |
| Review flag | `PALMISTRY_CONTENT_REVIEW.status = 'PENDING_HUMAN_REVIEW'`. The UI shows "Preview content: awaiting review by a qualified scholar before public release" until this changes. `test/palm01I1Content.test.ts` (E1–E2) fails if the status or approver changes, so recording approval means deliberately updating that test in the same change. |
| Research basis | `AURA_PALM_01_D1_DISCOVERY_REPORT.md` (in the requesting checkout; not part of this PR) |

The entry tables in §3 were **generated from `content.ts`**, so they match the shipped strings exactly. If the content changes, regenerate them.

---

## 1. What the reviewer is asked to confirm

For each entry in §3:

1. **Terminology.** Is the IAST term correct, and correctly applied to this feature?
2. **Attribution.** Does each cited source and locator actually support the sentence it is attached to?
3. **Interpretation.** Is the paraphrase faithful? Does it overstate or flatten the source?
4. **Position.** For lines, does the schematic course (see screenshots) match how the sources describe the line? It is labelled as approximate.
5. **Tradition label and confidence.** Are they appropriate?
6. **Tone.** Is the content culturally respectful and free of deterministic or fear-based claims?

Please answer the open questions in §4 and complete the sign-off in §7.

---

## 2. Guide-level text (exact wording)

| Element | Text |
|---|---|
| Explore card | Kicker "Palmistry"; title "Learn the lines of the hand"; description "Explore traditional Indian interpretations of palm lines and symbols."; footer "Traditional knowledge · no photo needed" |
| Page subtitle | Discover the traditions of Indian palmistry |
| Lead | Explore how historical Indian texts described lines and symbols on the palm. Select a feature to learn about its traditional interpretation and the sources behind it. |
| General disclosure (always visible, above the diagram) | Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events. |
| Longevity disclosure (on the āyurlekhā entry) | Aura does not estimate lifespan or predict death. This entry explains a historical idea only. |
| Diagram caption | A schematic drawing, not a real hand. Line positions follow how the sources describe them and are approximate. Real hands vary, and no hand needs to show every feature. |
| Marks note | Marks are shown as symbols, not placed on a hand: the sources do not fix one position for each, and no palm is expected to carry them. |
| About: tradition | Hasta Sāmudrika (reading the hand) is one branch of Sāmudrika Śāstra, the wider Indian tradition of reading marks on the whole body. Early descriptions of the hand appear in the Bṛhatsaṃhitā (6th century) and a Buddhist text from the 9th century. Fuller treatises followed in the 12th and 17th centuries. |
| About: lines and marks | The texts read two kinds of features: lines, which they apply to everyone, and shaped marks such as a fish or a parasol, which mostly signal royal or high status. Interpretations differ between texts, and Aura shows those differences rather than resolving them. |
| About: Indian and Western | Western palmistry, as popularised in 19th-century Europe, uses different names (heart, head, life and fate lines) and planetary "mounts". Its labels do not translate the Indian terms: the same crease can carry a different name and meaning in each system. |
| About: which hand | Indian palmistry texts traditionally examined the right hand of men and the left hand of women. The drawing shows a right hand only to illustrate; Aura does not ask which hand you use or infer anything about you. |
| About: limits | These are descriptions of what historical texts said, in the social world they came from. They are not claims about you. |

---

## 3. Every educational entry (exact wording, generated from `content.ts`)

### 1. Longevity line — *āyurlekhā* (`ayurlekha`, line)

| Field | Exact user-facing wording |
|---|---|
| Title | Longevity line |
| Traditional name | āyurlekhā |
| Where | The uppermost of the main lines, closest to the fingers. The texts describe it as starting below the little finger and running toward the base of the forefinger. |
| In this tradition | In this tradition, the line was associated with length of life, read from how far it reached toward the forefinger. The Bṛhatsaṃhitā and the 9th-century Buddhist chapter both describe this idea. |
| Context and uncertainty | The sources disagree on how the line was measured, which shows this was a scheme of interpretation, not a measurement. The term āyurlekhā in verse 3 rests on an editor's suggested reading; later diagrams label the line āyur-. |
| Western comparison | Western palmistry calls a crease in roughly this position the "heart line" and reads it differently. It is not the Western "life line". |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Drawn as a schematic line (`palm-line-ayurlekha`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.50; 70.13<br>Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, v. 3 (Zysk 2025, p. 244)<br>Indian hand diagrams (18th c. onward), described in Zysk 2025, figs. 1–3 (Zysk 2025, p. 244) |

### 2. Prosperity line (mother line) — *dhanamātṛlekhā* (`dhanamatrlekha`, line)

| Field | Exact user-facing wording |
|---|---|
| Title | Prosperity line (mother line) |
| Traditional name | dhanamātṛlekhā |
| Where | A line in the middle of the palm, between the longevity line above and the father or knowledge line below. |
| In this tradition | The 9th-century text links the middle line with wealth and names it after a lunar asterism. Later hand diagrams label it the "prosperity-mother" line. |
| Context and uncertainty | The compound name comes from the later diagrams, whose spellings vary. Which asterism the early text means is uncertain (possibly Dhaniṣṭhā). Historically "wealth" meant fortune in general, not a forecast of anyone's finances. |
| Western comparison | Western palmistry calls a crease in a similar place the "head line" and gives it a different meaning. |
| Tradition label | Indian (9th-century text; later diagrams) |
| Attribution badge | Later tradition (`later-tradition-supported`) |
| Attribution confidence | Medium |
| Diagram | Drawn as a schematic line (`palm-line-dhanamatrlekha`) |
| Sources shown | Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, vv. 6, 24 (Zysk 2025, pp. 245–246, 255)<br>Indian hand diagrams (18th c. onward), described in Zysk 2025, figs. 1–3 (Zysk 2025, p. 246) |

### 3. Father line (knowledge line) — *pitṛlekhā* (`pitrlekha`, line)

| Field | Exact user-facing wording |
|---|---|
| Title | Father line (knowledge line) |
| Traditional name | pitṛlekhā |
| Where | A line that rises from the base of the thumb near the wrist and runs toward the space between the thumb and forefinger. |
| In this tradition | The 9th-century text calls this a line of knowledge. Later hand diagrams name it the father's line, and one links it with Sarasvatī, the goddess of learning. |
| Context and uncertainty | The sources say little about how this line was read in detail. It was a traditional label, not a measure of intelligence, ancestry or character. The 12th-century Sāmudrikatilaka groups three lines as concerning family, wealth and longevity; whether its "family" line is this father line awaits expert review. |
| Western comparison | Western palmistry calls a crease curving round the thumb the "life line". In the Indian texts, the line linked with life is the longevity line at the top of the palm instead. |
| Tradition label | Indian (9th-century text; later diagrams) |
| Attribution badge | Later tradition (`later-tradition-supported`) |
| Attribution confidence | Medium |
| Diagram | Drawn as a schematic line (`palm-line-pitrlekha`) |
| Sources shown | Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, vv. 1–2 (Zysk 2025, p. 243)<br>Indian hand diagrams (18th c. onward), described in Zysk 2025, figs. 1–3 (Zysk 2025, p. 243) |

### 4. Upward line — *ūrdhvarekhā* (`urdhvarekha`, line)

| Field | Exact user-facing wording |
|---|---|
| Title | Upward line |
| Traditional name | ūrdhvarekhā |
| Where | A line rising from the wrist toward the fingers. Its course varies: the texts describe it ending at different fingers. |
| In this tradition | Later treatises read this line by the finger it reaches. The Hastasañjīvana pairs each finger with a social role of its time: the forefinger with a king or minister, the middle finger with a general, the ring finger with a wealthy merchant or leader, and the little finger with renown. The Sāmudrikatilaka gives a similar scheme. |
| Context and uncertainty | The drawing shows one possible course, ending at the middle finger. These readings describe the status categories of medieval society; the Sāmudrikatilaka even varies them by social class. For Sāmudrikatilaka 1.155, the Sanskrit names the ring finger while the English translation says forefinger, an open question for expert review. |
| Western comparison | Western palmistry splits similar vertical lines into a "fate line" and a "sun line". The Indian treatises treat them as one upward line read by where it ends. |
| Tradition label | Indian (12th- and 17th-century treatises) |
| Attribution badge | Later tradition (`later-tradition-supported`) |
| Attribution confidence | High |
| Diagram | Drawn as a schematic line (`palm-line-urdhvarekha`) |
| Sources shown | Hastasañjīvana (17th c.), excerpts in Zysk 2025, 3.2.80–82 (Zysk 2025, p. 264)<br>Sāmudrikatilaka (12th c.), excerpts in Zysk 2025, 1.155–1.156 (Zysk 2025, pp. 265–266)<br>Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 70.12 (a line from the wrist to the middle finger)<br>Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, vv. 1–2 (Zysk 2025, p. 243) |

### 5. Barleycorn — *yava* (`yava`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Barleycorn |
| Traditional name | yava |
| Where | A small mark shaped like a grain of barley, usually described on or at the base of the thumb. |
| In this tradition | Historically, this mark was interpreted as a sign of prosperity. The Bṛhatsaṃhitā also links a barleycorn at the thumb's root with sons. The 9th-century Buddhist text uses its position on the thumb in omens about the time of birth. |
| Context and uncertainty | Interpretations vary across sources, and the 9th-century text alone gives several different readings. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-yava`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.42 (Sanskrit editions: 67.42)<br>Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, vv. 9–15, 22 (Zysk 2025, pp. 247–254) |

### 6. Fish — *matsya* (`matsya`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Fish |
| Traditional name | matsya |
| Where | A mark shaped like a fish. The Bṛhatsaṃhitā places it in the middle of the palm; some later diagrams draw it just above the wrist. |
| In this tradition | The texts associate the fish with abundance. The Bṛhatsaṃhitā links two fish marks with feeding many people, and the 9th-century text links the fish with drink, food and wealth. |
| Context and uncertainty | The sources disagree on the fish's meaning and its position. The editor notes that the fish appears twice in the 9th-century text, which suggests two source traditions were merged. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-matsya`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.44<br>Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, vv. 15, 22 (Zysk 2025, pp. 250–254) |

### 7. Conch shell — *śaṅkha* (`shankha`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Conch shell |
| Traditional name | śaṅkha |
| Where | A mark shaped like a conch shell. The sources do not fix one position on the palm. |
| In this tradition | The conch is one of the "royal" marks. The Bṛhatsaṃhitā lists it among signs of kingship, and the 9th-century text names a king as one whose palms show a conch together with a parasol, a wheel and an elephant's foot. |
| Context and uncertainty | Royal marks reflect ideals of kingship in early Indian society; the conch is also a familiar symbol in Indian art and ritual. The editor notes the verse stresses the princely or warrior class. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-shankha`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.45; 70.10<br>Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, v. 21 (Zysk 2025, p. 253) |

### 8. Parasol — *chatra* (`chatra`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Parasol |
| Traditional name | chatra |
| Where | A mark shaped like a parasol or umbrella, the traditional canopy held over royalty. The sources do not fix one position on the palm. |
| In this tradition | Like the conch, the parasol belongs to the royal marks. The Bṛhatsaṃhitā lists it among signs of kingship for men and queenship for women, and the 9th-century text pairs it with the conch as a king's mark. |
| Context and uncertainty | In verse 21 the manuscripts read an "elephant parasol"; the 1954 editor emended this to "king's parasol". The term appears there inside that compound. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-chatra`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.45; 70.10<br>Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, v. 21 (Zysk 2025, p. 253) |

### 9. Altar — *vedī* (`vedi`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Altar |
| Traditional name | vedī |
| Where | A mark shaped like a Vedic sacrificial altar. The Bṛhatsaṃhitā places it at the root of the thumb. |
| In this tradition | Historically, this mark was associated with performing sacrificial rites. Both the Bṛhatsaṃhitā and the 9th-century text describe it this way. |
| Context and uncertainty | The meaning reflects the ritual life of early India. The two sources agree on the association; only the Bṛhatsaṃhitā gives a position. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-vedi`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.48<br>Śārdūlakarṇāvadāna (9th c.), ed. Zysk 2025, v. 22 (Zysk 2025, p. 254) |

---

## 4. Open questions for the reviewer (unresolved translation and attribution issues)

1. **āyurlekhā term.** In Śārdūlakarṇāvadāna v. 3 the term comes from an editor's *suggested* reading (Zysk 2025, p. 244). Later diagrams label the line "āyur-". Is the full term *āyurlekhā* (or *āyūrekhā*) appropriate as the display name?
2. **dhanamātṛlekhā.** The compound name is taken from later diagrams, whose spellings vary: *māta*, *dhanamātṛrekhā*, *dhanamānarekhā* (Zysk 2025, p. 246). Is this the best display form? Is the "mother" element correctly glossed?
3. **pitṛlekhā vs the Sāmudrikatilaka's "family" line.** Sāmudrikatilaka 1.143 groups three lines as family (*gotra*), wealth and longevity. Is it fair to leave the identification of the "family" line with the father line explicitly open, as the content does?
4. **pitṛlekhā vs Sarasvatī.** Fig. 3's Sarasvatī label is reported via Zysk's commentary. Should the content mention it?
5. **Sāmudrikatilaka 1.155.** The Sanskrit reads the ring finger (*anāmikā*), while Zysk's English has "forefinger" (p. 265). The content flags this as open. Which reading should Aura follow?
6. **Upward line, social roles.** The finger readings are described as "social roles of its time". Is that framing adequate? Should the varṇa-dependence in Sāmudrikatilaka 1.154 be stated more explicitly or less?
7. **Line positions.** The schematic places āyurlekhā as the top transverse crease, dhanamātṛlekhā in the middle, and pitṛlekhā rising from the thumb base toward the thumb–forefinger gap (screenshots 03–04). These follow Zysk's verbal descriptions; Aura's drawing copies no published diagram. Are they defensible?
8. **Bṛhatsaṃhitā numbering.** Locators use Iyer's 1884 numbering (ch. 68), and Sanskrit editions number the men's chapter 67 (e.g. Zysk cites 67.42 for Iyer's 68.42). Should locators switch to a critical edition's numbering?
9. **chatra.** In Śārdūlakarṇāvadāna v. 21 the term appears inside the compound *gajachatra* ("elephant parasol"), which the 1954 editor emended to *rājachatra*. Is *chatra* the right display term?
10. **Western comparisons.** Each line's "Western palmistry, for comparison" note maps it to the crease in a *similar position* (heart, head, life, fate/sun). The mapping is approximate. Is it accurate enough to show?
11. **Lotus (not included).** The Bṛhatsaṃhitā (Iyer 68.45, 70.10) lists the lotus among royal marks, but its Sanskrit term could not be verified (the wisdomlib Sanskrit pages were not accessible). It was left out of the five marks. Should it replace *vedī* once the term is verified?

---

## 5. Licensing notes

| Source | Licence | How Aura uses it | Review needed |
|---|---|---|---|
| Zysk 2025, *HSSA* 13 (edition and translations of the Śārdūlakarṇāvadāna, Sāmudrikatilaka and Hastasañjīvana excerpts) | **CC BY-SA 4.0** | Facts and interpretations, **paraphrased in Aura's own words**, with attribution. No translated verses, Sanskrit verses or diagrams are reproduced. | **Yes.** Licensing review should confirm the paraphrased content is not an "adaptation" that triggers share-alike. Attribution is present in the in-app Sources list. |
| Bṛhatsaṃhitā, tr. N. Chidambaram Iyer (1884) | Public domain (text and translation) | Paraphrased. The wisdomlib.org hosting is linked, but its site terms are not relied on (no text is copied). | Low |
| Manuscript hand diagrams (Zysk 2025, figs. 1–5) | Images in a CC BY-SA article | **Not copied.** Aura's hand illustration and mark glyphs are original drawings (`PalmHandDiagram.tsx`). | Low (confirm visual originality) |

---

## 6. Screenshots (local dev build, test account, local database)

| File | Shows |
|---|---|
| `screenshots/01-explore-fourth-card-mobile.jpg` | Explore with the Palmistry card fourth (375×812) |
| `screenshots/02-guide-intro-disclosure-mobile.jpg` | Intro, always-visible disclosure, review notice, Lines/Marks control |
| `screenshots/03-line-selected-focus-ring-mobile.jpg` | Longevity line selected (thick stroke + end markers), keyboard focus ring on line 2, detail panel |
| `screenshots/04-upward-line-mobile.jpg` | Upward line selected (drawn ending at the middle finger) |
| `screenshots/05-marks-fish-selected-mobile.jpg` | Marks gallery (original glyphs) with Fish selected |
| `screenshots/06-desktop-side-by-side.jpg` | Desktop: diagram and detail side by side (1280 wide) |

---

## 7. Sign-off (to be completed by a human reviewer — intentionally blank)

| Role | Name | Qualification | Date | Decision (Approve / Approve with corrections / Reject) | Notes |
|---|---|---|---|---|---|
| Primary scholarly reviewer |  |  |  |  |  |
| Editorial / cultural reviewer |  |  |  |  |  |
| Licensing review |  |  |  |  |  |

After sign-off, an engineer updates `PALMISTRY_CONTENT_REVIEW` (status and `approvedBy`) and test E1–E2 in the same change, citing this packet. Until then, the feature must not be released.
