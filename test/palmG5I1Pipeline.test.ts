/**
 * AURA-PALM-G5-I1 -- unit tests: analysis + quality feedback, the shared
 * session orchestrator (cancellation, replacement, stale results, model
 * failure, cleanup, camera-frame reuse), the development gate and the
 * cross-origin guard. Synthetic frames and landmarks only; the detector is a
 * test double behind the same PalmHandDetector interface MediaPipe implements.
 *
 *   npx ts-node test/palmG5I1Pipeline.test.ts
 */
import { analyzePalmFrame, PALM_ACCEPTED_HEADLINE, PALM_SCOPE_NOTE } from '../apps/web/lib/palm-analysis/analyze';
import { isPalmImageInputEnabled } from '../apps/web/lib/palm-analysis/gate';
import { createMediaPipeHandDetector, isPalmRuntimeSupported } from '../apps/web/lib/palm-analysis/mediapipeDetector';
import { __resetCrossOriginGuardForTests, acquireCrossOriginGuard, blockedCrossOriginHosts, isCrossOriginGuardActive, isSameOrigin } from '../apps/web/lib/palm-analysis/networkGuard';
import { normalizeDrawableFrame } from '../apps/web/lib/palm-analysis/normalize';
import { QUALITY_THRESHOLDS } from '../apps/web/lib/palm-analysis/quality';
import { createPalmAnalysisSession, type PalmSessionState } from '../apps/web/lib/palm-analysis/session';
import { PalmPipelineError, type PalmFrame, type PalmHandDetection, type PalmHandDetector } from '../apps/web/lib/palm-analysis/types';
import { blobOf, makeFakeCanvas, makeHand, makePixels, makePng, type PixelKind } from './palmG5I1Fixtures';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`OK   ${label}`); } else { failed++; console.log(`FAIL ${label}`); }
}

const W = 640, H = 480;
function frameOf(kind: PixelKind = 'textured', source: 'upload' | 'camera' = 'upload'): PalmFrame {
  return normalizeDrawableFrame({}, W, H, source, { createCanvas: (w, h) => makeFakeCanvas(w, h, (ww, hh) => makePixels(ww, hh, kind)) as any });
}
const detectorReturning = (hands: PalmHandDetection[]): PalmHandDetector & { closed: number; calls: number } => {
  const d = { closed: 0, calls: 0, detect: () => { d.calls++; return hands; }, close: () => { d.closed++; } };
  return d;
};
const hand = (opts: Parameters<typeof makeHand>[0] = {}, label = 'Left'): PalmHandDetection => ({ landmarks: makeHand(opts), handednessLabel: label, handednessScore: 0.98 });

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

