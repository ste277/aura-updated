/**
 * AURA-PALM-G5-D7-A -- identifiable but uninspectable archive / compressed-
 * stream formats fail closed (IV1-PC-1: gzip embedded after offset 0;
 * IV1-PC-1b: xz, 7z, bzip2, zstd, lz4, rar, cab at offset 0 or embedded;
 * G5-D7B / IV3B-1: xar, the macOS .pkg container; G5-IV3F / IV3E-1, IV3E-2:
 * xar with an oversized TOC, and xar with any checksum id).
 *
 * The scanner (`check-palmistry-bundle.js`) must never pass a build file that
 * holds such a stream -- top-level, embedded, or inside an archive member --
 * because stock readers (7-Zip `x`, bsdtar, xz/bzip2/zstd/lz4) extract them
 * while the scanner cannot inspect them. Gzip at offset 0, ZIP and tar keep
 * being inspected. Coincidental bytes (machine code, ASCII text) must NOT
 * match: every format is detected by magic + a structural check (CRC, header
 * fields, xxh32, or a bounded inflate for embedded gzip), and the negative
 * controls below prove the checks are specific.
 *
 * Fixtures are benign and deterministic: hand-built minimal headers (always
 * run, on every platform) and, where the stock compressor is installed, real
 * streams of a high-entropy text payload carrying "g5-i1-dev"; every
 * compressed fixture is checked NOT to expose the payload as plain bytes.
 * Missing tools are reported NOT RUN, never as a pass. Mutants of the scanner
 * prove each hook and each validator is exercised.
 *
 * Run: npx ts-node test/palmG5D7ArchiveFormats.test.ts
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
const TMP = 'palm-d7-';

let passed = 0, failed = 0;
const notRun: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); } };
const hasTool = (t: string) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0;
const cleanup = (d: string) => { if (path.basename(d).startsWith(TMP) && path.dirname(d) === os.tmpdir()) fs.rmSync(d, { recursive: true, force: true }); };

// ------------------------------------------------------------------ scanner
interface Run { exit: number | null; errors: string[]; hits: string[]; reason: string }
function run(name: string, data: Buffer, scanner = SCANNER, limits: Record<string, number> = {}): Run {
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
    const cli = Object.keys(limits).length ? null : spawnSync(process.execPath, [sp], { encoding: 'utf8', timeout: 120000 });
    const mod = require(sp);
    const api = mod.inspectArtifacts(web, { ...mod.INSPECTION_LIMITS, ...limits });
    delete require.cache[require.resolve(sp)];
    const errors: string[] = api.errors.map((e: any) => e.error);
    const hits: string[] = [...new Set<string>(api.hits.map((h: any) => h.sentinel))];
    return { exit: cli ? cli.status : (errors.length || hits.length ? 1 : 0), errors, hits, reason: errors[0] || hits[0] || '' };
  } finally { cleanup(tmp); }
}

// ------------------------------------------------------------------ fixtures (benign)
const crc = F.crc32;
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const hex = (h: string) => Buffer.from(h.replace(/\s+/g, ''), 'hex');
const fill = (n: number, c = 0x2f) => Buffer.alloc(n, c);
/** Deterministic high-entropy text with the sentinel, so entropy coders never leave it as raw bytes. */
const PAYLOAD = (() => { let x = 7, s = ''; const r = () => { x = (x * 1103515245 + 12345) >>> 0; return x; };
  for (let i = 0; i < 400; i++) { if (i % 8 === 0) s += `benign probe text: ${SENT}\n`; for (let j = 0; j < 12; j++) { let w = ''; for (let k = 3 + (r() % 6); k > 0; k--) w += String.fromCharCode(97 + (r() >>> 8) % 26); s += `${w} `; } s += '\n'; }
  return Buffer.from(s); })();
const BODY = zlib.deflateRawSync(PAYLOAD); // opaque tail after hand-built headers

