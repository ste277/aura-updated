// AURA-PALM-G6-D0-R1.4 — harness, coverage-accounting and loop-fixture tests (the interpretation engine is unchanged).
// Synthetic data only. Uses test/oracle.mjs (R1.3, hardened) and test/coverage.mjs (R1.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReading } from '../src/engine.mjs';
import { polylineProblem } from '../src/schema.mjs';
import { describe as describeGeom } from '../src/geometry.mjs';
import { summarize, meet, violations, orientations, orderFree, oracleSelfTest } from './oracle.mjs';
import { canonicalInputKey, rawInputKey, classifyTies, r11OrientationsDisagree, checkContract } from './coverage.mjs';
import * as F from '../fixtures/synthetic-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', f), 'utf8'));
const R13 = load('r1-3-constructed-boundary-fixtures.json');
const LOOP = load('r1-4-loop-validity-fixtures.json');
const deserial = (s) => ({ valid: s.valid, items: new Map(s.items), declined: new Map(s.declined) });
const byId = (id) => R13.fixtures.find((f) => f.id === id) || assert.fail(`fixture ${id} missing`);
const rev = (p) => [...p].reverse();

// ---------------- RV-03: oracle comparison domain ----------------
test('R1.4 RV-03: the oracle self-test includes orientations that disagree on rule sets, and all cases pass', () => {
  assert.deepEqual(oracleSelfTest(), []);
  const src = fs.readFileSync(path.join(here, 'oracle.mjs'), 'utf8');
  assert.match(src, /orientations disagree on rule sets: no common rule → no claim/);
  assert.match(src, /orientations disagree on rule sets: union of rules not supported/);
});

test('R1.4 RV-03: missing comparison results fail loudly instead of passing silently', () => {
  assert.throws(() => meet([]), /at least one orientation/);
  assert.throws(() => meet(undefined), /at least one orientation/);
  assert.throws(() => violations(summarize(generateReading(F.base())), undefined), /meet\(\) baseline/);
  assert.throws(() => violations(undefined, meet([summarize(generateReading(F.base()))])), /candidate/);
  assert.equal(meet([summarize(generateReading(F.base())), summarize(generateReading(F.strong()))]).orientationCount, 2);
});

// ---------------- RV-02: canonical distinct-input accounting ----------------
test('R1.4 RV-02: an input and its full or partial point-order reversal count once; different geometry counts separately', () => {
  const a = F.strong();
  const full = F.strong(); for (const c of full.creases.items) c.geometry.points.reverse();
  const partial = F.strong(); partial.creases.items[1].geometry.points.reverse();
  assert.equal(canonicalInputKey(a), canonicalInputKey(full)); assert.equal(canonicalInputKey(a), canonicalInputKey(partial));
  assert.notEqual(rawInputKey(a), rawInputKey(full), 'raw keys still distinguish supplied order (for traceability)');
  const moved = F.strong(); moved.creases.items[1].geometry.points[2].x += 1e-12;
  assert.notEqual(canonicalInputKey(a), canonicalInputKey(moved), 'a modified point must not collapse into the original');
  const movedRev = F.strong(); movedRev.creases.items[1].geometry.points[2].x += 1e-12; movedRev.creases.items[1].geometry.points.reverse();
  assert.equal(canonicalInputKey(moved), canonicalInputKey(movedRev));
  assert.notEqual(canonicalInputKey(F.base()), canonicalInputKey(F.weak()), 'different inputs stay different');
  const swapped = F.strong(); [swapped.creases.items[0], swapped.creases.items[1]] = [swapped.creases.items[1], swapped.creases.items[0]];
  assert.notEqual(canonicalInputKey(a), canonicalInputKey(swapped), 'crease order is not point order: not merged');
});

test('R1.4 RV-02: canonical keys are deterministic and the distinct count does not depend on case order', () => {
  const cases = [F.base(), F.strong(), F.weak(), F.strong(), (() => { const f = F.strong(); f.creases.items[2].geometry.points.reverse(); return f; })(), F.base()];
  for (const c of cases) assert.equal(canonicalInputKey(c), canonicalInputKey(JSON.parse(JSON.stringify(c))));
  const count = (list) => new Set(list.map(canonicalInputKey)).size;
  assert.equal(count(cases), 3); assert.equal(count([...cases].reverse()), 3); assert.equal(count([cases[2], cases[0], cases[4], cases[1], cases[5], cases[3]]), 3);
  assert.equal(new Set(cases.map(rawInputKey)).size, 4, 'raw count keeps the reversed copy separate');
});

