# AURA-PALM-01-D1 — Palmistry Discovery Report

**Ticket:** AURA-PALM-01-D1 (discovery only; implementation authorization: NONE)
**Date:** 2026-11-10
**Author:** Claude Code (Opus 5.5) at the request of Stephen Francis
**Status of this document:** Draft for independent review (see §H)

> Nothing in this report changes application code, routes, navigation, dependencies, schema, analytics, MCP, or Panchangam ranking. This file is the only artifact written, and it is untracked in the working tree (same convention as the existing `AURA_*_AUDIT.md` files). Nothing was committed or pushed.

---

## A. Repository Baseline

| Item | Value |
|---|---|
| Repository | `ste277/aura-updated` (remote `origin`) |
| Local checkout | `/Users/stephen/Desktop/Claude/auraschedule-math-core`, branch `main` @ `f35d35a` |
| Local vs remote | Local `main` is **34 commits behind** `origin/main` (as of the last fetch already present locally; no fetch was performed) |
| **Audited revision** | **`origin/main` @ `553f3b5952bd6eb4d556591db6837affb83a72f0`** ("PANCH-OVERLAP-01-I1 – Unify commencement caution across Home and Timing Search (#332)", 2026-11-10) |
| How audited | Read-only `git show origin/main:<path>` / `git grep origin/main`. No checkout, no worktree, no branch switch, so the M3 and MCP workstreams' working trees were never touched |
| Working-tree status | Unchanged from session start: untracked `.claude/settings.local.json`, nine `AURA_INSIGHTS_*` docs, `AURA_LOCATION_CONFIRMATION_AUDIT_V1.md`, `aura-hpg3-audit.zip`, **plus this report** |

> Caveat: the remote may have moved since the last local fetch. Re-verify the SHA before MVP planning.

### A.1 Explore implementation inventory (verified on `origin/main`)

