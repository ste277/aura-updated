/**
 * AURA-PALM-G5-I1 -- decode + normalise. Turns an image source into a
 * PalmFrame: upright pixels, long edge <= 1280 px, held in a canvas the
 * pipeline owns. Re-drawing into a fresh canvas also drops every metadata
 * block (EXIF, GPS, XMP, ICC text): nothing but RGBA pixels survives.
 *
 * Two entry points share the same frame type:
 *   - normalizeImageBlob(file)        uploads (this ticket)
 *   - normalizeDrawableFrame(source)  camera frames / any drawable (G5-I2)
 */
import { checkDimensions, orientedSize, PALM_IMAGE_LIMITS, type ImageHeaderInfo } from './validate';
import { PalmPipelineError, type PalmCanvasFactory, type PalmCanvasLike, type PalmFrame, type PalmImageSourceKind } from './types';

/** A decoded image the pipeline can draw once and must close. */
export interface PalmDecodedImage {
  readonly width: number;
  readonly height: number;
  readonly source: unknown; // CanvasImageSource
  close(): void;
}

export type PalmImageDecoder = (blob: Blob) => Promise<PalmDecodedImage>;

/** Injectable browser surface (tests replace these; nothing is global-patched). */
export interface PalmNormalizeEnv {
  createCanvas: PalmCanvasFactory;
  decode: PalmImageDecoder;
}

export function defaultCanvasFactory(width: number, height: number): PalmCanvasLike {
  if (typeof document === 'undefined') throw new PalmPipelineError('unsupported-browser');
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c as unknown as PalmCanvasLike;
}

/**
 * Default decoder. Prefers createImageBitmap with EXIF orientation applied
 * ('from-image'); retries without options for engines that reject the
 * option bag; falls back to an <img> decode through a short-lived object URL
 * that is revoked in `finally`, success or failure.
 */
