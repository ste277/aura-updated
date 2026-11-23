/**
 * AURA-PALM-G5-I1-R3 -- production scanner hardening (R2-N1, R2-N2).
 *
 * Runs the REAL scanner CLI (apps/web/scripts/check-palmistry-bundle.js, or
 * the file named by PALM_SCANNER_UNDER_TEST for negative controls) against
 * throwaway build trees, plus its inspectArtifacts() API for limits.
 *
 *   A. evidence pinning of the content signatures
 *   B. R2-N1: prohibited content in public/ and other artifact roots,
 *      whatever the file name or extension
 *   C. R2-N2: symlinks (8 required cases)
 *   D. R2-N2: source maps
 *   E. false positives on ordinary assets
 *   F. bounded inspection (limits, chunk boundaries)
 *   G. R2-N4 fixture (alternative import spelling)
 *   H. independence from Palmistry content approval
 *
 * Fixtures use only the already-installed MediaPipe package, synthetic files
 * and Aura's own source. No network. No real palm images.
 *
 * Run: npx ts-node test/palmG5I1R3ScannerHardening.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const MP = path.join(WEB, 'node_modules/@mediapipe/tasks-vision');
const SCANNER = process.env.PALM_SCANNER_UNDER_TEST || path.join(WEB, 'scripts/check-palmistry-bundle.js');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); }
}

/* eslint-disable @typescript-eslint/no-var-requires */
const scannerModule: any = require(SCANNER);

const realBundle = fs.readFileSync(path.join(MP, 'vision_bundle.mjs'));
const realLoader = fs.readFileSync(path.join(MP, 'wasm/vision_wasm_internal.js'));
const realWasm = fs.readFileSync(path.join(MP, 'wasm/vision_wasm_nosimd_internal.wasm'));
const uiSource = fs.readFileSync(path.join(WEB, 'components/palm-scan/PalmImageInput.tsx'));

/** A synthetic stand-in for hand_landmarker.task: 2 leading bytes (as in the real file), then a zip whose entries are the two tflite models. */
function syntheticTaskModel(): Buffer {
  const entry = (name: string, body: Buffer) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(22), Buffer.from([name.length, 0, 0, 0]), Buffer.from(name), body]);
  const tfl = Buffer.concat([Buffer.alloc(4), Buffer.from('TFL3'), Buffer.alloc(64, 7)]);
  return Buffer.concat([Buffer.from([0, 0]), entry('hand_detector.tflite', tfl), entry('hand_landmarks_detector.tflite', tfl)]);
}
const minimalBenignWasm = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

