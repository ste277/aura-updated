/**
 * AURA-PALM-G5-I1 -- upload validation, run entirely on-device BEFORE any
 * pixel decode. The authoritative format decision comes from the file's own
 * leading bytes ("magic numbers"), never from the file name or the
 * browser-reported MIME type alone, and declared dimensions are read from the
 * container header so an oversized image (decompression bomb) is refused
 * without being decoded.
 *
 * Limits (rationale in AURA_PALM_G5_I1_UPLOAD_PIPELINE/06_IMAGE_VALIDATION_RULES.md):
 *   - formats: JPEG, PNG, WebP (HEIC/HEIF/AVIF get a dedicated message)
 *   - file size: 1 byte .. 15 MiB
 *   - short edge >= 256 px; long edge <= 10 000 px; <= 40 megapixels
 *   - analysis canvas: long edge downscaled to <= 1280 px (G4-A setting)
 */
import type { PalmInputError, PalmInputErrorCode, SupportedPalmFormat } from './types';

export const PALM_IMAGE_LIMITS = Object.freeze({
  maxFileBytes: 15 * 1024 * 1024,
  minShortEdgePx: 256,
  maxLongEdgePx: 10_000,
  maxPixels: 40_000_000,
  analysisMaxEdgePx: 1280,
  /** Bytes read for header sniffing (JPEG SOF can follow a large EXIF block). */
  headerReadBytes: 512 * 1024,
});

/** `accept` attribute for the picker. No `capture` attribute is ever set. */
export const PALM_UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp';

export const PALM_INPUT_MESSAGES: Record<PalmInputErrorCode, string> = {
  'empty-file': 'That file is empty. Please choose a photo.',
  'file-too-large': 'That file is larger than 15 MB. Please choose a smaller photo.',
  'unsupported-format': 'That file type is not supported. Please choose a JPEG, PNG or WebP photo.',
  'heic-unsupported': 'HEIC/HEIF photos are not supported here. Please export the photo as JPEG (on iPhone: Settings > Camera > Formats > Most Compatible), or choose a JPEG or PNG.',
  'corrupt-image': 'This image could not be read. It may be damaged or incomplete. Please choose another photo.',
  'dimensions-too-small': 'This image is too small to check. Please choose a photo that is at least 256 pixels on its shorter side.',
  'dimensions-too-large': 'This image is too large to check on this device (over 40 megapixels or 10,000 pixels on a side). Please choose a standard-resolution photo.',
  'unsupported-browser': 'This browser cannot run the on-device image check. Please try a recent version of Chrome, Safari, Edge or Firefox.',
  'model-unavailable': 'The on-device hand model could not be loaded, so the photo was not checked. Please try again.',
  'analysis-failed': 'Something went wrong while checking this photo. Please try again or choose another photo.',
  'feature-disabled': 'Photo checks are not available in this build.',
  'runtime-unsafe': 'The on-device hand check has stopped so that nothing leaves this device. Reload the page before checking another photo.',
};

export function palmInputError(code: PalmInputErrorCode): PalmInputError {
  return { code, message: PALM_INPUT_MESSAGES[code], retryable: code === 'model-unavailable' || code === 'analysis-failed' };
}

export type SniffedFormat = SupportedPalmFormat | 'heic' | 'avif' | 'gif' | 'bmp' | 'tiff' | 'svg' | 'unknown';

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, len: number) => (b.length >= at + len ? String.fromCharCode(...Array.from(b.subarray(at, at + len))) : '');

/** Identify the container from its leading bytes. */
export function sniffImageFormat(b: Uint8Array): SniffedFormat {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brands = [ascii(b, 8, 4), ...Array.from({ length: 6 }, (_, i) => ascii(b, 16 + i * 4, 4))];
    if (brands.some((x) => x === 'avif' || x === 'avis')) return 'avif';
    if (brands.some((x) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(x))) return 'heic';
  }
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 2) === 'BM') return 'bmp';
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return 'tiff';
  const head = ascii(b, 0, Math.min(b.length, 256)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return 'unknown';
}

export interface ImageHeaderInfo {
  width: number;
  height: number;
  /** EXIF orientation 1-8 (JPEG only; 1 when absent). */
  exifOrientation: number;
}

