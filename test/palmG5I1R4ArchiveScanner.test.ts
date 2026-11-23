/**
 * AURA-PALM-G5-I1-R4 -- archive inspection and fail-closed scanner hardening
 * (R3-N1, R3-N3, R3-N4, R3-N6).
 *
 * Runs the REAL scanner CLI (apps/web/scripts/check-palmistry-bundle.js, or
 * the file named by PALM_SCANNER_UNDER_TEST for negative controls) against
 * throwaway build trees, plus its inspectArtifacts() API for limits.
 *
 *   A. archive regression matrix (ticket section 10)
 *   B. additional fail-closed archive structures
 *   C. archive resource limits
 *   D. scan-root contract (R3-N3)
 *   E. special filesystem objects (R3-N4)
 *   F. coverage wording (R3-N6)
 *
 * Archives are built in code (deterministic ZIP / TAR / GZIP writers below)
 * from the installed MediaPipe package, Aura's own source and synthetic
 * bytes. Nothing is extracted or executed. No network. No real palm images.
 *
 * Run: npx ts-node test/palmG5I1R4ArchiveScanner.test.ts
 */
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { execFileSync, spawnSync } from 'child_process';

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

/* eslint-disable @typescript-eslint/no-var-requires */
const scannerModule: any = require(SCANNER);

const realBundle = fs.readFileSync(path.join(MP, 'vision_bundle.mjs'));
const realWasm = fs.readFileSync(path.join(MP, 'wasm/vision_wasm_nosimd_internal.wasm'));
const uiSource = fs.readFileSync(path.join(WEB, 'components/palm-scan/PalmImageInput.tsx'));
const benignWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 9)]);

// ------------------------------------------------------------------ deterministic archive writers
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC_T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

interface ZipEntry { name: string; data: Buffer; method?: 0 | 8 | number; flags?: number; crc?: number; extAttr?: number; localName?: string; usize?: number }
function zip(entries: ZipEntry[], opts: { prefix?: Buffer; gapAfterFirst?: Buffer } = {}): Buffer {
  const locals: Buffer[] = [];
  const cds: Buffer[] = [];
  let offset = 0;
  entries.forEach((e, i) => {
    const method = e.method ?? 8;
    const comp = method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const crc = e.crc ?? crc32(e.data);
    const usize = e.usize ?? e.data.length;
    const lname = Buffer.from(e.localName ?? e.name);
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.flags ?? 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(lname.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x0314, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(e.flags ?? 0, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(usize, 24); cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(e.extAttr ?? ((0o100644 << 16) >>> 0), 38); cd.writeUInt32LE(offset, 42);
    const local = Buffer.concat([lh, lname, comp]);
    locals.push(local);
    cds.push(Buffer.concat([cd, name]));
    offset += local.length;
    if (i === 0 && opts.gapAfterFirst) { locals.push(opts.gapAfterFirst); offset += opts.gapAfterFirst.length; }
  });
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([opts.prefix ?? Buffer.alloc(0), ...locals, cdBuf, eocd]);
}

function tar(entries: Array<{ name: string; data?: Buffer; type?: string; linkname?: string }>): Buffer {
  const out: Buffer[] = [];
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write(e.type ?? '0', 156);
    if (e.linkname) h.write(e.linkname, 157, 100);
    h.write('ustar\0', 257); h.write('00', 263);
    h.fill(0x20, 148, 156);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    out.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}
const tgz = (entries: Parameters<typeof tar>[0]) => zlib.gzipSync(tar(entries));

/** A synthetic stand-in for hand_landmarker.task: 2 leading bytes, then a ZIP of the two tflite entry names. */
const tfl = Buffer.concat([Buffer.alloc(4), Buffer.from('TFL3'), Buffer.alloc(64, 7)]);
const syntheticTaskModel = () => zip([{ name: 'hand_detector.tflite', data: tfl, method: 0 }, { name: 'hand_landmarks_detector.tflite', data: tfl, method: 0 }], { prefix: Buffer.from([0, 0]) });

// ------------------------------------------------------------------ tree helpers
function makeTree(status = 'PENDING_HUMAN_REVIEW') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r4-scan-'));
  const web = path.join(tmp, 'apps/web');
  fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
  fs.copyFileSync(SCANNER, path.join(web, 'scripts/check-palmistry-bundle.js'));
  fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
  fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), JSON.stringify({ status, approvedBy: status === 'APPROVED' ? { reviewer: 'FIXTURE', date: 'n/a' } : null }));
  const put = (rel: string, data: string | Buffer) => { const f = path.join(web, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };
  put('.next/static/chunks/main-1a2b.js', 'self.__next_f=[];console.log("app")');
  put('.next/server/app/page.js', 'module.exports={}');
  put('.next/standalone/server.js', 'require("next")');
  put('public/manifest.json', '{"name":"AuraSchedule"}');
  put('public/icon-192.png', png);
  const run = () => spawnSync(process.execPath, [path.join(web, 'scripts/check-palmistry-bundle.js')], { encoding: 'utf8', timeout: 60000 });
  const restore: string[] = [];
  const done = () => { for (const p of restore) { try { fs.chmodSync(p, 0o755); } catch { /* ignore */ } } fs.rmSync(tmp, { recursive: true, force: true }); };
  return { tmp, web, put, run, done, restore };
}
type Tree = ReturnType<typeof makeTree>;
function scenario(setup: (t: Tree) => unknown, status?: string) {
  const t = makeTree(status);
  try { setup(t); return t.run(); } finally { t.done(); }
}
const fails = (r: any, re?: RegExp) => r.status === 1 && !r.signal && (!re || re.test(r.stderr));
const passes = (r: any) => r.status === 0 && !r.signal;
const out = (r: any) => `exit=${r.status}${r.signal ? ` signal=${r.signal}` : ''} ${((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(0, 3).join(' | ').slice(0, 300)}`;

