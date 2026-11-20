// AURA-PALM-G6-D0-R1.2 — regression tests for R1.1-RV-01 (reversal leaks), R1.1-RV-03 (bounded errors),
// R1.1-RV-04 (rotation contract in the rule spec) and the R1.1-RV-02 deferral characterisation. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReading, selectVariants } from '../src/engine.mjs';
import { canonicalSequence, polylineProblem, MAX_REPORTED_ERRORS, FRAME_BOUNDS } from '../src/schema.mjs';
import { describe as describeGeom } from '../src/geometry.mjs';
import { THRESHOLDS, ROTATION_ACCEPT_LIMIT_DEG, TENTATIVE_CAP } from '../src/policy.mjs';
import { FAMILIES } from '../src/rules.mjs';
import { renderRuleSpec } from '../bin/rule-spec.mjs';
import { characterizeBoundaries } from './rv02-characterization.mjs';
import * as F from '../fixtures/synthetic-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const items = (r) => r.sections.flatMap((s) => s.items);
const fam = (r, id) => items(r).find((i) => i.familyId === id);
const dec = (r, id) => r.sections.flatMap((s) => s.declined).find((d) => d.familyId === id);
const at = (f, id) => f.creases.items.find((c) => c.id === id);
const codes = (r) => (r.errors || []).map((e) => e.code);
/** Reading minus the two fields that fingerprint the input AS SUPPLIED (documented direction-sensitive metadata). */
const orderFree = (r) => JSON.stringify({ ...r, readingId: undefined, inputSha256: undefined });
const rev = (pts) => [...pts].reverse();
let seed = 20261119; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// =====================================================================================
// R1.1-RV-01 — reversal invariance
// =====================================================================================

const minorPts = [{ x: 0.67445, y: 0.4 }, { x: 0.71845, y: 0.55 }, { x: 0.71045, y: 0.7 }, { x: 0.70245, y: 0.85 }, { x: 0.69445, y: 1 }];
const ptcPts = [{ x: 0.05, y: 0.32 }, { x: 0.14134188622064273, y: 0.3504472954068809 }, { x: 0.24074335063722457, y: 0.37373052130626044 }, { x: 0.3213391325966152, y: 0.3898496776981386 }, { x: 0.40999449275194483, y: 0.39880476458251535 }, { x: 0.5067094311032135, y: 0.42567002523564557 }];
const withMinor = (pts, mk = F.base) => () => { const f = mk(); f.creases.items.push(F.crease('c-min', 'MINOR', pts, 0.9)); return f; };
const withPTC = (pts, mk = F.base) => () => { const f = mk(); at(f, 'c-ptc').geometry.points = pts; return f; };

test('R1.1-RV-01(a): the fate-line centre counterexample gives identical readings forward and reversed', () => {
  const a = generateReading(withMinor(minorPts)()), b = generateReading(withMinor(rev(minorPts))());
  assert.equal(orderFree(a), orderFree(b));
  assert.deepEqual(describeGeom(minorPts).centroid, describeGeom(rev(minorPts)).centroid);
});

test('R1.1-RV-01(b): the PTC length counterexample gives identical readings forward and reversed', () => {
  const a = generateReading(withPTC(ptcPts)()), b = generateReading(withPTC(rev(ptcPts))());
  assert.equal(orderFree(a), orderFree(b));
  assert.equal(describeGeom(ptcPts).lengthNorm, describeGeom(rev(ptcPts)).lengthNorm);
  assert.equal(fam(a, 'F-PTC-LENGTH').tier, fam(b, 'F-PTC-LENGTH').tier);
});

test('R1.1-RV-01: canonicalSequence picks one of {points, reversed} deterministically and only re-indexes', () => {
  for (let i = 0; i < 2000; i++) {
    const n = 2 + Math.floor(rnd() * 6); const pts = Array.from({ length: n }, () => ({ x: Math.round(rnd() * 1e5) / 1e5, y: Math.round(rnd() * 1e5) / 1e5 }));
    const c = canonicalSequence(pts), cr = canonicalSequence(rev(pts));
    assert.deepEqual(c, cr); assert.ok(JSON.stringify(c) === JSON.stringify(pts) || JSON.stringify(c) === JSON.stringify(rev(pts)));
    assert.deepEqual(canonicalSequence(c), c, 'idempotent');
  }
  const pal = [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }, { x: 0.1, y: 0.2 }]; assert.equal(canonicalSequence(pal), pal);
});