// ------------------------------------------------------------------ tree helpers
function makeTree(status = 'PENDING_HUMAN_REVIEW') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r3-scan-'));
  const web = path.join(tmp, 'apps/web');
  fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
  fs.copyFileSync(SCANNER, path.join(web, 'scripts/check-palmistry-bundle.js'));
  fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
  fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), JSON.stringify({ status, approvedBy: status === 'APPROVED' ? { reviewer: 'FIXTURE', date: 'n/a' } : null }));
  const put = (rel: string, data: string | Buffer) => { const f = path.join(web, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };
  // A small but realistic benign build.
  put('.next/static/chunks/main-1a2b.js', 'self.__next_f=[];console.log("app")');
  put('.next/static/css/app.css', 'body{margin:0}');
  put('.next/server/app/page.js', 'module.exports={}');
  put('.next/standalone/server.js', 'require("next")');
  put('.next/standalone/package.json', JSON.stringify({ dependencies: { '@mediapipe/tasks-vision': '1.2.0', next: '14.2.35' } })); // dependency line: must NOT match
  put('public/manifest.json', '{"name":"AuraSchedule"}');
  put('public/sw.js', 'self.addEventListener("fetch",()=>{})');
  put('public/icon-192.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256, 3)]));
  const link = (rel: string, target: string) => { const f = path.join(web, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.symlinkSync(target, f); return f; };
  const run = () => spawnSync(process.execPath, [path.join(web, 'scripts/check-palmistry-bundle.js')], { encoding: 'utf8' });
  const done = () => fs.rmSync(tmp, { recursive: true, force: true });
  return { tmp, web, put, link, run, done };
}

/** Run one fixture in a fresh tree; returns the CLI result. */
function scenario(setup: (t: ReturnType<typeof makeTree>) => void, status?: string) {
  const t = makeTree(status);
  try { setup(t); return t.run(); } finally { t.done(); }
}
const fails = (r: any, re?: RegExp) => r.status === 1 && (!re || re.test(r.stderr));
const passes = (r: any) => r.status === 0;
const out = (r: any) => `exit=${r.status} ${(r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' | ')}`;

// ------------------------------------------------------------------ A. evidence pinning
{
  const sigs: string[] = scannerModule.MEDIAPIPE_ARTIFACT_SIGNATURES ?? [];
  check('A0. scanner defines content-based artifact signatures', sigs.length >= 3);
  const markers: string[] = scannerModule.WASM_MEDIAPIPE_MARKERS ?? [];
  check('A1. every WASM MediaPipe marker occurs in all three real MediaPipe WASM binaries', markers.length > 0 && ['vision_wasm_internal.wasm', 'vision_wasm_module_internal.wasm', 'vision_wasm_nosimd_internal.wasm'].every((f) => markers.every((m) => fs.readFileSync(path.join(MP, 'wasm', f)).includes(m))));
  check('A2. the real WASM loader JS carries a scanner signature', realLoader.includes('_mediapipeLoggerGetEncodedApiKey'));
  check('A3. the dependency declaration form is not a signature (no false positive on package.json)', sigs.every((s) => !'"@mediapipe/tasks-vision": "1.2.0"'.includes(s)));
  check('A4. model entry-name signatures are the documented hand_landmarker.task entries', sigs.includes('hand_detector.tflite') && sigs.includes('hand_landmarks_detector.tflite'));
}

// ------------------------------------------------------------------ B. R2-N1 public/ and artifact content
{
  const cases: Array<[string, (t: ReturnType<typeof makeTree>) => void]> = [
    ['real MediaPipe bundle in public/ as lib.txt', (t) => t.put('public/lib.txt', realBundle)],
    ['real MediaPipe bundle in public/ as an image name', (t) => t.put('public/img/hero.png', realBundle)],
    ['real MediaPipe bundle in public/ with no extension', (t) => t.put('public/vendor/runtime', realBundle)],
    ['MediaPipe bundle embedded inside another JS file', (t) => t.put('public/app.bundle.js', Buffer.concat([Buffer.from('/*app*/var a=1;\n'), realBundle, Buffer.from('\nvar b=2;')]))],
    ['real WASM loader JS renamed in public/', (t) => t.put('public/js/loader.js', realLoader)],
    ['real MediaPipe WASM renamed to .dat in public/', (t) => t.put('public/data/blob.dat', realWasm)],
    ['real MediaPipe WASM renamed in .next/static/media', (t) => t.put('.next/static/media/a1b2.bin', realWasm)],
    ['hand model bundle (synthetic .task layout) renamed to .bin in public/', (t) => t.put('public/models/m.bin', syntheticTaskModel())],
    ['raw TFLite model (TFL3 identifier) in public/', (t) => t.put('public/models/x.dat', Buffer.concat([Buffer.alloc(4), Buffer.from('TFL3'), Buffer.alloc(100)]))],
    ['Aura upload UI source text in a neutral public file', (t) => t.put('public/notes.txt', uiSource)],
    ['MediaPipe bundle inside standalone node_modules under another name', (t) => t.put('.next/standalone/node_modules/vendored-lib/index.js', realBundle)],
  ];
  for (const [label, setup] of cases) {
    const r = scenario(setup);
    check(`B. [R2-N1] scanner FAILS on: ${label}`, fails(r), out(r));
  }
}

// ------------------------------------------------------------------ C. R2-N2 symlinks
{
  // 1. symlink to prohibited JavaScript (target inside another approved root)
  let r = scenario((t) => { t.put('.next/server/chunks/rt.js', realBundle); t.link('public/runtime.js', '../.next/server/chunks/rt.js'); });
  check('C1. symlink to prohibited JS (inside the scan roots) is followed and detected', fails(r, /public\/runtime\.js|rt\.js/), out(r));
  r = scenario((t) => { const v = path.join(t.web, 'vendor'); fs.mkdirSync(v); fs.writeFileSync(path.join(v, 'rt.js'), realBundle); t.link('public/runtime.js', '../vendor/rt.js'); });
  check('C1b. symlink to prohibited JS outside the scan roots fails closed (blocking scan error)', fails(r, /outside the approved scan roots/), out(r));
  // 2. symlink to prohibited WASM
  r = scenario((t) => { t.put('.next/static/media/x.dat', realWasm); t.link('public/w.dat', '../.next/static/media/x.dat'); });
  check('C2. symlink to prohibited WASM is followed and detected', fails(r, /WASM binary with MediaPipe symbol/), out(r));
  // 3. symlinked directory containing MediaPipe assets
  r = scenario((t) => { t.put('.next/server/blobs/a.bin', realWasm); t.put('.next/server/blobs/b.bin', syntheticTaskModel()); t.link('public/assets', '../.next/server/blobs'); });
  check('C3. symlinked directory with MediaPipe assets (inside roots) is traversed and detected', fails(r, /WASM binary with MediaPipe symbol|hand_detector\.tflite/), out(r));
  r = scenario((t) => { const d = path.join(t.tmp, 'elsewhere/mp'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'blob.bin'), realWasm); t.link('.next/standalone/assets', path.join(t.tmp, 'elsewhere/mp')); });
  check('C3b. symlinked directory outside the scan roots fails closed', fails(r, /outside the approved scan roots/), out(r));
  // 4. symlink loop and directory cycle
  r = scenario((t) => { t.link('public/a', 'b'); t.link('public/b', 'a'); });
  check('C4. symlink loop is a blocking scan error (no hang)', fails(r, /symlink loop/), out(r));
  r = scenario((t) => { t.put('public/sub/file.txt', 'x'); t.link('public/sub/up', '..'); });
  check('C4b. directory cycle (link to an ancestor) is a blocking scan error', fails(r, /symlink cycle/), out(r));
  // 5. broken symlink
  r = scenario((t) => { t.link('public/missing.js', 'does-not-exist.js'); });
  check('C5. broken symlink is a deterministic blocking scan error', fails(r, /broken symlink/), out(r));
  const r5b = scenario((t) => { t.link('public/missing.js', 'does-not-exist.js'); });
  check('C5b. ...and deterministic across runs', r5b.status === r.status && r5b.stderr === r.stderr);
  // 6. symlink outside scan root (absolute path to an unrelated, benign location)
  r = scenario((t) => { const d = path.join(t.tmp, 'unrelated'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'readme.txt'), 'hello'); t.link('public/ext', d); });
  check('C6. symlink to an unrelated location outside the roots fails closed even if benign', fails(r, /outside the approved scan roots/), out(r));
  // 7. benign internal symlink
  r = scenario((t) => { t.link('public/icon-alias.png', 'icon-192.png'); });
  check('C7. benign internal symlink passes, and is reported as followed', passes(r) && /1 symlink\(s\) followed/.test(r.stdout), out(r));
  // 8. repeated references to the same file
  r = scenario((t) => { t.link('public/i1.png', 'icon-192.png'); t.link('public/i2.png', 'icon-192.png'); t.link('public/i3.png', 'i1.png'); });
  check('C8. repeated references to one benign file: inspected once, passes, repeats counted', passes(r) && /3 repeated reference\(s\)/.test(r.stdout), out(r));
  r = scenario((t) => { t.put('public/a/rt.txt', realBundle); t.link('public/b1', 'a/rt.txt'); t.link('public/b2', 'a/rt.txt'); });
  check('C8b. repeated references to one prohibited file still FAIL', fails(r, /odml\.pa\.googleapis\.com/), out(r));
}

