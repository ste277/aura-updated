// AURA-PALM-03-I1 — user-assisted feature-set → engine adapter (TEST-ONLY; synthetic data only; not imported by any app).
//
// adaptFeatureSet(featureSet, synthetic) validates a COMPLETE apps/web `PalmFeatureSet` record
// (palm-03-i1-feature-set@0.1.0) and maps it onto the frozen engine's contract `aura.palm.features` v0.1.0.
// The engine (prototype/src) is NOT modified and keeps its identity and its synthetic-only restriction; this adapter
// only reads its published constants and polyline rules.
//
// Contract: the FULL result { features, declined, notMapped } is the integration and audit contract. There is
// deliberately no convenience export that returns `features` alone (PALM-03-I1 review L1).
//
// Rules (fail closed: any malformed, sparse, contradictory or incomplete record throws a typed AdapterError before any
// mapping; unexpected runtime errors are converted to AdapterError('invalid-input'), never leaked raw):
//  V1  plain data: objects and DENSE arrays only (holes, accessors and non-finite numbers rejected).
//  V2  quality: status must agree with issues (accepted ⇔ no issues; needs-retake ⇔ ≥ 1 issue; unknown ⇔ no issues),
//      issues must be distinct known codes. Blocking feedback therefore cannot pass as 'accepted' and is forwarded to
//      the engine's initial quality gate unaltered.
//  V3  inventories: exactly the 9 measurements, 4 lines and 5 marks, each record internally consistent
//      (measured/uncertain ⇒ finite value; unavailable ⇒ null), and the provenance index must match the records.
//  V4  lines: user-confirmed ⇔ confirmation 'confirmed' with valid geometry (2..64 finite points inside the frame
//      bounds that pass the engine's own polyline rules); unassessed ⇒ a known reason whose confirmation state is
//      consistent (skipped/not-requested ⇒ 'none', not-confirmed ⇒ 'pending', frame/trace problems ⇒ 'confirmed');
//      identity must be the expected anatomical identity for the line.
//  S1  synthetic only: the caller must pass { synthetic: true, scanConfidence } explicitly. There is no non-synthetic path.
//  S2  only user-confirmed traces are mapped. Unassessed lines are omitted (never inferred) and never mapped to
//      "expected but missing" (a skipped line says nothing about the palm).
//  S3  identity: heart → DTC, head → PTC, life → TC (classSource 'user-confirmed', classConfidence 1, a synthetic
//      encoding). The optional upward line → MINOR (the engine recognises a central longitudinal line only by geometry).
//  S4  confidence ceiling (owner decision 2): detection confidence = engine TENTATIVE_CAP (0.74), basis
//      'synthetic-declared', so a user-confirmed trace is interpreted at tentative at most.
//  S5  source stand-in: no user-trace source is registered in the frozen engine, so traces are submitted under the
//      'synthetic-fixture' detector entry; landmarks are declared 'synthetic-fixture' too (INC-1).
//  S6  geometry is forwarded in recorded order, never resampled or repaired.
//  S7  not mappable (no engine input exists): usable hand measurements and user-reported marks are listed in
//      `notMapped`; nothing is dropped silently.
import { FEATURE_SCHEMA_ID, FEATURE_SCHEMA_VERSION, COORDINATE_FRAME, FRAME_BOUNDS, MAX_POINTS, QUALITY_ISSUES, polylineProblem } from '../prototype/src/schema.mjs';
import { TENTATIVE_CAP } from '../prototype/src/policy.mjs';

export const FEATURE_SET_ADAPTER_VERSION = 'palm-03-i1-feature-set-adapter@0.2.0';
export const ACCEPTED_FEATURE_SET_VERSIONS = Object.freeze(['palm-03-i1-feature-set@0.1.0']);
export const ACCEPTED_MEASUREMENT_VERSIONS = Object.freeze(['palm-03-i1-hand-measurements@0.1.0']);
export const LINE_TO_CLASS = Object.freeze({ heart: 'DTC', head: 'PTC', life: 'TC', upward: 'MINOR' });
export const EXPECTED_ANATOMY = Object.freeze({ heart: 'distal-transverse', head: 'proximal-transverse', life: 'thenar', upward: 'central-longitudinal' });
export const LINE_IDS = Object.freeze(['heart', 'head', 'life', 'upward']);
export const MARK_IDS = Object.freeze(['yava', 'matsya', 'shankha', 'chatra', 'vedi']);
export const MEASUREMENT_IDS = Object.freeze(['palmLength', 'thumbLength', 'indexLength', 'middleLength', 'ringLength', 'littleLength', 'handLength', 'middleToPalmRatio', 'indexToRingRatio']);
const LINE_REASON_CONFIRMATION = Object.freeze({
  'not-requested': 'none', 'user-skipped': 'none', 'user-cannot-see': 'none', 'not-confirmed': 'pending',
  'frame-unavailable': 'confirmed', 'trace-too-few-points': 'confirmed', 'trace-too-many-points': 'confirmed',
  'trace-point-invalid': 'confirmed', 'trace-outside-image': 'confirmed', 'trace-outside-palm-frame': 'confirmed',
  'trace-too-few-distinct-points': 'confirmed', 'trace-repeated-point': 'confirmed', 'trace-too-short': 'confirmed',
  'trace-doubles-back': 'confirmed', 'trace-self-intersecting': 'confirmed', 'trace-tortuous': 'confirmed',
});
const MARK_UNASSESSED_REASONS = Object.freeze(['not-requested', 'user-skipped', 'location-invalid']);
const MEASUREMENT_STATUSES = Object.freeze(['measured', 'uncertain', 'unavailable']);