/** Random valid polylines across the required categories. */
function polyline(kind) {
  const r4h = (v) => Math.round(v * 1e4) / 1e4 + (rnd() < 0.5 ? 0.00005 : 0); // coordinates on 4-dp half points
  const base = { x: 0.1 + rnd() * 0.3, y: 0.2 + rnd() * 0.3 };
  const n = 2 + Math.floor(rnd() * 7); const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (kind === 'horizontal') pts.push({ x: base.x + 0.6 * t, y: base.y + (rnd() - 0.5) * 0.004 });
    else if (kind === 'vertical') pts.push({ x: base.x + (rnd() - 0.5) * 0.004, y: base.y + 0.8 * t });
    else if (kind === 'diagonal') pts.push({ x: base.x + 0.5 * t, y: base.y + 0.5 * t + (rnd() - 0.5) * 0.01 });
    else if (kind === 'zigzag') pts.push({ x: base.x + 0.6 * t, y: base.y + (i % 2 ? 0.03 : 0) });
    else if (kind === 'negative') pts.push({ x: -0.19 + 0.5 * t, y: -0.19 + 0.3 * t + (rnd() - 0.5) * 0.01 });
    else if (kind === 'halfpoint') pts.push({ x: r4h(base.x + 0.6 * t), y: r4h(base.y + 0.1 * Math.sin(3 * t)) });
    else if (kind === 'near-degenerate') pts.push({ x: base.x + 0.0201 * t, y: base.y });
  }
  return pts;
}

test('R1.1-RV-01: every descriptor and validity verdict is bit-identical under reversal (7 categories × 3,000 polylines)', () => {
  let checked = 0;
  for (const kind of ['horizontal', 'vertical', 'diagonal', 'zigzag', 'negative', 'halfpoint', 'near-degenerate']) {
    for (let i = 0; i < 3000; i++) {
      const pts = polyline(kind);
      assert.equal(polylineProblem(pts), polylineProblem(rev(pts)), `${kind} validity`);
      if (polylineProblem(pts)) continue;
      assert.deepEqual(describeGeom(pts), describeGeom(rev(pts)), `${kind} descriptors`);
      checked++;
    }
  }
  assert.ok(checked > 15000, `checked ${checked}`);
});

test('R1.1-RV-01: whole readings are identical under reversal for random creases in every class (selected rules, declines, confidence, text, trace)', () => {
  const slots = [['c-ptc', 'PTC'], ['c-dtc', 'DTC'], ['c-tc', 'TC'], ['c-min', 'MINOR']];
  let n = 0;
  for (let i = 0; i < 1500; i++) {
    const kind = ['horizontal', 'vertical', 'diagonal', 'zigzag', 'halfpoint'][i % 5];
    const pts = polyline(kind); if (polylineProblem(pts)) continue;
    const [id, cls] = slots[i % slots.length];
    const mk = (p) => () => { const f = F.strong(); if (cls === 'MINOR') { f.creases.items = f.creases.items.filter((c) => c.id !== 'c-vert'); f.creases.items.push(F.crease(id, 'MINOR', p, 0.9)); } else at(f, id).geometry.points = p; return f; };
    const a = generateReading(mk(pts)()), b = generateReading(mk(rev(pts))());
    assert.equal(orderFree(a), orderFree(b), `${kind}/${cls} #${i}`);
    n++;
  }
  assert.ok(n > 1000);
});

