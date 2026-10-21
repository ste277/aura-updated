# AURA Daily Briefing V1 — Feasibility & Architecture Audit

**Status:** Read-only audit. No implementation code was written. No dependencies or migrations were added.
**Repository baseline:** `origin/main` @ `02a85e934953e48a20f8c8024f9c742e302977de` ("Daily Rhythm DR4-F2B: Choose My Own Time During Rescheduling (#258)"), confirmed to include merged PR #258.
**Migration count:** 50 (confirmed via `apps/web/prisma/migrations`, unchanged — this audit adds none).
**Worktrees/uncommitted changes:** none touched by this audit; the working tree this audit ran in is tree-identical to `origin/main` (no diff).

---

## 0. Executive summary

This codebase already contains almost the entire astronomical and astrological computation layer a V1 Chandra Gochar daily briefing needs, **already shipping in production** behind an authenticated route and a live UI screen (`BirthChartSection.tsx`, reached from the "You" tab). The single biggest finding of this audit:

> `packages/vedic/src/transits.ts`'s `calculateDailyTransits()` **is** a working Chandra Gochar engine — natal Moon sign → transit chart → house-from-natal-Moon per planet → a hardcoded favorable/unfavorable table → human-readable prose per planet — and it is already called today via `GET /api/panchang/transits` and rendered in `BirthChartSection.tsx`.

What's genuinely missing is narrow: a cited (not just hardcoded) favorable-house rule table, a Theme/Career/Finance/Focus/Be-Mindful **composition** layer over the existing per-planet output, a Chandra Bala label (trivial — it's just the existing Moon row, renamed), and the Home/Insights UI surfaces themselves. No new ephemeris, no new timezone handling, no new birth-profile plumbing, and no external API or LLM are needed anywhere in this feature.

**Verdict: CONDITIONAL GO** (see §G) — gated on resolving rule-table provenance and two naming collisions before implementation starts, not on any missing engineering capability.

---

## A. Existing capabilities

| Capability | Existing implementation | Reusable? | Gap |
|---|---|---|---|
| Natal Moon sign | `buildNatalContext()` — [`packages/vedic/src/natalChart.ts:136-146`](packages/vedic/src/natalChart.ts) → `janmaRashi` | **Yes, as-is** | None |
| Natal nakshatra | Same function → `janmaNakshatra`, `natalNakshatraIndex` | **Yes, as-is** | None |
| Daily transits (all 9 grahas, sidereal) | `getNatalChart(instantUTC)` — [`natalChart.ts:46-72`](packages/vedic/src/natalChart.ts) (generic over any instant, not just birth) | **Yes, as-is** | None |
| Chandra Gochar (house-from-Moon + favorable/unfavorable + prose) | `calculateDailyTransits()` — [`packages/vedic/src/transits.ts`](packages/vedic/src/transits.ts), live via [`/api/panchang/transits`](apps/web/app/api/panchang/transits/route.ts) | **Yes, as the base** — needs a provenance pass on its rule table, not new astronomy | Favorable-house table (lines 42-54) is hardcoded with **no cited source** |
| Chandra Bala | **Does not exist as a named function.** Confirmed absent repo-wide; `muhurthamFinder.ts:1167` explicitly documents `NOT_IMPLEMENTED: Chandra Bala`. **But** classically it is just "is transiting Moon in a favorable house from natal Moon" — i.e. the `Moon` row of `calculateDailyTransits()`'s own output | **Trivially reusable** — no new calculation, just relabel/surface the existing Moon entry | Naming only |
| Tara Bala | `getTaraBala(natalNakshatraIndex, today)` — [`natalChart.ts:165-186`](packages/vedic/src/natalChart.ts), live via the same `/api/panchang/natal-chart` route, already feeds `PERSONAL_TARA_SUPPORT`/`PERSONAL_TARA_CAUTION` reasons into Timing Search today | **Yes, as-is** | None |
| Interpretation templates | Two separate patterns: (1) raw prose tables in `transits.ts:56-83` (`getTransitSummary`), used today; (2) structured-reason → pure-formatter pattern in [`packages/muhurta/src/muhurtaReasonFormat.ts`](packages/muhurta/src/muhurtaReasonFormat.ts) (≈20 reason codes → single-sentence prose, zero LLM) | **Yes** — pattern (2) is the better template for a traceable briefing generator | Needs a new Theme/Career/Finance/Focus/Be-Mindful **composition** layer over whichever pattern is chosen |
| Home integration | `HomeDashboard.tsx` (1808 lines), card-sectioned (`SectionHeader` + `SurfaceCard`); Daily Reflection card at lines 1372-1420 is a direct expand/collapse precedent | **Yes** — insertion point and pattern both exist | None structural; needs new per-local-date persistence key |
| Insights integration | `InsightsView.tsx`, `overview` sub-tab already has a documented "place new content first, render nothing when absent" precedent (lines 584-598) | **Yes** | InsightsView currently imports no astrology package at all — this would be the first; not a blocker, just a first-of-its-kind wiring |

