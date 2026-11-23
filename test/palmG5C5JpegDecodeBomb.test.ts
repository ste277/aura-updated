/**
 * AURA-PALM-G5-C5 (F-1) -- JPEG decompression bombs are rejected BEFORE any
 * decode, wherever the frame header (SOF) lies in the file.
 *
 * Before C5, a JPEG whose SOF lay past the first 512 KiB was accepted with
 * `header: null` and handed to createImageBitmap at full size; only the
 * post-decode check looked at its dimensions (G5-C1 review, reproduced with a
 * 589 918-byte synthetic JPEG declaring 65500 x 65500 px). These checks pin
 * the fix: windowed, bounded marker walking; rejection of malformed and
 * deceptive headers; valid large-metadata JPEGs still accepted; and, at the
 * session level, the decoder is never called for a rejected file.
 *
 * Synthetic bytes only -- no real photographs.
 *
 *   npx ts-node test/palmG5C5JpegDecodeBomb.test.ts
 */
import { PALM_IMAGE_LIMITS, validatePalmImageFile } from '../apps/web/lib/palm-analysis/validate';
import { createPalmAnalysisSession } from '../apps/web/lib/palm-analysis/session';
import { blobOf, makeFakeCanvas, makeHand } from './palmG5I1Fixtures';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`OK   ${label}`); } else { failed++; console.log(`FAIL ${label}`); }
}

const W = PALM_IMAGE_LIMITS.headerReadBytes;

// ---------------------------------------------------------------- builders
const SOI = [0xff, 0xd8];
const sof = (w: number, h: number, len = 0x11) => [0xff, 0xc0, len >> 8, len & 0xff, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1].slice(0, 2 + Math.max(len, 2));
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const EOI = [0xff, 0xd9];

/** APPn segment with `body` payload bytes (total size body + 4). */
function app(n: number, body: number): Uint8Array {
  const s = new Uint8Array(4 + body);
  s[0] = 0xff; s[1] = 0xe0 + n; s[2] = ((body + 2) >> 8) & 0xff; s[3] = (body + 2) & 0xff;
  return s;
}

/** Padding made of APP2 segments totalling exactly `bytes` (>= 4, never a 1-3 byte remainder). */
function padding(bytes: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let left = bytes;
  while (left > 0) {
    let seg = Math.min(left, 65_537);
    if (left - seg > 0 && left - seg < 4) seg -= 4;
    out.push(app(2, seg - 4));
    left -= seg;
  }
  return out;
}

/** EXIF APP1 carrying an orientation tag (big-endian TIFF). */
function exif(orientation: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0];
  const body = [...Array.from(new TextEncoder().encode('Exif')), 0, 0, ...tiff];
  return new Uint8Array([0xff, 0xe1, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body]);
}

function cat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/** The exact G5-C1 reproduction: 9 x 65 537-byte APP segments, then SOF 65500 x 65500, then 64 zero bytes. */
function c1Repro(): Uint8Array {
  const segs: Uint8Array[] = [];
  for (let i = 1; i <= 9; i++) {
    const s = new Uint8Array(65_537);
    s[0] = 0xff; s[1] = 0xe0 + (i % 15); s[2] = 0xff; s[3] = 0xff;
    segs.push(s);
  }
  return cat(SOI, ...segs, sof(65_500, 65_500), new Uint8Array(64));
}

/** blobOf + read accounting (how many slices, largest slice). */
function tracked(bytes: Uint8Array, type = 'image/jpeg', opts: { failReadAt?: number; shortReadAt?: number } = {}) {
  const base = blobOf(bytes, type, 'photo.jpg');
  const t = { reads: 0, maxSlice: 0, totalRead: 0 };
  const file = {
    size: base.size,
    type,
    name: 'photo.jpg',
    slice(start = 0, end = bytes.length) {
      t.reads++;
      const n = Math.max(0, Math.min(end, bytes.length) - start);
      t.maxSlice = Math.max(t.maxSlice, n);
      t.totalRead += n;
      const readNo = t.reads;
      if (opts.failReadAt === readNo) return { arrayBuffer: async () => { throw new Error('read failed'); } };
      if (opts.shortReadAt === readNo) return base.slice(start, Math.max(start, end - 100));
      return base.slice(start, end);
    },
  };
  return { file, t };
}

async function verdict(bytes: Uint8Array, opts?: Parameters<typeof tracked>[2]) {
  const { file, t } = tracked(bytes, 'image/jpeg', opts);
  const r = await validatePalmImageFile(file);
  return { r, code: r.ok ? 'ok' : r.error.code, t };
}

