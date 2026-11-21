// AURA-PALM-G6-D0-R1.1 — regression tests for the R1 review MINOR findings (R1-RV-01..05, 07), the INFO items
// addressed in scope (R1-RV-08, R1-RV-09) and G6-D0 RV-09 / RV-10. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReading, inputHash } from '../src/engine.mjs';
import { snapshotInput, SNAPSHOT_ARRAY_LIMIT } from '../src/snapshot.mjs';
import { polylineProblem, atMost, GEOMETRY_CONTRACT } from '../src/schema.mjs';
import { describe as describeGeom, verticalDeviation, axisRoles } from '../src/geometry.mjs';
import { THRESHOLDS } from '../src/policy.mjs';
import { FAMILIES } from '../src/rules.mjs';
import * as F from '../fixtures/synthetic-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const items = (r) => r.sections.flatMap((s) => s.items);
const declined = (r) => r.sections.flatMap((s) => s.declined);
const fam = (r, id) => items(r).find((i) => i.familyId === id);
const dec = (r, id) => declined(r).find((d) => d.familyId === id);
const at = (f, id) => f.creases.items.find((c) => c.id === id);
const codes = (r) => (r.errors || []).map((e) => e.code);
const run = (mk) => { let r; assert.doesNotThrow(() => { r = generateReading(mk()); }); return r; };
const invalidWith = (mk, code) => { const r = run(mk); assert.equal(r.status, 'invalid-input'); assert.equal(items(r).length, 0); if (code) assert.ok(codes(r).includes(code), `${code} not in ${codes(r)}`); return r; };
const json = (o) => JSON.parse(JSON.stringify(o));
const DIRECTION = FAMILIES.filter((f) => f.frame.direction).map((f) => f.id);

// =====================================================================================
// R1-RV-02 — stable validated input snapshot
// =====================================================================================

test('R1-RV-02: the engine reads the caller object once; later mutation-between-reads cannot change the reading', () => {
  // A Proxy that answers palmFacing:null on the first descriptor read and true afterwards, and counts reads per key.
  const reads = new Map();
  const base = F.strong();
  const orientation = new Proxy(base.capture.orientation, {
    getOwnPropertyDescriptor(t, k) {
      const n = (reads.get(k) || 0) + 1; reads.set(k, n);
      const d = Reflect.getOwnPropertyDescriptor(t, k);
      if (k === 'palmFacing') return { ...d, value: n === 1 ? null : true };
      return d;
    },
  });
  base.capture.orientation = orientation;
  const r = generateReading(base);
  for (const [k, n] of reads) assert.ok(n <= 1, `${String(k)} read ${n} times`);
  assert.equal(r.frame.palmFacing, null, 'the first (and only) answer is what the engine uses');
  for (const id of DIRECTION) assert.equal(fam(r, id), undefined);
  for (const it of items(r)) assert.equal(it.tier, 'tentative');
});

test('R1-RV-02: the engine never consults the raw argument after snapshotting (static) and never mutates it', () => {
  const src = fs.readFileSync(path.join(here, '..', 'src', 'engine.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export function generateReading(rawInput)'));
  assert.equal((body.match(/\brawInput\b/g) || []).length, 2, 'rawInput: parameter + snapshotInput(rawInput) only');
  for (const mk of Object.values(F.SAMPLE_FIXTURES)) {
    const f = mk(); const before = JSON.stringify(f);
    generateReading(f);
    assert.equal(JSON.stringify(f), before); assert.equal(Object.isFrozen(f), false, 'caller object is not frozen by the engine');
  }
});

