// AURA-PALM-03-I1 — user-assisted feature-set → engine adapter (TEST-ONLY; synthetic data only; not imported by any app).
//
// adaptFeatureSet(featureSet, synthetic) validates a COMPLETE apps/web `PalmFeatureSet` record
// (palm-03-i1-feature-set@0.1.0) against the contract below and only then maps it onto the frozen engine's contract
// `aura.palm.features` v0.1.0. The engine (prototype/src) is NOT modified and keeps its identity and its synthetic-only
// restriction; this adapter only reads its published constants and polyline rules.
//
// The FULL result { features, declined, notMapped } is the integration and audit contract (review L1).
//
// ---------------------------------------------------------------------------------------------------------------
// VALIDATION CONTRACT (v0.5.0). Authoritative basis: measureHand() (measurements.ts) and buildPalmFeatureSet()
// (features.ts). Every rule below is something those builders always produce; anything else is a malformed or
// contradictory record and is rejected with a typed AdapterError BEFORE any engine payload is built. Nothing is repaired.
//
// C1 Plain data. Plain-prototype objects and arrays only; arrays are dense and carry no named properties; no
//    accessors or symbols; finite numbers; every record has exactly its own fields (KEYS); every enum field is a
//    string from its list (an array or other type is never coerced).
// C2 Frame. reason 'ok' ⇔ available. palmFacing null when unavailable. qualityIssues: distinct known G5 codes.
//    qualityStatus: accepted ⇔ no issues, needs-retake ⇔ ≥ 1 issue, unknown ⇔ no issues (no feedback supplied).
// C3 Measurement set (S) is a pure function of the frame (F) up to two geometry-only facts:
//    S unavailable: reasons are exactly ONE of
//      [F.reason]                 when F.reason ∈ {image-size-invalid, landmarks-invalid, landmark-out-of-frame}
//                                 (and conversely those frame reasons always produce it);
//      BLOCKING ∩ F.issues        (ordered, non-empty) when F has blocking issues and F.reason ∈ {ok, frame-degenerate}
//                                 (and conversely: blocking issues always produce it unless the line above applies);
//      ['frame-degenerate']       no blocking issues and F.reason === 'frame-degenerate' (both builders share ONE
//                                 geometry, palmGeometry() in measurements.ts, so they always agree)  [geometry];
//      ['palm-not-facing']        no blocking issues, F available and F.palmFacing === false
//                                 (and conversely: palmFacing false never leaves S usable).
//    S usable (measured/uncertain): F available, no blocking issue, palmFacing ≠ false, and reasons EXACTLY
//      (DEGRADING ∩ F.issues, in order) + ['quality-unknown' iff F unknown] + ['palm-facing-unknown' iff palmFacing null]
//      + ['implausible-proportions'] as decided from the serialized palmLength v (raw thresholds 0.7 / 1.8, strict):
//        v < 0.700 or v > 1.800 ⇒ present; 0.700 < v < 1.800 ⇒ absent; v = 0.700 or 1.800 ⇒ either (the raw value
//        may lie on either side of the threshold and only its rounding is recorded). status = uncertain iff non-empty.
//    (['computation-nonfinite'] at set level cannot arise under the input contract: coordinates in [0,1] and image
//    sides ≤ 100,000 px keep every geometry term finite. It is rejected.)
// C4 Measurement items under a usable S (reasons R):
//      palmLength:     R;
//      finger lengths: R, or ['finger-not-extended'] [geometry exception];
//      derived (handLength = palm + middle; middleToPalmRatio = middle / palm; indexToRingRatio = index / ring):
//        ['depends-on-unavailable'] ⇔ an operand is unavailable; otherwise R, except that indexToRingRatio may be
//        ['computation-nonfinite'] ONLY when ringLength is usable with serialized value 0 (a ring length below the
//        rounding step makes index / ring overflow; every other value is a bounded finite quotient or sum);
//        a usable derived value must agree with its rounded operands within the rounding bound.
//    Every usable value is on the serialization grid: exactly 3 decimals (round3(v) === v).
//    Reasons R ⇒ status from R (measured iff empty, else uncertain), finite value ≥ 0; any other reason ⇒
//    unavailable, value null. Under an unavailable S every item is unavailable with ['depends-on-unavailable'].
//    Unit is 'ratio' for *Ratio ids, else 'palm-width'.
// C5 Lines. Identity is exactly the expected 4-field identity. user-confirmed ⇔ confirmation 'confirmed', F available,
//    valid geometry (2..64 exact {x,y} points in bounds passing the engine polyline rules). unassessed ⇒ known reason
//    with its confirmation state; 'frame-unavailable' ⇔ F unavailable for a confirmed trace (never when F available);
//    trace-* reasons only when F available. [geometry exception: confirmed identity with unusable geometry is valid]
// C6 Marks. user-reported: placement null or an in-bounds {x,y}; a placement requires F available. unassessed: known
//    reason, no placement field.
// C7 Inventories and provenance. Exactly 9 measurements, 4 lines, 5 marks; the provenance index equals the one
//    derived from the records.
//
// Mapping rules (unchanged): S1 synthetic only ({ synthetic: true, scanConfidence } explicit); S2 only user-confirmed
// traces are mapped, unassessed lines are omitted and never "expected but missing"; S3 heart→DTC, head→PTC, life→TC,
// upward→MINOR (classSource user-confirmed); S4 detection confidence = TENTATIVE_CAP (0.74, owner decision 2);
// S5 'synthetic-fixture' source stand-in (INC-1); S6 geometry forwarded in order, never repaired; S7 usable
// measurements and reported marks are listed in notMapped.
// ---------------------------------------------------------------------------------------------------------------
import { FEATURE_SCHEMA_ID, FEATURE_SCHEMA_VERSION, COORDINATE_FRAME, FRAME_BOUNDS, MAX_POINTS, QUALITY_ISSUES, polylineProblem } from '../prototype/src/schema.mjs';
import { TENTATIVE_CAP } from '../prototype/src/policy.mjs';