// ------------------------------------------------------------------ A. archive regression matrix
{
  const M: Array<[string, (t: Tree) => unknown, 'FAIL' | 'PASS', RegExp?]> = [
    ['ZIP containing MediaPipe runtime', (t) => t.put('public/a.zip', zip([{ name: 'rt.js', data: realBundle }])), 'FAIL', /archive entry.*a\.zip!rt\.js/],
    ['TGZ containing MediaPipe runtime', (t) => t.put('public/a.tgz', tgz([{ name: 'rt.js', data: realBundle }])), 'FAIL', /a\.tgz!rt\.js/],
    ['ZIP containing MediaPipe WASM', (t) => t.put('public/w.zip', zip([{ name: 'w.wasm', data: realWasm }])), 'FAIL', /WASM binary with MediaPipe symbol.*w\.zip!w\.wasm/],
    ['TGZ containing MediaPipe model', (t) => t.put('public/m.tgz', tgz([{ name: 'model.bin', data: syntheticTaskModel() }])), 'FAIL', /hand_detector\.tflite \(archive entry\)/],
    ['renamed ZIP with neutral extension (.woff2)', (t) => t.put('public/fonts/inter.woff2', zip([{ name: 'x', data: realBundle }])), 'FAIL', /inter\.woff2!x/],
    ['renamed TGZ with neutral extension (.png)', (t) => t.put('public/img/hero.png', tgz([{ name: 'x', data: realBundle }])), 'FAIL', /hero\.png!x/],
    ['nested ZIP containing runtime', (t) => t.put('public/n.zip', zip([{ name: 'inner.dat', data: zip([{ name: 'rt.js', data: realBundle }]) }])), 'FAIL', /n\.zip!inner\.dat!rt\.js/],
    ['nested TGZ containing model', (t) => t.put('public/n.tgz', tgz([{ name: 'inner.tgz', data: tgz([{ name: 'm.bin', data: syntheticTaskModel() }]) }])), 'FAIL', /n\.tgz!inner\.tgz!m\.bin/],
    ['archive beyond permitted nesting depth (benign payload)', (t) => { let a = zip([{ name: 'readme.txt', data: Buffer.from('hello') }]); for (let i = 0; i < 4; i++) a = zip([{ name: `l${i}.zip`, data: a }]); t.put('public/deep.zip', a); }, 'FAIL', /nested archive beyond the depth limit/],
    ['encrypted ZIP entry', (t) => t.put('public/e.zip', zip([{ name: 'a.txt', data: Buffer.from('hello'), flags: 0x1 }])), 'FAIL', /encrypted or password-protected/],
    ['truncated ZIP', (t) => { const z = zip([{ name: 'a.txt', data: Buffer.from('hello world '.repeat(50)) }]); t.put('public/t.zip', z.subarray(0, z.length - 30)); }, 'FAIL', /malformed or truncated ZIP/],
    ['corrupt TGZ', (t) => { const g = Buffer.from(tgz([{ name: 'a.txt', data: Buffer.from('hello world '.repeat(400)) }])); for (let i = 20; i < 60; i++) g[i] ^= 0xff; t.put('public/c.tgz', g); }, 'FAIL', /corrupt or truncated gzip|checksum|truncated tar/],
    ['decompression bomb / limit fixture (8 MiB of zeros in a ZIP)', (t) => t.put('public/bomb.zip', zip([{ name: 'z.bin', data: Buffer.alloc(8 * 1024 * 1024) }])), 'FAIL', /compression-ratio limit/],
    ['benign ZIP (JS, JSON, source map, image, docs, non-MediaPipe WASM)', (t) => t.put('public/ok.zip', zip([{ name: 'a.js', data: Buffer.from('console.log(1)') }, { name: 'b.json', data: Buffer.from('{"a":1}') }, { name: 'a.js.map', data: Buffer.from('{"version":3,"sources":["a.js"],"mappings":""}') }, { name: 'i.png', data: png, method: 0 }, { name: 'README.md', data: Buffer.from('Uses MediaPipe? No.') }, { name: 't.wasm', data: benignWasm }])), 'PASS'],
    ['benign TGZ', (t) => t.put('public/ok.tgz', tgz([{ name: 'pkg/', type: '5' }, { name: 'pkg/index.js', data: Buffer.from('module.exports=1') }, { name: 'pkg/package.json', data: Buffer.from('{"name":"x"}') }])), 'PASS'],
    ['benign nested archive within limits (depth 2)', (t) => t.put('public/okn.zip', zip([{ name: 'inner.tgz', data: tgz([{ name: 'a.txt', data: Buffer.from('fine') }]) }])), 'PASS'],
    ['ordinary non-MediaPipe WASM', (t) => t.put('public/t.wasm', benignWasm), 'PASS'],
    ['ordinary text mentioning MediaPipe', (t) => t.put('public/notes.txt', 'Palm input uses MediaPipe and @mediapipe/tasks-vision in development only.'), 'PASS'],
  ];
  for (const [label, setup, want, re] of M) {
    const r = scenario(setup);
    check(`A. [matrix] ${label} -> ${want}`, want === 'FAIL' ? fails(r, re) : passes(r), out(r));
  }
}

