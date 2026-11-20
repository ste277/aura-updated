/**
 * AURA-PALM-G5-I1-R4.1 -- archive parser bypass closure and bounded
 * decompression (R4-N1 .. R4-N7; R4-N8 checked because the tar path changed).
 *
 * Runs the REAL scanner CLI (apps/web/scripts/check-palmistry-bundle.js, or
 * PALM_SCANNER_UNDER_TEST for negative controls) against throwaway trees.
 * For each finding: the exact independent-review fixture, independent
 * structural variations and benign controls. Memory is measured on the
 * scanner child process with an RSS watchdog that kills it at a ceiling, so
 * nothing can exhaust the host.
 *
 * Archives are generated in code (deterministic writers below); where the
 * stock tools exist (zip, gzip, bsdtar) a few fixtures are also built with
 * them, otherwise those checks are reported NOT RUN. Payloads: the installed
 * MediaPipe package, Aura's own source and synthetic bytes. Nothing is
 * extracted or executed. No network. No real palm images.
 *
 * Run: npx ts-node test/palmG5I1R41ArchiveBypass.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync, spawn, spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const MP = path.join(WEB, 'node_modules/@mediapipe/tasks-vision');
const SCANNER = process.env.PALM_SCANNER_UNDER_TEST || path.join(WEB, 'scripts/check-palmistry-bundle.js');

let passed = 0;
let failed = 0;
const notRun: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); }
}

const MJS = fs.readFileSync(path.join(MP, 'vision_bundle.mjs'));
const WASM = fs.readFileSync(path.join(MP, 'wasm/vision_wasm_nosimd_internal.wasm'));
const UI = fs.readFileSync(path.join(WEB, 'components/palm-scan/PalmImageInput.tsx'));
const TFL = Buffer.concat([Buffer.alloc(4), Buffer.from('TFL3'), Buffer.alloc(64, 7)]);
const BENIGN_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const OK = Buffer.from('ok\n');

// ------------------------------------------------------------------ deterministic writers
const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

interface ZE { name: string; data: Buffer; method?: number; attr?: number; usize?: number; crc?: number; extra?: Buffer; comment?: Buffer; comp?: Buffer }
function zip(entries: ZE[], opts: { comment?: Buffer } = {}): Buffer {
  const locals: Buffer[] = [];
  const cds: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const comp = e.comp ?? (method === 8 ? zlib.deflateRawSync(e.data) : e.data);
    const crc = e.crc ?? crc32(e.data);
    const usize = e.usize ?? e.data.length;
    const name = Buffer.from(e.name);
    const extra = e.extra ?? Buffer.alloc(0);
    const comment = e.comment ?? Buffer.alloc(0);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(extra.length, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x0314, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(usize, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(comment.length, 32);
    cd.writeUInt32LE(((e.attr ?? 0o100644) << 16) >>> 0, 38); cd.writeUInt32LE(off, 42);
    const local = Buffer.concat([lh, name, extra, comp]);
    locals.push(local);
    cds.push(Buffer.concat([cd, name, comment]));
    off += local.length;
  }
  const cdb = Buffer.concat(cds);
  const c = opts.comment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdb.length, 12); eocd.writeUInt32LE(off, 16); eocd.writeUInt16LE(c.length, 20);
  return Buffer.concat([...locals, cdb, eocd, c]);
}

type TE = { name: string; data?: Buffer; type?: string; v7?: boolean; padFill?: Buffer; unusedFill?: boolean };
function tarHeader(name: string, size: number, type: string, v7 = false): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136);
  h.write(v7 ? (type === '0' ? '0' : type) : type, 156);
  if (!v7) { h.write('ustar\0', 257); h.write('00', 263); }
  return h;
}
function seal(h: Buffer): Buffer { h.fill(0x20, 148, 156); let s = 0; for (const b of h) s += b; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148); return h; }
function tar(entries: TE[], opts: { trailer?: Buffer } = {}): Buffer {
  const out: Buffer[] = [];
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const h = tarHeader(e.name, data.length, e.type ?? '0', e.v7);
    if (e.unusedFill) h.fill(0x41, 505, 510);
    out.push(seal(h), data);
    const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
    if (e.padFill) e.padFill.copy(pad, 0, 0, Math.min(pad.length, e.padFill.length));
    out.push(pad);
  }
  out.push(Buffer.alloc(1024));
  if (opts.trailer) out.push(opts.trailer);
  return Buffer.concat(out);
}
const paxRecord = (key: string, value: string) => { const body = ` ${key}=${value}\n`; let len = body.length + 1; while (String(len).length + body.length !== len) len = String(len).length + body.length; return Buffer.from(String(len) + body, 'latin1'); };
const gz = (b: Buffer) => zlib.gzipSync(b);
const v7tar = (entries: TE[]) => tar(entries.map((e) => ({ ...e, v7: true })));

// ------------------------------------------------------------------ trees and runs
function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r41-'));
  const web = path.join(tmp, 'apps/web');
  fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
  fs.copyFileSync(SCANNER, path.join(web, 'scripts/check-palmistry-bundle.js'));
  fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
  fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), '{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}');
  fs.mkdirSync(path.join(web, '.next/static/chunks'), { recursive: true });
  fs.writeFileSync(path.join(web, '.next/static/chunks/main.js'), 'console.log("app")');
  fs.mkdirSync(path.join(web, 'public'), { recursive: true });
  return { tmp, web };
}
function scan(files: Record<string, Buffer>) {
  const t = makeTree();
  try {
    for (const [rel, data] of Object.entries(files)) { const f = path.join(t.web, 'public', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); }
    return spawnSync(process.execPath, [path.join(t.web, 'scripts/check-palmistry-bundle.js')], { encoding: 'utf8', timeout: 120000 });
  } finally {
    // Cleanup only the mkdtemp directory this call created (verified prefix).
    if (path.basename(t.tmp).startsWith('palm-r41-') && path.dirname(t.tmp) === os.tmpdir()) fs.rmSync(t.tmp, { recursive: true, force: true });
  }
}
/** Run the scanner on one file in a child process; sample RSS with `ps` every 25 ms; SIGKILL above `ceilingMiB`. */
function scanWithWatchdog(name: string, data: Buffer, ceilingMiB: number): Promise<{ code: number | null; killed: boolean; maxRssMiB: number; out: string }> {
  const t = makeTree();
  fs.writeFileSync(path.join(t.web, 'public', name), data);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(t.web, 'scripts/check-palmistry-bundle.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let max = 0;
    let killed = false;
    const iv = setInterval(() => {
      try {
        const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).trim());
        if (kb > max) max = kb;
        if (kb / 1024 > ceilingMiB && !killed) { killed = true; child.kill('SIGKILL'); }
      } catch { /* exited */ }
    }, 25);
    child.on('exit', (code) => {
      clearInterval(iv);
      if (path.basename(t.tmp).startsWith('palm-r41-') && path.dirname(t.tmp) === os.tmpdir()) fs.rmSync(t.tmp, { recursive: true, force: true });
      resolve({ code, killed, maxRssMiB: +(max / 1024).toFixed(1), out });
    });
  });
}
const fails = (r: any, re?: RegExp) => r.status === 1 && !r.signal && (!re || re.test(r.stderr));
const passes = (r: any) => r.status === 0 && !r.signal;
const out = (r: any) => `exit=${r.status}${r.signal ? ` ${r.signal}` : ''} ${((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(0, 3).join(' | ').slice(0, 260)}`;
const caseFail = (id: string, label: string, files: Record<string, Buffer>, re?: RegExp) => { const r = scan(files); check(`${id}. ${label} -> FAIL`, fails(r, re), out(r)); };
const casePass = (id: string, label: string, files: Record<string, Buffer>) => { const r = scan(files); check(`${id}. ${label} -> PASS`, passes(r), out(r)); };
const HIT = /odml\.pa\.googleapis\.com|HandLandmarkerGraph|_mediapipeLoggerGetEncodedApiKey/;