test('R1.1-RV-01: fate-line centre and length boundary cases (4-dp half points) agree in both directions', () => {
  for (const cx of [0.29995, 0.30005, 0.69995, 0.70005, 0.7]) {
    const pts = [{ x: cx - 0.02, y: 0.4 }, { x: cx + 0.02, y: 0.55 }, { x: cx, y: 0.7 }, { x: cx - 0.01, y: 0.85 }, { x: cx + 0.01, y: 1 }];
    if (polylineProblem(pts)) continue;
    assert.equal(orderFree(generateReading(withMinor(pts)())), orderFree(generateReading(withMinor(rev(pts))())), `centroid ${cx}`);
  }
  for (const L of [0.46995, 0.47, 0.47005, 0.52995, 0.53005, 0.66995, 0.72995, 0.73005]) {
    const k = 5; const pts = Array.from({ length: k + 1 }, (_, i) => ({ x: 0.05 + (L / k) * i * Math.cos(0.1 * i), y: 0.32 + (L / k) * i * Math.sin(0.1 * i) }));
    if (polylineProblem(pts)) continue;
    assert.equal(orderFree(generateReading(withPTC(pts)())), orderFree(generateReading(withPTC(rev(pts))())), `length ${L}`);
  }
});

test('R1.1-RV-01: geometry limits and the 2× zig-zag bound are unchanged by canonicalisation', () => {
  const zig = Array.from({ length: 9 }, (_, i) => ({ x: 0.1 + i * 0.05625, y: 0.35 + (i % 2 ? 0.035 : 0) }));
  assert.equal(polylineProblem(zig), null); const d = describeGeom(zig); const chord = Math.hypot(zig[8].x - zig[0].x, zig[8].y - zig[0].y);
  assert.ok(d.lengthNorm / chord <= 2);
  assert.equal(polylineProblem([{ x: 0.1, y: 0.3 }, { x: 0.12, y: 0.3 }]), null); assert.equal(polylineProblem([{ x: 0.1, y: 0.3 }, { x: 0.1199999, y: 0.3 }]), 'degenerate');
  assert.equal(polylineProblem([{ x: 0.1, y: 0.3 }, { x: 0.6, y: 0.35 }, { x: 0.15, y: 0.38 }]), 'doubles-back');
  assert.equal(FRAME_BOUNDS.xMin, -0.2);
});

// =====================================================================================
// R1.1-RV-03 — bounded, deterministic validation errors
// =====================================================================================

const withUnknown = (n, mk = F.base) => () => { const f = mk(); for (let i = 0; i < n; i++) f[`k${i}`] = i; return f; };
function assertBounded(r, total) {
  assert.equal(r.status, 'invalid-input'); assert.equal(items(r).length, 0); assert.deepEqual(r.observations, []);
  assert.equal(r.errorCount, total);
  if (total > MAX_REPORTED_ERRORS) {
    assert.equal(r.errors.length, MAX_REPORTED_ERRORS + 1); assert.equal(r.errorsTruncated, true);
    const last = r.errors.at(-1); assert.equal(last.code, 'errors-truncated'); assert.equal(last.omitted, total - MAX_REPORTED_ERRORS);
  } else { assert.equal(r.errors.length, total); assert.equal(r.errorsTruncated, false); assert.ok(!codes(r).includes('errors-truncated')); }
  assert.ok(JSON.stringify(r).length < 20000, 'bounded output size');
}

test('R1.1-RV-03: error output is capped at MAX_REPORTED_ERRORS with an exact count and truncation marker', () => {
  assert.equal(MAX_REPORTED_ERRORS, 50);
  for (const n of [1, 49, 50, 51, 1000, 100000]) {
    const r = generateReading(withUnknown(n)());
    assertBounded(r, n);
    assert.equal(JSON.stringify(generateReading(withUnknown(n)())), JSON.stringify(r), `deterministic at ${n}`);
  }
});

test('R1.1-RV-03: the listed errors are the first 50 in deterministic order and never echo values', () => {
  const r = generateReading(withUnknown(80)());
  assert.deepEqual(r.errors.slice(0, 50).map((e) => e.path), Array.from({ length: 50 }, (_, i) => `$.k${i}`));
  for (const e of r.errors) { assert.ok(!/\b\d{2,}\b/.test(e.msg), e.msg); }
});

