// AURA-PALM-03-E1 -- essential feature descriptors (capabilities E1-E4, E1-E5).
// Input geometry is the PALM-03-I1 palm frame: origin at the index knuckle (landmark 5), x toward the little-finger
// knuckle (landmark 17), y toward the wrist, unit = palm width. Traces are I1 `palmPoints` (user-confirmed, already
// validated and rounded by I1). Finger bases are the palm-frame positions of landmarks 5/9/13/17 (I1 helper
// apps/web/lib/palm-analysis/fingerBases.ts); they are data, never inferred here.
//
// Endpoint roles follow the frozen G6 geometry contract (ported, not imported): radial/ulnar from the endpoints' x,
// distal/proximal from their y; endpoints within 0.01 palm widths on that axis are AMBIGUOUS and the descriptor is
// unavailable. Nothing guesses an anatomical direction.
//
// Every numeric value here is a PLACEHOLDER (C1 checklist C-8): no source defines a threshold or zone edge.

import { E1_ENGINE } from './identity.mjs';

export const DESCRIPTOR_CONTRACT = Object.freeze({
  version: E1_ENGINE.descriptorVersion,
  endpointTieTolerance: 0.01,
  fingerBaseTolerance: 0.001, // index base must be (0,0) and little base (1,0) in the I1 frame, within this
  minFingerBaseGap: 0.05,
  /** At each zone edge the margin is the record's boundaryMargin, capped at this fraction of the narrower adjacent zone. */
  marginCapFraction: 0.25,
});

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPt = (p) => p !== null && typeof p === 'object' && isNum(p.x) && isNum(p.y);

/** Validate palm-frame finger bases. Returns { ok: true, bases } or { ok: false, detail }. */
export function checkFingerBases(fb) {
  if (fb === null || fb === undefined) return { ok: false, detail: 'finger-bases-unavailable' };
  if (typeof fb !== 'object' || !['index', 'middle', 'ring', 'little'].every((k) => Object.prototype.hasOwnProperty.call(fb, k) && isPt(fb[k]))) return { ok: false, detail: 'finger-bases-invalid' };
  const T = DESCRIPTOR_CONTRACT.fingerBaseTolerance;
  if (Math.abs(fb.index.x) > T || Math.abs(fb.index.y) > T || Math.abs(fb.little.x - 1) > T || Math.abs(fb.little.y) > T) return { ok: false, detail: 'finger-bases-not-in-palm-frame' };
  const xs = [fb.index.x, fb.middle.x, fb.ring.x, fb.little.x];
  for (let i = 1; i < 4; i++) if (!(xs[i] - xs[i - 1] >= DESCRIPTOR_CONTRACT.minFingerBaseGap)) return { ok: false, detail: 'finger-bases-out-of-order' };
  return { ok: true, bases: fb };
}

/** Endpoint along an axis: returns { status: 'resolved', low, high } (low = smaller coordinate) or { status: 'ambiguous' }. */
function axisEnds(points, axis) {
  const a = points[0], b = points[points.length - 1];
  if (Math.abs(a[axis] - b[axis]) <= DESCRIPTOR_CONTRACT.endpointTieTolerance) return { status: 'ambiguous' };
  return a[axis] < b[axis] ? { status: 'resolved', low: a, high: b } : { status: 'resolved', low: b, high: a };
}

/** Head-line slope: y(ulnar end) - y(radial end), palm widths (+ve = slopes toward the wrist). Same definition as G6. */
export function headSlope(points) {
  const ru = axisEnds(points, 'x');
  if (ru.status !== 'resolved') return { ok: false, detail: 'endpoint-roles-ambiguous' };
  return { ok: true, value: r4(ru.high.y - ru.low.y) };
}

/**
 * Zone of x among ordered anchors [{ zone, x }]. Edges are midpoints between adjacent anchors. Returns
 * { zone, nearEdge, adjacentZone, edgeDistance, margin }: nearEdge when x lies within the effective margin of the
 * nearest edge, in which case adjacentZone names the zone across it (RC-7: the composer shows neither).
 */
export function zoneOf(x, anchors, margin) {
  const edges = [];
  for (let i = 1; i < anchors.length; i++) edges.push((anchors[i - 1].x + anchors[i].x) / 2);
  let k = 0;
  while (k < edges.length && x >= edges[k]) k++;
  const width = (j) => (j === 0 || j === anchors.length - 1 ? Infinity : edges[j] - edges[j - 1]);
  let best = null;
  for (const j of [k - 1, k]) {
    if (j < 0 || j >= edges.length) continue;
    const d = Math.abs(x - edges[j]);
    const m = Math.min(margin, DESCRIPTOR_CONTRACT.marginCapFraction * Math.min(width(j), width(j + 1)));
    if (best === null || d < best.d) best = { d, m, across: j === k - 1 ? k - 1 : k + 1 };
  }
  const nearEdge = best !== null && best.d < best.m;
  return Object.freeze({
    zone: anchors[k].zone,
    nearEdge,
    adjacentZone: nearEdge ? anchors[best.across].zone : null,
    edgeDistance: best === null ? null : r4(best.d),
    margin: best === null ? null : r4(best.m),
  });
}

/** Upward line: distal end (smaller y) mapped to the nearest finger-base zone (index | middle | ring | little). */
export function upwardEndingZone(points, bases, margin) {
  const dp = axisEnds(points, 'y');
  if (dp.status !== 'resolved') return { ok: false, detail: 'endpoint-roles-ambiguous' };
  const anchors = [
    { zone: 'index', x: bases.index.x }, { zone: 'middle', x: bases.middle.x },
    { zone: 'ring', x: bases.ring.x }, { zone: 'little', x: bases.little.x },
  ];
  return { ok: true, end: dp.low, ...zoneOf(dp.low.x, anchors, margin) };
}

/**
 * Heart line: radial end (smaller x) mapped to index | between-index-middle | middle | other. Anchors: the index base,
 * the midpoint of the index and middle bases, the middle base, and the ring base (beyond which the zone is 'other').
 */
export function heartEndingZone(points, bases, margin) {
  const ru = axisEnds(points, 'x');
  if (ru.status !== 'resolved') return { ok: false, detail: 'endpoint-roles-ambiguous' };
  const anchors = [
    { zone: 'index', x: bases.index.x }, { zone: 'between-index-middle', x: (bases.index.x + bases.middle.x) / 2 },
    { zone: 'middle', x: bases.middle.x }, { zone: 'other', x: bases.ring.x },
  ];
  return { ok: true, end: ru.low, ...zoneOf(ru.low.x, anchors, margin) };
}
