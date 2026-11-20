// AURA-PALM-G6-D0 — Deterministic geometric descriptors derived from crease polylines.
// Frame: palm-normalized-v1 (x radial→ulnar, y finger-base→wrist, unit = palm width).
// Pure functions. Values rounded to 4 dp so output is stable across platforms.
//
// R1-F5 point-order contract (enforced; see R1_POINT_ORDER_CONTRACT.md):
//   * Input points are an ORDERED, open polyline that has already passed schema.polylineProblem().
//   * The only order normalisation is (a) collapsing consecutive exact duplicates and (b) whole reversal.
//   * Radial/ulnar endpoint roles come from the endpoints' x; distal/proximal roles from their y. If the two
//     endpoints are within ENDPOINT_TIE_TOLERANCE on that axis the roles are AMBIGUOUS: the dependent descriptors
//     are null and the engine declines any rule that needs them. No tie-break guesses an anatomical direction.
//   * Branch positions (atT) are measured from the crease's RADIAL end (0 = radial, 1 = ulnar), independent of the
//     supplied point order, so reversing the points never changes a measurement. They are interpretable only when the
//     crease's radial/ulnar roles are resolved (rules that read them declare endpoints: radialUlnar).

import { collapseDuplicates, GEOMETRY_CONTRACT, atMost } from './schema.mjs';

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const TIE = GEOMETRY_CONTRACT.endpointTieTolerance;

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

/**
 * Endpoint roles along one axis. Returns { status: 'resolved', reversed } when the endpoints differ by more than the
 * tie tolerance on that axis (reversed = the supplied order runs high→low), else { status: 'ambiguous' }.
 */
export function axisRoles(pts, axis) {
  const a = pts[0][axis], b = pts[pts.length - 1][axis];
  if (atMost(Math.abs(b - a), TIE)) return Object.freeze({ status: 'ambiguous', reversed: null }); // R1.1: inclusive, eps-consistent
  return Object.freeze({ status: 'resolved', reversed: a > b });
}

/** Whole-reversal canonicalisation along an axis; null when the endpoint roles on that axis are ambiguous. */
export function canonicalOrder(pts, axis) {
  const roles = axisRoles(pts, axis);
  if (roles.status !== 'resolved') return null;
  return roles.reversed ? [...pts].reverse() : [...pts];
}

const pt = (p) => Object.freeze({ x: r4(p.x), y: r4(p.y) });

/**
 * Descriptors:
 *  lengthNorm          – polyline length (palm widths)
 *  verticalDeviationDeg– angle of the chord from the finger-base→wrist axis, [0,90]°, from |Δx|,|Δy| (reversal-invariant; rounded for display)
 *  chordDeg            – chord orientation radial→ulnar, degrees, +ve = sloping toward the wrist   (null if radial/ulnar ambiguous)
 *  bend                – signed max deviation from chord / chord length (+ve bulges toward wrist)   (null if radial/ulnar ambiguous)
 *  endDropRadial       – y(ulnar end) − y(radial end)                                               (null if radial/ulnar ambiguous)
 *  radialEnd, ulnarEnd                                                                                (null if radial/ulnar ambiguous)
 *  distalEnd, proximalEnd                                                                             (null if distal/proximal ambiguous)
 *  centroid, xMax, yMin, yMax – order-independent
 *  endpointRoles       – { radialUlnar, distalProximal }: 'resolved' | 'ambiguous'
 *  duplicatePointsCollapsed – count of consecutive duplicates removed
 */
/**
 * R1.1 (R1-RV-01): angle between the end-to-end chord and the finger-base→wrist axis, in degrees [0, 90], UNROUNDED.
 * Built from |Δx| and |Δy|, which are bit-identical for a polyline and its reversal, so the value cannot depend on order.
 */
export function verticalDeviation(points) {
  const pts = collapseDuplicates(points);
  const first = pts[0], last = pts[pts.length - 1];
  return (Math.atan2(Math.abs(last.x - first.x), Math.abs(last.y - first.y)) * 180) / Math.PI;
}

export function describe(points) {
  const pts = collapseDuplicates(points);
  const ru = axisRoles(pts, 'x');
  const dp = axisRoles(pts, 'y');
  const verticalDeviationDeg = verticalDeviation(pts); // display value below is rounded; classification uses the raw value

  let chordDeg = null, bend = null, endDropRadial = null, radialEnd = null, ulnarEnd = null;
  if (ru.status === 'resolved') {
    const tx = ru.reversed ? [...pts].reverse() : pts;
    const a = tx[0], b = tx[tx.length - 1];
    const cx = b.x - a.x, cy = b.y - a.y;
    const chord = Math.hypot(cx, cy);
    let bd = 0;
    for (const p of tx) {
      const s = -(((p.x - a.x) * cy - (p.y - a.y) * cx) / chord); // > 0 on the wrist (+y) side of a radial→ulnar chord
      if (Math.abs(s) > Math.abs(bd)) bd = s;
    }
    chordDeg = r4((Math.atan2(cy, cx) * 180) / Math.PI);
    bend = r4(bd / chord);
    endDropRadial = r4(b.y - a.y);
    radialEnd = pt(a); ulnarEnd = pt(b);
  }
  let distalEnd = null, proximalEnd = null;
  if (dp.status === 'resolved') {
    const ty = dp.reversed ? [...pts].reverse() : pts;
    distalEnd = pt(ty[0]); proximalEnd = pt(ty[ty.length - 1]);
  }
  let sx = 0, sy = 0, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of pts) { sx += p.x; sy += p.y; xMax = Math.max(xMax, p.x); yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y); }
  return Object.freeze({
    lengthNorm: r4(polylineLength(pts)),
    verticalDeviationDeg: r4(verticalDeviationDeg),
    chordDeg, bend, endDropRadial,
    centroid: Object.freeze({ x: r4(sx / pts.length), y: r4(sy / pts.length) }),
    xMax: r4(xMax), yMin: r4(yMin), yMax: r4(yMax),
    radialEnd, ulnarEnd, distalEnd, proximalEnd,
    endpointRoles: Object.freeze({ radialUlnar: ru.status, distalProximal: dp.status }),
    duplicatePointsCollapsed: points.length - pts.length,
  });
}

export const dist = (p, q) => r4(Math.hypot(p.x - q.x, p.y - q.y));