export class AdapterError extends Error { constructor(code, message) { super(`feature-set-adapter: ${code}: ${message}`); this.code = code; } }
const fail = (code, msg) => { throw new AdapterError(code, msg); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num01 = (v) => isNum(v) && v >= 0 && v <= 1;
const inBounds = (p) => p.x >= FRAME_BOUNDS.xMin && p.x <= FRAME_BOUNDS.xMax && p.y >= FRAME_BOUNDS.yMin && p.y <= FRAME_BOUNDS.yMax;
const sameKeys = (o, keys) => { const k = Object.keys(o); return k.length === keys.length && keys.every((x) => own(o, x)); };

/** V1: deep plain-data check (dense arrays, data properties only, finite numbers). Throws AdapterError. */
function assertPlain(v, where, depth = 0, seen = new Set()) {
  if (depth > 16) fail('invalid-input', `${where}: nesting too deep`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) fail('invalid-input', `${where}: non-finite number`); return; }
  if (typeof v !== 'object') fail('invalid-input', `${where}: ${typeof v} is not plain data`);
  if (seen.has(v)) fail('invalid-input', `${where}: cycle or shared reference`);
  seen.add(v);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) if (!own(v, i)) fail('sparse-array', `${where}[${i}] is a hole`);
  }
  for (const k of Object.getOwnPropertyNames(v)) {
    if (Array.isArray(v) && k === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d)) fail('invalid-input', `${where}.${k}: accessor property`);
    assertPlain(d.value, `${where}.${k}`, depth + 1, seen);
  }
  seen.delete(v);
}

function validQuality(fr) {
  if (!Array.isArray(fr.qualityIssues)) fail('invalid-frame', 'frame.qualityIssues must be an array');
  for (let i = 0; i < fr.qualityIssues.length; i++) {
    if (!own(fr.qualityIssues, i)) fail('sparse-array', `frame.qualityIssues[${i}] is a hole`);
    if (!QUALITY_ISSUES.includes(fr.qualityIssues[i])) fail('invalid-frame', `unknown quality issue ${JSON.stringify(fr.qualityIssues[i])}`);
  }
  if (new Set(fr.qualityIssues).size !== fr.qualityIssues.length) fail('invalid-frame', 'duplicate quality issues');
  const n = fr.qualityIssues.length;
  const ok = (fr.qualityStatus === 'accepted' && n === 0) || (fr.qualityStatus === 'needs-retake' && n > 0) || (fr.qualityStatus === 'unknown' && n === 0);
  if (!ok) fail('contradictory-quality', `qualityStatus ${JSON.stringify(fr.qualityStatus)} with ${n} issue(s)`);
}

function validMeasurements(ms) {
  if (!isObj(ms) || ms.provenance !== 'automatic-measured' || !ACCEPTED_MEASUREMENT_VERSIONS.includes(ms.version) || !MEASUREMENT_STATUSES.includes(ms.status) || !Array.isArray(ms.reasons)) fail('invalid-measurement', 'measurements { version, provenance: automatic-measured, status, reasons[] }');
  if (!isObj(ms.measurements) || !sameKeys(ms.measurements, MEASUREMENT_IDS)) fail('incomplete-inventory', `measurements must list exactly ${MEASUREMENT_IDS.join(', ')}`);
  for (const id of MEASUREMENT_IDS) {
    const m = ms.measurements[id];
    if (!isObj(m) || m.id !== id || !MEASUREMENT_STATUSES.includes(m.status) || !Array.isArray(m.reasons) || !['palm-width', 'ratio'].includes(m.unit)) fail('invalid-measurement', `measurements.${id}`);
    if (m.status === 'unavailable' ? m.value !== null : !isNum(m.value)) fail('invalid-measurement', `measurements.${id}: status ${m.status} with value ${JSON.stringify(m.value)}`);
  }
}

