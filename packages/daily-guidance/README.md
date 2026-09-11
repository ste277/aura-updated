# Daily Guidance Composer (V1)

Daily Guidance V1 introduces **no new astrology, no new Muhurta rules,
no new Aura Fit scoring formula, and no numeric composite score**. It is
Aura's first genuine cross-activity selection policy, joining two
already-computed, independently-owned facts:

```text
DailyPersonalFitContext (#102)          WindowRankingContext[] (#103)
   "what matters personally"      +        "best timing per family"
                    \                          /
                     \                        /
                      v                      v
                   Daily Guidance Composer V1
                              |
                              v
                 up to N structured recommendations
```

#104 answers: **given which activity families are personally relevant
today, and the best timing window available for each, which
activity+timing pairs deserve guidance?** It does **not** recompute
astrology, Muhurta, Aura Fit, or timing search; it does not re-rank a
family's own windows (that's #103's exclusive job); and it emits no
natural-language copy (that's #105's job).

## Architecture

```text
packages/personal-intelligence   DailyPersonalFitContext, WindowRankingContext types,
      (contract types)           and the new DailyGuidanceContext output types
              ^
              |
packages/daily-guidance          deriveDailyGuidance(input): DailyGuidanceContext
   (this package)                 -- pure join + staged selection, no recomputation
              ^
              |
   caller supplies both axes already computed
```

`deriveDailyGuidance` never calls `runTimingSearch`, `evaluateActivityFit`,
`evaluateMuhurta`, `getPanchangForDate`, `deriveLifeWeather`, or
`deriveDailyPersonalFit`. Both inputs are already-computed, already-valid
contract values — this engine's only job is to join them on
`activityFamily` and select which joined facts deserve guidance.

## Selection policy

Three fixed stages, run in order, each only if fewer than `limit`
recommendations have been selected so far. There is **no fourth stage**.

| Stage | Selection reason | Personal relevance | Timing label |
|---|---|---|---|
| 1 | `PRIMARY_FLOOR_MET` | `HIGHLY_RELEVANT` or `RELEVANT` | `EXCELLENT` / `VERY_GOOD` / `GOOD` |
| 2 | `RELAXED_TIMING_FLOOR` | `HIGHLY_RELEVANT` or `RELEVANT` | `USABLE` |
| 3 | `RELAXED_RELEVANCE_FLOOR` | `BASELINE` | `EXCELLENT` / `VERY_GOOD` / `GOOD` |

`CAUTION` is never eligible, in any stage — it is simply absent from
every stage's own timing-label set above, not filtered out by a separate
rule. `BASELINE + USABLE` is never eligible in V1 — there is deliberately
no fourth stage.

### Important policy consequence (merge-critical)

```text
RELEVANT + EXCELLENT   beats   HIGHLY_RELEVANT + USABLE
```

because the former clears Stage 1's own timing floor and the latter only
clears Stage 2's relaxed floor — Stage 1 fills every available slot
before Stage 2 is ever consulted. Within Stage 1 itself,
`HIGHLY_RELEVANT` still precedes `RELEVANT` (see "Within-stage ordering"
below) — the timing-quality floor gates *eligibility* first; personal
relevance only breaks ties *within* an already-eligible stage.

## Within-stage ordering

No numeric composite, ever. Candidates within one stage are ordered by a
fixed lexicographic tuple, comparing one key at a time and stopping at
the first non-zero comparison:

```text
1. personal relevance tier    (HIGHLY_RELEVANT=0, RELEVANT=1, BASELINE=2)
2. timing label tier          (EXCELLENT=0, VERY_GOOD=1, GOOD=2, USABLE=3, CAUTION=4)
3. timing score, descending   (verbatim upstream 0-10 presentation score)
4. behavioral affinity tier   (STRONG=0, MODERATE=1, NEUTRAL=2 -- Behavioral Integration V1)
5. preferred-daypart match    (true beats false -- Preferred Daypart Personalization V1)
6. start time, ascending
7. canonical family order     (final deterministic tie-break)
```