test('R1.1-RV-03: invalid input stays invalid when truncated — mixed known/unknown keys, validator-origin errors, fatal errors beyond the cap', () => {
  assertBounded(generateReading(withUnknown(60)()), 60); // otherwise-valid input + 60 unknown keys
  // validator-origin errors only (12 creases, each malformed in several fields)
  const bad = () => { const f = F.base(); f.creases.items = Array.from({ length: 12 }, (_, i) => ({ id: `-${i}`, geometry: { points: [] }, continuity: { breaks: -1 }, branches: 'x', detection: {}, identity: {} })); return f; };
  const r = generateReading(bad()); assert.equal(r.status, 'invalid-input'); assert.ok(r.errorCount > MAX_REPORTED_ERRORS); assertBounded(r, r.errorCount);
  assert.equal(JSON.stringify(generateReading(bad())), JSON.stringify(r));
  // a fatal (accessor) error that lies beyond the listing cap still makes the reading invalid, and the getter is never run
  let calls = 0;
  const lateFatal = () => { const f = {}; for (let i = 0; i < 60; i++) f[`k${i}`] = i; const g = F.base(); for (const k of Object.keys(g)) f[k] = g[k]; Object.defineProperty(f, 'capture', { get() { calls++; return g.capture; }, enumerable: true }); return f; };
  const rf = generateReading(lateFatal()); assert.equal(rf.status, 'invalid-input'); assert.equal(rf.errorCount, 61); assert.equal(rf.errorsTruncated, true); assert.equal(calls, 0);
});

test('R1.1-RV-03: hostile and repeated inputs stay bounded and deterministic', () => {
  const cases = {
    repeatedNested: () => { const f = F.base(); for (const c of f.creases.items) for (let i = 0; i < 40; i++) c[`x${i}`] = i; return f; },
    malformedArrays: () => { const f = F.base(); f.creases.items = new Array(1024).fill(0).map(() => ({ q: 1, r: 2 })); return f; },
    deepInvalid: () => { const f = F.base(); let o = {}; const root = o; for (let i = 0; i < 10000; i++) { o.n = {}; o = o.n; } f.capture.orientation = root; return f; },
    frozen: () => { const f = withUnknown(200)(); return Object.freeze(f); },
    nullProto: () => { const f = Object.assign(Object.create(null), withUnknown(200)()); return f; },
    getters: () => { const f = withUnknown(200)(); Object.defineProperty(f, 'zz', { get() { throw new Error('never'); }, enumerable: true }); return f; },
    proxy: () => new Proxy(withUnknown(200)(), {}),
    proxyTraps: () => { const t = withUnknown(200)(); return new Proxy(t, { ownKeys: (o) => Reflect.ownKeys(o), getOwnPropertyDescriptor: (o, k) => Reflect.getOwnPropertyDescriptor(o, k) }); },
    cyclic: () => { const f = withUnknown(200)(); f.self = f; f.capture.self = f.capture; return f; },
  };
  for (const [name, mk] of Object.entries(cases)) {
    let a, b; assert.doesNotThrow(() => { a = generateReading(mk()); b = generateReading(mk()); }, name);
    assert.equal(a.status, 'invalid-input', name); assert.equal(items(a).length, 0, name);
    assert.ok(a.errors.length <= MAX_REPORTED_ERRORS + 1, `${name}: ${a.errors.length}`); assert.ok(JSON.stringify(a).length < 20000, name);
    assert.equal(JSON.stringify(a), JSON.stringify(b), `${name} deterministic`);
  }
  // the same input object validated repeatedly gives the same reading and is not modified
  const f = withUnknown(300)(); const snap = JSON.stringify(f); const r1 = JSON.stringify(generateReading(f)); const r2 = JSON.stringify(generateReading(f));
  assert.equal(r1, r2); assert.equal(JSON.stringify(f), snap);
});

test('R1.1-RV-03: valid input readings are unchanged (no error fields on valid readings)', () => {
  for (const mk of Object.values(F.SAMPLE_FIXTURES)) { const r = generateReading(mk()); assert.equal(r.errorCount, undefined); assert.equal(r.errorsTruncated, undefined); }
});

// =====================================================================================
// R1.1-RV-04 — rotation contract: specification ⇔ implementation
// =====================================================================================

