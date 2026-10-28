# AURA DB0 — Gochar Rule Provenance & Naming Resolution

**Status:** Documentation and architecture-decision task only. No implementation code was written, no production files were modified, no dependencies or migrations were added.
**Scope:** Resolves the two outstanding conditions from `AURA_DAILY_BRIEFING_V1_FEASIBILITY_AUDIT.md` §G.

---

## 1. Existing-versus-proposed rule comparison

**Source inspected:** `packages/vedic/src/transits.ts`, function `checkTransitFavorability()` (private, not exported), lines 41-54. Read fresh, in full, for this task.

**Tests found:** none. A repo-wide search for `checkTransitFavorability`, `calculateDailyTransits`, and `TransitInsight` outside `packages/vedic/src/transits.ts` and its one consumer (`apps/web/app/api/panchang/transits/route.ts`) returns zero test files. `test/transitActivationEngine.test.ts` exists but tests the unrelated `packages/transit-activation` geometry engine, not this file. **This table has shipped to production with no automated test coverage of any kind.**

| Planet | Existing code (`transits.ts:42-53`) | Proposed table | Match? |
|---|---|---|---|
| Sun | 3, 6, 10, 11 | 3, 6, 10, 11 | ✅ Identical |
| Moon | 1, 3, 6, 7, 10, 11 | 1, 3, 6, 7, 10, 11 | ✅ Identical |
| Mars | 3, 6, 11 | 3, 6, 11 | ✅ Identical |
| **Mercury** | **2, 3, 4, 6, 8, 10, 11** | **2, 4, 6, 8, 10, 11** | ❌ **Differ — existing code includes house 3; proposed does not** |
| Jupiter | 2, 5, 7, 9, 11 | 2, 5, 7, 9, 11 | ✅ Identical |
| Venus | 1, 2, 3, 4, 5, 8, 9, 11, 12 | 1, 2, 3, 4, 5, 8, 9, 11, 12 | ✅ Identical |
| Saturn | 3, 6, 11 | 3, 6, 11 | ✅ Identical |
| Rahu | 3, 6, 11 | 3, 6, 11 | ✅ Identical |
| Ketu | 3, 6, 11 | 3, 6, 11 | ✅ Identical |

**Exactly one difference across all 9 grahas: Mercury's house 3.** No rules were modified as part of this task; the existing code in `transits.ts` is untouched.

The existing `getTransitSummary()` prose generator (lines 56-83) is keyed purely by `(graha, house, isBenefic)` and carries no citation of its own — same provenance gap as the house table itself; addressed below.

---

## 2. Rule provenance

### Research method

Web research was performed (3 targeted searches) rather than relying on unverified prior knowledge, per the ticket's explicit instruction not to invent or attribute citations without support. Full source list at the bottom of this section.

### What was found

