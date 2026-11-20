// AURA-PALM-G6-I1 — detector-to-engine feature adapter (TEST-ONLY; synthetic data only; not imported by any app).
//
// toFeatures(detection, frame, identity = null) → `aura.palm.features` v0.1.0 (plain JSON), from FROZEN synthetic
// detector output (creases-directional-d1@frozen-d1, creases-directional-d3b@D3B-C) and a synthetic frame.
// The frozen engine (prototype/src) is NOT modified; the adapter only reads its published contract constants.
//
// Contract obligations implemented (R1 / R1.1 "remaining G6-I1 dependencies", items B1–B7):
//   B1  plain JSON only: inputs must be plain JSON (no accessors, symbols, non-plain prototypes, non-finite numbers,
//       functions); the output contains only feature-contract fields and is a fresh JSON value.
//   B2  frame attestation: rotationDeg, palmFacing, handedness and quality are forwarded UNALTERED from the frame;
//       the coordinate frame is derived from the frame's landmark points, which are never forwarded.
//   B3  ordered polylines without sampling artefacts: each track's points are forwarded in detector order; no
//       resampling, smoothing, sorting, de-duplication, truncation or decimation.
//   B4  branches: none are synthesised (`branches: []`; D1/D3-B emit no branches).
//   B5  `gapsBridged` is forwarded as metadata only; `breaks` is null (not observed) and never derived from it.
//   B6  pixel → palm-normalized-v1 transform (below), within FRAME_BOUNDS and the MAX_POINTS limit.
//   B7  opaque ids cand1…cand6 by detector order (stable: a declined candidate leaves a gap; ids are never reused).
// Owner-approved behaviour (G6-I1): identity defaults to unclassified/none; detector scores are forwarded only with
// basis 'uncalibrated-detector-score' and only when already in [0, 1] (RV-14: no [0,1] mapping is defined for raw
// detector sums, and inventing one would be a calibration claim — such a crease is DECLINED); scan confidence is
// never emitted as 'calibrated'; a crease with more than MAX_POINTS points, fewer than 2, or any point outside the
// frame bounds is DECLINED (never truncated, decimated or clipped); a synthetic user-confirmed identity is accepted
// only when explicitly marked `synthetic: true` (isolated tests).
// Fail closed: any malformed input or contract violation throws AdapterError (never a partial or repaired output).
//
// palm-normalized-v1 transform (feature schema §5): unit = palm width w = |INDEX_MCP − PINKY_MCP|;
//   ex = (PINKY_MCP − INDEX_MCP) / w   (radial → ulnar; follows the hand, so left and right hands share one frame)
//   ey = ex rotated ±90°, the sign chosen so that the WRIST lies at y > 0 (finger base → wrist)
//   x = ((p − INDEX_MCP) · ex) / w,  y = ((p − INDEX_MCP) · ey) / w     (INDEX_MCP ↦ (0,0), PINKY_MCP ↦ (1,0))
import { DETECTOR_REGISTRY, LANDMARK_REGISTRY, FRAME_BOUNDS, MAX_POINTS, MAJOR_CLASSES, QUALITY_ISSUES, QUALITY_STATUSES, FEATURE_SCHEMA_ID, FEATURE_SCHEMA_VERSION, COORDINATE_FRAME } from '../prototype/src/schema.mjs';

export const ADAPTER_VERSION = 'g6-i1-feature-adapter@0.1.0';
export const MAX_CANDIDATES = 6;
export const RESEARCH_DETECTORS = Object.freeze({ 'creases-directional-d1': 'frozen-d1', 'creases-directional-d3b': 'D3B-C' });
const CANDIDATE_KEYS = Object.freeze(['points', 'score', 'lengthPx', 'symmetry', 'gapsBridged']);
const IDENTITY_CLASSES = Object.freeze(['DTC', 'PTC', 'TC', 'MINOR']);