async function run() {
  // ------------------------------------------------------------ A. the reproduced bomb
  const repro = c1Repro();
  check('A0. fixture is the C1 reproduction: 589 918 bytes, SOF past the 512 KiB window', repro.length === 589_918 && repro.length > W);
  const a = await verdict(repro);
  check('A1. 590 KB JPEG declaring 65500 x 65500 -> dimensions-too-large (was accepted with header:null)', a.code === 'dimensions-too-large');
  check('A2. ... found with bounded reads (2 windows, no slice larger than headerReadBytes)', a.t.reads === 2 && a.t.maxSlice <= W);

  // Session level: rejection happens before decode -- the decoder is never called.
  {
    let decodes = 0;
    let factories = 0;
    // What a real decoder would report: the size the file declares.
    let decodedSize = { width: 65_500, height: 65_500 };
    const s = createPalmAnalysisSession({
      detectorFactory: async () => { factories++; return { detect: () => [{ landmarks: makeHand() }], close() {} }; },
      normalizeEnv: {
        createCanvas: (w, h) => makeFakeCanvas(w, h) as any,
        decode: async () => { decodes++; return { ...decodedSize, source: {}, close() {} }; },
      },
      isEnabled: () => true,
      yieldToUi: () => Promise.resolve(),
    });
    await s.submitFile(tracked(repro).file as any);
    const st = s.getState();
    check('A3. session: bomb ends in error dimensions-too-large with no frame', st.phase === 'error' && st.error?.code === 'dimensions-too-large' && st.frame === null);
    check('A4. session: the image decoder was NEVER called, and no model was loaded', decodes === 0 && factories === 0);

    // Negative control: the same spy DOES see a decode for a valid far-SOF JPEG.
    const good = cat(SOI, ...padding(W + 1000), sof(2000, 1500), SOS, [0, 0], EOI);
    decodedSize = { width: 2000, height: 1500 };
    await s.submitFile(tracked(good).file as any);
    check('A5. control: a valid JPEG with SOF past the window IS decoded (spy works)', decodes === 1 && s.getState().phase === 'result');
    s.dispose();
  }

  // ------------------------------------------------------------ B. other bombs and limits past the window
  check('B1. SOF past window, 9000 x 9000 (81 MP) -> dimensions-too-large', (await verdict(cat(SOI, ...padding(W + 10), sof(9000, 9000), SOS, EOI))).code === 'dimensions-too-large');
  check('B2. SOF past window, 10 001 x 400 (long edge) -> dimensions-too-large', (await verdict(cat(SOI, ...padding(W + 10), sof(10_001, 400), SOS, EOI))).code === 'dimensions-too-large');
  check('B3. SOF past window, 1000 x 255 -> dimensions-too-small', (await verdict(cat(SOI, ...padding(W + 10), sof(1000, 255), SOS, EOI))).code === 'dimensions-too-small');
  check('B4. SOF past window, 0 x 0 -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 10), sof(0, 0), SOS, EOI))).code === 'corrupt-image');
  check('B5. progressive SOF2 past window, 65500 x 65500 -> dimensions-too-large', (await verdict(cat(SOI, ...padding(W * 3), [0xff, 0xc2, ...sof(65_500, 65_500).slice(2)], SOS, EOI))).code === 'dimensions-too-large');

  // ------------------------------------------------------------ C. valid compatibility
  {
    const far = await verdict(cat(SOI, ...padding(W + 1000), sof(2000, 1500), SOS, EOI));
    check('C1. valid JPEG, SOF past the window -> ok with dimensions read (2000 x 1500)', far.r.ok && far.r.header?.width === 2000 && far.r.header?.height === 1500);
    const near = await verdict(cat(SOI, ...padding(1000), sof(4000, 3000), SOS, EOI));
    check('C2. valid JPEG, SOF inside the window -> ok, a single read', near.r.ok && near.r.header?.width === 4000 && near.t.reads === 1);
    const big = PALM_IMAGE_LIMITS.maxFileBytes - 2000;
    const end = await verdict(cat(SOI, ...padding(big), sof(3000, 2000), SOS, EOI));
    check('C3. valid JPEG of ~15 MiB with SOF at the very end -> ok', end.r.ok && end.r.header?.width === 3000);
    check(`C4. ... within the read cap (${end.t.reads} <= ${PALM_IMAGE_LIMITS.maxJpegHeaderReads} reads; max slice <= window; total read <= size + one window)`, end.t.reads <= PALM_IMAGE_LIMITS.maxJpegHeaderReads && end.t.maxSlice <= W && end.t.totalRead <= big + 2 * W);
    for (const delta of [-5, -4, -1, 0, 1, 3]) {
      // SOF segment header placed so it straddles (or just meets) the first window edge.
      const pre = W - 2 + delta;
      const r = await verdict(cat(SOI, ...padding(pre), sof(2400, 1800), SOS, EOI));
      check(`C5. SOF straddling the window edge (offset W${delta >= 0 ? '+' : ''}${delta}) is read intact`, r.r.ok && r.r.header?.width === 2400 && r.r.header?.height === 1800);
    }
    // EXIF APP1 straddling the window edge: orientation still honoured.
    const ex = exif(6);
    const r6 = await verdict(cat(SOI, ...padding(W - 2 - Math.floor(ex.length / 2)), ex, sof(4000, 3000), SOS, EOI));
    check('C6. EXIF APP1 straddling the window edge -> orientation 6 still read', r6.r.ok && r6.r.header?.exifOrientation === 6);
    const r6far = await verdict(cat(SOI, ...padding(W * 2 + 77), ex, sof(4000, 3000), SOS, EOI));
    check('C7. EXIF APP1 past the window -> orientation 6 read', r6far.r.ok && r6far.r.header?.exifOrientation === 6);
    const fill = await verdict(cat(SOI, ...padding(W + 10), new Uint8Array(30).fill(0xff), sof(2000, 1500), SOS, EOI));
    check('C8. fill bytes (0xFF padding) before a far SOF are skipped', fill.r.ok && fill.r.header?.width === 2000);
  }

  // ------------------------------------------------------------ D. malformed / deceptive headers past the window
  check('D1. segment length runs past end of file, no SOF -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), [0xff, 0xe3, 0xff, 0xff, 1, 2, 3]))).code === 'corrupt-image');
  check('D2. SOS before any SOF (past window) -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), SOS, sof(65_500, 65_500), EOI))).code === 'corrupt-image');
  check('D3. EOI before any SOF (past window) -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), EOI, sof(65_500, 65_500)))).code === 'corrupt-image');
  check('D4. lost marker sync (past window) -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), [0x12, 0x34, 0x56, 0x78], sof(65_500, 65_500)))).code === 'corrupt-image');
  check('D5. segment length < 2 (past window) -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), [0xff, 0xe4, 0x00, 0x01], sof(2000, 1500)))).code === 'corrupt-image');
  check('D6. truncated SOF (length < 8) -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), sof(2000, 1500, 5), SOS, EOI))).code === 'corrupt-image');
  check('D7. SOF cut off by end of file (past window) -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), sof(2000, 1500).slice(0, 7)))).code === 'corrupt-image');
  check('D8. stuffed 0xFF00 where a marker is expected -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), [0xff, 0x00, 0x00, 0x10], sof(2000, 1500)))).code === 'corrupt-image');
  check('D9. no SOF at all in a small file -> corrupt-image (no decode on post-check alone)', (await verdict(cat(SOI, ...padding(4000), SOS, EOI))).code === 'corrupt-image');
  check('D10. read error in a later window -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), sof(2000, 1500), SOS, EOI), { failReadAt: 2 })).code === 'corrupt-image');
  check('D11. short read in a later window -> corrupt-image', (await verdict(cat(SOI, ...padding(W + 100), sof(2000, 1500), SOS, EOI), { shortReadAt: 2 })).code === 'corrupt-image');

  // ------------------------------------------------------------ E. bounded work on adversarial layouts (15 MiB, no SOF)
  {
    const max = PALM_IMAGE_LIMITS.maxFileBytes;
    const allFill = cat(SOI, new Uint8Array(max - 2).fill(0xff));
    const f = await verdict(allFill);
    check(`E1. 15 MiB of 0xFF fill bytes -> corrupt-image within the cap (${f.t.reads} reads)`, f.code === 'corrupt-image' && f.t.reads <= PALM_IMAGE_LIMITS.maxJpegHeaderReads && f.t.maxSlice <= W);
    const tiny = new Uint8Array(max);
    tiny.set(SOI, 0);
    for (let o = 2; o + 4 <= max; o += 4) { tiny[o] = 0xff; tiny[o + 1] = 0xe2; tiny[o + 2] = 0; tiny[o + 3] = 2; }
    const g = await verdict(tiny);
    check(`E2. 15 MiB of minimal 4-byte segments -> corrupt-image within the cap (${g.t.reads} reads)`, g.code === 'corrupt-image' && g.t.reads <= PALM_IMAGE_LIMITS.maxJpegHeaderReads && g.t.maxSlice <= W);
    const maxSeg = cat(SOI, ...padding(max - 2 - 20));
    const h = await verdict(maxSeg);
    check(`E3. 15 MiB of maximal 64 KiB segments, no SOF -> corrupt-image within the cap (${h.t.reads} reads)`, h.code === 'corrupt-image' && h.t.reads <= PALM_IMAGE_LIMITS.maxJpegHeaderReads);
    check('E4. read cap is finite and small', Number.isInteger(PALM_IMAGE_LIMITS.maxJpegHeaderReads) && PALM_IMAGE_LIMITS.maxJpegHeaderReads <= 40);
  }

  // ------------------------------------------------------------ F. PNG IHDR strictness (deceptive header)
  {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x07, 0xd0, 0, 0, 0x05, 0xdc, 8, 6, 0, 0, 0]);
    const ok = await validatePalmImageFile(blobOf(png, 'image/png'));
    check('F1. PNG with a 13-byte IHDR -> ok (2000 x 1500)', ok.ok && ok.header?.width === 2000);
    const bad = png.slice(); bad[11] = 12;
    const r = await validatePalmImageFile(blobOf(bad, 'image/png'));
    check('F2. PNG whose IHDR length is not 13 -> corrupt-image', !r.ok && r.error.code === 'corrupt-image');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
