/**
 * AURA-PALM-G5-C11 -- regression tests for the four C10 scanner findings
 * (`apps/web/scripts/check-palmistry-bundle.js`):
 *
 *   C10-F1 (P1) xar:   unusual header variants (version 2, a zero or > 2^31
 *                      uncompressed TOC length, a TOC beginning with a comment,
 *                      BOM, DOCTYPE or processing instruction) passed clean.
 *   C10-F2 (P1) xz:    check IDs outside {0, 1, 4, 10} passed clean, while xz
 *                      decodes them (with a warning).
 *   C10-F3 (P1) bzip2: a randomised block passed clean, while bzip2 decodes it.
 *   C10-F4 (P2) gzip:  no member-count limit and no work-time check inside the
 *                      member loop (1 M empty members: 5 s, 0.5 GB, clean pass).
 *
 * Every variant must now FAIL CLOSED. Coincidental bytes must still pass:
 * "xar!" in text, a "BZh91AY&SY" constant, an xz magic with a bad header CRC,
 * pseudo-random binary data. Supported archives (zip, tar, gzip incl.
 * multi-member) must still be inspected, and prohibited content in them found.
 *
 * Fixtures are synthetic and benign (payload: text carrying "g5-i1-dev").
 * Hand-built headers always run; real-tool variants run where xz / bzip2 /
 * bsdtar / xar are installed, and only after a precondition proves a stock
 * reader really extracts the payload. Missing tools are NOT RUN, never pass.
 * Mutants revert each fix and prove the suite observes the regression.
 * Set PALM_SCANNER_UNDER_TEST=<path> to run against another scanner copy
 * (used to show these tests fail on the pre-fix scanner; mutants then skip).
 *
 * Run: npx ts-node test/palmG5C11ForeignFormatFailOpen.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import * as F from './palmG5I1R43Fixtures';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const SCANNER = process.env.PALM_SCANNER_UNDER_TEST || path.join(WEB, 'scripts/check-palmistry-bundle.js');
const SENT = 'g5-i1-dev';
const FOREIGN = /unsupported archive or compressed stream \(([^)]+\)?)\)/;
const TMP = 'palm-c11-';

let passed = 0, failed = 0;
const notRun: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); } };
const hasTool = (t: string) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0;
const cleanup = (d: string) => { if (path.basename(d).startsWith(TMP) && path.dirname(d) === os.tmpdir()) fs.rmSync(d, { recursive: true, force: true }); };

// ------------------------------------------------------------------ scanner harness (same layout as the D7 suite)
interface Run { exit: number | null; errors: string[]; hits: string[]; reason: string; ms: number }
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
    const t0 = Date.now();
    const api = mod.inspectArtifacts(web, lim);
    const ms = Date.now() - t0;
    delete require.cache[require.resolve(sp)];
    const errors: string[] = api.errors.map((e: any) => e.error);
    const hits: string[] = [...new Set<string>(api.hits.map((h: any) => h.sentinel))];
    return { exit: cli ? cli.status : (errors.length || hits.length ? 1 : 0), errors, hits, reason: errors[0] || hits[0] || '', ms };
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
function mustHit(id: string, label: string, data: Buffer): void {
  const r = run(`${id}.bin`, data);
  check(`${id}. ${label} -> sentinel found`, r.exit === 1 && r.hits.some((h) => h.includes(SENT)), `exit=${r.exit} hits=${JSON.stringify(r.hits)} errors=${JSON.stringify(r.errors).slice(0, 160)}`);
}

// ------------------------------------------------------------------ fixtures (benign)
const crc = F.crc32;
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const hex = (h: string) => Buffer.from(h.replace(/\s+/g, ''), 'hex');
const fill = (n: number, c = 0x2f) => Buffer.alloc(n, c);
const code = (b: Buffer) => Buffer.concat([hex('cffaedfe 0c000001'), fill(256, 0x90), b, fill(256, 0xcc)]); // machine-code-like context
/** Deterministic high-entropy text carrying the sentinel (entropy coders never leave it as raw bytes). */
const textPayload = (lines: number) => { let x = 11, s = ''; const r = () => { x = (x * 1103515245 + 12345) >>> 0; return x; };
  for (let i = 0; i < lines; i++) { if (i % 8 === 0) s += `benign probe text: ${SENT}\n`; for (let j = 0; j < 10; j++) { let w = ''; for (let k = 3 + (r() % 6); k > 0; k--) w += String.fromCharCode(97 + (r() >>> 8) % 26); s += `${w} `; } s += '\n'; }
  return Buffer.from(s); };
