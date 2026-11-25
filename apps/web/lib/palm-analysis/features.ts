/**
 * AURA-PALM-03-I1 -- user-assisted palm feature representation.
 * DEVELOPMENT ONLY. Synthetic tests only. Not imported by any UI module, and
 * excluded from production builds with the rest of lib/palm-analysis.
 *
 * One structured record of everything a personalised reading may use, with
 * where each item came from:
 *   automatic-measured  hand proportions computed from landmarks (measurements.ts)
 *   user-confirmed      a palm line the user traced on their own photo and confirmed
 *   user-reported       a traditional mark the user says they see (no position checked)
 *   unassessed          skipped, not offered, unconfirmed, invalid, or no usable frame
 *
 * User confirmation establishes only WHICH line the user says they traced.
 * It does not establish that the trace is accurate, that any automatic
 * detection works, or that palm reading is valid. Nothing here detects lines or
 * marks automatically, and nothing infers them from landmarks.
 *
 * Coordinates
 *  - Traces arrive in normalised image coordinates ([0,1] per axis, the same
 *    convention as MediaPipe landmarks).
 *  - They are converted into the palm frame: origin at the index-finger
 *    knuckle (landmark 5), x towards the little-finger knuckle (landmark 17),
 *    y towards the wrist, unit = palm width. Because x follows the hand,
 *    left and right hands share one frame, and the frame does not change with
 *    image scale, position or rotation. This is the frame the reading engine
 *    expects (its palm-normalised frame); the engine-side adapter checks it.
 */
import type { PalmFeedbackCode } from './types';
import { LM, orientation } from './quality';
import { measureHand, palmGeometry, KNOWN_QUALITY_CODES, type HandMeasurementSet } from './measurements';

export const PALM_FEATURE_SET_VERSION = 'palm-03-i1-feature-set@0.1.0';

// ---------------------------------------------------------------- identities

export type PalmLineId = 'heart' | 'head' | 'life' | 'upward';
/** The three primary lines, always requested. */
export const PRIMARY_LINES: readonly PalmLineId[] = Object.freeze(['heart', 'head', 'life']);
/** Optional additional line(s) the engine can represent (as a hypothesis feature only). */
export const ADDITIONAL_LINES: readonly PalmLineId[] = Object.freeze(['upward']);
export const ALL_LINES: readonly PalmLineId[] = Object.freeze([...PRIMARY_LINES, ...ADDITIONAL_LINES]);

/**
 * A line's identity is anatomical (where it lies). Names differ by tradition
 * and the same position carries different meanings, so both are recorded.
 * Indian names and ids follow the approved educational guide content.
 */
export const PALM_LINE_IDENTITY: Readonly<Record<PalmLineId, Readonly<{ anatomical: string; western: string; indian: string; indianId: string }>>> = Object.freeze({
  heart: Object.freeze({ anatomical: 'distal-transverse', western: 'heart line', indian: 'āyurlekhā (longevity line)', indianId: 'ayurlekha' }),
  head: Object.freeze({ anatomical: 'proximal-transverse', western: 'head line', indian: 'dhanamātṛlekhā (prosperity/mother line)', indianId: 'dhanamatrlekha' }),
  life: Object.freeze({ anatomical: 'thenar', western: 'life line', indian: 'pitṛlekhā (father/knowledge line)', indianId: 'pitrlekha' }),
  upward: Object.freeze({ anatomical: 'central-longitudinal', western: 'fate line', indian: 'ūrdhvarekhā (upward line)', indianId: 'urdhvarekha' }),
});

/** Traditional marks from the approved guide. Only ever user-reported. */
export type PalmMarkId = 'yava' | 'matsya' | 'shankha' | 'chatra' | 'vedi';
export const ALL_MARKS: readonly PalmMarkId[] = Object.freeze(['yava', 'matsya', 'shankha', 'chatra', 'vedi']);

export type FeatureProvenance = 'automatic-measured' | 'user-confirmed' | 'user-reported' | 'unassessed';

// ---------------------------------------------------------------- inputs

export interface NormPoint { readonly x: number; readonly y: number }

export type LineInput =
  | { readonly line: PalmLineId; readonly action: 'traced'; readonly points: readonly NormPoint[]; readonly confirmed: boolean }
  | { readonly line: PalmLineId; readonly action: 'skipped'; readonly reason: 'user-skipped' | 'user-cannot-see' };