export const FEATURE_SET_ADAPTER_VERSION = 'palm-03-i1-feature-set-adapter@0.5.0';
export const ACCEPTED_FEATURE_SET_VERSIONS = Object.freeze(['palm-03-i1-feature-set@0.1.0']);
export const ACCEPTED_MEASUREMENT_VERSIONS = Object.freeze(['palm-03-i1-hand-measurements@0.1.0']);
export const LINE_TO_CLASS = Object.freeze({ heart: 'DTC', head: 'PTC', life: 'TC', upward: 'MINOR' });
/** Complete expected line identities (must equal PALM_LINE_IDENTITY in features.ts; the root test checks for drift). */
export const EXPECTED_IDENTITY = Object.freeze({
  heart: Object.freeze({ anatomical: 'distal-transverse', western: 'heart line', indian: 'āyurlekhā (longevity line)', indianId: 'ayurlekha' }),
  head: Object.freeze({ anatomical: 'proximal-transverse', western: 'head line', indian: 'dhanamātṛlekhā (prosperity/mother line)', indianId: 'dhanamatrlekha' }),
  life: Object.freeze({ anatomical: 'thenar', western: 'life line', indian: 'pitṛlekhā (father/knowledge line)', indianId: 'pitrlekha' }),
  upward: Object.freeze({ anatomical: 'central-longitudinal', western: 'fate line', indian: 'ūrdhvarekhā (upward line)', indianId: 'urdhvarekha' }),
});
export const LINE_IDS = Object.freeze(['heart', 'head', 'life', 'upward']);
export const MARK_IDS = Object.freeze(['yava', 'matsya', 'shankha', 'chatra', 'vedi']);
export const MEASUREMENT_IDS = Object.freeze(['palmLength', 'thumbLength', 'indexLength', 'middleLength', 'ringLength', 'littleLength', 'handLength', 'middleToPalmRatio', 'indexToRingRatio']);
const FINGER_IDS = Object.freeze(['thumbLength', 'indexLength', 'middleLength', 'ringLength', 'littleLength']);
const DERIVED = Object.freeze({ handLength: ['palmLength', 'middleLength'], middleToPalmRatio: ['middleLength', 'palmLength'], indexToRingRatio: ['indexLength', 'ringLength'] });
const KEYS = Object.freeze({
  featureSet: ['version', 'hand', 'dominantHand', 'frame', 'measurements', 'lines', 'marks', 'provenance'],
  hand: ['value', 'source'],
  frame: ['available', 'reason', 'rotationDeg', 'palmFacing', 'qualityStatus', 'qualityIssues'],
  measurementSet: ['version', 'provenance', 'status', 'reasons', 'measurements'],
  measurement: ['id', 'value', 'unit', 'status', 'reasons'],
  lineConfirmed: ['line', 'provenance', 'confirmation', 'identity', 'palmPoints'],
  lineUnassessed: ['line', 'provenance', 'confirmation', 'identity', 'reason'],
  identity: ['anatomical', 'western', 'indian', 'indianId'],
  markReported: ['mark', 'provenance', 'approximatePalmLocation'],
  markUnassessed: ['mark', 'provenance', 'reason'],
  point: ['x', 'y'],
  provenance: ['automatic-measured', 'user-confirmed', 'user-reported', 'unassessed'],
});
const FRAME_REASONS = Object.freeze(['ok', 'landmarks-invalid', 'landmark-out-of-frame', 'image-size-invalid', 'frame-degenerate']);
const FRAME_INPUT_REASONS = Object.freeze(['image-size-invalid', 'landmarks-invalid', 'landmark-out-of-frame']);
const BLOCKING_QUALITY = Object.freeze(['palm-not-visible', 'hand-cut-off']);
const DEGRADING_QUALITY = Object.freeze(['hand-too-small', 'hand-rotated', 'too-dark', 'too-bright', 'low-contrast', 'blurry']);
const QUALITY_STATUSES = Object.freeze(['accepted', 'needs-retake', 'unknown']);
const MEASUREMENT_STATUSES = Object.freeze(['measured', 'uncertain', 'unavailable']);
const LINE_REASON_CONFIRMATION = Object.freeze({
  'not-requested': 'none', 'user-skipped': 'none', 'user-cannot-see': 'none', 'not-confirmed': 'pending',
  'frame-unavailable': 'confirmed', 'trace-too-few-points': 'confirmed', 'trace-too-many-points': 'confirmed',
  'trace-point-invalid': 'confirmed', 'trace-outside-image': 'confirmed', 'trace-outside-palm-frame': 'confirmed',
  'trace-too-few-distinct-points': 'confirmed', 'trace-repeated-point': 'confirmed', 'trace-too-short': 'confirmed',
  'trace-doubles-back': 'confirmed', 'trace-self-intersecting': 'confirmed', 'trace-tortuous': 'confirmed',
});
const MARK_UNASSESSED_REASONS = Object.freeze(['not-requested', 'user-skipped', 'location-invalid']);