async function run() {
  // ============================================================ A. analysis
  {
    const r = analyzePalmFrame(frameOf(), detectorReturning([hand()]));
    check('A1. one open palm, good light -> accepted', r.status === 'accepted' && r.issues.length === 0);
    check('A2. accepted headline is the approved wording', r.headline === PALM_ACCEPTED_HEADLINE && r.headline === 'Palm image looks suitable for further analysis.');
    check('A3. result carries no pixels and no landmarks', !('landmarks' in r) && !JSON.stringify(r).includes('"landmarks"') && !/data:image|Uint8/.test(JSON.stringify(r)));
    check('A4. result keys are exactly the documented pixel-free set', JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['handsDetected', 'headline', 'issues', 'metrics', 'palmBox', 'source', 'status', 'timing']));
    check('A5. palm box is normalised to [0,1]', r.palmBox!.x0 >= 0 && r.palmBox!.x1 <= 1 && r.palmBox!.y0 >= 0 && r.palmBox!.y1 <= 1 && r.palmBox!.x1 > r.palmBox!.x0);
  }
  {
    const r = analyzePalmFrame(frameOf(), detectorReturning([]));
    check('A6. no hand -> no-hand status with guidance', r.status === 'no-hand' && /No hand detected/.test(r.headline) && r.metrics === undefined);
  }
  {
    const r = analyzePalmFrame(frameOf(), detectorReturning([hand(), hand({ dx: 0.2 })]));
    check('A7. two hands -> multiple-hands status', r.status === 'multiple-hands' && r.handsDetected === 2 && /More than one hand/.test(r.headline));
  }
  {
    const r = analyzePalmFrame(frameOf('dark'), detectorReturning([hand()]));
    check('A8. dark image -> needs-retake with too-dark', r.status === 'needs-retake' && r.issues.some((i) => i.code === 'too-dark'));
  }
  {
    const r = analyzePalmFrame(frameOf('bright'), detectorReturning([hand()]));
    check('A9. washed-out image -> too-bright', r.issues.some((i) => i.code === 'too-bright'));
  }
  {
    const r = analyzePalmFrame(frameOf('flat'), detectorReturning([hand()]));
    check('A10. flat (featureless) image -> blurry + low-contrast', r.issues.some((i) => i.code === 'blurry') && r.issues.some((i) => i.code === 'low-contrast'));
  }
  {
    const r = analyzePalmFrame(frameOf(), detectorReturning([hand({ scale: 0.25 })]));
    check('A11. hand too small in frame -> hand-too-small', r.issues.some((i) => i.code === 'hand-too-small') && r.metrics!.palmFraction < QUALITY_THRESHOLDS.minPalmFraction);
  }
  {
    const r = analyzePalmFrame(frameOf(), detectorReturning([hand({ dy: -0.25 })]));
    check('A12. fingertips outside the photo -> hand-cut-off', r.issues.some((i) => i.code === 'hand-cut-off') && r.metrics!.inFrame === false);
  }
  {
    const r = analyzePalmFrame(frameOf(), detectorReturning([hand({ rotateDeg: 90 })]));
    check('A13. sideways hand -> hand-rotated', r.issues.some((i) => i.code === 'hand-rotated') && Math.abs(r.metrics!.rotationDeg) > 45);
  }
  {
    const r = analyzePalmFrame(frameOf(), detectorReturning([hand({}, 'Right')]));
    check('A14. winding/handedness says back of hand -> palm-not-visible, listed first', r.issues[0]?.code === 'palm-not-visible' && r.metrics!.palmFacing === false);
    const m = analyzePalmFrame(frameOf(), detectorReturning([hand({ mirror: true }, 'Right')]));
    check('A15. mirrored image of a palm (selfie convention) is still palm-facing', m.status === 'accepted' && m.metrics!.palmFacing === true);
  }
  {
    // Fold ring + pinky (V-sign): tips pulled back toward the wrist past the PIP joint.
    const v = makeHand();
    for (const [pip, tip] of [[14, 16], [18, 20]]) v[tip] = { x: v[pip].x, y: v[pip].y + 0.1 };
    const r = analyzePalmFrame(frameOf(), detectorReturning([{ landmarks: v, handednessLabel: 'Left' }]));
    check('A15b. folded fingers (V-sign / fist) hide the palm -> palm-not-visible', r.status === 'needs-retake' && r.issues[0]?.code === 'palm-not-visible' && r.metrics!.fingersOpen === false);
    const open = analyzePalmFrame(frameOf(), detectorReturning([hand({ rotateDeg: 30 })]));
    check('A15c. open-finger check is rotation-invariant (30 deg tilt still open)', open.metrics!.fingersOpen === true);
  }
  {
    let err: any = null;
    try { analyzePalmFrame(frameOf(), detectorReturning([{ landmarks: makeHand().slice(0, 5) }])); } catch (e) { err = e; }
    check('A16. incomplete landmark set -> analysis-failed (no partial result)', err instanceof PalmPipelineError && err.code === 'analysis-failed');
    const f = frameOf();
    f.release();
    let err2: any = null;
    try { analyzePalmFrame(f, detectorReturning([hand()])); } catch (e) { err2 = e; }
    check('A17. analysing a released frame is refused', err2 instanceof PalmPipelineError);
  }
  {
    const r = analyzePalmFrame(frameOf('dark'), detectorReturning([hand()]));
    const text = [r.headline, ...r.issues.map((i) => i.message), PALM_SCOPE_NOTE].join(' ');
    check('A18. feedback never claims palm lines were detected', !/lines? (were|was|have been|has been) (detected|found|read)|detected (your )?(palm )?lines/i.test(text));
    check('A19. scope note says it does not read lines or predict', /does not read palm lines/.test(PALM_SCOPE_NOTE) && /prediction/.test(PALM_SCOPE_NOTE));
  }

  // ============================================================ B. session
  const env = (decodeDelay?: Promise<void>) => ({
    createCanvas: (w: number, h: number) => makeFakeCanvas(w, h) as any,
    decode: async () => { if (decodeDelay) await decodeDelay; return { width: 1600, height: 1200, source: {}, close() {} }; },
  });
  const pngFile = () => blobOf(makePng(400, 300), 'image/png', 'p.png') as any;
  const yieldNow = () => Promise.resolve();
  const states = (s: { subscribe: (l: (x: PalmSessionState) => void) => () => void }) => { const seen: PalmSessionState[] = []; s.subscribe((x) => seen.push(x)); return seen; };

  {
    const det = detectorReturning([hand()]);
    let factoryCalls = 0;
    const s = createPalmAnalysisSession({ detectorFactory: async () => { factoryCalls++; return det; }, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    const seen = states(s);
    await s.submitFile(pngFile());
    check('B1. happy path phases: validating -> loading-model -> analysing -> result', JSON.stringify(seen.map((x) => x.phase)) === JSON.stringify(['validating', 'loading-model', 'analysing', 'result']));
    check('B2. result accepted, preview frame present', s.getState().result?.status === 'accepted' && s.getState().frame !== null);
    await s.submitFile(pngFile());
    check('B3. model is loaded once and reused', factoryCalls === 1 && det.calls === 2);
    const prevFrame = seen[seen.length - 1].frame!;
    check('B4. replacing the image released the previous frame', seen.filter((x) => x.phase === 'result').length === 2 && seen[3].frame!.released && !prevFrame.released);
    const current = s.getState().frame!;
    s.clear();
    check('B5. remove (clear): idle state, frame released, result gone', s.getState().phase === 'idle' && s.getState().frame === null && s.getState().result === null && current.released);
    s.dispose();
    check('B6. dispose closes the model', det.closed === 1 && s.disposed);
    await s.submitFile(pngFile());
    check('B7. a disposed session ignores further input', s.getState().phase === 'idle' && det.calls === 2);
  }
  {
    let attempts = 0;
    const det = detectorReturning([hand()]);
    const s = createPalmAnalysisSession({ detectorFactory: async () => { attempts++; if (attempts === 1) throw new PalmPipelineError('model-unavailable'); return det; }, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    await s.submitFile(pngFile());
    const st = s.getState();
    check('B8. model load failure -> retryable model-unavailable error, image kept for retry', st.phase === 'error' && st.error?.code === 'model-unavailable' && st.error.retryable && st.frame !== null && !st.frame.released);
    await s.retry();
    check('B9. retry really reloads the model and completes', attempts === 2 && s.getState().phase === 'result' && s.getState().result?.status === 'accepted');
    s.dispose();
  }
  {
    const s = createPalmAnalysisSession({ detectorFactory: async () => { throw new Error('network down'); }, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    await s.submitFile(pngFile());
    check('B10. an unexpected loader exception still ends in a retryable error state', s.getState().phase === 'error' && s.getState().error?.retryable === true);
    s.dispose();
  }
  {
    // Removal during analysis: the late model must not produce a result.
    const load = deferred<PalmHandDetector>();
    const det = detectorReturning([hand()]);
    const s = createPalmAnalysisSession({ detectorFactory: () => load.promise, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    const seen = states(s);
    const p = s.submitFile(pngFile());
    await tick();
    check('B11. waiting on the model shows loading-model', s.getState().phase === 'loading-model');
    const frameDuringLoad = s.getState().frame!;
    s.clear();
    load.resolve(det);
    await p;
    await tick();
    check('B12. removed during analysis: stays idle, no stale result ever emitted', s.getState().phase === 'idle' && !seen.some((x) => x.phase === 'result') && det.calls === 0);
    check('B13. the removed image frame was released', frameDuringLoad.released);
    s.dispose();
    check('B14. model that finished loading is still closed on dispose', det.closed === 1);
  }
  {
    // Rapid replacement: A decodes slowly, B quickly; only B may be shown.
    const slow = deferred<void>();
    const decodes: string[] = [];
    let n = 0;
    const det = detectorReturning([hand()]);
    const canvases: any[] = [];
    const s = createPalmAnalysisSession({
      detectorFactory: async () => det,
      normalizeEnv: {
        createCanvas: (w, h) => { const c = makeFakeCanvas(w, h); canvases.push(c); return c as any; },
        decode: async () => { const id = n++ === 0 ? 'A' : 'B'; if (id === 'A') await slow.promise; decodes.push(id); return { width: 1600, height: 1200, source: { id }, close() {} }; },
      },
      isEnabled: () => true,
      yieldToUi: yieldNow,
    });
    const seen = states(s);
    const pa = s.submitFile(pngFile());
    await tick();
    const pb = s.submitFile(pngFile());
    await pb;
    const resultB = s.getState();
    slow.resolve();
    await pa;
    const drawnA = canvases.find((c) => c.ctx.calls.some((x: any) => x.op === 'drawImage' && x.args[0]?.id === 'A'));
    check('B15. rapid replacement: final state is the second image', resultB.phase === 'result' && s.getState().generation === resultB.generation && s.getState().frame === resultB.frame);
    check('B16. stale async decode of the first image never reaches the UI', seen.filter((x) => x.phase === 'result').length === 1 && decodes.join() === 'B,A');
    check('B17. the superseded first image frame was released immediately', Boolean(drawnA) && drawnA.width === 0 && drawnA.height === 0);
    check('B18. detector ran once (only for the current image)', det.calls === 1);
    s.dispose();
  }
  {
    // Stale result while analysing: replacement arrives during the UI yield.
    const gate = deferred<void>();
    let yields = 0;
    const det = detectorReturning([hand()]);
    const s = createPalmAnalysisSession({ detectorFactory: async () => det, normalizeEnv: env(), isEnabled: () => true, yieldToUi: () => (yields++ === 0 ? gate.promise : Promise.resolve()) });
    const seen = states(s);
    const p1 = s.submitFile(pngFile());
    for (let i = 0; i < 5; i++) await tick();
    check('B19. first image is in analysing', s.getState().phase === 'analysing');
    const p2 = s.submitFile(pngFile());
    await p2;
    gate.resolve();
    await p1;
    check('B20. analysis of a replaced image is discarded (exactly one result, for the new image)', seen.filter((x) => x.phase === 'result').length === 1 && det.calls === 1);
    s.dispose();
  }
  {
    // Dispose while the model is still loading: late detector is closed.
    const load = deferred<PalmHandDetector>();
    const det = detectorReturning([hand()]);
    const s = createPalmAnalysisSession({ detectorFactory: () => load.promise, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    const p = s.submitFile(pngFile());
    await tick();
    const f = s.getState().frame!;
    s.dispose();
    load.resolve(det);
    await p;
    await tick();
    check('B21. leaving during model load: late model closed, frame released', det.closed === 1 && f.released);
  }
  {
    const s = createPalmAnalysisSession({ detectorFactory: async () => detectorReturning([hand()]), normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    await s.submitFile(blobOf(new Uint8Array(0), 'image/png') as any);
    check('B22. invalid file -> error state, no frame, model never loaded', s.getState().phase === 'error' && s.getState().error?.code === 'empty-file' && s.getState().frame === null);
    await s.submitFile(pngFile());
    check('B23. error recovery: next valid image succeeds', s.getState().phase === 'result');
    s.dispose();
  }
  {
    let factoryCalls = 0;
    const s = createPalmAnalysisSession({ detectorFactory: async () => { factoryCalls++; return detectorReturning([hand()]); }, normalizeEnv: env(), isEnabled: () => false, yieldToUi: yieldNow });
    await s.submitFile(pngFile());
    check('B24. gate closed: session refuses work (feature-disabled), model never requested', s.getState().error?.code === 'feature-disabled' && factoryCalls === 0);
    s.dispose();
  }
  {
    const det = detectorReturning([hand()]);
    const s = createPalmAnalysisSession({ detectorFactory: async () => det, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    await s.submitDrawable({ tag: 'video-frame' }, 1280, 720, 'camera');
    const st = s.getState();
    check('B25. camera-frame entry point reuses the same tail (result, source=camera)', st.phase === 'result' && st.result?.source === 'camera' && st.frame?.source === 'camera');
    await s.submitFile(pngFile());
    check('B26. switching source releases the camera frame', st.frame!.released && s.getState().result?.source === 'upload');
    await s.submitDrawable({}, 100, 100, 'camera');
    check('B27. tiny camera frame -> dimensions-too-small through the shared checks', s.getState().error?.code === 'dimensions-too-small');
    s.dispose();
  }
  {
    const det = { detect: () => { throw new Error('wasm abort'); }, close() {} };
    const s = createPalmAnalysisSession({ detectorFactory: async () => det, normalizeEnv: env(), isEnabled: () => true, yieldToUi: yieldNow });
    await s.submitFile(pngFile());
    check('B28. detector crash -> analysis-failed error (retryable), no crash of the session', s.getState().error?.code === 'analysis-failed' && s.getState().error?.retryable === true);
    s.dispose();
  }

  // ============================================================ C. gate
  check('C1. gate open only for development + exact flag value', isPalmImageInputEnabled('development', 'g5-i1-dev') === true);
  check('C2. production build: closed even with the flag', isPalmImageInputEnabled('production', 'g5-i1-dev') === false);
  check('C3. test/undefined NODE_ENV: closed', isPalmImageInputEnabled('test', 'g5-i1-dev') === false && isPalmImageInputEnabled(undefined, 'g5-i1-dev') === false);
  check('C4. development without opt-in: closed', isPalmImageInputEnabled('development', undefined) === false && isPalmImageInputEnabled('development', '1') === false && isPalmImageInputEnabled('development', 'true') === false);
  check('C5. default arguments read the real environment (closed here)', isPalmImageInputEnabled() === false);

  // ============================================================ D. cross-origin guard
  {
    __resetCrossOriginGuardForTests();
    const g: any = globalThis as any;
    const savedLocation = g.location;
    Object.defineProperty(g, 'location', { value: { origin: 'http://localhost:3000' }, configurable: true });
    const calls: string[] = [];
    const target: any = { fetch: async (u: any) => { calls.push(String(u)); return { ok: true }; } };
    const original = target.fetch;
    const release1 = acquireCrossOriginGuard(target);
    const release2 = acquireCrossOriginGuard(target);
    await target.fetch('/palm-dev-assets/mediapipe-1.2.0/hand_landmarker.task');
    let blocked = false;
    try { await target.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: 'x' }); } catch { blocked = true; }
    let blocked2 = false;
    try { await target.fetch({ url: 'https://cdn.example.com/x.wasm' }); } catch { blocked2 = true; }
    check('D1. same-origin asset requests pass through', calls.length === 1 && calls[0].startsWith('/palm-dev-assets/'));
    check('D2. MediaPipe telemetry endpoint is blocked before the network', blocked && !calls.some((c) => c.includes('googleapis')));
    check('D3. any other cross-origin request (Request-like) is blocked', blocked2 && !calls.some((c) => c.includes('example.com')));
    check('D4. only hosts are recorded (no path/query/body)', JSON.stringify(blockedCrossOriginHosts()) === JSON.stringify(['odml.pa.googleapis.com', 'cdn.example.com']));
    release1();
    check('D5. guard is reference-counted (still active with one holder)', isCrossOriginGuardActive() && target.fetch !== original);
    release2();
    release2();
    check('D6. last release restores the original fetch; double release is harmless', !isCrossOriginGuardActive() && target.fetch === original);
    const r3 = acquireCrossOriginGuard(target);
    const someoneElse = async () => ({ ok: true });
    target.fetch = someoneElse;
    r3();
    check('D7. release never clobbers a fetch someone re-wrapped later', target.fetch === someoneElse);
    check('D8. isSameOrigin: relative and same-origin absolute pass, other origins fail', isSameOrigin('/x', 'http://localhost:3000') && isSameOrigin('http://localhost:3000/a', 'http://localhost:3000') && !isSameOrigin('http://localhost:3001/a', 'http://localhost:3000') && !isSameOrigin('https://odml.pa.googleapis.com/v1/log', 'http://localhost:3000'));
    Object.defineProperty(g, 'location', { value: savedLocation, configurable: true });
    __resetCrossOriginGuardForTests();
  }

  // ============================================================ E. detector entry guards
  {
    check('E1. runtime support needs WebAssembly + a document', isPalmRuntimeSupported({ WebAssembly: { instantiate() {} }, document: {} }) && !isPalmRuntimeSupported({ document: {} }) && !isPalmRuntimeSupported({ WebAssembly: { instantiate() {} } }));
    let err: any = null;
    try { await createMediaPipeHandDetector(); } catch (e) { err = e; }
    check('E2. unsupported environment (no DOM) -> unsupported-browser, before any import', err instanceof PalmPipelineError && err.code === 'unsupported-browser' && !isCrossOriginGuardActive());
    const g: any = globalThis as any;
    g.document = {};
    let err2: any = null;
    try { await createMediaPipeHandDetector('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision'); } catch (e) { err2 = e; }
    let err3: any = null;
    try { await createMediaPipeHandDetector('//cdn.example.com/x'); } catch (e) { err3 = e; }
    delete g.document;
    check('E3. a CDN / absolute asset base is refused (self-hosted same-origin only)', err2 instanceof PalmPipelineError && err2.code === 'model-unavailable' && err3 instanceof PalmPipelineError && !isCrossOriginGuardActive());
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