test('R1-RV-02: the snapshot is deep-frozen, null-prototype plain data and equal in content to valid JSON input', () => {
  const s = snapshotInput(F.strong());
  assert.equal(s.fatal, false); assert.deepEqual(s.errors, []);
  assert.ok(Object.isFrozen(s.value) && Object.isFrozen(s.value.creases.items[0].geometry.points[0]));
  assert.equal(Object.getPrototypeOf(s.value), null); assert.ok(Array.isArray(s.value.creases.items));
  assert.deepEqual(sortKeys(json(s.value)), sortKeys(json(F.strong())));
  assert.equal(inputHash(s.value), inputHash(json(F.strong())));
});
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])); return v; }

test('R1-RV-02: valid JSON inputs keep their behaviour (JSON round-trip and null-prototype copies give identical readings)', () => {
  const nullProto = (v) => { if (Array.isArray(v)) return v.map(nullProto); if (v && typeof v === 'object') { const o = Object.create(null); for (const k of Object.keys(v)) o[k] = nullProto(v[k]); return o; } return v; };
  for (const [name, mk] of Object.entries(F.SAMPLE_FIXTURES)) {
    const a = JSON.stringify(generateReading(mk()));
    assert.equal(JSON.stringify(generateReading(json(mk()))), a, name);
    assert.equal(JSON.stringify(generateReading(nullProto(json(mk())))), a, name);
  }
});

// =====================================================================================
// Hostile / unsupported JavaScript objects (R1-RV-02)
// =====================================================================================

test('HOSTILE: accessors are rejected without being invoked (getter, setter-only, getter on array index)', () => {
  let calls = 0;
  invalidWith(() => { const f = F.base(); Object.defineProperty(f.capture.orientation, 'palmFacing', { get() { calls++; return true; }, enumerable: true }); return f; }, 'unreadable-input');
  invalidWith(() => { const f = F.base(); Object.defineProperty(f.creases.items[0], 'id', { set() { calls++; }, enumerable: true }); return f; }, 'unreadable-input');
  invalidWith(() => { const f = F.base(); Object.defineProperty(f.creases.items[0].geometry.points, 1, { get() { calls++; return { x: 0.8, y: 0.19 }; }, enumerable: true, configurable: true }); return f; }, 'unreadable-input');
  invalidWith(() => { const f = F.base(); Object.defineProperty(f, 'capture', { get() { calls++; return F.base().capture; }, enumerable: true }); return f; }, 'unreadable-input');
  assert.equal(calls, 0, 'no user-supplied accessor was executed');
});

test('HOSTILE: Proxies with throwing traps and revoked Proxies give a controlled invalid-input', () => {
  const thrower = (t, trap) => new Proxy(t, { [trap]() { throw new Error(`trap ${trap}`); } });
  for (const trap of ['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf']) {
    invalidWith(() => thrower(F.base(), trap), 'unreadable-input');
    invalidWith(() => { const f = F.base(); f.capture = thrower(f.capture, trap); return f; }, 'unreadable-input');
    invalidWith(() => { const f = F.base(); f.creases.items = thrower(f.creases.items, trap); return f; }, 'unreadable-input');
  }
  for (const where of ['top', 'nested', 'array']) {
    invalidWith(() => {
      const f = F.base();
      const { proxy, revoke } = Proxy.revocable(where === 'top' ? f : where === 'nested' ? f.capture : f.creases.items, {}); revoke();
      if (where === 'top') return proxy; if (where === 'nested') f.capture = proxy; else f.creases.items = proxy; return f;
    }, 'unreadable-input');
  }
});

