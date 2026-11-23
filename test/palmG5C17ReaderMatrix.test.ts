/**
 * AURA-PALM-G5-C17 -- reader-versus-scanner matrix for the C16 findings of the
 * bundle scanner (`apps/web/scripts/check-palmistry-bundle.js`):
 *
 *   C16-F1  (P2) embedded gzip that emits content and THEN fails (invalid block,
 *                short truncated stream); C16-F1b a back-reference "too far
 *                back" (GNU gzip zero-fills and keeps decoding)
 *   C16-F2  (P2) LHA / LArc archives (bsdtar / libarchive)
 *   C16-F3  (P3) pack (1F 1E) and gzip LZH (1F A0) at offset 0
 *   C17-N1       gzip with the old magic 1F 9E at offset 0 (found during C17)
 *
 * For every fixture the suite runs every INSTALLED real reader that applies
 * (Node createGunzip streaming, Node DecompressionStream('gzip') -- the WHATWG
 * API browsers expose --, Python zlib streaming, gzip -dc, bsdtar), records
 * which recover the hidden sentinel, and then runs the scanner on the bytes as
 * they would sit in the build output. Invariant: when ANY reader recovers the
 * sentinel the scanner must fail closed. Fixtures no reader recovers carry a
 * fixed expectation (fail-closed policy, or PASS for coincidental bytes).
 * Readers that are not installed are reported, never simulated. Platform
 * preconditions (D*) prove the readers behave as the fixtures assume. Mutants
 * revert each C17 rule. PALM_SCANNER_UNDER_TEST=<path> runs another scanner
 * (mutants skip).
 *
 * Run: npx ts-node test/palmG5C17ReaderMatrix.test.ts
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { spawnSync } from 'child_process';
import * as F from './palmG5I1R43Fixtures';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const SCANNER = process.env.PALM_SCANNER_UNDER_TEST || path.join(WEB, 'scripts/check-palmistry-bundle.js');
const SENT = 'palm-dev-assets';
const FOREIGN = /unsupported archive or compressed stream \(([^)]+\)?)\)/;
const TMP = 'palm-c17-';

let passed = 0, failed = 0;
const notRun: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); } };
const which = (...ts: string[]) => ts.find((t) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0) || null;
const cleanup = (d: string) => { if (path.basename(d).startsWith(TMP) && path.dirname(d) === os.tmpdir()) fs.rmSync(d, { recursive: true, force: true }); };

// ------------------------------------------------------------------ scanner harness (same layout as D7 / C11 / C13 / C15)
interface Run { exit: number; errors: string[]; hits: string[]; reason: string }
function run(name: string, data: Buffer, scanner = SCANNER): Run {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
  try {
    const web = path.join(tmp, 'apps/web');
    fs.mkdirSync(path.join(web, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
    fs.copyFileSync(scanner, path.join(web, 'scripts/check-palmistry-bundle.js'));
    fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
    fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), '{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}');
    fs.mkdirSync(path.join(web, '.next/static/chunks'), { recursive: true }); fs.writeFileSync(path.join(web, '.next/static/chunks/main.js'), 'console.log("app")');
    fs.mkdirSync(path.join(web, 'public'), { recursive: true });
    fs.writeFileSync(path.join(web, 'public', name), data);
    const sp = path.join(web, 'scripts/check-palmistry-bundle.js');
    const mod = require(sp);
    const api = mod.inspectArtifacts(web, { ...mod.INSPECTION_LIMITS });
    delete require.cache[require.resolve(sp)];
    const errors: string[] = api.errors.map((e: any) => e.error);
    const hits: string[] = [...new Set<string>(api.hits.map((h: any) => h.sentinel))];
    return { exit: errors.length || hits.length ? 1 : 0, errors, hits, reason: errors[0] || hits[0] || '' };
  } finally { cleanup(tmp); }
}
const fmtOf = (r: Run) => { const m = FOREIGN.exec(r.errors.find((e) => FOREIGN.test(e)) || ''); return m ? m[1] : r.errors.length ? 'error' : r.hits.length ? 'hit' : ''; };

// ------------------------------------------------------------------ real readers
type ReaderId = 'node-gunzip' | 'decompression-stream' | 'python-zlib' | 'gzip' | 'bsdtar';
const GZIP = which('gzip');
const gzVer = GZIP ? spawnSync('gzip', ['--version'], { encoding: 'utf8' }) : null;
const FLAVOR = !gzVer ? 'none' : /Apple/.test(gzVer.stdout + gzVer.stderr) ? 'apple' : /^gzip 1\.\d+/m.test(gzVer.stdout) ? 'gnu' : 'other';
// G5-C17-CI-1: the exact gzip build is recorded, because GNU gzip's handling of a
// back-reference before the stream start differs between builds (1.12 on Debian 12
// zero-fills and recovers F1b; the GNU gzip on the Ubuntu 26.04 runner refuses it).
const GZ_VERSION = gzVer ? ((gzVer.stdout || gzVer.stderr || '').split('\n')[0].trim() || 'unknown') : 'none';
const GNU_RELEASE = FLAVOR === 'gnu' ? (/^gzip (1\.\d+)/m.exec(gzVer!.stdout) || [])[1] || '' : '';
// sha256 of the F1b gzip stream whose sentinel GNU gzip 1.12 (Debian 12) recovered live
// in G5-C17 (suites/c17_gnu_debian.log). Pinned so the verified regression fixture cannot drift.
const F1B_SHA256_VERIFIED_GZIP_1_12 = '147aaade4b0d89ae235d8a2a65ae5a84d239ffea292655a1f1d64292f53a239a';
const PY = which('python3');
const BSDTAR = which('bsdtar');
const available: Record<ReaderId, boolean> = { 'node-gunzip': true, 'decompression-stream': typeof (globalThis as any).DecompressionStream === 'function', 'python-zlib': !!PY, gzip: !!GZIP, bsdtar: !!BSDTAR };
// Streaming readers get the input in CHUNK-byte pieces (a network stream delivers
// small chunks): zlib-based readers drop the output of the chunk that fails, so
// what they emit before an error depends on where the chunk boundary falls.
const CHUNK = 16;
const PY_STREAM = 'import sys,zlib\nd=zlib.decompressobj(31)\nb=sys.stdin.buffer.read()\nfor i in range(0,len(b),16):\n  try: sys.stdout.buffer.write(d.decompress(b[i:i+256]))\n  except zlib.error: break\n';
async function readWith(id: ReaderId, input: Buffer): Promise<Buffer> {
  if (id === 'node-gunzip') return new Promise((res) => { const o: Buffer[] = []; const g = zlib.createGunzip(); g.on('data', (d) => o.push(d)); g.on('error', () => res(Buffer.concat(o))); g.on('end', () => res(Buffer.concat(o))); for (let i = 0; i < input.length; i += CHUNK) g.write(input.subarray(i, i + CHUNK)); g.end(); });
  if (id === 'decompression-stream') {
    const o: Buffer[] = [];
    try {
      let i = 0;
      const src = new ReadableStream({ pull(c) { if (i >= input.length) { c.close(); return; } c.enqueue(new Uint8Array(input.subarray(i, i + CHUNK))); i += CHUNK; } });
      for await (const c of src.pipeThrough(new (globalThis as any).DecompressionStream('gzip')) as any) o.push(Buffer.from(c));
    } catch { /* output emitted before the error stays */ }
    return Buffer.concat(o);
  }
  if (id === 'python-zlib') return (spawnSync(PY!, ['-I', '-c', PY_STREAM], { input, timeout: 30000, maxBuffer: 1 << 26 }).stdout as Buffer) || Buffer.alloc(0);
  if (id === 'gzip') return (spawnSync('gzip', ['-d', '-c'], { input, timeout: 30000, maxBuffer: 1 << 26 }).stdout as Buffer) || Buffer.alloc(0);
  // bsdtar reads a FILE (seekable, as a file on disk): its self-extractor search behaves differently on a pipe.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
  try { const f = path.join(d, 'in.bin'); fs.writeFileSync(f, input); return (spawnSync(BSDTAR!, ['-x', '-O', '-f', f], { timeout: 30000, maxBuffer: 1 << 26 }).stdout as Buffer) || Buffer.alloc(0); } finally { cleanup(d); }
}
const GZ_READERS: ReaderId[] = ['node-gunzip', 'decompression-stream', 'python-zlib', 'gzip'];

