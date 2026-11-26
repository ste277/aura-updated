// AURA-PALM-03-E1 -- essential feature descriptors (capabilities E1-E4, E1-E5).
// Input geometry is the PALM-03-I1 palm frame: origin at the index knuckle (landmark 5), x toward the little-finger
// knuckle (landmark 17), y toward the wrist, unit = palm width. Traces are I1 `palmPoints` (user-confirmed, validated
// and serialized by I1 to 4 decimals). Finger bases are the palm-frame positions of landmarks 5/9/13/17, produced by
// the I1 helper from the SAME landmarks as the feature set and sealed with it (observations.mjs checks the seal).
//
// R2 (finding F5): all comparisons are exact integer comparisons on the 0.0001 serialized grid (grid.mjs). Ties,
// gaps, edges and margins are closed: a distance EQUAL to a tolerance or margin counts as inside it.
//   endpoint tie:    |Δ| <= 0.01            -> roles ambiguous (same rule as the frozen G6 contract, Δ <= 0.01)
//   finger-base gap: Δx >= 0.05             -> valid
//   zone edge:       distance <= margin     -> nearEdge (RC-7)
// Endpoint roles follow the frozen G6 contract (ported, not imported): radial/ulnar from x, distal/proximal from y.
//
// Every numeric value here is a PLACEHOLDER (C1 checklist C-8 / C-12): no source defines a threshold or zone edge.

import { E1_ENGINE } from './identity.mjs';
import { toGrid, fromGrid } from './grid.mjs';

export const DESCRIPTOR_CONTRACT = Object.freeze({
  version: E1_ENGINE.descriptorVersion,
  endpointTieTolerance: 0.01,
  fingerBaseTolerance: 0.001, // index base must be (0,0) and little base (1,0) in the I1 frame, within this
  minFingerBaseGap: 0.05,
  /** Provisional (V-A): at each zone edge the margin is the record's boundaryMargin, capped at this fraction of the narrower adjacent zone. */
  marginCapFraction: 0.25,
});
const TIE = 100, BASE_TOL = 10, MIN_GAP = 500; // grid units

const gridPoint = (p) => {
  if (p === null || typeof p !== 'object') return null;
  const x = toGrid(p.x), y = toGrid(p.y);
  return x === null || y === null ? null : { x, y };
};
function gridPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const out = [];
  for (let i = 0; i < points.length; i++) { if (!Object.prototype.hasOwnProperty.call(points, i)) return null; const g = gridPoint(points[i]); if (!g) return null; out.push(g); }
  return out;
}

/** Validate palm-frame finger bases (palm widths, on the grid). Returns { ok: true, bases, grid } or { ok: false, detail }. */
export function checkFingerBases(fb) {
  if (fb === null || fb === undefined) return { ok: false, detail: 'finger-bases-unavailable' };
  if (typeof fb !== 'object') return { ok: false, detail: 'finger-bases-invalid' };
  const g = Object.create(null); // R6: keyed by finger name; never inherits
  for (const k of ['index', 'middle', 'ring', 'little']) {
    if (!Object.prototype.hasOwnProperty.call(fb, k)) return { ok: false, detail: 'finger-bases-invalid' };
    g[k] = gridPoint(fb[k]);
    if (!g[k]) return { ok: false, detail: 'finger-bases-invalid' };
  }
  if (Math.abs(g.index.x) > BASE_TOL || Math.abs(g.index.y) > BASE_TOL || Math.abs(g.little.x - 10000) > BASE_TOL || Math.abs(g.little.y) > BASE_TOL) return { ok: false, detail: 'finger-bases-not-in-palm-frame' };
  const xs = [g.index.x, g.middle.x, g.ring.x, g.little.x];
  for (let i = 1; i < 4; i++) if (!(xs[i] - xs[i - 1] >= MIN_GAP)) return { ok: false, detail: 'finger-bases-out-of-order' };
  return { ok: true, bases: fb, grid: g };
}

function gridBases(bases) {
  const c = checkFingerBases(bases);
  if (!c.ok) throw new RangeError(`finger bases invalid: ${c.detail}`);
  return c.grid;
}

/** Endpoints along an axis (grid points): { status: 'resolved', low, high } or { status: 'ambiguous' }. */
function axisEnds(pts, axis) {
  const a = pts[0], b = pts[pts.length - 1];
  if (Math.abs(a[axis] - b[axis]) <= TIE) return { status: 'ambiguous' };
  return a[axis] < b[axis] ? { status: 'resolved', low: a, high: b } : { status: 'resolved', low: b, high: a };
}

