# Personal Themes Engine (V1)

Transforms Bhrigu Natal V1 evidence into Aura's stable Personal Theme
taxonomy. This is the first real consumer of both
[`packages/bhrigu`](../bhrigu) and
[`packages/personal-intelligence`](../personal-intelligence).

```text
Existing GrahaPosition[]
      |
      v
BHRIGU_NATAL_V1
      |
      v
BhriguNatalResult
      |
      v
PERSONAL_THEMES_V1        <-- this package
      |
      v
PersonalThemeContext
      |
      v
PersonalThemeSignal[]
```

## Purpose

Aura needs a layer that answers:

> **What kinds of activities and life domains tend to suit this person?**
> Based on natal structure, not current timing.

It produces durable personal tendencies — `FOCUS`, `LEARNING`, `CAREER`,
`FINANCE`, `RELATIONSHIPS`, `CREATIVITY`, `SOCIAL`, `WELLBEING`,
`EXPLORATION`, `SPIRITUALITY` — never **"what should I do today?"**
(Dasha, transits, personal support, Panchang, Muhurta, and a future
ranking layer answer that, none of them implemented here).

Bhrigu Natal remains the astrology evidence source. Personal Themes is
the product interpretation layer built on top of it — it does not
bypass the Bhrigu graph or reimplement natal interpretation separately.

## Inputs / Outputs

- **Input**: an already-built `BhriguNatalResult`
  (`buildBhriguNatalGraph()`, `packages/bhrigu`). This package never
  calls `getNatalChart()`, never accepts a raw birth date/location, and
  performs no astrology calculation of its own.
- **Output**: a `PersonalThemeContext` (`packages/personal-intelligence`)
  — the existing, merged contract shape, used exactly as defined there.

```typescript
import { buildBhriguNatalGraph } from '../bhrigu/src/index';
import { deriveThemeContext } from './src/index';

const bhriguResult = buildBhriguNatalGraph(chart);
const themeContext = deriveThemeContext(bhriguResult);
```

## Scoring

**Every supported natal chart contains the same nine planets. Therefore
planet/karaka presence alone is not treated as personalized numeric
strength.** Karaka mappings establish theme *eligibility* and
*provenance*, while chart-specific Bhrigu relationships and planetary
chains determine personalized theme *reinforcement*:

```text
karaka mappings
  ->  which planets are ELIGIBLE to support each theme (no numeric score)
        |
        v
relationship reinforcement (chart-specific)
  +
chain reinforcement (chart-specific)
  =  personalizedRawScore
        |
        v
fixed theoretical reinforcement ceiling (derived from eligibility alone)
        |
        v
NormalizedScore [0,1]
```

Every step is a small, named, pure function (`scoring.ts`) — no single
opaque formula.

### 1. Karaka mapping = eligibility, not score (`mappings.ts`)

A hand-authored, versioned table (36 entries: 9 planets × 4 karakas each)
mapping each of Bhrigu's existing `PLANET_KARAKAS` themes to one of
Aura's 10 Personal Themes — copied from the brief's own recommended V1
table, e.g. Mercury's `learning` → `LEARNING`, Saturn's `discipline` and
`delay` → `FOCUS` (two distinct rules with their own evidence, since one
planet can map more than one of its own karakas to the same theme — see
"Distinct supporting planets," below).

Because every Bhrigu node always carries its planet's **complete, fixed**
karaka set (`packages/bhrigu/src/graph.ts` sets `karakas` unconditionally
for every chart), **a chart containing Mercury does not, on its own, ever
create positive `FINANCE` or `SOCIAL` strength** — every chart contains
Mercury, so that fact alone carries zero personalizing information. The
mapping table's only job is to establish *which planets are eligible* to
support each theme, and to carry the mapping/Bhrigu-karaka evidence
(`extractThemeMappings` → `ThemeEligibility[]`) — it contributes **no**
number to `personalizedRawScore`.

### Distinct supporting planets, not mapping-rule count

`n = distinctSupportingPlanetCount(theme)` counts **distinct planets**
eligible for a theme, not mapping rules — Saturn's two FOCUS karakas
(`discipline`, `delay`) count as **one** supporting planet for FOCUS, not
two. Derived purely from the static mapping table (never a chart):

