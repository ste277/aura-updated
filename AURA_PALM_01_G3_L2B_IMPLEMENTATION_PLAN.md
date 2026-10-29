# AURA-PALM-01-G3-L2B: Licensing Implementation Plan and Human-Review Preparation

**Date:** 2026-11-11 · **Authorized by:** G3-L2-D (CONDITIONAL APPROVAL, L2-B), for planning and review preparation only.
**Not authorized:** application content changes, publishing licence notices, changing the frozen PDF (`d5fb7a1e…19a88`, verified unchanged), committing revised governance decisions, closing L1/L2.
**Status:** External legal review deferred (not waived). Publication HOLD. Merge freeze ACTIVE.

> Statements about licence effect are proposals for the qualified human Creative Commons reviewer to confirm. This is not legal advice.

## 0. Decision recorded (owner, G3-L2-D)

- **Selected:** L2-B as the preferred licensing strategy: license the complete Palmistry text under CC BY-SA 4.0, retain Zysk attribution, and preserve the current interpretations.
- **Owner acceptance in principle:** after authorized publication, third parties may reuse the licensed Palmistry text commercially under CC BY-SA terms.
- **Conditions:** (1) qualified human CC review; (2) exact scope; (3) L3/L4; (4) L6; (5) AI ownership; (6) Android/iOS compatibility; (7) remaining legal uncertainty needing counsel; (8) proposed G3-C/G3-L1 record updates that preserve history.
- **L1/L2 stay OPEN.** Selecting L2-B does not close them.

Condition-to-section map: C1 → §6 and the reviewer package; C2 → §1; C3 → §2; C4 → §3; C5 → §4; C6 → §5; C7 → §7; C8 → `AURA_PALM_01_G3_DISTRIBUTION/proposed_governance/PROPOSED_L2D_RECORD_AMENDMENTS.md`.

## 1. Proposed licensed scope (Condition 2)

**Principle.** Only the **Palmistry guide's explanatory and descriptive text authored for Aura** is licensed. Code, illustrations, UI chrome, third-party bibliographic data and all other Aura content are not.

### 1.1 IN scope (proposed)

| Item | Location (`origin/main` @ `1741a95`) | Count |
|---|---|---|
| Entry text: `title`, `description`, `interpretation`, `contextNote`, `westernComparison`, `tradition` | `packages/palmistry/src/content.ts`, `PALMISTRY_ENTRIES` | 9 entries (9 titles + the 40 prose/label fields in the 49-string inventory) |
| Guide introduction: `title`, `lead`, `tradition`, `linesAndMarks`, `westernDifference`, `limits` | `content.ts`, `PALMISTRY_INTRO` | 6 |
| Disclosures and notes: general, longevity, diagram caption, hand convention | `content.ts` constants | 4 |
| Palmistry-specific prose in the view: Explore card description, action line and footer; marks note; "Shown as line N … (approximate)" / "Shown as a symbol only…" | `apps/web/components/PalmistryView.tsx` | about 6 |

### 1.2 OUT of scope (proposed)

| Item | Why |
|---|---|
| All application code (TS/TSX/JS, tests, build scripts), including `content.ts` as code | Software, not the licensed text. The licence attaches to the text expression, not to the file |
| Hand diagram and five mark glyphs (`PalmHandDiagram.tsx`) | Aura's own illustrations; not Zysk-dependent (L6 pending). Owner keeps its rights (subject to N3) |
| Generic UI labels and navigation ("Back to Explore", "Selected", "Where", "In this tradition", "Sources", badge labels such as "Classical source", error/fallback text) | Application UI chrome, not guide content. **Reviewer to confirm** that excluding them doesn't under-license any Adapted Material (none of them is Zysk-dependent) |
| `traditionalName` IAST terms | Sanskrit terms (facts; L7), not licensable expression of Aura's |
| Source list entries (`sources.ts`: titles, authors, editions, citations) | Third-party bibliographic data and facts. **Note:** some `author` strings contain an Aura remark (the Meghavijaya catalogue caveat). Reviewer to decide whether to include those remarks |
| The temporary review notice | Removed on approval |
| Aura name, logo, icons, emoji, other features, screenshots | Not Palmistry text |

**Implementation aid (future, L2-I):** mark the licensed text as a single, documented set (for example, a comment block in `content.ts` naming the licensed constants, plus a list in the docs), so scope can be verified mechanically.

## 2. Attribution and modification notices: draft wording (Condition 3, L3/L4)

**Draft only; not published.** For the CC reviewer and Reviewer B.

