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
import { measureHand, type HandMeasurementSet } from './measurements';

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
  readonly qualityIssues: readonly PalmFeedbackCode[];
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
  | 'trace-too-short'
  | 'trace-outside-palm-frame';

export type LineFeature =
  | {
      readonly line: PalmLineId;
      readonly provenance: 'user-confirmed';
      readonly confirmation: 'confirmed';
      readonly identity: (typeof PALM_LINE_IDENTITY)[PalmLineId];
      /** Ordered polyline in the palm frame (palm-width units), as traced; rounded to 4 decimals. */
      readonly palmPoints: readonly NormPoint[];
    }
  | {
      readonly line: PalmLineId;
      readonly provenance: 'unassessed';
      readonly confirmation: 'none' | 'pending';
      readonly identity: (typeof PALM_LINE_IDENTITY)[PalmLineId];
      readonly reason: LineUnassessedReason;
    };

export type MarkFeature =
  | { readonly mark: PalmMarkId; readonly provenance: 'user-reported'; readonly approximatePalmLocation: NormPoint | null }
  | { readonly mark: PalmMarkId; readonly provenance: 'unassessed'; readonly reason: 'not-requested' | 'user-skipped' | 'location-invalid' };

export interface PalmFrameInfo {
  readonly available: boolean;
  readonly reason: 'ok' | 'landmarks-invalid' | 'image-size-invalid' | 'frame-degenerate';
  readonly rotationDeg: number;
  /** Existing G5 palm-facing test; null when it cannot be decided (no frame, or no Left/Right handedness label). */
  readonly palmFacing: boolean | null;
  readonly qualityStatus: 'accepted' | 'needs-retake';
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

export const TRACE_LIMITS = Object.freeze({
  minPoints: 2,
  maxPoints: 64,
  /** Minimum traced length, in palm widths. */
  minLength: 0.02,
  /** The engine's accepted palm-frame bounds; a trace beyond them is not a palm line. */
  bounds: Object.freeze({ xMin: -0.2, xMax: 1.2, yMin: -0.2, yMax: 1.6 }),
});

interface Frame { origin: NormPoint; ex: NormPoint; ey: NormPoint; widthPx: number; w: number; h: number }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPt = (p: unknown): p is NormPoint => p !== null && typeof p === 'object' && isNum((p as NormPoint).x) && isNum((p as NormPoint).y);
const round4 = (v: number) => Math.round(v * 10000) / 10000 + 0; // + 0 turns -0 into 0

/** Palm frame from landmarks 0 (wrist), 5 and 17, in pixel space. Null when it cannot be defined. */
export function palmFrameFromLandmarks(landmarks: PalmFeatureSetInput['landmarks'], w: number, h: number): { frame: Frame | null; reason: PalmFrameInfo['reason'] } {
  if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0) return { frame: null, reason: 'image-size-invalid' };
  if (!Array.isArray(landmarks) || landmarks.length !== 21 || !landmarks.every(isPt)) return { frame: null, reason: 'landmarks-invalid' };
  const px = (k: number) => ({ x: landmarks[k].x * w, y: landmarks[k].y * h });
  const I = px(LM.INDEX_MCP), P = px(LM.PINKY_MCP), Wr = px(LM.WRIST);
  const widthPx = Math.hypot(P.x - I.x, P.y - I.y);
  if (!(widthPx > 1e-6)) return { frame: null, reason: 'frame-degenerate' };
  const ex = { x: (P.x - I.x) / widthPx, y: (P.y - I.y) / widthPx };
  let ey = { x: -ex.y, y: ex.x };
  const wristSide = (Wr.x - I.x) * ey.x + (Wr.y - I.y) * ey.y;
  if (!(Math.abs(wristSide) > 1e-9 * widthPx)) return { frame: null, reason: 'frame-degenerate' };
  if (wristSide < 0) ey = { x: -ey.x, y: -ey.y };
  return { frame: { origin: I, ex, ey, widthPx, w, h }, reason: 'ok' };
}

/** Normalised image point -> palm frame (palm widths). */
export function imageToPalm(f: Frame, p: NormPoint): NormPoint {
  const dx = p.x * f.w - f.origin.x, dy = p.y * f.h - f.origin.y;
  return { x: (dx * f.ex.x + dy * f.ex.y) / f.widthPx, y: (dx * f.ey.x + dy * f.ey.y) / f.widthPx };
}