export class AdapterError extends Error { constructor(code, message) { super(`feature-set-adapter: ${code}: ${message}`); this.code = code; } }
const fail = (code, msg) => { throw new AdapterError(code, msg); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num01 = (v) => isNum(v) && v >= 0 && v <= 1;
const oneOf = (v, list) => typeof v === 'string' && list.includes(v);
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const inBounds = (p) => p.x >= FRAME_BOUNDS.xMin && p.x <= FRAME_BOUNDS.xMax && p.y >= FRAME_BOUNDS.yMin && p.y <= FRAME_BOUNDS.yMax;
const sameKeys = (o, keys) => { const k = Object.getOwnPropertyNames(o); return k.length === keys.length && keys.every((x) => own(o, x)); };
const hasKeys = (o, keys, code, where) => { if (!isObj(o) || !sameKeys(o, keys)) fail(code, `${where} must have exactly the own fields ${keys.join(', ')}`); };
const strings = (a, code, where) => { if (!Array.isArray(a) || !a.every((x) => typeof x === 'string')) fail(code, `${where} must be an array of strings`); return a; };
const isPoint = (p) => isObj(p) && sameKeys(p, KEYS.point) && isNum(p.x) && isNum(p.y) && inBounds(p);

/** C1: deep plain-data check. Throws AdapterError. */
function assertPlain(v, where, depth = 0, seen = new Set()) {
  if (depth > 16) fail('invalid-input', `${where}: nesting too deep`);
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
  if (typeof v === 'number') { if (!Number.isFinite(v)) fail('invalid-input', `${where}: non-finite number`); return; }
  if (typeof v !== 'object') fail('invalid-input', `${where}: ${typeof v} is not plain data`);
  if (seen.has(v)) fail('invalid-input', `${where}: cycle or shared reference`);
  seen.add(v);
  const proto = Object.getPrototypeOf(v);
  if (Array.isArray(v) ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('invalid-input', `${where}: non-plain prototype (inherited fields are not accepted)`);
  if (Object.getOwnPropertySymbols(v).length) fail('invalid-input', `${where}: symbol keys`);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) if (!own(v, i)) fail('sparse-array', `${where}[${i}] is a hole`);
    if (Object.getOwnPropertyNames(v).length !== v.length + 1) fail('invalid-input', `${where}: array carries named properties`);
  }
  for (const k of Object.getOwnPropertyNames(v)) {
    if (Array.isArray(v) && k === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d)) fail('invalid-input', `${where}.${k}: accessor property`);
    assertPlain(d.value, `${where}.${k}`, depth + 1, seen);
  }
  seen.delete(v);
}

