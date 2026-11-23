/**
 * AURA-PALM-G5-C13 -- regression tests for the C12 independent-review
 * findings on the bundle scanner (`apps/web/scripts/check-palmistry-bundle.js`):
 *
 *   C12-F1 (P1) xar with a header-size field below 28 (xar reads the TOC at 28)
 *   C12-F2 (P1) 7z with a major-version byte other than 0 (not CRC-covered)
 *   C12-F3 (P1) cab with unusual reserved2/reserved3, version, cabinet size
 *               or file-table offset (bsdtar extracts them)
 *   C12-F4 (P2) lz4 legacy frames (magic 02 21 4C 18; `lz4 -l`)
 *   C12-F5 (P2) zstd legacy frames (v0.1-v0.7 magics; the zstd CLI decodes v0.7)
 *   C12-F6 (P2) rar v4 whose first block after the marker is not the main header
 *   C12-F7 (P3) gzip: work-time budget not checked after the member loop
 *
 * All of these passed clean at 76cecd7 while a stock tool decoded them; they
 * must now FAIL CLOSED. Variants the stock tools themselves refuse, and
 * coincidental bytes, must still pass. Real-tool cases run only after a
 * precondition proves a stock reader extracts the content; missing tools are
 * NOT RUN, never a pass. Mutants revert each fix. Set
 * PALM_SCANNER_UNDER_TEST=<path> to run against another scanner copy (used to
 * show these tests fail on the pre-fix scanner; mutants then skip).
 *
 * Run: npx ts-node test/palmG5C13ForeignFormatVariants.test.ts
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
const TMP = 'palm-c13-';

let passed = 0, failed = 0;
const notRun: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); } };
const hasTool = (t: string) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0;
const cleanup = (d: string) => { if (path.basename(d).startsWith(TMP) && path.dirname(d) === os.tmpdir()) fs.rmSync(d, { recursive: true, force: true }); };

// ------------------------------------------------------------------ scanner harness (same layout as the D7 / C11 suites)
interface Run { exit: number | null; errors: string[]; hits: string[]; reason: string }
type LimitsFn = (base: Record<string, number>) => Record<string, number>;
function run(name: string, data: Buffer, scanner = SCANNER, limits: Record<string, number> | LimitsFn = {}): Run {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
  try {
    const web = path.join(tmp, 'apps/web');
    fs.mkdirSync(path.join(web, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
    fs.copyFileSync(scanner, path.join(web, 'scripts/check-palmistry-bundle.js'));
    fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
    fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), '{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}');
    fs.mkdirSync(path.join(web, '.next/static/chunks'), { recursive: true }); fs.writeFileSync(path.join(web, '.next/static/chunks/main.js'), 'console.log("app")');
    fs.mkdirSync(path.join(web, 'public'), { recursive: true }); fs.writeFileSync(path.join(web, 'public', name), data);
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
function mustFail(id: string, label: string, data: Buffer, fmt: RegExp, scanner = SCANNER): boolean {
  const r = run(`${id}.bin`, data, scanner);
  const m = FOREIGN.exec(r.reason);
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
/** Run a stock reader in a scratch dir; true when any output (stdout or extracted file) contains `needle`. */
function extracts(cmd: string, args: (f: string) => string[], data: Buffer, needle: Buffer, ext = '.bin'): boolean {
  const o = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
  try {
    const f = path.join(o, `in${ext}`); fs.writeFileSync(f, data); const x = path.join(o, 'x'); fs.mkdirSync(x);
    const r = spawnSync(cmd, args(f), { cwd: x, encoding: 'buffer', timeout: 60000 });
    if (r.stdout && r.stdout.includes(needle)) return true;
    const walk = (d: string): boolean => fs.readdirSync(d).some((n) => { const p = path.join(d, n); const st = fs.statSync(p); return st.isDirectory() ? walk(p) : fs.readFileSync(p).includes(needle); });
    return walk(x);
  } finally { cleanup(o); }
}