test('HOSTILE: arrays with unusual properties are rejected (own iterator, extra keys, holes, subclass, too long)', () => {
  invalidWith(() => { const f = F.base(); f.creases.items[Symbol.iterator] = () => { throw new Error('boom'); }; return f; }, 'unsupported-shape');
  invalidWith(() => { const f = F.base(); const real = f.creases.items.slice(1); f.creases.items[Symbol.iterator] = function* () { yield* real; }; return f; }, 'unsupported-shape');
  invalidWith(() => { const f = F.base(); f.creases.items.extra = 1; return f; }, 'unsupported-shape');
  invalidWith(() => { const f = F.base(); f.creases.items[0].geometry.points.length = 8; return f; }, 'unsupported-shape'); // holes
  invalidWith(() => { const f = F.base(); class Sneaky extends Array {} f.creases.items = Sneaky.from(f.creases.items); return f; }, 'unsupported-shape');
  const big = invalidWith(() => { const f = F.base(); f.creases.items = new Array(SNAPSHOT_ARRAY_LIMIT + 1).fill(f.creases.items[0]); return f; }, 'too-many');
  assert.equal(big.errors.length, 1, 'R1-RV-09 (INFO): one bounded error, not one per element');
  const huge = invalidWith(() => { const f = F.base(); f.creases.items = new Array(1_000_000).fill(0); return f; }, 'too-many');
  assert.equal(huge.errors.length, 1);
});

test('HOSTILE: prototype manipulation, built-ins, boxed primitives and non-JSON values are rejected', () => {
  const shapes = [
    (f) => { Object.setPrototypeOf(f.capture, { palmFacing: true }); }, (f) => { f.capture.orientation = new (class O { constructor() { this.rotationDeg = 4; this.palmFacing = true; } })(); },
    (f) => { f.capture.quality.issues = new Set(); }, (f) => { f.creases.items[0].geometry = new Map(); }, (f) => { f.scanConfidence = new Date(); },
    (f) => { f.creases.items[0].geometry.points = new Float64Array(4); }, (f) => { f.creases.items[0].id = new String('c-dtc'); }, (f) => { f.scanConfidence.value = new Number(0.9); },
    (f) => { f.creases.source = /x/; }, (f) => { f.capture = Promise.resolve(1); }, (f) => { f.capture[Symbol('s')] = 1; },
    (f) => { Object.defineProperty(f.capture, 'dominantHand', { value: 'right', enumerable: false }); },
  ];
  for (const m of shapes) invalidWith(() => { const f = F.base(); m(f); return f; }, 'unsupported-shape');
  const values = [(f) => { f.scanConfidence.value = 1n; }, (f) => { f.creases.items[0].id = Symbol('id'); }, (f) => { f.capture.dominantHand = () => 'right'; }, (f) => { f.creases.items[0].continuity.breaks = 2n; }];
  for (const m of values) invalidWith(() => { const f = F.base(); m(f); return f; }, 'unsupported-value');
});

test('HOSTILE: cycles and shared references inside contract fields never loop or throw', () => {
  invalidWith(() => { const f = F.base(); const p = f.creases.items[0].geometry.points; p.push(p); return f; }, 'invalid-geometry');
  invalidWith(() => { const f = F.base(); const iss = f.capture.quality.issues; iss.push(iss); return f; }, 'invalid');
  invalidWith(() => { const f = F.base(); f.creases.items[0].identity.alternatives = [f.creases.items[0].identity]; return f; }, 'unknown-field');
  invalidWith(() => { const f = F.base(); f.creases.items.push(f.creases.items[0]); return f; }, 'duplicate');
  invalidWith(() => { const f = F.base(); f.capture.self = f; return f; }, 'unknown-field');
});

// =====================================================================================
// G6-D0 RV-09 / RV-10 — closed schema over the same snapshot
// =====================================================================================

test('RV-09: the input hash is computed over the validated snapshot; unhashable extras cannot crash it', () => {
  for (const extra of [10n, Symbol('x'), () => 1, undefined]) {
    const r = run(() => { const f = F.base(); f.extra = extra; return f; });
    assert.ok(codes(r).includes('unknown-field'), 'unknown keys are rejected even when their value is undefined (stricter than JSON)');
  }
  const r = generateReading(F.base());
  assert.equal(r.inputSha256, inputHash(snapshotInput(F.base()).value));
});

