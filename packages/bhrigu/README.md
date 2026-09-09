# Bhrigu Natal Foundation (V1)

A deterministic, **Bhrigu/Nadi-inspired** natal interpretation engine. This
package is the first layer of Aura's future personalization pipeline:

```text
Birth Chart
  -> Bhrigu Natal Graph          <-- this package (V1)
  -> Life Period                 <-- not implemented
  -> Current Activation          <-- not implemented
  -> Personal Support            <-- not implemented
  -> Panchang / Muhurta          <-- existing, separate packages
  -> Activity Fit                <-- existing, separate packages
  -> Window Ranking               <-- existing, separate packages
  -> Daily Guidance              <-- not implemented
```

It answers one question:

> **What stable natal themes and planetary relationships can Aura derive
> from a birth chart?**

It does **not** answer "what should the user do today?" — that belongs to
later layers built on top of this one, if they are built at all.

## What this is not

This is **not** a user-facing "Bhrigu Samhita" feature, and it does not
claim to reproduce a verified historical manuscript lookup. It is a
deterministic software implementation of a family of traditional
interpretive rules (sign-based planetary relationships and
significations), used here purely as structured, versioned **product
personalization input**. Nothing in this package is scientifically
verified or asserted as fact — the theme lists and relationship weights
are versioned interpretive/product-model metadata, not measurements.

## Scope (V1)

Implemented:

- Natal chart normalization and validation (`normalize.ts`)
- Traditional planet karakas/significations, versioned (`karakas.ts`)
- Deterministic sign-distance relationship detection (`relationships.ts`)
- Configurable relationship-strength weights (`constants.ts`)
- A full planetary relationship graph — 9 nodes, 36 edges (`graph.ts`)
- Connected planetary chains (`chains.ts`)
- Structured, replayable evidence for every derived fact (`evidence.ts`)
- Rule provenance/versioning (`provenance.ts`)

Explicitly **out of scope for V1** (not implemented anywhere in this
package):

- Transit calculations, or any "current activation" of a natal placement
- Vimshottari Dasha, Ashtakavarga, Bhrigu Bindu, Navamsha
- House-specific predictions, Ascendant/Lagna computation
- Marriage/career/health/event prediction, life-event dates
- Daily guidance, recommendation ranking, Activity Fit changes
- Panchang or Muhurta integration
- Any Home/Timeline UI, new public astrology screens
- Database persistence, API endpoints, AI/LLM interpretation

This package produces **evidence, not conclusions**. For example:

> Correct (V1 scope): "Mercury and Jupiter are in a trinal sign
> relationship. Relationship strength = 0.75. Mercury's karakas include
> communication/learning. Jupiter's karakas include growth/knowledge."

> Not correct (later layers, if ever built): "You will become a
> successful teacher." / "You should change careers this year."

## Input assumptions

This package **consumes** an already-computed natal chart; it never
calculates birth astronomy itself (no ephemeris, no date/timezone
handling of any kind — longitude in, structured graph out).

The one real ephemeris implementation in this repository is
[`packages/vedic/src/natalChart.ts`](../vedic/src/natalChart.ts)'s
`getNatalChart()`, which returns `GrahaPosition[]` — sidereal (Lahiri
ayanamsa) longitudes for the 9 classical grahas, including Rahu and Ketu
as two ordinary entries (not a combined "lunar nodes" concept). This
package reuses that representation directly:

- `PlanetId` is a type alias for that file's own `GrahaName` — not a
  second, incompatible planet union.
- `fromGrahaPositions()` (`normalize.ts`) adapts a `GrahaPosition[]`
  straight into this package's own input shape, with no recomputation.
- The zodiac sign convention (`ZodiacSign` = a `0-11` numeric index) is
  the same convention `GrahaPosition.rashiIndex` already uses.

If you don't already have a `GrahaPosition[]`, build one with the minimal
shape `{ planet: PlanetId; longitude: number }[]` — `normalizeNatalChart`
(or `buildBhriguNatalGraph`, which calls it internally) derives sign and
degree-within-sign deterministically from `longitude`.

Validation (`normalize.ts`) explicitly rejects:

- a non-finite longitude (`NaN`, `Infinity`, `-Infinity`) for any planet
- a missing planet (all 9 supported planets are required)
- a duplicate planet entry
- a caller-supplied `sign`/`degreeInSign` that contradicts what
  `longitude` itself derives (a genuinely contradictory chart)

...and normalizes (never rejects) any finite longitude outside `[0, 360)`,
including negative values and values `>= 360`.

## Relationship definitions

Relationships are detected purely from **relative sign (rashi) position**
— never from house/Ascendant, and never from fragile string comparisons.

For two planets A and B, the directional sign distance A → B is:

```typescript
signDistance(from, to) = ((to - from) % 12 + 12) % 12
```

an integer `0-11` — "how many signs forward from A's sign you must count
to reach B's sign," wrapping through the Pisces/Aries boundary. This
distance is **not** symmetric on its own (distance A→B and B→A generally
differ). Classification restores symmetry by construction: every bucket
below groups a distance together with its complement (`12 - d`), so
`classifyRelationship(A, B)` always equals `classifyRelationship(B, A)`
even though the two raw directional distances differ.

| Distance A→B  | Relationship    | Traditional meaning |
|----------------|-----------------|----------------------|
| 0              | `SAME_SIGN`     | Conjunction — shared sign |
| 1 or 11        | `TWO_TWELVE`    | 2nd/12th from each other |
| 2 or 10        | `THREE_ELEVEN`  | 3rd/11th from each other |
| 4 or 8         | `TRINE`         | 5th/9th from each other |
| 6              | `OPPOSITION`    | 7th from each other |
| 3, 5, 7, or 9   | `NONE`          | No V1-recognized relationship |

