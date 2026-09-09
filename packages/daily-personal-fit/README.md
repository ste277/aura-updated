# Daily Personal Fit Engine (V1)

Daily Personal Fit V1 does not evaluate Panchang, Muhurta, or timing
windows. It projects an already-computed Life Weather snapshot onto
Aura's canonical Muhurta activity families to determine personal
relevance. Timing and window ranking are intentionally deferred to
PR #103.

```text
LifeWeatherContext
        ↓
PersonalTheme → ActivityFamily mapping
        ↓
DailyPersonalFitContext
```

#102 answers: **which activity families are personally relevant to this
person at the current Life Weather snapshot?** It does **not** answer
"when should I do it," "which window is best," "is this Muhurta
favorable," "what are my Top 3," or "what should Aura recommend" — those
belong to #103 (Window Ranking & Conflict Resolution) and #104 (Daily
Guidance Composer).

## Hard boundary (Option B)

This engine has **no** Panchang, **no** Muhurta evaluation, **no** Aura
Fit evaluation, **no** timing windows, **no** window scores, **no**
Rahu/Yama/Gulika/Abhijit/Brahma logic, **no** ranking, **no** conflict
resolution, and **no** natural-language guidance. This boundary is
intentional, not a placeholder gap to be filled in later within this
package: the existing, live Aura Fit system (`packages/recommendation`)
is already responsible for activity/window scoring and already has its
own, separate Tara Bala / personal-Muhurta personalization layer
(`AURA_PERSONAL_FIT_V1`, `evaluatePersonalMuhurtaFit` in
`auraFitEngine.ts`) — #102 does not modify or integrate with that system
at all.

## Public API

```typescript
deriveDailyPersonalFit(input: DailyPersonalFitInput): DailyPersonalFitContext
```

```typescript
interface DailyPersonalFitInput {
  lifeWeather: LifeWeatherContext;
}
```

No separate date, timezone, location, birth information, or evaluation
instant argument. `evaluationTime` is read verbatim from
`lifeWeather.evaluationTime` — see "No new temporal model" below.

## Pure composition

This engine never calls `deriveLifeWeather`, `deriveThemeContext`,
`calculateTransitActivation`, `calculateVimshottariDasha`,
`getNatalChart`, `getPanchangForDate`, `evaluateMuhurta`, or
`evaluateActivityFit`. It consumes an already-computed
`LifeWeatherContext` only.

## Canonical activity vocabulary

`packages/muhurta/src/muhurtaEngine.ts`'s own **13-value**
`MuhurtaActivityFamily` — the exact vocabulary the real Muhurta `RULES`
scoring table is keyed on today:

```text
DEEP_WORK, WORKOUT, LEARNING, MEDITATION, RELATIONSHIP, JOURNEY_START,
SOCIAL, MEAL, FINANCE, NEW_BEGINNING, ADMIN, WELLBEING, FOCUSED_WORK
```

Deliberately **not** the newer, coarser 10-value `MuhurtaFamily`
(`activityOntology.ts`) and **not** `ActivityCategory`
(`packages/recommendation`) — using the legacy, scoring-keyed vocabulary
gives a future #103 a direct bridge from Daily Personal Fit into real
Muhurta/Aura Fit window scoring, without an extra translation step.

`packages/daily-personal-fit` (unlike `packages/personal-intelligence`)
is allowed to depend on upstream domain packages — this package imports
`MuhurtaActivityFamily` directly from `packages/muhurta` for its own
internal typing, matching the identical precedent `packages/personal-themes`
(depends on `packages/bhrigu`) and `packages/life-weather` (depends on
`packages/personal-themes`) already established. `packages/muhurta` is
imported from, **never modified**, and only for this one type — no
`evaluateMuhurta`, `RULES`, `muhurtaRulePacks`, `MuhurtaReason`, or
window type is ever imported.

## Activity family → Personal Theme mapping (new, Aura semantic layer)

No existing mapping between any activity-family vocabulary and
`PersonalTheme` was found anywhere in the repo (confirmed by search
across `packages/recommendation`, `packages/muhurta`,
`packages/personal-themes`, and `apps/web` during this PR's own
architecture audit) — this package therefore owns a new, hand-authored,
versioned table (`ACTIVITY_THEME_MAPPING_V1`, `mapping.ts`):

```text
DEEP_WORK      → FOCUS, CAREER, LEARNING, CREATIVITY
WORKOUT        → WELLBEING
LEARNING       → LEARNING, FOCUS
MEDITATION     → SPIRITUALITY, WELLBEING
RELATIONSHIP   → RELATIONSHIPS
JOURNEY_START  → EXPLORATION
SOCIAL         → SOCIAL, RELATIONSHIPS
MEAL           → WELLBEING
FINANCE        → FINANCE
NEW_BEGINNING  → CAREER, CREATIVITY, EXPLORATION
ADMIN          → FOCUS, CAREER
WELLBEING      → WELLBEING
FOCUSED_WORK   → FOCUS, CAREER
```

This table is **Aura product semantic mapping**, not a classical
astrology rule, not weighted, and not traditional doctrine. `CREATIVITY`
is reachable only through `DEEP_WORK`/`NEW_BEGINNING`, and
`SPIRITUALITY` only through `MEDITATION` — the current *scored* Muhurta
taxonomy (`MuhurtaActivityFamily`) has no dedicated creative or
broader-spiritual family, and this PR does not extend that taxonomy;
#102 maps onto existing scoring vocabulary only, it never invents a new
Muhurta family. Direction is `ActivityFamily → PersonalTheme[]` (never
the reverse, never bidirectional) — matching the per-activity query this
engine actually needs, and the identical precedent
`packages/life-weather/src/mapping.ts`'s own `getThemesForPlanet`
already established.

