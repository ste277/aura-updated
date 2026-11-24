/**
 * AURA-PALM-03-I1 -- hand measurements from the 21 MediaPipe hand landmarks.
 * DEVELOPMENT ONLY. Synthetic tests only. Not imported by any UI module, and
 * excluded from production builds with the rest of lib/palm-analysis.
 *
 * What this measures: hand PROPORTIONS (palm length, finger lengths and two
 * ratios), from landmarks only. What it never does: infer palm lines or
 * marks. Landmarks are joint positions; they carry no line information.
 *
 * Conventions
 *  - Input landmarks use MediaPipe's normalised image coordinates ([0,1] per
 *    axis). They are converted to pixel units with the image size first, so a
 *    non-square image does not distort distances.
 *  - Every length is divided by the palm width (index-finger knuckle to
 *    little-finger knuckle, landmarks 5 and 17), the same unit the reading
 *    engine's palm frame uses. That makes all values scale-independent and
 *    unchanged by translation, rotation and left/right mirroring.
 *  - Values are rounded to 3 decimals: enough for proportions, no false
 *    precision. They are hand-shape data: keep them transient, never log,
 *    store or send them (same rule as landmarks, see types.ts).
 *  - Each measurement says whether it is measured, uncertain or unavailable,
 *    with reasons. Nothing is estimated or filled in.
 */
import { LM, orientation, MIN_TIP_TO_PIP_RATIO, type Pt } from './quality';
import type { PalmFeedbackCode } from './types';
import { PALM_FEEDBACK_MESSAGES } from './analyze';

export const HAND_MEASUREMENT_VERSION = 'palm-03-i1-hand-measurements@0.1.0';

export type MeasurementStatus = 'measured' | 'uncertain' | 'unavailable';

export type MeasurementReason =
  | 'input-invalid'
  | 'landmarks-invalid'
  | 'landmark-out-of-frame'
  | 'quality-invalid'
  | 'quality-unknown'
  | 'computation-nonfinite'
  | 'image-size-invalid'
  | 'frame-degenerate'
  | 'palm-not-facing'
  | 'palm-facing-unknown'
  | 'palm-not-visible'
  | 'hand-cut-off'
  | 'hand-too-small'
  | 'hand-rotated'
  | 'too-dark'
  | 'too-bright'
  | 'low-contrast'
  | 'blurry'
  | 'implausible-proportions'
  | 'finger-not-extended'
  | 'depends-on-unavailable'
  | 'depends-on-uncertain';

export type HandMeasurementId =
  | 'palmLength'
  | 'thumbLength'
  | 'indexLength'
  | 'middleLength'
  | 'ringLength'
  | 'littleLength'
  | 'handLength'
  | 'middleToPalmRatio'
  | 'indexToRingRatio';

export interface HandMeasurement {
  readonly id: HandMeasurementId;
  /** null whenever status is 'unavailable'. */
  readonly value: number | null;
  /** 'palm-width' = multiples of the palm width; 'ratio' = dimensionless. */
  readonly unit: 'palm-width' | 'ratio';
  readonly status: MeasurementStatus;
  readonly reasons: readonly MeasurementReason[];
}

export interface HandMeasurementSet {
  readonly version: typeof HAND_MEASUREMENT_VERSION;
  /** Always automatic: computed from landmarks, never entered by the user. */
  readonly provenance: 'automatic-measured';
  /** Worst status that applies to the whole set (per-finger issues excluded). */
  readonly status: MeasurementStatus;
  readonly reasons: readonly MeasurementReason[];
  readonly measurements: Readonly<Record<HandMeasurementId, HandMeasurement>>;
}

export interface HandMeasurementInput {
  /** 21 MediaPipe landmarks, normalised image coordinates. */
  readonly landmarks: ReadonlyArray<{ x: number; y: number; z?: number }> | null | undefined;
  readonly imageWidth: number;
  readonly imageHeight: number;
  /**
   * G5 quality feedback codes for the SAME frame (analyze.ts). `null` or
   * `undefined` means quality is unknown: values are then at most uncertain.
   * Anything else that is not a dense array of known codes is invalid.
   */
  readonly qualityIssues: readonly PalmFeedbackCode[] | null | undefined;
  /** MediaPipe handedness label, used only by the existing palm-facing test. */
  readonly handednessLabel?: string;
}

