/**
 * AURA-PALM-G5-I1-R4.2 -- archive format ambiguity and nested-archive policy
 * (IV1-F1 cross-format interpretation and gzip header fields, IV1-F2 ZIP
 * structural validation, IV1-F3 nested ZIP policy).
 *
 * Runs the REAL scanner CLI (apps/web/scripts/check-palmistry-bundle.js, or
 * PALM_SCANNER_UNDER_TEST for negative controls) against throwaway trees, and
 * the exported inspectArtifacts API for limit checks. Archives are generated in
 * code (deterministic writers below); where stock tools exist (zip, ditto,
 * gzip, bsdtar, python3) a few benign fixtures are also built with them,
 * otherwise those checks are reported NOT RUN. Payloads: the installed
 * MediaPipe package and synthetic bytes. Nothing is extracted or executed. No
 * network. No real palm images. Memory is measured on the scanner child with
 * an RSS watchdog that kills it at a ceiling.
 *
 * Run: npx ts-node test/palmG5I1R42ArchiveFormat.test.ts
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
const OK = Buffer.from('ok\n');

// ------------------------------------------------------------------ deterministic writers
const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

interface ZE {
  name: string; data: Buffer; method?: number; attr?: number; usize?: number; crc?: number; extra?: Buffer; comp?: Buffer;
  flags?: number; lflags?: number; lmethod?: number; lver?: number; lcrc?: number; lcsize?: number; lusize?: number; descriptor?: Buffer;
}
interface ZipParts { locals: Buffer; cd: Buffer; eocd: Buffer; buf: Buffer }
function zipParts(entries: ZE[], opts: { comment?: Buffer; cdOffset?: number; lastCdComment?: Buffer } = {}): ZipParts {
  const locals: Buffer[] = [];
  const cds: Buffer[] = [];
  let off = 0;
  entries.forEach((e, i) => {
    const method = e.method ?? 8;
    const comp = e.comp ?? (method === 8 ? zlib.deflateRawSync(e.data) : e.data);
    const crc = e.crc ?? crc32(e.data);
    const usize = e.usize ?? e.data.length;
    const name = Buffer.from(e.name);
    const extra = e.extra ?? Buffer.alloc(0);
    const cdComment = i === entries.length - 1 && opts.lastCdComment ? opts.lastCdComment : Buffer.alloc(0);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(e.lver ?? 20, 4); lh.writeUInt16LE(e.lflags ?? e.flags ?? 0, 6); lh.writeUInt16LE(e.lmethod ?? method, 8);
    lh.writeUInt32LE(e.lcrc ?? crc, 14); lh.writeUInt32LE(e.lcsize ?? comp.length, 18); lh.writeUInt32LE(e.lusize ?? usize, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(extra.length, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x0314, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(e.flags ?? 0, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(usize, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(cdComment.length, 32);
    cd.writeUInt32LE(((e.attr ?? 0o100644) << 16) >>> 0, 38); cd.writeUInt32LE(off, 42);
    const local = Buffer.concat([lh, name, extra, comp, e.descriptor ?? Buffer.alloc(0)]);
    locals.push(local);
    cds.push(Buffer.concat([cd, name, cdComment]));
    off += local.length;
  });
  const cdb = Buffer.concat(cds);
  const c = opts.comment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdb.length, 12); eocd.writeUInt32LE(opts.cdOffset ?? off, 16); eocd.writeUInt16LE(c.length, 20);
  return { locals: Buffer.concat(locals), cd: cdb, eocd: Buffer.concat([eocd, c]), buf: Buffer.concat([...locals, cdb, eocd, c]) };
}
const zip = (entries: ZE[], opts: { comment?: Buffer } = {}) => zipParts(entries, opts).buf;
const descriptor = (data: Buffer, comp: Buffer, sig: boolean, crcOverride?: number) => {
  const d = Buffer.alloc(sig ? 16 : 12); let o = 0;
  if (sig) { d.writeUInt32LE(0x08074b50, 0); o = 4; }
  d.writeUInt32LE(crcOverride ?? crc32(data), o); d.writeUInt32LE(comp.length, o + 4); d.writeUInt32LE(data.length, o + 8);
  return d;
};

function tarHeader(name: string | Buffer, size: number, type = '0'): Buffer {
  const h = Buffer.alloc(512);
  if (typeof name === 'string') h.write(name, 0, 100, 'utf8'); else name.copy(h, 0, 0, Math.min(100, name.length));
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write(type, 156);
  h.write('ustar\0', 257); h.write('00', 263);
  return h;
}
function seal(h: Buffer): Buffer { h.fill(0x20, 148, 156); let s = 0; for (const b of h) s += b; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148); return h; }
function tar(entries: { name: string | Buffer; data?: Buffer; linkname?: Buffer }[]): Buffer {
  const out: Buffer[] = [];
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const h = tarHeader(e.name, data.length);
    if (e.linkname) e.linkname.copy(h, 157, 0, Math.min(100, e.linkname.length));
    out.push(seal(h), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}
/** One gzip member with optional FEXTRA / FNAME / FCOMMENT / FHCRC (true = correct CRC, number = forced value). */
function gzipMember(data: Buffer, f: { extra?: Buffer; name?: Buffer; comment?: Buffer; hcrc?: true | number; deflated?: Buffer; xlenOverride?: number; noNameNul?: boolean } = {}): Buffer {
  let flg = 0;
  if (f.extra) flg |= 0x04; if (f.name) flg |= 0x08; if (f.comment) flg |= 0x10; if (f.hcrc !== undefined) flg |= 0x02;
  const parts: Buffer[] = [Buffer.from([0x1f, 0x8b, 8, flg, 0, 0, 0, 0, 0, 3])];
  if (f.extra) { const x = Buffer.alloc(2); x.writeUInt16LE(f.xlenOverride ?? f.extra.length, 0); parts.push(x, f.extra); }
  if (f.name) parts.push(f.name, f.noNameNul ? Buffer.alloc(0) : Buffer.from([0]));
  if (f.comment) parts.push(f.comment, Buffer.from([0]));
  if (f.hcrc !== undefined) { const c = Buffer.alloc(2); c.writeUInt16LE(f.hcrc === true ? crc32(Buffer.concat(parts)) & 0xffff : f.hcrc, 0); parts.push(c); }
  const tr = Buffer.alloc(8); tr.writeUInt32LE(crc32(data), 0); tr.writeUInt32LE(data.length >>> 0, 4);
  return Buffer.concat([...parts, f.deflated ?? zlib.deflateRawSync(data), tr]);
}
/** Raw deflate using only stored blocks (the input bytes appear verbatim in the compressed stream). */
function deflateStored(data: Buffer): Buffer {
  const out: Buffer[] = []; let i = 0;
  do { const n = Math.min(65535, data.length - i); const h = Buffer.alloc(5); h[0] = i + n >= data.length ? 1 : 0; h.writeUInt16LE(n, 1); h.writeUInt16LE((~n) & 0xffff, 3); out.push(h, data.subarray(i, i + n)); i += n; } while (i < data.length);
  return Buffer.concat(out);
}
const gz = (b: Buffer) => zlib.gzipSync(b);

