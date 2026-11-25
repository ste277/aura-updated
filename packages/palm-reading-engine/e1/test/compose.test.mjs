// AURA-PALM-03-E1 -- composition engine vs the independent C1 reference oracle (synthetic observations only).
// The oracle (reference/check_examples.py, unmodified) is an expected-output reference, not the engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFromObservations, loadLibrary, defaultLibrary, MODES, E1Error } from '../src/index.mjs';
import { oracleDump, shape, readJson, CAT_PATH, SCHEMA_PATH, EXAMPLES_PATH, clone, rec } from './helpers.mjs';
const composeSyn = (obs, opts = {}) => composeFromObservations(obs, { synthetic: true, ...opts });

const CAT = readJson(CAT_PATH);
const SCHEMA = readJson(SCHEMA_PATH);
const EXAMPLES = readJson(EXAMPLES_PATH);
const ORACLE = oracleDump();
const run = (e, mode, library) => composeSyn(e.inputs, { mode, qualityAccepted: e.qualityAccepted, library });
const ids = (r) => [...r.sections.flatMap((s) => s.items.map((i) => i.recordId)), ...r.moreFromYourReading.map((i) => i.recordId)];
const sectionIds = (r) => r.sections.flatMap((s) => s.items.map((i) => i.recordId));

test('C0 the oracle itself ran cleanly on the packaged catalogue', () => {
  assert.equal(ORACLE.oracleExit, 0);
  assert.equal(ORACLE.sweep.length, 1920);
});

test('C1 all seven reference readings match the oracle in all three modes (later-capability example at E1 capability)', () => {
  let n = 0;
  for (const e of EXAMPLES.examples) {
    const key = e.capabilities.length === 1 && e.capabilities[0] === 'essential' ? e.id : `${e.id}@essential`;
    for (const mode of MODES) {
      assert.deepEqual(shape(run(e, mode)), ORACLE.examples[key].derived[mode], `${key}/${mode}`);
      n++;
    }
  }
  assert.equal(n, 21);
});

test('C2 hand-composed C1 expectations hold exactly for every essential example', () => {
  for (const e of EXAMPLES.examples.filter((x) => x.capabilities.join() === 'essential')) for (const mode of MODES) assert.deepEqual(shape(run(e, mode)), e.expected[mode], `${e.id}/${mode}`);
});

test('C3 later-eligible records never enter an E1 reading (R4 uses later inputs: E1 emits only what initial records support)', () => {
  const r4 = EXAMPLES.examples.find((x) => x.id === 'R4');
  for (const mode of MODES) {
    const got = ids(run(r4, mode));
    for (const id of got) assert.equal(defaultLibrary().byId[id].eligibility.status, 'eligible-initial', id);
    assert.ok(!got.some((id) => /PALM-RAISED|MATSYA|THUMB/.test(id)));
  }
});

test('C4 all 5,760 essential-input derivations match the oracle exactly', () => {
  let n = 0;
  for (const s of ORACLE.sweep) for (const mode of MODES) { assert.deepEqual(shape(composeSyn(s.inputs, { mode })), s.derived[mode]); n++; }
  assert.equal(n, 5760);
});

test('C5 sweep invariants: eligibility, capacity, single placement, first-listed-category rule, no displacement, empty-result', () => {
  const lib = defaultLibrary();
  const limit = lib.catalogue.globalPolicy.maxInterpretationsPerCategory;
  const order = lib.catalogue.readingModes.placement.sectionOrder;
  for (const s of ORACLE.sweep) {
    const byMode = {};
    for (const mode of MODES) {
      const r = composeSyn(s.inputs, { mode });
      byMode[mode] = r;
      const all = ids(r);
      assert.equal(new Set(all).size, all.length);
      assert.equal(r.moreFromYourReading.length, 0);
      for (const sec of r.sections) {
        assert.ok(sec.items.length <= limit);
        for (const it of sec.items) {
          const e = lib.byId[it.recordId];
          assert.equal(e.eligibility.status, 'eligible-initial');
          assert.ok(lib.catalogue.readingModes.modeBehaviour[mode].traditions.includes(e.tradition));
          assert.equal(it.section, sec.category);
          // RC-12: every category listed before the chosen one was full when the item was placed (rank order)
          const before = e.categories.slice(0, e.categories.indexOf(sec.category)).filter((c) => order.includes(c));
          for (const c of before) assert.ok(r.sections.find((x) => x.category === c)?.items.filter((x) => x.rank < it.rank).length === limit, `${it.recordId} skipped ${c}`);
          assert.equal(it.confidence.tier, 'tentative');
        }
      }
      assert.equal(r.emptyResult, all.length ? null : lib.catalogue.readingModes.modeBehaviour[mode].emptyResult);
    }
    const ind = new Set(ids(byMode['indian-only']));
    for (const id of ind) assert.ok(sectionIds(byMode.combined).includes(id), `Indian item ${id} displaced in combined`);
  }
});

