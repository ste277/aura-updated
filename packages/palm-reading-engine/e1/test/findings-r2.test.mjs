// AURA-PALM-03-E1-R2 -- regressions for the independent assessment of e78254a (findings F1-F7; F6 frame pairing is
// end to end in test/palm03E1Engine.test.ts). Each test reproduces the reviewer's probe against the corrected engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as E from '../src/index.mjs';
import { composeReading } from '../src/compose.mjs';
import { E1, CAT_PATH, SCHEMA_PATH, readJson, clone, rec, python, pythonCheck, tmpdir, shape } from './helpers.mjs';

const CAT = readJson(CAT_PATH);
const SCHEMA = readJson(SCHEMA_PATH);
const syn = { synthetic: true };
const compose = (obs, o = {}) => E.composeFromObservations(obs, { ...syn, ...o });
const items = (r) => r.sections.flatMap((s) => s.items.map((i) => i.recordId));
const ORIGINAL_ORACLE = path.join(E1, 'reference', 'original-c1-rev4', 'check_examples.py');
const CORRECTED_ORACLE = path.join(E1, 'reference', 'check_examples.py');
const ORIGINAL_CHECKER = path.join(E1, 'reference', 'original-c1-rev4', 'check_catalogue.py');

function oracle(file, cases) {
  const dir = tmpdir('oeval');
  const cp = path.join(dir, 'cases.json'), out = path.join(dir, 'out.json');
  fs.writeFileSync(cp, JSON.stringify(cases));
  const r = python([path.join(E1, 'reference', 'oracle_eval.py'), file, CAT_PATH, cp, out]);
  assert.equal(r.status, 0, r.stderr);
  const res = readJson(out);
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}
const caseOf = (inputs) => ({ inputs, capabilities: ['essential'], qualityAccepted: true });

// ---------------------------------------------------------------- F1 library integrity and eligibility
test('F1 the validated library cannot be modified after validation; the excluded long-index bypass is closed', () => {
  const lib = E.defaultLibrary();
  assert.throws(() => { lib.byId['C1-WE-INDEX-LONG'] = { ...lib.byId['C1-WE-INDEX-LONG'], eligibility: { status: 'eligible-initial' } }; }, TypeError);
  assert.throws(() => { lib.byId['C1-WE-INDEX-LONG'].eligibility.status = 'eligible-initial'; }, TypeError);
  assert.throws(() => { lib.byId['C1-WE-INDEX-LONG'].userFacing.reading = 'x'; }, TypeError);
  assert.throws(() => { lib.catalogue.interpretations[0] = {}; }, TypeError);
  assert.throws(() => { lib.initialIds.push('C1-WE-INDEX-LONG'); }, TypeError);
  assert.equal(typeof lib.byId.set, 'undefined'); // no writable map is exposed
  assert.equal(Object.getPrototypeOf(lib.byId), null);
  // the reviewer's probe: ratio 1.2 must never emit the excluded record
  const r = compose({ 'measurements.indexToRingRatio': { provenance: 'automatic-measured', value: 1.2 } });
  assert.deepEqual(items(r), []);
  assert.equal(r.notAssessed[0].code, 'not-read-in-this-version');
});

test('F1 forged, copied or re-classified libraries are refused; eligibility is re-checked at composition', () => {
  const lib = E.defaultLibrary();
  const forged = [{ ...lib }, Object.create(lib), structuredClone(lib), new Proxy(lib, {}), { catalogue: lib.catalogue, byId: { ...lib.byId } }];
  for (const f of forged) assert.throws(() => compose({}, { library: f }), (e) => e.code === 'invalid-library');
  for (const f of forged) assert.throws(() => composeReading(f, {}, {}), (e) => e.code === 'invalid-library');
  const reclass = clone(CAT); rec(reclass, 'C1-WE-INDEX-LONG').eligibility.status = 'eligible-initial';
  assert.throws(() => E.loadLibrary(reclass, SCHEMA), (e) => e.code === 'invalid-catalogue');
  // historical records: metadata only, never personalised text
  const r = compose({ 'marks.vedi': { provenance: 'user-reported', value: 'reported' } });
  assert.deepEqual(r.historicalContextMatched, ['C1-IN-MARK-HISTORICAL-VEDI']);
  assert.deepEqual(items(r), []);
  assert.ok(!JSON.stringify(r).includes(lib.byId['C1-IN-MARK-HISTORICAL-VEDI'].traditionalInterpretation.slice(0, 30)));
});

