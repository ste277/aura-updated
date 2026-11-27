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
 * Create a context from one analysed hand. `isCurrent` lets the owning session tie validity to its own generation
 * as well (belt and braces: the session also revokes explicitly). Returns null if the hand is not a complete set
 * of 21 finite landmarks or the frame size is not finite and positive.
 */
export function createConstructionContext(
  source: PalmConstructionData,
  generation: number,
  isCurrent: () => boolean,
): { context: PalmConstructionContext; revoke: () => void } | null {
  if (!isNum(source.imageWidth) || !isNum(source.imageHeight) || source.imageWidth <= 0 || source.imageHeight <= 0) return null;
  if (!Array.isArray(source.landmarks) || source.landmarks.length !== 21) return null;
  if (!source.landmarks.every((p) => p && isNum(p.x) && isNum(p.y) && (p.z === undefined || isNum(p.z)))) return null;
  let data: PalmConstructionData | null = copyData(source);
  const active = () => data !== null && isCurrent();
  const context: PalmConstructionContext = Object.freeze({
    generation,
    isActive: active,
    read: () => (active() && data ? copyData(data) : null),
    toJSON: () => ({ kind: PALM_CONSTRUCTION_CONTEXT_VERSION, generation, active: active() }),
  });
  return { context, revoke: () => { data = null; } };
}
