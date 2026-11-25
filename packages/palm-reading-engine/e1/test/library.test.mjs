// AURA-PALM-03-E1 -- library loader, schema validation and C1-checker agreement (synthetic, no images).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadLibrary, lintCatalogue, defaultLibrary, assertSupportedSchema, validateAgainstSchema, E1Error, IMPLEMENTED_CAPABILITIES } from '../src/index.mjs';
import { CAT_PATH, SCHEMA_PATH, E1, readJson, clone, rec, python, pythonCheck, tmpdir, CATALOGUE_MUTATIONS } from './helpers.mjs';

const CAT = readJson(CAT_PATH);
const SCHEMA = readJson(SCHEMA_PATH);
const rejects = (c, s = SCHEMA) => { try { loadLibrary(c, s); return null; } catch (e) { assert.ok(e instanceof E1Error, String(e)); return e; } };

test('L1 all 29 research records load with their classifications (12 / 7 / 3 / 2 / 5)', () => {
  const lib = defaultLibrary();
  assert.equal(lib.order.length, 29);
  const count = {};
  for (const id of lib.order) { const s = lib.byId[id].eligibility.status; count[s] = (count[s] ?? 0) + 1; }
  assert.deepEqual(count, { 'eligible-initial': 12, 'eligible-later': 7, held: 3, 'excluded-initial': 2, 'historical-context-only': 5 });
  assert.deepEqual([...lib.initialIds].sort(), [
    'C1-IN-PITR-KNOWLEDGE', 'C1-IN-URDHVA-INDEX', 'C1-IN-URDHVA-LITTLE', 'C1-IN-URDHVA-MIDDLE', 'C1-IN-URDHVA-RING',
    'C1-WE-FINGER-LONG', 'C1-WE-FINGER-SHORT', 'C1-WE-HEAD-SLOPING', 'C1-WE-HEAD-STRAIGHT', 'C1-WE-HEART-BETWEEN', 'C1-WE-HEART-JUPITER', 'C1-WE-RING-LONG',
  ]);
});

test('L2 records are preserved unchanged: sources, tradition, suitability, provenance requirements, unreviewed status', () => {
  const lib = defaultLibrary();
  assert.deepEqual(lib.catalogue, CAT);
  for (const id of lib.order) {
    const e = lib.byId[id];
    assert.equal(e.review.status, 'UNREVIEWED_RESEARCH_CONTENT', id);
    assert.ok(e.sources.length > 0 && e.requires.every((r) => r.provenanceAllowed.length > 0), id);
    assert.ok(e.suitability && e.tradition && e.uncertainty, id);
  }
  assert.equal(lib.catalogue.status, 'UNREVIEWED_RESEARCH_CONTENT');
  assert.ok(Object.isFrozen(lib.catalogue) && Object.isFrozen(lib.byId['C1-WE-HEART-JUPITER'].userFacing));
});

test('L3 every eligible-initial record needs only capabilities this milestone implements; none of the later ones do', () => {
  const lib = defaultLibrary();
  for (const id of lib.order) {
    const e = lib.byId[id];
    const ok = e.e1Capabilities.every((c) => IMPLEMENTED_CAPABILITIES.includes(c));
    if (e.eligibility.status === 'eligible-initial') assert.ok(ok, id);
    if (e.eligibility.status === 'eligible-later') assert.ok(!ok, `${id} would be emittable without its later capability`);
  }
});

test('L4 the C1 schema uses only supported keywords; unsupported keywords are rejected, never ignored', () => {
  assert.deepEqual(assertSupportedSchema(SCHEMA), []);
  const s = clone(SCHEMA); s.$defs.category.minLength = 2;
  assert.deepEqual(assertSupportedSchema(s), ['#/$defs/category/minLength']);
  assert.equal(rejects(CAT, s).code, 'invalid-schema');
  const f = clone(SCHEMA); f.properties.generatedBy.properties.date.format = 'email';
  assert.equal(rejects(CAT, f).code, 'invalid-schema');
});