// ------------------------------------------------------------------ fixture builders (benign, synthetic; the sentinel never appears as plain bytes)
const fill = (n: number, c = 0x2f) => Buffer.alloc(n, c);
const js = (b: Buffer) => Buffer.concat([Buffer.from('/* chunk */ var a = 1;\n'), b, Buffer.from('\nvar z = 2;\n')]);
const code = (b: Buffer) => Buffer.concat([Buffer.from('cffaedfe0c000001', 'hex'), fill(256, 0x90), b, fill(256, 0xcc)]);
const prng = (seed: number) => () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 8; };
const words = (n: number, seed = 7) => { const r = prng(seed); let s = ''; while (s.length < n) { for (let k = 3 + (r() % 6); k > 0; k--) s += String.fromCharCode(97 + (r() % 26)); s += ' '; } return Buffer.from(s.slice(0, n)); };
const GZ_HEAD = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x03]);
function tar(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.fill(0x20, 148, 156); let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]);
}
const zipStored = (name: string, data: Buffer) => F.buildZip([{ name, data, method: 0 }]).buf;
/** LSB-first deflate bit writer with fixed-Huffman helpers. */
class Bits {
  private out: number[] = []; private cur = 0; private n = 0;
  put(v: number, k: number) { for (let i = 0; i < k; i++) { this.cur |= ((v >> i) & 1) << this.n; if (++this.n === 8) { this.out.push(this.cur); this.cur = 0; this.n = 0; } } }
  huff(code: number, len: number) { for (let i = len - 1; i >= 0; i--) this.put((code >> i) & 1, 1); }
  lit(c: number) { if (c < 144) this.huff(0x30 + c, 8); else this.huff(0x190 + c - 144, 9); }
  sym(s: number) { if (s < 280) this.huff(s - 256, 7); else this.huff(0xc0 + s - 280, 8); }
  done() { return Buffer.from(this.n ? [...this.out, this.cur] : this.out); }
}
/** Deflate data that decodes to `content` and then hits an invalid (reserved) block type. */
function deflateThenError(content: Buffer) {
  const d = zlib.deflateRawSync(content, { level: 9, finishFlush: zlib.constants.Z_SYNC_FLUSH });
  return Buffer.concat([d, Buffer.from([0x07, 0x00])]); // BFINAL=1, BTYPE=11 (reserved): Z_DATA_ERROR
}
/** Fixed-Huffman block: a 3-byte copy from distance 33 at stream start ("too far back"), then `content`, then end of block. */
function tooFarBack(content: Buffer) {
  const b = new Bits(); b.put(1, 1); b.put(1, 2);
  b.sym(257); b.huff(10, 5); b.put(0, 4); // length 3, distance code 10 (base 33, 4 extra bits = 0)
  for (const c of content) b.lit(c);
  b.sym(256);
  return b.done();
}
/** Fixed-Huffman literals with no end of block (a stream cut short). */
function literalsOnly(content: Buffer) { const b = new Bits(); b.put(0, 1); b.put(1, 2); for (const c of content) b.lit(c); return b.done(); }
const trailer = (out: Buffer) => { const t = Buffer.alloc(8); t.writeUInt32LE(F.crc32(out as any) >>> 0, 0); t.writeUInt32LE(out.length, 4); return t; };
const S = Buffer.from(SENT);
// LHA -lh5- (level 0) and gzip LZH: lh5 bitstream; pack: static Huffman. Encoders adapted from the C16 reviewer's probe generator.
class MSB { bits: number[] = []; put(v: number, n: number) { for (let i = n - 1; i >= 0; i--) this.bits.push((v >> i) & 1); } done() { const b = [...this.bits]; while (b.length % 8) b.push(0); const o = Buffer.alloc(b.length / 8); for (let i = 0; i < b.length; i++) if (b[i]) o[i >> 3] |= 0x80 >> (i & 7); return o; } }
const DATA = Buffer.from(`<${SENT}>`);
const SYMS = (() => { const s = [...new Set(DATA)].sort((a, b) => a - b); for (const c of Buffer.from('0123456789ABCDEFGHIJ')) if (s.length < 15 && !s.includes(c)) s.push(c); return s; })();
function packStream() {
  const lits = [...SYMS].sort((a, b) => a - b); const w = new MSB();
  for (const c of DATA) w.put(lits.indexOf(c), 4); w.put(15, 4);
  const h = Buffer.alloc(11); h[0] = 0x1f; h[1] = 0x1e; h.writeUInt32BE(DATA.length, 2); h[6] = 4; h[10] = 14;
  return Buffer.concat([h, Buffer.from(lits), w.done()]);
}
const LH = (() => { const s = [...SYMS]; for (const c of Buffer.from('KLMNOP')) if (s.length < 16 && !s.includes(c)) s.push(c); return s.sort((a, b) => a - b); })();
function lh5Block(terminate: boolean) {
  const w = new MSB(); w.put(DATA.length, 16); w.put(7, 5); for (let i = 0; i < 3; i++) w.put(2, 3); w.put(3, 2); w.put(2, 3);
  const PT: Record<number, number> = { 0: 0, 1: 1, 2: 2, 6: 3 }; const n = Math.max(...LH) + 1; w.put(n, 9);
  for (let i = 0; i < n;) {
    if (LH.includes(i)) { w.put(PT[6], 2); i++; continue; }
    let j = i; while (j < n && !LH.includes(j)) j++;
    let runLen = j - i;
    while (runLen) { if (runLen >= 20) { const k = Math.min(runLen, 531); w.put(PT[2], 2); w.put(k - 20, 9); runLen -= k; } else if (runLen >= 3) { const k = Math.min(runLen, 18); w.put(PT[1], 2); w.put(k - 3, 4); runLen -= k; } else { w.put(PT[0], 2); runLen--; } }
    i = j;
  }
  w.put(0, 4); w.put(0, 4); for (const c of DATA) w.put(LH.indexOf(c), 4); if (terminate) w.put(0, 16);
  return w.done();
}
const crc16 = (b: Buffer) => { let c = 0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; } return c; };
function lha(o: { method?: string; attr?: number; level?: number; size?: number } = {}) {
  const body = lh5Block(false); const name = Buffer.from('payload.txt');
  const h = Buffer.concat([Buffer.from(o.method || '-lh5-', 'latin1'), Buffer.alloc(8), Buffer.from([0, 0, 0x6b, 0x5a, o.attr ?? 0x20, o.level ?? 0, name.length]), name, Buffer.alloc(2)]);
  h.writeUInt32LE(body.length, 5); h.writeUInt32LE(DATA.length, 9); h.writeUInt16LE(crc16(DATA), h.length - 2);
  let sum = 0; for (const x of h) sum += x;
  return Buffer.concat([Buffer.from([o.size ?? h.length, sum & 0xff]), h, body, Buffer.from([0])]);
}
const lzh = () => Buffer.concat([Buffer.from([0x1f, 0xa0]), lh5Block(true)]);
function oldGzip(content: Buffer) { const d = zlib.deflateRawSync(content, { level: 9 }); return Buffer.concat([Buffer.from([0x1f, 0x9e, 0x08, 0, 0, 0, 0, 0, 0, 3]), d, trailer(content)]); }

