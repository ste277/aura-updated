/**
 * AURA-PALM-01-I1 -- content integrity, wording safety, analytics contract,
 * privacy and isolation checks for the educational Palmistry guide.
 *
 * Pure ts-node script (root tsconfig), same `check()` convention as the
 * rest of /test. The mounted-UI half lives in palm01I1ExploreJsdom.test.ts.
 *
 *   npx ts-node test/palm01I1Content.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  getPalmistryEntry,
  isPalmistryEntryId,
  PALMISTRY_CONTENT_REVIEW,
  PALMISTRY_ENTRIES,
  PALMISTRY_ENTRY_IDS,
  PALMISTRY_GENERAL_DISCLOSURE,
  PALMISTRY_HAND_CONVENTION_NOTE,
  PALMISTRY_INTRO,
  PALMISTRY_LINE_IDS,
  PALMISTRY_LONGEVITY_DISCLOSURE,
  PALMISTRY_MARK_IDS,
  PALMISTRY_DIAGRAM_NOTE,
} from '../packages/palmistry/src/content';
import { getPalmSource, PALM_SOURCES } from '../packages/palmistry/src/sources';
import { isProductEventName, validateProductEvent } from '../apps/web/lib/productEvents';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============================================================
// A. Shape of the content set
// ============================================================
const lines = PALMISTRY_ENTRIES.filter((e) => e.category === 'line');
const marks = PALMISTRY_ENTRIES.filter((e) => e.category === 'mark');

check('A1. exactly the four approved line categories, in order', JSON.stringify(lines.map((e) => e.id)) === JSON.stringify(['ayurlekha', 'dhanamatrlekha', 'pitrlekha', 'urdhvarekha']));
check('A2. at most five marks (ticket: up to five verified marks)', marks.length > 0 && marks.length <= 5);
check('A3. entry ids are unique', new Set(PALMISTRY_ENTRIES.map((e) => e.id)).size === PALMISTRY_ENTRIES.length);
check('A4. PALMISTRY_ENTRY_IDS matches the entries exactly', JSON.stringify([...PALMISTRY_ENTRY_IDS].sort()) === JSON.stringify(PALMISTRY_ENTRIES.map((e) => e.id).sort()));
check('A5. line/mark id lists match categories', PALMISTRY_LINE_IDS.every((id) => getPalmistryEntry(id)?.category === 'line') && PALMISTRY_MARK_IDS.every((id) => getPalmistryEntry(id)?.category === 'mark'));

// ============================================================
// B. Every published entry is source-backed and labelled
// ============================================================
for (const entry of PALMISTRY_ENTRIES) {
  check(`B1. ${entry.id}: has >= 1 source`, entry.sources.length >= 1);
  check(`B2. ${entry.id}: every sourceId resolves in the register`, entry.sources.every((ref) => Boolean(getPalmSource(ref.sourceId))));
  check(`B3. ${entry.id}: every source ref has a locator`, entry.sources.every((ref) => ref.locator.trim().length > 0));
  check(`B4. ${entry.id}: has a tradition label`, entry.tradition.trim().length > 0);
  check(`B5. ${entry.id}: tradition label is Indian-first`, /^Indian/.test(entry.tradition));
  check(`B6. ${entry.id}: has attribution status + confidence`, Boolean(entry.attributionStatus) && ['High', 'Medium', 'Low'].includes(entry.attributionConfidence));
  check(`B7. ${entry.id}: has non-empty description, interpretation and context note`, [entry.description, entry.interpretation, entry.contextNote].every((t) => t.trim().length > 20));
  check(`B8. ${entry.id}: not placeholder content`, !/TODO|TBD|lorem|placeholder|xxx/i.test(JSON.stringify(entry)));
  check(`B9. ${entry.id}: no entry is labelled a modern interpretation (Indian-first MVP)`, entry.attributionStatus !== 'modern-interpretation');
  check(
    `B10. ${entry.id}: at least one cited source was read directly or via a scholarly edition (never "not-read" only)`,
    entry.sources.some((ref) => getPalmSource(ref.sourceId)?.verification !== 'not-read')
  );
  if (entry.westernComparison) {
    check(`B11. ${entry.id}: Western comparison is explicitly labelled as Western`, /Western/.test(entry.westernComparison));
  }
}
check('B12. marks are symbol-only (never placed on the hand)', marks.every((e) => e.diagramPlacement === 'symbol-only'));
check('B13. lines are drawn from source descriptions', lines.every((e) => e.diagramPlacement === 'described-in-sources'));
check('B14. upward line is NOT equated with the Western Sun line', !/is the (western )?sun line/i.test(JSON.stringify(getPalmistryEntry('urdhvarekha'))) && /one upward line/.test(getPalmistryEntry('urdhvarekha')!.westernComparison ?? ''));
check('B15. longevity line is explicitly NOT the Western life line', /not the Western "life line"/.test(getPalmistryEntry('ayurlekha')!.westernComparison ?? ''));

// Traditional names may only be terms seen in sources actually read (D1 +
// I1 verification). Any new IAST term must be added here deliberately.
const VERIFIED_TERMS = new Set(['āyurlekhā', 'dhanamātṛlekhā', 'pitṛlekhā', 'ūrdhvarekhā', 'yava', 'matsya', 'śaṅkha', 'chatra', 'vedī']);
check('B16. every traditionalName is on the verified-terms list', PALMISTRY_ENTRIES.every((e) => !e.traditionalName || VERIFIED_TERMS.has(e.traditionalName)));

// ============================================================
// C. Source register
// ============================================================
for (const source of PALM_SOURCES) {
  check(`C1. ${source.id}: has author, title, sections, edition, licensing, verification`, [source.author, source.title, source.sections, source.edition, source.licensing, source.verification, source.shortCitation].every((v) => typeof v === 'string' && v.length > 0));
  if (source.url) check(`C2. ${source.id}: url is https`, /^https:\/\//.test(source.url));
}
check('C3. CC BY-SA licensing is recorded for the Zysk edition', /CC BY-SA 4\.0/.test(getPalmSource('zysk-2025')!.licensing));
check('C3b. Zysk carries a structured licence notice (name, official URL, copyright holder) for in-app attribution', (() => { const l = getPalmSource('zysk-2025')!.licence; return Boolean(l) && l!.name === 'CC BY-SA 4.0' && l!.url === 'https://creativecommons.org/licenses/by-sa/4.0/' && l!.copyrightHolder === 'Kenneth G. Zysk'; })());
check('C4. no source is Wikipedia', PALM_SOURCES.every((s) => !/wikipedia/i.test(JSON.stringify(s))));
check('C5. every source in the register is cited by at least one entry or is the edition other sources rely on', PALM_SOURCES.every((s) => s.id === 'zysk-2025' || PALMISTRY_ENTRIES.some((e) => e.sources.some((r) => r.sourceId === s.id))));

// ============================================================
// D. Disclosures and wording safety
// ============================================================
check('D1. general disclosure is the exact approved sentence', PALMISTRY_GENERAL_DISCLOSURE === 'Palmistry is a traditional interpretive practice, not a scientifically validated method of predicting personality, health, lifespan, or future events.');
check('D2. longevity disclosure states Aura does not estimate lifespan or predict death', /does not estimate lifespan or predict death/.test(PALMISTRY_LONGEVITY_DISCLOSURE));
check('D3. hand-convention note is historical and says Aura does not infer anything', /traditionally/.test(PALMISTRY_HAND_CONVENTION_NOTE) && /does not ask/.test(PALMISTRY_HAND_CONVENTION_NOTE));
check('D4. diagram note says the drawing is schematic and not every hand shows every feature', /schematic/.test(PALMISTRY_DIAGRAM_NOTE) && /no hand needs to show every feature/.test(PALMISTRY_DIAGRAM_NOTE));

const allUserFacingText = [
  ...PALMISTRY_ENTRIES.flatMap((e) => [e.title, e.traditionalName ?? '', e.description, e.interpretation, e.tradition, e.contextNote, e.westernComparison ?? '', ...e.sources.map((r) => r.locator)]),
  ...Object.values(PALMISTRY_INTRO),
  PALMISTRY_HAND_CONVENTION_NOTE,
  PALMISTRY_DIAGRAM_NOTE,
].join('\n');
const BANNED = [
  /\byou will\b/i,
  /\byour palm (proves|shows|means)\b/i,
  /\bguarantee/i,
  /\bdestined\b/i,
  /\bpredicts? your\b/i,
  /\bwill definitely\b/i,
  /\byou are\b/i,
  /\byour (lifespan|life span|future|health|death)\b/i,
  /\b\d{2,3} years\b/i, // no numerical lifespan figures (decision 2.2)
  /\bdie\b|\bdeath will\b/i,
  /\bdanger\b|\bwarning\b|\bbeware\b/i, // no fear-based language
];
for (const pattern of BANNED) {
  check(`D5. user-facing content avoids ${pattern}`, !pattern.test(allUserFacingText));
}
check('D7. no unverified tradition names (Hasta Sāmudrika / Sāmudrika Śāstra) in user-facing text', !/Hasta S[aā]mudrika|S[aā]mudrika [SŚ][aā]stra/i.test(allUserFacingText));
check('D8. the early Buddhist chapter is never called simply "9th-century" (it is dated after the mid-9th century)', !/9th-century (text|Buddhist|chapter)/i.test(allUserFacingText));
check('D6. no Western planetary mount is presented as an entry', !PALMISTRY_ENTRIES.some((e) => /mount of|jupiter|saturn|apollo|venus/i.test(e.title)));

// ============================================================
// E. Review status cannot silently claim approval
// ============================================================
check('E1. content review status is still PENDING_HUMAN_REVIEW', PALMISTRY_CONTENT_REVIEW.status === 'PENDING_HUMAN_REVIEW');
check('E2. no approver is recorded (no fabricated sign-off)', PALMISTRY_CONTENT_REVIEW.approvedBy === null);

// ============================================================
// F. Safe lookups
// ============================================================
check('F1. unknown id returns undefined', getPalmistryEntry('heart-line') === undefined);
check('F2. non-string id returns undefined', getPalmistryEntry(42) === undefined && getPalmistryEntry(null) === undefined && getPalmistryEntry(undefined) === undefined);
check('F3. prototype-ish ids are rejected', !isPalmistryEntryId('__proto__') && !isPalmistryEntryId('constructor'));

// ============================================================
// G. Analytics contract (existing closed taxonomy, no schema change)
// ============================================================
check('G1. PALMISTRY_GUIDE_OPENED is a known event', isProductEventName('PALMISTRY_GUIDE_OPENED'));
check('G2. per-feature selections are NOT tracked (no profile built from selections)', !isProductEventName('PALMISTRY_FEATURE_SELECTED'));
check('G3. no PALMISTRY_GUIDE_COMPLETED event was invented', !isProductEventName('PALMISTRY_GUIDE_COMPLETED'));
check('G4. GUIDE_OPENED accepts empty metadata', validateProductEvent('PALMISTRY_GUIDE_OPENED', {}).ok);
check('G5. GUIDE_OPENED rejects an entry id', !validateProductEvent('PALMISTRY_GUIDE_OPENED', { entryId: 'yava' }).ok);
check('G6. GUIDE_OPENED rejects observation-like metadata', !validateProductEvent('PALMISTRY_GUIDE_OPENED', { lineLength: 'long' }).ok);
check('G7. GUIDE_OPENED rejects image-like metadata', !validateProductEvent('PALMISTRY_GUIDE_OPENED', { image: 'data:image/png;base64,AAAA' }).ok);
check('G8. no PALMISTRY_* event other than GUIDE_OPENED exists', !/'PALMISTRY_(?!GUIDE_OPENED')[A-Z_]+'/.test(read('apps/web/lib/productEvents.ts')));

// ============================================================
// H. Privacy: no photo, camera, upload, AI, storage or data lookups
// ============================================================
const FEATURE_FILES = [
  'packages/palmistry/src/content.ts',
  'packages/palmistry/src/sources.ts',
  'apps/web/components/PalmistryView.tsx',
  'apps/web/components/PalmHandDiagram.tsx',
];
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const file of FEATURE_FILES) {
  const src = strip(read(file));
  check(`H1. ${file}: no fetch() / XMLHttpRequest / sendBeacon`, !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(src));
  check(`H2. ${file}: no camera / media capture`, !/getUserMedia|mediaDevices|capture=|@capacitor\/camera/.test(src));
  check(`H3. ${file}: no file input / upload / FileReader / canvas`, !/type=["']file["']|FileReader|FormData|<canvas|getContext\(/.test(src));
  check(`H4. ${file}: no AI / LLM service`, !/gemini|openai|anthropic|generativelanguage|ask-aura/i.test(src));
  check(`H5. ${file}: no browser storage`, !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(src));
  check(`H6. ${file}: no API route / db / prisma / session access`, !/['"`]\/api\/|lib\/db|prisma|getSession|\/users\//.test(src));
  check(`H7. ${file}: no external image service`, !/<img\b|<image\b|url\(\s*['"]?https?:/.test(src));
}
check('H8. the guide components never import the tracker or any lib/ module', !/from '\.\.\/lib\//.test(read('apps/web/components/PalmistryView.tsx')) && !/from '\.\.\/lib\//.test(read('apps/web/components/PalmHandDiagram.tsx')));

// ============================================================
// I. No database change
// ============================================================
const migrations = fs.readdirSync(path.join(ROOT, 'apps/web/prisma/migrations'));
check('I1. no migration mentions palm', migrations.every((m) => !/palm/i.test(m)));
check('I2. schema.prisma has no palmistry model/field', !/palm/i.test(read('apps/web/prisma/schema.prisma')));

// ============================================================
// J. Isolation from the timing engines (Panchang ranking untouched)
// ============================================================
const palmPackageSrc = read('packages/palmistry/src/content.ts') + read('packages/palmistry/src/sources.ts');
check('J1. packages/palmistry imports nothing outside itself', !/from ['"](?!\.\/)/.test(palmPackageSrc));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const ENGINE_DIRS = fs.readdirSync(path.join(ROOT, 'packages')).filter((d) => d !== 'palmistry');
const engineHits = ENGINE_DIRS.flatMap((d) => walk(path.join(ROOT, 'packages', d))).filter((f) => /palmistry|PalmistryView|PalmHandDiagram/.test(fs.readFileSync(f, 'utf8')));
check('J2. no engine package (panchang, muhurta, recommendation, window-ranking, ...) references palmistry', engineHits.length === 0);

const webLibHits = walk(path.join(ROOT, 'apps/web/lib')).filter((f) => /palmistry/i.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
check('J3. only lib/productEvents.ts (analytics enum) references palmistry in apps/web/lib', JSON.stringify(webLibHits) === JSON.stringify(['apps/web/lib/productEvents.ts']));

const componentHits = walk(path.join(ROOT, 'apps/web/components'))
  .filter((f) => /PalmistryView|PalmHandDiagram|packages\/palmistry/.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.basename(f))
  .sort();
check('J4. palmistry is referenced only by its own components (not Home, Plan, Timeline, Panchang, Muhurtham)', JSON.stringify(componentHits) === JSON.stringify(['PalmHandDiagram.tsx', 'PalmistryView.tsx', 'PalmistryView.unpublished.tsx']));

// ============================================================
// K. Build-level exclusion (AURA-PALM-01-P1)
// ============================================================
const exclusion = require('../apps/web/palmistry-build-exclusion');
const bundleCheck = require('../apps/web/scripts/check-palmistry-bundle');
class FakeReplacementPlugin {
  constructor(public pattern: RegExp, public replacement: string) {}
}
const fakeWebpack = { NormalModuleReplacementPlugin: FakeReplacementPlugin };

const reviewJson = JSON.parse(read('packages/palmistry/src/review-status.json'));
check('K1. review-status.json is PENDING_HUMAN_REVIEW with no approver (single source of truth)', reviewJson.status === 'PENDING_HUMAN_REVIEW' && reviewJson.approvedBy === null);
check('K2. content.ts derives its review status from review-status.json', /import reviewStatus from '\.\/review-status\.json'/.test(read('packages/palmistry/src/content.ts')) && PALMISTRY_CONTENT_REVIEW.status === reviewJson.status);
check('K3. build exclusion reads the same file and reports NOT approved', exclusion.isPalmistryApproved() === false && path.resolve(exclusion.REVIEW_STATUS_PATH) === path.join(ROOT, 'packages/palmistry/src/review-status.json'));

const prodConfig = exclusion.applyPalmistryExclusion({ plugins: [] }, { dev: false, webpack: fakeWebpack, approved: false });
check('K4. production + not approved: exactly one replacement plugin pointing at the stand-in', prodConfig.plugins.length === 1 && prodConfig.plugins[0] instanceof FakeReplacementPlugin && prodConfig.plugins[0].replacement === path.join(ROOT, 'apps/web/components/PalmistryView.unpublished.tsx'));
check('K5. dev builds keep the real module', exclusion.applyPalmistryExclusion({ plugins: [] }, { dev: true, webpack: fakeWebpack, approved: false }).plugins.length === 0);
check('K6. approved content is not excluded', exclusion.applyPalmistryExclusion({ plugins: [] }, { dev: false, webpack: fakeWebpack, approved: true }).plugins.length === 0);
check('K7. default (no `approved` passed) reads the file -> excluded in production', exclusion.applyPalmistryExclusion({ plugins: [] }, { dev: false, webpack: fakeWebpack }).plugins.length === 1);
const re: RegExp = exclusion.PALMISTRY_VIEW_REQUEST;
check('K8. replacement pattern matches the PalmistryView request forms', re.test('../components/PalmistryView') && re.test('/repo/apps/web/components/PalmistryView.tsx') && re.test('C:\\repo\\apps\\web\\components\\PalmistryView'));
check('K9. replacement pattern does not match the stand-in, the diagram or similar names', !re.test('../components/PalmistryView.unpublished') && !re.test('./PalmistryView.unpublished.tsx') && !re.test('./PalmHandDiagram') && !re.test('../components/PalmistryViewer') && !re.test('../components/ExploreView'));
const realNextConfig = require('../apps/web/next.config.js');
{
  const pendingCfg = exclusion.applyPalmistryExclusion({ plugins: [], cache: { type: 'filesystem', version: 'base' } }, { dev: false, webpack: fakeWebpack, approved: false });
  const approvedCfg = exclusion.applyPalmistryExclusion({ plugins: [], cache: { type: 'filesystem', version: 'base' } }, { dev: false, webpack: fakeWebpack, approved: true });
  check('K9b. approval state is part of the webpack cache key (pending vs approved differ)', pendingCfg.cache.version === 'base|palmistry-approved:no' && approvedCfg.cache.version === 'base|palmistry-approved:yes');
  check('K9c. a config without a cache object is left alone', exclusion.applyPalmistryExclusion({ plugins: [], cache: false }, { dev: false, webpack: fakeWebpack, approved: false }).cache === false);
}
check('K10. next.config.js wires the exclusion into its webpack hook', typeof realNextConfig.webpack === 'function' && realNextConfig.webpack({ plugins: [] }, { dev: false, webpack: fakeWebpack }).plugins.length === 1 && realNextConfig.webpack({ plugins: [] }, { dev: true, webpack: fakeWebpack }).plugins.length === 0);

// Import allowlist: the replacement only removes everything if the Palmistry
// tree is reachable SOLELY through components/PalmistryView.
// P1 review finding 5: scan ALL of apps/web (incl. middleware and root files),
// not just app/components/lib, skipping only dependency and build output.
function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.next', '.next-dev', 'android', 'ios', 'cap-shell', 'public'].includes(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) out.push(...walkSource(full));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}
const importSources = [...walkSource(path.join(ROOT, 'apps/web')), ...walkSource(path.join(ROOT, 'packages'))];
const importersOf = (pattern: RegExp) => importSources.filter((f) => pattern.test(strip(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(ROOT, f).replace(/\\/g, '/')).sort();
check('K11. only PalmistryView and PalmHandDiagram import packages/palmistry (relative imports inside the package excluded)', JSON.stringify(importersOf(/(from|require\()\s*['"][^'"]*packages\/palmistry\//)) === JSON.stringify(['apps/web/components/PalmHandDiagram.tsx', 'apps/web/components/PalmistryView.tsx']));
check('K12. only app/page.tsx imports components/PalmistryView', JSON.stringify(importersOf(/(from|require\()\s*['"][^'"]*\/PalmistryView['"]/)) === JSON.stringify(['apps/web/app/page.tsx']));
check('K13. only PalmistryView imports PalmHandDiagram', JSON.stringify(importersOf(/(from|require\()\s*['"][^'"]*\/PalmHandDiagram['"]/)) === JSON.stringify(['apps/web/components/PalmistryView.tsx']));
check('K14. only the build-exclusion module refers to the stand-in (nothing imports it directly)', JSON.stringify(importersOf(/PalmistryView\.unpublished/)) === JSON.stringify(['apps/web/palmistry-build-exclusion.js']));

// The stand-in must be content-free and export what page.tsx imports.
const stubSrc = read('apps/web/components/PalmistryView.unpublished.tsx');
check('K15. stand-in contains none of the bundle sentinels', bundleCheck.SENTINELS.every((s: string) => !stubSrc.includes(s)));
check('K16. stand-in imports nothing from packages/palmistry or the real view', !/packages\/palmistry|from '\.\/PalmistryView'|PalmHandDiagram/.test(strip(stubSrc)));
const pageImports = (read('apps/web/app/page.tsx').match(/import \{([^}]*)\} from '\.\.\/components\/PalmistryView'/)?.[1] ?? '').split(',').map((n) => n.trim()).filter(Boolean).sort();
const exportsOf = (src: string) => Array.from(strip(src).matchAll(/export (?:function|const) (\w+)/g)).map((m) => m[1]).sort();
check('K17. every name page.tsx imports from PalmistryView is exported by BOTH the real module and the stand-in', pageImports.length === 3 && pageImports.every((n) => exportsOf(stubSrc).includes(n) && exportsOf(read('apps/web/components/PalmistryView.tsx')).includes(n)));

// Bundle-check sentinels must really occur in the source, or the post-build
// check could pass vacuously.
const palmSources = ['packages/palmistry/src/content.ts', 'packages/palmistry/src/sources.ts', 'packages/palmistry/src/review-status.json', 'apps/web/components/PalmistryView.tsx', 'apps/web/components/PalmHandDiagram.tsx'].map(read).join('\n');
for (const s of bundleCheck.SENTINELS) check(`K18. bundle sentinel present in source: ${s}`, palmSources.includes(s));
check('K18b. every bundle sentinel is ASCII-only (survives minifier escaping)', bundleCheck.SENTINELS.every((s: string) => /^[\x20-\x7e]+$/.test(s)));
check('K18c. at least 8 sentinels, covering content, sources, UI copy and review state', bundleCheck.SENTINELS.length >= 8);
check('K19. no sentinel occurs in ExploreView (card copy moved out)', bundleCheck.SENTINELS.every((s: string) => !read('apps/web/components/ExploreView.tsx').includes(s)));
// K21: negative control -- the scanner really detects leaked content.
{
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-bundle-check-'));
  fs.mkdirSync(path.join(tmp, '.next/static/chunks'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.next/static/chunks/clean.js'), 'console.log("no content here");');
  check('K21a. scanner reports nothing for a clean build', bundleCheck.scan(tmp).length === 0);
  fs.writeFileSync(path.join(tmp, '.next/static/chunks/leak.js'), `var x={status:"PENDING_HUMAN_REVIEW",id:"zysk-2025"};`);
  const hits = bundleCheck.scan(tmp);
  check('K21b. scanner flags leaked sentinels with file paths', hits.length === 2 && hits.every((h: { file: string }) => h.file.endsWith('leak.js')));
  fs.rmSync(tmp, { recursive: true, force: true });
}
check('K20. CI runs the bundle check right after the production build', /run: npm run build\n(?:\s+#.*\n)*\s+- name: Verify unapproved Palmistry content is excluded from the build\n\s+working-directory: apps\/web\n\s+run: node scripts\/check-palmistry-bundle\.js/.test(read('.github/workflows/ci.yml')));
check('J5. no API route references palmistry', walk(path.join(ROOT, 'apps/web/app/api')).every((f) => !/palmistry/i.test(fs.readFileSync(f, 'utf8'))));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
