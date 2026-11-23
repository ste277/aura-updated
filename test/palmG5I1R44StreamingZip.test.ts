/**
 * AURA-PALM-G5-R4.4 -- streaming-reader ZIP recognition (HR2-R1 findings
 * HR2R1-F1 and HR2R1-F2; classes R42-IV-F1 / R43-R1).
 *
 * F1: libarchive's streaming ZIP reader (bsdtar, file or stdin) bids on any of
 * six leading "PK" signatures and then scans FORWARD to the next local-file
 * header, whatever its version byte or name looks like. A buffer with such a
 * header (or such a lead) must never be classified "no archive".
 * F2: for a STORED entry with a data descriptor, a streaming reader finds the
 * end of the data by searching it for a descriptor signature, so an early fake
 * descriptor ends the entry and exposes an embedded local header. Such
 * entries are rejected (fail closed).
 *
 * Every case runs the REAL scanner CLI (or PALM_SCANNER_UNDER_TEST) in a
 * throwaway tree plus its inspectArtifacts API, and a differential against
 * every locally available reader: when the scanner passes a file, no reader
 * may extract the hidden payload. Readers that are not installed are reported
 * NOT RUN, never as a pass. Negative controls: the suite mutates the scanner
 * (each R4.4 rule reverted) and checks that it then FAILS, so these tests
 * really detect a regression.
 *
 * Benign synthetic fixtures only: the payload is plain text carrying the Aura
 * image-input sentinel "g5-i1-dev" (deflated, so the raw byte scan cannot see
 * it). No real images, no MediaPipe code, no network.
 *
 * Run: npx ts-node test/palmG5I1R44StreamingZip.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { execFileSync, spawnSync } from 'child_process';
import * as F from './palmG5I1R43Fixtures';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const SCANNER = process.env.PALM_SCANNER_UNDER_TEST || path.join(WEB, 'scripts/check-palmistry-bundle.js');
const PAY = Buffer.from('benign probe text: g5-i1-dev\n'.repeat(50));
const HIT = /g5-i1-dev/;
const DESC = /stored entry with a data descriptor/;

let passed = 0;
let failed = 0;
const notRun: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); }
}
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const hasTool = (t: string) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0;
const TMP_PREFIX = 'palm-r44-';
const cleanup = (d: string) => { if (path.basename(d).startsWith(TMP_PREFIX) && path.dirname(d) === os.tmpdir()) fs.rmSync(d, { recursive: true, force: true }); };

// ------------------------------------------------------------------ scanner runs
function makeTree(scanner: string) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  const web = path.join(tmp, 'apps/web');
  fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
  fs.copyFileSync(scanner, path.join(web, 'scripts/check-palmistry-bundle.js'));
  fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
  fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), '{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}');
  fs.mkdirSync(path.join(web, '.next/static/chunks'), { recursive: true });
  fs.writeFileSync(path.join(web, '.next/static/chunks/main.js'), 'console.log("app")');
  fs.mkdirSync(path.join(web, 'public'), { recursive: true });
  return { tmp, web };
}
interface Run { exit: number | null; archives: number; errors: string[]; hits: string[]; reason: string }
function run(name: string, data: Buffer, scanner = SCANNER, limits: Record<string, number> = {}): Run {
  const t = makeTree(scanner);
  try {
    fs.writeFileSync(path.join(t.web, 'public', name), data);
    const scannerPath = path.join(t.web, 'scripts/check-palmistry-bundle.js');
    const r = Object.keys(limits).length ? null : spawnSync(process.execPath, [scannerPath], { encoding: 'utf8', timeout: 120000 });
    const mod = require(scannerPath);
    const api = mod.inspectArtifacts(t.web, { ...mod.INSPECTION_LIMITS, ...limits });
    delete require.cache[require.resolve(scannerPath)];
    const errors = api.errors.map((e: any) => e.error);
    const hits = [...new Set<string>(api.hits.map((h: any) => h.sentinel))];
    const exit = r ? r.status : (errors.length || hits.length ? 1 : 0);
    return { exit, archives: api.stats.archives, errors, hits, reason: (errors[0] || hits[0] || '').replace('archive not fully inspectable: ', '') };
  } finally { cleanup(t.tmp); }
}

// ------------------------------------------------------------------ stock readers
interface Reader { id: string; ok: boolean; cmd: string; args: (f: string) => string[]; stdin?: boolean }
const java = hasTool('java') && hasTool('jar') && spawnSync('java', ['-version'], { encoding: 'utf8' }).status === 0;
const PY = 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nfor n in z.namelist(): sys.stdout.buffer.write(z.read(n))';
const READERS: Reader[] = [
  { id: 'unzip', ok: hasTool('unzip'), cmd: 'unzip', args: (f) => ['-o', '-q', f, '-d', '.'] },
  { id: 'bsdtar(file)', ok: hasTool('bsdtar'), cmd: 'bsdtar', args: (f) => ['-xf', f, '-C', '.'] },
  { id: 'bsdtar(stdin)', ok: hasTool('bsdtar'), cmd: 'bsdtar', args: () => ['-xf', '-', '-C', '.'], stdin: true },
  { id: 'python-zipfile', ok: hasTool('python3'), cmd: 'python3', args: (f) => ['-I', '-c', PY, f] },
  { id: 'jar(file)', ok: java, cmd: 'jar', args: (f) => ['xf', f] },
  { id: 'jar(stdin)', ok: java, cmd: 'jar', args: () => ['x'], stdin: true },
  { id: 'ditto', ok: hasTool('ditto'), cmd: 'ditto', args: (f) => ['-x', '-k', f, '.'] },
];
for (const r of READERS) if (!r.ok) notRun.push(`reader:${r.id}`);
/** True when the reader writes (to a file or stdout) bytes containing the payload. Exit status is irrelevant: a reader that reports a CRC error after writing the data still extracted it. */
function extracts(r: Reader, data: Buffer): boolean {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  try {
    const f = path.join(d, 'in.bin'); fs.writeFileSync(f, data); const o = path.join(d, 'out'); fs.mkdirSync(o);
    const res = spawnSync(r.cmd, r.args(f), { cwd: o, input: r.stdin ? data : undefined, timeout: 30000 });
    let got = !!res.stdout && HIT.test(res.stdout.toString('latin1'));
    const walk = (p: string) => { for (const n of fs.readdirSync(p)) { const q = path.join(p, n); const st = fs.lstatSync(q); if (st.isDirectory()) walk(q); else if (st.isFile() && HIT.test(fs.readFileSync(q).toString('latin1'))) got = true; } };
    walk(o);
    return got;
  } finally { cleanup(d); }
}
const extractedBy = (data: Buffer) => READERS.filter((r) => r.ok && extracts(r, data)).map((r) => r.id);

