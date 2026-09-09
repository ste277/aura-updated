# Life Weather Engine (V1)

Deterministic synthesis of which of a person's longer-term personal
themes are currently active, and which independent systems (their
current Vimshottari life period, their current transit activations) are
reinforcing them.

```text
Natal Personal Themes
        +
Current Vimshottari Mahadasha / Antardasha
        +
Current directed Transit Activations
        ↓
Life Weather
```

This is a **synthesis** engine, bridging static natal intelligence and
later daily recommendations. It is **not** daily guidance, horoscope
prose, activity recommendations, Panchang interpretation, Muhurta
ranking, window ranking, or Ashtakavarga synthesis — see "Non-goals"
below.

## Architecture

```text
birth chart              already computed
    ↓                         ↓
Personal Themes  ─────►  PersonalThemeContext ───┐
                                                   │
birth + evaluation instant                        │
    ↓                                             │
Vimshottari Dasha ─────► LifePeriodContext ───────┼──► deriveLifeWeather(...) ──► LifeWeatherContext
                                                   │
natal + evaluation instant                        │
    ↓                                             │
Transit Activation ────► TransitActivationContext ┘
```

`deriveLifeWeather` is a **pure composition engine**. It never calls
`getNatalChart`, `calculateVimshottariDasha`, `calculateTransitActivation`,
`buildBhriguNatalGraph`, `deriveThemeContext`, or any Ashtakavarga
calculation — every one of the three input contexts is already computed
by the caller. See `engine.ts`'s own module doc comment.

## Public API

```typescript
deriveLifeWeather(input: LifeWeatherInput): LifeWeatherContext
```

```typescript
interface LifeWeatherInput {
  natalThemes: PersonalThemeContext;
  lifePeriod: LifePeriodContext;
  transitActivations: TransitActivationContext;
  evaluationTime: string; // strict ISO-8601 UTC, explicit zone required
}
```

No birth details, no astronomy, no database, no ambient current time.
`evaluationTime` records the instant of *synthesis*; it is never used to
recompute any of the three input contexts, and the caller is responsible
for ensuring `lifePeriod` and `transitActivations` were themselves
computed at that same instant (not runtime-enforced — this engine never
recomputes either one to cross-check).

## Output

Always all 10 canonical `PersonalTheme` values, `PERSONAL_THEMES`
canonical order, never sparse. A theme with zero current contributors
still appears — with only its `NATAL` contributor and state `QUIET`.

```typescript
interface LifeWeatherTheme {
  theme: PersonalTheme;
  natalStrength: NormalizedScore;   // immutable natal baseline, copied verbatim
  natalDirection: 'SUPPORTIVE' | 'NEUTRAL' | 'CHALLENGING'; // natal-only, never a current polarity
  state: 'QUIET' | 'ACTIVE' | 'STRONGLY_ACTIVE';
  reinforcementSources: ('DASHA' | 'TRANSIT')[]; // never 'NATAL' -- see below
  contributors: LifeWeatherContributor[];
  evidence: PersonalEvidenceRef[];
}
```

## Canonical planet → theme mapping (reused, never re-invented)

Both Dasha and Transit projection reuse `packages/personal-themes`'s own
existing, public `THEME_MAPPING_RULES` (36 hand-authored planet+karaka →
`PersonalTheme` entries) via `mapping.ts`'s thin `getThemesForPlanet`
filter. **This package does not define a second planet-to-theme table.**
Every mapping rule's own `weight` (always `1.0`) is never read as a
numeric contribution — eligibility is categorical.

## Model D — transit theme projection (merge-critical)

For `transitingPlanet → natalPlanet`, the activated themes come from the
**natal target's own** canonical mapping, never the transiting planet's:

```text
transiting Saturn → natal Moon
                        ↓
              Moon's own canonical themes
                        ↓
              those themes get a TRANSIT contributor
```

This is what keeps Life Weather person-specific rather than a generic
horoscope ("Jupiter transit = LEARNING for everybody" is never
implemented anywhere in this package). Two different transiting planets
activating the same natal planet project into the *same* eligible theme
set (mediated by the shared natal target); the same transiting planet
activating two different natal planets projects into *different* theme
sets.

## Dasha theme projection — categorical, not numeric

For the current Mahadasha lord, the same canonical mapping determines
which themes receive a `DASHA_MAHADASHA` contributor; the Antardasha
lord independently determines `DASHA_ANTARDASHA` contributors. **No
numeric weighting** (e.g. "Mahadasha = 0.7, Antardasha = 0.3") is
implemented — no such model is justified by anything in the Vimshottari
engine's own output, so contribution stays purely categorical
(`natalPlanet` + evidence, no `strength` field on either Dasha
contributor kind at all).

### Mahadasha == Antardasha

When both lords are the same planet, **both** contributors are still
produced — `DASHA_MAHADASHA` and `DASHA_ANTARDASHA` remain two
separately-inspectable facts (two independent life-period levels), never
collapsed into one. For `state`/`reinforcementSources` purposes, though,
they still count as **one** current system (`DASHA`), never two.

## Transit contribution — per-pair, never aggregated

Each qualifying `TransitActivation` pair becomes its own
`LifeWeatherTransitContributor`, with `strength` copied **verbatim** from
that pair — never rescaled, summed, or maxed against any other
contributor. If two transits activate the same theme, both contributors
are kept, separately.

