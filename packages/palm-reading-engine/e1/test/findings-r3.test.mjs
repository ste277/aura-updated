// AURA-PALM-03-E1-R3 -- regressions for the independent assessment of 4dc40fc (F2, F4, F5, F7 at package level;
// F6 and the end-to-end text path are in test/palm03E1Engine.test.ts, the release guards in test/palm03E1ReleaseGuards).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/index.mjs';
import * as compose from '../src/compose.mjs';
import * as observations from '../src/observations.mjs';
import * as core from '../src/engine-core.mjs';
import * as packaged from '../src/packaged.mjs';
import { CAT_PATH, SCHEMA_PATH, readJson, clone, rec } from './helpers.mjs';

const CAT = readJson(CAT_PATH);
const SCHEMA = readJson(SCHEMA_PATH);
const syn = { synthetic: true };
const plan = (obs, o = {}) => E.planSelection(E.defaultLibrary(), obs, { ...syn, ...o });

// ---------------------------------------------------------------- F2 content safeguards
test('F2 R2 witnesses: injected notAssessed wording and injected fallback wording are refused by the loader', () => {
  const a = clone(CAT); a.globalPolicy.notAssessedReasons.find((r) => r.code === 'boundary').wording = 'You will die young.';
  assert.throws(() => E.loadLibrary(a, SCHEMA), (e) => e.code === 'invalid-catalogue' && /notAssessedReasons boundary/.test(e.message));
  const b = clone(CAT); b.readingModes.modeBehaviour.combined.emptyResult = 'You will die young.';
  assert.throws(() => E.loadLibrary(b, SCHEMA), (e) => e.code === 'invalid-catalogue' && /emptyResult must be a plain code/.test(e.message));
  const c = clone(CAT); rec(c, 'C1-WE-HEAD-SLOPING').userFacing.applicationNote = { text: 'You will die young.' };
  assert.throws(() => E.loadLibrary(c, SCHEMA), (e) => e.code === 'invalid-catalogue'); // nested object
  const d = clone(CAT); rec(d, 'C1-WE-HEAD-SLOPING').userFacing.extra = 'x';
  assert.throws(() => E.loadLibrary(d, SCHEMA), (e) => e.code === 'invalid-catalogue'); // unexpected field
});

test('F2 the text composer has no catalogue, schema or library override: it is pinned to the packaged library', () => {
  assert.equal(compose.composeReading.length, 2); // (minted, opts)
  assert.throws(() => compose.composeReading({ observations: {}, qualityAccepted: true }, { ...syn, library: E.loadLibrary(CAT, SCHEMA) }), (e) => e.code === 'invalid-input');
  assert.equal(packaged.pinnedLibrary(), E.defaultLibrary());
  assert.ok(!('composeFromObservations' in E) && !('composeReading' in E) && !('deriveObservations' in E) && !('readingFromConstruction' in E));
});

test('F2 planSelection (the only path that accepts fixture libraries) never carries interpretation or reason text', () => {
  const r = plan({ 'lines.head': { provenance: 'user-confirmed', value: 0.2 }, 'lines.heart': { notAssessed: 'user-skipped' } });
  const json = JSON.stringify(r);
  assert.ok(!/"text"|"wording"|"reading"|"observation"|"reflection"|"applicationNote"/.test(json), json);
  assert.deepEqual(Object.keys(r.sections[0].items[0]), ['recordId', 'rank', 'section']);
});

test('F2 validateReadingOutput rejects altered frames, foreign fields, non-string text, injected wording anywhere, and unknown fallbacks', () => {
  const lib = E.defaultLibrary();
  const base = () => ({ engine: { id: 'x' }, synthetic: true, contentStatus: 'UNREVIEWED_RESEARCH_CONTENT', publicationApproved: false, mode: 'combined', tierCeiling: 'tentative',
    frame: "This reading describes what palm-reading traditions said about features you traced, measured or told us about. Each item names the tradition it comes from. Where Indian and Western readings are equally suitable, the Indian one is preferred. It is not a scientific assessment and not a prediction. Please don't use it for decisions about health, money, work or relationships.",
    quality: { accepted: true }, sections: [{ category: 'strengths', items: [{ recordId: 'C1-IN-PITR-KNOWLEDGE', text: { observation: 'o', reading: 'r', reflection: 'q?' } }] }], moreFromYourReading: [], domains: [], notAssessed: [], observed: [], historicalContextMatched: [], emptyResult: null });
  assert.doesNotThrow(() => compose.validateReadingOutput(base(), lib));
  const bad = [
    (r) => { r.frame += ' You will die.'; }, (r) => { r.extra = 1; }, (r) => { r.sections[0].items[0].text.applicationNote = { t: 'x' }; },
    (r) => { r.sections[0].items[0].text.reading = 'This shows a long life.'; }, (r) => { r.sections[0].items[0].text.reflection = 'q'; },
    (r) => { r.notAssessed.push({ feature: 'lines.head', code: 'boundary', wording: 'You will die young.' }); }, (r) => { r.emptyResult = 'You will die young.'; },
    (r) => { r.quality.detail = 'your future is fixed'; }, (r) => { r.sections[0].items[0].text.extraField = 'x'; }, (r) => { r.observed.push({ value: Number.POSITIVE_INFINITY }); },
    (r) => { r.domains.push(new Date(0)); }, (r) => { r.sections[0].items[0].sources = [{ title: 'Guaranteed wealth' }]; },
  ];
  for (const [i, m] of bad.entries()) { const r = base(); m(r); assert.throws(() => compose.validateReadingOutput(r, lib), (e) => e.code === 'content-violation', String(i)); }
});