// ------------------------------------------------------------------ the matrix
interface Fx { id: string; label: string; scan: Buffer; read: Buffer | null; readers: ReaderId[]; expect: 'fail' | 'pass'; fmt?: RegExp; needle?: Buffer }
const GZE = /^gzip \(embedded\)$/;
function fixtures(): Fx[] {
  const L: Fx[] = [];
  const add = (f: Fx) => L.push(f);
  // C16-F1: content, then an invalid block, embedded in JS (readers carve the gzip stream)
  for (const pad of [0, 1000, 20000, 60000]) {
    const g = Buffer.concat([GZ_HEAD, deflateThenError(Buffer.concat([S, words(pad, pad + 3)]))]);
    add({ id: `F1.err${pad}`, label: `[C16-F1] embedded gzip: sentinel + ${pad} B, then an invalid block`, scan: js(g), read: g, readers: GZ_READERS, expect: 'fail', fmt: GZE });
  }
  { const g = Buffer.concat([GZ_HEAD, deflateThenError(Buffer.concat([words(30000, 5), S]))]);
    add({ id: 'F1.late', label: '[C16-F1] embedded gzip: sentinel at the END of 30 KB of output, then an invalid block', scan: js(g), read: g, readers: GZ_READERS, expect: 'fail', fmt: GZE }); }
  { const g = Buffer.concat([GZ_HEAD, deflateThenError(Buffer.concat([S, words(500)]))]);
    add({ id: 'F1.code', label: '[C16-F1] same, embedded in machine-code bytes', scan: code(g), read: g, readers: GZ_READERS, expect: 'fail', fmt: GZE });
    add({ id: 'F1.tar', label: '[C16-F1] same, in a JS member of a tar', scan: tar('a.js', js(g)), read: g, readers: GZ_READERS, expect: 'fail', fmt: GZE });
    add({ id: 'F1.zip', label: '[C16-F1] same, in a stored ZIP member', scan: zipStored('a.js', js(g)), read: g, readers: GZ_READERS, expect: 'fail', fmt: GZE });
    add({ id: 'F1.targz', label: '[C16-F1] same, in a JS member of a tar.gz', scan: zlib.gzipSync(tar('a.js', js(g))), read: g, readers: GZ_READERS, expect: 'fail', fmt: GZE }); }
  { const inner = Buffer.concat([Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0, 4]), fill(40, 0x11)]);
    const g = Buffer.concat([GZ_HEAD, deflateThenError(inner)]);
    add({ id: 'F1.nested', label: '[C16-F1] recovered output holds an xz stream (no plain sentinel)', scan: js(g), read: null, readers: [], expect: 'fail', fmt: GZE }); }
  // C16-F1b: back-reference too far back (GNU gzip zero-fills; zlib refuses)
  { const out = Buffer.concat([fill(3, 0), S]); const g = Buffer.concat([GZ_HEAD, tooFarBack(S), trailer(out)]);
    add({ id: 'F1b', label: '[C16-F1b] embedded gzip with a distance-too-far-back copy before the sentinel', scan: js(g), read: g, readers: GZ_READERS, expect: 'fail', fmt: GZE }); }
  // short truncated stream (< 16 bytes of deflate data, at the end of the file)
  { const s9 = Buffer.from('g5-i1-dev'); const g = Buffer.concat([GZ_HEAD, literalsOnly(s9)]);
    add({ id: 'F1.trunc', label: '[C17] embedded gzip cut short after the 9-byte sentinel literals (< 16 B of deflate data)', scan: Buffer.concat([Buffer.from('/* chunk */ var a = 1;\n'), g]), read: g, readers: GZ_READERS, expect: 'fail', fmt: GZE, needle: s9 }); }
  // controls: readers recover NO full sentinel
  { const g = Buffer.concat([GZ_HEAD, literalsOnly(S.subarray(0, 12))]);
    add({ id: 'F1.c1', label: 'control: truncated stream that yields only 12 bytes of the sentinel', scan: Buffer.concat([Buffer.from('/* chunk */ var a = 1;\n'), g]), read: g, readers: GZ_READERS, expect: 'pass' }); }
  { const g = Buffer.concat([GZ_HEAD, deflateThenError(words(4000, 11))]);
    add({ id: 'F1.c2', label: 'control: benign text then an invalid block (no sentinel)', scan: js(g), read: g, readers: GZ_READERS, expect: 'pass' }); }
  // C16-F2: LHA
  add({ id: 'L1', label: '[C16-F2] LHA -lh5- level 0 at offset 0', scan: lha(), read: lha(), readers: ['bsdtar'], expect: 'fail', fmt: /^lha$/ });
  add({ id: 'L2', label: '[C16-F2] LHA -lh5- level 0, attribute 0xff', scan: lha({ attr: 0xff }), read: lha({ attr: 0xff }), readers: ['bsdtar'], expect: 'fail', fmt: /^lha$/ });
  { const sfx = Buffer.concat([Buffer.from('MZ'), fill(40000, 0x90), lha()]);
    add({ id: 'L3', label: '[C16-F2] LHA behind a 40 KB MZ self-extractor stub', scan: sfx, read: sfx, readers: ['bsdtar'], expect: 'fail', fmt: /^lha$/ }); }
  add({ id: 'L4', label: '[C16-F2] LHA as a tar member', scan: tar('p.lzh', lha()), read: lha(), readers: ['bsdtar'], expect: 'fail', fmt: /^lha$/ });
  add({ id: 'L5', label: '[C16-F2] LHA in a tar.gz', scan: zlib.gzipSync(tar('p.lzh', lha())), read: lha(), readers: ['bsdtar'], expect: 'fail', fmt: /^lha$/ });
  add({ id: 'L6', label: '[C16-F2] LHA as a stored ZIP member', scan: zipStored('p.lzh', lha()), read: lha(), readers: ['bsdtar'], expect: 'fail', fmt: /^lha$/ });
  for (const m of ['-lh0-', '-lh1-', '-lh4-', '-lh6-', '-lh7-', '-lhd-', '-lzs-', '-lz4-', '-lz5-'])
    add({ id: `L7${m}`, label: `[C16-F2] LHA header with method ${m} (fail-closed policy)`, scan: lha({ method: m }), read: lha({ method: m }), readers: ['bsdtar'], expect: 'fail', fmt: /^lha$/ });
  add({ id: 'L8', label: '[C16-F2] LHA header cut short inside the body (fail-closed policy)', scan: lha().subarray(0, 40), read: null, readers: [], expect: 'fail', fmt: /^lha$/ });
  add({ id: 'L9', label: '[C16-F2] LHA after a 100-byte prefix (fail-closed policy)', scan: Buffer.concat([fill(100, 0), lha()]), read: null, readers: [], expect: 'fail', fmt: /^lha$/ });
  add({ id: 'L.c1', label: 'control: LHA header size byte 0 (end-of-archive marker)', scan: lha({ size: 0 }), read: lha({ size: 0 }), readers: ['bsdtar'], expect: 'pass' });
  add({ id: 'L.c2', label: 'control: LHA header level 4', scan: lha({ level: 4 }), read: lha({ level: 4 }), readers: ['bsdtar'], expect: 'pass' });
  add({ id: 'L.c3', label: 'control: "-lh5-" in JS text', scan: Buffer.from('var methods = ["-lh5-", "-lh6-", "-lzs-"]; // LHA method names\n'), read: null, readers: [], expect: 'pass' });
  add({ id: 'L.c4', label: 'control: method strings in a NUL-separated table followed by text', scan: Buffer.concat([fill(16, 0x41), Buffer.from('\0\0-lh5-\0-lh6-\0-lh7-\0compression methods\0', 'latin1'), fill(64, 0x41)]), read: null, readers: [], expect: 'pass' });
  // C16-F3: pack, gzip LZH
  add({ id: 'P1', label: '[C16-F3] pack (1F 1E) at offset 0', scan: packStream(), read: packStream(), readers: ['gzip'], expect: 'fail', fmt: /^pack \(1F 1E\)$/ });
  add({ id: 'P2', label: '[C16-F3] pack as a tar member', scan: tar('p.z', packStream()), read: packStream(), readers: ['gzip'], expect: 'fail', fmt: /^pack \(1F 1E\)$/ });
  add({ id: 'P3', label: '[C16-F3] pack cut short (fail-closed policy)', scan: packStream().subarray(0, 12), read: packStream().subarray(0, 12), readers: ['gzip'], expect: 'fail', fmt: /^pack \(1F 1E\)$/ });
  add({ id: 'P.c1', label: 'control: pack after a prefix (gzip reads only offset 0)', scan: Buffer.concat([Buffer.from('/*x*/'), packStream()]), read: Buffer.concat([Buffer.from('/*x*/'), packStream()]), readers: ['gzip'], expect: 'pass' });
  add({ id: 'Z1', label: '[C16-F3] gzip LZH (1F A0) at offset 0', scan: lzh(), read: lzh(), readers: ['gzip'], expect: 'fail', fmt: /^gzip LZH \(1F A0\)$/ });
  add({ id: 'Z2', label: '[C16-F3] gzip LZH as a stored ZIP member', scan: zipStored('p.z', lzh()), read: lzh(), readers: ['gzip'], expect: 'fail', fmt: /^gzip LZH \(1F A0\)$/ });
  add({ id: 'Z3', label: '[C16-F3] gzip LZH cut short (fail-closed policy)', scan: lzh().subarray(0, 6), read: lzh().subarray(0, 6), readers: ['gzip'], expect: 'fail', fmt: /^gzip LZH \(1F A0\)$/ });
  add({ id: 'Z.c1', label: 'control: gzip LZH after a prefix', scan: Buffer.concat([Buffer.from('/*x*/'), lzh()]), read: Buffer.concat([Buffer.from('/*x*/'), lzh()]), readers: ['gzip'], expect: 'pass' });
  // C17-N1: old gzip magic
  { const og = oldGzip(Buffer.concat([S, words(200)]));
    add({ id: 'O1', label: '[C17-N1] gzip with the old magic 1F 9E at offset 0', scan: og, read: og, readers: ['gzip'], expect: 'fail', fmt: /^gzip \(old magic 1F 9E\)$/ });
    add({ id: 'O2', label: '[C17-N1] old-magic gzip as a tar member', scan: tar('p.gz', og), read: og, readers: ['gzip'], expect: 'fail', fmt: /^gzip \(old magic 1F 9E\)$/ });
    const m1 = zlib.gzipSync(Buffer.from('benign text\n'));
    add({ id: 'O3', label: '[C17-N1] gzip member followed by an old-magic member', scan: Buffer.concat([m1, og]), read: Buffer.concat([m1, og]), readers: ['gzip'], expect: 'fail' });
    add({ id: 'O.c1', label: 'control: old-magic gzip after a prefix', scan: Buffer.concat([Buffer.from('/*x*/'), og]), read: Buffer.concat([Buffer.from('/*x*/'), og]), readers: ['gzip'], expect: 'pass' }); }
  add({ id: 'G.c1', label: 'control: benign text file', scan: Buffer.from('benign text, no archive at all.\n'), read: null, readers: [], expect: 'pass' });
  return L;
}