## State is structural, not numeric

```typescript
type LifeWeatherState = 'QUIET' | 'ACTIVE' | 'STRONGLY_ACTIVE';
```

```text
no current contributor (Dasha or Transit) → QUIET
exactly one current SYSTEM (Dasha xor Transit) → ACTIVE
both current systems → STRONGLY_ACTIVE
```

No `natalStrength` threshold, no transit-strength threshold, no count of
individual transits, no MD/AD count. Deliberately avoided: any numeric
cutoff here would be an invented policy this contract has no basis for —
exactly the "giant weighted astrology score" failure mode this whole
roadmap has avoided since Transit Activation V1.

`reinforcementSources` deliberately **excludes** `'NATAL'`: natal is the
baseline every theme already has, not a *current* activation source.

## Zero natal strength does not block current activation

Personal Themes V1 structurally yields `SOCIAL = 0` and `FINANCE = 0` for
every user (only Mercury's own karakas map to either theme, and a single
eligible planet has zero reinforcement ceiling — see
`packages/personal-themes/README.md`'s own "Scoring" section). Life
Weather's own eligibility comes entirely from the canonical
planet-to-theme mapping, **never** from `natalStrength` — a theme with
`natalStrength === 0` can still legitimately reach `ACTIVE` or
`STRONGLY_ACTIVE` from current Dasha/transit contributors.

## Active ≠ good

No current polarity anywhere in this engine's output. `state` is
strictly structural (`QUIET`/`ACTIVE`/`STRONGLY_ACTIVE`); this package
never emits `GOOD`/`BAD`/`FAVORABLE`/`UNFAVORABLE`/`LUCKY`/`UNLUCKY`.
Transit Activation strength is magnitude, not polarity; Dasha carries
period identity, not polarity; `natalDirection` is copied verbatim from
the natal context and is never treated as a *current* signal.

## No theme-level numeric activation score

Deliberately absent: `activationStrength`, `lifeWeatherScore`,
`themeScore`, `overallScore`, `supportScore`. `natalStrength` + `state` +
`reinforcementSources` + `contributors` is the complete, intentionally
minimal V1 output.

## Contributor ordering

Deterministic: `NATAL`, then `DASHA_MAHADASHA` (if present), then
`DASHA_ANTARDASHA` (if present), then `TRANSIT` contributors in the exact
order `transitActivations.activations` was supplied — never re-sorted.

## Evidence discipline

Every contributor carries exactly **one** small, Life-Weather-authored
evidence entry (source `'LIFE_WEATHER'`) documenting the one synthesis
fact that contributor asserts — never a forwarded copy of an upstream
engine's own (potentially large) evidence tree. A theme carries at most
two small evidence entries of its own (`STRUCTURAL_STATE`, plus
`CROSS_SYSTEM_REINFORCEMENT` only when both Dasha and Transit reinforce
it). The result carries one small summary entry. A representative full
10-theme result is expected to serialize in the **low tens of KB** —
comparable to or smaller than Transit Activation's own ~43KB, and well
under Ashtakavarga's ~610KB.

## Personal Intelligence contract V1 → V2

This engine's own existence required evolving `packages/personal-intelligence`'s
`TransitActivation` contract from a lossy, grouped-by-transiting-planet
V1 shape to a lossless, pair-level V2 shape (`transitingPlanet`,
`natalPlanet`, `relationship`, `strength` all first-class) — see
`packages/personal-intelligence/README.md`'s own "V1 -> V2" section and
`packages/transit-activation/README.md`'s own "Personal Intelligence
adapter" section for the full history. `packages/transit-activation`'s
own `toTransitActivationContext` (deferred in PR #100, restored in this
PR) is now a purely mechanical 1:1 mapping onto that V2 shape.

## Non-goals

Daily guidance, horoscope prose, activity recommendations, Panchang
interpretation, Muhurta ranking, window ranking, Ashtakavarga synthesis,
Dasha+transit numeric weighting, degree/orb aspects, retrograde/speed
weighting, UI, database/schema/API/server actions, LLM interpretation.

## Traditional vs. Aura synthesis

- **Traditional/upstream calculation**: Vimshottari period identity and
  boundaries; sidereal transit sign positions.
- **Existing Aura/Bhrigu convention**: Bhrigu's own sign-relationship
  categories/weights (reused by Transit Activation); Personal Themes'
  own natal reinforcement scoring.
- **Aura semantic layer**: the planet/karaka → `PersonalTheme` mapping
  itself (`packages/personal-themes`'s own `THEME_MAPPING_RULES`,
  reused here, never re-invented).
- **Aura Life Weather synthesis (this package)**: projecting a Dasha
  lord → its own eligible themes; projecting a transit → its natal
  target → that target's own eligible themes (Model D); the structural
  `QUIET`/`ACTIVE`/`STRONGLY_ACTIVE` state model; cross-system
  reinforcement itself. None of this is a classical astrological
  technique — it is Aura's own product synthesis, applied on top of
  traditional/upstream facts.

## Determinism

No `Date.now()`, `Math.random()`, network, or DB anywhere in the source.
`evaluationTime` is always caller-supplied. Repeated calls with
structurally identical input produce deeply-equal output.

## Disclaimer

This is a deterministic composition of already-computed, deterministic
upstream results and is not scientifically established predictive
analysis.
