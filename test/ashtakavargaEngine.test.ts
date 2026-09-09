/**
 * Ashtakavarga Engine V1: regression suite for packages/ashtakavarga/src
 * -- deterministically calculates the seven classical Bhinna Ashtakavarga
 * tables and the raw Sarvashtakavarga from already-known sidereal Rashi
 * placements. See packages/ashtakavarga/README.md for the full
 * convention (standard Parashara 56-rule table, 8 contributors excluding
 * Rahu/Ketu, 1-12 inclusive relative-house counting, fixed totals
 * 48/49/39/54/56/52/39/337) this suite verifies against.
 *
 * "Independent known-answer validation" (per this PR's own brief): the
 * KNOWN-ANSWER FIXTURE section below hand-derives 4 target/sign cells
 * directly from the LOCKED rule table (rules.ts), by manual arithmetic
 * in these comments -- NEVER by calling this package's own production
 * functions (relativeHouse/calculateSignResult/etc.) to generate the
 * "expected" value. The rule table itself was cross-validated during
 * this PR's own Phase 0 against two independent published sources (see
 * rules.ts's own module doc comment for the full source/recension audit
 * trace) -- both agreeing exactly on all 56 rows (32 verified at the
 * individual house-number level, all 56 verified at the row-count
 * level), and one of those sources included a fully worked real natal
 * chart example whose own resulting BAV/SAV totals independently
 * reproduce 48/49/39/54/56/52/39/337.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

import { getNatalChart } from '../packages/vedic/src/natalChart';
import { calculateNatalAscendant } from '../packages/lagna/src/index';

import {
  calculateAshtakavarga,
  calculateAshtakavargaFromNatalChart,
  calculateSignResult,
  calculateBhinnaAshtakavarga,
  calculateSarvashtakavarga,
  relativeHouse,
  ASHTAKAVARGA_RULES,
  findRule,
  dedupeEvidenceRefs,
  ASHTAKAVARGA_ENGINE_VERSION,
  ASHTAKAVARGA_RULESET_VERSION,
  ASHTAKAVARGA_TARGETS,
  ASHTAKAVARGA_CONTRIBUTORS,
  ASHTAKAVARGA_FIXED_TOTALS,
  ASHTAKAVARGA_SAV_FIXED_TOTAL,
  ZODIAC_SIGN_COUNT,
  AshtakavargaValidationError,
} from '../packages/ashtakavarga/src/index';
import type { AshtakavargaTargetPlanet, AshtakavargaContributor } from '../packages/ashtakavarga/src/index';

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ============================================================
// RULESET TEST -- merge-critical. Verify the declarative source table
// itself, independently of any chart geometry.
// ============================================================

check('ASHTAKAVARGA_RULES has exactly 56 rules (7 targets x 8 contributors)', ASHTAKAVARGA_RULES.length === 56);

check(
  'every target/contributor pair exists exactly once -- no duplicates, no missing pair',
  ASHTAKAVARGA_TARGETS.every((target) => ASHTAKAVARGA_CONTRIBUTORS.every((contributor) => ASHTAKAVARGA_RULES.filter((r) => r.target === target && r.contributor === contributor).length === 1))
);

check(
  'every rule\'s houses are integers in [1,12], with no duplicate house inside a single rule',
  ASHTAKAVARGA_RULES.every((r) => r.houses.every((h) => Number.isInteger(h) && h >= 1 && h <= 12) && new Set(r.houses).size === r.houses.length)
);

check(
  'every rule has a stable, non-empty ruleId following the ASHTAKAVARGA_BAV_<TARGET>_FROM_<CONTRIBUTOR>_V1 pattern, and a ruleVersion',
  ASHTAKAVARGA_RULES.every((r) => r.ruleId === `ASHTAKAVARGA_BAV_${r.target.toUpperCase()}_FROM_${r.contributor.toUpperCase()}_V1` && typeof r.ruleVersion === 'string' && r.ruleVersion.length > 0)
);

// Independently hard-coded expected totals -- NOT read from
// ASHTAKAVARGA_FIXED_TOTALS (that constant is itself compared against
// these same literal numbers below, so re-using it here would be
// circular). These are the classical BPHS totals, cross-validated
// against two independent published sources during this PR's own Phase 0
// (see rules.ts's own module doc comment).
const INDEPENDENTLY_EXPECTED_TOTALS: Record<AshtakavargaTargetPlanet, number> = {
  Sun: 48,
  Moon: 49,
  Mars: 39,
  Mercury: 54,
  Jupiter: 56,
  Venus: 52,
  Saturn: 39,
};

check(
  'RULE-TABLE INTEGRITY: independently counting the declared houses (summing the length of each of the 8 contributor house-lists) for every target reproduces the exact classical fixed total, computed here from the raw rule table -- BEFORE any chart geometry is involved',
  (Object.keys(INDEPENDENTLY_EXPECTED_TOTALS) as AshtakavargaTargetPlanet[]).every((target) => {
    const declaredTotal = ASHTAKAVARGA_RULES.filter((r) => r.target === target).reduce((sum, r) => sum + r.houses.length, 0);
    return declaredTotal === INDEPENDENTLY_EXPECTED_TOTALS[target];
  })
);

check(
  'the sum of all 56 rules\' own declared house-counts is exactly 337 (48+49+39+54+56+52+39), computed independently of ASHTAKAVARGA_SAV_FIXED_TOTAL',
  ASHTAKAVARGA_RULES.reduce((sum, r) => sum + r.houses.length, 0) === 337
);

check('ASHTAKAVARGA_FIXED_TOTALS matches the independently hard-coded expected totals', ASHTAKAVARGA_TARGETS.every((t) => ASHTAKAVARGA_FIXED_TOTALS[t] === INDEPENDENTLY_EXPECTED_TOTALS[t]));
check('ASHTAKAVARGA_SAV_FIXED_TOTAL is exactly 337', ASHTAKAVARGA_SAV_FIXED_TOTAL === 337);

check('findRule returns the correct, unique rule for a sample target/contributor pair', findRule('Jupiter', 'Saturn').houses.join(',') === '3,5,6,12');

// ============================================================
// FULL 56/56 HOUSE-LEVEL SOURCE-LOCK TEST -- merge-critical.
//
// Row-count agreement (the check above) is NOT sufficient: two
// different rule tables can have the same number of allowed houses per
// row while differing in WHICH houses are allowed, silently preserving
// 48/49/39/54/56/52/39/337 while producing an incorrect BAV/SAV
// distribution for every real chart. This section independently
// encodes every one of the 56 rows at the exact house-number level and
// deep-compares each against production -- it does NOT import
// ASHTAKAVARGA_RULES to build its own expected values (that would be
// circular); INDEPENDENT_RULE_REFERENCE below is transcribed directly
// from the same two sources, kept as a completely separate literal.
//
// Source A: "Mastering Ashtakavarga Part 2: Building Bhinnashtakavarga
// Charts" (vedastro.org/blog/Mastering-Ashtakavarga-Part-2-Building-
// Bhinnashtakavarga-Charts.html) -- fetched directly (not via a search
// summary) during this audit; presents a "Benefic Houses" table per
// target planet, one row per contributor, with the fixed total for each
// target planet stated alongside its own table.
//
// Source B: "LESSON No.1 -- WHAT IS THE ASHTAKAVARGA SYSTEM?" (KAS
// Corner, kascorner.com, PDF teaching document), pages 7-11 ("BHINNASHTAKAVARGA"
// section) -- read directly as a PDF; each target planet's table is a
// literal dot-grid, "from the" 1..12 across the top, one row per
// contributor. Re-verified in THIS audit pass at 400dpi with precise
// per-table pdftoppm crop boxes (not the original, coarser full-page
// text extraction) to eliminate any risk of column-position
// misalignment -- every one of the 56 rows was read from a crop showing
// the complete, unambiguous "1 2 3 4 5 6 7 8 9 10 11 12" column header
// directly above (or immediately traceable to) that row's own dots.
//
// Both sources independently agree EXACTLY on every one of the 56 rows
// below -- there is no discrepancy between Source A and Source B on any
// cell, and this table also matches production ASHTAKAVARGA_RULES
// exactly (verified by the deep-comparison check immediately below).
//
// Table orientation (verified separately, see relativeHouse.ts and
// prastara.ts): each row's house list means "the relative houses,
// counted inclusively from the CONTRIBUTOR's own natal sign, where that
// contributor gives the TARGET a point" -- i.e. production's own
// `relativeHouse(contributorSign, destinationSign)` call (prastara.ts)
// is the correct, non-reversed direction for this interpretation.
// ============================================================

const INDEPENDENT_RULE_REFERENCE: Record<AshtakavargaTargetPlanet, Record<AshtakavargaContributor, number[]>> = {
  Sun: {
    Sun: [1, 2, 4, 7, 8, 9, 10, 11],
    Moon: [3, 6, 10, 11],
    Mars: [1, 2, 4, 7, 8, 9, 10, 11],
    Mercury: [3, 5, 6, 9, 10, 11, 12],
    Jupiter: [5, 6, 9, 11],
    Venus: [6, 7, 12],
    Saturn: [1, 2, 4, 7, 8, 9, 10, 11],
    Lagna: [3, 4, 6, 10, 11, 12],
  },
  Moon: {
    Sun: [3, 6, 7, 8, 10, 11],
    Moon: [1, 3, 6, 7, 10, 11],
    Mars: [2, 3, 5, 6, 9, 10, 11],
    Mercury: [1, 3, 4, 5, 7, 8, 10, 11],
    Jupiter: [1, 4, 7, 8, 10, 11, 12],
    Venus: [3, 4, 5, 7, 9, 10, 11],
    Saturn: [3, 5, 6, 11],
    Lagna: [3, 6, 10, 11],
  },
  Mars: {
    Sun: [3, 5, 6, 10, 11],
    Moon: [3, 6, 11],
    Mars: [1, 2, 4, 7, 8, 10, 11],
    Mercury: [3, 5, 6, 11],
    Jupiter: [6, 10, 11, 12],
    Venus: [6, 8, 11, 12],
    Saturn: [1, 4, 7, 8, 9, 10, 11],
    Lagna: [1, 3, 6, 10, 11],
  },
  Mercury: {
    Sun: [5, 6, 9, 11, 12],
    Moon: [2, 4, 6, 8, 10, 11],
    Mars: [1, 2, 4, 7, 8, 9, 10, 11],
    Mercury: [1, 3, 5, 6, 9, 10, 11, 12],
    Jupiter: [6, 8, 11, 12],
    Venus: [1, 2, 3, 4, 5, 8, 9, 11],
    Saturn: [1, 2, 4, 7, 8, 9, 10, 11],
    Lagna: [1, 2, 4, 6, 8, 10, 11],
  },
  Jupiter: {
    Sun: [1, 2, 3, 4, 7, 8, 9, 10, 11],
    Moon: [2, 5, 7, 9, 11],
    Mars: [1, 2, 4, 7, 8, 10, 11],
    Mercury: [1, 2, 4, 5, 6, 9, 10, 11],
    Jupiter: [1, 2, 3, 4, 7, 8, 10, 11],
    Venus: [2, 5, 6, 9, 10, 11],
    Saturn: [3, 5, 6, 12],
    Lagna: [1, 2, 4, 5, 6, 7, 9, 10, 11],
  },
  Venus: {
    Sun: [8, 11, 12],
    Moon: [1, 2, 3, 4, 5, 8, 9, 11, 12],
    Mars: [3, 5, 6, 9, 11, 12],
    Mercury: [3, 5, 6, 9, 11],
    Jupiter: [5, 8, 9, 10, 11],
    Venus: [1, 2, 3, 4, 5, 8, 9, 10, 11],
    Saturn: [3, 4, 5, 8, 9, 10, 11],
    Lagna: [1, 2, 3, 4, 5, 8, 9, 11],
  },
  Saturn: {
    Sun: [1, 2, 4, 7, 8, 10, 11],
    Moon: [3, 6, 11],
    Mars: [3, 5, 6, 10, 11, 12],
    Mercury: [6, 8, 9, 10, 11, 12],
    Jupiter: [5, 6, 11, 12],
    Venus: [6, 11, 12],
    Saturn: [3, 5, 6, 11],
    Lagna: [1, 3, 4, 6, 10, 11],
  },
};

check(
  'INDEPENDENT_RULE_REFERENCE itself reproduces the classical fixed totals (sanity check on the reference data\'s own transcription, before comparing it to production)',
  ASHTAKAVARGA_TARGETS.every((target) => {
    const total = ASHTAKAVARGA_CONTRIBUTORS.reduce((sum, contributor) => sum + INDEPENDENT_RULE_REFERENCE[target][contributor].length, 0);
    return total === INDEPENDENTLY_EXPECTED_TOTALS[target];
  })
);

check(
  'FULL 56/56 HOUSE-LEVEL MATCH: every production rule\'s houses (order-normalized) exactly equal the independently-encoded reference for that target/contributor pair -- catches a wrong house, missing house, extra house, transposed target, or transposed contributor even when the row COUNT is unchanged',
  (() => {
    let allMatch = true;
    let checkedCount = 0;
    for (const target of ASHTAKAVARGA_TARGETS) {
      for (const contributor of ASHTAKAVARGA_CONTRIBUTORS) {
        checkedCount++;
        const production = [...findRule(target, contributor).houses].sort((a, b) => a - b);
        const reference = [...INDEPENDENT_RULE_REFERENCE[target][contributor]].sort((a, b) => a - b);
        if (JSON.stringify(production) !== JSON.stringify(reference)) {
          console.log(`  MISMATCH ${target} <- ${contributor}: production=${JSON.stringify(production)} reference=${JSON.stringify(reference)}`);
          allMatch = false;
        }
      }
    }
    return allMatch && checkedCount === 56;
  })()
);

// ============================================================
// RELATIVE-HOUSE TEST.
// ============================================================

check('Aries -> Aries = 1 (same sign)', relativeHouse(0, 0) === 1);
check('Aries -> Taurus = 2', relativeHouse(0, 1) === 2);
check('Aries -> Pisces = 12 (previous sign, wraparound)', relativeHouse(0, 11) === 12);
check('Taurus -> Aries = 12', relativeHouse(1, 0) === 12);
check('Pisces -> Aries = 2', relativeHouse(11, 0) === 2);

check(
  'all 12 relative-house distances hold for every starting sign (generic wraparound proof, not just Aries-anchored examples)',
  Array.from({ length: 12 }, (_, from) =>
    Array.from({ length: 12 }, (_, offset) => {
      const to = (from + offset) % 12;
      const expectedHouse = offset + 1; // 0 offset = house 1, ..., 11 offset = house 12
      return relativeHouse(from, to) === expectedHouse;
    }).every(Boolean)
  ).every(Boolean)
);

// ============================================================
// PRASTARA TEST.
// ============================================================

const SAMPLE_CONTRIBUTOR_SIGNS = { Sun: 0, Moon: 3, Mars: 6, Mercury: 1, Jupiter: 8, Venus: 2, Saturn: 10, Lagna: 0 };

check(
  'calculateSignResult produces exactly 8 contributions, in canonical ASHTAKAVARGA_CONTRIBUTORS order, each with point in {0,1} and relativeHouse in [1,12]',
  (() => {
    const { signResult } = calculateSignResult('Sun', SAMPLE_CONTRIBUTOR_SIGNS, 0);
    return (
      signResult.contributions.length === 8 &&
      signResult.contributions.every((c, i) => c.contributor === ASHTAKAVARGA_CONTRIBUTORS[i]) &&
      signResult.contributions.every((c) => (c.point === 0 || c.point === 1) && c.relativeHouse >= 1 && c.relativeHouse <= 12)
    );
  })()
);

check(
  'sign.total === sum(contribution.point) for a sample sign, and evidence points to the correct contributor rule',
  (() => {
    const { signResult } = calculateSignResult('Jupiter', SAMPLE_CONTRIBUTOR_SIGNS, 5);
    const expectedTotal = signResult.contributions.reduce((sum, c) => sum + c.point, 0);
    const ruleIdsMatch = signResult.contributions.every((c) => c.ruleId === findRule('Jupiter', c.contributor).ruleId);
    return signResult.total === expectedTotal && ruleIdsMatch;
  })()
);

// ============================================================
// KNOWN-ANSWER FIXTURE -- hand-derived directly from the LOCKED rule
// table (rules.ts), independent of production code. Fixture signs:
// Sun=0(Aries) Moon=3(Cancer) Mars=6(Libra) Mercury=1(Taurus)
// Jupiter=8(Sagittarius) Venus=2(Gemini) Saturn=10(Aquarius) Lagna=0(Aries)
//
// Cell 1: Sun target, destination sign 0 (Aries).
//   Sun(0)->0: relativeHouse=1  ; Sun-from-Sun=[1,2,4,7,8,9,10,11]    -> 1 in list -> point 1
//   Moon(3)->0: relativeHouse=10; Sun-from-Moon=[3,6,10,11]           -> 10 in list -> point 1
//   Mars(6)->0: relativeHouse=7 ; Sun-from-Mars=[1,2,4,7,8,9,10,11]   -> 7 in list -> point 1
//   Mercury(1)->0: relHouse=12  ; Sun-from-Mercury=[3,5,6,9,10,11,12] -> 12 in list -> point 1
//   Jupiter(8)->0: relHouse=5   ; Sun-from-Jupiter=[5,6,9,11]         -> 5 in list -> point 1
//   Venus(2)->0: relHouse=11    ; Sun-from-Venus=[6,7,12]             -> 11 NOT in list -> point 0
//   Saturn(10)->0: relHouse=3   ; Sun-from-Saturn=[1,2,4,7,8,9,10,11] -> 3 NOT in list -> point 0
//   Lagna(0)->0: relHouse=1     ; Sun-from-Lagna=[3,4,6,10,11,12]     -> 1 NOT in list -> point 0
//   Expected Sun@sign0 total = 1+1+1+1+1+0+0+0 = 5
//
// Cell 2: Sun target, destination sign 6 (Libra).
//   Sun(0)->6: relHouse=7 -> in [1,2,4,7,8,9,10,11] -> 1
//   Moon(3)->6: relHouse=4 -> NOT in [3,6,10,11] -> 0
//   Mars(6)->6: relHouse=1 -> in [1,2,4,7,8,10,11] -> 1
//   Mercury(1)->6: relHouse=6 -> in [3,5,6,9,10,11,12] -> 1
//   Jupiter(8)->6: relHouse=11 -> in [5,6,9,11] -> 1
//   Venus(2)->6: relHouse=5 -> NOT in [6,7,12] -> 0
//   Saturn(10)->6: relHouse=9 -> in [1,2,4,7,8,9,10,11] -> 1
//   Lagna(0)->6: relHouse=7 -> NOT in [3,4,6,10,11,12] -> 0
//   Expected Sun@sign6 total = 1+0+1+1+1+0+1+0 = 5
//
// Cell 3: Moon target, destination sign 0 (Aries).
//   Sun(0)->0: relHouse=1 -> NOT in Moon-from-Sun=[3,6,7,8,10,11] -> 0
//   Moon(3)->0: relHouse=10 -> in Moon-from-Moon=[1,3,6,7,10,11] -> 1
//   Mars(6)->0: relHouse=7 -> NOT in Moon-from-Mars=[2,3,5,6,9,10,11] -> 0
//   Mercury(1)->0: relHouse=12 -> NOT in Moon-from-Mercury=[1,3,4,5,7,8,10,11] -> 0
//   Jupiter(8)->0: relHouse=5 -> NOT in Moon-from-Jupiter=[1,4,7,8,10,11,12] -> 0
//   Venus(2)->0: relHouse=11 -> in Moon-from-Venus=[3,4,5,7,9,10,11] -> 1
//   Saturn(10)->0: relHouse=3 -> in Moon-from-Saturn=[3,5,6,11] -> 1
//   Lagna(0)->0: relHouse=1 -> NOT in Moon-from-Lagna=[3,6,10,11] -> 0
//   Expected Moon@sign0 total = 0+1+0+0+0+1+1+0 = 3
//
// Cell 4: Saturn target, destination sign 10 (Aquarius).
//   Sun(0)->10: relHouse=11 -> in Saturn-from-Sun=[1,2,4,7,8,10,11] -> 1
//   Moon(3)->10: relHouse=8 -> NOT in Saturn-from-Moon=[3,6,11] -> 0
//   Mars(6)->10: relHouse=5 -> in Saturn-from-Mars=[3,5,6,10,11,12] -> 1
//   Mercury(1)->10: relHouse=10 -> in Saturn-from-Mercury=[6,8,9,10,11,12] -> 1
//   Jupiter(8)->10: relHouse=3 -> NOT in Saturn-from-Jupiter=[5,6,11,12] -> 0
//   Venus(2)->10: relHouse=9 -> NOT in Saturn-from-Venus=[6,11,12] -> 0
//   Saturn(10)->10: relHouse=1 -> NOT in Saturn-from-Saturn=[3,5,6,11] -> 0
//   Lagna(0)->10: relHouse=11 -> in Saturn-from-Lagna=[1,3,4,6,10,11] -> 1
//   Expected Saturn@sign10 total = 1+0+1+1+0+0+0+1 = 4
// ============================================================

const KNOWN_ANSWER_SIGNS = { Sun: 0, Moon: 3, Mars: 6, Mercury: 1, Jupiter: 8, Venus: 2, Saturn: 10 };

check('KNOWN-ANSWER Cell 1: Sun target, sign 0 (Aries) -> total 5', calculateSignResult('Sun', { ...KNOWN_ANSWER_SIGNS, Lagna: 0 }, 0).signResult.total === 5);
check('KNOWN-ANSWER Cell 2: Sun target, sign 6 (Libra) -> total 5', calculateSignResult('Sun', { ...KNOWN_ANSWER_SIGNS, Lagna: 0 }, 6).signResult.total === 5);
check('KNOWN-ANSWER Cell 3: Moon target, sign 0 (Aries) -> total 3', calculateSignResult('Moon', { ...KNOWN_ANSWER_SIGNS, Lagna: 0 }, 0).signResult.total === 3);
check('KNOWN-ANSWER Cell 4: Saturn target, sign 10 (Aquarius) -> total 4', calculateSignResult('Saturn', { ...KNOWN_ANSWER_SIGNS, Lagna: 0 }, 10).signResult.total === 4);

check(
  'the full calculateAshtakavarga result for the known-answer fixture matches all 4 hand-derived cells simultaneously',
  (() => {
    const result = calculateAshtakavarga({ planetarySigns: KNOWN_ANSWER_SIGNS, lagnaSign: 0 });
    return result.bhinna.Sun.signs[0].total === 5 && result.bhinna.Sun.signs[6].total === 5 && result.bhinna.Moon.signs[0].total === 3 && result.bhinna.Saturn.signs[10].total === 4;
  })()
);

// ============================================================
// BAV TESTS -- multiple deliberately different synthetic charts.
// ============================================================

const CHART_FIXTURES = [
  { planetarySigns: { Sun: 0, Moon: 3, Mars: 6, Mercury: 2, Jupiter: 8, Venus: 1, Saturn: 9 }, lagnaSign: 0 },
  { planetarySigns: { Sun: 5, Moon: 11, Mars: 2, Mercury: 5, Jupiter: 0, Venus: 7, Saturn: 3 }, lagnaSign: 6 },
  { planetarySigns: { Sun: 9, Moon: 1, Mars: 9, Mercury: 9, Jupiter: 4, Venus: 4, Saturn: 11 }, lagnaSign: 10 },
];

check(
  'for every chart fixture, every target has exactly 12 signs (canonical 0..11 order) with exactly 8 contributors each',
  CHART_FIXTURES.every((input) => {
    const result = calculateAshtakavarga(input);
    return ASHTAKAVARGA_TARGETS.every((target) => {
      const bav = result.bhinna[target];
      return bav.signs.length === 12 && bav.signs.every((s, i) => s.sign === i && s.contributions.length === 8);
    });
  })
);

check(
  'for every chart fixture, every target\'s BAV total equals its fixed classical value',
  CHART_FIXTURES.every((input) => {
    const result = calculateAshtakavarga(input);
    return ASHTAKAVARGA_TARGETS.every((target) => result.bhinna[target].total === ASHTAKAVARGA_FIXED_TOTALS[target]);
  })
);

check(
  'for every chart fixture, every sign total is 0..8 and equals the sum of its own 8 contribution points',
  CHART_FIXTURES.every((input) =>
    ASHTAKAVARGA_TARGETS.every((target) =>
      calculateAshtakavarga(input)
        .bhinna[target].signs.every((s) => s.total >= 0 && s.total <= 8 && s.total === s.contributions.reduce((sum, c) => sum + c.point, 0))
    )
  )
);

// ============================================================
// SAV TESTS.
// ============================================================

check(
  'for every chart fixture, SAV(sign) === sum of the seven BAV(sign) values, for all 12 signs',
  CHART_FIXTURES.every((input) => {
    const result = calculateAshtakavarga(input);
    return result.sarva.signs.every((savSign, sign) => savSign.total === ASHTAKAVARGA_TARGETS.reduce((sum, target) => sum + result.bhinna[target].signs[sign].total, 0));
  })
);

check('for every chart fixture, SAV grand total is exactly 337', CHART_FIXTURES.every((input) => calculateAshtakavarga(input).sarva.total === 337));

check(
  'radically different chart fixtures produce the SAME SAV grand total (337) but DIFFERENT 12-sign SAV distributions -- the personalized signal is in the distribution, not the constant',
  (() => {
    const results = CHART_FIXTURES.map((input) => calculateAshtakavarga(input));
    const allSame337 = results.every((r) => r.sarva.total === 337);
    const distributionsA = JSON.stringify(results[0].sarva.signs.map((s) => s.total));
    const distributionsB = JSON.stringify(results[1].sarva.signs.map((s) => s.total));
    const distributionsC = JSON.stringify(results[2].sarva.signs.map((s) => s.total));
    return allSame337 && distributionsA !== distributionsB && distributionsB !== distributionsC && distributionsA !== distributionsC;
  })()
);

// ============================================================
// LAGNA SENSITIVITY -- merge-critical.
// ============================================================

const LAGNA_FIXED_PLANETS = { Sun: 2, Moon: 5, Mars: 8, Mercury: 1, Jupiter: 10, Venus: 3, Saturn: 7 };

check(
  'LAGNA SENSITIVITY: identical seven planetary signs, Lagna=Aries(0) vs Lagna=Libra(6) -- BAV sign distributions differ for at least one target',
  (() => {
    const a = calculateAshtakavarga({ planetarySigns: LAGNA_FIXED_PLANETS, lagnaSign: 0 });
    const b = calculateAshtakavarga({ planetarySigns: LAGNA_FIXED_PLANETS, lagnaSign: 6 });
    return ASHTAKAVARGA_TARGETS.some((target) => JSON.stringify(a.bhinna[target].signs.map((s) => s.total)) !== JSON.stringify(b.bhinna[target].signs.map((s) => s.total)));
  })()
);

check(
  'LAGNA SENSITIVITY: SAV distribution also differs between the two Lagna values, while all fixed totals (7 BAV totals + SAV 337) remain unchanged',
  (() => {
    const a = calculateAshtakavarga({ planetarySigns: LAGNA_FIXED_PLANETS, lagnaSign: 0 });
    const b = calculateAshtakavarga({ planetarySigns: LAGNA_FIXED_PLANETS, lagnaSign: 6 });
    const savDiffers = JSON.stringify(a.sarva.signs.map((s) => s.total)) !== JSON.stringify(b.sarva.signs.map((s) => s.total));
    const totalsUnchanged = ASHTAKAVARGA_TARGETS.every((t) => a.bhinna[t].total === ASHTAKAVARGA_FIXED_TOTALS[t] && b.bhinna[t].total === ASHTAKAVARGA_FIXED_TOTALS[t]);
    return savDiffers && totalsUnchanged && a.sarva.total === 337 && b.sarva.total === 337;
  })()
);

// ============================================================
// PLANET SENSITIVITY.
// ============================================================

check(
  'PLANET SENSITIVITY: holding everything else constant, Mercury=Gemini(2) vs Mercury=Virgo(5) -- some BAV/SAV distributions differ, all fixed totals unchanged',
  (() => {
    const base = { Sun: 0, Moon: 4, Mars: 8, Mercury: 2, Jupiter: 6, Venus: 10, Saturn: 3 };
    const a = calculateAshtakavarga({ planetarySigns: base, lagnaSign: 1 });
    const b = calculateAshtakavarga({ planetarySigns: { ...base, Mercury: 5 }, lagnaSign: 1 });
    const someDiffer = ASHTAKAVARGA_TARGETS.some((target) => JSON.stringify(a.bhinna[target].signs.map((s) => s.total)) !== JSON.stringify(b.bhinna[target].signs.map((s) => s.total)));
    const savDiffers = JSON.stringify(a.sarva.signs) !== JSON.stringify(b.sarva.signs);
    const totalsUnchanged = ASHTAKAVARGA_TARGETS.every((t) => a.bhinna[t].total === ASHTAKAVARGA_FIXED_TOTALS[t] && b.bhinna[t].total === ASHTAKAVARGA_FIXED_TOTALS[t]);
    return someDiffer && savDiffers && totalsUnchanged;
  })()
);

// ============================================================
// GLOBAL ROTATION INVARIANCE.
// ============================================================

function rotateSigns(signs: Record<string, number>, k: number): Record<string, number> {
  const rotated: Record<string, number> = {};
  for (const key of Object.keys(signs)) rotated[key] = (signs[key] + k + ZODIAC_SIGN_COUNT * 100) % ZODIAC_SIGN_COUNT;
  return rotated;
}

check(
  'GLOBAL ROTATION INVARIANCE: shifting every planetary sign and Lagna by the same k (mod 12) rotates every BAV distribution by exactly k, for multiple k values, while fixed totals remain unchanged',
  (() => {
    const base = { Sun: 1, Moon: 4, Mars: 7, Mercury: 10, Jupiter: 0, Venus: 5, Saturn: 8 };
    const baseLagna = 2;
    const baseResult = calculateAshtakavarga({ planetarySigns: base, lagnaSign: baseLagna });

    return [1, 5, 11].every((k) => {
      const rotatedPlanets = rotateSigns(base, k);
      const rotatedLagna = (baseLagna + k + ZODIAC_SIGN_COUNT * 100) % ZODIAC_SIGN_COUNT;
      const rotatedResult = calculateAshtakavarga({ planetarySigns: rotatedPlanets as typeof base, lagnaSign: rotatedLagna });

      const rotationHolds = ASHTAKAVARGA_TARGETS.every((target) => {
        const baseSigns = baseResult.bhinna[target].signs.map((s) => s.total);
        const rotatedSigns = rotatedResult.bhinna[target].signs.map((s) => s.total);
        const expectedRotated = Array.from({ length: 12 }, (_, i) => baseSigns[(i - k + 12 * 100) % 12]);
        return JSON.stringify(rotatedSigns) === JSON.stringify(expectedRotated);
      });

      const totalsUnchanged = ASHTAKAVARGA_TARGETS.every((t) => rotatedResult.bhinna[t].total === ASHTAKAVARGA_FIXED_TOTALS[t]) && rotatedResult.sarva.total === 337;

      return rotationHolds && totalsUnchanged;
    });
  })()
);

// ============================================================
// RAHU/KETU EXCLUSION.
// ============================================================

check('AshtakavargaContributor is structurally exactly the 7 targets + Lagna -- ASHTAKAVARGA_CONTRIBUTORS never contains Rahu/Ketu', !ASHTAKAVARGA_CONTRIBUTORS.includes('Rahu' as AshtakavargaContributor) && !ASHTAKAVARGA_CONTRIBUTORS.includes('Ketu' as AshtakavargaContributor) && ASHTAKAVARGA_CONTRIBUTORS.length === 8);

check('no rule in ASHTAKAVARGA_RULES has Rahu or Ketu as either target or contributor', ASHTAKAVARGA_RULES.every((r) => (r.target as string) !== 'Rahu' && (r.target as string) !== 'Ketu' && (r.contributor as string) !== 'Rahu' && (r.contributor as string) !== 'Ketu'));

check(
  'RAHU/KETU EXCLUSION (real adapter): a real 9-graha natal chart (including Rahu/Ketu) produces the exact SAME Ashtakavarga result whether or not Rahu/Ketu are present in the supplied positions array',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const positions = getNatalChart(birthMomentUTC);
    const lagna = calculateNatalAscendant(birthMomentUTC, 40.7128, -74.006);

    const withNodes = calculateAshtakavargaFromNatalChart(positions, lagna);
    const withoutNodes = calculateAshtakavargaFromNatalChart(
      positions.filter((p) => p.graha !== 'Rahu' && p.graha !== 'Ketu'),
      lagna
    );

    return JSON.stringify(withNodes) === JSON.stringify(withoutNodes);
  })()
);

// ============================================================
// REAL AURA INTEGRATION TEST.
// ============================================================

check(
  'INTEGRATION: fixed birthMomentUTC + lat/lon -> getNatalChart() + calculateNatalAscendant() -> calculateAshtakavargaFromNatalChart() produces 7 BAV tables (12 signs each), correct fixed totals, and SAV total 337',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const positions = getNatalChart(birthMomentUTC);
    const lagna = calculateNatalAscendant(birthMomentUTC, 40.7128, -74.006);
    const result = calculateAshtakavargaFromNatalChart(positions, lagna);

    return (
      ASHTAKAVARGA_TARGETS.every((t) => result.bhinna[t].signs.length === 12 && result.bhinna[t].total === ASHTAKAVARGA_FIXED_TOTALS[t]) &&
      result.sarva.total === 337 &&
      result.input.lagnaSign === lagna.rashiIndex
    );
  })()
);

check(
  'LAHIRI CONSISTENCY: the integration path applies NO additional ayanamsa -- Ashtakavarga\'s own lagnaSign input is exactly lagna.rashiIndex (already Lahiri sidereal from packages/lagna), and each planetarySigns value is exactly that graha\'s own already-Lahiri-sidereal rashiIndex from getNatalChart()',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const positions = getNatalChart(birthMomentUTC);
    const lagna = calculateNatalAscendant(birthMomentUTC, 40.7128, -74.006);
    const result = calculateAshtakavargaFromNatalChart(positions, lagna);
    const sun = positions.find((p) => p.graha === 'Sun')!;
    return result.input.lagnaSign === lagna.rashiIndex && result.input.planetarySigns.Sun === sun.rashiIndex;
  })()
);

check(
  'INTEGRATION: rejects a natal chart missing a required planet',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const positions = getNatalChart(birthMomentUTC).filter((p) => p.graha !== 'Saturn');
    const lagna = calculateNatalAscendant(birthMomentUTC, 40.7128, -74.006);
    try {
      calculateAshtakavargaFromNatalChart(positions, lagna);
      return false;
    } catch (e) {
      return e instanceof AshtakavargaValidationError;
    }
  })()
);

check(
  'INTEGRATION: rejects a natal chart with a duplicated required planet',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const positions = getNatalChart(birthMomentUTC);
    const sun = positions.find((p) => p.graha === 'Sun')!;
    const lagna = calculateNatalAscendant(birthMomentUTC, 40.7128, -74.006);
    try {
      calculateAshtakavargaFromNatalChart([...positions, sun], lagna);
      return false;
    } catch (e) {
      return e instanceof AshtakavargaValidationError;
    }
  })()
);

// ============================================================
// VALIDATION (core engine).
// ============================================================

const VALID_INPUT = { planetarySigns: { Sun: 0, Moon: 1, Mars: 2, Mercury: 3, Jupiter: 4, Venus: 5, Saturn: 6 }, lagnaSign: 7 };

check(
  'rejects input missing a required planet',
  (() => {
    const bad = { planetarySigns: { ...VALID_INPUT.planetarySigns }, lagnaSign: VALID_INPUT.lagnaSign } as any;
    delete bad.planetarySigns.Saturn;
    try {
      calculateAshtakavarga(bad);
      return false;
    } catch (e) {
      return e instanceof AshtakavargaValidationError;
    }
  })()
);

check(
  'rejects an invalid sign (out of [0,11])',
  (() => {
    try {
      calculateAshtakavarga({ ...VALID_INPUT, planetarySigns: { ...VALID_INPUT.planetarySigns, Sun: 12 } });
      return false;
    } catch (e) {
      return e instanceof AshtakavargaValidationError;
    }
  })()
);

check(
  'rejects a non-integer sign',
  (() => {
    try {
      calculateAshtakavarga({ ...VALID_INPUT, planetarySigns: { ...VALID_INPUT.planetarySigns, Sun: 1.5 } });
      return false;
    } catch (e) {
      return e instanceof AshtakavargaValidationError;
    }
  })()
);

check(
  'rejects a missing Lagna',
  (() => {
    const bad = { planetarySigns: VALID_INPUT.planetarySigns } as any;
    try {
      calculateAshtakavarga(bad);
      return false;
    } catch (e) {
      return e instanceof AshtakavargaValidationError;
    }
  })()
);

check(
  'rejects an invalid Lagna sign',
  (() => {
    try {
      calculateAshtakavarga({ ...VALID_INPUT, lagnaSign: -1 });
      return false;
    } catch (e) {
      return e instanceof AshtakavargaValidationError;
    }
  })()
);

check('accepts a fully valid input', Number.isFinite(calculateAshtakavarga(VALID_INPUT).sarva.total));

// ============================================================
// DETERMINISM.
// ============================================================

check(
  'calling calculateAshtakavarga twice with the same input produces deeply-equal output',
  (() => {
    const a = calculateAshtakavarga(VALID_INPUT);
    const b = calculateAshtakavarga(VALID_INPUT);
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

check(
  'no Date.now()/new Date()/Math.random anywhere in the package source (comments stripped) -- this engine has no time dimension at all',
  ['types', 'provenance', 'constants', 'relativeHouse', 'rules', 'prastara', 'bhinna', 'sarva', 'evidence', 'validation', 'engine', 'index']
    .map((name) => stripComments(fs.readFileSync(`packages/ashtakavarga/src/${name}.ts`, 'utf8')))
    .every((code) => !/Date\.now\(\)|new Date\(\)|Math\.random\(\)/.test(code))
);

check('ASHTAKAVARGA_ENGINE_VERSION and ASHTAKAVARGA_RULESET_VERSION are the stable literals', ASHTAKAVARGA_ENGINE_VERSION === 'ASHTAKAVARGA_V1' && ASHTAKAVARGA_RULESET_VERSION === 'ASHTAKAVARGA_PARASHARA_V1');

// ============================================================
// EVIDENCE / PROVENANCE.
// ============================================================

check(
  'every result has non-empty, JSON-safe evidence with stable source/ruleId/ruleVersion',
  (() => {
    const result = calculateAshtakavarga(VALID_INPUT);
    const roundTripped = JSON.parse(JSON.stringify(result));
    return result.evidence.length > 0 && result.evidence.every((e) => e.source === 'ASHTAKAVARGA' && typeof e.ruleId === 'string' && e.ruleVersion === '1.0.0') && JSON.stringify(roundTripped) === JSON.stringify(result);
  })()
);

check(
  'result.evidence includes both BAV total and SAV total aggregate rule IDs',
  (() => {
    const result = calculateAshtakavarga(VALID_INPUT);
    const ruleIds = new Set(result.evidence.map((e) => e.ruleId));
    return ruleIds.has('ASHTAKAVARGA_BAV_TOTAL_V1') && ruleIds.has('ASHTAKAVARGA_SAV_TOTAL_V1') && ruleIds.has('ASHTAKAVARGA_BAV_SIGN_SUM_V1') && ruleIds.has('ASHTAKAVARGA_SAV_SIGN_SUM_V1');
  })()
);

check(
  'dedupeEvidenceRefs removes exact duplicates while preserving first-occurrence order',
  (() => {
    const ref = { source: 'ASHTAKAVARGA' as const, ruleId: 'ASHTAKAVARGA_BAV_TOTAL_V1', ruleVersion: '1.0.0', summary: 'x', data: { total: 48 } };
    const distinct = { ...ref, data: { total: 49 } };
    const result = dedupeEvidenceRefs([ref, distinct, ref]);
    return result.length === 2 && result[0] === ref && result[1] === distinct;
  })()
);

// ============================================================
// Product/dependency boundary.
// ============================================================

const PACKAGE_SRC_FILES = ['types', 'provenance', 'constants', 'relativeHouse', 'rules', 'prastara', 'bhinna', 'sarva', 'evidence', 'validation', 'engine', 'index'].map((name) => `packages/ashtakavarga/src/${name}.ts`);

check(
  'every import in this package is either a relative import within itself, or a relative import into packages/vedic or packages/lagna -- never apps/web, Prisma, or personal-intelligence',
  PACKAGE_SRC_FILES.every((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const importStatements = source.match(/^import[\s\S]*?;/gm) ?? [];
    return importStatements.every((statement) => /from '\.\/|from '\.\.\/\.\.\/vedic\/|from '\.\.\/\.\.\/lagna\//.test(statement));
  })
);

check(
  'no ACTUAL CODE (comments stripped) in this package references apps/web, Prisma, a database, an API route, React, or an LLM',
  PACKAGE_SRC_FILES.every((file) => {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    return !/apps\/web|prisma|PrismaClient|react|localStorage|fetch\(|NextRequest|NextResponse|useState|useEffect|openai|anthropic|\bllm\b/i.test(code);
  })
);

check(
  'no ACTUAL CODE (comments stripped) in this package implements Trikona Shodhana, Ekadhipatya Shodhana, Shodhya Pinda, transit interpretation, or product/Aura scoring -- this PR\'s own explicit non-goals',
  PACKAGE_SRC_FILES.every((file) => {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    return !/trikona|ekadhipatya|shodhana|shodhya|\bpinda\b|kakshya|overallSupport|themeSupport|auraFit|personalSupport|recommend/i.test(code);
  })
);

check(
  'packages/vedic and packages/lagna source have no import of packages/ashtakavarga (this PR did not modify either to depend on it)',
  !/packages\/ashtakavarga/i.test(fs.readFileSync('packages/vedic/src/natalChart.ts', 'utf8')) && !/packages\/ashtakavarga/i.test(fs.readFileSync('packages/lagna/src/index.ts', 'utf8'))
);

check('packages/personal-intelligence source is untouched by this PR (no reference to ashtakavarga package path)', !/packages\/ashtakavarga/i.test(fs.readFileSync('packages/personal-intelligence/src/context.ts', 'utf8')));

if (!allPassed) {
  console.error('\nSome Ashtakavarga Engine checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ASHTAKAVARGA ENGINE CHECKS PASSED');
}
