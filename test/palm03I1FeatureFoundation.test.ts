/**
 * AURA-PALM-03-I1 -- hand measurements, user-assisted feature representation
 * and synthetic engine compatibility. SYNTHETIC FIXTURES ONLY: hand-built
 * landmark sets and traces; no images, no camera, no MediaPipe runtime.
 *
 *   npx ts-node test/palm03I1FeatureFoundation.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { measureHand, MEASUREMENT_IDS, HAND_MEASUREMENT_VERSION, type HandMeasurementSet } from '../apps/web/lib/palm-analysis/measurements';
import { buildPalmFeatureSet, palmFrameFromLandmarks, imageToPalm, traceGeometryProblem, ALL_LINES, ALL_MARKS, PALM_LINE_IDENTITY, type LineInput, type MarkInput, type PalmFeatureSet, type PalmFeatureSetInput } from '../apps/web/lib/palm-analysis/features';
import type { PalmFeedbackCode } from '../apps/web/lib/palm-analysis/types';

// The engine package is ESM (.mjs); Node >= 22.12 loads it through require().
// eslint-disable-next-line @typescript-eslint/no-var-requires
const featureSetAdapter = require('../packages/palm-reading-engine/adapter/feature-set-adapter.mjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const g6Adapter = require('../packages/palm-reading-engine/adapter/feature-adapter.mjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const engine = require('../packages/palm-reading-engine/prototype/src/index.mjs');

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`OK   ${label}`); } else { failed++; console.log(`FAIL ${label}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
}
const near = (a: number | null, b: number | null, eps = 1e-3) => a !== null && b !== null && Math.abs(a - b) <= eps;
const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============================================================ synthetic hand
// Canonical open hand, palm towards the camera, in "hand units" (palm width ~1), image y down.
type P = { x: number; y: number };
const CANON: P[] = [
  { x: 0.45, y: 1.0 },                                                                   // 0 wrist
  { x: -0.05, y: 0.75 }, { x: -0.25, y: 0.5 }, { x: -0.4, y: 0.3 }, { x: -0.5, y: 0.12 }, // 1-4 thumb
  { x: 0, y: 0 }, { x: -0.03, y: -0.4 }, { x: -0.05, y: -0.65 }, { x: -0.06, y: -0.85 },  // 5-8 index
  { x: 0.33, y: -0.03 }, { x: 0.33, y: -0.47 }, { x: 0.33, y: -0.75 }, { x: 0.33, y: -0.97 }, // 9-12 middle
  { x: 0.66, y: 0 }, { x: 0.68, y: -0.42 }, { x: 0.7, y: -0.68 }, { x: 0.71, y: -0.88 },  // 13-16 ring
  { x: 1, y: 0.05 }, { x: 1.05, y: -0.28 }, { x: 1.08, y: -0.48 }, { x: 1.1, y: -0.64 },  // 17-20 little
];
// Traces in the same canonical hand units (palm-frame-like positions of the three major lines + upward line).
const CANON_TRACES: Record<string, P[]> = {
  heart: [{ x: 0.95, y: 0.22 }, { x: 0.8, y: 0.21 }, { x: 0.65, y: 0.19 }, { x: 0.5, y: 0.16 }, { x: 0.38, y: 0.12 }, { x: 0.3, y: 0.08 }],
  head: [{ x: 0.05, y: 0.3 }, { x: 0.25, y: 0.34 }, { x: 0.45, y: 0.38 }, { x: 0.65, y: 0.43 }, { x: 0.8, y: 0.47 }],
  life: [{ x: 0.05, y: 0.27 }, { x: 0.12, y: 0.42 }, { x: 0.18, y: 0.58 }, { x: 0.24, y: 0.74 }, { x: 0.3, y: 0.9 }],
  upward: [{ x: 0.5, y: 0.95 }, { x: 0.49, y: 0.75 }, { x: 0.48, y: 0.55 }, { x: 0.47, y: 0.35 }],
};

interface Pose { scale: number; rotDeg: number; cx: number; cy: number; mirror: boolean; W: number; H: number }
const POSE: Pose = { scale: 300, rotDeg: 0, cx: 500, cy: 700, mirror: false, W: 1000, H: 1400 };
const toPx = (p: P, o: Pose): P => {
  const x = (o.mirror ? -p.x : p.x) * o.scale, y = p.y * o.scale, t = (o.rotDeg * Math.PI) / 180;
  return { x: o.cx + x * Math.cos(t) - y * Math.sin(t), y: o.cy + x * Math.sin(t) + y * Math.cos(t) };
};
const toNorm = (p: P, o: Pose): P => { const q = toPx(p, o); return { x: q.x / o.W, y: q.y / o.H }; };
const landmarksFor = (o: Pose, canon: P[] = CANON) => canon.map((p) => ({ ...toNorm(p, o), z: 0 }));
// The handedness label that makes the existing G5 palm-facing test pass for this pose (it flips under mirroring).
const LABEL_UNMIRRORED = (() => { const { orientation } = require('../apps/web/lib/palm-analysis/quality'); return orientation(CANON, 'Right').palmFacing ? 'Right' : 'Left'; })();
const labelFor = (o: Pose) => (o.mirror ? (LABEL_UNMIRRORED === 'Right' ? 'Left' : 'Right') : LABEL_UNMIRRORED);
const measureAt = (o: Pose, issues: PalmFeedbackCode[] = [], canon: P[] = CANON): HandMeasurementSet =>
  measureHand({ landmarks: landmarksFor(o, canon), imageWidth: o.W, imageHeight: o.H, qualityIssues: issues, handednessLabel: labelFor(o) });
const values = (s: HandMeasurementSet) => MEASUREMENT_IDS.map((id) => s.measurements[id].value);
const sameValues = (a: HandMeasurementSet, b: HandMeasurementSet, eps = 2e-3) => MEASUREMENT_IDS.every((id) => near(a.measurements[id].value, b.measurements[id].value, eps));

function tracedLines(o: Pose, which = ['heart', 'head', 'life'], confirmed = true): LineInput[] {
  return which.map((line) => ({ line: line as LineInput['line'], action: 'traced' as const, points: CANON_TRACES[line].map((p) => toNorm(p, o)), confirmed }));
}
function featureInput(o: Pose, over: Partial<PalmFeatureSetInput> = {}): PalmFeatureSetInput {
  return { hand: o.mirror ? 'left' : 'right', dominantHand: 'right', landmarks: landmarksFor(o), imageWidth: o.W, imageHeight: o.H, qualityIssues: [], rotationDeg: o.rotDeg, handednessLabel: labelFor(o), lines: tracedLines(o), marks: [], ...over };
}
function build(input: PalmFeatureSetInput): PalmFeatureSet {
  const r = buildPalmFeatureSet(input);
  if (!r.ok) throw new Error(`build failed: ${r.errors.join('; ')}`);
  return r.featureSet;
}
const SYN = { synthetic: true, scanConfidence: 0.9 };
// L1: the full adapter result ({ features, declined, notMapped }) is the integration contract; tests read .features from it.
const adaptF = (f: unknown, syn: unknown) => featureSetAdapter.adaptFeatureSet(f, syn).features;

// ============================================================ A. measurements: basic + coordinate normalisation
const base = measureAt(POSE);
check('A1. a clean synthetic open palm is fully measured', base.status === 'measured' && MEASUREMENT_IDS.every((id) => base.measurements[id].status === 'measured'), base);
check('A2. provenance is automatic-measured and the version is pinned', base.provenance === 'automatic-measured' && base.version === HAND_MEASUREMENT_VERSION);
check('A3. palm length is ~1.02 palm widths (wrist to middle knuckle / index-to-little knuckle)', near(base.measurements.palmLength.value, Math.hypot(0.45 - 0.33, 1.03) / 1.0012, 2e-3), base.measurements.palmLength);
check('A4. finger lengths are summed joint segments in palm widths (middle ~0.94)', near(base.measurements.middleLength.value, 0.94 / 1.0012, 2e-3), base.measurements.middleLength);
check('A5. derived values: handLength = palm + middle; ratios from the same inputs', near(base.measurements.handLength.value, (base.measurements.palmLength.value ?? 0) + (base.measurements.middleLength.value ?? 0), 2e-3) && near(base.measurements.middleToPalmRatio.value, (base.measurements.middleLength.value ?? 0) / (base.measurements.palmLength.value ?? 1), 3e-3));
check('A6. values are rounded to 3 decimals', values(base).every((v) => v !== null && Math.round(v * 1000) / 1000 === v));
check('A7. non-square image: normalised coordinates are converted with the image size (same values as square)', sameValues(base, measureAt({ ...POSE, W: 1400, H: 1400, cx: 700 })) && sameValues(base, measureAt({ ...POSE, W: 1000, H: 2000, cy: 1000 })));
check('A8. the result is frozen plain data (no landmarks, no pixels)', Object.isFrozen(base) && Object.isFrozen(base.measurements) && !/landmark|pixel|"x"|"y"/i.test(JSON.stringify(base)));

// ============================================================ B. scale invariance + orientation + left/right
check('B1. scale: hand at half and double size gives the same values', sameValues(base, measureAt({ ...POSE, scale: 150 })) && sameValues(base, measureAt({ ...POSE, scale: 600, W: 2000, H: 2800, cx: 1000, cy: 1400 })));
check('B2. translation: hand elsewhere in the image gives the same values', sameValues(base, measureAt({ ...POSE, cx: 420, cy: 760 })));
check('B3. in-plane rotation: +25 and -25 degrees give the same values', sameValues(base, measureAt({ ...POSE, rotDeg: 25 })) && sameValues(base, measureAt({ ...POSE, rotDeg: -25 })));
const mirrored = measureAt({ ...POSE, mirror: true });
check('B4. left/right: the mirrored hand (with its own handedness label) gives identical values', mirrored.status === 'measured' && sameValues(base, mirrored, 1e-9), values(mirrored));
const backOfHand = measureHand({ landmarks: landmarksFor({ ...POSE, mirror: true }), imageWidth: 1000, imageHeight: 1400, qualityIssues: [], handednessLabel: LABEL_UNMIRRORED });
check('B5. a mirrored winding with the unmirrored label (back of hand) -> all unavailable, palm-not-facing', backOfHand.status === 'unavailable' && backOfHand.reasons.includes('palm-not-facing') && values(backOfHand).every((v) => v === null));
const noLabel = measureHand({ landmarks: landmarksFor(POSE), imageWidth: 1000, imageHeight: 1400, qualityIssues: [] });
check('B6. no handedness label -> palm-facing undecidable -> values kept but uncertain', noLabel.status === 'uncertain' && noLabel.reasons.includes('palm-facing-unknown') && sameValues(base, noLabel));
const rotatedIssue = measureAt({ ...POSE, rotDeg: 60 }, ['hand-rotated']);
check('B7. a rotated hand flagged hand-rotated by G5 keeps its values but is uncertain', rotatedIssue.status === 'uncertain' && rotatedIssue.reasons.includes('hand-rotated') && sameValues(base, rotatedIssue));

// ============================================================ C. image-quality prerequisites + explicit unavailability
for (const code of ['palm-not-visible', 'hand-cut-off'] as PalmFeedbackCode[]) {
  const s = measureAt(POSE, [code]);
  check(`C1. G5 issue ${code} -> every measurement unavailable (null), reason recorded`, s.status === 'unavailable' && s.reasons.includes(code as never) && values(s).every((v) => v === null));
}
for (const code of ['hand-too-small', 'too-dark', 'too-bright', 'low-contrast', 'blurry'] as PalmFeedbackCode[]) {
  const s = measureAt(POSE, [code]);
  check(`C2. G5 issue ${code} -> values kept, every available measurement uncertain`, s.status === 'uncertain' && MEASUREMENT_IDS.every((id) => s.measurements[id].status === 'uncertain'));
}
const folded = CANON.map((p, i) => (i === 16 ? { x: 0.66, y: -0.2 } : p));
const foldedSet = measureAt(POSE, [], folded);
check('C3. a folded ring finger: ring length unavailable (finger-not-extended); other fingers measured', foldedSet.measurements.ringLength.status === 'unavailable' && foldedSet.measurements.ringLength.reasons.includes('finger-not-extended') && foldedSet.measurements.indexLength.status === 'measured');
check('C4. dependent ratio (index:ring) is unavailable, never estimated', foldedSet.measurements.indexToRingRatio.status === 'unavailable' && foldedSet.measurements.indexToRingRatio.value === null && foldedSet.measurements.indexToRingRatio.reasons.includes('depends-on-unavailable'));
const squashed = CANON.map((p) => ({ x: p.x, y: p.y * 0.55 }));
const squashedSet = measureAt(POSE, [], squashed);
check('C5. a foreshortened (tilted) palm with implausible proportions is uncertain, not rejected', squashedSet.status === 'uncertain' && squashedSet.reasons.includes('implausible-proportions'));

// ============================================================ D. invalid or incomplete landmarks
const lm = landmarksFor(POSE);
const badCases: Array<[string, unknown, number, number]> = [
  ['null landmarks', null, 1000, 1400],
  ['20 landmarks', lm.slice(0, 20), 1000, 1400],
  ['22 landmarks', [...lm, lm[0]], 1000, 1400],
  ['a NaN coordinate', lm.map((p, i) => (i === 9 ? { ...p, x: NaN } : p)), 1000, 1400],
  ['an Infinity coordinate', lm.map((p, i) => (i === 4 ? { ...p, y: Infinity } : p)), 1000, 1400],
  ['a missing point', lm.map((p, i) => (i === 12 ? null : p)), 1000, 1400],
  ['a string coordinate', lm.map((p, i) => (i === 3 ? { x: '0.5', y: 0.5 } : p)), 1000, 1400],
];
for (const [label, l, W, H] of badCases) {
  const s = measureHand({ landmarks: l as never, imageWidth: W, imageHeight: H, qualityIssues: [], handednessLabel: 'Right' });
  check(`D1. ${label} -> all unavailable (landmarks-invalid), no throw`, s.status === 'unavailable' && s.reasons.includes('landmarks-invalid') && values(s).every((v) => v === null));
}
for (const [W, H] of [[0, 1400], [1000, -1], [NaN, 1400], [1000, Infinity]]) {
  const s = measureHand({ landmarks: lm, imageWidth: W, imageHeight: H, qualityIssues: [], handednessLabel: 'Right' });
  check(`D2. image size ${W}x${H} -> unavailable (image-size-invalid)`, s.status === 'unavailable' && s.reasons.includes('image-size-invalid'));
}
const collapsed = lm.map((p, i) => (i === 17 ? { ...lm[5] } : p));
check('D3. index and little knuckles at the same point -> frame-degenerate', measureHand({ landmarks: collapsed, imageWidth: 1000, imageHeight: 1400, qualityIssues: [], handednessLabel: 'Right' }).reasons.includes('frame-degenerate'));
const wristOnLine = lm.map((p, i) => (i === 0 ? { x: (lm[5].x + lm[17].x) / 2, y: (lm[5].y + lm[17].y) / 2, z: 0 } : p));
check('D4. wrist on the knuckle line -> frame-degenerate', measureHand({ landmarks: wristOnLine, imageWidth: 1000, imageHeight: 1400, qualityIssues: [], handednessLabel: 'Right' }).reasons.includes('frame-degenerate'));

// ============================================================ E. palm frame + trace coordinates
{
  const { frame } = palmFrameFromLandmarks(lm, 1000, 1400);
  const pxLm = lm.map((p) => ({ x: p.x * 1000, y: p.y * 1400 }));
  const g6 = g6Adapter.palmFrame({ wrist: pxLm[0], indexMcp: pxLm[5], pinkyMcp: pxLm[17] });
  const probe = [{ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.6 }, { x: 0.52, y: 0.51 }];
  check('E1. the palm frame equals the engine adapter frame (G6-I1 palmFrame/toPalm) to 1e-9', frame !== null && probe.every((p) => { const a = imageToPalm(frame, p); const b = g6Adapter.toPalm(g6, { x: p.x * 1000, y: p.y * 1400 }); return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9; }));
  check('E2. index knuckle -> (0,0), little knuckle -> (1,0), wrist at y > 0', frame !== null && (() => { const a = imageToPalm(frame, lm[5]), b = imageToPalm(frame, lm[17]), w = imageToPalm(frame, lm[0]); return Math.abs(a.x) < 1e-9 && Math.abs(a.y) < 1e-9 && Math.abs(b.x - 1) < 1e-9 && Math.abs(b.y) < 1e-9 && w.y > 0; })());
}
const fsBase = build(featureInput(POSE));
const heartPts = (f: PalmFeatureSet) => { const l = f.lines.heart; return l.provenance === 'user-confirmed' ? l.palmPoints : []; };
const samePts = (a: readonly P[], b: readonly P[], eps = 2e-4) => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) <= eps && Math.abs(p.y - b[i].y) <= eps);
check('E3. confirmed traces are placed in the palm frame, in traced order, 4-decimal rounding', heartPts(fsBase).length === 6 && heartPts(fsBase)[0].x > heartPts(fsBase)[5].x && heartPts(fsBase).every((p) => Math.round(p.x * 1e4) / 1e4 === p.x));
for (const [label, pose] of [['scaled x0.5', { ...POSE, scale: 150 }], ['rotated 30 deg', { ...POSE, rotDeg: 30 }], ['non-square image', { ...POSE, W: 1500, cx: 750 }], ['translated', { ...POSE, cx: 450, cy: 650 }]] as Array<[string, Pose]>) {
  check(`E4. trace palm coordinates are invariant: ${label}`, samePts(heartPts(fsBase), heartPts(build(featureInput(pose)))));
}
const fsLeft = build(featureInput({ ...POSE, mirror: true }));
check('E5. left/right: the mirrored hand with mirrored traces gives identical palm-frame traces', ALL_LINES.slice(0, 3).every((l) => { const a = fsBase.lines[l], b = fsLeft.lines[l]; return a.provenance === 'user-confirmed' && b.provenance === 'user-confirmed' && samePts(a.palmPoints, b.palmPoints); }));
check('E6. left/right: hand is recorded as user-declared and never overridden', fsLeft.hand.value === 'left' && fsLeft.hand.source === 'user-declared' && fsBase.hand.value === 'right');

// ============================================================ F. invalid / incomplete traces + skipped features
const traceCase = (points: unknown, confirmed = true) => build(featureInput(POSE, { lines: [{ line: 'heart', action: 'traced', points: points as P[], confirmed }] })).lines.heart;
const reasonOf = (l: PalmFeatureSet['lines']['heart']) => (l.provenance === 'unassessed' ? l.reason : 'assessed');
check('F1. one-point trace -> unassessed (trace-too-few-points)', reasonOf(traceCase([{ x: 0.5, y: 0.5 }])) === 'trace-too-few-points');
check('F2. 65-point trace -> unassessed (trace-too-many-points)', reasonOf(traceCase(Array.from({ length: 65 }, (_, i) => ({ x: 0.4 + i * 0.001, y: 0.6 })))) === 'trace-too-many-points');
check('F3. NaN point -> unassessed (trace-point-invalid)', reasonOf(traceCase([{ x: 0.5, y: 0.5 }, { x: NaN, y: 0.5 }])) === 'trace-point-invalid');
check('F4. point outside the image -> unassessed (trace-outside-image)', reasonOf(traceCase([{ x: 0.5, y: 0.5 }, { x: 1.2, y: 0.5 }])) === 'trace-outside-image');
check('F5. trace far outside the palm (top of the image) -> unassessed (trace-outside-palm-frame)', reasonOf(traceCase([{ x: 0.1, y: 0.02 }, { x: 0.2, y: 0.03 }])) === 'trace-outside-palm-frame');
check('F6. tiny trace -> unassessed (trace-too-short)', reasonOf(traceCase([{ x: 0.5, y: 0.55 }, { x: 0.501, y: 0.55 }])) === 'trace-too-short');
check('F7. not-an-array trace -> unassessed, no throw', reasonOf(traceCase('heart')) === 'trace-too-few-points');
const pending = traceCase(CANON_TRACES.heart.map((p) => toNorm(p, POSE)), false);
check('F8. traced but not confirmed -> unassessed with confirmation "pending"', pending.provenance === 'unassessed' && pending.reason === 'not-confirmed' && pending.confirmation === 'pending');
const skipped = build(featureInput(POSE, { lines: [{ line: 'heart', action: 'skipped', reason: 'user-cannot-see' }, { line: 'head', action: 'skipped', reason: 'user-skipped' }] }));
check('F9. skipped lines keep the user reason; lines never offered are "not-requested"', reasonOf(skipped.lines.heart) === 'user-cannot-see' && reasonOf(skipped.lines.head) === 'user-skipped' && reasonOf(skipped.lines.life) === 'not-requested' && reasonOf(skipped.lines.upward) === 'not-requested');
const noFrame = build(featureInput(POSE, { landmarks: null }));
check('F10. no usable landmarks -> confirmed traces become unassessed (frame-unavailable), measurements unavailable', ALL_LINES.slice(0, 3).every((l) => reasonOf(noFrame.lines[l]) === 'frame-unavailable') && noFrame.measurements.status === 'unavailable' && !noFrame.frame.available);
check('F11. every line and mark is always present in the record (nothing silently missing)', ALL_LINES.every((l) => fsBase.lines[l] !== undefined) && ALL_MARKS.every((m) => fsBase.marks[m] !== undefined));
const structural: Array<[string, Partial<PalmFeatureSetInput>]> = [
  ['unknown line', { lines: [{ line: 'sun' as never, action: 'skipped', reason: 'user-skipped' }] }],
  ['duplicate line', { lines: [{ line: 'heart', action: 'skipped', reason: 'user-skipped' }, { line: 'heart', action: 'skipped', reason: 'user-skipped' }] }],
  ['bad skip reason', { lines: [{ line: 'heart', action: 'skipped', reason: 'bored' as never }] }],
  ['unknown mark', { marks: [{ mark: 'trident' as never, action: 'reported' }] }],
  ['duplicate mark', { marks: [{ mark: 'yava', action: 'reported' }, { mark: 'yava', action: 'skipped' }] }],
  ['hand "unknown"', { hand: 'unknown' as never }],
  ['rotation out of range', { rotationDeg: 400 }],
];
for (const [label, over] of structural) check(`F12. structural error fails the whole build: ${label}`, buildPalmFeatureSet(featureInput(POSE, over)).ok === false);

// ============================================================ G. provenance
const marks: MarkInput[] = [{ mark: 'matsya', action: 'reported', approximateLocation: toNorm({ x: 0.5, y: 0.5 }, POSE) }, { mark: 'yava', action: 'reported' }, { mark: 'vedi', action: 'skipped' }, { mark: 'chatra', action: 'reported', approximateLocation: { x: 2, y: 0.5 } }];
const fsFull = build(featureInput(POSE, { lines: [...tracedLines(POSE), { line: 'upward', action: 'skipped', reason: 'user-skipped' }], marks }));
const prov = fsFull.provenance;
check('G1. measurements are automatic-measured', MEASUREMENT_IDS.every((id) => prov['automatic-measured'].includes(`measurement:${id}`)));
check('G2. confirmed traces are user-confirmed; the skipped upward line is unassessed', ['heart', 'head', 'life'].every((l) => prov['user-confirmed'].includes(`line:${l}`)) && prov.unassessed.includes('line:upward'));
check('G3. reported marks are user-reported (location optional); skipped/unrequested/invalid-location marks are unassessed', prov['user-reported'].join() === 'mark:yava,mark:matsya' && ['mark:shankha', 'mark:chatra', 'mark:vedi'].every((m) => prov.unassessed.includes(m)));
check('G4. a reported mark location is converted to the palm frame; no location stays null (never guessed)', (() => { const f = fsFull.marks.matsya, y = fsFull.marks.yava; return f.provenance === 'user-reported' && f.approximatePalmLocation !== null && (() => { const fr = palmFrameFromLandmarks(lm, 1000, 1400).frame!; const e = imageToPalm(fr, toNorm({ x: 0.5, y: 0.5 }, POSE)); return Math.abs(f.approximatePalmLocation.x - e.x) < 1e-4 && Math.abs(f.approximatePalmLocation.y - e.y) < 1e-4; })() && y.provenance === 'user-reported' && y.approximatePalmLocation === null; })());
check('G5. every feature appears in exactly one provenance group', (() => { const all = Object.values(prov).flat(); return all.length === new Set(all).size && all.length === MEASUREMENT_IDS.length + ALL_LINES.length + ALL_MARKS.length; })());
check('G6. user confirmation records identity only: anatomical + Western + Indian names, no accuracy or score field', (() => { const l = fsFull.lines.heart; return l.provenance === 'user-confirmed' && l.identity === PALM_LINE_IDENTITY.heart && !/confidence|accuracy|score|valid/i.test(Object.keys(l).join()); })());
check('G7. no landmark coordinates or pixels in the feature set', !/"landmarks"|ImageData|pixel/i.test(JSON.stringify(fsFull)));
const guideMarks = [...read('packages/palmistry/src/content.ts').matchAll(/id: '([a-z]+)',\s*\n\s*category: 'mark'/g)].map((m) => m[1]);
const guideLines = [...read('packages/palmistry/src/content.ts').matchAll(/id: '([a-z]+)',\s*\n\s*category: 'line'/g)].map((m) => m[1]);
check('G8. mark ids match the approved guide\'s marks exactly', JSON.stringify(guideMarks) === JSON.stringify([...ALL_MARKS]), guideMarks);
check('G9. every line\'s Indian identity is one of the approved guide\'s lines', ALL_LINES.every((l) => guideLines.includes(PALM_LINE_IDENTITY[l].indianId)) && guideLines.length === 4, guideLines);

// ============================================================ H. synthetic engine compatibility + confidence handling
const adapted = featureSetAdapter.adaptFeatureSet(fsFull, SYN);
const validation = engine.validateFeatures(adapted.features);
check('H1. adapted output passes the frozen engine validator (schema 0.1.0, synthetic: true)', validation.ok, validation.errors);
const reading = engine.generateReading(adapted.features);
const obs = (cls: string) => reading.observations.find((o: any) => o.crease === cls);
check('H2. the engine interprets the reading', reading.status === 'interpreted', reading.status);
check('H3. traced heart/head/life map to DTC/PTC/TC with status ok', ['DTC', 'PTC', 'TC'].every((c) => obs(c)?.status === 'ok'), reading.observations.map((o: any) => [o.crease, o.status]));
check('H4. traced lines are capped at tentative evidence (<= 0.74): confirmation is not accuracy', ['DTC', 'PTC', 'TC'].every((c) => obs(c).evidenceScore <= 0.74 && obs(c).evidenceScore >= 0.5));
check('H5. the skipped upward line is not observed (never inferred)', obs('CENTRAL_LONGITUDINAL')?.status === 'not-observed');
check('H6. measurements and user-reported marks are listed as not mappable, none dropped silently', adapted.notMapped.filter((n: any) => n.feature.startsWith('measurement:')).length === MEASUREMENT_IDS.length && adapted.notMapped.some((n: any) => n.feature === 'mark:matsya') && adapted.notMapped.some((n: any) => n.feature === 'mark:yava'));
check('H7. skipped lines are not mapped as "expected but missing" (absence carries no meaning)', adapted.features.creases.expectedButMissing.length === 0);
check('H8. the engine disclaimer is present; reading text carries no prohibited claim (excluded-claims list aside)', /not a science/.test(reading.disclaimer.text) && !/\b(lifespan|death|die|diagnos|disease|guarantee)/i.test(JSON.stringify(reading.sections, (k, v) => (k === 'excludedClaims' ? undefined : v))) && JSON.stringify(reading.sections).includes('excludedClaims'));
const onlyHeart = engine.generateReading(adaptF(build(featureInput(POSE, { lines: tracedLines(POSE, ['heart']) })), SYN));
check('H9. only the heart line traced: head and life are not observed, heart is ok', obs.call(null, 'DTC') && onlyHeart.observations.find((o: any) => o.crease === 'DTC').status === 'ok' && ['PTC', 'TC'].every((c) => onlyHeart.observations.find((o: any) => o.crease === c).status === 'not-observed'));
const nothing = engine.generateReading(adaptF(build(featureInput(POSE, { lines: [] })), SYN));
check('H10. nothing traced: the engine declines rather than inventing a reading', nothing.status !== 'interpreted', nothing.status);
const lowScan = engine.generateReading(adaptF(fsFull, { synthetic: true, scanConfidence: 0.3 }));
check('H11. scan confidence below the engine minimum (0.40) declines the whole reading', lowScan.status !== 'interpreted', lowScan.status);
const blurry = build(featureInput(POSE, { qualityIssues: ['blurry'] }));
const blurryReading = engine.generateReading(adaptF(blurry, SYN));
check('H12. a G5 quality issue is forwarded unaltered and the engine applies its own frame rules', adaptF(blurry, SYN).capture.quality.status === 'needs-retake' && blurryReading.status !== 'interpreted', blurryReading.status);
const upward = build(featureInput(POSE, { lines: tracedLines(POSE, ['heart', 'head', 'life', 'upward']) }));
const upwardReading = engine.generateReading(adaptF(upward, SYN));
check('H13. a traced upward line reaches the engine only as a geometry-identified hypothesis (MINOR)', adaptF(upward, SYN).creases.items.some((c: any) => c.id === 'trace-upward' && c.identity.anatomicalClass === 'MINOR') && upwardReading.observations.find((o: any) => o.crease === 'CENTRAL_LONGITUDINAL').evidenceScore <= 0.74);
// A self-crossing trace is structurally fine in the feature set, but the engine geometry rules reject it.
const zigzag = [{ x: 0.3, y: 0.3 }, { x: 0.8, y: 0.45 }, { x: 0.8, y: 0.3 }, { x: 0.3, y: 0.45 }].map((p) => toNorm(p, POSE));
const zz = build(featureInput(POSE, { lines: [...tracedLines(POSE, ['heart', 'life']), { line: 'head', action: 'traced', points: zigzag, confirmed: true }] }));
const zzAdapted = featureSetAdapter.adaptFeatureSet(zz, SYN);
check('H14. a self-crossing trace never becomes confirmed geometry: unassessed (trace-self-intersecting, identity confirmation kept); the other lines still read', zz.lines.head.provenance === 'unassessed' && (zz.lines.head as any).reason === 'trace-self-intersecting' && zz.lines.head.confirmation === 'confirmed' && zzAdapted.features.creases.items.length === 2 && engine.validateFeatures(zzAdapted.features).ok && engine.generateReading(zzAdapted.features).status === 'interpreted');
const refuse = (fn: () => unknown, code: string) => { try { fn(); return false; } catch (e: any) { return e?.code === code; } };
check('H15. the adapter refuses without an explicit synthetic declaration (no real-input path)', refuse(() => featureSetAdapter.adaptFeatureSet(fsFull, { scanConfidence: 0.9 }), 'synthetic-required') && refuse(() => featureSetAdapter.adaptFeatureSet(fsFull, null), 'synthetic-required'));
check('H16. the adapter refuses an unknown feature-set version and an unconfirmed "assessed" line', refuse(() => featureSetAdapter.adaptFeatureSet({ ...fsFull, version: 'x' }, SYN), 'unsupported-feature-set') && refuse(() => featureSetAdapter.adaptFeatureSet({ ...fsFull, lines: { ...fsFull.lines, heart: { ...fsFull.lines.heart, confirmation: 'pending' } } }, SYN), 'invalid-line'));
check('H17. left and right hands produce the same engine creases (mirror consistency end to end)', JSON.stringify(adaptF(fsBase, SYN).creases) === JSON.stringify(adaptF(fsLeft, SYN).creases));
check('H18. the frozen engine keeps its synthetic-only restriction (synthetic: false is rejected)', !engine.validateFeatures({ ...adapted.features, synthetic: false }).ok);

// ============================================================ I. production exclusion + isolation
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NEW_LIB = ['apps/web/lib/palm-analysis/measurements.ts', 'apps/web/lib/palm-analysis/features.ts'];
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.next', '.next-dev', 'android', 'ios', 'public'].includes(name)) continue;
    const full = path.join(dir, name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walk(full)); else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}
const webSources = walk(path.join(ROOT, 'apps/web')).map((f) => path.relative(ROOT, f));
const importers = (re: RegExp) => webSources.filter((f) => !NEW_LIB.includes(f) && re.test(strip(read(f))));
check('I1. no app, component or other module imports the new measurement or feature modules', importers(/palm-analysis\/(measurements|features)['"]/).length === 0, importers(/palm-analysis\/(measurements|features)['"]/));
check('I2. the G5 public surface (index.ts) does not export them (not reachable from the upload UI)', !/measurements|features/.test(read('apps/web/lib/palm-analysis/index.ts')));
check('I3. new modules: no network, storage, console, camera, external URL or engine reference', NEW_LIB.every((f) => { const s = strip(read(f)); return !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie|console\.|getUserMedia|mediaDevices|https?:\/\/|reading-engine|palm-g6|mediapipe/i.test(s); }));
check('I4. new modules contain none of the engine bundle-guard sentinels', NEW_LIB.every((f) => !/aura\.palm\.features|palm-normalized-v1|uncalibrated-detector-score|creases-directional-d3b|landmark-crease-conflation|no-interpretable-creases|g6-i1-feature-adapter/.test(read(f))));
check('I5. no app or package outside the engine package references the new adapter', webSources.every((f) => !/feature-set-adapter/.test(read(f))));
check('I6. production exclusions unchanged: image input + MediaPipe still unconditionally excluded', /There is deliberately no flag or environment variable that turns this off/.test(read('apps/web/palm-image-input-build-exclusion.js')) && /if \(dev\) return config;/.test(read('apps/web/palm-image-input-build-exclusion.js')) && /MEDIAPIPE_PACKAGES = \['@mediapipe\/tasks-vision'\]/.test(read('apps/web/palm-image-input-build-exclusion.js')));
check('I7. the dev gate is unchanged (next dev + explicit flag)', /nodeEnv === 'development' && flag === PALM_IMAGE_INPUT_FLAG_VALUE/.test(read('apps/web/lib/palm-analysis/gate.ts')));
check('I8. the frozen engine sources are untouched by this ticket (no 03-I1 marker in prototype/src)', fs.readdirSync(path.join(ROOT, 'packages/palm-reading-engine/prototype/src')).every((f) => !/03-I1|feature-set-adapter/.test(read(`packages/palm-reading-engine/prototype/src/${f}`))));
check('I9. the approved guide review status is still APPROVED and the guide files are not referenced by the new modules', /"status":\s*"APPROVED"/.test(read('packages/palmistry/src/review-status.json')) && NEW_LIB.every((f) => !/packages\/palmistry|PalmistryView|PalmHandDiagram/.test(strip(read(f)))));

// ============================================================ R. independent-review boundary regressions (M1-M4, L1)
// Written from the PR #391 review findings (reviewed head 3c2e7de). Each must hold on the corrected head.
const noThrow = (fn: () => unknown): { ok: boolean; value?: any; error?: any } => { try { return { ok: true, value: fn() }; } catch (error) { return { ok: false, error }; } };
const mh = (over: Record<string, unknown>) => noThrow(() => measureHand({ landmarks: lm, imageWidth: 1000, imageHeight: 1400, qualityIssues: [], handednessLabel: labelFor(POSE), ...over } as never));
const sparseLm = lm.slice(); delete (sparseLm as any)[7];
const r1 = mh({ landmarks: sparseLm });
check('R1 (M1). sparse landmark array -> no exception, all unavailable (landmarks-invalid)', r1.ok && r1.value.status === 'unavailable' && r1.value.reasons.includes('landmarks-invalid'), r1.ok ? r1.value.reasons : String(r1.error));
const r2 = mh({ landmarks: lm.map((p, i) => (i === 12 ? { ...p, y: -0.05 } : p)) });
check('R2 (M1). landmark outside the normalised [0,1] frame -> unavailable (landmark-out-of-frame)', r2.ok && r2.value.status === 'unavailable' && r2.value.reasons.includes('landmark-out-of-frame'), r2.ok ? r2.value.reasons : String(r2.error));
const r3 = mh({ landmarks: lm.map((p, i) => (i === 2 ? { ...p, z: NaN } : p)) });
check('R3 (M1). non-finite optional z -> unavailable (landmarks-invalid)', r3.ok && r3.value.status === 'unavailable' && r3.value.reasons.includes('landmarks-invalid'), r3.ok ? r3.value.reasons : String(r3.error));
const r4 = mh({ imageWidth: 1e308, imageHeight: 1e308 });
check('R4 (M1). arithmetic overflow (1e308 px image) -> no non-finite value classified as measured', r4.ok && r4.value.status === 'unavailable' && MEASUREMENT_IDS.every((id: any) => r4.value.measurements[id].value === null), r4.ok ? [r4.value.status, values(r4.value)] : String(r4.error));
const r5 = mh({ qualityIssues: undefined });
check('R5 (M1). missing quality feedback -> quality explicitly unknown, values at most uncertain', r5.ok && r5.value.status === 'uncertain' && r5.value.reasons.includes('quality-unknown'), r5.ok ? [r5.value.status, r5.value.reasons] : String(r5.error));
const r6 = mh({ qualityIssues: ['not-a-code'] });
check('R6 (M1). invalid quality feedback (unknown code) -> unavailable (quality-invalid)', r6.ok && r6.value.status === 'unavailable' && r6.value.reasons.includes('quality-invalid'), r6.ok ? r6.value.reasons : String(r6.error));
const sparseIssues: PalmFeedbackCode[] = []; sparseIssues.length = 2;
const r6b = mh({ qualityIssues: sparseIssues });
check('R6b (M1). sparse quality-issue array -> unavailable (quality-invalid)', r6b.ok && r6b.value.status === 'unavailable' && r6b.value.reasons.includes('quality-invalid'), r6b.ok ? r6b.value.reasons : String(r6b.error));
const r7 = [noThrow(() => measureHand(null as never)), noThrow(() => measureHand({ get landmarks() { throw new Error('boom'); }, imageWidth: 1, imageHeight: 1, qualityIssues: [] } as never))];
check('R7 (M1). malformed input objects (null input, throwing accessor) -> no uncontrolled exception', r7.every((r) => r.ok && r.value.status === 'unavailable'), r7.map((r) => (r.ok ? r.value.reasons : String(r.error))));
const sparseTrace = CANON_TRACES.heart.map((p) => toNorm(p, POSE)); delete (sparseTrace as any)[2];
const r8 = noThrow(() => build(featureInput(POSE, { lines: [{ line: 'heart', action: 'traced', points: sparseTrace, confirmed: true }] })).lines.heart);
check('R8 (M2). sparse trace array -> no exception, unassessed (trace-point-invalid)', r8.ok && r8.value.provenance === 'unassessed' && r8.value.reason === 'trace-point-invalid', r8.ok ? r8.value : String(r8.error));
const crossing = [{ x: 0.3, y: 0.3 }, { x: 0.8, y: 0.45 }, { x: 0.8, y: 0.3 }, { x: 0.3, y: 0.45 }].map((p) => toNorm(p, POSE));
const r9 = noThrow(() => build(featureInput(POSE, { lines: [{ line: 'head', action: 'traced', points: crossing, confirmed: true }] })).lines.head);
check('R9 (M2). self-crossing trace is rejected before recording: unassessed (trace-self-intersecting), identity confirmation kept separate', r9.ok && r9.value.provenance === 'unassessed' && r9.value.reason === 'trace-self-intersecting' && r9.value.confirmation === 'confirmed', r9.ok ? r9.value : String(r9.error));
const backTrack = [{ x: 0.2, y: 0.4 }, { x: 0.6, y: 0.42 }, { x: 0.25, y: 0.43 }].map((p) => toNorm(p, POSE));
const r9b = noThrow(() => build(featureInput(POSE, { lines: [{ line: 'head', action: 'traced', points: backTrack, confirmed: true }] })).lines.head);
check('R9b (M2). doubling-back trace -> unassessed (trace-doubles-back)', r9b.ok && r9b.value.provenance === 'unassessed' && r9b.value.reason === 'trace-doubles-back', r9b.ok ? r9b.value : String(r9b.error));
// R10: property check over deterministic pseudo-random traces near the geometric limits: every RECORDED (rounded,
// serialised) geometry must pass the engine's own polyline rules and bounds, and order must be preserved.
const engineSchema = require('../packages/palm-reading-engine/prototype/src/schema.mjs');
let seed = 20261124; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const r10: { recorded: number; bad: any[] } = { recorded: 0, bad: [] };
const { frame: f10 } = palmFrameFromLandmarks(lm, 1000, 1400);
for (let k = 0; k < 600; k++) {
  const n = 2 + Math.floor(rnd() * 6), pts: P[] = [];
  const x0 = 0.35 + rnd() * 0.3, y0 = 0.45 + rnd() * 0.15, step = rnd() < 0.3 ? 0.000004 + rnd() * 0.00003 : 0.002 + rnd() * 0.05;
  for (let j = 0; j < n; j++) pts.push({ x: x0 + (rnd() - 0.3) * step * (j + 1), y: y0 + (rnd() - 0.5) * step * (j + 1) });
  const res = build(featureInput(POSE, { lines: [{ line: 'life', action: 'traced', points: pts, confirmed: true }] })).lines.life;
  if (res.provenance === 'user-confirmed') {
    r10.recorded++;
    const order = pts.map((p) => imageToPalm(f10!, p));
    const okOrder = res.palmPoints.every((q, i) => Math.abs(q.x - order[i].x) <= 5.1e-5 && Math.abs(q.y - order[i].y) <= 5.1e-5);
    if (engineSchema.polylineProblem(res.palmPoints.map((q) => ({ x: q.x, y: q.y }))) !== null || !okOrder || res.palmPoints.length !== pts.length) r10.bad.push(res.palmPoints);
  }
}
check('R10 (M2). rounding-sensitive traces: every recorded geometry passes the engine polyline rules after rounding; order and point count preserved', r10.bad.length === 0 && r10.recorded > 50, { recorded: r10.recorded, bad: r10.bad.slice(0, 2) });

// Port equivalence: the feature-set geometry rules agree with the engine's polylineProblem (same accept/reject verdict)
// on deterministic random polylines, including near-limit turns, crossings and near-duplicate points.
{
  const ENGINE_TO_TRACE: Record<string, string> = { 'too-few-distinct-points': 'trace-too-few-distinct-points', 'repeated-point': 'trace-repeated-point', degenerate: 'trace-too-short', 'doubles-back': 'trace-doubles-back', 'self-intersecting': 'trace-self-intersecting', tortuous: 'trace-tortuous' };
  let s2 = 77; const r2 = () => ((s2 = (s2 * 1103515245 + 12345) % 2147483648) / 2147483648);
  const mismatches: any[] = []; let rejects = 0;
  for (let k = 0; k < 3000; k++) {
    const n = 2 + Math.floor(r2() * 7), pts: P[] = [];
    for (let j = 0; j < n; j++) pts.push({ x: Math.round((0.2 + r2() * 0.6) * (r2() < 0.2 ? 100 : 10000)) / (r2() < 0.2 ? 100 : 10000), y: Math.round((0.2 + r2() * 0.6) * 10000) / 10000 });
    if (r2() < 0.1 && n > 2) pts[n - 1] = { ...pts[0] };
    const e = engineSchema.polylineProblem(pts), t = traceGeometryProblem(pts);
    if (e) rejects++;
    if ((e ? ENGINE_TO_TRACE[e] : null) !== t) mismatches.push({ pts, e, t });
  }
  check('R10b (M2). ported geometry rules give the engine polylineProblem verdict on 3000 random polylines (incl. rejects)', mismatches.length === 0 && rejects > 500, { mismatches: mismatches.slice(0, 2), rejects });
}
const unknownQ = build(featureInput(POSE, { qualityIssues: null }));
const unknownQAdapted = adaptF(unknownQ, SYN);
const unknownQReading = engine.generateReading(unknownQAdapted);
check('R5b (M1). builder with no quality feedback: qualityStatus "unknown", measurements uncertain (quality-unknown), forwarded unaltered; the engine does not interpret an unknown-quality frame', unknownQ.frame.qualityStatus === 'unknown' && unknownQ.measurements.reasons.includes('quality-unknown') && unknownQAdapted.capture.quality.status === 'unknown' && unknownQReading.status === 'declined', [unknownQ.frame.qualityStatus, unknownQReading.status]);
// Adapter (M3)
const clone = (v: unknown) => JSON.parse(JSON.stringify(v));
const adaptErr = (f: unknown, syn: unknown = SYN): string => { try { featureSetAdapter.adaptFeatureSet(f, syn); return 'accepted'; } catch (e: any) { return e instanceof featureSetAdapter.AdapterError ? e.code : `RAW:${e?.constructor?.name}:${e?.message}`; } };
const contra = clone(fsFull); contra.frame.qualityStatus = 'accepted'; contra.frame.qualityIssues = ['blurry'];
check('R11 (M3). contradictory quality record (accepted + issues) -> typed AdapterError', adaptErr(contra) === 'contradictory-quality', adaptErr(contra));
const blockAcc = clone(fsFull); blockAcc.frame.qualityStatus = 'accepted'; blockAcc.frame.qualityIssues = ['palm-not-visible'];
check('R11b (M3). blocking issue cannot be laundered through an "accepted" status', adaptErr(blockAcc) === 'contradictory-quality', adaptErr(blockAcc));
const noStatusIssues = clone(fsFull); noStatusIssues.frame.qualityStatus = 'needs-retake'; noStatusIssues.frame.qualityIssues = [];
check('R11c (M3). needs-retake with no issue is contradictory too', adaptErr(noStatusIssues) === 'contradictory-quality', adaptErr(noStatusIssues));
const sparsePts = clone(fsFull); sparsePts.lines.heart.palmPoints = [sparsePts.lines.heart.palmPoints[0], null, sparsePts.lines.heart.palmPoints[2]];
const holePts = clone(fsFull); const h = holePts.lines.heart.palmPoints; delete h[1];
check('R12 (M3). null trace point -> invalid-line; sparse (hole) trace array -> sparse-array (both typed AdapterErrors)', adaptErr(sparsePts) === 'invalid-line' && adaptErr(holePts) === 'sparse-array', [adaptErr(sparsePts), adaptErr(holePts)]);
const crossRec = clone(fsFull); crossRec.lines.head.palmPoints = [{ x: 0.3, y: 0.3 }, { x: 0.8, y: 0.45 }, { x: 0.8, y: 0.3 }, { x: 0.3, y: 0.45 }];
check('R12b (M3). malformed (self-crossing) recorded geometry -> typed AdapterError, not a silent decline', adaptErr(crossRec) === 'invalid-line', adaptErr(crossRec));
const noMeas = clone(fsFull); delete noMeas.measurements.measurements.ringLength;
const noMark = clone(fsFull); delete noMark.marks.shankha;
const noLine = clone(fsFull); delete noLine.lines.upward;
check('R13 (M3). incomplete measurement, mark or line inventory -> typed AdapterError (incomplete-inventory)', [noMeas, noMark, noLine].every((f) => adaptErr(f) === 'incomplete-inventory'), [noMeas, noMark, noLine].map((f) => adaptErr(f)));
const badMeas = clone(fsFull); badMeas.measurements.measurements.palmLength.value = null;
check('R13b (M3). measurement marked measured with a null value -> typed AdapterError', adaptErr(badMeas) === 'invalid-measurement', adaptErr(badMeas));
const provLine = clone(fsFull); provLine.lines.heart.provenance = 'user-reported';
const provMark = clone(fsFull); provMark.marks.yava.provenance = 'user-confirmed';
const provGroups = clone(fsFull); provGroups.provenance['user-confirmed'] = [...provGroups.provenance['user-confirmed'], 'line:upward'];
check('R14 (M3). invalid provenance (line user-reported, mark user-confirmed, groups disagreeing with records) -> typed AdapterError', adaptErr(provLine) === 'invalid-provenance' && adaptErr(provMark) === 'invalid-provenance' && adaptErr(provGroups) === 'invalid-provenance', [adaptErr(provLine), adaptErr(provMark), adaptErr(provGroups)]);
const confLine = clone(fsFull); confLine.lines.upward = { line: 'upward', provenance: 'unassessed', confirmation: 'confirmed', identity: confLine.lines.upward.identity, reason: 'user-skipped' };
const pendLine = clone(fsFull); pendLine.lines.heart.confirmation = 'pending';
const idLine = clone(fsFull); idLine.lines.heart.identity = clone(PALM_LINE_IDENTITY.life);
check('R15 (M3). invalid confirmation/source combinations (skipped yet confirmed, user-confirmed yet pending, wrong identity) -> typed AdapterError', adaptErr(confLine) === 'invalid-line' && adaptErr(pendLine) === 'invalid-line' && adaptErr(idLine) === 'invalid-line', [adaptErr(confLine), adaptErr(pendLine), adaptErr(idLine)]);
const throwing = clone(fsFull); Object.defineProperty(throwing, 'lines', { get() { throw new Error('boom'); }, enumerable: true });
const numPts = clone(fsFull); numPts.lines.heart.palmPoints = 5;
check('R16 (M3). hostile or wrongly typed records never leak raw exceptions (AdapterError only)', [throwing, numPts, null, 7, [], { version: 'palm-03-i1-feature-set@0.1.0' }].every((f) => !adaptErr(f).startsWith('RAW:') && adaptErr(f) !== 'accepted'), [throwing, numPts, null, 7, [], {}].map((f) => adaptErr(f)));
const blocking = build(featureInput(POSE, { qualityIssues: ['palm-not-visible'] }));
const blockingReading = engine.generateReading(adaptF(blocking, SYN));
check('R17 (M3). blocking quality feedback reaches the engine quality gate: reading declined (quality-not-accepted)', adaptF(blocking, SYN).capture.quality.status === 'needs-retake' && blockingReading.status === 'declined' && /quality/.test(JSON.stringify(blockingReading.decline ?? blockingReading)), blockingReading.status);
check('R18 (M3). synthetic-only gate and tentative ceiling preserved after hardening', adaptErr(fsFull, { scanConfidence: 0.9 }) === 'synthetic-required' && adaptF(fsFull, SYN).creases.items.every((c: any) => c.detection.confidence <= 0.74));
check('R19 (L1). the diagnostics-discarding convenience export is gone; only the full result is exported', featureSetAdapter.toEngineFeaturesFromFeatureSet === undefined && (() => { const r = featureSetAdapter.adaptFeatureSet(fsFull, SYN); return Array.isArray(r.declined) && Array.isArray(r.notMapped) && typeof r.features === 'object'; })());
// M4 characterization (frozen engine NOT modified): a user-SKIPPED line reaches the engine as "not observed" at the
// observation level, but the family-level decline reuses the engine's detector-miss wording ("not detected ...
// limitation of the photo or detector"). Recorded here as-is; PALM-03-E1 must resolve it (see report, E1 acceptance).
const skipLife = build(featureInput(POSE, { lines: [...tracedLines(POSE, ['heart', 'head']), { line: 'life', action: 'skipped', reason: 'user-skipped' }] }));
const skipReading = engine.generateReading(adaptF(skipLife, SYN));
const tcItems = skipReading.sections.flatMap((sec: any) => [...(sec.items ?? []), ...(sec.declined ?? []), ...(sec.quiet ?? [])]).filter((it: any) => /^F-TC-/.test(it.familyId ?? ''));
check('R20 (M4, characterization). skipped life line: observation not-observed; families declined with the detector-miss reason "missing" (frozen-engine mismatch, E1 item)', skipReading.observations.find((o: any) => o.crease === 'TC').status === 'not-observed' && tcItems.length > 0 && tcItems.every((it: any) => it.kind === 'declined' && it.reason === 'missing' && /not detected/.test(it.text)), tcItems.map((it: any) => [it.familyId, it.kind, it.reason]));
check('R21 (M4). no interpretation is generated from a skipped feature', tcItems.every((it: any) => it.kind !== 'interpreted') && !skipReading.sections.some((sec: any) => (sec.items ?? []).some((it: any) => it.kind === 'interpreted' && (it.evidence?.anatomicalClasses ?? []).includes('TC'))));

// ============================================================ RV. exact reproductions from the independent review (AURA-PALM-03-I1-IR)
// Axis-aligned 64 x 128 fixture: pixel offsets relative to (24, 32), label 'Left', rotation 0.
const RV_OFF = [[2,12],[-3,10],[-5,7],[-7,4],[-9,2],[0,0],[-1,-5],[-2,-8],[-3,-12],[4,0],[4,-5],[4,-9],[4,-13],[8,0],[9,-5],[9,-8],[9,-11],[12,0],[13,-4],[13,-7],[13,-10]];
const RV_LM = RV_OFF.map(([dx, dy]) => ({ x: (24 + dx) / 64, y: (32 + dy) / 128, z: 0 }));
const rvMeasure = (landmarks: unknown, over: Record<string, unknown> = {}) => noThrow(() => measureHand({ landmarks, imageWidth: 64, imageHeight: 128, qualityIssues: [], handednessLabel: 'Left', ...over } as never));
const rvInput = (over: Partial<PalmFeatureSetInput> = {}): PalmFeatureSetInput => ({ hand: 'right', dominantHand: 'right', landmarks: RV_LM, imageWidth: 64, imageHeight: 128, qualityIssues: [], rotationDeg: 0, handednessLabel: 'Left', lines: [], marks: [], ...over });
const rvBase = rvMeasure(RV_LM);
check('RV0. the review fixture is a valid frame (baseline measured or uncertain, never unavailable)', rvBase.ok && rvBase.value.status !== 'unavailable', rvBase.ok ? [rvBase.value.status, rvBase.value.reasons] : String(rvBase.error));
const rvHole = RV_LM.slice(); delete (rvHole as any)[5];
const rv1a = rvMeasure(rvHole), rv1b = noThrow(() => buildPalmFeatureSet(rvInput({ landmarks: rvHole })));
check('RV1 (M1). index 5 deleted: measureHand and buildPalmFeatureSet do not throw; landmarks invalid, frame unavailable', rv1a.ok && rv1a.value.status === 'unavailable' && rv1b.ok && rv1b.value.ok && !rv1b.value.featureSet.frame.available && rv1b.value.featureSet.frame.reason === 'landmarks-invalid', [rv1a.ok ? rv1a.value.reasons : String(rv1a.error), rv1b.ok ? rv1b.value : String(rv1b.error)]);
const rv2 = rvMeasure(RV_LM.map((p, i) => (i === 8 ? { ...p, x: 1.2 } : p)));
const rv3 = rvMeasure(RV_LM.map((p, i) => (i === 8 ? { ...p, x: Number.MAX_VALUE } : p)));
check('RV2 (M1). index fingertip at x = 1.2 -> unavailable (landmark-out-of-frame), not measured', rv2.ok && rv2.value.status === 'unavailable' && rv2.value.reasons.includes('landmark-out-of-frame'), rv2.ok ? rv2.value.reasons : String(rv2.error));
check('RV3 (M1). index fingertip at x = Number.MAX_VALUE -> unavailable; no Infinity anywhere', rv3.ok && rv3.value.status === 'unavailable' && !/Infinity|null,"unit":"palm-width","status":"measured"/.test(JSON.stringify(rv3.value)) && MEASUREMENT_IDS.every((id: any) => rv3.value.measurements[id].value === null), rv3.ok ? rv3.value.reasons : String(rv3.error));
const rv4 = rvMeasure(RV_LM, { qualityIssues: undefined });
check('RV4 (M1). qualityIssues undefined -> quality-unknown, not measured', rv4.ok && rv4.value.status === 'uncertain' && rv4.value.reasons.includes('quality-unknown'), rv4.ok ? [rv4.value.status, rv4.value.reasons] : String(rv4.error));
// Diagonal trace in the axis-aligned frame: palm (0.200051, 0.200051) -> (0.214211, 0.214211); palm width = 12 px.
const rvTrace = [[0.200051, 0.200051], [0.214211, 0.214211]].map(([px, py]) => ({ x: (24 + 12 * px) / 64, y: (32 + 12 * py) / 128 }));
const rv5 = noThrow(() => build(rvInput({ lines: [{ line: 'heart', action: 'traced', points: rvTrace, confirmed: true }] })).lines.heart);
check('RV5 (M2). rounding-boundary diagonal (raw ~0.020025, rounded ~0.019940): rejected as trace-too-short after rounding, never confirmed', rv5.ok && rv5.value.provenance === 'unassessed' && rv5.value.reason === 'trace-too-short' && rv5.value.confirmation === 'confirmed', rv5.ok ? rv5.value : String(rv5.error));
const rvGood = build(rvInput({ lines: [{ line: 'heart', action: 'traced', points: [[0.2, 0.2], [0.6, 0.25], [0.9, 0.3]].map(([px, py]) => ({ x: (24 + 12 * px) / 64, y: (32 + 12 * py) / 128 })), confirmed: true }] }));
check('RV5b (M2). a valid trace on the same fixture is still confirmed with order preserved', rvGood.lines.heart.provenance === 'user-confirmed' && (rvGood.lines.heart as any).palmPoints[0].x < (rvGood.lines.heart as any).palmPoints[2].x);
const rvMid = [[0.2, 0.2], [0.5, 0.25], [0.8, 0.3]].map(([px, py]) => ({ x: (24 + 12 * px) / 64, y: (32 + 12 * py) / 128 })); delete (rvMid as any)[1];
const rv6 = noThrow(() => build(rvInput({ lines: [{ line: 'heart', action: 'traced', points: rvMid, confirmed: true }] })).lines.heart);
check('RV6 (M2). three-point trace with the middle index deleted -> unassessed (trace-point-invalid), no throw', rv6.ok && rv6.value.provenance === 'unassessed' && rv6.value.reason === 'trace-point-invalid', rv6.ok ? rv6.value : String(rv6.error));
const rvRec = clone(rvGood); delete rvRec.lines.heart.palmPoints[1];
check('RV7 (M3). mapped record with a deleted palmPoints element -> typed AdapterError, no raw TypeError', ['sparse-array', 'invalid-line'].includes(adaptErr(rvRec)), adaptErr(rvRec));
const rvQ1 = clone(rvGood); rvQ1.frame.qualityIssues = new Array(1); rvQ1.frame.qualityStatus = 'needs-retake';
const rvQ2 = clone(rvGood); rvQ2.frame.qualityStatus = 'accepted'; rvQ2.frame.qualityIssues = ['hand-cut-off'];
check('RV8 (M3). quality issues new Array(1) -> typed error; accepted + hand-cut-off -> contradictory-quality (never reaches the engine)', ['sparse-array', 'invalid-frame'].includes(adaptErr(rvQ1)) && adaptErr(rvQ2) === 'contradictory-quality', [adaptErr(rvQ1), adaptErr(rvQ2)]);
const rvE1 = clone(rvGood); rvE1.measurements = {};
const rvE2 = clone(rvGood); rvE2.marks = {};
check('RV9 (M3). measurements {} or marks {} -> typed AdapterError (no silent loss of those diagnostic blocks)', ['invalid-measurement', 'incomplete-inventory'].includes(adaptErr(rvE1)) && adaptErr(rvE2) === 'incomplete-inventory', [adaptErr(rvE1), adaptErr(rvE2)]);
const rvSkip = build(featureInput(POSE, { lines: [...tracedLines(POSE, ['heart']), { line: 'head', action: 'skipped', reason: 'user-skipped' }] }));
const rvSkipReading = engine.generateReading(adaptF(rvSkip, SYN));
const ptcItems = rvSkipReading.sections.flatMap((sec: any) => [...(sec.items ?? []), ...(sec.declined ?? []), ...(sec.quiet ?? [])]).filter((it: any) => /PTC/.test(it.familyId ?? ''));
check('RV10 (M4, characterization). traced heart + skipped head: PTC not-observed, PTC families declined as "missing" with detector-miss wording, no PTC interpretation (frozen engine; E1 item)', rvSkipReading.observations.find((o: any) => o.crease === 'PTC').status === 'not-observed' && ptcItems.length > 0 && ptcItems.every((it: any) => it.kind === 'declined' && it.reason === 'missing' && /not detected/.test(it.text)), ptcItems.map((it: any) => [it.familyId, it.kind, it.reason]));
const allItems = (r: any) => r.sections.flatMap((sec: any) => sec.items ?? []).filter((it: any) => it.kind === 'interpreted');
check('RV11. every emitted interpretation item is tier "tentative" (decision 2 ceiling, scan confidence 1)', (() => { const r = engine.generateReading(adaptF(fsFull, { synthetic: true, scanConfidence: 1 })); const its = allItems(r); return its.length > 0 && its.every((it: any) => it.tier === 'tentative'); })());

check('RV12 (INC-7, characterization). empty branch arrays make the frozen branch/fork families evaluate to QUIET variants (unobserved read as none; E1-A3)', (() => { const q = engine.generateReading(adaptF(fsFull, SYN)).sections.flatMap((sec: any) => sec.quiet ?? []); return q.includes('F-DTC-BRANCHES') && q.includes('F-PTC-FORK'); })());

// ============================================================ M3F. final M3 adapter integrity (reviewed head 89ea6fe)
// Cross-record quality consistency, complete record invariants, inherited fields; positive controls first.
const okAdapt = (f: unknown) => adaptErr(f) === 'accepted';
const fold = CANON.map((p, i) => (i === 16 ? { x: 0.66, y: -0.2 } : p));
const POS: Array<[string, PalmFeatureSetInput]> = [
  ['clean, 3 traces', featureInput(POSE)],
  ...(['hand-too-small', 'hand-rotated', 'too-dark', 'too-bright', 'low-contrast', 'blurry'] as PalmFeedbackCode[]).map((c): [string, PalmFeatureSetInput] => [`degrading ${c}`, featureInput(POSE, { qualityIssues: [c] })]),
  ...(['palm-not-visible', 'hand-cut-off'] as PalmFeedbackCode[]).map((c): [string, PalmFeatureSetInput] => [`blocking ${c}`, featureInput(POSE, { qualityIssues: [c] })]),
  ['blocking + degrading', featureInput(POSE, { qualityIssues: ['hand-cut-off', 'blurry'] })],
  ['unknown quality', featureInput(POSE, { qualityIssues: null })],
  ['accepted + folded ring finger (geometry-specific unavailability)', featureInput(POSE, { landmarks: landmarksFor(POSE, fold) })],
  ['no handedness label', featureInput(POSE, { handednessLabel: undefined })],
  ['back of hand (palm-not-facing)', featureInput(POSE, { handednessLabel: LABEL_UNMIRRORED === 'Right' ? 'Left' : 'Right' })],
  ['implausible proportions', featureInput(POSE, { landmarks: landmarksFor(POSE, CANON.map((p) => ({ x: p.x, y: p.y * 0.55 }))) })],
  ['landmark out of frame (no frame)', featureInput(POSE, { landmarks: lm.map((p, i) => (i === 12 ? { ...p, y: -0.05 } : p)) })],
  ['invalid landmarks (no frame)', featureInput(POSE, { landmarks: null })],
  ['degenerate frame', featureInput(POSE, { landmarks: lm.map((p, i) => (i === 17 ? { ...lm[5] } : p)) })],
  ['mirrored left hand', featureInput({ ...POSE, mirror: true })],
  ['skipped / pending / invalid traces + marks', featureInput(POSE, { lines: [{ line: 'heart', action: 'skipped', reason: 'user-cannot-see' }, { line: 'head', action: 'traced', points: CANON_TRACES.head.map((p) => toNorm(p, POSE)), confirmed: false }, { line: 'life', action: 'traced', points: crossing, confirmed: true }], marks: [{ mark: 'matsya', action: 'reported', approximateLocation: toNorm({ x: 0.5, y: 0.5 }, POSE) }, { mark: 'yava', action: 'reported' }, { mark: 'vedi', action: 'skipped' }, { mark: 'chatra', action: 'reported', approximateLocation: { x: 2, y: 0 } }] })],
  ['frame unavailable + confirmed trace', featureInput(POSE, { landmarks: null, lines: tracedLines(POSE, ['heart']) })],
];
const posResults = POS.map(([label, inp]) => [label, adaptErr(build(inp))]);
check(`P1 (M3F positive controls). all ${POS.length} builder-produced records across quality and observation states are accepted by the adapter`, posResults.every(([, r]) => r === 'accepted'), posResults.filter(([, r]) => r !== 'accepted'));
check('P2. an accepted frame with geometry-specific unavailable measurements (folded finger) maps and interprets', (() => { const f = build(POS.find(([l]) => l.startsWith('accepted + folded'))![1]); return f.frame.qualityStatus === 'accepted' && f.measurements.measurements.ringLength.status === 'unavailable' && engine.generateReading(adaptF(f, SYN)).status === 'interpreted'; })());
check('P3. genuine blocked and unknown-quality records are accepted by the adapter and then declined by the engine quality gate (never interpreted)', ['blocking palm-not-visible', 'blocking hand-cut-off', 'unknown quality'].every((l) => { const f = build(POS.find(([x]) => x === l)![1]); return engine.generateReading(adaptF(f, SYN)).status === 'declined'; }));
// Contradictions (reproductions). reprov() rebuilds the provenance index from the records so that the ONLY defect in
// each case is the cross-record quality contradiction under test.
const reprov = (f: any) => { const g: any = { 'automatic-measured': [], 'user-confirmed': [], 'user-reported': [], unassessed: [] }; for (const id of MEASUREMENT_IDS) g[f.measurements.measurements[id].status === 'unavailable' ? 'unassessed' : 'automatic-measured'].push(`measurement:${id}`); for (const id of ALL_LINES) g[f.lines[id].provenance].push(`line:${id}`); for (const id of ALL_MARKS) g[f.marks[id].provenance].push(`mark:${id}`); f.provenance = g; return f; };
const cleanBlocked = clone(build(POS[0][1])); const blk = build(featureInput(POSE, { qualityIssues: ['hand-cut-off'] })); cleanBlocked.measurements = clone(blk.measurements); cleanBlocked.provenance = clone(blk.provenance); cleanBlocked.provenance['user-confirmed'] = clone(build(POS[0][1]).provenance['user-confirmed']); cleanBlocked.provenance.unassessed = clone(blk.provenance.unassessed).filter((x: string) => !x.startsWith('line:') || x === 'line:upward').concat([]);
reprov(cleanBlocked); const cbCode = adaptErr(cleanBlocked);
check('M3F-1. accepted (clean) frame + measurement record blocked by hand-cut-off -> contradictory-quality, before interpretation', cbCode === 'contradictory-quality', cbCode);
const cleanUnknown = clone(build(POS[0][1])); cleanUnknown.measurements = clone(build(featureInput(POSE, { qualityIssues: null })).measurements);
reprov(cleanUnknown); check('M3F-2. accepted frame + measurements carrying quality-unknown -> contradictory-quality', adaptErr(cleanUnknown) === 'contradictory-quality', adaptErr(cleanUnknown));
const unknownClean = clone(build(featureInput(POSE, { qualityIssues: null }))); unknownClean.measurements = clone(build(POS[0][1]).measurements);
reprov(unknownClean); check('M3F-3. unknown-quality frame + measurements claiming clean measured quality -> contradictory-quality', adaptErr(unknownClean) === 'contradictory-quality', adaptErr(unknownClean));
const blockedMeasured = clone(build(featureInput(POSE, { qualityIssues: ['palm-not-visible'] }))); blockedMeasured.measurements = clone(build(POS[0][1]).measurements);
reprov(blockedMeasured); check('M3F-4. blocking frame issue + fully measured measurements -> contradictory-quality', adaptErr(blockedMeasured) === 'contradictory-quality', adaptErr(blockedMeasured));
const degradedMeasured = clone(build(featureInput(POSE, { qualityIssues: ['blurry'] }))); degradedMeasured.measurements = clone(build(POS[0][1]).measurements);
reprov(degradedMeasured); check('M3F-5. degrading frame issue (blurry) + measurements with no matching reason -> contradictory-quality', adaptErr(degradedMeasured) === 'contradictory-quality', adaptErr(degradedMeasured));
const facingMismatch = clone(build(POS[0][1])); facingMismatch.frame.palmFacing = false;
check('M3F-6. frame palmFacing false + measured measurements -> contradictory-quality', adaptErr(facingMismatch) === 'contradictory-quality', adaptErr(facingMismatch));
const availMismatch = clone(build(featureInput(POSE, { landmarks: null }))); availMismatch.measurements = clone(build(POS[0][1]).measurements); availMismatch.provenance = clone(build(POS[0][1]).provenance); availMismatch.provenance['user-confirmed'] = []; availMismatch.provenance.unassessed = [...availMismatch.provenance.unassessed, 'line:heart', 'line:head', 'line:life'];
availMismatch.lines = clone(build(featureInput(POSE, { landmarks: null })).lines); reprov(availMismatch); check('M3F-7. frame unavailable + measured measurements -> contradictory-quality', adaptErr(availMismatch) === 'contradictory-quality', adaptErr(availMismatch));
const setInconsistent = clone(build(POS[0][1])); setInconsistent.measurements.status = 'measured'; setInconsistent.measurements.reasons = ['blurry'];
check('M3F-8. measurement set status/reasons inconsistent (measured with reasons) -> typed error (reason list is checked against the frame first)', ['invalid-measurement', 'contradictory-quality'].includes(adaptErr(setInconsistent)), adaptErr(setInconsistent));
// Record invariants
const staleMark = clone(fsFull); staleMark.marks.vedi.approximatePalmLocation = { x: 0.4, y: 0.4 };
check('M3F-9. unassessed mark carrying a stale placement -> invalid-mark', adaptErr(staleMark) === 'invalid-mark', adaptErr(staleMark));
const noReason = clone(fsFull); delete noReason.frame.reason;
const badReason = clone(fsFull); badReason.frame.reason = 'landmarks-invalid';
check('M3F-10. missing frame reason, or a reason contradicting availability -> invalid-frame', adaptErr(noReason) === 'invalid-frame' && adaptErr(badReason) === 'invalid-frame', [adaptErr(noReason), adaptErr(badReason)]);
const noUnassessedReason = clone(fsFull); delete noUnassessedReason.lines.upward.reason;
const noMarkReason = clone(fsFull); delete noMarkReason.marks.vedi.reason;
const noMeasReasons = clone(fsFull); delete noMeasReasons.measurements.measurements.palmLength.reasons;
check('M3F-11. missing required diagnostic fields (line reason, mark reason, measurement reasons) -> typed errors', adaptErr(noUnassessedReason) === 'invalid-line' && adaptErr(noMarkReason) === 'invalid-mark' && adaptErr(noMeasReasons) === 'invalid-measurement', [adaptErr(noUnassessedReason), adaptErr(noMarkReason), adaptErr(noMeasReasons)]);
const idPartial = clone(fsFull); delete idPartial.lines.heart.identity.indian;
const idWrong = clone(fsFull); idWrong.lines.head.identity.indianId = 'ayurlekha';
const idExtra = clone(fsFull); idExtra.lines.life.identity.meaning = 'longevity';
check('M3F-12. incomplete, wrong or extended line identity -> invalid-line', [idPartial, idWrong, idExtra].every((f) => adaptErr(f) === 'invalid-line'), [idPartial, idWrong, idExtra].map((f) => adaptErr(f)));
const confirmedUnassessed = build(featureInput(POSE, { lines: [{ line: 'life', action: 'traced', points: crossing, confirmed: true }] }));
check('M3F-13. positive control: user-confirmed identity with unassessed geometry is accepted', confirmedUnassessed.lines.life.provenance === 'unassessed' && confirmedUnassessed.lines.life.confirmation === 'confirmed' && okAdapt(confirmedUnassessed));
const inherit1 = Object.assign(Object.create(clone(fsFull)), {}); // every field inherited
const inherit2 = clone(fsFull); const fr2 = inherit2.frame; inherit2.frame = Object.assign(Object.create({ reason: fr2.reason }), { ...fr2 }); delete inherit2.frame.reason;
const inherit3 = clone(fsFull); inherit3.lines.heart = Object.assign(Object.create({ palmPoints: inherit3.lines.heart.palmPoints }), { ...inherit3.lines.heart }); delete inherit3.lines.heart.palmPoints;
check('M3F-14. inherited (prototype) fields never satisfy required properties -> typed error', [inherit1, inherit2, inherit3].every((f) => !okAdapt(f) && !adaptErr(f).startsWith('RAW:')), [inherit1, inherit2, inherit3].map((f) => adaptErr(f)));
const extraTop = clone(fsFull); extraTop.interpretation = 'x';
const extraLine = clone(fsFull); extraLine.lines.upward.palmPoints = [];
check('M3F-15. unexpected extra fields (top-level, or geometry on an unassessed line) -> typed error', !okAdapt(extraTop) && adaptErr(extraLine) === 'invalid-line', [adaptErr(extraTop), adaptErr(extraLine)]);
check('M3F-16. the adapter identity table equals the feature-set identity table (no drift)', JSON.stringify(featureSetAdapter.EXPECTED_IDENTITY) === JSON.stringify(PALM_LINE_IDENTITY), featureSetAdapter.EXPECTED_IDENTITY);
const rejectedBeforeEngine = (() => { const calls: any[] = []; const orig = engine.generateReading; try { [cleanBlocked, cleanUnknown, staleMark, idPartial, inherit2].forEach((f) => { try { const r = featureSetAdapter.adaptFeatureSet(f, SYN); calls.push(r); } catch { /* rejected */ } }); } finally { void orig; } return calls.length === 0; })();
check('M3F-17. malformed records are rejected by the adapter itself: no engine payload is produced for any of them', rejectedBeforeEngine);