// ------------------------------------------------------------------ fixtures (benign)
const crc = F.crc32;
const sig = (s: string) => Buffer.from(s, 'latin1');
const fill = (n: number) => Buffer.alloc(n, 0x2f);
/** A lone local-file header + data; no central directory, no EOCD. */
function lh(o: { ver?: number; name?: Buffer; method?: number; crcOverride?: number; truncate?: number } = {}): Buffer {
  const method = o.method ?? 8;
  const name = o.name ?? Buffer.from('a.txt');
  // Any non-stored method carries deflated bytes, so the payload is never visible to the raw byte scan.
  let comp = method === 0 ? PAY : zlib.deflateRawSync(PAY);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(o.ver ?? 20, 4); h.writeUInt16LE(method, 8);
  h.writeUInt32LE(o.crcOverride ?? crc(PAY), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(PAY.length, 22); h.writeUInt16LE(name.length, 26);
  if (o.truncate) comp = comp.subarray(0, comp.length - o.truncate);
  return Buffer.concat([h, name, comp]);
}
/** One-entry ZIP whose STORED entry declares a data descriptor (flag 8); `fake` puts an early descriptor + an embedded entry in its data. */
function storedWithDescriptor(fake: boolean, innerVer = 0xff): Buffer {
  const A = Buffer.from('ordinary leading bytes of a stored asset\n'.repeat(3));
  const early = Buffer.alloc(16); early.writeUInt32LE(0x08074b50, 0); early.writeUInt32LE(crc(A), 4); early.writeUInt32LE(A.length, 8); early.writeUInt32LE(A.length, 12);
  const data = Buffer.concat(fake ? [A, early, lh({ ver: innerVer })] : [A, Buffer.from('more ordinary bytes\n')]);
  const name = Buffer.from('e.bin');
  const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(name.length, 26);
  const desc = Buffer.alloc(16); desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc(data), 4); desc.writeUInt32LE(data.length, 8); desc.writeUInt32LE(data.length, 12);
  const loc = Buffer.concat([h, name, data, desc]);
  const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 8); c.writeUInt16LE(0, 10);
  c.writeUInt32LE(crc(data), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(0, 42);
  const cd = Buffer.concat([c, name]);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(1, 8); e.writeUInt16LE(1, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(loc.length, 16);
  return Buffer.concat([loc, cd, e]);
}
function gzipWrap(b: Buffer): Buffer { return zlib.gzipSync(b, { level: 0 }); }
function tarWrap(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(512); h.write(name, 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  h.fill(0x20, 148, 156); let s = 0; for (const x of h) s += x; h.write(s.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]);
}

const P1 = Buffer.concat([sig('PK\x07\x08'), fill(60), lh({ ver: 0xff })]);
const P2 = Buffer.concat([sig('PK00'), lh({ ver: 0xff })]);
const Q1 = storedWithDescriptor(true);

interface Case { id: string; label: string; data: Buffer; re?: RegExp }
const MUST_FAIL: Case[] = [
  { id: 'S1', label: '[HR2R1-F1/P1] PK\\x07\\x08 lead + mid-file local header, version byte 0xFF', data: P1 },
  { id: 'S2', label: '[HR2R1-F1/P2] PK00 lead + local header, version byte 0xFF', data: P2 },
  { id: 'S3', label: 'PK\\x05\\x06\\x01 lead + mid-file local header, version 0xFF', data: Buffer.concat([sig('PK\x05\x06\x01'), fill(59), lh({ ver: 0xff })]) },
  { id: 'S4', label: 'PK\\x06\\x06 lead + mid-file local header, version 0xFF', data: Buffer.concat([sig('PK\x06\x06'), fill(60), lh({ ver: 0xff })]) },
  { id: 'S5', label: 'PK\\x01\\x02 lead + mid-file local header, version 0xFF', data: Buffer.concat([sig('PK\x01\x02'), fill(60), lh({ ver: 0xff })]) },
  { id: 'S6', label: 'PK\\x07\\x08 lead + local header with a 5,000-byte name', data: Buffer.concat([sig('PK\x07\x08'), fill(60), lh({ name: Buffer.alloc(5000, 0x61) })]) },
  { id: 'S7', label: 'no lead signature: mid-file local header, version 0xFF', data: Buffer.concat([fill(64), lh({ ver: 0xff })]) },
  { id: 'S8', label: 'no lead signature: mid-file local header, empty name', data: Buffer.concat([fill(64), lh({ name: Buffer.alloc(0) })]) },
  { id: 'S9', label: 'no lead signature: mid-file local header, NUL in the name', data: Buffer.concat([fill(64), lh({ name: Buffer.from('a\0.txt') })]) },
  { id: 'S10', label: 'P1 with a WRONG CRC (recognition must not depend on CRC validity)', data: Buffer.concat([sig('PK\x07\x08'), fill(60), lh({ ver: 0xff, crcOverride: 1 })]) },
  { id: 'S11', label: 'P1 with a truncated deflate stream (an inflate-gated rule would pass it; bsdtar still extracts the payload)', data: Buffer.concat([sig('PK\x07\x08'), fill(60), lh({ ver: 0xff, truncate: 8 })]) },
  { id: 'S12', label: 'P1 with a bzip2 method id (12): not decodable by the scanner, still recognised', data: Buffer.concat([sig('PK\x07\x08'), fill(60), lh({ ver: 0xff, method: 12 })]) },
  { id: 'S13', label: 'lead signature only (PK\\x07\\x08, no local header): streaming candidate, fails closed', data: Buffer.concat([sig('PK\x07\x08'), fill(200)]) },
  { id: 'S14', label: 'nested: P1 stored inside a valid ZIP entry', data: F.buildZip([{ name: 'inner.bin', data: P1, method: 0 }]).buf },
  { id: 'S15', label: 'nested: P2 as a tar entry', data: tarWrap('inner.bin', P2) },
  { id: 'S16', label: 'nested: P1 as a gzip stream', data: gzipWrap(P1) },
  { id: 'Q1', label: '[HR2R1-F2] valid ZIP, stored entry + data descriptor hiding an early fake descriptor and an embedded entry', data: Q1, re: DESC },
  { id: 'Q2', label: '[HR2R1-F2] same, embedded local header plausible (version 20)', data: storedWithDescriptor(true, 20), re: DESC },
  { id: 'Q3', label: 'stored entry + data descriptor WITHOUT a fake descriptor: rejected by design (R4.4 rule 3)', data: storedWithDescriptor(false), re: DESC },
  { id: 'Q4', label: 'nested: Q1 stored inside a valid ZIP entry', data: F.buildZip([{ name: 'inner.zip', data: Q1, method: 0 }]).buf, re: DESC },
];

async function main(): Promise<void> {
  console.log(`INFO scanner=${SCANNER} sha256=${sha(fs.readFileSync(SCANNER))}`);
  console.log(`INFO readers available: ${READERS.filter((r) => r.ok).map((r) => r.id).join(', ') || '(none)'}; NOT RUN: ${READERS.filter((r) => !r.ok).map((r) => r.id).join(', ') || '(none)'}`);
  if (hasTool('bsdtar')) console.log(`INFO bsdtar: ${(spawnSync('bsdtar', ['--version'], { encoding: 'utf8' }).stdout || '').trim()}`);

  // ================================================================ A: attack preconditions (the fixtures are real)
  // These prove a stock reader really extracts the hidden payload. They are
  // reported NOT RUN where the reader is absent -- never as a pass.
  const pre: [string, Buffer, string[]][] = [['A1', P1, ['bsdtar(file)', 'bsdtar(stdin)']], ['A2', P2, ['bsdtar(file)', 'bsdtar(stdin)']], ['A3', Q1, ['bsdtar(stdin)']]];
  for (const [id, data, need] of pre) {
    const avail = READERS.filter((r) => need.includes(r.id) && r.ok);
    if (!avail.length) { notRun.push(id); console.log(`NOT RUN ${id} (needs ${need.join(' / ')})`); continue; }
    const ex = avail.filter((r) => extracts(r, data)).map((r) => r.id);
    check(`${id}. precondition: ${ex.join(', ') || avail.map((r) => r.id).join(', ')} extracts the hidden payload of ${id === 'A3' ? 'Q1' : id === 'A1' ? 'S1' : 'S2'}`, ex.length > 0, `none of ${avail.map((r) => r.id).join(', ')} extracted it`);
  }

  // ================================================================ S/Q: scanner must fail closed; differential
  for (const c of MUST_FAIL) {
    const r = run(`${c.id}.bin`, c.data);
    const ex = extractedBy(c.data);
    console.log(`INFO ${c.id} sha256=${sha(c.data).slice(0, 16)} scanner exit=${r.exit} archives=${r.archives} reason="${r.reason.slice(0, 110)}" extractedBy=[${ex.join(', ')}]`);
    check(`${c.id}. ${c.label} -> FAIL closed`, r.exit === 1 && r.archives >= 1 && r.hits.length === 0 && (!c.re || c.re.test(r.reason)), `exit=${r.exit} archives=${r.archives} reason=${r.reason}`);
    check(`${c.id}d. differential: scanner never passes a payload an available reader extracts`, r.exit === 1 || ex.length === 0, `scanner exit=${r.exit}, extracted by ${ex.join(', ')}`);
  }
  { // >64 MiB path (largeFileHasPlausibleZip), exercised with a reduced maxArchiveBytes.
    for (const [id, data] of [['L1', P1], ['L2', Buffer.concat([fill(64), lh({ ver: 0xff })])], ['L3', Buffer.concat([sig('PK\x07\x08'), fill(200)])]] as [string, Buffer][]) {
      const r = run(`${id}.bin`, data, SCANNER, { maxArchiveBytes: 50 });
      check(`${id}. archive-too-large path also fails closed (${id === 'L3' ? 'lead signature only' : 'mid-file local header'})`, r.errors.some((e) => /archive too large to inspect/.test(e)), JSON.stringify(r.errors));
    }
  }

  // ================================================================ C: false-positive controls (must pass)
  const OK_STORED = F.buildZip([{ name: 'hello.txt', data: F.HELLO, method: 0 }]).buf;
  const pass = (id: string, label: string, data: Buffer, archives: number) => {
    const r = run(`${id}.bin`, data);
    check(`${id}. ${label} -> PASS (${archives} archive(s))`, r.exit === 0 && r.archives === archives, `exit=${r.exit} archives=${r.archives} reason=${r.reason}`);
  };
  pass('C1', 'standard deflated ZIP', F.buildZip([{ name: 'hello.txt', data: F.HELLO }]).buf, 1);
  pass('C2', 'stored ZIP without a data descriptor', OK_STORED, 1);
  { const c = zlib.deflateRawSync(F.HELLO); const d = Buffer.alloc(16); d.writeUInt32LE(0x08074b50, 0); d.writeUInt32LE(crc(F.HELLO), 4); d.writeUInt32LE(c.length, 8); d.writeUInt32LE(F.HELLO.length, 12);
    pass('C3', 'DEFLATED entry with a valid data descriptor (unaffected by rule 3)', F.buildZip([{ name: 'hello.txt', data: F.HELLO, flags: 8, descriptor: d }]).buf, 1); }
  pass('C4', 'SFX-style prefix, relative offsets', F.buildZip([{ name: 'hello.txt', data: F.HELLO }], { prefix: fill(64) }).buf, 1);
  pass('C5', 'valid ZIP that starts with a PK\\x07\\x08 spanning marker', F.buildZip([{ name: 'hello.txt', data: F.HELLO }], { prefix: sig('PK\x07\x08') }).buf, 1);
  pass('C6', 'empty ZIP (EOCD only)', (() => { const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); return e; })(), 1);
  pass('C7', 'text mentioning PK and a local-header signature followed by ASCII (no known method)', Buffer.from('notes: PK\x03\x04 is the zip local header magic; PK\x05\x06 ends it.\n'), 0);
  { const h = Buffer.alloc(40, 0x41); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(0x7777, 8);
    pass('C8', 'mid-file local-header signature with an unknown method id (0x7777)', Buffer.concat([fill(64), h]), 0); }
  pass('C9', 'plain application JS', Buffer.from('export const a = 1;\n'.repeat(100)), 0);
  { // Shape of the one false positive in the R4.4 corpus run (a macOS system binary): chance "PK\3\4" in machine code with a zero method and empty name.
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(33807, 4); h.writeUInt16LE(596, 6); h.writeUInt16LE(0, 8); h.writeUInt32LE(113028, 18); h.writeUInt16LE(0, 26); h.writeUInt16LE(2750, 28);
    pass('C16', 'machine-code-like bytes: chance mid-file local-header signature with method 0 (stored)', Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(4000, 0x11), h, Buffer.alloc(4000, 0x22)]), 0); }
  { // Why stored mid-file headers may be skipped: their data is visible to the byte scan.
    const r = run('S17.bin', Buffer.concat([sig('PK\x07\x08'), fill(60), lh({ ver: 0xff, method: 0 })]));
    check('S17. stored (method 0) mid-file payload is caught by the byte scan itself (sentinel hit)', r.exit === 1 && r.hits.some((h) => HIT.test(h)), JSON.stringify(r));
    const r2 = run('S18.bin', Buffer.concat([fill(64), lh({ ver: 0xff, method: 0 })]));
    check('S18. same without a lead signature: byte-scan hit', r2.exit === 1 && r2.hits.some((h) => HIT.test(h)), JSON.stringify(r2)); }
  if (hasTool('zip')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
    try {
      fs.writeFileSync(path.join(d, 'hello.txt'), F.HELLO); fs.writeFileSync(path.join(d, 'tiny.txt'), 'x');
      execFileSync('zip', ['-q', 'def.zip', 'hello.txt', 'tiny.txt'], { cwd: d });
      execFileSync('zip', ['-q', '-0', 'stored.zip', 'hello.txt', 'tiny.txt'], { cwd: d });
      execFileSync('zip', ['-q', '-fd', 'fd.zip', 'hello.txt', 'tiny.txt'], { cwd: d });
      pass('C10', 'stock `zip` (deflate + a stored tiny file)', fs.readFileSync(path.join(d, 'def.zip')), 1);
      pass('C11', 'stock `zip -0` (all stored)', fs.readFileSync(path.join(d, 'stored.zip')), 1);
      const fd = fs.readFileSync(path.join(d, 'fd.zip'));
      const r = run('fd.zip', fd);
      console.log(`INFO C12 stock \`zip -fd\` (descriptors, tiny file may be stored): exit=${r.exit} reason="${r.reason.slice(0, 100)}"`);
      check('C12. stock `zip -fd` archive: passes, or fails closed ONLY by rule 3 (stored + descriptor)', r.exit === 0 || DESC.test(r.reason), r.reason);
    } finally { cleanup(d); }
  } else { notRun.push('C10', 'C11', 'C12'); console.log('NOT RUN C10-C12 (zip not available)'); }
  if (hasTool('ditto')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
    try { fs.mkdirSync(path.join(d, 'src')); fs.writeFileSync(path.join(d, 'src/hello.txt'), F.HELLO); fs.writeFileSync(path.join(d, 'src/tiny.txt'), 'x');
      execFileSync('ditto', ['-c', '-k', path.join(d, 'src'), path.join(d, 'dit.zip')]);
      pass('C13', 'stock `ditto -c -k` archive', fs.readFileSync(path.join(d, 'dit.zip')), 1); } finally { cleanup(d); }
  } else { notRun.push('C13'); console.log('NOT RUN C13 (ditto not available)'); }
  if (hasTool('python3')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
    try { const f = path.join(d, 'py.zip');
      execFileSync('python3', ['-I', '-c', 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_STORED)\nz.writestr("a.txt","hello\\n"*50)\nz.writestr("b.txt","x")\nz.close()', f]);
      pass('C14', 'Python zipfile ZIP_STORED to a seekable file', fs.readFileSync(f), 1); } finally { cleanup(d); }
  } else { notRun.push('C14'); console.log('NOT RUN C14 (python3 not available)'); }
  if (java) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
    try { fs.writeFileSync(path.join(d, 'hello.txt'), F.HELLO);
      execFileSync('jar', ['cf', 'a.jar', 'hello.txt'], { cwd: d });
      pass('C15', 'stock `jar cf` archive', fs.readFileSync(path.join(d, 'a.jar')), 1); } finally { cleanup(d); }
  } else { notRun.push('C15'); console.log('NOT RUN C15 (jar not available)'); }

  // ================================================================ M: negative controls (mutants must be detected)
  // Each mutant reverts one R4.4 rule to its R4.3 behaviour. The suite's own
  // cases must then see a clean pass of an attack fixture, i.e. these tests
  // would catch the regression.
  if (!process.env.PALM_SCANNER_UNDER_TEST) {
    const src = fs.readFileSync(SCANNER, 'utf8');
    const R43_PLAUSIBLE = 'return (buf.readUInt16LE(pos + 4) & 0xff) <= 63 && nlen >= 1 && nlen <= 4096 && pos + 30 + nlen <= buf.length && buf.subarray(pos + 30, pos + 30 + nlen).indexOf(0) === -1;';
    const RULE1: [string, string] = ['return 30 + nlen + buf.readUInt16LE(pos + 28) <= available;', R43_PLAUSIBLE];
    const RULE2: [string, string] = ['return buf.length >= 4 && ZIP_STREAM_LEAD_SIGS.has(buf.readUInt32LE(0));', 'return buf.length >= 4 && buf.readUInt32LE(0) === ZIP_LOCAL_SIG;'];
    const RULE3: [string, string] = ['if (method === 0 && flags & 0x8)', 'if (false)'];
    // `clean`: cases that must now pass clean (the suite detects the mutant).
    // `stillFail`: cases another, still-active rule must keep failing closed
    // (each rule is shown to be independently effective).
    const mutants: { id: string; label: string; edits: [string, string][]; clean: string[]; stillFail: string[] }[] = [
      { id: 'M1', label: 'rule 1 reverted (version/name plausibility restored)', edits: [RULE1], clean: ['S7', 'S8', 'S9'], stillFail: ['S1', 'S2', 'Q1'] },
      { id: 'M2', label: 'rule 2 reverted (only a local header at offset 0 is a lead)', edits: [RULE2], clean: ['S13'], stillFail: ['S1', 'S2'] },
      { id: 'M3', label: 'rules 1 and 2 reverted (R4.3 recognition)', edits: [RULE1, RULE2], clean: ['S1', 'S2', 'S11', 'S16'], stillFail: ['Q1'] },
      { id: 'M4', label: 'rule 3 reverted (stored + data descriptor accepted)', edits: [RULE3], clean: ['Q3'], stillFail: ['Q1'] },
      { id: 'M5', label: 'rules 1 and 3 reverted', edits: [RULE1, RULE3], clean: ['Q1'], stillFail: [] },
    ];
    const byId = new Map(MUST_FAIL.map((c) => [c.id, c]));
    for (const m of mutants) {
      let mut = src;
      let anchored = true;
      for (const [from, to] of m.edits) { if (mut.split(from).length !== 2) anchored = false; else mut = mut.replace(from, to); }
      if (!anchored) { check(`${m.id}. mutant anchor present exactly once (${m.label})`, false, 'scanner source changed; update the mutant'); continue; }
      const d = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
      try {
        const mp = path.join(d, 'check-palmistry-bundle.js'); fs.writeFileSync(mp, mut);
        const exitOf = (id: string) => run(`${id}.bin`, byId.get(id)!.data, mp).exit;
        const clean = m.clean.filter((id) => exitOf(id) === 0);
        check(`${m.id}. negative control: with ${m.label}, the suite detects a clean pass of ${clean.join(', ') || '(none)'}`, clean.length === m.clean.length, `expected clean passes for ${m.clean.join(', ')}, got ${clean.join(', ') || 'none'}`);
        if (m.stillFail.length) { const held = m.stillFail.filter((id) => exitOf(id) === 1);
          check(`${m.id}b. the remaining rules still fail closed on ${m.stillFail.join(', ')}`, held.length === m.stillFail.length, `held: ${held.join(', ') || 'none'}`); }
      } finally { cleanup(d); }
    }
  } else { notRun.push('M1-M4'); console.log('NOT RUN M1-M4 (PALM_SCANNER_UNDER_TEST set: mutants are built from the in-tree scanner only)'); }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