test('L5 schema validator: each implemented keyword rejects its violation', () => {
  const sch = { $defs: { t: { enum: ['a', 'b'] } }, type: 'object', required: ['n', 'e', 'c', 'p', 'l', 'd'], additionalProperties: false,
    properties: { n: { type: 'integer' }, e: { $ref: '#/$defs/t' }, c: { const: [1, 2] }, p: { type: 'string', pattern: '^C1-' }, l: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } }, d: { type: 'string', format: 'date' } } };
  const ok = { n: 1, e: 'a', c: [1, 2], p: 'C1-X', l: ['x'], d: '2026-11-25' };
  assert.deepEqual(validateAgainstSchema(ok, sch), []);
  const bad = [{ n: 1.5 }, { e: 'z' }, { c: [2, 1] }, { p: 'X' }, { l: [] }, { l: ['a', 'b', 'c'] }, { l: [1] }, { d: '2026-13-45' }, { extra: 1 }];
  for (const b of bad) assert.ok(validateAgainstSchema({ ...ok, ...b }, sch).length > 0, JSON.stringify(b));
  const missing = { ...ok }; delete missing.d;
  assert.ok(validateAgainstSchema(missing, sch).some((m) => m.includes('missing required d')));
  const sparse = { ...ok, l: ['x'] }; sparse.l.length = 2;
  assert.ok(validateAgainstSchema(sparse, sch).length > 0);
});

test('L6 the packaged catalogue passes both the JS loader and the unmodified C1 reference checker', () => {
  assert.equal(lintCatalogue(CAT, SCHEMA).length, 0);
  assert.equal(validateAgainstSchema(CAT, SCHEMA).length, 0);
  assert.ok(pythonCheck(CAT));
});

test('L7 the 25 C1 catalogue mutations are rejected by the JS loader AND by the C1 reference checker (agreement)', () => {
  for (const [name, mutate] of CATALOGUE_MUTATIONS) {
    const c = clone(CAT); mutate(c);
    assert.ok(rejects(c), `JS loader accepted ${name}`);
    assert.equal(pythonCheck(c), false, `C1 checker accepted ${name}`);
  }
});

test('L8 benign edits are accepted by both (agreement is not just "reject everything")', () => {
  const edits = [
    (c) => { rec(c, 'C1-WE-HEAD-STRAIGHT').userFacing.reflection = 'Which problems do you like to solve one step at a time?'; },
    (c) => { rec(c, 'C1-IN-URDHVA-RING').suitability.rationale += ' (edited)'; },
    (c) => { c.globalPolicy.notAssessedReasons.find((r) => r.code === 'boundary').wording = 'This sat between two readings, so neither is shown.'; },
  ];
  for (const edit of edits) { const c = clone(CAT); edit(c); assert.equal(rejects(c), null); assert.ok(pythonCheck(c)); }
});

test('L9 E1 runtime refusals: publication approval, version drift, structural damage, a zero section limit', () => {
  const cases = [
    (c) => { c.status = 'APPROVED'; },
    (c) => { rec(c, 'C1-WE-RING-LONG').review.status = 'APPROVED_FOR_PERSONALISED_READING'; },
    (c) => { c.featureSetVersion = 'palm-03-i1-feature-set@0.2.0'; },
    (c) => { c.interpretations.pop(); },
    (c) => { c.interpretations.push(clone(c.interpretations[0])); },
    (c) => { rec(c, 'C1-WE-HEAD-SLOPING').unexpected = true; },
    (c) => { c.globalPolicy.maxInterpretationsPerCategory = 0; },
    (c) => { rec(c, 'C1-IN-PITR-KNOWLEDGE').requires[0].provenanceAllowed = ['user-guessed']; },
  ];
  for (const [i, mutate] of cases.entries()) { const c = clone(CAT); mutate(c); assert.ok(rejects(c), `case ${i} accepted`); }
  // the loader never mutates its input
  const c = clone(CAT); loadLibrary(c, SCHEMA); assert.deepEqual(c, CAT);
});

test('L10 the full C1 reference suite (checker, oracle, 40 negative cases) passes unmodified on the packaged library', () => {
  const dir = tmpdir('ref');
  const r = python([path.join(E1, 'reference', 'run_reference.py'), CAT_PATH, SCHEMA_PATH, dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /25 catalogue \+ 13 example \+ 2 sweep mutations: ALL CAUGHT/);
});