export const MEASUREMENT_IDS: readonly HandMeasurementId[] = Object.freeze([
  'palmLength', 'thumbLength', 'indexLength', 'middleLength', 'ringLength', 'littleLength',
  'handLength', 'middleToPalmRatio', 'indexToRingRatio',
]);

/** Quality issues that make every measurement unavailable (the hand is not fully, frontally visible). */
const BLOCKING_ISSUES: readonly PalmFeedbackCode[] = Object.freeze(['palm-not-visible', 'hand-cut-off']);
/** Quality issues that keep values but mark them uncertain. */
const DEGRADING_ISSUES: readonly PalmFeedbackCode[] = Object.freeze(['hand-too-small', 'hand-rotated', 'too-dark', 'too-bright', 'low-contrast', 'blurry']);

/**
 * Plausible palm length / palm width range for a flat, frontal palm. Outside
 * it the hand is probably tilted towards or away from the camera
 * (foreshortened), so values are kept but marked uncertain. Provisional,
 * like the G5 quality thresholds: not calibrated on real hands.
 */
export const PLAUSIBLE_PALM_ASPECT = Object.freeze({ min: 0.7, max: 1.8 });

/** Landmark chains: [base, ..., tip]. Finger length = summed segment lengths, which tolerates slight bending. */
const CHAINS: Readonly<Record<'thumb' | 'index' | 'middle' | 'ring' | 'little', readonly number[]>> = Object.freeze({
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  little: [17, 18, 19, 20],
});
/** Thumb extension test: tip clearly farther from the wrist than the thumb's last joint (IP, landmark 3). */
export const MIN_THUMB_TIP_TO_IP_RATIO = 1.05;

/**
 * Largest accepted image side, in pixels. The pipeline downsizes frames to
 * <= 1280 px; this generous cap only keeps pixel arithmetic far from
 * floating-point overflow.
 */
export const MAX_IMAGE_SIDE_PX = 100000;
/** Known G5 feedback codes (the keys of the existing message table). */
export const KNOWN_QUALITY_CODES: readonly PalmFeedbackCode[] = Object.freeze(Object.keys(PALM_FEEDBACK_MESSAGES) as PalmFeedbackCode[]);

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Landmark contract: a dense array of exactly 21 objects, each with finite
 * x and y in MediaPipe's normalised image range [0, 1] and, if present, a
 * finite z. Sparse arrays (holes) are invalid. Every index is read
 * explicitly (Array.prototype.every skips holes). A landmark outside [0, 1]
 * lies outside the photo: the hand is not fully in frame, so nothing is
 * measured (explicit unavailable-data policy, never clamped).
 * Returns a plain copy, or the reason it is unusable.
 */
function readLandmarks(lm: unknown): { ok: true; points: Pt[] } | { ok: false; reason: 'landmarks-invalid' | 'landmark-out-of-frame' } {
  if (!Array.isArray(lm) || lm.length !== 21) return { ok: false, reason: 'landmarks-invalid' };
  const points: Pt[] = [];
  let outOfFrame = false;
  for (let k = 0; k < 21; k++) {
    if (!Object.prototype.hasOwnProperty.call(lm, k)) return { ok: false, reason: 'landmarks-invalid' };
    const p = lm[k];
    if (p === null || typeof p !== 'object') return { ok: false, reason: 'landmarks-invalid' };
    const x = (p as { x?: unknown }).x, y = (p as { y?: unknown }).y, z = (p as { z?: unknown }).z;
    if (!isFiniteNum(x) || !isFiniteNum(y) || (z !== undefined && !isFiniteNum(z))) return { ok: false, reason: 'landmarks-invalid' };
    if (x < 0 || x > 1 || y < 0 || y > 1) outOfFrame = true;
    points.push({ x, y });
  }
  return outOfFrame ? { ok: false, reason: 'landmark-out-of-frame' } : { ok: true, points };
}

