/**
 * AURA-PALM-G5-C15-CI-1 -- regression tests for the compress .Z maxbits range
 * of the bundle scanner (`apps/web/scripts/check-palmistry-bundle.js`).
 *
 * C15-CI-1: the C15 rule accepted maxbits 9..16 only (Apple gzip's range is
 * narrower still), but GNU gzip 1.12 (and its `uncompress`) and libarchive
 * (bsdtar, for tar.Z) decode maxbits 0..16. A .Z at offset 0 with maxbits
 * 0..8 passed the scanner and extracted on Ubuntu (CI run 45009025557, F8p).
 * Fixed rule: 1F 9D, maxbits 0..16, first 9-bit code < 256, offset 0 only.
 *
 * Every variant an installed reader decodes must FAIL CLOSED; headers no
 * reader decodes (maxbits 17..31, first code >= 256, header-only, .Z after
 * offset 0) must PASS. Reader preconditions run against whatever gzip /
 * uncompress / compress / bsdtar is installed (Apple on macOS, GNU + ncompress
 * + libarchive on Ubuntu CI); a missing reader is NOT RUN. Mutants revert
 * each bound. PALM_SCANNER_UNDER_TEST=<path> runs against another scanner
 * (mutants skip).
 *
 * Run: npx ts-node test/palmG5C15CI1CompressMaxbits.test.ts
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
const ZFMT = /^compress \(\.Z\)$/;
const TMP = 'palm-c15ci1-';

let passed = 0, failed = 0;
const notRun: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); } };
const which = (...ts: string[]) => ts.find((t) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0) || null;
const cleanup = (d: string) => { if (path.basename(d).startsWith(TMP) && path.dirname(d) === os.tmpdir()) fs.rmSync(d, { recursive: true, force: true }); };

// ------------------------------------------------------------------ scanner harness (same layout as D7 / C11 / C13 / C15)
interface Run { exit: number | null; errors: string[]; hits: string[]; reason: string }
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
function mustFail(id: string, label: string, data: Buffer, scanner = SCANNER): boolean {
  const r = run(`${id}.bin`, data, scanner);
  const m = FOREIGN.exec(r.errors.find((e) => FOREIGN.test(e)) || '');
  const ok = r.exit === 1 && !!m && ZFMT.test(m[1]);
  if (scanner === SCANNER) check(`${id}. ${label} -> FAIL closed (compress (.Z))`, ok, `exit=${r.exit} reason=${r.reason.slice(0, 160)}`);
  return ok;
}
function mustPass(id: string, label: string, data: Buffer, scanner = SCANNER): boolean {
  const r = run(`${id}.bin`, data, scanner);
  const ok = r.exit === 0;
  if (scanner === SCANNER) check(`${id}. ${label} -> PASS`, ok, `exit=${r.exit} reason=${r.reason.slice(0, 160)}`);
  return ok;
}

// ------------------------------------------------------------------ fixtures (benign, synthetic)
const pad2 = (n: number) => String(n).padStart(2, '0');
const fill = (n: number, c = 0x2f) => Buffer.alloc(n, c);
function tar(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.fill(0x20, 148, 156); let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]);
}
const zipStored = (name: string, data: Buffer) => F.buildZip([{ name, data, method: 0 }]).buf;
/** Hide the sentinel from a plain byte search: every byte becomes a 9-bit code. */
const LIT = Buffer.from(`literal-only .Z payload: ${SENT}\n`);
/**
 * Literal-only LZW: every code is a 9-bit literal, LSB-first. With maxbits
 * <= 8 the decoder never grows its table (free_ent starts at 257 > 2^maxbits)
 * so 9-bit codes are exact for any length; with maxbits >= 9 the payload is
 * short enough (< 255 codes) that no reader leaves 9-bit codes either.
 */
function literalZ(data: Buffer, flags: number): Buffer {
  const out = Buffer.alloc(Math.ceil((data.length * 9) / 8));
  let bit = 0;
  for (const b of data) { for (let i = 0; i < 9; i++, bit++) if ((b >> i) & 1) out[bit >> 3] |= 1 << (bit & 7); }
  return Buffer.concat([Buffer.from([0x1f, 0x9d, flags]), out]);
}
const withMaxbits = (z: Buffer, mb: number) => { const b = Buffer.from(z); b[2] = (b[2] & 0xe0) | mb; return b; };