// ------------------------------------------------------------------ B. additional fail-closed structures and coverage
{
  const B: Array<[string, (t: Tree) => unknown, RegExp]> = [
    ['ZIP containing the Upload Photo implementation source', (t) => t.put('public/src.zip', zip([{ name: 'PalmImageInput.tsx', data: uiSource }])), /Check a palm photo|g5-i1-dev/],
    ['ZIP with an unsupported compression method (bzip2 = 12)', (t) => t.put('public/m.zip', zip([{ name: 'a.txt', data: Buffer.from('x'), method: 12 }])), /unsupported compression method 12/],
    ['ZIP with duplicate entry paths', (t) => t.put('public/d.zip', zip([{ name: 'a.js', data: Buffer.from('1') }, { name: 'a.js', data: Buffer.from('2') }])), /duplicate entry path/],
    ['ZIP with a ".." traversal entry path', (t) => t.put('public/p.zip', zip([{ name: '../../etc/x', data: Buffer.from('1') }])), /traversal/],
    ['ZIP with an absolute entry path', (t) => t.put('public/p2.zip', zip([{ name: '/etc/x', data: Buffer.from('1') }])), /absolute/],
    ['ZIP with local/central path mismatch (path confusion)', (t) => t.put('public/pc.zip', zip([{ name: 'a.txt', localName: 'b.txt', data: Buffer.from('1') }])), /path mismatch/],
    ['ZIP with a CRC mismatch', (t) => t.put('public/crc.zip', zip([{ name: 'a.txt', data: Buffer.from('hello'), crc: 1234 }])), /CRC mismatch/],
    ['ZIP whose entry inflates beyond its declared size', (t) => t.put('public/lie.zip', zip([{ name: 'a.txt', data: Buffer.from('hello world hello world'), usize: 5 }])), /size above declared|size mismatch/],
    ['ZIP hiding a deflated runtime in unreferenced bytes between entries', (t) => t.put('public/h.zip', zip([{ name: 'a.txt', data: Buffer.from('a') }, { name: 'b.txt', data: Buffer.from('b') }], { gapAfterFirst: zlib.deflateRawSync(realBundle) })), /unreferenced bytes/],
    ['ZIP with a symlink entry', (t) => t.put('public/l.zip', zip([{ name: 'link', data: Buffer.from('/etc/passwd'), extAttr: (0o120777 << 16) >>> 0 }])), /link entry/],
    ['TAR with a symlink entry', (t) => t.put('public/l.tgz', tgz([{ name: 'link', type: '2', linkname: '/etc/passwd' }])), /link entry/],
    ['TAR with a device entry', (t) => t.put('public/dev.tgz', tgz([{ name: 'null', type: '3' }])), /unsupported tar entry type/],
    ['TAR with a bad header checksum', (t) => { const tb = tar([{ name: 'a.txt', data: Buffer.from('x') }]); tb[0] ^= 0x01; t.put('public/bad.tar', zlib.gzipSync(tb)); }, /checksum mismatch/],
    ['truncated TAR (no end-of-archive marker)', (t) => { const tb = tar([{ name: 'a.txt', data: Buffer.from('x') }]); t.put('public/tr.tgz', zlib.gzipSync(tb.subarray(0, 1024))); }, /truncated tar/],
    ['uncompressed TAR containing a deflated nested ZIP with the runtime', (t) => t.put('public/x.tar', tar([{ name: 'inner.bin', data: zip([{ name: 'rt.js', data: realBundle }]) }])), /x\.tar!inner\.bin!rt\.js/],
    ['prefixed ZIP layout (as hand_landmarker.task) with the runtime', (t) => t.put('public/pre.bin', zip([{ name: 'rt.js', data: realBundle }], { prefix: Buffer.from([0, 0]) })), /pre\.bin!rt\.js/],
    ['single gzip stream of the runtime (not tar)', (t) => t.put('public/rt.js.gz', zlib.gzipSync(realBundle)), /gzip stream/],
  ];
  for (const [label, setup, re] of B) {
    const r = scenario(setup);
    check(`B. ${label} -> FAIL`, fails(r, re), out(r));
  }
  let r = scenario((t) => t.put('public/okpre.bin', zip([{ name: 'a.txt', data: Buffer.from('fine') }], { prefix: Buffer.from([0, 0]) })));
  check('B. benign prefixed ZIP layout -> PASS', passes(r), out(r));
  r = scenario((t) => t.put('public/a.zip', zip([{ name: 'rt.js', data: realBundle }])), 'APPROVED');
  check('B. content APPROVED: ZIP with the runtime still FAILS', fails(r, /a\.zip!rt\.js/), out(r));
  r = scenario((t) => t.put('public/a.zip', zip([{ name: 'rt.js', data: realBundle }])), 'HIDDEN');
  check('B. content HIDDEN: ZIP with the runtime still FAILS', fails(r, /a\.zip!rt\.js/), out(r));
}