/** Quality contract: null/undefined = unknown; otherwise a dense array of known codes. */
function readQuality(q: unknown): { kind: 'known'; issues: PalmFeedbackCode[] } | { kind: 'unknown' } | { kind: 'invalid' } {
  if (q === null || q === undefined) return { kind: 'unknown' };
  if (!Array.isArray(q)) return { kind: 'invalid' };
  const issues: PalmFeedbackCode[] = [];
  for (let k = 0; k < q.length; k++) {
    if (!Object.prototype.hasOwnProperty.call(q, k) || !KNOWN_QUALITY_CODES.includes(q[k])) return { kind: 'invalid' };
    issues.push(q[k]);
  }
  return { kind: 'known', issues };
}

function unavailableSet(reasons: MeasurementReason[]): HandMeasurementSet {
  const measurements = {} as Record<HandMeasurementId, HandMeasurement>;
  for (const id of MEASUREMENT_IDS) {
    measurements[id] = Object.freeze({ id, value: null, unit: id.endsWith('Ratio') ? 'ratio' : 'palm-width', status: 'unavailable', reasons: Object.freeze(['depends-on-unavailable']) }) as HandMeasurement;
  }
  return Object.freeze({ version: HAND_MEASUREMENT_VERSION, provenance: 'automatic-measured', status: 'unavailable', reasons: Object.freeze([...reasons]), measurements: Object.freeze(measurements) });
}

/**
 * Measure hand proportions. Pure and deterministic; never throws on bad
 * input (it returns an all-unavailable set with the reason instead).
 */
export function measureHand(input: HandMeasurementInput): HandMeasurementSet {
  try {
    return measureHandUnsafe(input);
  } catch {
    // Hostile input (throwing accessors, proxies): no partial result, no exception.
    return unavailableSet(['input-invalid']);
  }
}

