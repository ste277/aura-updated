/**
 * AURA-PALM-03-E1 -- end-to-end tests: PALM-03-I1 feature set (synthetic landmarks + synthetic user traces) ->
 * finger bases -> E1 descriptors -> structured personalised reading. Synthetic only: no image, camera, upload,
 * network or storage. The engine package's own suite (packages/palm-reading-engine/e1/test) covers the library,
 * the 5,760-derivation oracle comparison and the production guard; this file covers the I1 -> E1 path and the
 * PALM-03-I1 carry-forward acceptance requirements M4 and E1-A1..A5.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildPalmFeatureSet, type LineInput, type MarkInput, type PalmFeatureSetInput } from '../apps/web/lib/palm-analysis/features';
import { palmFingerBases, PALM_FINGER_BASES_VERSION } from '../apps/web/lib/palm-analysis/fingerBases';
import { generateSyntheticReading } from '../packages/palm-reading-engine/e1/src/reading';

// The engine package is ESM (.mjs); Node >= 22.12 loads it through require().
// eslint-disable-next-line @typescript-eslint/no-var-requires
const e1 = require('../packages/palm-reading-engine/e1/src/index.mjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const construction = require('../packages/palm-reading-engine/e1/src/construction.mjs');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) passed++;
  else failures.push(`${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 600)}`}`);
}
const throwsCode = (fn: () => unknown, code: string): boolean => { try { fn(); return false; } catch (e: any) { return e instanceof e1.E1Error && e.code === code; } };

// ---------------------------------------------------------------- synthetic hand (palm frame = xy / 12, exact)
const XY = [[2, 12], [-3, 10], [-5, 7], [-7, 4], [-9, 2], [0, 0], [-1, -5], [-2, -8], [-3, -12], [4, 0], [4, -5], [4, -9], [4, -13], [8, 0], [9, -5], [9, -8], [9, -11], [12, 0], [13, -4], [13, -7], [13, -10]];
const point = ([x, y]: number[]) => ({ x: (24 + x) / 64, y: (32 + y) / 128 });
const LM = XY.map(point);
const P = (X: number, Y: number) => point([12 * X, 12 * Y]); // palm-frame point -> normalised image point
const traced = (line: LineInput['line'], pts: [number, number][], confirmed = true): LineInput => ({ line, action: 'traced', points: pts.map(([x, y]) => P(x, y)), confirmed });
const skipped = (line: LineInput['line'], reason: 'user-skipped' | 'user-cannot-see' = 'user-skipped'): LineInput => ({ line, action: 'skipped', reason });
const heartTo = (x: number) => traced('heart', [[0.95, 0.22], [0.5, 0.2], [x, 0.15]]);
const upwardTo = (x: number) => traced('upward', [[x + 0.02, 0.95], [x + 0.01, 0.55], [x, 0.12]]);
const headDrop = (d: number) => traced('head', [[0.05, 0.35], [0.5, 0.35 + d / 2], [0.92, 0.35 + d]]);
const lifeLine = traced('life', [[0.1, 0.3], [0.05, 0.7], [0.12, 1.1]]);

function input(over: Partial<PalmFeatureSetInput> = {}): PalmFeatureSetInput {
  return { imageWidth: 64, imageHeight: 128, landmarks: LM, hand: 'left', dominantHand: 'unknown', handednessLabel: 'Left', qualityIssues: [], rotationDeg: 0, lines: [], marks: [], ...over };
}
const built = (i: PalmFeatureSetInput): any => { const r = buildPalmFeatureSet(i); if (!r.ok) throw new Error(`fixture invalid: ${r.errors.join('; ')}`); return r.featureSet; };
// R3: the reading interface takes ONE synthetic input; the I1 feature set and finger bases are constructed inside.
const reading = (over: Partial<PalmFeatureSetInput> = {}, mode = 'combined'): any => generateSyntheticReading(input(over), { synthetic: true, mode: mode as any });
const plan = (obs: unknown, o: Record<string, unknown> = {}) => e1.planSelection(e1.defaultLibrary(), obs, { synthetic: true, ...o });
const items = (r: any): string[] => r.sections.flatMap((s: any) => s.items.map((i: any) => i.recordId));
// the fixture's measured middle-finger ratio (1.069) always adds C1-WE-FINGER-LONG; line assertions look at line-read items
const lineItems = (r: any): string[] => r.sections.flatMap((s: any) => s.items.filter((i: any) => i.supportingFeatures.every((f: any) => f.feature.startsWith('lines.'))).map((i: any) => i.recordId));
const na = (r: any, f: string) => r.notAssessed.find((n: any) => n.feature === f);

// ============================================================ A. finger-base descriptor input (I1 helper)
const fb = palmFingerBases(LM, 64, 128);
check('A1. finger bases are the I1 palm frame: index (0,0), little (1,0), middle and ring between', fb.ok && JSON.stringify(fb.bases) === JSON.stringify({ index: { x: 0, y: 0 }, middle: { x: 0.3333, y: 0 }, ring: { x: 0.6667, y: 0 }, little: { x: 1, y: 0 } }), fb);
check('A2. no frame -> no finger bases, with the I1 frame reason (never estimated)', JSON.stringify(palmFingerBases(null, 64, 128)) === JSON.stringify({ ok: false, reason: 'landmarks-invalid' }) && (palmFingerBases(LM, 0, 128) as any).reason === 'image-size-invalid');
check('A3. helper version recorded', PALM_FINGER_BASES_VERSION === 'palm-03-e1-finger-bases@0.1.0');
check('A4. finger bases are invariant to image rotation (same palm frame)', (() => {
  const th = 0.5, c = Math.cos(th), s = Math.sin(th);
  const rot = XY.map(([x, y]) => ({ x: (300 + c * x * 10 - s * y * 10) / 600, y: (300 + s * x * 10 + c * y * 10) / 600 }));
  const r = palmFingerBases(rot, 600, 600);
  return r.ok && Math.abs(r.bases.middle.x - 1 / 3) < 1e-3 && Math.abs(r.bases.ring.x - 2 / 3) < 1e-3 && Math.abs(r.bases.little.x - 1) < 1e-3;
})());

// ============================================================ B. descriptors end to end (traces -> records)
const rHeartIdx = reading({ lines: [heartTo(-0.05)] });
check('B1. heart radial end under the index finger -> C1-WE-HEART-JUPITER in Relationships', lineItems(rHeartIdx).join() === 'C1-WE-HEART-JUPITER' && rHeartIdx.sections.find((s: any) => s.category === 'emotional-relational')?.items[0].recordId === 'C1-WE-HEART-JUPITER' && rHeartIdx.domains.find((d: any) => d.domain === 'relationships').status === 'shown', rHeartIdx.sections);
check('B2. heart radial end between index and middle -> C1-WE-HEART-BETWEEN', lineItems(reading({ lines: [heartTo(0.1667)] })).join() === 'C1-WE-HEART-BETWEEN');
check('B3. heart radial end near a zone edge -> nothing shown, reason boundary (RC-7)', lineItems(reading({ lines: [heartTo(0.095)] })).length === 0 && na(reading({ lines: [heartTo(0.095)] }), 'lines.heart').code === 'boundary');
check('B4. heart ending under the middle finger (Saturn origin, not emitted) -> no-supported-content', na(reading({ lines: [heartTo(0.36)] }), 'lines.heart').code === 'no-supported-content');
check('B5. upward ending zones map to the four ūrdhva records', ['C1-IN-URDHVA-INDEX', 'C1-IN-URDHVA-MIDDLE', 'C1-IN-URDHVA-RING', 'C1-IN-URDHVA-LITTLE'].every((id, k) => lineItems(reading({ lines: [upwardTo([0.0, 0.3333, 0.6667, 0.98][k])] })).join() === id));
check('B6. upward ending near the middle|ring edge -> boundary', na(reading({ lines: [upwardTo(0.52)] }), 'lines.upward').code === 'boundary');
const rIdx = reading({ lines: [upwardTo(0.0)] });
check('B7. disputed URDHVA-INDEX carries its disagreement text and a disputed disclosure', (() => { const it = rIdx.sections.flatMap((s: any) => s.items).find((i: any) => i.recordId === 'C1-IN-URDHVA-INDEX'); return it && it.disclosures.includes('disputed-within-tradition') && /texts disagree/.test(it.text.reading); })());
check('B8. head slope: straight / sloping / boundary', lineItems(reading({ lines: [headDrop(0)] })).join() === 'C1-WE-HEAD-STRAIGHT' && lineItems(reading({ lines: [headDrop(0.2)] })).join() === 'C1-WE-HEAD-SLOPING' && na(reading({ lines: [headDrop(0.1)] }), 'lines.head').code === 'boundary');
check('B9. life line trace -> pitṛlekhā record (Indian), shown once', items(reading({ lines: [lifeLine] })).filter((x) => x === 'C1-IN-PITR-KNOWLEDGE').length === 1);
const rFull = reading({ lines: [heartTo(-0.05), headDrop(0.2), lifeLine, upwardTo(0.3333)] });
check('B10. full synthetic hand: sections follow the C1 placement rules and all four domains are shown', JSON.stringify(rFull.sections.map((s: any) => [s.category, s.items.map((i: any) => i.recordId)])) === JSON.stringify([
  ['personality', ['C1-WE-HEAD-SLOPING', 'C1-WE-FINGER-LONG']], ['strengths', ['C1-IN-PITR-KNOWLEDGE']], ['emotional-relational', ['C1-WE-HEART-JUPITER']], ['career-working-style', ['C1-IN-URDHVA-MIDDLE']],
]) && rFull.domains.filter((d: any) => d.status === 'shown').length === 3, rFull.sections.map((s: any) => [s.category, s.items.map((i: any) => i.recordId)]));
check('B11. the long index finger (excluded record) is listed only as "Not read in this version."', na(rFull, 'measurements.indexToRingRatio').code === 'not-read-in-this-version' && na(rFull, 'measurements.indexToRingRatio').wording === 'Not read in this version.' && !/pride|love of power|command over|domineer/i.test(JSON.stringify(rFull)));
check('B12. head and life both traced: the origin gap is not measured and is listed as not read (C1: not necessary)', na(rFull, 'proposed.origin.gap').code === 'not-read-in-this-version' && !JSON.stringify(rFull).includes('ORIGIN'));
const it0 = rFull.sections[3].items[0];
check('B13. each item carries id, tradition, supporting feature + provenance, sources, confidence, suitability, text, reflection', it0.recordId === 'C1-IN-URDHVA-MIDDLE' && it0.traditionTag === 'Indian · medieval treatise' && it0.supportingFeatures[0].provenance === 'user-confirmed' && it0.supportingFeatures[0].observed === 'middle' && it0.sources.length >= 1 && it0.sources.every((s: any) => s.locator && s.supportLevel) && it0.confidence.tier === 'tentative' && it0.suitability.eligibility === 'eligible-initial' && it0.text.reading.length > 0 && it0.text.reflection.endsWith('?') && it0.reviewStatus === 'UNREVIEWED_RESEARCH_CONTENT', it0);
check('B14. modes: indian-only drops Western items and lists their features as no-supported-content; western-only drops Indian items', (() => {
  const ind = reading({ lines: [heartTo(-0.05), headDrop(0.2), lifeLine, upwardTo(0.3333)] }, 'indian-only');
  const wes = reading({ lines: [heartTo(-0.05), headDrop(0.2), lifeLine, upwardTo(0.3333)] }, 'western-only');
  return items(ind).every((x) => x.startsWith('C1-IN-')) && items(wes).every((x) => x.startsWith('C1-WE-')) && na(ind, 'lines.heart').code === 'no-supported-content' && na(wes, 'lines.upward').code === 'no-supported-content';
})());
check('B15. deterministic end to end (identical input -> identical JSON)', JSON.stringify(reading({ lines: [heartTo(-0.05), lifeLine] })) === JSON.stringify(reading({ lines: [heartTo(-0.05), lifeLine] })));

// ============================================================ M4 / E1-A1..A5 (PALM-03-I1 carry-forward)
const rSkip = reading({ lines: [skipped('head'), skipped('life', 'user-cannot-see'), heartTo(-0.05)] });
check('M4/A1-1. user-skipped line -> its own reason and wording, never "not detected" or a photo/detector limitation', na(rSkip, 'lines.head').code === 'user-skipped' && na(rSkip, 'lines.head').wording === 'You chose to skip this.' && !/detect|photo|camera|scanner/i.test(na(rSkip, 'lines.head').wording));
check('M4/A1-2. user-cannot-see line -> its own reason', na(rSkip, 'lines.life').code === 'user-cannot-see' && !/detect/i.test(na(rSkip, 'lines.life').wording));
check('M4/A1-3. no reading ever uses detector wording or the detector-missing code for user input', !/not detected|detector/i.test(JSON.stringify(rSkip.notAssessed)) && !rSkip.notAssessed.some((n: any) => n.code === 'detector-missing'));
check('M4/A1-4. a skipped feature produces no interpretation', !items(rSkip).some((x) => /PITR|HEAD/.test(x)));
const rUnassessed = reading({ lines: [traced('heart', [[0.95, 0.22], [0.5, 0.2], [-0.05, 0.15]], false), traced('head', [[0.1, 0.3], [0.1001, 0.3001]])] });
check('A2-1. not traced (optional upward) / not confirmed / unusable trace are distinct unassessed reasons; none is read', na(rUnassessed, 'lines.upward').code === 'not-traced' && na(rUnassessed, 'lines.heart').code === 'trace-unusable' && na(rUnassessed, 'lines.heart').detail === 'not-confirmed' && na(rUnassessed, 'lines.head').code === 'trace-unusable' && /^trace-/.test(na(rUnassessed, 'lines.head').detail) && lineItems(rUnassessed).length === 0, rUnassessed.notAssessed);
check('A2-2. unreported marks are unknown (never absent); a skipped mark keeps the user reason', na(reading({ marks: [{ mark: 'vedi', action: 'skipped' } as MarkInput] }), 'marks.vedi').code === 'user-skipped' && na(reading(), 'marks.yava').code === 'mark-unknown');
check('A2-3. I1 has no observed-absence input, so E1 never reports observed-absent from a feature set; absence is never interpreted (composer: only eligible matches emit)', !reading({ lines: [skipped('heart')] }).notAssessed.some((n: any) => n.code === 'observed-absent') && plan({ 'lines.life': { notAssessed: 'observed-absent' } }).sections.length === 0);
const rFrame = reading({ landmarks: null, lines: [heartTo(-0.05), lifeLine] });
check('A2-4. no palm frame -> traced lines are frame-unavailable (unassessed, not absent) and nothing is read', na(rFrame, 'lines.heart').code === 'frame-unavailable' && na(rFrame, 'lines.life').code === 'frame-unavailable' && items(rFrame).length === 0);
check('A3-1. E1 reads no branches, forks or breaks: no initial record needs them and no reading contains them', !/branch|fork|break/i.test(JSON.stringify(rFull)) && e1.defaultLibrary().initialIds.every((id: string) => e1.defaultLibrary().byId[id].requires.every((r: any) => !/branch|fork|break|continuity/i.test(`${r.feature} ${r.observation?.descriptor ?? ''}`))));
check('A4-1. consistent diagnostics: every line is either read by an item or listed once with the code its I1 status implies', (() => {
  const inp = input({ lines: [heartTo(-0.05), skipped('head'), traced('life', [[0.1, 0.3], [0.1001, 0.3001]]), upwardTo(0.52)] });
  const env = { featureSet: built(inp) };
  const r: any = generateSyntheticReading(inp, { synthetic: true });
  const expectCode: Record<string, string> = { 'user-skipped': 'user-skipped', 'user-cannot-see': 'user-cannot-see', 'not-requested': 'not-traced', 'frame-unavailable': 'frame-unavailable' };
  return (['heart', 'head', 'life', 'upward'] as const).every((id) => {
    const f = `lines.${id}`, l: any = env.featureSet.lines[id];
    const used = r.sections.some((s: any) => s.items.some((i: any) => i.supportingFeatures.some((x: any) => x.feature === f)));
    const listed = r.notAssessed.filter((n: any) => n.feature === f);
    if (used) return listed.length === 0 && l.provenance === 'user-confirmed';
    if (listed.length !== 1) return false;
    if (l.provenance === 'user-confirmed') return ['boundary', 'no-supported-content', 'not-read-in-this-version', 'trace-unusable', 'frame-unavailable'].includes(listed[0].code);
    return listed[0].code === (expectCode[l.reason] ?? 'trace-unusable') && listed[0].detail === l.reason;
  });
})());
check('A5-1. tentative ceiling everywhere; quality is never shown as a confidence number', rFull.tierCeiling === 'tentative' && rFull.sections.every((s: any) => s.items.every((i: any) => i.confidence.tier === 'tentative' && !Object.values(i.confidence).some((v) => typeof v === 'number'))));
check('A5-2. synthetic-only: the reading interface and planSelection refuse without an explicit OWN { synthetic: true } (R4 F7)', [undefined, null, {}, { synthetic: 'yes' }, { synthetic: 1 }, { synthetic: false }, Object.create({ synthetic: true }), Object.defineProperty({}, 'synthetic', { get: () => true, enumerable: true })].every((o) => throwsCode(() => generateSyntheticReading(input(), o as any), 'synthetic-required') && throwsCode(() => e1.planSelection(e1.defaultLibrary(), {}, o), 'synthetic-required')) && !fs.existsSync(path.join(ROOT, 'packages/palm-reading-engine/e1/src/engine-core.mjs')) && !('composeReading' in e1) && !('deriveObservations' in e1) && !('composeFromObservations' in e1));
check('A5-3. separate identity from the frozen G6 engine, which E1 never imports', e1.E1_ENGINE.id === 'aura.palm.e1-reading' && fs.readdirSync(path.join(ROOT, 'packages/palm-reading-engine/e1/src')).every((f) => !/from '[^']*prototype\//.test(fs.readFileSync(path.join(ROOT, 'packages/palm-reading-engine/e1/src', f), 'utf8'))));
check('A5-4. the 23 Western G6 rule texts are excluded: none appears in the E1 catalogue or any reading', (() => {
  const rules = fs.readFileSync(path.join(ROOT, 'packages/palm-reading-engine/prototype/src/rules.mjs'), 'utf8');
  const texts = [...rules.matchAll(/\btext: '([^']{12,})'/g)].map((m) => m[1]);
  const cat = fs.readFileSync(path.join(ROOT, 'packages/palm-reading-engine/e1/library/catalogue.json'), 'utf8') + JSON.stringify(rFull);
  return texts.length >= 15 && texts.every((t) => !cat.includes(t));
})());
const rBlur = reading({ qualityIssues: ['blurry'], lines: [skipped('heart'), lifeLine] });
check('A5-5. quality gate: not-accepted G5 quality -> nothing emitted, observed features quality-gated, user reasons kept', items(rBlur).length === 0 && rBlur.quality.accepted === false && na(rBlur, 'measurements.middleToPalmRatio').code === 'quality-gated' && /^uncertain:/.test(na(rBlur, 'measurements.middleToPalmRatio').detail) && na(rBlur, 'lines.life').code === 'quality-gated' && na(rBlur, 'lines.heart').code === 'user-skipped' && rBlur.emptyResult !== null, rBlur.notAssessed);
check('A5-6. unknown quality (no G5 feedback) is not accepted either', reading({ qualityIssues: null, lines: [lifeLine] }).quality.accepted === false);
check('A5-7. uncertain vs unavailable measurements stay distinct: an uncertain value under accepted quality is never read and keeps its I1 detail', (() => {
  const r = plan({ 'measurements.middleToPalmRatio': { notAssessed: 'measurement-unavailable', detail: 'uncertain:implausible-proportions' } });
  return r.sections.length === 0 && na(r, 'measurements.middleToPalmRatio').detail === 'uncertain:implausible-proportions';
})());

// ============================================================ C. invalid input and interface (R3)
const goodIn = input({ lines: [heartTo(-0.05)] });
check('C1. input the I1 builder refuses is refused (duplicate line, bad skip reason, bad mark)', [
  { lines: [heartTo(-0.05), heartTo(0.1)] }, { lines: [{ line: 'head', action: 'skipped', reason: 'bored' } as any] }, { marks: [{ mark: 'unknown', action: 'reported' } as any] },
].every((o) => throwsCode(() => reading(o), 'invalid-input')));
check('C2. no catalogue, schema, library, feature-set, finger-base or observation override is accepted', ['library', 'catalogue', 'schema', 'featureSet', 'fingerBases', 'observations'].every((k) => throwsCode(() => generateSyntheticReading(goodIn, { synthetic: true, [k]: {} } as any), 'invalid-option')));
check('C3. non-object input is refused', [null, [], 'x', 1].every((x) => throwsCode(() => generateSyntheticReading(x as any, { synthetic: true }), 'invalid-input')));
check('C5. invalid mode refused', throwsCode(() => generateSyntheticReading(goodIn, { synthetic: true, mode: 'all' as any }), 'invalid-option'));
check('C6. inputs are not mutated by the engine', (() => { const x = JSON.parse(JSON.stringify(goodIn)); generateSyntheticReading(x, { synthetic: true }); return JSON.stringify(x) === JSON.stringify(goodIn); })());
check('C7. the reading is deeply frozen: derived geometry, traces and items cannot be replaced after construction', (() => {
  const r: any = generateSyntheticReading(goodIn, { synthetic: true });
  const tries = [() => { r.observed[0].value = 'index'; }, () => { r.sections[0].items[0].recordId = 'C1-WE-INDEX-LONG'; }, () => { r.notAssessed.push({}); }, () => { r.frame = ''; }];
  return Object.isFrozen(r) && tries.every((t) => { try { t(); return false; } catch { return true; } });
})());

// ============================================================ D. isolation of the new I1 helper
const helper = fs.readFileSync(path.join(ROOT, 'apps/web/lib/palm-analysis/fingerBases.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
check('D1. helper: no network, storage, console, camera, external URL or engine reference', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|console\.|getUserMedia|mediaDevices|https?:\/\/|reading-engine|palm-g6|mediapipe|aura\.palm/i.test(helper));
const webFiles = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', '.next'].includes(e.name) ? [] : webFiles(path.join(d, e.name))) : /\.(ts|tsx|js|mjs|cjs)$/.test(e.name) ? [path.join(d, e.name)] : []));
check('D2. no app module imports the helper; the G5 public surface does not export it', webFiles(path.join(ROOT, 'apps/web')).every((f) => f.endsWith('fingerBases.ts') || !/fingerBases/.test(fs.readFileSync(f, 'utf8'))) && !/fingerBases/.test(fs.readFileSync(path.join(ROOT, 'apps/web/lib/palm-analysis/index.ts'), 'utf8')));
check('D3. the E1 production-build guard is wired into CI after next build', /node scripts\/check-palm-e1-bundle\.js/.test(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')));

// ============================================================ F. one construction path (R3 F6, R4 F6)
// R5: construction authority is not exported or claimable: reading.ts binds the I1 builder at load and builds,
// verifies, derives and composes in module-private functions. (R4 text follows.) No function accepts a feature set separately from building it. The pipeline (engine-core.mjs) is claimed once,
// by reading.ts, and builds the I1 feature set itself from a snapshot of the input. The internal check that a feature
// set derives from the input (construction.mjs verifyConstruction, which returns no reading) still refuses every
// mixed state, which also covers a pipeline claimed by other code with a builder of its own (F12).
const XY_B = XY.map(([x, y], k) => (k === 9 ? [3, 0] : k === 13 ? [6, 0] : [x, y]));
const inA = input({ lines: [heartTo(0.1667), upwardTo(0.3333)] });
const inB = input({ landmarks: XY_B.map(point), lines: [heartTo(0.1667), upwardTo(0.3333)] });
const fsA = built(inA), fsB = built(inB);
const verify = (i: unknown, f: unknown) => construction.verifyConstruction(i, f);
check('F1. the reading interface has no geometry or feature-set parameter: generateSyntheticReading(input, { synthetic, mode })', generateSyntheticReading.length === 2 && ['fingerBases', 'featureSet', 'observations', 'library'].every((k) => throwsCode(() => generateSyntheticReading(inA, { synthetic: true, [k]: {} } as any), 'invalid-option')));
// D6-I1 (owner-approved B1): the interface now has exactly one more entry point, the development-gated confirmed-scanner one
check('F1b. R5: there is no claimable pipeline, core module or mixed-state entry point; reading.ts exports only the interface', !fs.existsSync(path.join(ROOT, 'packages/palm-reading-engine/e1/src/engine-core.mjs')) && !fs.existsSync(path.join(ROOT, 'packages/palm-reading-engine/e1/src/observations.mjs')) && Object.keys(require('../packages/palm-reading-engine/e1/src/reading')).sort().join() === 'E1Error,E1_ENGINE,generateConfirmedScannerReading,generateSyntheticReading');
check('F2. swapped finger bases (witness): hand B geometry with hand A traces -> construction-mismatch', throwsCode(() => verify(inA, fsB), 'construction-mismatch'));
check('F3. substituted trace (witness): a feature set whose heart trace differs from the supplied trace -> construction-mismatch', throwsCode(() => verify(inA, built(input({ lines: [heartTo(-0.05), upwardTo(0.3333)] }))), 'construction-mismatch'));
check('F4. fabricated frame (witness): a feature set claiming no frame, or another frame, for this input -> construction-mismatch', throwsCode(() => verify(inA, built(input({ landmarks: null, lines: [heartTo(0.1667), upwardTo(0.3333)] }))), 'construction-mismatch') && throwsCode(() => verify(input({ landmarks: XY_B.map(point) }), built(input())), 'construction-mismatch'));
check('F5. substituted measurements: a feature set from a hand with different finger lengths (same frame and traces) -> construction-mismatch', (() => {
  const XY_C = XY.map(([x, y], k) => (k >= 10 && k <= 12 ? [x, y - 2] : [x, y]));
  return throwsCode(() => verify(input(), built(input({ landmarks: XY_C.map(point) }))), 'construction-mismatch');
})());
check('F6. skip reasons, confirmation, quality and hand must also match the input', [
  [input({ lines: [skipped('head')] }), built(input({ lines: [skipped('head', 'user-cannot-see')] }))],
  [input({ lines: [heartTo(-0.05)] }), built(input({ lines: [traced('heart', [[0.95, 0.22], [0.5, 0.2], [-0.05, 0.15]], false)] }))],
  [input({ qualityIssues: [] }), built(input({ qualityIssues: null }))],
  [input({ hand: 'left' }), built(input({ hand: 'right' }))],
].every(([i, f]) => throwsCode(() => verify(i, f), 'construction-mismatch')));
check('F7. a feature set that does derive from the input is accepted', (() => { try { verify(inA, fsA); return true; } catch { return false; } })());
check('F8. a correctly constructed hand reads both zones', ['C1-WE-HEART-BETWEEN', 'C1-IN-URDHVA-MIDDLE'].every((id) => items(generateSyntheticReading(inA, { synthetic: true })).includes(id)));
// R4 witness: a palm-facing feature set paired with an input the public path classifies as back-facing
const inBack = input({ handednessLabel: 'Right', lines: [heartTo(0.1667), upwardTo(0.3333)] });
check('F9. R4 witness: back-facing input -> the public path emits nothing; pairing it with the palm-facing feature set -> construction-mismatch (palm facing)', built(inA).frame.palmFacing === true && built(inBack).frame.palmFacing === false && items(generateSyntheticReading(inBack, { synthetic: true })).length === 0 && (generateSyntheticReading(inBack, { synthetic: true }) as any).quality.detail === 'palm-not-facing' && throwsCode(() => verify(inBack, fsA), 'construction-mismatch'));
check('F10. measurement availability and status must match the input: unknown facing, unknown or degrading quality, blocking quality', [
  [input({ handednessLabel: undefined }), fsA], [input({ qualityIssues: null }), fsA], [input({ qualityIssues: ['blurry'] }), fsA], [input({ qualityIssues: ['hand-cut-off'] }), fsA],
  [inA, built(input({ lines: [heartTo(0.1667), upwardTo(0.3333)], qualityIssues: ['blurry'] }))],
].every(([i, f]) => throwsCode(() => verify(i, f), 'construction-mismatch')));
check('F11. the facing and status ports agree with the I1 builder (no false refusal) across labels, quality and hands', (() => {
  const labels = ['Left', 'Right', undefined, 'Unknown'];
  const qualities: any[] = [[], null, ['blurry'], ['hand-rotated', 'too-dark'], ['hand-cut-off'], ['palm-not-visible']];
  const hands = [XY, XY_B, XY.map(([x, y], k) => (k >= 10 && k <= 12 ? [x, y - 2] : [x, y])), XY.map(([x, y], k) => (k === 8 ? [-1, -3] : k === 16 ? [9, -6] : [x, y])), XY.map(([x, y], k) => (k === 0 ? [x, y * 2.2] : [x, y]))];
  let n = 0;
  for (const h of hands) for (const handednessLabel of labels) for (const qualityIssues of qualities) {
    const i = input({ landmarks: h.map(point), handednessLabel, qualityIssues, lines: [heartTo(0.1667), upwardTo(0.3333)] });
    const b = buildPalmFeatureSet(i);
    if (!b.ok) continue;
    try { verify(i, b.featureSet); n++; } catch (e) { console.log('F11 false refusal', JSON.stringify({ handednessLabel, qualityIssues }), String(e)); return false; }
  }
  return n >= 100;
})());
// R5 witnesses, fresh processes. The R4 independent witness substituted a feature set claiming the confirmed heart trace
// was unassessed ('trace-too-few-points'). There is no claim any more; the only remaining substitution route is
// replacing the I1 module's exported builder BEFORE reading.ts binds it (initialization order). Every substituted
// state -- including apparently valid unassessed states -- must be refused, and nothing eligible suppressed.
const R5_SCRIPT = `
  const W = ${JSON.stringify(ROOT)};
  const features = require(W + '/apps/web/lib/palm-analysis/features');
  const real = features.buildPalmFeatureSet;
  const cases = JSON.parse(process.argv[1]);
  let k = 0;
  if (process.argv[2] === 'substitute') features.buildPalmFeatureSet = () => real(cases[k].builtFrom); // before reading.ts loads
  const { generateSyntheticReading } = require(W + '/packages/palm-reading-engine/e1/src/reading');
  const out = [];
  for (; k < cases.length; k++) {
    try { const r = generateSyntheticReading(cases[k].supplied, { synthetic: true }); out.push({ ids: r.sections.flatMap((x) => x.items).concat(r.moreFromYourReading).map((x) => x.recordId), heart: (r.notAssessed.find((n) => n.feature === 'lines.heart') || {}).detail || null }); }
    catch (e) { out.push({ code: e.code, message: String(e.message).slice(0, 160) }); }
  }
  console.log(JSON.stringify(out));`;
const r5run = (cases: unknown[], mode: string): any[] => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), '-e', R5_SCRIPT, JSON.stringify(cases), mode], { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0) console.log('R5 run failed', r.status, r.stderr.slice(0, 800));
  return JSON.parse((r.stdout || '[]').trim() || '[]');
};
const heartFull: any = heartTo(0.1667);
const onePoint = input({ lines: [{ ...heartFull, points: [heartFull.points[0]] } as any, upwardTo(0.3333)] });
const r5cases = [
  { name: 'false unassessed state (R4 witness: trace-too-few-points for a valid trace)', supplied: inA, builtFrom: onePoint },
  { name: 'mixed facing (palm-facing set for a back-facing input)', supplied: inBack, builtFrom: inA },
  { name: 'swapped landmarks / finger bases', supplied: inA, builtFrom: inB },
  { name: 'substituted trace', supplied: inA, builtFrom: input({ lines: [heartTo(-0.05), upwardTo(0.3333)] }) },
  { name: 'fabricated frame', supplied: inA, builtFrom: input({ landmarks: null, lines: [heartTo(0.1667), upwardTo(0.3333)] }) },
  { name: 'false skip of the heart line', supplied: inA, builtFrom: input({ lines: [skipped('heart'), upwardTo(0.3333)] }) },
  { name: 'false unconfirmed state', supplied: inA, builtFrom: input({ lines: [{ ...heartFull, confirmed: false } as any, upwardTo(0.3333)] }) },
  { name: 'false quality', supplied: inA, builtFrom: input({ qualityIssues: ['blurry'], lines: [heartTo(0.1667), upwardTo(0.3333)] }) },
];
const r5sub = r5run(r5cases, 'substitute');
check('F12. R5 initialization order: a builder substituted BEFORE reading.ts loads cannot change construction -- every substituted state is refused (construction-mismatch)', r5sub.length === r5cases.length && r5sub.every((x) => x.code === 'construction-mismatch'), JSON.stringify(r5sub.map((x, i) => [r5cases[i].name, x.code ?? x.ids])));
check('F12b. ... including the R4 false-unassessed witness, refused on the heart line state itself', /the feature set does not derive from the supplied input: line heart (trace differs|state)/.test(r5sub[0]?.message ?? ''), r5sub[0]);
const r5ctl = r5run(r5cases.slice(0, 2), 'control');
check('F12c. control: the valid confirmed trace keeps its eligibility (heart reading emitted, no trace diagnostic); back-facing stays empty', r5ctl.length === 2 && r5ctl[0].ids?.includes('C1-WE-HEART-BETWEEN') && r5ctl[0].heart === null && r5ctl[1].ids?.length === 0, r5ctl);
check('F12d. the line-state port agrees with I1 for every unassessed reason (too few / too many points, invalid, outside image, outside frame, too short, repeated, doubles back, self-intersecting, tortuous)', (() => {
  const P = (X: number, Y: number) => point([12 * X, 12 * Y]);
  const traces: [string, Array<[number, number]>][] = [
    ['ok', [[0.95, 0.22], [0.5, 0.2], [0.17, 0.15]]], ['one', [[0.5, 0.2]]], ['many', Array.from({ length: 65 }, (_, i) => [0.1 + i * 0.01, 0.2] as [number, number])],
    ['outside-image', [[0.5, 0.2], [3.5, 0.2]]], ['outside-frame', [[0.5, 0.2], [1.6, 0.2]]], ['short', [[0.5, 0.2], [0.505, 0.2]]],
    ['repeated', [[0.5, 0.2], [0.7, 0.2], [0.5, 0.2]]], ['doubles-back', [[0.2, 0.2], [0.7, 0.2], [0.3, 0.21]]],
    ['self-intersecting', [[0.2, 0.2], [0.7, 0.4], [0.7, 0.2], [0.2, 0.4]]], ['tortuous', [[0.2, 0.2], [0.3, 0.6], [0.4, 0.2], [0.5, 0.6], [0.6, 0.2]]],
  ];
  const reasons = new Set<string>();
  for (const [, pts] of traces) {
    const i = input({ lines: [{ line: 'heart', action: 'traced', points: pts.map(([x, y]) => P(x, y)), confirmed: true } as any] });
    const b = buildPalmFeatureSet(i);
    if (!b.ok) return false;
    const l: any = b.featureSet.lines.heart;
    const mine = construction.placeTraceFromInput((i.lines![0] as any).points, construction.frameFromInput(i).frame);
    if (l.provenance === 'user-confirmed' ? !(mine.ok && JSON.stringify(mine.palmPoints) === JSON.stringify(l.palmPoints)) : mine.ok || mine.reason !== l.reason) { console.log('F12d disagreement', JSON.stringify(pts), l.reason, mine); return false; }
    try { verify(i, b.featureSet); } catch (e) { console.log('F12d false refusal', String(e)); return false; }
    reasons.add(l.provenance === 'user-confirmed' ? 'ok' : l.reason);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TRACE_LIMITS } = require('../apps/web/lib/palm-analysis/features');
  return JSON.stringify(TRACE_LIMITS) === JSON.stringify(construction.TRACE_LIMITS) && reasons.size >= 9;
})());
check('F12e. R5 F2 witness, fresh processes: an inherited Object.prototype value for any optional text or metadata field never reaches the reading', (() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require('child_process');
  const script = (field: string) => `
    const field = ${JSON.stringify(field)};
    if (field) Object.defineProperty(Object.prototype, field, { value: field === 'conflicts' ? [{ withId: 'C1-WE-HEAD-STRAIGHT', kind: 'x', handling: 'You have melanoma.' }] : 'You have melanoma.', configurable: true, writable: true });
    const { generateSyntheticReading } = require(${JSON.stringify(ROOT)} + '/packages/palm-reading-engine/e1/src/reading');
    const r = generateSyntheticReading(JSON.parse(process.argv[1]), { synthetic: true });
    if (field) delete Object.prototype[field];
    console.log(JSON.stringify(r));`;
  const run = (field: string) => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), '-e', script(field), JSON.stringify(inA)], { encoding: 'utf8', cwd: ROOT });
  const clean = run('');
  if (clean.status !== 0) { console.log('F12e clean', clean.stderr.slice(0, 500)); return false; }
  return ['applicationNote', 'reflection', 'conflicts', 'thresholdStatus', 'title', 'overallSupport', 'note', 'notes', 'detail', 'adjacentZone', 'descriptor'].every((f) => { const r = run(f); const ok = r.status === 0 && r.stdout === clean.stdout && !r.stdout.includes('melanoma'); if (!ok) console.log('F12e', f, r.status, r.stderr.slice(0, 300)); return ok; });
})());
check('F13. the input is read once, as plain data: accessor and non-plain inputs are refused', [Object.defineProperty({ ...inA }, 'landmarks', { get: () => inA.landmarks, enumerable: true }), Object.assign(Object.create({ extra: 1 }), inA), { ...inA, landmarks: inA.landmarks!.map((p, k) => (k === 0 ? Object.defineProperty({}, 'x', { get: () => p.x, enumerable: true }) : p)) }].every((i) => throwsCode(() => generateSyntheticReading(i as any, { synthetic: true }), 'invalid-input')));

// ============================================================ R6: one authoritative captured snapshot
// Witnesses from the R5 independent verification, generalised. Each runs in a fresh process (pollution and builder
// substitution are installed before reading.ts loads) and compares with a clean process.
const R6_SCRIPT = `
  const W = ${JSON.stringify(ROOT)};
  const [mode, arg, casesJson] = process.argv.slice(1);
  const cases = JSON.parse(casesJson);
  const features = require(W + '/apps/web/lib/palm-analysis/features');
  const real = features.buildPalmFeatureSet;
  if (mode === 'pollute') Object.defineProperty(Object.prototype, arg, { value: JSON.parse(process.argv[4]), configurable: true, writable: true });
  if (mode === 'flip') {
    // the builder returns a proxy whose top-level field arg alternates, per read, between the real value and the
    // same field of the feature set built from the palm-facing twin (the R5 changing-frame witness, generalised)
    let k = 0;
    features.buildPalmFeatureSet = (snap) => {
      const a = real(snap).featureSet, b = real(cases[k].twin).featureSet;
      let reads = 0;
      return { ok: true, featureSet: new Proxy(structuredClone(a), { get(t, key, r0) { if (key !== arg) return Reflect.get(t, key, r0); return (reads++ % 2 ? b : t)[key]; }, getOwnPropertyDescriptor(t, key) { const d = Reflect.getOwnPropertyDescriptor(t, key); if (key !== arg || !d) return d; return { ...d, value: (reads++ % 2 ? b : t)[key] }; } }) };
    };
  }
  if (mode === 'nested-accessor') {
    features.buildPalmFeatureSet = (snap) => { const fs = structuredClone(real(snap).featureSet); let n = 0; Object.defineProperty(fs.lines.heart, 'provenance', { get: () => (n++ ? 'unassessed' : 'user-confirmed'), enumerable: true }); return { ok: true, featureSet: fs }; };
  }
  const { generateSyntheticReading } = require(W + '/packages/palm-reading-engine/e1/src/reading');
  const out = [];
  for (let k = 0; k < cases.length; k++) {
    try { const r = generateSyntheticReading(cases[k].input, { synthetic: true }); out.push({ ids: r.sections.flatMap((x) => x.items).concat(r.moreFromYourReading).map((x) => x.recordId), reading: JSON.stringify(r) }); }
    catch (e) { out.push({ code: e.code }); }
  }
  if (mode === 'pollute') delete Object.prototype[arg];
  console.log(JSON.stringify(out));`;
const r6run = (mode: string, arg: string, cases: unknown[], extra = 'null'): any[] => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'), '-e', R6_SCRIPT, mode, arg, JSON.stringify(cases), extra], { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0) { console.log('R6 run failed', mode, arg, r.status, r.stderr.slice(0, 600)); return []; }
  return JSON.parse(r.stdout.trim());
};
const r6inputs = [{ input: inA }, { input: input({ lines: [skipped('heart'), upwardTo(0.3333)] }) }, { input: inBack }, { input: input({ qualityIssues: null, handednessLabel: undefined, lines: [heartTo(0.1667)] }) }];
const r6clean = r6run('clean', '', r6inputs);
check('F14. R6 F2 witness generalised: an inherited value for any intermediate construction / descriptor / observation / plan field leaves every reading byte-identical (skipped, confirmed, back-facing, unknown-quality inputs)', r6clean.length === 4 && r6clean.every((x) => x.reading) && [
  ['palmPoints', '[{"x":0.2,"y":0.2},{"x":0.3,"y":0.3}]'], ['kind', '"placed"'], ['ok', 'true'], ['reason', '"trace-too-few-points"'], ['frame', 'null'], ['px', '[]'], ['bases', '{}'], ['zone', '"jupiter"'],
  ['nearEdge', 'true'], ['adjacentZone', '"jupiter"'], ['detail', '"You have melanoma."'], ['value', '"present"'], ['status', '"measured"'], ['reasons', '[]'], ['provenance', '"user-confirmed"'],
  ['notAssessed', '"boundary"'], ['lines.heart', '"matched"'], ['personality', '[]'], ['applicationNote', '"You have melanoma."'], ['emptyResult', '"x"'],
].every(([f, v]) => { const got = r6run('pollute', f, r6inputs, v); const ok = got.length === 4 && got.every((x, k) => x.reading === r6clean[k].reading); if (!ok) console.log('F14', f, JSON.stringify(got.map((x) => x.code ?? x.ids))); return ok; }));
const r6flipCases = [{ input: inBack, twin: inA }];
check('F15. R6 F6 witness generalised: a builder whose frame / lines / measurements / marks change between reads never yields content for a back-facing hand (one captured state is validated and composed)', ['frame', 'lines', 'measurements', 'marks', 'hand'].every((f) => { const got = r6run('flip', f, r6flipCases); const ok = got.length === 1 && !(got[0].ids ?? []).length && (got[0].code === 'construction-mismatch' || got[0].ids?.length === 0); if (!ok) console.log('F15', f, JSON.stringify(got)); return ok; }));
check('F15b. ... and a builder exposing a nested accessor is refused at the snapshot boundary (fail closed)', (() => { const got = r6run('nested-accessor', '', [{ input: inA }]); return got.length === 1 && got[0].code === 'invalid-input'; })());
check('F16. R6 F7 witness: a changing options proxy is read once; the declaration validated is the declaration retained (reader and planner); a first read of false is refused before any work', (() => {
  const varying = (first: boolean) => { const reads = { n: 0 }; return { reads, o: new Proxy({ synthetic: false }, { getOwnPropertyDescriptor(t, k) { const d = Reflect.getOwnPropertyDescriptor(t, k); if (k !== 'synthetic' || !d) return d; reads.n++; return { ...d, value: reads.n === 1 ? first : !first }; } }) }; };
  const run = (first: boolean) => {
    const a = varying(first), b = varying(first); // one fresh proxy per entry point
    let reader: string, planner: string;
    try { generateSyntheticReading(inA, a.o as any); reader = 'reading'; } catch (e: any) { reader = e.code; }
    try { e1.planSelection(e1.defaultLibrary(), {}, b.o); planner = 'plan'; } catch (e: any) { planner = e.code; }
    return { reader, planner, readerReads: a.reads.n, plannerReads: b.reads.n };
  };
  const t = run(true), f = run(false);
  return t.reader === 'reading' && t.planner === 'plan' && t.readerReads === 1 && t.plannerReads === 1 && f.reader === 'synthetic-required' && f.planner === 'synthetic-required' && f.readerReads === 1 && f.plannerReads === 1;
})());
check('F17. R6: the caller\'s input is read once per property (a counting proxy over every nested object) and later changes to it cannot affect the reading', (() => {
  let reads = 0;
  const wrap = (v: any): any => (v && typeof v === 'object' ? new Proxy(Array.isArray(v) ? v.map(wrap) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wrap(x)])), { getOwnPropertyDescriptor(t, k) { reads++; return Reflect.getOwnPropertyDescriptor(t, k); } }) : v);
  const live: any = JSON.parse(JSON.stringify(inA));
  const proxied = wrap(live);
  const r1 = JSON.stringify(generateSyntheticReading(proxied, { synthetic: true }));
  const once = reads;
  const keys = (v: any): number => (v && typeof v === 'object' ? (Array.isArray(v) ? v.length + 1 + v.reduce((a: number, x: any) => a + keys(x), 0) : Object.keys(v).length + Object.values(v).reduce((a: number, x: any) => a + keys(x), 0)) : 0);
  return r1 === JSON.stringify(generateSyntheticReading(inA, { synthetic: true })) && once === keys(live);
})());

// ============================================================ G. generated synthetic hands (R2: V-F expanded geometry)
// A hand is defined in palm-frame units (index knuckle (0,0), little knuckle (1,0), y toward the wrist), then placed in
// a 1000 x 1000 image by a similarity transform (rotation, scale, translation, optional mirror). Traces are defined in
// the same palm units and transformed identically, so every pose of one hand must give the same reading. Synthetic
// geometry only: this is not real-hand anatomical validation.
type Hand = { m: number; r: number; finger: number; palm: number; ring?: number };
const BASE = XY.map(([x, y]) => [x / 12, y / 12]);
function handPoints(h: Hand): number[][] {
  return BASE.map(([x, y], k) => {
    if (k === 0) return [x, y * h.palm];
    if (k >= 1 && k <= 4) return [x, y];
    const f = Math.floor((k - 5) / 4), j = (k - 5) % 4; // finger 0..3, joint 0 = knuckle
    const kx = [0, h.m, h.r, 1][f];
    const [bx, by] = BASE[5 + 4 * f];
    return j === 0 ? [kx, 0] : [kx + (x - bx), (y - by) * h.finger * (f === 2 ? h.ring ?? 1 : 1)];
  });
}
type Pose = { rot: number; scale: number; tx: number; ty: number; mirror: boolean };
const place = (p: Pose) => ([X, Y]: number[]) => {
  const x = p.mirror ? -X : X, c = Math.cos(p.rot), sn = Math.sin(p.rot);
  return { x: (p.tx + p.scale * (c * x - sn * Y)) / 1000, y: (p.ty + p.scale * (sn * x + c * Y)) / 1000 };
};
function poseInput(h: Hand, p: Pose, lines: Array<[LineInput['line'], number[][]]>): PalmFeatureSetInput {
  const pl = place(p);
  const landmarks = handPoints(h).map(pl);
  const base = { imageWidth: 1000, imageHeight: 1000, landmarks, hand: (p.mirror ? 'left' : 'right') as 'left' | 'right', dominantHand: 'unknown' as const, qualityIssues: [], rotationDeg: Math.round((p.rot * 180) / Math.PI), lines: lines.map(([line, pts]) => ({ line, action: 'traced' as const, points: pts.map(pl), confirmed: true })), marks: [] };
  for (const label of ['Left', 'Right']) { const i = { ...base, handednessLabel: label } as PalmFeatureSetInput; const r = buildPalmFeatureSet(i); if (r.ok && r.featureSet.frame.palmFacing === true) return i; }
  throw new Error(`no palm-facing label for pose ${JSON.stringify(p)}`);
}
const poseReading = (h: Hand, p: Pose, lines: Array<[LineInput['line'], number[][]]>, mode = 'combined'): any => generateSyntheticReading(poseInput(h, p, lines), { synthetic: true, mode: mode as any });
const POSES: Pose[] = [
  { rot: 0, scale: 300, tx: 450, ty: 500, mirror: false }, { rot: 0.4, scale: 260, tx: 480, ty: 470, mirror: false },
  { rot: -1.1, scale: 280, tx: 520, ty: 520, mirror: false }, { rot: 2.6, scale: 240, tx: 500, ty: 500, mirror: false },
  { rot: 0, scale: 300, tx: 550, ty: 500, mirror: true }, { rot: 0.9, scale: 250, tx: 500, ty: 480, mirror: true },
];
const HANDS: Array<{ name: string; h: Hand }> = [
  { name: 'even spacing, long fingers', h: { m: 0.3333, r: 0.6667, finger: 1, palm: 1 } },
  { name: 'narrow index-middle spacing, short fingers', h: { m: 0.2, r: 0.55, finger: 0.62, palm: 1 } },
  { name: 'wide index-middle spacing, average fingers', h: { m: 0.42, r: 0.74, finger: 0.85, palm: 1 } },
  { name: 'narrow middle-ring spacing', h: { m: 0.36, r: 0.46, finger: 1, palm: 1 } },
];
// centre of the ring-finger zone (between the middle|ring and ring|little edges), on the 0.0001 grid
const ringMid = (h: Hand) => Math.round(((h.m + h.r) / 2 + (h.r + 1) / 2) / 2 * 1e4) / 1e4;
const keyOf = (r: any) => JSON.stringify({ items: r.sections.map((s: any) => [s.category, s.items.map((i: any) => i.recordId)]), na: r.notAssessed.filter((n: any) => !n.feature.startsWith('marks.')).map((n: any) => [n.feature, n.code]) });
for (const { name, h } of HANDS) {
  // heart radial end in the middle of the between-zone; upward end at the centre of the ring zone; sloping head; life
  const lines: Array<[LineInput['line'], number[][]]> = [
    ['heart', [[0.95, 0.22], [0.55, 0.2], [h.m / 2, 0.15]]],
    ['upward', [[ringMid(h) + 0.02, 0.95], [ringMid(h) + 0.01, 0.55], [ringMid(h), 0.12]]],
    ['head', [[0.05, 0.35], [0.5, 0.45], [0.92, 0.55]]],
    ['life', [[0.1, 0.3], [0.05, 0.7], [0.12, 1.1]]],
  ];
  const readings = POSES.map((p) => poseReading(h, p, lines));
  const keys = readings.map(keyOf);
  check(`G1. ${name}: identical reading under translation, scale, rotation and mirroring (${POSES.length} poses)`, keys.every((k) => k === keys[0]), keys);
  check(`G2. ${name}: heart between-zone, ring-finger upward ending and sloping head line are read`, ['C1-WE-HEART-BETWEEN', 'C1-IN-URDHVA-RING', 'C1-WE-HEAD-SLOPING', 'C1-IN-PITR-KNOWLEDGE'].every((id) => items(readings[0]).includes(id)), items(readings[0]));
}
const shortHand = poseReading(HANDS[1].h, POSES[2], []);
const longHand = poseReading(HANDS[0].h, POSES[3], []);
check('G3. proportions drive the finger records: short fingers -> FINGER-SHORT, long -> FINGER-LONG', items(shortHand).includes('C1-WE-FINGER-SHORT') && items(longHand).includes('C1-WE-FINGER-LONG'), [items(shortHand), items(longHand)]);
const midHand = poseReading(HANDS[2].h, POSES[1], []);
check('G4. an in-between finger proportion reads neither finger record (boundary or no supported content)', !items(midHand).some((x) => /FINGER-(LONG|SHORT)/.test(x)) && ['boundary', 'no-supported-content'].includes(na(midHand, 'measurements.middleToPalmRatio').code), [items(midHand), na(midHand, 'measurements.middleToPalmRatio')]);
const narrow = HANDS[3].h; // middle-ring gap 0.10: upward middle|ring edge at 0.41
const nearMR = poseReading(narrow, POSES[0], [['upward', [[0.43, 0.95], [0.42, 0.55], [0.41, 0.12]]]]);
check('G5. narrow zones: an upward ending on the middle|ring edge is a boundary, never one side', na(nearMR, 'lines.upward').code === 'boundary' && !items(nearMR).some((x) => x.includes('URDHVA')));
const tall = poseReading({ m: 0.3333, r: 0.6667, finger: 1, palm: 2.1 }, { rot: 0, scale: 200, tx: 450, ty: 400, mirror: false }, [['life', [[0.1, 0.3], [0.05, 0.7], [0.12, 1.1]]]]);
check('G6. uncertain measurements (implausible palm proportions) are withheld with their I1 detail; traces still read', na(tall, 'measurements.middleToPalmRatio').code === 'measurement-unavailable' && /^uncertain:.*implausible-proportions/.test(na(tall, 'measurements.middleToPalmRatio').detail) && items(tall).includes('C1-IN-PITR-KNOWLEDGE') && !items(tall).some((x) => x.includes('FINGER')), tall.notAssessed);

// ============================================================ H. R3 numerical compatibility, port fidelity, A4, coverage
// F5 witness: a valid synthetic hand whose I1 index/ring ratio is astronomically large (the ring chain is a few subnormal
// steps long). R2 rejected the whole reading; R3 withholds only that interpretation and keeps everything else.
const hugeHand = (() => {
  const s2 = Math.SQRT1_2, w = 0.25, C = [0.3, 0.3], u = [s2, -s2], f = [s2, s2];
  const at = (t: number, len: number) => ({ x: C[0] + (t - 0.5) * w * u[0] + len * f[0], y: C[1] + (t - 0.5) * w * u[1] + len * f[1] });
  const lm: any[] = []; lm[0] = { x: 0, y: 0 };
  lm[1] = at(-0.2, -0.15); lm[2] = at(-0.35, -0.08); lm[3] = at(-0.45, -0.02); lm[4] = at(-0.5, 0.03);
  for (const [k, t] of [[5, 0], [9, 1 / 3], [17, 1]] as [number, number][]) for (let j = 0; j < 4; j++) lm[k + j] = at(t, j * 0.09);
  lm[13] = { x: 0, y: 0 }; lm[14] = { x: 1e-306, y: 0 }; lm[15] = { x: 2e-306, y: 0 }; lm[16] = { x: 3e-306, y: 0 };
  return { imageWidth: 1000, imageHeight: 1000, landmarks: lm, hand: 'right', dominantHand: 'unknown', handednessLabel: 'Right', qualityIssues: [], rotationDeg: 0, lines: [], marks: [] } as PalmFeatureSetInput;
})();
const hugeFs: any = built(hugeHand);
const hugeR: any = generateSyntheticReading(hugeHand, { synthetic: true });
check('H1. F5 witness: the I1 builder measures an index/ring ratio far beyond the interpretable range', hugeFs.measurements.measurements.indexToRingRatio.status === 'measured' && hugeFs.measurements.measurements.indexToRingRatio.value > 1e300, hugeFs.measurements.measurements.indexToRingRatio);
check('H2. ...the reading is produced; only the dependent interpretation is withheld, with a diagnostic; other observations are kept', na(hugeR, 'measurements.indexToRingRatio').code === 'measurement-unavailable' && na(hugeR, 'measurements.indexToRingRatio').detail === 'value-outside-interpretable-range' && hugeR.observed.some((o: any) => o.feature === 'measurements.middleToPalmRatio'), hugeR.notAssessed);
check('H3. the exact reviewer value 2.1657716808922185e+304 is classified out of range (withheld), never rounded or overflowed', e1.gridStatus(2.1657716808922185e+304) === 'out-of-range' && e1.gridStatus(9e+304) === 'out-of-range');

// port fidelity: E1 derives finger bases from the input; they must equal the I1 helper on every hand and pose
let portChecks = 0, portOk = true;
for (const { h } of HANDS) for (const p of POSES) {
  const i = poseInput(h, p, []);
  const mine = construction.fingerBasesFromInput(i), ref = palmFingerBases(i.landmarks, i.imageWidth, i.imageHeight);
  portChecks++;
  if (!ref.ok || JSON.stringify(mine) !== JSON.stringify(ref.bases)) portOk = false;
}
check(`H4. the construction port equals the I1 finger-base helper exactly (${portChecks} hand x pose cases)`, portOk && portChecks === HANDS.length * POSES.length);

// plan == render, A4, coverage and text safety over a generated set of hands, poses, traces and modes
const BANNED = /\b(die|dies|death|lifespan|life span|live long|long life|longevity|rich|wealth|money|marri|husband|wife|children|sons|daughter|fertil|caste|varṇa|varna|health|illness|disease|accident|misfortune|guarantee|will become|you will|destined|fate)\w*/i;
const seen = new Set<string>();
let renders = 0, consistent = true, a4 = true, safe = true;
const handsH: Hand[] = [...HANDS.map((x) => x.h), { m: 0.3333, r: 0.6667, finger: 0.65, palm: 1 }, { m: 0.3333, r: 0.6667, finger: 1.15, palm: 1 }];
for (const h of handsH) for (const pose of [POSES[0], POSES[2], POSES[4]]) for (const hx of [-0.05, h.m / 2, h.m]) for (const ux of [0, h.m, ringMid(h), 0.98]) for (const hd of [0, 0.2]) {
  const lines: Array<[LineInput['line'], number[][]]> = [['heart', [[0.95, 0.22], [0.55, 0.2], [Math.round(hx * 1e4) / 1e4, 0.15]]], ['upward', [[ux + 0.02, 0.95], [ux + 0.01, 0.55], [ux, 0.12]]], ['head', [[0.05, 0.35], [0.5, 0.35 + hd / 2], [0.92, 0.35 + hd]]], ['life', [[0.1, 0.3], [0.05, 0.7], [0.12, 1.1]]]];
  for (const mode of ['combined', 'indian-only', 'western-only']) {
    const r = poseReading(h, pose, lines, mode);
    renders++;
    const obs = Object.fromEntries([...r.observed.map((o: any) => [o.feature, { provenance: o.provenance, value: o.value, ...(o.nearEdge !== undefined ? { nearEdge: o.nearEdge } : {}), ...(o.adjacentZone ? { adjacentZone: o.adjacentZone } : {}) }]), ...r.notAssessed.filter((n: any) => !r.observed.some((o: any) => o.feature === n.feature)).map((n: any) => [n.feature, { notAssessed: n.code, ...(n.detail !== undefined ? { detail: n.detail } : {}) }])]);
    const pl = plan(obs, { mode, qualityAccepted: r.quality.accepted, ...(r.quality.detail ? { qualityDetail: r.quality.detail } : {}) });
    const ids = (x: any) => JSON.stringify([x.sections.map((sx: any) => [sx.category, sx.items.map((i: any) => i.recordId)]), x.moreFromYourReading.map((i: any) => i.recordId), x.notAssessed.map((n: any) => [n.feature, n.code]), x.emptyResult]);
    if (ids(pl) !== ids(r)) { if (consistent) console.log('H5 first mismatch\n plan  ', ids(pl), '\n render', ids(r), '\n obs', JSON.stringify(obs)); consistent = false; }
    const allItems = [...r.sections.flatMap((sx: any) => sx.items), ...r.moreFromYourReading];
    for (const it of allItems) { seen.add(it.recordId); if (Object.values(it.text).some((t: any) => BANNED.test(t))) safe = false; }
    const featuresRead = allItems.flatMap((it: any) => it.supportingFeatures.map((x: any) => x.feature));
    if (new Set(featuresRead).size !== featuresRead.length) a4 = false;
    for (const o of r.observed) if (featuresRead.filter((f: string) => f === o.feature).length + r.notAssessed.filter((n: any) => n.feature === o.feature).length !== 1 && !r.historicalContextMatched.length) a4 = false;
  }
}
check(`H5. plan == rendered reading on every generated case (${renders} readings)`, consistent && renders >= 1000, renders);
check('H6. A4 (independent of oracle parity): no feature is read by two items; every observed feature is read once or listed once', a4);
check('H7. rendered text passes the prohibited-wording check everywhere (also enforced in-engine by validateReadingOutput)', safe);
const ringLongR = poseReading({ m: 0.3333, r: 0.6667, finger: 1, palm: 1, ring: 1.3 }, POSES[0], []);
check('H8. coverage: all 12 eligible-initial records are emitted with real text through the reading interface', (() => { const all = new Set([...seen, ...items(ringLongR)]); return e1.defaultLibrary().initialIds.every((id: string) => all.has(id)); })(), [...seen].sort());

console.log(`\nPALM-03-E1 end-to-end: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  FAIL ${f}`); process.exit(1); }