// ============================================================ M3C. complete-contract probes (reviewed head 193c16d)
// One probe per remaining finding class; each mutates a VALID builder record in exactly one respect (provenance index
// rebuilt where needed) and must be rejected with a typed AdapterError.
const VALID = { clean: build(POS[0][1]), blurry: build(featureInput(POSE, { qualityIssues: ['blurry'] })), folded: build(POS.find(([l]) => l.startsWith('accepted + folded'))![1]), noFrame: build(featureInput(POSE, { landmarks: null, marks: [{ mark: 'yava', action: 'reported' }] })) };
const typedReject = (f: unknown) => { const c = adaptErr(f); return c !== 'accepted' && !c.startsWith('RAW:'); };
const probe = (label: string, f: any) => check(`M3C ${label}`, typedReject(f), adaptErr(f));
let q: any;
q = clone(VALID.clean); q.measurements.measurements.palmLength.status = 'uncertain'; q.measurements.measurements.palmLength.reasons = ['blurry'];
probe('1. item cites a quality issue (blurry) that is absent from an accepted frame and a measured set', q);
q = clone(VALID.blurry); q.measurements.measurements.indexLength.reasons = ['depends-on-uncertain'];
probe('2. item omits the applicable degrading reason (blurry frame, uncertain set, item reasons lack blurry)', q);
q = clone(VALID.blurry); q.measurements.measurements.thumbLength.reasons = ['too-dark'];
probe('3. item cites a different degrading reason than the frame/set (too-dark vs blurry)', q);
q = clone(VALID.folded); q.measurements.measurements.indexToRingRatio = { id: 'indexToRingRatio', value: 1.1, unit: 'ratio', status: 'measured', reasons: [] }; reprov(q);
probe('4. usable ratio whose operand (ringLength) is unavailable', q);
q = clone(VALID.folded); q.measurements.measurements.ringLength = { id: 'ringLength', value: null, unit: 'palm-width', status: 'unavailable', reasons: ['depends-on-unavailable'] }; reprov(q);
probe('5. a finger length unavailable with a derived-only reason (depends-on-unavailable)', q);
q = clone(VALID.noFrame); q.marks.yava.approximatePalmLocation = { x: 0.5, y: 0.5 };
probe('6. mark placement present although no frame is available', q);
q = clone(VALID.clean); q.lines.upward = { line: 'upward', provenance: 'unassessed', confirmation: 'confirmed', identity: q.lines.upward.identity, reason: 'frame-unavailable' }; reprov(q);
probe('7. false frame-unavailable line reason while the frame IS available', q);
q = clone(VALID.noFrame); q.lines.heart = { line: 'heart', provenance: 'unassessed', confirmation: 'confirmed', identity: q.lines.heart.identity, reason: 'trace-too-short' }; reprov(q);
probe('8. trace-geometry reason although no frame was available to place a trace', q);
q = clone(VALID.clean); q.lines.upward.reason = ['not-requested'];
probe('9. array accepted as a diagnostic reason (line reason ["not-requested"])', q);
q = clone(VALID.clean); q.marks.vedi.reason = ['not-requested'];
probe('10. array as a mark reason', q);
q = clone(VALID.clean); (q.frame.qualityIssues as any).extra = 1;
probe('11. unexpected named property on an array (frame.qualityIssues.extra)', q);
q = clone(VALID.clean); (q.lines.heart.palmPoints as any).note = 'x';
probe('12. unexpected named property on geometry array (palmPoints.note)', q);
q = clone(VALID.clean); q.measurements.measurements.handLength.value = 99;
probe('13. derived value inconsistent with its operands (handLength != palm + middle)', q);
q = clone(VALID.clean); q.measurements.reasons = []; q.measurements.measurements.palmLength.reasons = ['implausible-proportions']; q.measurements.measurements.palmLength.status = 'uncertain';
probe('14. item reason (implausible-proportions) not present in the set reasons', q);
q = clone(VALID.clean); q.frame.rotationDeg = '0';
probe('15. invalid field type (rotationDeg as string)', q);