/** C2 */
function validFrame(fr) {
  hasKeys(fr, KEYS.frame, 'invalid-frame', 'frame');
  if (typeof fr.available !== 'boolean' || !oneOf(fr.reason, FRAME_REASONS) || (fr.reason === 'ok') !== fr.available) fail('invalid-frame', `frame.reason ${JSON.stringify(fr.reason)} must be 'ok' exactly when the frame is available`);
  if (!isNum(fr.rotationDeg) || Math.abs(fr.rotationDeg) > 180) fail('invalid-frame', 'frame.rotationDeg must be a number in [-180, 180]');
  if (!(fr.palmFacing === null || typeof fr.palmFacing === 'boolean') || (!fr.available && fr.palmFacing !== null)) fail('invalid-frame', 'frame.palmFacing must be boolean, or null (always null without a frame)');
  if (!Array.isArray(fr.qualityIssues) || !fr.qualityIssues.every((c) => oneOf(c, QUALITY_ISSUES)) || new Set(fr.qualityIssues).size !== fr.qualityIssues.length) fail('invalid-frame', 'frame.qualityIssues must be distinct known G5 codes');
  if (!oneOf(fr.qualityStatus, QUALITY_STATUSES)) fail('invalid-frame', 'frame.qualityStatus');
  const n = fr.qualityIssues.length;
  if (!((fr.qualityStatus === 'accepted' && n === 0) || (fr.qualityStatus === 'needs-retake' && n > 0) || (fr.qualityStatus === 'unknown' && n === 0))) fail('contradictory-quality', `qualityStatus ${fr.qualityStatus} with ${n} issue(s)`);
}