test('RV-10: unknown keys (e.g. raw landmark coordinates) are rejected at every level, without echoing values', () => {
  const muts = [
    (f) => { f.landmarks.points21 = Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: 0.5 })); },
    (f) => { f.landmarks.source.coords = [1, 2]; }, (f) => { f.capture.faceEmbedding = [0.1]; }, (f) => { f.creases.items[0].rawPixels = 'xyz'; },
    (f) => { f.creases.items[0].geometry.points[0].z = 0; }, (f) => { f.creases.items[0].identity.alternatives = [{ anatomicalClass: 'PTC', classConfidence: 0.2, note: 'x' }]; },
    (f) => { f.scanConfidence.calibration = {}; }, (f) => { f.creases.conflicts = [{ ids: ['c-dtc'], kind: 'overlap', why: 'x' }]; },
  ];
  for (const m of muts) {
    const r = invalidWith(() => { const f = F.base(); m(f); return f; }, 'unknown-field');
    for (const e of r.errors) assert.ok(!/0\.\d{3}|xyz/.test(e.msg));
  }
  invalidWith(() => JSON.parse(JSON.stringify(F.base()).replace('"capture":{', '"capture":{"__proto__":{"palmFacing":true},')), 'unknown-field');
  invalidWith(() => JSON.parse(JSON.stringify(F.base()).replace('{"schema"', '{"constructor":{"x":1},"schema"')), 'unknown-field');
  // inherited specific codes are preserved for known-forbidden keys
  invalidWith(() => { const f = F.base(); f.landmarks.items = []; return f; }, 'landmark-crease-conflation');
  invalidWith(() => { const f = F.base(); f.creases.items[0].geometry.lengthNorm = 0.8; return f; }, 'declared-descriptor');
});

// =====================================================================================
// R1-RV-01 — reversal-invariant verticality at the 30° boundary
// =====================================================================================

const atDeg = (deg, len = 0.45, x0 = 0.5, y0 = 0.4, sx = 1) => { const t = (deg * Math.PI) / 180; return [{ x: x0, y: y0 }, { x: x0 + sx * len * Math.sin(t), y: y0 + len * Math.cos(t) }]; };
const withMinor = (pts, mk = F.base) => () => { const f = mk(); f.creases.items.push(F.crease('c-min', 'MINOR', pts, 0.9)); return f; };
const central = (r) => r.observations.find((o) => o.crease === 'CENTRAL_LONGITUDINAL').status;

test('R1-RV-01: the reviewer counterexample (30.00005°) now classifies identically in both directions', () => {
  const pts = [{ x: 0.5, y: 0.4 }, { x: 0.7500003778747724, y: 0.833012483725898 }];
  assert.equal(verticalDeviation(pts), verticalDeviation([...pts].reverse()));
  const a = generateReading(withMinor(pts)()); const b = generateReading(withMinor([...pts].reverse())());
  assert.equal(JSON.stringify(a.sections), JSON.stringify(b.sections)); assert.equal(central(a), central(b));
});

test('R1-RV-01: exactly 30°, just below, just above, negative slope, vertical and horizontal behave predictably', () => {
  const cases = [[30, 'ok'], [29.9999, 'ok'], [30.0001, 'not-observed'], [30.00005, 'not-observed'], [0, 'ok'], [15, 'ok'], [45, 'not-observed'], [89, 'not-observed']];
  for (const [deg, want] of cases) for (const sx of [1, -1]) for (const rev of [false, true]) {
    let pts = atDeg(deg, 0.45, 0.5, 0.4, sx); if (rev) pts = [...pts].reverse();
    if (polylineProblem(pts)) continue; // a horizontal 2-point MINOR is still valid; guard for clarity
    const r = generateReading(withMinor(pts)());
    assert.equal(central(r), want, `${deg}° sx=${sx} rev=${rev}`);
  }
  assert.ok(atMost(verticalDeviation(atDeg(30)), 30), 'nominal 30° is inclusive whatever its IEEE representation');
});

