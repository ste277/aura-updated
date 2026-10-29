# Aura Palmistry Guide: Human Review Package (PALM-01-G1)

**Status: AWAITING QUALIFIED HUMAN REVIEW. Not approved. Not licensed. Not published.**
Prepared: 2026-11-11 · Content revision: `origin/main` @ `1741a95` · Approval file: `{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}`

This package is for a scholarly reviewer, an editorial/cultural reviewer and a licensing reviewer. **No source code is needed.** Every user-visible sentence is reproduced below exactly as it is in the content files.

The content was researched and drafted with AI assistance and checked by AI reviewers. **No human expert has reviewed it, and no licensing clearance has been given.** Nothing in this package records an approval.

### How to use this package

| Reviewer | Read | Complete |
|---|---|---|
| Scholarly reviewer | Parts A, B (all), C | Part C decisions, Part E sign-off |
| Editorial / cultural reviewer | Parts A, B §2–§3 and §6, C | Part C (items marked ◆), Part E sign-off |
| Licensing reviewer | Parts A, B §1 and §7, D | Part D, Part E sign-off |

Screenshots are in the folder `AURA_PALM_01_G1_REVIEW_PACKAGE_screenshots/` next to this file (send them with it).

---

## Part A. Context and decisions already made

**What the feature is.** A read-only educational guide inside the app's Explore tab. Users read an introduction, tap one of four lines on an original schematic drawing of a hand, or one of five traditional marks, and read how historical Indian texts interpreted it, with sources. No photo, no reading of the user's own hand, no personalisation, no prediction.

**Where it appears (product decision PALM-01-G1-PD1, 2026-11-11).** The Palmistry card sits **directly on the Explore screen**, as the fourth card after Panchang Calendar, Muhurtham Finder and Plan Ahead (screenshot 01). There is no "Traditional Wisdom" sub-menu. This follows the discovery report's recommendation (AURA-PALM-01-D1 §A.3) that a grouping screen holding a single item adds a step without adding content. It will be revisited only if a second non-timing tradition is approved.

**Independence from timing features.** The guide does not feed, and is not fed by, Panchangam, Muhurtham or any ranking or recommendation logic.

**Current visibility.** The guide is hidden from all public builds until approval is recorded (verified on the live site on 2026-11-11). Reviewers see it only through this package and its screenshots.

**What reviewers are *not* asked to do.** Approve publication. Publication needs your sign-off **and** a separate, explicit publication authorization from the product owner afterwards.

---

## Part B. The content (exact wording, sources, open questions)

Sections B §0–§7 below are the AURA-PALM-01-I1 content review packet, reproduced unchanged. On 2026-11-11 all 31 entry texts in it were checked word for word against the live content files and match. References to "§N" and "Q1–Q14" inside Part B refer to Part B's own sections.

> **Screenshot note.** The screenshots were captured at an earlier revision (`aa56547`). Where a screenshot and the text tables disagree, **the text tables are authoritative**. Known difference: screenshot 06 shows the upward line reading "the middle finger with a general or preceptor". The current text says only "the middle finger with a general" (see Q14). No screenshot shows the in-app Sources list with its licence notice; its wording is given in Part D.

### 0. Purpose, audience and what we are asking

**Feature.** "Palmistry" is a small, read-only educational guide in the Explore tab of Aura, a personal-planning app with Indian traditional-timing features. Users can:
- read a short introduction;
- tap one of four lines on an original schematic drawing of a hand, or one of five traditional marks;
- read how historical Indian texts interpreted that feature, with sources.

There is no photo upload, no palm "reading" of the user, no personalisation, and no prediction.

**Audience.** General adult users of the app, mostly in India and the Indian diaspora. Many have a cultural familiarity with palmistry but no textual training.

