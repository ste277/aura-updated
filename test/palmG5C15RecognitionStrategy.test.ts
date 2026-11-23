/**
 * AURA-PALM-G5-C15 -- regression tests for the C14 independent-review
 * findings and the tiered recognition strategy of the bundle scanner
 * (`apps/web/scripts/check-palmistry-bundle.js`):
 *
 *   C14-F1 (P1) embedded gzip: FNAME / FCOMMENT > 64 KiB, > 64 KiB of empty
 *               stored blocks, chains of tiny members, reserved flag bits
 *   C14-F2 (P2) rar v4 add-size first blocks (COMM / AV / SUB / PROTECT / SIGN)
 *   C14-F3 (P2) rar v5 file / service header first, 4-byte header-size number
 *   C14-F4 (P2) lzip, compress .Z (offset 0), ISO 9660 / zisofs
 *   C14-P3-1    cab variants cabextract accepts (reserved1 != 0); 7z / xz
 *               header variants other readers may recover -> Tier A
 *   C14-P3-2    work-time budget checked after the last tar / ZIP entry and
 *               at the end of the scan
 *
 * Strategy under test: Tier A (>= 6-byte binary magic) fails closed on the
 * magic alone; Tier B (short or text-like magic) adds only checks every
 * supported reader enforces. Every variant a stock reader decodes must FAIL
 * CLOSED; coincidental bytes (text, machine code) must still PASS.
 * Real-tool cases run only after a precondition proves a reader decodes the
 * content; missing tools are NOT RUN. Reader observations where the scanner
 * fails closed anyway are INFO lines. Mutants revert each rule.
 * PALM_SCANNER_UNDER_TEST=<path> runs against another scanner (mutants skip).
 *
 * Run: npx ts-node test/palmG5C15RecognitionStrategy.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { spawnSync } from 'child_process';
import * as F from './palmG5I1R43Fixtures';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const SCANNER = process.env.PALM_SCANNER_UNDER_TEST || path.join(WEB, 'scripts/check-palmistry-bundle.js');
const SENT = 'g5-i1-dev';
const FOREIGN = /unsupported archive or compressed stream \(([^)]+\)?)\)/;
const TMP = 'palm-c15-';

let passed = 0, failed = 0;
const notRun: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); } };
const info = (name: string, v: boolean) => console.log(`INFO ${name}: ${v ? 'yes' : 'no'}`);
const which = (...ts: string[]) => ts.find((t) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0) || null;
const cleanup = (d: string) => { if (path.basename(d).startsWith(TMP) && path.dirname(d) === os.tmpdir()) fs.rmSync(d, { recursive: true, force: true }); };

// ------------------------------------------------------------------ scanner harness (same layout as D7 / C11 / C13)
interface Run { exit: number | null; errors: string[]; hits: string[]; reason: string }
type LimitsFn = (base: Record<string, number>) => Record<string, number>;
function run(name: string, data: Buffer | null, scanner = SCANNER, limits: Record<string, number> | LimitsFn = {}, extra: [string, Buffer][] = []): Run {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
  try {
    const web = path.join(tmp, 'apps/web');
    fs.mkdirSync(path.join(web, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
    fs.copyFileSync(scanner, path.join(web, 'scripts/check-palmistry-bundle.js'));
    fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
    fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), '{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}');
    fs.mkdirSync(path.join(web, '.next/static/chunks'), { recursive: true }); fs.writeFileSync(path.join(web, '.next/static/chunks/main.js'), 'console.log("app")');
    fs.mkdirSync(path.join(web, 'public'), { recursive: true });
    if (data) fs.writeFileSync(path.join(web, 'public', name), data);
    for (const [n, d] of extra) fs.writeFileSync(path.join(web, 'public', n), d);
    const sp = path.join(web, 'scripts/check-palmistry-bundle.js');
    const custom = typeof limits === 'function' || Object.keys(limits).length > 0;
    const cli = custom ? null : spawnSync(process.execPath, [sp], { encoding: 'utf8', timeout: 120000 });
    const mod = require(sp);
    const lim = typeof limits === 'function' ? limits(mod.INSPECTION_LIMITS) : { ...mod.INSPECTION_LIMITS, ...limits };
    const api = mod.inspectArtifacts(web, lim);
    delete require.cache[require.resolve(sp)];
    const errors: string[] = api.errors.map((e: any) => e.error);
    const hits: string[] = [...new Set<string>(api.hits.map((h: any) => h.sentinel))];
    return { exit: cli ? cli.status : (errors.length || hits.length ? 1 : 0), errors, hits, reason: errors[0] || hits[0] || '' };
  } finally { cleanup(tmp); }
}
function mustFail(id: string, label: string, data: Buffer, fmt: RegExp, scanner = SCANNER, limits: Record<string, number> = {}): boolean {
  const r = run(`${id}.bin`, data, scanner, limits);
  const m = FOREIGN.exec(r.errors.find((e) => FOREIGN.test(e)) || '');
  const ok = r.exit === 1 && !!m && fmt.test(m[1]);
  if (scanner === SCANNER) check(`${id}. ${label} -> FAIL closed (${fmt.source})`, ok, `exit=${r.exit} reason=${r.reason.slice(0, 160)}`);
  return ok;
}
function mustPass(id: string, label: string, data: Buffer, scanner = SCANNER): boolean {
  const r = run(`${id}.bin`, data, scanner);
  const ok = r.exit === 0;
  if (scanner === SCANNER) check(`${id}. ${label} -> PASS`, ok, `exit=${r.exit} reason=${r.reason.slice(0, 160)}`);
  return ok;
}
/** Run a stock reader in a scratch dir; true when stdout or any extracted file contains `needle`. */
function extracts(cmd: string, args: (f: string) => string[], data: Buffer, needle: Buffer, ext = '.bin', stdin = false): boolean {
  const o = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
  try {
    const f = path.join(o, `in${ext}`); fs.writeFileSync(f, data); const x = path.join(o, 'x'); fs.mkdirSync(x);
    const r = spawnSync(cmd, args(f), { cwd: x, encoding: 'buffer', timeout: 60000, input: stdin ? data : undefined });
    if (r.stdout && r.stdout.includes(needle)) return true;
    const walk = (d: string): boolean => fs.readdirSync(d).some((n) => { const p = path.join(d, n); const st = fs.statSync(p); return st.isDirectory() ? walk(p) : fs.readFileSync(p).includes(needle); });
    return walk(x);
  } finally { cleanup(o); }
}