test('C6 deterministic: identical inputs give byte-identical output; key order and repetition do not matter', () => {
  for (const s of ORACLE.sweep.slice(0, 300)) {
    const a = JSON.stringify(composeSyn(s.inputs));
    const rev = Object.fromEntries(Object.entries(s.inputs).reverse());
    assert.equal(JSON.stringify(composeSyn(rev)), a);
    assert.equal(JSON.stringify(composeSyn(structuredClone(s.inputs))), a);
  }
  const r = composeSyn(ORACLE.sweep[100].inputs);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.sections) && Object.isFrozen(r.notAssessed));
});

test('C7 Indian preference only between comparably suitable candidates (same support level and suitability band)', () => {
  const obs = { 'lines.life': { provenance: 'user-confirmed', value: 'present' }, 'lines.head': { provenance: 'user-confirmed', value: 0.2 } };
  const variant = (f) => { const c = clone(CAT); c.globalPolicy.maxInterpretationsPerCategory = 1; for (const id of ['C1-IN-PITR-KNOWLEDGE', 'C1-WE-HEAD-SLOPING']) rec(c, id).categories = ['strengths']; f(c); return loadLibrary(c, SCHEMA); };
  const first = (lib) => composeSyn(obs, { library: lib }).sections[0].items[0].recordId;
  // inferred Indian vs direct Western: source support decides -> Western
  assert.equal(first(variant(() => {})), 'C1-WE-HEAD-SLOPING');
  // both direct, both band 0: comparably suitable -> Indian preferred
  const tie = variant((c) => { const p = rec(c, 'C1-IN-PITR-KNOWLEDGE'); p.overallSupport = 'direct'; p.uncertainty.sourceSupport = 'direct'; });
  assert.equal(first(tie), 'C1-IN-PITR-KNOWLEDGE');
  // same support, Indian in suitability band 1 (3 concerns): not comparable -> Western
  const band = variant((c) => { const p = rec(c, 'C1-IN-PITR-KNOWLEDGE'); p.overallSupport = 'direct'; p.uncertainty.sourceSupport = 'direct'; Object.assign(p.suitability, { observationRequirements: 'concern', culturalContext: 'concern' }); });
  assert.equal(first(band), 'C1-WE-HEAD-SLOPING');
  // the loser goes to "More from your reading", it is not dropped
  const r = composeSyn(obs, { library: tie });
  assert.deepEqual(r.moreFromYourReading.map((i) => i.recordId), ['C1-WE-HEAD-SLOPING']);
});

test('C8 unsupported sections: no invented items; Indian relationships report no-supported-content; empty readings say so', () => {
  const heartOnly = { 'lines.heart': { provenance: 'user-confirmed', value: 'index' } };
  const ind = composeSyn(heartOnly, { mode: 'indian-only' });
  assert.equal(ind.sections.length, 0);
  assert.equal(ind.emptyResult, 'say-indian-tradition-has-no-supported-reading-for-what-was-shared-point-to-guide');
  assert.equal(ind.domains.find((d) => d.domain === 'relationships').status, 'no-supported-content');
  assert.deepEqual(ind.notAssessed.map((n) => [n.feature, n.code]), [['lines.heart', 'no-supported-content']]);
  const west = composeSyn({ 'lines.upward': { provenance: 'user-confirmed', value: 'ring' } }, { mode: 'western-only' });
  assert.equal(west.domains.find((d) => d.domain === 'life-direction').status, 'no-supported-content');
  assert.equal(composeSyn({}).emptyResult, 'say-nothing-emittable-list-not-assessed-point-to-guide');
  const comb = composeSyn(heartOnly);
  assert.deepEqual(comb.domains.map((d) => [d.domain, d.status]), [['personality', 'not-shown'], ['relationships', 'shown'], ['career', 'not-shown'], ['life-direction', 'not-shown']]);
});

