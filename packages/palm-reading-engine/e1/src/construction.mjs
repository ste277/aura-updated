// AURA-PALM-03-E1-R3 -- coherent construction from ONE synthetic input (finding F6).
//
// The reading interface (reading.ts) builds the PALM-03-I1 feature set from the caller's single synthetic input. This
// module re-derives, from that SAME input, everything E1 reads that depends on geometry, and refuses any feature set
// that does not match it:
//   * the palm frame (port of I1 palmFrameFromLandmarks / palmGeometry), hence the finger bases (landmarks 5/9/13/17);
//   * every recorded trace (port of I1 imageToPalm + round4), line by line, and each line's skipped/unconfirmed state;
//   * the two measurements E1 interprets (middleToPalmRatio, indexToRingRatio; port of I1 measureHand chains + round3);
//   * the declared hand and the quality feedback;
//   * R4: palm facing (port of I1 orientation) and the two ratios' availability, status and reasons (port of the
//     I1 measureHand status rules), so facing and measurement availability also come from the same input.
// The ports are arithmetic copies of the frozen I1 code (same operations in the same order), NOT a modification of
// it; tests compare them with the I1 functions across many synthetic hands. Finger bases are never caller-supplied.
//
// Guarantee: a reading is internally consistent with one supplied synthetic input. It does NOT prove that the input
// came from a physical hand or a real image -- that belongs to the later scanner / real-image validation milestone.

import { E1Error } from './identity.mjs';

const LM = Object.freeze({ WRIST: 0, INDEX_MCP: 5, MIDDLE_MCP: 9, RING_MCP: 13, PINKY_MCP: 17 });
const CHAINS = Object.freeze({ index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16] });
const MAX_IMAGE_SIDE_PX = 100000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const round4 = (v) => Math.round(v * 10000) / 10000 + 0;
const round3 = (v) => Math.round(v * 1000) / 1000;

function readPoint(p) {
  if (p === null || typeof p !== 'object') return null;
  return isNum(p.x) && isNum(p.y) ? { x: p.x, y: p.y } : null;
}

/** Port of I1 palmGeometry (measurements.ts). */
function palmGeometry(wrist, indexMcp, pinkyMcp, middleMcp) {
  const widthPx = Math.hypot(pinkyMcp.x - indexMcp.x, pinkyMcp.y - indexMcp.y);
  const palmLengthPx = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);
  const cross = (pinkyMcp.x - indexMcp.x) * (wrist.y - indexMcp.y) - (pinkyMcp.y - indexMcp.y) * (wrist.x - indexMcp.x);
  const signedOffset = cross / (widthPx || 1);
  if (!(widthPx > 1e-6) || !(palmLengthPx > 1e-6) || !(Math.abs(signedOffset) > 1e-6 * widthPx)) return rec({ ok: false });
  if (!isNum(widthPx) || !isNum(palmLengthPx) || !isNum(signedOffset)) return rec({ ok: false });
  return rec({ ok: true, widthPx, palmLengthPx, signedOffset });
}

/** Port of I1 palmFrameFromLandmarks (features.ts). Returns { frame, px } or { frame: null }. */
export function frameFromInput(input) {
  const w = input?.imageWidth, h = input?.imageHeight, lm = input?.landmarks;
  if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0 || w > MAX_IMAGE_SIDE_PX || h > MAX_IMAGE_SIDE_PX) return rec({ frame: null });
  if (!Array.isArray(lm) || lm.length !== 21) return rec({ frame: null });
  const pts = [];
  for (let k = 0; k < 21; k++) {
    if (!own(lm, k)) return rec({ frame: null });
    const p = readPoint(lm[k]);
    const z = lm[k] === null || typeof lm[k] !== 'object' ? undefined : lm[k].z;
    if (!p || (z !== undefined && !isNum(z))) return rec({ frame: null });
    pts.push(p);
  }
  if (pts.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return rec({ frame: null });
  const px = pts.map((p) => ({ x: p.x * w, y: p.y * h }));
  const I = px[LM.INDEX_MCP], P = px[LM.PINKY_MCP];
  const geo = palmGeometry(px[LM.WRIST], I, P, px[LM.MIDDLE_MCP]);
  if (!geo.ok) return rec({ frame: null });
  const ex = { x: (P.x - I.x) / geo.widthPx, y: (P.y - I.y) / geo.widthPx };
  const ey = geo.signedOffset > 0 ? { x: -ex.y, y: ex.x } : { x: ex.y, y: -ex.x };
  return rec({ frame: rec({ origin: I, ex, ey, widthPx: geo.widthPx, palmLengthPx: geo.palmLengthPx, w, h }), px });
}