/** Rebuild a real (bsdtar) xar with a replacement TOC XML and/or checksum id; keeps the heap and refreshes the SHA-1 TOC checksum. */
function rebuildXar(b: Buffer, o: { tocXml?: (x: string) => string; alg?: number } = {}): Buffer {
  const hs = b.readUInt16BE(4), tocC = Number(b.readBigUInt64BE(8)), alg = b.readUInt32BE(24);
  const xml = zlib.inflateSync(b.subarray(hs, hs + tocC)).toString('utf8');
  const nx = o.tocXml ? o.tocXml(xml) : xml; const tz = zlib.deflateSync(Buffer.from(nx, 'utf8'));
  const h = Buffer.from(b.subarray(0, hs)); h.writeBigUInt64BE(BigInt(tz.length), 8); h.writeBigUInt64BE(BigInt(Buffer.byteLength(nx)), 16); h.writeUInt32BE((o.alg ?? alg) >>> 0, 24);
  const heap = Buffer.from(b.subarray(hs + tocC)); if (alg === 1) crypto.createHash('sha1').update(tz).digest().copy(heap, 0);
  return Buffer.concat([h, tz, heap]);
}
const bigComment = (x: string) => { const d = x.indexOf('?>') + 2; return `${x.slice(0, d)}\n<!--${' '.repeat(300000)}-->${x.slice(d)}`; };
const bigSpace = (x: string) => { const d = x.indexOf('?>') + 2; return `${x.slice(0, d)}${' '.repeat(300000)}${x.slice(d)}`; };
const XAR_ALGS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 255, 0xffffffff];
/** xar header (big-endian) + zlib-compressed TOC. `o` overrides fields for malformed variants. */
function xarHead(o: { hsize?: number; ver?: number; alg?: number; tocC?: number; toc?: Buffer } = {}): Buffer {
  const toc = o.toc ?? zlib.deflateSync(Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<xar><toc><creation-time>2026-11-21T00:00:00</creation-time></toc></xar>\n'));
  const h = Buffer.alloc(28); h.write('xar!', 0, 'latin1'); h.writeUInt16BE(o.hsize ?? 28, 4); h.writeUInt16BE(o.ver ?? 1, 6);
  h.writeBigUInt64BE(BigInt(o.tocC ?? toc.length), 8); h.writeBigUInt64BE(BigInt(1024), 16); h.writeUInt32BE(o.alg ?? 1, 24);
  return Buffer.concat([h, toc]);
}
// Minimal hand-built stream heads that satisfy the scanner's structural checks
// (independent constructions; rar/lz4 use published reference header bytes).
const HEADS: Record<string, Buffer> = {
  xz: (() => { const fl = hex('0001'); return Buffer.concat([hex('fd377a585a00'), fl, u32(crc(fl))]); })(),
  '7z': (() => { const sh = Buffer.concat([u32(0x20), u32(0), u32(0x40), u32(0), u32(0x12345678)]); return Buffer.concat([hex('377abcaf271c 0004'), u32(crc(sh)), sh]); })(),
  bzip2: hex('425a6839 314159265359 0a0b0c0d 00000100'), // level 9, randomised 0, origPtr 2
  zstd: hex('28b52ffd 00 50 410000') /* FHD 0, window 2^20, raw last block of 8 bytes */,
  lz4: hex('04224d18 6440a7'), // lz4 CLI default frame header (FLG 0x64, BD 0x40, HC 0xa7)
  rar4: hex('526172211a0700 cf90 73 0000 0d00 000000000000'),
  rar5: hex('526172211a070100 3392b5e5 0a 01 05 06 00 05 01 01 80 80 00'),
  xar: xarHead(),
  cab: (() => { const h = Buffer.alloc(36); h.write('MSCF', 0, 'latin1'); h.writeUInt32LE(4096, 8); h.writeUInt32LE(44, 16); h[24] = 3; h[25] = 1; h.writeUInt16LE(1, 26); h.writeUInt16LE(1, 28); return h; })(),
};
const NAME: Record<string, string> = { xz: 'xz', '7z': '7z', bzip2: 'bzip2', zstd: 'zstd', lz4: 'lz4', rar4: 'rar', rar5: 'rar', cab: 'cab', xar: 'xar' };
const stream = (k: string) => Buffer.concat([HEADS[k], k === 'zstd' ? Buffer.alloc(8, 0x61) : Buffer.alloc(0), BODY]);
const gzEmbedded = () => Buffer.concat([fill(64), zlib.gzipSync(PAYLOAD)]);
function tar(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.fill(0x20, 148, 156); let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]);
}
const zipStored = (name: string, data: Buffer) => F.buildZip([{ name, data, method: 0 }]).buf;
const zipComment = (comment: Buffer) => { const z = Buffer.from(F.buildZip([{ name: 'ok.txt', data: F.HELLO }]).buf); z.writeUInt16LE(comment.length, z.length - 2); return Buffer.concat([z, comment]); };

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