// ------------------------------------------------------------------ installed readers
interface Reader { id: string; decode: (z: Buffer) => Buffer }
const sp = (cmd: string, args: string[]) => (z: Buffer) => { const r = spawnSync(cmd, args, { input: z, timeout: 30000, maxBuffer: 1 << 26 }); return (r.stdout as Buffer) || Buffer.alloc(0); };
const gzipVer = which('gzip') ? (spawnSync('gzip', ['--version'], { encoding: 'utf8' }).stdout + spawnSync('gzip', ['--version'], { encoding: 'utf8' }).stderr) : '';
const FLAVOR = /Apple/.test(gzipVer) ? 'apple' : /^gzip 1\.\d+/m.test(gzipVer) ? 'gnu' : gzipVer ? 'other' : 'none';
const RAW: Reader[] = [];
if (which('gzip')) RAW.push({ id: `gzip(${FLAVOR})`, decode: sp('gzip', ['-d', '-c']) });
if (which('uncompress')) RAW.push({ id: 'uncompress', decode: sp('uncompress', ['-c']) });
if (which('compress')) RAW.push({ id: 'compress -d', decode: sp('compress', ['-d', '-c']) });
const BSDTAR = which('bsdtar');
const TARZ: Reader[] = [...RAW];
if (BSDTAR) TARZ.push({ id: 'bsdtar', decode: sp(BSDTAR, ['-x', '-O', '-f', '-']) });
const decodedBy = (readers: Reader[], z: Buffer) => readers.filter((r) => r.decode(z).includes(SENT)).map((r) => r.id);
const emitsAny = (readers: Reader[], z: Buffer) => readers.filter((r) => r.decode(z).length > 0).map((r) => r.id);