export class AdapterError extends Error { constructor(code, message) { super(`adapter: ${code}: ${message}`); this.code = code; } }
const fail = (code, msg) => { throw new AdapterError(code, msg); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** B1: deep check that `v` is plain JSON (throws AdapterError otherwise). Reads only own data properties. */
function assertPlainJson(v, where, depth = 0, seen = new Set()) {
  if (depth > 32) fail('not-plain-json', `${where}: nesting too deep`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) fail('not-plain-json', `${where}: non-finite number`); return; }
  if (typeof v !== 'object') fail('not-plain-json', `${where}: ${typeof v} is not JSON`);
  if (seen.has(v)) fail('not-plain-json', `${where}: cycle or shared reference`);
  seen.add(v);
  const proto = Object.getPrototypeOf(v);
  if (Array.isArray(v) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('not-plain-json', `${where}: non-plain object`);
  if (Object.getOwnPropertySymbols(v).length) fail('not-plain-json', `${where}: symbol keys`);
  for (const k of Object.getOwnPropertyNames(v)) {
    if (Array.isArray(v) && k === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d)) fail('not-plain-json', `${where}.${k}: accessor property`);
    assertPlainJson(d.value, `${where}.${k}`, depth + 1, seen);
  }
  seen.delete(v);
}
const isPoint = (p) => p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length === 2 && Number.isFinite(p.x) && Number.isFinite(p.y);
const num01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** B6: the palm frame from the three frame landmarks (pixel coordinates). */
export function palmFrame(lm) {
  for (const k of ['wrist', 'indexMcp', 'pinkyMcp']) if (!isPoint(lm?.[k])) fail('invalid-frame', `landmarks.points.${k} must be {x, y} finite pixels`);
  const I = lm.indexMcp, P = lm.pinkyMcp, Wr = lm.wrist;
  const w = Math.hypot(P.x - I.x, P.y - I.y);
  if (!(w > 0)) fail('invalid-frame', 'palm width (index-MCP to pinky-MCP) must be positive');
  const ex = { x: (P.x - I.x) / w, y: (P.y - I.y) / w };
  let ey = { x: -ex.y, y: ex.x };
  const wristSide = (Wr.x - I.x) * ey.x + (Wr.y - I.y) * ey.y;
  if (!(Math.abs(wristSide) > 1e-9 * w)) fail('invalid-frame', 'wrist lies on the finger-base line; the frame is undefined');
  if (wristSide < 0) ey = { x: -ey.x, y: -ey.y };
  return { origin: { x: I.x, y: I.y }, ex, ey, widthPx: w };
}
export const toPalm = (f, p) => ({ x: ((p.x - f.origin.x) * f.ex.x + (p.y - f.origin.y) * f.ex.y) / f.widthPx, y: ((p.x - f.origin.x) * f.ey.x + (p.y - f.origin.y) * f.ey.y) / f.widthPx });
const inBounds = (p) => p.x >= FRAME_BOUNDS.xMin && p.x <= FRAME_BOUNDS.xMax && p.y >= FRAME_BOUNDS.yMin && p.y <= FRAME_BOUNDS.yMax;

function checkFrame(frame) {
  if (!frame || typeof frame !== 'object') fail('invalid-frame', 'frame is required');
  const c = frame.capture;
  if (!c || typeof c !== 'object') fail('invalid-frame', 'frame.capture is required');
  if (!['left', 'right', 'unknown'].includes(c.handedness?.value) || !['user-declared', 'landmark-model', 'unknown'].includes(c.handedness?.source)) fail('invalid-frame', 'capture.handedness {value, source}');
  if (!['left', 'right', 'unknown'].includes(c.dominantHand)) fail('invalid-frame', 'capture.dominantHand');
  if (!(typeof c.orientation?.rotationDeg === 'number' && Number.isFinite(c.orientation.rotationDeg)) || !(c.orientation.palmFacing === null || typeof c.orientation.palmFacing === 'boolean')) fail('invalid-frame', 'capture.orientation {rotationDeg, palmFacing}');
  if (!QUALITY_STATUSES.includes(c.quality?.status) || !Array.isArray(c.quality.issues) || c.quality.issues.some((i) => !QUALITY_ISSUES.includes(i))) fail('invalid-frame', 'capture.quality {status, issues}');
  const lm = frame.landmarks;
  if (!lm || typeof lm !== 'object' || typeof lm.source?.detector !== 'string' || typeof lm.source?.version !== 'string') fail('invalid-frame', 'frame.landmarks.source {detector, version}');
  const reg = LANDMARK_REGISTRY[lm.source.detector];
  if (!reg || !reg.versions.includes(lm.source.version)) fail('unregistered-landmark-source', `${lm.source.detector}@${lm.source.version}`);
  const sc = frame.scanConfidence;
  if (!sc || typeof sc !== 'object' || !num01(sc.value)) fail('invalid-frame', 'frame.scanConfidence.value must be in [0, 1]');
  if (sc.basis !== 'uncalibrated-detector-score') fail('calibrated-scan-confidence-refused', `scan confidence basis ${JSON.stringify(sc.basis)}: only 'uncalibrated-detector-score' is accepted (no calibration exists)`);
}

function checkIdentity(identity, candidateCount) {
  if (identity === null) return null;
  if (!identity || typeof identity !== 'object') fail('invalid-identity', 'identity must be null or an object');
  if (identity.synthetic !== true) fail('non-synthetic-identity-refused', 'only an explicitly synthetic identity (synthetic: true) is accepted; real identity sources are not authorised');
  if (identity.kind !== 'user-confirmed') fail('invalid-identity', "identity.kind must be 'user-confirmed'");
  if (!Array.isArray(identity.labels)) fail('invalid-identity', 'identity.labels[] is required');
  const byIndex = new Map();
  for (const l of identity.labels) {
    if (!Number.isInteger(l?.candidate) || l.candidate < 0 || l.candidate >= candidateCount) fail('invalid-identity', `label for unknown candidate ${l?.candidate}`);
    if (byIndex.has(l.candidate)) fail('invalid-identity', `candidate ${l.candidate} labelled twice`);
    if (!IDENTITY_CLASSES.includes(l.anatomicalClass)) fail('invalid-identity', `anatomicalClass ${JSON.stringify(l.anatomicalClass)}`);
    if (!num01(l.classConfidence)) fail('invalid-identity', 'classConfidence must be in [0, 1]');
    byIndex.set(l.candidate, l);
  }
  return byIndex;
}