export type MarkInput =
  | { readonly mark: PalmMarkId; readonly action: 'reported'; readonly approximateLocation?: NormPoint }
  | { readonly mark: PalmMarkId; readonly action: 'skipped' };

export interface PalmFeatureSetInput {
  /** Which hand the user chose. Never overridden by the landmark model. */
  readonly hand: 'left' | 'right';
  readonly dominantHand: 'left' | 'right' | 'unknown';
  readonly landmarks: ReadonlyArray<{ x: number; y: number; z?: number }> | null | undefined;
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** G5 quality feedback for the same frame; null/undefined = quality unknown. */
  readonly qualityIssues: readonly PalmFeedbackCode[] | null | undefined;
  readonly rotationDeg: number;
  readonly handednessLabel?: string;
  readonly lines: readonly LineInput[];
  readonly marks: readonly MarkInput[];
}

// ---------------------------------------------------------------- output

export type LineUnassessedReason =
  | 'not-requested'
  | 'user-skipped'
  | 'user-cannot-see'
  | 'not-confirmed'
  | 'frame-unavailable'
  | 'trace-too-few-points'
  | 'trace-too-many-points'
  | 'trace-point-invalid'
  | 'trace-outside-image'
  | 'trace-outside-palm-frame'
  | 'trace-too-few-distinct-points'
  | 'trace-repeated-point'
  | 'trace-too-short'
  | 'trace-doubles-back'
  | 'trace-self-intersecting'
  | 'trace-tortuous';

export const LINE_UNASSESSED_REASONS: readonly LineUnassessedReason[] = Object.freeze([
  'not-requested', 'user-skipped', 'user-cannot-see', 'not-confirmed', 'frame-unavailable',
  'trace-too-few-points', 'trace-too-many-points', 'trace-point-invalid', 'trace-outside-image', 'trace-outside-palm-frame',
  'trace-too-few-distinct-points', 'trace-repeated-point', 'trace-too-short', 'trace-doubles-back', 'trace-self-intersecting', 'trace-tortuous',
]);

/**
 * Identity confirmation and geometry validity are separate facts.
 *  - user-confirmed: the user confirmed which line it is AND the recorded geometry is valid.
 *  - unassessed + confirmation 'confirmed': the user confirmed the identity, but no usable geometry exists
 *    (frame unavailable, or the trace failed a geometry check, see `reason`).
 *  - unassessed + 'pending': traced, not yet confirmed. 'none': skipped or never requested.
 */
export type LineFeature =
  | {
      readonly line: PalmLineId;
      readonly provenance: 'user-confirmed';
      readonly confirmation: 'confirmed';
      readonly identity: (typeof PALM_LINE_IDENTITY)[PalmLineId];
      /** Ordered polyline in the palm frame (palm-width units), as traced; rounded to 4 decimals and validated AFTER rounding. */
      readonly palmPoints: readonly NormPoint[];
    }
  | {
      readonly line: PalmLineId;
      readonly provenance: 'unassessed';
      readonly confirmation: 'none' | 'pending' | 'confirmed';
      readonly identity: (typeof PALM_LINE_IDENTITY)[PalmLineId];
      readonly reason: LineUnassessedReason;
    };

export type MarkFeature =
  | { readonly mark: PalmMarkId; readonly provenance: 'user-reported'; readonly approximatePalmLocation: NormPoint | null }
  | { readonly mark: PalmMarkId; readonly provenance: 'unassessed'; readonly reason: 'not-requested' | 'user-skipped' | 'location-invalid' };

export interface PalmFrameInfo {
  readonly available: boolean;
  readonly reason: 'ok' | 'landmarks-invalid' | 'landmark-out-of-frame' | 'image-size-invalid' | 'frame-degenerate';
  readonly rotationDeg: number;
  /** Existing G5 palm-facing test; null when it cannot be decided (no frame, or no Left/Right handedness label). */
  readonly palmFacing: boolean | null;
  /** 'unknown' when no same-frame quality feedback was supplied. 'accepted' iff there are no issues. */
  readonly qualityStatus: 'accepted' | 'needs-retake' | 'unknown';
  readonly qualityIssues: readonly PalmFeedbackCode[];
}

export interface PalmFeatureSet {
  readonly version: typeof PALM_FEATURE_SET_VERSION;
  readonly hand: { readonly value: 'left' | 'right'; readonly source: 'user-declared' };
  readonly dominantHand: 'left' | 'right' | 'unknown';
  readonly frame: PalmFrameInfo;
  readonly measurements: HandMeasurementSet;
  readonly lines: Readonly<Record<PalmLineId, LineFeature>>;
  readonly marks: Readonly<Record<PalmMarkId, MarkFeature>>;
  /** Every feature, grouped by provenance, for display and audit. */
  readonly provenance: Readonly<Record<FeatureProvenance, readonly string[]>>;
}