function validGeometry(points, where) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS) fail('invalid-line', `${where}: 2..${MAX_POINTS} points required`);
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || !sameKeys(p, ['x', 'y'])) fail('invalid-line', `${where}[${i}] must be { x, y } finite`);
    if (!inBounds(p)) fail('invalid-line', `${where}[${i}] is outside the palm-frame bounds`);
    out.push({ x: p.x, y: p.y });
  }
  const problem = polylineProblem(out);
  if (problem) fail('invalid-line', `${where}: geometry ${problem}`);
  return out;
}

function validLines(lines, frameAvailable) {
  if (!isObj(lines) || !sameKeys(lines, LINE_IDS)) fail('incomplete-inventory', `lines must list exactly ${LINE_IDS.join(', ')}`);
  for (const id of LINE_IDS) {
    const l = lines[id];
    if (!isObj(l) || l.line !== id) fail('invalid-line', `lines.${id}`);
    if (!isObj(l.identity) || l.identity.anatomical !== EXPECTED_ANATOMY[id]) fail('invalid-line', `lines.${id}: identity must be ${EXPECTED_ANATOMY[id]}`);
    if (l.provenance === 'user-confirmed') {
      if (l.confirmation !== 'confirmed') fail('invalid-line', `lines.${id}: user-confirmed requires confirmation 'confirmed'`);
      if (!frameAvailable) fail('invalid-line', `lines.${id}: placed geometry needs an available frame`);
      if (own(l, 'reason')) fail('invalid-line', `lines.${id}: a confirmed line carries no unassessed reason`);
      validGeometry(l.palmPoints, `lines.${id}.palmPoints`);
    } else if (l.provenance === 'unassessed') {
      if (own(l, 'palmPoints')) fail('invalid-line', `lines.${id}: unassessed lines carry no geometry`);
      const expected = own(LINE_REASON_CONFIRMATION, String(l.reason)) ? LINE_REASON_CONFIRMATION[l.reason] : undefined;
      if (!expected) fail('invalid-line', `lines.${id}: unknown unassessed reason ${JSON.stringify(l.reason)}`);
      if (l.confirmation !== expected) fail('invalid-line', `lines.${id}: reason ${l.reason} requires confirmation '${expected}', got ${JSON.stringify(l.confirmation)}`);
    } else fail('invalid-provenance', `lines.${id}: provenance ${JSON.stringify(l.provenance)} is not valid for a line`);
  }
}

function validMarks(marks) {
  if (!isObj(marks) || !sameKeys(marks, MARK_IDS)) fail('incomplete-inventory', `marks must list exactly ${MARK_IDS.join(', ')}`);
  for (const id of MARK_IDS) {
    const m = marks[id];
    if (!isObj(m) || m.mark !== id) fail('invalid-mark', `marks.${id}`);
    if (m.provenance === 'user-reported') {
      const loc = m.approximatePalmLocation;
      if (!(loc === null || (isObj(loc) && isNum(loc.x) && isNum(loc.y) && inBounds(loc)))) fail('invalid-mark', `marks.${id}.approximatePalmLocation`);
    } else if (m.provenance === 'unassessed') {
      if (!MARK_UNASSESSED_REASONS.includes(m.reason)) fail('invalid-mark', `marks.${id}: unknown reason ${JSON.stringify(m.reason)}`);
    } else fail('invalid-provenance', `marks.${id}: provenance ${JSON.stringify(m.provenance)} is not valid for a mark`);
  }
}

function validProvenanceIndex(fs) {
  const p = fs.provenance;
  const groups = ['automatic-measured', 'user-confirmed', 'user-reported', 'unassessed'];
  if (!isObj(p) || !sameKeys(p, groups) || groups.some((g) => !Array.isArray(p[g]))) fail('invalid-provenance', 'provenance index must have exactly the four groups');
  const expected = Object.fromEntries(groups.map((g) => [g, []]));
  for (const id of MEASUREMENT_IDS) expected[fs.measurements.measurements[id].status === 'unavailable' ? 'unassessed' : 'automatic-measured'].push(`measurement:${id}`);
  for (const id of LINE_IDS) expected[fs.lines[id].provenance].push(`line:${id}`);
  for (const id of MARK_IDS) expected[fs.marks[id].provenance].push(`mark:${id}`);
  for (const g of groups) {
    const a = [...p[g]].sort(), b = [...expected[g]].sort();
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) fail('invalid-provenance', `provenance.${g} does not match the feature records`);
  }
}

