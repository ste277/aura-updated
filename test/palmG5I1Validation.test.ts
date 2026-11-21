/**
 * AURA-PALM-G5-I1 -- unit tests: upload validation, header parsing, EXIF
 * orientation, decode/normalise and resource cleanup. Synthetic fixtures only.
 *
 *   npx ts-node test/palmG5I1Validation.test.ts
 */
import { checkDimensions, orientedSize, parseImageHeader, PALM_IMAGE_LIMITS, PALM_UPLOAD_ACCEPT, sniffImageFormat, validatePalmImageFile } from '../apps/web/lib/palm-analysis/validate';
import { createDefaultDecoder, normalizeDrawableFrame, normalizeImageBlob, scaleToFit } from '../apps/web/lib/palm-analysis/normalize';
import { PalmPipelineError } from '../apps/web/lib/palm-analysis/types';
import { blobOf, makeFakeCanvas, makeFtyp, makeJpegHeader, makePng, makePngHeader, makeWebpVp8, makeWebpVp8l, makeWebpVp8x } from './palmG5I1Fixtures';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`OK   ${label}`); } else { failed++; console.log(`FAIL ${label}`); }
}

async function code(p: Promise<any>): Promise<string> {
  const r = await p;
  return r.ok ? 'ok' : r.error.code;
}