// ---------------------------------------------------------------- F4 conflicting interpretations
test('F4 R2 witness: the alternative-catalogue overlap that emitted both head-line readings at slope 0.2000 is refused', () => {
  const c = clone(CAT);
  rec(c, 'C1-WE-HEAD-SLOPING').requires[0].observation.range.min = 0.09;
  rec(c, 'C1-WE-HEAD-STRAIGHT').requires[0].observation.range.max = 0.3;
  assert.throws(() => E.loadLibrary(c, SCHEMA), (e) => e.code === 'invalid-catalogue' && /C1-WE-HEAD-STRAIGHT and C1-WE-HEAD-SLOPING can both match/.test(e.message));
  // touching clean regions are also refused (closed bands: the clean region ends one grid step inside the margin)
  const t = clone(CAT); rec(t, 'C1-WE-HEAD-STRAIGHT').requires[0].observation.range.max = 0.0801; // clean to 0.0500 ... vs SLOPING clean from 0.1401
  assert.ok(E.loadLibrary(t, SCHEMA));
  const u = clone(CAT); rec(u, 'C1-WE-HEAD-STRAIGHT').requires[0].observation.range.max = 0.1702; // clean up to 0.1401 = SLOPING's first clean value
  assert.throws(() => E.loadLibrary(u, SCHEMA), (e) => /incompatible range overlap/.test(e.message));
  const v = clone(CAT); rec(v, 'C1-WE-HEART-BETWEEN').requires[0].observation.categorical = 'index';
  assert.throws(() => E.loadLibrary(v, SCHEMA), (e) => /same categorical value/.test(e.message));
});

test('F4 / A4 (independent of oracle parity): every feature value yields at most one item, and each observed feature is either read by exactly one item or listed exactly once', () => {
  const lib = E.defaultLibrary();
  const features = {};
  for (const id of lib.initialIds) for (const r of lib.byId[id].requires) (features[r.feature] ??= { prov: r.provenanceAllowed[0], cats: new Set() }).cats.add(r.observation?.categorical);
  let n = 0;
  for (const [f, info] of Object.entries(features)) {
    const values = [...info.cats].some((x) => x !== undefined)
      ? [...info.cats, 'other', 'unknown-zone'].flatMap((v) => [{ value: v }, { value: v, nearEdge: true, adjacentZone: [...info.cats][0] }])
      : Array.from({ length: 4001 }, (_, k) => ({ value: (k - 1000) / 10000 })).concat(Array.from({ length: 300 }, (_, k) => ({ value: (100 + k) / 100 })));
    for (const v of values) for (const mode of E.MODES) {
      const r = plan({ [f]: { provenance: info.prov, ...v } }, { mode });
      const items = r.sections.flatMap((x) => x.items);
      const listed = r.notAssessed.filter((x) => x.feature === f);
      assert.ok(items.length <= 1, `${f}=${JSON.stringify(v)}: ${items.map((x) => x.recordId)}`);
      assert.equal(items.length + listed.length, 1, `${f}=${JSON.stringify(v)}/${mode}`);
      n++;
    }
  }
  assert.ok(n > 20000, `cases: ${n}`);
});