/** Port of I1 imageToPalm followed by round4 (the recorded precision). */
const toPalm4 = (f, p) => {
  const dx = p.x * f.w - f.origin.x, dy = p.y * f.h - f.origin.y;
  return { x: round4((dx * f.ex.x + dy * f.ex.y) / f.widthPx), y: round4((dx * f.ey.x + dy * f.ey.y) / f.widthPx) };
};

/** Finger bases (landmarks 5/9/13/17) in the palm frame, derived from the input itself. */
export function fingerBasesFromInput(input) {
  const { frame } = frameFromInput(input);
  if (!frame) return null;
  const at = (k) => toPalm4(frame, readPoint(input.landmarks[k]));
  return Object.freeze({ index: Object.freeze(at(LM.INDEX_MCP)), middle: Object.freeze(at(LM.MIDDLE_MCP)), ring: Object.freeze(at(LM.RING_MCP)), little: Object.freeze(at(LM.PINKY_MCP)) });
}

/** Port of the two I1 ratios E1 interprets (unrounded chains, then round3), or null when not computable. */
function ratiosFromInput(frameInfo) {
  const { frame, px } = frameInfo;
  if (!frame) return null;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const chain = (c) => { let s = 0; for (let k = 1; k < c.length; k++) s += dist(px[c[k - 1]], px[c[k]]); return s / frame.widthPx; };
  const palmLength = frame.palmLengthPx / frame.widthPx;
  const r = (v) => (isNum(v) && isNum(round3(v)) ? round3(v) : null);
  return { middleToPalmRatio: r(chain(CHAINS.middle) / palmLength), indexToRingRatio: r(chain(CHAINS.index) / chain(CHAINS.ring)) };
}

/** Port of I1 orientation().palmFacing (quality.ts), applied as the feature builder does (features.ts). */
function palmFacingFromInput(input, frameInfo) {
  const label = input.handednessLabel;
  if (!frameInfo.frame || (label !== 'Left' && label !== 'Right')) return null;
  const p = frameInfo.px, w = p[LM.WRIST], i = p[LM.INDEX_MCP], k = p[LM.PINKY_MCP];
  const cross = (i.x - w.x) * (k.y - w.y) - (i.y - w.y) * (k.x - w.x);
  return cross * (label === 'Right' ? -1 : 1) > 0;
}

