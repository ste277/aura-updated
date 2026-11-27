/**
 * AURA-PALM-04-I1 -- the in-memory construction context (construction.ts, session.ts) and the headless
 * assisted-tracing model (tracing.ts). Synthetic frames, landmarks and traces only; the detector is a test double.
 *
 *   A. construction context: copies, frozen, opaque, revocable
 *   B. session lifecycle: created only for one analysed hand; revoked on reset, photo replacement, cancellation
 *      (superseded / retry / failed analysis) and teardown; never in the session state or result
 *   C. tracing state transitions; incomplete, skipped and invalid traces
 *   D. I1 parity over the complete independent 6,548-trace corpus (all four lines) + measurement parity
 *   E. privacy and release exclusion
 *
 *   npx ts-node test/palm04I1Tracing.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { analyzePalmFrame, analyzePalmFrameWithDetection } from '../apps/web/lib/palm-analysis/analyze';
import { createConstructionContext, PALM_CONSTRUCTION_CONTEXT_VERSION, type PalmConstructionData } from '../apps/web/lib/palm-analysis/construction';
import { buildPalmFeatureSet, TRACE_LIMITS, type PalmFeatureSetInput, type PalmLineId } from '../apps/web/lib/palm-analysis/features';
import { normalizeDrawableFrame } from '../apps/web/lib/palm-analysis/normalize';
import { createPalmAnalysisSession, type PalmSessionState } from '../apps/web/lib/palm-analysis/session';
import { createTracingModel, TracingError, TRACING_LINES, MAX_TRACE_INPUT_POINTS } from '../apps/web/lib/palm-analysis/tracing';
import { PalmPipelineError, type PalmFrame, type PalmHandDetection, type PalmHandDetector } from '../apps/web/lib/palm-analysis/types';
import { blobOf, makeFakeCanvas, makeHand, makePixels, makePng } from './palmG5I1Fixtures';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; console.log(`OK   ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}`}`); }
}
const throwsCode = (f: () => unknown, code: string) => { try { f(); return false; } catch (e: any) { return e instanceof TracingError && e.code === code; } };

// ---------------------------------------------------------------- synthetic hand (same hand as the I1/E1 suites)
const XY = [[2, 12], [-3, 10], [-5, 7], [-7, 4], [-9, 2], [0, 0], [-1, -5], [-2, -8], [-3, -12], [4, 0], [4, -5], [4, -9], [4, -13], [8, 0], [9, -5], [9, -8], [9, -11], [12, 0], [13, -4], [13, -7], [13, -10]];
const P0 = (x: number, y: number) => ({ x: (24 + x) / 64, y: (32 + y) / 128 });
const LM = XY.map(([x, y]) => P0(x, y));
const p = (x: number, y: number) => P0(12 * x, 12 * y);
const DATA = (over: Partial<PalmConstructionData> = {}): PalmConstructionData => ({ imageWidth: 64, imageHeight: 128, landmarks: LM.map((q) => ({ ...q })), handednessLabel: 'Left', rotationDeg: 0, qualityIssues: [], ...over });
const ctxOf = (data = DATA()) => createConstructionContext(data, 1, () => true)!;

async function run() {
  // ============================================================ A. construction context
  {
    const src = DATA();
    const made = ctxOf(src);
    const a = made.context.read()!, b = made.context.read()!;
    check('A1. read() returns the data (21 landmarks, size, label, rotation, quality)', a.landmarks.length === 21 && a.imageWidth === 64 && a.imageHeight === 128 && a.handednessLabel === 'Left' && a.rotationDeg === 0 && a.qualityIssues.length === 0);
    check('A2. each read() is a fresh, deep-frozen copy (no shared reference to the stored data)', a !== b && a.landmarks !== b.landmarks && Object.isFrozen(a) && Object.isFrozen(a.landmarks) && Object.isFrozen(a.landmarks[0]) && Object.isFrozen(a.qualityIssues));
    (src.landmarks as any)[0] = { x: 0.99, y: 0.99 };
    check('A3. the context copied its input: later changes to the source do not reach it', made.context.read()!.landmarks[0].x === LM[0].x);
    check('A4. the handle is opaque: JSON reveals only { kind, generation, active }', JSON.stringify(made.context) === JSON.stringify({ kind: PALM_CONSTRUCTION_CONTEXT_VERSION, generation: 1, active: true }) && Object.keys(made.context).every((k) => ['generation', 'isActive', 'read', 'toJSON'].includes(k)));
    made.revoke();
    check('A5. after revoke: inactive, read() is null, JSON says inactive and still carries no data', !made.context.isActive() && made.context.read() === null && JSON.stringify(made.context) === JSON.stringify({ kind: PALM_CONSTRUCTION_CONTEXT_VERSION, generation: 1, active: false }));
    let current = true;
    const tied = createConstructionContext(DATA(), 2, () => current)!;
    current = false;
    check('A6. validity is also tied to the owner (isCurrent false -> inactive, read null)', !tied.context.isActive() && tied.context.read() === null);
    check('A7. incomplete or malformed hands give no context', [DATA({ landmarks: LM.slice(0, 20) }), DATA({ landmarks: [...LM.slice(0, 20), { x: NaN, y: 0.5 }] }), DATA({ imageWidth: 0 }), DATA({ imageHeight: Infinity })].every((d) => createConstructionContext(d, 1, () => true) === null));
  }

  // ============================================================ B. session lifecycle
  const W = 640, H = 480;
  const env = (decodeDelay?: Promise<void>) => ({
    createCanvas: (w: number, h: number) => makeFakeCanvas(w, h, (ww: number, hh: number) => makePixels(ww, hh, 'textured')) as any,
    decode: async () => { if (decodeDelay) await decodeDelay; return { width: 1600, height: 1200, source: {}, close() {} }; },
  });
  const pngFile = () => blobOf(makePng(400, 300), 'image/png', 'p.png') as any;
  const yieldNow = () => Promise.resolve();
  const handOf = (opts: Parameters<typeof makeHand>[0] = {}, label = 'Left'): PalmHandDetection => ({ landmarks: makeHand(opts), handednessLabel: label, handednessScore: 0.98 });
  const detector = (seq: PalmHandDetection[][]): PalmHandDetector & { calls: number } => {
    const d = { calls: 0, detect: () => seq[Math.min(d.calls++, seq.length - 1)], close: () => {} };
    return d;
  };
  const allStates: PalmSessionState[] = [];
  const watch = (s: { subscribe: (l: (x: PalmSessionState) => void) => () => void }) => s.subscribe((x) => allStates.push(x));
  {
    const f: PalmFrame = normalizeDrawableFrame({}, W, H, 'upload', { createCanvas: (w, h) => makeFakeCanvas(w, h, (ww, hh) => makePixels(ww, hh, 'textured')) as any });
    const one = handOf();
    const withDet = analyzePalmFrameWithDetection(f, { detect: () => [one], close() {} });
    check('B0. analyzePalmFrame is unchanged: it equals the result half of analyzePalmFrameWithDetection', JSON.stringify(analyzePalmFrame(f, { detect: () => [one], close() {} }).status) === JSON.stringify(withDet.result.status) && withDet.hand === one && !('landmarks' in withDet.result) && !JSON.stringify(withDet.result).includes('landmarks'));
    check('B0b. no hand / two hands -> no detection is handed out', analyzePalmFrameWithDetection(f, { detect: () => [], close() {} }).hand === null && analyzePalmFrameWithDetection(f, { detect: () => [one, one], close() {} }).hand === null);
  }
  {
    const s = createPalmAnalysisSession({ detectorFactory: async () => detector([[handOf()], [handOf({ dx: 0.02 })]]), normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    watch(s);
    check('B1. no context before any analysis', s.getConstructionContext() === null);
    await s.submitFile(pngFile());
    const c1 = s.getConstructionContext();
    const d1x = c1?.read();
    check('B2. one analysed hand -> an active context with that hand (21 landmarks, frame size, label, rotation, quality codes)', !!c1 && c1.isActive() && !!d1x && d1x.landmarks.length === 21 && d1x.imageWidth === s.getState().frame!.width && d1x.imageHeight === s.getState().frame!.height && d1x.handednessLabel === 'Left' && d1x.rotationDeg === s.getState().result!.metrics!.rotationDeg && JSON.stringify(d1x.qualityIssues) === JSON.stringify(s.getState().result!.issues.map((i) => i.code)));
    check('B3. the session state and the analysis result stay landmark-free', !JSON.stringify(s.getState().result).includes('landmarks') && !('construction' in s.getState()) && !JSON.stringify({ ...s.getState(), frame: null }).includes(String(d1x!.landmarks[5].x)));
    const m1 = createTracingModel(c1!);
    m1.start('heart'); m1.addPoint('heart', p(0.9, 0.2));
    // photo replacement
    await s.submitFile(pngFile());
    const c2 = s.getConstructionContext();
    check('B4. photo replacement revokes the previous context (inactive, read null)', !c1!.isActive() && c1!.read() === null);
    check('B5. the replacement photo gets its own new context with its own hand', !!c2 && c2 !== c1 && c2.isActive() && c2.read()!.landmarks[5].x !== d1x!.landmarks[5].x);
    check('B6. no stale reuse: the old tracing model refuses every operation after replacement', throwsCode(() => m1.lines(), 'context-cleared') && throwsCode(() => m1.addPoint('heart', p(0.5, 0.2)), 'context-cleared') && throwsCode(() => m1.toFeatureSetInput({ hand: 'left', dominantHand: 'unknown' }), 'context-cleared') && !m1.isActive());
    check('B7. ... and a revoked context cannot start a new model', throwsCode(() => createTracingModel(c1!), 'context-cleared'));
    // reset
    s.clear();
    check('B8. reset (clear) revokes the context', !c2!.isActive() && c2!.read() === null && s.getConstructionContext() === null);
    // teardown
    await s.submitFile(pngFile());
    const c3 = s.getConstructionContext();
    s.dispose();
    check('B9. teardown (dispose) revokes the context', !!c3 && !c3.isActive() && c3.read() === null && s.getConstructionContext() === null);
  }
  {
    // cancellation: the first photo is still decoding when the second is chosen
    const gate: { open?: () => void } = {};
    const slow = new Promise<void>((r) => { gate.open = r; });
    let decodes = 0;
    const s = createPalmAnalysisSession({
      detectorFactory: async () => detector([[handOf({ dx: 0.03 })]]),
      normalizeEnv: { createCanvas: (w: number, h: number) => makeFakeCanvas(w, h, (ww: number, hh: number) => makePixels(ww, hh, 'textured')) as any, decode: async () => { decodes++; if (decodes === 1) await slow; return { width: 1600, height: 1200, source: {}, close() {} }; } },
      isEnabled: () => true, yieldToUi: yieldNow,
    });
    watch(s);
    const first = s.submitFile(pngFile());
    await new Promise((r) => setTimeout(r, 0));
    await s.submitFile(pngFile());
    const latest = s.getConstructionContext();
    gate.open!();
    await first;
    check('B10. cancellation: a superseded photo never yields a context; only the latest photo\'s context exists', !!latest && latest.isActive() && s.getConstructionContext() === latest && latest.generation === s.getState().generation);
    s.dispose();
  }
  {
    // retry after a failure, and a failed analysis
    let attempts = 0;
    const det = detector([[handOf()]]);
    const s = createPalmAnalysisSession({ detectorFactory: async () => { attempts++; if (attempts === 1) throw new PalmPipelineError('model-unavailable'); return det; }, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    watch(s);
    await s.submitFile(pngFile());
    check('B11. a failed analysis (model unavailable) gives no context', s.getState().phase === 'error' && s.getConstructionContext() === null);
    await s.retry();
    const c = s.getConstructionContext();
    check('B12. retry builds a fresh context for the new generation', !!c && c.isActive() && c.generation === s.getState().generation);
    s.dispose();
  }
  {
    const failing = { detect: () => [{ landmarks: makeHand().slice(0, 5) }], close() {} };
    const s = createPalmAnalysisSession({ detectorFactory: async () => failing as any, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    watch(s);
    await s.submitFile(pngFile());
    check('B13. an analysis that throws (incomplete landmarks) gives no context', s.getState().phase === 'error' && s.getConstructionContext() === null);
    s.dispose();
  }
  {
    const s0 = createPalmAnalysisSession({ detectorFactory: async () => detector([[]]), normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    const s2 = createPalmAnalysisSession({ detectorFactory: async () => detector([[handOf(), handOf({ dx: 0.2 })]]), normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    await s0.submitFile(pngFile()); await s2.submitFile(pngFile());
    check('B14. no hand / two hands -> no context', s0.getState().result?.status === 'no-hand' && s0.getConstructionContext() === null && s2.getState().result?.status === 'multiple-hands' && s2.getConstructionContext() === null);
    s0.dispose(); s2.dispose();
  }
  {
    const s = createPalmAnalysisSession({ detectorFactory: async () => detector([[handOf()]]), normalizeEnv: env(), isEnabled: () => false, yieldToUi: yieldNow });
    await s.submitFile(pngFile());
    check('B15. with the development gate closed, no analysis and no context', s.getState().error?.code === 'feature-disabled' && s.getConstructionContext() === null);
    s.dispose();
  }
  check('B16. across every state emitted in section B, no state ever carried landmarks or a context', allStates.length > 10 && allStates.every((x) => !('construction' in x) && !JSON.stringify({ ...x, frame: null }).includes('landmarks')));

  // ============================================================ C. tracing state transitions
  const heart = [p(0.95, 0.22), p(0.5, 0.2), p(0.1667, 0.15)];
  {
    const m = createTracingModel(ctxOf().context);
    check('C1. every line starts not-started, in the approved order (heart, head, life, upward)', JSON.stringify(m.lines().map((l) => [l.line, l.status])) === JSON.stringify(TRACING_LINES.map((l) => [l, 'not-started'])) && JSON.stringify(TRACING_LINES) === JSON.stringify(['heart', 'head', 'life', 'upward']));
    check('C2. editing requires start(): addPoint on a not-started line -> invalid-state', throwsCode(() => m.addPoint('heart', heart[0]), 'invalid-state'));
    check('C3. start -> tracing, no points; I1 says too few points', (() => { const v = m.start('heart'); return v.status === 'tracing' && v.points.length === 0 && v.placement?.ok === false && (v.placement as any).reason === 'trace-too-few-points'; })());
    m.addPoint('heart', heart[0]);
    check('C4. one point: still too few (I1)', (m.line('heart').placement as any).reason === 'trace-too-few-points');
    m.addPoint('heart', heart[1]); m.addPoint('heart', heart[2]);
    check('C5. three good points: I1 places the trace', m.line('heart').placement?.ok === true && m.line('heart').points.length === 3);
    m.movePoint('heart', 2, p(0.5005, 0.2));
    check('C6. move a point so the trace doubles back -> I1 reason, confirm refused with that reason, state unchanged', (() => { const r = m.confirm('heart'); return !r.ok && r.reason === (m.line('heart').placement as any).reason && /^trace-/.test(r.reason) && m.line('heart').status === 'tracing'; })());
    check('C7. undo restores the previous point; the trace is placeable again', m.undo() && m.line('heart').placement?.ok === true);
    check('C8. confirm a placeable trace -> confirmed', (() => { const r = m.confirm('heart'); return r.ok && r.line.status === 'confirmed'; })());
    check('C9. a confirmed line cannot be edited until start() reopens it (trace kept)', throwsCode(() => m.addPoint('heart', heart[0]), 'invalid-state') && m.start('heart').status === 'tracing' && m.line('heart').points.length === 3);
    m.deletePoint('heart', 0);
    check('C10. delete a point (2 left) -> still placeable; index checks enforced', m.line('heart').points.length === 2 && throwsCode(() => m.deletePoint('heart', 5), 'invalid-index') && throwsCode(() => m.movePoint('heart', -1, heart[0]), 'invalid-index'));
    check('C11. invalid points are refused (non-finite, missing coordinates)', throwsCode(() => m.addPoint('heart', { x: NaN, y: 0.2 }), 'invalid-point') && throwsCode(() => m.addPoint('heart', { x: 0.2 } as any), 'invalid-point') && throwsCode(() => m.addPoint('heart', null as any), 'invalid-point'));
    check('C12. skip with a reason -> skipped, trace cleared; invalid reason refused', m.skip('head', 'user-cannot-see').status === 'skipped' && m.line('head').skipReason === 'user-cannot-see' && m.line('head').points.length === 0 && throwsCode(() => m.skip('life', 'nope' as any), 'invalid-option'));
    check('C13. skipping a line that was being traced discards its points', (() => { m.start('life'); m.setTrace('life', [p(0.1, 0.4), p(0.2, 0.7), p(0.3, 0.95)]); m.skip('life', 'user-skipped'); return m.line('life').points.length === 0 && m.line('life').status === 'skipped'; })());
    check('C14. undo of a skip restores the trace and the tracing state', m.undo() && m.line('life').status === 'tracing' && m.line('life').points.length === 3);
    check('C15. reset -> not-started, cleared', m.reset('life').status === 'not-started' && m.line('life').points.length === 0);
    check('C16. unknown line refused', throwsCode(() => m.start('fate' as PalmLineId), 'unknown-line'));
    check('C17. input caps: more than MAX_TRACE_INPUT_POINTS refused (memory bound); I1 itself refuses more than its own limit', (() => { m.start('upward'); const many = Array.from({ length: TRACE_LIMITS.maxPoints + 1 }, (_, i) => p(0.1 + i * 0.01, 0.4)); m.setTrace('upward', many); return (m.line('upward').placement as any).reason === 'trace-too-many-points' && throwsCode(() => m.setTrace('upward', new Array(MAX_TRACE_INPUT_POINTS + 1).fill(p(0.5, 0.5))), 'too-many-points'); })());
    check('C18. returned views are copies (mutating them changes nothing)', (() => { const v: any = m.line('heart'); try { v.points.push(1); } catch { /* frozen */ } return m.line('heart').points.length === 2 && Object.isFrozen(v); })());
    // feature-set input from every kind of line state
    m.reset('upward');
    const input = m.toFeatureSetInput({ hand: 'left', dominantHand: 'right' });
    const fs1 = buildPalmFeatureSet(input);
    check('C19. toFeatureSetInput: tracing (unconfirmed) -> I1 not-confirmed; skipped -> its reason; not started -> not-requested; marks deferred -> all not-requested', fs1.ok && fs1.featureSet.lines.heart.provenance === 'unassessed' && (fs1.featureSet.lines.heart as any).reason === 'not-confirmed' && (fs1.featureSet.lines.head as any).reason === 'user-cannot-see' && (fs1.featureSet.lines.life as any).reason === 'not-requested' && (fs1.featureSet.lines.upward as any).reason === 'not-requested' && input.marks.length === 0 && Object.values(fs1.featureSet.marks).every((mk: any) => mk.provenance === 'unassessed' && mk.reason === 'not-requested'), fs1);
    check('C20. toFeatureSetInput carries the hand choice and the context data, and nothing else', input.hand === 'left' && input.dominantHand === 'right' && input.imageWidth === 64 && input.landmarks!.length === 21 && JSON.stringify(Object.keys(input).sort()) === JSON.stringify(['dominantHand', 'hand', 'handednessLabel', 'imageHeight', 'imageWidth', 'landmarks', 'lines', 'marks', 'qualityIssues', 'rotationDeg']));
    check('C21. invalid hand options refused', throwsCode(() => m.toFeatureSetInput({ hand: 'both' as any, dominantHand: 'unknown' }), 'invalid-option') && throwsCode(() => m.toFeatureSetInput({ hand: 'left', dominantHand: 'x' as any }), 'invalid-option'));
    m.start('heart'); m.setTrace('heart', heart); m.confirm('heart');
    const bf = m.buildFeatureSet({ hand: 'left', dominantHand: 'unknown' });
    check('C22. buildFeatureSet = buildPalmFeatureSet(toFeatureSetInput) (confirmed heart is user-confirmed)', bf.ok && bf.featureSet.lines.heart.provenance === 'user-confirmed' && JSON.stringify(bf) === JSON.stringify(buildPalmFeatureSet(m.toFeatureSetInput({ hand: 'left', dominantHand: 'unknown' }))));
    const g = m.guides();
    check('C23. guides: finger-base knuckles and wrist in normalised image coordinates (= the context landmarks), nothing else', g.image.index.x === LM[5].x && g.image.middle.x === LM[9].x && g.image.ring.y === LM[13].y && g.image.little.y === LM[17].y && g.image.wrist.x === LM[0].x && JSON.stringify(Object.keys(g)) === '["image"]' && Object.isFrozen(g.image));
    const noFrame = createTracingModel(ctxOf(DATA({ landmarks: LM.map((q, k) => (k === 17 ? LM[5] : q)) })).context);
    noFrame.start('heart'); noFrame.setTrace('heart', heart);
    check('C24. a hand without a usable palm frame: I1 says frame-unavailable for every trace', (noFrame.line('heart').placement as any).reason === 'frame-unavailable' && !noFrame.confirm('heart').ok);
  }

  // ============================================================ D. parity with I1
  // The independent R5 verifier's corpus (independent.cjs), reproduced exactly: hand-picked edge traces, the
  // trace-length boundary grid, and 6,500 seeded random traces (seed 66239, LCG 1664525 / 1013904223).
  let seed = 66239;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const good = [p(0.95, 0.22), p(0.5, 0.2), p(0.1667, 0.15)];
  // eslint-disable-next-line no-sparse-arrays
  const corpus: unknown[][] = [[], [p(0.3, 0.1)], good, [p(-0.2, 0), p(1.2, 0.2)], [p(-0.2001, 0), p(0.5, 0.2)], [p(0.3, 0.3), p(0.3, 0.3)], [p(0.4, 0.3), p(0.8, 0.5), p(0.4, 0.3)], [p(0.2, 0.3), p(0.7, 0.8), p(0.2, 0.7), p(0.7, 0.2)], Array.from({ length: 64 }, (_, i) => p(i * 0.01, 0.4)), Array.from({ length: 65 }, (_, i) => p(i * 0.01, 0.4)), [p(0.3, 0.4), NaN], [p(0.3, 0.4), , { x: 0.41, y: 0.28 }]];
  for (const len of [0.01994, 0.01995, 0.01996, 0.01999, 0.02, 0.02001, 0.02004, 0.02005, 0.02006]) for (const x of [0.0, 0.13, 0.33, 0.78]) corpus.push([p(x, 0.35), p(x + len, 0.35)]);
  for (let k = 0; k < 6500; k++) {
    const m = 2 + Math.floor(rand() * 10), xs: unknown[] = [];
    for (let i = 0; i < m; i++) {
      if (k % 4 === 0) xs.push(p(-0.22 + 1.45 * rand(), -0.22 + 1.85 * rand()));
      else if (k % 4 === 1) xs.push(p(-0.24 + 1.48 * i / (m - 1), 0.4 + rand() * 0.12));
      else if (k % 4 === 2) xs.push(p(0.08 + 0.84 * i / (m - 1), 0.4 + rand() * 0.05));
      else xs.push(p(0.25 + i * 0.008, 0.32 + rand() * 0.01));
    }
    corpus.push(k % 2 === 0 ? xs : xs.reverse());
  }
  check('D0. the corpus is the complete independent corpus (6,548 traces)', corpus.length === 6548);
  const base = DATA();
  const directInput = (lines: PalmFeatureSetInput['lines']): PalmFeatureSetInput => ({ hand: 'left', dominantHand: 'unknown', landmarks: base.landmarks, imageWidth: base.imageWidth, imageHeight: base.imageHeight, handednessLabel: 'Left', qualityIssues: base.qualityIssues, rotationDeg: base.rotationDeg, lines, marks: [] });
  const stats: Record<string, number> = {};
  let placementMismatch = 0, featureSetMismatch = 0, unconfirmedMismatch = 0, refused = 0, compared = 0;
  const firstMismatch: unknown[] = [];
  const model = createTracingModel(ctxOf(base).context);
  for (const line of TRACING_LINES) {
    for (const pts of corpus) {
      compared++;
      model.reset(line); model.start(line); model.setTrace(line, pts);
      const direct = buildPalmFeatureSet(directInput([{ line, action: 'traced', points: pts as any, confirmed: true }]));
      if (!direct.ok) { refused++; continue; }
      const l = direct.featureSet.lines[line];
      const want = l.provenance === 'user-confirmed' ? 'placed' : (l as any).reason;
      const v = model.line(line);
      const got = v.placement?.ok ? 'placed' : (v.placement as any)?.reason;
      if (line === 'heart') stats[want] = (stats[want] ?? 0) + 1;
      if (got !== want) { placementMismatch++; if (firstMismatch.length < 3) firstMismatch.push({ line, want, got }); continue; }
      // the confirmed feature set must equal I1's own feature set for the same trace (observations and measurements)
      const r = model.confirm(line);
      if (r.ok !== (want === 'placed')) { placementMismatch++; continue; }
      if (r.ok) {
        const mine = model.buildFeatureSet({ hand: 'left', dominantHand: 'unknown' });
        if (JSON.stringify(mine) !== JSON.stringify(direct)) { featureSetMismatch++; if (firstMismatch.length < 3) firstMismatch.push({ line, kind: 'featureSet' }); }
        model.start(line);
      }
      // an unconfirmed trace must reach I1 as not-confirmed, exactly as a direct unconfirmed input does
      const mineU = model.buildFeatureSet({ hand: 'left', dominantHand: 'unknown' });
      const directU = buildPalmFeatureSet(directInput([{ line, action: 'traced', points: pts as any, confirmed: false }]));
      if (JSON.stringify(mineU) !== JSON.stringify(directU)) unconfirmedMismatch++;
    }
    model.reset(line);
  }
  check('D1. complete-corpus placement parity: the model\'s live verdict equals I1 for every trace on every line (4 x 6,548)', compared === 4 * 6548 && placementMismatch === 0 && refused === 0, { placementMismatch, refused, firstMismatch });
  check('D2. feature-set parity: every confirmed trace yields exactly I1\'s feature set (lines, measurements, marks, frame, provenance)', featureSetMismatch === 0, firstMismatch);
  check('D3. unconfirmed-trace parity: every in-progress trace reaches I1 exactly as a direct not-confirmed input', unconfirmedMismatch === 0);
  check('D4. the corpus exercises every I1 trace outcome (placed and all ten trace-* reasons seen on the heart line)', (() => { const want = ['placed', 'trace-too-few-points', 'trace-too-many-points', 'trace-point-invalid', 'trace-outside-palm-frame', 'trace-too-few-distinct-points', 'trace-repeated-point', 'trace-too-short', 'trace-doubles-back', 'trace-self-intersecting', 'trace-tortuous']; return want.every((k) => (stats[k] ?? 0) > 0); })(), stats);
  console.log(`     corpus outcome counts (heart): ${JSON.stringify(stats)}`);
  // measurement and observation parity across varied synthetic hands, labels and quality states
  {
    const hands = [makeHand(), makeHand({ rotateDeg: 20 }), makeHand({ scale: 0.8, dx: 0.05 }), makeHand({ mirror: true }), makeHand({ rotateDeg: -35, dy: -0.03 })];
    const variants: Array<Partial<PalmConstructionData>> = [{ handednessLabel: 'Left' }, { handednessLabel: 'Right' }, { handednessLabel: undefined }, { qualityIssues: ['blurry'] }, { qualityIssues: ['hand-cut-off'] }, { rotationDeg: 12 }];
    let n = 0, mismatches = 0;
    for (const lm of hands) for (const v of variants) {
      const data = DATA({ landmarks: lm, imageWidth: 640, imageHeight: 480, ...v });
      const mm = createTracingModel(createConstructionContext(data, 1, () => true)!.context);
      mm.start('heart'); mm.setTrace('heart', good); const placed = mm.confirm('heart').ok;
      mm.skip('head', 'user-skipped');
      const mine = mm.buildFeatureSet({ hand: 'right', dominantHand: 'left' });
      const lines: PalmFeatureSetInput['lines'] = [{ line: 'heart', action: 'traced', points: good as any, confirmed: placed }, { line: 'head', action: 'skipped', reason: 'user-skipped' }];
      const direct = buildPalmFeatureSet({ hand: 'right', dominantHand: 'left', landmarks: data.landmarks, imageWidth: 640, imageHeight: 480, ...(data.handednessLabel === undefined ? {} : { handednessLabel: data.handednessLabel }), qualityIssues: data.qualityIssues, rotationDeg: data.rotationDeg, lines, marks: [] });
      n++;
      if (JSON.stringify(mine) !== JSON.stringify(direct)) mismatches++;
    }
    check('D5. measurement and observation parity across 5 hands x 6 label/quality/rotation variants (30 feature sets identical to I1)', n === 30 && mismatches === 0, { mismatches });
  }

  // ============================================================ E. privacy and release exclusion
  const SRC = ['apps/web/lib/palm-analysis/construction.ts', 'apps/web/lib/palm-analysis/tracing.ts'];
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of SRC) {
    const s = strip(read(f));
    check(`E1. ${f}: no network, storage, logging, messaging or global state`, !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|caches\.|console\.|postMessage|BroadcastChannel|globalThis|window\.|self\./.test(s));
    check(`E2. ${f}: imports only from lib/palm-analysis (no E1, no packages, no app modules)`, [...s.matchAll(/from '([^']+)'/g)].every((m) => /^\.\/[a-zA-Z]+$/.test(m[1])) && !/palm-reading-engine|packages\//.test(s));
  }
  check('E3. the tracing model never stores context data outside an operation (no module- or model-level copy of the landmarks)', !/let\s+\w+\s*:\s*PalmConstructionData|const\s+cached|=\s*context\.read\(\)\s*;?\s*$/m.test(strip(read('apps/web/lib/palm-analysis/tracing.ts')).replace(/const data = dead \? null : context\.read\(\);/, '')));
  check('E4. the session keeps the context out of its state (PalmSessionState shape unchanged)', (() => { const t = read('apps/web/lib/palm-analysis/session.ts'); const st = t.slice(t.indexOf('export interface PalmSessionState'), t.indexOf('export interface PalmSessionDeps')); return !/construction|landmark/i.test(st); })());
  check('E5. the analysis result type still carries no landmarks or pixels', (() => { const t = read('apps/web/lib/palm-analysis/types.ts'); const r = t.slice(t.indexOf('export interface PalmAnalysisResult'), t.indexOf('export class PalmPipelineError')); return !/landmarks|ImageData|Uint8|canvas/i.test(r); })());
  // release exclusion: nothing imports the new modules except the palm-analysis library itself (the production
  // build swaps out PalmImageInput, the only importer of lib/palm-analysis), and the bundle scanner carries their
  // runtime sentinels
  {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (['node_modules', '.next', '.next-dev', 'public', 'android', 'ios'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx|js|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const importers = walk(path.join(ROOT, 'apps/web')).filter((f) => /(construction|tracing)['"]/.test(fs.readFileSync(f, 'utf8')) && /from '[^']*(\.\/|lib\/palm-analysis\/)(construction|tracing)'/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f)).sort();
    check('E6. only lib/palm-analysis itself imports construction.ts / tracing.ts (no UI, no route, no app module)', JSON.stringify(importers) === JSON.stringify(['apps/web/lib/palm-analysis/index.ts', 'apps/web/lib/palm-analysis/session.ts', 'apps/web/lib/palm-analysis/tracing.ts']), importers);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const scanner = require('../apps/web/scripts/check-palmistry-bundle');
    const sentinels = ['palm-04-construction-context@0.1.0', 'the photo this tracing belonged to was reset, replaced or closed'];
    check('E7. the production bundle scanner checks both new runtime sentinels as image-input code', sentinels.every((s) => scanner.IMAGE_INPUT_SENTINELS.includes(s)));
    check('E8. each sentinel is reachable at runtime (used in code, not only in a comment)', strip(read('apps/web/lib/palm-analysis/construction.ts')).includes('kind: PALM_CONSTRUCTION_CONTEXT_VERSION') && strip(read('apps/web/lib/palm-analysis/tracing.ts')).includes(sentinels[1]));
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'p4i1-scan-'));
    try {
      fs.mkdirSync(path.join(tmp, '.next/static/chunks'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.next/static/chunks/a.js'), 'console.log("clean")');
      const clean = scanner.scanImageInput(tmp);
      fs.writeFileSync(path.join(tmp, '.next/static/chunks/b.js'), `var k={kind:"${sentinels[0]}"};throw new Error("${sentinels[1]}")`);
      const leak = scanner.scanImageInput(tmp);
      check('E9. the scanner flags a build that contains the new modules, and passes one that does not', clean.length === 0 && sentinels.every((sv) => leak.some((h: any) => h.sentinel === sv)), { clean, leak });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
}

run().then(() => {
  console.log(`\nPALM-04-I1 tracing: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