/** C3 + C4 */
function validMeasurements(ms, fr) {
  hasKeys(ms, KEYS.measurementSet, 'invalid-measurement', 'measurements');
  if (!oneOf(ms.version, ACCEPTED_MEASUREMENT_VERSIONS) || ms.provenance !== 'automatic-measured' || !oneOf(ms.status, MEASUREMENT_STATUSES)) fail('invalid-measurement', 'measurements { version, provenance: automatic-measured, status }');
  const R = strings(ms.reasons, 'invalid-measurement', 'measurements.reasons');
  if (!isObj(ms.measurements) || !sameKeys(ms.measurements, MEASUREMENT_IDS)) fail('incomplete-inventory', `measurements must list exactly ${MEASUREMENT_IDS.join(', ')}`);
  const items = ms.measurements;
  for (const id of MEASUREMENT_IDS) {
    const m = items[id];
    hasKeys(m, KEYS.measurement, 'invalid-measurement', `measurements.${id}`);
    if (m.id !== id || m.unit !== (id.endsWith('Ratio') ? 'ratio' : 'palm-width') || !oneOf(m.status, MEASUREMENT_STATUSES)) fail('invalid-measurement', `measurements.${id}: id, unit or status`);
    strings(m.reasons, 'invalid-measurement', `measurements.${id}.reasons`);
  }
  const bad = (msg) => fail('contradictory-quality', msg);
  const blocking = BLOCKING_QUALITY.filter((c) => fr.qualityIssues.includes(c));
  const one = (r) => R.length === 1 && R[0] === r;
  if (ms.status === 'unavailable') {
    // C3, unavailable forms (each with its frame precondition), and the converse implications.
    let ok = false;
    if (R.length === 1 && FRAME_INPUT_REASONS.includes(R[0])) ok = fr.reason === R[0];
    else if (R.length && R.every((r) => BLOCKING_QUALITY.includes(r))) ok = eq(R, blocking) && ['ok', 'frame-degenerate'].includes(fr.reason);
    else if (one('frame-degenerate')) ok = !blocking.length && fr.reason === 'frame-degenerate';
    else if (one('palm-not-facing')) ok = !blocking.length && fr.available && fr.palmFacing === false;
    if (!ok) bad(`measurement set unavailable with reasons ${JSON.stringify(R)} contradicts frame (reason ${fr.reason}, issues ${JSON.stringify(fr.qualityIssues)}, palmFacing ${fr.palmFacing})`);
    if (FRAME_INPUT_REASONS.includes(fr.reason) && !one(fr.reason)) bad(`frame reason ${fr.reason} requires measurement reasons ["${fr.reason}"]`);
    if (blocking.length && !FRAME_INPUT_REASONS.includes(fr.reason) && !eq(R, blocking)) bad(`blocking frame issues ${JSON.stringify(blocking)} require exactly those measurement reasons`);
    if (fr.reason === 'frame-degenerate' && !(eq(R, blocking) || one('frame-degenerate'))) bad('a degenerate frame requires a blocked or degenerate measurement set');
    for (const id of MEASUREMENT_IDS) {
      const m = items[id];
      if (m.status !== 'unavailable' || m.value !== null || !eq(m.reasons, ['depends-on-unavailable'])) fail('invalid-measurement', `measurements.${id}: must be unavailable (depends-on-unavailable) under an unavailable set`);
    }
    return;
  }
  // C3, usable set.
  if (!fr.available || blocking.length || fr.palmFacing === false) bad(`a usable measurement set contradicts the frame (available ${fr.available}, blocking ${JSON.stringify(blocking)}, palmFacing ${fr.palmFacing})`);
  const base = [...DEGRADING_QUALITY.filter((c) => fr.qualityIssues.includes(c)), ...(fr.qualityStatus === 'unknown' ? ['quality-unknown'] : []), ...(fr.palmFacing === null ? ['palm-facing-unknown'] : [])];
  if (!(eq(R, base) || eq(R, [...base, 'implausible-proportions']))) bad(`measurement reasons ${JSON.stringify(R)} must be ${JSON.stringify(base)} (+ implausible-proportions where applicable) for this frame`);
  if (ms.status !== (R.length ? 'uncertain' : 'measured')) fail('invalid-measurement', `measurement set status ${ms.status} with reasons ${JSON.stringify(R)}`);
  // Proportion diagnostic vs the serialized palm length (raw thresholds 0.7 / 1.8 are strict; 0.700 and 1.800 are
  // ambiguous after rounding and accept either).
  const pl = items.palmLength.value, flagged = R.includes('implausible-proportions');
  if (isNum(pl)) {
    const must = pl < 0.7 || pl > 1.8, mustNot = pl > 0.7 && pl < 1.8;
    if ((must && !flagged) || (mustNot && flagged)) fail('invalid-measurement', `palmLength ${pl} ${must ? 'requires' : 'forbids'} implausible-proportions`);
  }
  // C4, items.
  const usableReasons = (m) => eq(m.reasons, R);
  const onGrid = (v) => Math.round(v * 1000) / 1000 === v;
  const shape = (id, m) => {
    if (usableReasons(m)) {
      if (m.status !== (R.length ? 'uncertain' : 'measured') || !isNum(m.value) || m.value < 0) fail('invalid-measurement', `measurements.${id}: reasons ${JSON.stringify(m.reasons)} require status ${R.length ? 'uncertain' : 'measured'} and a finite value`);
      if (!onGrid(m.value)) fail('invalid-measurement', `measurements.${id}: value ${m.value} is not on the 3-decimal serialization grid`);
    } else if (m.status !== 'unavailable' || m.value !== null) fail('invalid-measurement', `measurements.${id}: reasons ${JSON.stringify(m.reasons)} require status unavailable and value null`);
  };
  for (const id of MEASUREMENT_IDS) {
    const m = items[id];
    let allowed = usableReasons(m);
    if (FINGER_IDS.includes(id)) allowed = allowed || eq(m.reasons, ['finger-not-extended']);
    if (eq(m.reasons, ['computation-nonfinite'])) {
      const ring = items.ringLength, index = items.indexLength;
      const legit = id === 'indexToRingRatio' && usableReasons(ring) && ring.value === 0 && usableReasons(index);
      if (!legit) fail('invalid-measurement', `measurements.${id}: computation-nonfinite is impossible here (finite operands; only index / ring with a ring length that rounds to 0 can overflow)`);
      allowed = true;
    }
    if (own(DERIVED, id)) {
      const opUnavailable = DERIVED[id].some((d) => items[d].status === 'unavailable');
      if (opUnavailable !== eq(m.reasons, ['depends-on-unavailable'])) fail('invalid-measurement', `measurements.${id}: depends-on-unavailable ⇔ an operand (${DERIVED[id].join(', ')}) is unavailable`);
      allowed = opUnavailable || allowed;
    }
    if (!allowed) bad(`measurements.${id}: reasons ${JSON.stringify(m.reasons)} are not consistent with the set reasons ${JSON.stringify(R)}`);
    shape(id, m);
  }
  // C4, derived values agree with their rounded operands (rounded to 3 dp: ±0.0005 each).
  const h = 0.0005, tol = 1e-9;
  for (const [id, [a, b]] of Object.entries(DERIVED)) {
    const m = items[id], A = items[a], B = items[b];
    if (m.status === 'unavailable' || A.status === 'unavailable' || B.status === 'unavailable') continue;
    let lo, hi;
    if (id === 'handLength') { lo = A.value + B.value - 2 * h; hi = A.value + B.value + 2 * h; }
    else { lo = Math.max(0, A.value - h) / (B.value + h); hi = B.value - h > 0 ? (A.value + h) / (B.value - h) : Infinity; }
    if (m.value < lo - h - tol || m.value > hi + h + tol) fail('invalid-measurement', `measurements.${id}: value ${m.value} disagrees with its operands ${a}=${A.value}, ${b}=${B.value}`);
  }
}

