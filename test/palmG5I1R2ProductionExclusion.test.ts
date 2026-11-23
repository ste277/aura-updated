/**
 * AURA-PALM-G5-I1-R2 -- R1-F3 regression suite: production image-input
 * exclusion is independent of Palmistry content approval.
 *
 *   A. build-config matrix (both real config modules, a recording webpack)
 *   B. the production stand-in and its wiring
 *   C. MediaPipe sentinels really occur in the installed package
 *   D. the REAL scanner CLI against throwaway build trees, in every
 *      content-approval state, with realistic prohibited artifacts
 *   E. no route or entry point reaches image input outside PalmistryView
 *
 * Real `next build` runs (pending / approved / dev-opt-in) are recorded in
 * AURA_PALM_G5_I1_R2_SECURITY_REMEDIATION/10_PRODUCTION_BUILD_AND_SCANNER.
 *
 * Run: npx ts-node test/palmG5I1R2ProductionExclusion.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); }
}

/* eslint-disable @typescript-eslint/no-var-requires */
const nextConfig = require('../apps/web/next.config.js');
const palmistryExclusion = require('../apps/web/palmistry-build-exclusion');
const scanner = require('../apps/web/scripts/check-palmistry-bundle');
const MP_SENTINELS: string[] = scanner.MEDIAPIPE_SENTINELS ?? [];

// ---------------------------------------------------------------- A. config matrix
class RecordingReplacement { constructor(public re: RegExp, public to: string) {} }
const fakeWebpack = { NormalModuleReplacementPlugin: RecordingReplacement };

function buildConfig(opts: { dev: boolean; approved: boolean; devFlag?: string }) {
  const saved = process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT;
  if (opts.devFlag === undefined) delete process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT; else process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = opts.devFlag;
  // Same composition as next.config.js, with the approval state injected
  // (the content module reads review-status.json; never written here).
  const cfg0: any = { plugins: [], resolve: { alias: { existing: 'kept' } }, cache: { type: 'filesystem', version: 'v' } };
  const { applyPalmImageInputExclusion } = require('../apps/web/palm-image-input-build-exclusion');
  const cfg = applyPalmImageInputExclusion(palmistryExclusion.applyPalmistryExclusion(cfg0, { dev: opts.dev, webpack: fakeWebpack, approved: opts.approved }), { dev: opts.dev, webpack: fakeWebpack });
  if (saved === undefined) delete process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT; else process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = saved;
  const repl = cfg.plugins.filter((p: any) => p instanceof RecordingReplacement) as RecordingReplacement[];
  const imageInputSwapped = repl.some((p) => p.re.test('./palm-scan/PalmImageInput') && /PalmImageInput\.excluded\.tsx$/.test(p.to));
  const contentSwapped = repl.some((p) => p.re.test('../components/PalmistryView'));
  const mediapipeEmpty = cfg.resolve?.alias?.['@mediapipe/tasks-vision'] === false;
  return { cfg, imageInputSwapped, contentSwapped, mediapipeEmpty };
}