**A. Aura licence notice** (proposed placement: top of the guide's Sources card, and in a docs `LICENSE-palmistry` file):

> The text of this Palmistry guide is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). It is based in part on, and adapted from, Kenneth G. Zysk, "Early Indian Palmistry. Śārdūlakarṇāvadāna: Pāṇilekhā", *History of Science in South Asia* 13 (2025), © Kenneth G. Zysk, licensed under CC BY-SA 4.0. Aura has paraphrased and summarised that work. The illustrations, the rest of the Aura app and its code are not covered by this licence.

**Open choices for the reviewer:**
- **(i) Copyright line for Aura's text.** Options: "© [owner/legal entity] [year]", or no © line. A © claim may overstate rights in AI-generated text (§4).
- **(ii) "Adapted from" vs "based on".** "Adapted from" is cautious and consistent with L2-B; it doesn't concede L1, but the reviewer should confirm.
- **(iii) Change indication.** The existing "Aura's text paraphrases this work" (Zysk row) plus the sentence above should satisfy §3(a)(1)(B) and the journal's acknowledgement request (author + "initial publication in this journal": the journal is named).
- **(iv) Whether the notice must also appear in the native apps' about/licences screen,** even though the text is served from the web (§5).

**B. Existing Zysk attribution:** unchanged (creator, © notice, CC BY-SA 4.0 link, source link, "paraphrases" note). L3 is confirmed only by the reviewer.

## 3. Illustration provenance check (Condition 4, L6)