Evidence for a real (non-`NONE`) relationship carries **both** directional
distances (`signDistanceAtoB`, `signDistanceBtoA`) alongside the single
symmetric `relationship` classification, so the exact geometry that
produced it is always reconstructable.

## Default strength configuration

Relationship strength is **product-model configuration**, not scientific
or scriptural truth — deliberately not buried inside the relationship
logic itself:

```typescript
export const DEFAULT_RELATIONSHIP_WEIGHTS: BhriguRelationshipWeights = {
  sameSign: 1.00,
  trine: 0.75,
  opposition: 0.50,
  threeEleven: 0.25,
  twoTwelve: 0.15,
  none: 0.00,
};
```

A caller may override any subset via `buildBhriguNatalGraph(chart, {
weights })`. Weights are validated (`validateRelationshipWeights`) to
reject non-finite values; out-of-range values are otherwise accepted
as-is (this function does not second-guess a caller's chosen product
numbers, only genuinely unusable ones).

## Chains

A **chain** is a connected component of the graph restricted to
non-`NONE` edges — planets connected transitively (A–B–C) count as one
chain even if A and C aren't directly related. Every one of the 9
supported planets appears in exactly one chain; a planet with no real
relationship to anything else forms its own single-node chain (score 0)
rather than being omitted, so `chains` always partitions the full planet
set.

**Chain score = mean strength of the chain's own internal, non-`NONE`
edges only** (not sum, and never diluted by the `NONE` pairs a
transitive chain implies). For a chain A–B–C where A–B and B–C are real
relationships but A–C is not directly related:

```text
score = (strength(A,B) + strength(B,C)) / 2
```

not `(strength(A,B) + strength(B,C) + 0.00) / 3` — the `NONE` A–C pair
is excluded from both the sum and the count, not averaged in as a zero.
This is a deliberate, documented choice so a chain's score reads as "how
strongly connected the real relationships in this chain are, on average,"
rather than being pulled toward zero by however many non-relationships a
chain's size incidentally implies.

## Provenance and versioning

Every major output carries `engineVersion: 'BHRIGU_NATAL_V1'`. Individual
rules carry their own stable ids so a future revision can be introduced
alongside V1 rather than silently changing it:

```text
BHRIGU_KARAKA_SUN_V1
BHRIGU_KARAKA_MOON_V1
... (one per planet)
BHRIGU_REL_SAME_SIGN_V1
BHRIGU_REL_TRINE_V1
BHRIGU_REL_OPPOSITION_V1
BHRIGU_REL_THREE_ELEVEN_V1
BHRIGU_REL_TWO_TWELVE_V1
BHRIGU_REL_NONE_V1
BHRIGU_CHAIN_CONNECTED_COMPONENT_V1
```

## Deterministic guarantees

Given identical input and config, `buildBhriguNatalGraph` always produces
a **structurally, deeply-equal** result:

- Node/edge/chain/evidence ordering is derived entirely from a fixed
  canonical planet order (`SUPPORTED_PLANETS`), never from the caller's
  own input array order or any `Map`/`Set`/object iteration order.
- No random ids, no current time, no locale-dependent sorting.
- No network calls, no database calls, no I/O of any kind.

## Example

```typescript
import { buildBhriguNatalGraph } from './packages/bhrigu/src/index';

const chart = [
  { planet: 'Sun', longitude: 12.5 },
  { planet: 'Moon', longitude: 200.5 },
  { planet: 'Mercury', longitude: 40.0 },
  { planet: 'Venus', longitude: 80.0 },
  { planet: 'Mars', longitude: 130.0 },
  { planet: 'Jupiter', longitude: 250.0 },
  { planet: 'Saturn', longitude: 300.0 },
  { planet: 'Rahu', longitude: 5.0 },
  { planet: 'Ketu', longitude: 185.0 },
];

const result = buildBhriguNatalGraph(chart);
```

Sample structural output shape (values illustrative, not a real chart's
actual result):

```json
{
  "engineVersion": "BHRIGU_NATAL_V1",
  "nodes": [
    { "planet": "Sun", "sign": 0, "longitude": 12.5, "karakas": ["identity", "authority", "leadership", "vitality"] }
  ],
  "edges": [
    {
      "from": "Sun",
      "to": "Jupiter",
      "relationship": "TRINE",
      "strength": 0.75,
      "sourceRuleId": "BHRIGU_REL_TRINE_V1",
      "evidence": [
        {
          "ruleId": "BHRIGU_REL_TRINE_V1",
          "ruleVersion": "1.0.0",
          "category": "RELATIONSHIP",
          "planets": ["Sun", "Jupiter"],
          "facts": { "signA": 0, "signB": 8, "signDistanceAtoB": 8, "signDistanceBtoA": 4, "relationship": "TRINE", "strength": 0.75 }
        }
      ]
    }
  ],
  "chains": [
    { "planets": ["Sun", "Jupiter"], "score": 0.75 }
  ],
  "evidence": [ /* one KARAKA entry per planet, one RELATIONSHIP entry per non-NONE edge, one CHAIN entry per multi-planet chain */ ]
}
```

If already using this repo's own natal chart calculator:

```typescript
import { getNatalChart } from '../vedic/src/natalChart';
import { buildBhriguNatalGraph, fromGrahaPositions } from './src/index';

const positions = getNatalChart(birthMomentUTC);
const result = buildBhriguNatalGraph(fromGrahaPositions(positions));
```

## Tests

`test/bhriguNatalFoundation.test.ts` (repo root `test/` directory,
matching this repository's existing convention — see
`test/ephemeris.test.ts` for the same `check()`/`console.log` pattern).
Run with:

```bash
npx ts-node test/bhriguNatalFoundation.test.ts
```
