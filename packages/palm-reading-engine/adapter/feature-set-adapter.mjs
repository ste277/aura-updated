// AURA-PALM-03-I1 — user-assisted feature-set → engine adapter (TEST-ONLY; synthetic data only; not imported by any app).
//
// toEngineFeaturesFromFeatureSet(featureSet, synthetic) maps the apps/web `PalmFeatureSet` (palm-03-i1-feature-set@0.1.0:
// automatic hand measurements, user-confirmed line traces, user-reported marks, unassessed features) onto the frozen
// engine's contract `aura.palm.features` v0.1.0. The engine (prototype/src) is NOT modified and keeps its identity and
// its synthetic-only restriction; this adapter only reads its published constants.
//
// Rules (fail closed: malformed input throws AdapterError, never a partial or repaired output):
//  S1  synthetic only: the caller must pass { synthetic: true, scanConfidence } explicitly. There is no non-synthetic path.
//  S2  only user-confirmed traces are mapped. Unassessed lines are omitted (never inferred); the engine reports them as
//      not observed. Absence is never mapped to "missing" (expectedButMissing stays empty: a skipped line says nothing
//      about the palm).
//  S3  identity: heart → DTC, head → PTC, life → TC (classSource 'user-confirmed', classConfidence 1). The optional
//      upward line → MINOR: the engine recognises the central longitudinal (fate/upward) line only by geometry among
//      MINOR creases, as a hypothesis feature capped at tentative.
//  S4  trace confidence: a user trace has no detector score. Detection confidence is set to the engine's tentative cap
//      (TENTATIVE_CAP, 0.74) with basis 'synthetic-declared': a confirmed identity must not read as an accurate trace,
//      so traced lines are worded tentatively at most.
//  S5  source registration: no user-trace source is registered in the frozen engine, so traces are submitted under the
//      'synthetic-fixture' detector entry (synthetic stand-in). Landmarks are declared 'synthetic-fixture' too.
//  S6  geometry: points are forwarded in traced order, never resampled or repaired. A trace the engine's own polyline
//      rules reject (self-crossing, doubling back, tortuous, degenerate) is DECLINED with the reason, so one bad trace
//      cannot invalidate the whole reading.
//  S7  not mappable (no engine input exists): hand measurements, user-reported marks, user-declared hand vs landmark
//      handedness. Each is listed in `notMapped` with the reason; nothing is dropped silently.
//  S8  quality: the frame's quality status and issues are forwarded unaltered (the engine applies its own frame rules).
import { FEATURE_SCHEMA_ID, FEATURE_SCHEMA_VERSION, COORDINATE_FRAME, FRAME_BOUNDS, MAX_POINTS, MAX_CREASES, QUALITY_ISSUES, polylineProblem } from '../prototype/src/schema.mjs';
import { TENTATIVE_CAP } from '../prototype/src/policy.mjs';

export const FEATURE_SET_ADAPTER_VERSION = 'palm-03-i1-feature-set-adapter@0.1.0';
export const ACCEPTED_FEATURE_SET_VERSIONS = Object.freeze(['palm-03-i1-feature-set@0.1.0']);
export const LINE_TO_CLASS = Object.freeze({ heart: 'DTC', head: 'PTC', life: 'TC', upward: 'MINOR' });
const LINE_ORDER = Object.freeze(['heart', 'head', 'life', 'upward']);

