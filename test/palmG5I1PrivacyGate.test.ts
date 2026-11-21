/**
 * AURA-PALM-G5-I1 -- static privacy, isolation and production-gate checks
 * for the palm-image input. Reads real source files and runs the real
 * post-build scanner against temporary trees (negative controls).
 *
 *   npx ts-node test/palmG5I1PrivacyGate.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`OK   ${label}`); } else { failed++; console.log(`FAIL ${label}`); }
}

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1');

const LIB_DIR = 'apps/web/lib/palm-analysis';
const UI_DIR = 'apps/web/components/palm-scan';
const listTs = (rel: string) => fs.readdirSync(path.join(ROOT, rel)).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => `${rel}/${f}`);
const FEATURE_FILES = [...listTs(LIB_DIR), ...listTs(UI_DIR)];

// ============================================================ A. no network / storage / logging / camera
check('A0. the feature has the expected modules', FEATURE_FILES.length >= 10 && FEATURE_FILES.includes(`${UI_DIR}/PalmImageInput.tsx`) && FEATURE_FILES.includes(`${LIB_DIR}/session.ts`));
for (const file of FEATURE_FILES) {
  const src = strip(read(file));
  check(`A1. ${file}: no fetch() call / XHR / sendBeacon / WebSocket / EventSource`, !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share/.test(src));
  check(`A2. ${file}: no persistent storage (local/session storage, IndexedDB, cookies, Cache API, OPFS)`, !/localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|getDirectory\(|serviceWorker/.test(src));
  check(`A3. ${file}: no console output (no image or landmark logging)`, !/console\.(log|info|debug|warn|error|trace|table|dir)/.test(src));
  check(`A4. ${file}: no camera / media capture`, !/getUserMedia|mediaDevices|capture=|\bcapture:|@capacitor\/camera|ImageCapture/.test(src));
  check(`A5. ${file}: no external URL (no CDN / third-party endpoint)`, !/https?:\/\//.test(src));
  check(`A6. ${file}: no analytics / tracker / API / database access`, !/trackEvent|productEvents|['"`]\/api\/|lib\/db|prisma|getSession/.test(src));
  check(`A7. ${file}: no image encoding for transport (toDataURL / toBlob / FileReader / FormData)`, !/toDataURL|toBlob|convertToBlob|FileReader|FormData|btoa\(/.test(src));
  check(`A8. ${file}: does not import the frozen D1 detector or any crease detector`, !/creases|directional|d1|palm-scan-g4/i.test(src.replace(/PalmPipelineError|PALM_|palm-scan\//g, '')));
}
const ui = strip(read(`${UI_DIR}/PalmImageInput.tsx`));
check('A9. exactly one file input, without a capture attribute', (ui.match(/type="file"/g) ?? []).length === 1 && !/capture/.test(ui));
check('A10. no createObjectURL for the preview (the EXIF-free canvas is shown)', !/createObjectURL/.test(ui));
check('A11. object URLs are only created in the <img> fallback decoder and revoked in finally', (() => { const n = strip(read(`${LIB_DIR}/normalize.ts`)); return /finally\s*\{\s*revoke\(url\);/.test(n) && (n.match(/toUrl\(blob\)/g) ?? []).length === 1; })());
check('A12. the result type carries no landmarks or pixels', (() => { const t = read(`${LIB_DIR}/types.ts`); const r = t.slice(t.indexOf('export interface PalmAnalysisResult'), t.indexOf('export class PalmPipelineError')); return !/landmarks|ImageData|Uint8|canvas|pixels/i.test(r.replace(/NO pixels|no pixels/g, '')); })());
check('A13. the guard records hosts only (never paths, queries or bodies)', /blockedHosts\.push\(host\)/.test(read(`${LIB_DIR}/networkGuard.ts`)) && !/blockedHosts\.push\(url/.test(read(`${LIB_DIR}/networkGuard.ts`)));

// ============================================================ B. isolation / import graph
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.next', '.next-dev', 'android', 'ios', 'cap-shell', 'public'].includes(name)) continue;
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}
const sources = [...walk(WEB), ...walk(path.join(ROOT, 'packages'))];
const importersOf = (re: RegExp) => sources.filter((f) => re.test(strip(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(ROOT, f).replace(/\\/g, '/')).sort();
check('B1. only PalmistryView imports the Upload Photo component', JSON.stringify(importersOf(/from\s+['"][^'"]*palm-scan\/PalmImageInput['"]/)) === JSON.stringify(['apps/web/components/PalmistryView.tsx']));
const libImporters = importersOf(/from\s+['"][^'"]*lib\/palm-analysis\//);
check('B2. only palm-scan components import lib/palm-analysis (from outside the lib)', libImporters.length > 0 && libImporters.every((f) => f.startsWith(`${UI_DIR}/`)));
check('B3. @mediapipe/tasks-vision is imported in exactly one module, lazily (dynamic import)', JSON.stringify(importersOf(/(from|import\(|require\()\s*['"]@mediapipe\/tasks-vision['"]/)) === JSON.stringify([`${LIB_DIR}/mediapipeDetector.ts`]) && /await import\('@mediapipe\/tasks-vision'\)/.test(read(`${LIB_DIR}/mediapipeDetector.ts`)) && !/^import .*@mediapipe/m.test(read(`${LIB_DIR}/mediapipeDetector.ts`)));
check('B4. the build exclusion still swaps exactly components/PalmistryView (which roots the whole image-input subtree)', (() => { const { PALMISTRY_VIEW_REQUEST } = require('../apps/web/palmistry-build-exclusion'); return PALMISTRY_VIEW_REQUEST.test('../components/PalmistryView') && !PALMISTRY_VIEW_REQUEST.test('./palm-scan/PalmImageInput'); })());
check('B5. the production stand-in is unchanged and imports nothing image-related', !/palm-scan|palm-analysis|mediapipe/.test(read('apps/web/components/PalmistryView.unpublished.tsx')));
check('B6. page.tsx does not reference the image input (no new route/tab)', !/palm-scan|palm-analysis|PalmImageInput/.test(read('apps/web/app/page.tsx')) && !fs.existsSync(path.join(WEB, 'app/palmistry')) && !fs.existsSync(path.join(WEB, 'app/palm')));
check('B7. no API route for images was added', !walk(path.join(WEB, 'app')).some((f) => /palm|image-upload|upload/i.test(path.relative(WEB, f))));
check('B8. one detector only: no other hand/pose model or vision library dependency', (() => { const pkg = JSON.parse(read('apps/web/package.json')); const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }); return deps.filter((d) => /mediapipe|tensorflow|tfjs|onnx|opencv|handtrack/i.test(d)).join() === '@mediapipe/tasks-vision'; })());
check('B9. MediaPipe is pinned exactly to 1.2.0', JSON.parse(read('apps/web/package.json')).dependencies['@mediapipe/tasks-vision'] === '1.2.0');

// ============================================================ C. gate
const gate = read(`${LIB_DIR}/gate.ts`);
check("C1. gate requires NODE_ENV === 'development' AND the explicit flag value", /nodeEnv === 'development' && flag === PALM_IMAGE_INPUT_FLAG_VALUE/.test(gate) && /PALM_IMAGE_INPUT_FLAG_VALUE = 'g5-i1-dev'/.test(gate));
check('C2. the component checks the gate before creating any session or model', /if \(!isPalmImageInputEnabled\(\)\) return null;\s*return <PalmImageInputEnabled/.test(read(`${UI_DIR}/PalmImageInput.tsx`)));
check('C3. the session refuses work when the gate is closed', /if \(!enabled\(\)\) \{\s*emit\(\{ phase: 'error'[^}]*palmInputError\('feature-disabled'\)/.test(read(`${LIB_DIR}/session.ts`)));
check('C4. the flag is not set in any committed env file or Vercel config', !['apps/web/.env.example', 'apps/web/vercel.json', '.github/workflows/ci.yml', 'deploy/compose.yml', 'deploy/Dockerfile'].some((f) => fs.existsSync(path.join(ROOT, f)) && /NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT|g5-i1-dev/.test(read(f))));
check('C5. Palmistry content review status is unchanged (PENDING_HUMAN_REVIEW, no approver)', (() => { const s = JSON.parse(read('packages/palmistry/src/review-status.json')); return s.status === 'PENDING_HUMAN_REVIEW' && s.approvedBy === null; })());

// ============================================================ D. dev-only assets
check('D1. the dev asset directory is gitignored', /^public\/palm-dev-assets\/$/m.test(read('apps/web/.gitignore')) && spawnSync('git', ['check-ignore', '-q', 'apps/web/public/palm-dev-assets/mediapipe-1.2.0/hand_landmarker.task'], { cwd: ROOT }).status === 0);
check('D2. the dev asset directory is excluded from Docker build context', /^apps\/web\/public\/palm-dev-assets$/m.test(read('.dockerignore')));
check('D3. no dev asset is tracked by git', spawnSync('git', ['ls-files', 'apps/web/public/palm-dev-assets'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() === '');
{
  const assets = require('../apps/web/scripts/palm-dev-assets');
  check('D4. asset installer refuses to run in CI / Vercel / production', Boolean(assets.refuseOutsideDev({ CI: 'true' })) && Boolean(assets.refuseOutsideDev({ VERCEL: '1' })) && Boolean(assets.refuseOutsideDev({ NODE_ENV: 'production' })) && assets.refuseOutsideDev({}) === null);
  const pkgDir = path.join(WEB, 'node_modules/@mediapipe/tasks-vision');
  const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const wasmPins = Object.entries(assets.PINNED as Record<string, string>).filter(([k]) => k.startsWith('wasm/'));
  check('D5. pinned WASM hashes equal the installed npm package files (6/6)', wasmPins.length === 6 && wasmPins.every(([rel, h]) => fs.existsSync(path.join(pkgDir, rel)) && sha(path.join(pkgDir, rel)) === h));
  check('D6. pinned model hash equals the G4-A ASSET_SHA256SUMS value', assets.PINNED['hand_landmarker.task'] === 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1');
  check('D7. asset base is a same-origin path matching the installer destination', (() => { const src = read(`${LIB_DIR}/mediapipeDetector.ts`); return /PALM_MEDIAPIPE_ASSET_BASE = `\/palm-dev-assets\/mediapipe-\$\{PALM_MEDIAPIPE_VERSION\}`/.test(src) && assets.DEST.endsWith(path.join('public', 'palm-dev-assets', 'mediapipe-1.2.0')); })());
}

// ============================================================ E. production bundle scanner (extended)
const scanner = require('../apps/web/scripts/check-palmistry-bundle');
const imageSources = FEATURE_FILES.map(read).join('\n') + fs.readFileSync(path.join(WEB, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'), 'utf8');
for (const s of scanner.IMAGE_INPUT_SENTINELS) check(`E1. image-input sentinel present in its source: ${s}`, imageSources.includes(s));
check('E2. image-input sentinels are ASCII-only', scanner.IMAGE_INPUT_SENTINELS.every((s: string) => /^[\x20-\x7e]+$/.test(s)));
check('E3. the original Palmistry sentinels are unchanged (8)', scanner.SENTINELS.length === 8);
check('E4. no image-input sentinel occurs in the production stand-in or page.tsx', scanner.IMAGE_INPUT_SENTINELS.every((s: string) => !read('apps/web/components/PalmistryView.unpublished.tsx').includes(s) && !read('apps/web/app/page.tsx').includes(s)));
{
  // Negative controls against throwaway trees, using the REAL scanner CLI.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-g5-scan-'));
  const web = path.join(tmp, 'apps/web');
  fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
  fs.copyFileSync(path.join(WEB, 'scripts/check-palmistry-bundle.js'), path.join(web, 'scripts/check-palmistry-bundle.js'));
  fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
  fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), JSON.stringify({ status: 'PENDING_HUMAN_REVIEW', approvedBy: null }));
  const runScan = () => spawnSync(process.execPath, [path.join(web, 'scripts/check-palmistry-bundle.js')], { encoding: 'utf8' });
  fs.mkdirSync(path.join(web, '.next/static/chunks'), { recursive: true });
  fs.writeFileSync(path.join(web, '.next/static/chunks/clean.js'), 'console.log("hello")');
  const clean = runScan();
  check('E5. scanner passes a clean build tree', clean.status === 0 && /image-input sentinels/.test(clean.stdout));
  fs.writeFileSync(path.join(web, '.next/static/chunks/leak.js'), 'var x="/palm-dev-assets/mediapipe-1.2.0";');
  const leak = runScan();
  check('E6. scanner FAILS when the image-input code leaks into a production chunk', leak.status === 1 && /palm-dev-assets/.test(leak.stderr));
  fs.unlinkSync(path.join(web, '.next/static/chunks/leak.js'));
  fs.writeFileSync(path.join(web, '.next/static/chunks/mp.js'), 'u="https://odml.pa.googleapis.com/v1/log"');
  check('E7. scanner FAILS when the MediaPipe bundle leaks into a production chunk', runScan().status === 1);
  fs.unlinkSync(path.join(web, '.next/static/chunks/mp.js'));
  fs.mkdirSync(path.join(web, 'public/palm-dev-assets/mediapipe-1.2.0'), { recursive: true });
  fs.writeFileSync(path.join(web, 'public/palm-dev-assets/mediapipe-1.2.0/hand_landmarker.task'), 'x');
  const assetsLeak = runScan();
  check('E8. scanner FAILS if dev MediaPipe assets are present in the build tree', assetsLeak.status === 1 && /development-only MediaPipe assets/.test(assetsLeak.stderr));
  fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), JSON.stringify({ status: 'APPROVED', approvedBy: 'x' }));
  check('E9. ...even if Palmistry content were approved (dev assets never ship)', runScan().status === 1);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ============================================================ F. frozen research + scope
// AURA-PALM-G5-C1 base compatibility: packages/palm-reading-engine (G6-I1,
// merged after this suite's 1741a95 base) legitimately vendors hash-pinned
// frozen D1 output for its synthetic adapter tests. It is excluded from F1
// only; its isolation is enforced by its own isolation tests (nothing imports
// it) and the unconditional apps/web/scripts/check-palm-engine-bundle.js guard.
const PALM_ENGINE_DIR = path.join(ROOT, 'packages', 'palm-reading-engine') + path.sep;
check('F1. no reference to the frozen D1 file, C5 evaluation or G4-D1 worktree in the app', !sources.filter((f) => !f.startsWith(PALM_ENGINE_DIR)).some((f) => /creases-directional-d1|c5-eval|palm-g4d1|palm-scan-g4d1/.test(fs.readFileSync(f, 'utf8'))));
check('F2. no database change (no palm migration, schema untouched)', fs.readdirSync(path.join(WEB, 'prisma/migrations')).every((m) => !/palm/i.test(m)) && !/palm/i.test(read('apps/web/prisma/schema.prisma')));
check('F3. production nginx headers untouched (camera=() and no wasm-unsafe-eval still in place)', /camera=\(\)/.test(read('deploy/nginx-aura.conf')) && !/wasm-unsafe-eval/.test(read('deploy/nginx-aura.conf')));
check('F4. native permission manifests untouched (no CAMERA / NSCameraUsageDescription)', !/android\.permission\.CAMERA/.test(read('apps/web/android/app/src/main/AndroidManifest.xml')) && !/NSCameraUsageDescription/.test(read('apps/web/ios/App/App/Info.plist')));
check('F5. no new product analytics event for palm images', !/PALM(ISTRY)?_(IMAGE|PHOTO|UPLOAD|SCAN)/.test(read('apps/web/lib/productEvents.ts')));
const userCopy = [read(`${UI_DIR}/PalmImageInput.tsx`), read(`${LIB_DIR}/analyze.ts`), read(`${LIB_DIR}/validate.ts`)].join('\n');
check('F6. no claim that palm lines were detected', !/lines? (were|was|have been|has been) (detected|found)|detected (your )?(palm )?lines|line detection complete/i.test(userCopy));
check('F7. no personality / relationship / career / future / medical / identity claims in user copy', !/personality|relationship|career|your future|destiny|lifespan|diagnos|medical|identif(y|ies) you|biometric/i.test(userCopy));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
