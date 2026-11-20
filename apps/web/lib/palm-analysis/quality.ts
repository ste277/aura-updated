/**
 * AURA-PALM-G5-I1 -- geometry + image-quality checks, ported (typed, no
 * behaviour change to the thresholds) from the G4-A research prototype:
 *   .claude/worktrees/palm-g4a-scan/research/palm-scan-g4a/src/geometry.js
 *   .claude/worktrees/palm-g4a-scan/research/palm-scan-g4a/src/quality.js
 * Pure functions, no I/O. G4-A's crease detectors (creases*.js) and the
 * frozen G4-D1 directional detector are deliberately NOT ported.
 *
 * Thresholds are PROVISIONAL: G4-A calibrated them only on its public
 * research set; real-palm calibration is blocked by the real-image hold.
 */

export interface Pt { x: number; y: number }

/** MediaPipe hand landmark indices. */
export const LM = { WRIST: 0, THUMB_CMC: 1, THUMB_MCP: 2, INDEX_MCP: 5, MIDDLE_MCP: 9, RING_MCP: 13, PINKY_MCP: 17 } as const;

/** Palm polygon in pixels: wrist, thumb base, finger bases. */
export function palmPolygon(landmarks: ReadonlyArray<Pt>, w: number, h: number): Pt[] {
  return [LM.WRIST, LM.THUMB_CMC, LM.THUMB_MCP, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP].map((i) => ({ x: landmarks[i].x * w, y: landmarks[i].y * h }));
}

export function polygonMask(w: number, h: number, poly: ReadonlyArray<Pt>): Uint8Array {
  const mask = new Uint8Array(w * h);
  let minY = h, maxY = 0;
  for (const p of poly) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(h - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(w - 1, Math.floor(xs[k + 1])); x++) mask[y * w + x] = 1;
    }
  }
  return mask;
}

export function bbox(points: ReadonlyArray<Pt>): { x0: number; y0: number; x1: number; y1: number } {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Heuristic orientation (G4-A). Rotation = angle wrist -> middle-finger base,
 * 0 deg = fingers up. Palm-facing combines the winding of (index base -
 * wrist) x (pinky base - wrist) with MediaPipe's handedness label; both flip
 * together under mirroring, so the test is consistent for mirrored (selfie)
 * and unmirrored (rear camera / upload) images. The label itself is NOT
 * shown to users: it names the hand as if the image were mirrored.
 */
export function orientation(landmarks: ReadonlyArray<Pt>, handednessLabel?: string): { rotationDeg: number; palmFacing: boolean } {
  const w = landmarks[LM.WRIST], m = landmarks[LM.MIDDLE_MCP], i = landmarks[LM.INDEX_MCP], p = landmarks[LM.PINKY_MCP];
  const rotationDeg = (Math.atan2(m.x - w.x, -(m.y - w.y)) * 180) / Math.PI;
  const cross = (i.x - w.x) * (p.y - w.y) - (i.y - w.y) * (p.x - w.x);
  const sign = handednessLabel === 'Right' ? -1 : 1;
  return { rotationDeg, palmFacing: cross * sign > 0 };
}

/**
 * G5-I1 addition (not in G4-A): are the four fingers open? A folded finger
 * (fist, V-sign, pointing) lies across the palm and hides it. A finger counts
 * as extended when its tip is clearly farther from the wrist than its middle
 * joint (PIP). Rotation- and scale-invariant; uses landmarks transiently.
 */
const FINGERS: ReadonlyArray<[pip: number, tip: number]> = [[6, 8], [10, 12], [14, 16], [18, 20]];
export const MIN_TIP_TO_PIP_RATIO = 1.1;

export function extendedFingerCount(landmarks: ReadonlyArray<Pt>): number {
  const w = landmarks[LM.WRIST];
  const d = (p: Pt) => Math.hypot(p.x - w.x, p.y - w.y);
  return FINGERS.filter(([pip, tip]) => d(landmarks[tip]) > d(landmarks[pip]) * MIN_TIP_TO_PIP_RATIO).length;
}

export function toGray(imageData: { data: ArrayLike<number>; width: number; height: number }): Float32Array {
  const { data, width, height } = imageData;
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return g;
}

/** G4-A thresholds, unchanged. */
export const QUALITY_THRESHOLDS = Object.freeze({ minBrightness: 60, maxBrightness: 215, minContrast: 18, minSharpness: 12, minPalmFraction: 0.04, maxAbsRotationDeg: 45 });

export type QualityIssue = 'too-dark' | 'too-bright' | 'low-contrast' | 'blurry' | 'hand-too-small' | 'hand-cut-off' | 'hand-rotated';

export interface QualityAssessment {
  brightness: number;
  contrast: number;
  sharpness: number;
  palmFraction: number;
  inFrame: boolean;
  issues: QualityIssue[];
}

export function assessQuality(gray: Float32Array, w: number, h: number, palmPoly: ReadonlyArray<Pt>, allLandmarksPx: ReadonlyArray<Pt>, rotationDeg: number): QualityAssessment {
  const mask = polygonMask(w, h, palmPoly);
  let n = 0, sum = 0, sum2 = 0, lapN = 0, lapSum = 0, lapSum2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      if (!mask[k]) continue;
      const v = gray[k]; n++; sum += v; sum2 += v * v;
      const lap = gray[k - 1] + gray[k + 1] + gray[k - w] + gray[k + w] - 4 * v;
      lapN++; lapSum += lap; lapSum2 += lap * lap;
    }
  }
  const mean = n ? sum / n : 0;
  const std = n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0;
  const lapVar = lapN ? lapSum2 / lapN - (lapSum / lapN) ** 2 : 0;
  const b = bbox(palmPoly);
  const palmFraction = ((b.x1 - b.x0) * (b.y1 - b.y0)) / (w * h);
  const inFrame = allLandmarksPx.every((p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h);
  const t = QUALITY_THRESHOLDS;
  const issues: QualityIssue[] = [];
  if (mean < t.minBrightness) issues.push('too-dark');
  if (mean > t.maxBrightness) issues.push('too-bright');
  if (std < t.minContrast) issues.push('low-contrast');
  if (lapVar < t.minSharpness) issues.push('blurry');
  if (palmFraction < t.minPalmFraction) issues.push('hand-too-small');
  if (!inFrame) issues.push('hand-cut-off');
  if (Math.abs(rotationDeg) > t.maxAbsRotationDeg) issues.push('hand-rotated');
  return { brightness: mean, contrast: std, sharpness: lapVar, palmFraction, inFrame, issues };
}