// ------------------------------------------------------------------ fixtures (benign, synthetic)
const crc = F.crc32;
const hex = (h: string) => Buffer.from(h.replace(/\s+/g, ''), 'hex');
const fill = (n: number, c = 0x2f) => Buffer.alloc(n, c);
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const code = (b: Buffer) => Buffer.concat([hex('cffaedfe 0c000001'), fill(256, 0x90), b, fill(256, 0xcc)]); // machine-code-like context
const textPayload = (lines: number) => { let x = 13, s = ''; const r = () => { x = (x * 1103515245 + 12345) >>> 0; return x; };
  for (let i = 0; i < lines; i++) { if (i % 8 === 0) s += `benign probe text: ${SENT}\n`; for (let j = 0; j < 10; j++) { let w = ''; for (let k = 3 + (r() % 6); k > 0; k--) w += String.fromCharCode(97 + (r() >>> 8) % 26); s += `${w} `; } s += '\n'; }
  return Buffer.from(s); };
const PAYLOAD = textPayload(120);
const BENIGN = Buffer.from('benign build asset text: nothing to see here\n'.repeat(3)); // for formats without an encoder (content stays plain)
const BODY = zlib.deflateRawSync(PAYLOAD);
const zipStored = (name: string, data: Buffer) => F.buildZip([{ name, data, method: 0 }]).buf;
function tar(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.fill(0x20, 148, 156); let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]);
}
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<xar><toc><creation-time>2026-11-22T00:00:00</creation-time></toc></xar>\n';
/** Hand-built xar head whose header-size FIELD says `hsize` while the TOC sits at offset 28. */
function xarSmall(hsize: number): Buffer {
  const toc = zlib.deflateSync(Buffer.from(XML));
  const h = Buffer.alloc(28); h.write('xar!', 0, 'latin1'); h.writeUInt16BE(hsize, 4); h.writeUInt16BE(1, 6);
  h.writeBigUInt64BE(BigInt(toc.length), 8); h.writeBigUInt64BE(BigInt(XML.length), 16); h.writeUInt32BE(1, 24);
  return Buffer.concat([h, toc, BODY]);
}
/** Hand-built 7z signature header with a valid start-header CRC and the given major/minor version. */
function sevenZHead(major: number, minor = 4, badCrc = false): Buffer {
  const sh = Buffer.concat([u32(0x20), u32(0), u32(0x40), u32(0), u32(0x12345678)]);
  return Buffer.concat([hex('377abcaf271c'), Buffer.from([major, minor]), u32(crc(sh) ^ (badCrc ? 1 : 0)), sh, BODY]);
}
/** MSZIP cabinet (content deflated, so hidden) with overridable header fields (independent construction). */
function cab(o: { r1?: number; r2?: number; r3?: number; vmin?: number; vmaj?: number; nfold?: number; nfiles?: number; cb?: number; coff?: number } = {}, content = PAYLOAD): Buffer {
  const data = Buffer.concat([Buffer.from('CK'), zlib.deflateRawSync(content)]);
  const name = Buffer.from('payload.txt\0');
  const cffile = Buffer.concat([u32(content.length), u32(0), u16(0), u16(0x5a21), u16(0x6000), u16(0x20), name]);
  const offFiles = 36 + 8, offData = offFiles + cffile.length;
  const cfdata = Buffer.concat([u32(0), u16(data.length), u16(content.length), data]);
  const total = offData + cfdata.length;
  const h = Buffer.alloc(36); h.write('MSCF', 0, 'latin1'); h.writeUInt32LE(o.r1 ?? 0, 4); h.writeUInt32LE((o.cb ?? total) >>> 0, 8); h.writeUInt32LE((o.r2 ?? 0) >>> 0, 12);
  h.writeUInt32LE(o.coff ?? offFiles, 16); h.writeUInt32LE((o.r3 ?? 0) >>> 0, 20); h[24] = o.vmin ?? 3; h[25] = o.vmaj ?? 1; h.writeUInt16LE(o.nfold ?? 1, 26); h.writeUInt16LE(o.nfiles ?? 1, 28);
  h.writeUInt16LE(0, 30); h.writeUInt16LE(0x1234, 32); h.writeUInt16LE(0, 34);
  const folder = Buffer.concat([u32(offData), u16(1), u16(1)]);
  return Buffer.concat([h, folder, cffile, cfdata]);
}
/** zstd v0.7 frame with raw blocks (as the zstd CLI's legacy decoder accepts): magic, FHD 0, window 0, raw block(s), end block. */
function zstdV07Raw(content: Buffer, versionByte = 0x27): Buffer {
  const n = content.length; return Buffer.concat([Buffer.from([versionByte, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x40 | (n >> 16), (n >> 8) & 0xff, n & 0xff]), content, hex('c00000')]);
}
/** rar v4 block: CRC16 (low half of CRC32 over type..end of header), type, flags, size, body. */
function rarBlock(type: number, flags: number, body: Buffer, crcOk = true): Buffer {
  const hdr = Buffer.concat([Buffer.from([type]), u16(flags), u16(7 + body.length), body]);
  return Buffer.concat([u16((crc(hdr) & 0xffff) ^ (crcOk ? 0 : 0xffff)), hdr]);
}
const RAR_MARK = Buffer.from('Rar!\x1a\x07\x00', 'latin1');
const rarMain = () => rarBlock(0x73, 0, Buffer.alloc(6));
function rarFile(content: Buffer): Buffer {
  const name = Buffer.from('payload.txt');
  const body = Buffer.concat([u32(content.length), u32(content.length), Buffer.from([3]), u32(crc(content)), u32(0x5a210000), Buffer.from([20, 0x30]), u16(name.length), u32(0x81a4), name]);
  return Buffer.concat([rarBlock(0x74, 0x8000, body), content]);
}
const RAR_END = rarBlock(0x7b, 0x4000, Buffer.alloc(0));
const gzMember = (data: Buffer) => zlib.gzipSync(data);