`RELEVANCE_TIER_ORDER`/`TIMING_LABEL_TIER_ORDER`/`BEHAVIORAL_AFFINITY_TIER_ORDER`
(constants.ts) are **ordinal ordering keys only** — they are never added,
multiplied, or otherwise combined across axes into one number. Forbidden
patterns: `guidanceScore`, `personalScore`, `combinedScore`,
`priorityScore`, or any `HIGHLY_RELEVANT = 100` / `RELEVANT = 70` /
`BASELINE = 40` style mapping. Every axis stays first-class and
independently explainable in the output (`personalRelevance` and
`timing.label`/`timing.score` are always present side by side on every
recommendation; behavioral affinity and preferred-daypart match are both
input-only, never a new output field — see "Behavioral affinity" and
"Preferred daypart match" below).

### Behavioral affinity (Behavioral Integration V1)

`DailyGuidanceInput.behavioralAffinityByFamily` is an OPTIONAL,
family-keyed map of `'STRONG' | 'MODERATE' | 'NEUTRAL'` — this package's
own local copy of #110's (`apps/web/lib/behavioralAffinity.ts`)
`BehavioralAffinity` tier, never imported from app-layer code (packages
never depend on `apps/web`). The app-level orchestrator derives #110's
real `BehavioralProfileContext` once per request and maps it onto this
structurally-equivalent local type before calling `deriveDailyGuidance`.

Three invariants, all merge-critical:

- **Ordering only, never eligibility.** Affinity is read exclusively in
  `ordering.ts`'s own `compareCandidates` — `eligibility.ts`'s
  `isEligibleForStage` never sees it, so stage membership (which of the
  three fixed stages a candidate clears) is completely unaffected. A
  `STRONG`-affinity `CAUTION`-labeled candidate remains exactly as
  ineligible as before; there is still no fourth stage.
- **Deliberately positioned after timing score, not before it.** Personal
  relevance and timing label are real, structural product floors; timing
  score is a genuine, continuous timing-quality signal within one label
  (see `packages/recommendation/src/timingSearch.ts`'s own
  `toPresentationScore`) — a same-label score gap (e.g. `GOOD` 89 vs
  `GOOD` 74) is a real timing-quality difference that historical
  repetition must never override. Affinity therefore only ever breaks a
  tie that would otherwise fall through to the already-arbitrary
  `start`/`canonical family order` tail.
- **Missing input reproduces pre-integration output exactly.** An omitted
  `behavioralAffinityByFamily` (every pre-Behavioral-Integration-V1
  caller), or a family absent from it, both resolve to `NEUTRAL` in
  `eligibility.ts`'s own `buildCandidates` — never thrown. `NEUTRAL` vs
  `NEUTRAL` is always a comparison no-op, so cold start / no-history
  output is byte-for-byte identical to V1's pre-integration ranking.

### Preferred daypart match (Preferred Daypart Personalization V1)