export function createDefaultDecoder(deps: {
  createImageBitmap?: (b: Blob, o?: any) => Promise<any>;
  createObjectURL?: (b: Blob) => string;
  revokeObjectURL?: (u: string) => void;
  createImage?: () => any;
} = {}): PalmImageDecoder {
  const cib = deps.createImageBitmap ?? (typeof createImageBitmap === 'function' ? (b: Blob, o?: any) => (o ? createImageBitmap(b, o) : createImageBitmap(b)) : undefined);
  const toUrl = deps.createObjectURL ?? (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? (b: Blob) => URL.createObjectURL(b) : undefined);
  const revoke = deps.revokeObjectURL ?? (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function' ? (u: string) => URL.revokeObjectURL(u) : undefined);
  const newImage = deps.createImage ?? (typeof Image !== 'undefined' ? () => new Image() : undefined);

  return async (blob: Blob) => {
    if (cib) {
      let bmp: any;
      try {
        bmp = await cib(blob, { imageOrientation: 'from-image' });
      } catch (err) {
        // TypeError = option bag not supported; anything else = undecodable.
        if (!(err instanceof TypeError)) throw new PalmPipelineError('corrupt-image');
        try {
          bmp = await cib(blob);
        } catch {
          throw new PalmPipelineError('corrupt-image');
        }
      }
      return { width: bmp.width, height: bmp.height, source: bmp, close: () => bmp.close?.() };
    }
    if (!toUrl || !revoke || !newImage) throw new PalmPipelineError('unsupported-browser');
    const url = toUrl(blob);
    try {
      const img = newImage();
      img.decoding = 'async';
      img.src = url;
      try {
        await img.decode();
      } catch {
        throw new PalmPipelineError('corrupt-image');
      }
      const w = img.naturalWidth, h = img.naturalHeight;
      return { width: w, height: h, source: img, close: () => { img.src = ''; } };
    } finally {
      revoke(url);
    }
  };
}

let frameSeq = 0;

function makeFrame(source: PalmImageSourceKind, canvas: PalmCanvasLike, ow: number, oh: number, orientation: PalmFrame['orientation']): PalmFrame {
  frameSeq++;
  let released = false;
  return {
    source,
    canvas,
    width: canvas.width,
    height: canvas.height,
    originalWidth: ow,
    originalHeight: oh,
    orientation,
    get released() { return released; },
    release() {
      if (released) return;
      released = true;
      try {
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      } catch { /* context may be lost already */ }
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export function scaleToFit(w: number, h: number, maxEdge = PALM_IMAGE_LIMITS.analysisMaxEdgePx): { width: number; height: number } {
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * EXIF transform for orientations the decoder did NOT apply. Draw space is
 * the oriented (display) size; (sw, sh) is the stored size.
 */
function exifTransform(o: number, dw: number, dh: number): [number, number, number, number, number, number] {
  switch (o) {
    case 2: return [-1, 0, 0, 1, dw, 0];
    case 3: return [-1, 0, 0, -1, dw, dh];
    case 4: return [1, 0, 0, -1, 0, dh];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, dw, 0];
    case 7: return [0, -1, -1, 0, dw, dh];
    case 8: return [0, -1, 1, 0, 0, dh];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

/** Decode a validated upload into a normalised frame. */
export async function normalizeImageBlob(blob: Blob, header: ImageHeaderInfo | null, env: PalmNormalizeEnv): Promise<PalmFrame> {
  let decoded: PalmDecodedImage;
  try {
    decoded = await env.decode(blob);
  } catch (err) {
    throw err instanceof PalmPipelineError ? err : new PalmPipelineError('corrupt-image');
  }
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new PalmPipelineError('corrupt-image');
    const exif = header?.exifOrientation ?? 1;
    // Did the decoder honour EXIF? For 5-8 the display size is transposed,
    // so a decoder that ignored EXIF returns the stored (untransposed) size.
    let orientation: PalmFrame['orientation'] = exif === 1 ? 'none' : 'decoder';
    let manual = 1;
    if (exif >= 5 && header && decoded.width !== decoded.height) {
      const want = orientedSize(header);
      if (decoded.width === header.width && decoded.height === header.height && want.width !== header.width) {
        orientation = 'manual';
        manual = exif;
      }
    }
    const ow = manual >= 5 ? decoded.height : decoded.width;
    const oh = manual >= 5 ? decoded.width : decoded.height;
    const dimError = checkDimensions(ow, oh);
    if (dimError) throw new PalmPipelineError(dimError);
    const { width, height } = scaleToFit(ow, oh);
    const canvas = env.createCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new PalmPipelineError('unsupported-browser');
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    if (manual !== 1 && ctx.setTransform) {
      const [a, b, c, d, e, f] = exifTransform(manual, width, height);
      ctx.setTransform(a, b, c, d, e, f);
      // In the rotated space the stored image is drawn at its stored aspect.
      const sw = manual >= 5 ? height : width, sh = manual >= 5 ? width : height;
      ctx.drawImage(decoded.source, 0, 0, sw, sh);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(decoded.source, 0, 0, width, height);
    }
    return makeFrame('upload', canvas, ow, oh, orientation);
  } finally {
    decoded.close();
  }
}

/**
 * G5-I2 entry point: wrap any drawable (video element, ImageBitmap, canvas)
 * of known size as a normalised frame. Camera frames are already upright
 * pixels without EXIF, so only the downscale applies.
 */
export function normalizeDrawableFrame(drawable: unknown, width: number, height: number, source: PalmImageSourceKind, env: Pick<PalmNormalizeEnv, 'createCanvas'>): PalmFrame {
  const dimError = checkDimensions(width, height);
  if (dimError) throw new PalmPipelineError(dimError);
  const size = scaleToFit(width, height);
  const canvas = env.createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new PalmPipelineError('unsupported-browser');
  ctx.drawImage(drawable, 0, 0, size.width, size.height);
  return makeFrame(source, canvas, width, height, 'none');
}

/** Test/diagnostic hook: how many frames have been created in this process. */
export function framesCreated(): number {
  return frameSeq;
}
