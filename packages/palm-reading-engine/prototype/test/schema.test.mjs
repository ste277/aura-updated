// G6-D0 — schema validation tests (synthetic only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFeatures } from '../src/schema.mjs';
import { base, crease, SAMPLE_FIXTURES } from '../fixtures/synthetic-fixtures.mjs';

const codes = (r) => r.errors.map((e) => e.code);
const has = (r, code, pathPart) => r.errors.some((e) => e.code === code && (!pathPart || e.path.includes(pathPart)));

test('every sample fixture is schema-valid', () => {
  for (const [k, f] of Object.entries(SAMPLE_FIXTURES)) assert.equal(validateFeatures(f()).ok, true, k);
});

test('non-object and wrong schema/version are rejected', () => {
  assert.equal(validateFeatures(null).ok, false);
  assert.equal(validateFeatures([]).ok, false);
  const f = base(); f.schema = 'something.else'; assert.ok(has(validateFeatures(f), 'wrong-schema'));
  const g = base(); g.schemaVersion = '9.9.9'; assert.ok(has(validateFeatures(g), 'unsupported-version'));
});

test('non-synthetic input is refused in G6-D0', () => {
  const f = base(); f.synthetic = false; assert.ok(has(validateFeatures(f), 'synthetic-required'));
  const g = base(); delete g.synthetic; assert.ok(has(validateFeatures(g), 'synthetic-required'));
});

test('missing required fields are reported, never defaulted', () => {
  const paths = [['capture'], ['capture', 'handedness'], ['capture', 'orientation'], ['capture', 'quality'], ['landmarks'], ['creases'], ['scanConfidence'],
    ['creases', 'items'], ['creases', 'expectedButMissing'], ['creases', 'conflicts'], ['capture', 'dominantHand']];
  for (const p of paths) {
    const f = base(); let o = f; for (const k of p.slice(0, -1)) o = o[k]; delete o[p[p.length - 1]];
    const before = JSON.stringify(f);
    const r = validateFeatures(f);
    assert.equal(r.ok, false, p.join('.'));
    assert.equal(JSON.stringify(f), before, 'validator must not mutate/repair input');
  }
  for (const k of ['continuity', 'branches', 'detection', 'identity', 'geometry']) {
    const f = base(); delete f.creases.items[0][k]; assert.equal(validateFeatures(f).ok, false, k);
  }
});

test('unknown detectors and unknown detector versions are rejected', () => {
  const f = base(); f.creases.source = { detector: 'super-palm-ai', version: '1.0' }; assert.ok(has(validateFeatures(f), 'unknown-detector'));
  const g = base(); g.creases.source = { detector: 'creases-directional-d1', version: '2.0.0' }; assert.ok(has(validateFeatures(g), 'unknown-detector-version'));
  const h = base(); h.landmarks.source = { detector: 'mediapipe-hands', version: '0.0.1' }; assert.ok(has(validateFeatures(h), 'unknown-landmark-version'));
});

test('invalid geometry is rejected', () => {
  const cases = {
    nan: [{ x: NaN, y: 0.1 }, { x: 0.5, y: 0.1 }],
    infinite: [{ x: Infinity, y: 0.1 }, { x: 0.5, y: 0.1 }],
    outOfFrame: [{ x: 0.1, y: 0.1 }, { x: 3, y: 0.1 }],
    onePoint: [{ x: 0.1, y: 0.1 }],
    degenerate: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }],
    stringCoords: [{ x: '0.1', y: 0.1 }, { x: 0.5, y: 0.1 }],
    tooMany: Array.from({ length: 65 }, (_, i) => ({ x: i / 70, y: 0.3 })),
  };
  for (const [k, pts] of Object.entries(cases)) {
    const f = base(); f.creases.items[0].geometry.points = pts;
    assert.ok(has(validateFeatures(f), 'invalid-geometry'), k);
  }
});

test('declared descriptors are refused (engine derives them from points)', () => {
  const f = base(); f.creases.items[1].geometry.lengthNorm = 2.5;
  assert.ok(has(validateFeatures(f), 'declared-descriptor'));
});

test('hand landmarks can never be submitted as palm creases', () => {
  const a = base(); a.creases.source = { detector: 'mediapipe-hands', version: '1.2.0' };
  assert.ok(has(validateFeatures(a), 'landmark-crease-conflation'));
  const b = base(); b.landmarks.items = [{ x: 0, y: 0 }];
  assert.ok(has(validateFeatures(b), 'landmark-crease-conflation'));
  const c = base(); c.creases.items[0].id = 'index_mcp';
  assert.ok(has(validateFeatures(c), 'landmark-crease-conflation'));
  const d = base(); d.landmarks.lines = [];
  assert.ok(has(validateFeatures(d), 'landmark-crease-conflation'));
});

test('detector capabilities cannot be invented', () => {
  // D1/D3-B emit unlabelled polylines: no classifier, no calibrated confidence, no declared classes.
  for (const [det, ver] of [['creases-directional-d1', 'frozen-d1'], ['creases-directional-d3b', 'D3B-C']]) {
    const f = base(); f.creases.source = { detector: det, version: ver };
    f.creases.items.forEach((c) => { c.identity.classSource = 'classifier'; c.detection.confidenceBasis = 'uncalibrated-detector-score'; });
    assert.ok(has(validateFeatures(f), 'unsupported-capability', 'classSource'), `${det} classifier`);
    const g = base(); g.creases.source = { detector: det, version: ver };
    assert.ok(has(validateFeatures(g), 'unsupported-capability', 'classSource'), `${det} synthetic-declared`);
    const h = base(); h.creases.source = { detector: det, version: ver };
    h.creases.items.forEach((c) => { c.identity.classSource = 'user-confirmed'; c.detection.confidenceBasis = 'calibrated'; });
    assert.ok(has(validateFeatures(h), 'unsupported-capability', 'confidenceBasis'), `${det} calibrated`);
  }
});

test('identity consistency and confidence ranges are enforced', () => {
  const f = base(); f.creases.items[0].identity = { anatomicalClass: 'unclassified', classConfidence: 0.5, classSource: 'synthetic-declared' };
  assert.ok(has(validateFeatures(f), 'inconsistent'));
  const g = base(); g.creases.items[0].detection.confidence = 1.4; assert.equal(validateFeatures(g).ok, false);
  const h = base(); h.scanConfidence.value = -0.1; assert.equal(validateFeatures(h).ok, false);
  const i = base(); i.creases.items.push(crease('c-dtc', 'MINOR', [{ x: 0.1, y: 0.8 }, { x: 0.3, y: 0.9 }])); assert.ok(has(validateFeatures(i), 'duplicate'));
  const j = base(); j.creases.expectedButMissing = ['heart']; assert.equal(validateFeatures(j).ok, false);
});

test('anatomical class vocabulary excludes palmistry names', () => {
  const f = base(); f.creases.items[0].identity.anatomicalClass = 'heart'; assert.equal(validateFeatures(f).ok, false);
  assert.ok(!codes(validateFeatures(base())).length);
});
