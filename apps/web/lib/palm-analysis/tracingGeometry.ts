/**
 * AURA-PALM-04-I2 -- the ONE image geometry the tracing overlay uses, for drawing (photo, guides, traces) and for
 * reading pointer positions. DEVELOPMENT ONLY (lib/palm-analysis is excluded from production builds). Pure functions:
 * no DOM access, no state, no I/O. It also re-exports, read-only, the approved line names and I1's trace point limits
 * for the overlay (the frozen I1 modules stay off the public surface).
 *
 * The photo is shown inside a stage box of any size with object-fit: contain semantics: scaled uniformly, never
 * distorted, centred, letterboxed on the two remaining sides. The content rectangle that results is the only frame of
 * reference: a normalised image coordinate (x, y in [0, 1], the MediaPipe / I1 convention) maps to
 *   left + x * width, top + y * height
 * of the content rectangle, and a pointer position maps back by the inverse. The stage box itself (its own width and
 * height) is never used as the coordinate frame, so letterboxing, aspect ratio, container resizing and orientation
 * changes cannot shift a recorded point. All values are CSS pixels, the unit of getBoundingClientRect and pointer
 * events, so the device pixel ratio does not enter the mapping.
 *
 * Stroke capture helpers turn a freehand gesture into a trace the frozen I1 builder judges: spacing filter, then
 * arc-length resampling to a bounded number of points (I1 allows at most TRACE_LIMITS.maxPoints). They never decide
 * whether a trace is valid -- that is I1's verdict, via the tracing model.
 */

import { PALM_LINE_IDENTITY, TRACE_LIMITS, type LineUnassessedReason, type PalmLineId } from './features';

export type TracingLineId = PalmLineId;
export type TracingUnassessedReason = LineUnassessedReason;
/** The approved line names (frozen I1 PALM_LINE_IDENTITY), for the overlay's labels. Read-only. */
export const TRACING_LINE_NAMES = PALM_LINE_IDENTITY;
/** I1's own trace point limits (frozen TRACE_LIMITS), for the overlay's instructions and stroke resampling. */
export const TRACE_POINT_LIMITS = Object.freeze({ min: TRACE_LIMITS.minPoints, max: TRACE_LIMITS.maxPoints });

export const PALM_TRACING_GEOMETRY_VERSION = 'palm-04-tracing-geometry@0.1.0';

export interface Rect { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
export interface Pt { readonly x: number; readonly y: number }

const fin = (v: number) => typeof v === 'number' && Number.isFinite(v);

/**
 * The content rectangle of an image of intrinsic size imgW x imgH shown with object-fit: contain inside a box at
 * (box.left, box.top) of size box.width x box.height. Null when any size is not finite and positive.
 */
export function containRect(box: Rect, imgW: number, imgH: number): Rect | null {
  if (![box.left, box.top, box.width, box.height, imgW, imgH].every(fin) || box.width <= 0 || box.height <= 0 || imgW <= 0 || imgH <= 0) return null;
  const scale = Math.min(box.width / imgW, box.height / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** Normalised image coordinate -> CSS position, in the frame of the content rectangle. */
export function imageToClient(p: Pt, content: Rect): Pt {
  return { x: content.left + p.x * content.width, y: content.top + p.y * content.height };
}

/**
 * CSS position -> normalised image coordinate. `inside` is false when the position lies outside the photo (in the
 * letterbox or beyond the stage). The coordinate is NOT clamped: an off-photo position stays off-photo, and I1 judges
 * a trace that leaves the photo (trace-outside-image) instead of the overlay silently moving it.
 */
export function clientToImage(clientX: number, clientY: number, content: Rect): { x: number; y: number; inside: boolean } | null {
  if (!fin(clientX) || !fin(clientY) || content.width <= 0 || content.height <= 0) return null;
  const x = (clientX - content.left) / content.width;
  const y = (clientY - content.top) / content.height;
  return { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

/** Distance between two normalised points, measured in image pixels (so x and y weigh the same on screen). */
export function imageDistance(a: Pt, b: Pt, imgW: number, imgH: number): number {
  return Math.hypot((a.x - b.x) * imgW, (a.y - b.y) * imgH);
}

/** Keep a stroke point only when it is at least `minStepPx` image pixels from the last kept one; the end is kept. */
export function spaceStroke(points: readonly Pt[], imgW: number, imgH: number, minStepPx: number): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    if (!out.length || imageDistance(out[out.length - 1], p, imgW, imgH) >= minStepPx) out.push({ x: p.x, y: p.y });
  }
  const last = points[points.length - 1];
  if (last && out.length && (out[out.length - 1].x !== last.x || out[out.length - 1].y !== last.y)) out.push({ x: last.x, y: last.y });
  return out;
}

/**
 * Resample a stroke to at most `maxPoints` points, evenly spaced along its length (in image pixels), keeping the
 * first and last point. A stroke that already has few enough points is returned as a plain copy.
 */
export function resampleStroke(points: readonly Pt[], maxPoints: number, imgW: number, imgH: number): Pt[] {
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  if (pts.length <= maxPoints || maxPoints < 2) return pts;
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + imageDistance(pts[i - 1], pts[i], imgW, imgH));
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [pts[0], pts[pts.length - 1]];
  const out: Pt[] = [];
  let seg = 1;
  for (let k = 0; k < maxPoints; k++) {
    const target = (total * k) / (maxPoints - 1);
    while (seg < pts.length - 1 && cum[seg] < target) seg++;
    const a = pts[seg - 1], b = pts[seg];
    const span = cum[seg] - cum[seg - 1];
    const t = span > 0 ? Math.min(1, Math.max(0, (target - cum[seg - 1]) / span)) : 0;
    out.push(k === 0 ? pts[0] : k === maxPoints - 1 ? pts[pts.length - 1] : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}
