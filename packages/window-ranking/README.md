# Window Ranking Engine (V1)

Window Ranking V1 introduces **no new astrology, no new Muhurta rules,
and no new Aura Fit scoring formula**. It formalizes existing production
timing-search behavior.

```text
existing runTimingSearch / TimingCandidate[]
                    ↓
         Window Ranking V1 contract
                    ↓
 ranked windows for ONE activity family
```

#103 answers: **what are the already-evaluated timing candidates for
this activity, in the canonical timing-system ranking order?** It does
**not** answer which activity matters most personally, which activity
should win across families, or what Aura's Top 3 for today are — those
belong to #102/#104.

## Critical finding — do not rebuild timing logic

The existing production stack (`packages/recommendation/src/dailyAssistant.ts`
and `packages/recommendation/src/timingSearch.ts`) already owns candidate
generation, 15-minute search stepping, requested-duration evaluation,
atomic window segmentation, overlap handling, hard-block dominance, Aura
Fit scoring, Muhurta scoring, caution handling, and deterministic timing
ranking. This package does not recreate any of it — it consumes
already-computed `TimingCandidate[]` results and formalizes them into an
explicit, per-activity-family contract.

## Personal relevance absent (orthogonal to #102)

This package has **zero reference** to `DailyPersonalFitContext`,
`DailyActivityFit`, `PersonalRelevance`, `LifeWeatherContext`, or any
other `packages/personal-intelligence`/`packages/daily-personal-fit`/
`packages/life-weather` type. Personal relevance is constant across
every timing candidate belonging to one activity family — it therefore
cannot change the *order* of windows within that family, which is all
this package ranks. #104 is the layer that will combine `#102`'s
personal-relevance axis with `#103`'s own best-timing-per-activity
output.

## Pure core API

```typescript
deriveWindowRanking(input: WindowRankingInput): WindowRankingContext
```

```typescript
interface WindowRankingInput {
  activityFamily: MuhurtaActivityFamily; // packages/muhurta's own 13-value, scoring-keyed vocabulary
  candidates: TimingCandidate[];         // packages/recommendation's own timing-search output
}
```

The core never calls `runTimingSearch`, `evaluateActivityFit`,
`evaluateMuhurta`, or `getPanchangForDate` — it consumes already-returned
candidates only.

## Important — order semantics (read before touching this code)

**`deriveWindowRanking` does not recalculate ranking. It treats the
supplied `TimingCandidate[]` order as canonical and assigns explicit
1-based ranks.**

`runTimingSearch` has already ranked candidates using internal timing
information (its own raw score plus deterministic tie-breaking — see
`selectDiversePlanningOptions`/`selectDailyBestPlanningOptions` in
`dailyAssistant.ts`, and `runFind`'s own final `sort((a,b) => b.rawScore - a.rawScore)`
in `timingSearch.ts`) before ever returning `candidates[]`. The exposed
`TimingCandidate.score` is a **presentation** score (0-10, one decimal) —
re-deriving a sort from it here could collapse distinctions the
production system's own internal raw scoring already resolved, or
silently disagree with the canonical production order. **This is
crucial to prevent a future maintainer from "simplifying" this engine by
sorting on presentation score — do not do that.**

Concretely: `output.windows[i].rank === i + 1`, always, for the
`candidates` array exactly as supplied. No `.sort(...)` of any kind
exists anywhere in this package's own ranking core.

## Output contract

```typescript
type RankedTimingWindow = TimingCandidate & { rank: number };

interface WindowRankingContext {
  engineVersion: string;             // 'WINDOW_RANKING_V1'
  activityFamily: MuhurtaActivityFamily;
  windows: RankedTimingWindow[];     // one activity family only -- never cross-family
}
```

Every `TimingCandidate` field (`start`, `end`, `score`, `label`,
`muhurtaScore`, `auraFitScore`, `reasons`, `conflicts`, `metadata`) is
preserved **verbatim** via a shallow copy — never renamed, renormalized,
or reinterpreted. `start`/`end` are kept as-is rather than renamed to
`startAt`/`endAt`, specifically to avoid an unnecessary timestamp
transformation.

## No score renormalization, no label duplication

The existing 0-10 presentation score is never converted to 0-100 or
0-1. `TimingCandidateLabel` (`EXCELLENT`/`VERY_GOOD`/`GOOD`/`USABLE`/
`CAUTION`) is imported and reused directly — never redeclared, never
mapped to a second scale (e.g. `VERY_GOOD → 80`).

## Hard-block semantics remain upstream