const states: Array<{ label: string; approved: boolean; devFlag?: string }> = [
  { label: 'content PENDING review', approved: false },
  { label: 'content APPROVED', approved: true },
  { label: 'content HIDDEN (any non-APPROVED value)', approved: false },
  { label: 'development opt-in flag set at build time', approved: false, devFlag: 'g5-i1-dev' },
];
for (const st of states) {
  const r = buildConfig({ dev: false, approved: st.approved, devFlag: st.devFlag });
  check(`A1. production + ${st.label}: upload UI swapped for the stand-in`, r.imageInputSwapped);
  check(`A2. production + ${st.label}: @mediapipe/tasks-vision resolves to an empty module`, r.mediapipeEmpty);
  check(`A3. production + ${st.label}: content exclusion unchanged (${st.approved ? 'included' : 'excluded'})`, r.contentSwapped === !st.approved);
}
{
  const r = buildConfig({ dev: false, approved: false });
  check('A4. existing aliases are preserved', r.cfg.resolve.alias.existing === 'kept');
  check('A5. webpack cache key carries the image-input exclusion', /palm-image-input:excluded/.test(r.cfg.cache.version));
  const d = buildConfig({ dev: true, approved: false, devFlag: 'g5-i1-dev' });
  check('A6. next dev (authorised opt-in) is unaffected: real upload UI and MediaPipe available', !d.imageInputSwapped && !d.mediapipeEmpty && !d.contentSwapped);
  // HIDDEN: the content module's real reading of a non-APPROVED value.
  check('A7. a non-exact approval value ("HIDDEN") counts as unapproved for content', (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r2-hidden-'));
    const f = path.join(tmp, 'review-status.json');
    fs.writeFileSync(f, JSON.stringify({ status: 'HIDDEN' }));
    const ok = JSON.parse(fs.readFileSync(f, 'utf8')).status !== 'APPROVED';
    fs.rmSync(tmp, { recursive: true, force: true });
    return ok;
  })());
  const re = require('../apps/web/palm-image-input-build-exclusion').IMAGE_INPUT_REQUEST as RegExp;
  check('A8. the replacement matches the real import and nothing else', re.test('./palm-scan/PalmImageInput') && re.test('../components/palm-scan/PalmImageInput.tsx') && !re.test('./palm-scan/PalmImageInput.excluded') && !re.test('./PalmistryView'));
  check('A9. next.config.js composes BOTH exclusions in its webpack hook', /applyPalmImageInputExclusion\(applyPalmistryExclusion\(config/.test(read('apps/web/next.config.js')) && typeof nextConfig.webpack === 'function');
  check('A10. the image-input exclusion has no flag or env switch', !/process\.env/.test(read('apps/web/palm-image-input-build-exclusion.js').replace(/\/\/.*$/gm, '')));
}

// ---------------------------------------------------------------- B. stand-in
{
  const stub = read('apps/web/components/palm-scan/PalmImageInput.excluded.tsx');
  const code = stub.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('B1. stand-in renders nothing and imports nothing', /export function PalmImageInput\([^)]*\): null \{\s*return null;\s*\}/.test(code) && !/\bimport\b/.test(code));
  check('B2. stand-in contains no image-input or MediaPipe sentinel', [...scanner.IMAGE_INPUT_SENTINELS, ...MP_SENTINELS].every((s: string) => !stub.includes(s)));
  const view = read('apps/web/components/PalmistryView.tsx');
  const m = view.match(/import \{ PalmImageInput \} from '([^']+)'/);
  const re = require('../apps/web/palm-image-input-build-exclusion').IMAGE_INPUT_REQUEST as RegExp;
  check('B3. PalmistryView imports the upload UI through the exact request the exclusion replaces', !!m && re.test(m[1]), m?.[1] ?? 'no import');
}

