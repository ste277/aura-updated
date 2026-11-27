/**
 * AURA-PALM-G5-I1 -- analysis stage: landmarks -> quality -> feedback.
 * Source-agnostic: takes a PalmFrame (upload today, camera frame in G5-I2)
 * and a PalmHandDetector. Returns a pixel-free, landmark-free result.
 *
 * Wording rule: a passing check means only that the photo shows one open
 * palm clearly enough for LATER analysis. It never claims palm lines were
 * found and never interprets anything.
 */
import { assessQuality, orientation, palmPolygon, bbox, toGray, extendedFingerCount, type QualityIssue } from './quality';
import { PalmPipelineError, type PalmAnalysisResult, type PalmFeedbackCode, type PalmFrame, type PalmHandDetection, type PalmHandDetector } from './types';

export const PALM_ACCEPTED_HEADLINE = 'Palm image looks suitable for further analysis.';
export const PALM_SCOPE_NOTE = 'This checks hand position and image quality only. It does not read palm lines or make any prediction.';

export const PALM_FEEDBACK_MESSAGES: Record<PalmFeedbackCode, string> = {
  'palm-not-visible': 'The palm side of the hand is not clearly visible. Use a photo of an open palm facing the camera, fingers spread.',
  'hand-cut-off': 'Part of the hand is outside the photo. Make sure the whole hand, including the wrist and fingertips, is in the frame.',
  'hand-too-small': 'The hand is too small in the photo. Move the camera closer, or crop the photo so the palm fills more of it.',
  'hand-rotated': 'The hand is tilted. Use a photo with the fingers pointing up.',
  'too-dark': 'The photo is too dark. Retake it in brighter, even light.',
  'too-bright': 'The photo is too bright or washed out. Avoid direct sunlight or flash on the palm.',
  'low-contrast': 'The palm has very low contrast. Try even lighting against a plain background.',
  'blurry': 'The photo looks blurry. Hold the camera steady and make sure the palm is in focus.',
};

const ISSUE_ORDER: PalmFeedbackCode[] = ['palm-not-visible', 'hand-cut-off', 'hand-too-small', 'hand-rotated', 'too-dark', 'too-bright', 'low-contrast', 'blurry'];

export const PALM_NO_HAND_HEADLINE = 'No hand detected. Use a photo of one open hand, palm facing the camera, in even light.';
export const PALM_MULTIPLE_HANDS_HEADLINE = 'More than one hand detected. Choose a photo that shows only one hand.';
export const PALM_RETAKE_HEADLINE = 'This photo is not suitable yet. See the suggestions below.';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function analyzePalmFrame(frame: PalmFrame, detector: PalmHandDetector): PalmAnalysisResult {
  return analyzePalmFrameWithDetection(frame, detector).result;
}

/**
 * AURA-PALM-04-I1 -- the same analysis (identical result), also returning the ONE detected hand so the session can
 * build its in-memory construction context (construction.ts). The hand is null unless exactly one hand was found
 * and analysed. The result itself stays pixel-free and landmark-free.
 */
export function analyzePalmFrameWithDetection(frame: PalmFrame, detector: PalmHandDetector): { result: PalmAnalysisResult; hand: PalmHandDetection | null } {
  if (frame.released) throw new PalmPipelineError('analysis-failed', 'frame already released');
  const { width: w, height: h } = frame;
  const t0 = now();
  const hands = detector.detect(frame);
  const detectMs = now() - t0;
  const base = { source: frame.source, handsDetected: hands.length } as const;

  if (hands.length === 0) {
    return { result: { ...base, status: 'no-hand', headline: PALM_NO_HAND_HEADLINE, issues: [], timing: { detectMs, postMs: 0 } }, hand: null };
  }
  if (hands.length > 1) {
    return { result: { ...base, status: 'multiple-hands', headline: PALM_MULTIPLE_HANDS_HEADLINE, issues: [], timing: { detectMs, postMs: 0 } }, hand: null };
  }

  const t1 = now();
  const hand = hands[0];
  if (!hand.landmarks || hand.landmarks.length < 21) throw new PalmPipelineError('analysis-failed', 'incomplete landmarks');
  const ctx = frame.canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new PalmPipelineError('unsupported-browser');
  let gray: Float32Array | null = toGray(ctx.getImageData(0, 0, w, h));
  const poly = palmPolygon(hand.landmarks, w, h);
  const lmPx = hand.landmarks.map((p) => ({ x: p.x * w, y: p.y * h }));
  const orient = orientation(hand.landmarks, hand.handednessLabel);
  const q = assessQuality(gray, w, h, poly, lmPx, orient.rotationDeg);
  gray = null; // drop the derived greyscale buffer immediately

  const codes = new Set<PalmFeedbackCode>(q.issues as QualityIssue[]);
  const fingersOpen = extendedFingerCount(hand.landmarks) === 4;
  if (!orient.palmFacing || !fingersOpen) codes.add('palm-not-visible');
  const issues = ISSUE_ORDER.filter((c) => codes.has(c)).map((code) => ({ code, message: PALM_FEEDBACK_MESSAGES[code] }));
  const box = bbox(poly);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const accepted = issues.length === 0;
  const result: PalmAnalysisResult = {
    ...base,
    status: accepted ? 'accepted' : 'needs-retake',
    headline: accepted ? PALM_ACCEPTED_HEADLINE : PALM_RETAKE_HEADLINE,
    issues,
    metrics: {
      brightness: Math.round(q.brightness),
      contrast: Math.round(q.contrast),
      sharpness: Math.round(q.sharpness * 10) / 10,
      palmFraction: Math.round(q.palmFraction * 1000) / 1000,
      rotationDeg: Math.round(orient.rotationDeg),
      palmFacing: orient.palmFacing,
      fingersOpen,
      inFrame: q.inFrame,
    },
    palmBox: { x0: clamp(box.x0 / w), y0: clamp(box.y0 / h), x1: clamp(box.x1 / w), y1: clamp(box.y1 / h) },
    timing: { detectMs, postMs: now() - t1 },
  };
  return { result, hand };
}