| Step | Evidence |
|---|---|
| 1 | Provenance excerpt: SVG authored 2026-11-10 06:03Z, edited 06:22Z, with no image opened or extracted (main and sub-agent transcripts) |
| 2 | Human visual comparison of PDF screenshots 03, 05 and 06 (and the live SVG) against Zysk 2025 Appendix II figs. 1–5 **and their underlying sources**: fig. 1 (1998 exhibition catalogue, Santiago de Compostela), fig. 2 (Pratāpa Muni 1929), figs. 3–4 (manuscripts, 1732–48), **fig. 5 (S. Miśra 2002: protected, possibly outside Zysk's CC grant)** |
| 3 | Reviewer records "no derivation concern" or names a concern. If a concern is found: redraw independently (separate authorization) |

Illustrations are **out of licence scope** (§1.2) whatever the L6 outcome.

## 4. AI-generated content: ownership and rights assessment (Condition 5)

### 4.1 Facts

| Category | Strings / assets | Evidence |
|---|---|---|
| Owner-authored (verbatim in owner tickets) | Guide subtitle, lead, general disclosure, Explore card description, first longevity sentence, "Upward line" | Transcript, 2026-11-10 05:57Z |
| AI-generated text (directed by owner decisions, revised after AI reviews) | All other licensed text | Transcripts; commits list the owner as author, co-authored by the AI |
| AI-generated illustrations | Hand diagram, 5 glyphs | Transcript |
| Human line-editing of AI text | **None recorded** | — |
| AI provider terms | **Not yet supplied** | Owner to supply |

### 4.2 Questions for the CC reviewer and, where flagged, counsel

1. Can Aura validly apply CC BY-SA 4.0 to AI-generated text? If no copyright subsists, does the notice still serve L2-B's purpose (meeting ShareAlike for any Adapted Material)? Does it create any misrepresentation risk?
2. **US:** current US Copyright Office guidance and case law require human authorship. To what extent are owner selection and direction enough? **(Counsel)**
3. **India:** the Copyright Act 1957 defines the author of a computer-generated work as "the person who causes the work to be created" (s. 2(d)(vi)). How does that apply to these AI outputs, and who is that person? **(Counsel)**
4. Do the AI provider's terms assign or license output rights to Aura, and do they restrict open licensing? (Needs the terms.)
5. Is there third-party-rights risk in the AI outputs beyond Zysk? Evidence: G3-L1 overlap test (max 11-word conventional phrase; at most 3 words with Wikipedia).
6. What provenance records should Aura keep from now on?

## 5. Android and iOS distribution compatibility (Condition 6)

### 5.1 Facts (repository evidence)

- The native shells are **Capacitor in remote-URL mode** (`apps/web/capacitor.config.ts`: "The native shells load the web app by URL"; production `server.url` = the deployed web app).
- The bundled `webDir` (`apps/web/cap-shell/index.html`) is only an offline fallback, with **0** Palmistry mentions. Nothing under `apps/web/ios` or `apps/web/android` mentions Palmistry.
- So **the licensed text is not inside either store binary.** It is delivered from the web at runtime.
- **Store publication status:** [owner to confirm whether the apps are, or will be, on the App Store / Google Play, and under which EULA].

### 5.2 Assessment (not legal advice)

| Platform | Known issue | Aura position | Residual uncertainty |
|---|---|---|---|
| **iOS (App Store)** | Long-running debate over whether Apple's standard Licensed Application EULA and its usage rules and mandatory DRM conflict with CC BY-SA §3(b)(3) (no additional terms or effective technological measures on Adapted Material). Discussed in developer forums only; no authoritative ruling found | Licensed text is not in the binary (remote-URL), which reduces exposure. The app EULA governs the shell; content is fetched from the web | **Whether Apple's EULA/usage rules reach content displayed inside the app shell** is unresolved. Options: rely on remote delivery; use a custom EULA that carves out the CC-licensed text (must not conflict with the App Store terms); or ask counsel. **Flag for counsel (§7)** |
| **Android (Google Play)** | Play does not impose a standard end-user EULA on app content as Apple does; app signing isn't content DRM | Remote-URL delivery; no Palmistry text in the APK/AAB | Low. The reviewer should confirm Play's developer distribution terms impose no restriction on the CC-licensed text |
| Web | — | Primary delivery; the notice is shown in-guide | None identified beyond §2 |

**Implementation requirements (future L2-I):**
- **Keep** Palmistry text out of native bundles (remote-URL mode) unless re-reviewed.
- Show the licence notice wherever the guide renders.
- Consider a "Licences" entry in native about screens.

## 6. Human CC review (Condition 1)

See `AURA_PALM_01_G3_L2B_CC_REVIEWER_PACKAGE.md`: reviewer qualifications, questions per condition, materials and deliverable. Its fallback-closer role mirrors G3-C requirements §1A (internal licensing reviewer with CC BY-SA 4.0 expertise). **Under L2-D the human CC review is mandatory.**

## 7. Remaining legal uncertainty: candidates for external counsel (Condition 7)

| # | Question | Why it may need counsel | Can the CC reviewer resolve it? |
|---|---|---|---|
| U-1 | Apple EULA / usage rules / DRM vs CC BY-SA §3(b)(3) for in-app display of remotely served licensed text | Platform-contract interpretation; no authoritative guidance | Partly (can recommend a custom EULA carve-out). **Counsel recommended if the iOS app is distributed** |
| U-2 | AI authorship and ownership (US human-authorship requirement; India s. 2(d)(vi)); validity and effect of applying CC BY-SA to AI text; © line | Unsettled, jurisdiction-specific | Partly (notice drafting). **Counsel recommended** for the ownership question |
| U-3 | Whether licensing the full text set under CC BY-SA 4.0 satisfies all ShareAlike obligations for any Adapted Material (the L2-B design intent) | Core of L2-B | **Yes, likely** (CC expertise). Counsel only if the reviewer is uncertain |
| U-4 | Scope boundary (text vs code vs UI vs illustrations) is adequate | Licence-interpretation detail | **Yes** |
| U-5 | Attribution and journal acknowledgement (L3/L4) | Notice adequacy | **Yes** |

**Provisional view:** U-3 to U-5 sit with the CC reviewer. U-1 (if the iOS app ships) and U-2 are the likely residual counsel questions. External review stays **deferred**; the owner decides after the CC reviewer reports.

## 8. Implementation sequence (future; each step separately authorized)

1. **CC review gate (G3-L2B-R):** designate the human CC reviewer, authorize sharing the review package (minimum materials), and receive written findings on Conditions 1–7.
2. **Owner decisions** on the reviewer's findings: notice wording (with Reviewer B), scope, © line, iOS approach, whether to engage counsel for U-1/U-2.
3. **Governance amendments (G3-L2B-G):** authorize applying the proposed G3-C and G3-L1 amendments (drafted, not applied).
4. **Implementation (G3-L2-I):** feature-branch change adding the licence notice and scope marking. No interpretation changes. Tests: Palmistry suites (220/78/30); approval file unchanged; scanners pass; overlap re-run not needed (no prose change); isolation preserved. No merge (freeze).
5. **Review package v1.2** (separately authorized), if reviewers need to see the notice in context.
6. L1/L2 close only on recorded reviewer (and, if engaged, counsel) evidence. Publication stays a separate gate.

## 9. Status of findings (unchanged by this plan)

L1 OPEN · L2 OPEN · N3 OPEN · L3/L4/L6 OPEN (publication blockers) · L5/L7/L8 OPEN (P2) · GF-1 to GF-3 OPEN · PD1 approved.
