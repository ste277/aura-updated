# Transit Activation Engine (V1)

Deterministic sign-level detection of which natal placements a person's
current planetary transits are activating.

```text
Birth data                          Evaluation instant
   |                                     |
   v                                     v
Natal chart (packages/vedic)     Transit chart (packages/vedic,
   |                              same function, different instant)
   +-------------------+  +--------------+
                        v  v
              Transit Activation adapter
                        |
                        v
              pure activation engine
                        |
                        v
        directed transiting -> natal activations
```

This is an **activation-detection** engine. It is **not** a horoscope
composer, recommendation engine, Life Weather engine, or UI feature —
see "Non-goals" below.

## Purpose

Given a canonical natal chart and planetary positions at an explicit
evaluation instant, deterministically identify which natal planetary
themes are being activated by current transits and return structured,
explainable activation evidence.

## Repository audit (Phase 0)

Searched the repository for `transit`, `activation`, `conjunction`,
`opposition`, `trine`, `aspect`, `orb`, `gochara`, `TransitActivation`.
Findings:

- **`TransitActivation`/`TransitActivationContext` already exist** as a
  forward-looking contract in `packages/personal-intelligence/src/context.ts`
  (from PR #95) — at that time: `{ transitingPlanet: string; activatedThemes:
  PersonalThemeSignal[]; natalTargets: PersonalEvidenceRef[]; strength:
  number; evidence: PersonalEvidenceRef[] }` (CONTRACT_V1). See "Personal
  Intelligence adapter" below for why this package's own adapter into that
  contract was initially deferred, and how PR #101's CONTRACT_V2 evolution
  later made a lossless adapter possible.
  that contract in V1.
- **`packages/vedic/src/transits.ts` already exists**, and its own
  `calculateDailyTransits` already calls `getNatalChart(currentDate)` to
  obtain "transit" positions for an arbitrary instant — this is the
  direct, in-production proof that `getNatalChart()` is already the
  canonical transit-position source (see "Canonical sources" below).
  That file's own logic (house-from-Moon transit favorability +
  hardcoded favorable/cautionary prose) is a **different, older,
  interpretive heuristic** — this package does not import or extend it,
  only the underlying `getNatalChart()` position calculator it also
  calls.
- **`packages/bhrigu/src/relationships.ts` already implements** exactly
  the generic, stateless sign-relationship classification this engine
  needs, publicly exported from `packages/bhrigu/src/index.ts` — see
  "Relationship model" below.
- **No existing Transit Activation engine of any kind** exists prior to
  this package.

## Canonical sources

- **Natal positions**: `packages/vedic/src/natalChart.ts`'s
  `getNatalChart(birthMomentUTC): GrahaPosition[]`.
- **Transit positions**: the **same function**, called with the
  evaluation instant instead of the birth instant —
  `getNatalChart(evaluationInstant): GrahaPosition[]`. No second
  astronomy implementation is introduced; both natal and transit
  positions share the exact same Lahiri sidereal convention because
  they come from the identical calculator.

This package never calls `getNatalChart()` internally — it only accepts
already-computed `GrahaPosition[]` results (see `adapter.ts`).

## Relationship model

Reused **verbatim** from `packages/bhrigu`: `classifyRelationship`,
`getRelationshipStrength`, `DEFAULT_RELATIONSHIP_WEIGHTS`, and the
`BhriguRelationshipType` union (aliased here as `TransitRelationship`).
All of these are publicly exported, stateless, and take no
graph/chain-building state — so this package imports and reuses them
directly rather than duplicating or "mirroring" a second,
potentially-drifting copy. `packages/bhrigu` is imported from, never
modified.

```text
distance = (transitSign - natalSign + 12) % 12

