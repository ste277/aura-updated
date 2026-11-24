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
import { buildPalmFeatureSet, palmFrameFromLandmarks, imageToPalm, ALL_LINES, ALL_MARKS, PALM_LINE_IDENTITY, type LineInput, type MarkInput, type PalmFeatureSet, type PalmFeatureSetInput } from '../apps/web/lib/palm-analysis/features';
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
const onlyHeart = engine.generateReading(featureSetAdapter.toEngineFeaturesFromFeatureSet(build(featureInput(POSE, { lines: tracedLines(POSE, ['heart']) })), SYN));
check('H9. only the heart line traced: head and life are not observed, heart is ok', obs.call(null, 'DTC') && onlyHeart.observations.find((o: any) => o.crease === 'DTC').status === 'ok' && ['PTC', 'TC'].every((c) => onlyHeart.observations.find((o: any) => o.crease === c).status === 'not-observed'));
const nothing = engine.generateReading(featureSetAdapter.toEngineFeaturesFromFeatureSet(build(featureInput(POSE, { lines: [] })), SYN));
check('H10. nothing traced: the engine declines rather than inventing a reading', nothing.status !== 'interpreted', nothing.status);
const lowScan = engine.generateReading(featureSetAdapter.toEngineFeaturesFromFeatureSet(fsFull, { synthetic: true, scanConfidence: 0.3 }));
check('H11. scan confidence below the engine minimum (0.40) declines the whole reading', lowScan.status !== 'interpreted', lowScan.status);
const blurry = build(featureInput(POSE, { qualityIssues: ['blurry'] }));
const blurryReading = engine.generateReading(featureSetAdapter.toEngineFeaturesFromFeatureSet(blurry, SYN));
check('H12. a G5 quality issue is forwarded unaltered and the engine applies its own frame rules', featureSetAdapter.toEngineFeaturesFromFeatureSet(blurry, SYN).capture.quality.status === 'needs-retake' && blurryReading.status !== 'interpreted', blurryReading.status);
const upward = build(featureInput(POSE, { lines: tracedLines(POSE, ['heart', 'head', 'life', 'upward']) }));
const upwardReading = engine.generateReading(featureSetAdapter.toEngineFeaturesFromFeatureSet(upward, SYN));
check('H13. a traced upward line reaches the engine only as a geometry-identified hypothesis (MINOR)', featureSetAdapter.toEngineFeaturesFromFeatureSet(upward, SYN).creases.items.some((c: any) => c.id === 'trace-upward' && c.identity.anatomicalClass === 'MINOR') && upwardReading.observations.find((o: any) => o.crease === 'CENTRAL_LONGITUDINAL').evidenceScore <= 0.74);
// A self-crossing trace is structurally fine in the feature set, but the engine geometry rules reject it.
const zigzag = [{ x: 0.3, y: 0.3 }, { x: 0.8, y: 0.45 }, { x: 0.8, y: 0.3 }, { x: 0.3, y: 0.45 }].map((p) => toNorm(p, POSE));
const zz = build(featureInput(POSE, { lines: [...tracedLines(POSE, ['heart', 'life']), { line: 'head', action: 'traced', points: zigzag, confirmed: true }] }));
const zzAdapted = featureSetAdapter.adaptFeatureSet(zz, SYN);
check('H14. a self-crossing trace is declined by the adapter with the engine reason; the other lines still read', zzAdapted.declined.some((d: any) => d.line === 'head' && /^geometry-/.test(d.reason)) && engine.validateFeatures(zzAdapted.features).ok && engine.generateReading(zzAdapted.features).status === 'interpreted');
const refuse = (fn: () => unknown, code: string) => { try { fn(); return false; } catch (e: any) { return e?.code === code; } };
check('H15. the adapter refuses without an explicit synthetic declaration (no real-input path)', refuse(() => featureSetAdapter.adaptFeatureSet(fsFull, { scanConfidence: 0.9 }), 'synthetic-required') && refuse(() => featureSetAdapter.adaptFeatureSet(fsFull, null), 'synthetic-required'));
check('H16. the adapter refuses an unknown feature-set version and an unconfirmed "assessed" line', refuse(() => featureSetAdapter.adaptFeatureSet({ ...fsFull, version: 'x' }, SYN), 'unsupported-feature-set') && refuse(() => featureSetAdapter.adaptFeatureSet({ ...fsFull, lines: { ...fsFull.lines, heart: { ...fsFull.lines.heart, confirmation: 'pending' } } }, SYN), 'invalid-line'));
check('H17. left and right hands produce the same engine creases (mirror consistency end to end)', JSON.stringify(featureSetAdapter.toEngineFeaturesFromFeatureSet(fsBase, SYN).creases) === JSON.stringify(featureSetAdapter.toEngineFeaturesFromFeatureSet(fsLeft, SYN).creases));
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