// ---------------- RV-01: outcome-relevant ties ----------------
test('R1.4 RV-01: tie categories on known constructed fixtures follow the existing policy semantics', () => {
  const cls = (id) => classifyTies(byId(id).input, generateReading(byId(id).input), describeGeom, byId(id).r11.map((o) => o.summary));
  // claim/no-claim abstentions
  for (const id of R13.fixtures.filter((f) => /^A-ptc-length-tie-0\.52995|^A-ptc-length-tie-0\.66995|^B-fate-length-tie-0\.31995/.test(f.id)).map((f) => f.id)) {
    const c = cls(id); assert.ok(c.observed && c.abstention && c.outcomeRelevant && !c.harmless, `${id}: ${JSON.stringify(c)}`);
  }
  // same-reading ties: observed but harmless
  for (const id of R13.fixtures.filter((f) => /^A-ptc-length-tie-0\.(46995|73005|59995|60005|53005)/.test(f.id)).map((f) => f.id)) {
    const c = cls(id); assert.ok(c.observed && c.harmless && !c.outcomeRelevant, `${id}: ${JSON.stringify(c)}`);
  }
  // hypothesis-capped fate tie whose orders differ only in ambiguity: reconciled in trace, but harmless
  { const c = cls('B-fate-length-tie-0.37995-0'); assert.ok(c.reconciledInTrace && c.harmless && !c.outcomeRelevant, JSON.stringify(c)); }
  // tier lowered from clear (SHORT vs SHORT*): outcome-relevant, not an abstention
  for (const id of R13.fixtures.filter((f) => /^A-ptc-length-tie-0\.(47005|72995)/.test(f.id)).map((f) => f.id)) {
    const c = cls(id); assert.ok(c.tierLowered && c.outcomeRelevant && !c.abstention, `${id}: ${JSON.stringify(c)}`);
  }
  // centre ties: sole exclusion and tie-created conflict are abstentions; a conflict that exists anyway is harmless
  { const c = cls('D01-reviewer-tied-crease-alone'); assert.ok(c.abstention, JSON.stringify(c)); }
  { const c = cls('D02-tied-plus-competitor'); assert.ok(c.abstention, JSON.stringify(c)); }
  { const c = cls('D09-multiple-competitors'); assert.ok(c.reconciledInTrace && c.harmless && !c.outcomeRelevant, JSON.stringify(c)); }
  // no tie at all
  { const c = cls('A-ptc-length-plain-0.47'); assert.ok(!c.observed && !c.outcomeRelevant && !c.harmless); }
});

test('R1.4 RV-01: classification is identical for every orientation; no-op reconciliations never change an outcome; categories need the R1.1 baseline', () => {
  let relevant = 0, harmless = 0, abstention = 0, reconciledNoop = 0;
  for (const fx of R13.fixtures) {
    const sums = fx.r11.map((o) => o.summary);
    const all = orientations(fx.input).map(({ input }) => JSON.stringify(classifyTies(input, generateReading(input), describeGeom, sums)));
    for (const a of all) assert.equal(a, all[0], fx.id);
    const c = JSON.parse(all[0]);
    assert.equal(c.noopChanged, false, `${fx.id}: a reconciliation changed a family on which R1.1 orientations agree`);
    if (c.outcomeRelevant) relevant++; if (c.harmless) harmless++; if (c.abstention) abstention++; if (c.reconciledInTrace && !c.outcomeRelevant) reconciledNoop++;
  }
  assert.ok(relevant >= 10 && harmless >= 10 && abstention >= 8 && reconciledNoop >= 2, `relevant ${relevant}, harmless ${harmless}, abstention ${abstention}, reconciled-but-no-op ${reconciledNoop}`);
  assert.throws(() => classifyTies(R13.fixtures[0].input, generateReading(R13.fixtures[0].input), describeGeom), /R1.1 orientation summaries are required/);
});

// ---------------- RV-04: loop-shaped validity fixtures ----------------
test('R1.4 RV-04: loop fixtures provably reach their conditions (R1.1 single-order validator proofs)', () => {
  const cat = (c) => LOOP.fixtures.filter((f) => f.category === c);
  for (const [c, n] of Object.entries({ 'loop-closed': 2, 'loop-near-closed': 1, 'loop-self-intersecting': 3, 'tortuous-order-dependent': 2, 'intermediate-disagreement': 2, 'valid-control': 2 })) assert.ok(cat(c).length >= n, `${c}: ${cat(c).length}`);
  for (const f of cat('tortuous-order-dependent')) assert.ok((f.proof.r11Forward === null) !== (f.proof.r11Reversed === null), `${f.id}: one R1.1 order valid, the other invalid`);
  for (const f of cat('intermediate-disagreement')) assert.ok(f.proof.r11Forward && f.proof.r11Reversed && f.proof.r11Forward !== f.proof.r11Reversed, `${f.id}: both invalid with different codes`);
  for (const f of [...cat('loop-closed'), ...cat('loop-near-closed'), ...cat('loop-self-intersecting')]) assert.ok(f.proof.r11Forward && f.proof.r11Reversed, `${f.id}: invalid in both R1.1 orders`);
  for (const f of cat('valid-control')) assert.ok(f.proof.r11Forward === null && f.proof.r11Reversed === null, f.id);
});

