/**
 * AURA-PALM-G5-I1 -- synthetic test fixtures. Every image here is generated
 * in code: byte-level containers (PNG/JPEG/WebP/HEIC/... headers), flat or
 * noise pixel fields and hand-landmark sets computed from a few hand-picked
 * points. No photograph -- real-palm or otherwise -- is used or needed.
 */
import * as zlib from 'zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A real, decodable greyscale PNG of the given size (small sizes only). */
export function makePng(width: number, height: number, fill = 128): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((width + 1) * Math.min(height, 4096));
  for (let y = 0; y < Math.min(height, 4096); y++) raw.fill(fill, y * (width + 1) + 1, (y + 1) * (width + 1));
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]));
}

/** PNG header only (signature + IHDR) -- for dimension checks of huge sizes. */
export function makePngHeader(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)]));
}

function exifApp1(orientation: number, littleEndian: boolean): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  if (littleEndian) {
    tiff.write('II', 0, 'ascii');
    tiff.writeUInt16LE(42, 2);
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x0112, 10);
    tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(orientation, 18);
  } else {
    tiff.write('MM', 0, 'ascii');
    tiff.writeUInt16BE(42, 2);
    tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8);
    tiff.writeUInt16BE(0x0112, 10);
    tiff.writeUInt16BE(3, 12);
    tiff.writeUInt32BE(1, 14);
    tiff.writeUInt16BE(orientation, 18);
  }
  const payload = Buffer.concat([Buffer.from('Exif\u0000\u0000', 'binary'), tiff]);
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = 0xe1;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** JPEG container header: SOI, optional EXIF APP1, optional padding APPn, SOF0, SOS, EOI. */
export function makeJpegHeader(width: number, height: number, opts: { orientation?: number; littleEndian?: boolean; paddingBytes?: number } = {}): Uint8Array {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (opts.orientation) parts.push(exifApp1(opts.orientation, Boolean(opts.littleEndian)));
  let pad = opts.paddingBytes ?? 0;
  while (pad > 0) {
    const n = Math.min(pad, 65000);
    const seg = Buffer.alloc(4 + n);
    seg[0] = 0xff;
    seg[1] = 0xe2;
    seg.writeUInt16BE(n + 2, 2);
    parts.push(seg);
    pad -= n;
  }
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  parts.push(sof, Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), Buffer.from([0x00, 0x00, 0xff, 0xd9]));
  return new Uint8Array(Buffer.concat(parts));
}

export function makeWebpVp8(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8 ', 12, 'ascii');
  b.writeUInt32LE(20, 16);
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(width & 0x3fff, 26);
  b.writeUInt16LE(height & 0x3fff, 28);
  return new Uint8Array(b);
}
export function makeWebpVp8l(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(24, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8L', 12, 'ascii');
  b.writeUInt32LE(10, 16);
  b[20] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  b.writeUInt32LE(bits >>> 0, 21);
  return new Uint8Array(b);
}
export function makeWebpVp8x(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(24, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return new Uint8Array(b);
}
export function makeFtyp(brand: string, compat: string[] = []): Uint8Array {
  const b = Buffer.alloc(16 + compat.length * 4 + 8);
  b.writeUInt32BE(b.length, 0);
  b.write('ftyp', 4, 'ascii');
  b.write(brand, 8, 'ascii');
  compat.forEach((c, i) => b.write(c, 16 + i * 4, 'ascii'));
  return new Uint8Array(b);
}

/** Minimal Blob-like with an optional fake size (oversize tests never allocate). */
export function blobOf(bytes: Uint8Array, type = '', name = 'photo', fakeSize?: number) {
  return {
    size: fakeSize ?? bytes.length,
    type,
    name,
    slice(start = 0, end = bytes.length) {
      const part = bytes.slice(start, end);
      return { arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) };
    },
  };
}

// ---------------------------------------------------------------- pixels
/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PixelKind = 'textured' | 'dark' | 'bright' | 'flat';

/** RGBA pixel field: textured mid-grey (passes), dark, bright or flat (blurry + low contrast). */
export function makePixels(w: number, h: number, kind: PixelKind, seed = 1): Uint8ClampedArray {
  const r = rng(seed);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = kind === 'flat' ? 128 : kind === 'dark' ? 20 + r() * 12 : kind === 'bright' ? 235 + r() * 15 : 128 + (r() - 0.5) * 120;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return d;
}

export interface FakeCtx {
  calls: { op: string; args: unknown[] }[];
  drawImage(...args: unknown[]): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
  clearRect(...args: unknown[]): void;
  setTransform(...args: unknown[]): void;
  imageSmoothingQuality: string;
}

/** Fake 2D canvas; pixels come from `pixels(w,h)` when read. */
export function makeFakeCanvas(width: number, height: number, pixels: (w: number, h: number) => Uint8ClampedArray = (w, h) => makePixels(w, h, 'textured')) {
  const ctx: FakeCtx = {
    calls: [],
    imageSmoothingQuality: 'low',
    drawImage(...args) { ctx.calls.push({ op: 'drawImage', args }); },
    getImageData(_x, _y, w, h) { ctx.calls.push({ op: 'getImageData', args: [w, h] }); return { data: pixels(w, h), width: w, height: h }; },
    clearRect(...args) { ctx.calls.push({ op: 'clearRect', args }); },
    setTransform(...args) { ctx.calls.push({ op: 'setTransform', args }); },
  };
  const canvas = { width, height, ctx, getContext: () => ctx };
  return canvas;
}

// ---------------------------------------------------------------- hands
export interface P { x: number; y: number }

/** 21 synthetic landmarks of an open hand, fingers up, centred at (0.5, 0.62). */
export function makeHand(opts: { scale?: number; rotateDeg?: number; dx?: number; dy?: number; mirror?: boolean } = {}): P[] {
  const key: Record<number, P> = {
    0: { x: 0.5, y: 0.85 }, 1: { x: 0.36, y: 0.76 }, 2: { x: 0.29, y: 0.64 }, 3: { x: 0.24, y: 0.55 }, 4: { x: 0.2, y: 0.47 },
    5: { x: 0.38, y: 0.45 }, 6: { x: 0.37, y: 0.33 }, 7: { x: 0.36, y: 0.25 }, 8: { x: 0.36, y: 0.18 },
    9: { x: 0.5, y: 0.42 }, 10: { x: 0.5, y: 0.29 }, 11: { x: 0.5, y: 0.2 }, 12: { x: 0.5, y: 0.13 },
    13: { x: 0.6, y: 0.44 }, 14: { x: 0.61, y: 0.32 }, 15: { x: 0.62, y: 0.24 }, 16: { x: 0.62, y: 0.18 },
    17: { x: 0.68, y: 0.5 }, 18: { x: 0.71, y: 0.41 }, 19: { x: 0.73, y: 0.35 }, 20: { x: 0.74, y: 0.3 },
  };
  const s = opts.scale ?? 1;
  const a = ((opts.rotateDeg ?? 0) * Math.PI) / 180;
  const cx = 0.5, cy = 0.55;
  return Array.from({ length: 21 }, (_, i) => {
    let { x, y } = key[i];
    if (opts.mirror) x = 1 - x;
    x = cx + (x - cx) * s;
    y = cy + (y - cy) * s;
    const rx = cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a);
    const ry = cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a);
    return { x: rx + (opts.dx ?? 0), y: ry + (opts.dy ?? 0) };
  });
}