async function main(): Promise<void> {
  // ================================================================ A: payload is never plain bytes
  check('A0. payload carries the sentinel; deflated body does not expose it', PAYLOAD.includes(SENT) && !BODY.includes(SENT));

  // ================================================================ B: hand-built heads, every placement
  for (const k of Object.keys(HEADS)) {
    const fmt = new RegExp(`^${NAME[k]}$`);
    const s = stream(k);
    check(`B0.${k}. fixture does not expose the payload as plain bytes`, !s.includes(SENT));
    mustFail(`B1.${k}`, `${k} at offset 0`, s, fmt);
    mustFail(`B2.${k}`, `${k} after 64 filler bytes (embedded)`, Buffer.concat([fill(64), s]), fmt);
    mustFail(`B3.${k}`, `${k} between filler (embedded, trailing bytes)`, Buffer.concat([fill(64), s, fill(64)]), fmt);
    mustFail(`B4.${k}`, `${k} as a stored ZIP member (member at offset 0)`, zipStored('m.bin', s), fmt);
    mustFail(`B5.${k}`, `${k} embedded inside a stored ZIP member`, zipStored('m.bin', Buffer.concat([fill(64), s])), fmt);
    mustFail(`B6.${k}`, `${k} as a tar member`, tar('m.bin', s), fmt);
    mustFail(`B7.${k}`, `${k} inside a gzip stream (decompressed buffer)`, zlib.gzipSync(Buffer.concat([fill(64), s])), fmt);
  }
  { const g = gzEmbedded(); const fmt = /^gzip \(embedded\)$/;
    check('B0.gzip. embedded gzip fixture does not expose the payload', !g.includes(SENT));
    mustFail('B2.gzip', '[IV1-PC-1] gzip after 64 filler bytes (embedded)', g, fmt);
    mustFail('B3.gzip', 'gzip between filler', Buffer.concat([g, fill(64)]), fmt);
    mustFail('B5.gzip', 'gzip embedded inside a stored ZIP member', zipStored('m.bin', g), fmt);
    mustFail('B6.gzip', 'embedded gzip inside a tar member', tar('m.bin', g), fmt);
    mustFail('B8.gzip', 'embedded gzip in a ZIP archive comment (container region)', zipComment(g.subarray(0, 4000)), fmt);
    mustFail('B9.gzip', 'two levels deep: ZIP > ZIP > member with embedded gzip', zipStored('l1.zip', zipStored('m.bin', g)), fmt); }
  mustFail('B9.xz', 'two levels deep: ZIP > tar > member holding xz', zipStored('l1.tar', tar('m.bin', stream('xz'))), /^xz$/);

  // ================================================================ C: real streams from stock compressors (where installed)
  const tools: [string, string, string[], RegExp][] = [
    ['xz', 'xz', ['-9', '-c'], /^xz$/], ['bzip2', 'bzip2', ['-9', '-c'], /^bzip2$/], ['zstd', 'zstd', ['-q', '-19', '-c'], /^zstd$/], ['lz4', 'lz4', ['-q', '-9', '-c'], /^lz4$/],
  ];
  for (const [id, cmd, args, fmt] of tools) {
    if (!hasTool(cmd)) { notRun.push(`C.${id}`); console.log(`NOT RUN C.${id} (${cmd} not installed)`); continue; }
    const r = spawnSync(cmd, args, { input: PAYLOAD });
    const s = r.stdout as Buffer;
    if (r.status !== 0 || !s.length) { check(`C0.${id}. ${cmd} produced a stream`, false, String(r.stderr)); continue; }
    if (id === 'lz4' && s.includes(SENT)) { console.log(`INFO C.${id}: lz4 keeps literals raw (no entropy coding); detection is by frame header`); }
    else check(`C0.${id}. real ${id} stream does not expose the payload as plain bytes`, !s.includes(SENT));
    mustFail(`C1.${id}`, `real ${id} stream at offset 0`, s, fmt);
    mustFail(`C2.${id}`, `real ${id} stream embedded after 64 bytes`, Buffer.concat([fill(64), s]), fmt);
    const d = spawnSync(cmd, ['-dc'], { input: Buffer.concat([s]) });
    check(`C3.${id}. precondition: stock ${cmd} -dc restores the payload`, d.status === 0 && (d.stdout as Buffer).includes(SENT));
  }
  const z7 = hasTool('7zz') ? '7zz' : hasTool('7z') ? '7z' : null;
  if (z7) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
    try {
      fs.writeFileSync(path.join(d, 'payload.txt'), PAYLOAD);
      spawnSync(z7, ['a', '-bso0', '-bsp0', '-mx=9', 'p.7z', 'payload.txt'], { cwd: d });
      const s = fs.readFileSync(path.join(d, 'p.7z'));
      check('C0.7z. real 7z archive does not expose the payload as plain bytes', !s.includes(SENT));
      mustFail('C1.7z', 'real 7z archive at offset 0', s, /^7z$/);
      mustFail('C2.7z', 'real 7z archive embedded after 64 bytes', Buffer.concat([fill(64), s]), /^7z$/);
      fs.writeFileSync(path.join(d, 'e.bin'), gzEmbedded()); fs.mkdirSync(path.join(d, 'o'));
      spawnSync(z7, ['x', '-y', path.join(d, 'e.bin')], { cwd: path.join(d, 'o') });
      const got = fs.readdirSync(path.join(d, 'o')).some((n) => fs.readFileSync(path.join(d, 'o', n)).includes(SENT));
      check(`C3.7z. precondition [IV1-PC-1]: stock ${z7} x extracts the payload of a gzip embedded after 64 bytes`, got);
    } finally { cleanup(d); }
  } else { notRun.push('C.7z'); console.log('NOT RUN C.7z (7-Zip not installed)'); }

  const code = (b: Buffer) => Buffer.concat([hex('cffaedfe 0c000001'), fill(256, 0x90), b, fill(256, 0xcc)]); // machine-code-like context
  // ================================================================ X: xar (G5-D7B, IV3B-1)
  if (hasTool('bsdtar')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
    try {
      fs.writeFileSync(path.join(d, 'payload.txt'), PAYLOAD);
      const mk = spawnSync('bsdtar', ['--format', 'xar', '-cf', 'p.xar', 'payload.txt'], { cwd: d, encoding: 'utf8' });
      const s = mk.status === 0 && fs.existsSync(path.join(d, 'p.xar')) ? fs.readFileSync(path.join(d, 'p.xar')) : null;
      if (!s) { notRun.push('X.real'); console.log(`NOT RUN X.real (this bsdtar cannot write xar: ${(mk.stderr || '').trim().slice(0, 80)})`); }
      else {
        check('X0. real xar (bsdtar --format xar) does not expose the payload as plain bytes', !s.includes(SENT));
        mustFail('X1', 'real xar at offset 0', s, /^xar$/);
        mustFail('X2', 'real xar embedded after 64 bytes', Buffer.concat([fill(64), s]), /^xar$/);
        mustFail('X3', 'real xar as a stored ZIP member', zipStored('p.pkg', s), /^xar$/);
        mustFail('X4', 'real xar as a tar member', tar('p.pkg', s), /^xar$/);
        const readers: [string, string[], Buffer][] = [['bsdtar', ['-xf', '-'], s]];
        const z7x = hasTool('7zz') ? '7zz' : hasTool('7z') ? '7z' : null;
        for (const [rid, args, data] of readers) {
          const o = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
          try { spawnSync(rid, args, { cwd: o, input: data }); const got = fs.readdirSync(o).some((n) => fs.readFileSync(path.join(o, n)).includes(SENT));
            check(`X5. precondition: stock ${rid} extracts the payload of the real xar (stdin)`, got); } finally { cleanup(o); }
        }
        if (z7x) { const o = fs.mkdtempSync(path.join(os.tmpdir(), TMP)); try { fs.writeFileSync(path.join(o, 'in.bin'), Buffer.concat([fill(64), s])); fs.mkdirSync(path.join(o, 'x'));
            spawnSync(z7x, ['x', '-y', path.join(o, 'in.bin')], { cwd: path.join(o, 'x') });
            const got = fs.readdirSync(path.join(o, 'x')).some((n) => fs.readFileSync(path.join(o, 'x', n)).includes(SENT));
            check(`X6. precondition: stock ${z7x} x extracts the payload of a xar embedded after 64 bytes`, got); } finally { cleanup(o); } }
        else { notRun.push('X6'); console.log('NOT RUN X6 (7-Zip not installed)'); }
        // ---- G5-IV3F: IV3E-1 (oversized TOC) and IV3E-2 (checksum id) on REAL xar archives
        const xe1 = rebuildXar(s, { tocXml: bigComment }), xe1b = rebuildXar(s, { tocXml: bigSpace });
        mustFail('XE1', '[IV3E-1] real xar whose TOC carries a 300 KB XML comment (probe reaches the cap), at offset 0', xe1, /^xar$/);
        mustFail('XE1e', '[IV3E-1] same, embedded after 64 bytes', Buffer.concat([fill(64), xe1]), /^xar$/);
        mustFail('XE1b', '[IV3E-1] real xar whose TOC carries 300 KB of whitespace, embedded after 64 bytes', Buffer.concat([fill(64), xe1b]), /^xar$/);
        mustFail('XE1b0', '[IV3E-1] same, at offset 0', xe1b, /^xar$/);
        mustFail('XE1m', '[IV3E-1] oversized-TOC xar as a stored ZIP member', zipStored('p.pkg', xe1b), /^xar$/);
        for (const a of XAR_ALGS) {
          const x = rebuildXar(s, { alg: a });
          mustFail(`XE4.${a}`, `[IV3E-2] real xar with checksum id ${a}, at offset 0`, x, /^xar$/);
          mustFail(`XE4e.${a}`, `[IV3E-2] real xar with checksum id ${a}, embedded after 64 bytes`, Buffer.concat([fill(64), x]), /^xar$/);
        }
        const ext = (cmd: string, args: (f: string) => string[], data: Buffer, stdin = false) => { const o = fs.mkdtempSync(path.join(os.tmpdir(), TMP)); try {
          const f = path.join(o, 'in.bin'); fs.writeFileSync(f, data); fs.mkdirSync(path.join(o, 'x')); spawnSync(cmd, args(f), { cwd: path.join(o, 'x'), input: stdin ? data : undefined });
          return fs.readdirSync(path.join(o, 'x')).some((n) => fs.readFileSync(path.join(o, 'x', n)).includes(SENT)); } finally { cleanup(o); } };
        check('XE5. precondition [IV3E-1]: stock bsdtar (stdin) extracts the payload of XE1', ext('bsdtar', () => ['-xf', '-'], xe1, true));
        if (z7x) {
          check(`XE6. precondition [IV3E-1]: stock ${z7x} x extracts the payload of XE1b embedded after 64 bytes`, ext(z7x, (f) => ['x', '-y', f], Buffer.concat([fill(64), xe1b])));
          const algsOk = XAR_ALGS.filter((a) => ext(z7x, (f) => ['x', '-y', f], rebuildXar(s, { alg: a })));
          check(`XE7. precondition [IV3E-2]: stock ${z7x} x extracts the payload for every tested checksum id (${XAR_ALGS.length})`, algsOk.length === XAR_ALGS.length, `extracted for ${algsOk.join(',')}`);
        } else { notRun.push('XE6', 'XE7'); console.log('NOT RUN XE6/XE7 (7-Zip not installed)'); }
      }
    } finally { cleanup(d); }
  } else { notRun.push('X.real'); console.log('NOT RUN X.real (bsdtar not installed)'); }
  mustPass('X7', 'malformed xar: version 2', code(xarHead({ ver: 2 })));
  mustPass('X8', 'malformed xar: header size 27', code(xarHead({ hsize: 27 })));
  // G5-IV3F (IV3E-2): the checksum id is not a validity criterion (7-Zip ignores it) -- every id is detected.
  for (const a of XAR_ALGS) { mustFail(`X9.${a}`, `hand-built xar head with checksum id ${a} (offset 0)`, xarHead({ alg: a }), /^xar$/);
    mustFail(`X9e.${a}`, `hand-built xar head with checksum id ${a} (embedded in machine-code bytes)`, code(xarHead({ alg: a })), /^xar$/); }
  // G5-IV3F (IV3E-1): a TOC whose bounded probe reaches the 64 KiB cap is detected (after the header checks).
  { const big = xarHead({ toc: zlib.deflateSync(Buffer.from(`<?xml version="1.0"?>\n<!--${' '.repeat(300000)}--><xar/>`)) });
    mustFail('XH1', '[IV3E-1] hand-built xar head with an oversized TOC, at offset 0', big, /^xar$/);
    mustFail('XH1e', '[IV3E-1] same, embedded after 64 bytes', Buffer.concat([fill(64), big]), /^xar$/);
    mustFail('XH1m', '[IV3E-1] same, as a tar member', tar('p.pkg', big), /^xar$/);
    mustFail('XH2', 'conservative: valid xar header + a zlib TOC reaching the cap with non-XML content is detected', xarHead({ toc: zlib.deflateSync(Buffer.alloc(300000, 0x41)) }), /^xar$/);
    mustPass('XH3', 'malformed header (version 2) with an oversized TOC still passes (cap rule only after the header checks)', code(xarHead({ ver: 2, toc: zlib.deflateSync(Buffer.alloc(300000, 0x41)) })));
    mustPass('XH4', 'malformed header (size 27) with an oversized TOC still passes', code(xarHead({ hsize: 27, toc: zlib.deflateSync(Buffer.alloc(300000, 0x41)) }))); }
  mustPass('X10', 'malformed xar: zero TOC length', code(xarHead({ tocC: 0 })));
  mustPass('X11', 'malformed xar: TOC is not a zlib stream', code(xarHead({ toc: fill(64, 0xff) })));
  mustPass('X12', 'malformed xar: TOC inflates but is not XML', code(xarHead({ toc: zlib.deflateSync(Buffer.from('not an xml table of contents '.repeat(4))) })));
  mustPass('X13', 'incidental "xar!" in JS text', Buffer.from('// xar! is the macOS package magic; see docs.\nexport const XAR = "xar!";\n'.repeat(4)));
  mustPass('X14', 'incidental "xar!" followed by machine-code bytes', code(Buffer.concat([Buffer.from('xar!', 'latin1'), fill(40, 0x48)])));
  { const r = run('X15.bin', Buffer.concat([fill(64), stream('xar')]), SCANNER, { maxArchiveBytes: 40 });
    check('X15. >maxArchiveBytes file with embedded xar: fails closed (window probe)', r.errors.some((e) => /\(xar\)/.test(e)), JSON.stringify(r.errors)); }

  // ================================================================ D: legitimate content still passes (and is inspected)
  mustPass('D1', 'gzip at offset 0 (supported, inspected)', zlib.gzipSync(F.HELLO));
  mustPass('D2', '.tar.gz (supported, inspected)', zlib.gzipSync(tar('hello.txt', F.HELLO)));
  mustPass('D3', 'gem-like tar whose members are gzip files (members at offset 0 inspected)', tar('data.tar.gz', zlib.gzipSync(tar('hello.txt', F.HELLO))));
  mustPass('D4', 'standard ZIP', F.buildZip([{ name: 'hello.txt', data: F.HELLO }]).buf);
  mustPass('D5', 'ZIP storing a .gz member (member at offset 0)', zipStored('hello.txt.gz', zlib.gzipSync(F.HELLO)));
  mustPass('D6', 'plain application JS', Buffer.from('export const a = 1;\n'.repeat(200)));
  mustPass('D7', 'R4.4 machine-code control (chance PK\\3\\4, method 0)', (() => { const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(33807, 4); h.writeUInt16LE(596, 6); h.writeUInt32LE(113028, 18); h.writeUInt16LE(2750, 28); return Buffer.concat([hex('cffaedfe'), fill(4000, 0x11), h, fill(4000, 0x22)]); })());

  // ================================================================ E: false-positive controls -- magic present, structure invalid
  mustPass('E1', 'xz magic with a wrong flags CRC', code(Buffer.concat([hex('fd377a585a00 0001'), u32(0xdeadbeef), BODY.subarray(0, 64)])));
  mustPass('E2', '7z magic with a wrong start-header CRC', code(Buffer.concat([hex('377abcaf271c 0004'), u32(1), fill(20, 7)])));
  mustPass('E3', 'bzip2 block magic as ASCII text in JS ("BZh91AY&SY" constant)', Buffer.from('const BZ = "BZh91AY&SY";\nexport function isBzip2(s) { return s.startsWith(BZ); }\n'));
  mustPass('E4', 'zstd magic with the reserved FHD bit set', code(hex('28b52ffd 08 50 410000 6161616161616161')));
  mustPass('E5', 'zstd magic with an invalid (reserved) block type', code(hex('28b52ffd 00 50 070000 6161616161616161')));
  mustPass('E6', 'lz4 magic with a wrong header checksum', code(hex('04224d18 6440a8 00000000')));
  mustPass('E7', 'RAR marker followed by code bytes (libarchive/cpack shape: signature constant only)', code(Buffer.concat([Buffer.from('Rar!\x1a\x07\x00', 'latin1'), fill(32, 0x48)])));
  mustPass('E8', 'RAR5 marker with a wrong main-header CRC', code(hex('526172211a070100 00000000 0a 01 05 06 00 05 01 01 80 80 00')));
  mustPass('E9', '"MSCF" in text (not a cabinet header)', Buffer.from('// MSCF is the Microsoft cabinet magic; see docs.\n'.repeat(5)));
  mustPass('E10', 'gzip magic followed by an invalid deflate stream (reserved block type)', code(Buffer.concat([hex('1f8b0800 00000000 0003'), fill(64, 0xff)])));
  mustPass('E11', 'documented residual: embedded gzip decoding to < 64 bytes', Buffer.concat([fill(64), zlib.gzipSync(Buffer.from('tiny'))]));
  mustPass('E12', 'documented residual: brotli (no magic number)', Buffer.concat([fill(64), zlib.brotliCompressSync(PAYLOAD)]));

  // ================================================================ L: large-file path and bounds
  { const r = run('L1.bin', Buffer.concat([fill(64), stream('xz')]), SCANNER, { maxArchiveBytes: 40 });
    check('L1. >maxArchiveBytes file with embedded xz: fails closed (window probe)', r.errors.some((e) => /\(xz\)/.test(e)), JSON.stringify(r.errors));
    const r2 = run('L2.bin', gzEmbedded(), SCANNER, { maxArchiveBytes: 40 });
    check('L2. >maxArchiveBytes file with embedded gzip: fails closed (window probe)', r2.errors.some((e) => /gzip \(embedded\)/.test(e)), JSON.stringify(r2.errors));
    const r3 = run('L3.bin', code(Buffer.concat([hex('fd377a585a00 0001'), u32(1)])), SCANNER, { maxArchiveBytes: 40 });
    check('L3. >maxArchiveBytes file with an invalid xz header: passes (no false positive)', r3.errors.length === 0, JSON.stringify(r3.errors)); }
  { const many = Buffer.concat(Array.from({ length: 4200 }, () => Buffer.concat([hex('fd377a585a00 0001'), u32(1)])));
    const r = run('L4.bin', many);
    check('L4. > MAX_SIG_POSITIONS invalid xz magics: fails closed (bounded work)', r.exit === 1 && /too many (xz|archive)/.test(r.reason), r.reason); }

  // ================================================================ M: negative controls (mutants must be detected)
  if (!process.env.PALM_SCANNER_UNDER_TEST) {
    const src = fs.readFileSync(SCANNER, 'utf8');
    const mutants: { id: string; label: string; from: string; to: string; probe: () => boolean }[] = [
      { id: 'M1', label: 'detection disabled (findForeignStream returns null)', from: 'function findForeignStream(buf) {', to: 'function findForeignStream(buf) { return null;', probe: () => mustPass('M1p', '', stream('xz'), mut) },
      { id: 'M2', label: 'archive-member hook removed', from: '} else assertNoForeignStream(data, label); // G5-D7-A', to: '} // G5-D7-A', probe: () => mustPass('M2p', '', zipStored('m.bin', stream('xz')), mut) && !mustPass('M2q', '', stream('xz'), mut) },
      { id: 'M3', label: 'top-level hook removed', from: 'try { assertNoForeignStream(archiveBuf, shown); }', to: 'try { }', probe: () => mustPass('M3p', '', stream('xz'), mut) && !mustPass('M3q', '', zipStored('m.bin', stream('xz')), mut) },
      { id: 'M4', label: 'RAR validator weakened to the marker only', from: 'function validRarAt(buf, p) {', to: 'function validRarAt(buf, p) { return true;', probe: () => !mustPass('M4p', '', code(Buffer.concat([Buffer.from('Rar!\x1a\x07\x00', 'latin1'), fill(32, 0x48)])), mut) },
      { id: 'M5', label: 'embedded-gzip validator weakened to the magic only', from: 'function validGzipAt(buf, p) {', to: 'function validGzipAt(buf, p) { return true;', probe: () => !mustPass('M5p', '', code(Buffer.concat([hex('1f8b0800 00000000 0003'), fill(64, 0xff)])), mut) },
      { id: 'M6', label: 'bzip2 origin-pointer check removed', from: 'return origPtr < level * 100000;', to: 'return true;', probe: () => !mustPass('M6p', '', Buffer.from('const BZ = "BZh91AY&SY";\nexport function isBzip2(s) { return s.startsWith(BZ); }\n'), mut) },
      { id: 'M8', label: 'xar detection disabled (validator returns false)', from: 'function validXarAt(buf, p) {', to: 'function validXarAt(buf, p) { return false;', probe: () => mustPass('M8p', '', stream('xar'), mut) && mustPass('M8q', '', zipStored('p.pkg', stream('xar')), mut) },
      { id: 'M9', label: 'xar inspection-cap detection disabled (IV3E-1 reverted)', from: "} catch (err) { return !!err && err.code === 'ERR_BUFFER_TOO_LARGE'; } // IV3E-1: xar TOC reached the inspection cap -> detected", to: '} catch (err) { return false; }', probe: () => mustPass('M9p', '', xarHead({ toc: zlib.deflateSync(Buffer.from(`<?xml version="1.0"?>\n<!--${' '.repeat(300000)}--><xar/>`)) }), mut) && !mustPass('M9q', '', stream('xar'), mut) },
      { id: 'M10', label: 'xar checksum-id bound reinstated (IV3E-2 reverted)', from: 'if (hsize < 28 || hsize > 4096 || buf.readUInt16BE(p + 6) !== 1) return false;', to: 'if (hsize < 28 || hsize > 4096 || buf.readUInt16BE(p + 6) !== 1 || buf.readUInt32BE(p + 24) > 3) return false;', probe: () => mustPass('M10p', '', xarHead({ alg: 4 }), mut) && mustPass('M10q', '', xarHead({ alg: 0xffffffff }), mut) && !mustPass('M10r', '', xarHead({ alg: 1 }), mut) },
      { id: 'M7', label: 'large-file window probe removed', from: 'f = largeFileForeignStream(realPath, size, scanRes.foreignPositions);', to: 'f = null;', probe: () => run('M7p.bin', Buffer.concat([fill(64), stream('xz')]), mut, { maxArchiveBytes: 40 }).errors.length === 0 },
    ];
    let mut = '';
    for (const m of mutants) {
      if (src.split(m.from).length !== 2) { check(`${m.id}. mutant anchor present exactly once (${m.label})`, false, 'scanner source changed; update the mutant'); continue; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
      try { mut = path.join(d, 'check-palmistry-bundle.js'); fs.writeFileSync(mut, src.replace(m.from, m.to));
        check(`${m.id}. negative control: with ${m.label}, the suite observes the regression`, m.probe()); } finally { cleanup(d); }
    }
  } else { notRun.push('M1-M10'); console.log('NOT RUN M1-M10 (PALM_SCANNER_UNDER_TEST set)'); }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