/** Display size after EXIF orientation (5-8 swap width and height). */
export function orientedSize(info: ImageHeaderInfo): { width: number; height: number } {
  return info.exifOrientation >= 5 && info.exifOrientation <= 8 ? { width: info.height, height: info.width } : { width: info.width, height: info.height };
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

function readExifOrientation(b: Uint8Array, start: number, end: number): number {
  // APP1 payload: "Exif\0\0" + TIFF header.
  if (ascii(b, start, 6) !== 'Exif\u0000\u0000') return 1;
  const t = start + 6;
  if (t + 8 > end) return 1;
  const le = ascii(b, t, 2) === 'II';
  if (!le && ascii(b, t, 2) !== 'MM') return 1;
  const r16 = (i: number) => (le ? u16le(b, i) : u16be(b, i));
  const r32 = (i: number) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i));
  if (r16(t + 2) !== 42) return 1;
  const ifd = t + r32(t + 4);
  if (ifd + 2 > end) return 1;
  const count = r16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) return 1;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

function parseJpeg(b: Uint8Array): ImageHeaderInfo | null {
  let i = 2;
  let orientation = 1;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null; // lost sync: corrupt
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any SOF
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    const segStart = i + 4;
    const segEnd = i + 2 + len;
    if (marker === 0xe1 && orientation === 1) orientation = readExifOrientation(b, segStart, Math.min(segEnd, b.length));
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (segStart + 5 > b.length) return null;
      return { height: u16be(b, segStart + 1), width: u16be(b, segStart + 3), exifOrientation: orientation };
    }
    i = segEnd;
  }
  return null; // SOF not inside the header window
}

function parsePng(b: Uint8Array): ImageHeaderInfo | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: u32be(b, 16), height: u32be(b, 20), exifOrientation: 1 };
}

function parseWebp(b: Uint8Array): ImageHeaderInfo | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30) {
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, exifOrientation: 1 };
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    if (b[20] !== 0x2f) return null;
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, exifOrientation: 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, exifOrientation: 1 };
  }
  return null;
}

export function parseImageHeader(format: SupportedPalmFormat, b: Uint8Array): ImageHeaderInfo | null {
  return format === 'jpeg' ? parseJpeg(b) : format === 'png' ? parsePng(b) : parseWebp(b);
}

/** Dimension policy, shared by the header pre-check and the post-decode check. */
export function checkDimensions(width: number, height: number): PalmInputErrorCode | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return 'corrupt-image';
  const L = PALM_IMAGE_LIMITS;
  if (Math.max(width, height) > L.maxLongEdgePx || width * height > L.maxPixels) return 'dimensions-too-large';
  if (Math.min(width, height) < L.minShortEdgePx) return 'dimensions-too-small';
  return null;
}

/** Minimal Blob surface (File in browsers, Blob in Node >= 18). */
export interface PalmBlobLike {
  readonly size: number;
  readonly type: string;
  readonly name?: string;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export type PalmValidationResult =
  | { ok: true; format: SupportedPalmFormat; header: ImageHeaderInfo | null; declaredTypeMismatch: boolean }
  | { ok: false; error: PalmInputError };

const MIME_FOR: Record<SupportedPalmFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * Validate a picked file without decoding pixels. Never reads more than
 * PALM_IMAGE_LIMITS.headerReadBytes, never touches the network.
 */
export async function validatePalmImageFile(file: PalmBlobLike): Promise<PalmValidationResult> {
  const fail = (code: PalmInputErrorCode): PalmValidationResult => ({ ok: false, error: palmInputError(code) });
  if (!file || typeof file.size !== 'number' || file.size <= 0) return fail('empty-file');
  if (file.size > PALM_IMAGE_LIMITS.maxFileBytes) return fail('file-too-large');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.slice(0, Math.min(file.size, PALM_IMAGE_LIMITS.headerReadBytes)).arrayBuffer());
  } catch {
    return fail('corrupt-image');
  }
  const sniffed = sniffImageFormat(bytes);
  const declared = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (sniffed === 'heic' || sniffed === 'avif') return fail('heic-unsupported');
  if (sniffed !== 'jpeg' && sniffed !== 'png' && sniffed !== 'webp') {
    // Unknown bytes but a HEIC label: still give the useful HEIC message.
    if (sniffed === 'unknown' && (/hei[cf]/.test(declared) || /\.hei[cf]$/.test(name))) return fail('heic-unsupported');
    return fail('unsupported-format');
  }
  const header = parseImageHeader(sniffed, bytes);
  // PNG/WebP keep their size in the first bytes: no header means corrupt.
  // A JPEG may place SOF beyond the window; the post-decode check covers it.
  if (!header && sniffed !== 'jpeg') return fail('corrupt-image');
  if (!header && bytes.length >= file.size) return fail('corrupt-image');
  if (header) {
    const dimError = checkDimensions(header.width, header.height);
    if (dimError) return fail(dimError);
  }
  return { ok: true, format: sniffed, header, declaredTypeMismatch: declared !== '' && declared !== MIME_FOR[sniffed] };
}