| Theme | Distinct supporting planets (n) |
|---|---|
| CAREER | 5 (Sun, Mars, Jupiter, Saturn, Rahu) |
| FOCUS | 5 (Moon, Mercury, Mars, Saturn, Ketu) |
| WELLBEING | 4 (Sun, Moon, Venus, Saturn) |
| RELATIONSHIPS | 3 (Moon, Venus, Ketu) |
| EXPLORATION | 3 (Mars, Jupiter, Rahu) |
| LEARNING | 2 (Mercury, Jupiter) |
| CREATIVITY | 2 (Venus, Rahu) |
| SPIRITUALITY | 2 (Jupiter, Ketu) |
| SOCIAL | 1 (Mercury) |
| FINANCE | 1 (Mercury) |

### 2. Relationship reinforcement (chart-specific)

**V1 rule: a relationship only reinforces a theme if both connected
planets are actually ELIGIBLE for that same theme.** Bhrigu's own
relationship strength is reused as-is — no second relationship
classification is invented:

```text
SAME_SIGN      1.00  ->  reinforces 0.500
TRINE          0.75  ->  reinforces 0.375
OPPOSITION     0.50  ->  reinforces 0.250
THREE_ELEVEN   0.25  ->  reinforces 0.125
TWO_TWELVE     0.15  ->  reinforces 0.075
NONE                 ->  reinforces 0
```

(`relationshipAmplificationFactor × edge.strength`, factor = `0.5`.)

Example (matches the brief's own worked case):

```text
Mercury eligible for LEARNING, FOCUS, SOCIAL, FINANCE
Jupiter eligible for LEARNING, CAREER, SPIRITUALITY, EXPLORATION
Mercury <-> Jupiter = TRINE

LEARNING is reinforced (both sides eligible).
FINANCE is NOT (Jupiter isn't eligible) -- even though
Mercury and Jupiter ARE related, that relationship never touches FINANCE.
```

`OPPOSITION` reinforces **positively**, matching how Bhrigu V1 itself
models it (strength `0.50`, not inherently negative) — this layer
preserves that interpretation rather than inventing a natal-timing-style
"challenging" penalty. `NONE` reinforces nothing.

### 3. Chain reinforcement (chart-specific)

**V1 rule: reward a theme only when at least 2 distinct planets inside
one connected Bhrigu chain are each independently ELIGIBLE for it.**
Deliberately smaller than, and separate from, the per-edge bonus above
(no double-counting — chain reinforcement never re-adds
`relationshipAmplificationFactor × edge.strength` for any pair):

```text
chainReinforcement =
  (supportingPlanetCount - 1)
  × CHAIN_AMPLIFICATION_PER_ADDITIONAL_PLANET (0.15)
  × chain.score
```

A single-node chain (an isolated planet) is skipped entirely — there is
nothing to reinforce.

```text
personalizedRawScore(theme) = relationshipReinforcement(theme) + chainReinforcement(theme)
```

There is no third "base" term — eligibility alone never contributes a
number (see §1).

### 4. Normalization — reinforcement ceiling derived from eligibility

Output uses `packages/personal-intelligence`'s `NormalizedScore`: `[0,1]`
— never `0–100`. The ceiling is the **theoretical maximum** reinforcement
a theme's own eligible-planet set could ever reach, derived entirely from
`n = distinctSupportingPlanetCount(theme)` and the two amplification
factors — never from any specific user's chart:

```text
maxSharedPairs              = n * (n - 1) / 2
maxRelationshipReinforcement = maxSharedPairs * relationshipAmplificationFactor
maxChainReinforcement        = n >= 2 ? (n - 1) * chainAmplificationPerAdditionalPlanet : 0
maxReinforcement             = maxRelationshipReinforcement + maxChainReinforcement

strength = maxReinforcement === 0 ? 0 : min(1, personalizedRawScore / maxReinforcement)
```

`maxSharedPairs` is "every possible pair among the n eligible planets at
maximum (SAME_SIGN) strength"; `maxChainReinforcement` mirrors the chain
formula's own `(supportingPlanetCount - 1)` term at ITS own maximum (all
n eligible planets in one chain, chain score `1.0`). Both are fixed,
chart-independent constants derived purely from the static mapping table
— **no per-chart min-max normalization, no universal base, no
multiplier.**

