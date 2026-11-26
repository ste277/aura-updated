// AURA-PALM-03-E1-R4 -- regressions for independent ticket 50323 (F2, F6, F7; release-guard completeness is in
// guard.test.mjs G1b). Readings end to end, and the F6 feature-set witnesses, are in test/palm03E1Engine.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as E from '../src/index.mjs';
import * as packaged from '../src/packaged.mjs';
import { validateReadingOutput, READING_FRAME } from '../src/compose.mjs';
import { requireSyntheticOptions } from '../src/identity.mjs';
import { E1, CAT_PATH, SCHEMA_PATH, readJson, clone, rec, tmpdir } from './helpers.mjs';

const CAT = readJson(CAT_PATH);
const SCHEMA = readJson(SCHEMA_PATH);
const node = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: E1 });

// ---------------------------------------------------------------- F2 catalogue immutability
test('F2 the packaged bytes are the C1 rev. 4 deliverables; 29 records with their classifications', () => {
  for (const [name, digest] of Object.entries(packaged.C1_REV4_DIGESTS)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(E1, 'library', `${name}.json`))).digest('hex'), digest, name);
  }
  const lib = E.defaultLibrary();
  assert.equal(lib.order.length, 29);
  const counts = {};
  for (const id of lib.order) counts[lib.byId[id].eligibility.status] = (counts[lib.byId[id].eligibility.status] ?? 0) + 1;
  assert.deepEqual(counts, { 'eligible-initial': 12, 'eligible-later': 7, held: 3, 'excluded-initial': 2, 'historical-context-only': 5 });
  assert.ok(lib.order.every((id) => lib.byId[id].review.status === 'UNREVIEWED_RESEARCH_CONTENT'));
});

test('F2 witness, fresh process: mutating the catalogue JSON module BEFORE E1 first loads does not reach E1', () => {
  // the same module-map object an importer of the JSON path receives (the R3 export was this object)
  const r = node(`
    import cat from './library/catalogue.json' with { type: 'json' };
    cat.interpretations.find((e) => e.id === 'C1-IN-PITR-KNOWLEDGE').userFacing.applicationNote = 'You have cancer.';
    cat.interpretations[0].userFacing.reading = 'You have cancer.';
    const E = await import('./src/index.mjs');
    const lib = E.defaultLibrary();
    const t = JSON.stringify(lib.catalogue);
    console.log(JSON.stringify({ leaked: t.includes('You have cancer.'), exported: 'PACKAGED_CATALOGUE' in E, note: lib.byId['C1-IN-PITR-KNOWLEDGE'].userFacing.applicationNote.slice(0, 30) }));`);
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim());
  assert.deepEqual([o.leaked, o.exported], [false, false]);
  assert.match(o.note, /^The texts name this line/);
});

test('F2 the authoritative library is immutable after initialization: nested objects, arrays and indexes', () => {
  const lib = E.defaultLibrary();
  const before = JSON.stringify(lib);
  const attempts = [
    () => { lib.byId['C1-IN-PITR-KNOWLEDGE'].userFacing.applicationNote = 'You have cancer.'; },
    () => { lib.catalogue.interpretations[0].userFacing.reading = 'You have cancer.'; },
    () => { lib.catalogue.interpretations[0] = {}; },
    () => { lib.catalogue.interpretations.push({}); },
    () => { lib.catalogue.interpretations.length = 0; },
    () => { lib.catalogue.interpretations[0].requires[0].observation = {}; },
    () => { lib.catalogue.globalPolicy.notAssessedReasons[0].wording = 'You have cancer.'; },
    () => { lib.reasons.boundary.wording = 'You have cancer.'; },
    () => { lib.sources[Object.keys(lib.sources)[0]].title = 'x'; },
    () => { lib.order.reverse(); },
    () => { lib.initialIds.splice(0, 1); },
    () => { lib.byId['C1-NEW'] = {}; },
    () => { delete lib.byId['C1-IN-PITR-KNOWLEDGE']; },
    () => { Object.defineProperty(lib.catalogue, 'libraryVersion', { value: 'x' }); },
    () => { Object.setPrototypeOf(lib.catalogue.interpretations[0], { userFacing: { reading: 'x' } }); },
    () => { lib.catalogue.readingModes.modeBehaviour.combined.emptyResult = 'You have cancer.'; },
  ];
  for (const [i, f] of attempts.entries()) assert.throws(f, TypeError, `attempt ${i} must throw (strict mode, frozen)`);
  assert.equal(JSON.stringify(lib), before);
  assert.equal(E.defaultLibrary(), lib); // validation and generation use this one object
});