test('R1-RV-01: degenerate geometry never reaches the verticality measurement', () => {
  invalidWith(withMinor([{ x: 0.5, y: 0.4 }, { x: 0.5, y: 0.4 }]), 'invalid-geometry');
  invalidWith(withMinor([{ x: 0.5, y: 0.4 }, { x: 0.5, y: 0.41 }]), 'invalid-geometry');
});

test('R1-RV-01: random polylines — verticality is bit-identical under reversal and the trace shows the rounded value', () => {
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 20000; i++) {
    const n = 2 + Math.floor(rnd() * 5); const pts = Array.from({ length: n }, () => ({ x: rnd() * 1.4 - 0.2, y: rnd() * 1.8 - 0.2 }));
    assert.equal(verticalDeviation(pts), verticalDeviation([...pts].reverse()));
    assert.equal(describeGeom(pts).verticalDeviationDeg, describeGeom([...pts].reverse()).verticalDeviationDeg);
  }
  const d = describeGeom(atDeg(12.3456789)); assert.equal(d.verticalDeviationDeg, 12.3457);
});

// =====================================================================================
// R1-RV-03 — one inclusive, eps-consistent comparison for every geometric limit
// =====================================================================================

test('R1-RV-03: nominal 0.01 endpoint gaps are ambiguous regardless of representation; just above resolves', () => {
  for (const [a, b] of [[0.3, 0.31], [0.4, 0.41], [0.1, 0.11], [0.2, 0.21], [0.5, 0.51], [0.7, 0.71], [0.0, 0.01], [-0.1, -0.09]]) {
    const pts = [{ x: a, y: 0.3 }, { x: (a + b) / 2, y: 0.4 }, { x: b, y: 0.5 }];
    assert.equal(axisRoles(pts, 'x').status, 'ambiguous', `${a}→${b}`);
    assert.equal(axisRoles([...pts].reverse(), 'x').status, 'ambiguous');
    assert.equal(polylineProblem(pts), polylineProblem([...pts].reverse()), 'reversal does not change validity');
  }
  for (const d of [0.0100001, 0.011, 0.02]) assert.equal(axisRoles([{ x: 0.4, y: 0.3 }, { x: 0.4 + d, y: 0.5 }], 'x').status, 'resolved', String(d));
  for (const d of [0.0099999, 0.005, 0]) assert.equal(axisRoles([{ x: 0.4, y: 0.3 }, { x: 0.4 + d, y: 0.5 }], 'x').status, 'ambiguous', String(d));
  for (const [a, b] of [[0.3, 0.31], [0.4, 0.41]]) assert.equal(axisRoles([{ x: 0.2, y: a }, { x: 0.6, y: b }], 'y').status, 'ambiguous', 'same rule on the y axis');
});

test('R1-RV-03: an ambiguous 0.01 endpoint never reaches interpretation (dependent rules decline identically both ways)', () => {
  const pts = [{ x: 0.4, y: 0.3 }, { x: 0.42, y: 0.4 }, { x: 0.41, y: 0.5 }];
  const a = generateReading((() => { const f = F.base(); at(f, 'c-ptc').geometry.points = pts; return f; })());
  const b = generateReading((() => { const f = F.base(); at(f, 'c-ptc').geometry.points = [...pts].reverse(); return f; })());
  assert.equal(dec(a, 'F-PTC-SLOPE').reason, 'geometry-ambiguous'); assert.equal(JSON.stringify(a.sections), JSON.stringify(b.sections));
});

test('R1-RV-03: the same comparison rule applies to every geometry limit (length, turn, tortuosity)', () => {
  assert.equal(polylineProblem([{ x: 0.1, y: 0.3 }, { x: 0.12, y: 0.3 }]), null, 'length exactly 0.02 is valid');
  assert.equal(polylineProblem([{ x: 0.1, y: 0.3 }, { x: 0.1199999, y: 0.3 }]), 'degenerate');
  const turn = (deg) => { const t = (deg * Math.PI) / 180; return [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.4 + 0.2 * Math.cos(t), y: 0.5 + 0.2 * Math.sin(t) }]; };
  assert.equal(polylineProblem(turn(120)), null, 'turn exactly 120° is allowed'); assert.equal(polylineProblem(turn(120.001)), 'doubles-back');
  assert.equal(GEOMETRY_CONTRACT.eps, 1e-9);
});

