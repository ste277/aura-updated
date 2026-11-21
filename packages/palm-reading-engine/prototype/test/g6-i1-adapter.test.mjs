// AURA-PALM-G6-I1 — adapter contract tests (B1–B7 and the owner-approved behaviour). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateReading } from '../src/engine.mjs';
import { validateFeatures, FRAME_BOUNDS, MAX_POINTS, DETECTOR_REGISTRY } from '../src/schema.mjs';
import { orientations, orderFree, summarize, meet, violations } from './oracle.mjs';
import { toFeatures, adaptDetection, palmFrame, toPalm, AdapterError, MAX_CANDIDATES } from '../../adapter/feature-adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(here, '..', '..');
const INPUTS = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'g6-i1-adapter-inputs.json'), 'utf8'));
const D1_FILE = path.join(PKG, 'vendor', 'AURA_PALM_G4_D1', 'evidence', 'd1_candidates_existing_fixtures.json');
const D1 = JSON.parse(fs.readFileSync(D1_FILE, 'utf8'));
const FRAME = INPUTS.frame;
const clone = (o) => JSON.parse(JSON.stringify(o));
const det = (cands, over = {}) => ({ detector: 'creases-directional-d1', version: 'frozen-d1', candidates: clone(cands), ...over });
const SYN = INPUTS.cases.find((c) => c.category === 'adapter-synthetic-identity' && c.detection.candidates.length === 3);
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof AdapterError && e.code === code, code);

test('G6-I1 inputs: adapter inputs are the frozen D1 evidence (hash-pinned) and the G4 synthetic frame, unaltered', () => {
  const pinned = fs.readFileSync(path.join(PKG, 'vendor', 'AURA_PALM_G4_D1', 'SHA256SUMS'), 'utf8').trim().split(/\s+/)[0];
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(D1_FILE)).digest('hex'), pinned);
  assert.equal(INPUTS.source.sha256, pinned);
  for (const c of INPUTS.cases.filter((x) => x.category === 'adapter-frozen')) {
    const key = Object.keys(D1).find((k) => `${k.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}--frozen` === c.id);
    assert.ok(key, c.id); assert.deepEqual(c.detection.candidates, D1[key], c.id);
  }
  assert.deepEqual(FRAME.landmarks.points, { wrist: { x: 240, y: 560 }, indexMcp: { x: 150, y: 250 }, pinkyMcp: { x: 365, y: 270 } });
});

test('G6-I1 B1: output is plain JSON with only feature-contract fields and validates; malformed inputs fail closed', () => {
  const f = toFeatures(SYN.detection, FRAME, SYN.identity);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(f))), JSON.stringify(f));
  assert.deepEqual(validateFeatures(f), { ok: true, errors: [], warnings: [] });
  assert.deepEqual(Object.keys(f).sort(), ['capture', 'creases', 'landmarks', 'scanConfidence', 'schema', 'schemaVersion', 'synthetic']);
  for (const it of f.creases.items) assert.deepEqual(Object.keys(it).sort(), ['branches', 'continuity', 'detection', 'geometry', 'id', 'identity']);
  const d = clone(SYN.detection);
  const withAccessor = clone(d); Object.defineProperty(withAccessor.candidates[0], 'score', { get: () => 0.6, enumerable: true }); throwsCode(() => toFeatures(withAccessor, FRAME), 'not-plain-json');
  const nan = clone(d); nan.candidates[0].points[0].x = NaN; throwsCode(() => toFeatures(nan, FRAME), 'not-plain-json');
  const proto = clone(d); proto.candidates[0] = Object.assign(Object.create({ evil: 1 }), proto.candidates[0]); throwsCode(() => toFeatures(proto, FRAME), 'not-plain-json');
  const sym = clone(d); sym.candidates[0][Symbol('x')] = 1; throwsCode(() => toFeatures(sym, FRAME), 'not-plain-json');
  const fn = clone(FRAME); fn.capture.quality.issues = [() => 1]; throwsCode(() => toFeatures(d, fn), 'not-plain-json');
  const cyc = clone(d); cyc.candidates[0].self = cyc.candidates[0]; throwsCode(() => toFeatures(cyc, FRAME), 'not-plain-json');
  const extra = clone(d); extra.candidates[0].landmarks = [1, 2]; throwsCode(() => toFeatures(extra, FRAME), 'invalid-candidate');
  throwsCode(() => toFeatures(det([]), {}), 'invalid-frame');
  throwsCode(() => toFeatures(null, FRAME), 'invalid-detection');
  throwsCode(() => toFeatures(det([], { detector: 'mediapipe-hands', version: '1.2.0' }), FRAME), 'unpinned-detector');
  throwsCode(() => toFeatures(det([], { version: 'frozen-d2' }), FRAME), 'unpinned-detector');
  throwsCode(() => toFeatures(det([], { detector: 'synthetic-fixture', version: '0.1.0' }), FRAME), 'unpinned-detector');
  throwsCode(() => toFeatures(det(Array.from({ length: MAX_CANDIDATES + 1 }, () => d.candidates[0])), FRAME), 'too-many-candidates');
});