/**
 * Full adapter result: { features, declined: [{ candidate, id, reason }] }. `features` is plain JSON conforming to
 * aura.palm.features v0.1.0; `declined` lists every candidate the adapter refused to forward, with the reason.
 */
export function adaptDetection(detection, frame, identity = null) {
  assertPlainJson(detection, 'detection'); assertPlainJson(frame, 'frame'); assertPlainJson(identity, 'identity');
  if (!detection || typeof detection !== 'object' || Array.isArray(detection)) fail('invalid-detection', 'detection must be an object');
  const regEntry = DETECTOR_REGISTRY[detection.detector];
  if (!own(RESEARCH_DETECTORS, String(detection.detector)) || RESEARCH_DETECTORS[detection.detector] !== detection.version || !regEntry || !regEntry.versions.includes(detection.version)) fail('unpinned-detector', `${detection.detector}@${detection.version} is not a pinned research detector`);
  if (!Array.isArray(detection.candidates)) fail('invalid-detection', 'detection.candidates[] is required');
  if (detection.candidates.length > MAX_CANDIDATES) fail('too-many-candidates', `${detection.candidates.length} > ${MAX_CANDIDATES}`);
  checkFrame(frame);
  const labels = checkIdentity(identity, detection.candidates.length);
  const pf = palmFrame(frame.landmarks.points);
  const items = [], declined = [];
  detection.candidates.forEach((c, i) => {
    const id = `cand${i + 1}`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) fail('invalid-candidate', `${id}: must be an object`);
    const extra = Object.keys(c).filter((k) => !CANDIDATE_KEYS.includes(k));
    if (extra.length) fail('invalid-candidate', `${id}: unexpected field(s) ${extra.join(', ')}`);
    if (!Array.isArray(c.points) || !c.points.every(isPoint)) fail('invalid-candidate', `${id}: points must be [{x, y}] finite pixels`);
    if (!Number.isInteger(c.gapsBridged) || c.gapsBridged < 0) fail('invalid-candidate', `${id}: gapsBridged must be a non-negative integer`);
    if (typeof c.score !== 'number' || !Number.isFinite(c.score)) fail('invalid-candidate', `${id}: score must be a finite number`);
    // per-crease declines (the crease is omitted, never altered)
    if (c.points.length > MAX_POINTS) { declined.push({ candidate: i, id, reason: 'too-many-points' }); return; }
    if (c.points.length < 2) { declined.push({ candidate: i, id, reason: 'too-few-points' }); return; }
    if (!num01(c.score)) { declined.push({ candidate: i, id, reason: 'score-not-normalised' }); return; }
    const pts = c.points.map((p) => toPalm(pf, p));
    if (!pts.every(inBounds)) { declined.push({ candidate: i, id, reason: 'outside-frame-bounds' }); return; }
    const lab = labels?.get(i);
    items.push({
      id,
      geometry: { points: pts },
      continuity: { gapsBridged: c.gapsBridged, breaks: null },
      branches: [],
      detection: { confidence: c.score, confidenceBasis: 'uncalibrated-detector-score' },
      identity: lab ? { anatomicalClass: lab.anatomicalClass, classConfidence: lab.classConfidence, classSource: 'user-confirmed' } : { anatomicalClass: 'unclassified', classConfidence: 0, classSource: 'none' },
    });
  });
  // identity-derived cross references (only when an identity source exists)
  const conflicts = [], expectedButMissing = [];
  if (labels) {
    for (const cls of MAJOR_CLASSES) {
      const ids = items.filter((it) => it.identity.anatomicalClass === cls).map((it) => it.id);
      if (ids.length > 1) conflicts.push({ ids, kind: 'class-collision' });
      if (ids.length === 0) expectedButMissing.push(cls);
    }
  }
  const c = frame.capture;
  const features = {
    schema: FEATURE_SCHEMA_ID, schemaVersion: FEATURE_SCHEMA_VERSION, synthetic: true,
    capture: { handedness: { value: c.handedness.value, source: c.handedness.source }, dominantHand: c.dominantHand,
      orientation: { rotationDeg: c.orientation.rotationDeg, palmFacing: c.orientation.palmFacing }, quality: { status: c.quality.status, issues: [...c.quality.issues] } },
    landmarks: { present: true, source: { detector: frame.landmarks.source.detector, version: frame.landmarks.source.version } }, // B2: frame metadata only — never coordinates
    creases: { source: { detector: detection.detector, version: detection.version }, coordinateFrame: COORDINATE_FRAME, items, expectedButMissing, conflicts },
    scanConfidence: { value: frame.scanConfidence.value, basis: 'uncalibrated-detector-score' },
  };
  return { features: JSON.parse(JSON.stringify(features)), declined };
}

/** toFeatures(detection, frame, identity = null) → aura.palm.features (plain JSON). Fails closed (AdapterError). */
export function toFeatures(detection, frame, identity = null) { return adaptDetection(detection, frame, identity).features; }