// Port of the I1 measureHand() status rules (measurements.ts) for the two ratios E1 interprets: availability,
// uncertainty and reasons, in I1's order. Tests compare it with measureHand across synthetic hands.
const BLOCKING_ISSUES = Object.freeze(['palm-not-visible', 'hand-cut-off']);
const DEGRADING_ISSUES = Object.freeze(['hand-too-small', 'hand-rotated', 'too-dark', 'too-bright', 'low-contrast', 'blurry']);
const PLAUSIBLE_PALM_ASPECT = Object.freeze({ min: 0.7, max: 1.8 });
const MIN_TIP_TO_PIP_RATIO = 1.1;
function ratioStatusFromInput(input, frameInfo, values) {
  const unavailable = Object.freeze({ status: 'unavailable', value: null, reasons: ['depends-on-unavailable'] });
  const all = (m) => ({ middleToPalmRatio: m, indexToRingRatio: m });
  const q = input.qualityIssues;
  if (q !== null && q !== undefined && !Array.isArray(q)) return all(unavailable);
  const issues = Array.isArray(q) ? q : [];
  if (!frameInfo.frame || BLOCKING_ISSUES.some((c) => issues.includes(c))) return all(unavailable);
  const setReasons = DEGRADING_ISSUES.filter((c) => issues.includes(c));
  if (!Array.isArray(q)) setReasons.push('quality-unknown');
  const facing = palmFacingFromInput(input, frameInfo);
  if (facing === false) return all(unavailable);
  if (facing === null) setReasons.push('palm-facing-unknown');
  const { frame, px } = frameInfo;
  const palmLength = frame.palmLengthPx / frame.widthPx;
  if (palmLength < PLAUSIBLE_PALM_ASPECT.min || palmLength > PLAUSIBLE_PALM_ASPECT.max) setReasons.push('implausible-proportions');
  const fromWrist = (k) => Math.hypot(px[LM.WRIST].x - px[k].x, px[LM.WRIST].y - px[k].y);
  const extended = (tip, pip) => fromWrist(tip) > fromWrist(pip) * MIN_TIP_TO_PIP_RATIO;
  const base = setReasons.length ? 'uncertain' : 'measured';
  const finger = (ext) => (ext ? base : 'unavailable');
  const derive = (deps, value) => {
    if (deps.includes('unavailable')) return unavailable;
    if (value === null) return { status: 'unavailable', value: null, reasons: ['computation-nonfinite'] };
    return deps.includes('uncertain') ? { status: 'uncertain', value, reasons: [...setReasons] } : { status: 'measured', value, reasons: [] };
  };
  return {
    middleToPalmRatio: derive([finger(extended(12, 10)), base], values.middleToPalmRatio),
    indexToRingRatio: derive([finger(extended(8, 6)), finger(extended(16, 14))], values.indexToRingRatio),
  };
}