---

## B. Proposed architecture (minimal data flow)

```
User.birthDate/birthTime/birthTimezone (nullable, Prisma schema.prisma:47-52)
        │  (existing gate, reused verbatim)
        ▼
buildPersonalMuhurtaContextForUser(user)  — apps/web/lib/natalContext.ts:41-44
  → undefined if incomplete (ALREADY the established "does this user have
    a usable birth profile" check, used by timing-search/muhurtham-search/
    Aura Moment reschedule today)
        │
        ▼
buildNatalContext(birthMomentUTC) — packages/vedic/src/natalChart.ts:136
  → { janmaRashi, janmaNakshatra, natalNakshatraIndex, moonElement }
        │
        ├──────────────────────────────┐
        ▼                              ▼
calculateDailyTransits(...)      getTaraBala(natalNakshatraIndex, today)
  packages/vedic/src/transits.ts   packages/vedic/src/natalChart.ts:165
  → TransitInsight[] (9 planets,   → { taraNumber, name, favorable }
    house-from-Moon, favorable
    bool, prose)
        │                              │
        └──────────────┬───────────────┘
                        ▼
        ★ NEW: briefing composition layer ★
        (packages/daily-briefing/ or apps/web/lib/dailyBriefing.ts)
        - groups TransitInsight[] into Theme/Career/Finance/Focus/
          Be-mindful sections using the PersonalTheme taxonomy that
          ALREADY exists (packages/personal-intelligence/src/themes.ts:22:
          FOCUS, CAREER, FINANCE are first-class values)
        - applies rule precedence using the existing non-numeric,
          "count distinct reinforcing facts" philosophy already
          established in packages/life-weather/src/state.ts:26-30
          (explicitly NOT a weighted composite score, by prior design
          decision in this codebase)
        - attaches evidence refs (reason code → source calculation) using
          the same pattern as muhurtaReasonFormat.ts / transit-activation's
          evidence.ts (dedupeEvidenceRefs) for traceability
        - "do not claim guaranteed outcomes" enforced structurally (no
          probability/certainty language in any output string, same
          posture as transits.ts's existing prose)
                        │
                        ▼
              GET /api/daily-briefing/today (new, thin route —
              same shape as /api/panchang/transits + /api/panchang/
              natal-chart, both already authenticated, both already
              404/400 on incomplete birth profile)
                        │
          ┌─────────────┴─────────────┐
          ▼                             ▼
   HomeDashboard.tsx (new card,    InsightsView.tsx (new "Briefing"
   inserted after PageHeader,      sub-tab or top-of-overview section,
   before Right Now — same         same "first in hierarchy, render
   SectionHeader+SurfaceCard        nothing when absent" precedent as
   pattern as Daily Reflection)     PR4's Alignment card, lines 584-598)
          │
          ▼ (optional CTA)
   handleOpenPlan('Focused work')  — apps/web/app/page.tsx:1345-1350,
   ALREADY generic, zero new nav contract needed
```

No new database table is required for the briefing's **content** (it is recomputed on demand, same as `/api/panchang/transits` today — see §F on performance). A client-side-only `localStorage` key (same pattern as `apps/web/lib/windowNotifications.ts:13-26`) is sufficient for "expanded on first visit of the local day, compact after" — see §D.

---

## C. Rule provenance

**Astronomical layer (not in question):** Lahiri ayanamsa (linear approximation, [`packages/vedic/src/panchangElements.ts:50-54`](packages/vedic/src/panchangElements.ts)), `astronomy-engine` npm package (VSOP87-class, deterministic, offline), mean lunar node for Rahu/Ketu (Meeus *Astronomical Algorithms* ch. 47, [`natalChart.ts:74-86`](packages/vedic/src/natalChart.ts)). These are standard, well-cited techniques and are **not** the provenance concern.

