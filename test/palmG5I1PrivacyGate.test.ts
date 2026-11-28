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
// AURA-PALM-04-I5: the one camera adapter (see A4c)
const CAMERA_ADAPTER = `${LIB_DIR}/camera.ts`;

// ============================================================ A. no network / storage / logging / camera
check('A0. the feature has the expected modules', FEATURE_FILES.length >= 10 && FEATURE_FILES.includes(`${UI_DIR}/PalmImageInput.tsx`) && FEATURE_FILES.includes(`${LIB_DIR}/session.ts`));
for (const file of FEATURE_FILES) {
  const src = strip(read(file));
  check(`A1. ${file}: no fetch() call / XHR / sendBeacon / WebSocket / EventSource`, !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share/.test(src));
  check(`A2. ${file}: no persistent storage (local/session storage, IndexedDB, cookies, Cache API, OPFS)`, !/localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|getDirectory\(|serviceWorker/.test(src));
  check(`A3. ${file}: no console output (no image or landmark logging)`, !/console\.(log|info|debug|warn|error|trace|table|dir)/.test(src));
  if (file === CAMERA_ADAPTER) {
    // AURA-PALM-04-I5 (owner ticket 50361, plan G-8 / D2) -- SUPERSEDES A4 FOR THIS ONE FILE ONLY. A4 was written for
    // G5-I1, before the planned camera adapter; every other feature file is still held to A4 unchanged. The camera
    // adapter is instead held to the stricter, camera-specific A4c checks below.
    check(`A4c-1. ${file}: the browser camera API is reached in exactly one place (navigator.mediaDevices.getUserMedia)`, (src.match(/\.mediaDevices\b/g) ?? []).length === 1 && (src.match(/getUserMedia!?\(/g) ?? []).length === 2 && /env\.getUserMedia!\(PALM_CAMERA_CONSTRAINTS\)/.test(src));
    check(`A4c-2. ${file}: video only -- the constraints set audio: false and nothing requests audio`, /audio:\s*false as const/.test(src) && (src.match(/audio\s*:/g) ?? []).length === 1);
    check(`A4c-3. ${file}: no recording, still-image grabbing, screen sharing, device listing or device identity`, !/MediaRecorder|ImageCapture|takePhoto|grabFrame|getDisplayMedia|enumerateDevices|deviceId|groupId|\.label\b|getSettings|getCapabilities|captureStream|requestVideoFrameCallback|@capacitor\/camera|capture=|\bcapture:/.test(src));
    check(`A4c-4. ${file}: a stream that carries any non-video track is stopped and refused (fail closed)`, /tracks\.some\(\(t\) => t\.kind !== 'video'\)/.test(src));
  } else {
    check(`A4. ${file}: no camera / media capture`, !/getUserMedia|mediaDevices|capture=|\bcapture:|@capacitor\/camera|ImageCapture/.test(src));
  }
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
// AURA-PALM-03-E1-R3 -- EXPLICIT DEVELOPMENT-ONLY PRIVACY-GATE EXCEPTION (owner-authorised 2026-11-26).
// Exactly one file outside palm-scan may import from lib/palm-analysis: the development-only, synthetic-only E1 reading
// interface, which builds the I1 feature set from one synthetic input. The exception is limited to ONE import
// statement of the I1 builder (buildPalmFeatureSet and the PalmFeatureSetInput type) from lib/palm-analysis/features.
// Every other B2 restriction is unchanged, and B2b/B2c below compensate: nothing in apps/web or packages may reach the
// E1 interface, directly or indirectly, and only explicitly listed development/test consumers may import it. The E1
// release guard (apps/web/scripts/check-palm-e1-bundle.js) keeps it out of every shipped artifact.
const E1_READING = 'packages/palm-reading-engine/e1/src/reading.ts';
const E1_BUILDER_IMPORT = "import { buildPalmFeatureSet, type PalmFeatureSetInput } from '../../../../apps/web/lib/palm-analysis/features';";
const E1_READING_CONSUMERS = ['test/palm03E1Engine.test.ts', 'test/palmD6I1Reading.test.ts']; // explicitly scoped development/test consumers
// AURA-PALM-D6-I1 (owner-approved B3, ticket 50368) -- B2b AMENDMENT: exactly ONE designated app integration module may
// import the E1 reading interface, with exactly this one statement and only the development-gated confirmed-scanner
// entry point (never generateSyntheticReading). That module is the dev-gated scanner, which every production build
// swaps for an empty stand-in (B4, G5-R2 exclusion), and the E1 bundle guard stays unconditional. Every other app,
// package or test reach is still refused (B2b closure below treats only this one module as the integration sink).
const E1_APP_CONSUMER = `${UI_DIR}/PalmImageInput.tsx`;
const E1_APP_IMPORT = "import { generateConfirmedScannerReading } from '../../../../packages/palm-reading-engine/e1/src/reading';";
const LIB_REF = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*lib\/palm-analysis\/[^'"]*['"]/g;
type Src = { rel: string; text: string };
/** B2 with the E1-R3 exception: files outside palm-scan that reference lib/palm-analysis (static, dynamic or require). */
const LIB_ROOT = 'apps/web/lib/palm-analysis/';
/** Every import / dynamic import / require specifier in `text` that resolves (relatively) into lib/palm-analysis or names it. */
function libRefs(rel: string, text: string): string[] {
  const specs = [...strip(text).matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specs.filter((sp) => /lib\/palm-analysis\//.test(sp) || (sp.startsWith('.') && `${path.posix.normalize(path.posix.join(path.posix.dirname(rel), sp))}/`.startsWith(LIB_ROOT)));
}
function b2Violations(files: Src[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.rel.startsWith(LIB_ROOT)) continue; // inside the lib itself
    const refs = libRefs(f.rel, f.text);
    if (!refs.length || f.rel.startsWith(`${UI_DIR}/`)) continue;
    if (f.rel === E1_READING) {
      const stmts = f.text.split('\n').filter((l) => /lib\/palm-analysis\//.test(l) && !/^\s*(\/\/|\*)/.test(l));
      if (refs.length === 1 && stmts.length === 1 && stmts[0].trim() === E1_BUILDER_IMPORT) continue;
    }
    out.push(f.rel);
  }
  return out;
}
const realSources: Src[] = sources.map((f) => ({ rel: path.relative(ROOT, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }));
check('B2. only palm-scan components import lib/palm-analysis (from outside the lib), except the one scoped E1-R3 development builder import', libImporters.length > 0 && libImporters.some((f) => f.startsWith(`${UI_DIR}/`)) && libImporters.every((f) => f.startsWith(`${UI_DIR}/`) || f === E1_READING) && b2Violations(realSources).length === 0);
if (b2Violations(realSources).length) console.log('  B2 violations:', b2Violations(realSources));

/** Files (by repo-relative path) that import `target`, directly or transitively, among `files` (relative specifiers resolved). */
function importersClosure(files: Src[], target: string): string[] {
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const resolve = (from: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, `${base}/index.ts`, `${base}/index.mjs`]) if (byRel.has(c) || c === target) return c;
    return base;
  };
  const deps = new Map<string, string[]>();
  for (const f of files) deps.set(f.rel, [...strip(f.text).matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => resolve(f.rel, m[1])).filter((x): x is string => !!x));
  const reached = new Set<string>([target]);
  let grew = true;
  while (grew) { grew = false; for (const [k, ds] of deps) if (!reached.has(k) && ds.some((d) => reached.has(d))) { reached.add(k); grew = true; } }
  reached.delete(target);
  return [...reached].sort();
}
const e1Pkg = 'packages/palm-reading-engine/e1/';
/** D6-I1: reach of the E1 interface with the one designated app module as the sink (its own importers are expected). */
const reachersExceptApp = (files: Src[]) => importersClosure(files.filter((f) => f.rel !== E1_APP_CONSUMER), E1_READING).filter((f) => !f.startsWith(e1Pkg));
/** D6-I1: the designated app module's E1 references -- exactly the one approved import statement, nothing else. */
function appImportViolations(files: Src[]): string[] {
  const out: string[] = [];
  const app = files.find((f) => f.rel === E1_APP_CONSUMER);
  const lines = app ? app.text.split('\n').filter((l) => /palm-reading-engine|e1\/src\/reading|generateSyntheticReading/.test(l) && !/^\s*(\/\/|\*)/.test(l)) : [];
  if (lines.length !== 1 || lines[0].trim() !== E1_APP_IMPORT) out.push(`${E1_APP_CONSUMER}: ${JSON.stringify(lines)}`);
  return out;
}
check('B2b-app. (D6-I1) the designated app module imports the E1 interface with exactly one approved statement (confirmed-scanner entry only)', appImportViolations(realSources).length === 0);
if (appImportViolations(realSources).length) console.log('  app import:', appImportViolations(realSources));
const productionReachers = reachersExceptApp(realSources);
check('B2b. compensating: no application or other production-facing module in apps/web or packages imports the E1 reading interface, directly or indirectly', productionReachers.length === 0);
if (productionReachers.length) console.log('  reachers:', productionReachers);
const testDir = path.join(ROOT, 'test');
// this file's own negative fixtures contain import strings, so it is excluded from the consumer scan
const testSources: Src[] = fs.readdirSync(testDir).filter((n) => /\.(ts|tsx|js|mjs|cjs)$/.test(n) && n !== path.basename(__filename)).map((n) => ({ rel: `test/${n}`, text: fs.readFileSync(path.join(testDir, n), 'utf8') }));
const testConsumers = reachersExceptApp([...realSources, ...testSources]);
check('B2b. only explicitly scoped development/test consumers import the E1 reading interface', JSON.stringify(testConsumers) === JSON.stringify(E1_READING_CONSUMERS));
if (JSON.stringify(testConsumers) !== JSON.stringify(E1_READING_CONSUMERS)) console.log('  consumers:', testConsumers);
// R5/R6: reading.ts IS the single pipeline -- it binds the I1 builder at load and requires an OWN data property
// { synthetic: true }, captured once and then validated (identity.mjs), before any work
const e1Src = (f: string) => read(path.posix.join(path.posix.dirname(E1_READING), f));
check('B2b. the E1 reading interface stays synthetic-only and development-only (refuses without an own { synthetic: true })', /^const BUILD: \(input: PalmFeatureSetInput\) => Any = buildPalmFeatureSet;$/m.test(read(E1_READING)) && /const opts = requireSyntheticOptions\(options, \['synthetic', 'mode'\]\); \/\/ 1\. before any work/.test(read(E1_READING)) && /snap = captureOwnData\(options, \{ code: 'synthetic-required'[\s\S]*if \(snap\.synthetic !== true\) refuse\('synthetic must be exactly true'\);/.test(e1Src('identity.mjs')) && /DEVELOPMENT ONLY\. SYNTHETIC ONLY\./.test(read(E1_READING)) && !require('fs').existsSync(require('path').join(ROOT, path.posix.dirname(E1_READING), 'engine-core.mjs')));
check('B2b-d6. (D6-I1) the confirmed-scanner entry requires its own { confirmedScanner: true } declaration AND the development gate, and its output is marked non-synthetic', /const opts = requireConfirmedScannerOptions\(options, \['confirmedScanner', 'mode'\]\); \/\/ 1\. before any work\n\s+if \(!confirmedScannerGateOpen\(\)\) throw new E1ErrorClass\('development-only'/.test(read(E1_READING)) && /return process\.env\.NODE_ENV === 'development' && process\.env\.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT === 'g5-i1-dev';/.test(read(E1_READING)) && /return readingFor\(input, opts\.mode, false\);/.test(read(E1_READING)) && /if \(snap\.confirmedScanner !== true\) refuse\('confirmedScanner must be exactly true'\);/.test(e1Src('identity.mjs')));
// B2c -- negative regressions: unauthorised imports still fail B2 / B2b
const readingText = read(E1_READING);
const neg: Array<[string, Src[], 'b2' | 'closure' | 'app']> = [
  ['another package imports lib/palm-analysis', [{ rel: 'packages/other/x.ts', text: "import { measureHand } from '../../apps/web/lib/palm-analysis/measurements';" }], 'b2'],
  ['an app module dynamically imports lib/palm-analysis', [{ rel: 'apps/web/lib/other.ts', text: "const m = await import('./palm-analysis/features');" }], 'b2'],
  ['a module requires lib/palm-analysis', [{ rel: 'apps/web/app/x.ts', text: "const f = require('../lib/palm-analysis/quality');" }], 'b2'],
  ['the E1 interface imports a different lib module', [{ rel: E1_READING, text: readingText.replace("lib/palm-analysis/features'", "lib/palm-analysis/measurements'") }], 'b2'],
  ['the E1 interface imports more than the builder', [{ rel: E1_READING, text: readingText.replace('import { buildPalmFeatureSet, type PalmFeatureSetInput }', 'import { buildPalmFeatureSet, palmFrameFromLandmarks, type PalmFeatureSetInput }') }], 'b2'],
  ['the E1 interface adds a second lib reference', [{ rel: E1_READING, text: `${readingText}\nconst q = require('../../../../apps/web/lib/palm-analysis/quality');` }], 'b2'],
  ['an app module imports the E1 interface', [{ rel: 'apps/web/app/page.tsx', text: "import { generateSyntheticReading } from '../../../packages/palm-reading-engine/e1/src/reading';" }], 'closure'],
  ['an app module reaches it indirectly', [{ rel: 'apps/web/lib/helper.ts', text: "export * from '../../../packages/palm-reading-engine/e1/src/reading';" }, { rel: 'apps/web/app/page.tsx', text: "import { x } from '../lib/helper';" }], 'closure'],
  ['an unlisted test imports it', [{ rel: 'test/other.test.ts', text: "import { generateSyntheticReading } from '../packages/palm-reading-engine/e1/src/reading';" }], 'closure'],
  // D6-I1 (B3) negatives: the amendment admits exactly one module and one statement
  ['a second app module imports the confirmed-scanner entry', [{ rel: 'apps/web/components/PalmistryView.tsx', text: `${read('apps/web/components/PalmistryView.tsx')}\nimport { generateConfirmedScannerReading } from '../../../packages/palm-reading-engine/e1/src/reading';` }], 'closure'],
  ['another palm-scan file imports the E1 interface', [{ rel: `${UI_DIR}/Other.tsx`, text: "import { generateConfirmedScannerReading } from '../../../../packages/palm-reading-engine/e1/src/reading';" }], 'closure'],
  ['the designated module also imports the synthetic entry', [{ rel: E1_APP_CONSUMER, text: read(E1_APP_CONSUMER).replace(E1_APP_IMPORT, "import { generateConfirmedScannerReading, generateSyntheticReading } from '../../../../packages/palm-reading-engine/e1/src/reading';") }], 'app'],
  ['the designated module adds a second E1 reference', [{ rel: E1_APP_CONSUMER, text: `${read(E1_APP_CONSUMER)}\nconst e1 = require('../../../../packages/palm-reading-engine/e1/src/packaged.mjs');` }], 'app'],
];
const neg2 = neg as Array<[string, Src[], 'b2' | 'closure' | 'app']>;
for (const [name, files, kind] of neg2) {
  const all = [...realSources.filter((f) => !files.some((g) => g.rel === f.rel)), ...files];
  const failed = kind === 'b2' ? b2Violations(all).length > 0 : kind === 'app' ? appImportViolations(all).length > 0 : reachersExceptApp([...all, ...testSources]).filter((f) => !E1_READING_CONSUMERS.includes(f)).length > 0;
  check(`B2c. negative: ${name} -> fails`, failed);
}
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
// AURA-PALM-01-G3: content approval (Product Owner, 2026-11-24) covers the educational guide only; it never authorises image input (see the unconditional image-input exclusion checks).
check('C5. Palmistry content review record is exactly the Product Owner content-only approval (independentScholarlyReview false)', (() => { const s = JSON.parse(read('packages/palmistry/src/review-status.json')); return s.status === 'APPROVED' && s.approvedBy !== null && s.approvedBy.reviewer === 'Product Owner' && s.approvedBy.role === 'PRODUCT_OWNER_EDITORIAL_AND_CULTURAL_REVIEW' && s.approvedBy.independentScholarlyReview === false && s.approvedBy.contentCommit === 'f723942' && s.approvedBy.date === '2026-11-24' && /AURA-PALM-01-G3-SCHOLAR-WAIVER\.md §5/.test(s.approvedBy.basis) && Object.keys(s.approvedBy).sort().join(',') === 'basis,contentCommit,date,independentScholarlyReview,reviewer,role'; })());

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
// AURA-PALM-D6-I1 (owner-approved B3) -- F7 AMENDMENT: the scanner may show E1's reading under five topic headings. The
// ONLY app-authored text allowed to name those topics is the exact <reading-topics> block below (headings and E1
// category ids, no interpretation); F7 then applies, unchanged, to everything else in the scanner's user copy.
// Interpretation text is E1 output at runtime (checked behaviourally in test/palmD6I1ReadingJsdom.test.ts).
const READING_TOPICS_BLOCK = `// <reading-topics> D6-I1: the five topic HEADINGS and the E1 section categories / domains each one shows. Headings only:
// no interpretation text may be written here (the privacy gate F7 accepts exactly this block and nothing else).
export const READING_TOPICS = Object.freeze([
  Object.freeze({ id: 'personality', label: 'Personality', categories: Object.freeze(['personality']), domain: 'personality' }),
  Object.freeze({ id: 'strengths', label: 'Personal strengths', categories: Object.freeze(['strengths', 'growth']), domain: null }),
  Object.freeze({ id: 'relationships', label: 'Relationships', categories: Object.freeze(['emotional-relational']), domain: 'relationships' }),
  Object.freeze({ id: 'career', label: 'Career and work', categories: Object.freeze(['career-working-style']), domain: 'career' }),
  Object.freeze({ id: 'life-direction', label: 'Life direction', categories: Object.freeze(['life-direction']), domain: 'life-direction' }),
]);
// </reading-topics>`;
const F7_BANNED = /personality|relationship|career|your future|destiny|lifespan|diagnos|medical|identif(y|ies) you|biometric/i;
/** F7 with the one accepted block removed -- null when the block is missing, duplicated or altered (fails closed). */
const f7Copy = (ui: string): string | null => (ui.split(READING_TOPICS_BLOCK).length === 2 ? ui.replace(READING_TOPICS_BLOCK, '') : null);
const scannerUi = read(`${UI_DIR}/PalmImageInput.tsx`);
const userCopy = [f7Copy(scannerUi) ?? scannerUi, read(`${LIB_DIR}/analyze.ts`), read(`${LIB_DIR}/validate.ts`)].join('\n');
check('F6. no claim that palm lines were detected', !/lines? (were|was|have been|has been) (detected|found)|detected (your )?(palm )?lines|line detection complete/i.test(userCopy));
check('F7a. (D6-I1) the reading-topic headings block occurs exactly once, byte-identical to the approved block', f7Copy(scannerUi) !== null);
check('F7. no personality / relationship / career / future / medical / identity claims in user copy (outside the approved topic headings)', f7Copy(scannerUi) !== null && !F7_BANNED.test(userCopy));
{
  const f7Fails = (ui: string) => { const c = f7Copy(ui); return c === null || F7_BANNED.test(c); };
  check('F7-neg1. negative: an app-authored interpretation outside the block fails F7', f7Fails(scannerUi.replace("const TOPIC_NOT_ASSESSED =", "const APP_TEXT = 'Your career will flourish.';\nconst TOPIC_NOT_ASSESSED =")));
  check('F7-neg2. negative: interpretation text added inside the topic block fails F7a', f7Fails(scannerUi.replace("label: 'Career and work',", "label: 'Career and work: you will lead',")));
  check('F7-neg3. negative: a second copy of the block (to hide text) fails F7a', f7Fails(`${scannerUi}\n${READING_TOPICS_BLOCK}`));
  check('F7-neg4. negative: a banned word outside the block in another form ("relationship advice") fails F7', f7Fails(scannerUi.replace("const TOPIC_NO_CONTENT =", "const X = 'relationship advice';\nconst TOPIC_NO_CONTENT =")));
}

// ============================================================ A4c behavioural (AURA-PALM-04-I5-R1, 50362 F2)
// The A4c static checks above are kept; these run the REAL camera adapter in this process against an installed fake
// browser camera surface (navigator.mediaDevices), so an extra or disguised acquisition, or a disabled non-video
// refusal, is caught by behaviour rather than by source text.
async function cameraBehaviour(): Promise<void> {
  type T = { kind: string; readyState: string; stops: number; stop(): void };
  const track = (kind: string): T => ({ kind, readyState: 'live', stops: 0, stop() { this.stops++; this.readyState = 'ended'; } });
  let requests = 0;
  const handed: T[][] = [];
  let mixed = false;
  const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedSecure = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const constraints: unknown[] = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: (c: unknown) => { requests++; constraints.push(JSON.parse(JSON.stringify(c))); const ts = mixed ? [track('video'), track('audio')] : [track('video')]; handed.push(ts); return Promise.resolve({ getTracks: () => ts.slice() }); } } } });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPalmCamera } = require('../apps/web/lib/palm-analysis/camera');
    const cam = createPalmCamera();
    check('A4c-5. behaviour: creating the camera makes no browser acquisition request', requests === 0);
    await cam.start();
    check('A4c-6. behaviour: exactly ONE browser acquisition request per accepted explicit start, video only', requests === 1 && constraints.every((c: any) => c && c.audio === false && !!c.video) && cam.getState().phase === 'live');
    await cam.start();
    check('A4c-7. behaviour: start() while live is not accepted and requests nothing', requests === 1);
    cam.stop('done');
    await cam.start();
    check('A4c-8. behaviour: a second accepted start makes exactly one more request; the first stream\'s tracks are all stopped', requests === 2 && handed[0].every((t) => t.readyState === 'ended'));
    cam.stop('done');
    mixed = true;
    await cam.start();
    const last = handed[handed.length - 1];
    check('A4c-9. behaviour: an unexpected mixed video/audio stream is REJECTED and every acquired track is stopped', cam.getState().phase === 'error' && last.length === 2 && last.every((t) => t.stops === 1 && t.readyState === 'ended'));
    cam.dispose();
    check('A4c-10. behaviour: after teardown no acquired track is live', handed.every((ts) => ts.every((t) => t.readyState === 'ended')));
  } finally {
    if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav); else delete (globalThis as any).navigator;
    if (savedSecure) Object.defineProperty(globalThis, 'isSecureContext', savedSecure); else delete (globalThis as any).isSecureContext;
  }
}

cameraBehaviour().catch((e) => check(`A4c behaviour (uncaught: ${String(e).slice(0, 120)})`, false)).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
