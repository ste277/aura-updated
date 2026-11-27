/**
 * AURA-PALM-04-I1 -- the in-memory HAND CONSTRUCTION CONTEXT.
 * DEVELOPMENT ONLY (behind the G5 image-input gate; excluded from production builds with the rest of
 * lib/palm-analysis). Synthetic tests only.
 *
 * What the assisted-tracing step needs from the analysed photo: the hand landmarks (normalised [0,1]), the
 * handedness label, the analysed frame size, the rotation and the G5 quality codes -- exactly the I1
 * PalmFeatureSetInput fields that come from the image. The G5 PalmAnalysisResult deliberately carries none of the
 * landmarks; this context is the ONLY place they are kept after analysis, and it is:
 *   - in memory only: never persisted, never logged, never transmitted, never rendered, never part of the
 *     session state or the analysis result;
 *   - owned by the session and REVOKED by it on reset (clear), photo replacement (a new submit), cancellation
 *     (a superseded generation, a retry, a failed analysis) and teardown (dispose);
 *   - opaque: the handle exposes no data properties. read() returns a fresh frozen copy while the context is
 *     active and null once it is revoked, and the handle's own reference to the data is dropped on revoke, so a
 *     revoked context holds nothing. JSON.stringify(handle) reveals only { kind, generation, active }.
 */
import type { PalmFeedbackCode } from './types';

export const PALM_CONSTRUCTION_CONTEXT_VERSION = 'palm-04-construction-context@0.1.0';

export interface PalmConstructionData {
  /** The analysed (normalised) frame size; traces and landmarks are normalised to it. */
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** The 21 hand landmarks, normalised [0,1] (MediaPipe convention). */
  readonly landmarks: ReadonlyArray<Readonly<{ x: number; y: number; z?: number }>>;
  readonly handednessLabel?: string;
  /** The analysed rotation, as reported in the G5 result metrics. */
  readonly rotationDeg: number;
  /** The G5 quality codes of the same frame (empty when accepted). */
  readonly qualityIssues: readonly PalmFeedbackCode[];
}

export interface PalmConstructionContext {
  /** The session generation this context belongs to. */
  readonly generation: number;
  /** True until the session revokes it (reset, replacement, cancellation, teardown). */
  isActive(): boolean;
  /** A fresh frozen copy of the data while active; null once revoked. */
  read(): PalmConstructionData | null;
  /** Serialises to { kind, generation, active } only -- never the landmarks. */
  toJSON(): { kind: string; generation: number; active: boolean };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const own = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);

type Landmark = Readonly<{ x: number; y: number; z?: number }>;

function copyData(d: PalmConstructionData): PalmConstructionData {
  return Object.freeze({
    imageWidth: d.imageWidth,
    imageHeight: d.imageHeight,
    landmarks: Object.freeze(d.landmarks.map((p) => Object.freeze(p.z === undefined ? { x: p.x, y: p.y } : { x: p.x, y: p.y, z: p.z }))),
    ...(d.handednessLabel === undefined ? {} : { handednessLabel: d.handednessLabel }),
    rotationDeg: d.rotationDeg,
    qualityIssues: Object.freeze([...d.qualityIssues]),
  });
}

/**
 * R1: one-pass snapshot + validation of the detector landmarks, under the frozen I1 landmark contract
 * (measurements.ts readLandmarks / features.ts palmFrameFromLandmarks): a dense array of exactly 21 entries, every
 * index an own property (holes are rejected explicitly -- Array.prototype.every skips them), every entry a non-null
 * object with finite x and y in [0, 1] (boundaries inclusive) and, if present, a finite z. Each entry and each
 * coordinate is read exactly once, and the returned plain copy is what the context keeps, so the validated values
 * and the stored values are the same snapshot. Returns null for any malformed input; never throws.
 */
function snapshotLandmarks(lm: unknown): Landmark[] | null {
  try {
    if (!Array.isArray(lm) || lm.length !== 21) return null;
    const out: Landmark[] = [];
    for (let k = 0; k < 21; k++) {
      if (!own(lm, k)) return null;
      const p: unknown = lm[k];
      if (p === null || typeof p !== 'object') return null;
      const x: unknown = (p as { x?: unknown }).x, y: unknown = (p as { y?: unknown }).y, z: unknown = (p as { z?: unknown }).z;
      if (!isNum(x) || !isNum(y) || (z !== undefined && !isNum(z))) return null;
      if (x < 0 || x > 1 || y < 0 || y > 1) return null;
      out.push(z === undefined ? { x, y } : { x, y, z: z as number });
    }
    return out;
  } catch {
    return null; // a throwing accessor or proxy is malformed input, not a crash
  }
}

/**
 * Create a context from one analysed hand. `isCurrent` lets the owning session tie validity to its own generation
 * as well (belt and braces: the session also revokes explicitly). Returns null -- a controlled rejection, never an
 * active malformed context -- unless the hand meets the frozen I1 landmark contract (snapshotLandmarks) and the frame
 * size is finite and positive.
 */
export function createConstructionContext(
  source: PalmConstructionData,
  generation: number,
  isCurrent: () => boolean,
): { context: PalmConstructionContext; revoke: () => void } | null {
  if (!source || !isNum(source.imageWidth) || !isNum(source.imageHeight) || source.imageWidth <= 0 || source.imageHeight <= 0) return null;
  const landmarks = snapshotLandmarks(source.landmarks);
  if (!landmarks) return null;
  let data: PalmConstructionData | null = copyData({ ...source, landmarks });
  const active = () => data !== null && isCurrent();
  const context: PalmConstructionContext = Object.freeze({
    generation,
    isActive: active,
    read: () => (active() && data ? copyData(data) : null),
    toJSON: () => ({ kind: PALM_CONSTRUCTION_CONTEXT_VERSION, generation, active: active() }),
  });
  return { context, revoke: () => { data = null; } };
}