async function main(): Promise<void> {
  check('A0. payload carries the sentinel; the deflated body does not expose it', PAYLOAD.includes(SENT) && !BODY.includes(SENT) && !BENIGN.includes(SENT));

  // ================================================================ X: C12-F1 xar header size < 28
  for (const hs of [0, 4, 8, 20, 27]) mustFail(`X1.${hs}`, `[C12-F1] xar whose header-size field is ${hs} (TOC at 28)`, xarSmall(hs), /^xar$/);
  mustFail('X2', '[C12-F1] same (size 0), embedded in machine-code bytes', code(xarSmall(0)), /^xar$/);
  mustFail('X3', '[C12-F1] same (size 0), as a stored ZIP member', zipStored('p.pkg', xarSmall(0)), /^xar$/);
  mustFail('X4', '[C12-F1] same (size 0), inside a tar.gz', zlib.gzipSync(tar('p.pkg', xarSmall(0))), /^xar$/);
  if (hasTool('bsdtar') && hasTool('xar')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
    try {
      fs.writeFileSync(path.join(d, 'payload.txt'), PAYLOAD);
      const mk = spawnSync('bsdtar', ['--format', 'xar', '-cf', 'p.xar', 'payload.txt'], { cwd: d });
      const s = mk.status === 0 ? fs.readFileSync(path.join(d, 'p.xar')) : null;
      if (!s || s.readUInt16BE(4) !== 28) { notRun.push('XR'); console.log('NOT RUN XR (this bsdtar cannot write a 28-byte-header xar)'); }
      else for (const hs of [0, 20, 27]) {
        const v = Buffer.from(s); v.writeUInt16BE(hs, 4);
        check(`XR${hs}p. precondition: stock xar extracts the payload when the header-size field says ${hs}`, extracts('xar', (f) => ['-xf', f], v, Buffer.from(SENT)));
        mustFail(`XR${hs}`, `[C12-F1] real xar, header-size field ${hs}`, v, /^xar$/);
      }
    } finally { cleanup(d); }
  } else { notRun.push('XR'); console.log('NOT RUN XR (bsdtar and xar are both needed)'); }

  // ================================================================ S: C12-F2 7z major version
  for (const mj of [1, 2, 0x7f, 0xff]) mustFail(`S1.${mj}`, `[C12-F2] 7z signature header, major version ${mj}`, sevenZHead(mj), /^7z$/);
  mustFail('S2', '[C12-F2] 7z major version 1, as a stored ZIP member inside a tar.gz', zlib.gzipSync(tar('a.zip', zipStored('a.7z', sevenZHead(1)))), /^7z$/);
  // G5-C15 Tier A: a >= 6-byte binary magic alone fails closed (no header field is consulted) (7-Zip may recover a bad start header, C14-P3-1).
  mustFail('S3', '[C15 Tier A] 7z magic with a broken start-header CRC', code(sevenZHead(0, 4, true)), /^7z$/);
  if (hasTool('bsdtar')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
    try {
      fs.writeFileSync(path.join(d, 'payload.txt'), PAYLOAD);
      const mk = spawnSync('bsdtar', ['--format', '7zip', '-cf', 'p.7z', 'payload.txt'], { cwd: d });
      const s = mk.status === 0 ? fs.readFileSync(path.join(d, 'p.7z')) : null;
      if (!s) { notRun.push('SR'); console.log('NOT RUN SR (this bsdtar cannot write 7z)'); }
      else {
        check('SR0. real 7z does not expose the payload as plain bytes', !s.includes(SENT));
        for (const mj of [1, 0xff]) {
          const v = Buffer.from(s); v[6] = mj;
          check(`SR${mj}p. precondition: stock bsdtar extracts the payload of the real 7z with major version ${mj}`, extracts('bsdtar', (f) => ['-xOf', f], v, Buffer.from(SENT), '.7z'));
          mustFail(`SR${mj}`, `[C12-F2] real 7z, major version ${mj}`, v, /^7z$/);
          mustFail(`SR${mj}e`, `[C12-F2] same, embedded after 64 bytes`, Buffer.concat([fill(64), v]), /^7z$/);
        }
      }
    } finally { cleanup(d); }
  } else { notRun.push('SR'); console.log('NOT RUN SR (bsdtar not installed)'); }

  // ================================================================ C: C12-F3 cab header fields
  const CAB_VARIANTS: [string, Parameters<typeof cab>[0]][] = [
    ['reserved2 != 0', { r2: 0xdeadbeef }], ['reserved3 != 0', { r3: 0xdeadbeef }], ['version 1.0', { vmin: 0 }], ['version 1.4', { vmin: 4 }],
    ['version 2.3', { vmaj: 2 }], ['cabinet size 0', { cb: 0 }], ['cabinet size 43', { cb: 43 }], ['file offset >= cabinet size', { cb: 44, coff: 44 }],
  ];
  check('C0. hand-built MSZIP cabinet does not expose the payload as plain bytes', !cab().includes(SENT));
  mustFail('C1', 'standard MSZIP cabinet (control)', cab(), /^cab$/);
  for (const [i, [lbl, o]] of CAB_VARIANTS.entries()) {
    const v = cab(o);
    if (hasTool('bsdtar')) check(`C2.${i}p. precondition: stock bsdtar extracts the payload of the cabinet with ${lbl}`, extracts('bsdtar', (f) => ['-xOf', f], v, Buffer.from(SENT), '.cab'));
    mustFail(`C2.${i}`, `[C12-F3] cabinet with ${lbl}`, v, /^cab$/);
  }
  if (!hasTool('bsdtar')) { notRun.push('C2p'); console.log('NOT RUN C2.*p (bsdtar not installed)'); }
  mustFail('C3', '[C12-F3] cabinet with reserved2 != 0, as a stored ZIP member', zipStored('a.cab', cab({ r2: 1 })), /^cab$/);
  for (const [i, [lbl, o]] of ([['reserved1 != 0', { r1: 1 }], ['no folders', { nfold: 0 }], ['no files', { nfiles: 0 }]] as [string, Parameters<typeof cab>[0]][]).entries()) {
    const v = code(cab(o));
    if (hasTool('bsdtar')) check(`C4.${i}p. precondition: stock bsdtar does NOT extract the cabinet with ${lbl}`, !extracts('bsdtar', (f) => ['-xOf', f], cab(o), Buffer.from(SENT), '.cab'));
    // G5-C15 (C14-P3-1): cabextract ignores reserved1, so that cabinet now fails closed; zero folders / files still pass (both readers refuse).
    if (i === 0) mustFail(`C4.${i}`, `[C15] cabinet with ${lbl} (cabextract accepts it), in machine-code bytes`, v, /^cab$/);
    else mustPass(`C4.${i}`, `cabinet with ${lbl} (bsdtar and cabextract refuse it), in machine-code bytes`, v);
  }

  // ================================================================ L: C12-F4 lz4 legacy
  mustFail('L1', '[C12-F4] lz4 legacy head (block size 128)', Buffer.concat([hex('02214c18'), u32(128), BODY]), /^lz4 \(legacy\)$/);
  mustPass('L2', 'lz4 legacy magic with block size 0 (no block)', code(Buffer.concat([hex('02214c18'), u32(0), fill(16, 0x41)])));
  mustPass('L3', 'lz4 legacy magic with a block size above LZ4_compressBound(8 MiB)', code(Buffer.concat([hex('02214c18'), u32(0x7fffffff), fill(16, 0x41)])));
  if (hasTool('lz4')) {
    // lz4 keeps first occurrences as literal bytes, so the sentinel is assembled from earlier fragments (LZ matches hide it).
    const LZ_HIDE = Buffer.from(`header text 0123456789 g5-i1QQQQ some filler text -devRRRR more filler ${SENT} and a long trailing tail of filler text that is not special at all.\n`);
    const l = spawnSync('lz4', ['-l', '-c'], { input: LZ_HIDE }).stdout as Buffer;
    if (l && l.length > 8 && !l.includes(SENT)) check('LR0. real lz4 legacy output does not expose the payload as plain bytes', true);
    else { notRun.push('LR0'); console.log('NOT RUN LR0 (this lz4 version leaves the sentinel as literal bytes; detection below still runs)'); }
    check('LR1p. precondition: stock lz4 -dc decodes the payload of the legacy frame', (spawnSync('lz4', ['-d', '-c'], { input: l }).stdout as Buffer).includes(SENT));
    mustFail('LR1', '[C12-F4] real lz4 legacy frame', l, /^lz4 \(legacy\)$/);
    mustFail('LR1e', '[C12-F4] same, embedded after 64 bytes', Buffer.concat([fill(64), l]), /^lz4 \(legacy\)$/);
    mustFail('LR1g', '[C12-F4] same, as member 2 of a multi-member gzip', Buffer.concat([gzMember(Buffer.from('benign\n')), gzMember(l)]), /^lz4 \(legacy\)$/);
  } else { notRun.push('LR'); console.log('NOT RUN LR (lz4 not installed)'); }

  // ================================================================ Z: C12-F5 zstd legacy
  for (const [v, b] of [[1, 0x1e], [2, 0x22], [3, 0x23], [4, 0x24], [5, 0x25], [6, 0x26], [7, 0x27]] as [number, number][])
    mustFail(`Z1.${v}`, `[C12-F5] zstd legacy v0.${v} magic`, zstdV07Raw(BENIGN, b), new RegExp(`^zstd \\(legacy v0\\.${v}\\)$`));
  mustFail('Z2', '[C12-F5] zstd legacy v0.7 frame, as a tar member', tar('a.zst', zstdV07Raw(BENIGN)), /^zstd \(legacy v0\.7\)$/);
  if (hasTool('zstd')) {
    const out = spawnSync('zstd', ['-d', '-c'], { input: zstdV07Raw(BENIGN) }).stdout as Buffer;
    if (out && out.equals(BENIGN)) check('ZR1p. precondition: stock zstd -dc decodes the hand-built v0.7 legacy frame', true);
    else { notRun.push('ZR1p'); console.log('NOT RUN ZR1p (this zstd build has no v0.7 legacy decoder)'); }
  } else { notRun.push('ZR1p'); console.log('NOT RUN ZR1p (zstd not installed)'); }

  // ================================================================ R: C12-F6 rar v4 block order
  const nomain = Buffer.concat([RAR_MARK, rarFile(BENIGN), RAR_END]);
  const commentFirst = Buffer.concat([RAR_MARK, rarBlock(0x75, 0, Buffer.alloc(6)), rarMain(), rarFile(BENIGN), RAR_END]);
  mustFail('R1', 'rar v4 with the main header first (control)', Buffer.concat([RAR_MARK, rarMain(), rarFile(BENIGN), RAR_END]), /^rar$/);
  mustFail('R2', '[C12-F6] rar v4 with no main header (file header first)', nomain, /^rar$/);
  mustFail('R3', '[C12-F6] rar v4 with a comment block before the main header', commentFirst, /^rar$/);
  mustFail('R4', '[C12-F6] rar v4 with no main header, embedded in machine-code bytes', code(nomain), /^rar$/);
  // G5-C15 Tier A: a >= 6-byte binary magic alone fails closed (no header field is consulted).
  mustFail('R5', '[C15 Tier A] rar v4 marker followed by a block with a broken CRC', code(Buffer.concat([RAR_MARK, rarBlock(0x74, 0, Buffer.alloc(30), false)])), /^rar$/);
  if (hasTool('bsdtar')) {
    check('RR2p. precondition: stock bsdtar extracts the content of the no-main-header rar', extracts('bsdtar', (f) => ['-xOf', f], nomain, BENIGN.subarray(0, 24), '.rar'));
    check('RR3p. precondition: stock bsdtar extracts the content of the comment-first rar', extracts('bsdtar', (f) => ['-xOf', f], commentFirst, BENIGN.subarray(0, 24), '.rar'));
  } else { notRun.push('RRp'); console.log('NOT RUN RR*p (bsdtar not installed)'); }

  // ================================================================ G: C12-F7 gzip budget after the member loop
  // The budget expires on the k-th work-time check made after gunzip starts (it reads maxGzipMembers first).
  const expireAt = (k: number): LimitsFn => (base) => { let armed = false, n = 0; return new Proxy({ ...base }, { get(t: any, key) {
    if (key === 'maxGzipMembers') armed = true;
    if (key === 'maxScanMs' && armed && ++n >= k) return -1; return t[key]; } }); };
  const three = Buffer.concat([gzMember(Buffer.from('one\n')), gzMember(Buffer.from(`two ${SENT}\n`)), gzMember(Buffer.from('three\n'))]);
  { const r = run('G1.gz', three, SCANNER, expireAt(4));
    check('G1. [C12-F7] budget expiring after the last member fails closed before the members are joined', r.errors.some((e) => /exceeded after decompressing gzip stream/.test(e)), JSON.stringify(r.errors)); }
  { const r = run('G2.gz', three, SCANNER, expireAt(5));
    check('G2. [C12-F7] budget expiring after gunzip stops the scan before the decompressed stream is inspected (blocking error, no inspection)', r.errors.some((e) => /work-time budget/.test(e)) && !r.hits.some((h) => h.includes(SENT)), JSON.stringify(r)); }
  { const r = run('G3.gz', three, SCANNER, expireAt(1));
    check('G3. the in-loop check (C11) still fires first when the budget expires at the first member', r.errors.some((e) => /exceeded while decompressing gzip stream/.test(e)), JSON.stringify(r.errors)); }
  { const r = run('G4.gz', three);
    check('G4. without a budget problem the sentinel in member 2 is still found', r.exit === 1 && r.hits.some((h) => h.includes(SENT)) && r.errors.length === 0, JSON.stringify(r)); }
  { const mod = (() => { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP)); try { fs.mkdirSync(path.join(tmp, 'apps/web/scripts'), { recursive: true }); const sp = path.join(tmp, 'apps/web/scripts/check-palmistry-bundle.js');
      fs.copyFileSync(SCANNER, sp); fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(tmp, 'apps/web/palmistry-build-exclusion.js')); const m = require(sp); delete require.cache[require.resolve(sp)]; return m; } finally { cleanup(tmp); } })();
    const L = mod.INSPECTION_LIMITS;
    const expected = { maxFileBytes: 256 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 * 1024, maxFiles: 250000, maxDepth: 64, maxArchiveBytes: 64 * 1024 * 1024, maxArchiveEntryBytes: 64 * 1024 * 1024, maxArchiveDecompressedBytes: 256 * 1024 * 1024, maxTotalDecompressedBytes: 1024 * 1024 * 1024, maxCompressionRatio: 200, maxArchiveEntries: 10000, maxGzipMembers: 10000, maxNestedArchiveDepth: 3, maxScanMs: 600000 };
    check('G5. every inspection limit is unchanged (size, nesting, member count, time)', Object.entries(expected).every(([k, v]) => L[k] === v) && Object.keys(L).length === Object.keys(expected).length + 1, JSON.stringify(L)); }

  // ================================================================ P: coincidental bytes (no false positives from the new rules)
  mustPass('P1', '"MSCF" in JS text', Buffer.from('// MSCF is the cabinet magic\nexport const CAB = "MSCF";\nconst x = "MSCF header";\n'.repeat(8)));
  mustPass('P2', '"Rar!" in JS text', Buffer.from('export const RAR = "Rar!\\x1a\\x07\\x00";\n// Rar! archives\n'.repeat(8)));
  mustPass('P3', '"xar!" in JS text', Buffer.from('export const XAR = "xar!";\n// xar! archives\n'.repeat(8)));
  mustPass('P4', '64 KiB of pseudo-random binary data', Buffer.from(Array.from({ length: 65536 }, (_, i) => (i * 2246822519 >>> 11) & 0xff)));
  mustPass('P5', 'a benign tar.gz and a benign ZIP still pass', Buffer.concat([zlib.gzipSync(tar('a.txt', BENIGN))]));

  // ================================================================ M: mutants (each fix reverted -> the suite observes it)
  if (!process.env.PALM_SCANNER_UNDER_TEST) {
    const src = fs.readFileSync(SCANNER, 'utf8');
    const mutants: { id: string; label: string; from: string; to: string; probe: (m: string) => boolean }[] = [
      { id: 'M1', label: 'xar size rule back to 28..4096 (C12-F1 reverted)', from: 'if (hsize <= 4096) return true;', to: 'if (hsize >= 28 && hsize <= 4096) return true;', probe: (m) => mustPass('M1p', '', xarSmall(0), m) },
      { id: 'M2', label: '7z major-version check reinstated (C12-F2 reverted)', from: 'function valid7zAt() {\n  return true;', to: 'function valid7zAt(buf, p) {\n  return buf[p + 6] === 0;', probe: (m) => mustPass('M2p', '', sevenZHead(1), m) && !mustPass('M2q', '', sevenZHead(0), m) },
      { id: 'M3', label: 'cab reserved2 check reinstated (C12-F3 reverted)', from: 'if (buf.readUInt32LE(p + 4) === 0) return true; // bsdtar', to: 'if (buf.readUInt32LE(p + 12) !== 0) return false;\n  if (buf.readUInt32LE(p + 4) === 0) return true; // bsdtar', probe: (m) => mustPass('M3p', '', cab({ r2: 1 }), m) && !mustPass('M3q', '', cab(), m) },
      { id: 'M4', label: 'lz4 legacy detection removed (C12-F4 reverted)', from: 'function validLz4LegacyAt(buf, p) {', to: 'function validLz4LegacyAt(buf, p) { return false;', probe: (m) => mustPass('M4p', '', Buffer.concat([hex('02214c18'), u32(128), BODY]), m) },
      { id: 'M5', label: 'zstd legacy detection removed (C12-F5 reverted)', from: 'function validZstdLegacyAt(buf, p) {', to: 'function validZstdLegacyAt(buf, p) { return false;', probe: (m) => mustPass('M5p', '', zstdV07Raw(BENIGN), m) },
      { id: 'M6', label: 'rar v4 main-header requirement reinstated (C12-F6 reverted)', from: 'function validRarAt() {\n  return true;', to: 'function validRarAt(buf, p) {\n  return buf[p + 9] === 0x73;', probe: (m) => mustPass('M6p', '', nomain, m) && !mustPass('M6q', '', Buffer.concat([RAR_MARK, rarMain(), rarFile(BENIGN), RAR_END]), m) },
      { id: 'M7', label: 'gzip post-loop budget check removed (C12-F7 reverted)', from: 'if (overTime()) throw new ArchiveError(`work-time budget (${limits.maxScanMs} ms) exceeded after decompressing', to: 'if (false) throw new ArchiveError(`work-time budget (${limits.maxScanMs} ms) exceeded after decompressing',
        probe: (m) => !run('M7p.gz', three, m, expireAt(4)).errors.some((e) => /after decompressing gzip stream/.test(e)) },
      { id: 'M8', label: 'pre-inspection budget check removed (C12-F7 reverted)', from: 'if (overTime()) return; // G5-C13 (C12-F7)', to: '// removed (C12-F7)',
        probe: (m) => run('M8p.gz', three, m, expireAt(5)).hits.some((h) => h.includes(SENT)) },
    ];
    for (const mt of mutants) {
      if (src.split(mt.from).length !== 2) { check(`${mt.id}. mutant anchor present exactly once (${mt.label})`, false, 'scanner source changed; update the mutant'); continue; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
      try { const mut = path.join(d, 'check-palmistry-bundle.js'); fs.writeFileSync(mut, src.replace(mt.from, mt.to));
        check(`${mt.id}. negative control: with ${mt.label}, the suite observes the regression`, mt.probe(mut)); } finally { cleanup(d); }
    }
  } else { notRun.push('M1-M8'); console.log('NOT RUN M1-M8 (PALM_SCANNER_UNDER_TEST set)'); }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
