// AURA-PALM-03-E1-R3 -- coherent construction from ONE synthetic input (finding F6).
//
// The reading interface (reading.ts) builds the PALM-03-I1 feature set from the caller's single synthetic input. This
// module re-derives, from that SAME input, everything E1 reads that depends on geometry, and refuses any feature set
// that does not match it:
//   * the palm frame (port of I1 palmFrameFromLandmarks / palmGeometry), hence the finger bases (landmarks 5/9/13/17);
//   * every recorded trace (port of I1 imageToPalm + round4), line by line, and each line's skipped/unconfirmed state;
//   * the two measurements E1 interprets (middleToPalmRatio, indexToRingRatio; port of I1 measureHand chains + round3);
//   * the declared hand and the quality feedback.
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
  if (!(widthPx > 1e-6) || !(palmLengthPx > 1e-6) || !(Math.abs(signedOffset) > 1e-6 * widthPx)) return { ok: false };
  if (!isNum(widthPx) || !isNum(palmLengthPx) || !isNum(signedOffset)) return { ok: false };
  return { ok: true, widthPx, palmLengthPx, signedOffset };
}

/** Port of I1 palmFrameFromLandmarks (features.ts). Returns { frame, px } or { frame: null }. */
export function frameFromInput(input) {
  const w = input?.imageWidth, h = input?.imageHeight, lm = input?.landmarks;
  if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0 || w > MAX_IMAGE_SIDE_PX || h > MAX_IMAGE_SIDE_PX) return { frame: null };
  if (!Array.isArray(lm) || lm.length !== 21) return { frame: null };
  const pts = [];
  for (let k = 0; k < 21; k++) {
    if (!own(lm, k)) return { frame: null };
    const p = readPoint(lm[k]);
    const z = lm[k] === null || typeof lm[k] !== 'object' ? undefined : lm[k].z;
    if (!p || (z !== undefined && !isNum(z))) return { frame: null };
    pts.push(p);
  }
  if (pts.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return { frame: null };
  const px = pts.map((p) => ({ x: p.x * w, y: p.y * h }));
  const I = px[LM.INDEX_MCP], P = px[LM.PINKY_MCP];
  const geo = palmGeometry(px[LM.WRIST], I, P, px[LM.MIDDLE_MCP]);
  if (!geo.ok) return { frame: null };
  const ex = { x: (P.x - I.x) / geo.widthPx, y: (P.y - I.y) / geo.widthPx };
  const ey = geo.signedOffset > 0 ? { x: -ex.y, y: ex.x } : { x: ex.y, y: -ex.x };
  return { frame: { origin: I, ex, ey, widthPx: geo.widthPx, palmLengthPx: geo.palmLengthPx, w, h }, px };
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
  const lines = Array.isArray(input.lines) ? input.lines : [];
  for (const id of ['heart', 'head', 'life', 'upward']) {
    const given = lines.filter((l) => l && l.line === id);
    const l = featureSet.lines[id];
    if (given.length > 1) fail(`line ${id} given twice`);
    const g = given[0];
    if (l.provenance === 'user-confirmed') {
      if (!g || g.action !== 'traced' || g.confirmed !== true) fail(`line ${id} confirmed without a confirmed trace`);
      if (!fi.frame) fail(`line ${id} placed without a frame`);
      const pts = Array.isArray(g.points) ? g.points.map(readPoint) : null;
      if (!pts || pts.some((p) => !p) || !samePoints(pts.map((p) => toPalm4(fi.frame, p)), l.palmPoints)) fail(`line ${id} trace differs from the supplied trace`);
    } else if (!g) { if (l.reason !== 'not-requested') fail(`line ${id} state`); }
    else if (g.action === 'skipped') { if (l.reason !== g.reason) fail(`line ${id} skip reason`); }
    else if (g.action === 'traced' && g.confirmed !== true) { if (l.reason !== 'not-confirmed') fail(`line ${id} confirmation`); }
    else if (g.action === 'traced') { if (!(l.reason === 'frame-unavailable' || /^trace-/.test(l.reason))) fail(`line ${id} unassessed reason`); }
    else fail(`line ${id} action`);
  }
  const ratios = ratiosFromInput(fi);
  for (const id of ['middleToPalmRatio', 'indexToRingRatio']) {
    const m = featureSet.measurements.measurements[id];
    if (m.value !== null && (!ratios || ratios[id] !== m.value)) fail(`measurement ${id} differs from the supplied landmarks`);
  }
  const marks = Array.isArray(input.marks) ? input.marks : [];
  for (const id of ['yava', 'matsya', 'shankha', 'chatra', 'vedi']) {
    const given = marks.filter((m) => m && m.mark === id)[0];
    const m = featureSet.marks[id];
    const ok = !given ? m.provenance === 'unassessed' && m.reason === 'not-requested'
      : given.action === 'skipped' ? m.provenance === 'unassessed' && m.reason === 'user-skipped'
        : m.provenance === 'user-reported' || (m.provenance === 'unassessed' && m.reason === 'location-invalid');
    if (!ok) fail(`mark ${id} state`);
  }
  return Object.freeze({ frameAvailable: fi.frame !== null, fingerBases: fingerBasesFromInput(input) });
}