/** Head-line slope: y(ulnar end) - y(radial end), palm widths (+ve = slopes toward the wrist). Same definition as G6. */
export function headSlope(points) {
  const pts = gridPoints(points);
  if (!pts) return { ok: false, detail: 'trace-off-grid' };
  const ru = axisEnds(pts, 'x');
  if (ru.status !== 'resolved') return { ok: false, detail: 'endpoint-roles-ambiguous' };
  return { ok: true, value: fromGrid(ru.high.y - ru.low.y) };
}

/**
 * Zone of grid-x among ordered grid anchors [{ zone, x }]. Edges are midpoints between adjacent anchors. Computed in
 * doubled grid units so midpoints are integers; the margin cap is compared multiplied by 4 so it stays integral.
 * Returns { zone, nearEdge, adjacentZone, edgeDistance, margin } (distances in palm widths).
 */
export function zoneOfGrid(xg, anchors, marginGrid) {
  const X = 2 * xg;
  const E = [];
  for (let i = 1; i < anchors.length; i++) E.push(anchors[i - 1].x + anchors[i].x); // doubled midpoints
  let k = 0;
  while (k < E.length && X >= E[k]) k++;
  const width2 = (j) => (j === 0 || j === anchors.length - 1 ? Infinity : E[j] - E[j - 1]); // doubled zone widths
  let best = null;
  for (const j of [k - 1, k]) {
    if (j < 0 || j >= E.length) continue;
    const d2 = Math.abs(X - E[j]);
    const m4 = Math.min(4 * 2 * marginGrid, Math.min(width2(j), width2(j + 1))); // 4 x (doubled capped margin)
    if (best === null || d2 < best.d2) best = { d2, m4, across: j === k - 1 ? k - 1 : k + 1 };
  }
  const nearEdge = best !== null && 4 * best.d2 <= best.m4;
  return Object.freeze({
    zone: anchors[k].zone,
    nearEdge,
    adjacentZone: nearEdge ? anchors[best.across].zone : null,
    edgeDistance: best === null ? null : best.d2 / 2 / 10000,
    margin: best === null ? null : best.m4 / 8 / 10000,
  });
}

/** Public helper in palm widths (values must lie on the grid). */
export function zoneOf(x, anchors, margin) {
  const xg = toGrid(x), mg = toGrid(margin);
  const ag = anchors.map((a) => ({ zone: a.zone, x: toGrid(a.x) }));
  if (xg === null || mg === null || ag.some((a) => a.x === null)) throw new RangeError('zoneOf: values must lie on the 0.0001 grid');
  return zoneOfGrid(xg, ag, mg);
}

/** Upward line: distal end (smaller y) mapped to the nearest finger-base zone (index | middle | ring | little). */
export function upwardEndingZone(points, bases, margin) {
  const pts = gridPoints(points);
  if (!pts) return { ok: false, detail: 'trace-off-grid' };
  const dp = axisEnds(pts, 'y');
  if (dp.status !== 'resolved') return { ok: false, detail: 'endpoint-roles-ambiguous' };
  bases = gridBases(bases);
  const anchors = [
    { zone: 'index', x: bases.index.x }, { zone: 'middle', x: bases.middle.x },
    { zone: 'ring', x: bases.ring.x }, { zone: 'little', x: bases.little.x },
  ];
  return { ok: true, end: { x: fromGrid(dp.low.x), y: fromGrid(dp.low.y) }, ...zoneOfGrid(dp.low.x, anchors, toGrid(margin)) };
}

/**
 * Heart line: radial end (smaller x) mapped to index | between-index-middle | middle | other. Anchors: the index base,
 * the midpoint of the index and middle bases, the middle base, and the ring base. Anchors are in doubled grid units
 * internally (the index-middle midpoint can be a half step), so this calls zoneOfGrid with everything doubled.
 */
export function heartEndingZone(points, bases, margin) {
  const pts = gridPoints(points);
  if (!pts) return { ok: false, detail: 'trace-off-grid' };
  const ru = axisEnds(pts, 'x');
  if (ru.status !== 'resolved') return { ok: false, detail: 'endpoint-roles-ambiguous' };
  bases = gridBases(bases);
  const anchors2 = [
    { zone: 'index', x: 2 * bases.index.x }, { zone: 'between-index-middle', x: bases.index.x + bases.middle.x },
    { zone: 'middle', x: 2 * bases.middle.x }, { zone: 'other', x: 2 * bases.ring.x },
  ];
  const z = zoneOfGrid(2 * ru.low.x, anchors2, 2 * toGrid(margin));
  return { ok: true, end: { x: fromGrid(ru.low.x), y: fromGrid(ru.low.y) }, ...z, edgeDistance: z.edgeDistance / 2, margin: z.margin / 2 };
}