**Interpretive layer (the actual concern):** `transits.ts`'s `checkTransitFavorability()` favorable-house table has **no citation** in the source — no reference to Parashara, Phaladeepika, or any named classical text. The numbers are broadly consistent with common Vedic Gochar mnemonics (Saturn/Mars/Rahu/Ketu sharing houses 3-6-11 is a standard convention; Jupiter's 2-5-7-9-11 and Venus's wide favorable set are conventional), but this codebase offers no citation trail today.

The ticket's own brief references "supplied traditional favourable-house tables" that were **not included in the pasted prompt this audit received** — so this audit cannot compare the supplied tables against `transits.ts`'s existing table. **Action before implementation**: whoever has the supplied tables should diff them line-by-line against `transits.ts:42-53`'s existing `rules` object and flag every divergent house number, rather than assuming either source is correct by default.

**Separation of astronomy from interpretation**: the codebase already models this split architecturally in `packages/transit-activation` (geometry-only, explicitly "no interpretation, polarity, or product scoring" per its own doc comment) vs. `packages/vedic/src/transits.ts` (geometry + interpretation combined). The briefing should follow `transit-activation`'s discipline — keep `getNatalChart()`/`calculateDailyTransits()`'s geometry outputs (house-from-Moon, rashi placements) as pure, uncontested facts, and put every interpretive claim (favorable/unfavorable, the prose) behind its own versioned, citable rule table, following the `TRANSIT_ACTIVATION_RULE_VERSION`-style provenance constant pattern already established in [`packages/transit-activation/src/provenance.ts`](packages/transit-activation/src/provenance.ts).