**The full V1 default ceiling table** (`relationshipAmplificationFactor =
0.5`, `chainAmplificationPerAdditionalPlanet = 0.15`):

| Theme | n | Max shared pairs | Max relationship | Max chain | Max reinforcement |
|---|---:|---:|---:|---:|---:|
| CAREER | 5 | 10 | 5.00 | 0.60 | **5.60** |
| FOCUS | 5 | 10 | 5.00 | 0.60 | **5.60** |
| WELLBEING | 4 | 6 | 3.00 | 0.45 | **3.45** |
| RELATIONSHIPS | 3 | 3 | 1.50 | 0.30 | **1.80** |
| EXPLORATION | 3 | 3 | 1.50 | 0.30 | **1.80** |
| LEARNING | 2 | 1 | 0.50 | 0.15 | **0.65** |
| CREATIVITY | 2 | 1 | 0.50 | 0.15 | **0.65** |
| SPIRITUALITY | 2 | 1 | 0.50 | 0.15 | **0.65** |
| **SOCIAL** | **1** | 0 | 0 | 0 | **0.00** |
| **FINANCE** | **1** | 0 | 0 | 0 | **0.00** |

`test/personalThemesEngine.test.ts` locks this exact table as a
regression guard, so an accidental mapping/scoring change becomes
immediately visible.

### SOCIAL and FINANCE are currently always neutral — by design, not by omission

Under the current V1 mapping table, `SOCIAL` and `FINANCE` each have only
**one** eligible planet (Mercury, for both). A single eligible planet can
never form a relationship pair or a multi-planet chain with itself, so
their ceiling is exactly `0`, and `strength = 0` / `direction = NEUTRAL`
for **every** chart, unconditionally. This does not mean SOCIAL/FINANCE
are irrelevant to the person — it means V1's mapping table does not yet
give either theme enough eligible planets to express **chart-specific
structural differentiation**. Their mapping and Bhrigu-karaka evidence
remain fully present in `reasons` regardless (see "Explainability",
below) — a zero score is not a zero-evidence theme. Widening either
theme's eligible-planet set is a natural, versioned follow-up (a new
mapping rule, e.g. an additional planet's karaka → SOCIAL), not a change
to the scoring formula itself.

### 5. Direction

V1 has no negative/absent-support model — it **never emits
`CHALLENGING`**:

```text
score >= supportiveThreshold (0.35) -> SUPPORTIVE
otherwise                          -> NEUTRAL
```

Unlike the earlier (superseded) eligibility-inclusive scoring draft, V1
now produces **real variation**: a theme with strong chart-specific
relationship/chain reinforcement (e.g. a real Mercury–Jupiter `TRINE` for
`LEARNING`) can reach `SUPPORTIVE`, while a theme with weak or no
reinforcement (or, for `SOCIAL`/`FINANCE`, structurally zero reinforcement
in V1) stays `NEUTRAL`. `CHALLENGING` becomes meaningful once a later
layer (Dasha/transits/personal support/Panchang/Muhurta) contributes
dynamic, current-timing nuance; `supportiveThreshold` is a versioned
config value specifically so it can be revisited later without a code
change.

### Full-vector output

`deriveThemeContext` always returns **all 10 themes**, in
`packages/personal-intelligence`'s exact `PERSONAL_THEMES` canonical
order — never sorted by score, never a sparse subset. This creates a
stable profile vector; a future UI wanting "strongest first" sorts it
itself. `SOCIAL`/`FINANCE` (currently always `strength: 0`) are included
in this vector exactly like every other theme — see above.

## Explainability

Every eligibility fact and every non-zero reinforcement traces back to
**both**:

1. This engine's own interpretation rule (`source: 'PERSONAL_THEMES'`,
   e.g. `PERSONAL_THEME_MAP_MERCURY_LEARNING_V1`)
2. The underlying Bhrigu-native evidence it was derived from
   (`source: 'BHRIGU_NATAL'`, e.g. `BHRIGU_KARAKA_MERCURY_V1`)