function validGeometry(points, where) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_POINTS) fail('invalid-line', `${where}: 2..${MAX_POINTS} points required`);
  if (!points.every(isPoint)) fail('invalid-line', `${where}: every point must be exactly { x, y }, finite and inside the palm-frame bounds`);
  const problem = polylineProblem(points.map((p) => ({ x: p.x, y: p.y })));
  if (problem) fail('invalid-line', `${where}: geometry ${problem}`);
}

/** C5 */
function validLines(lines, fr) {
  if (!isObj(lines) || !sameKeys(lines, LINE_IDS)) fail('incomplete-inventory', `lines must list exactly ${LINE_IDS.join(', ')}`);
  for (const id of LINE_IDS) {
    const l = lines[id];
    if (!isObj(l) || l.line !== id) fail('invalid-line', `lines.${id}`);
    if (l.provenance !== 'user-confirmed' && l.provenance !== 'unassessed') fail('invalid-provenance', `lines.${id}: provenance ${JSON.stringify(l.provenance)} is not valid for a line`);
    hasKeys(l, l.provenance === 'user-confirmed' ? KEYS.lineConfirmed : KEYS.lineUnassessed, 'invalid-line', `lines.${id}`);
    hasKeys(l.identity, KEYS.identity, 'invalid-line', `lines.${id}.identity`);
    if (KEYS.identity.some((k) => l.identity[k] !== EXPECTED_IDENTITY[id][k])) fail('invalid-line', `lines.${id}: identity must be exactly ${JSON.stringify(EXPECTED_IDENTITY[id])}`);
    if (l.provenance === 'user-confirmed') {
      if (l.confirmation !== 'confirmed') fail('invalid-line', `lines.${id}: user-confirmed requires confirmation 'confirmed'`);
      if (!fr.available) fail('invalid-line', `lines.${id}: placed geometry needs an available frame`);
      validGeometry(l.palmPoints, `lines.${id}.palmPoints`);
      continue;
    }
    if (typeof l.reason !== 'string' || !own(LINE_REASON_CONFIRMATION, l.reason)) fail('invalid-line', `lines.${id}: unknown unassessed reason ${JSON.stringify(l.reason)}`);
    if (l.confirmation !== LINE_REASON_CONFIRMATION[l.reason]) fail('invalid-line', `lines.${id}: reason ${l.reason} requires confirmation '${LINE_REASON_CONFIRMATION[l.reason]}'`);
    if (l.reason === 'frame-unavailable' && fr.available) fail('invalid-line', `lines.${id}: 'frame-unavailable' although the frame is available`);
    if (l.reason.startsWith('trace-') && !fr.available) fail('invalid-line', `lines.${id}: ${l.reason} although no frame was available to place a trace`);
  }
}