test('C9 boundaries: range margins and zone edges (either side) show nothing; just outside the margin emits', () => {
  const head = (v) => composeSyn({ 'lines.head': { provenance: 'user-confirmed', value: v } });
  assert.equal(head(0.105).notAssessed[0].code, 'boundary');
  assert.equal(head(0.081).notAssessed[0].code, 'boundary');
  assert.equal(head(0.0795).notAssessed[0].code, 'boundary'); // with 0.03 margins the whole 0.02-0.14 band is boundary
  // R2: closed bands -- exactly the margin away from a threshold is still a boundary; one grid step farther emits
  assert.equal(head(0.14).notAssessed[0].code, 'boundary');
  assert.equal(head(0.1401).sections[0].items[0].recordId, 'C1-WE-HEAD-SLOPING');
  assert.equal(head(0.02).notAssessed[0].code, 'boundary');
  assert.equal(head(0.0199).sections[0].items[0].recordId, 'C1-WE-HEAD-STRAIGHT');
  const heart = (value, adjacentZone) => composeSyn({ 'lines.heart': { provenance: 'user-confirmed', value, nearEdge: true, adjacentZone } });
  assert.equal(heart('index', 'between-index-middle').notAssessed[0].code, 'boundary');
  assert.equal(heart('between-index-middle', 'index').notAssessed[0].code, 'boundary');
  assert.equal(heart('middle', 'between-index-middle').notAssessed[0].code, 'boundary'); // the emitting zone is across the edge
  assert.equal(heart('middle', 'other').notAssessed[0].code, 'no-supported-content');
});

test('C10 provenance: an observation with a provenance the record does not allow is never read', () => {
  const r = composeSyn({ 'lines.life': { provenance: 'user-reported', value: 'present' }, 'measurements.middleToPalmRatio': { provenance: 'user-confirmed', value: 1.2 } });
  assert.equal(r.sections.length, 0);
  assert.deepEqual(r.notAssessed.map((n) => n.code), ['no-supported-content', 'no-supported-content']);
  const ok = composeSyn({ 'lines.life': { provenance: 'user-confirmed', value: 'present' } });
  assert.deepEqual(ok.sections[0].items[0].supportingFeatures[0], { feature: 'lines.life', anatomical: 'thenar', provenance: 'user-confirmed', observed: 'present', descriptor: null, thresholdStatus: 'placeholder' });
});