function validateRecord(fs) {
  if (!isObj(fs)) fail('unsupported-feature-set', 'feature set must be an object');
  assertPlain(fs, 'featureSet');
  if (!ACCEPTED_FEATURE_SET_VERSIONS.includes(fs.version)) fail('unsupported-feature-set', `version ${JSON.stringify(fs.version)}`);
  const hand = fs.hand;
  if (!isObj(hand) || !['left', 'right'].includes(hand.value) || hand.source !== 'user-declared') fail('invalid-hand', 'hand { value: left|right, source: user-declared }');
  if (!['left', 'right', 'unknown'].includes(fs.dominantHand)) fail('invalid-dominant-hand', 'left | right | unknown');
  const fr = fs.frame;
  if (!isObj(fr) || typeof fr.available !== 'boolean' || !(fr.palmFacing === null || typeof fr.palmFacing === 'boolean') || !isNum(fr.rotationDeg) || Math.abs(fr.rotationDeg) > 180) fail('invalid-frame', 'frame { available, palmFacing, rotationDeg }');
  if (!fr.available && fr.palmFacing !== null) fail('invalid-frame', 'palmFacing must be null when no frame is available');
  validQuality(fr);
  validMeasurements(fs.measurements);
  validLines(fs.lines, fr.available);
  validMarks(fs.marks);
  validProvenanceIndex(fs);
}

/** Full result: { features, declined, notMapped }. This is the integration and audit contract. */
export function adaptFeatureSet(featureSet, synthetic) {
  try {
    return adaptUnsafe(featureSet, synthetic);
  } catch (e) {
    if (e instanceof AdapterError) throw e;
    throw new AdapterError('invalid-input', 'the record could not be read safely');
  }
}

function adaptUnsafe(featureSet, synthetic) {
  if (!isObj(synthetic) || synthetic.synthetic !== true) fail('synthetic-required', 'pass { synthetic: true, scanConfidence } explicitly; real input is not authorised');
  if (!num01(synthetic.scanConfidence)) fail('invalid-scan-confidence', 'synthetic.scanConfidence must be in [0, 1] (declared, never calibrated)');
  validateRecord(featureSet);
  const fs = featureSet, fr = fs.frame;

  const items = [];
  for (const line of LINE_IDS) {
    const f = fs.lines[line];
    if (f.provenance !== 'user-confirmed') continue; // S2: omitted, never inferred
    items.push({
      id: `trace-${line}`,
      geometry: { points: f.palmPoints.map((p) => ({ x: p.x, y: p.y })) },
      continuity: { gapsBridged: null, breaks: null }, // a trace observes no breaks
      branches: [], // NOTE (INC-7): the frozen engine reads [] as "zero branches" (quiet variants), not "unobserved"
      detection: { confidence: TENTATIVE_CAP, confidenceBasis: 'synthetic-declared' }, // S4
      identity: { anatomicalClass: LINE_TO_CLASS[line], classConfidence: 1, classSource: 'user-confirmed' },
    });
  }

  const notMapped = [];
  for (const id of MEASUREMENT_IDS) if (fs.measurements.measurements[id].status !== 'unavailable') notMapped.push({ feature: `measurement:${id}`, reason: 'engine-has-no-hand-measurement-input' });
  for (const id of MARK_IDS) if (fs.marks[id].provenance === 'user-reported') notMapped.push({ feature: `mark:${id}`, reason: 'engine-has-no-mark-input' });

  const features = {
    schema: FEATURE_SCHEMA_ID, schemaVersion: FEATURE_SCHEMA_VERSION, synthetic: true,
    capture: {
      handedness: { value: fs.hand.value, source: 'user-declared' },
      dominantHand: fs.dominantHand,
      orientation: { rotationDeg: fr.rotationDeg, palmFacing: fr.palmFacing },
      quality: { status: fr.qualityStatus, issues: [...fr.qualityIssues] },
    },
    landmarks: fr.available ? { present: true, source: { detector: 'synthetic-fixture', version: '0.1.0' } } : { present: false },
    creases: { source: { detector: 'synthetic-fixture', version: '0.1.0' }, coordinateFrame: COORDINATE_FRAME, items, expectedButMissing: [], conflicts: [] },
    scanConfidence: { value: synthetic.scanConfidence, basis: 'synthetic-declared' },
  };
  // `declined` stays in the contract: geometry problems are now rejected upstream (feature set) or as AdapterError,
  // so a valid record yields an empty list; it is kept so callers never have to special-case its absence.
  return { features: JSON.parse(JSON.stringify(features)), declined: [], notMapped };
}