0            -> SAME_SIGN     (strength 1.00)
1 or 11      -> TWO_TWELVE    (strength 0.15)
2 or 10      -> THREE_ELEVEN  (strength 0.25)
3, 5, 7, 9   -> NONE          (strength 0.00)
4 or 8       -> TRINE         (strength 0.75)
6            -> OPPOSITION    (strength 0.50)
```

This package mints its own rule IDs (`TRANSIT_ACTIVATION_TRINE_V1`,
etc.) rather than reusing Bhrigu's own `BHRIGU_REL_*_V1` IDs — the
classification math is shared, but attributing a fact to
`BHRIGU_REL_*` would misrepresent it as a Bhrigu-natal-chain-graph fact
rather than a Transit Activation fact.

**No degree-orb aspects.** V1 remains sign-based, since no canonical
degree-aspect (Western-style orb) or classical Graha Drishti
implementation exists anywhere in this repository to reuse without
ambiguity. `TRANSIT ACTIVATION V1 = sign-level activation` — this is an
explicit, documented scope boundary, not an oversight.

## Direction

Transit activation is **directional**: `transitingPlanet -> natalPlanet`.
Transiting Saturn activating natal Moon is a distinct activation
identity from transiting Moon activating natal Saturn, even when both
share the same relationship *category* (the underlying classification
is geometrically symmetric — see `relationships.ts` — but activation
identity never is, since `transitingPlanet`/`natalPlanet` are always
kept as separate, explicitly-labeled fields, never collapsed into an
unordered pair).

## Canonical planets

All 9 grahas: **Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Rahu,
Ketu.** Unlike `packages/ashtakavarga` (whose own locked classical rule
table excludes the lunar nodes), Transit Activation is a structurally
different model, and the canonical transit source (`getNatalChart`)
already computes Rahu/Ketu positions using the exact same sidereal
convention as the other 7 grahas — there is no technical reason to
exclude them, so V1 includes all 9. Rahu/Ketu are tested explicitly in
both transiting and natal roles, including self-pairs.

## Evaluated pairs

9 transiting × 9 natal = **81 directed pairs**, including self-pairs
(e.g. transiting Saturn → natal Saturn — a real "return"-type event,
never skipped). The public engine evaluates all 81 and returns **only
the non-NONE activations** — see "Filtering" below.

## Strength

A relationship's strength means *how strongly this transit geometry
activates the natal placement* — **not** how favorable or unfavorable
it is. `OPPOSITION = 0.50` does not mean 50% favorable. V1 omits
polarity entirely; no `favorable`/`unfavorable`/`good`/`bad` label
exists anywhere in this package's output or source.

## Filtering

`calculateTransitActivation` evaluates the full 81-pair matrix
internally (`evaluateAllPairs`, independently testable for exact count)
but its own public `activations` field returns only the pairs whose
relationship is not `NONE`. A `TRANSIT_ACTIVATION_SUMMARY_V1` evidence
entry records the full evaluated-planet-set/pair-count/activation-count
even though the raw NONE pairs themselves are not individually returned.

## Payload size discipline

Activation records are compact: `transitingPlanet`, `natalPlanet`,
`transitSign`, `natalSign`, `relationship`, `strength`, `ruleId`, plus a
small evidence entry — no embedded natal chart, transit chart, Bhrigu
graph, or Ashtakavarga result. A representative real 9×9 evaluation
serializes to **~43KB**, well under `packages/ashtakavarga`'s own
~610KB full-explainability result (a deliberately different tradeoff:
Ashtakavarga optimizes for complete per-contributor auditability across
84 sign-cells; this engine optimizes for a compact activation list).

## Input model

The core engine works entirely from already-normalized sidereal signs
plus an explicit evaluation instant:

```typescript
interface TransitActivationInput {
  natalSigns: Record<GrahaName, ZodiacSign>;   // all 9 planets required
  transitSigns: Record<GrahaName, ZodiacSign>; // all 9 planets required
  evaluationTime: string; // ISO-8601 UTC, caller-supplied, never inferred
}
```

The core engine never queries a database, reads a user profile, calls
`Date.now()`, or infers "now" — `evaluationTime` is validated for shape
only, then echoed straight through into the result and evidence.

## Public API

```typescript
calculateTransitActivation(input: TransitActivationInput): TransitActivationResult
calculateTransitActivationFromPositions(natalPositions, transitPositions, evaluationTimeUTC: Date): TransitActivationResult
toTransitActivationContext(result: TransitActivationResult): TransitActivationContext
```

`calculateTransitActivationFromPositions` extracts each of the 9
required planets' own `rashiIndex` from real `GrahaPosition[]` arrays
(rejecting a missing or duplicated planet in either chart,
array-order-independent) and delegates to the pure engine.

## Personal Intelligence adapter — restored (V1: deferred, V2: lossless)

At PR #100 merge time, `packages/personal-intelligence`'s own
`TransitActivation` contract was keyed by one `transitingPlanet: string`
per entry, with `natalTargets: PersonalEvidenceRef[]` and a single
`strength: number` scalar — no typed field for the activated natal
planet's own identity or the relationship category. Mapping this
engine's own pair-level output into that shape was necessarily lossy
(e.g. a transiting Saturn activating three natal placements collapsed
into one contract record, with an invented `Math.max` aggregate
strength discarding the other two activations' own strengths). PR #100
therefore deliberately deferred `toTransitActivationContext` rather than
ship a lossy adapter or modify the protected `packages/personal-intelligence`
package outside its own scope.

PR #101's own architecture audit evolved the Personal Intelligence
contract to `PERSONAL_INTELLIGENCE_CONTRACT_V2`
(`packages/personal-intelligence/src/provenance.ts`): `TransitActivation`
is now a **pair-level** record —
`{ transitingPlanet, natalPlanet, relationship, strength, evidence }`,
one record per directed pair, never grouped, never aggregated. This
package's own natural output grain already IS one record per directed
pair, so `toTransitActivationContext` is now a purely mechanical 1:1
mapping:

```text
result.activations.length === context.activations.length
```

always holds. Every pair's `transitingPlanet`/`natalPlanet`/`relationship`/
`strength` survive as first-class typed fields — no downstream consumer
ever needs to parse `evidence.data` to recover activation identity. No
`Math.max`/sum/average, no grouping, and no theme projection (theme
projection is Life Weather's own job, `packages/life-weather` — this
adapter never imports `packages/personal-themes` or projects any
`PersonalTheme`).

`PersonalTransitRelationship` (the contract's own relationship type) is
a **contract-local** 5-value union (`SAME_SIGN`/`TRINE`/`OPPOSITION`/
`THREE_ELEVEN`/`TWO_TWELVE`, deliberately excluding `NONE`) — Personal
Intelligence still imports nothing from this package or from
`packages/bhrigu` (see that package's own "zero cross-package imports"
architecture). Alignment between this engine's own `TransitRelationship`
values and `PersonalTransitRelationship` is documented convention, never
a type import; `toPersonalTransitRelationship` in `adapter.ts` maps
between them at the one point they meet.

## No aggregation policy invented

This package performs **no aggregation of any kind** — not sum, not
max. Each of the up-to-81 evaluated pairs is returned as its own
independent, directed activation record, and `toTransitActivationContext`
preserves that independence exactly (see above). Any cross-record
synthesis (e.g. "which of my current transits, combined with my current
Dasha, most reinforces LEARNING") belongs to Life Weather
(`packages/life-weather`), which reads the lossless per-pair facts this
package produces and applies its own, separately-documented synthesis
model on top of them.

## No Ashtakavarga / Dasha / Bhrigu-graph dependency

This package does not import, consume, or reference `packages/ashtakavarga`
(BAV/SAV/bindu), `packages/vimshottari` (Mahadasha/Antardasha), or
Bhrigu's own natal-chain-graph functions (`buildBhriguNatalGraph`,
`deriveChains`). It reuses only Bhrigu's stateless sign-relationship
classification/weights — never natal graph state.

## Determinism

No `Date.now()`, `Math.random()`, network, or DB anywhere in the
source. `evaluationTime` is always caller-supplied. Host-process
timezone never affects output (verified via `Date.UTC` vs. explicit
`+00:00` ISO string equivalence).

## Non-goals

Life Weather, Daily Personal Fit, activity scoring, Muhurta ranking,
Ashtakavarga transit interpretation, Kakshya, Dasha+transit synthesis,
Bhrigu predictive chains, good/bad day labels, recommendations, "Top 3"
guidance, UI, database/schema/API/server actions, LLM interpretation.

## Limitations

Sign-level only — no degree orb, retrograde state, planetary speed,
house system, or classical Graha Drishti (none of these exist
canonically elsewhere in this repository to reuse without inventing a
new, potentially-conflicting model). Theme projection into
`PersonalTheme` is deferred. Strength is a geometry-activation measure,
not an outcome-favorability score.

## Disclaimer

This is a deterministic implementation of a traditional astrological
geometry-detection model and is not scientifically established
predictive analysis.