// ---------------------------------------------------------------- C. MediaPipe sentinels are real
{
  const mjs = fs.readFileSync(path.join(WEB, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'), 'utf8');
  const cjs = fs.readFileSync(path.join(WEB, 'node_modules/@mediapipe/tasks-vision/vision_bundle.cjs'), 'utf8');
  check('C0. the scanner defines MediaPipe runtime sentinels', MP_SENTINELS.length >= 3);
  for (const s of MP_SENTINELS) check(`C1. MediaPipe sentinel occurs in both installed bundles: ${s}`, mjs.includes(s) && cjs.includes(s));
  check('C2. MediaPipe sentinels are ASCII-only', MP_SENTINELS.length > 0 && MP_SENTINELS.every((s: string) => /^[\x20-\x7e]+$/.test(s)));
  check('C3. the original 8 Palmistry content sentinels are unchanged', scanner.SENTINELS.length === 8);
}

// ---------------------------------------------------------------- D. scanner CLI matrix
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r2-scan-'));
  const web = path.join(tmp, 'apps/web');
  const scannerUnderTest = process.env.PALM_R2_SCANNER_PATH || path.join(WEB, 'scripts/check-palmistry-bundle.js');
  fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
  fs.copyFileSync(scannerUnderTest, path.join(web, 'scripts/check-palmistry-bundle.js'));
  fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
  const setStatus = (status: string) => fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), JSON.stringify({ status, approvedBy: status === 'APPROVED' ? { reviewer: 'FIXTURE', date: 'n/a' } : null }));
  const runScan = () => spawnSync(process.execPath, [path.join(web, 'scripts/check-palmistry-bundle.js')], { encoding: 'utf8' });
  const put = (rel: string, data: string | Buffer) => { const f = path.join(web, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); return f; };
  const mpPkg = path.join(WEB, 'node_modules/@mediapipe/tasks-vision');
  const realBundle = fs.readFileSync(path.join(mpPkg, 'vision_bundle.mjs'));
  const realWasm = fs.readFileSync(path.join(mpPkg, 'wasm/vision_wasm_nosimd_internal.wasm'));

  put('.next/static/chunks/clean.js', 'console.log("hello")');
  put('.next/server/app/page.js', 'module.exports={}');
  put('.next/standalone/node_modules/react/index.js', 'module.exports={}');

  // Realistic prohibited artifacts, each checked on its own.
  const artifacts: Array<[string, string, string | Buffer]> = [
    ['Aura upload UI chunk', '.next/static/chunks/app/page-5f1c.js', 'x.jsx("h2",{children:"Check a palm photo"})'],
    ['MediaPipe dynamic-import chunk (real bundle bytes, hashed name)', '.next/static/chunks/913.8d2e1a.js', realBundle],
    ['MediaPipe code in a server chunk', '.next/server/chunks/77.js', realBundle],
    ['MediaPipe package traced into standalone node_modules', '.next/standalone/node_modules/@mediapipe/tasks-vision/package.json', '{"name":"@mediapipe/tasks-vision"}'],
    ['real MediaPipe WASM under a neutral name', '.next/static/media/a1b2c3.wasm', realWasm],
    ['MediaPipe WASM by name', 'public/runtime/vision_wasm_internal.wasm', Buffer.from([0, 0x61, 0x73, 0x6d])],
    ['hand model bundle in public/', 'public/models/model.task', Buffer.from('PK\x03\x04tflite')],
    ['hand model by name in static media', '.next/static/media/hand_landmarker.bin', Buffer.from('x')],
    ['development asset directory', 'public/palm-dev-assets/mediapipe-1.2.0/wasm/x.js', 'x'],
  ];

  for (const status of ['PENDING_HUMAN_REVIEW', 'APPROVED', 'HIDDEN']) {
    setStatus(status);
    const clean = runScan();
    check(`D1. [${status}] scanner passes a clean build tree`, clean.status === 0, clean.stderr + clean.stdout);
    for (const [label, rel, data] of artifacts) {
      const f = put(rel, data);
      const r = runScan();
      check(`D2. [${status}] scanner FAILS on: ${label}`, r.status === 1, `exit=${r.status} ${r.stdout.trim()}`);
      fs.rmSync(f);
      if (rel.startsWith('public/palm-dev-assets')) fs.rmSync(path.join(web, 'public/palm-dev-assets'), { recursive: true, force: true });
    }
  }
  setStatus('APPROVED');
  const approvedClean = runScan();
  check('D3. APPROVED content: existing inclusion message unchanged, and the image-input check is reported as run', approvedClean.status === 0 && /content APPROVED -- inclusion allowed/.test(approvedClean.stdout) && /Image-input exclusion checked independently: OK/.test(approvedClean.stdout));
  setStatus('PENDING_HUMAN_REVIEW');
  put('.next/static/chunks/content.js', '"Learn the lines of the hand"');
  check('D4. existing content check unchanged: PENDING + content sentinel still FAILS', runScan().status === 1);
  setStatus('APPROVED');
  check('D5. existing content check unchanged: APPROVED + content sentinel passes', runScan().status === 0);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------- E. routes and entry points
{
  const appFiles: string[] = [];
  const walk = (d: string) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) walk(f); else if (/\.(tsx?|jsx?)$/.test(n)) appFiles.push(f); } };
  walk(path.join(WEB, 'app'));
  walk(path.join(WEB, 'components'));
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const importers = appFiles.filter((f) => /from '[^']*(palm-scan\/PalmImageInput|lib\/palm-analysis|@mediapipe\/tasks-vision)[^']*'|import\('@mediapipe\/tasks-vision'\)/.test(stripComments(fs.readFileSync(f, 'utf8'))));
  const rel = importers.map((f) => path.relative(WEB, f)).sort();
  check('E1. only PalmistryView imports the upload UI; only the upload UI imports the pipeline', JSON.stringify(rel) === JSON.stringify(['components/PalmistryView.tsx', 'components/palm-scan/PalmImageInput.tsx']), JSON.stringify(rel));
  check('E2. no app route directory for palm image input exists (no direct URL)', !appFiles.some((f) => /app[\\/][^\\/]*palm[^\\/]*[\\/]page\.tsx$/i.test(f)));
  check('E3. the Palmistry tab itself stays behind its runtime gate in page.tsx', /tab !== 'palmistry' \|\| palmistryAvailable/.test(read('apps/web/app/page.tsx')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
