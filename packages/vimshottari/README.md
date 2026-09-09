# Vimshottari Dasha Engine (V1)

Deterministically calculates Vimshottari Mahadasha and Antardasha periods
from the natal Moon.

```text
Birth data
   |
   +-- Natal chart -> Bhrigu Natal -> Personal Themes   (separate branch, PRs #94/#96)
   |
   +-- Natal Moon -> Vimshottari Dasha -> Life Period Context   <-- this package
```

This is the first **independent** personalization primitive after the
Bhrigu-natal-themes branch — it answers *"what longer-term planetary
period is this person currently in?"*, based purely on the natal Moon's
own sidereal position. It does not depend on, and is not depended on by,
`packages/bhrigu` or `packages/personal-themes`.

## Purpose

> Deterministically calculates Vimshottari Mahadasha and Antardasha
> periods from the natal Moon.

It does **not** produce horoscope predictions or daily recommendations.

## Inputs

Birth moment (UTC) + an already-known sidereal natal Moon longitude —
never a raw birth date/location, and never computed by calling an
ephemeris itself. The one existing ephemeris in this repository is
`packages/vedic/src/natalChart.ts`'s `getNatalChart(birthMomentUTC): GrahaPosition[]`
(sidereal, Lahiri ayanamsa, longitude normalized to `[0, 360)` — confirmed
directly from that file's own source before writing any code in this
package, not assumed). `calculateVimshottariFromNatalChart()` is a thin
adapter over that existing shape; `calculateVimshottariDasha()` is the
core function and takes the Moon longitude directly.

## Repository audit (Phase 0)

Before writing any production code, the entire repository was searched
for `dasha`, `vimshottari`, `nakshatra`, `Moon`, `sidereal`, `Lahiri`,
`ayanamsa`, `Julian`, `365.25`/`365.2425`. Findings:

- **No Dasha/Vimshottari calculation exists anywhere else in this
  repository.** Every prior hit is either an unrelated Tithi-name
  coincidence ("Dashami", the 10th tithi), a doc comment explicitly
  stating Dasha/Antardasha are `NOT_IMPLEMENTED` anywhere
  (`packages/recommendation/src/muhurthamFinder.ts`), or
  `packages/personal-intelligence`'s own forward-looking
  `LifePeriodContext.system: 'VIMSHOTTARI_DASHA'` placeholder — which
  this package is the first real producer for. No duplicate engine risk.
- **No existing 365.25/365.2425-day (or any other) Dasha year-length
  convention exists anywhere.** The only `365.25`-adjacent code found
  (`packages/vedic/src/natalChart.ts`'s Julian-centuries-since-J2000
  polynomial for the lunar node) is unrelated astronomy, not a Dasha
  convention. Free to introduce this package's own explicit, versioned
  choice (see "Convention" below) with no conflict.
- **`packages/vedic/src/panchangElements.ts` already exports
  `NAKSHATRA_NAMES`** (Ashwini..Revati, Sanskrit) — reused directly here
  rather than redeclared. Its own `getNakshatra(date: Date)` function is
  **not** reused: it computes today's Moon longitude itself via a fresh
  ephemeris call, which this package must never do (see "Inputs" above)
  — this package derives a Nakshatra from an *already-known* longitude
  instead, using the identical underlying math (`span = 360/27`,
  `floor(longitude / span)`).