test('R1.1-RV-04: the rule spec states the strict >45° rule and each family’s frame requirements exactly as the engine declares them', () => {
  const spec = renderRuleSpec();
  assert.equal(ROTATION_ACCEPT_LIMIT_DEG, 45);
  assert.match(spec, /strictly greater than 45°/); assert.match(spec, /exactly 45° (the angle alone does not indicate rotation|is not rotated)/);
  assert.match(spec, /rotation-conflict/); assert.match(spec, /rotation-out-of-range/);
  for (const f of FAMILIES) {
    const sec = spec.slice(spec.indexOf(`### ${f.id} `)); const row = sec.split('\n').find((l) => l.startsWith('| Frame dependency'));
    assert.equal(/direction \(radial\/ulnar[^*]*\*\*required\*\*/.test(row), !!f.frame.direction, `${f.id} direction`);
    assert.equal(/scale \(palm width[^*]*\*\*required\*\*/.test(row), !!f.frame.scale, `${f.id} scale`);
    assert.equal(/axis \(finger-base[^*]*\*\*required\*\*/.test(row), !!(f.frame.axis || f.frame.direction), `${f.id} axis`);
  }
  const saved = path.resolve(here, '..', '..', '03_INTERPRETATION_RULE_SPEC.md');
  if (fs.existsSync(saved)) assert.equal(fs.readFileSync(saved, 'utf8'), spec, 'saved spec equals the renderer output');
});

test('R1.1-RV-04: runtime agrees with the spec at 45° boundaries, with the flag on and off', () => {
  const DIRECTION = FAMILIES.filter((f) => f.frame.direction).map((f) => f.id);
  const cases = [[44.9999, false, true], [45, false, true], [-45, false, true], [45.0001, false, false], [44.9999, true, false], [45, true, false], [45.0001, true, false], [60, true, false]];
  for (const [deg, flag, reliable] of cases) {
    const f = F.strong(); f.capture.orientation.rotationDeg = deg; if (flag) f.capture.quality.issues = ['hand-rotated'];
    const r = generateReading(f);
    assert.equal(r.frame.axisReliable, reliable, `${deg}/${flag}`);
    if (reliable) { assert.equal(fam(r, 'F-CENTRAL-LONGITUDINAL').tier, 'tentative'); for (const id of DIRECTION) assert.ok(fam(r, id), `${id} at ${deg}`); }
    else {
      const want = flag !== Math.abs(deg) > 45 ? 'rotation-conflict' : 'rotation-out-of-range';
      assert.ok(r.frame.axisReasons.includes(want), `${deg}/${flag}: ${r.frame.axisReasons}`);
      for (const id of [...DIRECTION, 'F-CENTRAL-LONGITUDINAL']) { assert.equal(fam(r, id), undefined, id); assert.equal(dec(r, id).reason, 'frame-unreliable'); }
      // INFO R1.1-RV-05 (documented, deliberate): the observation itself is still reported
      assert.equal(r.observations.find((o) => o.crease === 'CENTRAL_LONGITUDINAL').status, 'ok');
    }
  }
});

test('R1.1-RV-04: unknown orientation and unknown handedness never yield an orientation-dependent interpretation', () => {
  const DIRECTION = FAMILIES.filter((f) => f.frame.direction).map((f) => f.id);
  for (const m of [(f) => { f.capture.orientation.palmFacing = null; }, (f) => { f.capture.handedness = { value: 'unknown', source: 'unknown' }; }, (f) => { f.capture.orientation.palmFacing = null; f.capture.orientation.rotationDeg = 50; }]) {
    const f = F.strong(); m(f); const r = generateReading(f);
    for (const id of DIRECTION) assert.equal(fam(r, id), undefined, id);
  }
  for (const v of [null, undefined, 'x']) { const f = F.strong(); f.capture.orientation.rotationDeg = v; assert.equal(generateReading(f).status, 'invalid-input'); }
});

// =====================================================================================
// R1.1-RV-02 — DEFERRED: cut-offs characterised, unchanged
// =====================================================================================

test('R1.1-RV-02 (deferred): every interpretation cut-off behaves exactly as recorded (thresholds, margins, edge behaviour unchanged)', () => {
  const recorded = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'rv02-boundary-characterization.json'), 'utf8'));
  assert.deepEqual(characterizeBoundaries(), recorded);
});

test('R1.1-RV-02 (deferred): identical evidence always gives identical selection (discontinuities are thresholds, not contradictions)', () => {
  for (const f of FAMILIES) for (let i = 0; i < 500; i++) {
    const v = rnd() * 1.2 - 0.1; assert.deepEqual(selectVariants(f, v), selectVariants(f, v));
  }
});

// =====================================================================================
// Preserved safeguards
// =====================================================================================