// ------------------------------------------------------------------ trees and runs
function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r42-'));
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
const cleanup = (tmp: string) => { if (path.basename(tmp).startsWith('palm-r42-') && path.dirname(tmp) === os.tmpdir()) fs.rmSync(tmp, { recursive: true, force: true }); };
function scan(files: Record<string, Buffer>) {
  const t = makeTree();
  try {
    for (const [rel, data] of Object.entries(files)) { const f = path.join(t.web, 'public', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); }
    return spawnSync(process.execPath, [path.join(t.web, 'scripts/check-palmistry-bundle.js')], { encoding: 'utf8', timeout: 120000 });
  } finally { cleanup(t.tmp); }
}
function inspectWith(files: Record<string, Buffer>, limits: Record<string, number>) {
  const t = makeTree();
  try {
    for (const [rel, data] of Object.entries(files)) fs.writeFileSync(path.join(t.web, 'public', rel), data);
    const mod = require(path.join(t.web, 'scripts/check-palmistry-bundle.js'));
    return mod.inspectArtifacts(t.web, { ...mod.INSPECTION_LIMITS, ...limits });
  } finally { cleanup(t.tmp); }
}
/** Scanner child process; RSS sampled with `ps` every 25 ms; SIGKILL above `ceilingMiB`. */
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
    const hard = setTimeout(() => { if (!killed) { killed = true; child.kill('SIGKILL'); } }, 120000);
    child.on('exit', (code) => { clearInterval(iv); clearTimeout(hard); cleanup(t.tmp); resolve({ code, killed, maxRssMiB: +(max / 1024).toFixed(1), out }); });
  });
}
const fails = (r: any, re?: RegExp) => r.status === 1 && !r.signal && (!re || re.test(r.stderr));
const passes = (r: any) => r.status === 0 && !r.signal;
const out = (r: any) => `exit=${r.status}${r.signal ? ` ${r.signal}` : ''} ${((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(0, 3).join(' | ').slice(0, 260)}`;
const caseFail = (id: string, label: string, files: Record<string, Buffer>, re?: RegExp) => { const r = scan(files); check(`${id}. ${label} -> FAIL`, fails(r, re), out(r)); };
const casePass = (id: string, label: string, files: Record<string, Buffer>) => { const r = scan(files); check(`${id}. ${label} -> PASS`, passes(r), out(r)); };
const HIT = /odml\.pa\.googleapis\.com|HandLandmarkerGraph|_mediapipeLoggerGetEncodedApiKey/;
const AMBIG = /ambiguous archive/;
const hasTool = (t: string) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0;

const MJS_ZIP = zip([{ name: 'a.js', data: MJS }]);
const OK_ZIP = zip([{ name: 'ok.txt', data: OK }]);
// A runtime slice that carries a scanner signature and deflates to well under 64 KiB (fits one gzip FEXTRA field).
const SIG_AT = Math.max(0, MJS.indexOf(Buffer.from('odml.pa.googleapis.com')));
const RT_SLICE = MJS.subarray(Math.max(0, SIG_AT - 20000), SIG_AT + 20000);
const SMALL_RT_ZIP = zip([{ name: 'a.js', data: RT_SLICE }]);