/** C6 */
function validMarks(marks, fr) {
  if (!isObj(marks) || !sameKeys(marks, MARK_IDS)) fail('incomplete-inventory', `marks must list exactly ${MARK_IDS.join(', ')}`);
  for (const id of MARK_IDS) {
    const m = marks[id];
    if (!isObj(m) || m.mark !== id) fail('invalid-mark', `marks.${id}`);
    if (m.provenance !== 'user-reported' && m.provenance !== 'unassessed') fail('invalid-provenance', `marks.${id}: provenance ${JSON.stringify(m.provenance)} is not valid for a mark`);
    hasKeys(m, m.provenance === 'user-reported' ? KEYS.markReported : KEYS.markUnassessed, 'invalid-mark', `marks.${id}`);
    if (m.provenance === 'user-reported') {
      const loc = m.approximatePalmLocation;
      if (!(loc === null || isPoint(loc))) fail('invalid-mark', `marks.${id}.approximatePalmLocation`);
      if (loc !== null && !fr.available) fail('invalid-mark', `marks.${id}: a placement requires an available frame`);
    } else if (!oneOf(m.reason, MARK_UNASSESSED_REASONS)) fail('invalid-mark', `marks.${id}: unknown reason ${JSON.stringify(m.reason)}`);
  }
}

/** C7 */
function validProvenanceIndex(fs) {
  hasKeys(fs.provenance, KEYS.provenance, 'invalid-provenance', 'provenance');
  const expected = Object.fromEntries(KEYS.provenance.map((g) => [g, []]));
  for (const id of MEASUREMENT_IDS) expected[fs.measurements.measurements[id].status === 'unavailable' ? 'unassessed' : 'automatic-measured'].push(`measurement:${id}`);
  for (const id of LINE_IDS) expected[fs.lines[id].provenance].push(`line:${id}`);
  for (const id of MARK_IDS) expected[fs.marks[id].provenance].push(`mark:${id}`);
  for (const g of KEYS.provenance) {
    const a = strings(fs.provenance[g], 'invalid-provenance', `provenance.${g}`);
    if (!eq([...a].sort(), [...expected[g]].sort())) fail('invalid-provenance', `provenance.${g} does not match the feature records`);
  }
}

function validateRecord(fs) {
  if (!isObj(fs)) fail('unsupported-feature-set', 'feature set must be an object');
  assertPlain(fs, 'featureSet');
  if (!oneOf(fs.version, ACCEPTED_FEATURE_SET_VERSIONS)) fail('unsupported-feature-set', `version ${JSON.stringify(fs.version)}`);
  hasKeys(fs, KEYS.featureSet, 'invalid-feature-set', 'featureSet');
  hasKeys(fs.hand, KEYS.hand, 'invalid-hand', 'hand');
  if (!oneOf(fs.hand.value, ['left', 'right']) || fs.hand.source !== 'user-declared') fail('invalid-hand', 'hand { value: left|right, source: user-declared }');
  if (!oneOf(fs.dominantHand, ['left', 'right', 'unknown'])) fail('invalid-dominant-hand', 'left | right | unknown');
  validFrame(fs.frame);
  validMeasurements(fs.measurements, fs.frame);
  validLines(fs.lines, fs.frame);
  validMarks(fs.marks, fs.frame);
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