**Reviewer profile.** We are asking for a reviewer with demonstrated expertise in one of:
- Sanskrit technical literature (*śāstra*), ideally *lakṣaṇa*/*Sāmudrika* or omen literature;
- Indian intellectual history;
- the textual history of Indian palmistry.

A second editorial/cultural reviewer is welcome.

**We ask the reviewer to:**
1. Check each user-visible sentence in §3 against the cited sources.
2. Answer the open questions in §5 (14 in total).
3. Approve, or request changes, using Parts C and E of this package.

**How to read the ledgers.** Every claim is tagged as one of:

| Tag | Meaning |
|---|---|
| **VERIFIED-TEXT** | The cited page/verse was read in the stated edition or translation, and supports the claim. The check was done by the author and an AI reviewer, not by a human expert. |
| **VIA-TRANSLATION** | Supported by an English translation only. The Sanskrit was not checked. |
| **ENGINEERING** | An interpretive or design decision by the implementer, not a source fact (for example, where a line is drawn). |
| **OPEN** | Unresolved. Listed in §5 for the reviewer. |

---

### 1. Sources used

| ID | Source | Edition actually used | Notes |
|---|---|---|---|
| Zysk 2025 | Kenneth G. Zysk, "Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā", *History of Science in South Asia* 13 (2025): 240–275, DOI 10.18732/hssa128 | Full PDF, read directly | Critical edition and translation of the Śārdūlakarṇāvadāna palmistry chapter. Appendix I translates excerpts of the Hastasañjīvana and Sāmudrikatilaka; Appendix II reproduces hand diagrams. CC BY-SA 4.0. |
| Śārdūlakarṇāvadāna | Buddhist Sanskrit text, chapter *Pāṇilekhā* | Via Zysk 2025 | Zysk: the chapter entered the text "after the middle of the ninth century CE" (p. 240) |
| Bṛhatsaṃhitā | Varāhamihira, 6th c. CE | N. Chidambaram Iyer, English tr. (1884), ch. 68 (men) and 70 (women), via wisdomlib.org | The Sanskrit was **not** checked. Sanskrit editions number the men's chapter 67 (Zysk cites 67.42 for Iyer 68.42). |
| Sāmudrikatilaka | Durlabharāja, completed by Jagaddeva, 1160–1175 CE | Excerpts in Zysk 2025, App. I (1.143, 1.152–1.156) | Excerpts only |
| Hastasañjīvana | Meghavijaya Gaṇi (Tapāgaccha, active 1674–1695), per Zysk 2025 p. 241 | Excerpts in Zysk 2025, App. I (3.2.80–82; 1.3.88–91) | Some catalogues treat Meghavijaya as the commentator rather than the root-text author |
| Hand diagrams | Indian manuscript and printed diagrams, figs. 1–5 in Zysk 2025 | As described in Zysk's commentary | Figs. 3–4: 1732–1748 CE; fig. 1 undated; fig. 2: 1929 print; fig. 5: 2002 print. **Not reproduced by Aura.** |

---

### 2. Guide-level text (exact wording)


| Element | Text |
|---|---|
| Explore card | Kicker "Palmistry"; title "Learn the lines of the hand"; description "Explore traditional Indian interpretations of palm lines and symbols."; footer "Traditional knowledge · no photo needed" |
| Page subtitle | Discover the traditions of Indian palmistry |
| Lead | Explore how historical Indian texts described lines and symbols on the palm. Select a feature to learn about its traditional interpretation and the sources behind it. |
| General disclosure (always visible, above the diagram) | Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events. |
| Longevity disclosure (on the āyurlekhā entry) | Aura does not estimate lifespan or predict death. This entry explains a historical idea only. |
| Diagram caption | A schematic drawing, not a real hand. Line positions follow how the sources describe them and are approximate. Real hands vary, and no hand needs to show every feature. |
| Marks note | Marks are shown as symbols, not placed on a hand: the sources do not fix one position for each, and no palm is expected to carry them. |
| About: tradition | Indian texts on reading the hand, which scholars group under Rekhāśāstra ("the study of lines"), belong to a wider tradition of reading marks on the whole body. Early descriptions of the hand appear in the Bṛhatsaṃhitā (6th century) and in a Buddhist text whose palmistry chapter was compiled after the mid-9th century. Fuller treatises followed in the 12th and 17th centuries. |
| About: lines and marks | The texts read two kinds of features: lines, which they apply to everyone, and shaped marks such as a fish or a parasol, which mostly signal royal or high status. Interpretations differ between texts, and Aura shows those differences rather than resolving them. |
| About: Indian and Western | Western palmistry, as popularised in 19th-century Europe, uses different names (heart, head, life and fate lines) and planetary "mounts". Its labels do not translate the Indian terms: the same crease can carry a different name and meaning in each system. |
| About: which hand | Indian palmistry texts traditionally examined the right hand of men and the left hand of women. The drawing shows a right hand only to illustrate; Aura does not ask which hand you use or infer anything about you. |
| About: limits | These are descriptions of what historical texts said, in the social world they came from. They are not claims about you. |


---

### 3. Every entry: exact user-visible wording

These tables are **generated directly from the shipped content file** (`packages/palmistry/src/content.ts`), so they match what users see.

#### 1. Longevity line — *āyurlekhā* (`ayurlekha`, line)

| Field | Exact user-facing wording |
|---|---|
| Title | Longevity line |
| Traditional name | āyurlekhā |
| Where | The uppermost of the main lines, closest to the fingers. The texts describe it as starting below the little finger and running toward the base of the forefinger. |
| In this tradition | In this tradition, the line was associated with length of life, read from how far it reached toward the forefinger. The Bṛhatsaṃhitā and a later Buddhist palmistry chapter (compiled after the mid-9th century) both describe this idea. |
| Context and uncertainty | The sources disagree on how the line was measured, which shows this was a scheme of interpretation, not a measurement. The term āyurlekhā appears in verse 6 of the early Buddhist chapter (and is an editor's suggested reading in verse 3); later diagrams label the line āyur-. |
| Western comparison | Western palmistry calls a crease in roughly this position the "heart line" and reads it differently. It is not the Western "life line". |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Drawn as a schematic line (`palm-line-ayurlekha`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.50; 70.13<br>Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, vv. 3, 6 (Zysk 2025, pp. 244–245)<br>Indian hand diagrams (18th c. onward), described in Zysk 2025, figs. 1–3 (Zysk 2025, p. 244) |

#### 2. Prosperity line (mother line) — *dhanamātṛlekhā* (`dhanamatrlekha`, line)

| Field | Exact user-facing wording |
|---|---|
| Title | Prosperity line (mother line) |
| Traditional name | dhanamātṛlekhā |
| Where | A line in the middle of the palm, between the longevity line above and the father or knowledge line below. |
| In this tradition | An early Buddhist palmistry chapter (after the mid-9th century) links the middle line with wealth and names it after a lunar asterism. Later hand diagrams label it the "prosperity-mother" line. |
| Context and uncertainty | The compound name comes from the later diagrams, whose spellings vary. Which asterism the early text means is uncertain (possibly Dhaniṣṭhā). Historically "wealth" meant fortune in general, not a forecast of anyone's finances. |
| Western comparison | Western palmistry calls a crease in a similar place the "head line" and gives it a different meaning. |
| Tradition label | Indian (early Buddhist text; later diagrams) |
| Attribution badge | Later tradition (`later-tradition-supported`) |
| Attribution confidence | Medium |
| Diagram | Drawn as a schematic line (`palm-line-dhanamatrlekha`) |
| Sources shown | Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, vv. 6, 24 (Zysk 2025, pp. 245–246, 255)<br>Indian hand diagrams (18th c. onward), described in Zysk 2025, figs. 1–3 (Zysk 2025, p. 246) |

#### 3. Father line (knowledge line) — *pitṛlekhā* (`pitrlekha`, line)

| Field | Exact user-facing wording |
|---|---|
| Title | Father line (knowledge line) |
| Traditional name | pitṛlekhā |
| Where | A line that rises from the base of the thumb near the wrist. The 12th-century Sāmudrikatilaka describes the first lines of the palm as reaching between the thumb and forefinger. |
| In this tradition | The early Buddhist palmistry chapter calls this a line of knowledge. Later hand diagrams name it the father's line, and one links it with Sarasvatī, the goddess of learning. |
| Context and uncertainty | The sources say little about how this line was read in detail. It was a traditional label, not a measure of intelligence, ancestry or character. The 12th-century Sāmudrikatilaka groups three lines as concerning family, wealth and longevity; whether its "family" line is this father line awaits expert review. |
| Western comparison | Western palmistry calls a crease curving round the thumb the "life line". In the Indian texts, the line linked with life is the longevity line at the top of the palm instead. |
| Tradition label | Indian (early Buddhist text; later diagrams) |
| Attribution badge | Later tradition (`later-tradition-supported`) |
| Attribution confidence | Medium |
| Diagram | Drawn as a schematic line (`palm-line-pitrlekha`) |
| Sources shown | Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, vv. 1–2 (Zysk 2025, p. 243)<br>Indian hand diagrams (18th c. onward), described in Zysk 2025, figs. 1–3 (Zysk 2025, p. 243)<br>Sāmudrikatilaka (12th c.), excerpts in Zysk 2025, 1.143 (Zysk 2025, p. 265) |

#### 4. Upward line — *ūrdhvarekhā* (`urdhvarekha`, line)

| Field | Exact user-facing wording |
|---|---|
| Title | Upward line |
| Traditional name | ūrdhvarekhā |
| Where | A line rising from the wrist toward the fingers. Its course varies: the texts describe it ending at different fingers. |
| In this tradition | Later treatises read this line by the finger it reaches. The Hastasañjīvana pairs each finger with a social role of its time: the forefinger with a king or minister, the middle finger with a general, the ring finger with a wealthy merchant or leader, and the little finger with renown. The Sāmudrikatilaka gives a similar scheme, including a king, army commander or preceptor for the middle finger. |
| Context and uncertainty | The drawing shows one possible course, ending at the middle finger. These readings describe the status categories of medieval society; the Sāmudrikatilaka (1.154) even varies them by social class. For Sāmudrikatilaka 1.155, the Sanskrit names the ring finger while the English translation says forefinger, an open question for expert review. |
| Western comparison | Western palmistry splits similar vertical lines into a "fate line" and a "sun line". The Indian treatises treat them as one upward line read by where it ends. |
| Tradition label | Indian (12th- and 17th-century treatises) |
| Attribution badge | Later tradition (`later-tradition-supported`) |
| Attribution confidence | High |
| Diagram | Drawn as a schematic line (`palm-line-urdhvarekha`) |
| Sources shown | Hastasañjīvana (17th c.), excerpts in Zysk 2025, 3.2.80–82 (Zysk 2025, p. 264)<br>Sāmudrikatilaka (12th c.), excerpts in Zysk 2025, 1.152–1.156 (Zysk 2025, pp. 265–266)<br>Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 70.12 (a line from the wrist to the middle finger)<br>Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, vv. 1–2 (Zysk 2025, p. 243) |

#### 5. Barleycorn — *yava* (`yava`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Barleycorn |
| Traditional name | yava |
| Where | A small mark shaped like a grain of barley, usually described on or at the base of the thumb. |
| In this tradition | Historically, this mark was interpreted as a sign of prosperity. The Bṛhatsaṃhitā also links a barleycorn at the thumb's root with sons. An early Buddhist palmistry chapter (after the mid-9th century) uses its position on the thumb in omens about the time of birth. |
| Context and uncertainty | Interpretations vary across sources, and the early Buddhist chapter alone gives several different readings. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-yava`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.42 (Sanskrit editions: 67.42)<br>Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, vv. 9–15, 22 (Zysk 2025, pp. 247–254) |

#### 6. Fish — *matsya* (`matsya`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Fish |
| Traditional name | matsya |
| Where | A mark shaped like a fish. The Bṛhatsaṃhitā places it in the middle of the palm; some later diagrams draw it just above the wrist. |
| In this tradition | The texts associate the fish with abundance. The Bṛhatsaṃhitā links two fish marks with feeding many people, and the early Buddhist chapter links the fish with drink, food and wealth. |
| Context and uncertainty | The sources disagree on the fish's meaning and its position. Zysk notes that the fish appears twice in the early Buddhist chapter, which suggests two source traditions were merged. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-matsya`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.44<br>Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, vv. 15, 22 (Zysk 2025, pp. 250–254) |

#### 7. Conch shell — *śaṅkha* (`shankha`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Conch shell |
| Traditional name | śaṅkha |
| Where | A mark shaped like a conch shell. The sources do not fix one position on the palm. |
| In this tradition | The conch is one of the "royal" marks. The Bṛhatsaṃhitā lists it among signs of kingship, and the early Buddhist chapter names a king as one whose palms show a conch together with a parasol, a wheel and an elephant's foot. |
| Context and uncertainty | Royal marks reflect ideals of kingship in early Indian society; the conch is also a familiar symbol in Indian art and ritual. Zysk notes the verse stresses the princely or warrior class. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-shankha`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.45; 70.10<br>Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, v. 21 (Zysk 2025, p. 253) |

#### 8. Parasol — *chatra* (`chatra`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Parasol |
| Traditional name | chatra |
| Where | A mark shaped like a parasol or umbrella, the traditional canopy held over royalty. The sources do not fix one position on the palm. |
| In this tradition | Like the conch, the parasol belongs to the royal marks. The Bṛhatsaṃhitā lists it among signs of kingship for men and queenship for women, and the early Buddhist chapter pairs it with the conch as a king's mark. |
| Context and uncertainty | In verse 21 the manuscripts read an "elephant parasol"; the 1954 editor emended this to "king's parasol". The term appears there inside that compound. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-chatra`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.45; 70.10<br>Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, v. 21 (Zysk 2025, p. 253) |

#### 9. Altar — *vedī* (`vedi`, mark)

| Field | Exact user-facing wording |
|---|---|
| Title | Altar |
| Traditional name | vedī |
| Where | A mark shaped like a Vedic sacrificial altar. The Bṛhatsaṃhitā places it at the root of the thumb. |
| In this tradition | Historically, this mark was associated with performing sacrificial rites. Both the Bṛhatsaṃhitā and the early Buddhist chapter describe it this way. |
| Context and uncertainty | The meaning reflects the ritual life of early India. The two sources agree on the association; only the Bṛhatsaṃhitā gives a position. |
| Western comparison | — (none shown) |
| Tradition label | Indian (classical) |
| Attribution badge | Classical source (`classical-supported`) |
| Attribution confidence | High |
| Diagram | Symbol only, not placed on the hand (`palm-mark-vedi`) |
| Sources shown | Bṛhatsaṃhitā (6th c.), tr. Iyer 1884, Iyer tr. 68.48<br>Śārdūlakarṇāvadāna (palmistry chapter after mid-9th c.), ed. Zysk 2025, v. 22 (Zysk 2025, p. 254) |

---

### 4. Source and citation ledger (claim by claim)

Page numbers refer to Zysk 2025 unless marked "Iyer". "v." = verse of the Śārdūlakarṇāvadāna chapter. "ST" = Sāmudrikatilaka. "HS" = Hastasañjīvana. "BS" = Bṛhatsaṃhitā.

| Entry | Claim in the guide | Source and locator | Tag |
|---|---|---|---|
| āyurlekhā | Topmost line, from below the little finger toward the base of the forefinger | p. 244 (comment on v. 3); BS Iyer 70.13 | VERIFIED-TEXT |
| āyurlekhā | Associated with length of life, read from how far it reaches toward the forefinger | v. 3, p. 244; BS Iyer 68.50 | VERIFIED-TEXT (BS: VIA-TRANSLATION) |
| āyurlekhā | Sources disagree on how the line was measured | p. 244 (v. 3 uses 100/70/50/30; the diagrams use 100/75/50/25) | VERIFIED-TEXT. The numbers are deliberately **not shown** to users. |
| āyurlekhā | The term appears in v. 6, and is an editor's suggested reading in v. 3 | pp. 244–245 | VERIFIED-TEXT |
| āyurlekhā | A crease in this position is the Western "heart line", not the "life line" | Positional reading of the verbal description | **ENGINEERING** (OPEN Q7, Q10) |
| dhanamātṛlekhā | Middle line, between the longevity line and the father/knowledge line | pp. 245–246, 255 | VERIFIED-TEXT |
| dhanamātṛlekhā | Linked with wealth and named after an asterism (possibly Dhaniṣṭhā) | v. 6, pp. 245–246 | VERIFIED-TEXT |
| dhanamātṛlekhā | The name comes from later diagrams, with varying spellings | p. 246 | VERIFIED-TEXT (OPEN Q2) |
| pitṛlekhā | Rises from the base of the thumb near the wrist | vv. 1–2 comment, p. 243 | VERIFIED-TEXT |
| pitṛlekhā | Called a line of knowledge in the early text; "father's line" in diagrams, one linked with Sarasvatī | p. 243 | VERIFIED-TEXT (OPEN Q4) |
| pitṛlekhā | ST describes the first lines as reaching between the thumb and forefinger; family, wealth, longevity | ST 1.143, p. 265 | VERIFIED-TEXT. Identifying ST's "family" line with pitṛlekhā is left **OPEN** (Q3). |
| ūrdhvarekhā | Rises from the wrist; read by the finger it reaches | HS 3.2.80, p. 264; vv. 1–2, p. 243 | VERIFIED-TEXT |
| ūrdhvarekhā | Forefinger: king or minister; middle: general; ring ("refuge of Śiva"): rich merchant or leader; little: supported and famous | HS 3.2.81–82, p. 264 | VERIFIED-TEXT. "Preceptor" (Sanskrit *ācārya* in 3.2.81) is deliberately **not** attributed to HS, because Zysk's English gives only "general" (OPEN Q14). |
| ūrdhvarekhā | ST gives a similar scheme, including king, army commander or preceptor for the middle finger; it varies by social class | ST 1.152, 1.154–1.156, pp. 265–266 | VERIFIED-TEXT. ST 1.155 has a Sanskrit/English discrepancy (OPEN Q5). |
| ūrdhvarekhā | Line from the wrist to the middle finger | BS Iyer 70.12 | VIA-TRANSLATION |
| ūrdhvarekhā | Drawn ending at the middle finger | One of the documented courses | **ENGINEERING** |
| yava | Barley-grain mark on or at the base of the thumb; prosperity, and sons at the root | BS Iyer 68.42 (Zysk: BS 67.42, p. 247) | VIA-TRANSLATION |
| yava | Used in birth-time omens; several readings | vv. 9–15, pp. 247–251; v. 22, p. 254 | VERIFIED-TEXT |
| matsya | Two fish marks in mid-palm: feeding many people | BS Iyer 68.44 | VIA-TRANSLATION |
| matsya | Fish: wealth, food and good fortune; drink; appears twice (two sources merged) | v. 15, pp. 250–251; v. 22, p. 254 | VERIFIED-TEXT |
| matsya | Later diagrams draw the fish just above the wrist | p. 250 | VERIFIED-TEXT |
| śaṅkha | Among the royal marks (kingship; queenship) | BS Iyer 68.45; 70.10 | VIA-TRANSLATION |
| śaṅkha | A king's palms show a conch with parasol, wheel and elephant's foot; Zysk notes the princely/warrior emphasis | v. 21, p. 253 | VERIFIED-TEXT |
| chatra | Among the royal marks (kingship; queenship) | BS Iyer 68.45; 70.10 | VIA-TRANSLATION |
| chatra | The manuscripts read *gajachatra*; the 1954 editor emended it to *rājachatra* | v. 21, p. 253 | VERIFIED-TEXT (OPEN Q9) |
| vedī | Altar-shaped mark at the thumb root: performing sacrifices | BS Iyer 68.48 | VIA-TRANSLATION |
| vedī | The altar portends sacrifice | v. 22, p. 254 | VERIFIED-TEXT |
| Intro | Palmistry texts grouped under Rekhāśāstra | pp. 241, 243 (Zysk's usage) | VERIFIED-TEXT (OPEN Q12) |
| Intro | BS 6th c.; Buddhist chapter compiled after the mid-9th c.; treatises in the 12th and 17th c. | pp. 240–242 | VERIFIED-TEXT |
| Hand convention | Right hand for men, left for women "standard in Indian palmistry" | p. 241 (implied, not stated, for this chapter); Iyer footnote to BS 70.10 | VERIFIED-TEXT (Iyer: VIA-TRANSLATION) |

**Not independently checked by anyone:** the Sanskrit of the Bṛhatsaṃhitā verses (the wisdomlib Sanskrit pages returned HTTP 403), and any source beyond Zysk 2025 and Iyer 1884. In particular, Zysk 2016 (*The Indian System of Human Marks*, Brill) was not consulted, and no regional (for example South Indian) traditions were researched.

---

### 5. Open questions for the reviewer


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
12. **Naming the tradition.** The guide now calls the practice Rekhāśāstra, the term Zysk 2025 uses (pp. 241, 243). The names "Hasta Sāmudrika" and "Sāmudrika Śāstra" were removed, because they were not attested in the sources read for this ticket (Sāmudrikaśāstra appears there only as a 1956 book title). Should Aura use either name, and with what attribution?
13. **Śārdūlakarṇāvadāna dating.** The guide says the palmistry chapter was compiled "after the mid-9th century", following Zysk p. 240. Is that the right public-facing phrasing?
14. **Hastasañjīvana 3.2.81, "preceptor".** The Sanskrit reads *…tathācāryaḥ…* for the middle finger, but Zysk's English translation gives only "renowned army general". The guide currently attributes only "general" to the Hastasañjīvana, and "preceptor" only to Sāmudrikatilaka 1.152, whose English supports it. Should the Hastasañjīvana reading include the preceptor?


---

### 6. Safeguards built into the text

| Safeguard | How it appears |
|---|---|
| General disclosure | Always visible above the diagram: "Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events." |
| Longevity | No lifespan numbers anywhere in user-visible text. The āyurlekhā entry shows "Aura does not estimate lifespan or predict death. This entry explains a historical idea only." |
| Framing | Every interpretation is phrased historically ("In this tradition…", "Historically, this mark was interpreted as…"). Automated tests reject phrases such as "you will", "destined", "guarantee" and numeric lifespans. |
| Hand convention | Presented as history only. Aura never asks for, or infers, a user's gender or hand. |
| Western comparisons | Shown only in a separate, labelled "Western palmistry, for comparison" note. Western planetary mounts are not used as entries. |
| Social roles | Status-based readings (kings, merchants, varṇa) are described as categories of medieval society. |
| Omitted on purpose | Palm colour and nail readings, health readings, adverse or inauspicious marks, and the lotus mark (term unverified). |

---

### 7. Licensing and attribution checklist

Nothing in this checklist is legal advice, and **no licensing clearance has been given.**

| Source | Material used | Type of use | Licence | Attribution requirement | Outstanding question | Review status |
|---|---|---|---|---|---|---|
| Zysk 2025 (article text, critical edition, English translations) | Facts and interpretations from the commentary; the meaning of verses as rendered in Zysk's translations; line and mark names as printed | Original paraphrase in Aura's own words. No verses, translations, sentences or figures reproduced. Short terms (IAST names) and page/verse locators cited. | CC BY-SA 4.0. Copyright held by the author. Confirmed in the article PDF's front matter. | BY: credit the author and title, link the licence, indicate changes. Aura's in-app Sources list credits the title, author, journal and DOI, links the article, and (added in P1) shows "© Kenneth G. Zysk, licensed under CC BY-SA 4.0" with a licence link and a note that Aura's text paraphrases the work. | (1) Is paraphrasing the *meaning* of Zysk's verse translations (e.g. the finger readings of HS 3.2.81–82) an "Adapted Material" that triggers ShareAlike, or a use of unprotectable facts and ideas? (2) Is the in-app attribution sufficient, including its "indicate changes" wording ("Aura's text paraphrases this work")? | **PENDING** licensing review |
| Śārdūlakarṇāvadāna, Sāmudrikatilaka, Hastasañjīvana (underlying texts) | Content via Zysk's editions | Paraphrase | Pre-modern texts (public domain); the editions and translations are CC BY-SA (above) | Cite the edition | None beyond the Zysk row | Pending (with Zysk) |
| Bṛhatsaṃhitā, Iyer tr. (1884) | Meaning of ch. 68 and 70 hand verses | Paraphrase | The translation is public domain by age. The wisdomlib.org digital edition's own terms are not relied on, because no text was copied. | Courtesy citation (present) | Confirm public-domain status of the 1884 translation | Pending (low risk) |
| Hand diagrams (Zysk figs. 1–5) | **None.** Not copied or traced. | None | Images in a CC BY-SA article; some may carry separate holding-institution rights | n/a | None | n/a |
| Aura hand illustration and mark glyphs | Original inline SVG drawn for Aura (`PalmHandDiagram.tsx`) | Original work | Aura's own | n/a | A reviewer may confirm it is not derivative of any published diagram | Self-assessed original. Pending visual confirmation. |
| Screenshots in this packet | Screens of Aura's own UI (local test account, local data) | Internal review only | Aura's own | n/a | None | n/a |

---

## Part C. Scholarly and editorial decisions

### C.1 Proposed wording corrections (proposals only; not applied)

These were raised by the PALM-01-G1 audit. Accept, amend or reject each.

| ID | Where | Current wording | Proposed wording | Reason | Decision (Accept / Amend / Reject) |
|---|---|---|---|---|---|
| W1 ◆ | Barleycorn (*yava*), "In this tradition" | "The Bṛhatsaṃhitā also links a barleycorn at the thumb's root with sons." | "The Bṛhatsaṃhitā also links a barleycorn at the thumb's root with having sons, reflecting the concerns of texts of that period." | A progeny/gender reading currently has no context, unlike the other sensitive readings |  |
| W2 | Prosperity line (*dhanamātṛlekhā*), "Context and uncertainty" | "Historically "wealth" meant fortune in general, not a forecast of anyone's finances." | "Here "wealth" is a traditional category, not a forecast of anyone's finances." | The historical claim has no source in the ledger; the safeguard is kept |  |
| W3 ◆ | Upward line (*ūrdhvarekhā*), "Context and uncertainty" | "…the Sāmudrikatilaka (1.154) even varies them by social class." | "…the Sāmudrikatilaka (1.154) also varies them by social class (varṇa)." | "even" is editorial. Whether to name varṇa is part of Q6. |  |
| W4 ◆ | General disclosure | "Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events." | Same, plus: "Please don't use it for decisions about health, money or relationships." | Makes the no-prediction stance practical |  |

### C.2 Per-item decisions

Use one row per item. "Open questions" refers to Part B §5. Items marked ◆ also need the editorial/cultural reviewer.

| # | Item (Part B reference) | Decision (Approve / Approve with corrections / Reject) | Corrections required (exact new wording) | Open questions answered or accepted as open | Initials |
|---|---|---|---|---|---|
| 1 | Introduction and tradition framing, incl. dates and "Rekhāśāstra" (§2) |  |  | Q12, Q13 |  |
| 2 | Explore card text (§2) |  |  | — |  |
| 3 ◆ | General disclosure (§2) and W4 |  |  | — |  |
| 4 ◆ | Longevity disclosure (§2) |  |  | — |  |
| 5 ◆ | Hand-convention note: men's right hand, women's left (§2) |  |  | — |  |
| 6 | Diagram caption, marks note and schematic line positions (§2; screenshots 03–04, 06) |  |  | Q7 |  |
| 7 | Longevity line, *āyurlekhā* (§3.1) |  |  | Q1 |  |
| 8 | Prosperity line, *dhanamātṛlekhā* (§3.2) and W2 |  |  | Q2 |  |
| 9 | Father line, *pitṛlekhā* (§3.3) |  |  | Q3, Q4 |  |
| 10 ◆ | Upward line, *ūrdhvarekhā*, incl. social roles and varṇa (§3.4) and W3 |  |  | Q5, Q6, Q14 |  |
| 11 ◆ | Barleycorn, *yava* (§3.5) and W1 |  |  | — |  |
| 12 | Fish, *matsya* (§3.6) |  |  | — |  |
| 13 | Conch shell, *śaṅkha* (§3.7) |  |  | — |  |
| 14 | Parasol, *chatra* (§3.8) |  |  | Q9 |  |
| 15 | Altar, *vedī* (§3.9) |  |  | — |  |
| 16 | "Western palmistry, for comparison" notes, all four lines (§3) |  |  | Q10 |  |
| 17 | Bṛhatsaṃhitā locator numbering (§4) |  |  | Q8 |  |
| 18 | Lotus mark, currently excluded |  |  | Q11 |  |
| 19 | Citation ledger as a whole (§4) |  |  | — |  |

### C.3 Overall checklist

Scholarly reviewer:
- [ ] Every IAST term in §3 is correctly spelled and applied
- [ ] Every claim in the §4 ledger is supported by its locator, and none overstates its source
- [ ] Historical dating and framing are accurate
- [ ] Traditional belief is never presented as established fact
- [ ] Q1–Q14 are answered, or explicitly accepted as open with the current wording
- [ ] Schematic line positions are defensible as "approximate"

Editorial / cultural reviewer (◆ items):
- [ ] No deterministic health, lifespan, relationship, progeny or financial prediction, express or implied
- [ ] Status- and caste-linked readings (upward line, royal marks) are presented responsibly
- [ ] Gendered content (hand convention, barleycorn "sons") is presented responsibly
- [ ] No culturally inappropriate, sensational or misleading wording
- [ ] The disclosures are clear to a general adult audience

**Known research limits (for the reviewer's judgement):** the Sanskrit of the Bṛhatsaṃhitā verses was not checked; three of six sources were read only through Zysk 2025; Zysk 2016 (*The Indian System of Human Marks*) and regional traditions were not consulted. Please state whether any of these must be closed before approval.

---

## Part D. Licensing clearance checklist

Nothing here is legal advice. **No licensing clearance has been given.**

**In-app attribution as currently written** (shown in the guide's Sources list for Zysk 2025): title, author, journal, volume, pages and DOI, with a link; "© Kenneth G. Zysk, licensed under CC BY-SA 4.0" with a link to the licence; and "; Aura's text paraphrases this work." Below the list: "All descriptions are Aura's own paraphrases. No translations or diagrams are reproduced."

| # | Question | Current position (recorded, not cleared) | Decision | Notes |
|---|---|---|---|---|
| L1 | Is Aura's paraphrase of the *meaning* of Zysk's verse translations "Adapted Material" under CC BY-SA 4.0 (which would trigger ShareAlike), or a use of unprotectable facts and ideas? | Paraphrase only. No verses, translated sentences or figures reproduced. | ☐ Facts/ideas ☐ Adapted Material ☐ Other |  |
| L2 | If ShareAlike applies: which licence must Aura's Palmistry text carry, and is that acceptable to the business? | Not assessed | |  |
| L3 | Does the in-app attribution (above) satisfy the BY condition? | Implemented and rendered | ☐ Accept ☐ Changes needed |  |
| L4 | Does the paraphrase notice satisfy the "indicate changes" requirement? | Not assessed | ☐ Yes ☐ No |  |
| L5 | Is N. Chidambaram Iyer's 1884 Bṛhatsaṃhitā translation in the public domain in the target markets (India, diaspora markets)? | Expected public domain by age. The wisdomlib.org hosting terms are not relied on, as no text was copied. | ☐ Confirmed ☐ Not confirmed |  |
| L6 | Are the hand drawing and the five mark symbols original and not derivative of Zysk figs. 1–5? (Compare screenshots 03, 05, 06 with Zysk 2025 Appendix II.) | Self-assessed original | ☐ Accept ☐ Concern |  |
| L7 | Do the Sanskrit/IAST terms, verse numbers and page locators raise any rights issue? | Treated as facts | ☐ Accept |  |
| L8 | Any concern with the "Palmistry" name or the ✋ 📜 icons (system emoji)? | None identified | ☐ Accept |  |

---

## Part E. Sign-off

**Intentionally blank. To be completed only by the actual reviewers.** Nobody else may fill in these fields, and an AI system cannot.

| Role | Name | Qualification / role | Date | Decision (Approve / Approve with corrections / Reject) | Conditions or notes |
|---|---|---|---|---|---|
| Primary scholarly reviewer |  |  |  |  |  |
| Editorial / cultural reviewer |  |  |  |  |  |
| Licensing reviewer |  |  |  |  |  |

**What happens after sign-off**

1. If corrections were requested, an engineer applies them in a new change, and the reviewer re-confirms the exact changed text.
2. Only after all three sign-offs: the approval file is set to `APPROVED` with the real reviewer name and date, in a reviewed change.
3. **Publication still requires a separate, explicit authorization** from the product owner, under the merge and release rules in force at that time. Sign-off alone does not publish anything.