/** gzip(benign) whose first 512 bytes are also a valid ustar header; the raw tar member holds `member`. */
function gzipTarPolyglot(member: Buffer): Buffer {
  const tarData = Buffer.concat([member, Buffer.alloc((512 - (member.length % 512)) % 512), Buffer.alloc(1024)]);
  const blk = Buffer.alloc(512);
  Buffer.from([0x1f, 0x8b, 8, 0x04, 0, 0, 0, 0, 0, 3]).copy(blk, 0);
  blk.writeUInt16LE(512 - 12 + tarData.length, 10);
  blk.write('0000644\0', 100); blk.write('0000000\0', 108); blk.write('0000000\0', 116);
  blk.write(member.length.toString(8).padStart(11, '0') + '\0', 124); blk.write('00000000000\0', 136); blk.write('0', 156);
  blk.write('ustar\0', 257); blk.write('00', 263);
  seal(blk);
  return gzipMember(OK, { extra: Buffer.concat([blk.subarray(12), tarData]) });
}
/** tar whose two entries split one ZIP (local header + data in entry A; CD + EOCD in entry B), readable by unzip. */
function tarSplitZip(lver: number, leading = Buffer.alloc(0)): Buffer {
  const first = zipParts([{ name: 'a.js', data: MJS, lver }]);
  const A = Buffer.concat([leading, first.locals]);
  const bStart = 512 + A.length + ((512 - (A.length % 512)) % 512) + 512;
  const z = zipParts([{ name: 'a.js', data: MJS, lver }], { cdOffset: bStart - 512 - leading.length });
  return tar([{ name: 'a.bin', data: A }, { name: 'b.bin', data: Buffer.concat([z.cd, z.eocd]) }]);
}
/** tar where the CD sits in entry A (its last record's comment spans the tar header of B) and only the EOCD is in entry B. */
function tarSplitEocdOnly(): Buffer {
  const lead = Buffer.from('X');
  const p0 = zipParts([{ name: 'a.js', data: MJS, lver: 0xff }]);
  const aLen0 = lead.length + p0.locals.length + p0.cd.length; // CD comment fills the rest of A, its padding and B's header
  const aPadded = Math.ceil((aLen0 + 1) / 512) * 512;
  const commentLen = aPadded - aLen0 + 512;
  const p = zipParts([{ name: 'a.js', data: MJS, lver: 0xff }], { lastCdComment: Buffer.alloc(commentLen, 0x20) });
  const eocd = Buffer.from(p.eocd);
  eocd.writeUInt32LE(p.cd.length, 12); // CD size includes the comment that spans the tar header
  eocd.writeUInt32LE(p.locals.length, 16);
  const A = Buffer.concat([lead, p.locals, p.cd.subarray(0, p.cd.length - commentLen), Buffer.alloc(aPadded - aLen0, 0x20)]);
  const tarBuf = tar([{ name: 'a.bin', data: A }, { name: 'b.bin', data: eocd }]);
  // Overwrite the comment span (A's tail is already spaces; B's header must stay a valid tar header) -- the
  // central directory's comment bytes ARE the padding + header bytes, which unzip does not interpret.
  return tarBuf;
}