test('C11 quality gate: nothing is emitted; observed features are quality-gated; user reasons are kept', () => {
  const e = EXAMPLES.examples.find((x) => x.id === 'R3Q');
  const r = composeSyn(e.inputs, { qualityAccepted: false, qualityDetail: 'quality-needs-retake' });
  assert.equal(r.sections.length, 0);
  assert.equal(r.quality.accepted, false);
  assert.equal(r.notAssessed.find((n) => n.feature === 'measurements.middleToPalmRatio').code, 'quality-gated');
  assert.equal(r.notAssessed.find((n) => n.feature === 'lines.heart').code, 'user-skipped');
  assert.ok(!JSON.stringify(r).match(/confidence"?\s*:\s*0\.\d/), 'no numeric confidence is shown');
});

test('C12 invalid observations and options are rejected with typed errors', () => {
  const bad = [
    null, [], { 'lines.head': null }, { 'not a key': { provenance: 'user-confirmed', value: 1 } },
    { 'lines.head': { notAssessed: 'made-up' } }, { 'lines.head': { notAssessed: 'detector-missing' } },
    { 'lines.head': { provenance: 'user-confirmed', value: Number.NaN } }, { 'lines.head': { provenance: 'user-confirmed', value: '' } },
    { 'lines.head': { value: 0.1 } }, { 'lines.head': { provenance: 'user-confirmed', value: 0.1, extra: 1 } },
    { 'lines.heart': { provenance: 'user-confirmed', value: 'index', nearEdge: 'yes' } },
  ];
  for (const o of bad) assert.throws(() => composeSyn(o), (e) => e instanceof E1Error && e.code === 'invalid-input', JSON.stringify(o));
  assert.throws(() => composeSyn({}, { mode: 'mixed' }), (e) => e.code === 'invalid-option');
  assert.throws(() => composeSyn({}, { qualityAccepted: 'yes' }), (e) => e.code === 'invalid-option');
});

test('C13 the 13 C1 example mutations: the engine output never equals a mutated expectation (or the input is refused)', () => {
  const ex = (d, id) => d.examples.find((e) => e.id === id);
  const X = [
    ['X1', (d) => ex(d, 'R3').expected.combined.sections.personality.push('C1-WE-INDEX-LONG'), 'R3', 'combined'],
    ['X2', (d) => { ex(d, 'R6').inputs['lines.head'] = { notAssessed: 'detector-missing' }; }, 'R6', 'combined'],
    ['X3', (d) => { ex(d, 'R1').expected['indian-only'].sections.personality = ['C1-WE-HEAD-SLOPING']; }, 'R1', 'indian-only'],
    ['X4', (d) => { ex(d, 'R2').expected.combined.sections.personality = ['C1-WE-HEAD-STRAIGHT', 'C1-WE-RING-LONG']; }, 'R2', 'combined'],
    ['X5', (d) => { ex(d, 'R5').expected.combined.sections.personality = ['C1-WE-FINGER-SHORT', 'C1-WE-HEAD-SLOPING']; }, 'R5', 'combined'],
    ['X6', (d) => { ex(d, 'R6').inputs['marks.matsya'] = { notAssessed: 'observed-absent' }; ex(d, 'R6').expected.combined.sections.strengths = ['C1-IN-MATSYA-PAIR-HOSPITALITY']; }, 'R6', 'combined'],
    ['X7', (d) => { ex(d, 'R1').expected.combined.sections['life-direction'] = ['C1-WE-ORIGIN-SEPARATE']; }, 'R1', 'combined'],
    ['X8', (d) => { delete ex(d, 'R1').expected.combined.notAssessed['lines.heart']; }, 'R1', 'combined'],
    ['X9', (d) => { ex(d, 'R3Q').expected.combined.sections.personality = ['C1-WE-FINGER-LONG']; }, 'R3Q', 'combined'],
    ['X10', (d) => { ex(d, 'R6').expected['indian-only'].emptyResult = null; }, 'R6', 'indian-only'],
    ['X11', (d) => { ex(d, 'R2').expected.combined.sections['emotional-relational'] = ['C1-WE-HEART-JUPITER']; }, 'R2', 'combined'],
    ['X12', (d) => { ex(d, 'R6').expected['indian-only'].sections['emotional-relational'] = ['C1-IN-PITR-KNOWLEDGE']; }, 'R6', 'indian-only'],
    ['X13', (d) => { ex(d, 'R1').expected.combined.notAssessed['marks.other'] = 'observed-absent'; }, 'R1', 'combined'],
  ];
  for (const [name, mutate, id, mode] of X) {
    const d = clone(EXAMPLES); mutate(d);
    const e = ex(d, id);
    let got;
    try { got = shape(run(e, mode)); } catch (err) { assert.ok(err instanceof E1Error && err.code === 'invalid-input', name); continue; }
    assert.notDeepEqual(got, e.expected[mode], `${name}: engine output equals the mutated expectation`);
  }
});

test('C14 sweep mutations: S1 (zero section limit) is refused by the loader; S2 makes the displacement check fail', () => {
  const s1 = clone(CAT); s1.globalPolicy.maxInterpretationsPerCategory = 0;
  assert.throws(() => loadLibrary(s1, SCHEMA), (e) => e.code === 'invalid-catalogue');
  const s2 = clone(CAT); s2.globalPolicy.maxInterpretationsPerCategory = 1;
  for (const id of ['C1-IN-URDHVA-MIDDLE', 'C1-IN-URDHVA-INDEX', 'C1-IN-URDHVA-RING', 'C1-IN-URDHVA-LITTLE', 'C1-WE-FINGER-LONG', 'C1-WE-FINGER-SHORT']) rec(s2, id).categories = ['career-working-style'];
  const lib = loadLibrary(s2, SCHEMA);
  let displaced = 0;
  for (const s of ORACLE.sweep) {
    const comb = sectionIds(composeSyn(s.inputs, { library: lib }));
    for (const id of ids(composeSyn(s.inputs, { library: lib, mode: 'indian-only' }))) if (!comb.includes(id)) displaced++;
  }
  assert.ok(displaced > 0, 'the S2 library must displace an Indian item (the property check is not vacuous)');
});