test('R1.4 RV-04: a loop invalid in either order is invalid in every orientation, with an order-independent error (code and message)', () => {
  for (const f of LOOP.fixtures) {
    const outs = orientations(f.input).map(({ input }) => generateReading(input));
    for (const r of outs) {
      if (f.expect === 'invalid-both') { assert.equal(r.status, 'invalid-input', f.id); assert.ok(r.errors.some((e) => e.code === 'invalid-geometry'), f.id); }
      else assert.notEqual(r.status, 'invalid-input', f.id);
      assert.equal(orderFree(r), orderFree(outs[0]), `${f.id}: the reading (incl. error code and message) must not depend on point order`);
    }
    const p = f.slot === 'PTC' ? f.input.creases.items[1].geometry.points : f.input.creases.items.at(-1).geometry.points;
    assert.equal(polylineProblem(p), polylineProblem(rev(p)), f.id); assert.equal(polylineProblem(p), polylineProblem(rev(rev(p))), f.id);
  }
});

test('R1.4 RV-04: loop fixtures never upgrade relative to the R1.1 meet (validity, claims, confidence)', () => {
  let n = 0;
  for (const f of LOOP.fixtures) {
    const base = meet(f.r11.map((o) => deserial(o.summary)));
    for (const { input } of orientations(f.input)) { assert.deepEqual(violations(summarize(generateReading(input)), base), [], f.id); n++; }
  }
  assert.ok(n >= 80, `checked ${n}`);
});

// ---------------- RV-03: coverage contract ----------------
const CONTRACT = { campaigns: [{ id: 'random-A', generator: 'g', minCanonicalDistinct: 100, minEligible: 80, minOrientationComparisons: 500, minOutcome: { outcomeRelevantTies: 5 } }, { id: 'fixtures-X', minCanonicalDistinct: 10, minEligible: 0, minOrientationComparisons: 20 }] };
const good = () => ({
  'random-A': { campaign: 'random-A', generator: 'g', completed: true, reversalMismatches: 0, oracleSelfTestFailures: [], upgrades: { 'claim-presence-upgrade': 0, 'confidence-upgrade': 0, 'invalid-to-valid': 0, 'conflict-abstention-to-claim': 0, 'additional-interpretation': 0 },
    counts: { generated: 130, canonicalDistinct: 110, eligibleCanonicalDistinct: 90, orientationComparisons: 900, orientationVariants: 1010, comparedCases: 110, variantCoverageFailures: 0, r11Evaluations: 1010, r13Evaluations: 1010, outcomeRelevantTies: 7 } },
  'fixtures-X': { campaign: 'fixtures-X', completed: true, reversalMismatches: 0, oracleSelfTestFailures: [], upgrades: { 'claim-presence-upgrade': 0, 'confidence-upgrade': 0, 'invalid-to-valid': 0, 'conflict-abstention-to-claim': 0, 'additional-interpretation': 0 },
    counts: { generated: 12, canonicalDistinct: 12, eligibleCanonicalDistinct: 3, orientationComparisons: 40, orientationVariants: 52, comparedCases: 12, variantCoverageFailures: 0, r11Evaluations: 52, r13Evaluations: 52 } },
});
test('R1.4 RV-03: the coverage contract accepts a complete report set', () => { assert.deepEqual(checkContract(CONTRACT, good()), { pass: true, failures: [] }); });
test('R1.4 RV-03: the coverage contract rejects every listed coverage defect', () => {
  const cases = {
    'campaign-present': (r) => { delete r['fixtures-X']; },
    'min-orientation-comparisons': (r) => { r['random-A'].counts.orientationComparisons = 499; },
    'min-eligible': (r) => { r['random-A'].counts.eligibleCanonicalDistinct = 79; },
    'min-canonical-distinct': (r) => { r['random-A'].counts.canonicalDistinct = 99; r['random-A'].counts.comparedCases = 99; },
    'not-duplicate-only': (r) => { Object.assign(r['random-A'].counts, { canonicalDistinct: 0, comparedCases: 0 }); },
    completed: (r) => { r['random-A'].completed = false; },
    'all-point-order-variants': (r) => { r['random-A'].counts.variantCoverageFailures = 3; },
    'both-engines-every-variant': (r) => { r['random-A'].counts.r11Evaluations = 110; },
    'min-outcomeRelevantTies': (r) => { r['random-A'].counts.outcomeRelevantTies = 0; },
    'zero-claim-presence-upgrade': (r) => { r['random-A'].upgrades['claim-presence-upgrade'] = 1; },
    'reversal-invariant': (r) => { r['fixtures-X'].reversalMismatches = 2; },
    'non-empty': (r) => { r['fixtures-X'].counts.generated = 0; },
    'unexpected-campaign': (r) => { r['random-Z'] = r['random-A']; },
  };
  for (const [check, mut] of Object.entries(cases)) {
    const r = good(); mut(r); const res = checkContract(CONTRACT, r);
    assert.equal(res.pass, false, check); assert.ok(res.failures.some((f) => f.check === check), `${check}: ${JSON.stringify(res.failures)}`);
  }
});
