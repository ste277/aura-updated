# Ashtakavarga Engine (V1)

Deterministic raw classical Bhinna Ashtakavarga (BAV) and Sarvashtakavarga
(SAV) calculation from already-known sidereal Rashi placements.

```text
Birth data
   |
   +-- Natal chart (planets) -> packages/vedic
   +-- Natal Ascendant/Lagna -> packages/lagna
                |
                v
        Ashtakavarga adapter
                |
                v
      7 raw BAV tables + raw SAV     <-- this package
                |
                v
   (future PR: reductions, transit scoring, Personal Support)
```

This is a mathematical/traditional calculation package. It is **not** a
prediction, transit, recommendation, or Aura-scoring engine.

## Purpose

Using Aura's canonical natal planetary positions and canonical Lagna,
calculate the seven classical Bhinna Ashtakavarga tables and the
aggregate raw Sarvashtakavarga, with contributor-level explainability,
explicit source provenance, deterministic output, and independently
verified arithmetic invariants.

## Repository audit (Phase 0)

Searched the repository for `ashtakavarga`, `bhinna`, `sarva`, `bindu`,
`rekha`, `prastara`, `trikona`, `ekadhipatya`, `shodhana`, `shodhya`,
`pinda`. Findings:

- **No Ashtakavarga calculation exists anywhere in this repository
  prior to this package.** Every hit is a forward-looking placeholder
  (`packages/personal-intelligence`'s own `PersonalSupportContext.system:
  'ASHTAKAVARGA'` literal) or an explicit `NOT_IMPLEMENTED` note in
  `packages/recommendation/src/muhurthamFinder.ts`. This package is the
  first real producer.
- **Canonical natal planetary source**: `packages/vedic/src/natalChart.ts`'s
  `getNatalChart(birthMomentUTC): GrahaPosition[]`, unchanged, imported
  only.
- **Canonical Lagna source**: `packages/lagna`'s
  `calculateNatalAscendant(birthMomentUTC, latitude, longitude):
  NatalAscendant` (PR #98), unchanged, imported only. This package uses
  `NatalAscendant.rashiIndex` as Lagna's own contributor sign.
- **Sign convention** confirmed 0-11 (0 = Mesha/Aries .. 11 =
  Meena/Pisces), matching both `GrahaPosition.rashiIndex` and
  `NatalAscendant.rashiIndex` exactly.

## Rule source

**This is the single most important Phase 0 finding, and it received a
second, deeper verification pass after initial implementation.** Before
writing any of the 56 contribution rules, two independent published
sources were identified and compared cell-by-cell:

1. **Source A**: *"Mastering Ashtakavarga Part 2: Building
   Bhinnashtakavarga Charts"*
   (`vedastro.org/blog/Mastering-Ashtakavarga-Part-2-Building-Bhinnashtakavarga-Charts.html`),
   fetched directly (not merely via a search-engine summary) — presents
   the standard **Parashara (BPHS)** Bhinnashtakavarga "Benefic Houses"
   table, one row per contributor, for all 7 targets.
2. **Source B**: *"LESSON No.1 — WHAT IS THE ASHTAKAVARGA SYSTEM?"*
   (KAS Corner, `kascorner.com`, PDF teaching document, pages 7–11,
   "BHINNASHTAKAVARGA" section), read directly as a PDF — presents the
   same table as literal per-house dot grids for all 7 targets, **plus a
   fully worked real chart example** (a natal chart for a birth in
   Nagpur, India, 26 Oct 1961, 9:45am) whose own resulting BAV/SAV
   totals independently reproduce 48/49/39/54/56/52/39/337.

**Result: all 56 of 56 rules were independently verified at the exact
house-number level (not merely row-count) between the two sources, with
zero disagreement on any cell.** The first implementation pass verified
32 of 56 rows this way and only row-counts for the remaining 24
(Jupiter, Venus, Saturn); a follow-up audit closed that gap by
re-rendering Source B's PDF pages at 400dpi with precise per-table
`pdftoppm` crop boxes (eliminating the column-alignment ambiguity of a
coarser, full-page text extraction) and reading every one of the
remaining 24 rows directly against a visible, unambiguous
"1 2 3 4 5 6 7 8 9 10 11 12" column header. Every row matched Source A
exactly. `test/ashtakavargaEngine.test.ts`'s own `INDEPENDENT_RULE_REFERENCE`
table encodes all 56 rows from this fully-verified data (a separate,
independently-typed literal — never importing `ASHTAKAVARGA_RULES`) and
deep-compares it against production, catching a wrong/missing/extra
house or a transposed target/contributor even when row counts would
still coincidentally match. Both sources also independently confirm the
standard table excludes Rahu/Ketu.

**Table orientation** was verified separately: each rule's house list
means *"the relative houses, counted inclusively from the contributor's
own natal sign, where that contributor gives the target a point"* —
confirmed as the exact interpretation `relativeHouse.ts`/`prastara.ts`
implement (`relativeHouse(contributorSign, destinationSign)`, never the
reversed direction).

**The KAS Corner worked chart was not used as a full known-answer
fixture** (only its aggregate row/column totals, which are invariant to
this issue): its own "ASHTAKAVARGA CHART OF MALE" table is presented by
**house-from-Lagna** position, not by fixed zodiac Rashi — the source's
own text states *"the SUN is located in the 12th house... contributes 5
points to this house"*, and its South-Indian-style box chart places the
Ascendant in box "1" with other planets' boxes numbered as houses
relative to it, not as fixed Rashi identities. Reconstructing an
unambiguous Rashi (0=Aries..11=Pisces) placement for each planet from
that chart image alone — as opposed to a house-from-Lagna position —
was judged too interpretation-risky to build a full cell-by-cell fixture
from, so it was not forced into one.

The locked table is implemented in `rules.ts` as declarative data (56
`AshtakavargaContributionRule` entries), never as nested conditionals.

## Terminology

Internally, this package uses neutral terminology:
`AshtakavargaPoint = 0 | 1`, `point`/`contribution`/`point count` — never
`bindu`/`rekha` at the type level. This avoids letting a known historical
naming ambiguity (some modern software calls a positive mark "bindu";
some classical source conventions distinguish `positive = rekha/sthana`
vs. `negative = bindu/karana` — the opposite assignment) infect the
mathematics. **Aura V1 does not use the word "bindu" anywhere in its
public contract** — this README documents the convention explicitly so
a future PR that does introduce that word knows it is using it in the
common modern-software sense (positive point), not claiming that usage
is universal.

## Contributors

Eight: **Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, Lagna.**
**Rahu and Ketu are explicitly NOT contributors** to the standard V1 BAV
tables — they may exist in the canonical 9-graha natal chart input, and
are simply ignored by the adapter (`calculateAshtakavargaFromNatalChart`)
rather than causing rejection. This does not delete or modify Rahu/Ketu
anywhere in the natal engine; it only excludes them from Ashtakavarga's
own contributor set, matching the locked classical table (see "Rule
source" above).

## Targets

The same seven planets, as Bhinna Ashtakavarga *targets*: **Sun, Moon,
Mars, Mercury, Jupiter, Venus, Saturn.** (Lagna is a contributor to each
of these seven tables — it is not itself an eighth BAV target in V1; see
"Raw Sarvashtakavarga" below.)

## Relative-house semantics

Inclusive classical house counting, 1-12 (never 0-based sign distance):

```typescript
relativeHouse(from, to) = ((to - from + 12) % 12) + 1
```

`from`/`to` are 0-11 zodiac-sign indices. Same sign = 1, next sign = 2,
..., previous sign = 12. One canonical helper (`relativeHouse.ts`), used
by every rule lookup.

## Input model

The core engine (`calculateAshtakavarga`) accepts only already-normalized
sidereal Rashi indices — it never calculates planetary/Lagna astronomy
itself and never reads Prisma/profile state:

```typescript
interface AshtakavargaNatalInput {
  planetarySigns: { Sun; Moon; Mars; Mercury; Jupiter; Venus; Saturn: ZodiacSign };
  lagnaSign: ZodiacSign;
}
```

A separate adapter, `calculateAshtakavargaFromNatalChart(positions,
lagna)`, bridges from real `GrahaPosition[]` (`packages/vedic`) and a
real `NatalAscendant` (`packages/lagna`) to this shape, using each
source's own already-Lahiri-sidereal `rashiIndex` directly:

```text
real natal chart + real Lagna
            |
            v
   calculateAshtakavargaFromNatalChart (adapter)
            |
            v
   AshtakavargaNatalInput (normalized signs)
            |
            v
   calculateAshtakavarga (pure calculation engine)
```

## Prastara (contributor-level calculation)

For every target/sign, all 8 contributors are evaluated and preserved —
not just the final 0-8 count:

```typescript
interface AshtakavargaContribution {
  contributor; contributorSign; destinationSign; relativeHouse; point; ruleId;
}
interface AshtakavargaSignResult {
  sign; contributions: readonly AshtakavargaContribution[]; total; // = sum(point)
}
```

This makes the engine auditable: "why does Saturn have 5 points in this
sign?" is answerable directly from `contributions`, not only from
`total`.

## Fixed totals

Under the locked rule table, every valid chart's seven BAV grand totals
are **fixed** — the chart only changes *where* in the zodiac each
contributor's allowed houses land, never *how many* allowed houses exist
in the table:

```text
Sun       48
Moon      49
Mars      39
Mercury   54
Jupiter   56
Venus     52
Saturn    39
SAV      337
```

Verified independently (`rules.ts`'s own row-sum, before any chart
geometry) and per-chart (every `BhinnaAshtakavarga.total` and
`Sarvashtakavarga.total`) across multiple deliberately different
fixtures, a Lagna-sensitivity fixture, a planet-sensitivity fixture, and
a global-rotation-invariance property test — see
`test/ashtakavargaEngine.test.ts`.

## Raw Sarvashtakavarga

Sign-by-sign sum of the seven BAV tables:

```typescript
sav[s] = sunBav[s] + moonBav[s] + marsBav[s] + mercuryBav[s] + jupiterBav[s] + venusBav[s] + saturnBav[s]
```

**No separate Lagna BAV is added as an eighth SAV component** — Lagna
already participated as a *contributor* inside each of the seven BAV
tables; adding it again here would double-count it. Each sign's SAV is
in `[0, 56]`; the grand total is always `337`.

## Raw vs. reduced

This PR produces **raw** BAV/SAV only. It does **not** implement:

- **Trikona Shodhana** — not implemented
- **Ekadhipatya Shodhana** — not implemented
- **Shodhya Pinda** — not implemented

These are documented as a deliberate, versioned future scope, not
silently folded into "raw." (Reduction-audit notes, for future
reference: sources broadly agree these three reductions exist and are
applied to raw BAV/SAV in a specific order, but a full audit of their
exact rule sets, whether Lagna participates in each, and whether the
337 invariant survives reduction, was not performed for this PR — that
audit belongs to whichever future PR actually implements them.)

## Evidence / provenance

Every contribution and every aggregate is traceable: target, contributor,
contributor sign, destination sign, relative house, allowed-house rule,
resulting point, engine/rule version. Stable rule IDs
(`ASHTAKAVARGA_BAV_<TARGET>_FROM_<CONTRIBUTOR>_V1` per contribution rule;
`ASHTAKAVARGA_BAV_SIGN_SUM_V1`, `ASHTAKAVARGA_BAV_TOTAL_V1`,
`ASHTAKAVARGA_SAV_SIGN_SUM_V1`, `ASHTAKAVARGA_SAV_TOTAL_V1` for
aggregates) — never random, never timestamped.

## Determinism

This engine has no time dimension at all: it accepts only already-reduced
zodiac signs, never a birth instant. No `Date.now()`, `Math.random()`,
network, or DB anywhere in the source. Canonical ordering throughout
(`ASHTAKAVARGA_TARGETS`, `ASHTAKAVARGA_CONTRIBUTORS`, signs 0→11).

## Personal Intelligence contract

`packages/personal-intelligence`'s existing `PersonalSupportContext`
requires a normalized `overallSupport?: number` / `themeSupport?`
representation — an interpretive, lossy mapping this PR's own brief
explicitly prohibits producing. **No `PersonalSupportContext` adapter is
built in this PR**, and `packages/personal-intelligence` is not modified.
Raw Ashtakavarga comes first; a later composition PR can map it to
product support.

## Non-goals

Trikona Shodhana, Ekadhipatya Shodhana, Shodhya Pinda, Rashi Pinda, Graha
Pinda, Kakshya, transit interpretation/scoring, `PersonalSupportContext`
scoring, Aura-score normalization, Life Weather, Daily Personal Fit,
recommendation ranking, UI, DB, API, server actions, LLM interpretation.

## Interpretation

Raw Ashtakavarga points are a traditional astrological structure, not a
scientifically validated predictive analysis. A high or low point count
is not, on its own, a guaranteed outcome.

## Disclaimer

This is a deterministic implementation of a traditional astrological
calculation model and is not scientifically established predictive
analysis.