async function main(): Promise<void> {
  // ================================================================ F: cross-format interpretation (IV1-F1)
  caseFail('F1', '[IV1-F1] gzip(benign) whose FEXTRA field is a complete zip(runtime) (unzip/zipfile read it)', { 'a.gz': gzipMember(OK, { extra: SMALL_RT_ZIP }) }, HIT);
  casePass('F2', 'gzip(benign) whose FEXTRA field is a benign zip (nested-inspected, no false positive)', { 'a.gz': gzipMember(OK, { extra: OK_ZIP }) });
  caseFail('F3', '[IV1-F1] gzip/tar polyglot: same bytes are gzip(benign) and a raw tar holding gzip(runtime)', { 'a.gz': gzipTarPolyglot(gz(RT_SLICE)) }, /both a gzip stream and a tar archive/);
  caseFail('F4', 'gzip/tar polyglot with a benign tar member (ambiguity itself fails closed)', { 'a.gz': gzipTarPolyglot(OK) }, /both a gzip stream and a tar archive/);
  caseFail('F5', '[IV1-F1/F2] tar whose entries split one zip(runtime) (plausible local header)', { 'a.tar': tarSplitZip(20) }, AMBIG);
  caseFail('F6', '[IV1-F1/F2] tar whose entries split one zip(runtime) (implausible local version 0xff)', { 'a.tar': tarSplitZip(0xff) }, AMBIG);
  caseFail('F7', 'tar-split zip with a leading byte before the implausible local header', { 'a.tar': tarSplitZip(0xff, Buffer.from('X')) }, AMBIG);
  caseFail('F8', 'tar with a ZIP local-header signature inside a header (linkname) field', { 'a.tar': tar([{ name: 'a.txt', data: OK, linkname: Buffer.concat([Buffer.from('n'), Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from('x')]) }]) }, /ZIP signature in tar header/);
  caseFail('F9', 'tar with a ZIP EOCD signature inside a header (linkname) field', { 'a.tar': tar([{ name: 'a.txt', data: OK, linkname: Buffer.concat([Buffer.from('n'), Buffer.from([0x50, 0x4b, 5, 6]), Buffer.from('x')]) }]) }, /ZIP signature in tar header/);
  caseFail('F10', 'tar entry holding a whole zip(runtime) (contained: nested-inspected)', { 'a.tar': tar([{ name: 'z.zip', data: MJS_ZIP }]) }, HIT);
  casePass('F11', 'tar entry holding a whole benign zip', { 'a.tar': tar([{ name: 'z.zip', data: OK_ZIP }]) });
  caseFail('F12', 'gzip whose deflate stored blocks carry zip(runtime) (raw copy == inspected output)', { 'a.gz': gzipMember(MJS_ZIP, { deflated: deflateStored(MJS_ZIP) }) }, HIT);
  casePass('F13', 'gzip whose deflate stored blocks carry a benign zip (no false positive)', { 'a.gz': gzipMember(OK_ZIP, { deflated: deflateStored(OK_ZIP) }) });
  {
    // A raw ZIP spanning two stored blocks: the 5-byte block header sits inside the raw ZIP, so the
    // decompressed output does not contain the same bytes.
    const p = zipParts([{ name: 'a.js', data: MJS.subarray(0, 30000), method: 0 }]);
    const tail = Buffer.concat([p.cd, p.eocd]);
    const tailFixed = Buffer.from(tail); tailFixed.writeUInt32LE(p.locals.length + 5, p.cd.length + 16);
    const h1 = Buffer.alloc(5); h1[0] = 0; h1.writeUInt16LE(p.locals.length, 1); h1.writeUInt16LE((~p.locals.length) & 0xffff, 3);
    const h2 = Buffer.alloc(5); h2[0] = 1; h2.writeUInt16LE(tailFixed.length, 1); h2.writeUInt16LE((~tailFixed.length) & 0xffff, 3);
    const outData = Buffer.concat([p.locals, tailFixed]);
    caseFail('F14', 'raw ZIP spanning a deflate stored-block boundary inside gzip (no inspected copy)', { 'a.gz': gzipMember(outData, { deflated: Buffer.concat([h1, p.locals, h2, tailFixed]) }) }, /ambiguous archive|malformed|central directory/);
  }
  caseFail('F15', 'tar where only the EOCD is in entry B and the CD (comment spanning the header) is in entry A', { 'a.tar': tarSplitEocdOnly() }, AMBIG);
  casePass('F16', 'valid single-format archives still pass (tar, tgz, zip, gzip)', { 'a.tar': tar([{ name: 'a.txt', data: OK }]), 'b.tgz': gz(tar([{ name: 'b.txt', data: OK }])), 'c.zip': OK_ZIP, 'd.gz': gz(OK) });
  caseFail('F17', 'zip(benign) with a gzip/tar polyglot as a stored entry (nested ambiguity fails closed)', { 'a.zip': zip([{ name: 'p.gz', data: gzipTarPolyglot(OK), method: 0 }]) }, /both a gzip stream and a tar archive/);
  caseFail('F18', 'zip(benign) prefixed by a gzip(runtime) member (whole buffer is gzip with trailing data)', { 'a.bin': Buffer.concat([gz(RT_SLICE), OK_ZIP]) }, /unexpected data after gzip member/);

  // ================================================================ G: gzip header fields
  casePass('G1', 'valid FEXTRA + FNAME + FCOMMENT + correct FHCRC', { 'a.gz': gzipMember(OK, { extra: Buffer.from('AB\x02\x00hi'), name: Buffer.from('ok.txt'), comment: Buffer.from('a comment'), hcrc: true }) });
  caseFail('G2', 'wrong FHCRC (verified, not skipped)', { 'a.gz': gzipMember(OK, { name: Buffer.from('ok.txt'), hcrc: 0x1234 }) }, /header CRC mismatch/);
  caseFail('G3', 'FEXTRA length overruns the stream', { 'a.gz': gzipMember(OK, { extra: Buffer.from('ABCD'), xlenOverride: 60000 }) }, /FEXTRA overruns|corrupt or truncated gzip/);
  caseFail('G4', 'FNAME never terminated', { 'a.gz': Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0x08, 0, 0, 0, 0, 0, 3]), Buffer.alloc(40, 0x41)]) }, /not terminated|corrupt or truncated gzip/);
  casePass('G5', 'empty FEXTRA (XLEN = 0)', { 'a.gz': gzipMember(OK, { extra: Buffer.alloc(0) }) });
  casePass('G6', 'maximum-length benign FEXTRA (XLEN = 65535)', { 'a.gz': gzipMember(OK, { extra: Buffer.alloc(65535, 0x41) }) });
  caseFail('G7', 'FEXTRA holding gzip(runtime) (nested gzip inspected)', { 'a.gz': gzipMember(OK, { extra: gz(RT_SLICE) }) }, HIT);
  caseFail('G8', 'FEXTRA holding a ustar tar(gzip(runtime))', { 'a.gz': gzipMember(OK, { extra: tar([{ name: 'x.gz', data: gz(RT_SLICE) }]) }) }, HIT);
  caseFail('G9', 'FEXTRA holding two concatenated zips (nested ambiguity fails closed)', { 'a.gz': gzipMember(OK, { extra: Buffer.concat([OK_ZIP, OK_ZIP]) }) }, /multiple ZIP central directories|unreferenced ZIP local file header/);
  caseFail('G10', 'second member of a multi-member gzip carries zip(runtime) in FEXTRA', { 'a.gz': Buffer.concat([gz(OK), gzipMember(OK, { extra: SMALL_RT_ZIP })]) }, HIT);
  casePass('G11', 'multi-member gzip with benign header fields in every member', { 'a.gz': Buffer.concat([gzipMember(OK, { name: Buffer.from('a') }), gzipMember(OK, { comment: Buffer.from('b'), hcrc: true })]) });
  caseFail('G12', 'trailing data after the last member', { 'a.gz': Buffer.concat([gzipMember(OK, { name: Buffer.from('a') }), Buffer.from('TRAIL')]) }, /unexpected data after gzip member/);
  caseFail('G13', 'FNAME carrying a plaintext signature', { 'a.gz': gzipMember(OK, { name: Buffer.from('odml.pa.googleapis.com') }) }, /odml/);
  if (hasTool('gzip')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r42-'));
    try { fs.writeFileSync(path.join(d, 'file.txt'), 'plain text\n'.repeat(50)); execFileSync('gzip', ['-k', path.join(d, 'file.txt')]); casePass('G14', 'stock gzip output (FNAME set)', { 'file.txt.gz': fs.readFileSync(path.join(d, 'file.txt.gz')) }); } finally { cleanup(d); }
  } else { notRun.push('G14'); console.log('NOT RUN G14 (gzip not available)'); }

  // ================================================================ Z: ZIP structure (IV1-F2)
  caseFail('Z1', 'local method differs from the central directory', { 'a.zip': zip([{ name: 'a.txt', data: OK, method: 0, lmethod: 8 }]) }, /disagrees with central directory \(method\/flags\)/);
  caseFail('Z2', 'local compressed size differs (no data descriptor)', { 'a.zip': zip([{ name: 'a.txt', data: OK, lcsize: 1 }]) }, /disagrees with central directory \(CRC\/sizes\)/);
  caseFail('Z3', 'local CRC differs (no data descriptor)', { 'a.zip': zip([{ name: 'a.txt', data: OK, lcrc: 1 }]) }, /disagrees with central directory \(CRC\/sizes\)/);
  caseFail('Z4', 'local header claims a data descriptor the central directory does not', { 'a.zip': zip([{ name: 'a.txt', data: OK, lflags: 8 }]) }, /disagrees with central directory \(method\/flags\)/);
  { const c = zlib.deflateRawSync(OK);
    caseFail('Z5', 'declared data descriptor missing', { 'a.zip': zip([{ name: 'a.txt', data: OK, flags: 8, lcrc: 0, lcsize: 0, lusize: 0 }]) }, /data descriptor/);
    caseFail('Z6', 'data descriptor with a wrong CRC', { 'a.zip': zip([{ name: 'a.txt', data: OK, flags: 8, lcrc: 0, lcsize: 0, lusize: 0, descriptor: descriptor(OK, c, true, 7) }]) }, /data descriptor/);
    casePass('Z7', 'valid data descriptor with signature', { 'a.zip': zip([{ name: 'a.txt', data: OK, flags: 8, lcrc: 0, lcsize: 0, lusize: 0, descriptor: descriptor(OK, c, true) }]) });
    casePass('Z8', 'valid data descriptor without signature', { 'a.zip': zip([{ name: 'a.txt', data: OK, flags: 8, lcrc: 0, lcsize: 0, lusize: 0, descriptor: descriptor(OK, c, false) }]) });
    caseFail('Z9', 'bytes hidden after a valid data descriptor', { 'a.zip': zip([{ name: 'a.txt', data: OK, flags: 8, lcrc: 0, lcsize: 0, lusize: 0, descriptor: Buffer.concat([descriptor(OK, c, true), Buffer.from('HIDE')]) }]) }, /unreferenced bytes inside ZIP/); }
  { const implausible = (lver: number, nlen = 4) => { const h = Buffer.alloc(30 + nlen, 0x41); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(lver, 4); h.writeUInt16LE(77, 8); h.writeUInt16LE(nlen, 26); h.writeUInt16LE(0, 28); return h; };
    caseFail('Z10', '[IV1-F2] implausible local header (version 0xff, method 77) in the suffix', { 'a.zip': Buffer.concat([OK_ZIP, implausible(0xff)]) }, /unreferenced ZIP local file header/);
    caseFail('Z11', '[IV1-F2] local header with an empty name in the prefix', { 'a.zip': Buffer.concat([Buffer.from('xx'), implausible(20, 0), OK_ZIP]) }, /unreferenced ZIP local file header/);
    caseFail('Z12', '[IV1-F2] local-header signature inside the archive comment', { 'a.zip': zip([{ name: 'ok.txt', data: OK }], { comment: Buffer.concat([Buffer.from('c '), implausible(0xff)]) }) }, /unreferenced ZIP local file header/);
    caseFail('Z13', '[IV1-F2] local-header signature inside a local extra field', { 'a.zip': zip([{ name: 'ok.txt', data: OK, extra: Buffer.concat([Buffer.from([0x99, 0x99, 34, 0]), implausible(0xff)]) }]) }, /unreferenced ZIP local file header/);
    caseFail('Z14', 'a lone local header at offset 0 with an implausible version is treated as ZIP (streaming readers)', { 'a.bin': Buffer.concat([implausible(0xff), Buffer.from('payload')]) }, /no valid end-of-central-directory|malformed/); }
  { const z = Buffer.from(OK_ZIP); const e = z.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6])); z.writeUInt32LE(3, e + 16);
    caseFail('Z15', 'central-directory offset inconsistent with the local header', { 'a.zip': z }, /bad local header|malformed|unreferenced/); }
  { const a = zipParts([{ name: 'a.txt', data: OK }, { name: 'b.txt', data: OK }]); const z = Buffer.from(a.buf); const cd2 = a.locals.length + 46 + 5; z.writeUInt32LE(4, cd2 + 42);
    caseFail('Z16', 'overlapping records (second entry points into the first)', { 'a.zip': z }, /overlapping|bad local header|mismatch|unreferenced/); }
  { const z64 = Buffer.alloc(22); z64.writeUInt32LE(0x06054b50, 0); z64.writeUInt16LE(0xffff, 8); z64.writeUInt16LE(0xffff, 10); z64.writeUInt32LE(0xffffffff, 12); z64.writeUInt32LE(0xffffffff, 16);
    caseFail('Z17', 'valid zip + an appended ZIP64-marked EOCD (unsupported second directory counts)', { 'a.zip': Buffer.concat([OK_ZIP, z64]) }, /multiple ZIP central directories|ZIP64/); }
  { // A second directory with no local headers at all: only the competing-directory rule can see it.
    const emptyEocd = Buffer.alloc(22); emptyEocd.writeUInt32LE(0x06054b50, 0);
    caseFail('Z24', 'zip(runtime) + an appended empty-archive EOCD (second directory, no local headers)', { 'a.zip': Buffer.concat([MJS_ZIP, emptyEocd]) }, /multiple ZIP central directories/);
    caseFail('Z25', 'benign zip + an appended empty-archive EOCD (the ambiguity itself fails closed)', { 'a.zip': Buffer.concat([OK_ZIP, emptyEocd]) }, /multiple ZIP central directories/); }
  caseFail('Z18', 'zip(runtime) concatenated after a benign zip (R4.1 protection intact)', { 'a.zip': Buffer.concat([OK_ZIP, MJS_ZIP]) }, /multiple ZIP central directories|unreferenced ZIP local file header/);
  casePass('Z19', 'benign zip comment and small extra fields', { 'a.zip': zip([{ name: 'ok.txt', data: OK, extra: Buffer.from([0x55, 0x54, 5, 0, 1, 0, 0, 0, 0]) }], { comment: Buffer.from('release build') }) });
  caseFail('Z20', 'zip(runtime) embedded in a local extra field', { 'a.zip': zip([{ name: 'ok.txt', data: OK, extra: Buffer.concat([Buffer.from([0x99, 0x99, 0, 0]), zip([{ name: 'a.js', data: MJS.subarray(0, 1500) }])]).subarray(0, 4096) }]) }, /unreferenced ZIP local file header|odml|Handland|multiple/i);
  if (hasTool('zip')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r42-'));
    try {
      fs.mkdirSync(path.join(d, 'src')); fs.writeFileSync(path.join(d, 'src/a.txt'), 'hello\n'.repeat(100));
      execFileSync('zip', ['-q', '-fd', path.join(d, 'fd.zip'), 'a.txt'], { cwd: path.join(d, 'src') });
      casePass('Z21', 'stock `zip -fd` (data descriptors) archive', { 'fd.zip': fs.readFileSync(path.join(d, 'fd.zip')) });
      if (hasTool('ditto')) { execFileSync('ditto', ['-c', '-k', path.join(d, 'src'), path.join(d, 'dit.zip')]); casePass('Z22', 'stock `ditto -c -k` (data descriptors) archive', { 'dit.zip': fs.readFileSync(path.join(d, 'dit.zip')) }); } else { notRun.push('Z22'); console.log('NOT RUN Z22 (ditto not available)'); }
    } finally { cleanup(d); }
  } else { notRun.push('Z21', 'Z22'); console.log('NOT RUN Z21/Z22 (zip not available)'); }
  if (hasTool('python3')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r42-'));
    try {
      const f = path.join(d, 'py.zip');
      execFileSync('python3', ['-I', '-c', [
        'import zipfile,io,sys',
        'class W(io.RawIOBase):',
        '  def __init__(s): s.b=bytearray()',
        '  def writable(s): return True',
        '  def write(s,x): s.b+=x; return len(x)',
        'w=W(); z=zipfile.ZipFile(w,"w",zipfile.ZIP_DEFLATED); z.writestr("a.txt","hello\\n"*50); z.close(); open(sys.argv[1],"wb").write(bytes(w.b))',
      ].join('\n'), f]);
      casePass('Z23', 'Python zipfile streaming output (descriptor with signature)', { 'py.zip': fs.readFileSync(f) });
    } finally { cleanup(d); }
  } else { notRun.push('Z23'); console.log('NOT RUN Z23 (python3 not available)'); }

  // ================================================================ N: nested archives (IV1-F3)
  const OK_ZIP_D2 = zip([{ name: 'l2.zip', data: OK_ZIP, method: 0 }]);
  casePass('N1', '[IV1-F3] ZIP storing (method 0) a benign ZIP', { 'a.zip': zip([{ name: 'inner.zip', data: OK_ZIP, method: 0 }]) });
  caseFail('N2', 'ZIP storing zip(runtime): inner archive inspected, not silently accepted', { 'a.zip': zip([{ name: 'inner.zip', data: MJS_ZIP, method: 0 }]) }, HIT);
  casePass('N3', 'ZIP deflating a benign ZIP', { 'a.zip': zip([{ name: 'inner.zip', data: OK_ZIP, method: 8 }]) });
  caseFail('N4', 'ZIP deflating zip(runtime)', { 'a.zip': zip([{ name: 'inner.zip', data: MJS_ZIP, method: 8 }]) }, HIT);
  casePass('N5', 'TAR containing a benign ZIP', { 'a.tar': tar([{ name: 'i.zip', data: OK_ZIP }]) });
  caseFail('N6', 'TAR containing zip(runtime)', { 'a.tar': tar([{ name: 'i.zip', data: MJS_ZIP }]) }, HIT);
  casePass('N7', 'gzip-compressed TAR containing a benign ZIP', { 'a.tgz': gz(tar([{ name: 'i.zip', data: OK_ZIP }])) });
  caseFail('N8', 'gzip-compressed TAR containing zip(runtime)', { 'a.tgz': gz(tar([{ name: 'i.zip', data: MJS_ZIP }])) }, HIT);
  casePass('N9', 'stored nesting at the depth limit (3 levels)', { 'a.zip': zip([{ name: 'l1.zip', data: OK_ZIP_D2, method: 0 }]) });
  caseFail('N10', 'stored nesting beyond the depth limit (4 levels)', { 'a.zip': zip([{ name: 'l0.zip', data: zip([{ name: 'l1.zip', data: OK_ZIP_D2, method: 0 }]), method: 0 }]) }, /nested archive beyond the depth limit/);
  casePass('N11', 'mixed nesting at the depth limit: tgz > zip(stored) > zip', { 'a.tgz': gz(tar([{ name: 'z.zip', data: OK_ZIP_D2 }])) });
  caseFail('N12', 'mixed nesting beyond the depth limit: tgz > zip > zip > zip', { 'a.tgz': gz(tar([{ name: 'z.zip', data: zip([{ name: 'l1.zip', data: OK_ZIP_D2, method: 0 }]) }])) }, /nested archive beyond the depth limit/);
  casePass('N13', 'two stored benign ZIPs in one ZIP (not mistaken for concatenation)', { 'a.zip': zip([{ name: 'a.zip', data: OK_ZIP, method: 0 }, { name: 'b.zip', data: zip([{ name: 'b.txt', data: OK }]), method: 0 }]) });
  caseFail('N14', 'stored entry that is itself zip+zip (inner concatenation still fails closed)', { 'a.zip': zip([{ name: 'i.zip', data: Buffer.concat([OK_ZIP, OK_ZIP]), method: 0 }]) }, /multiple ZIP central directories|unreferenced ZIP local file header/);
  { // Inner ZIP whose EOCD is inside the stored entry but whose central directory starts before it (spans the boundary).
    const inner = zipParts([{ name: 'x.txt', data: OK }]);
    const tailOnly = Buffer.concat([inner.cd, inner.eocd]);
    const outerP = zipParts([{ name: 'pre.bin', data: inner.locals, method: 0 }, { name: 'tail.bin', data: tailOnly, method: 0 }]);
    caseFail('N15', 'inner ZIP split across two stored entries (crosses an entry boundary)', { 'a.zip': outerP.buf }, /multiple ZIP central directories|unreferenced ZIP local file header|malformed/);
  }
  caseFail('N16', 'ZIP storing a benign ZIP followed by a concatenated zip(runtime)', { 'a.zip': Buffer.concat([zip([{ name: 'inner.zip', data: OK_ZIP, method: 0 }]), MJS_ZIP]) }, /multiple ZIP central directories|unreferenced ZIP local file header/);
  {
    const big = Buffer.alloc(3 * 1024 * 1024); let x = 12345; for (let i = 0; i < big.length; i++) { x = (x * 1103515245 + 12345) >>> 0; big[i] = 0x61 + ((x >>> 16) % 16); } // deterministic, moderately compressible
    const innerBig = zip([{ name: 'big.txt', data: big }]);
    const res = inspectWith({ 'a.zip': zip([{ name: 'inner.zip', data: innerBig, method: 0 }]) }, { maxArchiveDecompressedBytes: innerBig.length + 1024 * 1024 });
    check('N17. stored nested ZIP: inner expansion counts against the per-archive limit (size overflow fails closed)', res.errors.some((e: any) => /per-archive decompressed-bytes limit|entry-size limit/.test(e.error)), JSON.stringify(res.errors).slice(0, 200));
    const res2 = inspectWith({ 'a.zip': zip([{ name: 'inner.zip', data: innerBig, method: 0 }]) }, {});
    check('N18. ...and passes with the default limits', res2.errors.length === 0 && res2.hits.length === 0, JSON.stringify(res2.errors).slice(0, 200));
  }
  if (hasTool('zip')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r42-'));
    try {
      fs.mkdirSync(path.join(d, 'src')); fs.writeFileSync(path.join(d, 'src/a.txt'), 'hello\n'.repeat(100));
      execFileSync('zip', ['-q', path.join(d, 'inner.zip'), 'a.txt'], { cwd: path.join(d, 'src') });
      execFileSync('zip', ['-q', path.join(d, 'outer.zip'), 'inner.zip'], { cwd: d }); // Info-ZIP stores .zip members by default
      const o = fs.readFileSync(path.join(d, 'outer.zip'));
      check('N19a. stock `zip outer.zip inner.zip` stores the member (method 0)', o.readUInt16LE(8) === 0);
      casePass('N19', '[IV1-F3] stock Info-ZIP nested archive (stored member)', { 'outer.zip': o });
      fs.writeFileSync(path.join(d, 'src/a.js'), MJS);
      execFileSync('zip', ['-q', path.join(d, 'rt.zip'), 'a.js'], { cwd: path.join(d, 'src') });
      execFileSync('zip', ['-q', path.join(d, 'outer2.zip'), 'rt.zip'], { cwd: d });
      caseFail('N20', 'stock Info-ZIP nested archive whose inner zip holds the runtime', { 'outer2.zip': fs.readFileSync(path.join(d, 'outer2.zip')) }, HIT);
    } finally { cleanup(d); }
  } else { notRun.push('N19', 'N20'); console.log('NOT RUN N19/N20 (zip not available)'); }

  // ================================================================ M: bounded nested decompression (IV1-F3 memory evidence)
  {
    // Inner bomb: entry declares 0 bytes, deflate actually yields 300 MiB. The OUTER entry is stored, which R4.1
    // rejected before decompression ("multiple central directories"); R4.2 must reach the inner inflate and cap it.
    const bombData = zlib.deflateRawSync(Buffer.alloc(300 * 1024 * 1024), { level: 9 });
    const inner = zip([{ name: 'bomb.bin', data: Buffer.alloc(0), comp: bombData, usize: 0, crc: 0 }]);
    const outer = zip([{ name: 'inner.zip', data: inner, method: 0 }]);
    const r = await scanWithWatchdog('nested.zip', outer, 512);
    check('M1. stored-outer nested bomb reaches the INNER inflate and fails closed at its cap (not an early structural rejection)', !r.killed && r.code === 1 && /bomb\.bin/.test(r.out) && /size above declared|exceeds/.test(r.out) && !/multiple ZIP central directories/.test(r.out), `code=${r.code} killed=${r.killed} ${r.out.slice(0, 220)}`);
    check('M2. ...peak scanner RSS stays below 160 MiB', !r.killed && r.maxRssMiB < 160, `maxRSS=${r.maxRssMiB} MiB`);
    console.log(`INFO M1 maxRSS=${r.maxRssMiB} MiB`);
    const innerTrue = zip([{ name: 'bomb.bin', data: Buffer.alloc(0), comp: bombData, usize: 300 * 1024 * 1024, crc: 0 }]);
    const r2 = await scanWithWatchdog('nested2.zip', zip([{ name: 'inner.zip', data: innerTrue, method: 0 }]), 512);
    check('M3. stored-outer nested entry DECLARING 300 MiB fails closed before inflating (entry-size limit), bounded', !r2.killed && r2.code === 1 && /entry-size limit|compression-ratio/.test(r2.out) && r2.maxRssMiB < 160, `code=${r2.code} maxRSS=${r2.maxRssMiB} ${r2.out.slice(0, 200)}`);
    console.log(`INFO M3 maxRSS=${r2.maxRssMiB} MiB`);
    const fextraBomb = zip([{ name: 'g.bin', data: Buffer.alloc(0), comp: zlib.deflateRawSync(Buffer.alloc(50 * 1024 * 1024), { level: 9 }), usize: 0, crc: 0 }]);
    check('M4a. FEXTRA bomb fixture fits in one FEXTRA field', fextraBomb.length <= 65535, `len=${fextraBomb.length}`);
    const r3 = await scanWithWatchdog('gzfx.gz', gzipMember(OK, { extra: fextraBomb }), 512);
    check('M4. bomb carried in a gzip FEXTRA field reaches nested inflate and is capped, bounded', !r3.killed && r3.code === 1 && /size above declared|exceeds|decompressed-size limit/.test(r3.out) && r3.maxRssMiB < 160, `code=${r3.code} maxRSS=${r3.maxRssMiB} ${r3.out.slice(0, 200)}`);
    console.log(`INFO M4 maxRSS=${r3.maxRssMiB} MiB`);
  }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
