# Natal Ascendant / Lagna Foundation (V1)

Canonical, deterministic natal Ascendant (Lagna) calculation from a birth
moment (UTC) and geographic coordinates.

```text
Birth data
   |
   +-- Natal chart (planets) -> Bhrigu Natal -> Personal Themes
   +-- Natal Moon             -> Vimshottari  -> Life Period
   +-- Natal Ascendant/Lagna  -> (this package)   <-- PR #98
                                     |
                                     v
                              PR #99: Ashtakavarga
```

This is the prerequisite for PR #99 (Ashtakavarga Engine V1): classical
Bhinna Ashtakavarga requires eight contributors — the seven classical
planets **plus Lagna** — and no canonical Ascendant calculator existed
anywhere in this repository before this PR (see "Repository audit"
below). This package exists to provide that one missing primitive, and
nothing else.

## Purpose

Given a birth moment and geographic coordinates, deterministically
calculate the tropical Ascendant, convert it to this repository's
existing Lahiri sidereal convention, and expose a canonical Lagna
longitude/sign result for downstream natal engines (Ashtakavarga, and
whatever else needs Lagna after it).

## Required inputs

```typescript
calculateNatalAscendant(birthMomentUTC: Date, latitude: number, longitude: number): NatalAscendant
```

- `birthMomentUTC` — a UTC instant. Birth **timezone** and **city name**
  are not inputs to this engine — those are product-level concerns for
  resolving a local birth time into a UTC instant *before* calling this
  package (see "Timezone independence" below).
- `latitude` — degrees north of the equator, in `(-90, 90)` (south
  negative). The poles themselves are rejected — see "Polar / high-
  latitude behavior".
- `longitude` — degrees **east** of Greenwich, in `[-180, 180]` (west
  negative) — see "Longitude convention" below.

## Repository audit (Phase 0)

Before writing any code, the repository was searched for `ascendant`,
`lagna`, `rising`, `sidereal time`, `birthLatitude`/`birthLongitude`, and
related terms. Findings:

- **No Ascendant/Lagna calculation exists anywhere in this repository.**
  `packages/vedic/src/natalChart.ts`'s own module doc comment states,
  verbatim: *"It does NOT compute the Ascendant/Lagna or house cusps
  (needs sidereal-time + latitude-dependent spherical trig — meaningfully
  more machinery)."* `packages/recommendation/src/muhurthamFinder.ts`'s
  own doc comment independently confirms: *"`UserChartContext.lagnaSign`
  (personalizedTasks.ts) is declared but never populated with a real
  value or read by any scoring path"* and *"NOT_IMPLEMENTED: ...
  Ashtakavarga -- none of these exist anywhere in this codebase."* This
  package is the first real Ascendant producer.
- **Birth location data already exists** as optional, nullable fields
  (`birthLatitude`, `birthLongitude`, `birthTimezone`) on the `User`
  model (`apps/web/prisma/schema.prisma`) and matching types in
  `apps/web/lib/db.ts` — sufficient for a *later* adapter, but this
  package does not read Prisma or any database state itself (see
  "Real birth-profile compatibility" below).
- **`astronomy-engine`** (already a dependency, used throughout
  `packages/vedic`) exposes reliable sidereal-time and coordinate-
  rotation primitives sufficient to compute the Ascendant without any
  hand-rolled astronomical formula — see "Ascendant formula" below.

## Architecture decision: new package, not `packages/vedic`

This PR's own protected-scope rule prohibits modifying
`packages/vedic/**` (it may only be imported from). Adding new files
*inside* `packages/vedic` would itself be a modification of that
protected package, so the only compliant option is a new package:
`packages/lagna/`. This also happens to match the brief's own stated
preference for "a cleaner dependency boundary" — the Ascendant is a
distinct astronomical calculation (horizon/ecliptic intersection) from
`packages/vedic`'s own planetary-position calculations, and keeping it
separate means a future consumer can depend on just the Ascendant
without pulling in the full natal-chart module, or vice versa.

## Ascendant formula: astronomy-engine rotation composition, not a
## hand-rolled trig formula

The Ascendant is the point where the ecliptic intersects the eastern
horizon for a given UTC instant, latitude, and longitude.

