// AURA-PALM-G6-D0 — Palm feature contract `aura.palm.features` v0.1.0 (SYNTHETIC PROTOTYPE ONLY).
// Pure module: no I/O, no network, no globals, no randomness.
// Authored by Claude (AI) for Aura under G6-D0. Not production code. Not on any production import path.
// R1 (AURA-PALM-G6-D0-R1): safe identifier validation (R1-F1), prototype-safe registries (R1-F2),
// gapsBridged/break semantics (R1-F3) and the enforced point-order contract (R1-F5).

export const FEATURE_SCHEMA_ID = 'aura.palm.features';
export const FEATURE_SCHEMA_VERSION = '0.1.0';
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze(['0.1.0']);
/** Validation-rule revision for schema 0.1.0. R1 tightens identifier, registry, continuity and geometry checks. */
export const VALIDATOR_REVISION = '0.1.0-r1.3';

/**
 * R1-F2: every lookup table keyed by external strings is a frozen null-prototype object and is read only
 * through ownLookup(), so inherited names (`__proto__`, `constructor`, `toString`, ...) can never resolve.
 */
export const safeTable = (entries) => Object.freeze(Object.assign(Object.create(null), entries));
export const ownLookup = (table, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

/** Anatomical crease classes (from G4-B accuracy criteria / B2A annotation schema). Never palmistry names. */
export const ANATOMICAL_CLASSES = Object.freeze(['DTC', 'PTC', 'TC', 'MINOR', 'unclassified']);
export const MAJOR_CLASSES = Object.freeze(['DTC', 'PTC', 'TC']);

/** How a crease's anatomical class was established. */
export const CLASS_SOURCES = Object.freeze(['synthetic-declared', 'user-confirmed', 'classifier', 'none']);
export const CONFIDENCE_BASES = Object.freeze(['synthetic-declared', 'uncalibrated-detector-score', 'calibrated']);

/** Quality feedback codes mirror G5-I1 `PalmFeedbackCode` (types.ts snapshot in baseline/). */
export const QUALITY_ISSUES = Object.freeze([
  'palm-not-visible', 'hand-cut-off', 'hand-too-small', 'hand-rotated',
  'too-dark', 'too-bright', 'low-contrast', 'blurry',
]);
export const QUALITY_STATUSES = Object.freeze(['accepted', 'needs-retake', 'no-hand', 'multiple-hands', 'unknown']);

/**
 * Detector registry. Every crease source must be listed here; unknown detectors are rejected.
 * capabilities.classifiesCreases === false means that detector CANNOT emit anatomical classes:
 * any `classSource: 'classifier'` claim from it is rejected (no invented capabilities).
 */
export const DETECTOR_REGISTRY = safeTable({
  'synthetic-fixture': Object.freeze({
    versions: Object.freeze(['0.1.0']), status: 'synthetic',
    capabilities: Object.freeze({ emitsPolylines: true, classifiesCreases: false, calibratedConfidence: false, observesBreaks: true }),
    note: 'Hand-constructed G6-D0 test fixtures. Class labels and break counts are declared by the fixture author (stand-ins for a future validated source).',
  }),
  'creases-directional-d1': Object.freeze({
    versions: Object.freeze(['frozen-d1']), status: 'research-experimental',
    capabilities: Object.freeze({ emitsPolylines: true, classifiesCreases: false, calibratedConfidence: false, observesBreaks: false }),
    note: 'G4-D1 frozen. Emits up to 6 unlabelled polylines {points, score, lengthPx, symmetry, gapsBridged}. D2-A FAIL. Real-image accuracy INCONCLUSIVE (0 images).',
  }),
  'creases-directional-d3b': Object.freeze({
    versions: Object.freeze(['D3B-C']), status: 'research-experimental',
    capabilities: Object.freeze({ emitsPolylines: true, classifiesCreases: false, calibratedConfidence: false, observesBreaks: false }),
    note: 'G4-D3-B frozen candidate. Same output shape as D1. D2-A CONDITIONAL PASS (design-exposed). Not held-out validated.',
  }),
});

/** Landmark sources. Landmarks define the coordinate frame only; they are never crease observations. */
export const LANDMARK_REGISTRY = safeTable({
  'mediapipe-hands': Object.freeze({ versions: Object.freeze(['1.2.0']) }),
  'synthetic-fixture': Object.freeze({ versions: Object.freeze(['0.1.0']) }),
});
const LANDMARK_ONLY_SOURCES = Object.freeze(['mediapipe-hands']);
/** MediaPipe landmark names; a crease id that looks like one is rejected to keep the two concepts apart. */
const LANDMARK_NAME_PATTERN = /^(wrist|thumb_|index_|middle_|ring_|pinky_|lm\d+$)/i;

/** palm-normalized-v1: x = 0 radial (thumb) edge → 1 ulnar edge (handedness-mirrored); y = 0 at finger base → wrist; unit = palm width. */
export const COORDINATE_FRAME = 'palm-normalized-v1';
export const FRAME_BOUNDS = Object.freeze({ xMin: -0.2, xMax: 1.2, yMin: -0.2, yMax: 1.6 });
export const MAX_POINTS = 64;
export const MAX_CREASES = 12;
/**
 * R1.2 (R1.1-RV-03): at most this many validation errors are LISTED in an invalid-input reading. Every error is still
 * counted (`errorCount`), validity is decided on the full count, and a final `errors-truncated` entry states how many
 * were omitted. 50 is the bound the R1.1 reviewer proposed; it is above the largest error set any single malformed
 * crease or capture block can produce (≈ 10) and keeps a worst-case reading to a few kilobytes.
 */
export const MAX_REPORTED_ERRORS = 50;

/** R1-F1: crease identifiers are opaque tokens. Pattern-checked before any other use; never linted as text. */
export const CREASE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
/** Names that collide with JavaScript object internals are reserved and rejected even though they match the pattern. */
export const RESERVED_IDS = Object.freeze([...new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype', 'constructor', '__proto__'])].map((n) => n.toLowerCase()));
export const isValidCreaseId = (id) => typeof id === 'string' && CREASE_ID_PATTERN.test(id) && !RESERVED_IDS.includes(id.toLowerCase());

/**
 * R1-F5 point-order contract (see R1_POINT_ORDER_CONTRACT.md):
 *  - `geometry.points` is an ORDERED polyline. Either direction is accepted; the engine canonicalises by whole reversal only.
 *  - Consecutive exact duplicates are collapsed; any other repeated point (revisit, closed loop) is rejected.
 *  - Polylines that self-intersect, double back (turn > MAX_TURN_DEG between consecutive segments) or wander
 *    (path length > MAX_TORTUOSITY × chord) are rejected as unordered/implausible: they cannot be measured safely.
 *  - Endpoints closer than ENDPOINT_TIE_TOLERANCE on an axis make that axis's endpoint roles ambiguous; dependent
 *    descriptors become null and dependent rules decline. The engine never guesses an anatomical direction.
 */
export const GEOMETRY_CONTRACT = Object.freeze({ minLength: 0.02, maxTurnDeg: 120, maxTortuosity: 2.0, endpointTieTolerance: 0.01, centralMaxVerticalDeviationDeg: 30, eps: 1e-9 });

/**
 * R1.1 (R1-RV-01, R1-RV-03): ONE comparison rule for every geometric limit. Each limit is INCLUSIVE on its "allowed"
 * side, and values within GEOMETRY_CONTRACT.eps (1e-9, far below any measurement resolution) of a limit count as ON
 * the limit, so a nominal 0.01 / 30° / 0.02 / 120° / 2.0 classifies the same way however IEEE-754 represents it.
 *   atMost(v, L)  ⇔ v ≤ L (within eps)       e.g. endpoints ambiguous when Δ ≤ 0.01; vertical when deviation ≤ 30°
 *   below(v, L)   ⇔ v < L (beyond eps)       e.g. degenerate when length < 0.02
 *   above(v, L)   ⇔ v > L (beyond eps)       e.g. doubles back when turn > 120°; tortuous when ratio > 2.0
 * Classification always uses unrounded values; 4-dp rounding is for trace display only.
 */
const EPS = 1e-9;
export const atMost = (v, limit) => v <= limit + EPS;
export const below = (v, limit) => v < limit - EPS;
export const above = (v, limit) => v > limit + EPS;
const ORDER_METADATA_KEYS = Object.freeze(['order', 'pointOrder', 'direction', 'closed', 'reversed']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isUnit = (v) => isNum(v) && v >= 0 && v <= 1;

/**
 * Validate a feature object. Returns { ok, errors[], warnings[] }. Never mutates or repairs input,
 * never fills missing fields with defaults (no fabrication).
 */
export function validateFeatures(input) {
  const errors = [];
  const warnings = [];
  const err = (path, code, msg) => errors.push({ path, code, msg });

  if (!isObj(input)) { err('$', 'not-object', 'Feature payload must be an object.'); return { ok: false, errors, warnings }; }
  if (input.schema !== FEATURE_SCHEMA_ID) err('schema', 'wrong-schema', `Expected "${FEATURE_SCHEMA_ID}".`);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(input.schemaVersion)) err('schemaVersion', 'unsupported-version', `Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`);
  // G6-D0 authorises synthetic inputs only.
  if (input.synthetic !== true) err('synthetic', 'synthetic-required', 'G6-D0 accepts synthetic feature objects only (synthetic: true).');

  // capture
  const cap = input.capture;
  if (!isObj(cap)) err('capture', 'missing', 'capture is required.');
  else {
    const h = cap.handedness;
    if (!isObj(h)) err('capture.handedness', 'missing', 'handedness is required (value may be "unknown").');
    else {
      if (!['left', 'right', 'unknown'].includes(h.value)) err('capture.handedness.value', 'invalid', 'left | right | unknown.');
      if (!['user-declared', 'landmark-model', 'unknown'].includes(h.source)) err('capture.handedness.source', 'invalid', 'user-declared | landmark-model | unknown.');
      if (h.value !== 'unknown' && h.source === 'unknown') err('capture.handedness', 'inconsistent', 'A known handedness needs a source.');
    }
    if (!['left', 'right', 'unknown'].includes(cap.dominantHand)) err('capture.dominantHand', 'invalid', 'left | right | unknown (user-declared only).');
    const o = cap.orientation;
    if (!isObj(o)) err('capture.orientation', 'missing', 'orientation is required.');
    else {
      if (!isNum(o.rotationDeg) || Math.abs(o.rotationDeg) > 180) err('capture.orientation.rotationDeg', 'invalid', 'Finite number in [-180, 180].');
      if (!(o.palmFacing === true || o.palmFacing === false || o.palmFacing === null)) err('capture.orientation.palmFacing', 'invalid', 'boolean or null.');
    }
    const q = cap.quality;
    if (!isObj(q)) err('capture.quality', 'missing', 'quality is required.');
    else {
      if (!QUALITY_STATUSES.includes(q.status)) err('capture.quality.status', 'invalid', QUALITY_STATUSES.join(' | '));
      if (!Array.isArray(q.issues) || q.issues.some((i) => !QUALITY_ISSUES.includes(i))) err('capture.quality.issues', 'invalid', 'Array of G5-I1 PalmFeedbackCode values.');
    }
  }

  // landmarks: frame reference only
  const lm = input.landmarks;
  if (!isObj(lm)) err('landmarks', 'missing', 'landmarks block is required (present may be false).');
  else {
    if (typeof lm.present !== 'boolean') err('landmarks.present', 'invalid', 'boolean.');
    if (lm.present) {
      const reg = isObj(lm.source) ? ownLookup(LANDMARK_REGISTRY, lm.source.detector) : undefined;
      if (!reg) err('landmarks.source.detector', 'unknown-landmark-detector', 'Unregistered landmark source.');
      else if (!reg.versions.includes(lm.source.version)) err('landmarks.source.version', 'unknown-landmark-version', 'Unregistered landmark detector version.');
    }
    for (const k of ['items', 'lines', 'creases']) if (Object.prototype.hasOwnProperty.call(lm, k)) err(`landmarks.${k}`, 'landmark-crease-conflation', 'Landmarks carry no line/crease data. Hand landmarks are not palm creases.');
  }

  // creases
  const cr = input.creases;
  if (!isObj(cr)) err('creases', 'missing', 'creases block is required.');
  else {
    const det = isObj(cr.source) ? cr.source.detector : undefined;
    if (LANDMARK_ONLY_SOURCES.includes(det)) err('creases.source.detector', 'landmark-crease-conflation', 'A landmark model is not a crease detector.');
    const reg = ownLookup(DETECTOR_REGISTRY, det);
    if (!reg) { if (!LANDMARK_ONLY_SOURCES.includes(det)) err('creases.source.detector', 'unknown-detector', 'Unregistered crease detector.'); }
    else if (!reg.versions.includes(cr.source.version)) err('creases.source.version', 'unknown-detector-version', `Registered versions: ${reg.versions.join(', ')}.`);
    if (cr.coordinateFrame !== COORDINATE_FRAME) err('creases.coordinateFrame', 'invalid', `Must be "${COORDINATE_FRAME}".`);
    if (!Array.isArray(cr.items)) err('creases.items', 'missing', 'items array is required (may be empty).');
    else {
      if (cr.items.length > MAX_CREASES) err('creases.items', 'too-many', `At most ${MAX_CREASES}.`);
      const ids = new Set();
      cr.items.forEach((c, i) => validateCrease(c, `creases.items[${i}]`, reg, ids, err, warnings));
    }
    if (!Array.isArray(cr.expectedButMissing) || cr.expectedButMissing.some((m) => !MAJOR_CLASSES.includes(m))) err('creases.expectedButMissing', 'invalid', 'Array of DTC | PTC | TC (may be empty).');
    if (!Array.isArray(cr.conflicts)) err('creases.conflicts', 'invalid', 'Array (may be empty).');
    else cr.conflicts.forEach((c, i) => {
      if (!isObj(c) || !Array.isArray(c.ids) || c.ids.length < 1 || c.ids.length > MAX_CREASES || !c.ids.every(isValidCreaseId) || !['class-collision', 'overlap', 'crossing-ambiguity', 'other'].includes(c.kind)) err(`creases.conflicts[${i}]`, 'invalid', '{ ids[] (valid crease ids), kind }');
    });
  }

  const sc = input.scanConfidence;
  if (!isObj(sc) || !isUnit(sc.value) || !CONFIDENCE_BASES.includes(sc.basis)) err('scanConfidence', 'invalid', '{ value ∈ [0,1], basis }');

  return { ok: errors.length === 0, errors, warnings };
}

function validateCrease(c, p, reg, ids, err, warnings) {
  if (!isObj(c)) { err(p, 'not-object', 'Crease must be an object.'); return; }
  if (typeof c.id !== 'string' || !CREASE_ID_PATTERN.test(c.id)) err(`${p}.id`, 'invalid', 'Crease id must be 1-32 ASCII letters, digits, "-" or "_", starting with a letter or digit.');
  else if (RESERVED_IDS.includes(c.id.toLowerCase())) err(`${p}.id`, 'reserved-id', 'This crease id is reserved.');
  else {
    if (ids.has(c.id)) err(`${p}.id`, 'duplicate', 'Crease ids must be unique.');
    ids.add(c.id);
    if (LANDMARK_NAME_PATTERN.test(c.id)) err(`${p}.id`, 'landmark-crease-conflation', 'Crease ids must not reuse hand-landmark names.');
  }
  const g = c.geometry;
  if (!isObj(g) || !Array.isArray(g.points)) err(`${p}.geometry.points`, 'missing', 'points array required.');
  else {
    if (g.points.length < 2) err(`${p}.geometry.points`, 'invalid-geometry', 'At least 2 points.');
    if (g.points.length > MAX_POINTS) err(`${p}.geometry.points`, 'invalid-geometry', `At most ${MAX_POINTS} points.`);
    let bad = false;
    for (const pt of g.points) {
      if (!isObj(pt) || !isNum(pt.x) || !isNum(pt.y) || pt.x < FRAME_BOUNDS.xMin || pt.x > FRAME_BOUNDS.xMax || pt.y < FRAME_BOUNDS.yMin || pt.y > FRAME_BOUNDS.yMax) { bad = true; break; }
    }
    if (bad) err(`${p}.geometry.points`, 'invalid-geometry', 'Every point needs finite x,y inside the palm-normalized frame bounds.');
    else if (g.points.length >= 2 && g.points.length <= MAX_POINTS) {
      const problem = polylineProblem(g.points);
      if (problem) err(`${p}.geometry.points`, 'invalid-geometry', GEOMETRY_PROBLEM_TEXT[problem]);
    }
    // Derived descriptors are computed by the engine; declared ones are not trusted and must not be supplied.
    for (const k of ['lengthNorm', 'curvature', 'orientationDeg', 'centroid']) if (Object.prototype.hasOwnProperty.call(g, k)) err(`${p}.geometry.${k}`, 'declared-descriptor', 'Descriptors are derived from points by the engine; do not declare them.');
    // R1-F5: point order is derived from the polyline itself; declared ordering metadata could conflict with it.
    for (const k of ORDER_METADATA_KEYS) if (Object.prototype.hasOwnProperty.call(g, k)) err(`${p}.geometry.${k}`, 'declared-descriptor', 'Point order is derived from the ordered points; do not declare it.');
  }
  // R1-F3: `gapsBridged` is detector PREPROCESSING metadata (gaps the tracker bridged because it judged the crease
  // to continue). It is optional, never an observation, and never read by any rule. `breaks` is an observed-break
  // count and is accepted only from a source whose registry entry declares `observesBreaks`; absent/null = not observed.
  const ct = c.continuity;
  const optCount = (v) => v === undefined || v === null || (Number.isInteger(v) && v >= 0 && v <= 1000);
  if (!isObj(ct) || !optCount(ct.gapsBridged) || !optCount(ct.breaks)) err(`${p}.continuity`, 'invalid', '{ gapsBridged?, breaks? }: optional non-negative integers (null = not observed).');
  else if (reg && !reg.capabilities.observesBreaks && Number.isInteger(ct.breaks) && ct.breaks > 0) err(`${p}.continuity.breaks`, 'unsupported-capability', 'This detector does not observe crease breaks; gapsBridged is not a break count.');
  if (!Array.isArray(c.branches) || c.branches.some((b) => !isObj(b) || !isUnit(b.atT) || !['distal', 'proximal'].includes(b.direction) || !isNum(b.lengthNorm) || b.lengthNorm <= 0)) err(`${p}.branches`, 'invalid', 'Array of { atT ∈ [0,1], direction: distal|proximal, lengthNorm > 0 }.');
  const d = c.detection;
  if (!isObj(d) || !isUnit(d.confidence) || !CONFIDENCE_BASES.includes(d.confidenceBasis)) err(`${p}.detection`, 'invalid', '{ confidence ∈ [0,1], confidenceBasis }');
  else if (reg && d.confidenceBasis === 'calibrated' && !reg.capabilities.calibratedConfidence) err(`${p}.detection.confidenceBasis`, 'unsupported-capability', 'This detector has no calibrated confidence.');
  const id = c.identity;
  if (!isObj(id) || !ANATOMICAL_CLASSES.includes(id.anatomicalClass) || !isUnit(id.classConfidence) || !CLASS_SOURCES.includes(id.classSource)) err(`${p}.identity`, 'invalid', '{ anatomicalClass, classConfidence ∈ [0,1], classSource }');
  else {
    if (id.classSource === 'classifier' && reg && !reg.capabilities.classifiesCreases) err(`${p}.identity.classSource`, 'unsupported-capability', 'No registered crease classifier exists; this detector emits unlabelled polylines only.');
    if (id.classSource === 'synthetic-declared' && reg && reg.status !== 'synthetic') err(`${p}.identity.classSource`, 'unsupported-capability', 'Only synthetic fixtures may declare classes.');
    if (id.anatomicalClass === 'unclassified' && id.classSource !== 'none') err(`${p}.identity`, 'inconsistent', 'unclassified requires classSource "none".');
    if (id.anatomicalClass !== 'unclassified' && id.classSource === 'none') err(`${p}.identity`, 'inconsistent', 'A class needs a classSource.');
    if (id.alternatives !== undefined && (!Array.isArray(id.alternatives) || id.alternatives.some((a) => !isObj(a) || !ANATOMICAL_CLASSES.includes(a.anatomicalClass) || !isUnit(a.classConfidence)))) err(`${p}.identity.alternatives`, 'invalid', 'Array of { anatomicalClass, classConfidence }.');
  }
}

// ---------- R1-F5 polyline plausibility ----------

const GEOMETRY_PROBLEM_TEXT = Object.freeze({
  'too-few-distinct-points': 'At least 2 distinct points are required.',
  'repeated-point': 'A point is repeated out of sequence (closed or revisiting polyline); points must be an ordered, open polyline.',
  degenerate: 'Degenerate polyline (length < 0.02 palm widths).',
  'doubles-back': 'The polyline doubles back on itself; points must be supplied in order along the crease.',
  'self-intersecting': 'The polyline crosses itself; points must be supplied in order along the crease.',
  tortuous: 'The polyline is far longer than its end-to-end span; points must be supplied in order along the crease.',
});

/** Collapse consecutive exact duplicates (the only order repair the contract allows). */
export function collapseDuplicates(points) {
  const out = [];
  for (const p of points) { const q = out[out.length - 1]; if (!q || q.x !== p.x || q.y !== p.y) out.push(p); }
  return out;
}

/**
 * R1.2 (R1.1-RV-01): canonical point sequence. A polyline and its reversal describe the same crease, so every
 * order-sensitive computation (floating-point sums for length and centroid, segment tests) runs on ONE of the two
 * sequences, chosen deterministically: the lexicographically smaller sequence, comparing points pairwise by (x, y).
 * A palindromic sequence equals its reversal, so either choice is the same. This is a pure re-indexing: it never
 * moves, adds, removes or rounds a point, and it does not change what the geometry means.
 */
export function canonicalSequence(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[n - 1 - i];
    if (a.x !== b.x) return a.x < b.x ? points : [...points].reverse();
    if (a.y !== b.y) return a.y < b.y ? points : [...points].reverse();
  }
  return points;
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const onSeg = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
function segmentsTouch(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSeg(p3, p1, p4)) || (d2 === 0 && onSeg(p3, p2, p4)) || (d3 === 0 && onSeg(p1, p3, p2)) || (d4 === 0 && onSeg(p1, p4, p2));
}

/** Returns null for a measurable ordered polyline, else a problem code. Pure and deterministic. */
export function polylineProblem(points) {
  // R1.3 (R1.2-RV-03, owner-approved conservative validity): a polyline is valid only if it is valid in BOTH point
  // orders. Both orders are evaluated (canonical first, then its reversal) and the first problem found is returned, so
  // the verdict and the reported code are identical whichever order was supplied.
  const c = canonicalSequence(collapseDuplicates(points));
  return problemInOrder(c) ?? problemInOrder([...c].reverse());
}

function problemInOrder(pts) {
  if (pts.length < 2) return 'too-few-distinct-points';
  const seen = new Set();
  for (const p of pts) { const k = `${p.x},${p.y}`; if (seen.has(k)) return 'repeated-point'; seen.add(k); }
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (below(len, GEOMETRY_CONTRACT.minLength)) return 'degenerate';
  for (let i = 1; i + 1 < pts.length; i++) {
    const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y, bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))));
    if (above((Math.acos(cos) * 180) / Math.PI, GEOMETRY_CONTRACT.maxTurnDeg)) return 'doubles-back';
  }
  for (let i = 0; i + 1 < pts.length; i++) for (let j = i + 2; j + 1 < pts.length; j++) if (segmentsTouch(pts[i], pts[i + 1], pts[j], pts[j + 1])) return 'self-intersecting';
  const chord = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
  if (above(len / chord, GEOMETRY_CONTRACT.maxTortuosity)) return 'tortuous';
  return null;
}