const PAYLOAD = textPayload(200);
const SHORT = Buffer.from(`benign probe text: ${SENT}\nalpha bravo charlie delta echo foxtrot\n`); // < 618 bytes: a randomised bzip2 block decodes intact
const BODY = zlib.deflateRawSync(PAYLOAD);
const zipStored = (name: string, data: Buffer) => F.buildZip([{ name, data, method: 0 }]).buf;
const zipDeflated = (name: string, data: Buffer) => F.buildZip([{ name, data, method: 8 }]).buf;
function tar(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.fill(0x20, 148, 156); let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]);
}
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<xar><toc><creation-time>2026-11-22T00:00:00</creation-time></toc></xar>\n';
/** Hand-built xar head (big-endian) + zlib TOC; `o` overrides fields for the C10-F1 variants. */
function xarHead(o: { hsize?: number; ver?: number; tocC?: bigint; tocU?: bigint; toc?: Buffer; xml?: string } = {}): Buffer {
  const toc = o.toc ?? zlib.deflateSync(Buffer.from(o.xml ?? XML));
  const h = Buffer.alloc(28); h.write('xar!', 0, 'latin1'); h.writeUInt16BE(o.hsize ?? 28, 4); h.writeUInt16BE(o.ver ?? 1, 6);
  h.writeBigUInt64BE(o.tocC ?? BigInt(toc.length), 8); h.writeBigUInt64BE(o.tocU ?? 1024n, 16); h.writeUInt32BE(1, 24);
  return Buffer.concat([h, toc, BODY]);
}
const TOC_PREFIXES: [string, (x: string) => string][] = [
  ['leading XML comment', (x) => `<!-- c -->\n${x.replace(/^<\?xml[^>]*>\n?/, '')}`],
  ['UTF-8 BOM', (x) => `﻿${x}`],
  ['DOCTYPE first', (x) => `<!DOCTYPE xar>\n${x.replace(/^<\?xml[^>]*>\n?/, '')}`],
  ['processing instruction first', (x) => `<?foo bar?>\n${x.replace(/^<\?xml[^>]*>\n?/, '')}`],
];
/** Rebuild a real xar with new header fields and/or TOC XML; refreshes tocC/tocU and the SHA-1 TOC checksum in the heap. */
function rebuildXar(b: Buffer, o: { ver?: number; tocU?: bigint; tocXml?: (x: string) => string } = {}): Buffer {
  const hs = b.readUInt16BE(4), tocC = Number(b.readBigUInt64BE(8)), alg = b.readUInt32BE(24);
  const xml = zlib.inflateSync(b.subarray(hs, hs + tocC)).toString('utf8');
  const nx = o.tocXml ? o.tocXml(xml) : xml; const tz = o.tocXml ? zlib.deflateSync(Buffer.from(nx, 'utf8')) : Buffer.from(b.subarray(hs, hs + tocC));
  const h = Buffer.from(b.subarray(0, hs)); h.writeBigUInt64BE(BigInt(tz.length), 8); h.writeBigUInt64BE(o.tocU ?? BigInt(Buffer.byteLength(nx)), 16);
  if (o.ver !== undefined) h.writeUInt16BE(o.ver, 6);
  const heap = Buffer.from(b.subarray(hs + tocC)); if (alg === 1) crypto.createHash('sha1').update(tz).digest().copy(heap, 0);
  return Buffer.concat([h, tz, heap]);
}
/** xz stream header with an arbitrary stream-flags pair and a matching (or broken) CRC. */
const xzHead = (f0: number, f1: number, badCrc = false) => { const fl = Buffer.from([f0, f1]); return Buffer.concat([hex('fd377a585a00'), fl, u32le(crc(fl) ^ (badCrc ? 1 : 0)), BODY]); };
/** Change the check ID of a real xz stream (header and footer flags, both CRCs). Same check-field size required. */
function xzWithCheck(b: Buffer, id: number): Buffer {
  const x = Buffer.from(b); x[7] = id; x.writeUInt32LE(crc(x.subarray(6, 8)), 8);
  const f = x.length - 12; x[f + 9] = id; x.writeUInt32LE(crc(x.subarray(f + 4, f + 10)), f);
  return x;
}
/** bzip2 head: "BZh" + level + block magic + block CRC + randomised bit + origin pointer (24 bits). */
const bzHead = (level: string, randomised: boolean, origPtr = 2) => {
  const b = Buffer.concat([Buffer.from(`BZh${level}`, 'latin1'), hex('314159265359 0a0b0c0d'), Buffer.alloc(4)]);
  const v = ((randomised ? 1 : 0) << 31) | ((origPtr & 0xffffff) << 7); b.writeUInt32BE(v >>> 0, 14);
  return Buffer.concat([b, BODY]);
};
const gzMember = (data: Buffer, extra?: Buffer) => (extra ? F.gzipWithExtra(data, extra) : zlib.gzipSync(data));
const gzEmptyMembers = (n: number) => { const m = zlib.gzipSync(Buffer.alloc(0)); return Buffer.concat(Array.from({ length: n }, () => m)); };