// =====================================================================================
// R1-RV-04 — point-order policy: disposition B (gentle zig-zags supported and documented)
// =====================================================================================

const smooth = Array.from({ length: 9 }, (_, i) => { const t = (i / 8) * Math.PI * 0.6; return { x: 0.1 + 0.5 * Math.sin(t), y: 0.3 + 0.5 * (1 - Math.cos(t)) }; });
const mildZig = Array.from({ length: 9 }, (_, i) => ({ x: 0.1 + i * 0.05625, y: 0.35 + (i % 2 ? 0.035 : 0) }));
const strongZig = Array.from({ length: 7 }, (_, i) => ({ x: 0.1 + i * 0.05, y: 0.35 + (i % 2 ? 0.2 : 0) }));
const staircase = [{ x: 0.1, y: 0.3 }, { x: 0.2, y: 0.3 }, { x: 0.2, y: 0.35 }, { x: 0.3, y: 0.35 }, { x: 0.3, y: 0.4 }, { x: 0.4, y: 0.4 }];

test('R1-RV-04: smooth curves, reversed curves, mild zig-zags and staircases (parallel segments) are accepted as ordered polylines', () => {
  for (const [name, pts] of [['smooth', smooth], ['mild zig-zag', mildZig], ['staircase', staircase]]) {
    assert.equal(polylineProblem(pts), null, name); assert.equal(polylineProblem([...pts].reverse()), null, `${name} reversed`);
    const a = generateReading((() => { const f = F.base(); at(f, 'c-ptc').geometry.points = pts; return f; })());
    const b = generateReading((() => { const f = F.base(); at(f, 'c-ptc').geometry.points = [...pts].reverse(); return f; })());
    assert.equal(a.status, 'interpreted'); assert.equal(JSON.stringify(a.sections), JSON.stringify(b.sections), `${name}: reversal-invariant`);
  }
});

test('R1-RV-04: strong zig-zags, doubling back, self-intersection, loops, shuffles and degenerate endpoints stay rejected', () => {
  const PTC = F.base().creases.items[1].geometry.points;
  const rejected = [
    ['strong zig-zag', strongZig], ['doubling back', [{ x: 0.1, y: 0.3 }, { x: 0.6, y: 0.35 }, { x: 0.15, y: 0.38 }]],
    ['self-intersection', [{ x: 0.1, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.3, y: 0.5 }, { x: 0.3, y: 0.2 }]],
    ['loop', [...PTC, PTC[0]]], ['shuffled', [PTC[0], PTC[3], PTC[1], PTC[4], PTC[2]]],
    ['U-turn parallel legs', [{ x: 0.1, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.32 }, { x: 0.1, y: 0.32 }]],
    ['degenerate endpoints', [{ x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 }]],
  ];
  for (const [name, pts] of rejected) { assert.notEqual(polylineProblem(pts), null, name); invalidWith(() => { const f = F.base(); at(f, 'c-ptc').geometry.points = pts; return f; }, 'invalid-geometry'); }
});

test('R1-RV-04: an accepted zig-zag can lengthen the measured path by at most the tortuosity bound (2.0 × chord)', () => {
  const d = describeGeom(mildZig); const chord = Math.hypot(mildZig[8].x - mildZig[0].x, mildZig[8].y - mildZig[0].y);
  assert.ok(d.lengthNorm / chord > 1 && d.lengthNorm / chord <= GEOMETRY_CONTRACT.maxTortuosity);
});