export type PalmFeatureSetResult =
  | { readonly ok: true; readonly featureSet: PalmFeatureSet }
  | { readonly ok: false; readonly errors: readonly string[] };

// ---------------------------------------------------------------- palm frame

/**
 * Trace limits. They mirror the reading engine's published geometry contract
 * (point limits, frame bounds, minimum length, maximum turn, maximum
 * tortuosity, eps) so that a recorded trace is one the engine can measure.
 * The root test cross-checks this port against the engine's own rules.
 */
export const TRACE_LIMITS = Object.freeze({
  minPoints: 2,
  maxPoints: 64,
  /** Minimum traced length, in palm widths. */
  minLength: 0.02,
  maxTurnDeg: 120,
  maxTortuosity: 2.0,
  eps: 1e-9,
  /** The engine's accepted palm-frame bounds; a trace beyond them is not a palm line. */
  bounds: Object.freeze({ xMin: -0.2, xMax: 1.2, yMin: -0.2, yMax: 1.6 }),
});

interface Frame { origin: NormPoint; ex: NormPoint; ey: NormPoint; widthPx: number; w: number; h: number }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const own = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
const round4 = (v: number) => Math.round(v * 10000) / 10000 + 0; // + 0 turns -0 into 0

/** Read a point-like value into a plain {x, y}; null unless both are finite numbers. */
function readPoint(p: unknown): NormPoint | null {
  if (p === null || typeof p !== 'object') return null;
  const x = (p as { x?: unknown }).x, y = (p as { y?: unknown }).y;
  return isNum(x) && isNum(y) ? { x, y } : null;
}