async function main() {
  console.log(`readers: ${(Object.keys(available) as ReaderId[]).map((r) => `${r}=${available[r] ? (r === 'gzip' ? `yes(${FLAVOR}; ${GZ_VERSION})` : 'yes') : 'NOT AVAILABLE'}`).join(', ')}`);
  for (const r of Object.keys(available) as ReaderId[]) if (!available[r]) notRun.push(`reader:${r}`);
  const fx = fixtures();
  const recovered: Record<string, ReaderId[]> = {};
  const verdict: Record<string, number> = {};
  for (const f of fx) {
    const needle = f.needle || S;
    check(`${f.id}0. fixture does not contain the sentinel as plain bytes`, !f.scan.includes(needle));
    const rec: ReaderId[] = [];
    const cells: string[] = [];
    for (const r of f.readers) {
      if (!available[r]) { cells.push(`${r}=n/a`); continue; }
      const ok = (await readWith(r, f.read!)).includes(needle);
      if (ok) rec.push(r);
      cells.push(`${r}=${ok ? 'RECOVERS' : 'no'}`);
    }
    recovered[f.id] = rec;
    const res = run(`${f.id.replace(/[^A-Za-z0-9.]/g, '_')}.bin`, f.scan);
    verdict[f.id] = res.exit;
    console.log(`MATRIX ${f.id} | ${cells.join(' ') || 'no reader applies'} | scanner=${res.exit ? `FAIL(${fmtOf(res)})` : 'PASS'}`);
    if (rec.length) check(`${f.id}. ${f.label}: recovered by ${rec.join(', ')} -> scanner must fail closed`, res.exit === 1, res.reason.slice(0, 160));
    if (f.expect === 'fail') check(`${f.id}e. ${f.label} -> FAIL closed${f.fmt ? ` (${f.fmt.source})` : ''}`, res.exit === 1 && (!f.fmt || f.fmt.test(fmtOf(res))), `exit=${res.exit} reason=${res.reason.slice(0, 160)}`);
    else { check(`${f.id}p. precondition: no installed reader recovers the sentinel (${f.label})`, rec.length === 0, rec.join(', ')); check(`${f.id}e. ${f.label} -> PASS`, res.exit === 0, res.reason.slice(0, 160)); }
  }
  // ---------------------------------------------------------------- D: reader preconditions (the matrix exercises what it claims)
  const has = (id: string, r: ReaderId) => (recovered[id] || []).includes(r);
  check('D1. Node streaming gunzip recovers the sentinel before the invalid block (C16-F1)', has('F1.err1000', 'node-gunzip') && has('F1.err60000', 'node-gunzip'));
  if (available['decompression-stream']) check('D2. DecompressionStream("gzip") recovers it too (C16-F1)', has('F1.err1000', 'decompression-stream') && has('F1.err60000', 'decompression-stream'));
  if (available['python-zlib']) check('D3. Python zlib streaming recovers it too (C16-F1)', has('F1.err1000', 'python-zlib'));
  check('D4. a streaming reader recovers the 9-byte sentinel from the short truncated stream', (recovered['F1.trunc'] || []).length > 0, 'no reader recovered it');
  if (FLAVOR === 'gnu') {
    // D5 (G5-C17-CI-1): record what this GNU gzip build actually does with F1b; a build
    // that refuses it is acceptable, a build that recovers it must be met by a rejection.
    const f1bLive = has('F1b', 'gzip');
    console.log(`INFO D5 ${GZ_VERSION}: F1b ${f1bLive ? 'RECOVERED (zero-fill, as GNU gzip 1.12)' : 'REFUSED (no output, as zlib)'}; scanner ${verdict['F1b'] === 1 ? 'FAIL closed' : 'PASS'}`);
    check(`D5. GNU gzip ${GNU_RELEASE || '?'} F1b behaviour recorded (${f1bLive ? 'recovers' : 'refuses'}) and any recovery is rejected by the scanner (C16-F1b)`, !f1bLive || verdict['F1b'] === 1);
    if (GNU_RELEASE === '1.12' && f1bLive) check('D5-live. live GNU gzip 1.12 reproduces the verified F1b recovery', true);
    else { notRun.push(`D5-live(GNU gzip 1.12 F1b recovery not reproduced live: ${GZ_VERSION} ${f1bLive ? 'recovers' : 'refuses'}; covered by D5a/D5b)`); console.log(`NOT RUN D5-live: no live GNU gzip 1.12 recovery here (${GZ_VERSION}); the verified 1.12 behaviour stays covered by D5a/D5b`); }
    check('D6. GNU gzip decodes pack, gzip LZH and old-magic gzip at offset 0', has('P1', 'gzip') && has('Z1', 'gzip') && has('O1', 'gzip'));
    check('D7. GNU gzip recovers the sentinel before the invalid block once its 32 KiB window flushes', has('F1.err60000', 'gzip'));
  } else if (FLAVOR === 'apple') {
    check('D5. Apple gzip decodes pack and old-magic gzip at offset 0 (not LZH)', has('P1', 'gzip') && has('O1', 'gzip') && !has('Z1', 'gzip'));
  } else notRun.push('D5-D7');
  // D5a/D5b (G5-C17-CI-1): the GNU gzip 1.12 behaviour verified in G5-C17 stays covered on every platform.
  { const f1b = fx.find((f) => f.id === 'F1b')!;
    const f1bSha = crypto.createHash('sha256').update(f1b.read!).digest('hex');
    check('D5a. F1b is byte-identical to the stream GNU gzip 1.12 recovered in G5-C17 (pinned sha256)', f1bSha === F1B_SHA256_VERIFIED_GZIP_1_12, `sha256=${f1bSha}`);
    const SCD = require(SCANNER);
    const want = Buffer.concat([Buffer.alloc(3, 0), S]);
    const got = typeof SCD.inflateRecover === 'function' ? SCD.inflateRecover(f1b.read!.subarray(GZ_HEAD.length), 70000) : Buffer.alloc(0);
    check('D5b. the scanner\'s recovery decoder reproduces GNU gzip 1.12\'s F1b output (3 zero bytes + sentinel)', Buffer.compare(got, want) === 0, `got ${got.length} B`);
    if (available.gzip && FLAVOR !== 'gnu') console.log(`INFO D5 ${GZ_VERSION}: F1b ${has('F1b', 'gzip') ? 'RECOVERED' : 'REFUSED'}; scanner ${verdict['F1b'] === 1 ? 'FAIL closed' : 'PASS'}`);
    check('D5c. F1b is rejected by the scanner regardless of the installed gzip', verdict['F1b'] === 1); }
  check('D8. zlib readers refuse the too-far-back stream (why C16-F1b needs the GNU-style zero fill)', !has('F1b', 'node-gunzip'));
  if (available.bsdtar) check('D9. bsdtar extracts LHA level 0 (any attribute) and behind an MZ stub', has('L1', 'bsdtar') && has('L2', 'bsdtar') && has('L3', 'bsdtar'));

  // ---------------------------------------------------------------- R: resources (the recovery probe stays bounded)
  {
    const r = prng(99);
    const parts: Buffer[] = [Buffer.from('/* chunk */ var a = 1;\n')];
    for (let i = 0; i < 3000; i++) { const b = Buffer.alloc(600); for (let k = 0; k < b.length; k++) b[k] = r() & 0xff; parts.push(GZ_HEAD, b); }
    const t0 = Date.now(); const res = run('R1.bin', Buffer.concat(parts)); const ms = Date.now() - t0;
    // Random bytes after a gzip magic decode cleanly >= 64 bytes ~0.2% of the time (C15 rule, unchanged), so the verdict is informational.
    console.log(`INFO R1 verdict: ${res.exit ? `fail closed (${res.reason.slice(0, 100)})` : 'PASS'}`);
    check(`R1. 3,000 embedded gzip headers followed by random bytes: scan completes in ${ms} ms (< 60 s)`, ms < 60000);
  }

  // ---------------------------------------------------------------- M: mutants (each C17 rule reverted -> the suite observes it)
  if (!process.env.PALM_SCANNER_UNDER_TEST) {
    const src = fs.readFileSync(SCANNER, 'utf8');
    const byId = (id: string) => fx.find((f) => f.id === id)!;
    const passesUnder = (id: string, m: string) => run(`${id}.bin`, byId(id).scan, m).exit === 0;
    const mutants: { id: string; label: string; from: string; to: string; probe: (m: string) => boolean }[] = [
      { id: 'M1', label: 'recovered-output inspection disabled', from: 'function gzipRecoverableLeak(slice) {', to: 'function gzipRecoverableLeak(slice) { return false;', probe: (m) => passesUnder('F1.err0', m) },
      { id: 'M2', label: 'too-far-back copies treated as an error (zlib semantics, no GNU zero fill)', from: 'for (let i = 0; i < len; i++) emit(n - d >= 0 ? out[n - d] : 0);', to: "if (d > n) throw new Error('too far back'); for (let i = 0; i < len; i++) emit(out[n - d]);", probe: (m) => passesUnder('F1b', m) },
      { id: 'M3', label: 'nested inspection of recovered output removed', from: 'return detectArchiveInBuffer(out) !== null || findForeignStream(out) !== null;', to: 'return false;', probe: (m) => passesUnder('F1.nested', m) },
      { id: 'M4', label: 'output decoded before an error discarded', from: '} catch { /* everything decoded so far is what a streaming reader may emit */ }', to: '} catch { n = 0; }', probe: (m) => passesUnder('F1.err0', m) },
      { id: 'M5', label: 'LHA detection removed', from: 'function validLhaAt(buf, p) {', to: 'function validLhaAt(buf, p) { return false;', probe: (m) => passesUnder('L1', m) },
      { id: 'M6', label: 'LHA attribute required to be 0x20', from: '  return p + 22 <= buf.length && buf[p] !== 0 && buf[p + 20] <= 3;', to: '  return p + 22 <= buf.length && buf[p] !== 0 && buf[p + 20] <= 3 && buf[p + 19] === 0x20;', probe: (m) => passesUnder('L2', m) },
      { id: 'M7', label: 'pack detection removed', from: 'function validPackAt(buf) {', to: 'function validPackAt(buf) { return false;', probe: (m) => passesUnder('P1', m) },
      { id: 'M8', label: 'gzip LZH detection removed', from: 'function validGzipLzhAt(buf) {', to: 'function validGzipLzhAt(buf) { return false;', probe: (m) => passesUnder('Z1', m) },
      { id: 'M9', label: 'old-magic gzip detection removed', from: 'function validOldGzipAt(buf) {', to: 'function validOldGzipAt(buf) { return false;', probe: (m) => passesUnder('O1', m) },
      { id: 'M10', label: 'offset-0 formats dropped from the file-level gate', from: '|| !!headForeign; // G5-D7-A', to: '; // G5-D7-A', probe: (m) => passesUnder('P1', m) },
      { id: 'M11', label: 'short-truncation recovery removed (C15 rule only)', from: '    return gzipRecoverableLeak(slice); // G5-C17 (C16-F1)', to: '    return false; // G5-C17 (C16-F1)', probe: (m) => passesUnder('F1.trunc', m) },
    ];
    // R3: the recovery decoder equals zlib on valid streams and recovers at least what a
    // byte-fed zlib stream emits from a corrupted one (seeded, every level / strategy).
    {
      const SC = require(SCANNER); const r = prng(4242); let same = 0, prefix = 0; const N = 300;
      for (let t = 0; t < N; t++) {
        const n = 1 + (r() % 20000); const kind = t % 3;
        const data = kind === 0 ? Buffer.from(Array.from({ length: n }, () => r() & 0xff)) : kind === 1 ? Buffer.alloc(n, r() & 0xff) : words(n, t + 1);
        const d = zlib.deflateRawSync(data, { level: r() % 10, strategy: r() % 5, memLevel: 1 + (r() % 9), windowBits: 8 + (r() % 8) });
        if (SC.inflateRecover(d, 70000).equals(data)) same++;
        const c = Buffer.from(d); c[r() % c.length] ^= 1 + (r() % 255);
        const e: any = zlib.createInflateRaw(); const zo: Buffer[] = [];
        try { for (let i = 0; i < c.length; i++) { const x = e._processChunk(c.subarray(i, i + 1), zlib.constants.Z_SYNC_FLUSH); if (x && x.length) zo.push(x); } } catch { /* stops at the error */ } finally { e.close(); }
        const z = Buffer.concat(zo); if (SC.inflateRecover(c, 70000).subarray(0, z.length).equals(z)) prefix++;
      }
      delete require.cache[require.resolve(SCANNER)];
      check(`R3. recovery decoder equals zlib on ${N} valid streams (${same}/${N}) and extends zlib's byte-fed output on ${N} corrupted ones (${prefix}/${N})`, same === N && prefix === N);
    }
    // R2: the C17 recovery adds no false positive on random bytes after a gzip magic:
    // identical verdicts with and without it over 2,000 random tails.
    {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
      try {
        const off = path.join(d, 'off.js'); fs.writeFileSync(off, src.replace('function gzipRecoverableLeak(slice) {', 'function gzipRecoverableLeak(slice) { return false;'));
        const sub = path.join(d, 'scripts'); fs.mkdirSync(sub); fs.copyFileSync(SCANNER, path.join(sub, 'on.js')); fs.renameSync(off, path.join(sub, 'off.js'));
        fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(d, 'palmistry-build-exclusion.js'));
        const ON = require(path.join(sub, 'on.js')), OFF = require(path.join(sub, 'off.js'));
        const r = prng(1234); let diff = 0, on = 0;
        for (let i = 0; i < 2000; i++) { const b = Buffer.alloc(600); for (let k = 0; k < b.length; k++) b[k] = r() & 0xff; const buf = Buffer.concat([Buffer.from('/*x*/'), GZ_HEAD, b]);
          const a = !!ON.findForeignStream(buf), c = !!OFF.findForeignStream(buf); if (a) on++; if (a !== c) diff++; }
        console.log(`INFO R2 random tails failing closed with the C17 recovery: ${on}/2000`);
        check('R2. the C17 recovery changes no verdict on 2,000 random tails after a gzip magic (no added false positive)', diff === 0, `${diff} differ`);
      } finally { cleanup(d); }
    }
    for (const mt of mutants) {
      if (src.split(mt.from).length !== 2) { check(`${mt.id}. mutant anchor present exactly once (${mt.label})`, false, 'scanner source changed; update the mutant'); continue; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
      try { const mut = path.join(d, 'check-palmistry-bundle.js'); fs.writeFileSync(mut, src.replace(mt.from, mt.to));
        check(`${mt.id}. negative control: with ${mt.label}, the suite observes the regression`, mt.probe(mut)); } finally { cleanup(d); }
    }
  } else { notRun.push('M1-M11'); console.log('NOT RUN M1-M11 (PALM_SCANNER_UNDER_TEST set)'); }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