**Conflicting conventions to flag, not silently pick one of:** different classical sources disagree on exact Gochar house tables for several planets (particularly Mars and Saturn, where Ashtottari/Kalachakra-adjacent traditions diverge from the mainstream Parashari 3-6-11 convention used here). V1 should pick ONE named convention, cite it in a comment at the rule-table definition (mirroring `transit-activation`'s pattern), and explicitly not claim universality.

---

## D. UI integration

### Home (`apps/web/components/HomeDashboard.tsx`, 1808 lines)

- **Insertion point**: immediately after `<PageHeader .../>` closes (~line 1075) and before the `/* RIGHT NOW */` block (~line 1077) — "near the top," above the hero card, per the ticket's own requirement.
- **Component pattern to follow**: `<div style={{display:'flex',flexDirection:'column',gap:spacing.lg}}><SectionHeader label="..." /><SurfaceCard>...</SurfaceCard></div>` — used throughout, e.g. Daily Reflection (lines 1373-1376).
- **Expand/collapse precedent**: Daily Reflection already toggles full-form vs. collapsed-summary (`reflectionSaved && !isEditingReflection`, line 1396) — directly adaptable, just keyed off local-date instead of saved-state.
- **State management**: a new `localStorage` key (e.g. `aura_daily_briefing_last_expanded_date`, following the existing `window_notification_prefs` key-constant-plus-typed-load/save pattern in `apps/web/lib/windowNotifications.ts:13-26`) storing the last local date the briefing was shown expanded. On mount, compare against `getDatePartsInTimezone(timezone, new Date()).dateStr` (already used throughout this codebase, e.g. `PlanWithAuraView.tsx`) — if different, show expanded and update the key; if same, show compact.
- **⚠️ Naming collision #1 (must avoid)**: a type literally named `DailyBriefing` already exists — [`packages/recommendation/src/dailyAssistant.ts:31`](packages/recommendation/src/dailyAssistant.ts), consumed at `HomeDashboard.tsx:8,84` and `apps/web/app/page.tsx:16,148,413`. It represents solar-window/muhurta "right now" state (`briefingState`, `peakWindow`), **entirely unrelated** to this feature. The new type must use a different name (e.g. `AstroDailyBriefing` / `DailyGocharBriefing`).
- **⚠️ Naming collision #2 (must avoid)**: `packages/daily-guidance` + `apps/web/lib/dailyGuidanceOrchestrator.ts` already implement a "Daily Guidance" concept for behavioral/activity-family recommendations (the "Good Right Now" suggestions), unrelated to astrology. Avoid "Daily Guidance" as a name for the new feature's internal modules.
- **Architectural caution worth surfacing to the product owner**: `apps/web/lib/dailyStory.ts`'s own header comment (lines 8-15) explicitly states it deliberately does *not* thread Panchang/window-quality into its narrative prose, specifically "to avoid a second 'what does this window mean' narrative competing with the existing Right Now card." The Daily Briefing is precisely that second narrative. This isn't a blocker — the product direction explicitly wants it — but Home's placement/copy should be deliberate about not duplicating Right Now's own "why now" framing.

### Insights (`apps/web/components/InsightsView.tsx`, 1487 lines)

- Four existing sub-tabs: `overview | patterns | trends | streaks` (`SegmentedControl`, lines 577-583).
- Precedent: PR4's Alignment card and PR5's "Aura suggests" are both documented as "placed FIRST in the existing Overview hierarchy... never replacing" prior cards (lines 584-598) — the exact pattern a full Daily Briefing section (today's + optionally yesterday's) should follow, either as the top of `overview` or as a 5th sub-tab.
- This would be the **first** astrology-package import into `InsightsView.tsx` (confirmed via grep — none currently exist). Not a blocker, just worth noting as new surface area.

### Home → Plan ("Find time for focused work")

Already fully supported, zero new contract: `apps/web/app/page.tsx:1345-1350`:
```ts
const handleOpenPlan = useCallback((activity?: string) => {
  const cleanActivity = activity?.trim();
  if (cleanActivity) setPlanPrefill({ activity: cleanActivity, key: Date.now() });
  setActiveTab('plan');
}, []);
```
This feeds `PlanWithAuraView`'s `initialActivity`/`initialActivityKey` props directly (`page.tsx:1616-1618`) — pure in-memory React state, no URL/query params. The briefing's CTA can call the exact same `onPlanClick` prop `HomeDashboard` already receives (`page.tsx:1538`) with e.g. `'Focused work'`. **No deferral needed** — this is the one part of the ticket's open questions (§8) that resolves cleanly to "already supported."

---

## E. Implementation breakdown (recommended PR sequence)

- **DB1 — Briefing calculation & interpretation contract.** New package or `apps/web/lib/dailyBriefing.ts`: the composition layer in §B's diagram. Consumes `buildPersonalMuhurtaContextForUser`, `calculateDailyTransits`, `getTaraBala` (all unchanged, reused as-is). Produces a versioned, evidence-carrying `AstroDailyBriefing` structure (theme/career/finance/focus/mindful + evidence refs). Includes: resolving the rule-table provenance question from §C, citing the chosen convention in a `provenance.ts`-style constant. Pure functions, fully unit-testable without a server — can reuse this repo's existing plain-`ts-node` test convention.
- **DB2 — Thin API route.** `GET /api/daily-briefing/today` (and optionally `?date=` for yesterday, since §3's historical-date support already exists end-to-end). Same shape/auth pattern as `/api/panchang/transits`: `getSessionFromRequest`, 401/404 on missing session/birth profile, calls DB1's pure function.
- **DB3 — Home Daily Briefing card.** `HomeDashboard.tsx` insertion per §D, with the `localStorage`-backed expand/compact-per-local-date state.
- **DB4 — Full briefing in Insights.** `InsightsView.tsx` insertion per §D (today's + optionally yesterday's, reusing DB2's `?date=` param).
- **DB5 (optional, can merge into DB3) — Home-to-Plan contextual CTA.** Wire "Find time for focused work" through the already-existing `onPlanClick`/`handleOpenPlan` contract — genuinely small, could be a few lines inside DB3 rather than its own PR.

This sequence can likely compress to **3 PRs** (DB1, DB2+DB3 combined, DB4) given how much is already-existing reused infrastructure — but keeping DB1 (calculation/contract) strictly separate from UI PRs is worth preserving, matching this repo's own established pattern of calculation-package PRs preceding UI-integration PRs throughout the DR4 ticket chain.

---

## F. Complexity assessment

| Dimension | Assessment |
|---|---|
| Files likely to change | **Small.** 1 new calculation file (or small package), 1 new API route, edits to `HomeDashboard.tsx` and `InsightsView.tsx` (additive sections only), possibly 1 new `apps/web/lib/dailyBriefingPersistence.ts` for the localStorage helper. No existing file needs structural rework. |
| New dependencies | **None.** `astronomy-engine` is already a dependency; all astrology math reuses existing packages. |
| Database migrations | **None required.** Briefing content is computed on demand (same as `/api/panchang/transits` today, which has run uncached in production with no reported performance issue). A migration would only become necessary if cross-device "did I see today's briefing" persistence is later required — ticket explicitly says to avoid this unless essential, and the client-side `localStorage` approach (§D) satisfies "expanded once per local day" without one. |
| External API requirements | **None.** No LLM, no third-party astrology API — confirmed via repo-wide search for `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/external AI endpoints: zero hits in any production path. |
| Performance impact | **Low.** `getNatalChart()` is 9 `astronomy-engine` calls (Sun/Moon/5 planets + 2 derived nodes); `BirthChartSection.tsx` already calls the equivalent pipeline on every mount with zero caching and no reported issue. Home/Insights calling it once per local-day-first-visit (not per render, given the localStorage gate) is a strictly lighter load than the existing, already-shipped pattern. |
| Major technical risks | 1) **Rule-table provenance** (§C) — reputational/trust risk if shipped uncited. 2) **Two naming collisions** (§D) — mechanical but must be caught before merge, not a design risk. 3) **Ayanamsa precision**: `lahiriAyanamsa()` is a linear approximation, not a full nutation series — acceptable for daily sign/nakshatra-level astrology (the error is arcseconds/year-scale, far below a zodiac-sign boundary's precision need) but worth a one-line doc caveat. 4) **Noon-anchored reference instant**: `getPanchangForDate`'s nakshatra/tithi evaluation defaults to local-noon of the requested date, not sunrise — a documented, deliberate simplification already accepted elsewhere in this codebase; the briefing should inherit the same "civil calendar date" semantics rather than attempt strict sunrise-to-sunrise Vedic-day boundaries, to stay consistent with every other feature in the app. |

---

## G. Recommendation

### CONDITIONAL GO

Existing infrastructure supports a genuinely small implementation — the astronomy, the natal-chart computation, the Gochar house-from-Moon logic, the Tara Bala calculation, the Theme taxonomy (FOCUS/CAREER/FINANCE already first-class), the Home card pattern, the Insights insertion precedent, and the Home→Plan navigation contract **all already exist and are proven in production**. This is not a "build an astrology engine" project; it is a "compose and surface already-working output" project.

The two conditions to resolve **before writing implementation code** (not blocking this audit, but blocking DB1):

1. **Rule-table provenance** (§C) — diff the ticket's own supplied favorable-house tables (not present in this audit's input) against `transits.ts`'s existing hardcoded table, pick and cite one named classical convention, and document it with a `provenance.ts`-style versioned constant, following the precedent already set by `packages/transit-activation`.
2. **Naming collisions** (§D) — confirm the new feature does not reuse the identifiers `DailyBriefing` (already `packages/recommendation/src/dailyAssistant.ts`) or "Daily Guidance" (already `packages/daily-guidance` + `dailyGuidanceOrchestrator.ts`), both unrelated existing features.

Neither condition requires new engineering capability — both are naming/documentation decisions a short pre-implementation pass can close out.

---

## Delivery checklist (per ticket §12)

1. ✅ Completed audit document — this file.
2. ✅ Repository evidence — every claim above cites `file:line`; cross-verified by 4 independent parallel research passes plus firsthand reads of `packages/vedic/src/{natalChart,transits,panchangElements}.ts`, `apps/web/app/api/panchang/{natal-chart,transits}/route.ts`, `apps/web/components/BirthChartSection.tsx`, `apps/web/prisma/schema.prisma`, `apps/web/lib/natalContext.ts`, `packages/transit-activation/src/{index,provenance}.ts`, `packages/personal-intelligence/src/themes.ts`, and `packages/recommendation/src/dailyAssistant.ts`.
3. **Blockers/uncertainties:**
   - The ticket's own "supplied traditional favourable-house tables" were not included in this audit's input prompt — cannot be diffed against the existing table until provided.
   - `lahiriAyanamsa()`'s linear approximation precision was not independently benchmarked against a reference ephemeris in this pass (flagged as low-risk, not verified to a specific arcsecond tolerance).
   - Classical-convention divergence (which named source to cite for the Gochar table) requires a product/astrology-SME decision, not an engineering one.
4. **Recommended minimal implementation sequence:** §E (DB1 → DB2+DB3 → DB4, optionally compressing to 3 PRs).
5. **Verdict: CONDITIONAL GO** — see §G.

**STOP AFTER AUDIT, per ticket instruction. No implementation PRs were created. Awaiting approval.**