/** Dense copy of an array of points, or null if any index is a hole or not a finite point. */
function readPoints(a: unknown[]): NormPoint[] | null {
  const out: NormPoint[] = [];
  for (let k = 0; k < a.length; k++) {
    if (!own(a, k)) return null;
    const p = readPoint(a[k]);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/** Palm frame from landmarks 0 (wrist), 5 and 17, in pixel space. Same landmark contract as measurements.ts. */
export function palmFrameFromLandmarks(landmarks: PalmFeatureSetInput['landmarks'], w: number, h: number): { frame: Frame | null; reason: PalmFrameInfo['reason'] } {
  if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0 || w > 100000 || h > 100000) return { frame: null, reason: 'image-size-invalid' };
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return { frame: null, reason: 'landmarks-invalid' };
  const pts: NormPoint[] = [];
  for (let k = 0; k < 21; k++) {
    if (!own(landmarks, k)) return { frame: null, reason: 'landmarks-invalid' };
    const p = readPoint(landmarks[k]);
    const z = (landmarks[k] as { z?: unknown } | null)?.z;
    if (!p || (z !== undefined && !isNum(z))) return { frame: null, reason: 'landmarks-invalid' };
    pts.push(p);
  }
  if (pts.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return { frame: null, reason: 'landmark-out-of-frame' };
  const px = (k: number) => ({ x: pts[k].x * w, y: pts[k].y * h });
  const I = px(LM.INDEX_MCP), P = px(LM.PINKY_MCP);
  // One authoritative geometry with measureHand() (C3 fix): same offset calculation, same thresholds.
  const geo = palmGeometry(px(LM.WRIST), I, P, px(LM.MIDDLE_MCP));
  if (!geo.ok) return { frame: null, reason: 'frame-degenerate' };
  const widthPx = geo.widthPx;
  const ex = { x: (P.x - I.x) / widthPx, y: (P.y - I.y) / widthPx };
  // signedOffset = (wrist - index knuckle) . (-ex.y, ex.x): choose the normal that points towards the wrist.
  const ey = geo.signedOffset > 0 ? { x: -ex.y, y: ex.x } : { x: ex.y, y: -ex.x };
  return { frame: { origin: I, ex, ey, widthPx, w, h }, reason: 'ok' };
}

/** Normalised image point -> palm frame (palm widths). */
export function imageToPalm(f: Frame, p: NormPoint): NormPoint {
  const dx = p.x * f.w - f.origin.x, dy = p.y * f.h - f.origin.y;
  return { x: (dx * f.ex.x + dy * f.ex.y) / f.widthPx, y: (dx * f.ey.x + dy * f.ey.y) / f.widthPx };
}

const inBounds = (p: NormPoint) => p.x >= TRACE_LIMITS.bounds.xMin && p.x <= TRACE_LIMITS.bounds.xMax && p.y >= TRACE_LIMITS.bounds.yMin && p.y <= TRACE_LIMITS.bounds.yMax;

// ---------------------------------------------------------------- polyline geometry (engine-equivalent)
// A faithful port of the reading engine's polyline rules: valid only if valid in BOTH point orders; consecutive exact
// duplicates are tolerated (ignored for checking, never removed from the record); every limit compared with eps.
// It only CHECKS: nothing here moves, adds, removes, reorders or rounds a recorded point.

type GeometryProblem = 'trace-too-few-distinct-points' | 'trace-repeated-point' | 'trace-too-short' | 'trace-doubles-back' | 'trace-self-intersecting' | 'trace-tortuous';
const below = (v: number, l: number) => v < l - TRACE_LIMITS.eps;
const above = (v: number, l: number) => v > l + TRACE_LIMITS.eps;

function withoutConsecutiveDuplicates(points: readonly NormPoint[]): NormPoint[] {
  const out: NormPoint[] = [];
  for (const p of points) { const q = out[out.length - 1]; if (!q || q.x !== p.x || q.y !== p.y) out.push(p); }
  return out;
}
function canonical(points: NormPoint[]): NormPoint[] {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[n - 1 - i];
    if (a.x !== b.x) return a.x < b.x ? points : [...points].reverse();
    if (a.y !== b.y) return a.y < b.y ? points : [...points].reverse();
  }
  return points;
}
const cross = (o: NormPoint, a: NormPoint, b: NormPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const onSeg = (p: NormPoint, q: NormPoint, r: NormPoint) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
function segmentsTouch(p1: NormPoint, p2: NormPoint, p3: NormPoint, p4: NormPoint): boolean {
  const c1 = cross(p3, p4, p1), c2 = cross(p3, p4, p2), c3 = cross(p1, p2, p3), c4 = cross(p1, p2, p4);
  if (((c1 > 0 && c2 < 0) || (c1 < 0 && c2 > 0)) && ((c3 > 0 && c4 < 0) || (c3 < 0 && c4 > 0))) return true;
  return (c1 === 0 && onSeg(p3, p1, p4)) || (c2 === 0 && onSeg(p3, p2, p4)) || (c3 === 0 && onSeg(p1, p3, p2)) || (c4 === 0 && onSeg(p1, p4, p2));
}
function problemInOrder(pts: NormPoint[]): GeometryProblem | null {
  if (pts.length < 2) return 'trace-too-few-distinct-points';
  const seen = new Set<string>();
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
/** null for a measurable ordered polyline, else the specific problem. Same verdict whichever order is supplied. */
export function traceGeometryProblem(points: readonly NormPoint[]): GeometryProblem | null {
  const c = canonical(withoutConsecutiveDuplicates(points));
  return problemInOrder(c) ?? problemInOrder([...c].reverse());
}

/**
 * Place a confirmed trace: structural checks, conversion to the palm frame, rounding to the recorded precision,
 * then EVERY check (bounds and geometry) on the final rounded values that will be recorded, so rounding can never
 * produce a recorded geometry the engine would reject. Point order and count are preserved exactly.
 */
function placeTrace(points: unknown, frame: Frame): { ok: true; palmPoints: NormPoint[] } | { ok: false; reason: LineUnassessedReason } {
  if (!Array.isArray(points) || points.length < TRACE_LIMITS.minPoints) return { ok: false, reason: 'trace-too-few-points' };
  if (points.length > TRACE_LIMITS.maxPoints) return { ok: false, reason: 'trace-too-many-points' };
  const pts = readPoints(points);
  if (!pts) return { ok: false, reason: 'trace-point-invalid' };
  if (!pts.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return { ok: false, reason: 'trace-outside-image' };
  const rounded = pts.map((p) => imageToPalm(frame, p)).map((p) => ({ x: round4(p.x), y: round4(p.y) }));
  if (!rounded.every((p) => isNum(p.x) && isNum(p.y))) return { ok: false, reason: 'trace-point-invalid' };
  if (!rounded.every(inBounds)) return { ok: false, reason: 'trace-outside-palm-frame' };
  const problem = traceGeometryProblem(rounded);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, palmPoints: rounded };
}

// ---------------------------------------------------------------- builder

/**
 * Build the feature set. Structural input errors (unknown line or mark,
 * duplicate or sparse entries, bad hand choice, invalid quality feedback)
 * fail the whole build. Problems with a single trace or mark never do: that
 * feature becomes 'unassessed' with the specific reason. Pure and
 * deterministic; returns frozen plain data; never throws.
 */
export function buildPalmFeatureSet(input: PalmFeatureSetInput): PalmFeatureSetResult {
  try {
    return buildUnsafe(input);
  } catch {
    return { ok: false, errors: ['input-invalid: the input could not be read safely'] };
  }
}

type Quality = { status: PalmFrameInfo['qualityStatus']; issues: PalmFeedbackCode[] };
function readQualityRecord(q: unknown): Quality | null {
  if (q === null || q === undefined) return { status: 'unknown', issues: [] };
  if (!Array.isArray(q)) return null;
  const issues: PalmFeedbackCode[] = [];
  for (let k = 0; k < q.length; k++) {
    if (!own(q, k) || !KNOWN_QUALITY_CODES.includes(q[k]) || issues.includes(q[k])) return null;
    issues.push(q[k]);
  }
  return { status: issues.length ? 'needs-retake' : 'accepted', issues };
}

function buildUnsafe(input: PalmFeatureSetInput): PalmFeatureSetResult {
  if (input === null || typeof input !== 'object') return { ok: false, errors: ['input must be an object'] };
  const errors: string[] = [];
  if (input.hand !== 'left' && input.hand !== 'right') errors.push('hand must be "left" or "right" (user-declared)');
  if (!['left', 'right', 'unknown'].includes(input.dominantHand)) errors.push('dominantHand must be left | right | unknown');
  if (!isNum(input.rotationDeg) || Math.abs(input.rotationDeg) > 180) errors.push('rotationDeg must be a finite number in [-180, 180]');
  if (!Array.isArray(input.lines)) errors.push('lines[] is required (may be empty)');
  if (!Array.isArray(input.marks)) errors.push('marks[] is required (may be empty)');
  const quality = readQualityRecord(input.qualityIssues);
  if (!quality) errors.push('qualityIssues must be null (unknown) or a dense array of distinct known G5 feedback codes');
  if (errors.length || !quality) return { ok: false, errors };

  const lineInputs: LineInput[] = [];
  for (let k = 0; k < input.lines.length; k++) {
    if (!own(input.lines, k)) { errors.push(`lines[${k}] is a hole (sparse array)`); continue; }
    const l = input.lines[k];
    if (!l || typeof l !== 'object' || !ALL_LINES.includes(l.line)) { errors.push(`unknown line ${JSON.stringify((l as { line?: unknown } | null)?.line)}`); continue; }
    if (lineInputs.some((x) => x.line === l.line)) errors.push(`line "${l.line}" given more than once`);
    const action: string = (l as { action: string }).action;
    if (action !== 'traced' && action !== 'skipped') errors.push(`line "${l.line}": action must be traced | skipped`);
    if (l.action === 'traced' && typeof l.confirmed !== 'boolean') errors.push(`line "${l.line}": confirmed must be boolean`);
    if (l.action === 'skipped' && l.reason !== 'user-skipped' && l.reason !== 'user-cannot-see') errors.push(`line "${l.line}": skip reason must be user-skipped | user-cannot-see`);
    lineInputs.push(l);
  }
  const markInputs: MarkInput[] = [];
  for (let k = 0; k < input.marks.length; k++) {
    if (!own(input.marks, k)) { errors.push(`marks[${k}] is a hole (sparse array)`); continue; }
    const m = input.marks[k];
    if (!m || typeof m !== 'object' || !ALL_MARKS.includes(m.mark)) { errors.push(`unknown mark ${JSON.stringify((m as { mark?: unknown } | null)?.mark)}`); continue; }
    if (markInputs.some((x) => x.mark === m.mark)) errors.push(`mark "${m.mark}" given more than once`);
    const markAction: string = (m as { action: string }).action;
    if (markAction !== 'reported' && markAction !== 'skipped') errors.push(`mark "${m.mark}": action must be reported | skipped`);
    markInputs.push(m);
  }
  if (errors.length) return { ok: false, errors };

  const { frame, reason: frameReason } = palmFrameFromLandmarks(input.landmarks, input.imageWidth, input.imageHeight);
  const label = typeof input.handednessLabel === 'string' ? input.handednessLabel : undefined;
  const measurements = measureHand({ landmarks: input.landmarks, imageWidth: input.imageWidth, imageHeight: input.imageHeight, qualityIssues: quality.status === 'unknown' ? null : quality.issues, handednessLabel: label });

  const lines = {} as Record<PalmLineId, LineFeature>;
  for (const id of ALL_LINES) {
    const identity = PALM_LINE_IDENTITY[id];
    const l = lineInputs.find((x) => x.line === id);
    const unassessed = (reason: LineUnassessedReason, confirmation: 'none' | 'pending' | 'confirmed' = 'none'): LineFeature => Object.freeze({ line: id, provenance: 'unassessed', confirmation, identity, reason });
    if (!l) lines[id] = unassessed('not-requested');
    else if (l.action === 'skipped') lines[id] = unassessed(l.reason);
    else if (!l.confirmed) lines[id] = unassessed('not-confirmed', 'pending');
    else if (!frame) lines[id] = unassessed('frame-unavailable', 'confirmed');
    else {
      const placed = placeTrace(l.points, frame);
      lines[id] = placed.ok
        ? Object.freeze({ line: id, provenance: 'user-confirmed', confirmation: 'confirmed', identity, palmPoints: Object.freeze(placed.palmPoints.map((p) => Object.freeze(p))) })
        : unassessed(placed.reason, 'confirmed');
    }
  }

  const marks = {} as Record<PalmMarkId, MarkFeature>;
  for (const id of ALL_MARKS) {
    const m = markInputs.find((x) => x.mark === id);
    if (!m) marks[id] = Object.freeze({ mark: id, provenance: 'unassessed', reason: 'not-requested' });
    else if (m.action === 'skipped') marks[id] = Object.freeze({ mark: id, provenance: 'unassessed', reason: 'user-skipped' });
    else if (m.approximateLocation === undefined) marks[id] = Object.freeze({ mark: id, provenance: 'user-reported', approximatePalmLocation: null });
    else {
      const loc0 = readPoint(m.approximateLocation);
      if (!loc0 || loc0.x < 0 || loc0.x > 1 || loc0.y < 0 || loc0.y > 1) marks[id] = Object.freeze({ mark: id, provenance: 'unassessed', reason: 'location-invalid' });
      else {
        // A location without a usable frame is dropped, not guessed; the report itself still stands.
        const loc = frame ? imageToPalm(frame, loc0) : null;
        const r = loc ? { x: round4(loc.x), y: round4(loc.y) } : null;
        marks[id] = Object.freeze({ mark: id, provenance: 'user-reported', approximatePalmLocation: r && isNum(r.x) && isNum(r.y) && inBounds(r) ? Object.freeze(r) : null });
      }
    }
  }

  const provenance: Record<FeatureProvenance, string[]> = { 'automatic-measured': [], 'user-confirmed': [], 'user-reported': [], unassessed: [] };
  for (const [id, m] of Object.entries(measurements.measurements)) provenance[m.status === 'unavailable' ? 'unassessed' : 'automatic-measured'].push(`measurement:${id}`);
  for (const id of ALL_LINES) provenance[lines[id].provenance].push(`line:${id}`);
  for (const id of ALL_MARKS) provenance[marks[id].provenance].push(`mark:${id}`);

  const lmPts = frame ? (input.landmarks as ReadonlyArray<NormPoint>) : null;
  const palmFacing = lmPts && (label === 'Left' || label === 'Right')
    ? orientation(Array.from({ length: 21 }, (_, k) => ({ x: lmPts[k].x * input.imageWidth, y: lmPts[k].y * input.imageHeight })), label).palmFacing
    : null;
  const featureSet: PalmFeatureSet = Object.freeze({
    version: PALM_FEATURE_SET_VERSION,
    hand: Object.freeze({ value: input.hand, source: 'user-declared' as const }),
    dominantHand: input.dominantHand,
    frame: Object.freeze({ available: frame !== null, reason: frameReason, rotationDeg: input.rotationDeg, palmFacing, qualityStatus: quality.status, qualityIssues: Object.freeze([...quality.issues]) }),
    measurements,
    lines: Object.freeze(lines),
    marks: Object.freeze(marks),
    provenance: Object.freeze(Object.fromEntries(Object.entries(provenance).map(([k, v]) => [k, Object.freeze(v)])) as Record<FeatureProvenance, readonly string[]>),
  });
  return { ok: true, featureSet };
}