test('G6-I1 B2: frame attestation is forwarded unaltered; landmark coordinates are never forwarded', () => {
  const fr = clone(FRAME); fr.capture.orientation = { rotationDeg: -44.9999, palmFacing: null }; fr.capture.quality = { status: 'needs-retake', issues: ['hand-rotated'] }; fr.capture.handedness = { value: 'left', source: 'landmark-model' };
  const f = toFeatures(SYN.detection, fr);
  assert.deepEqual(f.capture, { handedness: fr.capture.handedness, dominantHand: fr.capture.dominantHand, orientation: fr.capture.orientation, quality: fr.capture.quality });
  assert.deepEqual(f.landmarks, { present: true, source: { detector: 'synthetic-fixture', version: '0.1.0' } });
  const s = JSON.stringify(f);
  for (const lm of Object.values(FRAME.landmarks.points)) for (const v of [lm.x, lm.y]) assert.ok(!new RegExp(`[:\\[,]${v}[,}\\]]`).test(s), `landmark coordinate ${v} must not appear`);
  assert.ok(!/wrist|indexMcp|pinkyMcp|points"?:\{"wrist/.test(s));
});

test('G6-I1 B3: track point order is preserved exactly — no resampling, sorting, de-duplication or truncation', () => {
  const f = toFeatures(SYN.detection, FRAME);
  const pf = palmFrame(FRAME.landmarks.points);
  f.creases.items.forEach((it) => { const c = SYN.detection.candidates[Number(it.id.slice(4)) - 1]; assert.deepEqual(it.geometry.points, c.points.map((p) => toPalm(pf, p)), it.id); });
  const rev = clone(SYN.detection); rev.candidates[0].points.reverse();
  assert.deepEqual(toFeatures(rev, FRAME).creases.items[0].geometry.points, [...f.creases.items[0].geometry.points].reverse());
  const dup = clone(SYN.detection); dup.candidates[0].points.splice(1, 0, { ...dup.candidates[0].points[1] });
  assert.equal(toFeatures(dup, FRAME).creases.items[0].geometry.points.length, dup.candidates[0].points.length, 'a repeated point is forwarded, not removed');
});

test('G6-I1 B4/B5: no branches are synthesised; gapsBridged is metadata only and breaks is always null', () => {
  const d = clone(SYN.detection); d.candidates.forEach((c, i) => { c.gapsBridged = i * 3; });
  const f = toFeatures(d, FRAME);
  for (const [i, it] of f.creases.items.entries()) { assert.deepEqual(it.branches, []); assert.deepEqual(it.continuity, { gapsBridged: i * 3, breaks: null }); }
  throwsCode(() => toFeatures(det([{ ...d.candidates[0], gapsBridged: -1 }]), FRAME), 'invalid-candidate');
  throwsCode(() => toFeatures(det([{ ...d.candidates[0], gapsBridged: 1.5 }]), FRAME), 'invalid-candidate');
});