async function run() {
  // ------------------------------------------------------------ A. formats
  const okJpeg = await validatePalmImageFile(blobOf(makeJpegHeader(1600, 1200), 'image/jpeg', 'a.jpg'));
  check('A1. valid JPEG accepted, dimensions read from SOF', okJpeg.ok && okJpeg.format === 'jpeg' && okJpeg.header?.width === 1600 && okJpeg.header?.height === 1200);
  const okPng = await validatePalmImageFile(blobOf(makePng(640, 480), 'image/png', 'a.png'));
  check('A2. valid PNG accepted, dimensions read from IHDR', okPng.ok && okPng.format === 'png' && okPng.header?.width === 640 && okPng.header?.height === 480);
  const okWebp = await validatePalmImageFile(blobOf(makeWebpVp8(800, 600), 'image/webp', 'a.webp'));
  check('A3. valid WebP (lossy VP8) accepted', okWebp.ok && okWebp.format === 'webp' && okWebp.header?.width === 800 && okWebp.header?.height === 600);
  const okWebpL = await validatePalmImageFile(blobOf(makeWebpVp8l(1024, 768), 'image/webp'));
  check('A4. valid WebP (lossless VP8L) accepted', okWebpL.ok && okWebpL.header?.width === 1024 && okWebpL.header?.height === 768);
  const okWebpX = await validatePalmImageFile(blobOf(makeWebpVp8x(3000, 2000), 'image/webp'));
  check('A5. valid WebP (extended VP8X) accepted', okWebpX.ok && okWebpX.header?.width === 3000 && okWebpX.header?.height === 2000);
  const mismatch = await validatePalmImageFile(blobOf(makePng(640, 480), 'image/jpeg', 'renamed.jpg'));
  check('A6. format is decided by bytes, not the label (PNG named .jpg accepted, mismatch flagged)', mismatch.ok && mismatch.format === 'png' && mismatch.declaredTypeMismatch === true);
  check('A7. picker accept list is exactly JPEG/PNG/WebP', PALM_UPLOAD_ACCEPT === 'image/jpeg,image/png,image/webp');

  // ------------------------------------------------------------ B. rejects
  check('B1. empty file -> empty-file', (await code(validatePalmImageFile(blobOf(new Uint8Array(0), 'image/jpeg')))) === 'empty-file');
  check('B2. oversized file (15 MiB + 1) -> file-too-large, without reading it', (await code(validatePalmImageFile(blobOf(makeJpegHeader(1000, 1000), 'image/jpeg', 'big.jpg', PALM_IMAGE_LIMITS.maxFileBytes + 1)))) === 'file-too-large');
  check('B3. exactly 15 MiB is allowed', (await code(validatePalmImageFile(blobOf(makeJpegHeader(1000, 1000), 'image/jpeg', 'edge.jpg', PALM_IMAGE_LIMITS.maxFileBytes)))) === 'ok');
  check('B4. GIF -> unsupported-format', (await code(validatePalmImageFile(blobOf(new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000'), 'image/gif')))) === 'unsupported-format');
  check('B5. SVG (scriptable) -> unsupported-format', (await code(validatePalmImageFile(blobOf(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml')))) === 'unsupported-format');
  check('B6. BMP -> unsupported-format', (await code(validatePalmImageFile(blobOf(new TextEncoder().encode('BM\u0000\u0000\u0000\u0000'), 'image/bmp')))) === 'unsupported-format');
  check('B7. plain text labelled image/jpeg -> unsupported-format', (await code(validatePalmImageFile(blobOf(new TextEncoder().encode('hello, not an image'), 'image/jpeg', 'x.jpg')))) === 'unsupported-format');
  check('B8. HEIC bytes -> heic-unsupported (useful message)', (await code(validatePalmImageFile(blobOf(makeFtyp('heic', ['mif1', 'heic']), 'image/heic', 'IMG.HEIC')))) === 'heic-unsupported');
  check('B9. HEIF (mif1 brand) -> heic-unsupported', (await code(validatePalmImageFile(blobOf(makeFtyp('mif1', ['heic']), '')))) === 'heic-unsupported');
  check('B10. AVIF -> heic-unsupported path (same guidance)', (await code(validatePalmImageFile(blobOf(makeFtyp('avif', ['mif1']), 'image/avif')))) === 'heic-unsupported');
  check('B11. unknown bytes but .heic name -> heic-unsupported', (await code(validatePalmImageFile(blobOf(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), '', 'photo.heic')))) === 'heic-unsupported');
  const heicMsg = (await validatePalmImageFile(blobOf(makeFtyp('heic'), 'image/heic'))) as any;
  check('B12. HEIC message tells the user what to do (JPEG / Most Compatible)', /JPEG/.test(heicMsg.error.message) && /Most Compatible/.test(heicMsg.error.message));
  check('B13. PNG signature without IHDR -> corrupt-image', (await code(validatePalmImageFile(blobOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'image/png')))) === 'corrupt-image');
  check('B14. JPEG SOI followed by garbage (lost marker sync) -> corrupt-image', (await code(validatePalmImageFile(blobOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x01, 0x02]), 'image/jpeg')))) === 'corrupt-image');
  check('B15. truncated WebP (RIFF/WEBP, no chunk) -> corrupt-image', (await code(validatePalmImageFile(blobOf(new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBP'), 'image/webp')))) === 'corrupt-image');
  const throwing = { size: 100, type: 'image/png', name: 'x', slice: () => ({ arrayBuffer: async () => { throw new Error('read failed'); } }) };
  check('B16. unreadable file (read error) -> corrupt-image', (await code(validatePalmImageFile(throwing))) === 'corrupt-image');

  // ------------------------------------------------------------ C. dimensions
  check('C1. 255 px short edge -> dimensions-too-small', (await code(validatePalmImageFile(blobOf(makePngHeader(1000, 255), 'image/png')))) === 'dimensions-too-small');
  check('C2. 256 px short edge -> ok', (await code(validatePalmImageFile(blobOf(makePngHeader(1000, 256), 'image/png')))) === 'ok');
  check('C3. 10 001 px long edge -> dimensions-too-large', (await code(validatePalmImageFile(blobOf(makePngHeader(10001, 400), 'image/png')))) === 'dimensions-too-large');
  check('C4. 48 MP (8000x6000) -> dimensions-too-large before any decode', (await code(validatePalmImageFile(blobOf(makePngHeader(8000, 6000), 'image/png')))) === 'dimensions-too-large');
  check('C5. 35 MP (7000x5000) -> ok', (await code(validatePalmImageFile(blobOf(makePngHeader(7000, 5000), 'image/png')))) === 'ok');
  check('C6. zero width -> corrupt-image', (await code(validatePalmImageFile(blobOf(makePngHeader(0, 500), 'image/png')))) === 'corrupt-image');
  check('C7. JPEG with 0x0 SOF -> corrupt-image', (await code(validatePalmImageFile(blobOf(makeJpegHeader(0, 0), 'image/jpeg')))) === 'corrupt-image');
  check('C8. huge WebP VP8X (16384x16384) -> dimensions-too-large', (await code(validatePalmImageFile(blobOf(makeWebpVp8x(16384, 16384), 'image/webp')))) === 'dimensions-too-large');
  check('C9. checkDimensions rejects NaN', checkDimensions(NaN, 100) === 'corrupt-image');
  const farSof = await validatePalmImageFile(blobOf(makeJpegHeader(2000, 1500, { paddingBytes: PALM_IMAGE_LIMITS.headerReadBytes + 1000 }), 'image/jpeg'));
  // AURA-PALM-G5-C5 (F-1): the SOF is now located past the window and checked
  // before decode (was: accepted with header null, post-decode check only).
  // Bombs past the window: test/palmG5C5JpegDecodeBomb.test.ts.
  check('C10. JPEG whose SOF lies beyond the header window: dimensions read and checked before decode', farSof.ok && farSof.header?.width === 2000 && farSof.header?.height === 1500);

  // ------------------------------------------------------------ D. orientation
  for (const le of [false, true]) {
    const r = await validatePalmImageFile(blobOf(makeJpegHeader(4000, 3000, { orientation: 6, littleEndian: le }), 'image/jpeg'));
    check(`D1. EXIF orientation 6 read (${le ? 'little' : 'big'}-endian TIFF)`, r.ok && r.header?.exifOrientation === 6);
  }
  check('D2. orientation 6 swaps display size', JSON.stringify(orientedSize({ width: 4000, height: 3000, exifOrientation: 6 })) === JSON.stringify({ width: 3000, height: 4000 }));
  check('D3. orientation 3 keeps display size', JSON.stringify(orientedSize({ width: 4000, height: 3000, exifOrientation: 3 })) === JSON.stringify({ width: 4000, height: 3000 }));
  const noExif = await validatePalmImageFile(blobOf(makeJpegHeader(400, 300), 'image/jpeg'));
  check('D4. no EXIF -> orientation 1', noExif.ok && noExif.header?.exifOrientation === 1);
  check('D5. invalid orientation value (9) is ignored -> 1', parseImageHeader('jpeg', makeJpegHeader(400, 300, { orientation: 9 }))?.exifOrientation === 1);
  check('D6. sniffImageFormat on empty bytes is unknown', sniffImageFormat(new Uint8Array(0)) === 'unknown');

  // ------------------------------------------------------------ E. normalise
  const fakeBlob = {} as Blob;
  const canvases: any[] = [];
  const env = (decoded: { width: number; height: number }, onClose: () => void = () => {}) => ({
    createCanvas: (w: number, h: number) => { const c = makeFakeCanvas(w, h); canvases.push(c); return c as any; },
    decode: async () => ({ ...decoded, source: { tag: 'bitmap' }, close: onClose }),
  });

  let closed = 0;
  const f1 = await normalizeImageBlob(fakeBlob, { width: 4000, height: 3000, exifOrientation: 1 }, env({ width: 4000, height: 3000 }, () => closed++));
  check('E1. downscaled to long edge 1280 (4000x3000 -> 1280x960)', f1.width === 1280 && f1.height === 960 && f1.originalWidth === 4000);
  check('E2. decoded bitmap is closed after drawing (resource cleanup)', closed === 1);
  check('E3. small images are not upscaled', JSON.stringify(scaleToFit(800, 600)) === JSON.stringify({ width: 800, height: 600 }));
  check('E4. frame source is upload, orientation none', f1.source === 'upload' && f1.orientation === 'none');
  f1.release();
  check('E5. release() zeroes the canvas and is idempotent', f1.released && (f1.canvas as any).width === 0 && (f1.canvas as any).height === 0 && (f1.release(), true));

  const f2 = await normalizeImageBlob(fakeBlob, { width: 4000, height: 3000, exifOrientation: 6 }, env({ width: 3000, height: 4000 }));
  const ctx2 = (f2.canvas as any).ctx;
  check('E6. orientation applied by the decoder is detected (no manual transform)', f2.orientation === 'decoder' && f2.width === 960 && f2.height === 1280 && !ctx2.calls.some((c: any) => c.op === 'setTransform'));

  const f3 = await normalizeImageBlob(fakeBlob, { width: 4000, height: 3000, exifOrientation: 6 }, env({ width: 4000, height: 3000 }));
  const ctx3 = (f3.canvas as any).ctx;
  const t3 = ctx3.calls.find((c: any) => c.op === 'setTransform');
  const d3 = ctx3.calls.find((c: any) => c.op === 'drawImage');
  check('E7. decoder that ignored EXIF 6 -> manual rotation, upright portrait frame', f3.orientation === 'manual' && f3.width === 960 && f3.height === 1280);
  check('E8. manual EXIF 6 transform = rotate 90 deg clockwise', JSON.stringify(t3?.args) === JSON.stringify([0, 1, -1, 0, 960, 0]) && JSON.stringify(d3?.args.slice(1)) === JSON.stringify([0, 0, 1280, 960]));
  const f4 = await normalizeImageBlob(fakeBlob, { width: 4000, height: 3000, exifOrientation: 8 }, env({ width: 4000, height: 3000 }));
  check('E9. manual EXIF 8 transform = rotate 90 deg counter-clockwise', JSON.stringify((f4.canvas as any).ctx.calls.find((c: any) => c.op === 'setTransform')?.args) === JSON.stringify([0, -1, 1, 0, 0, 1280]));

  let closed5 = 0;
  let err5: any = null;
  try { await normalizeImageBlob(fakeBlob, null, env({ width: 200, height: 150 }, () => closed5++)); } catch (e) { err5 = e; }
  check('E10. post-decode dimension check (JPEG without header dims) -> dimensions-too-small, bitmap still closed', err5 instanceof PalmPipelineError && err5.code === 'dimensions-too-small' && closed5 === 1);
  let err6: any = null;
  try { await normalizeImageBlob(fakeBlob, null, { createCanvas: () => makeFakeCanvas(1, 1) as any, decode: async () => { throw new Error('boom'); } }); } catch (e) { err6 = e; }
  check('E11. decoder failure -> corrupt-image', err6 instanceof PalmPipelineError && err6.code === 'corrupt-image');
  let err7: any = null;
  try { await normalizeImageBlob(fakeBlob, null, env({ width: 0, height: 0 })); } catch (e) { err7 = e; }
  check('E12. zero-size decode -> corrupt-image', err7 instanceof PalmPipelineError && err7.code === 'corrupt-image');

  const cam = normalizeDrawableFrame({ tag: 'video' }, 1920, 1080, 'camera', { createCanvas: (w, h) => makeFakeCanvas(w, h) as any });
  check('E13. drawable (camera-frame) entry point yields the same frame type, downscaled', cam.source === 'camera' && cam.width === 1280 && cam.height === 720 && cam.orientation === 'none');

  // ------------------------------------------------------------ F. default decoder
  const optsSeen: any[] = [];
  const dec1 = createDefaultDecoder({ createImageBitmap: async (_b, o) => { optsSeen.push(o); return { width: 10, height: 20, close() {} }; } });
  const r1 = await dec1(fakeBlob);
  check('F1. createImageBitmap is asked to apply EXIF orientation (from-image)', optsSeen[0]?.imageOrientation === 'from-image' && r1.width === 10);
  const dec2 = createDefaultDecoder({ createImageBitmap: async (_b, o) => { if (o) throw new TypeError('bad option'); return { width: 5, height: 6, close() {} }; } });
  check('F2. engines rejecting the option bag fall back to a plain decode', (await dec2(fakeBlob)).width === 5);
  const dec3 = createDefaultDecoder({ createImageBitmap: async () => { const e: any = new Error('InvalidStateError'); e.name = 'InvalidStateError'; throw e; } });
  let err8: any = null;
  try { await dec3(fakeBlob); } catch (e) { err8 = e; }
  check('F3. undecodable data -> corrupt-image', err8 instanceof PalmPipelineError && err8.code === 'corrupt-image');

  const urls = { created: 0, revoked: 0 };
  const mkImg = (ok: boolean) => () => ({ src: '', decoding: '', naturalWidth: 300, naturalHeight: 400, decode: async () => { if (!ok) throw new Error('decode'); } });
  // Node has no createImageBitmap; it is also removed explicitly so the
  // decoder must take the <img> + object-URL fallback path.
  const g: any = globalThis as any;
  const savedCib = g.createImageBitmap;
  delete g.createImageBitmap;
  const decFallback = createDefaultDecoder({ createObjectURL: () => { urls.created++; return 'blob:x'; }, revokeObjectURL: () => { urls.revoked++; }, createImage: mkImg(true) });
  const rf = await decFallback(fakeBlob);
  const decFallbackBad = createDefaultDecoder({ createObjectURL: () => { urls.created++; return 'blob:y'; }, revokeObjectURL: () => { urls.revoked++; }, createImage: mkImg(false) });
  let err9: any = null;
  try { await decFallbackBad(fakeBlob); } catch (e) { err9 = e; }
  if (savedCib) g.createImageBitmap = savedCib;
  check('F4. <img> fallback decodes via an object URL', rf.width === 300 && rf.height === 400);
  check('F5. fallback failure -> corrupt-image', err9 instanceof PalmPipelineError && err9.code === 'corrupt-image');
  check('F6. every object URL created is revoked (success and failure)', urls.created === 2 && urls.revoked === 2);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
