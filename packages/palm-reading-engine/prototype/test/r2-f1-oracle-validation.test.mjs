// AURA-PALM-G6-R2-F1 — both no-upgrade oracles reject malformed readings (fail closed). Harness/tests only; the
// interpretation engine is unchanged. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.mjs';
import * as G from '../src/geometry.mjs';
import * as O from './oracle.mjs';
import * as C from './coverage.mjs';
import * as K from './campaign-core.mjs';
import * as V from './campaign-verify.mjs';
import { independentUpgradeKinds, independentSelfTest } from './independent-oracle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', f), 'utf8')).fixtures;
const FIXTURES = [...load('r1-3-constructed-boundary-fixtures.json'), ...load('r1-4-loop-validity-fixtures.json'), ...load('r1-5-loop-order-asymmetric-fixtures.json')];
const item = (familyId, tier, rules) => ({ kind: 'interpreted', familyId, tier, interpretations: rules.map((ruleId) => ({ ruleId })) });
const R = (...sections) => ({ status: 'interpreted', sections: sections.map((items) => ({ items, declined: [], quiet: [] })) });
const TENTATIVE = R([item('F', 'tentative', ['A'])]);
const MALFORMED = {
  'unknown tier': R([item('F', 'definite', ['A'])]),
  'duplicate family in one section': R([item('F', 'clear', ['A']), item('F', 'tentative', ['A'])]),
  'duplicate family across sections': R([item('F', 'clear', ['A'])], [item('F', 'tentative', ['A'])]),
  'duplicate rule within a claim': R([item('F', 'tentative', ['A', 'A'])]),
};
const oracle = (cand, base) => O.violations(O.summarize(cand), O.meet(base.map(O.summarize)));

test('R2-F1: both oracles reject an unknown confidence tier (candidate or baseline)', () => {
  const bad = MALFORMED['unknown tier'];
  assert.throws(() => oracle(bad, [TENTATIVE]), /malformed reading: unknown confidence tier/);
  assert.throws(() => oracle(TENTATIVE, [bad]), /malformed reading: unknown confidence tier/);
  assert.throws(() => independentUpgradeKinds(bad, [TENTATIVE]), /malformed reading: tier/);
  assert.throws(() => independentUpgradeKinds(TENTATIVE, [bad]), /malformed reading: tier/);
});

test('R2-F1: both oracles reject duplicate interpretation claims (same section, across sections, repeated rule)', () => {
  for (const name of ['duplicate family in one section', 'duplicate family across sections', 'duplicate rule within a claim']) {
    const bad = MALFORMED[name];
    assert.throws(() => oracle(bad, [TENTATIVE]), /malformed reading: duplicate/, name);
    assert.throws(() => oracle(TENTATIVE, [bad]), /malformed reading: duplicate/, name);
    assert.throws(() => independentUpgradeKinds(bad, [TENTATIVE]), /malformed reading: (family|rule)/, name);
    assert.throws(() => independentUpgradeKinds(TENTATIVE, [bad]), /malformed reading: (family|rule)/, name);
  }
});

test('R2-F1: valid readings keep their behaviour — self-tests pass and every fixture orientation compares as before in both oracles', () => {
  assert.deepEqual(O.oracleSelfTest(), []);
  assert.deepEqual(independentSelfTest(), []);
  // well-formed upgrades are still reported (semantics unchanged)
  assert.deepEqual(oracle(R([item('F', 'clear', ['A'])]), [TENTATIVE]).map((v) => v.kind), ['confidence-upgrade']);
  assert.deepEqual(independentUpgradeKinds(R([item('F', 'clear', ['A'])]), [TENTATIVE]), ['confidence-upgrade']);
  let n = 0;
  for (const fx of FIXTURES) {
    const rs = O.orientations(fx.input).map(({ input }) => E.generateReading(input));
    const base = O.meet(rs.map(O.summarize));
    for (const r of rs) { assert.deepEqual(O.violations(O.summarize(r), base), [], fx.id); assert.deepEqual(independentUpgradeKinds(r, rs), [], fx.id); n++; }
  }
  assert.ok(n >= 900, `compared ${n}`);
});

test('R2-F1: the reviewer\'s over-claiming engine (a clear duplicate before each tentative claim) now fails closed in the campaign and in the contract re-check', () => {
  const overClaim = { generateReading: (inp) => {
    const r = JSON.parse(JSON.stringify(E.generateReading(inp)));
    if (r.status !== 'invalid-input') for (const s of r.sections) s.items = s.items.flatMap((it) => (it.tier === 'tentative' && !it.evidence?.orderTie ? [{ ...it, tier: 'clear' }, it] : [it]));
    return r; } };
  const R11 = E; // the baseline engine does not matter here: the malformed candidate reading must be rejected
  const fx = FIXTURES.find((f) => f.id.startsWith('A-ptc-length-tie-0.47005'));
  const g = O.orientations(fx.input)[0].input;
  assert.ok(overClaim.generateReading(g).sections.some((s) => new Set(s.items.map((i) => i.familyId)).size !== s.items.length), 'the stand-in really emits duplicate claims');
  const c = { n: 0, id: fx.id, input: fx.input, tags: [], raw: C.rawInputKey(fx.input), key: C.canonicalInputKey(fx.input), vars: O.orientations(fx.input) };
  assert.throws(() => K.evaluateCase(c, 0, { E11: R11, EC: overClaim, G, O, C }), /malformed reading/); // campaign (shared oracle)
  assert.throws(() => V.reverifyCase(c, {}, { E11: R11, EC: overClaim, G, C }), /malformed reading/); // contract re-check (independent oracle)
});