// ============================================================ MUT. systematic contract-mutation suite (deterministic)
// Base: the 21 builder-produced positive-control records (POS). Every mutation below is invalid BY CONSTRUCTION (its
// expected outcome is decided in this test, independently of the adapter): each must be rejected with a typed
// AdapterError (never accepted, never a raw exception, never an engine payload).
{
  const BASES = POS.map(([label, inp]) => [label, JSON.parse(JSON.stringify(build(inp)))] as [string, any]);
  const stats: Record<string, { n: number; accepted: any[]; raw: any[] }> = {};
  const distinct = new Set<string>();
  const expectReject = (cat: string, label: string, f: any) => {
    const st = (stats[cat] ??= { n: 0, accepted: [], raw: [] }); st.n++;
    try { distinct.add(JSON.stringify(f, (k, v) => (Array.isArray(v) && Object.keys(v).length !== v.length ? { __arr: [...v], __props: Object.keys(v) } : v)) + String(Object.getPrototypeOf(f) === Object.prototype)); } catch { /* hostile */ }
    const c = adaptErr(f);
    if (c === 'accepted') st.accepted.push(label); else if (c.startsWith('RAW:')) st.raw.push(`${label}: ${c}`);
  };
  type Node = { path: (string | number)[]; value: any };
  const nodes = (v: any, path: (string | number)[] = [], out: Node[] = []): Node[] => {
    out.push({ path, value: v });
    if (v !== null && typeof v === 'object') for (const k of Object.keys(v)) nodes(v[k], [...path, Array.isArray(v) ? Number(k) : k], out);
    return out;
  };
  const at = (root: any, path: (string | number)[]) => path.reduce((o, k) => o[k], root);
  const mutate = (base: any, path: (string | number)[], fn: (parent: any, key: string | number) => void) => {
    const c = clone(base);
    if (path.length === 0) return c;
    fn(at(c, path.slice(0, -1)), path[path.length - 1]);
    return c;
  };
  const keyOf = (path: (string | number)[]) => String(path[path.length - 1]);
  // Fields where null / a number / a boolean CAN be legitimate somewhere in the contract are excluded from those
  // particular type substitutions (they are still covered by the always-invalid ones).
  const NULL_OK = ['palmFacing', 'approximatePalmLocation', 'value'];
  const NUM_OK = ['rotationDeg', 'x', 'y', 'value'];
  const BOOL_OK = ['available', 'palmFacing'];
  for (const [label, base] of BASES) {
    for (const { path, value } of nodes(base)) {
      if (path.length === 0) continue;
      const where = `${label} @ ${path.join('.')}`;
      const parentIsArray = Array.isArray(at(base, path.slice(0, -1)));
      // A. missing required fields (object members only; array elements are covered by D)
      if (!parentIsArray) expectReject('A missing field', where, mutate(base, path, (o, k) => { delete o[k]; }));
      // B. unexpected fields on every object and array
      if (value !== null && typeof value === 'object') {
        expectReject('B unexpected field', where, mutate(base, path, (o, k) => { o[k].zzUnexpected = 1; }));
      }
      // C. invalid field types: always-invalid substitutions, plus type-specific ones where never legitimate
      const k = keyOf(path);
      if (!parentIsArray || typeof value !== 'object') {
        expectReject('C invalid type', `${where} -> [v]`, mutate(base, path, (o, kk) => { o[kk] = [o[kk]]; }));
        expectReject('C invalid type', `${where} -> {}`, mutate(base, path, (o, kk) => { o[kk] = {}; }));
        expectReject('C invalid type', `${where} -> "zz-not-a-value"`, mutate(base, path, (o, kk) => { o[kk] = 'zz-not-a-value'; }));
        if (!NULL_OK.includes(k) && value !== null) expectReject('C invalid type', `${where} -> null`, mutate(base, path, (o, kk) => { o[kk] = null; }));
        if (!NUM_OK.includes(k) && typeof value !== 'number') expectReject('C invalid type', `${where} -> 7`, mutate(base, path, (o, kk) => { o[kk] = 7; }));
        if (!BOOL_OK.includes(k) && typeof value !== 'boolean') expectReject('C invalid type', `${where} -> true`, mutate(base, path, (o, kk) => { o[kk] = true; }));
      }
      // D. sparse arrays and named array properties
      if (Array.isArray(value)) {
        expectReject('D sparse/array props', `${where} hole`, mutate(base, path, (o, kk) => { o[kk].length += 1; }));
        expectReject('D sparse/array props', `${where} named prop`, mutate(base, path, (o, kk) => { (o[kk] as any).zz = 1; }));
        if (value.length) expectReject('D sparse/array props', `${where} hole@0`, mutate(base, path, (o, kk) => { delete o[kk][0]; }));
      }
    }
    // E. contradictory status / reason combinations (status is a function of reasons; confirmation of reason)
    for (const id of MEASUREMENT_IDS as any) {
      for (const st of ['measured', 'uncertain', 'unavailable']) {
        if (base.measurements.measurements[id].status === st) continue;
        expectReject('E status/reason', `${label} ${id}.status=${st}`, (() => { const c = clone(base); c.measurements.measurements[id].status = st; return c; })());
      }
    }
    for (const st of ['measured', 'uncertain', 'unavailable']) {
      if (base.measurements.status !== st) expectReject('E status/reason', `${label} set.status=${st}`, (() => { const c = clone(base); c.measurements.status = st; return c; })());
    }
    for (const id of ALL_LINES) for (const cf of ['none', 'pending', 'confirmed']) {
      if (base.lines[id].confirmation !== cf) expectReject('E status/reason', `${label} ${id}.confirmation=${cf}`, (() => { const c = clone(base); c.lines[id].confirmation = cf; return c; })());
    }
    if (base.measurements.status !== 'unavailable') {
      for (const extra of ['blurry', 'quality-unknown', 'palm-facing-unknown', 'finger-not-extended', 'depends-on-uncertain']) {
        if (base.measurements.reasons.includes(extra)) continue;
        expectReject('E status/reason', `${label} set.reasons+${extra}`, (() => { const c = clone(base); c.measurements.reasons = [...c.measurements.reasons, extra]; c.measurements.status = 'uncertain'; for (const id of MEASUREMENT_IDS as any) { const m = c.measurements.measurements[id]; if (m.status !== 'unavailable') { m.reasons = [...c.measurements.reasons]; m.status = 'uncertain'; } } return c; })());
      }
      for (const id of MEASUREMENT_IDS as any) {
        const m = base.measurements.measurements[id];
        if (m.status === 'unavailable') continue;
        expectReject('E status/reason', `${label} ${id} item reasons drop/alter`, (() => { const c = clone(base); const mm = c.measurements.measurements[id]; mm.reasons = mm.reasons.length ? mm.reasons.slice(1) : ['too-dark']; mm.status = mm.reasons.length ? 'uncertain' : 'measured'; return reprov(c); })());
      }
    }
    // H. measurement dependencies
    if (base.measurements.status !== 'unavailable') {
      for (const [d, [a, b]] of Object.entries({ handLength: ['palmLength', 'middleLength'], middleToPalmRatio: ['middleLength', 'palmLength'], indexToRingRatio: ['indexLength', 'ringLength'] })) {
        const ms = base.measurements.measurements;
        if (ms[d].status !== 'unavailable') {
          if (a !== 'palmLength') expectReject('H dependency', `${label} ${a} unavailable under usable ${d}`, (() => { const c = clone(base); c.measurements.measurements[a] = { id: a, value: null, unit: 'palm-width', status: 'unavailable', reasons: ['finger-not-extended'] }; return reprov(c); })());
          expectReject('H dependency', `${label} ${d} value off by 0.05`, (() => { const c = clone(base); c.measurements.measurements[d].value = Math.round((ms[d].value + 0.05) * 1000) / 1000; return c; })());
          expectReject('H dependency', `${label} ${d} depends-on-unavailable with usable operands`, (() => { const c = clone(base); c.measurements.measurements[d] = { id: d, value: null, unit: d.endsWith('Ratio') ? 'ratio' : 'palm-width', status: 'unavailable', reasons: ['depends-on-unavailable'] }; return reprov(c); })());
        } else {
          expectReject('H dependency', `${label} usable ${d} with an unavailable operand`, (() => { const c = clone(base); c.measurements.measurements[d] = { id: d, value: 1, unit: d.endsWith('Ratio') ? 'ratio' : 'palm-width', status: c.measurements.reasons.length ? 'uncertain' : 'measured', reasons: [...c.measurements.reasons] }; return reprov(c); })());
        }
        void b;
      }
    }
    // J. provenance contradictions: every id moved to every other group; duplicated; removed
    const groups = ['automatic-measured', 'user-confirmed', 'user-reported', 'unassessed'];
    for (const g of groups) for (const id of base.provenance[g]) {
      for (const g2 of groups) if (g2 !== g) expectReject('J provenance', `${label} ${id} ${g}->${g2}`, (() => { const c = clone(base); c.provenance[g] = c.provenance[g].filter((x: string) => x !== id); c.provenance[g2] = [...c.provenance[g2], id]; return c; })());
      expectReject('J provenance', `${label} ${id} duplicated`, (() => { const c = clone(base); c.provenance[g] = [...c.provenance[g], id]; return c; })());
      expectReject('J provenance', `${label} ${id} removed`, (() => { const c = clone(base); c.provenance[g] = c.provenance[g].filter((x: string) => x !== id); return c; })());
    }
  }
  // F. cross-record quality substitutions: transplant the measurement set of record B into record A whenever B's set
  // REQUIRES quality evidence that A's frame does not have (decided here from the frames alone).
  const DEG = ['hand-too-small', 'hand-rotated', 'too-dark', 'too-bright', 'low-contrast', 'blurry'], BLK = ['palm-not-visible', 'hand-cut-off'];
  const qualityNeed = (f: any): string | null => {
    const r = f.measurements.reasons;
    if (f.measurements.status === 'unavailable') return r.every((x: string) => BLK.includes(x)) ? `B:${r.join(',')}` : null; // non-quality unavailability: geometry-dependent, not asserted
    return `U:${r.filter((x: string) => DEG.includes(x) || x === 'quality-unknown').join(',')}`;
  };
  const qualityHave = (f: any, usable: boolean): string => {
    const iss = f.frame.qualityIssues;
    if (!usable) return `B:${BLK.filter((x) => iss.includes(x)).join(',')}`;
    return BLK.some((x) => iss.includes(x)) ? 'U:<blocked>' : `U:${[...DEG.filter((x) => iss.includes(x)), ...(f.frame.qualityStatus === 'unknown' ? ['quality-unknown'] : [])].join(',')}`;
  };
  for (const [la, A] of BASES) for (const [lb, B] of BASES) {
    if (la === lb) continue;
    const need = qualityNeed(B);
    if (need === null) continue;
    const usable = need.startsWith('U:');
    if (need === qualityHave(A, usable)) continue; // quality-compatible: outcome depends on geometry, not asserted
    if (usable && (!A.frame.available || A.frame.palmFacing === false)) { /* also invalid, but for availability; still asserted */ }
    expectReject('F cross-record quality', `${lb} measurements -> ${la}`, (() => { const c = clone(A); c.measurements = clone(B.measurements); return reprov(c); })());
  }
  // G. geometry / frame inconsistencies via substitutions
  const noFrame = BASES.filter(([, b]) => !b.frame.available), withFrame = BASES.filter(([, b]) => b.frame.available);
  for (const [la, A] of noFrame) for (const [lb, B] of withFrame) {
    for (const id of ALL_LINES) if (B.lines[id].provenance === 'user-confirmed' || (B.lines[id].reason ?? '').startsWith('trace-')) expectReject('G geometry/frame', `${lb} line ${id} -> ${la}`, (() => { const c = clone(A); c.lines[id] = clone(B.lines[id]); return reprov(c); })());
    for (const id of ALL_MARKS) if (B.marks[id].provenance === 'user-reported' && B.marks[id].approximatePalmLocation) expectReject('G geometry/frame', `${lb} mark ${id} -> ${la}`, (() => { const c = clone(A); c.marks[id] = clone(B.marks[id]); return reprov(c); })());
  }
  for (const [lb, B] of noFrame) for (const id of ALL_LINES) if (B.lines[id].reason === 'frame-unavailable') for (const [la, A] of withFrame) expectReject('G geometry/frame', `${lb} line ${id} (frame-unavailable) -> ${la}`, (() => { const c = clone(A); c.lines[id] = clone(B.lines[id]); return reprov(c); })());
  for (const [la, A] of withFrame) for (const id of ALL_LINES) if (A.lines[id].provenance === 'user-confirmed') {
    for (const [tag, pts] of [['crossing', [{ x: 0.3, y: 0.3 }, { x: 0.8, y: 0.45 }, { x: 0.8, y: 0.3 }, { x: 0.3, y: 0.45 }]], ['out of bounds', [{ x: 0.3, y: 0.3 }, { x: 1.5, y: 0.4 }]], ['single point', [{ x: 0.3, y: 0.3 }]], ['65 points', Array.from({ length: 65 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.5 }))]] as Array<[string, P[]]>) {
      expectReject('G geometry/frame', `${la} ${id} ${tag}`, (() => { const c = clone(A); c.lines[id].palmPoints = pts; return c; })());
    }
  }
  const total = Object.values(stats).reduce((a, s) => a + s.n, 0);
  const acc = Object.values(stats).reduce((a, s) => a + s.accepted.length, 0), raw = Object.values(stats).reduce((a, s) => a + s.raw.length, 0);
  console.log(`MUT summary: ${total} mutations (${distinct.size} distinct serialisations); ${acc} accepted; ${raw} raw exceptions; ` + Object.entries(stats).map(([k, v]) => `${k}=${v.n} (accepted ${v.accepted.length})`).join('; '));
  for (const [cat, st] of Object.entries(stats)) check(`MUT ${cat}: ${st.n} mutations, all rejected with typed AdapterErrors`, st.n > 0 && st.accepted.length === 0 && st.raw.length === 0, { accepted: st.accepted.slice(0, 5), raw: st.raw.slice(0, 3) });
}
// Interpretation boundaries
check('IB1. all 21 builder positive controls: every genuine degrading, blocked or unknown-quality record keeps its evidence in the payload and produces no interpretation', POS.every(([l, inp]) => { const f = build(inp); if (f.frame.qualityStatus === 'accepted') return true; const pay = adaptF(f, SYN); return JSON.stringify(pay.capture.quality.issues) === JSON.stringify(f.frame.qualityIssues) && pay.capture.quality.status === f.frame.qualityStatus && engine.generateReading(pay).status !== 'interpreted'; }));
check('IB2. maximum declared confidence (scan 1) never exceeds the tentative ceiling, for every accepted positive control', POS.every(([, inp]) => { const f = build(inp); const pay = adaptF(f, { synthetic: true, scanConfidence: 1 }); const r = engine.generateReading(pay); return pay.creases.items.every((c: any) => c.detection.confidence <= 0.74) && r.sections.flatMap((sec: any) => sec.items ?? []).filter((it: any) => it.kind === 'interpreted').every((it: any) => it.tier === 'tentative'); }));