// ------------------------------------------------------------------ fixtures (benign, synthetic)
const crc = (b: Buffer): number => F.crc32(b as any);
const hex = (h: string) => Buffer.from(h.replace(/\s+/g, ''), 'hex');
const fill = (n: number, c = 0x2f) => Buffer.alloc(n, c);
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const code = (b: Buffer) => Buffer.concat([hex('cffaedfe 0c000001'), fill(256, 0x90), b, fill(256, 0xcc)]);
const js = (b: Buffer) => Buffer.concat([Buffer.from('/* bundle */ var a = 1;\n'), b, Buffer.from('\nvar z = 2;\n')]);
const textPayload = (lines: number) => { let x = 17, s = ''; const r = () => { x = (x * 1103515245 + 12345) >>> 0; return x; };
  for (let i = 0; i < lines; i++) { if (i % 8 === 0) s += `benign probe text: ${SENT}\n`; for (let j = 0; j < 10; j++) { let w = ''; for (let k = 3 + (r() % 6); k > 0; k--) w += String.fromCharCode(97 + (r() >>> 8) % 26); s += `${w} `; } s += '\n'; }
  return Buffer.from(s); };
const PAYLOAD = textPayload(80);
const BENIGN = Buffer.from('benign text with no sentinel at all, used only to test archive recognition.\n');
function tar(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.fill(0x20, 148, 156); let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]);
}
const zipStored = (name: string, data: Buffer) => F.buildZip([{ name, data, method: 0 }]).buf;

/** gzip member built by hand: optional FEXTRA / FNAME / FCOMMENT / FHCRC, extra flag bits, deflate body, trailer. */
function gz(content: Buffer, o: { name?: Buffer; comment?: Buffer; flagBits?: number; body?: Buffer; badTrailer?: boolean } = {}): Buffer {
  let flg = o.flagBits ?? 0; if (o.name) flg |= 0x08; if (o.comment) flg |= 0x10;
  const h = Buffer.from([0x1f, 0x8b, 8, flg, 0, 0, 0, 0, 0, 3]);
  const parts: Buffer[] = [h]; if (o.name) parts.push(o.name, Buffer.from([0])); if (o.comment) parts.push(o.comment, Buffer.from([0]));
  const body = o.body ?? zlib.deflateRawSync(content);
  parts.push(body, u32(crc(content) ^ (o.badTrailer ? 1 : 0)), u32(content.length));
  return Buffer.concat(parts);
}
/** n empty, non-final stored deflate blocks (5 bytes each) followed by the content's own deflate stream. */
const emptyBlocks = (n: number, content: Buffer) => Buffer.concat([...Array.from({ length: n }, () => hex('000000ffff')), zlib.deflateRawSync(content)]);

// rar v4 (independent of the C14 reviewer's builder; same layout)
const rar4Block = (type: number, flags: number, body: Buffer, add: Buffer = Buffer.alloc(0), crcOverAdd = false) => {
  const h = Buffer.concat([Buffer.from([type]), u16(flags), u16(7 + body.length), body]);
  return Buffer.concat([u16(crc(Buffer.concat([h, crcOverAdd ? add : Buffer.alloc(0)])) & 0xffff), h, add]);
};
const R4_MARK = Buffer.from('Rar!\x1a\x07\x00', 'latin1');
const r4Main = () => rar4Block(0x73, 0, Buffer.alloc(6));
const r4File = (data: Buffer) => { const name = Buffer.from('b.txt');
  return Buffer.concat([rar4Block(0x74, 0x8000, Buffer.concat([u32(data.length), u32(data.length), Buffer.from([3]), u32(crc(data)), u32(0x4f4712ea), Buffer.from([20, 0x30]), u16(name.length), u32(((0o100644 << 16) | 0x20) >>> 0), name])), data]); };
