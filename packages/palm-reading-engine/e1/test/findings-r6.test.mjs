// AURA-PALM-03-E1-R6 -- the authoritative snapshot boundary (identity.mjs captureOwnData) and the planner's use of it.
// Reading-level witnesses (inherited intermediates, changing builder state, changing options) are end to end in
// test/palm03E1Engine.test.ts F14-F17.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as E from '../src/index.mjs';
import { captureOwnData, requireSyntheticOptions } from '../src/identity.mjs';
import { E1 } from './helpers.mjs';

const node = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', cwd: E1 });
const counting = (target) => { const reads = new Map(); const wrap = (v, at) => (v && typeof v === 'object' ? new Proxy(Array.isArray(v) ? v.map((x, i) => wrap(x, `${at}[${i}]`)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wrap(x, `${at}.${k}`)])), { getOwnPropertyDescriptor(t, k) { const key = `${at}/${String(k)}`; reads.set(key, (reads.get(key) ?? 0) + 1); return Reflect.getOwnPropertyDescriptor(t, k); } }) : v); return { proxy: wrap(target, '$'), reads }; };

test('R6 capture: each own property is read exactly once; the result is a deep, frozen, null-prototype copy', () => {
  const src = { a: 1, b: { c: [1, { d: 'x' }], e: null }, f: true };
  const { proxy, reads } = counting(src);
  const snap = captureOwnData(proxy);
  assert.ok([...reads.values()].every((n) => n === 1), JSON.stringify([...reads]));
  assert.equal(JSON.stringify(snap), JSON.stringify(src));
  assert.equal(Object.getPrototypeOf(snap), null); assert.equal(Object.getPrototypeOf(snap.b), null); assert.equal(Object.getPrototypeOf(snap.b.c[1]), null);
  assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.b.c) && Object.isFrozen(snap.b.c[1]));
  src.b.c[1].d = 'changed'; src.a = 2; // later changes to the source never reach the snapshot
  assert.equal(snap.b.c[1].d, 'x'); assert.equal(snap.a, 1);
});

test('R6 capture fails closed on anything that is not own plain data', () => {
  const cases = [
    Object.defineProperty({}, 'x', { get: () => 1, enumerable: true }), { x: Object.defineProperty({}, 'y', { set() {}, enumerable: true }) },
    { [Symbol('s')]: 1 }, { d: new Date(0) }, { m: new Map() }, { f: () => 1 }, { n: 10n }, Object.create({ inherited: 1 }),
    JSON.parse('{"__proto__": 1}'), new Proxy({}, { ownKeys() { throw new Error('boom'); } }),
    new Proxy({ a: 1 }, { ownKeys() { return ['a', 'ghost']; }, getOwnPropertyDescriptor(t, k) { return k === 'ghost' ? undefined : Reflect.getOwnPropertyDescriptor(t, k); } }),
  ];
  for (const [i, c] of cases.entries()) assert.throws(() => captureOwnData(c, { code: 'invalid-input' }), (e) => e.code === 'invalid-input', String(i));
  const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
  assert.throws(() => captureOwnData(sparse), (e) => e.code === 'invalid-input');
  assert.equal(captureOwnData(sparse, { holes: 'preserve' }).length, 3);
  assert.ok(!(1 in captureOwnData(sparse, { holes: 'preserve' })));
});

test('R6 options: captured once, validated from the capture, and the capture is what is returned', () => {
  let n = 0;
  const flip = new Proxy({ synthetic: false }, { getOwnPropertyDescriptor(t, k) { const d = Reflect.getOwnPropertyDescriptor(t, k); if (k !== 'synthetic' || !d) return d; n++; return { ...d, value: n === 1 }; } });
  const snap = requireSyntheticOptions(flip, ['synthetic']);
  assert.equal(n, 1); assert.equal(snap.synthetic, true); assert.ok(Object.isFrozen(snap));
  n = 0;
  const flipFalse = new Proxy({ synthetic: false }, { getOwnPropertyDescriptor(t, k) { const d = Reflect.getOwnPropertyDescriptor(t, k); if (k !== 'synthetic' || !d) return d; n++; return { ...d, value: n !== 1 }; } });
  assert.throws(() => requireSyntheticOptions(flipFalse, ['synthetic']), (e) => e.code === 'synthetic-required');
  assert.equal(n, 1);
});

test('R6 planner: observations are read once; an inherited feature-id key (fresh process) changes no plan', () => {
  const obs = { 'lines.heart': { provenance: 'user-confirmed', value: 'between', nearEdge: false, adjacentZone: null, descriptor: 'heart-ending-zone' }, 'lines.life': { notAssessed: 'user-skipped', detail: 'user-skipped' } };
  const { proxy, reads } = counting(obs);
  const viaProxy = E.planSelection(E.defaultLibrary(), proxy, { synthetic: true });
  assert.ok([...reads.values()].every((v) => v === 1), JSON.stringify([...reads]));
  assert.equal(JSON.stringify(viaProxy), JSON.stringify(E.planSelection(E.defaultLibrary(), obs, { synthetic: true })));
  const run = (key) => node(`
    ${key ? `Object.defineProperty(Object.prototype, ${JSON.stringify(key)}, { value: 'matched', configurable: true, writable: true });` : ''}
    const E = await import('./src/index.mjs');
    const plans = ['combined', 'indian-only', 'western-only'].map((mode) => E.planSelection(E.defaultLibrary(), ${JSON.stringify(obs)}, { synthetic: true, mode }));
    console.log(JSON.stringify(plans));`);
  const clean = run(null);
  assert.equal(clean.status, 0, clean.stderr);
  for (const key of ['lines.heart', 'lines.head', 'measurements.middleToPalmRatio', 'personality', 'strengths', 'C1-WE-HEART-BETWEEN', 'E1-E2', 'boundary']) {
    const r = run(key);
    assert.equal(r.status, 0, `${key}: ${r.stderr}`);
    assert.equal(r.stdout, clean.stdout, key);
  }
});