// ============================================================ CX. Codex review of e20040a: C3 geometry + C3/C4 evidence
// Ported from the independent harness (/private/tmp/palm391-m3.1ZABkEub/head/review-witness.cjs, review-targeted.cjs,
// replay.cjs; fixture values copied, harness not executed). Fixture: 64 x 128 image, offsets around (24, 32).
{
  const cxPoint = ([x, y]: number[]) => ({ x: (24 + x) / 64, y: (32 + y) / 128 });
  const cxRaw: Record<string, number[][]> = { heart: [[10, 2], [7, 2], [3, 1]], head: [[1, 4], [5, 5], [10, 6]], life: [[1, 3], [2, 6], [3, 10]], upward: [[6, 10], [6, 7], [6, 3]] };
  const cxBase: PalmFeatureSetInput = { imageWidth: 64, imageHeight: 128, landmarks: RV_LM, hand: 'left', dominantHand: 'unknown', handednessLabel: 'Left', qualityIssues: [], rotationDeg: 0, lines: Object.keys(cxRaw).map((line) => ({ line: line as any, action: 'traced' as const, points: cxRaw[line].map(cxPoint), confirmed: true })), marks: [] };
  const cx = (over: Partial<PalmFeatureSetInput> = {}) => build({ ...cxBase, ...over });
  const by = (k: number, pt: P) => RV_LM.map((v, i) => (i === k ? { ...pt, z: 0 } : v));
  const SYN1 = { synthetic: true, scanConfidence: 1 };
  const outcome = (f: any) => { try { const out = featureSetAdapter.adaptFeatureSet(f, SYN1); const r = engine.generateReading(out.features); return { code: 'accepted', status: r.status, decline: r.decline?.reason, interpreted: r.sections.flatMap((x: any) => x.items ?? []).filter((i: any) => i.kind === 'interpreted') }; } catch (e: any) { return { code: e instanceof featureSetAdapter.AdapterError ? e.code : `RAW:${e?.message}` }; } };
  const agree = (f: PalmFeatureSet) => (f.frame.reason === 'frame-degenerate') === (f.measurements.status === 'unavailable' && f.measurements.reasons.includes('frame-degenerate' as never)) || f.measurements.reasons.some((r: string) => ['palm-not-visible', 'hand-cut-off'].includes(r));

  // CX-1 exact witness (review-witness.cjs): near-degenerate frame, image 100000 x 100000, all four quality variants.
  const wit = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  wit[5] = { x: 0, y: 0, z: 0 }; wit[17] = { x: 9.257353612035515e-12, y: 1.448415743932128e-11, z: 0 }; wit[0] = { x: 0.33738545681117105, y: 0.5278770023257036, z: 0 };
  const witRes = ([[], null, ['blurry'], ['hand-cut-off']] as Array<PalmFeedbackCode[] | null>).map((q) => { const f = cx({ landmarks: wit, imageWidth: 100000, imageHeight: 100000, handednessLabel: undefined, lines: [], qualityIssues: q }); return { q, frame: f.frame.reason, set: f.measurements.reasons, agree: agree(f), ...outcome(f) }; });
  check('CX-1 (C3). exact Codex witness, accepted / unknown / blurry / hand-cut-off: frame and measurements agree (one geometry) and the adapter accepts every genuine output; nothing is interpreted', witRes.every((r) => r.agree && r.code === 'accepted' && (r.interpreted ?? []).length === 0), witRes);
  // Root cause: the old frame offset (a projection) cancelled to 0, while the true offset 4.04e-12 px exceeds the shared
  // threshold 1e-6 * width = 1.72e-12 px. With ONE geometry both builders now see an AVAILABLE frame and a usable set.
  check('CX-1b. the witness is now an available frame in BOTH builders (frame ok, usable measurement set with its quality evidence); the blocked variant keeps hand-cut-off and reaches quality-not-accepted', witRes.slice(0, 3).every((r) => r.frame === 'ok' && !r.set.includes('frame-degenerate')) && JSON.stringify(witRes[1].set).includes('quality-unknown') && JSON.stringify(witRes[2].set).includes('blurry') && witRes[3].decline === 'quality-not-accepted' && JSON.stringify(witRes[3].set) === '["hand-cut-off"]', witRes);
  // CX-2 bounded near-degenerate generator (review-targeted.cjs loop, same LCG and ranges, 20,000 draws).
  {
    let sd = 1234; const rnd2 = () => { sd = (Math.imul(1664525, sd) + 1013904223) >>> 0; return sd / 4294967296; };
    let n = 0; const fails: any[] = []; const st = { degenerate: 0, available: 0 };
    for (let i = 0; i < 20000 && fails.length < 3; i++) {
      const sc = 0.000000000012, dx = sc * (0.2 + rnd2() * 0.8), dy = sc * (1 + rnd2());
      const wx = 0.15 + 0.25 * rnd2(), wy = wx * (dy / dx);
      if (wy > 1) continue;
      const L = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 })); L[5] = { x: 0, y: 0, z: 0 }; L[17] = { x: dx, y: dy, z: 0 }; L[0] = { x: wx, y: wy, z: 0 };
      const f = cx({ landmarks: L, imageWidth: 100000, imageHeight: 100000, handednessLabel: undefined, lines: [] }); n++;
      st[f.frame.available ? 'available' : 'degenerate']++;
      const o = outcome(f);
      if (!agree(f) || o.code !== 'accepted') fails.push({ dx, dy, wx, wy, frame: f.frame.reason, set: f.measurements.reasons, o: o.code });
    }
    check(`CX-2 (C3). bounded near-degenerate generator: ${n} genuine builder outputs, frame/measurement availability agree and all are accepted`, n > 5000 && fails.length === 0, { n, st, fails });
  }
  // CX-3 geometry thresholds on both sides, with rotation / scale / translation invariance of the classification.
  {
    const res: any[] = [];
    for (const k of [0.5, 0.9, 0.99, 1.01, 1.1, 2]) for (const rot of [0, 33, -71]) for (const scale of [0.05, 0.3]) for (const shift of [0, 0.1]) {
      // knuckles 5 and 17 a palm width w apart; wrist at perpendicular offset k * 1e-6 * w from the knuckle line, far along it
      const w = scale * 0.5, t = (rot * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t), cxx = 0.45 + shift, cyy = 0.5 - shift / 2;
      const R2 = (u: number, v: number) => ({ x: cxx + (u * c - v * sn), y: cyy + (u * sn + v * c), z: 0 });
      const L = Array.from({ length: 21 }, () => R2(w * 0.3, -w * 0.4)); L[5] = R2(0, 0); L[17] = R2(w, 0); L[9] = R2(w / 3, 0); L[0] = R2(w * 0.4, k * 1e-6 * w);
      const f = cx({ landmarks: L, imageWidth: 1000, imageHeight: 1000, handednessLabel: undefined, lines: [] });
      res.push({ k, rot, scale, shift, degenerate: f.frame.reason === 'frame-degenerate', agree: agree(f), code: outcome(f).code });
    }
    const byK = (k: number) => res.filter((r) => r.k === k);
    check('CX-3 (C3). wrist offset at 0.5x..2x the 1e-6 threshold: degenerate below, available above, identical under rotation / scale / translation; builders agree and the adapter accepts every output', [0.5, 0.9, 0.99].every((k) => byK(k).every((r) => r.degenerate)) && [1.01, 1.1, 2].every((k) => byK(k).every((r) => !r.degenerate)) && res.every((r) => r.agree && r.code === 'accepted'), res.filter((r) => !r.agree || r.code !== 'accepted' || (r.k < 1) !== r.degenerate).slice(0, 4));
  }
  const axisWrist = cx({ landmarks: by(0, cxPoint([6, 0.0000012])) });
  check('CX-3b (C3, replay positive revised). wrist on the knuckle axis: BOTH builders now report frame-degenerate (previously frame available + set degenerate); accepted', axisWrist.frame.reason === 'frame-degenerate' && JSON.stringify(axisWrist.measurements.reasons) === '["frame-degenerate"]' && outcome(axisWrist).code === 'accepted');
  const fakeAvail = clone(axisWrist); fakeAvail.frame = clone(cx().frame); for (const id of ALL_LINES) fakeAvail.lines[id] = clone(cx().lines[id]); reprov(fakeAvail);
  check('CX-3c (C3). an available frame paired with a frame-degenerate set is no longer a builder state and is rejected', outcome(fakeAvail).code === 'contradictory-quality', outcome(fakeAvail));

  // CX-4 proportion diagnostics below / at / above both thresholds (review-targeted.cjs values) + forged flips.
  const pts: Array<[number, boolean]> = [[4, true], [22, true], [12, false], [8.3995, true], [8.4005, false], [21.5995, false], [21.6005, true]];
  const bnd = pts.map(([y, exp]) => { const f = cx({ landmarks: by(0, cxPoint([4, y])) }); return { y, exp, pl: f.measurements.measurements.palmLength.value, flagged: f.measurements.reasons.includes('implausible-proportions' as never), code: outcome(f).code, f }; });
  check('CX-4 (C4). genuine proportion diagnostics at y = 4, 22, 12, 8.3995, 8.4005, 21.5995, 21.6005 match the raw thresholds and are all accepted (incl. both sides of 0.700 and 1.800)', bnd.every((b) => b.flagged === b.exp && b.code === 'accepted'), bnd.map(({ f, ...r }) => r));
  const flip = (f: any) => { const g = clone(f); const on = !g.measurements.reasons.includes('implausible-proportions'); const R = on ? [...g.measurements.reasons, 'implausible-proportions'] : g.measurements.reasons.filter((x: string) => x !== 'implausible-proportions'); g.measurements.reasons = R; g.measurements.status = R.length ? 'uncertain' : 'measured'; for (const m of Object.values(g.measurements.measurements) as any[]) if (m.status !== 'unavailable') { m.reasons = R.slice(); m.status = g.measurements.status; } return g; };
  const flips = bnd.map((b) => ({ y: b.y, pl: b.pl, code: outcome(flip(b.f)).code }));
  check('CX-4b (C4). flipping the diagnostic is rejected for 0.333 (missing), 1.833 (missing) and 1.000 (spurious); at exactly 0.700 / 1.800 the flipped record is ALSO builder-possible and is accepted (rounding ambiguity)', flips.every((r) => ((r.pl === 0.7 || r.pl === 1.8) ? r.code === 'accepted' : r.code === 'invalid-measurement')), flips);
  {
    // Fine sweep across both thresholds: generated genuine outputs accepted, flips rejected unless serialized at 0.700 / 1.800.
    const bad: any[] = []; let n = 0;
    for (const [lo, hi] of [[8.39, 8.41], [21.59, 21.61]]) for (let y = lo; y <= hi + 1e-12; y += 0.00025) {
      const f = cx({ landmarks: by(0, cxPoint([4, y])) }); n++;
      const pl = f.measurements.measurements.palmLength.value as number, g = outcome(f).code, fl = outcome(flip(f)).code;
      const ambiguous = pl === 0.7 || pl === 1.8;
      if (g !== 'accepted' || (ambiguous ? fl !== 'accepted' : fl !== 'invalid-measurement')) bad.push({ y, pl, g, fl });
    }
    check(`CX-4c (C4). fine sweep of ${n} genuine outputs across 0.7 and 1.8: all accepted; every flipped diagnostic rejected except at the serialized 0.700 / 1.800 values`, bad.length === 0 && n > 150, bad.slice(0, 4));
  }
  // CX-5 precision and computation-nonfinite.
  const offGrid = clone(cx()); offGrid.measurements.measurements.thumbLength.value += 0.0001;
  check('CX-5 (C4). off-grid measurement value (thumb + 0.0001 -> ' + offGrid.measurements.measurements.thumbLength.value + ') is rejected', outcome(offGrid).code === 'invalid-measurement', outcome(offGrid));
  const grid = MEASUREMENT_IDS.map((id: any) => { const g = clone(cx()); const m = g.measurements.measurements[id]; if (m.value === null) return 'n/a'; m.value = Math.round(m.value * 1000) / 1000 + 0.0004; return outcome(g).code; });
  check('CX-5b. every usable measurement shifted off the 3-decimal grid by 0.0004 is rejected', grid.every((c) => c === 'n/a' || c === 'invalid-measurement'), grid);
  const nfHand = clone(cx()); nfHand.measurements.measurements.handLength = { id: 'handLength', unit: 'palm-width', status: 'unavailable', value: null, reasons: ['computation-nonfinite'] }; reprov(nfHand);
  check('CX-5c (C4). handLength labelled computation-nonfinite despite finite operands is rejected', outcome(nfHand).code === 'invalid-measurement', outcome(nfHand));
  const nfAll = MEASUREMENT_IDS.map((id: any) => { const g = clone(cx()); g.measurements.measurements[id] = { id, unit: id.endsWith('Ratio') ? 'ratio' : 'palm-width', status: 'unavailable', value: null, reasons: ['computation-nonfinite'] }; return outcome(reprov(g)).code; });
  check('CX-5d. computation-nonfinite on any item of an ordinary record (finite operands, ring > 0) is rejected', nfAll.every((c) => c !== 'accepted' && !c.startsWith('RAW')), nfAll);
  const setNF = clone(cx()); setNF.measurements.status = 'unavailable'; setNF.measurements.reasons = ['computation-nonfinite']; for (const m of Object.values(setNF.measurements.measurements) as any[]) Object.assign(m, { status: 'unavailable', value: null, reasons: ['depends-on-unavailable'] }); reprov(setNF);
  check('CX-5e (C3). forged set-level computation-nonfinite is rejected (unreachable under the input contract)', outcome(setNF).code === 'contradictory-quality', outcome(setNF));
  const tinyRing = RV_LM.map((pt, i) => (i === 0 || (i >= 13 && i <= 15) ? { x: 0, y: 0, z: 0 } : i === 16 ? { x: 1e-320, y: 0, z: 0 } : i === 8 ? { x: 1, y: 1, z: 0 } : pt));
  const tr = cx({ landmarks: tinyRing, handednessLabel: undefined, lines: [] });
  check('CX-6. genuine overflow (ring length rounds to 0, index / ring = Infinity): builder emits computation-nonfinite on indexToRingRatio only, and it is accepted', tr.measurements.measurements.ringLength.value === 0 && JSON.stringify(tr.measurements.measurements.indexToRingRatio.reasons) === '["computation-nonfinite"]' && outcome(tr).code === 'accepted', [tr.measurements.status, tr.measurements.measurements.ringLength, tr.measurements.measurements.indexToRingRatio, outcome(tr).code]);
  const nzr = cx({ landmarks: RV_LM.map((v, i) => (i >= 13 && i <= 16 ? { ...cxPoint([2 + (i === 16 ? 0.001 : 0), 12]), z: 0 } : v)) });
  check('CX-6b. valid rounded-zero denominator: ringLength 0.000 with a finite large ratio (' + nzr.measurements.measurements.indexToRingRatio.value + ') is accepted', nzr.measurements.measurements.ringLength.value === 0 && (nzr.measurements.measurements.indexToRingRatio.value as number) > 1000 && outcome(nzr).code === 'accepted');
  const nzrNF = clone(nzr); nzrNF.measurements.measurements.indexToRingRatio = { id: 'indexToRingRatio', unit: 'ratio', status: 'unavailable', value: null, reasons: ['computation-nonfinite'] }; reprov(nzrNF);
  check('CX-6c (documented limitation). with ringLength serialized as 0 the record cannot show whether index / ring overflowed, so computation-nonfinite is accepted there too', outcome(nzrNF).code === 'accepted');
  // CX-7 quality: all 255 non-empty issue subsets preserve evidence, reach quality-not-accepted, zero interpretations, record unchanged.
  {
    const codes: PalmFeedbackCode[] = ['hand-too-small', 'hand-rotated', 'too-dark', 'too-bright', 'low-contrast', 'blurry', 'palm-not-visible', 'hand-cut-off'];
    const bad: any[] = [];
    for (let mask = 1; mask < 256; mask++) {
      const issues = codes.filter((_, i) => mask & (1 << i)).reverse();
      const f = cx({ qualityIssues: issues }); const before = JSON.stringify(f);
      const out = featureSetAdapter.adaptFeatureSet(f, SYN1); const r = engine.generateReading(out.features);
      const ok = JSON.stringify(out.features.capture.quality) === JSON.stringify({ status: 'needs-retake', issues }) && r.decline?.reason === 'quality-not-accepted' && r.sections.flatMap((x: any) => x.items ?? []).filter((i: any) => i.kind === 'interpreted').length === 0 && JSON.stringify(f) === before;
      if (!ok) bad.push(issues);
    }
    check('CX-7. all 255 non-empty quality-issue subsets: evidence preserved, quality-not-accepted, zero interpretations, record unchanged', bad.length === 0, bad.slice(0, 3));
  }
  const nullQ = [null, undefined].map((q) => { const f = cx({ qualityIssues: q }); const out = featureSetAdapter.adaptFeatureSet(f, SYN1); const r = engine.generateReading(out.features); return out.features.capture.quality.status === 'unknown' && r.decline?.reason === 'quality-not-accepted'; });
  check('CX-7b. null and omitted quality feedback: unknown status preserved, quality-not-accepted', nullQ.every(Boolean));
  // CX-8 replay of the 28 original independent probes (replay.cjs): all rejected with a typed AdapterError before any payload.
  {
    const rec2 = (over: Partial<PalmFeatureSetInput> = {}) => clone(cx(over));
    const blockedR = () => rec2({ qualityIssues: ['hand-cut-off'] }), unknownR = () => rec2({ qualityIssues: null }), degradedR = () => rec2({ qualityIssues: ['blurry'] }), framelessR = () => rec2({ landmarks: null });
    const splice2 = (fr: () => any, ms: () => any) => { const x = fr(); x.measurements = ms().measurements; return reprov(x); };
    const cases: Array<[string, string[], (x: any) => any]> = [
      ['legacy accepted plus blocking issue', ['contradictory-quality'], (x) => { x.frame.qualityIssues = ['hand-cut-off']; }],
      ['accepted plus blocked measurement set', ['contradictory-quality'], () => splice2(rec2, blockedR)],
      ['accepted plus unknown measurement set', ['contradictory-quality'], () => splice2(rec2, unknownR)],
      ['unknown frame plus clean set', ['contradictory-quality'], () => splice2(unknownR, rec2)],
      ['blocked frame plus clean set', ['contradictory-quality'], () => splice2(blockedR, rec2)],
      ['degraded frame plus clean set', ['contradictory-quality'], () => splice2(degradedR, rec2)],
      ['clean frame plus degrading measurement set', ['contradictory-quality'], () => splice2(rec2, degradedR)],
      ['unavailable frame plus measured set', ['contradictory-quality'], () => splice2(framelessR, rec2)],
      ['available frame plus invalid landmark measurement set', ['contradictory-quality'], () => splice2(rec2, framelessR)],
      ['not facing plus measured set', ['contradictory-quality'], (x) => { x.frame.palmFacing = false; }],
      ['undecided facing plus measured set', ['contradictory-quality'], (x) => { x.frame.palmFacing = null; }],
      ['unassessed mark with placement', ['invalid-mark'], (x) => { x.marks.vedi.approximatePalmLocation = { x: 0.4, y: 0.4 }; }],
      ['missing frame reason', ['invalid-frame'], (x) => { delete x.frame.reason; }],
      ['inconsistent frame reason', ['invalid-frame'], (x) => { x.frame.reason = 'landmarks-invalid'; }],
      ['partial identity', ['invalid-line'], (x) => { delete x.lines.heart.identity.indian; }],
      ['contradictory identity', ['invalid-line'], (x) => { x.lines.heart.identity.indianId = 'pitrlekha'; }],
      ['inherited frame fields', ['invalid-input'], (x) => { x.frame = Object.create(x.frame); }],
      ['sparse trace', ['sparse-array'], (x) => { delete x.lines.heart.palmPoints[1]; }],
      ['extra field', ['invalid-feature-set'], (x) => { x.extra = true; }],
      ['per-item quality unknown on accepted clean frame', ['contradictory-quality'], (x) => { x.measurements.measurements.palmLength = unknownR().measurements.measurements.palmLength; }],
      ['per-item blurry reason on accepted clean frame', ['contradictory-quality'], (x) => { x.measurements.measurements.palmLength = degradedR().measurements.measurements.palmLength; }],
      ['per-item facing unknown on known facing frame', ['contradictory-quality'], (x) => { x.measurements.measurements.palmLength = rec2({ handednessLabel: undefined }).measurements.measurements.palmLength; }],
      ['missing degrading reason on usable item', ['invalid-measurement', 'contradictory-quality'], () => { const x = degradedR(); x.measurements.measurements.palmLength.reasons = ['implausible-proportions']; return x; }],
      ['ratio usable despite unavailable ring input', ['invalid-measurement'], (x) => { x.measurements.measurements.ringLength = rec2({ landmarks: by(16, cxPoint([9, -1])) }).measurements.measurements.ringLength; return reprov(x); }],
      ['unavailable frame with reported mark placement', ['invalid-mark'], () => { const x = framelessR(); x.marks.vedi = { mark: 'vedi', provenance: 'user-reported', approximatePalmLocation: { x: 0.4, y: 0.4 } }; return reprov(x); }],
      ['available frame with line reason frame-unavailable', ['invalid-line'], (x) => { x.lines.heart = { line: 'heart', identity: x.lines.heart.identity, provenance: 'unassessed', confirmation: 'confirmed', reason: 'frame-unavailable' }; return reprov(x); }],
      ['line reason array coerced to string', ['invalid-line'], () => { const x = rec2({ lines: [] }); x.lines.heart.reason = ['not-requested']; return x; }],
      ['extra field on quality array', ['invalid-input'], (x) => { x.frame.qualityIssues.note = 'hand-cut-off'; }],
    ];
    const res = cases.map(([label, codes, fn]) => { const root = rec2(); const x = fn(root) ?? root; const o = outcome(x); return { label, code: o.code, ok: codes.includes(o.code) }; });
    check(`CX-8. replay of the ${cases.length} original independent probes: all rejected with the expected typed AdapterError before any payload`, cases.length === 28 && res.every((r) => r.ok), res.filter((r) => !r.ok));
  }
  // CX-9 replay positives: blocked/unknown gate, folded + tentative, degraders, marks, confirmed unusable trace, wrong facing.
  const gate = ([null, undefined, ['palm-not-visible'], ['hand-cut-off'], ['hand-cut-off', 'blurry']] as any[]).map((q) => outcome(cx({ qualityIssues: q })));
  const fold = cx({ landmarks: by(16, cxPoint([9, -1])) }); const fo = outcome(fold);
  const degr = (['hand-too-small', 'hand-rotated', 'too-dark', 'too-bright', 'low-contrast', 'blurry'] as PalmFeedbackCode[]).map((iss) => { const f = cx({ qualityIssues: [iss] }); return f.measurements.status === 'uncertain' && Object.values(f.measurements.measurements).every((v: any) => v.value !== null && v.status === 'uncertain' && v.reasons.includes(iss)) && outcome(f).decline === 'quality-not-accepted'; });
  const obs = cx({ lines: [{ line: 'heart', action: 'traced', points: [cxPoint([0, 0]), cxPoint([0, 0])], confirmed: true }], marks: [{ mark: 'yava', action: 'reported', approximateLocation: cxPoint([6, 6]) }, { mark: 'matsya', action: 'reported' }, { mark: 'shankha', action: 'skipped' }, { mark: 'chatra', action: 'reported', approximateLocation: { x: 2, y: 0 } }] });
  const misc = cx({ handednessLabel: 'Right' });
  const markVariants = [RV_LM, null].map((L) => outcome(cx({ landmarks: L, marks: [{ mark: 'yava', action: 'reported', approximateLocation: cxPoint([6, 6]) }, { mark: 'matsya', action: 'reported', approximateLocation: { x: 0, y: 0 } }, { mark: 'shankha', action: 'reported', approximateLocation: { x: 2, y: 0 } }] })).code);
  check('CX-9. replay positives: blocked/unknown reach quality-not-accepted; folded ring interprets (tentative only); each degrader keeps per-item evidence and is declined; confirmed unusable trace + mark variants (with and without frame) + wrong facing all accepted', gate.every((g) => g.decline === 'quality-not-accepted' && (g.interpreted ?? []).length === 0) && fo.status === 'interpreted' && (fo.interpreted ?? []).length > 0 && (fo.interpreted ?? []).every((i: any) => i.tier === 'tentative') && degr.every(Boolean) && obs.lines.heart.provenance === 'unassessed' && obs.lines.heart.confirmation === 'confirmed' && outcome(obs).code === 'accepted' && featureSetAdapter.adaptFeatureSet(obs, SYN1).notMapped.filter((m: any) => m.feature.startsWith('mark:')).map((m: any) => m.feature).join() === 'mark:yava,mark:matsya' && misc.frame.palmFacing === false && JSON.stringify(misc.measurements.reasons) === '["palm-not-facing"]' && outcome(misc).code === 'accepted' && markVariants.every((c) => c === 'accepted'), { gate, fo: fo.status, degr, mv: markVariants });
  check('CX-9b. synthetic-only enforcement intact: synthetic:false is refused', (() => { try { featureSetAdapter.adaptFeatureSet(fold, { synthetic: false, scanConfidence: 1 }); return false; } catch (e: any) { return e.code === 'synthetic-required'; } })());
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
