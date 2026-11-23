/**
 * AURA-PALM-G5-I1-R2 -- R1-F1 regression suite: MediaPipe telemetry lifecycle.
 *
 * Drives the PRODUCTION detector (apps/web/lib/palm-analysis/mediapipeDetector.ts,
 * unmodified, through its real dynamic import) against the REAL MediaPipe
 * 1.2.0 JS layer and its REAL usage logger, with a fake WASM module and a
 * recording transport (test/palmG5I1R2FakeMediaPipeRuntime.ts). No request
 * ever leaves the process.
 *
 * The detector module is required untyped so this same file can be run, as a
 * negative control, against the original G5-I1 detector (which lacks the R2
 * exports): see AURA_PALM_G5_I1_R2_SECURITY_REMEDIATION/11_NEGATIVE_CONTROLS.
 *
 * Run: npx ts-node test/palmG5I1R2Lifecycle.test.ts
 */
import {
  installFakeMediaPipeRuntime, resetRuntime, runtime, telemetry, fireLoggerTimers, liveLoggerTimers, loggersCreated,
  fakeTransport, MODEL_SENTINEL_BYTE, PAGE_ORIGIN,
} from './palmG5I1R2FakeMediaPipeRuntime';

installFakeMediaPipeRuntime();

/* eslint-disable @typescript-eslint/no-var-requires */
const det: any = require('../apps/web/lib/palm-analysis/mediapipeDetector');
const guard: any = require('../apps/web/lib/palm-analysis/networkGuard');
const { createPalmAnalysisSession } = require('../apps/web/lib/palm-analysis/session');
const { PalmPipelineError } = require('../apps/web/lib/palm-analysis/types');

// The same module instance the detector's dynamic import() resolves to.
const requireVision = () => require(require.resolve('@mediapipe/tasks-vision', { paths: [require('path').join(__dirname, '../apps/web/lib/palm-analysis')] }));

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); }
}

const create = (base?: string) => det.createMediaPipeHandDetector(base);
const refs = (): number => (guard.crossOriginGuardRefs ? guard.crossOriginGuardRefs().refs : guard.isCrossOriginGuardActive() ? 1 : 0);
const quarantined = (): string | null => (det.palmRuntimeQuarantineReason ? det.palmRuntimeQuarantineReason() : null);
const fetchIsTransport = () => (globalThis as any).fetch === fakeTransport;
const odmlBlocked = () => guard.blockedCrossOriginHosts().filter((h: string) => h === 'odml.pa.googleapis.com').length;
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const codeOf = (e: any) => (e instanceof PalmPipelineError ? e.code : String(e?.message ?? e));

function fresh(): void {
  guard.__resetCrossOriginGuardForTests();
  det.__resetPalmRuntimeForTests?.();
  resetRuntime();
}

// A tiny canvas so sessions can build frames (detection itself then fails on
// the fake WASM, which is fine: these tests are about the lifecycle).
const fakeCanvas = (w: number, h: number) => ({
  width: w, height: h,
  getContext: () => ({ drawImage() {}, clearRect() {}, getImageData: (_x: number, _y: number, ww: number, hh: number) => ({ data: new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh }) }),
});
const sessionWithRealDetector = () =>
  createPalmAnalysisSession({
    detectorFactory: () => create(),
    normalizeEnv: { createCanvas: fakeCanvas as any, decode: async () => { throw new Error('unused'); } },
    isEnabled: () => true,
    yieldToUi: () => Promise.resolve(),
  });

