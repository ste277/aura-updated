# AURA-PALM-01-G1: Palmistry Content Governance and Publication Readiness

**Type:** Review and audit only. No code, content, configuration, deployment or merge changes were made.
**Date:** 2026-11-11
**Author:** Claude Code (Opus 5.5), at the request of the repository owner
**Publication:** HOLD · **Production merge freeze:** ACTIVE (respected)

> This report records evidence. It does not approve content, grant licensing clearance, or authorize publication. AI review is not expert sign-off.

---

## 0. Audit baseline and method

| Item | Value |
|---|---|
| Repository | `ste277/aura-updated` |
| Audited revision | `origin/main` @ `1741a95` (merge of #347, 2026-11-10), fetched 2026-11-11 |
| Local `main` | `f35d35a`, **49 commits behind** `origin/main`. It contains no Palmistry code. Not modified. |
| How audited | A detached, throw-away `git worktree` of `origin/main` in the session scratchpad. Dependencies were installed there only. The user's checkout, branches and working tree were not touched. |
| Live check | Read-only unauthenticated `GET` of `https://aura-updated.vercel.app/` and `/?tab=palmistry`, plus every JS chunk they reference and the webpack runtime chunk map (17 files, 1.10 MB). |
| GitHub | Read-only `gh pr view 338`, `gh run list/view` on `main`. |

**Commands re-run for this audit (worktree at `1741a95`)**

| Command | Result |
|---|---|
| `npx ts-node test/palm01I1Content.test.ts` | **220 passed, 0 failed** |
| `npx ts-node --project tsconfig.jsdom-tests.json test/palm01I1ExploreJsdom.test.ts` | **78 passed, 0 failed** |
| `npx ts-node test/palm01P4VercelGuard.test.ts` | **30 passed, 0 failed** (incl. D1: approval still `PENDING_HUMAN_REVIEW`, no approver) |
| GitHub CI run 42861524237 on `1741a95`: Palmistry steps | All 3 test steps **success**; `check-palmistry-bundle.js` step **success** ("none of 8 Palmistry sentinels present") |

---

## 1A. Product decision PALM-01-G1-PD1: Explore placement

| Field | Value |
|---|---|
| Decision ID | PALM-01-G1-PD1 |
| Date | 2026-11-11 |
| Decided by | Product owner (repository owner), in response to finding G1-P2-01 |
| Decision | **KEEP D1 PLACEMENT.** The Palmistry card stays directly on Explore. No "Traditional Wisdom" navigation layer is introduced for the current MVP. |
| Basis | AURA-PALM-01-D1 §A.3: Explore is a flat list of destination cards, and a "Traditional Wisdom" hub holding one item would add a tap and a screen with no content to justify it. D1 recommended revisiting a grouping only if a second non-timing tradition is approved later. |
| Matches shipped code? | Yes. `apps/web/components/ExploreView.tsx:102–113` (fourth `ExploreFeatureCard`); no code change needed or made. |
| Revisit trigger | Approval of a second non-timing tradition (per D1 §A.3). |
| Does not change | Publication HOLD, approval status (`PENDING_HUMAN_REVIEW`), the Production merge freeze, or any roadmap milestone. |

---

## 1. Verified milestone status

Status is based on evidence found, not on earlier claims.

| Milestone | Claimed | Evidence found | Verified status |
|---|---|---|---|
| **PALM-01-D1** Discovery | Complete | `AURA_PALM_01_D1_DISCOVERY_REPORT.md` (520 lines, 2026-11-10): Explore inventory, source register, risk, roadmap. Independent review was an **AI subagent**, first pass "Changes requested"; post-fix status is the author's own assessment (no second review pass). Ends **"PRODUCT DECISION REQUIRED"** with 7 open decisions. The file is **untracked** (local only, not in git). | **Complete as a discovery draft.** Review was AI-only, and the closing state was "decision required". |
| **PALM-01** MVP scope | Approved | Code cites "product decision 2.1 / 2.2 / 2.3 / 2.4 / 2.7" (`packages/palmistry/src/content.ts:3,5,13,75,83`). **No decision record** was found in the repo, the local untracked docs, or PR #338. The shipped scope matches D1's recommended options (Indian-first, longevity explained with disclosure, hand convention as history, paraphrase only, gated launch, one analytics event). | **Implemented, but the scope decision is untraceable.** See finding G1-P2-02. |
| **PALM-01-M1** PR #338 | Merged | `gh`: **MERGED** 2026-11-10T11:00:15Z, merge commit `afbe5204`. PR body still says *"Draft. Do not merge."* **0 GitHub reviews** recorded. One check failed at merge (*Day Constructor acceptance DB tests*); it is unrelated to Palmistry and has failed on `main` since at least `8e9802e`. Reviews were run as AI "independent reviews" (described in PR body). | **Merged.** Merge authorization is not recorded on GitHub. See G1-P2-03. |
| **PALM-01-M2** Integration | Complete | No M2 artifact or ticket record found. Integration evidence does exist: PR #338's P4 commit merged `main` (`9a487a9`) into the branch, resolved the `ci.yml` conflict, and wired the scanner into `vercel-build.sh`. CI on every later `main` commit runs the Palmistry steps green. | **Functionally evidenced, not documented as a milestone.** See G1-P2-02. |
| **PALM-01-M3** Deployment verification | "Deployed and verified, content unpublished" | `AURA_PALM_01_M3_PRODUCTION_RECOVERY.md` (untracked): first Production build of `afbe520` failed on a transient DB reach error (P1001), one redeploy succeeded (`dpl_CGik…`), 0/8 sentinels live. **Re-verified today:** Production now serves a later deployment (`dpl_B9ER…`), `/` and `/?tab=palmistry` are byte-identical (200), **0 of 11 content strings** found in 17 live chunks (the 8 CI sentinels plus "yurlekh", "Barleycorn", "no photo needed"). The 10 "palmistry" matches are code identifiers only, as M3 described. | **Verified, still holds.** |

---

## 2. Content inventory and source traceability

All user-visible content lives in two files: `packages/palmistry/src/content.ts` (entries, guide text, disclosures) and `apps/web/components/PalmistryView.tsx` (UI labels and the Explore card copy). Sources are in `packages/palmistry/src/sources.ts`.

The verbatim text of every entry is in `docs/palmistry/AURA_PALM_01_I1_CONTENT_REVIEW_PACKET.md` §3. **Drift check:** all 31 entry strings (description, interpretation, context, Western comparison) in `content.ts` appear verbatim in the packet. The packet is current.

### 2.1 Entries (4 lines, 5 marks)

| ID | Title / term | Interpretation (as framed in the app) | Sources (locator) | Attribution / confidence | Claim qualified? | Notes for review |
|---|---|---|---|---|---|---|
| `ayurlekha` | Longevity line, *āyurlekhā* | "Associated with length of life" in this tradition | Bṛhatsaṃhitā (Iyer 68.50; 70.13); Śārdūlakarṇāvadāna vv. 3, 6; 18th-c. diagrams | Classical / High | **Yes.** Plus a dedicated longevity disclosure; no numbers or ages anywhere. | Packet Q1 (term from an editor's suggested reading in v. 3) |
| `dhanamatrlekha` | Prosperity line (mother line), *dhanamātṛlekhā* | Linked with wealth; named after a lunar asterism | Śārdūlakarṇāvadāna vv. 6, 24; later diagrams | Later tradition / Medium | **Yes.** "Not a forecast of anyone's finances." | Q2 spelling. The sentence "Historically 'wealth' meant fortune in general" is unsourced framing (§5.3 W2). |
| `pitrlekha` | Father line (knowledge line), *pitṛlekhā* | Line of knowledge; later "father's line"; one diagram links it to Sarasvatī | Śārdūlakarṇāvadāna vv. 1–2; diagrams; Sāmudrikatilaka 1.143 | Later tradition / Medium | **Yes.** "Not a measure of intelligence, ancestry or character." | Q3, Q4 |
| `urdhvarekha` | Upward line, *ūrdhvarekhā* | Read by the finger it reaches: king/minister, general, merchant, renown | Hastasañjīvana 3.2.80–82; Sāmudrikatilaka 1.152–156; Bṛhatsaṃhitā 70.12; Śārdūlakarṇāvadāna vv. 1–2 | Later tradition / High | **Yes.** Framed as "social roles of its time". | Q5, Q6, Q14. Mentions variation by social class (varṇa); sensitive, needs cultural review. |
| `yava` | Barleycorn, *yava* | Prosperity; at the thumb's root linked "with sons"; birth-time omens | Bṛhatsaṃhitā 68.42 (Skt. 67.42); Śārdūlakarṇāvadāna vv. 9–15, 22 | Classical / High | **Partly.** "Historically… interpreted as", but the "sons" clause is a progeny/gender reading with no context note. | §5.3 W1 |
| `matsya` | Fish, *matsya* | Abundance; feeding many; drink, food, wealth | Bṛhatsaṃhitā 68.44; Śārdūlakarṇāvadāna vv. 15, 22 | Classical / High | Yes | Sources disagree on position and meaning (stated) |
| `shankha` | Conch, *śaṅkha* | Royal mark (kingship) | Bṛhatsaṃhitā 68.45, 70.10; Śārdūlakarṇāvadāna v. 21 | Classical / High | Yes | — |
| `chatra` | Parasol, *chatra* | Royal mark (kingship / queenship) | Bṛhatsaṃhitā 68.45, 70.10; Śārdūlakarṇāvadāna v. 21 | Classical / High | Yes | Q9 (*gajachatra* emended to *rājachatra*) |
| `vedi` | Altar, *vedī* | Associated with performing sacrificial rites | Bṛhatsaṃhitā 68.48; Śārdūlakarṇāvadāna v. 22 | Classical / High | Yes | — |

### 2.2 Guide-level text, disclosures and UI copy

| Item | Location | Qualified? |
|---|---|---|
| General disclosure: "Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events." | `content.ts:72` | Yes. Always visible (jsdom tests). |
| Longevity disclosure: "Aura does not estimate lifespan or predict death…" | `content.ts:76` | Yes |
| Diagram note ("A schematic drawing, not a real hand…") | `content.ts:80` | Yes |
| Hand-convention note (men right / women left, history only; Aura never asks or infers gender) | `content.ts:85` | Yes. Gendered content, already a reviewer item. |
| Intro: tradition, lines vs marks, Indian vs Western, limits ("They are not claims about you.") | `content.ts:88–100` | Yes. Contains dating claims (6th, 9th, 12th, 17th c.) that need scholarly confirmation (Q13). |
| Review notice: "Preview content: awaiting review by a qualified scholar before public release." | `content.ts:113` | n/a |
| Explore card: "Palmistry · Learn the lines of the hand · Explore traditional Indian interpretations of palm lines and symbols · Traditional knowledge · no photo needed" | `PalmistryView.tsx:48–53` | Yes |
| UI labels ("In this tradition", "Context and uncertainty", "Western palmistry, for comparison", "Which hand?", error/fallback text) | `PalmistryView.tsx` | n/a (structural) |

**Traditional vs scientific claims.** The content makes **no scientific claims**. Every interpretation is attributed to a named text or "this tradition". The factual claims it does make are **historical/philological** (dates, attributions, verse numbers, Sanskrit terms). These need scholarly, not scientific, verification. No deterministic health, lifespan, relationship or financial prediction was found. The one item closest to a relationship/progeny reading is the *yava* "sons" clause (W1).

### 2.3 Illustrations and visual assets

| Asset | Location | Origin | Licensing |
|---|---|---|---|
| Schematic right palm with 4 lines (inline SVG) | `apps/web/components/PalmHandDiagram.tsx` | Original hand-written SVG paths (D1/P5 state it does not copy Zysk figs. 1–5) | Original work. **Not yet accepted as non-derivative by a licensing reviewer.** |
| 5 mark glyphs (inline SVG) | `PalmHandDiagram.tsx` | Original geometric paths | Same |
| Card icons ✋ 📜 | `ExploreView.tsx:107–109` | System emoji | No asset shipped |
| Review screenshots 01–06 | `docs/palmistry/screenshots/` | Captured from local dev build | Internal review material, not shipped |

### 2.4 Source register

| ID | Work | Verification (what was actually read) | Licensing (as recorded, not cleared) |
|---|---|---|---|
| `zysk-2025` | Zysk, *HSSA* 13 (2025) 240–275, DOI 10.18732/hssa128 | read directly | **CC BY-SA 4.0.** Paraphrase only. ShareAlike question open. |
| `sardulakarnavadana` | Śārdūlakarṇāvadāna, palmistry chapter | via Zysk's edition/translation | Text public domain; translation CC BY-SA 4.0 |
| `brhatsamhita` | Varāhamihira, Bṛhatsaṃhitā | Iyer 1884 English, read directly. **Sanskrit not checked.** | 1884 translation expected public domain (unconfirmed) |
| `samudrikatilaka` | Durlabharāja / Jagaddeva | Excerpts in Zysk only | As Zysk |
| `hastasanjivana` | Meghavijaya | Excerpts in Zysk only | As Zysk |
| `hand-diagrams-18c` | Manuscript diagrams | Described in Zysk; images not reproduced | n/a |

**Gaps disclosed but not closed:** Zysk 2016 (*The Indian System of Human Marks*) not consulted; Sanskrit of the Bṛhatsaṃhitā verses not checked; regional traditions not covered.

---

## 3. Technical publication-safeguard audit

| Requirement | Result | Evidence |
|---|---|---|
| Placement in Explore | **Pass (decision recorded 2026-11-11, see §1A)** | Palmistry is the **fourth card directly on Explore** (`ExploreView.tsx:102–113`), with no "Traditional Wisdom" layer. This was the D1 recommendation (D1 §A.3) and is now the explicit product decision PALM-01-G1-PD1. |
| Explore dock highlighting | Pass | `page.tsx:2155` includes `'palmistry'` |
| MVP is **no-photo** | **Pass** | No `type="file"`, camera, `getUserMedia`, upload, canvas, storage or `fetch` in `Palm*.tsx`. No API route references palmistry (test J5). Card footer says "no photo needed". |
| **No influence on Panchangam / Muhurtham ranking** | **Pass** | `git grep -i palm` outside tests/docs hits only `page.tsx`, `ExploreView.tsx`, `productEvents.ts`, the Palm components, the build/scanner scripts and `ci.yml`. **No hits** in `packages/panchang`, `muhurta`, `window-ranking`, `recommendation` or any other engine package, nor in `apps/mcp`. `packages/palmistry` imports only its own JSON. Enforced by tests J1, J2, J4. |
| Status is `PENDING_HUMAN_REVIEW` | **Pass** | `packages/palmistry/src/review-status.json` = `{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}` |
| `approvedBy` is `null` | **Pass** | Same file; `content.ts:114` reads it; guard test D1 asserts it |
| **Fail-closed approval** | Pass | `content.ts:111` treats anything other than the exact string `APPROVED` as pending. Build exclusion (`palmistry-build-exclusion.js:23–26`) also requires exactly `APPROVED`. |
| Layer 1: runtime gate | Pass | `isPalmistryAvailable()` (`PalmistryView.tsx:39–44`) is false in production unless approved. `page.tsx:290` removes the tab from `VALID_TABS`, so `?tab=palmistry` is refused. |
| Layer 2: build exclusion | Pass | `next.config.js:18–20` → `NormalModuleReplacementPlugin` swaps `components/PalmistryView` for the content-free stub in every `next build` while unapproved. Cache key includes the approval state. Next 14.2.35 with webpack (no Turbopack in `build`). |
| Layer 3: CI scanner | Pass | `ci.yml:692–694`, after `next build`. Green on `1741a95`. |
| Layer 4: Vercel build scanner | Pass | `apps/web/scripts/vercel-build.sh` runs `check-palmistry-bundle.js` under `set -e` after `next build`, for Preview and Production. Guard test 30/0. |
| **No unapproved content publicly accessible** | **Pass (re-verified 2026-11-11)** | Live Production: `/` and `/?tab=palmistry` identical, 0/11 content strings across 17 chunks |
| Docker deploy path | Partial | `deploy/Dockerfile` runs `npm run build`, so the exclusion applies; it does **not** run the scanner (G1-P3-01) |
| Reviewer access | Limitation | The guide only renders in `next dev`. Vercel Preview is a production build and shows nothing. Reviewers rely on the packet text and 6 screenshots (G1-P3-03). |

**Scope of this check:** the live scan covers the unauthenticated HTML, its referenced chunks and the runtime chunk map. It did not sign in. M3 recorded a signed-in scan at deployment time; the build-level exclusion means signed-in builds contain the same (stub) module.

---

## 4. Human-review checklist (scholarly / editorial)

For a reviewer who will not open the code. Full verbatim text: packet §2–§3. Claim ledger: packet §4. Open questions Q1–Q14: packet §5.

**Reviewer qualification required:** demonstrated expertise in Sanskrit śāstra literature (ideally *lakṣaṇa* / Sāmudrika or omen texts), Indian intellectual history, or the textual history of Indian palmistry. A second editorial / cultural reviewer is recommended.

### 4.1 Per-item decision table

| # | Item | Decision (Approve / Approve with corrections / Reject) | Corrections required | Open questions answered | Reviewer initials |
|---|---|---|---|---|---|
| 1 | Guide intro and tradition framing (incl. dating, "Rekhāśāstra") |  |  | Q12, Q13 |  |
| 2 | General disclosure |  |  | — |  |
| 3 | Longevity disclosure |  |  | — |  |
| 4 | Hand-convention note (gendered) |  |  | — |  |
| 5 | Diagram note and line positions |  |  | Q7 |  |
| 6 | *āyurlekhā* |  |  | Q1 |  |
| 7 | *dhanamātṛlekhā* |  |  | Q2 |  |
| 8 | *pitṛlekhā* |  |  | Q3, Q4 |  |
| 9 | *ūrdhvarekhā* (incl. varṇa reference) |  |  | Q5, Q6, Q14 |  |
| 10 | *yava* (incl. "sons" clause) |  |  | — |  |
| 11 | *matsya* |  |  | — |  |
| 12 | *śaṅkha* |  |  | — |  |
| 13 | *chatra* |  |  | Q9 |  |
| 14 | *vedī* |  |  | — |  |
| 15 | Western comparison notes (all 4 lines) |  |  | Q10 |  |
| 16 | Bṛhatsaṃhitā locator numbering |  |  | Q8 |  |
| 17 | Lotus mark (excluded): add or keep out |  |  | Q11 |  |
| 18 | Proposed wording changes W1–W4 (§5.3 below) |  |  | — |  |

### 4.2 Overall checklist

- [ ] Every IAST term is correctly spelled and applied
- [ ] Every claim is supported by its locator; none overstates its source
- [ ] Traditional belief is never presented as established fact
- [ ] No deterministic health, lifespan, relationship, progeny or financial prediction
- [ ] Status- and caste-linked readings (*ūrdhvarekhā*, royal marks) are presented responsibly
- [ ] Gendered content (hand convention, *yava* "sons") is presented responsibly
- [ ] No culturally inappropriate or misleading wording
- [ ] Q1–Q14 answered, or explicitly accepted as open with the current wording
- [ ] Schematic line positions are defensible as "approximate"

### 4.3 Sign-off (blank: to be completed only by the actual reviewers)

| Role | Name | Qualification | Date | Decision | Notes |
|---|---|---|---|---|---|
| Primary scholarly reviewer |  |  |  |  |  |
| Editorial / cultural reviewer |  |  |  |  |  |

---

## 5. Licensing clearance checklist

| # | Question | Current position (recorded, not cleared) | Decision | Reviewer / date |
|---|---|---|---|---|
| L1 | Is Aura's paraphrase of the *meaning* of Zysk's verse translations "Adapted Material" under CC BY-SA 4.0 (triggering ShareAlike), or a use of unprotectable facts and ideas? | Paraphrase only; no verses, sentences or figures reproduced | ☐ Facts/ideas ☐ Adapted Material ☐ Other |  |
| L2 | If ShareAlike applies, what licence must Aura's Palmistry text carry, and is that acceptable to the business? | Not assessed | |  |
| L3 | Does the in-app attribution satisfy BY (title, author, journal, DOI, link, "© Kenneth G. Zysk, CC BY-SA 4.0", licence link, "Aura's text paraphrases this work")? | Implemented; jsdom test F5 confirms it renders | ☐ Accept ☐ Changes |  |
| L4 | Is the "indicate changes" requirement met by the paraphrase notice? | Unassessed | |  |
| L5 | Is Iyer's 1884 Bṛhatsaṃhitā translation public domain in the target markets? | Expected PD; wisdomlib hosting terms not relied on | ☐ Confirmed |  |
| L6 | Are the SVG hand diagram and 5 mark glyphs original and non-derivative of Zysk figs. 1–5? | Stated original | ☐ Accept |  |
| L7 | Do the Sanskrit/IAST terms and locators raise any rights issue? | Treated as facts | ☐ Accept |  |
| L8 | Any trademark/cultural-property concern with the "Palmistry" card or emoji icons? | None identified | ☐ Accept |  |

**Status: no licensing clearance has been given.** Licensing reviewer sign-off: Name ____ · Role ____ · Date ____ · Decision ____

### 5.3 Proposed wording corrections (proposals only; not applied)

| ID | Entry | Current | Proposed | Why |
|---|---|---|---|---|
| W1 | `yava` | "The Bṛhatsaṃhitā also links a barleycorn at the thumb's root with sons." | "The Bṛhatsaṃhitā also links a barleycorn at the thumb's root with having sons, reflecting the concerns of texts of that period." | Progeny/gender reading with no context; other sensitive readings carry context |
| W2 | `dhanamatrlekha` | "Historically \"wealth\" meant fortune in general, not a forecast of anyone's finances." | "Here \"wealth\" is a traditional category, not a forecast of anyone's finances." | The historical claim is unsourced; the safeguard is kept |
| W3 | `urdhvarekha` | "…the Sāmudrikatilaka (1.154) even varies them by social class." | "…the Sāmudrikatilaka (1.154) also varies them by social class (varṇa)." | "even" is editorial; the reviewer should decide whether to name varṇa (Q6) |
| W4 | General disclosure | (current text) | Optionally add: "Please don't use it for decisions about health, money or relationships." | Makes the no-prediction stance actionable; the ticket names these domains |

All four need reviewer acceptance. Any accepted change then needs reviewer re-confirmation of the final text.

---

## 6. Findings (P0–P3)

**P0: none.** No unapproved content is publicly reachable, and nothing influences Panchangam/Muhurtham ranking.

**P1: publication blockers (expected state, not defects)**

| ID | Finding | Evidence | Needed |
|---|---|---|---|
| G1-P1-01 | No qualified human scholarly sign-off | Packet §8 sign-off table blank; `approvedBy: null` | Recruit reviewer; complete §4 |
| G1-P1-02 | No licensing clearance (CC BY-SA ShareAlike question open) | `sources.ts` licensing field; P5 §5 | Legal/licensing decision §5 |

**P2: governance and traceability**

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| G1-P2-01 | ~~Placement differs from ticket: no "Traditional Wisdom" layer~~ **CLOSED 2026-11-11** | `ExploreView.tsx:102–113`; D1 §A.3 | Resolved by product decision PALM-01-G1-PD1 (§1A): keep the D1 placement. No code change. |
| G1-P2-02 | MVP scope decisions ("2.1–2.7") and the M2 Integration milestone have no written record | Cited in `content.ts`; nothing in repo, local docs or PR #338 | Record the product decisions and M2 closure in a decision record |
| G1-P2-03 | PR #338 merged while its description still says "Draft. Do not merge"; 0 GitHub reviews; merged with one red check | `gh pr view 338` | Record the merge authorization (who, when). The red check is unrelated (see P2-04). |
| G1-P2-04 | `main` CI has been red on every run sampled (since at least `8e9802e`) on *Day Constructor acceptance DB tests* | Runs on `8e9802e` → `1741a95` | Not Palmistry-related, but a persistently red `main` weakens merge-gate signal |
| G1-P2-05 | D1, M3 and P5 evidence reports exist only as untracked local files | `git status` | Commit or archive them so milestone evidence is versioned |

**P3: minor**

| ID | Finding | Evidence |
|---|---|---|
| G1-P3-01 | Docker build path runs the exclusion but not the scanner | `deploy/Dockerfile:27` (known, P4 review) |
| G1-P3-02 | Wording proposals W1–W4 | §5.3 |
| G1-P3-03 | Reviewers can only see the live guide via `next dev`. Screenshots are from `aa56547`: none shows the Sources list or licence notice, and **screenshot 06 shows superseded wording** ("general or preceptor"; current text says "general"). Mitigated in the review package by a note that the text tables are authoritative. | Packet §9–§10; `docs/palmistry/screenshots/06-desktop-upward-line.jpg` |
| G1-P3-04 | P5 handoff describes PR #338 as "draft" at head `0c8d0d6`; PR body says 13 open questions, packet has 14 | `AURA_PALM_01_P5_REVIEW_HANDOFF.md:4`; PR body |
| G1-P3-05 | Research gaps: Zysk 2016 not consulted, Bṛhatsaṃhitā Sanskrit unchecked, 3 of 6 sources read only through Zysk | `sources.ts` verification fields |
| G1-P3-06 | Shared `SegmentedControl` exposes `tablist` without `tabpanel` or arrow keys (pre-existing, cross-screen) | PR #338 review note #11 |

---

## 6A. Human-review package (prepared 2026-11-11)

Prepared after decision PD1, as two untracked files at the repository root:

- `AURA_PALM_01_G1_HUMAN_REVIEW_PACKAGE.md`: a standalone package for the scholarly, editorial/cultural and licensing reviewers. Part A gives context and the PD1 placement decision. Part B reproduces the I1 content packet §0–§7 unchanged; all 49 user-facing content strings were checked word for word against `content.ts` at `1741a95`. Part C holds wording proposals W1–W4, a 19-row decision table and checklists. Part D is the licensing checklist L1–L8. Part E is the blank sign-off.
- `AURA_PALM_01_G1_REVIEW_PACKAGE_screenshots/`: the six review screenshots, exported unchanged from `origin/main:docs/palmistry/screenshots/`.

No reviewer has been contacted, and nothing has been approved.

## 7. Recommendation

### **GO to the human-review stage. HOLD on publication.**

**Why GO for review:** the content is complete, source-attributed and qualified; the review packet is current (31/31 strings verbatim); safeguards are layered, fail-closed, tested (328 checks passing) and verified live; and nothing touches the timing engines.

**What must happen before publication can be authorized**, in order:

1. ~~Product owner rules on placement (G1-P2-01)~~ Done: PD1, 2026-11-11. Still open: record the MVP decisions and merge authorization (G1-P2-02, -03).
2. A qualified scholarly reviewer (and ideally an editorial/cultural reviewer) completes §4, including Q1–Q14 and W1–W4.
3. A licensing reviewer completes §5 (L1–L8).
4. An engineer applies the accepted corrections in a new PR; the reviewer re-confirms the changed text.
5. Only then: set `review-status.json` to `APPROVED` with the real reviewer and date, and update tests E1–E2, K1, K3 and guard D1, in the same PR.
6. Separate merge and Production authorization, under whatever freeze and branch-protection rules are in force at that time.

**Not done here (by design):** no code, content or status changes; no approvals; no deployment, merge or publication; no Panchangam changes; no photo/AI scope.

---

## Erratum (added during AURA-PALM-01-G3, 2026-11-11)

A G3 evidence search of the owner's original tickets (Claude Code session "Palmistry discovery and feasibility audit", local transcript) corrected three points above. The original text is kept unchanged for traceability.

1. **Milestone labels (§1).** M1 was "Controlled Merge Preflight & Final Technical Verification" (read-only). **M2 was "Controlled Merge & Production Verification"**, not "Integration". It authorized the PR #338 merge and ended "POST-MERGE BLOCKED" because the automatic Production deployment failed. M3 resolved that. Neither M1 nor M2 has a report file.
2. **G1-P2-02.** The MVP decisions **were** written down: I1 ticket §2, "Product Decisions" 2.1–2.7 (2026-11-10T05:57Z). They are not recorded in the repository. The finding stays open as a repository-traceability gap.
3. **G1-P2-03.** The merge **was** explicitly authorized by the M2 ticket (2026-11-10T10:47Z, "normal GitHub merge"), before the merge at 11:00:15Z. The authorization is not recorded on GitHub. The finding stays open as a traceability gap.

Evidence, reconciliation proposals and closure criteria: `AURA_PALM_01_G3_DISTRIBUTION/GOVERNANCE_FINDINGS_TRACKER.md`. No finding has been closed.