// ------------------------------------------------------------------ C. archive resource limits
{
  const inspect = scannerModule.inspectArtifacts as undefined | ((root: string, limits?: any) => { hits: any[]; errors: any[]; stats: any });
  check('C0. scanner exposes archive limits', !!scannerModule.INSPECTION_LIMITS && ['maxArchiveBytes', 'maxArchiveEntryBytes', 'maxArchiveDecompressedBytes', 'maxTotalDecompressedBytes', 'maxCompressionRatio', 'maxArchiveEntries', 'maxNestedArchiveDepth', 'maxScanMs'].every((k) => typeof scannerModule.INSPECTION_LIMITS[k] === 'number'));
  if (typeof inspect === 'function') {
    const L = scannerModule.INSPECTION_LIMITS;
    const err = (res: any, re: RegExp) => res.errors.some((e: any) => re.test(e.error));
    const withTree = (setup: (t: Tree) => void, fn: (t: Tree) => void) => { const t = makeTree(); try { setup(t); fn(t); } finally { t.done(); } };
    const bigText = Buffer.from('lorem ipsum dolor sit amet '.repeat(20000)); // ~540 KB, compresses well but < ratio limit check size
    withTree((t) => t.put('public/a.zip', zip([{ name: 'a.txt', data: bigText }])), (t) => {
      check('C1. individual archive size limit -> blocking error', err(inspect(t.web, { ...L, maxArchiveBytes: 1000 }), /archive too large to inspect/));
      check('C2. individual decompressed entry size limit -> blocking error', err(inspect(t.web, { ...L, maxArchiveEntryBytes: 100000 }), /decompressed entry-size limit/));
      check('C3. per-archive decompressed-bytes limit -> blocking error', err(inspect(t.web, { ...L, maxArchiveDecompressedBytes: 100000 }), /per-archive decompressed-bytes limit/));
      check('C4. total decompressed-bytes limit -> blocking error', err(inspect(t.web, { ...L, maxTotalDecompressedBytes: 100000 }), /total decompressed-bytes limit/));
      check('C5. scan work-time budget -> blocking error', err(inspect(t.web, { ...L, maxScanMs: -1 }), /work-time budget/));
    });
    withTree((t) => t.put('public/many.zip', zip(Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from(String(i)) })))), (t) => {
      check('C6. archive entry-count limit -> blocking error', err(inspect(t.web, { ...L, maxArchiveEntries: 10 }), /entry-count limit/));
      check('C7. overall file-count limit includes archive entries -> blocking error', err(inspect(t.web, { ...L, maxFiles: 15 }), /file-count limit/));
    });
    withTree((t) => t.put('public/r.zip', zip([{ name: 'z.bin', data: Buffer.alloc(2 * 1024 * 1024, 0x41) }])), (t) => {
      check('C8. compression-ratio limit -> blocking error', err(inspect(t.web, { ...L, maxCompressionRatio: 50 }), /compression-ratio limit/));
    });
    withTree((t) => t.put('public/g.gz', zlib.gzipSync(Buffer.alloc(3 * 1024 * 1024, 0x42))), (t) => {
      check('C9. gzip stream decompressed-size limit -> blocking error', err(inspect(t.web, { ...L, maxArchiveEntryBytes: 1024 * 1024 }), /decompressed-size limit exceeded for gzip/));
    });
    withTree((t) => t.put('public/n.zip', zip([{ name: 'i.zip', data: zip([{ name: 'a.txt', data: Buffer.from('x') }]) }])), (t) => {
      check('C10. nested-depth limit is configurable and enforced (depth 1 -> nested ZIP is an error)', err(inspect(t.web, { ...L, maxNestedArchiveDepth: 1 }), /nested archive beyond the depth limit \(1\)/));
      const res = inspect(t.web);
      check('C11. stats count archives, entries and decompressed bytes actually inspected', res.errors.length === 0 && res.stats.archives === 2 && res.stats.archiveEntries === 2 && res.stats.decompressedBytes > 0 && res.stats.archiveCompressedBytes > 0, JSON.stringify(res.stats));
    });
    // Memory: a 40 MiB benign entry is inspected within the documented bound.
    withTree((t) => t.put('public/big.zip', zip([{ name: 'b.bin', data: Buffer.from(Array.from({ length: 40 * 1024 * 1024 }, (_, i) => (i * 2654435761) >>> 24)) }])), (t) => {
      const before = process.memoryUsage().rss;
      const res = inspect(t.web);
      const grew = (process.memoryUsage().rss - before) / 1048576;
      check('C12. 40 MiB entry inspected without error; RSS growth within the documented bound (< maxArchiveBytes + maxArchiveEntryBytes)', res.errors.length === 0 && grew < 128 + 16, `rss+${grew.toFixed(1)} MiB errors=${JSON.stringify(res.errors)}`);
    });
  }
}