const r4End = () => rar4Block(0x7b, 0x4000, Buffer.alloc(0));
const r4AddFirst = (type: number, withMain: boolean) => { const add = fill(40, 0x5a);
  return Buffer.concat([R4_MARK, rar4Block(type, 0x8000, Buffer.concat([u32(add.length), Buffer.alloc(4)]), add, true), ...(withMain ? [r4Main()] : []), r4File(BENIGN), r4End()]); };
// rar v5
const vint = (n: number, minlen = 1) => { const b: number[] = []; do { b.push(n & 0x7f); n = Math.floor(n / 128); } while (n); while (b.length < minlen) b.push(0); return Buffer.from(b.map((x, i) => (i < b.length - 1 ? x | 0x80 : x))); };
const r5Hdr = (body: Buffer, szlen = 1) => { const sz = vint(body.length, szlen); return Buffer.concat([u32(crc(Buffer.concat([sz, body]))), sz, body]); };
const R5_SIG = Buffer.from('Rar!\x1a\x07\x01\x00', 'latin1');
const r5Main = (szlen = 1) => r5Hdr(Buffer.concat([vint(1), vint(0), vint(0)]), szlen);
const r5File = (data: Buffer) => { const name = Buffer.from('b.txt');
  return Buffer.concat([r5Hdr(Buffer.concat([vint(2), vint(2), vint(data.length), vint(4), vint(data.length), vint(0o100644), u32(crc(data)), vint(0), vint(1), vint(name.length), name])), data]); };
const r5End = () => r5Hdr(Buffer.concat([vint(5), vint(0), vint(0)]));
const r5Service = () => { const n = Buffer.from('CMT'), d = Buffer.from('comment');
  return Buffer.concat([r5Hdr(Buffer.concat([vint(3), vint(2), vint(d.length), vint(0), vint(d.length), vint(0), vint(0), vint(1), vint(n.length), n])), d]); };

/** cab (MSZIP, content hidden) with overridable header fields. */
function cab(o: { r1?: number; nfold?: number; nfiles?: number; cb?: number; coff?: number } = {}, content = PAYLOAD): Buffer {
  const data = Buffer.concat([Buffer.from('CK'), zlib.deflateRawSync(content)]);
  const name = Buffer.from('payload.txt\0');
  const cffile = Buffer.concat([u32(content.length), u32(0), u16(0), u16(0x5a21), u16(0x6000), u16(0x20), name]);
  const offFiles = 44, offData = offFiles + cffile.length;
  const cfdata = Buffer.concat([u32(0), u16(data.length), u16(content.length), data]);
  const total = offData + cfdata.length;
  const h = Buffer.alloc(36); h.write('MSCF', 0, 'latin1'); h.writeUInt32LE(o.r1 ?? 0, 4); h.writeUInt32LE((o.cb ?? total) >>> 0, 8);
  h.writeUInt32LE(o.coff ?? offFiles, 16); h[24] = 3; h[25] = 1; h.writeUInt16LE(o.nfold ?? 1, 26); h.writeUInt16LE(o.nfiles ?? 1, 28); h.writeUInt16LE(0x1234, 32);
  return Buffer.concat([h, Buffer.concat([u32(offData), u16(1), u16(1)]), cffile, cfdata]);
}
/** lzip member from xz's raw LZMA1 encoder (lc3 lp0 pb2, end marker) + 20-byte trailer. Null when xz cannot. */
function lzip(content: Buffer, version = 1): Buffer | null {
  if (!which('xz')) return null;
  const r = spawnSync('xz', ['--format=raw', '--lzma1=lc=3,lp=0,pb=2,dict=8MiB', '-c'], { input: content });
  if (r.status !== 0 || !r.stdout.length) return null;
  const member = Buffer.concat([Buffer.from('LZIP'), Buffer.from([version, 0x17]), r.stdout]);
  const t = Buffer.alloc(20); t.writeUInt32LE(crc(content), 0); t.writeBigUInt64LE(BigInt(content.length), 4); t.writeBigUInt64LE(BigInt(member.length + 20), 12);
  return Buffer.concat([member, t]);
}