// ---------------------------------------------------------------- F2 every user-facing field is checked
test('F2 the death-prediction injection in applicationNote is rejected (JS loader and corrected C1 checker)', () => {
  const inject = (field, text) => { const c = clone(CAT); rec(c, 'C1-WE-HEAD-SLOPING').userFacing[field] = text; return c; };
  const cases = [['applicationNote', 'This means you will die young.'], ['applicationNote', 'A sign of a long life ahead.'], ['applicationNote', 'You are going to be rich.'], ['reflection', 'Will your health hold up?']];
  for (const [field, text] of cases) {
    const c = inject(field, text);
    assert.throws(() => E.loadLibrary(c, SCHEMA), (e) => e.code === 'invalid-catalogue', text);
    assert.equal(pythonCheck(c), false, `corrected C1 checker accepted: ${text}`);
  }
  // before/after evidence: the preserved C1 rev. 4 checker accepted the applicationNote injection
  const c = inject('applicationNote', 'This means you will die young.');
  const dir = tmpdir('orig'); const p = path.join(dir, 'c.json'); fs.writeFileSync(p, JSON.stringify(c));
  assert.equal(python([ORIGINAL_CHECKER, p, SCHEMA_PATH]).status, 0, 'the original checker is expected to show the defect');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('F2 a non-emittable record keeps the C1 field set (the preserved catalogue loads unchanged); emission re-checks everything', () => {
  assert.match(CAT.interpretations.find((e) => e.id === 'C1-IN-MATSYA-PAIR-HOSPITALITY').userFacing.applicationNote, /\brich\b/);
  assert.ok(E.defaultLibrary());
  assert.equal(E.lintCatalogue(CAT, SCHEMA).length, 0);
});

// ---------------------------------------------------------------- F3 calendar dates
test('F3 impossible calendar dates are rejected; real ones (including leap days) are accepted', () => {
  const date = (d) => { const c = clone(CAT); c.generatedBy.date = d; return c; };
  for (const d of ['2026-02-30', '2026-02-29', '2025-13-01', '2026-04-31', '2026-00-10', '2026-01-00', '2026-1-01']) assert.throws(() => E.loadLibrary(date(d), SCHEMA), (e) => e.code === 'invalid-catalogue', d);
  for (const d of ['2024-02-29', '2026-11-25', '2000-02-29', '2026-12-31']) assert.ok(E.loadLibrary(date(d), SCHEMA), d);
  assert.throws(() => E.loadLibrary(date('1900-02-29'), SCHEMA)); // not a leap year
});

// ---------------------------------------------------------------- F4 contradictory interpretations, exact boundaries
test('F4 exact head slope 0.0800 never emits both readings; 0.0799 / 0.0800 / 0.0801 are all boundary', () => {
  for (const v of [0.0799, 0.08, 0.0801]) {
    for (const mode of E.MODES) {
      const r = compose({ 'lines.head': { provenance: 'user-confirmed', value: v } }, { mode });
      assert.deepEqual(items(r), [], `${v}/${mode}`);
      assert.equal(r.notAssessed[0].code, mode === 'indian-only' ? 'no-supported-content' : 'boundary', `${v}/${mode}`);
    }
  }
  // the preserved C1 rev. 4 oracle reproduces the defect; the corrected oracle agrees with the engine
  const [orig] = oracle(ORIGINAL_ORACLE, [caseOf({ 'lines.head': { provenance: 'user-confirmed', value: 0.08 } })]);
  assert.deepEqual(orig.combined.sections, { personality: ['C1-WE-HEAD-STRAIGHT', 'C1-WE-HEAD-SLOPING'] });
  const [corr] = oracle(CORRECTED_ORACLE, [caseOf({ 'lines.head': { provenance: 'user-confirmed', value: 0.08 } })]);
  assert.deepEqual(corr.combined, { sections: {}, overflow: [], notAssessed: { 'lines.head': 'boundary' }, emptyResult: 'say-nothing-emittable-list-not-assessed-point-to-guide' });
});

test('F4 one serialized grid step either side of every range threshold and margin edge; engine == corrected oracle', () => {
  const step = 1e-4;
  const g = (v) => Math.round(v * 1e4) / 1e4;
  const ranges = [];
  for (const id of E.defaultLibrary().initialIds) {
    const e = E.defaultLibrary().byId[id];
    for (const r of e.requires) if (r.observation?.range) ranges.push({ feature: r.feature, prov: r.provenanceAllowed[0], m: e.observationQuality.boundaryMargin, t: [r.observation.range.min, r.observation.range.max].filter((x) => x !== null && x !== undefined) });
  }
  const cases = [];
  for (const r of ranges) for (const t of r.t) for (const base of [t - r.m, t, t + r.m]) for (const d of [-step, 0, step]) cases.push({ feature: r.feature, prov: r.prov, v: g(base + d) });
  const inputs = cases.map((c) => caseOf({ [c.feature]: { provenance: c.prov, value: c.v } }));
  const want = oracle(CORRECTED_ORACLE, inputs);
  let contradictions = 0;
  cases.forEach((c, i) => {
    for (const mode of E.MODES) {
      const r = compose(inputs[i].inputs, { mode });
      assert.deepEqual(shape(r), want[i][mode], `${c.feature}=${c.v}/${mode}`);
      if (items(r).length > 1) contradictions++;
    }
  });
  assert.equal(contradictions, 0);
  assert.ok(cases.length >= 45, `cases: ${cases.length}`);
  // values off the serialized grid are refused, not silently rounded
  assert.throws(() => compose({ 'lines.head': { provenance: 'user-confirmed', value: 0.08000001 } }), (e) => e.code === 'invalid-input');
});

test('F4 a feature that is a boundary for one record suppresses every other record reading it (RC-7)', () => {
  const c = clone(CAT);
  rec(c, 'C1-WE-HEAD-SLOPING').requires[0].observation.range.min = 0.09; // overlap: 0.1 is clean for SLOPING? (0.01 from 0.09 -> boundary)
  rec(c, 'C1-WE-HEAD-STRAIGHT').requires[0].observation.range.max = 0.2; // 0.1 inside STRAIGHT, 0.1 from 0.2: clean
  const lib = E.loadLibrary(c, SCHEMA);
  const r = compose({ 'lines.head': { provenance: 'user-confirmed', value: 0.1 } }, { library: lib });
  assert.deepEqual(items(r), []);
  assert.equal(r.notAssessed[0].code, 'boundary');
});

// ---------------------------------------------------------------- F5 exact geometry on the serialized grid
test('F5 an exact 0.05 finger-base gap is valid wherever it lies; 0.0499 is not', () => {
  for (let k = 500; k <= 9000; k += 37) {
    const m = k / 1e4, r = (k + 500) / 1e4;
    assert.equal(E.checkFingerBases({ index: { x: 0, y: 0 }, middle: { x: m, y: 0 }, ring: { x: r, y: 0 }, little: { x: 1, y: 0 } }).ok, r <= 0.95, `${m},${r}`);
    if (r <= 0.95) assert.equal(E.checkFingerBases({ index: { x: 0, y: 0 }, middle: { x: m, y: 0 }, ring: { x: (k + 499) / 1e4, y: 0 }, little: { x: 1, y: 0 } }).ok, false);
  }
});

test('F5 an exact 0.01 endpoint tie is ambiguous at every translation; 0.0101 resolves; slope is translation-invariant', () => {
  for (let k = -2000; k <= 12000; k += 13) {
    const x0 = k / 1e4;
    const tie = [{ x: x0, y: 0.3 }, { x: (k + 3000) / 1e4, y: 0.5 }, { x: (k + 100) / 1e4, y: 0.7 }];
    assert.deepEqual(E.headSlope(tie), { ok: false, detail: 'endpoint-roles-ambiguous' }, String(x0));
    const res = [{ x: x0, y: 0.3 }, { x: (k + 3000) / 1e4, y: 0.5 }, { x: (k + 101) / 1e4, y: 0.7 }];
    assert.deepEqual(E.headSlope(res), { ok: true, value: 0.4 }, String(x0));
    const tr = [{ x: x0, y: 0.3 }, { x: (k + 5000) / 1e4, y: 0.35 }, { x: (k + 9000) / 1e4, y: 0.38 }];
    assert.deepEqual(E.headSlope(tr), { ok: true, value: 0.08 });
    assert.deepEqual(E.headSlope([...tr].reverse()), { ok: true, value: 0.08 });
    const ytie = [{ x: 0.3, y: x0 }, { x: 0.32, y: (k + 2000) / 1e4 }, { x: 0.31, y: (k + 100) / 1e4 }];
    assert.deepEqual(E.upwardEndingZone(ytie, { index: { x: 0, y: 0 }, middle: { x: 0.33, y: 0 }, ring: { x: 0.67, y: 0 }, little: { x: 1, y: 0 } }, 0.08), { ok: false, detail: 'endpoint-roles-ambiguous' });
  }
});

test('F5 zone edges: distance equal to the effective margin is near the edge; one step farther is not (every spacing)', () => {
  for (let mk = 1500; mk <= 5000; mk += 50) {
    const m = mk / 1e4, r = Math.min(9000, mk + 3300) / 1e4;
    const bases = { index: { x: 0, y: 0 }, middle: { x: m, y: 0 }, ring: { x: r, y: 0 }, little: { x: 1, y: 0 } };
    // upward: index|middle edge at m/2 (in doubled units the edge is integral)
    const edge2 = mk; // 2 x (m/2) in grid units
    const up = (xg) => E.upwardEndingZone([{ x: xg / 1e4, y: 0.9 }, { x: xg / 1e4, y: 0.5 }, { x: xg / 1e4, y: 0.12 }], bases, 0.08);
    assert.equal(up(Math.ceil(edge2 / 2)).nearEdge, true);
    // 4 x the doubled capped margin at the index|middle edge: min(8 x 0.08 grid, doubled middle-zone width = r)
    const m4 = Math.min(8 * 800, Math.round(r * 1e4));
    // largest x (grid) with 4*|2x - edge2| <= m4, then one more step
    const xin = Math.floor((edge2 + m4 / 4) / 2), xout = xin + 1;
    assert.equal(up(xin).nearEdge, true, `${m} in ${xin}`);
    assert.equal(up(xout).nearEdge, false, `${m} out ${xout}`);
  }
});