// ---------------------------------------------------------------- F5 numerical compatibility
test('F5 the I1 serialized-grid membership rule: no tolerance; 0.20000000001 is off the grid; round3/round4 values are on it', () => {
  assert.equal(E.gridStatus(0.20000000001), 'off-grid');
  assert.equal(E.gridStatus(0.2), 'ok');
  assert.equal(E.gridStatus(0.0799), 'ok');
  assert.equal(E.gridStatus(1.069), 'ok');
  assert.equal(E.gridStatus(0.12345), 'off-grid');
  assert.equal(E.gridStatus(2.1657716808922185e+304), 'out-of-range');
  assert.equal(E.gridStatus(9e+304), 'out-of-range');
  assert.equal(E.gridStatus(E.MAX_INTERPRETABLE), 'ok');
  assert.equal(E.gridStatus(Number.NaN), 'not-finite');
  for (let k = -20000; k <= 20000; k += 7) { const v = Math.round((k / 7919) * 1000) / 1000; assert.equal(E.gridStatus(v), 'ok', String(v)); const w = Math.round((k / 7919) * 10000) / 10000 + 0; assert.equal(E.gridStatus(w), 'ok', String(w)); }
  assert.throws(() => plan({ 'lines.head': { provenance: 'user-confirmed', value: 0.20000000001 } }), (e) => e.code === 'invalid-input' && /off-grid/.test(e.message));
  assert.throws(() => plan({ 'measurements.indexToRingRatio': { provenance: 'automatic-measured', value: 2.1657716808922185e+304 } }), (e) => e.code === 'invalid-input' && /out-of-range/.test(e.message));
});

test('F5 exact boundaries and one grid step either side, plus large in-range magnitudes, compare exactly', () => {
  const head = (v) => { const r = plan({ 'lines.head': { provenance: 'user-confirmed', value: v } }); return r.sections.flatMap((x) => x.items.map((i) => i.recordId)).join() || r.notAssessed[0].code; };
  assert.deepEqual([0.0199, 0.02, 0.0201, 0.0799, 0.08, 0.0801, 0.1399, 0.14, 0.1401].map(head), ['C1-WE-HEAD-STRAIGHT', 'boundary', 'boundary', 'boundary', 'boundary', 'boundary', 'boundary', 'boundary', 'C1-WE-HEAD-SLOPING']);
  const ratio = (v) => { const r = plan({ 'measurements.middleToPalmRatio': { provenance: 'automatic-measured', value: v } }); return r.sections.flatMap((x) => x.items.map((i) => i.recordId)).join() || r.notAssessed[0].code; };
  assert.equal(ratio(999999.999), 'C1-WE-FINGER-LONG');
  assert.equal(ratio(-999999.999), 'C1-WE-FINGER-SHORT');
  assert.equal(ratio(0.769), 'C1-WE-FINGER-SHORT');
  assert.equal(ratio(0.77), 'boundary');
});

// ---------------------------------------------------------------- F7 synthetic-only enforcement
test('F7 R2 witness: importing compose.mjs directly no longer emits a reading without a synthetic declaration', () => {
  const lib = E.defaultLibrary();
  assert.throws(() => compose.composeReading({ 'lines.life': { provenance: 'user-confirmed', value: 'present' } }, {}), (e) => e.code === 'synthetic-required');
  assert.throws(() => compose.composeReading(lib, { 'lines.life': { provenance: 'user-confirmed', value: 'present' } }), (e) => e.code === 'synthetic-required' || e.code === 'invalid-input');
  // with the declaration, hand-made observations are still refused: only observations minted from one input compose
  assert.throws(() => compose.composeReading({ observations: { 'lines.life': { provenance: 'user-confirmed', value: 'present' } }, qualityAccepted: true }, syn), (e) => e.code === 'invalid-input');
  assert.equal(observations.isMintedObservations({ observations: {} }), false);
});

test('F7 every exported function able to produce a reading or a plan refuses without { synthetic: true }', () => {
  const lib = E.defaultLibrary();
  const noSyn = [undefined, null, {}, { synthetic: 'yes' }, { synthetic: 1 }, { synthetic: false }];
  for (const o of noSyn) {
    assert.throws(() => compose.composeReading({}, o), (e) => e.code === 'synthetic-required');
    assert.throws(() => compose.planSelection(lib, {}, o), (e) => e.code === 'synthetic-required');
    assert.throws(() => E.planSelection(lib, {}, o), (e) => e.code === 'synthetic-required');
    assert.throws(() => observations.deriveObservations(lib, {}, {}, o), (e) => e.code === 'synthetic-required');
    assert.throws(() => core.readingFromConstruction({}, {}, o), (e) => e.code === 'synthetic-required');
  }
  // the inventory of exported functions per module is fixed; a new reading-capable export must be added here
  assert.deepEqual(Object.keys(compose).sort(), ['composeReading', 'planSelection', 'validateObservations', 'validateReadingOutput']);
  assert.deepEqual(Object.keys(observations).sort(), ['deriveObservations', 'isMintedObservations']);
  assert.deepEqual(Object.keys(core).sort(), ['E1Error', 'E1_ENGINE', 'readingFromConstruction']);
});
