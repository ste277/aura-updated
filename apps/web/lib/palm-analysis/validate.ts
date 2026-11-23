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
  /**
   * AURA-PALM-G5-C5 (F-1): a JPEG whose SOF lies beyond the first window is
   * located by walking its marker segments through further windows of
   * headerReadBytes. A segment is at most 65 537 bytes, so every window
   * advances by at least headerReadBytes - 65 537 bytes; this bound covers a
   * maxFileBytes file with margin and is enforced as a hard cap.
   */
  maxJpegHeaderReads: Math.ceil((15 * 1024 * 1024) / (512 * 1024 - 65_537)) + 2,
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

/**
 * Result of walking JPEG marker segments over one window of the file.
 *   found   -- the frame header (SOF) was read;
 *   corrupt -- the stream is malformed, or ends (EOI/SOS/end of file) before any SOF;
 *   more    -- the window ended first; resume at absolute `offset`.
 */
type JpegScan =
  | { kind: 'found'; info: ImageHeaderInfo }
  | { kind: 'corrupt' }
  | { kind: 'more'; offset: number; orientation: number; sof: ImageHeaderInfo | null };

/** SOFn: frame headers browsers decode or reject (C0-C3, C5-C7, C9-CB, CD-CF). */
const isSofMarker = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/**
 * AURA-PALM-G5-C7 (C6-F1): the ONLY markers allowed between SOI and SOS,
 * besides the single SOF and 0xFF fill bytes: APP0-APP15, COM, DQT, DHT, DRI
 * and DAC -- the table/misc segments ITU T.81 B.2.4 permits there. Every one
 * carries a 2-byte length, so every decoder skips them identically.
 *
 * Everything else is rejected, because decoders disagree about it:
 * RST0-7 (D0-D7) and TEM (01) are length-less to libjpeg but WebKit/ImageIO
 * skips a 2-byte length after them, so a crafted file showed the validator a
 * fake 300 x 300 SOF while ImageIO decoded the real 12000 x 400 one (C6-F1).
 * A second SOI, DNL (DC), DHP/EXP (DE/DF), JPG (C8), JPGn (F0-FD), reserved
 * (02-BF) and stuffed 0x00 have no legitimate place before SOS in a baseline
 * or progressive photo; libjpeg already refuses them there.
 */
const isAllowedTableMarker = (m: number) =>
  (m >= 0xe0 && m <= 0xef) || m === 0xfe || m === 0xdb || m === 0xc4 || m === 0xdd || m === 0xcc;

/**
 * AURA-PALM-G5-C5 (F-1) / C7 (C6-F1): walk JPEG markers in `b`, which holds
 * the file bytes [base, base + b.length), starting at absolute offset
 * `start`, from SOI to the first SOS. Segment bodies are skipped by their
 * declared length and never buffered beyond the window. The SOF and the first
 * APP1 (EXIF orientation) are only interpreted when the whole segment is
 * inside the window; otherwise the caller re-reads from the segment start, so
 * a straddling header is never parsed truncated.
 *
 * C7: fail closed on any marker outside the allowlist, and require EXACTLY ONE
 * SOF before SOS (a second SOF is ambiguous: decoders differ on which wins).
 * The dimensions are only reported once SOS is reached, i.e. once the whole
 * header sequence a decoder will act on has been checked.
 */
function scanJpeg(b: Uint8Array, base: number, start: number, orientation: number, sofIn: ImageHeaderInfo | null, atEof: boolean): JpegScan {
  const corrupt: JpegScan = { kind: 'corrupt' };
  let sof = sofIn;
  const more = (at: number): JpegScan => (atEof || base + at <= start ? corrupt : { kind: 'more', offset: base + at, orientation, sof });
  let i = start - base;
  for (;;) {
    if (i + 2 > b.length) return more(i);
    if (b[i] !== 0xff) return corrupt; // lost sync
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xda) return sof ? { kind: 'found', info: sof } : corrupt; // SOS: header sequence complete
    const sofHere = isSofMarker(marker);
    if (!sofHere && !isAllowedTableMarker(marker)) return corrupt; // RSTn, TEM, SOI, EOI, DNL, JPGn, reserved, 0x00 ...
    if (sofHere && sof) return corrupt; // a second frame header before SOS
    if (i + 4 > b.length) return more(i);
    const len = u16be(b, i + 2);
    if (len < 2) return corrupt;
    const segEnd = i + 2 + len;
    const wantExif = marker === 0xe1 && orientation === 1 && !sof;
    if ((sofHere || wantExif) && segEnd > b.length) return more(i);
    if (wantExif) orientation = readExifOrientation(b, i + 4, segEnd);
    if (sofHere) {
      // precision(1) height(2) width(2) components(1) at least.
      if (len < 8) return corrupt;
      sof = { height: u16be(b, i + 5), width: u16be(b, i + 7), exifOrientation: orientation };
      // An out-of-limit frame header is rejected at once: nothing later in
      // the file can make it acceptable, so there is no need to read on.
      if (checkDimensions(sof.width, sof.height)) return { kind: 'found', info: sof };
    }
    i = segEnd;
  }
}

function parseJpeg(b: Uint8Array): ImageHeaderInfo | null {
  const r = scanJpeg(b, 0, 2, 1, null, true);
  return r.kind === 'found' ? r.info : null;
}

/**
 * Locate the JPEG frame header anywhere in the file with bounded work: at
 * most maxJpegHeaderReads windows of headerReadBytes, one held at a time,
 * each strictly further into the file. Returns null when the file is not a
 * well-formed JPEG up to its SOF (the caller rejects it as corrupt).
 */
async function locateJpegHeader(file: PalmBlobLike, first: Uint8Array): Promise<ImageHeaderInfo | null> {
  const L = PALM_IMAGE_LIMITS;
  // A JPEG must start with exactly one SOI (FF D8); the walk begins after it.
  let scan = scanJpeg(first, 0, 2, 1, null, first.length >= file.size);
  let reads = 1;
  while (scan.kind === 'more') {
    reads++;
    if (reads > L.maxJpegHeaderReads || scan.offset >= file.size) return null;
    const base = scan.offset;
    const end = Math.min(file.size, base + L.headerReadBytes);
    const buf = new Uint8Array(await file.slice(base, end).arrayBuffer());
    if (buf.length !== end - base) return null; // short read
    scan = scanJpeg(buf, base, base, scan.orientation, scan.sof, end >= file.size);
  }
  return scan.kind === 'found' ? scan.info : null;
}

function parsePng(b: Uint8Array): ImageHeaderInfo | null {
  // IHDR must be the first chunk and exactly 13 bytes long (PNG spec 11.2.2).
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR' || u32be(b, 8) !== 13) return null;
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
  // AURA-PALM-G5-C5 (F-1): every accepted file has its declared dimensions
  // checked HERE, before any decode. PNG/WebP keep their size in the first
  // bytes; a JPEG's SOF is located through bounded windowed reads however far
  // into the file it lies. No header means corrupt -- nothing is decoded on
  // the strength of the post-decode check alone (that check stays as defence
  // in depth in normalize.ts).
  let header: ImageHeaderInfo | null;
  try {
    header = sniffed === 'jpeg' ? await locateJpegHeader(file, bytes) : parseImageHeader(sniffed, bytes);
  } catch {
    return fail('corrupt-image');
  }
  if (!header) return fail('corrupt-image');
  const dimError = checkDimensions(header.width, header.height);
  if (dimError) return fail(dimError);
  return { ok: true, format: sniffed, header, declaredTypeMismatch: declared !== '' && declared !== MIME_FOR[sniffed] };
}
