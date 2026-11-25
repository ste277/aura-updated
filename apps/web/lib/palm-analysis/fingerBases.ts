/**
 * AURA-PALM-03-E1 -- finger-base positions in the PALM-03-I1 palm frame.
 * DEVELOPMENT ONLY. Synthetic tests only. Not imported by any UI module, and
 * excluded from production builds with the rest of lib/palm-analysis.
 *
 * The four finger knuckles (landmarks 5, 9, 13, 17) expressed in the same palm
 * frame as I1 traces (origin at landmark 5, x towards landmark 17, y towards
 * the wrist, unit = palm width), so a line ending can be compared with the
 * finger bases. By construction the index base is (0, 0) and the little-finger
 * base is (1, 0). Pure: no estimation, no clamping, nothing inferred about
 * palm lines. Returns null fields with a reason when no frame is available.
 */
import { createHash } from 'crypto';
import { LM } from './quality';
import { buildPalmFeatureSet, palmFrameFromLandmarks, imageToPalm, type NormPoint, type PalmFeatureSet, type PalmFeatureSetInput, type PalmFrameInfo } from './features';

export const PALM_FINGER_BASES_VERSION = 'palm-03-e1-finger-bases@0.1.0';

export interface PalmFingerBases {
  readonly index: NormPoint;
  readonly middle: NormPoint;
  readonly ring: NormPoint;
  readonly little: NormPoint;
}

export type PalmFingerBasesResult =
  | { readonly ok: true; readonly bases: PalmFingerBases }
  | { readonly ok: false; readonly reason: Exclude<PalmFrameInfo['reason'], 'ok'> };

const round4 = (v: number) => Math.round(v * 10000) / 10000 + 0;

export function palmFingerBases(landmarks: PalmFeatureSetInput['landmarks'], imageWidth: number, imageHeight: number): PalmFingerBasesResult {
  const { frame, reason } = palmFrameFromLandmarks(landmarks, imageWidth, imageHeight);
  if (!frame || reason !== 'ok') return Object.freeze({ ok: false as const, reason: reason as Exclude<PalmFrameInfo['reason'], 'ok'> });
  const lm = landmarks as ReadonlyArray<NormPoint>;
  const at = (k: number): NormPoint => {
    const p = imageToPalm(frame, { x: lm[k].x, y: lm[k].y });
    return Object.freeze({ x: round4(p.x), y: round4(p.y) });
  };
  return Object.freeze({
    ok: true as const,
    bases: Object.freeze({ index: at(LM.INDEX_MCP), middle: at(LM.MIDDLE_MCP), ring: at(LM.RING_MCP), little: at(LM.PINKY_MCP) }),
  });
}

// ---------------------------------------------------------------- sealed observation (PALM-03-E1-R2, finding F6)
// The feature set and the finger bases are derived here from ONE input, so they always describe the same frame. A
// frame id (digest of the landmarks and image size) and a seal (digest of everything in the envelope) bind them; the
// consumer recomputes the seal and refuses any mismatch, e.g. finger bases taken from a different hand. The seal
// guards against mispairing, not against a deliberate forger: it is not keyed (development-only, synthetic input).

export const PALM_OBSERVATION_ENVELOPE = Object.freeze({ kind: 'palm-03-e1-observation', version: '0.1.0' });

/** Canonical JSON: sorted keys, undefined omitted. Must match canonicalJson() on the consumer side. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export interface PalmObservationEnvelope {
  readonly kind: 'palm-03-e1-observation';
  readonly version: '0.1.0';
  readonly frameId: string;
  readonly featureSet: PalmFeatureSet;
  readonly fingerBases: PalmFingerBases | null;
  readonly fingerBasesReason: Exclude<PalmFrameInfo['reason'], 'ok'> | null;
  readonly seal: string;
}

export type PalmObservationResult =
  | { readonly ok: true; readonly envelope: PalmObservationEnvelope }
  | { readonly ok: false; readonly errors: readonly string[] };

export function buildPalmE1Observation(input: PalmFeatureSetInput): PalmObservationResult {
  const built = buildPalmFeatureSet(input);
  if (!built.ok) return built;
  const fb = palmFingerBases(input.landmarks, input.imageWidth, input.imageHeight);
  const frameId = sha256(canonicalJson({ imageWidth: input.imageWidth, imageHeight: input.imageHeight, landmarks: input.landmarks ?? null }));
  const body = {
    kind: PALM_OBSERVATION_ENVELOPE.kind,
    version: PALM_OBSERVATION_ENVELOPE.version,
    frameId,
    featureSet: built.featureSet,
    fingerBases: fb.ok ? fb.bases : null,
    fingerBasesReason: fb.ok ? null : fb.reason,
  } as const;
  const seal = sha256(canonicalJson(body));
  return Object.freeze({ ok: true as const, envelope: Object.freeze({ ...body, seal }) });
}