| Component | Actual source path | Current behavior | Reuse potential for Palmistry |
|---|---|---|---|
| Explore entrypoint | `apps/web/components/ExploreView.tsx` | Landing screen with a `PageHeader` ("Explore ✨"), **three** `ExploreFeatureCard`s (Panchang Calendar, Muhurtham Finder, Plan Ahead), a "Quick Explore" grid of Muhurtham occasions from `SUPPORTED_MUHURTHAM_ACTIVITY_IDS`, and "View all occasions →" | **High.** A fourth `ExploreFeatureCard` is the smallest consistent entry. The card is local to the file (not exported) and takes `kicker / actionLabel / description / icon / accent / footer / onClick` |
| Navigation / "routing" | `apps/web/app/page.tsx` (lines ~282–283, 2070–2143) | **Not Next.js routes.** One client page with an `AppTab` union (`'explore' \| 'panchang' \| 'muhurtham' \| 'planner' \| …`), `useState`, and an optional `?tab=` deep link checked against `VALID_TABS`. Sub-screens get `onBack={() => setActiveTab('explore')}`. The bottom dock has 6 `NavButton`s, and Explore is highlighted for `explore \| panchang \| muhurtham \| planner` | **High.** The pattern is one new `AppTab` value (`'palmistry'`), one render branch, and one addition to the Explore highlight condition. No new route tree is needed |
| Sub-screen pattern | `PanchangCalendarView.tsx`, `MuhurthamFinderView.tsx`, `ForwardPlannerView.tsx` | Each has a "← Explore" back button (`aria-label="Back to Explore"`) and its own content | **High.** Copy the back-button convention |
| Mode toggle | `ExploreModeToggle.tsx` → `SegmentedControl` | Calendar ⇄ Muhurtham toggle, shared by the two views | **Not applicable** to Palmistry. Do **not** add Palmistry to this toggle (that would couple it to the timing tools) |
| Content cards / detail | `components/ui.tsx`: `PageHeader`, `SectionHeader`, `SurfaceCard`, `ResultCard`, `ActionRow`, `StatusBadge`, `SegmentedControl` (`role="tablist"`), `EmptyState`, `ModalShell` + `useModalA11y`, buttons | Shared primitive set ("Aura UI Experience V2") | **High.** Feature detail = `SurfaceCard` + `SectionHeader` + `StatusBadge` (for the provenance label). Lines/Marks switch = `SegmentedControl` |
| Shared design system | `components/theme.ts` (+ `app/tokens.css`) | `colors` (incl. `traditional: '#a78bfa'` "traditional-astrology accents"), `spacing`, `radius`, `typography`, `panelStyle` | **High.** Use `colors.traditional` as the Palmistry accent. This avoids "mystical decoration" while staying in the existing family |
| Inline SVG precedent | `components/Dial.tsx`, `Timeline.tsx`, `HomeDashboard.tsx` | Hand-written inline SVG, no chart/graphics library | **Medium-high.** A static hand diagram can be inline SVG with **no new dependency** |
| Selectable-grid precedent | `components/SouthIndianChart.tsx` | Clickable cells (`onClick` → `handleCellClick(rashiIndex)`), selection + clear | **Medium.** Same "select a region → show detail" interaction model |
| Static content catalogs | `packages/recommendation/src/personalizedTasks.ts` (`FULL_ACTIVITY_CATALOG`) | Typed in-code catalog imported by the UI | **High.** Precedent for a typed, in-repo content module (no DB) |
| Mobile layout | `page.tsx` (shared max-width wrapper, fixed 60px dock with `safe-area-inset-bottom`), Capacitor 6 iOS/Android shells loading the web app by URL (`capacitor.config.ts`) | One web codebase serves web + native | **High.** A palm guide is web-only and needs no native plugin |
| Localization | — | **None.** No i18n library, and strings are inline English. "locale" grep hits are only `toLocaleDateString` | **Gap.** Sanskrit/IAST terms must be authored as data. Hindi/Tamil/etc. would need an i18n decision that is out of scope |
| Feature flags | — | **None found** (no `FEATURE_*`, no `NEXT_PUBLIC_*_ENABLED`) | **Gap.** A dark launch needs a product decision: env-gated card, internal-only `?tab=palmistry`, or ship-when-ready |
| Analytics | `lib/trackEvent.ts` (fire-and-forget POST), `lib/productEvents.ts` (**closed** `ProductEventName` union, `CLIENT_TRACKED_EVENTS`, `FORBIDDEN_METADATA_KEYS`), `app/api/product-events/route.ts` | Tab-view events fire from `page.tsx`. Metadata is allow-listed per event, with a forbidden-key denylist | **High.** New events must be added to the closed taxonomy (an explicit future change, **not done here**) |
| Accessibility | `ui.tsx` (`useModalA11y`, `role="tablist"`/`aria-selected`, `FieldLabel visuallyHidden`), `aria-label`s on cards/back buttons | Reasonable ARIA conventions; `SegmentedControl` min-height 38px | **Medium.** A diagram needs a non-visual equivalent (see C.4). Note 38px < 44px recommended touch target |
| Auth gate | `page.tsx:1775` returns `LoginScreen` when no user | Explore is **signed-in only**. Guests get `/find` only | Palmistry inherits this unless product decides a guest version |
| Tests / CI | `.github/workflows/ci.yml` runs explicit `npx ts-node test/*.test.ts` files | No Explore e2e tests. Source-scan guards already read `ExploreView.tsx` (`test/actionPhase.test.ts:129–130`, `test/muhurtaRulePacks.test.ts:636`). `muhurthamFinderViewLogic` / `panchangCalendarLogic` tests also exist | A new content-integrity test must be **explicitly wired** into CI (as with #273). The existing source-scan guards are the precedent for the import-isolation test (G.1 criterion 7) |

### A.2 Infrastructure that does **not** exist (relevant to photo features)

| Capability | Finding on `origin/main` |
|---|---|
| Image upload / file input / `FormData` / blob storage | **None** (no `type="file"`, no multipart handling, no S3/Blob SDK) |
| Camera access | **None** (no `@capacitor/camera`, no `getUserMedia`) |
| Image/binary columns in Prisma | **None** (`schema.prisma` models are User, SavedPerson, AuraMoment, ProductEvent, HabitLog, PlannedActivity, Goal*, Capture (text-only), etc.) |
| LLM / multimodal AI | **None active.** `app/api/ask-aura/route.ts` states the prior Gemini fallback was removed and Ask Aura is deterministic. `GEMINI_API_KEY` remains only as documentation residue in `apps/web/.env.example`, `DEPLOY.md` and `deploy/README.md` |
| On-device ML runtime | **None** (no TF.js / MediaPipe / ONNX) |
| MCP server | **None in this repo** (no `mcp` paths). AURA-MCP-01-D1 is a separate audit |
| Account deletion endpoint | Not found by grep. `app/api/users/export` exists |

**Implication:** any photo-based phase is a net-new platform capability (capture, processing, retention, consent, deletion), not a small extension. This supports a no-photo MVP.

### A.3 Explore placement recommendation

The proposed path **Explore → Traditional Wisdom → Palmistry** introduces a taxonomy layer that **does not exist**. Explore is a flat list of three destination cards. Adding a "Traditional Wisdom" hub for one item would add a tap and a screen with no content to justify it.

**Recommendation:** add Palmistry as a **fourth `ExploreFeatureCard`**, placed **after** the three timing tools and before "Quick Explore". Suggested copy: kicker "Palmistry", action "Learn the lines of the hand", description "Explore Hasta Samudrika, the Indian tradition of reading the hand.", accent `colors.traditional`. It opens a new `AppTab` `'palmistry'` with "← Explore" back navigation, and Explore stays highlighted in the dock.

Revisit a "Traditional Wisdom" grouping only if a **second** non-timing tradition is approved later.

---

## B. Traditional Knowledge Research

### B.1 Method and limits

- Primary scholarly anchor: **Kenneth G. Zysk, "Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā", *History of Science in South Asia* 13 (2025): 240–275, DOI 10.18732/hssa128** (CC BY-SA 4.0). The full PDF was downloaded by the fetch tool and text-extracted locally; the passages cited below were read directly.
- Classical text: **Bṛhatsaṃhitā** of Varāhamihira, ch. 68 (*puruṣa-lakṣaṇa*) and ch. 70 (*kanyā-lakṣaṇa*), in **N. Chidambaram Iyer's 1884 English translation** (public domain; read via wisdomlib.org). This is a 19th-century translation with OCR errors and irregular numbering. The Sanskrit was **not** independently checked.
- Overviews: Wikipedia "Samudrika Shastra" and "Palmistry" (both rely mainly on Zysk 2016, *The Indian System of Human Marks*, Brill). One practitioner essay was read (Korin George, Substack, 2026). It is unsourced and is used only as a pointer, never as evidence.
- **Not read** (gaps): Zysk 2016 (the main monograph); the Gārgīyajyotiṣa, Bhaviṣyapurāṇa and Garuḍapurāṇa passages themselves; the full Sāmudrikatilaka and Hastasañjīvana (only Zysk's appendix excerpts); South Indian / Tamil (*kai rekai*) and regional traditions; modern Indian Hindi-language palmistry manuals (e.g., K. C. Sen, *Hast Samudrika Shastra*, 1965). **No Sanskritist has reviewed this report.**
- **No Sanskrit verses are reproduced or newly translated here.** Sanskrit terms appear only as names, as printed by Zysk.

### B.2 Source register

| ID | Source | Type | Date of text | Attribution confidence | Notes |
|---|---|---|---|---|---|
| S1 | Zysk 2025, HSSA 13: 240–275 | Peer-reviewed critical edition + translation | Śārdūlakarṇāvadāna *pāṇilekhā* chapter: entered the text "after the middle of the ninth century CE" (p. 240) | **High** | 34 verses, compiled from three metrical groups. Appendices translate Hastasañjīvana and Sāmudrikatilaka passages and reproduce hand diagrams (figs. 1–5; see S8) |
| S2 | Bṛhatsaṃhitā chs. 68, 70 (Iyer tr. 1884) | Classical Sanskrit text, 19th-c. translation | 6th c. CE (Zysk 2025: 240) | Text: **High**. Translation wording: **Medium** | Hand material: 68.36–50; 70.10–14, 22 |
| S3 | Gārgīyajyotiṣa | Classical | "c. early centuries CE" (S1: 240) | Existence/date: High (via S1). Content: **not read** | Named by Zysk as the earliest of four early formulations |
| S4 | Bhaviṣyapurāṇa | Purāṇa | 6th–7th c. CE (S1: 240) | Content: **not read** | Early formulation per S1 |
| S5 | Sāmudrikatilaka (Durlabharāja, completed by son Jagaddeva) | Medieval treatise | 1160–1175 CE (S1: 242) | **High** (date/authorship via S1). Content: excerpts only | Pre-dates any European influence |
| S6 | Hastasañjīvana with Meghavijaya Gaṇi's commentary (Tapāgaccha Jain) | Late-medieval treatise | Late 17th c. (Meghavijaya active 1674–1695, S1: 241) | **High** (via S1). Root-text authorship disputed (wisdomlib study) | First full integration of astrology and palmistry (S1: 241) |
| S7 | Garuḍapurāṇa | Purāṇa | Undated here | **Low** (secondary only: Wikipedia citing a dictionary) | Mentioned as including Sāmudrika; not verified |
| S8 | Indian hand diagrams, figs. 1–5 in S1 | Manuscript and printed artefacts | Fig. 3: 1732–33 CE (MS); fig. 4: 1747–48 CE (BHU MS); fig. 1: Rajasthan, undated; fig. 2: Pratāpa Muni 1929 (Gujarati Hastasañjīvana); fig. 5: S. Miśra 2002 | **High** (via S1) | Show named lines (āyur-, dhanamātṛ-, pitṛ-/Sarasvatī-rekhā) |
| S9 | Western chiromancy: d'Arpentigny *La Chirognomie* (1839); Desbarrolles; Heron-Allen (1883); Cheiro (W. J. Warner); W. G. Benham (1900) | Modern Western popular / esoteric literature | 19th–early 20th c. | **Medium** (dates via Wikipedia; specific innovations via one unsourced essay) | Origin of hand-shape types, planetary mount system, life/head/heart/fate naming as used today |
| S10 | Wikipedia "Palmistry" | Encyclopedia | 2026 revision | n/a | Scientific-status statement: "widely viewed as a pseudoscience" |

### B.3 Headline finding: the Western line names do **not** map onto the classical Indian system

This is the most important research result for product design. The ticket's list (life, head, heart, fate, Sun, Mercury) uses **19th-century Western** names. The classical and medieval Indian sources describe a different set of named lines, with different meanings. Some of those lines run along the same physical creases.

| Physical crease (anatomical description) | Modern Western name (S9) | Classical / medieval Indian name and meaning | Evidence | Classification |
|---|---|---|---|---|
| Upper transverse crease, from below the little finger toward the forefinger | **Heart line** | **āyurlekhā / āyūrekhā, "longevity line."** The length it reaches toward the forefinger was read as lifespan (S1 v.3: 100/70/50/30 yrs; diagrams 100/75/50/25). BS 68.50: a line reaching the root of the forefinger indicates 100 years. BS 70.13: a line from below the little finger toward the gap between forefinger and middle finger indicates long life | S1 pp. 243–244; S2 | **CLASSICAL SOURCE SUPPORTED** (that the line was so named and read). Positional equivalence to the Western "heart line" is **my inference** from S1's description and needs expert confirmation |
| Middle transverse crease | **Head line** | **dhanamātṛlekhā, "prosperity / mother line,"** linked to wealth. S1 v.6 also ties it to an asterism name, possibly Dhaniṣṭhā | S1 pp. 245–246 (v.6), 255 (v.24); S8 diagrams | **CLASSICAL / LATER TRADITION SUPPORTED** (S1 9th c.; diagrams 18th–20th c.). Position: inference |
| Crease arcing from the base of the thumb at the wrist | **Life line** | **pitṛlekhā, "father line,"** also *vidyā* / Sarasvatī ("knowledge") line in diagrams | S1 p. 243 (comment on vv.1–2); S8 | **CLASSICAL / LATER TRADITION SUPPORTED.** Note: the Western "life line" is **not** the Indian longevity line |
| The three lines together | — | **Sāmudrikatilaka 1.143:** three lines that emerge from the base (Zysk's English: "base of the thumb") and reach between thumb and forefinger relate to **family (gotra), wealth (dravya) and longevity (āyus)** | S1 Appendix p. 265 | **CLASSICAL SOURCE SUPPORTED** (12th c.) |
| Vertical line up the middle of the palm | **Fate / Saturn line** | **"Upward-going" line (*ūrdhva-*).** Later Rekhāśāstra reads it by **which finger it ends at** (Hastasañjīvana 3.2.80–82). BS 68.44: three lines from the wrist reaching the middle of the palm indicate kingship. BS 70.12: a line from the wrist to the middle finger | S1 p. 243; S2 | **CLASSICAL** (existence/position) + **LATER TRADITION** (finger-termination reading). "Fate" as a name: **MODERN POPULAR (Western)** |
| Line toward the ring finger | **Sun / Apollo line** | **Attested as a case of the upward line, not as a separate "Sun" line.** Hastasañjīvana 3.2.82: an upward line reaching the "refuge of Śiva" (ring finger) indicates a rich merchant or military leader. Sāmudrikatilaka 1.155 may also refer to the ring finger (the Sanskrit reads *anāmikā*; Zysk's English has "forefinger", unresolved) | S1 pp. 264–266 | Finger-termination reading: **LATER TRADITION SUPPORTED** (17th c.). The "Sun/Apollo" name and its Western meaning (fame, creativity): **MODERN POPULAR (Western)** |
| Line toward the little finger | **Mercury / health line** | Upward line reaching the little finger: Hastasañjīvana 3.2.82 (supported, famous); Sāmudrikatilaka 1.156 (high-ranking, wealthy). The Western "health" reading is **unsupported** classically and is **medically unsafe** | S1 pp. 264, 266 | Finger-termination reading: **LATER TRADITION SUPPORTED**. "Mercury" name: **MODERN POPULAR**. Health reading: **EXCLUDED** |
| Small lines on the "belly" of the thumb (later diagrams: below the little finger) | Western "children lines" (popular) | **Offspring lines.** Count = number of children (S1 v.7; BS 68.49: big = sons, small = daughters; BS 70.14) | S1 p. 246; S2 | **CLASSICAL.** Treat as historical only, **not** a personal reading (fertility claim) |

### B.4 Shaped marks (*lakṣaṇa*), the most distinctively Indian content

| Concept | Source | Traditional association (paraphrase) | Classification | Proposed user-facing wording |
|---|---|---|---|---|
| Barleycorn (*yava*) on or at the base of the thumb | BS 68.42; S1 vv.9–13 (extended section) | BS: wealth (middle of thumb), sons (root). Śārdūlakarṇāvadāna: day vs. night birth, happiness, prosperity | **CLASSICAL** | "Classical texts give special attention to a barley-grain shape on the thumb. The Bṛhatsaṃhitā links it with prosperity; a 9th-century Buddhist text uses it in birth-time omens." |
| Fish (*matsya*) | BS 68.44 (two fish in mid-palm: feeding many people); S1 (fish portends drink/food) | Abundance, generosity | **CLASSICAL** | "The fish mark was traditionally read as a sign of abundance." |
| Conch, lotus, umbrella, flag, elephant-goad, palanquin, horse, elephant | BS 68.45–46; 70.10 | Royalty / queenship / high status | **CLASSICAL** | "Classical lists of 'royal' marks include the conch, lotus and umbrella, symbols also seen in Indian art and iconography." |
| Weapon shapes (discus, sword, bow, spear) | BS 68.47 | Military command | **CLASSICAL** | Historical context only |
| Altar (*vedī*) at thumb root; mortar | BS 68.47–48 | Performing sacrifices | **CLASSICAL** | Historical context only |
| Adverse shapes (crow, owl, serpent, etc.) | BS 70.22 | Poverty and misery | **CLASSICAL** | **Exclude**, or mention only that "texts also list inauspicious marks", with no personal application |

General observation (S1 p. 240): early texts treat **lines** as applying to all people and **symbolic images** as mostly pertaining to royalty.

### B.5 Mounts and palm regions

| Concept | Finding | Classification |
|---|---|---|
| Planetary mounts (Jupiter, Saturn, Sun/Apollo, Mercury, Venus, Moon/Luna, Mars) | **Not found** in BS chs. 68/70 or in Zysk's edition and appendices (text search for mount/planet/graha terms returned nothing). The planetary-mount system is a feature of **European chiromancy**, linked to Renaissance astrology and systematized as personality types by 19th–20th-c. writers (Benham, Cheiro). Many **modern Indian** palmistry books use Sanskrit planet names (Guru, Śani, Sūrya, Budha, Śukra, Candra, Maṅgala). When and how this adoption happened was **not established** | Western: **MODERN POPULAR (Western)**. Indian usage: **SOURCE UNCERTAIN (likely modern)** |
| Astrology on the hand, Indian form | The Indian astrological overlay is **nakṣatras (asterisms) mapped onto the palm and fingers**: Hastasañjīvana 1.3.88–91 (S1 pp. 266–267) places 28 asterisms "three by three" on the palm and fingers, beginning with Aśvinī in the centre, read on the right hand. S1 also has early, unclear nakṣatra/lagna references | **LATER TRADITION SUPPORTED** (17th c.); early form **SOURCE UNCERTAIN** (S1: "the most uncertain part of the text") |
| Fleshy base of the thumb | Classical: site of offspring lines and yava/vedī marks. Western: "Mount of Venus" | Classical region **CLASSICAL**; "Venus" label **MODERN/WESTERN** |
| Palm hollowness / height | BS 68.39 (hollow palm: no paternal inheritance; round-hollow: wealth; high: generosity) | **CLASSICAL.** Avoid as personal reading |

**Recommendation:** the MVP should present **Indian regions and marks first**, and present the Western mount map only as a clearly labelled "Western palmistry (19th century)" overlay, or omit it. This is a product decision (§I).

### B.6 Hand characteristics

| Concept | Source | Classification | Handling |
|---|---|---|---|
| Palm colour (red auspicious; yellow → "forbidden women"; dry → poverty) | BS 68.40, 68.87, 68.97 | CLASSICAL | **Exclude** colour-based content. It is skin-tone-adjacent and moralistic |
| Palm texture (soft, lotus-like) | BS 70.11 | CLASSICAL | Historical mention only |
| Finger length/closeness/shape | BS 68.36–37, 68.43 | CLASSICAL | Historical; no personal judgement |
| Nails | BS 68.41 (incl. gender/sex-characteristic claim), 68.86–87, 68.101 | CLASSICAL | **Exclude** the 68.41 sex/gender claim entirely |
| Line depth / gloss / continuity | BS 68.43 (glossy, deep = wealth), 68.50 (broken = fall from a tree; many or no lines = poverty) | CLASSICAL | Present as "texts valued clear, unbroken lines". No outcome claims |
| Hand-shape types (square, spatulate, conic, philosophic…) | d'Arpentigny 1839 | **MODERN (Western, 19th c.)** | Optional labelled overlay or omit |
| Thumb characteristics | Classical focus is on **marks on** the thumb (yava), not thumb shape. Thumb-shape "willpower" readings are Western | Classical marks: CLASSICAL; thumb-shape psychology: **MODERN POPULAR** | Do not infer psychology |
| Which hand | **Right hand for men, left for women.** Zysk calls this "standard in Indian palmistry", while noting it is only *implied*, not stated, in the Śārdūlakarṇāvadāna (S1 p. 241). The convention is stated in Iyer's translator footnote to BS 70.10 (not in the verse itself as translated). Modern Western practice uses dominant vs non-dominant hand (S9; not verified in a primary source here) | Indian: **CLASSICAL / LATER TRADITION**. Western: **MODERN POPULAR** | Present as a **historical convention**, not an instruction keyed to the user's gender. Product decision on inclusive framing (§I) |

### B.7 Cross-tradition notes and disagreements

- **Line naming:** Indian = longevity / prosperity-mother / father-knowledge + upward line. Western = heart / head / life + fate. Same creases, different meanings. Blending them unlabelled would be culturally inaccurate.
- **Longevity line placement:** S1 v.3 uses a four-step unequal scale (100/70/50/30). The diagrams use 100/75/50/25, and one diagram marks 25 at the ring finger. The sources disagree among themselves (S1 p. 244).
- **Verse-numbering concordance:** Zysk numbers the Bṛhatsaṃhitā barleycorn verse as 67.42 (S1 p. 247), while Iyer's translation (used here) has 68.42. Bṛhatsaṃhitā chapter/verse numbers differ between editions, so content locators must name the edition (e.g., "BS (Iyer) 68.42").
- **Offspring line placement:** early texts put them below the thumb. Later diagrams put them at the edge below the little finger (S1 p. 246).
- **Antiquity claims:** popular "5,000-year Vedic palmistry" claims are **not supported**. The earliest datable formulations are early-centuries-CE to 6th c. CE (S1, S3, S2). Do not claim Vedic origin.
- **Western "Indian origin" narratives** (e.g., Cheiro's claimed Brahmin manuscript) are self-reported and unverified (Wikipedia "Cheiro").
- **Scientific status:** described as "widely viewed as a pseudoscience due to … the lack of evidence for palmistry's predictions" (Wikipedia, "Palmistry"). Aura content must frame everything as cultural tradition.

### B.8 Attribution confidence summary

| Claim class | Confidence |
|---|---|
| Existence, dating and authorship of S1, S2, S5, S6 | High |
| Indian three-line naming (āyur-, dhanamātṛ-, pitṛ-rekhā) and meanings | High (S1 + diagrams) |
| Positional correspondence Indian ↔ Western line names | **Medium.** It is my reading of S1's descriptions and has not been confirmed by a specialist |
| BS 68/70 specific verse content | Medium (19th-c. translation; Sanskrit not checked) |
| Planetary mounts absent from classical Indian texts | Medium-high for the texts read; **not verified** against Zysk 2016 or Garuḍa/Bhaviṣya |
| Date/process of Indian adoption of planetary mounts | **Low / unknown** |
| Regional (South Indian, Bengali, etc.) variants | **Not researched** |

---

## C. Proposed Product Experience

### C.1 Recommended MVP: Experience A, "Learn Palmistry" (no photograph)

**Can Experience A deliver real value without personal data?** Yes. The content is distinctive. The Indian line system, the *lakṣaṇa* marks and their link to Indian iconography, and the contrast with Western palmistry are not what most palmistry apps offer. It also fits Explore's "understand traditional knowledge" role. It needs no camera, no storage, no AI, no new dependency and no schema change.

**Experience B, "Explore My Palm,"** is **not recommended for the MVP** (see §D). A future intermediate step that avoids photos entirely is **"Look at your own hand"**: a guided self-observation prompt ("Find the upper crease below your little finger…"). The user looks at their own hand while reading the guide, with nothing captured. This gives a personal feel at zero privacy cost.

### C.2 Answers to the product questions (D1-C)

| Question | Recommendation |
|---|---|
| Educational first? | **Yes.** |
| Is image interpretation necessary for engagement? | No evidence it is. It adds the most risk (privacy, accuracy, hallucination) for unproven value |
| Manual identification before AI? | Yes. Any later photo phase should start with **user-placed annotations** (Approach B), never automated interpretation |
| How to correct uncertain interpretations? | N/A for MVP. In Phase 2+, every detected or placed feature must be editable/removable before any text is shown |
| Both hands? | Show **one illustrated right hand** (the classical default for the examined hand in the sources) with a note on the men-right / women-left convention and the Western dominant-hand convention. Mirroring for the left hand is optional polish |
| Explain differences between schools? | **Yes, briefly.** Each feature card has a "Tradition" badge. One short "Indian and Western palmistry" explainer |
| First-screen load? | Short intro (≤ 3 sentences) + diagram + "Lines / Marks" toggle. History is one tap away, not on the first screen |
| Mobile-first? | Diagram sized to viewport width (~320–360px). A list alternative below it. Detail opens inline (bottom card), not a new screen, to keep context |

### C.3 Screen specifications (text wireframes)

**Screen 1 — Explore entry (existing `ExploreView`, one added card)**
```
┌──────────────────────────────────────┐
│ Explore ✨                            │
│ Understand today. Find the right day… │
│ [🗓️ PANCHANG CALENDAR  Explore the day →] │
│ [✨ MUHURTHAM FINDER  Find an auspicious…]│
│ [📅 PLAN AHEAD  Find the best future time]│
│ [✋ PALMISTRY                          ] │  ← new; accent = colors.traditional
│ [   Learn the lines of the hand        ] │
│ [   Explore Hasta Samudrika, the Indian ] │
│ [   tradition of reading the hand.      ] │
│ [   📜 Traditional knowledge · no photo →]│
│ QUICK EXPLORE  (unchanged Muhurtham grid) │
└──────────────────────────────────────┘
```
Card footer states "no photo needed" to set expectations up front.

**Screen 2+3 — Palmistry guide (single screen, `AppTab 'palmistry'`)**
```
┌──────────────────────────────────────┐
│ ← Explore                             │
│ Palmistry                             │  PageHeader
│ Hasta Sāmudrika is part of Sāmudrika  │
│ Śāstra, the Indian study of bodily    │
│ marks. Explore how it reads the hand. │
│ ⓘ A cultural tradition, not a         │
│   scientific prediction.  [About ›]   │  ← always visible
│ [ Lines | Marks | Regions ]           │  SegmentedControl
│ ┌──────────────────────────────┐      │
│ │   (inline SVG right palm,    │      │
│ │    3–4 tappable lines        │      │
│ │    highlighted in accent)    │      │
│ └──────────────────────────────┘      │
│ Tap a line, or choose below:          │
│ ○ Longevity line (āyurlekhā)          │  ← ActionRow list = accessible
│ ○ Prosperity line (dhanamātṛlekhā)    │    equivalent of the diagram
│ ○ Father / knowledge line (pitṛlekhā) │
│ ○ Upward line (ūrdhvarekhā)           │
│ [ Indian and Western palmistry › ]    │
└──────────────────────────────────────┘
```

**Screen 4 — Feature detail (inline card / bottom sheet)**
```
┌──────────────────────────────────────┐
│ Longevity line · āyurlekhā       [×] │
│ [CLASSICAL SOURCE] badge             │
│ WHERE: The upper crease, from below  │
│ the little finger toward the         │
│ forefinger.                          │
│ TRADITION: Classical texts called    │
│ this the longevity line and          │
│ associated how far it reached with   │
│ length of life. Aura does not        │
│ estimate lifespan.                   │
│ IN WESTERN PALMISTRY: the same crease│
│ is usually called the "heart line"   │
│ and read differently.                │
│ SOURCES: Bṛhatsaṃhitā (6th c.) ch.68;│
│ Śārdūlakarṇāvadāna (9th c.), ed.     │
│ Zysk 2025.  [Read more ›]            │
│ RELATED: Prosperity line · Upward line│
└──────────────────────────────────────┘
```

**"About this tradition" (secondary, one tap)**: history in 4–6 short paragraphs (Sāmudrika scope; Bṛhatsaṃhitā; Śārdūlakarṇāvadāna; Sāmudrikatilaka; Hastasañjīvana; Western 19th-c. system; "why Aura presents this as tradition, not prediction").

**Screen 5 — Personalized exploration:** **not specified for MVP.** It is listed in §G as a future phase that requires separate authorization.

### C.4 Mobile and accessibility considerations

- Every tappable line/region has a hit area ≥ 44×44px (wider invisible stroke). The diagram is **never the only way in**: the `ActionRow` list duplicates it.
- SVG: `role="img"` + `<title>`/`<desc>`, or interactive `<g role="button" tabindex="0" aria-label="Longevity line">`. Focus ring uses `colors.borderFocus`. Selected state uses shape + colour (not colour alone).
- Text: plain English first, with Sanskrit (IAST) as a secondary label. Never Sanskrit-only.
- Respect `prefers-reduced-motion` (no animated "glow" effects).
- Visual tone: line drawing on the existing dark panel, `colors.traditional` accent, no stars/crystal-ball imagery.
- Works offline-ish: content is static and bundled, so no network fetch is needed after load.

---

## D. Technical Feasibility

### D.1 Two independent questions (kept separate throughout)
1. **Computer vision:** can the system reliably locate visible palm features in a photo?
2. **Cultural interpretation:** what does a sourced tradition associate with those features?

Neither establishes predictive validity. A high detection confidence says nothing about whether palmistry is true.

### D.2 Evidence on CV feasibility

| Sub-problem | State of the art (evidence) | Assessment |
|---|---|---|
| Hand detection, orientation, 21 landmarks, left/right | **MediaPipe Hands** (Zhang et al., arXiv 2006.10214): 21 2.5D landmarks + handedness score, real-time on mobile GPU. Browser via `@tensorflow-models/hand-pose-detection`. Google's Oct-2021 model card reports evaluation across skin-tone groups with no reported error pattern (secondary-source figures ~5–6% normalized error; not verified against the PDF) | **Feasible on-device.** Needs a new ML dependency (~MBs of model weights). Handedness from a single static palm photo can be ambiguous (front/back, mirrored selfie camera) |
| Palm ROI / region segmentation | Derivable from landmarks (mount regions = polygons between finger bases and wrist landmarks) | Feasible, approximate |
| **Major crease (line) detection** | Research-grade only. Examples: U-Net + context fusion palm-line segmentation (arXiv 2102.12127) on a small self-built dataset (mIoU 0.584); CAS_Palm deep edge detector (Phenomics 2022) with line similarity 0.813 vs ground truth on 5,251 images. Metrics are not comparable across papers. **No off-the-shelf, validated, smartphone-photo crease model** was found | **Not reliable enough for a consumer feature without our own dataset + validation.** mIoU ~0.58 means substantial pixel disagreement |
| Line continuity / breaks / "shaped marks" (fish, yava…) | No credible evidence of automated detection | **Not feasible** at present. Shape-mark detection would be pareidolia-prone |
| Image quality validation (blur, exposure, framing) | Standard heuristics (Laplacian variance, histogram, landmark presence score) | Feasible |
| Lighting / skin-tone robustness for creases | Crease contrast depends heavily on lighting and skin tone. No fairness evaluation for crease segmentation found | **High fairness risk.** Must be validated across Monk-scale tones before any launch |
| Confidence estimation | Landmark presence score exists. Crease models give per-pixel probabilities, but calibration on in-the-wild photos is unknown | Partial |

### D.3 Approach comparison

| Criterion | A. Manual interactive guide | B. Assisted photo annotation | C. Automated feature detection | D. Multimodal AI interpretation |
|---|---|---|---|---|
| Technical feasibility | **High.** Static content + inline SVG with existing primitives | Medium. Needs image capture, a canvas/overlay editor, and transient storage | Low–medium. Landmarks yes; creases research-grade | High to build, low to make trustworthy |
| Accuracy limits | None (no observation claimed) | User-placed, so accuracy = user's own judgement | Crease segmentation unreliable; marks infeasible | Will "see" lines and marks that are not there; unverifiable |
| UX | Simple, fast, no permission prompts | More personal; extra steps; drawing on a small screen is fiddly | Magical when it works, confusing when wrong | Fluent, but high risk of confident, unfounded text |
| Privacy | **None collected** | Photo touches the device; can stay local | Photo processed (local or remote) | Photo sent to a third-party processor |
| Operating cost | ~0 | Low (if local) | Low if on-device; dataset/validation cost is high | Per-call API cost |
| Latency | Instant | Instant (local) | 100s of ms on-device | Seconds |
| Device compatibility | All (web + Capacitor shells) | Needs file input/camera on web + iOS/Android WebViews | WebGL/WASM performance varies on low-end Android | Network-dependent |
| Accessibility | Good (list alternative) | Weak for low-vision/motor users (precise drawing) | Mixed | Text output is accessible; capture step is not |
| Testing | Content-integrity + UI tests | Plus image-flow e2e, consent, deletion tests | Plus labelled multi-tone dataset, accuracy and fairness benchmarks | Plus adversarial/hallucination evals, output filtering |
| Hallucination risk | **None** (fixed, reviewed content) | Low (user places features; text is template-mapped) | Medium (false detections) | **High** (invented features, invented "traditional" claims, invented sources) |
| Maintenance | Low | Medium | High (model updates, drift) | High (model/vendor changes, prompt regressions) |

**Comparative recommendation:** **Approach A for the MVP.** Approach B is the only photo approach worth a later spike, and only with **on-device, non-retained** processing. Approach C should wait until a validated crease model and a multi-tone evaluation exist. **Approach D should not be used to generate interpretations.** If ever used, limit it to structured observation (Layer 1), with output discarded unless the user confirms it and with fixed, sourced Layer-2 content. It currently has no infrastructure in the repo, and it conflicts with Ask Aura's deliberate removal of the LLM path.

---

## E. Architecture (proposed, not implemented)

### E.1 Layered interpretation model: **recommended**

```
Layer 1 OBSERVATION        Layer 2 TRADITION MAPPING        Layer 3 EXPLANATION
(MVP: user selection;      (static, sourced content)        (template text, hedged)
 later: user-placed /
 detected features)
  featureId ───────────▶  PalmEntry[featureId] ─────────▶  "According to the Bṛhatsaṃhitā…"
  {+ confidence,            {tradition, sourceIds,           + provenance badge
     userConfirmed}          classification, wording}         + uncertainty note
```

This design is appropriate: it keeps CV uncertainty (L1) separate from cultural attribution (L2), and makes L3 a pure, testable function. In the MVP, L1 is simply "the user tapped a feature", so observations cannot be invented.

### E.2 Component boundaries (suggested paths, for a future ticket)

| Unit | Suggested location | Notes |
|---|---|---|
| Content + source register | `packages/palmistry/src/content.ts`, `sources.ts` | Pure data + types. **Must not import** `packages/panchang`, `muhurta`, `recommendation`, `window-ranking`, `daily-guidance`, and none of those may import it |
| View | `apps/web/components/PalmistryView.tsx` | Uses `ui.tsx` + `theme.ts` only |
| Diagram | `apps/web/components/PalmDiagram.tsx` | Inline SVG, no dependency |
| Wiring | `ExploreView.tsx` (+1 card, +1 prop `onOpenPalmistry`), `page.tsx` (+`'palmistry'` in `AppTab`/`VALID_TABS`, render branch, dock highlight) | ~3 small edits |
| Tests | `test/palmistryContent.test.ts` (wired into `ci.yml`) | See acceptance criteria |

### E.3 Content model (proposed)

```ts
type Classification = 'CLASSICAL_SOURCE' | 'LATER_TRADITION' | 'MODERN_POPULAR' | 'SOURCE_UNCERTAIN';
type Tradition = 'INDIAN_CLASSICAL' | 'INDIAN_LATER' | 'WESTERN_MODERN';

interface PalmSource { id: string; title: string; type: 'classical-text' | 'translation' | 'scholarly-edition' | 'manuscript-diagram' | 'modern-popular';
  textDate: string; citation: string; licence?: string; url?: string; }

interface PalmEntry {
  id: string;                       // 'ayurlekha'
  kind: 'line' | 'mark' | 'region' | 'hand-feature';
  names: { english: string; iast?: string; westernEquivalent?: string };
  location: string;                 // observable, anatomical description
  diagramRef?: string;              // SVG element id
  traditions: Array<{ tradition: Tradition; classification: Classification;
                      association: string;   // user-facing, hedged
                      sourceIds: string[]; locator?: string; // 'BS 68.50', 'Zysk 2025 p.244'
                      disagreements?: string }>;
  excludedClaims?: string[];        // documented reasons for what is NOT shown
  related?: string[];
  reviewedBy?: { reviewer: string; date: string };  // content sign-off
}
```

### E.4 Data flow and privacy boundaries (MVP)

`content.ts` (bundled) → `PalmistryView` (client state: selected feature) → render. **No network calls, no persistence, no user data read or written.** Optional analytics (if separately approved) send only an enum `featureId`, never free text.

### E.5 Integration points and isolation guarantees

- **Panchangam / Muhurtham / Timing Search / Daily Rhythm / Home caution policy:** no imports in either direction. Enforce with a CI test that scans import graphs, or an ESLint `no-restricted-imports` rule.
- **Ask Aura:** no routing of palm questions in MVP (avoids reviving the LLM path).
- **MCP (AURA-MCP-01-D1):** **little value now.** The only exposable thing is read-only static content (`palmistry.listFeatures`, `palmistry.getFeature`). That is trivial and not a user need. Recommend **no MCP exposure** until the MCP architecture is approved *and* a concrete agent use case exists. **No photo/image tools via MCP, ever, without a separate privacy review.**
- **Auth:** none beyond the existing signed-in gate. **Users/preferences/DB:** none.

---

## F. Risks

| Area | Risk | Mitigation |
|---|---|---|
| Cultural accuracy | Presenting Western names (heart/head/life) as "Hasta Samudrika"; claiming Vedic antiquity | Indian-first naming; provenance badge on every entry; no "Vedic"/"5,000 years" claims; specialist review |
| Source quality | Reliance on a 1884 translation; Sanskrit unchecked; Zysk 2016 unread; regional traditions unresearched | Pre-launch review by a Sanskritist/Indologist; cite Zysk for every line claim |
| Interpretation quality | Classical content includes lifespan numbers, sex/gender, caste, colour and moral judgements | Explicit exclusions list (below); "Aura does not estimate lifespan" line; historical framing |
| Inclusivity | Men-right / women-left convention; gendered sons/daughters lines | Present as historical convention; do not ask the user's gender; no personal application |
| Image processing (future) | Unreliable crease detection; skin-tone and lighting bias; pareidolia for marks | Defer; require validated model + Monk-scale fairness evaluation; user correction mandatory |
| Privacy (future) | Palm images are a **biometric identifier class** (contactless palmprint recognition works from ordinary phone cameras, per vendor and academic literature) and may show skin conditions, tattoos, rings, faces in frame | No upload by default; on-device only; no retention; explicit consent; legal review under India DPDP Act 2023 and GDPR Art. 9 where applicable |
| User trust | Users read tradition as prediction; distress from "short longevity line" | Always-visible "tradition, not prediction" notice; no negative personal readings; no outcome certainty |
| Scope creep | Palmistry drifting into Home, Plan, or timing ranking | Hard isolation (E.5); acceptance criteria forbid it |
| Licensing | Zysk 2025 is **CC BY-SA 4.0**; reproducing its translations in-app may trigger share-alike and attribution obligations | Paraphrase; cite; do not embed translated verses without a licence decision |
| Maintenance | Content errors are reputational | Content lives in one typed module with source IDs and tests; a named reviewer signs off on each entry |

**Content exclusions (MVP):** lifespan estimates or numbers applied to the user; health/medical readings (incl. the Western "health line"); fertility/offspring counts as personal readings; marriage, wealth or career certainties; palm-colour and nail-based claims; the BS 68.41 sex-characteristic claim; caste/varṇa-based outcomes; adverse "inauspicious mark" readings; any advice to make financial, medical or relationship decisions.

---

## G. Proposed Roadmap

### G.1 Recommended MVP — **Phase 1: "Learn Palmistry" (educational, no photo)**

**Scope**
- One new Explore card + one new `AppTab` (`'palmistry'`) with back-to-Explore.
- Single guide screen: intro, always-visible tradition notice, Lines / Marks (/ Regions) toggle, inline-SVG right hand, accessible list, inline feature detail, "About this tradition" and "Indian and Western palmistry" explainers.
- Content: **~4 lines** (āyur-, dhanamātṛ-, pitṛ-, ūrdhva-rekhā), **~5 marks** (yava, matsya, śaṅkha, padma, chatra), and optionally 1–2 regions. Each entry has a source and a classification. Western equivalents are shown as labelled notes only.

**Explicit exclusions:** photos/camera/upload; AI/LLM; ML dependencies; DB tables; saved sessions; personalization; Ask Aura/MCP integration; analytics activation (unless separately approved); Home/Plan surfaces; any link to Panchangam, Muhurtham, Timing Search, Daily Rhythm or commencement caution; i18n; guest access.

**Dependencies:** product decisions in §I; a named content reviewer (Indologist/Sanskritist) for sign-off; illustration of one hand (can be hand-authored SVG).

**Acceptance criteria**
1. Explore shows a Palmistry card; tapping it opens the guide; "← Explore" returns; the dock keeps Explore highlighted.
2. Every `PalmEntry` has ≥ 1 valid `sourceId` and a `classification`. A CI test fails otherwise.
3. Every `MODERN_POPULAR` association is visibly labelled as Western/modern.
4. A banned-phrase test over all user-facing strings (e.g., "will definitely", "predicts", "proves", "lifespan of", "you will") passes.
5. The tradition notice is visible on the guide without scrolling at 375×812.
6. All features are reachable by keyboard/screen reader through the list; touch targets ≥ 44px.
7. Import-isolation test: `packages/palmistry` neither imports nor is imported by Panchang/Muhurtham/recommendation/window-ranking/daily-guidance packages.
8. Existing CI suite (ephemeris, muhurta, timing search, panchang…) passes unchanged. No diffs to Panchangam scoring or Timing Search files.
9. No network requests issued by the guide (verified in browser devtools / e2e), other than the allow-listed `/api/product-events` calls **if** Phase-1 analytics are approved.
10. Content reviewer sign-off recorded per entry (`reviewedBy`).

**Estimated complexity:** **Small-to-medium engineering** (≈ 2–4 dev-days: card + tab wiring is small; SVG diagram + detail UI is the bulk; tests ≈ 0.5 day). **Content is the critical path** (≈ 1–2 weeks including specialist review).

**Risks:** content accuracy and review availability; the diagram's precision on small screens.

### G.2 Later phases (candidates, not approved)

| Phase | Gate to start | Notes |
|---|---|---|
| 1.5 "Look at your own hand" guided self-observation | Phase 1 shipped + usage signal | Zero data collection; low cost; tests whether personal engagement matters |
| 2 Assisted photo annotation | Privacy/legal review; consent copy; decision on on-device-only; deletion design; new dependency approval (camera/file input) | User places lines on their own photo; **photo never leaves the device and is never stored by default** |
| 3 Automated detection | Validated crease model; labelled multi-skin-tone dataset; fairness and accuracy thresholds agreed in advance | Detection is advisory; user confirmation is required before any text |
| 4 Personalized interpretation + optional saved sessions | Phases 2–3 proven; storage and deletion infrastructure; separate product decision | Saved data = derived feature IDs only, never images, unless separately approved |

### G.3 Analytics and success criteria (recommendation only; nothing activated)

- **Phase 1 events (if approved):** `PALMISTRY_GUIDE_VIEWED`; `PALMISTRY_FEATURE_SELECTED` with metadata `{ featureId: <enum>, kind: 'line'|'mark'|'region' }`; `PALMISTRY_ABOUT_OPENED`. Add them to `ProductEventName`, `PRODUCT_EVENT_NAMES` and `CLIENT_TRACKED_EVENTS` with per-event allow-listed metadata.
- **Optional:** one-tap "Was this interesting? 👍/👎" (no free text).
- **Success = understanding and voluntary return:** share of guide viewers who open ≥ 2 features; return visits within 30 days; 👍 rate; zero trust complaints. **Not** time-on-screen maximization.
- **Future photo phase (if ever approved):** consent accepted rate, quality-failure rate, correction frequency. **Never** images, coordinates, crease geometry or derived feature vectors in analytics. Add relevant keys to `FORBIDDEN_METADATA_KEYS` pre-emptively (`image`, `photo`, `palm`, `landmarks`).

### G.4 Privacy baseline for any image phase (requirements, not claims)

The current architecture **cannot** support any of these today, because no image pipeline exists. They are requirements for a future design.

1. The educational guide always works with no photo.
2. Explicit, specific consent screen before the first capture; easy to decline.
3. **On-device processing by default.** No upload. If remote processing is ever proposed, it needs a separate decision covering processor, region, DPA, and no-training contract terms.
4. No image retention: in-memory only, discarded on leave, with no cache/IndexedDB copy.
5. No training use without a separate, informed opt-in.
6. Derived features stored only if the user saves, deletable individually and on account deletion. An account-deletion path should be confirmed first (none was found by grep).
7. Images and derived data excluded from logs, analytics, error reports and the `users/export` route unless the user saved them.
8. No sharing, no cross-user access, no MCP exposure.
9. Legal review: India DPDP Act 2023 (+ rules); GDPR Art. 9 if EU users (palm images processed for identification are biometric special-category data, and even unintended identifiability should be treated conservatively).

---

## H. Independent Review

**Reviewer:** a separate Claude subagent with no part in drafting, run read-only against `origin/main` @ `553f3b5`, the extracted Zysk 2025 text, and the wisdomlib Bṛhatsaṃhitā translation. It is an *independent AI review*, **not** a human or subject-matter-expert review. A Sanskritist/Indologist review is still required before content ships (§I, decision 4).

**Verdict (first pass): CHANGES REQUESTED.** Five minor citation/accuracy fixes. The structure and conclusions held.

| # | Check | Result | Evidence summary |
|---|---|---|---|
| 1 | Traditional claims sourced | FAIL (minor) → **fixed** | ≥ 12 claims matched Zysk pages and BS verses. Problems: Sun-line "no Indian equivalent" contradicted by HS 3.2.82; HS nakṣatra cite range; S8 diagram dates; ST 1.143 paraphrase; men-right/women-left hedge. Nothing fabricated; no Sanskrit verses reproduced |
| 2 | Classical vs modern distinguished | PASS | Every row classified; positional mapping labelled as inference, Medium confidence |
| 3 | Explore inspected accurately | NOTE → **fixed** | Inventory verified line by line. "No Explore-specific tests" was wrong (existing source-scan guards); GEMINI_API_KEY also in deploy docs |
| 4 | MVP proportionate | PASS | — |
| 5 | Image limits not understated | PASS | — |
| 6 | Privacy addressed | PASS (note → **fixed**) | §G.4 framed as requirements, not claims. Criterion 9 vs analytics conflict resolved |
| 7 | Not represented as predictive | PASS | — |
| 8 | No unauthorized code changes | PASS | `git status --short`: only pre-existing untracked files + this report; `git diff --stat` empty; HEAD `f35d35a` unchanged |
| 9 | Roadmap preserved | PASS | No edits; HOME-PLAN-PILOT not started |
| 10 | Workstreams isolated | PASS | Read-only `git show`; the `panch-overlap-01-i1` and `feature/aura-mcp-01-i1` worktrees untouched |

**Changes applied after review (author-verified against the Zysk text before applying):**
1. Sun/Apollo and Mercury rows rewritten. The upward line's ring-finger and little-finger terminations are attested in later tradition (HS 3.2.82, p. 264; ST 1.155–1.156, pp. 265–266). Only the Western names and meanings are modern. ST 1.155's Sanskrit/English divergence (*anāmikā* vs "forefinger") is flagged as unresolved.
2. HS nakṣatra cite → 1.3.88–91, pp. 266–267.
3. S8 diagram dates corrected (figs. 3–4 are 18th c.; fig. 2 is 1929; fig. 5 is 2002; fig. 1 undated).
4. Men-right/women-left hedged ("implied" in S1; stated in Iyer's footnote).
5. §A.1 tests row corrected; GEMINI_API_KEY locations corrected.
6. Non-blocking notes also applied: BS numbering concordance (Zysk 67.42 vs Iyer 68.42); ST 1.143 paraphrase aligned with Zysk's "base of the thumb"; "no network" criterion made conditional on the analytics decision.

**Post-fix status: APPROVE WITH NOTES.** This is the author's assessment that every requested change was addressed. The reviewer did not run a second pass. Remaining notes: the SHA caveat (local `main` 34 behind; re-verify the remote); research gaps disclosed in §B.1 belong to content review.

**Additional finding during fix verification:** ST 1.154 makes the upward line's meaning depend on varṇa (priest/warrior/merchant/worker). This supports the existing caste exclusion in §F.

---

## I. Final Decision

## **AURA-PALM-01-D1 — PRODUCT DECISION REQUIRED**

The research and architecture evidence is sufficient to scope a focused, no-photo educational MVP (§G.1). The independent reviewer agreed. The remaining research gaps (Zysk 2016, regional traditions, Sanskritist review) are disclosed and belong to the MVP's content-review step, not to engineering planning. An MVP ticket cannot be written until the seven product decisions below are made, because they change the content model, the copy and the launch mechanics.

### Product decisions required before an MVP ticket can be written
1. **Tradition framing:** Indian-classical-first (recommended), dual Indian/Western, or Western-familiar names with Indian notes. Determines whether the Western mount map appears at all.
2. **Lifespan content:** whether to explain that the upper crease was historically the "longevity line" (recommended, with "Aura does not estimate lifespan"), or omit longevity entirely.
3. **Gendered hand convention:** present the men-right / women-left convention as history only (recommended), or omit.
4. **Content reviewer:** who signs off (an Indologist/Sanskritist is recommended), and whether launch blocks on sign-off.
5. **Launch gating:** with no feature-flag system, choose ship-when-ready, an env-gated card, or deep-link-only internal preview.
6. **Analytics:** whether Phase-1 events are approved.
7. **Licensing:** whether to paraphrase only (recommended) or seek permission to quote translations (CC BY-SA 4.0 obligations).

---

## Sources

- Zysk, K. G. 2025. "Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā." *History of Science in South Asia* 13: 240–275. https://doi.org/10.18732/hssa128 — https://journals.library.ualberta.ca/hssa/index.php/hssa/article/view/128
- Varāhamihira, *Bṛhatsaṃhitā*, tr. N. Chidambaram Iyer (1884), ch. 68 https://www.wisdomlib.org/hinduism/book/brihat-samhita/d/doc229330.html and ch. 70 https://www.wisdomlib.org/hinduism/book/brihat-samhita/d/doc229332.html
- Wikipedia, "Samudrika Shastra" https://en.wikipedia.org/wiki/Samudrika_Shastra ; "Palmistry" https://en.wikipedia.org/wiki/Palmistry ; "Cheiro" https://en.wikipedia.org/wiki/Cheiro
- wisdomlib, "Date of Meghavijayagani's Commentary on the Hastasanjivana" https://www.wisdomlib.org/history/book/studies-in-indian-literary-history/d/doc1474901.html ; "Samudratilaka" https://www.wisdomlib.org/definition/samudratilaka
- George, K. 2026. "Palmistry Is Not in the Vedas…" (practitioner essay, unsourced; pointer only) https://evolutionarypalmistry.substack.com/p/palmistry-is-not-in-the-vedas-and
- Zhang, F. et al. 2020. "MediaPipe Hands: On-device Real-time Hand Tracking." https://arxiv.org/abs/2006.10214 ; Google Research blog https://research.google/blog/on-device-real-time-hand-tracking-with-mediapipe/ ; TF.js hand-pose-detection https://www.npmjs.com/package/@tensorflow-models/hand-pose-detection
- "Efficient Palm-Line Segmentation with U-Net Context Fusion Module" (arXiv 2102.12127) https://deepai.org/publication/efficient-palm-line-segmentation-with-u-net-context-fusion-module
- CAS_Palm / "Palmprint phenotype feature extraction and classification based on deep learning" (Phenomics 2022) https://www.bohrium.com/paper-details/palmprint-phenotype-feature-extraction-and-classification-based-on-deep-learning/864977993750020301-83878
- Smartphone palmprint dataset MPD (arXiv 2003.13266) https://arxiv.org/pdf/2003.13266.pdf
- Innovatrics, contactless palm verification on smartphones (vendor) https://www.innovatrics.com/resources/contactless-palm-verification-on-smartphones/