`DailyGuidanceInput.preferredDaypartMatchByFamily` is an OPTIONAL,
family-keyed map of `boolean` — deliberately a bare primitive, never a
daypart enum, never a timezone. The app-level orchestrator already knows
the family's own rank-1 window (`ConcreteGuidanceCandidate.timingCandidates[0]`),
the user's own timezone, and #110's own derived `preferredDaypart` for
that family; it resolves the yes/no fact ("does this family's selected
window match") once, before this input is ever built. This package never
imports `InsightsDayPart`, `BehavioralProfileContext`, or any
`apps/web/lib` module — it receives only the already-resolved boolean,
keeping it fully timezone-agnostic and behavioral-engine-agnostic, the
identical dependency-direction discipline `behavioralAffinityByFamily`
already established.

Four invariants, all merge-critical:

- **Ordering only, never eligibility.** Identical to behavioral affinity
  — read exclusively in `ordering.ts`'s own `compareCandidates`,
  `eligibility.ts`'s `isEligibleForStage` never sees it. A `true`-match
  `CAUTION`-labeled candidate remains exactly as ineligible as before;
  still no fourth stage.
- **Deliberately positioned after behavioral affinity, not before it.**
  Behavioral Affinity measures established commitment to an entire
  activity family; a preferred-daypart match is a narrower refinement of
  *when* within an already-observed pattern — a materially weaker signal
  that must never outrank a more established overall pattern. Placed
  before `start`/`canonical family order`, exactly where affinity itself
  sits relative to that same tail.
- **Positive-only signal.** A genuine mismatch, no behavioral history,
  and an app-excluded Plan candidate (the app never computes a match for
  a `source: 'PLAN'` candidate — an explicit Plan time is never
  second-guessed by behavior) are ALL represented by the identical
  `false`. There is no way for this package to distinguish or penalize
  any of them differently — a match only ever adds a boost, absence of
  one is always neutral, never a penalty.
- **Missing input reproduces pre-integration output exactly.** An omitted
  `preferredDaypartMatchByFamily` (every pre-Preferred-Daypart-
  Personalization-V1 caller), a family absent from it, or an explicit
  `false` entry all resolve to `false` in `eligibility.ts`'s own
  `buildCandidates` — never thrown. `false` vs `false` is always a
  comparison no-op, so cold start / no-history output is byte-for-byte
  identical to this feature's own pre-integration ranking.

## Best window only (merge-critical)

For each family, only `windowRanking.windows[0]` (rank 1) is ever read.
Rank 2/3 are never inspected when composing a recommendation, and never
substituted for a rank-1 window that turns out to overlap an
already-selected recommendation — see "Diversity" below. This preserves
`packages/window-ranking`'s exclusive ownership of within-family timing
order: #104 never redefines what a family's own "best timing" is.

## Diversity (temporal only)

Two selected windows may never overlap. Overlap uses **strict interval
semantics**:

```ts
function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}
```

Adjacent windows (`09:00–10:00` followed immediately by `10:00–11:00`) do
**not** overlap under this definition and may both be selected.

This is deliberately **not** the same rule as
`packages/recommendation/src/dailyAssistant.ts`'s own
`selectDiversePlanningOptions()` 90-minute clock-time-proximity buffer —
that buffer solves a different problem (perceived variety across *one*
activity's own multi-day/multi-time candidates). #104's own problem is
"can the user physically do both", which is a real interval conflict, not
a proximity heuristic, so the 90-minute rule was not reused.

If a family's rank-1 window overlaps an already-selected recommendation,
that family is **skipped entirely for the current stage** — never
demoted to its own rank-2/3 window to make the result look tidier. The
overlap constraint is also never relaxed just to reach `limit`: if only
two non-overlapping eligible recommendations exist, the result contains
2, not a forced 3.

No semantic family grouping (`DEEP_WORK`+`FOCUSED_WORK`+`ADMIN` as one
"focus" group, `WORKOUT`+`WELLBEING` as one "health" group, etc.) is
implemented — no canonical grouping exists anywhere else in the repo, and
inventing one is explicitly deferred to a future PR informed by real
#105 UX feedback.

## Up to N, never exactly N

`limit` defaults to 3, is caller-configurable, and must be a positive
integer when supplied. `recommendations` may legitimately contain fewer
than `limit` entries (quality over padding) and may legitimately be `[]`
(no family cleared any stage's eligibility bar today) — both are valid,
non-error results, never fabricated guidance.

## Empty/missing window handling

A family with no supplied `WindowRankingContext`, or one whose `windows`
is `[]`, produces **no candidate at all** for that family — including
when that family is `HIGHLY_RELEVANT`. There is no fabricated timing, no
exception raised solely because a list is empty, and no
`unavailableRelevantActivities`-style contract in V1 (see "No
omittedActivities in V1" below).

## No `omittedActivities` in V1

`DailyGuidanceContext` does **not** report which relevant families were
not selected, or why (no window / `CAUTION`-only / lost a diversity
tie-break). This is a deliberate V1 scope decision, not an oversight:

- omission semantics are genuinely unresolved product questions (should a
  `CAUTION`-only family get a distinct code from a no-window family? does
  "lost to diversity" deserve reporting at all?);
- #104's core job is producing selected, *positive* guidance;
- richer "why wasn't this selected?" explainability belongs naturally to
  #106 (Why Aura?), which can be added later without changing selection
  semantics here.

A family with no selectable recommendation is simply absent from
`recommendations[]`.

## Why not `DailyPersonalGuidance`

`packages/personal-intelligence/src/guidance.ts` already has an older,
unpopulated placeholder — `DailyPersonalGuidance`/`PersonalRecommendation`
— left over from before #101/#102/#103 existed. It is **not** used or
modified by this PR: its shape is semantically incompatible with #104's
own V1 scope on three independent counts —

1. `PersonalRecommendation.score: NormalizedScore` is a single collapsed
   number — exactly the numeric composite this PR's own architectural
   principle forbids.
2. `DailyPersonalGuidance.headline`/`summary: string` are pre-rendered
   display prose — #104 emits no natural-language copy.
3. `DailyPersonalGuidance.date`/`timezone` assume date/timezone
   ownership — #104 stays fully temporal-agnostic (see "Timezone
   handling" below).

Following the exact precedent #102 already set for its own, differently
incompatible older placeholder (`PersonalActivityFit`), this PR leaves
`DailyPersonalGuidance`/`PersonalRecommendation`/`PersonalActivityFit`
completely untouched and adds new, distinctly-named types
(`DailyGuidanceContext`/`DailyGuidanceRecommendation`, in
`packages/personal-intelligence/src/context.ts`) instead of retrofitting
the old shape.

## Timezone handling

This package accepts no `timezone`/`latitude`/`longitude`/`localDate`
input and performs no timezone or DST logic. All timestamps
(`window.start`/`window.end`) arrive already materialized from whatever
search range the caller's own upstream `runTimingSearch`/#103 call used.
If a caller wants "remaining today only" guidance, that filtering belongs
to the upstream timing-search call (or a future #103 adapter parameter),
never to this composer.

## Evidence strategy

At most two `PersonalEvidenceRef` entries per recommendation:

1. one composer-owned selection-rule fact (`source: 'DAILY_GUIDANCE'`) —
   which stage selected this candidate and the tuple values compared;
2. one forwarded-timing-facts bundle (`source: 'MUHURTA'`, only present
   when the selected window actually has `reasons`/`conflicts`) — the
   selected window's own `MuhurtaReason[]`/`TimingConflict[]`, reduced to
   JSON-safe fields (`code`/`factor`/`polarity`/`impact`/`value`/`params`
   for reasons; `type`/`message` for conflicts), never reinterpreted.

Evidence is tagged by **originating calculation**, never by whichever
engine merely forwards it — this is why forwarded timing facts stay
tagged `'MUHURTA'` rather than `'DAILY_GUIDANCE'`, matching this
contract's existing convention (see
`packages/personal-intelligence/src/evidence.ts`'s own doc comment on
`PersonalEvidenceSource`). One additional result-level `'DAILY_GUIDANCE'`
summary entry (requested limit, selected count, engine/policy version)
is attached to `DailyGuidanceContext.evidence` — never an enumeration of
rejected/omitted families.

`relevantThemes`/`personalRelevance` are copied verbatim from the
matching `DailyActivityFit` onto each recommendation directly (not
wrapped in a separate evidence entry) — those are already the compact
facts #105/#106 need; this PR does **not** copy
`DailyActivityFit.evidence`, `DailyPersonalFitContext.evidence`, or any
Life Weather evidence into the output.

## Zero-coupling boundary

`packages/personal-intelligence` must remain at zero cross-package
imports. The new `DailyGuidanceRecommendation.activityFamily` and
`DailyGuidanceTiming.label` fields stay plain `string` there — never a
type import of `packages/muhurta`'s `MuhurtaActivityFamily` or
`packages/recommendation`'s `TimingCandidateLabel`. This package
(`packages/daily-guidance`) is the one place those real upstream types
get consulted, narrowed, and adapted into the generic contract shape —
matching the exact same boundary `packages/daily-personal-fit` and
`packages/window-ranking` already established for their own upstream
dependencies.

## Validation

Structural shape only, never astrology:

- `dailyPersonalFit.activities` must cover all 13 canonical families
  exactly once each, with a canonical `activityFamily` and a canonical
  `personalRelevance` — enforcing a guarantee `DailyPersonalFitContext`
  already makes for every valid instance, not a new restriction.
- `windowRankings` may cover fewer than 13 families (partial coverage is
  valid); a **duplicate** `WindowRankingContext` for one family is
  rejected outright (never "first/last/best wins" — structurally
  ambiguous).
- A non-canonical `activityFamily` anywhere is rejected.
- A `windowRankings` entry referencing a family absent from
  `dailyPersonalFit.activities` is rejected (defense-in-depth — this
  should be structurally unreachable given the "all 13" check above, but
  is validated anyway).
- A non-empty `windows` array's own `windows[0].rank` must be `1` — this
  engine trusts, but minimally checks, #103's own rank-1-best guarantee;
  it never re-validates #103's full rank sequence or reason/conflict
  shapes beyond what composition itself needs.
- `limit`, when supplied, must be a positive integer.

## Non-goals

- No astrology calculation of any kind (no new or re-derived
  Tithi/Nakshatra/Yoga/Karana/Rahu/Yama/Gulika/Abhijit/Brahma logic).
- No Muhurta calculation, no Aura Fit calculation, no timing search.
- No within-family re-ranking (#103's exclusive job).
- No numeric composite score.
- No natural-language copy, no display labels, no LLM call.
- No semantic (non-temporal) family diversity.
- No `CAUTION` recommendations, and no "use caution" advisory section.
- No new personalization source (no calendar, habit history, behavior
  history, or user-preference weighting).
- No Ashtakavarga or any additional astrology beyond what #101/#102
  already compute.
- No forward/future-date planning (that's #107's job).
- No Home UI.

## Traditional vs Aura

```text
Traditional / upstream     Panchang, Muhurta, Tara Bala
Personal astrology         Life Weather (#101), Daily Personal Fit (#102)
Existing timing            Aura Fit, Timing Search, Window Ranking (#103)
                           intelligence
New Aura synthesis (#104)  cross-family eligibility, quality floor,
                           fallback staging, cross-family tuple ordering,
                           exact-overlap diversity
```

These selection rules are **Aura product semantics**, not classical
astrological rules — exactly the same boundary #101's and #102's own
READMEs already draw for their own synthesis layers.

## Package contents

| File | Contents |
|---|---|
| `constants.ts` | `CANONICAL_ACTIVITY_FAMILIES`, `RELEVANCE_TIER_ORDER`, `TIMING_LABEL_TIER_ORDER`, `BEHAVIORAL_AFFINITY_TIER_ORDER`, `PRIMARY_TIMING_LABELS`, `RELAXED_TIMING_LABELS`, `DEFAULT_LIMIT` |
| `types.ts` | `DailyGuidanceInput`, `DailyGuidanceValidationError`, `DailyGuidanceCandidate` (internal), `BehavioralAffinityTier` -- `preferredDaypartMatch`/`preferredDaypartMatchByFamily` are plain `boolean`, no new type |
| `validation.ts` | `assertValidDailyGuidanceInput` |
| `eligibility.ts` | `buildCandidates`, `isEligibleForStage`, `SELECTION_STAGES` |
| `ordering.ts` | `compareCandidates`, `sortCandidates` |
| `overlap.ts` | `windowsOverlap` |
| `evidence.ts` | `buildSelectionEvidence`, `buildTimingEvidence`, `buildResultSummaryEvidence` |
| `engine.ts` | `deriveDailyGuidance` |
| `provenance.ts` | `DAILY_GUIDANCE_ENGINE_VERSION`, `DAILY_GUIDANCE_SELECTION_POLICY_VERSION` |

## Two version constants

```typescript
export const DAILY_GUIDANCE_ENGINE_VERSION = 'DAILY_GUIDANCE_V1';
export const DAILY_GUIDANCE_SELECTION_POLICY_VERSION = 'DAILY_GUIDANCE_SELECTION_POLICY_V3';
```

`SELECTION_POLICY_VERSION` bumped to `V2` under Behavioral Integration V1
— the within-stage ordinal tuple gained a new key (behavioral affinity
tier), which is exactly PRODUCT selection semantics, not a contract shape
change — then to `V3` under Preferred Daypart Personalization V1 for the
identical reason (one more tuple key, preferred-daypart match). `ENGINE_VERSION`
stayed `V1` both times: `DailyGuidanceContext`/`DailyGuidanceRecommendation`
gained no new field either time — both behavioral affinity and
preferred-daypart match are input-only ordering signals (see "Behavioral
affinity" and "Preferred daypart match" above).

Kept deliberately separate: the engine version describes the *contract
and plumbing* (what fields exist, what they mean structurally); the
selection-policy version describes *Aura product semantics* (which stage
floors apply, what order the tuple keys are consulted in) — semantics
that may reasonably evolve on their own without the contract shape
itself changing.

## Tests

`test/dailyGuidanceEngine.test.ts` (repo root `test/` directory, matching
this repository's existing convention). Run with:

```bash
npx ts-node test/dailyGuidanceEngine.test.ts
```
