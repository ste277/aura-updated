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

export const HAND_MEASUREMENT_VERSION = 'palm-03-i1-hand-measurements@0.1.0';

export type MeasurementStatus = 'measured' | 'uncertain' | 'unavailable';

export type MeasurementReason =
  | 'landmarks-invalid'
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
  /** G5 quality feedback codes for the same frame (analyze.ts). */
  readonly qualityIssues: readonly PalmFeedbackCode[];
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

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validLandmarks(lm: HandMeasurementInput['landmarks']): lm is ReadonlyArray<{ x: number; y: number }> {
  return Array.isArray(lm) && lm.length === 21 && lm.every((p) => p !== null && typeof p === 'object' && isFiniteNum(p.x) && isFiniteNum(p.y));
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
  const { imageWidth: w, imageHeight: h } = input;
  if (!isFiniteNum(w) || !isFiniteNum(h) || w <= 0 || h <= 0) return unavailableSet(['image-size-invalid']);
  if (!validLandmarks(input.landmarks)) return unavailableSet(['landmarks-invalid']);
  const issues = Array.isArray(input.qualityIssues) ? input.qualityIssues : [];
  const blocking = BLOCKING_ISSUES.filter((c) => issues.includes(c));
  if (blocking.length) return unavailableSet([...blocking] as MeasurementReason[]);

  const norm = input.landmarks;
  const px: Pt[] = norm.map((p) => ({ x: p.x * w, y: p.y * h }));
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const palmWidth = dist(px[LM.INDEX_MCP], px[LM.PINKY_MCP]);
  const palmLengthPx = dist(px[LM.WRIST], px[LM.MIDDLE_MCP]);
  // A degenerate frame: zero width, or the wrist on the knuckle line.
  const i = px[LM.INDEX_MCP], p = px[LM.PINKY_MCP], wr = px[LM.WRIST];
  const wristOffset = Math.abs((p.x - i.x) * (wr.y - i.y) - (p.y - i.y) * (wr.x - i.x)) / (palmWidth || 1);
  if (!(palmWidth > 1e-6) || !(palmLengthPx > 1e-6) || !(wristOffset > 1e-6 * palmWidth)) return unavailableSet(['frame-degenerate']);
  const setReasons: MeasurementReason[] = DEGRADING_ISSUES.filter((c) => issues.includes(c)) as MeasurementReason[];
  // Palm facing: the existing G5 test, on pixel-space landmarks so aspect ratio cannot flip it. The test needs the
  // handedness label (a mirrored hand flips the winding); without one, palm-facing cannot be decided -> uncertain.
  const label = input.handednessLabel;
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
    const unavailable = raw === null || reasons.includes('finger-not-extended') || reasons.includes('depends-on-unavailable');
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
