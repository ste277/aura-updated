/**
 * AURA-PALM-G5-C7 (C6-F1) -- JPEG marker desync between the validator and
 * WebKit/ImageIO.
 *
 * Before C7, validate.ts skipped RST0-7 (FF D0-D7) and TEM (FF 01) as
 * length-less markers before the frame header. Apple ImageIO (Safari,
 * WKWebView) reads a 2-byte length after them. A crafted file therefore showed
 * the validator a fake 300 x 300 SOF while ImageIO decoded the real
 * 12000 x 400 (or 8000 x 8000) frame (G5-C6 review, reproduced with sips).
 *
 * C7 allows only APPn/COM/DQT/DHT/DRI/DAC and fill bytes between SOI and SOS,
 * requires exactly one SOF before SOS, and reports dimensions only once SOS
 * is reached. These checks pin that, and -- where the decoders are installed
 * -- run a differential against libjpeg (ImageMagick) and ImageIO (sips):
 * no crafted file may pass validation while a real decoder reports a
 * different or over-limit size. Absent decoders are reported NOT RUN, never
 * counted as passes.
 *
 * Synthetic images only (generated gradients); no photographs.
 *
 *   npx ts-node test/palmG5C7JpegMarkerDesync.test.ts
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkDimensions, PALM_IMAGE_LIMITS, validatePalmImageFile } from '../apps/web/lib/palm-analysis/validate';
import { createPalmAnalysisSession } from '../apps/web/lib/palm-analysis/session';
import { blobOf, makeFakeCanvas, makeHand } from './palmG5I1Fixtures';

let passed = 0;
let failed = 0;
const notRun: string[] = [];
function check(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`OK   ${label}`); } else { failed++; console.log(`FAIL ${label}`); }
}
function skip(label: string, why: string): void {
  notRun.push(label);
  console.log(`NOT RUN ${label} (${why})`);
}

const W = PALM_IMAGE_LIMITS.headerReadBytes;

// ---------------------------------------------------------------- builders
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const SOS = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
const DQT = [0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(1)];
const DHT = [0xff, 0xc4, 0x00, 0x14, 0x00, 1, ...new Array(15).fill(0), 0x00];
const DRI = [0xff, 0xdd, 0x00, 0x04, 0x00, 0x10];
const sofOf = (w: number, h: number, marker = 0xc0) => [0xff, marker, 0x00, 0x11, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];

function cat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/** COM segment totalling exactly `total` bytes (>= 4). */
function com(total: number): Uint8Array {
  const s = new Uint8Array(total);
  s[0] = 0xff; s[1] = 0xfe; s[2] = ((total - 2) >> 8) & 0xff; s[3] = (total - 2) & 0xff;
  return s;
}

/**
 * The C6-F1 desync: `FF <mk>` + fake SOF(300x300) + COM, sized so that a
 * decoder that reads a 2-byte length after `FF <mk>` (the fake SOF's own
 * `FF C0` = 0xFFC0) lands exactly on whatever follows.
 */
function desync(mk: number, fakeW = 300, fakeH = 300): Uint8Array {
  const fake = sofOf(fakeW, fakeH);
  return cat([0xff, mk], fake, com(0xffc0 - fake.length));
}

/** A structurally complete header-only JPEG: SOI, tables, `pre`, SOF, SOS, EOI. */
function jpeg(w: number, h: number, pre: Uint8Array | number[] = [], post: Uint8Array | number[] = []): Uint8Array {
  return cat(SOI, DQT, pre, sofOf(w, h), DHT, post, SOS, [0x12, 0x34], EOI);
}