// =====================================================================================
// R1-RV-05 — rotation evidence gates the central-longitudinal (fate-line) rule
// =====================================================================================

const withRotation = (deg, issue, mk = F.strong) => () => { const f = mk(); f.capture.orientation.rotationDeg = deg; if (issue) f.capture.quality.issues = ['hand-rotated']; return f; };

test('R1-RV-05: confirmed rotation permits evaluation; the fate-line rule stays tentative', () => {
  for (const deg of [4, -30, 45, -45]) {
    const r = generateReading(withRotation(deg, false)());
    assert.equal(fam(r, 'F-CENTRAL-LONGITUDINAL').tier, 'tentative', String(deg));
    assert.equal(r.frame.axisReliable, true);
    assert.ok(fam(r, 'F-CENTRAL-LONGITUDINAL').evidence.capsApplied.includes('hypothesis-capped'));
  }
});

test('R1-RV-05: conflicting or out-of-range rotation declines the axis- and direction-dependent rules', () => {
  const cases = [[4, true, 'rotation-conflict'], [45.0001, false, 'rotation-conflict'], [180, false, 'rotation-conflict'], [-90, false, 'rotation-conflict'], [60, true, 'rotation-out-of-range']];
  for (const [deg, issue, reason] of cases) {
    const r = generateReading(withRotation(deg, issue)());
    const d = dec(r, 'F-CENTRAL-LONGITUDINAL');
    assert.equal(d.reason, 'frame-unreliable', `${deg}/${issue}`); assert.ok(d.frameReasons.includes(reason), `${deg}/${issue}: ${d.frameReasons}`);
    for (const id of DIRECTION) assert.equal(fam(r, id), undefined, `${id} at ${deg}/${issue}`);
    for (const it of items(r)) assert.equal(it.evidence.frame.requires.axis || it.evidence.frame.requires.direction, false);
  }
});

test('R1-RV-05: unknown or invalid rotation is rejected, never defaulted', () => {
  for (const v of [null, undefined, NaN, Infinity, 400, -181, '4']) invalidWith(() => { const f = F.strong(); f.capture.orientation.rotationDeg = v; return f; });
});

test('R1-RV-05: reversed central crease, unconfirmed palm side and the research-detector cap', () => {
  const rev = F.strong(); at(rev, 'c-vert').geometry.points.reverse();
  assert.equal(JSON.stringify(generateReading(rev).sections), JSON.stringify(generateReading(F.strong()).sections));
  const facing = generateReading((() => { const f = F.strong(); f.capture.orientation.palmFacing = null; return f; })());
  const it = fam(facing, 'F-CENTRAL-LONGITUDINAL'); assert.equal(it.tier, 'tentative'); assert.ok(it.evidence.capsApplied.includes('orientation-unconfirmed'));
  assert.equal(dec(generateReading((() => { const f = F.strong(); f.capture.orientation.palmFacing = null; f.capture.orientation.rotationDeg = 90; return f; })()), 'F-CENTRAL-LONGITUDINAL').reason, 'frame-unreliable');
  const d3 = (() => { const f = F.d3bUserConfirmed(); const c = F.crease('c-vert', 'MINOR', [{ x: 0.52, y: 1.0 }, { x: 0.51, y: 0.75 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.36 }], 0.9); c.detection = { confidence: 0.9, confidenceBasis: 'uncalibrated-detector-score' }; c.identity = { anatomicalClass: 'MINOR', classConfidence: 0.95, classSource: 'user-confirmed' }; f.creases.items.push(c); return f; });
  const ok = fam(generateReading(d3()), 'F-CENTRAL-LONGITUDINAL'); assert.equal(ok.tier, 'tentative'); assert.ok(ok.evidence.capsApplied.includes('basis-capped'));
  const conflict = d3(); conflict.capture.quality.issues = ['hand-rotated'];
  assert.equal(dec(generateReading(conflict), 'F-CENTRAL-LONGITUDINAL').reason, 'frame-unreliable');
});