- **One documented, non-blocking indexing-convention note** (not a
  boundary/math conflict): this repository already has an established
  **1-27** Nakshatra index convention elsewhere
  (`NatalContext.natalNakshatraIndex`,
  `PersonalMuhurtaContext.natalNakshatraIndex`, both "1-27, matching
  `getNakshatra()`"). This package's own `VimshottariBirthNakshatra.index`
  is **0-26** instead, per this package's own brief. This is a new,
  independent field on a new type in a new package — it never reads,
  writes, or contradicts either existing 1-27 field, and the underlying
  Nakshatra boundaries/spans/names are byte-identical either way (same
  13°20' spans, same `NAKSHATRA_NAMES` order, same 0°-sidereal-Aries
  start) — only the display/array-index numbering differs. Flagged
  explicitly in `nakshatra.ts`'s own doc comment rather than silently
  chosen. Kept as **0-26 for V1** (not changed to 1-27 to match the
  unrelated existing fields) since it matches this engine's own
  mathematical indexing convention (`Math.floor(longitude / span)`,
  array-index-shaped) — summarized as: **engine index: `0..26`** (this
  package, internal/array-shaped) vs. **display ordinal: `1..27`**
  (the existing, unrelated `natalNakshatraIndex` convention elsewhere in
  this repo, human-facing/"1st Nakshatra"-shaped). No derived display-
  ordinal field is exposed in V1, to avoid broadening this package's own
  contract for a purely cosmetic conversion (`index + 1`) any caller can
  already do itself.

No STOP condition was triggered: no existing Nakshatra-boundary,
ayanamsa, Dasha-year-length, birth-balance, or Antardasha-partitioning
convention was found that this package's own choices could conflict
with.

## Convention

- **27 Nakshatras**, each spanning exactly `360 / 27` degrees (a derived
  constant, never the fragile decimal literal `13.333...`) — Ashwini
  starts at `0°` sidereal Aries.
- **Vimshottari sequence** (fixed, never reordered): Ketu(7) → Venus(20)
  → Sun(6) → Moon(10) → Mars(7) → Rahu(18) → Jupiter(16) → Saturn(19) →
  Mercury(17) — summing to exactly **120 years**.
- The Nakshatra ruler sequence follows this same order and repeats every
  9 Nakshatras (27 / 9 = 3 full repeats across the zodiac).
- **V1 year length: 365.25 days** (`VIMSHOTTARI_YEAR_DAYS`) —
  `VIMSHOTTARI_YEAR_MS = 31_557_600_000`, an **exact** integer with zero
  fractional remainder. This is a calculation convention for this
  package, not a claim that every tradition/software uses the same year
  basis.
- **Birth balance**: the Mahadasha active at birth is the ruler of the
  Moon's own birth Nakshatra, but that Mahadasha does **not** restart at
  birth — its true start precedes birth by however far the Moon has
  already progressed through its Nakshatra:

  ```text
  fractionElapsed = (moonLongitude mod nakshatraSpan) / nakshatraSpan
  fractionRemaining = 1 - fractionElapsed
  ```

  **Explicit V1 millisecond-rounding rule** (centralized in exactly one
  place — `mahadasha.ts`'s own `calculateBirthBalance` — and never
  re-derived with floating-point arithmetic anywhere downstream):

  ```typescript
  rawElapsedMs = fullMahadashaDurationMs * fractionElapsed
  elapsedMs    = Math.min(Math.round(rawElapsedMs), fullMahadashaDurationMs - 1)
  mahadashaStartMs = birthMomentMs - elapsedMs
  mahadashaEndMs   = mahadashaStartMs + fullMahadashaDurationMs
  ```

  `rawElapsedMs` is the one genuinely fractional value in this whole
  engine (it depends on the continuous real-valued Moon longitude); it is
  rounded to the nearest integer millisecond via `Math.round` exactly
  once, then clamped to at most `fullMahadashaDurationMs - 1`, guaranteeing
  birth always falls strictly inside `[mahadashaStartMs, mahadashaEndMs)`
  even for a longitude extremely close to the next Nakshatra boundary.
  Every value derived afterward (this Mahadasha's own end, every
  subsequent Mahadasha, every Antardasha) is then exact integer-millisecond
  arithmetic with **zero** further rounding — verified by
  `test/vimshottariDashaEngine.test.ts`'s own dedicated rounding-rule
  section (integer-ms boundaries, stability under a non-round longitude,
  no gaps/overlaps, an exact-Nakshatra-start zero-offset case, and one
  independently-recomputed fractional-offset worked example). Birth-balance
  evidence (`VIMSHOTTARI_BIRTH_BALANCE_V1`) retains both `fractionElapsed`
  (the continuous input) and the resulting integer `elapsedMs`, so either
  can be inspected without recomputing the other.
- **`[start, end)` interval semantics**: `start` inclusive, `end`
  exclusive. At an exact transition instant, the old period is inactive
  and the new one is active. Applies to both Mahadasha and Antardasha.

## Coverage

`calculateVimshottariDasha`/`calculateVimshottariFromNatalChart` generate
complete Mahadashas — starting from the birth Mahadasha's own true,
pre-birth start — for **at least 120 Vimshottari years after the supplied
birth moment**, not merely "one nine-Mahadasha cycle from the true
start." Those are different guarantees: because the true start typically
precedes birth by the already-elapsed portion of the birth Nakshatra,
nine Mahadashas measured from the true start alone cover *less* than 120
years *after birth* — e.g. if birth falls 15 years into a 20-year Venus
Mahadasha, nine Mahadashas from Venus's own true start end only 105 years
after birth, not 120. Since the Vimshottari sequence is cyclic, this
engine instead keeps generating (wrapping the 9-lord sequence as many
times as necessary — the starting lord's own Mahadasha reappears) until
the guarantee below holds:

```typescript
coverageEndMs = birthMomentMs + 120 * VIMSHOTTARI_YEAR_MS; // VIMSHOTTARI_MIN_COVERAGE_MS

result.mahadashas[0].start   <= birthMomentMs
result.mahadashas.at(-1).end >= coverageEndMs
```

No individual Mahadasha is ever truncated to reach this horizon — the
final generated Mahadasha keeps its own full, undivided duration, so its
own `end` may (and typically does) fall strictly past the 120-year mark.
`result.mahadashas.length` is therefore **not always 9** — it is
whatever count of complete Mahadashas is needed to satisfy the coverage
guarantee above, and every one of them (including a Mahadasha in a
repeated/wrapped cycle) gets its own correctly-anchored 9 Antardashas —
Antardasha generation is never special-cased for a repeated cycle.

## Precision

`VIMSHOTTARI_YEAR_MS / 120 = 262_980_000` — also an **exact** integer.
Every Antardasha duration is therefore
`mahadashaLordYears * antardashaLordYears * 262_980_000`, a product of
three integers with **zero floating-point rounding anywhere**, for every
one of the 81 Antardashas across a full 9-Mahadasha cycle. Summing a
Mahadasha's own 9 Antardasha durations exactly reconstructs that
Mahadasha's own duration with no drift — proven by
`test/vimshottariDashaEngine.test.ts`'s own exact-partition checks. The
final Antardasha's own `end` is additionally forced to equal the parent
Mahadasha's own `end` explicitly, as a redundant, documented invariant
(belt-and-suspenders, not strictly required given the exact-integer
proof above).

One subtlety worth documenting: the naive `((deg % 360) + 360) % 360`
double-modulo longitude-normalization idiom, applied to THIS package's
own Nakshatra-boundary math, introduces measurable floating-point
precision loss even for an already-in-range value — confirmed empirically
(in this package's own isolated reproduction, against this package's own
Nakshatra-index math) to misclassify an EXACT Nakshatra boundary (13°20')
into the wrong Nakshatra. `nakshatra.ts`'s own `normalizeLongitude` is
therefore an identity for any longitude already in `[0, 360)` (the common
case — every real `GrahaPosition.siderealLongitude` already arrives
pre-normalized), falling back to the double-modulo only for a genuinely
out-of-range input.

A structurally similar `((deg % 360) + 360) % 360` idiom also exists
elsewhere in this repository (e.g. `packages/bhrigu/src/normalize.ts`).
Whether that specific usage is actually exposed to the same failure mode
depends on its own call sites' own boundary sensitivity, which this PR
did **not** audit — `packages/bhrigu` is protected/out-of-scope for this
PR, and no reproduction was attempted against Bhrigu's own actual inputs
or use cases. This is flagged here only as a pattern worth a separate,
targeted audit if relevant, not as a confirmed Bhrigu defect.

## Product interpretation

Dasha-lord theme metadata (Sun→leadership/visibility/responsibility,
Moon→emotions/care/habits, etc.) is Aura product-interpretation metadata
only, kept structurally separate from the calculation above — it does
not alter the Dasha mathematics. **This PR does not score Personal
Themes**: `toLifePeriodContext()`'s own `themes` field is always `[]`,
and this package never calls into or mutates `packages/personal-themes`.

## Personal Intelligence integration

`packages/personal-intelligence`'s existing, merged `LifePeriodContext`/
`LifePeriodSegment` were inspected directly before writing any adapter
code. No incompatibility was found, and **no contract change was
needed**: `LifePeriodContext` is already a point-in-time snapshot
(`majorPeriod`/`subPeriod`, singular, not a full history) — exactly what
"the Mahadasha/Antardasha active at a given instant" already is.
`toLifePeriodContext(result, at)` adapts this engine's own result into
that existing shape directly.

## Public API

```typescript
calculateVimshottariDasha({ birthMomentUTC, moonLongitude }): VimshottariDashaResult
calculateVimshottariFromNatalChart(birthMomentUTC, positions: GrahaPosition[]): VimshottariDashaResult
findMahadashaAt(result, instant: Date): VimshottariMahadashaPeriod | undefined
findAntardashaAt(result, instant: Date): VimshottariPeriod | undefined
getVimshottariPeriodAt(result, instant: Date): { mahadasha?, antardasha? }
toLifePeriodContext(result, at: Date): LifePeriodContext
```

`calculateVimshottariFromNatalChart` validates that `positions` contains
**exactly one** `Moon` entry (rejects zero or duplicated). No function in
this package calls `new Date()`/`Date.now()`/`Math.random()` internally
— every instant is caller-supplied.

## Dependency direction

```text
packages/vimshottari
      +--> packages/vedic               (GrahaName, GrahaPosition, NAKSHATRA_NAMES)
      +--> packages/personal-intelligence (LifePeriodContext, LifePeriodSegment, PersonalEvidenceRef)
```

Does **not** depend on `packages/bhrigu` or `packages/personal-themes` —
the Dasha branch is architecturally independent of the Bhrigu-natal-themes
branch (see this README's own opening diagram). No dependency on
`apps/web`, Prisma, a database, an API route, or an LLM anywhere.

## Explicitly out of scope

Pratyantardasha, Yogini Dasha or any other Dasha system, transit
calculations, Ashtakavarga, Life Weather, Personal Activity Fit,
recommendation ranking, Panchang, Muhurta, Home UI, Ask Aura,
notifications, DB schema, Prisma, API routes, server actions, or
LLM-generated interpretations.

## Disclaimer

This is a deterministic implementation of a traditional astrological
timing model (Vimshottari Dasha) and is not scientifically established
predictive analysis.

## Tests

`test/vimshottariDashaEngine.test.ts` (repo root `test/` directory,
matching this repository's existing convention). Includes three
independently hand-derived known-answer fixtures (Nakshatra start,
Nakshatra midpoint, and a non-trivial 25%-elapsed offset) computed by
hand in the test's own comments — never by invoking this package's own
production functions to generate the "expected" value. Run with:

```bash
npx ts-node test/vimshottariDashaEngine.test.ts
```
