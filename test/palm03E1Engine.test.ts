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
const core = require('../packages/palm-reading-engine/e1/src/engine-core.mjs');
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
check('A5-2. synthetic-only: every function able to emit a reading refuses without an explicit synthetic declaration (R3 F7)', [undefined, null, {}, { synthetic: 'yes' }, { synthetic: 1 }].every((o) => throwsCode(() => generateSyntheticReading(input(), o as any), 'synthetic-required') && throwsCode(() => core.readingFromConstruction(input(), built(input()), o), 'synthetic-required') && throwsCode(() => e1.planSelection(e1.defaultLibrary(), {}, o), 'synthetic-required')) && !('composeReading' in e1) && !('deriveObservations' in e1) && !('composeFromObservations' in e1));
check('A5-3. separate identity from the frozen G6 engine, which E1 never imports', e1.E1_ENGINE.id === 'aura.palm.e1-reading' && fs.readdirSync(path.join(ROOT, 'packages/palm-reading-engine/e1/src')).every((f) => !/from '[^']*prototype\//.test(fs.readFileSync(path.join(ROOT, 'packages/palm-reading-engine/e1/src', f), 'utf8'))));
check('A5-4. the 23 Western G6 rule texts are excluded: none appears in the E1 catalogue or any reading', (() => {
  const rules = fs.readFileSync(path.join(ROOT, 'packages/palm-reading-engine/prototype/src/rules.mjs'), 'utf8');
  const texts = [...rules.matchAll(/\btext: '([^']{12,})'/g)].map((m) => m[1]);
  const cat = JSON.stringify(e1.PACKAGED_CATALOGUE) + JSON.stringify(rFull);
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

// ============================================================ F. coherent construction from one input (R3 finding F6)
// The R2 witnesses (swapped finger bases, substituted trace, fabricated frame) were externally assembled, resealed
// bundles. The reading interface no longer accepts any such bundle; the internal pipeline re-derives everything it
// reads from the ONE input and refuses a feature set that does not derive from it.
const XY_B = XY.map(([x, y], k) => (k === 9 ? [3, 0] : k === 13 ? [6, 0] : [x, y]));
const inA = input({ lines: [heartTo(0.1667), upwardTo(0.3333)] });
const inB = input({ landmarks: XY_B.map(point), lines: [heartTo(0.1667), upwardTo(0.3333)] });
const fsA = built(inA), fsB = built(inB);
check('F1. the reading interface has no geometry parameter: generateSyntheticReading(input, { synthetic, mode })', generateSyntheticReading.length === 2 && throwsCode(() => generateSyntheticReading(inA, { synthetic: true, fingerBases: {} } as any), 'invalid-option'));
check('F2. swapped finger bases (witness): hand B geometry with hand A traces -> construction-mismatch', throwsCode(() => core.readingFromConstruction(inA, fsB, { synthetic: true }), 'construction-mismatch'));
check('F3. substituted trace (witness): a feature set whose heart trace differs from the supplied trace -> construction-mismatch', throwsCode(() => core.readingFromConstruction(inA, built(input({ lines: [heartTo(-0.05), upwardTo(0.3333)] })), { synthetic: true }), 'construction-mismatch'));
check('F4. fabricated frame (witness): a feature set claiming no frame, or another frame, for this input -> construction-mismatch', throwsCode(() => core.readingFromConstruction(inA, built(input({ landmarks: null, lines: [heartTo(0.1667), upwardTo(0.3333)] })), { synthetic: true }), 'construction-mismatch') && throwsCode(() => core.readingFromConstruction(input({ landmarks: XY_B.map(point) }), built(input()), { synthetic: true }), 'construction-mismatch'));
check('F5. substituted measurements: a feature set from a hand with different finger lengths (same frame and traces) -> construction-mismatch', (() => {
  const XY_C = XY.map(([x, y], k) => (k >= 10 && k <= 12 ? [x, y - 2] : [x, y]));
  return throwsCode(() => core.readingFromConstruction(input(), built(input({ landmarks: XY_C.map(point) })), { synthetic: true }), 'construction-mismatch');
})());
check('F6. skip reasons, confirmation, quality and hand must also match the input', [
  [input({ lines: [skipped('head')] }), built(input({ lines: [skipped('head', 'user-cannot-see')] }))],
  [input({ lines: [heartTo(-0.05)] }), built(input({ lines: [traced('heart', [[0.95, 0.22], [0.5, 0.2], [-0.05, 0.15]], false)] }))],
  [input({ qualityIssues: [] }), built(input({ qualityIssues: null }))],
  [input({ hand: 'left' }), built(input({ hand: 'right' }))],
].every(([i, f]) => throwsCode(() => core.readingFromConstruction(i, f, { synthetic: true }), 'construction-mismatch')));
check('F7. a feature set that does derive from the input is accepted, and gives the same reading as the interface', JSON.stringify(core.readingFromConstruction(inA, fsA, { synthetic: true })) === JSON.stringify(generateSyntheticReading(inA, { synthetic: true })));
check('F8. a correctly constructed hand reads both zones', ['C1-WE-HEART-BETWEEN', 'C1-IN-URDHVA-MIDDLE'].every((id) => items(generateSyntheticReading(inA, { synthetic: true })).includes(id)));

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