async function main(): Promise<void> {
  check('A0. payload carries the sentinel; deflate output does not expose it', PAYLOAD.includes(SENT) && !zlib.deflateRawSync(PAYLOAD).includes(SENT));
  const node = (b: Buffer) => { const i = b.indexOf(Buffer.from([0x1f, 0x8b, 8])), e = b.lastIndexOf(Buffer.from('\nvar z = 2;\n')); try { return zlib.gunzipSync(b.subarray(i, e === -1 ? b.length : e)).includes(SENT); } catch { return false; } };

  // ================================================================ G: C14-F1 embedded gzip (Tier B)
  const G: [string, Buffer][] = [
    ['FNAME of 70,000 bytes', js(gz(PAYLOAD, { name: fill(70000, 0x41) }))],
    ['FCOMMENT of 70,000 bytes', js(gz(PAYLOAD, { comment: fill(70000, 0x42) }))],
    ['13,200 empty stored blocks (66 KB) before the content', js(gz(PAYLOAD, { body: emptyBlocks(13200, PAYLOAD) }))],
    ['chain of tiny members (3-byte outputs)', js(Buffer.concat(['g5-', 'i1-', 'dev', '\n'].map((s) => gz(Buffer.from(s)))))],
    ['reserved flag bit 0x20', js(gz(PAYLOAD, { flagBits: 0x20 }))],
    ['FNAME of 1.2 MB (beyond the 1 MiB field scan)', js(Buffer.concat([gz(PAYLOAD, { name: fill(1200000, 0x41) })]))],
    ['complete 9-byte member with a WRONG trailer (gunzip emits it before the CRC check)', js(gz(Buffer.from(SENT), { badTrailer: true }))],
  ];
  for (const [i, [lbl, b]] of G.entries()) {
    if (i < 5 || i === 5) check(`G${i}p. precondition: ${i === 4 ? 'Python gzip' : 'Node zlib.gunzipSync'} recovers the hidden sentinel (${lbl})`, i === 4
      ? spawnSync('python3', ['-I', '-c', `import gzip,sys;d=sys.stdin.buffer.read();i=d.find(b'\\x1f\\x8b\\x08');sys.exit(0 if b'${SENT}' in gzip.decompress(d[i:d.rfind(b'\\nvar z')]) else 1)`], { input: b }).status === 0
      : node(b));
    check(`G${i}r. raw bytes do not expose the sentinel (${lbl})`, !b.includes(SENT) || i === 6);
    mustFail(`G${i}`, `[C14-F1] embedded gzip, ${lbl}`, b, /^gzip \(embedded\)$/);
  }
  mustFail('G7', '[C14-F1] empty-block gzip as a tar member', tar('a.js', js(gz(PAYLOAD, { body: emptyBlocks(13200, PAYLOAD) }))), /^gzip \(embedded\)$/);
  mustFail('G8', '[C14-F1] long-FNAME gzip, large-file window path (maxArchiveBytes 1024)', Buffer.concat([fill(2048, 0x20), gz(PAYLOAD, { name: fill(300000, 0x41) })]), /^gzip \(embedded\)$/, SCANNER, { maxArchiveBytes: 1024 });
  mustPass('G9', 'gzip magic + header + invalid deflate (reserved block type)', code(Buffer.concat([hex('1f8b0800 00000000 0003'), fill(64, 0xff)])));
  mustPass('G10', 'gzip magic + FNAME that never terminates before the end of the data (nothing decodable)', code(Buffer.concat([hex('1f8b0808 00000000 0003'), fill(200, 0x41)])).subarray(0, 256 + 8 + 10 + 150));
  mustPass('G11', 'complete 4-byte member with a wrong trailer (too short to hide a sentinel)', js(gz(Buffer.from('tiny'), { badTrailer: true })));

  // ================================================================ R: C14-F2 / F3 rar (Tier A: marker alone)
  const bsdtar = which('bsdtar');
  for (const [t, n] of [[0x75, 'COMM'], [0x76, 'AV'], [0x77, 'SUB'], [0x78, 'PROTECT'], [0x79, 'SIGN']] as [number, string][]) {
    for (const withMain of [true, false]) {
      const b = r4AddFirst(t, withMain);
      if (bsdtar) check(`R4.${n}.${withMain ? 'main' : 'nomain'}p. precondition: bsdtar extracts the rar v4 whose first block is an add-size ${n} block`, extracts('bsdtar', (f) => ['-xOf', f], b, BENIGN.subarray(0, 30), '.rar'));
      mustFail(`R4.${n}.${withMain ? 'main' : 'nomain'}`, `[C14-F2] rar v4, add-size ${n} block first${withMain ? '' : ', no main header'}`, b, /^rar$/);
    }
  }
  const R5: [string, Buffer][] = [['file header first, no main header', Buffer.concat([R5_SIG, r5File(BENIGN), r5End()])],
    ['service header first', Buffer.concat([R5_SIG, r5Service(), r5Main(), r5File(BENIGN), r5End()])], ['main header with a 4-byte size number', Buffer.concat([R5_SIG, r5Main(4), r5File(BENIGN), r5End()])]];
  for (const [i, [lbl, b]] of R5.entries()) {
    if (bsdtar) check(`R5.${i}p. precondition: bsdtar extracts the rar v5 with ${lbl}`, extracts('bsdtar', (f) => ['-xOf', f], b, BENIGN.subarray(0, 30), '.rar'));
    mustFail(`R5.${i}`, `[C14-F3] rar v5, ${lbl}`, b, /^rar$/);
    mustFail(`R5.${i}e`, `[C14-F3] same, embedded in machine-code bytes`, code(b), /^rar$/);
  }
  if (!bsdtar) { notRun.push('R*p'); console.log('NOT RUN R*p (bsdtar not installed)'); }
  mustFail('R6', '[Tier A] rar v5 marker inside a stored ZIP inside a tar.gz', zlib.gzipSync(tar('a.zip', zipStored('a.rar', Buffer.concat([R5_SIG, fill(32, 0x48)])))), /^rar$/);
  mustPass('R7', '"Rar!" in JS text (escaped marker, as bundlers emit it)', Buffer.from('const RAR = "Rar!\\x1a\\x07\\x00"; // Rar! archive\n'.repeat(8)));

  // ================================================================ F: C14-F4 lzip, compress .Z, ISO 9660
  const lz = lzip(PAYLOAD);
  if (lz) {
    check('F1p. precondition: xz --format=lzip decodes the lzip member', (spawnSync('xz', ['--format=lzip', '-d', '-c'], { input: lz }).stdout as Buffer).includes(SENT));
    check('F1r. lzip member does not expose the sentinel', !lz.includes(SENT));
    mustFail('F1', '[C14-F4] lzip (version 1)', lz, /^lzip$/);
    mustFail('F1e', '[C14-F4] lzip, embedded in machine-code bytes', code(lz), /^lzip$/);
    const v0 = lzip(PAYLOAD, 0)!;
    check('F2p. precondition: xz decodes an lzip member with version byte 0', (spawnSync('xz', ['--format=lzip', '-d', '-c'], { input: v0 }).stdout as Buffer).includes(SENT));
    mustFail('F2', '[C14-F4] lzip (version 0)', v0, /^lzip$/);
    mustFail('F3', '[C14-F4] lzip inside a tar.gz', zlib.gzipSync(tar('a.tar.lz', lz)), /^lzip$/);
  } else { notRun.push('F1-F3'); console.log('NOT RUN F1-F3 (xz with raw LZMA1 encoding not available)'); }
  mustPass('F4', '"LZIP" in JS text', Buffer.from('// LZIP is the lzip magic\nexport const LZ = "LZIP";\n'.repeat(8)));
  mustPass('F4b', 'NUL-terminated "LZIP" string followed by UTF-8 text (C-string table / .mo file shape)', code(Buffer.concat([Buffer.from('LZIP\0'), Buffer.from('\u0424\u0430\u0439\u043b', 'utf8')])));
  if (lz) {
    const nz = Buffer.from(lz); nz[6] = 0x55;
    check('F4cp. precondition: xz refuses an lzip member whose first LZMA byte is not 0', !(spawnSync('xz', ['--format=lzip', '-d', '-c'], { input: nz }).stdout as Buffer).includes(SENT));
    if (which('lzip')) check('F4cq. precondition: lzip -dc refuses it too (justifies F4c = PASS)', !(spawnSync('lzip', ['-d', '-c'], { input: nz }).stdout as Buffer).includes(SENT));
    else console.log('NOT RUN F4cq (lzip not installed)');
    mustPass('F4c', 'lzip header with a non-zero first LZMA byte (readers refuse it)', code(nz));
  }
  const compress = which('compress', 'ncompress');
  if (compress) {
    const z = spawnSync(compress, ['-c'], { input: PAYLOAD }).stdout as Buffer;
    check('F5p. precondition: gzip -dc decodes the .Z stream', (spawnSync('gzip', ['-d', '-c'], { input: z }).stdout as Buffer).includes(SENT));
    check('F5r. .Z stream does not expose the sentinel', !z.includes(SENT));
    mustFail('F5', '[C14-F4] compress .Z at offset 0', z, /^compress \(\.Z\)$/);
    mustFail('F6', '[C14-F4] compress .Z as a stored ZIP member (offset 0 of the member)', zipStored('a.Z', z), /^compress \(\.Z\)$/);
    const res = Buffer.from(z); res[2] |= 0x60;
    check('F7p. precondition: gzip -dc decodes a .Z with reserved flag bits set', (spawnSync('gzip', ['-d', '-c'], { input: res }).stdout as Buffer).includes(SENT));
    mustFail('F7', '[C14-F4] compress .Z with reserved flag bits', res, /^compress \(\.Z\)$/);
    const mb8 = Buffer.from(z); mb8[2] = (mb8[2] & 0xe0) | 8;
    // C15-CI-1: GNU gzip (Ubuntu) decodes maxbits 0..8, Apple gzip does not; the
    // scanner fails closed either way (full range: palmG5C15CI1CompressMaxbits).
    info('F8i. gzip -dc decodes a .Z with maxbits 8 (scanner fails closed either way)', (spawnSync('gzip', ['-d', '-c'], { input: mb8 }).stdout as Buffer).includes(SENT));
    mustFail('F8', '[C15-CI-1] .Z header with maxbits 8 (GNU gzip decodes it)', mb8, /^compress \(\.Z\)$/);
    check('F9p. precondition: gzip refuses a .Z that starts after offset 0', !(spawnSync('gzip', ['-d', '-c'], { input: Buffer.concat([fill(16, 0x41), z]) }).stdout as Buffer).includes(SENT));
    mustPass('F9', 'documented residual: .Z embedded after offset 0 (no stock reader opens it)', Buffer.concat([fill(16, 0x41), z]));
  } else { notRun.push('F5-F9'); console.log('NOT RUN F5-F9 (compress / ncompress not installed)'); }
  if (bsdtar) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
    try {
      fs.writeFileSync(path.join(d, 'p.txt'), PAYLOAD);
      const mk = spawnSync('bsdtar', ['--format', 'iso9660', '--options', 'zisofs', '-cf', 'z.iso', 'p.txt'], { cwd: d });
      const iso = mk.status === 0 ? fs.readFileSync(path.join(d, 'z.iso')) : null;
      if (!iso) { notRun.push('F10'); console.log('NOT RUN F10 (this bsdtar cannot write a zisofs ISO)'); }
      else {
        check('F10p. precondition: bsdtar extracts the payload of the zisofs ISO', extracts('bsdtar', (f) => ['-xOf', f], iso, Buffer.from(SENT), '.iso'));
        mustFail('F10', '[C14-F4] ISO 9660 image with zisofs', iso, /^iso9660$/);
        mustFail('F10t', '[C14-F4] same, as a tar member', tar('z.iso', iso), /^iso9660$/);
      }
    } finally { cleanup(d); }
  } else { notRun.push('F10'); console.log('NOT RUN F10 (bsdtar not installed)'); }
  mustPass('F11', '"CD001" in JS text', Buffer.from('const ISO = "CD001"; // ISO 9660 standard identifier CD001\n'.repeat(8)));

  // ================================================================ C: cab -- reader union (bsdtar | cabextract)
  mustFail('C1', '[C14-P3-1] cab with reserved1 != 0 (cabextract ignores reserved1)', cab({ r1: 0x41414141 }), /^cab$/);
  mustPass('C2', 'cab with no folders (bsdtar and cabextract refuse)', code(cab({ nfold: 0 })));
  mustPass('C3', 'cab with reserved1 != 0 and a file-table offset beyond the cabinet size (neither reader accepts)', code(cab({ r1: 1, coff: 0x7fffffff })));
  mustPass('C4', '"MSCF" in JS text', Buffer.from('// MSCF cabinet magic\nexport const CAB = "MSCF"; const note = "MSCF header with folders and files listed";\n'.repeat(8)));
  const cabx = which('cabextract');
  if (cabx) {
    info('C1i. cabextract extracts the reserved1 != 0 cabinet (scanner fails closed either way)', extracts(cabx, (f) => ['-p', f], cab({ r1: 0x41414141 }), Buffer.from(SENT), '.cab'));
    check('C2p. precondition: cabextract refuses the no-folder cabinet (justifies C2 = PASS)', !extracts(cabx, (f) => ['-p', f], cab({ nfold: 0 }), Buffer.from(SENT), '.cab'));
    check('C3p. precondition: cabextract refuses the out-of-range cabinet (justifies C3 = PASS)', !extracts(cabx, (f) => ['-p', f], cab({ r1: 1, coff: 0x7fffffff }), Buffer.from(SENT), '.cab'));
  } else { notRun.push('C*p (cabextract)'); console.log('NOT RUN C1i/C2p/C3p (cabextract not installed)'); }

  // ================================================================ S: Tier A xz / 7z header variants
  mustFail('S1', '[Tier A] xz magic with a broken header CRC', code(Buffer.concat([hex('fd377a585a00 0004'), u32(0xdeadbeef), fill(32, 0x11)])), /^xz$/);
  mustFail('S2', '[Tier A] 7z magic with a zeroed start header', code(Buffer.concat([hex('377abcaf271c 0004'), Buffer.alloc(24)])), /^7z$/);
  const sz = which('7zz', '7z');
  if (sz && bsdtar) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
    try {
      fs.writeFileSync(path.join(d, 'p.txt'), PAYLOAD);
      if (spawnSync('bsdtar', ['--format', '7zip', '-cf', 'p.7z', 'p.txt'], { cwd: d }).status === 0) {
        const z = fs.readFileSync(path.join(d, 'p.7z')); const bad = Buffer.from(z); bad.fill(0, 8, 32);
        info(`S2i. ${sz} extracts a 7z whose start header is zeroed (scanner fails closed either way)`, extracts(sz, (f) => ['x', '-y', f], bad, Buffer.from(SENT), '.7z'));
      }
    } finally { cleanup(d); }
  } else console.log('NOT RUN S2i (7-Zip not installed)');

  // ================================================================ T: C14-P3-2 budget after the last entry and at the end of the scan
  { // Count the budget reads of a clean scan of one ZIP, then expire exactly on the last read.
    const z = F.buildZip([{ name: 'a.txt', data: BENIGN }, { name: 'b.txt', data: BENIGN }]).buf;
    let reads = 0;
    const counter: LimitsFn = (base) => new Proxy({ ...base }, { get(t: any, k) { if (k === 'maxScanMs') reads++; return t[k]; } });
    const r0 = run('T.zip', z, SCANNER, counter);
    check('T0. control: the ZIP scan is clean without a budget problem', r0.exit === 0, JSON.stringify(r0));
    const expireLast: LimitsFn = (base) => { let n = 0; return new Proxy({ ...base }, { get(t: any, k) { if (k === 'maxScanMs' && ++n >= reads) return -1; return t[k]; } }); };
    const r1 = run('T.zip', z, SCANNER, expireLast);
    check(`T1. [C14-P3-2] a budget that expires on the final check (read ${reads}) is reported (end-of-scan check)`, r1.errors.some((e) => /work-time budget/.test(e)), JSON.stringify(r1.errors));
    const expirePrev: LimitsFn = (base) => { let n = 0; return new Proxy({ ...base }, { get(t: any, k) { if (k === 'maxScanMs' && ++n >= reads - 1) return -1; return t[k]; } }); };
    const r2 = run('T.zip', z, SCANNER, expirePrev);
    check('T2. [C14-P3-2] a budget that expires right after the last ZIP entry is reported', r2.errors.some((e) => /work-time budget/.test(e)), JSON.stringify(r2.errors));
  }
  { const mod = (() => { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP)); try { fs.mkdirSync(path.join(tmp, 'apps/web/scripts'), { recursive: true }); const sp = path.join(tmp, 'apps/web/scripts/check-palmistry-bundle.js');
      fs.copyFileSync(SCANNER, sp); fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(tmp, 'apps/web/palmistry-build-exclusion.js')); const m = require(sp); delete require.cache[require.resolve(sp)]; return m; } finally { cleanup(tmp); } })();
    const L = mod.INSPECTION_LIMITS;
    const expected = { maxFileBytes: 256 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 * 1024, maxFiles: 250000, maxDepth: 64, chunkBytes: 1024 * 1024, maxArchiveBytes: 64 * 1024 * 1024, maxArchiveEntryBytes: 64 * 1024 * 1024, maxArchiveDecompressedBytes: 256 * 1024 * 1024, maxTotalDecompressedBytes: 1024 * 1024 * 1024, maxCompressionRatio: 200, maxArchiveEntries: 10000, maxGzipMembers: 10000, maxNestedArchiveDepth: 3, maxScanMs: 600000 };
    check('T3. every inspection limit is unchanged', Object.entries(expected).every(([k, v]) => L[k] === v) && Object.keys(L).length === Object.keys(expected).length, JSON.stringify(L)); }

  // ================================================================ P: nested prohibited content still found; false positives
  mustPass('P1', 'benign tar.gz and ZIP pass', zlib.gzipSync(tar('a.zip', zipStored('a.txt', BENIGN))));
  { const r = run('P2.tgz', zlib.gzipSync(tar('a.zip', F.buildZip([{ name: 'x.txt', data: PAYLOAD, method: 8 }]).buf)));
    check('P2. sentinel in a deflated ZIP inside a tar.gz is found', r.exit === 1 && r.hits.some((h) => h.includes(SENT)), JSON.stringify(r)); }
  mustPass('P3', '256 KiB of pseudo-random binary data', Buffer.from(Array.from({ length: 262144 }, (_, i) => (Math.imul(i + 7, 2654435761) >>> 13) & 0xff)));

  // ================================================================ M: mutants (each rule reverted -> the suite observes it)
  if (!process.env.PALM_SCANNER_UNDER_TEST) {
    const src = fs.readFileSync(SCANNER, 'utf8');
    const longName = js(gz(PAYLOAD, { name: fill(70000, 0x41) })), empty = js(gz(PAYLOAD, { body: emptyBlocks(13200, PAYLOAD) }));
    const tiny = js(Buffer.concat(['g5-', 'i1-', 'dev'].map((s) => gz(Buffer.from(s)))));
    const mutants: { id: string; label: string; from: string; to: string; probe: (m: string) => boolean }[] = [
      { id: 'M1', label: 'gzip: a field still open at the scan bound treated as "not gzip" again', from: 'if (z === -1) return end < buf.length || !!ctx.more;', to: 'if (z === -1) return false;', probe: (m) => mustPass('M1p', '', js(gz(PAYLOAD, { name: fill(1200000, 0x41) })), m) },
      { id: 'M2', label: 'gzip "valid through the window" rule removed', from: "if (err && err.code === 'Z_BUF_ERROR' && (", to: "if (false && (", probe: (m) => mustPass('M2p', '', empty, m) },
      { id: 'M3', label: 'gzip complete-member trailer rule removed', from: 'return (buf.readUInt32LE(t) === crc32(r.buffer) && buf.readUInt32LE(t + 4) === r.buffer.length) || gzipRecoverableLeak(slice);', to: 'return gzipRecoverableLeak(slice);', probe: (m) => mustPass('M3p', '', tiny, m) },
      { id: 'M4', label: 'gzip reserved-flag rejection reinstated', from: "if (p + 10 > buf.length || buf[p + 2] !== 8) return false;\n  const flg = buf[p + 3];", to: "if (p + 10 > buf.length || buf[p + 2] !== 8 || buf[p + 3] & 0xe0) return false;\n  const flg = buf[p + 3];", probe: (m) => mustPass('M4p', '', js(gz(PAYLOAD, { flagBits: 0x20 })), m) },
      { id: 'M5', label: 'rar Tier A reverted (main header required first)', from: 'function validRarAt() {\n  return true;', to: 'function validRarAt(buf, p) {\n  return buf[p + 6] === 0 && buf[p + 9] === 0x73;', probe: (m) => mustPass('M5p', '', Buffer.concat([R5_SIG, r5File(BENIGN), r5End()]), m) },
      { id: 'M6', label: 'cab cabextract rule removed', from: 'return buf.readUInt32LE(p + 16) < buf.readUInt32LE(p + 8) && buf.readUInt32LE(p + 8) < avail + 32;', to: 'return false;', probe: (m) => mustPass('M6p', '', cab({ r1: 0x41414141 }), m) },
      { id: 'M7', label: 'lzip detection removed', from: 'function validLzipAt(buf, p) {', to: 'function validLzipAt(buf, p) { return false;', probe: (m) => mustPass('M7p', '', Buffer.concat([Buffer.from('LZIP'), Buffer.from([1, 0x17, 0]), fill(40, 0x11)]), m) },
      { id: 'M8', label: 'ISO 9660 detection removed', from: 'function validIsoAt(buf, p) {', to: 'function validIsoAt(buf, p) { return false;', probe: (m) => mustPass('M8p', '', code(Buffer.concat([Buffer.from([1]), Buffer.from('CD001'), Buffer.from([1, 0])])), m) },
      { id: 'M9', label: 'compress .Z detection removed', from: 'function validCompressAt(buf) {', to: 'function validCompressAt(buf) { return false;', probe: (m) => mustPass('M9p', '', hex('1f9d90 70 ff ff ff ff'), m) },
      { id: 'M10', label: 'xz Tier A reverted (header CRC required)', from: 'function validXzAt() {\n  return true;', to: 'function validXzAt(buf, p) {\n  return p + 12 <= buf.length && crc32(buf.subarray(p + 6, p + 8)) === buf.readUInt32LE(p + 8);', probe: (m) => mustPass('M10p', '', code(Buffer.concat([hex('fd377a585a00 0004'), u32(0xdeadbeef), fill(32, 0x11)])), m) },
      { id: 'M11', label: '7z Tier A reverted (start-header CRC required)', from: 'function valid7zAt() {\n  return true;', to: 'function valid7zAt(buf, p) {\n  return p + 32 <= buf.length && crc32(buf.subarray(p + 12, p + 32)) === buf.readUInt32LE(p + 8);', probe: (m) => mustPass('M11p', '', code(Buffer.concat([hex('377abcaf271c 0004'), Buffer.alloc(24)])), m) },
      { id: 'M12', label: 'end-of-scan budget check removed', from: "  overTime(); // G5-C15 (C14-P3-2): and once more at the end of the scan", to: '  // removed', probe: (m) => {
        const z = F.buildZip([{ name: 'a.txt', data: BENIGN }, { name: 'b.txt', data: BENIGN }]).buf; let reads = 0;
        run('T.zip', z, SCANNER, (base) => new Proxy({ ...base }, { get(t: any, k) { if (k === 'maxScanMs') reads++; return t[k]; } }));
        const r = run('T.zip', z, m, (base) => { let n = 0; return new Proxy({ ...base }, { get(t: any, k) { if (k === 'maxScanMs' && ++n >= reads) return -1; return t[k]; } }); });
        return !r.errors.some((e) => /work-time budget/.test(e)); } },
    ];
    for (const mt of mutants) {
      if (src.split(mt.from).length !== 2) { check(`${mt.id}. mutant anchor present exactly once (${mt.label})`, false, 'scanner source changed; update the mutant'); continue; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
      try { const mut = path.join(d, 'check-palmistry-bundle.js'); fs.writeFileSync(mut, src.replace(mt.from, mt.to));
        check(`${mt.id}. negative control: with ${mt.label}, the suite observes the regression`, mt.probe(mut)); } finally { cleanup(d); }
    }
  } else { notRun.push('M1-M12'); console.log('NOT RUN M1-M12 (PALM_SCANNER_UNDER_TEST set)'); }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