test('PRESERVED: thresholds, tentative cap and the 0.49996 boundary are unchanged', () => {
  assert.equal(THRESHOLDS.clear, 0.75); assert.equal(THRESHOLDS.tentative, 0.5); assert.equal(TENTATIVE_CAP, 0.74);
  const tiers = (conf) => items(generateReading(F.base({ conf, scan: 0.95 }))).map((i) => i.tier);
  assert.equal(tiers(0.49996).length, 0); assert.ok(tiers(0.74996).every((t) => t === 'tentative')); assert.ok(tiers(0.75).every((t) => t === 'clear'));
  for (const it of items(generateReading(F.d3bUserConfirmed()))) assert.equal(it.tier, 'tentative');
});

// =====================================================================================
// R1.2 owner-approved CONSERVATIVE TIE RULE (R1.1-RV-01)
// =====================================================================================

const RANK = { tentative: 1, clear: 2 };
// R1.1 outcomes recorded in baseline/FINDINGS_REPRODUCED_ON_R1_1.txt (frozen R1.1 source).
const R1_1 = {
  fateForward: { central: 'tentative' }, fateReversed: { central: null },
  ptcForward: { length: 'clear' }, ptcReversed: { length: 'tentative' },
};

test('TIE RULE: fate-line reviewer case — not emitted in either order; never more confident than R1.1', () => {
  for (const [name, pts] of [['fateForward', minorPts], ['fateReversed', rev(minorPts)]]) {
    const r = generateReading(withMinor(pts)());
    assert.equal(fam(r, 'F-CENTRAL-LONGITUDINAL'), undefined, name);
    const obs = r.observations.find((o) => o.crease === 'CENTRAL_LONGITUDINAL');
    assert.equal(obs.status, 'not-observed'); assert.deepEqual(obs.tieExcludedCreaseIds, ['c-min'], 'the exclusion is traced');
    const before = R1_1[name].central; assert.ok(before === null || RANK.tentative >= 0, 'no upgrade: R1.2 emits nothing');
  }
  assert.deepEqual(describeGeom(minorPts).orderTies.centroidX, [0.7, 0.7001]);
});

test('TIE RULE: PTC-length reviewer case — tentative in both orders with both tie values traced; never more confident than R1.1', () => {
  for (const [name, pts] of [['ptcForward', ptcPts], ['ptcReversed', rev(ptcPts)]]) {
    const it = fam(generateReading(withPTC(pts)()), 'F-PTC-LENGTH');
    assert.equal(it.tier, 'tentative', name); assert.ok(RANK[it.tier] <= RANK[R1_1[name].length], `${name}: no upgrade over R1.1`);
    assert.deepEqual(it.interpretations.map((x) => x.ruleId), ['P-PTC-SHORT']);
    assert.ok(it.evidence.capsApplied.includes('order-tie')); assert.deepEqual(it.evidence.orderTie.values, [0.47, 0.4701]);
    // R1.3 REVISED EXPECTATION RE-1 (R1_3_REGRESSION_RESULTS.md): original R1.2 assertion expected the resolution label
    // 'both-neighbouring-readings-tentative' (union). The owner-approved R1.3 rule keeps only readings common to both
    // orders, labelled 'common-reading-tentative'. Tier (tentative) and readings (P-PTC-SHORT) are unchanged.
    assert.equal(it.evidence.orderTie.resolution, 'common-reading-tentative');
    assert.ok(it.uncertainty.some((u) => /boundary/.test(u)), 'the ambiguity is explained to the reader');
  }
});

/**
 * Constructive tie search: bisect a parameter t so the measured value of build(t) crosses a 4-dp half point, then
 * step t through neighbouring floating-point values until the two point orders round differently (orderTies set).
 */
