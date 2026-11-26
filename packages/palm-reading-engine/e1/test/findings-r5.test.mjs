// AURA-PALM-03-E1-R5 -- regressions for the R4 independent verification of 63b6a9d (F2 inherited fields, F7 accessor
// with inherited descriptor value; F6 and the full-reading F2 checks are end to end in test/palm03E1Engine.test.ts;
// the release-guard startup-module checks are guard.test.mjs G1c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as E from '../src/index.mjs';
import { E1, CAT_PATH, readJson } from './helpers.mjs';

const node = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: E1 });

// Every optional field of the C1 schema (fields a record may omit), plus the observation-shape keys the matcher tests.
const OPTIONAL_FIELDS = ['anatomical', 'observation', 'descriptor', 'range', 'categorical', 'thresholdStatus', 'min', 'max', 'measurementStatusRequired', 'boundaryMargin', 'displayRule', 'originalTerm', 'translationOfTerm', 'verification', 'note', 'overallSupport', 'conflicts', 'traditionNotes', 'selfReport', 'readingModes', 'complementsIndianGap', 'wordingFidelity', 'reflection', 'applicationNote', 'notes', 'sourceWording', 'title', 'notAssessed', 'detail', 'nearEdge', 'adjacentZone'];

test('F2 R5: the library is private null-prototype records -- no catalogue object has a prototype chain', () => {
  const lib = E.defaultLibrary();
  const seen = [];
  const walk = (v) => { if (v && typeof v === 'object') { if (!Array.isArray(v)) seen.push(Object.getPrototypeOf(v)); for (const x of Object.values(v)) walk(x); } };
  walk(lib.catalogue);
  assert.ok(seen.length > 500 && seen.every((p) => p === null), `${seen.filter((p) => p !== null).length} objects with a prototype`);
  for (const k of ['byId', 'reasons', 'sources']) assert.equal(Object.getPrototypeOf(lib[k]), null, k);
  assert.equal(JSON.stringify(lib.catalogue), JSON.stringify(readJson(CAT_PATH))); // content unchanged
});

test('F2 R5 witness class, fresh processes: an inherited value for ANY optional field, set BEFORE E1 loads, changes nothing', () => {
  // each run is a new process; the pollution (if any) is installed before the E1 modules are first imported
  const run = (field) => node(`
    const field = ${JSON.stringify(field)};
    if (field) {
      const poison = field === 'conflicts' || field === 'readingModes' ? ['indian-only'] : field === 'range' ? { min: -1e6, max: 1e6 } : field === 'categorical' ? ['between', 'jupiter'] : field === 'nearEdge' ? true : 'You have melanoma.';
      Object.defineProperty(Object.prototype, field, { value: poison, configurable: true, writable: true });
    }
    const E = await import('./src/index.mjs');
    const lib = E.defaultLibrary();
    const OBS = [{}, { 'lines.heart': { provenance: 'user-confirmed', value: 'between', nearEdge: false, adjacentZone: null, descriptor: 'heart-ending-zone' }, 'lines.head': { provenance: 'user-confirmed', value: 0.2 }, 'measurements.middleToPalmRatio': { provenance: 'automatic-measured', value: 1.1 }, 'lines.life': { notAssessed: 'user-skipped' } }];
    const plans = ['combined', 'indian-only', 'western-only'].flatMap((mode) => OBS.map((o) => E.planSelection(lib, o, { synthetic: true, mode })));
    if (field) delete Object.prototype[field];
    console.log(JSON.stringify([lib.catalogue, plans]));`);
  const clean = run(null);
  assert.equal(clean.status, 0, clean.stderr);
  for (const field of OPTIONAL_FIELDS) {
    const r = run(field);
    assert.equal(r.status, 0, `${field}: ${r.stderr}`);
    assert.ok(!r.stdout.includes('melanoma'), field);
    assert.equal(r.stdout, clean.stdout, `inherited ${field} changed the library or a plan`);
  }
});

test('F2 R5: the loader refuses accessor, symbol-keyed and non-plain catalogue values (only own data is read)', () => {
  const cat = readJson(CAT_PATH), schema = readJson(CAT_PATH.replace('catalogue.json', 'schema.json'));
  const withAccessor = structuredClone(cat);
  Object.defineProperty(withAccessor.interpretations[0].userFacing, 'applicationNote', { get: () => 'x', enumerable: true });
  assert.throws(() => E.loadLibrary(withAccessor, schema), (e) => e.code === 'invalid-catalogue' && /not a data property/.test(e.message));
  const withSymbol = structuredClone(cat); withSymbol.interpretations[0][Symbol('x')] = 1;
  assert.throws(() => E.loadLibrary(withSymbol, schema), (e) => e.code === 'invalid-catalogue');
  const withDate = structuredClone(cat); withDate.interpretations[0].userFacing.applicationNote = new Date(0);
  assert.throws(() => E.loadLibrary(withDate, schema), (e) => e.code === 'invalid-catalogue');
  const sparse = structuredClone(cat); sparse.interpretations.length += 1;
  assert.throws(() => E.loadLibrary(sparse, schema), (e) => e.code === 'invalid-catalogue');
});

test('F7 R5: the descriptor check reads only the descriptor\'s own fields (accessor + inherited value is refused, before any work)', () => {
  const r = node(`
    const { requireSyntheticOptions, isOwnDataDescriptor } = await import('./src/identity.mjs');
    const E = await import('./src/index.mjs');
    Object.defineProperty(Object.prototype, 'value', { value: true, configurable: true });
    const out = {};
    const accessor = { get synthetic() { out.getterRan = true; return true; } };
    try { requireSyntheticOptions(accessor, ['synthetic']); out.direct = 'accepted'; } catch (e) { out.direct = e.code; }
    try { E.planSelection(E.defaultLibrary(), { 'lines.life': { provenance: 'user-confirmed', value: 'present' } }, accessor); out.plan = 'produced'; } catch (e) { out.plan = e.code; }
    out.descriptor = isOwnDataDescriptor(Object.getOwnPropertyDescriptor(accessor, 'synthetic'));
    delete Object.prototype.value;
    console.log(JSON.stringify(out));`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { direct: 'synthetic-required', plan: 'synthetic-required', descriptor: false });
});
