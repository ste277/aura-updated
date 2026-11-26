// AURA-PALM-03-E1 -- essential descriptors: head slope, line-ending zones, boundary margins, finger-base checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { headSlope, upwardEndingZone, heartEndingZone, zoneOf, checkFingerBases, DESCRIPTOR_CONTRACT } from '../src/index.mjs';

const B = { index: { x: 0, y: 0 }, middle: { x: 0.34, y: -0.02 }, ring: { x: 0.68, y: -0.01 }, little: { x: 1, y: 0 } };
const r4 = (v) => Math.round(v * 1e4) / 1e4; // fixtures on the I1 serialized grid
const up = (x) => [{ x: r4(x), y: 0.12 }, { x: r4(x + 0.01), y: 0.5 }, { x: r4(x + 0.02), y: 0.9 }];
const heart = (x) => [{ x: 1.0, y: 0.25 }, { x: 0.6, y: 0.2 }, { x, y: 0.15 }];

test('D1 head slope = y(ulnar end) - y(radial end), independent of trace direction; ambiguous endpoints refuse', () => {
  const pts = [{ x: 0.05, y: 0.3 }, { x: 0.5, y: 0.38 }, { x: 0.9, y: 0.46 }];
  assert.deepEqual(headSlope(pts), { ok: true, value: 0.16 });
  assert.deepEqual(headSlope([...pts].reverse()), { ok: true, value: 0.16 });
  assert.deepEqual(headSlope([{ x: 0.5, y: 0.2 }, { x: 0.2, y: 0.4 }, { x: 0.505, y: 0.6 }]), { ok: false, detail: 'endpoint-roles-ambiguous' });
});

test('D2 upward ending: distal end mapped to the nearest finger base; trace direction does not matter', () => {
  const m = 0.08;
  assert.equal(upwardEndingZone(up(0.0), B, m).zone, 'index');
  assert.equal(upwardEndingZone(up(0.34), B, m).zone, 'middle');
  assert.equal(upwardEndingZone([...up(0.34)].reverse(), B, m).zone, 'middle');
  assert.equal(upwardEndingZone(up(0.68), B, m).zone, 'ring');
  assert.equal(upwardEndingZone(up(1.05), B, m).zone, 'little');
  assert.equal(upwardEndingZone(up(-0.15), B, m).zone, 'index');
  assert.deepEqual(upwardEndingZone([{ x: 0.3, y: 0.5 }, { x: 0.4, y: 0.2 }, { x: 0.35, y: 0.505 }], B, m), { ok: false, detail: 'endpoint-roles-ambiguous' });
});

test('D3 zone edges: within the margin -> nearEdge with the zone across the edge; just outside -> clean', () => {
  const m = 0.08; // edge index|middle at 0.17
  const near = upwardEndingZone(up(0.2), B, m);
  assert.equal(near.zone, 'middle'); assert.equal(near.nearEdge, true); assert.equal(near.adjacentZone, 'index');
  const nearL = upwardEndingZone(up(0.15), B, m);
  assert.equal(nearL.zone, 'index'); assert.equal(nearL.nearEdge, true); assert.equal(nearL.adjacentZone, 'middle');
  const clean = upwardEndingZone(up(0.26), B, m);
  assert.equal(clean.zone, 'middle'); assert.equal(clean.nearEdge, false); assert.equal(clean.adjacentZone, null);
  assert.equal(near.margin, 0.08);
});

test('D4 heart ending zones; the margin is capped at a quarter of the narrower adjacent zone so every zone stays reachable', () => {
  const m = 0.08; // anchors 0, 0.17, 0.34, 0.68 -> edges 0.085, 0.255, 0.51; between-zone width 0.17 -> cap 0.0425
  const z = (x) => heartEndingZone(heart(x), B, m);
  assert.equal(z(-0.1).zone, 'index'); assert.equal(z(-0.1).nearEdge, false);
  assert.equal(z(0.17).zone, 'between-index-middle'); assert.equal(z(0.17).nearEdge, false);
  assert.equal(z(0.3).zone, 'middle');
  assert.equal(z(0.9).zone, 'other');
  const e = z(0.1);
  assert.equal(e.zone, 'between-index-middle'); assert.equal(e.nearEdge, true); assert.equal(e.adjacentZone, 'index'); assert.equal(e.margin, 0.0425);
  assert.equal(z(0.13).nearEdge, false); // 0.045 from the edge: outside the capped margin
  assert.equal(heartEndingZone([...heart(0.17)].reverse(), B, m).zone, 'between-index-middle');
});

test('D5 zoneOf is total and monotone over x', () => {
  const anchors = [{ zone: 'a', x: 0 }, { zone: 'b', x: 1 }, { zone: 'c', x: 2 }];
  let last = -1;
  for (let k = -300; k <= 500; k++) {
    const r = zoneOf(k / 100, anchors, 0.1);
    const z = ['a', 'b', 'c'].indexOf(r.zone);
    assert.ok(z >= last); last = z;
    if (r.nearEdge) assert.ok(r.adjacentZone && r.adjacentZone !== r.zone);
  }
});

test('D6 finger bases must be the I1 palm frame (index (0,0), little (1,0), increasing x); anything else is refused', () => {
  assert.equal(checkFingerBases(B).ok, true);
  const bad = [null, undefined, {}, { ...B, ring: null }, { ...B, index: { x: 0.01, y: 0 } }, { ...B, little: { x: 1, y: 0.01 } },
    { ...B, middle: { x: 0.7, y: 0 } }, { ...B, middle: { x: 0.02, y: 0 } }, { ...B, ring: { x: Number.NaN, y: 0 } }];
  for (const b of bad) assert.equal(checkFingerBases(b).ok, false, JSON.stringify(b));
  assert.equal(DESCRIPTOR_CONTRACT.endpointTieTolerance, 0.01);
});