async function main(): Promise<void> {
  // ===================================================== 1. success + normal cleanup
  {
    fresh();
    const d = await create();
    check('T1a. success: the real MediaPipe usage logger exists (one 60 s timer)', loggersCreated() === 1 && liveLoggerTimers() === 1);
    check('T1b. success: model fetched same-origin through the guard', runtime.wire.some((w) => w.url.endsWith('/hand_landmarker.task')) && telemetry().length === 0);
    check('T1c. success: one guard reference while the detector lives', refs() === 1 && !fetchIsTransport());
    d.close();
    await settle();
    check('T1d. normal close: no telemetry reached the transport', telemetry().length === 0);
    check('T1e. normal close: guard released, original fetch restored, runtime not quarantined', refs() === 0 && fetchIsTransport() && quarantined() === null);
  }

  // ===================================================== 2. failure BEFORE the logger exists
  {
    fresh();
    // 2a. Phase A failure (file-set resolution throws): no MediaPipe task at all.
    // Fault injection on the public FilesetResolver API of the same module
    // instance the detector imports; restored immediately.
    const vision: any = requireVision();
    const savedFor = vision.FilesetResolver.forVisionTasks;
    vision.FilesetResolver.forVisionTasks = async () => { throw new Error('fake file-set failure'); };
    let e1: any = null;
    try { await create(); } catch (e) { e1 = e; }
    vision.FilesetResolver.forVisionTasks = savedFor;
    check('T2a. pre-task failure: model-unavailable (retryable), no logger, guard released', codeOf(e1) === 'model-unavailable' && loggersCreated() === 0 && refs() === 0 && quarantined() === null, `code=${codeOf(e1)} refs=${refs()}`);
    const d = await create();
    check('T2b. pre-task failure stays retryable: next create succeeds', !!d && quarantined() === null);
    d.close();

    // 2c. WASM module factory rejects inside createFromOptions (logger not yet created).
    fresh();
    runtime.modes = ['factory-error'];
    let e2: any = null;
    try { await create(); } catch (e) { e2 = e; }
    await fireLoggerTimers();
    check('T2c. factory failure inside createFromOptions: no logger was created, nothing sent', loggersCreated() === 0 && telemetry().length === 0);
    check('T2d. ...and the runtime fails closed anyway (cannot be told apart from outside): runtime-unsafe, guard kept', codeOf(e2) === 'runtime-unsafe' && quarantined() === 'init-failed' && refs() >= 1, `code=${codeOf(e2)}`);
  }

  // ===================================================== 3. failure AFTER the logger exists (queue empty)
  {
    fresh();
    runtime.modes = ['pre-graph-error'];
    let e: any = null;
    try { await create(); } catch (err) { e = err; }
    const armed = liveLoggerTimers();
    await fireLoggerTimers();
    check('T3a. failure after logger creation: an orphaned logger timer exists', armed === 1);
    check('T3b. ...runtime-unsafe, guard kept, nothing sent', codeOf(e) === 'runtime-unsafe' && refs() >= 1 && telemetry().length === 0, `code=${codeOf(e)} refs=${refs()} tel=${telemetry().length}`);
  }

  // ===================================================== 4. failure AFTER an event was queued (R1-F1 core)
  {
    fresh();
    runtime.modes = ['graph-error'];
    let e: any = null;
    try { await create(); } catch (err) { e = err; }
    check('T4a. graph error after setGraph(): createFromOptions rejected with an armed orphan logger', liveLoggerTimers() === 1 && runtime.events.some((x) => x.startsWith('graph#')));
    check('T4b. guard still installed after the failure (not released early)', refs() >= 1 && !fetchIsTransport(), `refs=${refs()}`);
    await fireLoggerTimers(); // 60 s later: the orphan flushes its queued init event
    check('T4c. ORPHAN TELEMETRY BLOCKED: the queued event never reaches the transport', telemetry().length === 0, `escaped=${telemetry().length}`);
    check('T4d. the attempt was made and rejected in-page (host recorded)', odmlBlocked() === 1, `blocked=${odmlBlocked()}`);
    check('T4e. user-facing outcome is runtime-unsafe (non-retryable)', codeOf(e) === 'runtime-unsafe');
  }

  // ===================================================== 5. periodic telemetry during normal operation
  {
    fresh();
    const d = await create();
    const fired = await fireLoggerTimers();
    check('T5. periodic 60 s flush while the detector is alive is blocked', fired === 1 && telemetry().length === 0 && odmlBlocked() === 1);
    d.close();
    await settle();
    check('T5b. after the blocked flush the logger stays silent at close; guard released', telemetry().length === 0 && refs() === 0);
  }

  // ===================================================== 6. telemetry during shutdown
  {
    fresh();
    const d = await create();
    d.close(); // logger flushes its queued init event synchronously inside close()
    await settle();
    check('T6. shutdown flush is blocked (guard held through close), then the guard is released', telemetry().length === 0 && odmlBlocked() === 1 && refs() === 0 && fetchIsTransport());
  }

  // ===================================================== 7. pending telemetry after failed init, over time
  {
    fresh();
    runtime.modes = ['graph-error'];
    try { await create(); } catch { /* expected */ }
    const session = sessionWithRealDetector();
    session.dispose(); // the UI leaving Palmistry does not end the orphan's timer
    for (let i = 0; i < 3; i++) await fireLoggerTimers();
    const holds = guard.crossOriginGuardRefs ? guard.crossOriginGuardRefs().permanentHolds : [];
    check('T7a. pending orphan event never escapes across repeated 60 s ticks and after the UI is gone', telemetry().length === 0);
    check('T7b. containment is an explicit page-lifetime hold with a recorded reason', holds.includes('palm-mediapipe:init-failed') && refs() >= 1, JSON.stringify(holds));
  }

  // ===================================================== 8. repeated initialisation failures
  {
    fresh();
    runtime.modes = ['graph-error', 'graph-error', 'graph-error'];
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) { try { await create(); codes.push('ok'); } catch (e) { codes.push(codeOf(e)); } }
    await fireLoggerTimers();
    check('T8a. after the first failure no further MediaPipe task is created (no accumulation)', loggersCreated() === 1 && runtime.createCount >= 1, `loggers=${loggersCreated()}`);
    check('T8b. every attempt reports runtime-unsafe; nothing sent', codes.every((c) => c === 'runtime-unsafe') && telemetry().length === 0, codes.join(','));
    const r = refs();
    try { await create(); } catch { /* expected */ }
    check('T8c. refused attempts do not leak guard references', refs() === r);
  }

  // ===================================================== 9. cancellation during initialisation (session)
  {
    fresh();
    const s = sessionWithRealDetector();
    const p = s.submitDrawable({}, 640, 480, 'camera');
    s.clear(); // user removes the image while the model is loading
    await p;
    await settle();
    check('T9a. cancelled during load: state is idle, nothing sent', s.getState().phase === 'idle' && telemetry().length === 0);
    s.dispose();
    await settle();
    check('T9b. after dispose: detector closed, flush blocked, guard released', telemetry().length === 0 && refs() === 0 && fetchIsTransport());

    fresh();
    runtime.modes = ['graph-error'];
    const s2 = sessionWithRealDetector();
    const p2 = s2.submitDrawable({}, 640, 480, 'camera');
    s2.clear();
    await p2;
    await fireLoggerTimers();
    check('T9c. cancelled during a load that then fails: orphan contained', telemetry().length === 0 && refs() >= 1 && quarantined() === 'init-failed');
  }

  // ===================================================== 10. component unmount during initialisation
  {
    // PalmImageInput's effect cleanup calls session.dispose() (jsdom F-series);
    // this drives that exact call while the real model is still loading.
    fresh();
    const s = sessionWithRealDetector();
    const p = s.submitDrawable({}, 640, 480, 'camera');
    s.dispose();
    await p;
    await settle(8);
    check('T10a. unmount during load: the late detector is closed at once; flush blocked; guard released', telemetry().length === 0 && refs() === 0 && liveLoggerTimers() === 0 && fetchIsTransport(), `refs=${refs()} live=${liveLoggerTimers()}`);

    fresh();
    runtime.modes = ['graph-error'];
    const s2 = sessionWithRealDetector();
    const p2 = s2.submitDrawable({}, 640, 480, 'camera');
    s2.dispose();
    await p2;
    await fireLoggerTimers();
    check('T10b. unmount during a load that fails: orphan contained', telemetry().length === 0 && refs() >= 1);
  }

  // ===================================================== 11. rapid image replacement
  {
    fresh();
    const s = sessionWithRealDetector();
    const ps = [s.submitDrawable({}, 640, 480, 'camera'), s.submitDrawable({}, 800, 600, 'camera'), s.submitDrawable({}, 1024, 768, 'camera')];
    await Promise.all(ps);
    await settle();
    check('T11a. rapid replacement during load: ONE MediaPipe task, nothing sent', loggersCreated() === 1 && telemetry().length === 0, `loggers=${loggersCreated()}`);
    s.dispose();
    await settle();
    check('T11b. ...and dispose releases everything', refs() === 0 && telemetry().length === 0);
  }

  // ===================================================== 12. concurrent initialisation
  {
    fresh();
    const [a, b] = await Promise.all([create(), create()]);
    const ev = runtime.events.filter((x) => /^(factory|graph)#/.test(x)).map((x) => x.split('#')[0]);
    check('T12a. concurrent creates are serialised (second WASM load starts after the first graph is built)', ev.join(',') === 'factory,graph,factory,graph', runtime.events.join(' '));
    check('T12b. two detectors hold two guard references', refs() === 2);
    a.close();
    check('T12c. closing one keeps the guard for the other', refs() === 1 && !fetchIsTransport());
    b.close();
    await settle();
    check('T12d. closing both: guard released, nothing sent', refs() === 0 && fetchIsTransport() && telemetry().length === 0);

    fresh();
    runtime.modes = ['graph-error', 'ok'];
    const r = await Promise.allSettled([create(), create()]);
    await fireLoggerTimers();
    check('T12e. concurrent creates where the first fails: second is refused, one task only, nothing sent',
      r.every((x) => x.status === 'rejected' && codeOf((x as PromiseRejectedResult).reason) === 'runtime-unsafe') && loggersCreated() === 1 && telemetry().length === 0,
      `loggers=${loggersCreated()}`);
  }

  // ===================================================== 13. cleanup failure
  {
    fresh();
    runtime.modes = ['close-error'];
    const d = await create();
    let threw = false;
    try { d.close(); } catch { threw = true; }
    await fireLoggerTimers();
    check('T13a. close() failure does not throw into the UI', !threw);
    check('T13b. close() failure fails closed: quarantined, guard kept, nothing sent', quarantined() === 'close-failed' && refs() >= 1 && telemetry().length === 0, `q=${quarantined()} refs=${refs()}`);
    let e: any = null;
    try { await create(); } catch (err) { e = err; }
    check('T13c. no further analysis until reload (runtime-unsafe)', codeOf(e) === 'runtime-unsafe');
  }

  // ===================================================== 14. guard reference counting
  {
    fresh();
    const a = await create();
    const b = await create();
    const c = await create();
    const seq = [refs()];
    b.close(); seq.push(refs());
    b.close(); seq.push(refs()); // double close is harmless
    a.close(); seq.push(refs());
    c.close(); seq.push(refs());
    check('T14. reference count 3 -> 2 -> 2 -> 1 -> 0, original fetch restored', JSON.stringify(seq) === '[3,2,2,1,0]' && fetchIsTransport(), JSON.stringify(seq));
  }

  // ===================================================== 15. unrelated Aura networking
  {
    fresh();
    const d = await create();
    runtime.wire = [];
    await fetch('/api/users/location');
    await fetch(`${PAGE_ORIGIN}/api/explore`);
    let xBlocked = false;
    try { await fetch('https://api.example.org/x'); } catch { xBlocked = true; }
    check('T15a. while a detector lives: same-origin app requests pass; cross-origin is blocked (documented)', runtime.wire.length === 2 && xBlocked);
    d.close();
    runtime.wire = [];
    await fetch('https://api.example.org/x');
    await fetch('/api/users/location');
    check('T15b. after a normal close: no interception at all (cross-origin reaches the transport again)', runtime.wire.length === 2 && fetchIsTransport());

    fresh();
    runtime.modes = ['graph-error'];
    try { await create(); } catch { /* expected */ }
    runtime.wire = [];
    await fetch('/api/users/location');
    check('T15c. during quarantine: same-origin app requests still pass', runtime.wire.length === 1 && runtime.wire[0].url === '/api/users/location');
  }

  // ===================================================== 16. payload content
  {
    // Exercise the real logger WITHOUT the guard to capture what it would send.
    fresh();
    const vision: any = requireVision();
    const fileset = await vision.FilesetResolver.forVisionTasks('/palm-dev-assets/mediapipe-1.2.0/wasm');
    const hl = await vision.HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/palm-dev-assets/mediapipe-1.2.0/hand_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 2 });
    try { hl.detect({ width: 640, height: 480 }); } catch { /* fake WASM cannot run inference */ }
    hl.close();
    await settle();
    const sent = telemetry();
    const body = sent[0]?.body ?? new Uint8Array();
    let run = 0, maxRun = 0;
    for (const b of body) { run = b === MODEL_SENTINEL_BYTE ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
    const printable = (Buffer.from(body).toString('latin1').match(/[ -~]{4,}/g) ?? []);
    check('T16a. (unguarded control) the real logger POSTs a small protobuf', sent.length === 1 && body.length > 0 && body.length < 256, `len=${body.length}`);
    check('T16b. payload contains no model/image bytes (no run of the 0xAB sentinel the transport served)', maxRun < 4, `maxRun=${maxRun}`);
    check('T16c. payload has no readable strings beyond the library version', printable.every((s) => s.startsWith('1.2.0') && s.length <= 6) /* '1.2.0' + at most one adjacent protobuf tag byte */, JSON.stringify(printable));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
