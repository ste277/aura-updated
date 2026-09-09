# Personal Intelligence Contract (V1)

One shared contract for Aura's future personalization engines.

## Purpose

Aura is evolving from:

```text
Astronomy -> Panchang -> Muhurta -> Activity -> Recommendation
```

toward:

```text
Birth Chart -> Natal Themes -> Life Period -> Transit Activation -> Personal Support
                                                                          +
                                                              Panchang -> Muhurta
                                                                          |
                                                              Personal Activity Fit
                                                                          |
                                                                 Window Ranking
                                                                          |
                                                                 Daily Guidance
```

Before more engines are built (Bhrigu-derived themes, Vimshottari Dasha,
transit activation, Ashtakavarga, and the future activity-fit/daily-
guidance composer), they need a **stable shared vocabulary** so they
don't each invent an incompatible result shape. This package is that
vocabulary — nothing else.

```text
Bhrigu Natal
Personal Themes
Vimshottari Dasha
Transit Activation
Ashtakavarga
Panchang
Muhurta
      |
      v
PersonalGuidanceContext
      |
      v
future PersonalActivityFit
      |
      v
future DailyPersonalGuidance
```

## Important distinction

- **Contracts do not perform astrology calculations.**
- **Contracts do not rank activities.**
- **Contracts do not create predictions.**

The contract layer describes **what personalization evidence means
structurally**. It does not decide **what is good for the user**. There
is no scoring engine, prediction engine, recommendation engine, or UI
composition anywhere in this package — see "Explicitly out of scope"
below. This is deliberately boring infrastructure.

## Evidence-first principle

Every future result should remain traceable to engine evidence. That's
what [`PersonalEvidenceRef`](src/evidence.ts) exists for: a generic
envelope any engine's native evidence can be adapted into, carrying
`source` (which engine family), `ruleId`/`ruleVersion` (provenance), an
optional `summary`, and an optional bounded `data` bag — never
predictive/horoscope prose as the source of truth.

## Partial-context principle

Aura may operate with incomplete personalization context — that is
**intentional, not an invalid state**. Every section of
[`PersonalGuidanceContext`](src/context.ts) is optional:

```text
Birth profile unavailable:
  Panchang + Muhurta may still work.

Birth profile available but Dasha unavailable:
  Natal Themes + Panchang + Muhurta may still work.
```

`isPersonalGuidanceContext` (validation.ts) reflects this: a value with
only `{ version }` is just as valid as one with every section populated.

## Package contents

| File | Contents |
|---|---|
| [`types.ts`](src/types.ts) | `NormalizedScore`, `ActivityIdentifier`, `PersonalTheme`, `PersonalThemeSignal`, `PersonalReason` (+ canonical starter codes) |
| [`themes.ts`](src/themes.ts) | `PERSONAL_THEMES` — the canonical, ordered theme list |
| [`evidence.ts`](src/evidence.ts) | `PersonalEvidenceSource`, `PersonalEvidenceRef`, `PersonalEvidence<TFacts>`, `toPersonalEvidenceRef` |
| [`context.ts`](src/context.ts) | `LifePeriodContext`, `TransitActivationContext`, `PersonalSupportContext`, `PersonalPanchangContext`, `PersonalMuhurtaTimingContext`, `PersonalNatalContext`, `PersonalThemeContext`, `PersonalGuidanceContext` |
| [`guidance.ts`](src/guidance.ts) | `PersonalActivityFit`, `PersonalRecommendation`, `DailyPersonalGuidance` (future output shapes only) |
| [`validation.ts`](src/validation.ts) | `isNormalizedScore`, `assertNormalizedScore`, `isPersonalTheme`, `isPersonalGuidanceContext` |
| [`provenance.ts`](src/provenance.ts) | `CONTRACT_VERSION` |

## Personal theme taxonomy

```typescript
type PersonalTheme =
  | 'FOCUS' | 'LEARNING' | 'CAREER' | 'FINANCE' | 'RELATIONSHIPS'
  | 'CREATIVITY' | 'SOCIAL' | 'WELLBEING' | 'EXPLORATION' | 'SPIRITUALITY';
```