function tracked(bytes: Uint8Array) {
  const base = blobOf(bytes, 'image/jpeg', 'photo.jpg');
  const t = { reads: 0, maxSlice: 0 };
  return {
    t,
    file: {
      size: base.size, type: 'image/jpeg', name: 'photo.jpg',
      slice(start = 0, end = bytes.length) { t.reads++; t.maxSlice = Math.max(t.maxSlice, Math.min(end, bytes.length) - start); return base.slice(start, end); },
    },
  };
}
async function verdict(bytes: Uint8Array) {
  const { file, t } = tracked(bytes);
  const r = await validatePalmImageFile(file);
  return { r, code: r.ok ? 'ok' : r.error.code, t, header: r.ok ? r.header : null };
}

// ---------------------------------------------------------------- real decoders (optional)
function have(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0 || (r.stdout || '').length > 0 || (r.stderr || '').length > 0 ? r.error === undefined : false;
}
const MAGICK = have('magick', ['-version']) ? { gen: ['magick'], id: ['magick', 'identify'] } : have('convert', ['-version']) && have('identify', ['-version']) ? { gen: ['convert'], id: ['identify'] } : null;
const SIPS = process.platform === 'darwin' && have('sips', ['--help']);

/** libjpeg (ImageMagick) view: {w,h} or 'error'. */
function libjpegSize(file: string): { w: number; h: number } | 'error' {
  if (!MAGICK) throw new Error('no magick');
  const r = spawnSync(MAGICK.id[0], [...MAGICK.id.slice(1), '-regard-warnings', '-format', '%w %h', file], { encoding: 'utf8' });
  if (r.status !== 0) return 'error';
  const [w, h] = r.stdout.trim().split(/\s+/).map(Number);
  return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : 'error';
}
/** ImageIO (WebKit/Safari decoder on Apple platforms) view via sips. */
function imageioSize(file: string): { w: number; h: number } | 'error' {
  const r = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = Number((/pixelWidth:\s*(\d+)/.exec(r.stdout) || [])[1]);
  const h = Number((/pixelHeight:\s*(\d+)/.exec(r.stdout) || [])[1]);
  return r.status === 0 && w > 0 && h > 0 ? { w, h } : 'error';
}
function magickMake(out: string, args: string[]): boolean {
  if (!MAGICK) return false;
  const r = spawnSync(MAGICK.gen[0], [...MAGICK.gen.slice(1), ...args, out], { encoding: 'utf8' });
  return r.status === 0 && fs.existsSync(out);
}
/** Byte offset of the first SOFn in a real encoder's JPEG. */
function firstSofOffset(d: Uint8Array): number {
  let i = 2;
  while (i + 4 <= d.length) {
    if (d[i] !== 0xff) throw new Error('unexpected encoder output');
    const m = d[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return i;
    i += 2 + ((d[i + 2] << 8) | d[i + 3]);
  }
  throw new Error('no SOF in encoder output');
}
const insertAt = (d: Uint8Array, at: number, ins: Uint8Array) => cat(d.subarray(0, at), ins, d.subarray(at));

async function run() {
  // ------------------------------------------------------------ A. C6-F1 structural reproduction
  check('A0. structural C6-F1 (TEM/RST + fake 300x300 SOF + COM, real SOF 12000x400): fixture well formed for a length-reading decoder', desync(0xd0).length - 2 === 0xffc0);
  for (const mk of [0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0x01]) {
    const hex = mk.toString(16).toUpperCase().padStart(2, '0');
    check(`A1. FF ${hex} desync, real 12000 x 400 -> corrupt-image (was: accepted as 300 x 300)`, (await verdict(jpeg(12_000, 400, desync(mk)))).code === 'corrupt-image');
    check(`A2. FF ${hex} desync, real 8000 x 8000 (64 MP) -> rejected`, (await verdict(jpeg(8000, 8000, desync(mk)))).code !== 'ok');
  }
  check('A3. bare RST0 before SOF (no desync payload) -> corrupt-image', (await verdict(jpeg(1600, 1200, [0xff, 0xd0]))).code === 'corrupt-image');
  check('A4. bare TEM before SOF -> corrupt-image', (await verdict(jpeg(1600, 1200, [0xff, 0x01]))).code === 'corrupt-image');
  check('A5. RST between SOF and SOS -> corrupt-image', (await verdict(jpeg(1600, 1200, [], [0xff, 0xd3]))).code === 'corrupt-image');
  check('A6. desync placed past the 512 KiB window -> corrupt-image', (await verdict(jpeg(12_000, 400, cat(com(W + 100), desync(0xd5))))).code === 'corrupt-image');

  // Session level: the decoder is never reached for the C6-F1 file.
  {
    let decodes = 0;
    const s = createPalmAnalysisSession({
      detectorFactory: async () => ({ detect: () => [{ landmarks: makeHand() }], close() {} }),
      normalizeEnv: { createCanvas: (w, h) => makeFakeCanvas(w, h) as any, decode: async () => { decodes++; return { width: 12_000, height: 400, source: {}, close() {} }; } },
      isEnabled: () => true,
      yieldToUi: () => Promise.resolve(),
    });
    await s.submitFile(tracked(jpeg(12_000, 400, desync(0xd0))).file as any);
    check('A7. session: C6-F1 file ends in corrupt-image and the decoder is NEVER called', s.getState().error?.code === 'corrupt-image' && decodes === 0);
    s.dispose();
  }

  // ------------------------------------------------------------ B. marker allowlist, exhaustively
  {
    const allowed = new Set<number>([...Array.from({ length: 16 }, (_, k) => 0xe0 + k), 0xfe, 0xdb, 0xc4, 0xdd, 0xcc]);
    const sofs = new Set<number>([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    const wronglyAccepted: string[] = [];
    const wronglyRejected: string[] = [];
    for (let m = 0x00; m <= 0xfe; m++) {
      if (sofs.has(m) || m === 0xff) continue;
      // A well-formed 2-byte-length segment (length 4, 2 payload bytes) with marker m before the SOF.
      const seg = [0xff, m, 0x00, 0x04, 0x00, 0x00];
      const r = await verdict(jpeg(1600, 1200, seg));
      if (allowed.has(m) && r.code !== 'ok') wronglyRejected.push(m.toString(16));
      if (!allowed.has(m) && r.code === 'ok') wronglyAccepted.push(m.toString(16));
    }
    check(`B1. every non-allowlisted marker before SOF is rejected (${wronglyAccepted.length ? 'accepted: ' + wronglyAccepted.join(',') : 'none accepted'})`, wronglyAccepted.length === 0);
    check(`B2. every allowlisted table/misc marker (APP0-15, COM, DQT, DHT, DRI, DAC) is accepted (${wronglyRejected.length ? 'rejected: ' + wronglyRejected.join(',') : 'all accepted'})`, wronglyRejected.length === 0);
  }
  check('B3. second SOI after the first -> corrupt-image', (await verdict(jpeg(1600, 1200, [0xff, 0xd8]))).code === 'corrupt-image');
  check('B4. DNL (FF DC) before SOS -> corrupt-image', (await verdict(jpeg(1600, 1200, [], [0xff, 0xdc, 0x00, 0x04, 0x01, 0x90]))).code === 'corrupt-image');
  check('B5. EOI before SOS -> corrupt-image', (await verdict(cat(SOI, sofOf(1600, 1200), EOI))).code === 'corrupt-image');
  check('B6. stuffed FF 00 before SOS -> corrupt-image', (await verdict(jpeg(1600, 1200, [0xff, 0x00]))).code === 'corrupt-image');

  // ------------------------------------------------------------ C. exactly one SOF before SOS
  check('C1. duplicate SOF, small first then large -> corrupt-image', (await verdict(cat(SOI, sofOf(300, 300), sofOf(12_000, 400), SOS, EOI))).code === 'corrupt-image');
  check('C2. duplicate SOF, both in limits -> corrupt-image (ambiguous: decoders differ on which wins)', (await verdict(cat(SOI, sofOf(1600, 1200), DHT, sofOf(1600, 1200), SOS, EOI))).code === 'corrupt-image');
  check('C3. progressive SOF2 then baseline SOF0 -> corrupt-image', (await verdict(cat(SOI, sofOf(800, 600, 0xc2), sofOf(800, 600), SOS, EOI))).code === 'corrupt-image');
  check('C4. valid SOF but no SOS anywhere (truncated header sequence) -> corrupt-image', (await verdict(cat(SOI, DQT, sofOf(1600, 1200), DHT))).code === 'corrupt-image');
  check('C5. over-limit SOF is rejected at once, even with no SOS after it (dimensions-too-large)', (await verdict(cat(SOI, sofOf(65_500, 65_500), new Uint8Array(64)))).code === 'dimensions-too-large');

  // ------------------------------------------------------------ D. limits and the original F-1 file
  {
    const segs: Uint8Array[] = [];
    for (let i = 1; i <= 9; i++) { const s = new Uint8Array(65_537); s[0] = 0xff; s[1] = 0xe0 + (i % 15); s[2] = 0xff; s[3] = 0xff; segs.push(s); }
    const c1 = cat(SOI, ...segs, sofOf(65_500, 65_500), new Uint8Array(64));
    const v = await verdict(c1);
    check('D1. original G5-C1 file (589 918 B, 65500 x 65500, SOF past 512 KiB) -> dimensions-too-large', c1.length === 589_918 && v.code === 'dimensions-too-large');
  }
  check('D2. 10 001 x 400 -> dimensions-too-large', (await verdict(jpeg(10_001, 400))).code === 'dimensions-too-large');
  check('D3. 7000 x 6000 (42 MP) -> dimensions-too-large', (await verdict(jpeg(7000, 6000))).code === 'dimensions-too-large');
  check('D4. 1000 x 255 -> dimensions-too-small', (await verdict(jpeg(1000, 255))).code === 'dimensions-too-small');
  {
    const ok = await verdict(jpeg(4000, 3000, [], DRI));
    check('D5. well-formed header with DRI and tables after SOF -> ok, 4000 x 3000', ok.code === 'ok' && ok.header?.width === 4000 && ok.header?.height === 3000);
    const okSos = await verdict(cat(SOI, DQT, sofOf(2400, 1800), DHT, SOS, [0x00, 0xff, 0xd0, 0x11, 0xff, 0xd1, 0x22], EOI));
    check('D6. RST markers INSIDE scan data (after SOS) are untouched -> ok', okSos.code === 'ok' && okSos.header?.width === 2400);
  }

  // ------------------------------------------------------------ E. bounded work
  {
    const max = PALM_IMAGE_LIMITS.maxFileBytes;
    const rsts = new Uint8Array(max);
    rsts.set(SOI, 0);
    for (let o = 2; o + 1 < max; o += 2) { rsts[o] = 0xff; rsts[o + 1] = 0xd0; }
    const r1 = await verdict(rsts);
    check(`E1. 15 MiB of FF D0 -> corrupt-image after ${r1.t.reads} read(s)`, r1.code === 'corrupt-image' && r1.t.reads === 1);
    const tables = cat(SOI, sofOf(3000, 2000), ...Array.from({ length: Math.floor((max - 200) / 65_537) }, () => { const s = new Uint8Array(65_537); s[0] = 0xff; s[1] = 0xe2; s[2] = 0xff; s[3] = 0xff; return s; }), SOS, EOI);
    const r2 = await verdict(tables);
    check(`E2. ~15 MiB of APP segments between SOF and SOS -> ok within the cap (${r2.t.reads} <= ${PALM_IMAGE_LIMITS.maxJpegHeaderReads} reads, max slice <= window)`, r2.code === 'ok' && r2.t.reads <= PALM_IMAGE_LIMITS.maxJpegHeaderReads && r2.t.maxSlice <= W);
  }

  // ------------------------------------------------------------ F. real-decoder differential (optional)
  if (!MAGICK) {
    skip('F. real-encoder compatibility and libjpeg/ImageIO differential', 'ImageMagick not installed');
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-c7-'));
    try {
      const gen = (name: string, args: string[]) => { const f = path.join(dir, name); return magickMake(f, args) ? f : null; };
      // 1. Legitimate encoder output stays accepted, with the decoder's own size.
      const legit: [string, string[], number, number][] = [
        ['baseline.jpg', ['-size', '1600x1200', 'gradient:red-blue', '-quality', '85'], 1600, 1200],
        ['progressive.jpg', ['-size', '1200x1600', 'gradient:green-yellow', '-interlace', 'JPEG', '-quality', '80'], 1200, 1600],
        ['restart.jpg', ['-size', '2000x1500', 'gradient:white-black', '-define', 'jpeg:restart-interval=1', '-quality', '85'], 2000, 1500],
        ['gray.jpg', ['-size', '1024x768', 'gradient:', '-colorspace', 'Gray', '-quality', '90'], 1024, 768],
        ['cmyk.jpg', ['-size', '800x600', 'gradient:cyan-magenta', '-colorspace', 'CMYK', '-quality', '85'], 800, 600],
        ['s444.jpg', ['-size', '1000x1000', 'gradient:orange-purple', '-sampling-factor', '1x1', '-quality', '95'], 1000, 1000],
        ['comment.jpg', ['-size', '640x480', 'gradient:blue-white', '-set', 'comment', 'x'.repeat(60_000), '-quality', '80'], 640, 480],
        ['big-legal.jpg', ['-size', '7000x5000', 'gradient:red-blue', '-quality', '60'], 7000, 5000],
      ];
      for (const [name, args, w, h] of legit) {
        const f = gen(name, args);
        if (!f) { skip(`F1. legitimate ${name}`, 'encoder failed'); continue; }
        const v = await verdict(new Uint8Array(fs.readFileSync(f)));
        const lib = libjpegSize(f);
        check(`F1. legitimate encoder output ${name} -> ok, validator ${v.header?.width}x${v.header?.height} = libjpeg ${lib === 'error' ? 'error' : lib.w + 'x' + lib.h}`, v.code === 'ok' && v.header?.width === w && v.header?.height === h && lib !== 'error' && lib.w === w && lib.h === h);
      }
      // EXIF orientation: ImageMagick writes no EXIF for a generated image, so
      // insert a standard big-endian EXIF APP1 (Orientation = 6) after SOI.
      {
        const f = gen('orient-src.jpg', ['-size', '1600x1200', 'gradient:red-black', '-quality', '85']);
        if (!f) skip('F1b. EXIF orientation 6 in real encoder output', 'encoder failed');
        else {
          const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
          const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
          const app1 = new Uint8Array([0xff, 0xe1, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body]);
          const d = new Uint8Array(fs.readFileSync(f));
          const withExif = insertAt(d, 2, app1);
          const o = path.join(dir, 'orient6.jpg');
          fs.writeFileSync(o, withExif);
          const v = await verdict(withExif);
          const lib = libjpegSize(o);
          check('F1b. real encoder output + EXIF Orientation 6 -> ok, stored 1600 x 1200, orientation 6 read; libjpeg decodes it', v.code === 'ok' && v.header?.width === 1600 && v.header?.exifOrientation === 6 && lib !== 'error' && lib.w === 1600);
          if (SIPS) {
            const io = imageioSize(o);
            check('F1c. ImageIO reads the same file (stored 1600 x 1200; orientation applied at display time)', io !== 'error' && ((io.w === 1600 && io.h === 1200) || (io.w === 1200 && io.h === 1600)));
          }
        }
      }

      // 2. Crafted files built from real encoder output: whatever the validator
      //    accepts must decode, in every available decoder, to the validated size.
      const base = gen('base12000.jpg', ['-size', '12000x400', 'gradient:red-blue', '-quality', '70']);
      const base8k = gen('base8000.jpg', ['-size', '8000x8000', 'xc:gray', '-quality', '50']);
      const small = gen('base1600.jpg', ['-size', '1600x1200', 'gradient:red-blue', '-quality', '70']);
      if (!base || !base8k || !small) {
        skip('F2. crafted-file differential', 'encoder failed');
      } else {
        const crafted: [string, Uint8Array][] = [];
        for (const src of [base, base8k]) {
          const d = new Uint8Array(fs.readFileSync(src));
          const at = firstSofOffset(d);
          const tag = path.basename(src, '.jpg');
          for (const mk of [0xd0, 0xd3, 0xd7, 0x01]) crafted.push([`${tag}-desync-${mk.toString(16)}`, insertAt(d, at, desync(mk))]);
          // A small SOF hidden behind other length-bearing markers (decoders agree on these).
          for (const mk of [0x02, 0x10, 0x80, 0xbf, 0xc8, 0xdc, 0xde, 0xdf, 0xe0, 0xf0, 0xf7, 0xfd, 0xfe]) crafted.push([`${tag}-hidden-${mk.toString(16)}`, insertAt(d, at, cat([0xff, mk, 0x00, 0x15], sofOf(300, 300)))]);
          crafted.push([`${tag}-dupsof-small-first`, insertAt(d, at, new Uint8Array(sofOf(300, 300)))]);
          crafted.push([`${tag}-soi-mid`, insertAt(d, at, cat([0xff, 0xd8], sofOf(300, 300)))]);
          crafted.push([`${tag}-fill-small`, insertAt(d, at, cat(new Array(8).fill(0xff), sofOf(300, 300)))]);
        }
        const unsafe: string[] = [];
        let accepted = 0;
        let imageioChecked = 0;
        for (const [name, bytes] of crafted) {
          const f = path.join(dir, `${name}.jpg`);
          fs.writeFileSync(f, bytes);
          const v = await verdict(bytes);
          if (v.code !== 'ok') continue;
          accepted++;
          const views: [string, { w: number; h: number } | 'error'][] = [['libjpeg', libjpegSize(f)]];
          if (SIPS) { views.push(['ImageIO', imageioSize(f)]); imageioChecked++; }
          for (const [dec, s] of views) {
            if (s === 'error') continue; // decoder refuses the file: nothing is allocated
            if (s.w !== v.header!.width || s.h !== v.header!.height || checkDimensions(s.w, s.h)) unsafe.push(`${name}: validator ${v.header!.width}x${v.header!.height}, ${dec} ${s.w}x${s.h}`);
          }
        }
        check(`F2. ${crafted.length} crafted files: none accepted by the validator decodes to a different or over-limit size in libjpeg${SIPS ? ' or ImageIO' : ''} (${accepted} accepted; ${unsafe.length ? unsafe.join('; ') : 'no mismatch'})`, unsafe.length === 0);
        if (!SIPS) skip('F3. ImageIO (WebKit/Safari decoder) differential', 'sips not available (macOS only)');
        else {
          // Precondition: ImageIO really does read the hidden real size of the C6-F1 file.
          const f = path.join(dir, 'base12000-desync-d0.jpg');
          const io = imageioSize(f);
          check('F3. precondition: ImageIO decodes the C6-F1 file at its real 12000 x 400 (so F2 is a meaningful differential)', io !== 'error' && io.w === 12_000 && io.h === 400);
          check(`F3b. ImageIO consulted for every validator-accepted crafted file (${imageioChecked})`, imageioChecked === accepted);
        }
        // The small legit file with the same desync must also be refused (marker, not size, decides).
        const ds = new Uint8Array(fs.readFileSync(small));
        check('F4. C6-F1 marker sequence inside an in-limit real JPEG -> corrupt-image', (await verdict(insertAt(ds, firstSofOffset(ds), desync(0xd0)))).code === 'corrupt-image');
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join('; ')})` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
