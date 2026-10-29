# AURA-PALM-01-G3-L2B: Evidence Matrix (CC Review Gate)

**Date:** 2026-11-11 · **Mode:** read-only audit; documentation only. Missing information is marked **`AWAITING_USER_INPUT`**. Nothing is inferred to fill a gap.
**Baseline:** PDF v1.1 SHA-256 `d5fb7a1e30c6ad52c1ac7ab9ce06a49d822ee105872099ff74497f48c1719a88` (verified). Content `origin/main` @ `1741a95`.

> Applying CC BY-SA 4.0 does **not** establish Aura's ownership of the text, and does **not** clear third-party rights. Those are separate questions (§4, §6).

## 1. Evidence register

| ID | Evidence | Location | Verified |
|---|---|---|---|
| E-01 | Palmistry content source (entries, intro, disclosures) | `origin/main:packages/palmistry/src/content.ts` | Yes (`1741a95`) |
| E-02 | Source register (bibliographic entries, licence field) | `origin/main:packages/palmistry/src/sources.ts` | Yes |
| E-03 | View prose, attribution rendering, UI labels | `origin/main:apps/web/components/PalmistryView.tsx` (e.g. lines 412–413 "Shown as line N…", the licence notice block) | Yes |
| E-04 | Illustrations (SVG) | `origin/main:apps/web/components/PalmHandDiagram.tsx` | Yes |
| E-05 | Content commits: `d719126`, `aa56547`, `27afaea`, `4b0959b`, `2e55a86` (2026-11-10, 06:27Z–07:52Z UTC). Author "Stephen Francis"; trailer "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" | git history | Yes |
| E-06 | Generation record: Claude Code session transcript `b1121d49-418e-41ef-a69a-ffd7ecb8d667.jsonl` (32 MB; span 2026-11-10T05:42Z to 2026-11-11T13:14Z) + sub-agent files (corrected 2026-11-11: 44 sub-agent transcripts + 88 metadata files at snapshot; see AI evidence manifest) | `~/.claude/projects/-Users-stephen-Desktop-Claude-auraschedule-math-core/` (local only) | Yes (exists; covers all E-05 commits) |
| E-07 | Owner-authored strings (verbatim in the owner's I1 ticket, 2026-11-10T05:57:37Z) | E-06 | Yes (independently re-verified in G3-C review) |
| E-08 | Zysk 2025 licence: CC BY-SA 4.0; "Copyright (c) 2025 Kenneth Zysk"; journal acknowledgement request | Journal page + PDF front matter (fetched 2026-11-11; PDF SHA-256 `bc1490f6…0cf9`) | Yes |
| E-09 | CC BY-SA 4.0 legal code | creativecommons.org (fetched 2026-11-11) | Yes |
| E-10 | Overlap analysis (max 11-word conventional phrase; at most 3 words with Wikipedia) | G3-L1 audit §8.2 (AI-prepared, AI-checked) | Yes (AI evidence only) |
| E-11 | Iyer 1884 translation (Iyer 68.42/44/45/48/50; 70.10/12/13 checked) | wisdomlib transcription of a modern reprint; original at Wellcome (not checked) | Partly (the 1884 original is not yet checked) |
| E-12 | Iyer's death, January 1892 | Bookseller listing quoting the brother's preface | Secondary only |
| E-13 | Zysk figure sources: fig. 1 exhibition catalogue (1998); fig. 2 Pratāpa Muni 1929; figs. 3–4 MSS (1732–48); fig. 5 S. Miśra 2002 | Zysk 2025 PDF, figure captions and bibliography | Yes |
| E-14 | Native shells in remote-URL mode; no Palmistry text in `cap-shell/index.html`, `ios/` or `android/` | `origin/main:apps/web/capacitor.config.ts`; tree grep | Yes |
| E-15 | Apple standard Licensed Application EULA (public); CC BY-SA vs iOS debate (forums only) | apple.com/legal; developer forums | Public text found; **no authoritative interpretation** |
| E-16 | Kern 1865 BS Sanskrit edition | archive.org scan / catalogue records | Yes (existence) |

## 2. Condition traceability (C1–C8)

| Condition | Evidence | Gap |
|---|---|---|
| C1: human CC review of approach and source-use permissions | Reviewer package; E-08, E-09, E-10 | **Reviewer not designated** (`AWAITING_USER_INPUT`) |
| C2: exact scope | Plan §1; E-01–E-03 (§3 below) | Reviewer confirmation |
| C3: attribution and modification notices (L3/L4) | E-03 (existing notice), E-08 (journal request); draft notice in plan §2 | Reviewer confirmation; owner choice on the © line |
| C4: illustration provenance (L6) | E-04, E-06 (authorship), E-13 (figure sources) | **Human visual comparison not done** |
| C5: AI ownership | E-05, E-06, E-07 | **AI provider terms and account type: `AWAITING_USER_INPUT`**; legal questions (Open Questions OQ-L1, OQ-L2) |
| C6: Android/iOS compatibility | E-14, E-15 | **Store status and EULA in use: `AWAITING_USER_INPUT`**; iOS interpretation unresolved |
| C7: residual uncertainty needing counsel | Plan §7 (U-1 to U-5); Open Questions | Owner decision on counsel after the review |
| C8: proposed G3-C/G3-L1 record updates | `AURA_PALM_01_G3_DISTRIBUTION/proposed_governance/PROPOSED_L2D_RECORD_AMENDMENTS.md` (A1–A4, append-only) | Not applied. Requires the C1 findings + gate G3-L2B-G. **Not a reviewer question** (owner/governance item) |

## 3. Source-to-scope matrix

| Category | Material | File / constant | Proposed status | Ownership / rights status | Obligations |
|---|---|---|---|---|---|
| **Licensed Palmistry prose (proposed)** | Entry titles + description/interpretation/contextNote/westernComparison/tradition | E-01 `PALMISTRY_ENTRIES` | IN | Owner-authored: "Upward line" only. Rest AI-generated (E-05/E-06). **Ownership uncertain (N3)** | CC BY-SA 4.0 notice + link; no added restrictions |
| | Guide introduction (title, lead, tradition, linesAndMarks, westernDifference, limits) | E-01 `PALMISTRY_INTRO` | IN | Title and lead: owner-authored (E-07). Rest AI-generated | Same |
| | Disclosures/notes (general, longevity, diagram, hand convention) | E-01 constants | IN | General disclosure and first longevity sentence: owner. Rest AI | Same |
| | Palmistry-specific view prose: card description/action/footer; marks note; "Shown as line N … (approximate)" / "Shown as a symbol only…" | E-03 | IN | Card description: owner. Rest AI | Same |
| **Excluded: code and generic UI** | All TS/TSX/JS, tests, build scripts; generic labels ("Back to Explore", "Selected", "Where", "In this tradition", "Sources", badges, error/fallback text) | Repository | OUT | Aura's | None from CC. Reviewer to confirm no Zysk-dependent text is excluded (none identified) |
| **Excluded: drawings** | Hand diagram, 5 mark glyphs | E-04 | OUT | AI-generated SVG (E-06); ownership uncertain (N3); L6 pending | None, if L6 finds no derivation |
| **Excluded: terms and bibliography** | `traditionalName` IAST terms; source list entries | E-01, E-02 | OUT | Facts / third-party titles | Zysk attribution stays (the source-list licence notice) |
| **Third-party material** | Zysk 2025 (CC BY-SA 4.0) | E-08 | Source of meaning for 16 strings + 2 glossed titles | Rights holder: K. G. Zysk | §3(a)(1) attribution (present: creator, ©, licence link, source link, change note); journal acknowledgement (journal named) |
| | Bṛhatsaṃhitā (Kern 1865 Skt; Iyer 1884 tr.) | E-11, E-12, E-16 | Supports 6 strings + clauses | PD (Kern verified; Iyer very likely, date secondary) | None if PD; cite the 1884 original |
| | Wikipedia (facts only), wisdomlib pages, practitioner essay | G3-L1 S-09 to S-11 | Background research | CC BY-SA (Wikipedia) / unknown | None for facts; record provenance |
| | Zysk figures and their underlying sources (incl. Miśra 2002) | E-13 | **Not used** | Various; Miśra 2002 protected | None unless used (never without clearance) |
| **Uncertain** | Ownership of AI-generated text and drawings | E-05/E-06 | — | **UNRESOLVED (N3)** | Legal advice (OQ-L2) |
| | Meghavijaya catalogue remark inside a `sources.ts` author string | E-02 | Undecided (reviewer Q4) | AI-written remark based on a wisdomlib fact | Reviewer decision |

## 4. Human-authored vs AI-generated text

| Origin | Items | Evidence |
|---|---|---|
| Owner (human), verbatim from ticket | intro.title; intro.lead; general disclosure; Explore card description; longevity disclosure sentence 1; "Upward line" title | E-07 |
| AI-generated (Claude Opus 5.5, via Claude Code), from owner product decisions; revised after AI reviews | All other licensed prose; both illustrations | E-05, E-06 |
| Human line-editing of AI output | **None recorded** | E-06 |
| Owner authorship of ticket text | Assumed; **not independently established** | — |

## 5. AI provider evidence

| Item | Status |
|---|---|
| Provider / model | Anthropic, Claude Opus 5.5, used through Claude Code (E-05 trailer; E-06) |
| Account type / plan (consumer vs commercial terms) | **`AWAITING_USER_INPUT`** |
| Applicable terms (document, version, date in force on 2026-11-10) | **`AWAITING_USER_INPUT`** |
| Generation records | Session transcript + sub-agent transcripts (E-06), **local only** |
| Missing records | Separate prompt/output logs for each string (the transcript is the only record); **a retention plan for E-06** (local files may be cleaned up): `AWAITING_USER_INPUT` (owner decision to preserve a copy) |

## 6. Distribution status

| Item | Status |
|---|---|
| Web | Primary delivery (content excluded from all public builds until approval) |
| iOS app | Shell exists (`apps/web/ios`). **Store status: `AWAITING_USER_INPUT`** |
| Android app | Shell exists (`apps/web/android`, appId `com.greenarrow.auraschedule`). **Store status: `AWAITING_USER_INPUT`** |
| Apple licence agreement in use (standard EULA vs custom) | **`AWAITING_USER_INPUT`** |
| Google Play terms / any custom EULA | **`AWAITING_USER_INPUT`** |
| Licensed text inside the native binaries | **No** (E-14) |