// ------------------------------------------------------------------ D. scan-root contract (R3-N3)
{
  let r = scenario(() => undefined);
  check('D1. valid root directories -> PASS', passes(r), out(r));
  r = scenario((t) => { fs.rmSync(path.join(t.web, 'public'), { recursive: true }); t.put('assets-real/icon.png', png); fs.symlinkSync('./assets-real', path.join(t.web, 'public')); });
  check('D2. valid internal root symlink (public -> ./assets-real inside apps/web) -> PASS', passes(r), out(r));
  r = scenario((t) => { fs.rmSync(path.join(t.web, 'public'), { recursive: true }); fs.symlinkSync('./does-not-exist', path.join(t.web, 'public')); });
  check('D3. broken root symlink -> FAIL (not treated as absent)', fails(r, /scan root is a broken symlink/), out(r));
  r = scenario((t) => { fs.rmSync(path.join(t.web, 'public'), { recursive: true }); const ext = path.join(t.tmp, 'external'); fs.mkdirSync(ext); fs.writeFileSync(path.join(ext, 'a.txt'), 'x'); fs.symlinkSync(ext, path.join(t.web, 'public')); });
  check('D4. external root symlink -> FAIL', fails(r, /points outside the app directory/), out(r));
  r = scenario((t) => fs.rmSync(path.join(t.web, '.next/static'), { recursive: true }));
  check('D5. missing required root (.next/static) -> FAIL', fails(r, /required scan root missing/), out(r));
  r = scenario((t) => fs.rmSync(path.join(t.web, '.next/static'), { recursive: true }), 'APPROVED');
  check('D5b. missing required root fails even when content is APPROVED', fails(r, /required scan root missing/), out(r));
  r = scenario((t) => fs.rmSync(path.join(t.web, 'public'), { recursive: true }));
  check('D6. missing documented optional root (public) -> PASS, reported as absent', passes(r) && /absent optional roots: public/.test(r.stdout), out(r));
  r = scenario((t) => { const p = path.join(t.web, 'public'); fs.chmodSync(p, 0o000); t.restore.push(p); });
  check('D7. permission-denied root -> FAIL', fails(r, /scan root inaccessible|unreadable directory/), out(r));
  r = scenario((t) => { fs.rmSync(path.join(t.web, 'public'), { recursive: true }); fs.symlinkSync('public', path.join(t.web, 'public')); });
  check('D8. root symlink loop -> FAIL', fails(r, /symlink loop/), out(r));
  r = scenario((t) => { fs.rmSync(path.join(t.web, 'public'), { recursive: true }); fs.writeFileSync(path.join(t.web, 'public'), 'not a dir'); });
  check('D9. root that is not a directory -> FAIL', fails(r, /not a directory/), out(r));
}

