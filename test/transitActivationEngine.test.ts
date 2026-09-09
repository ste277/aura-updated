/**
 * Transit Activation Engine V1: regression suite for
 * packages/transit-activation/src -- deterministically detects
 * sign-level transit-to-natal activation geometry from already-known
 * sidereal Rashi placements plus an explicit evaluation instant. See
 * packages/transit-activation/README.md for the full convention (reuse
 * of packages/bhrigu's own sign-relationship classification/weights,
 * 9 canonical planets including Rahu/Ketu, directional transiting->natal
 * pair identity, [start,end)-free sign-only geometry) this suite
 * verifies against.
 *
 * "Independent strength table" (per this PR's own brief): the expected
 * relationship-strength table below is a bare, hard-coded literal
 * (matching packages/bhrigu's own published DEFAULT_RELATIONSHIP_WEIGHTS
 * documentation), never derived by calling production code.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

import { getNatalChart } from '../packages/vedic/src/natalChart';

import {
  calculateTransitActivation,
  calculateTransitActivationFromPositions,
  evaluatePair,
  evaluateAllPairs,
  classifyTransitRelationship,
  transitRelationshipStrength,
  transitRelationshipRuleId,
  dedupeEvidenceRefs,
  TRANSIT_ACTIVATION_ENGINE_VERSION,
  TRANSIT_RELATIONSHIP_RULESET_VERSION,
  TRANSIT_ACTIVATION_PLANETS,
  TRANSIT_ACTIVATION_PLANET_COUNT,
  TRANSIT_ACTIVATION_PAIR_COUNT,
  TransitActivationValidationError,
} from '../packages/transit-activation/src/index';
import type { TransitActivationPlanet, TransitRelationship } from '../packages/transit-activation/src/index';

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const ALL_PLANETS: readonly TransitActivationPlanet[] = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu'];

function synthSigns(values: readonly number[]): Record<TransitActivationPlanet, number> {
  const signs = {} as Record<TransitActivationPlanet, number>;
  ALL_PLANETS.forEach((p, i) => (signs[p] = values[i]));
  return signs;
}

// ============================================================
// Constants / canonical planet set.
// ============================================================

check('TRANSIT_ACTIVATION_PLANETS is exactly the 9 canonical grahas, Sun..Ketu, in canonical order', JSON.stringify(TRANSIT_ACTIVATION_PLANETS) === JSON.stringify(ALL_PLANETS));
check('TRANSIT_ACTIVATION_PLANET_COUNT is 9', TRANSIT_ACTIVATION_PLANET_COUNT === 9);
check('TRANSIT_ACTIVATION_PAIR_COUNT is 81 (9x9)', TRANSIT_ACTIVATION_PAIR_COUNT === 81);
check('TRANSIT_ACTIVATION_ENGINE_VERSION is the stable literal', TRANSIT_ACTIVATION_ENGINE_VERSION === 'TRANSIT_ACTIVATION_V1');
check('TRANSIT_RELATIONSHIP_RULESET_VERSION is the stable literal', TRANSIT_RELATIONSHIP_RULESET_VERSION === 'TRANSIT_RELATIONSHIP_RULESET_V1');

// ============================================================
// RELATIONSHIP MAPPING -- all 12 sign distances.
//
// Independently hard-coded expected mapping (matching packages/bhrigu's
// own PUBLISHED classifyRelationship documentation -- not re-derived by
// calling production code to generate "expected"):
//   0            -> SAME_SIGN
//   1, 11        -> TWO_TWELVE
//   2, 10        -> THREE_ELEVEN
//   3, 5, 7, 9   -> NONE
//   4, 8         -> TRINE
//   6            -> OPPOSITION
// ============================================================

const EXPECTED_RELATIONSHIP_BY_DISTANCE: Record<number, TransitRelationship> = {
  0: 'SAME_SIGN',
  1: 'TWO_TWELVE',
  2: 'THREE_ELEVEN',
  3: 'NONE',
  4: 'TRINE',
  5: 'NONE',
  6: 'OPPOSITION',
  7: 'NONE',
  8: 'TRINE',
  9: 'NONE',
  10: 'THREE_ELEVEN',
  11: 'TWO_TWELVE',
};

check(
  'all 12 sign distances map to the expected relationship, for a representative natal sign (0) -- catches reversed subtraction, off-by-one, wrong trine/opposition mapping, 2/12 vs 3/11 confusion',
  Object.entries(EXPECTED_RELATIONSHIP_BY_DISTANCE).every(([distance, expected]) => classifyTransitRelationship(0, Number(distance)) === expected)
);

check(
  'the same 12-distance mapping holds for a DIFFERENT natal sign anchor (7), proving the mapping is relative, not absolute',
  Object.entries(EXPECTED_RELATIONSHIP_BY_DISTANCE).every(([distance, expected]) => classifyTransitRelationship(7, (7 + Number(distance)) % 12) === expected)
);

// ============================================================
// STRENGTH TABLE -- independently encoded, never imported from
// production's own weight source.
// ============================================================

const EXPECTED_STRENGTH: Record<TransitRelationship, number> = {
  SAME_SIGN: 1.0,
  TRINE: 0.75,
  OPPOSITION: 0.5,
  THREE_ELEVEN: 0.25,
  TWO_TWELVE: 0.15,
  NONE: 0.0,
};

check(
  'transitRelationshipStrength matches the independently-encoded expected strength table for every relationship category',
  (Object.keys(EXPECTED_STRENGTH) as TransitRelationship[]).every((rel) => transitRelationshipStrength(rel) === EXPECTED_STRENGTH[rel])
);

check(
  'transitRelationshipRuleId returns a distinct, stable, non-empty rule id for every relationship category',
  (() => {
    const ids = (Object.keys(EXPECTED_STRENGTH) as TransitRelationship[]).map((rel) => transitRelationshipRuleId(rel));
    return ids.every((id) => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length;
  })()
);

// ============================================================
// DIRECTION -- activation identity preserves transiting/natal roles
// even when relationship geometry is identical.
// ============================================================

check(
  'DIRECTION: transiting A at sign X, natal B at sign Y produces a DIFFERENT activation identity than transiting B at sign X, natal A at sign Y, even though the relationship CATEGORY is the same geometry either way',
  (() => {
    const pairAB = evaluatePair('Saturn', 'Moon', 4, 0); // transiting Saturn (sign 4) -> natal Moon (sign 0)
    const pairBA = evaluatePair('Moon', 'Saturn', 4, 0); // transiting Moon (sign 4) -> natal Saturn (sign 0)
    return (
      pairAB.transitingPlanet === 'Saturn' &&
      pairAB.natalPlanet === 'Moon' &&
      pairBA.transitingPlanet === 'Moon' &&
      pairBA.natalPlanet === 'Saturn' &&
      pairAB.relationship === pairBA.relationship && // same geometric category (TRINE, distance 4)
      JSON.stringify(pairAB) !== JSON.stringify(pairBA) // but distinct activation records
    );
  })()
);

check(
  'DIRECTION: swapping which planet is "transiting" and which is "natal" changes the reported transitSign/natalSign roles even when the raw sign VALUES are swapped correspondingly',
  (() => {
    const pair1 = evaluatePair('Jupiter', 'Venus', 3, 9); // transit sign 3, natal sign 9
    const pair2 = evaluatePair('Venus', 'Jupiter', 9, 3); // transit sign 9, natal sign 3 (roles swapped)
    return pair1.transitSign === 3 && pair1.natalSign === 9 && pair2.transitSign === 9 && pair2.natalSign === 3;
  })()
);

// ============================================================
// ALL PAIRS -- exactly N x N, no missing self-pairs, no duplicates.
// ============================================================

const SAMPLE_NATAL = synthSigns([0, 3, 1, 2, 6, 8, 9, 5, 11]);
const SAMPLE_TRANSIT = synthSigns([6, 3, 4, 7, 0, 0, 9, 10, 4]);

check('evaluateAllPairs returns exactly 81 pairs for the full 9-planet set', evaluateAllPairs(SAMPLE_NATAL, SAMPLE_TRANSIT).length === 81);

check(
  'evaluateAllPairs includes every (transitingPlanet, natalPlanet) combination exactly once -- no missing pair, no duplicate pair',
  (() => {
    const pairs = evaluateAllPairs(SAMPLE_NATAL, SAMPLE_TRANSIT);
    const keys = new Set(pairs.map((p) => `${p.transitingPlanet}|${p.natalPlanet}`));
    return keys.size === 81 && ALL_PLANETS.every((t) => ALL_PLANETS.every((n) => keys.has(`${t}|${n}`)));
  })()
);

check(
  'no self-pair is accidentally skipped -- every transiting X -> natal X pair is present and evaluated normally (e.g. a "return"-type event)',
  (() => {
    const pairs = evaluateAllPairs(SAMPLE_NATAL, SAMPLE_TRANSIT);
    return ALL_PLANETS.every((p) => pairs.some((pair) => pair.transitingPlanet === p && pair.natalPlanet === p));
  })()
);

check(
  'the public engine\'s own returned activations are EXACTLY the non-NONE subset of the full 81-pair evaluation -- no missing, no extra',
  (() => {
    const allPairs = evaluateAllPairs(SAMPLE_NATAL, SAMPLE_TRANSIT);
    const expectedNonNone = allPairs.filter((p) => p.relationship !== 'NONE');
    const result = calculateTransitActivation({ natalSigns: SAMPLE_NATAL, transitSigns: SAMPLE_TRANSIT, evaluationTime: '2026-01-01T00:00:00.000Z' });
    const resultKeys = new Set(result.activations.map((p) => `${p.transitingPlanet}|${p.natalPlanet}`));
    const expectedKeys = new Set(expectedNonNone.map((p) => `${p.transitingPlanet}|${p.natalPlanet}`));
    return resultKeys.size === expectedKeys.size && [...resultKeys].every((k) => expectedKeys.has(k)) && result.activations.every((p) => p.relationship !== 'NONE');
  })()
);

// ============================================================
// SAME_SIGN / TRINE / OPPOSITION / THREE_ELEVEN / TWO_TWELVE / NONE.
// ============================================================

check(
  'SAME_SIGN: transiting Jupiter sign == natal Moon sign -> relationship SAME_SIGN, strength 1.0, correct planet identities',
  (() => {
    const pair = evaluatePair('Jupiter', 'Moon', 5, 5);
    return pair.relationship === 'SAME_SIGN' && pair.strength === 1.0 && pair.transitingPlanet === 'Jupiter' && pair.natalPlanet === 'Moon' && pair.ruleId === transitRelationshipRuleId('SAME_SIGN');
  })()
);

check(
  'TRINE (distance 4): natal Aries(0), transit Leo(4) -> TRINE, strength 0.75',
  (() => {
    const pair = evaluatePair('Mars', 'Sun', 4, 0);
    return pair.relationship === 'TRINE' && pair.strength === 0.75;
  })()
);

check(
  'TRINE wraparound (distance 8): natal Sagittarius(8), transit Aries(0) -> TRINE, strength 0.75',
  (() => {
    const pair = evaluatePair('Venus', 'Saturn', 0, 8);
    return pair.relationship === 'TRINE' && pair.strength === 0.75;
  })()
);

check(
  'OPPOSITION (distance 6, exact 7th sign): natal Aries(0), transit Libra(6) -> OPPOSITION, strength 0.5',
  (() => {
    const pair = evaluatePair('Saturn', 'Sun', 6, 0);
    return pair.relationship === 'OPPOSITION' && pair.strength === 0.5;
  })()
);

check(
  'THREE_ELEVEN both directions (+2 and +10) map to the SAME category and strength',
  (() => {
    const plus2 = evaluatePair('Mercury', 'Venus', 2, 0);
    const plus10 = evaluatePair('Mercury', 'Venus', 10, 0);
    return plus2.relationship === 'THREE_ELEVEN' && plus10.relationship === 'THREE_ELEVEN' && plus2.strength === 0.25 && plus10.strength === 0.25;
  })()
);

check(
  'TWO_TWELVE both directions (+1 and +11) map to the SAME category and strength',
  (() => {
    const plus1 = evaluatePair('Rahu', 'Ketu', 1, 0);
    const plus11 = evaluatePair('Rahu', 'Ketu', 11, 0);
    return plus1.relationship === 'TWO_TWELVE' && plus11.relationship === 'TWO_TWELVE' && plus1.strength === 0.15 && plus11.strength === 0.15;
  })()
);

check(
  'NONE: a deliberately unmapped distance (e.g. 3) classifies as NONE with strength 0, and is EXCLUDED from the public engine\'s own returned activations',
  (() => {
    const pair = evaluatePair('Mars', 'Jupiter', 3, 0);
    const result = calculateTransitActivation({ natalSigns: synthSigns([0, 0, 0, 0, 0, 0, 0, 0, 0]), transitSigns: synthSigns([3, 3, 3, 3, 3, 3, 3, 3, 3]), evaluationTime: '2026-01-01T00:00:00.000Z' });
    return pair.relationship === 'NONE' && pair.strength === 0 && result.activations.length === 0;
  })()
);

check(
  'SELF-PLANET: transiting Saturn -> natal Saturn is evaluated normally (not skipped) and can itself be SAME_SIGN (a "return"-type event) when signs coincide',
  (() => {
    const pair = evaluatePair('Saturn', 'Saturn', 7, 7);
    return pair.transitingPlanet === 'Saturn' && pair.natalPlanet === 'Saturn' && pair.relationship === 'SAME_SIGN';
  })()
);

check(
  'SELF-PLANET: transiting Saturn -> natal Saturn is STILL evaluated (never silently skipped) even when the current transit sign differs from the natal sign',
  (() => {
    const pair = evaluatePair('Saturn', 'Saturn', 7, 2);
    return pair.transitingPlanet === 'Saturn' && pair.natalPlanet === 'Saturn' && pair.relationship !== undefined;
  })()
);

// ============================================================
// RAHU/KETU -- included in V1 (unlike packages/ashtakavarga), tested
// explicitly in both transiting and natal roles.
// ============================================================

check(
  'RAHU/KETU: transiting Rahu -> natal planet is evaluated with the same relationship logic as any other planet',
  (() => {
    const pair = evaluatePair('Rahu', 'Sun', 4, 0);
    return pair.relationship === 'TRINE' && pair.strength === 0.75;
  })()
);

check(
  'RAHU/KETU: transiting planet -> natal Rahu is evaluated with the same relationship logic',
  (() => {
    const pair = evaluatePair('Jupiter', 'Rahu', 6, 0);
    return pair.relationship === 'OPPOSITION' && pair.strength === 0.5;
  })()
);

check(
  'RAHU/KETU: transiting Ketu -> natal Ketu (self-pair) is evaluated like any other self-pair',
  (() => {
    const pair = evaluatePair('Ketu', 'Ketu', 3, 3);
    return pair.relationship === 'SAME_SIGN';
  })()
);

check('RAHU and KETU are present in TRANSIT_ACTIVATION_PLANETS (explicit V1 inclusion, unlike packages/ashtakavarga)', TRANSIT_ACTIVATION_PLANETS.includes('Rahu') && TRANSIT_ACTIVATION_PLANETS.includes('Ketu'));

// ============================================================
// VALIDATION.
// ============================================================

const VALID_INPUT = { natalSigns: SAMPLE_NATAL, transitSigns: SAMPLE_TRANSIT, evaluationTime: '2026-01-01T00:00:00.000Z' };

check(
  'rejects natalSigns missing a required planet',
  (() => {
    const bad = { ...SAMPLE_NATAL } as any;
    delete bad.Saturn;
    try {
      calculateTransitActivation({ ...VALID_INPUT, natalSigns: bad });
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })()
);

check(
  'rejects transitSigns missing a required planet',
  (() => {
    const bad = { ...SAMPLE_TRANSIT } as any;
    delete bad.Rahu;
    try {
      calculateTransitActivation({ ...VALID_INPUT, transitSigns: bad });
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })()
);

check(
  'rejects invalid signs: -1, 12, 1.5, NaN, Infinity',
  [-1, 12, 1.5, NaN, Infinity].every((badSign) => {
    try {
      calculateTransitActivation({ ...VALID_INPUT, natalSigns: { ...SAMPLE_NATAL, Sun: badSign } });
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })
);

check('accepts valid boundary signs: 0 and 11', Number.isFinite(calculateTransitActivation({ ...VALID_INPUT, natalSigns: { ...SAMPLE_NATAL, Sun: 0, Moon: 11 } }).activations.length));

check(
  'rejects a malformed evaluationTime (non-parseable string)',
  (() => {
    try {
      calculateTransitActivation({ ...VALID_INPUT, evaluationTime: 'not-a-date' });
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })()
);

check(
  'rejects an empty evaluationTime',
  (() => {
    try {
      calculateTransitActivation({ ...VALID_INPUT, evaluationTime: '' });
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })()
);

// ============================================================
// ADAPTER -- duplicate/missing planet validation on real GrahaPosition[].
// ============================================================

check(
  'ADAPTER: rejects a natal chart missing a required planet',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const evaluationInstant = new Date('2026-09-09T12:00:00.000Z');
    const natalPositions = getNatalChart(birthMomentUTC).filter((p) => p.graha !== 'Saturn');
    const transitPositions = getNatalChart(evaluationInstant);
    try {
      calculateTransitActivationFromPositions(natalPositions, transitPositions, evaluationInstant);
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })()
);

check(
  'ADAPTER: rejects a transit chart with a duplicated required planet',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const evaluationInstant = new Date('2026-09-09T12:00:00.000Z');
    const natalPositions = getNatalChart(birthMomentUTC);
    const transitPositions = getNatalChart(evaluationInstant);
    const sun = transitPositions.find((p) => p.graha === 'Sun')!;
    try {
      calculateTransitActivationFromPositions(natalPositions, [...transitPositions, sun], evaluationInstant);
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })()
);

check(
  'ADAPTER: rejects a NATAL chart with a duplicated required planet (not just a transit chart)',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const evaluationInstant = new Date('2026-09-09T12:00:00.000Z');
    const natalPositions = getNatalChart(birthMomentUTC);
    const transitPositions = getNatalChart(evaluationInstant);
    const moon = natalPositions.find((p) => p.graha === 'Moon')!;
    try {
      calculateTransitActivationFromPositions([...natalPositions, moon], transitPositions, evaluationInstant);
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })()
);

check(
  'ADAPTER: rejects an invalid evaluationTimeUTC Date',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const natalPositions = getNatalChart(birthMomentUTC);
    try {
      calculateTransitActivationFromPositions(natalPositions, natalPositions, new Date('not-a-date'));
      return false;
    } catch (e) {
      return e instanceof TransitActivationValidationError;
    }
  })()
);

check(
  'ADAPTER ARRAY-ORDER INVARIANCE: shuffling the order of entries within the natal and transit GrahaPosition[] arrays does not change the result (the adapter filters by graha identity, never relies on array index)',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const evaluationInstant = new Date('2026-09-09T12:00:00.000Z');
    const natalPositions = getNatalChart(birthMomentUTC);
    const transitPositions = getNatalChart(evaluationInstant);

    const reversedNatal = [...natalPositions].reverse();
    const shuffledTransit = [...transitPositions].sort((a, b) => a.graha.localeCompare(b.graha));

    const a = calculateTransitActivationFromPositions(natalPositions, transitPositions, evaluationInstant);
    const b = calculateTransitActivationFromPositions(reversedNatal, shuffledTransit, evaluationInstant);

    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

// ============================================================
// DETERMINISM / EXPLICIT EVALUATION TIME / TIMEZONE INDEPENDENCE.
// ============================================================

check(
  'repeated calls with the same input produce deeply-equal output',
  (() => {
    const a = calculateTransitActivation(VALID_INPUT);
    const b = calculateTransitActivation(VALID_INPUT);
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

check(
  'no Date.now()/new Date() with no args/Math.random anywhere in the package source (comments stripped) -- evaluationTime is always caller-supplied, never inferred',
  ['types', 'provenance', 'constants', 'relationships', 'activation', 'evidence', 'validation', 'engine', 'adapter', 'index']
    .map((name) => stripComments(fs.readFileSync(`packages/transit-activation/src/${name}.ts`, 'utf8')))
    .every((code) => !/Date\.now\(\)|new Date\(\)(?!\.)|Math\.random\(\)/.test(code))
);

check(
  'TIMEZONE INDEPENDENCE: constructing the same evaluation instant via Date.UTC vs an explicit +00:00 ISO string produces identical adapter output',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const natalPositions = getNatalChart(birthMomentUTC);
    const a = calculateTransitActivationFromPositions(natalPositions, getNatalChart(new Date(Date.UTC(2026, 8, 9, 12, 0, 0))), new Date(Date.UTC(2026, 8, 9, 12, 0, 0)));
    const b = calculateTransitActivationFromPositions(natalPositions, getNatalChart(new Date('2026-09-09T12:00:00.000+00:00')), new Date('2026-09-09T12:00:00.000+00:00'));
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

// ============================================================
// REAL NATAL + TRANSIT INTEGRATION.
// ============================================================

check(
  'INTEGRATION: fixed birth instant + fixed evaluation instant -> getNatalChart() (natal) + getNatalChart() (transit) -> adapter produces valid activations with valid signs, categories, and strengths',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const evaluationInstant = new Date('2026-09-09T12:00:00.000Z');
    const natalPositions = getNatalChart(birthMomentUTC);
    const transitPositions = getNatalChart(evaluationInstant);
    const result = calculateTransitActivationFromPositions(natalPositions, transitPositions, evaluationInstant);

    return (
      result.evaluationTime === evaluationInstant.toISOString() &&
      result.activations.length > 0 &&
      result.activations.every(
        (a) =>
          ALL_PLANETS.includes(a.transitingPlanet) &&
          ALL_PLANETS.includes(a.natalPlanet) &&
          a.transitSign >= 0 &&
          a.transitSign <= 11 &&
          a.natalSign >= 0 &&
          a.natalSign <= 11 &&
          a.relationship !== 'NONE' &&
          a.strength > 0 &&
          a.strength <= 1
      )
    );
  })()
);

// ============================================================
// TRANSIT TIME SENSITIVITY / NATAL SENSITIVITY.
// ============================================================

check(
  'TRANSIT TIME SENSITIVITY: two evaluation instants separated by ~90 days (enough for at least one fast-moving planet to change sidereal sign) produce a DIFFERENT activation set',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const natalPositions = getNatalChart(birthMomentUTC);
    const t1 = new Date('2026-01-01T00:00:00.000Z');
    const t2 = new Date('2026-04-01T00:00:00.000Z');
    const r1 = calculateTransitActivationFromPositions(natalPositions, getNatalChart(t1), t1);
    const r2 = calculateTransitActivationFromPositions(natalPositions, getNatalChart(t2), t2);
    return JSON.stringify(r1.activations) !== JSON.stringify(r2.activations);
  })()
);

check(
  'NATAL SENSITIVITY: holding transit signs fixed, changing one natal planet\'s sign changes at least one activation involving that natal planet, while unrelated pairs remain stable',
  (() => {
    const base = calculateTransitActivation({ natalSigns: SAMPLE_NATAL, transitSigns: SAMPLE_TRANSIT, evaluationTime: '2026-01-01T00:00:00.000Z' });
    const changedNatal = { ...SAMPLE_NATAL, Moon: (SAMPLE_NATAL.Moon + 5) % 12 };
    const changed = calculateTransitActivation({ natalSigns: changedNatal, transitSigns: SAMPLE_TRANSIT, evaluationTime: '2026-01-01T00:00:00.000Z' });

    const baseMoonPairs = base.activations.filter((a) => a.natalPlanet === 'Moon');
    const changedMoonPairs = changed.activations.filter((a) => a.natalPlanet === 'Moon');
    const moonPairsChanged = JSON.stringify(baseMoonPairs) !== JSON.stringify(changedMoonPairs);

    const baseSaturnPairs = base.activations.filter((a) => a.natalPlanet === 'Saturn');
    const changedSaturnPairs = changed.activations.filter((a) => a.natalPlanet === 'Saturn');
    const unrelatedStable = JSON.stringify(baseSaturnPairs) === JSON.stringify(changedSaturnPairs);

    return moonPairsChanged && unrelatedStable;
  })()
);

// ============================================================
// GLOBAL ROTATION INVARIANCE -- merge-critical.
// ============================================================

function rotateSigns(signs: Record<TransitActivationPlanet, number>, k: number): Record<TransitActivationPlanet, number> {
  const rotated = {} as Record<TransitActivationPlanet, number>;
  for (const p of ALL_PLANETS) rotated[p] = (signs[p] + k + 1200) % 12;
  return rotated;
}

check(
  'GLOBAL ROTATION INVARIANCE: shifting every natal sign and every transit sign by the same k (mod 12) leaves every relationship category and strength unchanged, for k = 1, 5, 11',
  (() => {
    const base = calculateTransitActivation({ natalSigns: SAMPLE_NATAL, transitSigns: SAMPLE_TRANSIT, evaluationTime: '2026-01-01T00:00:00.000Z' });
    return [1, 5, 11].every((k) => {
      const rotated = calculateTransitActivation({ natalSigns: rotateSigns(SAMPLE_NATAL, k), transitSigns: rotateSigns(SAMPLE_TRANSIT, k), evaluationTime: '2026-01-01T00:00:00.000Z' });
      const baseIdentities = base.activations.map((a) => `${a.transitingPlanet}|${a.natalPlanet}|${a.relationship}|${a.strength}`);
      const rotatedIdentities = rotated.activations.map((a) => `${a.transitingPlanet}|${a.natalPlanet}|${a.relationship}|${a.strength}`);
      return JSON.stringify(baseIdentities) === JSON.stringify(rotatedIdentities);
    });
  })()
);

check(
  'GLOBAL ROTATION INVARIANCE: signs reported in evidence rotate by exactly k',
  (() => {
    const base = calculateTransitActivation({ natalSigns: SAMPLE_NATAL, transitSigns: SAMPLE_TRANSIT, evaluationTime: '2026-01-01T00:00:00.000Z' });
    const k = 5;
    const rotated = calculateTransitActivation({ natalSigns: rotateSigns(SAMPLE_NATAL, k), transitSigns: rotateSigns(SAMPLE_TRANSIT, k), evaluationTime: '2026-01-01T00:00:00.000Z' });
    return base.activations.every((a, i) => rotated.activations[i].transitSign === (a.transitSign + k) % 12 && rotated.activations[i].natalSign === (a.natalSign + k) % 12);
  })()
);

// ============================================================
// NO POLARITY / NO INTERPRETATION.
// ============================================================

check(
  'no interpretive polarity/favorability language anywhere in package source (comments stripped) -- strength is activation geometry, not outcome polarity',
  ['types', 'provenance', 'constants', 'relationships', 'activation', 'evidence', 'validation', 'engine', 'adapter', 'index']
    .map((name) => stripComments(fs.readFileSync(`packages/transit-activation/src/${name}.ts`, 'utf8')))
    .every((code) => !/favorable|unfavorable|\bgood\b|\bbad\b|\bpositive\b|\bnegative\b|lucky|unlucky|dangerous|excellent/i.test(code))
);

// ============================================================
// PAYLOAD SIZE DISCIPLINE.
// ============================================================

check(
  'PAYLOAD SIZE: a representative real 9x9 evaluation result serializes to well under 100KB (compact activation records, no embedded upstream chart/graph/Ashtakavarga payloads) -- contrast with packages/ashtakavarga\'s own much larger ~610KB full-explainability result',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const evaluationInstant = new Date('2026-09-09T12:00:00.000Z');
    const result = calculateTransitActivationFromPositions(getNatalChart(birthMomentUTC), getNatalChart(evaluationInstant), evaluationInstant);
    const size = JSON.stringify(result).length;
    console.log(`    (approximate serialized size: ${size} characters / ~${Math.round(size / 1024)}KB)`);
    return size < 100_000;
  })()
);

// ============================================================
// PERSONAL INTELLIGENCE ADAPTER: deliberately NOT built in V1.
//
// See packages/transit-activation/README.md's "Personal Intelligence
// adapter -- deferred" section: TRANSIT_ACTIVATION_CONTEXT_V1 has no
// typed field for natalPlanet/relationship identity, so no
// toTransitActivationContext export exists to test here. Confirm the
// package's own public surface stays exactly as documented (no
// personal-intelligence-shaped export slipped back in).
// ============================================================

check(
  'PERSONAL INTELLIGENCE ADAPTER DEFERRED: package index does not export any toTransitActivationContext (or similarly-named) function',
  (() => {
    const indexSrc = fs.readFileSync(require.resolve('../packages/transit-activation/src/index'), 'utf8');
    return !/toTransitActivationContext/.test(indexSrc);
  })()
);

check(
  'PERSONAL INTELLIGENCE ADAPTER DEFERRED: adapter.ts has no actual import statement from packages/personal-intelligence (mentioning it in the doc comment explaining the deferral is fine; importing from it is not)',
  !/import[^;]*from\s+['"][^'"]*personal-intelligence[^'"]*['"]/.test(stripComments(fs.readFileSync(require.resolve('../packages/transit-activation/src/adapter'), 'utf8')))
);

// ============================================================
// EVIDENCE / PROVENANCE.
// ============================================================

check(
  'every activation has non-empty, JSON-safe evidence with stable source/ruleId/ruleVersion',
  (() => {
    const result = calculateTransitActivation(VALID_INPUT);
    const roundTripped = JSON.parse(JSON.stringify(result));
    return result.activations.every((a) => a.evidence.length > 0 && a.evidence.every((e) => e.source === 'TRANSIT_ACTIVATION' && typeof e.ruleId === 'string' && e.ruleVersion === '1.0.0')) && JSON.stringify(roundTripped) === JSON.stringify(result);
  })()
);

check(
  'result.evidence includes a summary evidence entry naming the evaluation time, evaluated planet count, pair count, and activation count',
  (() => {
    const result = calculateTransitActivation(VALID_INPUT);
    const summary = result.evidence.find((e) => e.ruleId === 'TRANSIT_ACTIVATION_SUMMARY_V1');
    return summary !== undefined && summary.data?.evaluationTime === VALID_INPUT.evaluationTime && summary.data?.pairCount === 81;
  })()
);

check(
  'dedupeEvidenceRefs removes exact duplicates while preserving first-occurrence order',
  (() => {
    const ref = { source: 'TRANSIT_ACTIVATION' as const, ruleId: 'TRANSIT_ACTIVATION_TRINE_V1', ruleVersion: '1.0.0', summary: 'x', data: { a: 1 } };
    const distinct = { ...ref, data: { a: 2 } };
    const result = dedupeEvidenceRefs([ref, distinct, ref]);
    return result.length === 2 && result[0] === ref && result[1] === distinct;
  })()
);

// ============================================================
// NO ASHTAKAVARGA / DASHA / BHRIGU-GRAPH DEPENDENCY.
// ============================================================

const PACKAGE_SRC_FILES = ['types', 'provenance', 'constants', 'relationships', 'activation', 'evidence', 'validation', 'engine', 'adapter', 'index'].map((name) => `packages/transit-activation/src/${name}.ts`);

check(
  'no ACTUAL CODE (comments stripped) references Ashtakavarga (BAV/SAV/bindu), Vimshottari Dasha/Antardasha synthesis, or Bhrigu natal-graph traversal (buildBhriguNatalGraph/chains/deriveChains) -- this PR\'s own explicit non-goals',
  PACKAGE_SRC_FILES.every((file) => {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    return !/ashtakavarga|\bBAV\b|\bSAV\b|\bbindu\b|antardasha|mahadasha|buildBhriguNatalGraph|deriveChains|BhriguNatalGraph/i.test(code);
  })
);

check(
  'every import in this package is either a relative import within itself, or a relative import into packages/vedic, packages/bhrigu, or packages/personal-intelligence -- never apps/web, Prisma, packages/vimshottari, or packages/ashtakavarga',
  PACKAGE_SRC_FILES.every((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const importStatements = source.match(/^import[\s\S]*?;/gm) ?? [];
    return importStatements.every((statement) => /from '\.\/|from '\.\.\/\.\.\/vedic\/|from '\.\.\/\.\.\/bhrigu\/|from '\.\.\/\.\.\/personal-intelligence\//.test(statement));
  })
);

check(
  'no ACTUAL CODE (comments stripped) references apps/web, Prisma, a database, an API route, React, or an LLM',
  PACKAGE_SRC_FILES.every((file) => {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    return !/apps\/web|prisma|PrismaClient|react|localStorage|fetch\(|NextRequest|NextResponse|useState|useEffect|openai|anthropic|\bllm\b/i.test(code);
  })
);

check(
  'packages/vedic and packages/bhrigu source have no import of packages/transit-activation (this PR did not modify either to depend on it)',
  !/packages\/transit-activation/i.test(fs.readFileSync('packages/vedic/src/natalChart.ts', 'utf8')) && !/packages\/transit-activation/i.test(fs.readFileSync('packages/bhrigu/src/index.ts', 'utf8'))
);

check('packages/personal-intelligence source is untouched by this PR (no reference to transit-activation package path)', !/packages\/transit-activation/i.test(fs.readFileSync('packages/personal-intelligence/src/context.ts', 'utf8')));

check('packages/ashtakavarga and packages/vimshottari source are untouched (no reference to transit-activation package path)', !/packages\/transit-activation/i.test(fs.readFileSync('packages/ashtakavarga/src/index.ts', 'utf8')) && !/packages\/transit-activation/i.test(fs.readFileSync('packages/vimshottari/src/index.ts', 'utf8')));

if (!allPassed) {
  console.error('\nSome Transit Activation Engine checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL TRANSIT ACTIVATION ENGINE CHECKS PASSED');
}