function measureHandUnsafe(input: HandMeasurementInput): HandMeasurementSet {
  if (input === null || typeof input !== 'object') return unavailableSet(['input-invalid']);
  const w = input.imageWidth, h = input.imageHeight;
  if (!isFiniteNum(w) || !isFiniteNum(h) || w <= 0 || h <= 0 || w > MAX_IMAGE_SIDE_PX || h > MAX_IMAGE_SIDE_PX) return unavailableSet(['image-size-invalid']);
  const read = readLandmarks(input.landmarks);
  if (!read.ok) return unavailableSet([read.reason]);
  const quality = readQuality(input.qualityIssues);
  if (quality.kind === 'invalid') return unavailableSet(['quality-invalid']);
  const issues: PalmFeedbackCode[] = quality.kind === 'known' ? quality.issues : [];
  const blocking = BLOCKING_ISSUES.filter((c) => issues.includes(c));
  if (blocking.length) return unavailableSet([...blocking] as MeasurementReason[]);

  const px: Pt[] = read.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const palmWidth = dist(px[LM.INDEX_MCP], px[LM.PINKY_MCP]);
  const palmLengthPx = dist(px[LM.WRIST], px[LM.MIDDLE_MCP]);
  // A degenerate frame: zero width, or the wrist on the knuckle line.
  const i = px[LM.INDEX_MCP], p = px[LM.PINKY_MCP], wr = px[LM.WRIST];
  const wristOffset = Math.abs((p.x - i.x) * (wr.y - i.y) - (p.y - i.y) * (wr.x - i.x)) / (palmWidth || 1);
  if (!(palmWidth > 1e-6) || !(palmLengthPx > 1e-6) || !(wristOffset > 1e-6 * palmWidth)) return unavailableSet(['frame-degenerate']);
  if (!isFiniteNum(palmWidth) || !isFiniteNum(palmLengthPx) || !isFiniteNum(wristOffset)) return unavailableSet(['computation-nonfinite']);
  const setReasons: MeasurementReason[] = DEGRADING_ISSUES.filter((c) => issues.includes(c)) as MeasurementReason[];
  if (quality.kind === 'unknown') setReasons.push('quality-unknown');
  // Palm facing: the existing G5 test, on pixel-space landmarks so aspect ratio cannot flip it. The test needs the
  // handedness label (a mirrored hand flips the winding); without one, palm-facing cannot be decided -> uncertain.
  const label = typeof input.handednessLabel === 'string' ? input.handednessLabel : undefined;
  if (label === 'Left' || label === 'Right') {
    if (!orientation(px, label).palmFacing) return unavailableSet(['palm-not-facing']);
  } else setReasons.push('palm-facing-unknown');
  const palmLength = palmLengthPx / palmWidth;
  if (palmLength < PLAUSIBLE_PALM_ASPECT.min || palmLength > PLAUSIBLE_PALM_ASPECT.max) setReasons.push('implausible-proportions');
  const setStatus: MeasurementStatus = setReasons.length ? 'uncertain' : 'measured';

  const fromWrist = (k: number) => dist(px[LM.WRIST], px[k]);
  const extended = {
    thumb: fromWrist(4) > fromWrist(3) * MIN_THUMB_TIP_TO_IP_RATIO,
    index: fromWrist(8) > fromWrist(6) * MIN_TIP_TO_PIP_RATIO,
    middle: fromWrist(12) > fromWrist(10) * MIN_TIP_TO_PIP_RATIO,
    ring: fromWrist(16) > fromWrist(14) * MIN_TIP_TO_PIP_RATIO,
    little: fromWrist(20) > fromWrist(18) * MIN_TIP_TO_PIP_RATIO,
  };
  const chainLength = (chain: readonly number[]) => {
    let s = 0;
    for (let k = 1; k < chain.length; k++) s += dist(px[chain[k - 1]], px[chain[k]]);
    return s / palmWidth;
  };

  const out = {} as Record<HandMeasurementId, HandMeasurement>;
  const put = (id: HandMeasurementId, raw: number | null, reasons: MeasurementReason[]) => {
    // A non-finite computed value is never classified as measured or uncertain.
    if (raw !== null && !(isFiniteNum(raw) && isFiniteNum(round3(raw)))) reasons = ['computation-nonfinite'];
    const unavailable = raw === null || reasons.includes('finger-not-extended') || reasons.includes('depends-on-unavailable') || reasons.includes('computation-nonfinite');
    const status: MeasurementStatus = unavailable ? 'unavailable' : reasons.length ? 'uncertain' : 'measured';
    out[id] = Object.freeze({ id, value: unavailable ? null : round3(raw as number), unit: id.endsWith('Ratio') ? 'ratio' : 'palm-width', status, reasons: Object.freeze([...reasons]) }) as HandMeasurement;
  };
  const fingerId = { thumb: 'thumbLength', index: 'indexLength', middle: 'middleLength', ring: 'ringLength', little: 'littleLength' } as const;

  put('palmLength', palmLength, [...setReasons]);
  for (const f of Object.keys(CHAINS) as Array<keyof typeof CHAINS>) {
    put(fingerId[f], chainLength(CHAINS[f]), extended[f] ? [...setReasons] : ['finger-not-extended']);
  }
  // Derived values use unrounded inputs (rounding never compounds) and inherit the worst status of their inputs.
  const unrounded: Partial<Record<HandMeasurementId, number>> = {
    palmLength,
    middleLength: chainLength(CHAINS.middle),
    indexLength: chainLength(CHAINS.index),
    ringLength: chainLength(CHAINS.ring),
  };
  const derive = (id: HandMeasurementId, deps: [HandMeasurementId, HandMeasurementId], f: (a: number, b: number) => number) => {
    const ms = deps.map((d) => out[d]);
    if (ms.some((m) => m.status === 'unavailable')) { put(id, null, ['depends-on-unavailable']); return; }
    const uncertain = ms.some((m) => m.status === 'uncertain');
    const reasons: MeasurementReason[] = !uncertain ? [] : setReasons.length ? [...setReasons] : ['depends-on-uncertain'];
    put(id, f(unrounded[deps[0]] as number, unrounded[deps[1]] as number), reasons);
  };
  derive('handLength', ['palmLength', 'middleLength'], (a, b) => a + b);
  derive('middleToPalmRatio', ['middleLength', 'palmLength'], (a, b) => a / b);
  derive('indexToRingRatio', ['indexLength', 'ringLength'], (a, b) => a / b);

  return Object.freeze({ version: HAND_MEASUREMENT_VERSION, provenance: 'automatic-measured', status: setStatus, reasons: Object.freeze(setReasons), measurements: Object.freeze(out) });
}