// ------------------------------------------------------------------ E. special filesystem objects (R3-N4)
{
  let r = scenario((t) => { t.put('public/a.txt', 'x'); fs.mkdirSync(path.join(t.web, 'public/dir')); fs.symlinkSync('a.txt', path.join(t.web, 'public/link.txt')); });
  check('E1. regular file, directory and internal symlink -> PASS', passes(r), out(r));
  r = scenario((t) => execFileSync('mkfifo', [path.join(t.web, 'public/pipe')]));
  check('E2. FIFO -> FAIL, never opened (scanner completes, no hang)', fails(r, /unsupported filesystem object: FIFO/), out(r));
  r = scenario((t) => { execFileSync('mkfifo', [path.join(t.web, 'public/pipe2')]); fs.symlinkSync('pipe2', path.join(t.web, 'public/to-pipe')); });
  check('E3. symlink to a FIFO -> FAIL, never opened', fails(r, /FIFO/), out(r));
  // Unix-domain socket: created by a child Node process that keeps listening while we scan.
  {
    const t = makeTree();
    try {
      const sock = path.join(t.web, 'public/s.sock');
      const child = spawnSync(process.execPath, ['-e', `const n=require('net');const s=n.createServer();s.listen(${JSON.stringify(sock)},()=>{s.close=()=>{};process.exit(0)});`], { encoding: 'utf8', timeout: 10000 });
      if (fs.existsSync(sock) && fs.lstatSync(sock).isSocket()) {
        const rr = t.run();
        check('E4. Unix-domain socket -> FAIL, never connected', fails(rr, /Unix-domain socket/), out(rr));
      } else {
        notRun.push('E4 Unix-domain socket (socket file not created on this host)');
        console.log(`NOT RUN E4. Unix-domain socket (host could not create the fixture: ${child.stderr || child.status})`);
      }
    } finally { t.done(); }
    void net;
  }
  notRun.push('E5 device node (creating one needs elevated privileges; not attempted)');
  console.log('NOT RUN E5. unsupported device-node fixture (mknod requires elevated privileges; covered by code review: block/character devices fall into the same non-file/non-directory branch as E2-E4)');
  r = scenario((t) => { const f = t.put('public/secret.bin', 'x'); fs.chmodSync(f, 0o000); t.restore.push(f); });
  check('E6. permission-denied file -> FAIL (blocking, not skipped)', fails(r, /unreadable/), out(r));
}

// ------------------------------------------------------------------ F. coverage wording (R3-N6)
{
  const src = fs.readFileSync(SCANNER, 'utf8');
  check('F1. scanner header states what is NOT detected (encodings / signature-based)', /does NOT guarantee/.test(src) && /signature-based/.test(src));
  check('F2. scanner documents supported archive formats, nesting depth and fail-closed conditions', /ZIP, GZIP/.test(src) && /maxNestedArchiveDepth/.test(src) && /FAIL-CLOSED/.test(src));
  check('F3. no over-claiming phrase "whatever its format" remains', !/whatever its (name, extension or )?format/.test(src));
  check('F4. scanner documents the Docker integration gap (R2-N5) and platform packaging limits', /R2-N5/.test(src) && /post-build packaging/.test(src));
  const r = scenario(() => undefined);
  check('F5. OK line reports archives, entries, decompressed bytes and the signature-based limitation', passes(r) && /archive\(s\) with \d+ entr\(ies\)/.test(r.stdout) && /MiB decompressed/.test(r.stdout) && /encoded\/transformed payloads are not detected/.test(r.stdout), out(r));
}

console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join('; ')})` : ''}`);
process.exit(failed > 0 ? 1 : 0);