const MJS_ZIP = zip([{ name: 'a.js', data: MJS }]);
const OK_ZIP = zip([{ name: 'ok.txt', data: OK }]);
const hasTool = (t: string) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0;

async function main(): Promise<void> {
  // ================================================================ N1 gzip trailing data
  caseFail('N1.1', '[reviewer A19] gzip(benign) + 0x00 + zip(runtime)', { 'a.bin': Buffer.concat([gz(OK), Buffer.from([0]), MJS_ZIP]) }, /unexpected data after gzip member|trailing/);
  caseFail('N1.2', 'gzip(benign) + non-NUL garbage + zip(runtime)', { 'a.bin': Buffer.concat([gz(OK), Buffer.from('JUNK'), MJS_ZIP]) }, /unexpected data after gzip member|corrupt/);
  caseFail('N1.3', 'gzip(benign) + zip(benign) (any trailing data fails closed)', { 'a.bin': Buffer.concat([gz(OK), OK_ZIP]) }, /unexpected data after gzip member|corrupt/);
  caseFail('N1.4', 'multi-member gzip whose 2nd member holds the runtime (all members decompressed)', { 'a.gz': Buffer.concat([gz(OK), gz(MJS)]) }, HIT);
  casePass('N1.5', 'valid multi-member benign gzip (policy: all members inspected)', { 'a.gz': Buffer.concat([gz(OK), gz(Buffer.from('more'))]) });
  caseFail('N1.6', 'gzip with truncated CRC/ISIZE trailer', { 'a.gz': gz(Buffer.from('hello world '.repeat(100))).subarray(0, -3) }, /corrupt or truncated gzip/);
  { const g = Buffer.from(gz(Buffer.from('hello'))); g.writeUInt32LE((g.readUInt32LE(g.length - 8) ^ 1) >>> 0, g.length - 8); caseFail('N1.7', 'gzip with a wrong CRC trailer', { 'a.gz': g }, /CRC\/size trailer mismatch/); }
  { const fn = Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0x18, 0, 0, 0, 0, 0, 3]), Buffer.from('name.txt\0'), Buffer.from('odml.pa.googleapis.com\0'), zlib.deflateRawSync(OK)]); const tr = Buffer.alloc(8); tr.writeUInt32LE(crc32(OK), 0); tr.writeUInt32LE(OK.length, 4);
    caseFail('N1.8', 'gzip header FCOMMENT carrying a signature is inspected', { 'a.gz': Buffer.concat([fn, tr]) }, /odml/); }
  casePass('N1.9', 'ordinary benign single gzip', { 'a.txt.gz': gz(Buffer.from('plain text')) });

  // ================================================================ N2 ZIP with prefix/suffix
  caseFail('N2.1', '[reviewer A03] "X" + zip(runtime) + "Y"', { 'a.bin': Buffer.concat([Buffer.from('X'), MJS_ZIP, Buffer.from('Y')]) }, HIT);
  for (const [pre, suf] of [[7, 0], [4096, 3], [0, 1], [0, 100]] as const) {
    caseFail(`N2.2.${pre}.${suf}`, `prefix ${pre} B + zip(runtime) + suffix ${suf} B`, { 'a.dat': Buffer.concat([Buffer.alloc(pre, 0x5a), MJS_ZIP, Buffer.alloc(suf, 0x5a)]) }, HIT);
  }
  caseFail('N2.3', 'SFX-style random 2 KiB stub + zip(runtime)', { 'setup.bin': Buffer.concat([Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 131 + 7) & 0xff)), MJS_ZIP]) }, HIT);
  caseFail('N2.4', 'zip(benign) + suffix that is gzip(runtime) (suffix region inspected)', { 'a.bin': Buffer.concat([OK_ZIP, gz(MJS)]) }, HIT);
  caseFail('N2.5', 'zip(benign) + suffix carrying a plaintext signature', { 'a.bin': Buffer.concat([OK_ZIP, Buffer.from('xx node_modules/@mediapipe/ xx')]) }, /node_modules\/@mediapipe\//);
  casePass('N2.6', 'benign zip with a 3-byte prefix and 5-byte suffix', { 'a.bin': Buffer.concat([Buffer.from('abc'), OK_ZIP, Buffer.from('trail')]) });
  caseFail('N2.7', 'zip(runtime) renamed .woff2 with prefix and suffix', { 'f.woff2': Buffer.concat([Buffer.from('wOF2'), MJS_ZIP, Buffer.from('\0\0')]) }, HIT);

  // ================================================================ N3 concatenated / competing interpretations
  caseFail('N3.1', '[reviewer A02] zip(runtime) + zip(benign)', { 'a.bin': Buffer.concat([MJS_ZIP, OK_ZIP]) }, /multiple ZIP central directories|unreferenced ZIP local file header/);
  caseFail('N3.2', 'zip(benign) + zip(runtime)', { 'a.bin': Buffer.concat([OK_ZIP, MJS_ZIP]) }, /multiple ZIP central directories|unreferenced ZIP local file header/);
  caseFail('N3.3', 'three concatenated zips', { 'a.bin': Buffer.concat([OK_ZIP, MJS_ZIP, OK_ZIP]) }, /multiple ZIP central directories|unreferenced ZIP local file header/);
  { const streamOnly = MJS_ZIP.subarray(0, MJS_ZIP.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    caseFail('N3.4', 'streaming-only zip (local headers, no central directory) before a benign zip', { 'a.bin': Buffer.concat([streamOnly, OK_ZIP]) }, /unreferenced ZIP local file header|multiple/); }
  caseFail('N3.5', 'zip(runtime) carried in the archive comment of a benign zip', { 'a.zip': zip([{ name: 'ok.txt', data: OK }], { comment: MJS_ZIP.subarray(0, Math.min(MJS_ZIP.length, 65535)) }) }, /HandLandmarkerGraph|odml|unreferenced|multiple|malformed/);
  caseFail('N3.6', 'nested: zip whose entry is zip(runtime)+zip(benign)', { 'n.zip': zip([{ name: 'inner.bin', data: Buffer.concat([MJS_ZIP, OK_ZIP]) }]) }, /multiple ZIP central directories|unreferenced ZIP local file header/);
  caseFail('N3.7', 'zip(benign) + tgz(runtime) appended', { 'a.bin': Buffer.concat([OK_ZIP, gz(tar([{ name: 'a.js', data: MJS }]))]) }, HIT);
  casePass('N3.8', 'valid single zip (control)', { 'a.zip': OK_ZIP });

  // ================================================================ N4 v7 tar
  const INNER = zip([{ name: 'a.js', data: MJS }]);
  caseFail('N4.1', '[reviewer A10] plain v7 tar[inner.zip(runtime)]', { 'a.tar': v7tar([{ name: 'inner.zip', data: INNER }]) }, HIT);
  caseFail('N4.2', '[reviewer A09/A20] gzip(v7 tar[inner.zip(runtime)])', { 'a.tgz': gz(v7tar([{ name: 'inner.zip', data: INNER }])) }, HIT);
  caseFail('N4.3', 'v7 tar with prohibited JavaScript', { 'a.tar': v7tar([{ name: 'a.js', data: MJS }]) }, HIT);
  caseFail('N4.4', 'v7 tar with prohibited WASM (deflated in a zip inside)', { 'a.tar': v7tar([{ name: 'w.zip', data: zip([{ name: 'w.wasm', data: WASM }]) }]) }, /WASM binary with MediaPipe symbol/);
  caseFail('N4.5', 'v7 tar with model data', { 'a.tar': v7tar([{ name: 'm.bin', data: zip([{ name: 'hand_detector.tflite', data: TFL, method: 0 }]) }]) }, /hand_detector\.tflite/);
  casePass('N4.6', 'benign v7 tar', { 'a.tar': v7tar([{ name: 'readme.txt', data: Buffer.from('hello') }]) });
  caseFail('N4.7', 'renamed v7 tgz (.png)', { 'img.png': gz(v7tar([{ name: 'inner.zip', data: INNER }])) }, HIT);
  caseFail('N4.8', 'nested v7 tar inside a zip', { 'n.zip': zip([{ name: 'inner.tar', data: v7tar([{ name: 'z.zip', data: INNER }]) }]) }, HIT);
  // v7 recognition must be essential: a gzip entry (not at byte 0, no ZIP signature, no plaintext) is only reachable by parsing the tar.
  caseFail('N4.10', 'v7 tar whose entry is gzip(runtime) (only tar parsing can reach it)', { 'a.tar': v7tar([{ name: 'rt.gz', data: gz(MJS) }]) }, HIT);
  caseFail('N4.11', 'gzip(v7 tar[gzip(runtime)]) renamed .bin', { 'a.bin': gz(v7tar([{ name: 'x.gz', data: gz(MJS) }])) }, HIT);
  caseFail('N4.12', 'v7 tar with a nonzero byte in its unused header area', { 'a.tar': (() => { const t = v7tar([{ name: 'a.txt', data: OK }]); t[300] = 0x41; let s = 0; for (let i = 0; i < 512; i++) s += i >= 148 && i < 156 ? 0x20 : t[i]; t.write(s.toString(8).padStart(6, '0') + '\0 ', 148); return t; })() }, /unused tar header fields/);
  if (hasTool('bsdtar')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r41-tool-'));
    try {
      fs.writeFileSync(path.join(d, 'inner.zip'), INNER);
      execFileSync('bsdtar', ['--format=v7', '-czf', path.join(d, 'pkg.tgz'), '-C', d, 'inner.zip']);
      const listed = execFileSync('bsdtar', ['-tzf', path.join(d, 'pkg.tgz')], { encoding: 'utf8' }).trim();
      caseFail('N4.9', `[reviewer A20, stock tool] bsdtar --format=v7 -czf (bsdtar lists: ${listed})`, { 'pkg.tgz': fs.readFileSync(path.join(d, 'pkg.tgz')) }, HIT);
    } finally { if (path.basename(d).startsWith('palm-r41-tool-')) fs.rmSync(d, { recursive: true, force: true }); }
  } else { notRun.push('N4.9 stock bsdtar v7'); console.log('NOT RUN N4.9 (bsdtar not available)'); }

  // ================================================================ N5 bounded decompression
  {
    // A 300 MiB zero stream declared as size 0, built incrementally (the test process never holds 300 MiB).
    const deflated: Buffer[] = await new Promise((resolve, reject) => { const chunks: Buffer[] = []; const d = zlib.createDeflateRaw({ level: 9 }); d.on('data', (c) => chunks.push(c)); d.on('end', () => resolve(chunks)); d.on('error', reject); const z = Buffer.alloc(1024 * 1024); let i = 0; const pump = () => { while (i < 300) { i++; if (!d.write(z)) { d.once('drain', pump); return; } } d.end(); }; pump(); });
    const comp = Buffer.concat(deflated);
    const bomb = zip([{ name: 'z.bin', data: Buffer.alloc(0), comp, usize: 0, crc: 0 }]);
    const r = await scanWithWatchdog('bomb.zip', bomb, 512);
    check('N5.1. [reviewer] declared size 0, actual 300 MiB: fails closed', !r.killed && r.code === 1 && /size above declared|exceeds/.test(r.out), `code=${r.code} killed=${r.killed} ${r.out.slice(0, 200)}`);
    check('N5.2. ...peak scanner RSS stays far below the documented bound (< 160 MiB; R4 reached 598 MiB)', !r.killed && r.maxRssMiB < 160, `maxRSS=${r.maxRssMiB} MiB`);
    const r2 = await scanWithWatchdog('bomb.zip', bomb, 512);
    check('N5.3. ...deterministic failure across runs', r2.code === r.code && (r2.out.split('\n')[1] || '') === (r.out.split('\n')[1] || ''));
    const nested = zip([{ name: 'inner.zip', data: bomb }]);
    const r3 = await scanWithWatchdog('nested.zip', nested, 512);
    check('N5.4. nested compressed archive containing the bomb: fails closed, bounded', !r3.killed && r3.code === 1 && r3.maxRssMiB < 160, `code=${r3.code} maxRSS=${r3.maxRssMiB}`);
    const gzb = Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]), comp, Buffer.alloc(8)]);
    const r4 = await scanWithWatchdog('bomb.gz', gzb, 512);
    check('N5.5. gzip stream expanding to 300 MiB: fails closed at the entry cap, bounded', !r4.killed && r4.code === 1 && /decompressed-size limit exceeded for gzip/.test(r4.out) && r4.maxRssMiB < 200, `code=${r4.code} maxRSS=${r4.maxRssMiB} ${r4.out.slice(0, 160)}`);
  }
  caseFail('N5.6', 'declared size smaller than actual output', { 'a.zip': zip([{ name: 'a.txt', data: Buffer.from('x'.repeat(5000)), usize: 100 }]) }, /size above declared/);
  caseFail('N5.7', 'declared size larger than actual output', { 'a.zip': zip([{ name: 'a.txt', data: Buffer.from('hello'), usize: 50 }]) }, /size mismatch|deflate stream/);
  caseFail('N5.8', 'extremely high declared compression ratio', { 'a.zip': zip([{ name: 'a.bin', data: Buffer.alloc(4 * 1024 * 1024) }]) }, /compression-ratio limit/);
  caseFail('N5.9', 'truncated deflate stream', { 'a.zip': zip([{ name: 'a.txt', data: Buffer.from('hello world '.repeat(300)), comp: zlib.deflateRawSync(Buffer.from('hello world '.repeat(300))).subarray(0, 20) }]) }, /decompression error|deflate stream/);
  caseFail('N5.10', 'deflate stream followed by hidden bytes inside the entry', { 'a.zip': zip([{ name: 'a.txt', data: OK, comp: Buffer.concat([zlib.deflateRawSync(OK), zlib.deflateRawSync(MJS)]) }]) }, /does not span the entry data/);
  caseFail('N5.11', 'malformed size field (compressed size beyond archive)', { 'a.zip': (() => { const z = Buffer.from(OK_ZIP); const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); z.writeUInt32LE(0x7fffffff, cd + 20); return z; })() }, /truncated ZIP entry|malformed/);
  {
    // Limit boundaries and aggregate expansion through the API (small limits).
    const sm: any = require(SCANNER);
    if (typeof sm.inspectArtifacts === 'function') {
      const L = sm.INSPECTION_LIMITS;
      const t = makeTree();
      try {
        const data1000 = Buffer.from(Array.from({ length: 1000 }, (_, i) => 65 + (i % 26)));
        fs.writeFileSync(path.join(t.web, 'public/at.zip'), zip([{ name: 'a.txt', data: data1000 }]));
        let res = sm.inspectArtifacts(t.web, { ...L, maxArchiveEntryBytes: 1000 });
        check('N5.12. entry exactly at the entry-size limit passes', res.errors.length === 0, JSON.stringify(res.errors));
        res = sm.inspectArtifacts(t.web, { ...L, maxArchiveEntryBytes: 999 });
        check('N5.13. one byte above the entry-size limit fails', res.errors.some((e: any) => /entry-size limit/.test(e.error)));
        fs.writeFileSync(path.join(t.web, 'public/many.zip'), zip(Array.from({ length: 20 }, (_, i) => ({ name: `f${i}.txt`, data: data1000 }))));
        res = sm.inspectArtifacts(t.web, { ...L, maxArchiveDecompressedBytes: 10000 });
        check('N5.14. aggregate expansion across many entries hits the per-archive limit', res.errors.some((e: any) => /per-archive decompressed-bytes limit/.test(e.error)));
        res = sm.inspectArtifacts(t.web, { ...L, maxTotalDecompressedBytes: 15000 });
        check('N5.15. aggregate expansion hits the whole-scan limit', res.errors.some((e: any) => /total decompressed-bytes limit/.test(e.error)));
      } finally { if (path.basename(t.tmp).startsWith('palm-r41-')) fs.rmSync(t.tmp, { recursive: true, force: true }); }
    } else { for (const id of ['N5.12', 'N5.13', 'N5.14', 'N5.15']) check(`${id}. limits API present`, false); }
  }

  // ================================================================ N6 directory entries carrying data
  caseFail('N6.1', '[reviewer A04] directory entry "d/" with deflated runtime data', { 'a.zip': zip([{ name: 'd/', data: MJS, attr: 0o040755 }]) }, /directory entry with data/);
  caseFail('N6.2', 'unix-directory entry without a trailing slash carrying data', { 'a.zip': zip([{ name: 'dir', data: MJS, attr: 0o040755 }]) }, /directory entry with data/);
  caseFail('N6.3', 'directory entry declaring size 0 but whose deflate stream yields data', { 'a.zip': zip([{ name: 'd/', data: Buffer.alloc(0), comp: zlib.deflateRawSync(MJS), usize: 0, crc: 0, attr: 0o040755 }]) }, /size above declared|directory entry/);
  casePass('N6.4', 'ordinary empty directory entries (stored and deflated empty)', { 'a.zip': zip([{ name: 'd/', data: Buffer.alloc(0), method: 0, attr: 0o040755 }, { name: 'e/', data: Buffer.alloc(0), method: 8, attr: 0o040755 }, { name: 'd/f.txt', data: OK }]) });

  // ================================================================ N7 tar metadata, padding, ZIP metadata
  caseFail('N7.1', '[reviewer A05] tgz with a pax comment= record holding the runtime', { 'a.tgz': gz(Buffer.concat([seal(tarHeader('PaxHeader/ok.txt', paxRecord('comment', MJS.toString('latin1')).length, 'x')), paxRecord('comment', MJS.toString('latin1')), Buffer.alloc((512 - (paxRecord('comment', MJS.toString('latin1')).length % 512)) % 512), tar([{ name: 'ok.txt', data: OK }])])) }, HIT);
  caseFail('N7.2', '[reviewer A06] tgz with a signature in tar padding', { 'a.tgz': gz(tar([{ name: 'ok.txt', data: OK, padFill: Buffer.concat([Buffer.alloc(10), Buffer.from('node_modules/@mediapipe/')]) }])) }, /nonzero tar padding|node_modules\/@mediapipe\//);
  caseFail('N7.3', 'tar padding hiding a deflated zip (binary, not plaintext)', { 'a.tar': tar([{ name: 'ok.txt', data: Buffer.alloc(10), padFill: Buffer.alloc(400, 0x7) }]) }, /nonzero tar padding/);
  caseFail('N7.4', 'GNU long-name record carrying the runtime as plaintext', { 'a.tgz': gz(Buffer.concat([seal(tarHeader('././@LongLink', MJS.length, 'L')), MJS, Buffer.alloc((512 - (MJS.length % 512)) % 512), tar([{ name: 'ok.txt', data: OK }])])) }, HIT);
  caseFail('N7.5', 'GNU long-link record carrying a zip(runtime)', { 'a.tar': Buffer.concat([seal(tarHeader('././@LongLink', MJS_ZIP.length, 'K')), MJS_ZIP, Buffer.alloc((512 - (MJS_ZIP.length % 512)) % 512), tar([{ name: 'ok.txt', data: OK }])]) }, HIT);
  caseFail('N7.6', 'nonzero bytes in unused tar header fields', { 'a.tar': tar([{ name: 'ok.txt', data: OK, unusedFill: true }]) }, /unused tar header fields/);
  caseFail('N7.7', 'two tar archives concatenated in one stream', { 'a.tar': Buffer.concat([tar([{ name: 'ok.txt', data: OK }]), tar([{ name: 'a.js', data: MJS }])]) }, /after tar end-of-archive|odml/);
  caseFail('N7.8', 'pax record with malformed length', { 'a.tar': Buffer.concat([seal(tarHeader('PaxHeader/x', 12, 'x')), Buffer.from('99 path=abc\n'), Buffer.alloc(500), tar([{ name: 'ok.txt', data: OK }])]) }, /malformed pax record/);
  caseFail('N7.9', '[reviewer A08] oversized ZIP local extra field (hidden deflate data)', { 'a.zip': zip([{ name: 'ok.txt', data: OK, extra: Buffer.concat([Buffer.from([0xfe, 0xca, 0x60, 0xea]), zlib.deflateRawSync(MJS.subarray(0, 30000))]) }]) }, /oversized ZIP extra field/);
  caseFail('N7.10', 'small ZIP extra field carrying a signature', { 'a.zip': zip([{ name: 'ok.txt', data: OK, extra: Buffer.concat([Buffer.from([0xfe, 0xca, 24, 0]), Buffer.from('node_modules/@mediapipe/')]) }]) }, /node_modules\/@mediapipe\//);
  caseFail('N7.11', 'ZIP entry comment carrying a signature', { 'a.zip': zip([{ name: 'ok.txt', data: OK, comment: Buffer.from('odml.pa.googleapis.com') }]) }, /odml/);
  caseFail('N7.12', 'global pax header (unsupported, fails closed)', { 'a.tar': Buffer.concat([seal(tarHeader('pax_global_header', paxRecord('comment', 'x').length, 'g')), paxRecord('comment', 'x'), Buffer.alloc(512 - paxRecord('comment', 'x').length), tar([{ name: 'ok.txt', data: OK }])]) }, /global pax header/);

  // ================================================================ benign compatibility matrix
  casePass('B1', 'ZIP stored + deflated entries', { 'a.zip': zip([{ name: 'a.txt', data: OK, method: 0 }, { name: 'b.js', data: Buffer.from('console.log(1)'), method: 8 }]) });
  casePass('B2', 'ZIP with ordinary directory entries', { 'a.zip': zip([{ name: 'pkg/', data: Buffer.alloc(0), method: 0, attr: 0o040755 }, { name: 'pkg/i.js', data: Buffer.from('1') }]) });
  casePass('B3', 'ZIP with a valid archive comment and entry comment', { 'a.zip': zip([{ name: 'a.txt', data: OK, comment: Buffer.from('fine') }], { comment: Buffer.from('built by tests') }) });
  casePass('B4', 'ustar TAR', { 'a.tar': tar([{ name: 'a.txt', data: OK }]) });
  casePass('B5', 'TGZ', { 'a.tgz': gz(tar([{ name: 'pkg/', type: '5' }, { name: 'pkg/a.js', data: Buffer.from('x') }])) });
  casePass('B6', 'v7 TAR', { 'a.tar': v7tar([{ name: 'a.txt', data: OK }]) });
  { const pr = paxRecord('path', `${'deep/'.repeat(30)}file.txt`); casePass('B7', 'pax TAR (long path via pax record)', { 'a.tar': Buffer.concat([seal(tarHeader('PaxHeader/f', pr.length, 'x')), pr, Buffer.alloc((512 - (pr.length % 512)) % 512), tar([{ name: 'file.txt', data: OK }])]) }); }
  { const ln = Buffer.from(`${'long/'.repeat(30)}name.txt\0`); casePass('B8', 'GNU TAR (long name record)', { 'a.tar': Buffer.concat([seal(tarHeader('././@LongLink', ln.length, 'L')), ln, Buffer.alloc((512 - (ln.length % 512)) % 512), tar([{ name: 'short', data: OK }])]) }); }
  casePass('B9', '`tar -C dir .` layout ("./" root entry; R4-N8)', { 'a.tar': tar([{ name: './', type: '5' }, { name: './a.txt', data: OK }]) });
  casePass('B10', 'single gzip', { 'a.gz': gz(Buffer.from('text')) });
  casePass('B11', 'valid nested archives (tgz inside zip)', { 'a.zip': zip([{ name: 'in.tgz', data: gz(tar([{ name: 'a.txt', data: OK }])) }]) });
  casePass('B12', 'unrelated WASM', { 'x.wasm': BENIGN_WASM });
  casePass('B13', 'benign MediaPipe mentions without runtime content', { 'notes.md': Buffer.from('Palm input uses MediaPipe (@mediapipe/tasks-vision) in development only.') });
  if (hasTool('bsdtar') && hasTool('zip')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r41-tool-'));
    try {
      fs.mkdirSync(path.join(d, 'src/sub'), { recursive: true });
      fs.writeFileSync(path.join(d, 'src/a.txt'), 'hello');
      fs.writeFileSync(path.join(d, 'src/sub/b.json'), '{"x":1}');
      execFileSync('bsdtar', ['-C', path.join(d, 'src'), '-cf', path.join(d, 'dot.tar'), '.']);
      execFileSync('bsdtar', ['--format=pax', '-C', path.join(d, 'src'), '-czf', path.join(d, 'pax.tgz'), '.']);
      execFileSync('bsdtar', ['--format=gnutar', '-C', path.join(d, 'src'), '-cf', path.join(d, 'gnu.tar'), '.']);
      execFileSync('bsdtar', ['--format=v7', '-C', path.join(d, 'src'), '-cf', path.join(d, 'v7.tar'), 'a.txt']);
      execFileSync('zip', ['-q', '-r', '-z', path.join(d, 'c.zip'), '.'], { cwd: path.join(d, 'src'), input: 'zip comment\n.\n' });
      for (const f of ['dot.tar', 'pax.tgz', 'gnu.tar', 'v7.tar', 'c.zip']) casePass(`B14.${f}`, `stock-tool benign archive ${f}`, { [f]: fs.readFileSync(path.join(d, f)) });
    } finally { if (path.basename(d).startsWith('palm-r41-tool-')) fs.rmSync(d, { recursive: true, force: true }); }
  } else { notRun.push('B14 stock-tool benign archives'); console.log('NOT RUN B14 (bsdtar/zip not available)'); }

  // ================================================================ upload code and model in the new paths
  caseFail('U1', 'Upload Photo source inside a prefixed zip', { 'a.bin': Buffer.concat([Buffer.from('P'), zip([{ name: 'PalmImageInput.tsx', data: UI }])]) }, /Check a palm photo|g5-i1-dev/);
  caseFail('U2', 'model entries inside a v7 tgz', { 'm.tgz': gz(v7tar([{ name: 'm.bin', data: zip([{ name: 'hand_landmarks_detector.tflite', data: TFL, method: 0 }]) }])) }, /hand_landmarks_detector\.tflite/);

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join('; ')})` : ''}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