For commencement-sensitive activities, current production behavior
hard-excludes a requested duration whenever it **overlaps at all** with
`RAHU_KALAM`/`YAMA`/`GULIKA` — even when the activity begins before the
friction window and only later overlaps it. This package does not
reinterpret that rule (it is not "only blocked if the task starts inside
Rahu/Yama/Gulika") — it simply preserves whatever `runTimingSearch`
already decided. For non-commencement-sensitive (everyday) activities,
the same windows create friction and lower scoring without hard
exclusion — again, preserved as-is, never re-derived.

## Blocked candidates — known V1 limitation

`runTimingSearch`'s own FIND mode already filters out hard-negative
(blocked) candidates before returning its ranked list (see
`runFind`'s own `if (candidate.conflicts?.some(...FRICTION_WINDOW_BLOCKED...)) continue`).
**Window Ranking V1 therefore represents only the eligible, returned
timing candidates — not every rejected candidate considered during
search.** This is an intentional, documented V1 boundary, not an
oversight; surfacing rejected/blocked candidates explicitly (a new
capability beyond what exists today) is deferred to a later PR if #106
needs it.

## CAUTION candidates remain

The existing `TimingCandidateLabel` scale already includes `CAUTION` for
low/negative-scoring-but-still-returned candidates. This package never
filters them out and never invents a second status vocabulary
(`SUPPORTED`/`MIXED`/`BLOCKED`) — the existing 5-value scale already
covers the space.

## Raw reasons/conflicts preserved

`MuhurtaReason[]` (with its own `SUPPORT`/`CAUTION`/`BLOCK` polarity) and
`TimingConflict[]` are forwarded exactly as received — never collapsed
into a synthetic `MIXED` status. A consumer can inspect reason polarity
directly.

## No global ranking

This package's API processes exactly **one** `activityFamily` at a time.
It never accepts a map of multiple families and never produces a single
combined, cross-activity sorted list — comparing a `DEEP_WORK` window
against a `FINANCE` window is explicitly #104's own job.

## Optional orchestration adapter

```typescript
rankActivityWindowsFromTimingSearch(input: WindowRankingFromTimingSearchInput): WindowRankingContext
```

Calls `runTimingSearch` in `mode: 'FIND'` **only** (never `CHECK`/
`COMPARE`, which have different semantic purposes — normalizing those
into this same contract is deferred, not attempted, in V1), then passes
`response.candidates` straight into `deriveWindowRanking` with no
intermediate sort, no score change, and no additional filtering beyond
what `runTimingSearch` itself already performed.

### No reverse family → activity mapping (merge-critical)

No canonical `MuhurtaActivityFamily → ActivityProfile` mapping exists
anywhere in the repo — confirmed by the PR #103 architecture audit: many
catalog activities can share one family, each with its own different
timing preferences, so there is no single "the" activity per family.
This adapter does **not** invent one (e.g. it will never contain
`DEEP_WORK → 'deep-work-default'`). The caller must supply **both**
`activityFamily` (for this package's own output identity) **and**
whatever `runTimingSearch` itself already requires to resolve a concrete
activity (`activityId` or `taskTitle`) — exactly the two inputs a caller
of `runTimingSearch` would already need today.

## Timezone / DST

The pure core requires no timezone, latitude, or longitude at all —
candidates are already materialized instants by the time they reach it.
The orchestration adapter reuses `packages/recommendation`'s own
existing `DailyAssistantContext` (IANA-timezone-correct via
`resolveTzOffsetMinutes`, `Intl`-based, DST-correct) rather than
introducing a second time/location contract. No host timezone, no
`UTC+5:30` assumption.

## Traditional vs. Aura

- **Traditional/upstream inputs**: Panchang (Tithi/Nakshatra/Yoga/Karana,
  solar windows), Tara Bala.
- **Existing Aura methodology**: the Aura Fit weighted formula, hard
  commencement exclusion, `TimingCandidate` labels, timing-search
  ranking — all owned by `packages/recommendation`/`packages/muhurta`,
  untouched by this PR.
- **New #103 behavior**: an explicit contract, rank numbering, order
  preservation, and an optional orchestration adapter. **No new
  astrology.** `WINDOW_RANKING_V1` refers to this contract/order
  formalization, never a new scoring methodology.

## Non-goals

Candidate generation, Aura Fit/Muhurta calculation, Panchang calculation,
conflict-resolution algorithms (already implemented upstream), atomic
window-segment exposure, blocked-candidate retention, cross-activity/
global ranking, personal relevance, natural-language guidance ("Best for
you," "Top 3," "You should"), UI, database/schema/API/server actions,
LLM interpretation.

## Determinism

No `Date.now()`, `Math.random()`, network, or DB anywhere in the pure
core. Repeated calls with structurally identical input produce
deeply-equal output. Input `candidates` (and every nested field) is
never mutated.

## Disclaimer

This is a deterministic formalization of an already-computed,
deterministic upstream result and is not scientifically established
predictive analysis.
