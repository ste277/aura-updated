/**
 * AURA-PALM-G5-I1 -- shared, typed contract of the on-device palm-image
 * pipeline. One pipeline serves every image source:
 *
 *   input adapter (upload now, camera frame in G5-I2)
 *     -> validate (uploads only: bytes, format, size, dimensions)
 *     -> decode / normalize (upright, EXIF-free RGBA canvas, <= 1280 px)
 *     -> hand landmarks (MediaPipe HandLandmarker, local WASM)
 *     -> quality assessment (ported from G4-A quality.js / geometry.js)
 *     -> feedback (codes + plain-language messages)
 *
 * Privacy rule encoded in these types: a PalmAnalysisResult carries NO pixels
 * and NO landmarks -- only coarse quality numbers, issue codes and a coarse
 * normalised palm box -- so nothing image-derived can drift into storage,
 * logs or analytics by accident. Landmarks exist only transiently inside
 * analyzePalmFrame().
 */

/** Where a frame came from. 'camera' is reserved for G5-I2. */
export type PalmImageSourceKind = 'upload' | 'camera';

export type SupportedPalmFormat = 'jpeg' | 'png' | 'webp';

/** Anything 2D-drawable that MediaPipe and a 2D context accept. */
export interface PalmCanvasLike {
  width: number;
  height: number;
  getContext(kind: '2d', options?: { willReadFrequently?: boolean }): PalmContext2DLike | null;
}

/** The subset of CanvasRenderingContext2D the pipeline uses. */
export interface PalmContext2DLike {
  drawImage(...args: any[]): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray | ArrayLike<number>; width: number; height: number };
  clearRect(x: number, y: number, w: number, h: number): void;
  setTransform?(a: number, b: number, c: number, d: number, e: number, f: number): void;
  imageSmoothingQuality?: string;
}

export type PalmCanvasFactory = (width: number, height: number) => PalmCanvasLike;

/**
 * A normalised frame: upright, downscaled RGBA pixels held in a canvas that
 * the pipeline owns. `release()` zeroes the canvas so the browser can reclaim
 * the pixel buffer (best effort; see the privacy notes in the report).
 */
export interface PalmFrame {
  readonly source: PalmImageSourceKind;
  readonly canvas: PalmCanvasLike;
  readonly width: number;
  readonly height: number;
  /** Original (pre-downscale, oriented) size, for diagnostics only. */
  readonly originalWidth: number;
  readonly originalHeight: number;
  /** How EXIF orientation was honoured: by the decoder, manually, or n/a. */
  readonly orientation: 'none' | 'decoder' | 'manual';
  readonly released: boolean;
  release(): void;
}

/** One detected hand, normalised [0,1] coordinates (MediaPipe convention). */
export interface PalmHandDetection {
  readonly landmarks: ReadonlyArray<{ x: number; y: number; z?: number }>;
  readonly handednessLabel?: string;
  readonly handednessScore?: number;
}

/** The detector seam. Exactly one implementation ships: MediaPipe. */
export interface PalmHandDetector {
  detect(frame: PalmFrame): PalmHandDetection[];
  close(): void;
}

export type PalmHandDetectorFactory = () => Promise<PalmHandDetector>;

/** Input-validation / decode failures (before any analysis runs). */
export type PalmInputErrorCode =
  | 'empty-file'
  | 'file-too-large'
  | 'unsupported-format'
  | 'heic-unsupported'
  | 'corrupt-image'
  | 'dimensions-too-small'
  | 'dimensions-too-large'
  | 'unsupported-browser'
  | 'model-unavailable'
  | 'analysis-failed'
  | 'feature-disabled'
  /** G5-I1-R2: MediaPipe could not be started or shut down safely; reload required. */
  | 'runtime-unsafe';

export interface PalmInputError {
  readonly code: PalmInputErrorCode;
  readonly message: string;
  /** True when retrying the same image could succeed (e.g. model load). */
  readonly retryable: boolean;
}

/** Quality / positioning issues, in priority order of display. */
export type PalmFeedbackCode =
  | 'palm-not-visible'
  | 'hand-cut-off'
  | 'hand-too-small'
  | 'hand-rotated'
  | 'too-dark'
  | 'too-bright'
  | 'low-contrast'
  | 'blurry';

export interface PalmQualityMetrics {
  readonly brightness: number;
  readonly contrast: number;
  readonly sharpness: number;
  /** Bounding-box area of the palm polygon / image area. */
  readonly palmFraction: number;
  readonly rotationDeg: number;
  readonly palmFacing: boolean;
  /** All four fingers extended (a folded finger hides the palm). */
  readonly fingersOpen: boolean;
  readonly inFrame: boolean;
}

export type PalmAnalysisStatus = 'accepted' | 'needs-retake' | 'no-hand' | 'multiple-hands';

export interface PalmAnalysisResult {
  readonly status: PalmAnalysisStatus;
  readonly source: PalmImageSourceKind;
  /** Headline shown to the user. Never claims palm lines were detected. */
  readonly headline: string;
  readonly issues: ReadonlyArray<{ code: PalmFeedbackCode; message: string }>;
  readonly handsDetected: number;
  /** Present only when exactly one hand was found. */
  readonly metrics?: PalmQualityMetrics;
  /** Coarse palm box, normalised [0,1] -- for a positioning outline only. */
  readonly palmBox?: { x0: number; y0: number; x1: number; y1: number };
  readonly timing: { detectMs: number; postMs: number };
}

export class PalmPipelineError extends Error {
  readonly code: PalmInputErrorCode;
  constructor(code: PalmInputErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'PalmPipelineError';
    this.code = code;
  }
}