A `PersonalTheme` is the user's **longer-term tendency/domain** — distinct
from an **Activity**, a concrete thing the user may do. It is also
distinct from two existing, different classifications already in this
repo:

- `ActivityCategory` (`packages/recommendation/src/personalizedTasks.ts`,
  15 values) classifies an *activity*, not a person's tendency.
- `MuhurtaFamily` (`packages/muhurta/src/activityOntology.ts`, 10 values)
  classifies a *Muhurta evaluation's own domain*, not a personal theme.

Neither was reused, because neither means the same thing as
`PersonalTheme` — reusing them would have quietly conflated three
different concepts under one name.

## Normalized score convention

Every score in this contract (`PersonalThemeSignal.strength`,
`TransitActivation.strength`, `PersonalActivityFit.score`,
`PersonalRecommendation.score`) is a **`NormalizedScore`: a finite number
in `[0, 1]`** — matching `packages/bhrigu`'s own existing 0–1
relationship-strength scale.

This is **not** the same scale as `packages/recommendation`'s existing
0–100 `AuraFitEvaluation.score`/`ActionCard.fitScore`. A future engine
that bridges the two must divide by 100 explicitly — this package never
mixes the two scales silently, and `isNormalizedScore`/
`assertNormalizedScore` will reject an unconverted 0–100 value (e.g. `85`)
just as they reject `NaN`/`Infinity`/out-of-range values.

## Unified evidence model

```typescript
interface PersonalEvidenceRef {
  source: PersonalEvidenceSource; // 'BHRIGU_NATAL' | 'PERSONAL_THEMES' | 'VIMSHOTTARI_DASHA' | 'TRANSIT_ACTIVATION' | 'ASHTAKAVARGA' | 'PANCHANG' | 'MUHURTA'
  ruleId: string;
  ruleVersion: string;
  summary?: string;
  data?: Readonly<Record<string, PersonalEvidenceDataValue>>;
}
```

`packages/bhrigu` already has its own `BhriguEvidence` shape
(`category`/`planets`/`facts`, specific to sign relationships). This
package deliberately does **not** force every future engine to reuse that
exact shape — Vimshottari Dasha, transit, Ashtakavarga, Panchang, and
Muhurta evidence don't have "planets" in Bhrigu's sense. Instead,
`PersonalEvidenceRef` is a generic envelope any engine's evidence can be
adapted into. A future adapter can build one from a real `BhriguEvidence`
by copying `ruleId`/`ruleVersion` verbatim and summarizing the rest — see
`test/personalIntelligenceContract.test.ts`'s own compatibility check,
which proves this is possible **without importing or modifying
`packages/bhrigu`** from this package.

`PersonalEvidence<TFacts>` is a stricter, typed-facts variant for a
future engine that wants compile-time-checked facts; `toPersonalEvidenceRef`
adapts one into the generic `PersonalEvidenceRef` shape every other
contract in this package actually consumes.

## Contracts by layer

Each of these describes a **future** engine's eventual output shape —
none of the calculations exist in this package.

- **`PersonalNatalContext`** — a lightweight reference to natal
  intelligence (`engine: 'BHRIGU_NATAL'`, `engineVersion`, `evidence`),
  never a copy of Bhrigu's own graph. `themes` is optional and left
  unpopulated by this PR — deriving product themes from Bhrigu evidence
  is the future Personal Themes engine's job, not something this PR
  fabricates early.
- **`LifePeriodContext`** — future Vimshottari Dasha output
  (`majorPeriod`/`subPeriod` segments, `MAHADASHA`/`ANTARDASHA` levels).
  No date math; `startAt`/`endAt` are ISO-8601 strings.
