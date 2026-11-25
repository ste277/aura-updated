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
import { LM } from './quality';
import { palmFrameFromLandmarks, imageToPalm, type NormPoint, type PalmFeatureSetInput, type PalmFrameInfo } from './features';

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