// R5 (finding F6): port of the I1 trace placement (features.ts placeTrace, traceGeometryProblem, TRACE_LIMITS), so
// every line state E1 reads -- placed points AND the specific unassessed reason -- is recomputed from the input.
// Same operations in the same order; tests compare TRACE_LIMITS and the verdicts with I1 across many traces.
export const TRACE_LIMITS = Object.freeze({ minPoints: 2, maxPoints: 64, minLength: 0.02, maxTurnDeg: 120, maxTortuosity: 2.0, eps: 1e-9, bounds: Object.freeze({ xMin: -0.2, xMax: 1.2, yMin: -0.2, yMax: 1.6 }) });
const inBounds = (p) => p.x >= TRACE_LIMITS.bounds.xMin && p.x <= TRACE_LIMITS.bounds.xMax && p.y >= TRACE_LIMITS.bounds.yMin && p.y <= TRACE_LIMITS.bounds.yMax;
const below = (v, l) => v < l - TRACE_LIMITS.eps;
const above = (v, l) => v > l + TRACE_LIMITS.eps;
function withoutConsecutiveDuplicates(points) { const out = []; for (const p of points) { const q = out[out.length - 1]; if (!q || q.x !== p.x || q.y !== p.y) out.push(p); } return out; }
function canonical(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[n - 1 - i];
    if (a.x !== b.x) return a.x < b.x ? points : [...points].reverse();
    if (a.y !== b.y) return a.y < b.y ? points : [...points].reverse();
  }
  return points;
}
const crossP = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const onSeg = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
function segmentsTouch(p1, p2, p3, p4) {
  const c1 = crossP(p3, p4, p1), c2 = crossP(p3, p4, p2), c3 = crossP(p1, p2, p3), c4 = crossP(p1, p2, p4);
  if (((c1 > 0 && c2 < 0) || (c1 < 0 && c2 > 0)) && ((c3 > 0 && c4 < 0) || (c3 < 0 && c4 > 0))) return true;
  return (c1 === 0 && onSeg(p3, p1, p4)) || (c2 === 0 && onSeg(p3, p2, p4)) || (c3 === 0 && onSeg(p1, p3, p2)) || (c4 === 0 && onSeg(p1, p4, p2));
}
function problemInOrder(pts) {
  if (pts.length < 2) return 'trace-too-few-distinct-points';
  const seen = new Set();
  for (const p of pts) { const k = `${p.x},${p.y}`; if (seen.has(k)) return 'trace-repeated-point'; seen.add(k); }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (below(len, TRACE_LIMITS.minLength)) return 'trace-too-short';
  for (let i = 1; i + 1 < pts.length; i++) {
    const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y, bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))));
    if (above((Math.acos(cos) * 180) / Math.PI, TRACE_LIMITS.maxTurnDeg)) return 'trace-doubles-back';
  }
  for (let i = 0; i + 1 < pts.length; i++) for (let j = i + 2; j + 1 < pts.length; j++) if (segmentsTouch(pts[i], pts[i + 1], pts[j], pts[j + 1])) return 'trace-self-intersecting';
  const chord = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
  if (above(len / chord, TRACE_LIMITS.maxTortuosity)) return 'trace-tortuous';
  return null;
}
function traceGeometryProblem(points) { const c = canonical(withoutConsecutiveDuplicates(points)); return problemInOrder(c) ?? problemInOrder([...c].reverse()); }
/** Port of I1 placeTrace: { ok, palmPoints } or { ok: false, reason }. */
export function placeTraceFromInput(points, frame) {
  if (!Array.isArray(points) || points.length < TRACE_LIMITS.minPoints) return rec({ ok: false, reason: 'trace-too-few-points' });
  if (points.length > TRACE_LIMITS.maxPoints) return rec({ ok: false, reason: 'trace-too-many-points' });
  const pts = [];
  for (let k = 0; k < points.length; k++) { if (!own(points, k)) return rec({ ok: false, reason: 'trace-point-invalid' }); const p = readPoint(points[k]); if (!p) return rec({ ok: false, reason: 'trace-point-invalid' }); pts.push(p); }
  if (!pts.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return rec({ ok: false, reason: 'trace-outside-image' });
  const rounded = pts.map((p) => toPalm4(frame, p));
  if (!rounded.every((p) => isNum(p.x) && isNum(p.y))) return rec({ ok: false, reason: 'trace-point-invalid' });
  if (!rounded.every(inBounds)) return rec({ ok: false, reason: 'trace-outside-palm-frame' });
  const problem = traceGeometryProblem(rounded);
  if (problem) return rec({ ok: false, reason: problem });
  return rec({ ok: true, palmPoints: rounded });
}

/** R6: tagged, null-prototype expected line state (only the fields of its kind exist). */
const expectedState = (kind, x) => Object.freeze(Object.assign(Object.create(null), kind === 'placed' ? { kind, palmPoints: x } : { kind, reason: x }));
/** R6: intermediate results are null-prototype records: an absent field reads as undefined, never as an inherited value. */
const rec = (o) => Object.freeze(Object.assign(Object.create(null), o));
const samePoints = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

/**
 * Verify that `featureSet` is the I1 representation of `input`. Throws E1Error('construction-mismatch') naming the
 * first inconsistency. Assumes featureSet already passed the I1 contract (feature-set-adapter.mjs).
 */
export function verifyConstruction(input, featureSet) {
  const fail = (what) => { throw new E1Error('construction-mismatch', `the feature set does not derive from the supplied input: ${what}`); };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('input is not an object');
  const fi = frameFromInput(input);
  if ((fi.frame !== null) !== (featureSet.frame.available === true)) fail('palm frame availability');
  if (featureSet.hand.value !== input.hand) fail('declared hand');
  const q = input.qualityIssues;
  const status = q === null || q === undefined ? 'unknown' : Array.isArray(q) && q.length === 0 ? 'accepted' : 'needs-retake';
  if (featureSet.frame.qualityStatus !== status) fail('quality status');
  if (Array.isArray(q) && JSON.stringify([...q]) !== JSON.stringify([...featureSet.frame.qualityIssues])) fail('quality issues');
  // R5: every line state is recomputed from the input and must match exactly (provenance, placed points, reason)
  const lines = Array.isArray(input.lines) ? input.lines : [];
  for (const id of ['heart', 'head', 'life', 'upward']) {
    const given = lines.filter((l) => l && l.line === id);
    const l = featureSet.lines[id];
    if (given.length > 1) fail(`line ${id} given twice`);
    const g = given[0];
    // R6: the expected state is an explicitly tagged record ({ kind: 'placed', palmPoints } | { kind: 'unassessed',
    // reason }); no optional field is ever probed, so nothing inherited can turn one kind into the other
    let want;
    if (!g) want = expectedState('unassessed', 'not-requested');
    else if (g.action === 'skipped') want = expectedState('unassessed', g.reason);
    else if (g.action !== 'traced') fail(`line ${id} action`);
    else if (g.confirmed !== true) want = expectedState('unassessed', 'not-confirmed');
    else if (!fi.frame) want = expectedState('unassessed', 'frame-unavailable');
    else { const placed = placeTraceFromInput(g.points, fi.frame); want = placed.ok === true ? expectedState('placed', placed.palmPoints) : expectedState('unassessed', placed.reason); }
    if (want.kind === 'placed') { if (l.provenance !== 'user-confirmed' || !samePoints(want.palmPoints, l.palmPoints)) fail(`line ${id} trace differs from the supplied trace`); }
    else if (l.provenance !== 'unassessed' || l.reason !== want.reason) fail(`line ${id} state (${l.provenance}/${own(l, 'reason') ? l.reason : '-'}) differs from the supplied input (${want.reason})`);
  }
  if (featureSet.frame.palmFacing !== palmFacingFromInput(input, fi)) fail('palm facing');
  const ratios = ratiosFromInput(fi) ?? { middleToPalmRatio: null, indexToRingRatio: null };
  const expected = ratioStatusFromInput(input, fi, ratios);
  for (const id of ['middleToPalmRatio', 'indexToRingRatio']) {
    const m = featureSet.measurements.measurements[id], e = expected[id];
    if (m.status !== e.status || m.value !== e.value || JSON.stringify([...m.reasons]) !== JSON.stringify(e.reasons)) fail(`measurement ${id} (status, value or reasons) differs from the supplied landmarks and quality`);
  }
  // R5: mark states recomputed exactly (port of the I1 mark rules: report, skip, location validity)
  const marks = Array.isArray(input.marks) ? input.marks : [];
  for (const id of ['yava', 'matsya', 'shankha', 'chatra', 'vedi']) {
    const given = marks.filter((m) => m && m.mark === id);
    if (given.length > 1) fail(`mark ${id} given twice`);
    const g = given[0], m = featureSet.marks[id];
    let want;
    if (!g) want = 'unassessed/not-requested';
    else if (g.action === 'skipped') want = 'unassessed/user-skipped';
    else if (g.approximateLocation === undefined) want = 'user-reported/';
    else { const loc = readPoint(g.approximateLocation); want = !loc || loc.x < 0 || loc.x > 1 || loc.y < 0 || loc.y > 1 ? 'unassessed/location-invalid' : 'user-reported/'; }
    if (`${m.provenance}/${m.provenance === 'unassessed' ? m.reason : ''}` !== want) fail(`mark ${id} state`);
  }
  return Object.freeze({ frameAvailable: fi.frame !== null, fingerBases: fingerBasesFromInput(input) });
}