**Mapping completeness**: every one of the 13 canonical
`MuhurtaActivityFamily` values has exactly one mapping-table entry — no
silent missing values (verified by `isMappingComplete()` and a dedicated
test).

## Full activity vector — never sparse

Every `DailyPersonalFitContext.activities` result contains exactly 13
`DailyActivityFit` entries, in `CANONICAL_ACTIVITY_FAMILIES`' own fixed
order — never fewer, never re-sorted by relevance. This gives a future
#103 a stable join surface.

## `relevantThemes` — lossless, not "active themes only"

For every activity family, `relevantThemes` lists **every** theme it is
semantically mapped to, together with that theme's own current
`LifeWeatherState` — **including `QUIET`**. A theme is never dropped
because it happens to be quiet right now; the mapping stays fully
explainable regardless of current state.

`relevantThemes` never carries `contributors`, transit details, Dasha
details, full Life Weather evidence, or `natalStrength` — Life Weather
remains the source of truth for all of that; this package carries only
`{ theme, state }` plus its own small synthesis evidence.

## Personal relevance derivation — structural maximum, never a count

```text
PersonalRelevance = 'BASELINE' | 'RELEVANT' | 'HIGHLY_RELEVANT'

if ANY mapped theme is STRONGLY_ACTIVE → HIGHLY_RELEVANT
else if ANY mapped theme is ACTIVE     → RELEVANT
else                                    → BASELINE
```

No numeric conversion, no counting, no weighted average. Three `ACTIVE`
mapped themes produce exactly the same `RELEVANT` result as one `ACTIVE`
mapped theme — count never drives V1 relevance, only the presence of a
`STRONGLY_ACTIVE` theme elevates the result. `BASELINE` means "not
currently reinforced by Life Weather" — it does **not** mean the
activity is unsuitable, low-quality, or bad; V1 deliberately never emits
`LOW`/`IRRELEVANT`/`BAD`/`AVOID`.

## Natal strength / natal direction do not drive fit (merge-critical)

`personalRelevance` is derived **only** from `theme.state`.
`LifeWeatherTheme.natalStrength` and `.natalDirection` are never
inspected by the relevance derivation — confirmed structurally: neither
field is even passed into `deriveActivityRelevance`. This is why
`SOCIAL`/`FINANCE` (structurally `natalStrength = 0` for every user in
Personal Themes V1) can still reach `RELEVANT`/`HIGHLY_RELEVANT` whenever
their own `state` is `ACTIVE`/`STRONGLY_ACTIVE`. `natalDirection`
(`SUPPORTIVE`/`NEUTRAL`/`CHALLENGING`) is natal context, not a "today is
favorable" signal, and V1 does not reinterpret it as one.

## No ranking

Output order is always `CANONICAL_ACTIVITY_FAMILIES`' own fixed order —
never sorted by relevance, never "best first." #103/#104 own
prioritization.

## No new temporal model

"Daily" refers to the current Life Weather snapshot
(`lifeWeather.evaluationTime`), **not** a Panchang-day calculation. This
engine introduces no `date`, `timezone`, `location`, `localDate`,
`dayStart`, or `sunrise` concept of its own anywhere in its core API.

## Evidence discipline

Every activity family carries exactly one small,
`DAILY_PERSONAL_FIT`-sourced evidence entry documenting which mapped
themes were inspected and which maximum state determined the result —
never a forwarded copy of `LifeWeatherTheme.evidence`/`contributors`. The
result carries one small summary entry. A representative full 13-family
result is expected to serialize in the **low single-digit KB**.

## Traditional vs. Aura

- **Life Weather input**: already-derived Aura personal intelligence
  (itself built on traditional Vimshottari period identity and sidereal
  transit positions — see `packages/life-weather/README.md`).
- **Activity-theme mapping**: Aura product semantic mapping (this
  package's own new table).
- **Relevance derivation**: Aura product synthesis (the structural
  maximum-state rule above).

#102 performs **zero traditional astrology calculation** directly. The
activity-theme mapping is not Vedic/classical doctrine — it is a new,
versioned, hand-authored Aura product decision.

## Non-goals

Panchang, Muhurta evaluation, Aura Fit evaluation, timing windows,
window scores, Rahu/Yama/Gulika/Abhijit/Brahma logic, Ashtakavarga,
window ranking, conflict resolution, natural-language guidance,
recommendations, "Top 3," UI, database/schema/API/server actions, LLM
interpretation.

## `PersonalActivityFit` is a different, older type

`packages/personal-intelligence`'s existing `PersonalActivityFit`
(`guidance.ts`) is an older, still-unpopulated placeholder contract — a
single-activity-id-keyed `{ activity, score, reasons, cautions, evidence }`
shape, unrelated to and unmodified by this PR. Daily Personal Fit V1's
own output is `DailyPersonalFitContext`/`DailyActivityFit`
(`context.ts`) — an activity-FAMILY-keyed, multi-dimensional relevance
result with no numeric score.

## Determinism

No `Date.now()`, `Math.random()`, network, or DB anywhere in the source.
`evaluationTime` is always read verbatim from the supplied
`LifeWeatherContext`. Repeated calls with structurally identical input
produce deeply-equal output.

## Disclaimer

This is a deterministic composition of an already-computed, deterministic
upstream result and is not scientifically established predictive
analysis.