export class AdapterError extends Error { constructor(code, message) { super(`feature-set-adapter: ${code}: ${message}`); this.code = code; } }
const fail = (code, msg) => { throw new AdapterError(code, msg); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const isPoint = (p) => isObj(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const inBounds = (p) => p.x >= FRAME_BOUNDS.xMin && p.x <= FRAME_BOUNDS.xMax && p.y >= FRAME_BOUNDS.yMin && p.y <= FRAME_BOUNDS.yMax;

/** Full result: { features, declined: [{ line, reason }], notMapped: [{ feature, reason }] }. */
export function adaptFeatureSet(featureSet, synthetic) {
  if (!isObj(synthetic) || synthetic.synthetic !== true) fail('synthetic-required', 'pass { synthetic: true, scanConfidence } explicitly; real input is not authorised');
  if (!num01(synthetic.scanConfidence)) fail('invalid-scan-confidence', 'synthetic.scanConfidence must be in [0, 1] (declared, never calibrated)');
  if (!isObj(featureSet) || !ACCEPTED_FEATURE_SET_VERSIONS.includes(featureSet.version)) fail('unsupported-feature-set', `version ${JSON.stringify(featureSet?.version)}`);
  const hand = featureSet.hand;
  if (!isObj(hand) || !['left', 'right'].includes(hand.value) || hand.source !== 'user-declared') fail('invalid-hand', 'hand { value: left|right, source: user-declared }');
  if (!['left', 'right', 'unknown'].includes(featureSet.dominantHand)) fail('invalid-dominant-hand', 'left | right | unknown');
  const fr = featureSet.frame;
  if (!isObj(fr) || typeof fr.available !== 'boolean' || !(fr.palmFacing === null || typeof fr.palmFacing === 'boolean') || !Number.isFinite(fr.rotationDeg) || Math.abs(fr.rotationDeg) > 180) fail('invalid-frame', 'frame { available, rotationDeg }');
  if (!['accepted', 'needs-retake'].includes(fr.qualityStatus) || !Array.isArray(fr.qualityIssues) || fr.qualityIssues.some((i) => !QUALITY_ISSUES.includes(i))) fail('invalid-frame', 'frame quality { status, issues }');
  if (!isObj(featureSet.lines) || !isObj(featureSet.marks) || !isObj(featureSet.measurements)) fail('invalid-feature-set', 'lines, marks and measurements are required');

  const items = [], declined = [], notMapped = [];
  for (const line of LINE_ORDER) {
    const f = featureSet.lines[line];
    if (!isObj(f)) fail('invalid-feature-set', `lines.${line} is required`);
    if (f.provenance === 'unassessed') continue; // S2: omitted, never inferred
    if (f.provenance !== 'user-confirmed' || f.confirmation !== 'confirmed') fail('invalid-line', `lines.${line}: only confirmed user traces can be mapped`);
    if (!fr.available) fail('invalid-line', `lines.${line}: a placed trace needs an available frame`);
    const pts = f.palmPoints;
    if (!Array.isArray(pts) || !pts.every(isPoint)) fail('invalid-line', `lines.${line}.palmPoints must be [{x, y}]`);
    if (pts.length < 2 || pts.length > MAX_POINTS || !pts.every(inBounds)) { declined.push({ line, reason: 'outside-engine-limits' }); continue; }
    const points = pts.map((p) => ({ x: p.x, y: p.y }));
    const problem = polylineProblem(points);
    if (problem) { declined.push({ line, reason: `geometry-${problem}` }); continue; }
    items.push({
      id: `trace-${line}`,
      geometry: { points },
      continuity: { gapsBridged: null, breaks: null }, // a trace observes no breaks
      branches: [],
      detection: { confidence: TENTATIVE_CAP, confidenceBasis: 'synthetic-declared' }, // S4
      identity: { anatomicalClass: LINE_TO_CLASS[line], classConfidence: 1, classSource: 'user-confirmed' },
    });
  }
  if (items.length > MAX_CREASES) fail('too-many-lines', `${items.length} > ${MAX_CREASES}`);

  // S7: everything the engine has no input for is listed, never silently dropped.
  for (const [id, m] of Object.entries(featureSet.measurements.measurements ?? {})) {
    if (m?.status !== 'unavailable') notMapped.push({ feature: `measurement:${id}`, reason: 'engine-has-no-hand-measurement-input' });
  }
  for (const [id, m] of Object.entries(featureSet.marks)) {
    if (m?.provenance === 'user-reported') notMapped.push({ feature: `mark:${id}`, reason: 'engine-has-no-mark-input' });
  }

  const features = {
    schema: FEATURE_SCHEMA_ID, schemaVersion: FEATURE_SCHEMA_VERSION, synthetic: true,
    capture: {
      handedness: { value: hand.value, source: 'user-declared' },
      dominantHand: featureSet.dominantHand,
      orientation: { rotationDeg: fr.rotationDeg, palmFacing: fr.palmFacing },
      quality: { status: fr.qualityStatus, issues: [...fr.qualityIssues] },
    },
    landmarks: fr.available ? { present: true, source: { detector: 'synthetic-fixture', version: '0.1.0' } } : { present: false },
    creases: { source: { detector: 'synthetic-fixture', version: '0.1.0' }, coordinateFrame: COORDINATE_FRAME, items, expectedButMissing: [], conflicts: [] },
    scanConfidence: { value: synthetic.scanConfidence, basis: 'synthetic-declared' },
  };
  return { features: JSON.parse(JSON.stringify(features)), declined, notMapped };
}

export function toEngineFeaturesFromFeatureSet(featureSet, synthetic) { return adaptFeatureSet(featureSet, synthetic).features; }