- **`TransitActivationContext`** — future current-transit activation.
  `transitingPlanet` stays a plain `string` (not importing
  `packages/vedic`'s `GrahaName`) to keep this package's dependency count
  at zero; a `GrahaName` value is assignable to it since it's itself a
  string-literal union.
- **`PersonalSupportContext`** — future Ashtakavarga-derived support,
  named generically (`system: string`, not hardcoded Ashtakavarga
  concepts like bindus/rekhas as universal product concepts).
- **`PersonalPanchangContext`** / **`PersonalMuhurtaTimingContext`** —
  narrow, personalization-facing *views*, never a second copy of
  `packages/panchang`'s `PanchangDay` or `packages/muhurta`'s
  `MuhurtaEvaluation`. Time boundaries use ISO-8601 strings, matching
  `PanchangWindowSpan.start`/`end`'s own convention — never a raw `Date`
  or the lower-level minute-of-day representation `packages/panchang`
  uses internally.

  > **Naming note:** `packages/recommendation/src/auraFitEngine.ts`
  > already exports a *different* type named `PersonalMuhurtaContext`
  > (natal Nakshatra/Rashi/Moon-element inputs fed into Muhurta scoring —
  > not a personalization-facing view of Muhurta timing windows). This
  > package's own type is deliberately named `PersonalMuhurtaTimingContext`,
  > not `PersonalMuhurtaContext`, specifically to avoid that collision —
  > the two concepts are unrelated, live in different packages, and this
  > package has zero dependency on `packages/recommendation`. Do not
  > rename this back to `PersonalMuhurtaContext`, and do not rename
  > `packages/recommendation`'s own type — that package is out of scope
  > for this PR.

## `PersonalGuidanceContext`

The one contract every future personalization consumer reads from. Every
section is optional (see "Partial-context principle" above):

```typescript
interface PersonalGuidanceContext {
  version: string; // CONTRACT_VERSION
  natal?: PersonalNatalContext;
  themes?: PersonalThemeContext;
  lifePeriod?: LifePeriodContext;
  transits?: TransitActivationContext;
  personalSupport?: PersonalSupportContext;
  panchang?: PersonalPanchangContext;
  muhurta?: PersonalMuhurtaTimingContext;
}
```

## Future output shapes (`guidance.ts`)

```typescript
interface PersonalActivityFit {
  activity: ActivityIdentifier; // plain string, matches ActivityProfile.id
  score: NormalizedScore;       // [0, 1]
  reasons: PersonalReason[];
  cautions: PersonalReason[];
  evidence: PersonalEvidenceRef[];
}

interface DailyPersonalGuidance {
  version: string;
  date: string;
  timezone: string;
  headline: string;
  summary: string;
  dominantThemes: PersonalThemeSignal[];
  recommendations: PersonalRecommendation[];
  evidence: PersonalEvidenceRef[];
}
```

Neither is produced by this PR. No composer, no template generation, no
LLM call exists here.

## Reason/explainability model

```typescript
interface PersonalReason {
  code: string;   // deterministic future template key
  message: string;
  evidence: PersonalEvidenceRef[];
}
```

`code` stays a plain `string`, not a closed union — a future engine can
introduce a new code without a release of this package. A small
canonical starter set exists as `PERSONAL_REASON_CODES` (not a required
set): `NATAL_THEME_SUPPORT`, `LIFE_PERIOD_ALIGNMENT`,
`TRANSIT_ACTIVATION`, `PANCHANG_SUPPORT`, `MUHURTA_WINDOW_SUPPORT`,
`RAHU_CONFLICT`.

## Provenance and versioning

```typescript
export const CONTRACT_VERSION = 'PERSONAL_INTELLIGENCE_CONTRACT_V2';
```

Two distinct version concepts, kept explicit and never conflated:

```text
contractVersion = PERSONAL_INTELLIGENCE_CONTRACT_V2   (this package's own shape version)
source engineVersion = BHRIGU_NATAL_V1                (that engine's own version, carried verbatim)
```

### V1 -> V2 (Life Weather V1 / PR #101)

- `TransitActivation` changed from a lossy, grouped-by-transiting-planet
  shape (`activatedThemes`/`natalTargets`/an invented `Math.max` aggregate
  `strength`) to a lossless, pair-level shape (`transitingPlanet`,
  `natalPlanet`, `relationship`, `strength` all first-class -- one record
  per directed pair). Zero production consumers existed at the time of
  this change (the V1 shape's only intended producer,
  `toTransitActivationContext`, was deliberately never built against it --
  see `packages/transit-activation/README.md`'s own PR #100 history), so
  this is a historical shape change, not a breaking change to any real
  caller.
- Added `PersonalTransitRelationship` (contract-local, 5 values, `'NONE'`
  deliberately excluded).
- Added `LifeWeatherContext` and `PersonalGuidanceContext.lifeWeather`
  (additive).
- Added `'LIFE_WEATHER'` to `PersonalEvidenceSource` (additive).

## Immutability / serializability

Every contract shape here is safe for engine boundaries, server/client
transfer, future persistence, tests, and debugging: only serializable
primitives (`string`, `number`, `boolean`, `null`, arrays, and plain
object literals). This package contains **no** functions inside a
contract shape, **no** class instances, **no** `Map`/`Set`, **no**
`Date` (ISO strings throughout, matching this repo's own established
convention at package boundaries — see `PanchangWindowSpan`), and no
cyclic references. `PersonalEvidenceDataValue` is the bounded recursive
JSON-value type `PersonalEvidenceRef.data`/`PersonalEvidence.facts` are
restricted to, so every evidence payload round-trips through
`JSON.stringify`/`JSON.parse` unchanged.

## Dependency direction

```text
packages/personal-intelligence
        ^
future adapters / engines
```

This package has **zero cross-package imports** — not from
`packages/bhrigu`, `packages/vedic`, `packages/panchang`,
`packages/muhurta`, `packages/recommendation`, or `apps/web`. Every field
that could plausibly reuse an existing type instead stays a plain,
self-contained primitive (`string`, `number`) with a doc comment
explaining what existing values it's expected to align with — reuse by
*documented convention*, never by *type import*, specifically so this
package never risks:

- depending on `apps/web` (a contract layer has no business depending on
  UI code), or
- a circular import (`packages/bhrigu` importing this package while this
  package imports `packages/bhrigu`).

`packages/bhrigu` was **not modified** by this PR and does not depend on
this package — it remains independently usable exactly as it already
was.

## Explicitly out of scope

This PR does **not** implement:

- Personal Themes scoring, or a Bhrigu -> theme mapping
- Vimshottari Dasha or Antardasha calculations
- Transit calculations
- Ashtakavarga calculations
- Panchang or Muhurta calculations
- Recommendation scoring, conflict resolution, or window ranking
- A Daily Guidance composer
- Home UI, Ask Aura, or Life Weather changes
- Database models, migrations, API endpoints, or server actions
- Any LLM integration
- Persisted personalization

This PR is intentionally boring infrastructure.

## Example

```typescript
import type { PersonalGuidanceContext } from './src/index';
import { CONTRACT_VERSION } from './src/index';

// A partial context -- natal intelligence only, everything else not yet
// available. This is a fully valid PersonalGuidanceContext today, not a
// placeholder for a "complete" one.
const context: PersonalGuidanceContext = {
  version: CONTRACT_VERSION,
  natal: {
    engine: 'BHRIGU_NATAL',
    engineVersion: 'BHRIGU_NATAL_V1',
    evidence: [
      {
        source: 'BHRIGU_NATAL',
        ruleId: 'BHRIGU_REL_TRINE_V1',
        ruleVersion: '1.0.0',
        summary: 'Mercury and Jupiter are in a trinal sign relationship.',
        data: { relationship: 'TRINE', strength: 0.75 },
      },
    ],
  },
};
```

## Tests

`test/personalIntelligenceContract.test.ts` (repo root `test/` directory,
matching this repository's existing convention). Run with:

```bash
npx ts-node test/personalIntelligenceContract.test.ts
```
