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
  (from PR #95) — `{ transitingPlanet: string; activatedThemes:
  PersonalThemeSignal[]; natalTargets: PersonalEvidenceRef[]; strength:
  number; evidence: PersonalEvidenceRef[] }`. See "Personal Intelligence
  adapter" below for why this package does **not** attempt to produce
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
```

`calculateTransitActivationFromPositions` extracts each of the 9
required planets' own `rashiIndex` from real `GrahaPosition[]` arrays
(rejecting a missing or duplicated planet in either chart,
array-order-independent) and delegates to the pure engine.

## Personal Intelligence adapter — deferred

**Personal Intelligence adapter deferred because
`TRANSIT_ACTIVATION_CONTEXT_V1` cannot losslessly represent directed
transit→natal activation identity.**

The existing `TransitActivation` contract in
`packages/personal-intelligence/src/context.ts` is keyed by one
`transitingPlanet: string` per entry, with `natalTargets:
PersonalEvidenceRef[]` and a single `strength: number` scalar. It has
**no typed field** for the activated natal planet's own identity and
**no typed field** for the relationship category — both would have to
be smuggled into an untyped `PersonalEvidenceRef.data` bag. That is
evidence metadata, not a typed domain field a downstream engine (Life
Weather, PR #101) could safely rely on without parsing arbitrary
evidence content to recover essential domain identity.

Concretely: a transiting Saturn activating three natal placements
(natal Moon `SAME_SIGN` 1.00, natal Venus `TRINE` 0.75, natal Mercury
`OPPOSITION` 0.50) is **3 engine records**. Mapped into the existing
contract shape, that collapses into **1 contract record** — one
`TransitActivation` keyed by `transitingPlanet: "Saturn"` — since the
contract has only one `strength` scalar per transiting planet.
`natalPlanet` and `relationship` survive only inside each
`PersonalEvidenceRef.data`, never as first-class fields, and any single
scalar strength would have to pick a policy (e.g. maximum) to collapse
1.00 / 0.75 / 0.50 into one number — discarding the other two
activations' own strengths entirely. That aggregation policy is not
specified anywhere in the existing contract; it would be invented here,
baking a Transit-Activation-specific product decision into what must
stay a pure geometry-detection engine.

This package therefore does **not** modify `packages/personal-intelligence`
and does **not** ship a `toTransitActivationContext` adapter in V1. It
exposes only `calculateTransitActivation(...)` and
`calculateTransitActivationFromPositions(...)` until the contract is
intentionally evolved (a deliberate, future decision — likely alongside
Life Weather, PR #101 — not smuggled into this PR to fit an insufficient
forward-looking shape).

`activatedThemes` would in any case always be `[]`: `packages/bhrigu`'s
own publicly exported karaka/theme mapping (`getKarakaThemes`) uses a
different, lowercase, free-text vocabulary (`'identity'`, `'authority'`,
...) that does not correspond to `packages/personal-intelligence`'s own
closed `PersonalTheme` union (`'FOCUS'`, `'CAREER'`, ...) — translating
between the two would require inventing a new planet-to-theme mapping,
which this PR's own scope explicitly prohibits. Theme projection is
deferred to a later composition PR, matching `packages/ashtakavarga`'s
own precedent for the identical reason.

## No aggregation policy invented

This package performs **no aggregation of any kind** — not sum, not
max. Each of the up-to-81 evaluated pairs is returned as its own
independent, directed activation record. Any cross-record aggregation
(e.g. "the strongest activation currently affecting natal Venus")
belongs to a later consumer (Life Weather) that can make that policy
decision explicitly, once the contract it writes into can represent the
inputs losslessly.

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