test('F2 altered packaged bytes make the engine fail to load (fail closed), even if the change is not prohibited wording', () => {
  const t = tmpdir('r4-bytes');
  try {
    for (const d of ['src', 'library']) fs.cpSync(path.join(E1, d), path.join(t, 'e1', d), { recursive: true });
    const p = path.join(t, 'e1', 'library', 'catalogue.json');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('The texts name this line after knowledge', 'The texts name this line after learning'));
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path.join(t, 'e1', 'src', 'packaged.mjs')).href)})`], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /invalid-catalogue.*not the C1 rev\. 4 deliverable/);
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});

test('F2 defence in depth: medical-claim wording is refused by the loader and in the output, in any field', () => {
  for (const w of ['You have cancer.', 'This may indicate a tumour.', 'A sign of diabetes.', 'Consider medical treatment.', 'It suggests a disorder.', 'This is a diagnosis of anxiety.']) {
    const c = clone(CAT); rec(c, 'C1-IN-PITR-KNOWLEDGE').userFacing.applicationNote = w;
    assert.throws(() => E.loadLibrary(c, SCHEMA), (e) => e.code === 'invalid-catalogue', w);
    const d = clone(CAT); rec(d, 'C1-WE-HEAD-SLOPING').userFacing.reading = w;
    assert.throws(() => E.loadLibrary(d, SCHEMA), (e) => e.code === 'invalid-catalogue', w);
  }
  // and at output, in every string field (validated before any reading is returned)
  const reading = (note) => ({ engine: { id: 'x' }, synthetic: true, contentStatus: 'UNREVIEWED_RESEARCH_CONTENT', publicationApproved: false, mode: 'combined', tierCeiling: 'tentative', frame: READING_FRAME,
    quality: { accepted: true }, sections: [{ category: 'strengths', items: [{ recordId: 'C1-IN-PITR-KNOWLEDGE', text: { observation: 'o', reading: 'r', reflection: 'q?', applicationNote: note } }] }], moreFromYourReading: [], domains: [], notAssessed: [], observed: [], historicalContextMatched: [], emptyResult: null });
  assert.doesNotThrow(() => validateReadingOutput(reading('A note.'), E.defaultLibrary()));
  assert.throws(() => validateReadingOutput(reading('You have cancer.'), E.defaultLibrary()), (e) => e.code === 'content-violation');
  // the medical vocabulary does not reject the approved-for-development catalogue (e.g. 'treatises')
  assert.doesNotThrow(() => E.loadLibrary(CAT, SCHEMA));
});

// ---------------------------------------------------------------- F7 explicit synthetic declaration
const NOT_DECLARED = () => [
  ['omitted', undefined], ['null', null], ['plain {}', {}], ['false', { synthetic: false }], ['string', { synthetic: 'true' }], ['number', { synthetic: 1 }],
  ['boxed true', { synthetic: Object(true) }], ['array', [true]], ['function', () => true],
  ['inherited', Object.create({ synthetic: true })], ['accessor', Object.defineProperty({}, 'synthetic', { get: () => true, enumerable: true })],
  ['class instance', new (class { constructor() { this.synthetic = true; } })()], ['Map', new Map([['synthetic', true]])],
];

test('F7 an own data property exactly true is required; omitted, inherited, false, malformed and non-boolean refused', () => {
  for (const [what, o] of NOT_DECLARED()) {
    assert.throws(() => requireSyntheticOptions(o, ['synthetic']), (e) => e.code === 'synthetic-required', what);
    assert.throws(() => E.planSelection(E.defaultLibrary(), {}, o), (e) => e.code === 'synthetic-required', what);
  }
  assert.doesNotThrow(() => requireSyntheticOptions({ synthetic: true }, ['synthetic']));
  assert.doesNotThrow(() => requireSyntheticOptions(Object.assign(Object.create(null), { synthetic: true }), ['synthetic']));
  assert.throws(() => requireSyntheticOptions({ synthetic: true, library: {} }, ['synthetic']), (e) => e.code === 'invalid-option');
  // R6: a symbol key makes the options uncapturable (refused at the snapshot boundary)
  assert.throws(() => requireSyntheticOptions({ synthetic: true, [Symbol('x')]: 1 }, ['synthetic']), (e) => e.code === 'invalid-option' || e.code === 'synthetic-required');
});

test('F7 witness, fresh process: a polluted Object.prototype does not make {} -- or an accessor -- a synthetic declaration', () => {
  const r = node(`
    const E = await import('./src/index.mjs');
    const out = {};
    const tryPlan = (o) => { try { E.planSelection(E.defaultLibrary(), {}, o); return 'produced'; } catch (e) { return e.code; } };
    Object.defineProperty(Object.prototype, 'synthetic', { value: true, configurable: true });
    out.ambient = tryPlan({});
    delete Object.prototype.synthetic;
    // R4 independent witness: an accessor-only declaration whose descriptor inherits Object.prototype.value = true
    const accessor = { get synthetic() { throw new Error('getter invoked'); } };
    Object.defineProperty(Object.prototype, 'value', { value: true, configurable: true });
    out.accessorInheritedValue = tryPlan(accessor);
    delete Object.prototype.value;
    out.valid = tryPlan({ synthetic: true });
    console.log(JSON.stringify(out));`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { ambient: 'synthetic-required', accessorInheritedValue: 'synthetic-required', valid: 'produced' });
});

// ---------------------------------------------------------------- F6 single construction path (package level)
test('F6 R5: no package module exports a pipeline, a claim, or any function taking a builder or feature set; the reader is reading.ts only', async () => {
  assert.ok(!fs.existsSync(path.join(E1, 'src', 'engine-core.mjs')) && !fs.existsSync(path.join(E1, 'src', 'observations.mjs')));
  const forbidden = /claim|reader|pipeline|composeReading|deriveObservations|readingFromConstruction|generate/i;
  for (const f of fs.readdirSync(path.join(E1, 'src')).filter((x) => x.endsWith('.mjs'))) {
    const m = await import(pathToFileURL(path.join(E1, 'src', f)).href);
    for (const k of Object.keys(m)) assert.ok(!forbidden.test(k), `${f} exports ${k}`);
  }
  const reading = fs.readFileSync(path.join(E1, 'src', 'reading.ts'), 'utf8');
  assert.deepEqual([...reading.matchAll(/^export (?:function|const|type) (\w+)/gm)].map((x) => x[1]).sort(), ['E1Error', 'E1_ENGINE', 'ReadingMode', 'generateSyntheticReading']);
  assert.match(reading, /^const BUILD: \(input: PalmFeatureSetInput\) => Any = buildPalmFeatureSet;$/m); // bound at load, never a parameter
});