**The "count houses from the natal Moon, not the Ascendant" method itself** is the standard, broadly-attested Parashari Gochar convention — every source consulted, both secondary websites and discussion of primary texts (Brihat Parashara Hora Shastra, which has a dedicated transit/Gochara treatment per [enjoylearningsanskrit.com's chapter index](https://enjoylearningsanskrit.com/scriptures/parashara/chapter-62/verse-19)), agrees transits are conventionally read from Chandra Lagna (the Moon sign) first. **This part of the existing implementation's design (`houseFromMoon` as the organizing principle) is not in question.**

**The specific per-planet favorable-house numbers** are what has provenance uncertainty. Aggregating results across multiple independent secondary sources ([dekhopanchang.com](https://dekhopanchang.com/en/learn/gochar), [jyothishai.com](https://jyothishai.com/learn/transits), [kundlidikhao.com](https://www.kundlidikhao.com/post/planetary-transit-in-vedic-astrology), [mahadasha.com](https://mahadasha.com/planetary-transits-in-vedic-astrology)):

- Sun (3,6,10,11), Mars (3,6,11), Jupiter (2,5,7,9,11), Venus (1,2,3,4,5,8,9,11,12), Saturn/Rahu/Ketu (3,6,11): **consistent across every source checked** — both the existing code and the proposed table agree with this cross-source consensus.
- **Mercury: the cross-source consensus is 2, 4, 6, 8, 10, 11 — matching the proposed table, not the existing code's extra house 3.** No source checked includes house 3 for Mercury.
- **Moon's own favorable houses showed genuine disagreement between sources**: most give 1,3,6,7,10,11 (matching both the existing code and the proposed table), but at least one gives 1,4,5,9,10,11 instead. Both the existing implementation and the proposed table already agree on the majority convention here, so this doesn't change the recommendation, but it is a documented point of real disagreement in the tradition worth a one-line code comment.
- One secondary source attributes these lists to "Phaladeepika and Brihat Samhita" without a verse citation — **this could not be independently verified** against the primary text in this research pass (see below), so it is reported here as an unverified claim, not a confirmed citation.
- A related, more granular refinement exists in the tradition — **Vedha** (an obstructing planet in a second house can cancel an otherwise-favorable transit) — which neither the existing code nor the proposed table implement. This is a legitimate scope boundary for V1, not a correctness defect in either table; flagged for a future version.

### Primary-text verification attempt

`Phaladeepika` (Mantreswara, Sanskrit, ~13th–16th century CE depending on source) was confirmed to be a real, identifiable text with a dedicated "Transit of Planets" chapter — **Chapter 26** in the V. Subrahmanya Sastri 1950 English translation, per the [vedamsbooks.com](https://vedamsbooks.com/books/phaladeepika) and a [Scribd-hosted outline](https://www.scribd.com/doc/31645824/PHALADEEPIKA) of the same edition's table of contents. However, **this audit could not retrieve or read that chapter's actual verse content** through the searches performed — the exact house numbers it specifies were not independently confirmed. `Brihat Parashara Hora Shastra` (R. Santhanam English translation) was also confirmed to exist and to be findable in full (archive.org PDF), with Gochara-adjacent verses locatable (e.g. [chapter 62, verse 19](https://enjoylearningsanskrit.com/scriptures/parashara/chapter-62/verse-19), on the Moon's subtle transit near the Sun) — but a complete house-by-house table was likewise not retrieved in this pass.

**Honest conclusion**: this audit can confirm the *method* (Moon-relative house counting) is textually grounded and can name two credible, real, identifiable classical texts as the likely ultimate source of the house conventions — but cannot certify the exact verse-level numbers against either primary text without someone reading the actual translated chapters directly (Phaladeepika Ch. 26, or BPHS's transit chapter). **Treat the house tables — both the existing code's and the proposed table's — as resting on modern secondary consensus, not a verified primary citation, until that follow-up read happens.**

### Recommendation for Aura V1

1. **Adopt the proposed table's Mercury list (2, 4, 6, 8, 10, 11)**, since it matches the convergent secondary-source consensus and the existing code's extra "3" appears to be an isolated outlier not corroborated by any source checked.
2. **Keep every other planet's existing values** — they already match both the proposed table and cross-source consensus.
3. **Document the convention explicitly in code** as "Parashari Gochar, Moon-relative, secondary-source consensus (Phaladeepika-attributed, unverified against primary Sanskrit text)" — honest about the provenance tier, not overclaiming textual authority the research couldn't confirm.
4. **Do not implement Vedha** in V1 (matches the feasibility audit's "smallest defensible rule set" instruction) — note it as a named, deliberately-deferred refinement, not an oversight.
5. **Do not silently "correct" `transits.ts`'s existing Mercury entry** — see §4 below; the existing file should not change in DB1 at all.

**Sources** (all consulted above): [Gochar — dekhopanchang.com](https://dekhopanchang.com/en/learn/gochar) · [Planetary Transits (Gochar) — jyothishai.com](https://jyothishai.com/learn/transits) · [Planetary Transit — kundlidikhao.com](https://www.kundlidikhao.com/post/planetary-transit-in-vedic-astrology) · [Planetary Transits in Vedic Astrology — mahadasha.com](https://mahadasha.com/planetary-transits-in-vedic-astrology) · [Phaladeepika — Wikipedia](https://en.wikipedia.org/wiki/Phaladeepika) · [Phaladeepika (Sanskrit text and translation) — wisdomlib.org](https://www.wisdomlib.org/hinduism/book/phaladeepika-by-mantreswara-text-and-translation/d/doc1621576.html) · [Phaladeepika — vedamsbooks.com](https://vedamsbooks.com/books/phaladeepika) · [PHALADEEPIKA outline — scribd.com](https://www.scribd.com/doc/31645824/PHALADEEPIKA) · [BPHS Ch.62 v.19 — enjoylearningsanskrit.com](https://enjoylearningsanskrit.com/scriptures/parashara/chapter-62/verse-19) · [BPHS R. Santhanam translation (PDF) — archive.org](https://archive.org/download/BPHSEnglish/BPHS%20-%201%20RSanthanam.pdf)

---

## 3. Naming resolution

### Confirmed existing occupied identifiers (from the prior audit, reverified)

| Identifier | Occupied by | Evidence |
|---|---|---|
| `DailyBriefing` (type) | Solar-window/muhurta "right now" state, unrelated to astrology | `packages/recommendation/src/dailyAssistant.ts:31` (`export interface DailyBriefing`), `:144` (`buildDailyBriefing`); consumed at `apps/web/app/page.tsx:16,148,413` and `apps/web/components/HomeDashboard.tsx:8,84` |
| "Daily Guidance" | Behavioral/activity-family recommendation system (the "Good Right Now" suggestions), unrelated to astrology | Package `packages/daily-guidance`; `apps/web/lib/dailyGuidanceTypes.ts`, `dailyGuidanceOrchestrator.ts`, `dailyGuidanceCandidates.ts`; also referenced from `bestForYouViewModel.ts`, `homeTimelineComposer.ts`, `forwardPlannerOrchestrator.ts`, `askAuraOrchestrator.ts`, and route `apps/web/app/api/daily-assistant/guidance/route.ts` — a pervasive, core concept across multiple files, not an isolated name |

Both confirmed real and both confirmed unrelated to the astrological briefing feature — reusing either name would create genuine ambiguity (two different `DailyBriefing` types, or "Daily Guidance" meaning either behavioral suggestions or astrology depending on file).

### Verification of the proposed replacement names

A repo-wide search (`apps/web`, `packages`, `test`) found **zero existing occurrences** of any of the following:

| Proposed identifier | Collision check | Result |
|---|---|---|
| Feature name "Personalized Daily Briefing" | grep for exact phrase | No collision |
| Type `AstroDailyBriefing` | grep for exact identifier | No collision |
| Module `dailyAstroBriefing.ts` | filename search | No collision |
| Route `/api/daily-briefing/today` | directory search under `apps/web/app/api` | No collision |

### Final naming decision

**Adopted as proposed, unchanged:**
- Feature: **Personalized Daily Briefing**
- Type: `AstroDailyBriefing`
- Composition module: `dailyAstroBriefing.ts`
- API route: `/api/daily-briefing/today`

No further naming changes are needed; the preferred names in the DB0 ticket are confirmed clear.

---

## 4. Preserving existing architecture

### Reuse confirmed, function-by-function

| Needed capability | Existing function | Confirmed reusable as-is? |
|---|---|---|
| Transit geometry + current (uncited) interpretation | `calculateDailyTransits(birthDate, birthLat, birthLng, currentDate, currentLat, currentLng): TransitInsight[]` — `packages/vedic/src/transits.ts:12` | Yes — call unchanged |
| Natal Moon sign + nakshatra | `buildNatalContext(birthMomentUTC): NatalContext` — `packages/vedic/src/natalChart.ts:136` | Yes — call unchanged |
| Today's personal lunar strength | `getTaraBala(natalNakshatraIndex, today): TaraBala` — `packages/vedic/src/natalChart.ts:165` | Yes — call unchanged |
| "Does this user have a usable birth profile" gate | `buildPersonalMuhurtaContextForUser(user): PersonalMuhurtaContext | undefined` — `apps/web/lib/natalContext.ts:41` | Yes — call unchanged |

**None of these four functions need to be modified, forked, or wrapped with new parameters.** DB1 is purely an additive consumer.

### The one real tension, and how to resolve it

`checkTransitFavorability()` and `getTransitSummary()` (the interpretation layer) are **private, unexported functions inside `transits.ts`**, called internally by `calculateDailyTransits()`. `calculateDailyTransits()`'s returned `TransitInsight.isBenefic`/`.insight` fields are therefore permanently tied to the *existing* (uncited, Mercury-house-3-including) table — there is no parameter to swap in a corrected table without editing `transits.ts` itself.

The ticket requires **both** "reuse `calculateDailyTransits()`" **and** "avoid changing existing production transit behaviour" **and** a corrected Mercury table for the new feature. These three requirements are only simultaneously satisfiable by **not editing `transits.ts` at all**, and instead:

1. **DB1 calls `calculateDailyTransits()` exactly as it is today** — this is the literal reuse the ticket asks for, and it costs nothing (it already computes the natal chart, the transit chart, and `houseFromMoon` per planet correctly).
2. **DB1 discards only the two interpretation fields** (`isBenefic`, `insight`) from each `TransitInsight` and **recomputes them locally**, in the new `dailyAstroBriefing.ts` module, using a new, versioned, cited rule table (the corrected table from §2) and DB1's own prose. The raw geometric fields (`graha`, `natalRashi`, `transitRashi`, `houseFromMoon`) are used as-is, unmodified, straight from `calculateDailyTransits()`.
3. This means **zero duplication of any astronomy or geometry** (the expensive, error-prone part — `getNatalChart()`'s ephemeris calls, the `houseFromMoon` arithmetic) — only the small, cheap, already-necessarily-separate *interpretation* table is maintained in two places short-term: `transits.ts`'s existing one (still serving `BirthChartSection.tsx` unchanged) and DB1's new, corrected, cited one (serving the briefing).
4. `BirthChartSection.tsx` and `/api/panchang/transits` are **not touched** — zero risk to existing production behavior, satisfying that requirement exactly.

### Versioning the interpretation rules

Follow the provenance-constant pattern **already established in this codebase** by `packages/transit-activation/src/provenance.ts` (e.g. `TRANSIT_ACTIVATION_RULE_VERSION = '1.0.0'`), rather than inventing a new convention:

```ts
// dailyAstroBriefing.ts (new, DB1)
export const GOCHAR_RULE_VERSION = 'GOCHAR_MOON_RELATIVE_PARASHARI_V1';
// Sources: cross-referenced secondary-source consensus (see
// AURA_DB0_GOCHAR_RULE_PROVENANCE.md §2); attributed to Phaladeepika-style
// Gochara convention, NOT independently verified against the primary
// Sanskrit text. Differs from transits.ts's own (unversioned, uncited)
// table in exactly one place: Mercury excludes house 3 here.
const GOCHAR_FAVORABLE_HOUSES: Record<GrahaName, number[]> = { /* corrected table */ };
```

Every evidence ref the briefing attaches to an interpretive claim should carry `GOCHAR_RULE_VERSION`, mirroring `transit-activation`'s `TransitActivationEvidenceRef` pattern — this gives the "traceability from explanation to calculation" the original feasibility audit's §5 asked for, and lets a future rule correction be shipped as a version bump without silently changing historical briefings' meaning.

A **future, optional cleanup** (explicitly NOT part of DB1, since it would touch `transits.ts` and risk the "avoid changing existing production behaviour" requirement): once the briefing's corrected table has been live and stable, consider refactoring `transits.ts` to accept a pluggable rule table so `BirthChartSection.tsx` and the briefing converge on one shared, versioned table instead of two. Not recommended now — would add scope and risk to DB1 for no V1 user-facing benefit.

---

## 5. Minimal DB1 architecture (updated from the feasibility audit)

```
calculateDailyTransits(...)        buildNatalContext(...)         getTaraBala(...)
  [UNCHANGED, transits.ts]           [UNCHANGED, natalChart.ts]      [UNCHANGED, natalChart.ts]
        │                                    │                             │
        │ (keep: graha, houseFromMoon,       │                             │
        │  natalRashi, transitRashi)         │                             │
        │ (discard: isBenefic, insight)      │                             │
        ▼                                    ▼                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  dailyAstroBriefing.ts  (NEW, DB1)                                           │
│  - GOCHAR_RULE_VERSION + GOCHAR_FAVORABLE_HOUSES (corrected: Mercury         │
│    excludes house 3; every other planet identical to transits.ts's own)     │
│  - re-derives isBenefic/prose per planet from houseFromMoon using the       │
│    versioned table above, independent of transits.ts's own interpretation   │
│  - composes AstroDailyBriefing { theme, career, finance, focus, mindful,     │
│    evidence[] } using the existing PersonalTheme taxonomy                    │
│    (packages/personal-intelligence/src/themes.ts: FOCUS/CAREER/FINANCE       │
│    already first-class)                                                      │
└──────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
GET /api/daily-briefing/today  (NEW route, same auth/404 pattern as
                                 /api/panchang/transits)
```

---

## 6. Recommendation

### GO

Both outstanding conditions from the feasibility audit are now resolved to the point implementation can begin:

- **Rule provenance**: exactly one numeric difference found (Mercury house 3), cross-source research supports adopting the proposed table's value, and a defensible (if honestly-caveated) provenance statement is documented in §2.
- **Naming**: both collisions confirmed and explained; both proposed replacement names confirmed collision-free; adopted as-is.
- **Architecture**: a concrete, low-risk integration path confirmed — `calculateDailyTransits()`, `buildNatalContext()`, `getTaraBala()`, and `buildPersonalMuhurtaContextForUser()` are all reused unmodified; `transits.ts` is never edited; the interpretation-layer duplication this requires is small, deliberate, and versioned, not an open-ended fork.

**Residual, non-blocking follow-up**: the verse-level primary-text citation (Phaladeepika Ch. 26 / BPHS transit chapter) remains unverified beyond confirming the texts and chapters exist. This does not block DB1 — the rule table itself is already well-supported by convergent secondary sources and the honest provenance label in §2/§4 — but it's worth a follow-up task if the product wants to cite a specific verse number in user-facing copy rather than the general "Parashari Gochar convention" framing recommended here.

**STOP AFTER AUDIT, per ticket instruction. No DB1 code was implemented, and `transits.ts` was not modified. Awaiting approval.**