**Critical convention audit**: `astronomy-engine` exposes
`Rotation_ECL_HOR`, but its own doc comment identifies `"ECL"` as
*"ecliptic system, using equator at J2000 epoch"* — a **fixed-epoch**
frame, not ecliptic-of-date. That is the wrong frame: every other
tropical-longitude quantity in this repository
(`packages/vedic/src/natalChart.ts`'s own `GrahaPosition`) is computed in
the **true ecliptic of date** (`astronomy-engine`'s own `"ECT"` frame,
via its `Ecliptic()` function, whose own doc comment says verbatim:
*"Converts a J2000 mean equator (EQJ) vector to a TRUE ECLIPTIC OF DATE
(ETC) vector"*). Using the fixed-epoch `ECL`/`HOR` rotation instead would
silently introduce a multi-arcminute precession-sized error and make this
package's tropical Ascendant inconsistent with the rest of this
repository's own convention.

`astronomy-engine` does not expose a single `Rotation_ECT_HOR` function,
but exposes both halves of the exact composition needed:
`Rotation_ECT_EQD` (true ecliptic of date → equator of date) and
`Rotation_EQD_HOR` (equator of date → horizontal, observer-dependent).
`CombineRotation` composes them:

```text
true ecliptic of date  --Rotation_ECT_EQD-->  equator of date  --Rotation_EQD_HOR-->  horizontal (x=north, y=west, z=zenith)
```

This is built **entirely** from `astronomy-engine`'s own tested rotation
primitives — no hand-rolled sidereal-time formula, obliquity model, or
coordinate-rotation trigonometry of this package's own.

**Root-finding**: the ecliptic and the horizon are both great circles
through the observer's celestial sphere, so they always intersect at
**exactly two antipodal points** (for any latitude strictly between the
poles) — the Ascendant and the Descendant, always exactly 180° apart in
ecliptic longitude (verified as an internal consistency test). This
package coarsely scans 1440 points across `[0, 360)` of ecliptic
longitude to bracket both zero-altitude crossings, then refines each via
60 bisection iterations. The **rising** (Ascendant) root is distinguished
from the **setting** (Descendant) root by azimuth: an object is rising if
and only if it is on the geometrically eastern side of the horizon (
azimuth strictly between 0° and 180°, passing through 90°/east) — a
general, hemisphere- and season-independent consequence of Earth's
west-to-east rotation, not a formula this package invented.

This azimuth-based disambiguation has **no quadrant ambiguity** of the
kind that famously affects the classical closed-form
`tan(Ascendant) = ...` formula (a well-documented, commonly-reported
pitfall — see "Independent known-answer validation" below) — this
package avoids that class of bug entirely by construction.

## Lahiri ayanamsa

Reused **verbatim** from `packages/vedic/src/panchangElements.ts`'s own
`lahiriAyanamsa(date: Date): number` — no independent Lahiri formula is
implemented in this package.

```typescript
siderealLongitude = normalize360(tropicalLongitude - lahiriAyanamsa(birthMomentUTC))
```

## Sign convention

`0 = Mesha (Aries)`, `1 = Vrishabha (Taurus)`, ... `11 = Meena (Pisces)` —
identical order and indexing to `packages/vedic/src/natalChart.ts`'s own
`rashiIndex`/`RASHI_NAMES` convention. That array is **private**
(unexported) and `packages/vedic` is protected scope for this PR, so it
cannot be imported; `constants.ts`'s own `RASHI_NAMES` is a minimal,
purely-static re-declaration of the same 12 names, in the same order —
**not** a second astronomical calculation. This mirrors a pattern this
repository has already established twice for exactly this same
constraint: `packages/vedic/src/lunarCalendar.ts`'s own doc comment
(*"Not imported from there (that module's RASHI_NAMES is private...) --
kept as a small local constant"*) and `packages/bhrigu/src/types.ts`'s
own `ZodiacSign` doc comment.

`normalize360` is deliberately an **identity** for any longitude already
in `[0, 360)`, falling back to the double-modulo idiom only for a
genuinely out-of-range input — reproducing, independently, the exact
floating-point precision fix `packages/vimshottari` discovered in PR #97
(the naive `((deg % 360) + 360) % 360` pattern measurably loses precision
even for an already-in-range value, which can misclassify an exact
30°-boundary longitude into the wrong sign).

## Longitude convention

**East-positive**, matching `astronomy-engine`'s own `Observer.longitude`
documented convention exactly: *"degrees east of the prime meridian...
negative for observers west... should be kept in the range -180 to +180
to minimize floating point errors."* This package validates (does not
normalize) longitude into `[-180, 180]` — an out-of-range value (e.g.
`436`, `-284`) is **rejected**, not wrapped. This is a deliberate
decision, not an oversight: it avoids introducing a second,
independently-invented wraparound convention when the input contract can
simply require the caller to supply an already-canonical value, exactly
as `astronomy-engine` itself recommends. (The underlying geometry *is*
still 360°-periodic in longitude — verified directly against the
internal root-finder in tests — only the public input *contract* is
non-wrapping.)

## Timezone independence

The core calculation takes `birthMomentUTC`, `latitude`, `longitude`
only — never `birthTimezone` or `birthCityName`. Those remain product-
input concerns for resolving a local birth time into a UTC instant
*before* calling this package. No host-local timezone affects the
output (verified by constructing the same instant via `Date.UTC` vs. an
explicit `+00:00` ISO string and confirming identical output).

## Polar / high-latitude behavior

For any latitude strictly between the poles, the Ascendant is always
mathematically well-defined (two great circles through a sphere's center
always intersect at two antipodal points) — verified numerically stable
up to `89.9999°` in both hemispheres with no degradation. Exactly `±90°`
is **rejected** as invalid input: at the poles, the horizontal coordinate
frame itself is singular (azimuth/"north" is not a well-defined direction
there), a genuine definitional edge case rather than a numerical
inconvenience. If the root-finder ever fails to find exactly two
crossings, or exactly one rising crossing, it throws a typed
`NatalLagnaComputationError` rather than returning `NaN` or a silent
fallback — this should only be reachable at exactly the (already-
rejected) poles.

## Public API

```typescript
calculateNatalAscendant(birthMomentUTC: Date, latitude: number, longitude: number): NatalAscendant
calculateNatalAscendantFromInput(input: NatalAscendantInput): NatalAscendant
```

```typescript
interface NatalAscendant {
  engineVersion: 'NATAL_LAGNA_V1';
  tropicalLongitude: number;   // [0, 360)
  siderealLongitude: number;   // [0, 360), Lahiri
  rashiIndex: number;          // 0-11
  rashiName: string;
  degreeInRashi: number;       // [0, 30)
  ayanamsaDegrees: number;
  evidence: NatalLagnaEvidenceRef[];
}
```

Structurally mirrors `packages/vedic`'s own `GrahaPosition`
(`siderealLongitude`/`rashiIndex`/`rashiName`/`degreeInRashi`) so a future
consumer can handle Lagna alongside a `GrahaPosition[]` with minimal
special-casing — but Lagna is **not** typed as (and does not extend)
`GrahaPosition`/`GrahaName`: the Ascendant is a horizon/ecliptic
intersection point, not a planet ("graha"), and conflating the two would
misrepresent what it astronomically is.

## Real birth-profile compatibility

Confirmed by inspection (no modification made): `apps/web/prisma/schema.prisma`'s
`User` model already has nullable `birthDate`, `birthTime`,
`birthLatitude`, `birthLongitude`, `birthTimezone` fields — sufficient
inputs for a *later* adapter that resolves a local birth date/time/
timezone into a UTC instant and calls this package. This PR does not
build that adapter (it would require touching `apps/web`, which is
protected scope here) and does not modify Prisma.

## Determinism

No `Date.now()`, `Math.random()`, network, DB, or host-timezone
dependency anywhere in the package source (grep-verified in tests).
Same inputs → deep-equal output.

## Independent known-answer validation

Per this PR's own brief, the engine is **not** validated only against
its own formula. Two genuinely separate sources of truth are used:

1. **A real published technical worked example** — RadixPro, *"The
   ascendant"* (`https://radixpro.com/a4a-start/the-ascendant/`,
   content retrieved via web search since the page blocks direct
   fetches with HTTP 403). For Enschede, Netherlands (52°13′N, 6°54′E),
   2 November 2016, 21:17:30 UT, the source states its **own**
   intermediate values: sidereal time `0:35:23.6` (0.5899018653h),
   obliquity `23°26′13.56586091″` (23.437101628°), giving
   `RAMC = 8.8485279795°`. This package's own `astronomy-engine`-derived
   obliquity for the same instant matches to within `1e-4°`, and RAMC to
   within `0.01°` (a small, expected residual from apparent-vs-mean
   sidereal time / nutation model differences between libraries).
   Applying the standard closed-form Ascendant formula
   (`atan2(cos RAMC, -(sin ε·tan φ + cos ε·sin RAMC))`, normalized) to
   the **externally-published** RAMC/obliquity gives an expected tropical
   Ascendant this package's own `calculateNatalAscendant` output matches
   to within `0.01°`.
2. **The same closed-form formula**, applied to this package's own
   library-derived intermediates, for three further fixtures: the
   equator (lat=0), Chennai/India (mid-latitude, matching this
   repository's own established Chennai test coordinates), and New York
   (western longitude, matching this repository's own established NYC
   test coordinates) — each matching this package's rotation-based
   production output to within `0.005°`.

The closed-form formula and this package's rotation-matrix + root-
finding algorithm are two **completely independent computational
techniques** for the same astronomical definition — their agreement,
together with agreement against a real external source's own stated
intermediates, is genuine cross-validation, not a circular self-check.
Tolerances (`0.005°`–`0.01°`, roughly 18–36 arcseconds) are chosen to be
substantially tighter than one zodiac degree while still comfortably
accommodating the small, well-understood residuals between different
apparent-sidereal-time/nutation implementations.

## Non-goals

No house cusps, Bhava chart, Placidus/Whole-Sign/Sripati/Equal/
Regiomontanus house systems, Navamsha, Ashtakavarga (bindu/rekha,
Trikona/Ekadhipatya Shodhana), predictions, recommendations, UI, or
database/API/server changes. This package calculates the Ascendant
**point** only, not a full house system — Ashtakavarga (PR #99) only
needs the canonical Lagna sign as one of its eight contributors.

## Disclaimer

This is a deterministic implementation of a traditional astrological
coordinate calculation (the Ascendant/Lagna) and is not scientifically
established predictive analysis.