const inBounds = (p: NormPoint) => p.x >= TRACE_LIMITS.bounds.xMin && p.x <= TRACE_LIMITS.bounds.xMax && p.y >= TRACE_LIMITS.bounds.yMin && p.y <= TRACE_LIMITS.bounds.yMax;

/** Structural trace checks. Geometry plausibility (self-crossing, doubling back) is left to the engine-side adapter. */
function placeTrace(points: unknown, frame: Frame): { ok: true; palmPoints: NormPoint[] } | { ok: false; reason: LineUnassessedReason } {
  if (!Array.isArray(points) || points.length < TRACE_LIMITS.minPoints) return { ok: false, reason: 'trace-too-few-points' };
  if (points.length > TRACE_LIMITS.maxPoints) return { ok: false, reason: 'trace-too-many-points' };
  if (!points.every(isPt)) return { ok: false, reason: 'trace-point-invalid' };
  if (!points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return { ok: false, reason: 'trace-outside-image' };
  const palm = points.map((p) => imageToPalm(frame, p));
  if (!palm.every(inBounds)) return { ok: false, reason: 'trace-outside-palm-frame' };
  let len = 0;
  for (let k = 1; k < palm.length; k++) len += Math.hypot(palm[k].x - palm[k - 1].x, palm[k].y - palm[k - 1].y);
  if (len < TRACE_LIMITS.minLength) return { ok: false, reason: 'trace-too-short' };
  // Never resampled, smoothed or reordered: the points stay in the order the user drew them.
  return { ok: true, palmPoints: palm.map((p) => ({ x: round4(p.x), y: round4(p.y) })) };
}

// ---------------------------------------------------------------- builder

/**
 * Build the feature set. Structural input errors (unknown line or mark,
 * duplicate entries, bad hand choice) fail the whole build. Problems with a
 * single trace or mark never do: that feature becomes 'unassessed' with the
 * reason. Pure and deterministic; returns frozen plain data.
 */
export function buildPalmFeatureSet(input: PalmFeatureSetInput): PalmFeatureSetResult {
  const errors: string[] = [];
  if (input.hand !== 'left' && input.hand !== 'right') errors.push('hand must be "left" or "right" (user-declared)');
  if (!['left', 'right', 'unknown'].includes(input.dominantHand)) errors.push('dominantHand must be left | right | unknown');
  if (!isNum(input.rotationDeg) || Math.abs(input.rotationDeg) > 180) errors.push('rotationDeg must be a finite number in [-180, 180]');
  if (!Array.isArray(input.lines)) errors.push('lines[] is required (may be empty)');
  if (!Array.isArray(input.marks)) errors.push('marks[] is required (may be empty)');
  if (!Array.isArray(input.qualityIssues)) errors.push('qualityIssues[] is required (may be empty)');
  if (errors.length) return { ok: false, errors };

  const seenLines = new Set<string>();
  for (const l of input.lines) {
    if (!l || !ALL_LINES.includes(l.line)) { errors.push(`unknown line ${JSON.stringify(l?.line)}`); continue; }
    if (seenLines.has(l.line)) errors.push(`line "${l.line}" given more than once`);
    seenLines.add(l.line);
    const action: string = (l as { action: string }).action;
    if (action !== 'traced' && action !== 'skipped') errors.push(`line "${l.line}": action must be traced | skipped`);
    if (l.action === 'traced' && typeof l.confirmed !== 'boolean') errors.push(`line "${l.line}": confirmed must be boolean`);
    if (l.action === 'skipped' && l.reason !== 'user-skipped' && l.reason !== 'user-cannot-see') errors.push(`line "${l.line}": skip reason must be user-skipped | user-cannot-see`);
  }
  const seenMarks = new Set<string>();
  for (const m of input.marks) {
    if (!m || !ALL_MARKS.includes(m.mark)) { errors.push(`unknown mark ${JSON.stringify(m?.mark)}`); continue; }
    if (seenMarks.has(m.mark)) errors.push(`mark "${m.mark}" given more than once`);
    seenMarks.add(m.mark);
    const markAction: string = (m as { action: string }).action;
    if (markAction !== 'reported' && markAction !== 'skipped') errors.push(`mark "${m.mark}": action must be reported | skipped`);
  }
  if (errors.length) return { ok: false, errors };

  const { frame, reason: frameReason } = palmFrameFromLandmarks(input.landmarks, input.imageWidth, input.imageHeight);
  const measurements = measureHand({ landmarks: input.landmarks, imageWidth: input.imageWidth, imageHeight: input.imageHeight, qualityIssues: input.qualityIssues, handednessLabel: input.handednessLabel });

  const lines = {} as Record<PalmLineId, LineFeature>;
  for (const id of ALL_LINES) {
    const identity = PALM_LINE_IDENTITY[id];
    const l = input.lines.find((x) => x.line === id);
    const unassessed = (reason: LineUnassessedReason, confirmation: 'none' | 'pending' = 'none'): LineFeature => Object.freeze({ line: id, provenance: 'unassessed', confirmation, identity, reason });
    if (!l) lines[id] = unassessed('not-requested');
    else if (l.action === 'skipped') lines[id] = unassessed(l.reason);
    else if (!l.confirmed) lines[id] = unassessed('not-confirmed', 'pending');
    else if (!frame) lines[id] = unassessed('frame-unavailable');
    else {
      const placed = placeTrace(l.points, frame);
      lines[id] = placed.ok
        ? Object.freeze({ line: id, provenance: 'user-confirmed', confirmation: 'confirmed', identity, palmPoints: Object.freeze(placed.palmPoints.map((p) => Object.freeze(p))) })
        : unassessed(placed.reason);
    }
  }

  const marks = {} as Record<PalmMarkId, MarkFeature>;
  for (const id of ALL_MARKS) {
    const m = input.marks.find((x) => x.mark === id);
    if (!m) marks[id] = Object.freeze({ mark: id, provenance: 'unassessed', reason: 'not-requested' });
    else if (m.action === 'skipped') marks[id] = Object.freeze({ mark: id, provenance: 'unassessed', reason: 'user-skipped' });
    else if (m.approximateLocation === undefined) marks[id] = Object.freeze({ mark: id, provenance: 'user-reported', approximatePalmLocation: null });
    else if (!isPt(m.approximateLocation) || m.approximateLocation.x < 0 || m.approximateLocation.x > 1 || m.approximateLocation.y < 0 || m.approximateLocation.y > 1) {
      marks[id] = Object.freeze({ mark: id, provenance: 'unassessed', reason: 'location-invalid' });
    } else {
      // A location without a usable frame is dropped, not guessed; the report itself still stands.
      const loc = frame ? imageToPalm(frame, m.approximateLocation) : null;
      marks[id] = Object.freeze({ mark: id, provenance: 'user-reported', approximatePalmLocation: loc && inBounds(loc) ? Object.freeze({ x: round4(loc.x), y: round4(loc.y) }) : null });
    }
  }

  const provenance: Record<FeatureProvenance, string[]> = { 'automatic-measured': [], 'user-confirmed': [], 'user-reported': [], unassessed: [] };
  for (const [id, m] of Object.entries(measurements.measurements)) provenance[m.status === 'unavailable' ? 'unassessed' : 'automatic-measured'].push(`measurement:${id}`);
  for (const id of ALL_LINES) provenance[lines[id].provenance].push(`line:${id}`);
  for (const id of ALL_MARKS) provenance[marks[id].provenance].push(`mark:${id}`);

  const issues = [...input.qualityIssues];
  const label = input.handednessLabel;
  const palmFacing = frame && (label === 'Left' || label === 'Right')
    ? orientation((input.landmarks as ReadonlyArray<NormPoint>).map((p) => ({ x: p.x * input.imageWidth, y: p.y * input.imageHeight })), label).palmFacing
    : null;
  const featureSet: PalmFeatureSet = Object.freeze({
    version: PALM_FEATURE_SET_VERSION,
    hand: Object.freeze({ value: input.hand, source: 'user-declared' as const }),
    dominantHand: input.dominantHand,
    frame: Object.freeze({ available: frame !== null, reason: frameReason, rotationDeg: input.rotationDeg, palmFacing, qualityStatus: issues.length ? 'needs-retake' : 'accepted', qualityIssues: Object.freeze(issues) }),
    measurements,
    lines: Object.freeze(lines),
    marks: Object.freeze(marks),
    provenance: Object.freeze(Object.fromEntries(Object.entries(provenance).map(([k, v]) => [k, Object.freeze(v)])) as Record<FeatureProvenance, readonly string[]>),
  });
  return { ok: true, featureSet };
}