async function main() {
  console.log(`readers: ${RAW.map((r) => r.id).join(', ') || 'none'}${BSDTAR ? ', bsdtar (tar.Z)' : ''}; gzip flavor: ${FLAVOR}`);
  const realCompress = which('compress');
  const real = realCompress ? (spawnSync(realCompress, ['-c'], { input: Buffer.concat([Buffer.from(`real compress(1) output: ${SENT}\n`), fill(4000, 0x61)]) }).stdout as Buffer) : null;
  const tarBody = tar('p.txt', Buffer.from(`x ${SENT}\n`));
  const tarReal = realCompress ? (spawnSync(realCompress, ['-c'], { input: tarBody }).stdout as Buffer) : null;
  const decodable = new Set<number>();          // maxbits values any installed reader decoded
  const observe = (mb: number, readers: Reader[], z: Buffer) => { const d = decodedBy(readers, z); if (d.length) decodable.add(mb); return d; };

  // ================================================================ L: literal-only .Z, every maxbits value 0..31
  check('L0. literal-only .Z does not expose the sentinel as plain bytes', !literalZ(LIT, 0x88).includes(SENT));
  for (let mb = 0; mb < 32; mb++) {
    const z = literalZ(LIT, 0x80 | mb);
    const d = observe(mb, RAW, z);
    if (mb <= 16) mustFail(`L.${pad2(mb)}`, `literal .Z, maxbits ${mb}${d.length ? ` (decoded by ${d.join(', ')})` : ''}`, z);
    else { check(`L.${pad2(mb)}p. precondition: no installed reader decodes literal .Z with maxbits ${mb}`, d.length === 0, d.join(', ')); mustPass(`L.${pad2(mb)}`, `literal .Z, maxbits ${mb}`, z); }
  }

  // ================================================================ R: real compress(1) output with the maxbits field rewritten
  if (real) {
    check('R0. real .Z does not expose the sentinel as plain bytes', !real.includes(SENT));
    for (let mb = 0; mb < 32; mb++) {
      const z = withMaxbits(real, mb);
      const d = observe(mb, RAW, z);
      if (mb <= 16) mustFail(`R.${pad2(mb)}`, `real .Z, maxbits ${mb}${d.length ? ` (decoded by ${d.join(', ')})` : ''}`, z);
      else { check(`R.${pad2(mb)}p. precondition: no installed reader decodes real .Z with maxbits ${mb}`, d.length === 0, d.join(', ')); mustPass(`R.${pad2(mb)}`, `real .Z, maxbits ${mb}`, z); }
    }
  } else { notRun.push('R'); console.log('NOT RUN R (compress / ncompress not installed)'); }

  // ================================================================ T: tar.Z (libarchive reads .Z as a tar filter)
  for (let mb = 0; mb <= 8; mb++) {
    const z = literalZ(tarBody, 0x80 | mb);
    const d = observe(mb, TARZ, z);
    mustFail(`T.${pad2(mb)}`, `literal tar.Z, maxbits ${mb}${d.length ? ` (decoded by ${d.join(', ')})` : ''}`, z);
  }
  if (tarReal) {
    for (const mb of [9, 12, 16, 17, 24, 31]) {
      const z = withMaxbits(tarReal, mb);
      const d = observe(mb, TARZ, z);
      if (mb <= 16) mustFail(`T.${pad2(mb)}`, `real tar.Z, maxbits ${mb}${d.length ? ` (decoded by ${d.join(', ')})` : ''}`, z);
      else { check(`T.${pad2(mb)}p. precondition: no installed reader decodes real tar.Z with maxbits ${mb}`, d.length === 0, d.join(', ')); mustPass(`T.${pad2(mb)}`, `real tar.Z, maxbits ${mb}`, z); }
    }
  } else { notRun.push('T-real'); console.log('NOT RUN T real tar.Z (compress not installed)'); }

  // ================================================================ D: reader differential (justifies the 0..16 range)
  const range = [...decodable].sort((a, b) => a - b);
  console.log(`INFO maxbits values decoded by an installed reader: ${range.join(',') || 'none'}`);
  if (RAW.length || BSDTAR) check('D1. every maxbits value an installed reader decodes is within the scanner range 0..16', range.every((mb) => mb <= 16), range.join(','));
  else { notRun.push('D1'); console.log('NOT RUN D1 (no .Z reader installed)'); }
  const gz = RAW.find((r) => r.id.startsWith('gzip('));
  const gzDecodes = (mb: number) => !!gz && gz.decode(literalZ(LIT, 0x80 | mb)).includes(SENT);
  const span = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  if (FLAVOR === 'gnu') {
    check('D2. [C15-CI-1] GNU gzip decodes maxbits 0..8 (the C15 bypass; now fail-closed)', span(0, 8).every(gzDecodes));
    check('D3. GNU gzip decodes maxbits 9..16', span(9, 16).every(gzDecodes));
    check('D4. GNU gzip refuses maxbits 17..31', span(17, 31).every((mb) => !gzDecodes(mb)));
    check('D5. GNU gzip ignores the block-mode bit (maxbits 8, block mode off is decoded)', !!gz && gz.decode(literalZ(LIT, 0x08)).includes(SENT));
  } else if (FLAVOR === 'apple') {
    check('D2. Apple gzip refuses maxbits 0..11 (why C15 missed C15-CI-1 locally)', span(0, 11).every((mb) => !gzDecodes(mb)));
    check('D3. Apple gzip decodes maxbits 12..16', span(12, 16).every(gzDecodes));
    check('D4. Apple gzip refuses maxbits 17..31', span(17, 31).every((mb) => !gzDecodes(mb)));
  } else { notRun.push('D2-D5'); console.log(`NOT RUN D2-D5 (gzip flavor: ${FLAVOR})`); }
  if (BSDTAR) {
    const bt = TARZ.find((r) => r.id === 'bsdtar')!;
    check('D6. libarchive (bsdtar) extracts a tar.Z with maxbits 0..8', span(0, 8).every((mb) => bt.decode(literalZ(tarBody, 0x80 | mb)).includes(SENT)));
  } else { notRun.push('D6'); console.log('NOT RUN D6 (bsdtar not installed)'); }

  // ================================================================ H: valid and malformed headers
  mustFail('H1', 'maxbits 8, block-mode bit clear', literalZ(LIT, 0x08));
  mustFail('H2', 'maxbits 8, reserved flag bits 0x60 set', literalZ(LIT, 0x80 | 0x60 | 8));
  mustFail('H3', 'maxbits 0, block mode, minimal 2-code stream', literalZ(Buffer.from('ab'), 0x80));
  const bad = literalZ(LIT, 0x88); bad[3] = 0xff; bad[4] |= 1;
  check('H4p. precondition: no installed reader emits output for a first code of 511', emitsAny(RAW, bad).length === 0, emitsAny(RAW, bad).join(', '));
  mustPass('H4', 'maxbits 8 with a first 9-bit code of 511 (corrupt input everywhere)', bad);
  const b256 = literalZ(LIT, 0x88); b256[3] = 0x00; b256[4] |= 1;
  check('H5p. precondition: no installed reader emits output for a first code of 256', emitsAny(RAW, b256).length === 0, emitsAny(RAW, b256).join(', '));
  mustPass('H5', 'maxbits 8 with a first 9-bit code of 256 (CLEAR as first code)', b256);
  for (const [id, h] of [['H6', Buffer.from([0x1f, 0x9d, 0x88])], ['H7', Buffer.from([0x1f, 0x9d, 0x88, 0x41])]] as [string, Buffer][]) {
    check(`${id}p. precondition: no installed reader emits output for a ${h.length}-byte header`, emitsAny(RAW, h).length === 0, emitsAny(RAW, h).join(', '));
    mustPass(id, `${h.length}-byte .Z header (no complete code)`, h);
  }
  mustPass('H8', 'maxbits 17 with the reserved bits 0x60 set (field masked to 17)', literalZ(LIT, 0x80 | 0x60 | 17));

  // ================================================================ N: nested and embedded
  const z8 = literalZ(LIT, 0x88);
  mustFail('N1', 'maxbits 8 .Z as a stored ZIP member', zipStored('a.Z', z8));
  mustFail('N2', 'maxbits 8 .Z as a tar member', tar('a.Z', z8));
  mustFail('N3', 'maxbits 8 .Z inside a gzip stream (offset 0 of the inflated output)', zlib.gzipSync(z8));
  mustFail('N4', 'maxbits 0 .Z as a tar member inside a tar.gz', zlib.gzipSync(tar('a.Z', literalZ(LIT, 0x80))));
  const later = Buffer.concat([fill(16, 0x41), z8]);
  check('N5p. precondition: no installed reader decodes a maxbits-8 .Z that starts after offset 0', decodedBy(TARZ, later).length === 0, decodedBy(TARZ, later).join(', '));
  mustPass('N5', 'documented residual: maxbits 8 .Z after offset 0 (no stock reader opens it)', later);

  // ================================================================ P: false-positive controls
  mustPass('P1', 'JS text containing the escaped bytes "\\x1f\\x9d"', Buffer.from('var m = "\\x1f\\x9d\\x08"; // compress magic as text\n'));
  mustPass('P2', 'binary starting 1F 9D with maxbits 31', Buffer.concat([Buffer.from([0x1f, 0x9d, 0x1f]), fill(64, 0x11)]));
  mustPass('P3', 'binary with 1F 9D 08 after offset 0 (machine-code shape)', Buffer.concat([fill(64, 0x90), Buffer.from([0x1f, 0x9d, 0x08, 0x41, 0x00]), fill(64, 0xcc)]));
  mustPass('P4', 'benign text file', Buffer.from('benign text with no compress stream at all.\n'));

  // ================================================================ M: mutants (each bound reverted -> the suite observes it)
  if (!process.env.PALM_SCANNER_UNDER_TEST) {
    const src = fs.readFileSync(SCANNER, 'utf8');
    const anchor = '  return maxbits <= 16 && (buf[3] | ((buf[4] & 1) << 8)) < 256;';
    const mutants: { id: string; label: string; to: string; probe: (m: string) => boolean }[] = [
      { id: 'M1', label: 'C15 lower bound reinstated (maxbits >= 9)', to: '  return maxbits >= 9 && maxbits <= 16 && (buf[3] | ((buf[4] & 1) << 8)) < 256;', probe: (m) => mustPass('M1p', '', literalZ(LIT, 0x88), m) },
      { id: 'M2', label: 'upper bound removed (maxbits <= 31)', to: '  return maxbits <= 31 && (buf[3] | ((buf[4] & 1) << 8)) < 256;', probe: (m) => !mustPass('M2p', '', literalZ(LIT, 0x80 | 17), m) },
      { id: 'M3', label: 'first-code check removed', to: '  return maxbits <= 16;', probe: (m) => !mustPass('M3p', '', bad, m) },
      { id: 'M4', label: 'off-by-one upper bound (maxbits < 16)', to: '  return maxbits < 16 && (buf[3] | ((buf[4] & 1) << 8)) < 256;', probe: (m) => mustPass('M4p', '', literalZ(LIT, 0x80 | 16), m) },
    ];
    for (const mt of mutants) {
      if (src.split(anchor).length !== 2) { check(`${mt.id}. mutant anchor present exactly once (${mt.label})`, false, 'scanner source changed; update the mutant'); continue; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP));
      try { const mut = path.join(d, 'check-palmistry-bundle.js'); fs.writeFileSync(mut, src.replace(anchor, mt.to));
        check(`${mt.id}. negative control: with ${mt.label}, the suite observes the regression`, mt.probe(mut)); } finally { cleanup(d); }
    }
  } else { notRun.push('M1-M4'); console.log('NOT RUN M1-M4 (PALM_SCANNER_UNDER_TEST set)'); }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