function findTies(build, measure, half, field, want = 12) {
  const out = [];
  for (let shape = 0; shape < 40 && out.length < want; shape++) {
    let lo = 0.9, hi = 1.1;
    const f = (t) => measure(build(t, shape)) - half;
    if (Math.sign(f(lo)) === Math.sign(f(hi))) continue;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m; else hi = m; }
    for (let k = -64; k <= 64; k++) {
      const t = lo + k * Number.EPSILON * lo; const pts = build(t, shape);
      if (!polylineProblem(pts) && describeGeom(pts).orderTies?.[field]) { out.push(pts); break; }
    }
  }
  return out;
}
const lengthOf = (pts) => describeGeomRawLength(pts);
function describeGeomRawLength(pts) { const c = canonicalSequence(pts); let L = 0; for (let i = 1; i < c.length; i++) L += Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y); return L; }
const buildPTC = (L) => (t, shape) => { const k = 3 + (shape % 5); const bend = 0.03 + 0.01 * (shape % 7); return Array.from({ length: k + 1 }, (_, j) => ({ x: 0.05 + ((L * t) / k) * j * Math.cos(bend * j), y: 0.32 + ((L * t) / k) * j * Math.sin(bend * j) + (j % 2 ? 0.0001 * shape : 0) })); };

test('TIE RULE: adjacent rounding boundaries — length ties near 0.47 / 0.53 / 0.67 / 0.73 are order-invariant and never clear when readings differ', () => {
  let ties = 0, resolvedTentative = 0;
  for (const L of [0.47, 0.53, 0.67, 0.73]) {
    for (const half of [L - 0.00005, L + 0.00005]) {
      for (const pts of findTies(buildPTC(L), lengthOf, half, 'lengthNorm', 4)) {
        ties++;
        const a = generateReading(withPTC(pts)()), b = generateReading(withPTC(rev(pts))());
        assert.equal(orderFree(a), orderFree(b));
        const it = fam(a, 'F-PTC-LENGTH');
        if (it) assert.ok(it.evidence.orderTie, 'a tie is always traced');
        // R1.3 REVISED EXPECTATION RE-2: label 'both-neighbouring-readings-tentative' → 'common-reading-tentative' (see RE-1).
        if (it?.evidence.orderTie?.resolution === 'common-reading-tentative') { assert.equal(it.tier, 'tentative'); resolvedTentative++; }
      }
    }
  }
  assert.ok(ties >= 8, `constructed ${ties} length ties`); assert.ok(resolvedTentative >= 1, 'at least one boundary-changing tie exercised');
});

test('TIE RULE: centre ties at both edges (0.3, 0.7) withhold the fate line in both orders; non-tie centres are unaffected', () => {
  const centreOf = (pts) => { const c = canonicalSequence(pts); let s = 0; for (const p of c) s += p.x; return s / c.length; };
  const build = (edge) => (t, shape) => { const cx = edge * t; const w = 0.011 + 0.0007 * shape; return [{ x: cx - 0.02, y: 0.4 }, { x: cx + w, y: 0.55 }, { x: cx - 0.0031, y: 0.7 }, { x: cx - 0.01, y: 0.85 }, { x: cx + 0.0221 - w, y: 1 }]; };
  let ties = 0;
  for (const edge of [0.3, 0.7]) for (const half of [edge - 0.00005, edge + 0.00005]) {
    for (const pts of findTies(build(edge), centreOf, half, 'centroidX', 4)) {
      ties++;
      const a = generateReading(withMinor(pts)()), b = generateReading(withMinor(rev(pts))());
      assert.equal(orderFree(a), orderFree(b));
      const xs = describeGeom(pts).orderTies.centroidX; const inBoth = xs.every((x) => x >= 0.3 && x <= 0.7);
      assert.equal(!!fam(a, 'F-CENTRAL-LONGITUDINAL'), inBoth);
      if (!inBoth && xs.some((x) => x >= 0.3 && x <= 0.7)) assert.deepEqual(a.observations.find((o) => o.crease === 'CENTRAL_LONGITUDINAL').tieExcludedCreaseIds, ['c-min']);
    }
  }
  assert.ok(ties >= 2, `constructed ${ties} centre ties`);
  assert.equal(fam(generateReading(F.strong()), 'F-CENTRAL-LONGITUDINAL').tier, 'tentative', 'non-tie centre unaffected');
});

test('TIE RULE: tie fields appear only on rounding ties — none of the 13 samples carries one', () => {
  for (const mk of Object.values(F.SAMPLE_FIXTURES)) {
    const s = JSON.stringify(generateReading(mk()));
    assert.ok(!/orderTie|tieExcludedCreaseIds|order-tie/.test(s));
  }
});