async function main(): Promise<void> {
  check('A0. payloads carry the sentinel; the deflated body does not expose it', PAYLOAD.includes(SENT) && SHORT.includes(SENT) && !BODY.includes(SENT));

  // ================================================================ X: C10-F1 xar
  mustFail('X1', '[C10-F1] hand-built xar, header version 2', xarHead({ ver: 2 }), /^xar$/);
  mustFail('X2', '[C10-F1] hand-built xar, uncompressed TOC length 0', xarHead({ tocU: 0n }), /^xar$/);
  mustFail('X3', '[C10-F1] hand-built xar, uncompressed TOC length 0x80000000', xarHead({ tocU: 0x80000000n }), /^xar$/);
  mustFail('X4', '[C10-F1] hand-built xar, compressed TOC length 0', xarHead({ tocC: 0n }), /^xar$/);
  for (const [i, [lbl, fn]] of TOC_PREFIXES.entries()) {
    mustFail(`X5.${i}`, `[C10-F1] hand-built xar, TOC with a ${lbl}`, xarHead({ xml: fn(XML) }), /^xar$/);
    mustFail(`X5e.${i}`, `[C10-F1] same, embedded in machine-code bytes`, code(xarHead({ xml: fn(XML) })), /^xar$/);
  }
  mustFail('X6', '[C10-F1] hand-built xar, version 2 + TOC that is not zlib (binary header size alone)', xarHead({ ver: 2, toc: fill(64, 0xff) }), /^xar$/);
  { const far = (toc: Buffer, hsize: number) => { const h = xarHead({ hsize, toc: Buffer.alloc(0) }).subarray(0, 28); return Buffer.concat([h, Buffer.alloc(hsize - 28), toc, BODY]); };
    mustFail('X7', 'xar declaring a header size of 5000 with a zlib TOC at that position (rule b)', far(zlib.deflateSync(Buffer.from(XML)), 5000), /^xar$/);
    mustPass('X8', 'xar magic with a header size of 5000 and no zlib stream there (nothing a reader could open)', code(far(fill(64, 0xff), 5000))); }
  mustFail('X9', '[C10-F1] version-2 xar as a stored ZIP member', zipStored('p.pkg', xarHead({ ver: 2 })), /^xar$/);
  mustFail('X10', '[C10-F1] BOM-TOC xar as a tar member', tar('p.pkg', xarHead({ xml: TOC_PREFIXES[1][1](XML) })), /^xar$/);
  // Real xar archives (bsdtar --format xar), mutated as in the C10 review; precondition: a stock reader extracts the payload.
  if (hasTool('bsdtar')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
    try {
      fs.writeFileSync(path.join(d, 'payload.txt'), PAYLOAD);
      const mk = spawnSync('bsdtar', ['--format', 'xar', '-cf', 'p.xar', 'payload.txt'], { cwd: d, encoding: 'utf8' });
      const s = mk.status === 0 && fs.existsSync(path.join(d, 'p.xar')) ? fs.readFileSync(path.join(d, 'p.xar')) : null;
      if (!s) { notRun.push('XR'); console.log(`NOT RUN XR (this bsdtar cannot write xar: ${(mk.stderr || '').trim().slice(0, 80)})`); }
      else {
        const extracts = (data: Buffer) => { const o = fs.mkdtempSync(path.join(os.tmpdir(), TMP)); try {
          const f = path.join(o, 'in.xar'); fs.writeFileSync(f, data); const x = path.join(o, 'x'); fs.mkdirSync(x);
          const readers: string[] = [];
          if (spawnSync('bsdtar', ['-xOf', f], { encoding: 'buffer' }).stdout?.includes(SENT)) readers.push('bsdtar');
          if (hasTool('xar')) { spawnSync('xar', ['-xf', f, '-C', x]); if (fs.readdirSync(x).some((n) => fs.statSync(path.join(x, n)).isFile() && fs.readFileSync(path.join(x, n)).includes(SENT))) readers.push('xar'); }
          return readers; } finally { cleanup(o); } };
        const variants: [string, Buffer][] = [
          ['version 2', rebuildXar(s, { ver: 2 })], ['tocU 0', rebuildXar(s, { tocU: 0n })], ['tocU 0x80000000', rebuildXar(s, { tocU: 0x80000000n })],
          ...TOC_PREFIXES.map(([l, fn]) => [`TOC with a ${l}`, rebuildXar(s, { tocXml: fn })] as [string, Buffer]),
        ];
        check('XR0. real xar does not expose the payload as plain bytes', !s.includes(SENT) && variants.every(([, v]) => !v.includes(SENT)));
        for (const [i, [lbl, v]] of variants.entries()) {
          const rd = extracts(v);
          if (rd.length) check(`XR${i + 1}p. precondition: stock ${rd.join('+')} extracts the payload of the real xar (${lbl})`, true);
          else { notRun.push(`XR${i + 1}p`); console.log(`NOT RUN XR${i + 1}p (no installed reader extracts the ${lbl} variant)`); }
          mustFail(`XR${i + 1}`, `[C10-F1] real xar, ${lbl}`, v, /^xar$/);
          mustFail(`XR${i + 1}e`, `[C10-F1] real xar, ${lbl}, embedded after 64 bytes`, Buffer.concat([fill(64), v]), /^xar$/);
        }
      }
    } finally { cleanup(d); }
  } else { notRun.push('XR'); console.log('NOT RUN XR (bsdtar not installed)'); }

  // ================================================================ Z: C10-F2 xz
  for (let id = 0; id <= 15; id++) mustFail(`Z1.${id}`, `[C10-F2] xz stream header with check ID ${id}`, xzHead(0, id), /^xz$/);
  mustFail('Z2', '[C10-F2] xz stream header with reserved flag bits set (unsupported variant)', xzHead(0x01, 0xf1), /^xz$/);
  mustFail('Z3', '[C10-F2] xz check ID 5, embedded in machine-code bytes', code(xzHead(0, 5)), /^xz$/);
  mustFail('Z4', '[C10-F2] xz check ID 6, as a deflated ZIP member', zipDeflated('d.xz', xzHead(0, 6)), /^xz$/);
  if (hasTool('xz')) {
    const mk = (c: string) => spawnSync('xz', ['-z', '-c', '-C', c], { input: PAYLOAD }).stdout as Buffer;
    const c32 = mk('crc32'), c64 = mk('crc64');
    const reals: [number, Buffer][] = [[2, xzWithCheck(c32, 2)], [3, xzWithCheck(c32, 3)], [5, xzWithCheck(c64, 5)], [6, xzWithCheck(c64, 6)]];
    check('ZR0. real xz streams do not expose the payload as plain bytes', reals.every(([, b]) => !b.includes(SENT)));
    for (const [id, b] of reals) {
      const out = spawnSync('xz', ['-d', '-c'], { input: b }).stdout as Buffer;
      check(`ZR${id}p. precondition: stock xz -dc outputs the payload of the real stream with check ID ${id}`, !!out && out.includes(SENT));
      mustFail(`ZR${id}`, `[C10-F2] real xz stream, check ID ${id}`, b, /^xz$/);
      mustFail(`ZR${id}e`, `[C10-F2] same, embedded after 64 bytes`, Buffer.concat([fill(64), b]), /^xz$/);
    }
  } else { notRun.push('ZR'); console.log('NOT RUN ZR (xz not installed)'); }

  // ================================================================ B: C10-F3 bzip2
  mustFail('B1', '[C10-F3] bzip2 head with the randomised bit set', bzHead('9', true), /^bzip2$/);
  mustFail('B2', '[C10-F3] randomised bzip2, embedded in machine-code bytes', code(bzHead('9', true)), /^bzip2$/);
  mustFail('B3', '[C10-F3] randomised bzip2 as a stored ZIP member', zipStored('r.bz2', bzHead('1', true)), /^bzip2$/);
  mustFail('B4', 'bzip2 head with an out-of-range level digit (unsupported variant, bounded as level 9)', bzHead('0', false), /^bzip2$/);
  mustFail('B5', 'bzip2 head with a level digit lower than the encoder used (small block; bzip2 decodes it)', bzHead('1', false, 400), /^bzip2$/);
  mustPass('B6', 'bzip2 head whose origin pointer lies outside the declared level-1 block (bzip2 refuses it: BZ_DATA_ERROR)', code(bzHead('1', false, 150000)));
  if (hasTool('bzip2')) {
    const b = spawnSync('bzip2', ['-c'], { input: SHORT }).stdout as Buffer;
    const r = Buffer.from(b); r[14] |= 0x80;
    const out = spawnSync('bzip2', ['-d', '-c'], { input: r });
    check('BR0. real bzip2 stream does not expose the payload as plain bytes', !b.includes(SENT) && !r.includes(SENT));
    check('BR1p. precondition: stock bzip2 -dc extracts the payload of the randomised stream (exit 0)', out.status === 0 && (out.stdout as Buffer).includes(SENT), `status=${out.status}`);
    mustFail('BR1', '[C10-F3] real randomised bzip2 stream', r, /^bzip2$/);
    mustFail('BR1e', '[C10-F3] same, embedded after 64 bytes', Buffer.concat([fill(64), r]), /^bzip2$/);
  } else { notRun.push('BR'); console.log('NOT RUN BR (bzip2 not installed)'); }

  // ================================================================ G: C10-F4 gzip members and time budget
  { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP)); let L: any;
    try { fs.mkdirSync(path.join(tmp, 'apps/web/scripts'), { recursive: true }); const sp = path.join(tmp, 'apps/web/scripts/check-palmistry-bundle.js');
      fs.copyFileSync(SCANNER, sp); fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(tmp, 'apps/web/palmistry-build-exclusion.js'));
      L = require(sp).INSPECTION_LIMITS; delete require.cache[require.resolve(sp)]; } finally { cleanup(tmp); }
    const before = { maxFileBytes: 256 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 * 1024, maxFiles: 250000, maxDepth: 64, maxArchiveBytes: 64 * 1024 * 1024, maxArchiveEntryBytes: 64 * 1024 * 1024, maxArchiveDecompressedBytes: 256 * 1024 * 1024, maxTotalDecompressedBytes: 1024 * 1024 * 1024, maxCompressionRatio: 200, maxArchiveEntries: 10000, maxNestedArchiveDepth: 3, maxScanMs: 600000 };
    check('G0. every pre-C11 inspection limit is unchanged (none weakened) and maxGzipMembers = 10000 is added', Object.entries(before).every(([k, v]) => L[k] === v) && L.maxGzipMembers === 10000, JSON.stringify(L)); }
  { const r = run('G1.gz', gzEmptyMembers(10000));
    check('G1. gzip with exactly maxGzipMembers (10000) empty members passes', r.exit === 0, r.reason); }
  { const r = run('G2.gz', gzEmptyMembers(10001));
    check('G2. [C10-F4] gzip with 10001 members fails closed (member-count limit)', r.exit === 1 && r.errors.some((e) => /gzip member-count limit \(10000\) exceeded/.test(e)), JSON.stringify(r.errors).slice(0, 200)); }
  { const r = run('G3.gz', gzEmptyMembers(1000000));
    check('G3. [C10-F4] 1,000,000 empty members (20 MB, the C10 case) fail closed, quickly', r.exit === 1 && r.errors.some((e) => /member-count limit/.test(e)) && r.ms < 10000, `ms=${r.ms} ${JSON.stringify(r.errors).slice(0, 160)}`); }
  { const m = F.gzipWithExtra(Buffer.alloc(0), Buffer.alloc(0)); const r = run('G4.gz', Buffer.concat(Array.from({ length: 20000 }, () => m)));
    check('G4. [C10-F4] 20,000 empty members with an empty FEXTRA field fail closed (member-count limit)', r.exit === 1 && r.errors.some((e) => /member-count limit/.test(e)), JSON.stringify(r.errors).slice(0, 200)); }
  { const r = run('G5.gz', Buffer.concat([gzEmptyMembers(6)]), SCANNER, { maxGzipMembers: 5 });
    check('G5. maxGzipMembers is an inspection limit (override 5, 6 members fails closed)', r.errors.some((e) => /member-count limit \(5\)/.test(e)), JSON.stringify(r.errors)); }
  { // In-loop work-time check, deterministically: the budget expires once gunzip starts (it reads maxGzipMembers first).
    const expireInGunzip: LimitsFn = (base) => { let armed = false; return new Proxy({ ...base }, { get(t: any, k) { if (k === 'maxGzipMembers') armed = true; if (k === 'maxScanMs' && armed) return -1; return t[k]; } }); };
    const gz = Buffer.concat([gzMember(Buffer.from('a benign member\n')), gzMember(Buffer.from('another benign member\n')), gzMember(Buffer.from('third\n'))]);
    const r = run('G6.gz', gz, SCANNER, expireInGunzip);
    check('G6. [C10-F4] the work-time budget is checked inside the gzip member loop (fails closed there)', r.errors.some((e) => /work-time budget .* exceeded while decompressing gzip stream/.test(e)), JSON.stringify(r.errors)); }
  { const gz = Buffer.concat([gzMember(Buffer.from('member one: benign\n')), gzMember(Buffer.from(`member two: ${SENT}\n`)), gzMember(Buffer.from('member three\n'))]);
    mustPass('G7', 'multi-member gzip with benign members still passes', Buffer.concat([gzMember(Buffer.from('one\n')), gzMember(Buffer.from('two\n')), gzMember(Buffer.from('three\n'))]));
    mustHit('G8', 'prohibited content in member 2 of a multi-member gzip is still found', gz);
    mustHit('G9', 'prohibited content in a gzip FEXTRA field is still found', F.gzipWithExtra(Buffer.from('benign\n'), Buffer.from(`x${SENT}x`))); }

  // ================================================================ N: supported archives still inspected (nested prohibited content)
  mustPass('N0', 'benign ZIP, tar and tar.gz pass', Buffer.concat([zipDeflated('a.txt', Buffer.from('benign\n'))]));
  mustPass('N0b', 'benign tar.gz passes', zlib.gzipSync(tar('a.txt', Buffer.from('benign\n'))));
  mustHit('N1', 'sentinel in a deflated ZIP entry is found', zipDeflated('a.txt', PAYLOAD));
  mustHit('N2', 'sentinel in a ZIP inside a tar.gz is found', zlib.gzipSync(tar('inner.zip', zipDeflated('a.txt', PAYLOAD))));
  mustHit('N3', 'sentinel in a ZIP stored inside a ZIP is found', zipStored('inner.zip', zipDeflated('a.txt', PAYLOAD)));
  mustFail('N4', 'xz (check ID 5) inside a ZIP inside a tar.gz fails closed', zlib.gzipSync(tar('inner.zip', zipStored('d.xz', xzHead(0, 5)))), /^xz$/);
  mustFail('N5', 'randomised bzip2 inside a tar fails closed', tar('r.bz2', bzHead('9', true)), /^bzip2$/);

  // ================================================================ P: coincidental bytes must not match (no false positives)
  mustPass('P1', 'incidental "xar!" in JS text', Buffer.from('// xar! is the macOS package magic\nexport const XAR = "xar!";\nconst s = "xar! archive";\n'.repeat(8)));
  mustPass('P2', 'a "BZh91AY&SY" constant in JS text', Buffer.from('const BZ = "BZh91AY&SY";\nexport function isBzip2(s) { return s.startsWith(BZ); }\n'.repeat(4)));
  mustPass('P3', 'xz magic with a broken header CRC (xz refuses it)', code(xzHead(0, 4, true)));
  mustPass('P4', 'bzip2 block magic whose origin pointer is outside every block size (bzip2 refuses it)', code(bzHead('9', false, 0x7fffff)));
  mustPass('P5', '64 KiB of pseudo-random binary data', Buffer.from(Array.from({ length: 65536 }, (_, i) => (i * 2654435761 >>> 13) & 0xff)));
  mustPass('P6', '"xar!" followed by printable machine-code-like bytes', code(Buffer.concat([Buffer.from('xar!', 'latin1'), fill(40, 0x48)])));

  // ================================================================ M: mutants (each fix reverted -> the suite observes it)
  if (!process.env.PALM_SCANNER_UNDER_TEST) {
    const src = fs.readFileSync(SCANNER, 'utf8');
    const mutants: { id: string; label: string; from: string; to: string; probe: (mut: string) => boolean }[] = [
      { id: 'M1', label: 'xz check-ID allowlist reinstated (C10-F2 reverted)', from: '  if (p + 12 > buf.length) return false;\n  return crc32(buf.subarray(p + 6, p + 8)) === buf.readUInt32LE(p + 8);',
        to: '  if (p + 12 > buf.length || buf[p + 6] !== 0 || ![0x00, 0x01, 0x04, 0x0a].includes(buf[p + 7])) return false;\n  return crc32(buf.subarray(p + 6, p + 8)) === buf.readUInt32LE(p + 8);', probe: (m) => mustPass('M1p', '', xzHead(0, 5), m) && !mustPass('M1q', '', xzHead(0, 4), m) },
      { id: 'M2', label: 'bzip2 randomised-bit rejection reinstated (C10-F3 reverted)', from: 'const level = digit >= 1 && digit <= 9 ? digit : 9;', to: 'const level = digit >= 1 && digit <= 9 && !(buf[p + 14] & 0x80) ? digit : -1;',
        probe: (m) => mustPass('M2p', '', bzHead('9', true), m) && !mustPass('M2q', '', bzHead('9', false), m) },
      { id: 'M3', label: 'xar version check reinstated on the binary-size rule (C10-F1 reverted)', from: 'if (hsize <= 4096) return true;', to: 'if (hsize <= 4096 && buf.readUInt16BE(p + 6) === 1) return true;',
        probe: (m) => mustPass('M3p', '', xarHead({ ver: 2, toc: fill(64, 0xff) }), m) && !mustPass('M3q', '', xarHead(), m) },
      { id: 'M4', label: 'gzip member-count limit removed (C10-F4 reverted)', from: 'if (headers.length >= maxMembers) throw', to: 'if (false) throw',
        probe: (m) => run('M4p.gz', gzEmptyMembers(10001), m).exit === 0 },
      { id: 'M5', label: 'in-loop gzip work-time check removed (C10-F4 reverted)', from: 'if (overTime()) throw new ArchiveError(`work-time budget (${limits.maxScanMs} ms) exceeded while decompressing', to: 'if (false) throw new ArchiveError(`work-time budget (${limits.maxScanMs} ms) exceeded while decompressing',
        probe: (m) => { const fn: LimitsFn = (base) => { let armed = false; return new Proxy({ ...base }, { get(t: any, k) { if (k === 'maxGzipMembers') armed = true; if (k === 'maxScanMs' && armed) return -1; return t[k]; } }); };
          return !run('M5p.gz', Buffer.concat([gzMember(Buffer.from('a\n')), gzMember(Buffer.from('b\n'))]), m, fn).errors.some((e) => /while decompressing gzip stream/.test(e)); } },
    ];
    for (const mt of mutants) {
      if (src.split(mt.from).length !== 2) { check(`${mt.id}. mutant anchor present exactly once (${mt.label})`, false, 'scanner source changed; update the mutant'); continue; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
      try { const mut = path.join(d, 'check-palmistry-bundle.js'); fs.writeFileSync(mut, src.replace(mt.from, mt.to));
        check(`${mt.id}. negative control: with ${mt.label}, the suite observes the regression`, mt.probe(mut)); } finally { cleanup(d); }
    }
  } else { notRun.push('M1-M5'); console.log('NOT RUN M1-M5 (PALM_SCANNER_UNDER_TEST set)'); }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