// =====================================================================================
// R1-RV-07 — the hypothesis tier cap is traced (sixth MINOR)
// =====================================================================================

test('R1-RV-07: every hypothesis family lowered from clear records hypothesis-capped; other families never do', () => {
  const b = fam(generateReading(F.contradictory()), 'F-TC-BREAKS');
  assert.equal(b.tier, 'tentative'); assert.equal(b.evidence.evidenceScore, 0.9); assert.ok(b.evidence.capsApplied.includes('hypothesis-capped'));
  for (const mk of Object.values(F.SAMPLE_FIXTURES)) for (const it of items(generateReading(mk()))) {
    const hyp = FAMILIES.find((f) => f.id === it.familyId).hypothesis;
    if (hyp && it.evidence.evidenceBeforeFrameCaps >= THRESHOLDS.clear) assert.ok(it.evidence.capsApplied.includes('hypothesis-capped'), it.familyId);
    if (!hyp) assert.ok(!it.evidence.capsApplied.includes('hypothesis-capped'), it.familyId);
    // trace consistency: a tentative item with clear-level evidence always says why
    if (it.tier === 'tentative' && it.evidence.evidenceScore >= THRESHOLDS.clear) assert.ok(it.evidence.capsApplied.length || it.evidence.ambiguousBoundary || it.evidence.contradiction, it.familyId);
  }
});

// =====================================================================================
// Preservation and INFO items
// =====================================================================================

test('PRESERVED: confidence thresholds and the 0.49996 raw-score regression hold through the snapshot', () => {
  assert.equal(THRESHOLDS.clear, 0.75); assert.equal(THRESHOLDS.tentative, 0.5);
  const tiers = (conf) => items(generateReading(json(F.base({ conf, scan: 0.95 })))).map((i) => i.tier);
  assert.ok(tiers(0.75).every((t) => t === 'clear')); assert.ok(tiers(0.74996).every((t) => t === 'tentative'));
  assert.ok(tiers(0.5).length > 0 && tiers(0.5).every((t) => t === 'tentative')); assert.equal(tiers(0.49996).length, 0);
});

test('R1-RV-08 (INFO): every string-valued key in every sample reading is classified as prose (linted) or identifier/metadata', () => {
  const PROSE = new Set(['observation', 'interpretation', 'reflection', 'uncertainty', 'text', 'note', 'title', 'detail', 'absentNote', 'msg']);
  const NON_PROSE = new Set(['readingId', 'inputSha256', 'status', 'engine', 'ruleset', 'policy', 'featureSchema', 'validator', 'id', 'reason', 'crease', 'traditionalName', 'creaseIds',
    'unclassifiedCreaseIds', 'domain', 'familyId', 'quiet', 'tier', 'ruleId', 'qualityIssues', 'directionReasons', 'scaleReasons', 'axisReasons', 'frameReasons', 'value', 'source',
    'frameQualityIssues', 'radialUlnar', 'distalProximal', 'breakObservation', 'ambiguousEndpointRoles', 'path', 'code', 'field', 'kind',
    // metadata subtrees that are skipped by the lint by design (static author text, not user-facing):
    'meaning', 'evidence', 'provenance', 'excludedClaims', 'disclaimer']);
  const unclassified = new Set();
  const walk = (v, k) => {
    if (typeof v === 'string') { if (!PROSE.has(k) && !NON_PROSE.has(k)) unclassified.add(k); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, k));
    else if (v && typeof v === 'object') for (const kk of Object.keys(v)) { if (['evidence', 'provenance', 'excludedClaims', 'disclaimer'].includes(kk)) continue; walk(v[kk], kk); }
  };
  for (const mk of Object.values(F.SAMPLE_FIXTURES)) walk(generateReading(mk()), '$');
  assert.deepEqual([...unclassified], []);
});
