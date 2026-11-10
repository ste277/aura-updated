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
check('J4. palmistry is referenced only by its own components (not Home, Plan, Timeline, Panchang, Muhurtham)', JSON.stringify(componentHits) === JSON.stringify(['PalmHandDiagram.tsx', 'PalmistryView.tsx']));
check('J5. no API route references palmistry', walk(path.join(ROOT, 'apps/web/app/api')).every((f) => !/palmistry/i.test(fs.readFileSync(f, 'utf8'))));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