// ------------------------------------------------------------------ D. R2-N2 source maps
{
  const map = (sources: string[], sourcesContent?: (string | null)[]) => JSON.stringify({ version: 3, file: 'x.js', sources, ...(sourcesContent ? { sourcesContent } : {}), mappings: 'AAAA' });
  const mpSrc = realBundle.toString('utf8');
  let r = scenario((t) => t.put('.next/static/chunks/913.js.map', map(['webpack://_N_E/./src/x.js'], [mpSrc])));
  check('D1. MediaPipe runtime embedded in sourcesContent is detected', fails(r, /HandLandmarkerGraph|odml/), out(r));
  r = scenario((t) => t.put('.next/static/chunks/page.js.map', map(['webpack://_N_E/./components/palm-scan/x.tsx'], [uiSource.toString('utf8')])));
  check('D2. prohibited Aura image-input source in sourcesContent is detected', fails(r, /Check a palm photo|g5-i1-dev/), out(r));
  r = scenario((t) => t.put('.next/static/chunks/1.js.map', map(['webpack://_N_E/./node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'])));
  check('D3. MediaPipe package path in map "sources" metadata is detected', fails(r, /node_modules\/@mediapipe\//), out(r));
  r = scenario((t) => t.put('public/debug/info.json', map(['webpack://_N_E/./node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'], [mpSrc])));
  check('D4. renamed source map (.json in public/) is detected', fails(r), out(r));
  r = scenario((t) => t.put('.next/static/chunks/bad.js.map', `{"version":3,"sourcesContent":["${'x'.repeat(100)}odml.pa.googleapis.com`));
  check('D5. malformed (truncated) map carrying a signature is detected (byte scan, no parse)', fails(r, /odml/), out(r));
  r = scenario((t) => t.put('.next/static/chunks/bad2.js.map', '{"version":3,"sources":["a.js"'));
  check('D5b. malformed benign map does not crash the scanner and passes', passes(r), out(r));
  r = scenario((t) => { const big = Buffer.alloc(24 * 1024 * 1024, 0x61); Buffer.from('hand_landmarks_detector.tflite').copy(big, 1024 * 1024 - 10); t.put('.next/static/chunks/huge.js.map', Buffer.concat([Buffer.from('{"version":3,"sourcesContent":["'), big, Buffer.from('"]}')])); });
  check('D6. large (24 MiB) map with a signature straddling a 1 MiB chunk boundary is detected', fails(r, /hand_landmarks_detector\.tflite/), out(r));
  r = scenario((t) => t.put('.next/static/chunks/main.js.map', map(['webpack://_N_E/./app/page.tsx'], ['// This app does not use MediaPipe or @mediapipe/tasks-vision.\nexport default function Page(){return null}'])));
  check('D7. benign source map that merely mentions MediaPipe in prose passes', passes(r), out(r));
}

// ------------------------------------------------------------------ E. false positives
{
  let r = scenario(() => undefined);
  check('E1. ordinary benign build (icons, manifest, sw.js, CSS, standalone package.json listing the dependency) passes', passes(r), out(r));
  r = scenario((t) => t.put('public/tiny.wasm', minimalBenignWasm));
  check('E2. a benign non-MediaPipe WASM module passes', passes(r), out(r));
  r = scenario((t) => t.put('public/docs.txt', 'Palm image input uses MediaPipe in development only. See @mediapipe/tasks-vision docs.'));
  check('E3. prose mentioning MediaPipe and the package name passes (no word-level rule)', passes(r), out(r));
  r = scenario((t) => t.put('public/random.bin', Buffer.from(Array.from({ length: 65536 }, (_, i) => (i * 2654435761) & 0xff))));
  check('E4. arbitrary binary data without a format header passes', passes(r), out(r));
  check('E5. there is no allowlist or exemption for public/ in the scanner', !/allowlist|exempt/i.test(fs.readFileSync(SCANNER, 'utf8').replace(/\/\/.*$/gm, '')));
}

// ------------------------------------------------------------------ F. bounded inspection
{
  const inspect = scannerModule.inspectArtifacts as undefined | ((root: string, limits?: any) => { hits: any[]; errors: any[]; stats: any });
  check('F0. scanner exposes inspectArtifacts with explicit limits', typeof inspect === 'function' && !!scannerModule.INSPECTION_LIMITS);
  if (typeof inspect === 'function') {
    const base = scannerModule.INSPECTION_LIMITS;
    const t = makeTree();
    try {
      t.put('public/big.bin', Buffer.alloc(5000, 1));
      let res = inspect(t.web, { ...base, maxFileBytes: 4096 });
      check('F1. file larger than maxFileBytes is a blocking error (not skipped)', res.errors.some((e: any) => /too large/.test(e.error)));
      res = inspect(t.web, { ...base, maxFiles: 3 });
      check('F2. file-count limit is enforced as a blocking error', res.errors.some((e: any) => /file-count limit/.test(e.error)));
      res = inspect(t.web, { ...base, maxTotalBytes: 2000 });
      check('F3. total-bytes limit is enforced as a blocking error', res.errors.some((e: any) => /total-bytes limit/.test(e.error)));
      t.put('public/a/b/c/d/e/f.txt', 'x');
      res = inspect(t.web, { ...base, maxDepth: 3 });
      check('F4. depth limit is enforced as a blocking error', res.errors.some((e: any) => /depth limit/.test(e.error)));
      t.put('public/edge.txt', Buffer.concat([Buffer.alloc(13, 0x20), Buffer.from('odml.pa.googleapis.com'), Buffer.alloc(13, 0x20)]));
      res = inspect(t.web, { ...base, chunkBytes: 16 });
      check('F5. a signature split across tiny 16-byte chunks is still found (overlap correct)', res.hits.some((h: any) => h.file.endsWith('edge.txt') && /odml/.test(h.sentinel)));
      res = inspect(t.web);
      check('F6. stats report what was actually inspected (files, bytes, roots)', res.stats.files >= 8 && res.stats.bytes > 0 && res.stats.roots.includes('public') && res.stats.roots.includes('.next/standalone'));
    } finally { t.done(); }
  }
}

// ------------------------------------------------------------------ G. R2-N4 fixture
{
  // If an alternative import spelling (e.g. './palm-scan/./PalmImageInput')
  // slipped past the build swap, the real component would be compiled into a
  // chunk. Its text then carries the UI sentinels; MediaPipe stays aliased
  // empty. A real build of exactly this case is recorded in the R3 evidence.
  const r = scenario((t) => t.put('.next/static/chunks/app/page-alt.js', uiSource));
  check('G1. upload UI compiled via an unswapped import path is caught by content sentinels', fails(r, /Check a palm photo|g5-i1-dev|palm-dev-assets/), out(r));
}

// ------------------------------------------------------------------ H. independent of content approval
{
  for (const status of ['APPROVED', 'HIDDEN']) {
    let r = scenario((t) => t.put('public/lib.txt', realBundle), status);
    check(`H1. [${status}] renamed bundle in public/ still FAILS`, fails(r), out(r));
    r = scenario((t) => { const v = path.join(t.web, 'vendor'); fs.mkdirSync(v); fs.writeFileSync(path.join(v, 'rt.js'), realBundle); t.link('public/runtime.js', '../vendor/rt.js'); }, status);
    check(`H2. [${status}] out-of-root symlink still FAILS`, fails(r), out(r));
    r = scenario((t) => t.put('.next/static/chunks/913.js.map', JSON.stringify({ version: 3, sources: ['x'], sourcesContent: [realBundle.toString('utf8')] })), status);
    check(`H3. [${status}] source map with the runtime still FAILS`, fails(r), out(r));
  }
  const r = scenario(() => undefined, 'APPROVED');
  check('H4. APPROVED benign build: existing inclusion message preserved, image-input inspection reported', passes(r) && /content APPROVED -- inclusion allowed/.test(r.stdout) && /Image-input exclusion checked independently: OK; inspected \d+ file/.test(r.stdout), out(r));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