test('G6-I1 B6: pixel → palm-normalized-v1 transform (anchors, unit, bounds) and per-crease decline outside the frame or above 64 points', () => {
  const pf = palmFrame(FRAME.landmarks.points);
  const near = (a, b) => assert.ok(Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  near(toPalm(pf, FRAME.landmarks.points.indexMcp), { x: 0, y: 0 }); near(toPalm(pf, FRAME.landmarks.points.pinkyMcp), { x: 1, y: 0 });
  assert.ok(toPalm(pf, FRAME.landmarks.points.wrist).y > 0, 'wrist lies towards +y (finger base → wrist)');
  const base = SYN.detection.candidates[0];
  const far = { ...base, points: [base.points[0], { x: 900, y: 900 }] };
  const long = { ...base, points: Array.from({ length: MAX_POINTS + 1 }, (_, k) => ({ x: 170 + k * 0.5, y: 330 + k * 0.2 })) };
  const exact = { ...base, points: Array.from({ length: MAX_POINTS }, (_, k) => ({ x: 170 + k * 0.5, y: 330 + k * 0.2 })) };
  const one = { ...base, points: [base.points[0]] };
  const r = adaptDetection(det([far, long, exact, one, { ...base, score: 1301.37 }]), FRAME);
  assert.deepEqual(r.declined.map((x) => [x.id, x.reason]), [['cand1', 'outside-frame-bounds'], ['cand2', 'too-many-points'], ['cand4', 'too-few-points'], ['cand5', 'score-not-normalised']]);
  assert.deepEqual(r.features.creases.items.map((i) => [i.id, i.geometry.points.length]), [['cand3', MAX_POINTS]], 'the 64-point crease is forwarded whole; the 65-point one is declined, never truncated');
  for (const it of r.features.creases.items) for (const p of it.geometry.points) assert.ok(p.x >= FRAME_BOUNDS.xMin && p.x <= FRAME_BOUNDS.xMax && p.y >= FRAME_BOUNDS.yMin && p.y <= FRAME_BOUNDS.yMax);
  const bad = clone(FRAME); bad.landmarks.points.pinkyMcp = { ...bad.landmarks.points.indexMcp }; throwsCode(() => toFeatures(SYN.detection, bad), 'invalid-frame');
  const flat = clone(FRAME); flat.landmarks.points.wrist = { x: 257.5, y: 260 }; throwsCode(() => toFeatures(SYN.detection, flat), 'invalid-frame');
});

test('G6-I1 B7: opaque ids cand1…cand6 by detector order, stable across declines; ids satisfy the engine contract', () => {
  const c = SYN.detection.candidates;
  const r = adaptDetection(det([{ ...c[0], score: 5 }, c[1], c[2]]), FRAME);
  assert.deepEqual(r.features.creases.items.map((i) => i.id), ['cand2', 'cand3']);
  assert.deepEqual(r.declined.map((x) => x.id), ['cand1']);
  assert.deepEqual(validateFeatures(r.features).ok, true);
});

test('G6-I1 identity and confidence: unclassified by default; scores only as uncalibrated-detector-score; never calibrated; synthetic user-confirmed identity only when explicitly synthetic', () => {
  const f = toFeatures(SYN.detection, FRAME);
  for (const it of f.creases.items) { assert.deepEqual(it.identity, { anatomicalClass: 'unclassified', classConfidence: 0, classSource: 'none' }); assert.deepEqual(it.detection, { confidence: 0.6, confidenceBasis: 'uncalibrated-detector-score' }); }
  assert.deepEqual(f.creases.expectedButMissing, []); assert.deepEqual(f.creases.conflicts, []);
  assert.deepEqual(f.scanConfidence, { value: FRAME.scanConfidence.value, basis: 'uncalibrated-detector-score' });
  assert.ok(!JSON.stringify(f).includes('"calibrated"'));
  const cal = clone(FRAME); cal.scanConfidence.basis = 'calibrated'; throwsCode(() => toFeatures(SYN.detection, cal), 'calibrated-scan-confidence-refused');
  const g = toFeatures(SYN.detection, FRAME, SYN.identity);
  assert.ok(g.creases.items.every((i) => i.identity.classSource === 'user-confirmed'));
  throwsCode(() => toFeatures(SYN.detection, FRAME, { ...SYN.identity, synthetic: false }), 'non-synthetic-identity-refused');
  throwsCode(() => toFeatures(SYN.detection, FRAME, { kind: 'user-confirmed', labels: [] }), 'non-synthetic-identity-refused');
  throwsCode(() => toFeatures(SYN.detection, FRAME, { ...SYN.identity, labels: [{ candidate: 9, anatomicalClass: 'DTC', classConfidence: 0.9 }] }), 'invalid-identity');
  throwsCode(() => toFeatures(SYN.detection, FRAME, { ...SYN.identity, labels: [{ candidate: 0, anatomicalClass: 'head line', classConfidence: 0.9 }] }), 'invalid-identity');
  const two = { ...SYN.identity, labels: [{ candidate: 0, anatomicalClass: 'PTC', classConfidence: 0.9 }, { candidate: 1, anatomicalClass: 'PTC', classConfidence: 0.9 }] };
  const h = toFeatures(SYN.detection, FRAME, two);
  assert.deepEqual(h.creases.conflicts, [{ ids: ['cand1', 'cand2'], kind: 'class-collision' }]); assert.deepEqual(h.creases.expectedButMissing, ['DTC', 'TC']);
});

test('G6-I1 determinism and orientation: identical output on repeat; reversed tracks give the same reading; mirrored and rotated images give the same palm-frame geometry', () => {
  const a = JSON.stringify(toFeatures(SYN.detection, FRAME, SYN.identity));
  for (let k = 0; k < 5; k++) assert.equal(JSON.stringify(toFeatures(clone(SYN.detection), clone(FRAME), clone(SYN.identity))), a);
  // point-order reversal of any subset of tracks: the engine reading is identical (reversal invariance through the adapter)
  const base = generateReading(toFeatures(SYN.detection, FRAME, SYN.identity));
  for (let m = 1; m < 1 << SYN.detection.candidates.length; m++) {
    const d = clone(SYN.detection); d.candidates.forEach((c, b) => { if (m & (1 << b)) c.points.reverse(); });
    assert.equal(orderFree(generateReading(toFeatures(d, FRAME, SYN.identity))), orderFree(base), `mask ${m}`);
  }
  // a horizontally mirrored image (left hand) and a rotated image map to the same palm-frame points
  const W = 480; const mir = (p) => ({ x: W - p.x, y: p.y });
  const th = 0.4, rot = (p) => ({ x: 240 + (p.x - 240) * Math.cos(th) - (p.y - 300) * Math.sin(th), y: 300 + (p.x - 240) * Math.sin(th) + (p.y - 300) * Math.cos(th) });
  for (const tf of [mir, rot]) {
    const d = clone(SYN.detection); d.candidates.forEach((c) => { c.points = c.points.map(tf); });
    const fr = clone(FRAME); for (const k of Object.keys(fr.landmarks.points)) fr.landmarks.points[k] = tf(fr.landmarks.points[k]);
    const gr = adaptDetection(d, fr, SYN.identity), f = toFeatures(SYN.detection, FRAME, SYN.identity); const g = gr.features;
    assert.deepEqual(gr.declined, [], `${tf.name}: no crease may be declined after the transform`);
    assert.ok(f.creases.items.length > 0); assert.deepEqual(g.creases.items.map((i) => i.id), f.creases.items.map((i) => i.id), tf.name);
    g.creases.items.forEach((it, i) => it.geometry.points.forEach((p, j) => { const q = f.creases.items[i].geometry.points[j]; assert.ok(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9); }));
  }
});

test('G6-I1 end to end: every frozen D1 output declines through the pipeline; synthetic-score cases never claim above tentative and never upgrade the meet of their orientations', () => {
  let frozen = 0, interpreted = 0;
  for (const c of INPUTS.cases) {
    const r = adaptDetection(c.detection, FRAME, c.identity);
    assert.equal(validateFeatures(r.features).ok, true, c.id);
    const vars = orientations(r.features); const readings = vars.map(({ input }) => generateReading(input));
    for (const x of readings) assert.equal(orderFree(x), orderFree(readings[0]), `${c.id}: reversal invariance`);
    const reading = readings[0];
    if (c.category === 'adapter-frozen') { frozen++; assert.equal(r.features.creases.items.length, 0, c.id); assert.ok(r.declined.every((d) => d.reason === 'score-not-normalised'), c.id); assert.notEqual(reading.status, 'interpreted', c.id); }
    else {
      for (const s of reading.sections || []) for (const it of s.items) assert.equal(it.tier, 'tentative', `${c.id}: uncalibrated scores cap at tentative`);
      if (c.category === 'adapter-synthetic-identity' && reading.status === 'interpreted') interpreted++;
      if (c.category === 'adapter-synthetic-score') assert.notEqual(reading.status, 'interpreted', `${c.id}: unlabelled output must not be interpreted`);
    }
    assert.deepEqual(violations(summarize(reading), meet(readings.map(summarize))), [], c.id);
  }
  assert.equal(frozen, 66); assert.ok(interpreted >= 30, `interpreted synthetic-identity cases: ${interpreted}`);
  assert.deepEqual(Object.keys(DETECTOR_REGISTRY).map((k) => [k, [...DETECTOR_REGISTRY[k].versions]]), [['synthetic-fixture', ['0.1.0']], ['creases-directional-d1', ['frozen-d1']], ['creases-directional-d3b', ['D3B-C']]]);
});

test('G6-I1 bundle guard: every production-build sentinel occurs in the engine/adapter source and nowhere else under apps/ or packages/', async () => {
  const REPO = path.resolve(PKG, '..', '..');
  const guard = path.join(REPO, 'apps', 'web', 'scripts', 'check-palm-engine-bundle.js');
  const src = fs.readFileSync(guard, 'utf8');
  const list = src.slice(src.indexOf('const SENTINELS = ['), src.indexOf('];', src.indexOf('const SENTINELS = [')));
  const SENTINELS = [...list.matchAll(/^\s*'([^']+)',/gm)].map((m) => m[1]);
  assert.ok(SENTINELS.length >= 5, `sentinels parsed: ${SENTINELS.length}`);
  const read = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.next', '.git'].includes(e.name) ? [] : read(path.join(d, e.name))) : /\.(m?[jt]sx?|c?js|json)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const engineText = [...read(path.join(PKG, 'prototype', 'src')), ...read(path.join(PKG, 'adapter'))].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const s of SENTINELS) assert.ok(engineText.includes(s), `sentinel must occur in the engine/adapter source: ${s}`);
  const others = ['apps', 'packages'].flatMap((d) => read(path.join(REPO, d))).filter((f) => !path.resolve(f).startsWith(path.resolve(PKG) + path.sep) && path.resolve(f) !== path.resolve(guard));
  for (const f of others) { const t = fs.readFileSync(f, 'utf8'); for (const s of SENTINELS) assert.ok(!t.includes(s), `sentinel ${s} also occurs in ${path.relative(REPO, f)}`); }
  // the guard really fails on a build that contains the engine, and passes a clean one
  const { scan } = await import(pathToFileURL(guard).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-engine-bundle-'));
  try {
    fs.mkdirSync(path.join(tmp, '.next', 'static'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.next', 'static', 'a.js'), 'console.log("clean")');
    assert.deepEqual(scan(tmp), []);
    for (const s of SENTINELS) { fs.writeFileSync(path.join(tmp, '.next', 'static', 'b.js'), `var x=${JSON.stringify(s)}`); assert.equal(scan(tmp).length, 1, s); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