Neither replaces the other — both are preserved (`evidence.ts`). Notice
below that the eligibility evidence (1–4) appears **regardless of
whether reinforcement fires** — it documents *why Mercury/Jupiter are
eligible for LEARNING at all*, which is distinct from *why LEARNING's
number is non-zero* (5–8):

```text
Theme: LEARNING
Raw reinforcement: 0.375 (relationship) + 0.1125 (chain) = 0.4875
Ceiling: 0.65 (n=2 eligible planets: Mercury, Jupiter)
Strength: 0.4875 / 0.65 = 0.75 (SUPPORTIVE)

Reasons:
1. PERSONAL_THEME_MAP_MERCURY_LEARNING_V1 <- Mercury's learning karaka (eligibility, not score)
2. BHRIGU_KARAKA_MERCURY_V1                <- the underlying Bhrigu fact
3. PERSONAL_THEME_MAP_JUPITER_KNOWLEDGE_V1 <- Jupiter's knowledge karaka (eligibility, not score)
4. BHRIGU_KARAKA_JUPITER_V1
5. PERSONAL_THEME_REL_SHARED_LEARNING_V1   <- Mercury-Jupiter TRINE, shared eligible theme (+0.375)
6. BHRIGU_REL_TRINE_V1
7. PERSONAL_THEME_CHAIN_LEARNING_V1        <- 2 chain-connected planets eligible for LEARNING (+0.1125)
8. BHRIGU_CHAIN_CONNECTED_COMPONENT_V1
```

Contrast with `SOCIAL` (Mercury only, n=1): its own eligibility evidence
(`PERSONAL_THEME_MAP_MERCURY_COMMUNICATION_SOCIAL_V1` +
`BHRIGU_KARAKA_MERCURY_V1`) is still present in `reasons` even though its
strength is always `0` — the theme is never evidence-less, only
reinforcement-less.

`PersonalThemeContext.evidence` is the deterministic, deduplicated union
of every signal's own reasons — never unrelated Bhrigu evidence that
never actually contributed. Deduplication (`dedupeEvidenceRefs`) uses
stable identity (`source + ruleId + data`), never `summary` alone.

## Deterministic ordering

- `signals` — always `PERSONAL_THEMES`' fixed canonical order.
- Eligibility/relationship/chain contributions — iterate Bhrigu's own
  already-canonical node/edge/chain order.
- Repeated calls with the same input/config produce deeply-equal output.

## Provenance / versioning

```typescript
PERSONAL_THEMES_ENGINE_VERSION = 'PERSONAL_THEMES_V1'      // this engine
REQUIRED_BHRIGU_ENGINE_VERSION = 'BHRIGU_NATAL_V1'          // consumed, not owned
// packages/personal-intelligence's own CONTRACT_VERSION     // consumed, not owned
```

Stable rule ids: `PERSONAL_THEME_MAP_<PLANET>_<KARAKA>_<THEME>_V1`,
`PERSONAL_THEME_REL_SHARED_<THEME>_V1`, `PERSONAL_THEME_CHAIN_<THEME>_V1`.

## Dependency direction

```text
packages/personal-themes
      +--> packages/bhrigu
      +--> packages/personal-intelligence
```

Unlike `packages/personal-intelligence` itself (which is deliberately
zero-dependency), this engine **is** allowed to — and does — depend on
both packages/bhrigu and packages/personal-intelligence: it is their
first real consumer. Neither `packages/bhrigu` nor
`packages/personal-intelligence` depends on this package — no circular
dependency exists, and neither was modified by this PR. No dependency on
`apps/web` anywhere.

## Explicitly out of scope

This PR does **not** implement Vimshottari Dasha, Antardasha, current
transits, Ashtakavarga, Life Weather, Panchang or Muhurta personalization,
`PersonalActivityFit`, window ranking, conflict resolution, Daily
Guidance, Home/Ask Aura changes, user preferences, habit history,
calendar context, an LLM, database persistence, or API routes.

## Disclaimer

This is a deterministic product interpretation of traditional
astrological concepts (via `packages/bhrigu`'s own Bhrigu/Nadi-inspired
evidence) and is not scientifically established predictive analysis.

## Tests

`test/personalThemesEngine.test.ts` (repo root `test/` directory,
matching this repository's existing convention). Run with:

```bash
npx ts-node test/personalThemesEngine.test.ts
```
