/**
 * AURA-PALM-04-I5 -- the camera adapter (apps/web/lib/palm-analysis/camera.ts) with MOCKED streams only: permission
 * granted / denied / unavailable / insecure, every error mapping, constraints (video only, never audio), track cleanup,
 * delayed permission grants and rejections after cancel or unmount, track end, fail-closed audio streams, repeated
 * start, frame readiness, and the hand-off into the real session (submitDrawable) with replacement revoking the old
 * construction context.
 *
 *   npx ts-node test/palm04I5CameraAdapter.test.ts
 */
import { cameraErrorCode, createPalmCamera, palmCameraSupport, PALM_CAMERA_CONSTRAINTS, PALM_CAMERA_PREVIEW_TIMEOUT_MS, PALM_CAMERA_VERSION, type PalmCameraEnv, type PalmStreamLike, type PalmTrackLike, type PalmVideoLike } from '../apps/web/lib/palm-analysis/camera';
import { createPalmAnalysisSession } from '../apps/web/lib/palm-analysis/session';

let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`OK   ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
};

class FakeTrack implements PalmTrackLike {
  readyState = 'live';
  stops = 0;
  private ended = new Set<() => void>();
  constructor(readonly kind: string) {}
  stop() { this.stops++; this.readyState = 'ended'; }
  addEventListener(_t: 'ended', l: () => void) { this.ended.add(l); }
  removeEventListener(_t: 'ended', l: () => void) { this.ended.delete(l); }
  /** the device ends the track by itself (unplugged, OS revoked) */
  end() { this.readyState = 'ended'; for (const l of Array.from(this.ended)) l(); }
  listenerCount() { return this.ended.size; }
}
const streamOf = (...kinds: string[]) => { const tracks = kinds.map((k) => new FakeTrack(k)); return { tracks, stream: { getTracks: () => tracks.slice() } as PalmStreamLike }; };
const domErr = (name: string) => Object.assign(new Error(name), { name });

/** A getUserMedia whose every call is recorded and resolved/rejected by the test. */
function controllableEnv(extra: Partial<PalmCameraEnv> = {}) {
  const calls: unknown[] = [];
  const pending: Array<{ resolve: (s: PalmStreamLike) => void; reject: (e: unknown) => void }> = [];
  const env: PalmCameraEnv = {
    secureContext: true,
    getUserMedia: (c) => { calls.push(JSON.parse(JSON.stringify(c))); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    ...extra,
  };
  return { env, calls, pending };
}
class FakeVideo implements PalmVideoLike {
  private src: unknown = null;
  get srcObject(): unknown { return this.src; }
  set srcObject(v: unknown) { if (v && this.failAttach) throw domErr('TypeError'); this.src = v; }
  muted = false;
  playsInline = false;
  videoWidth = 0;
  videoHeight = 0;
  readyState = 0;
  plays = 0;
  pauses = 0;
  attrs: Record<string, string> = {};
  setAttribute(n: string, v: string) { this.attrs[n] = v; }
  /** R1: how play() behaves -- resolve (default), reject, throw, or a promise the test settles later */
  playMode: 'ok' | 'reject' | 'throw' | 'manual' = 'ok';
  pendingPlays: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  failAttach = false;
  play(): Promise<void> {
    this.plays++;
    if (this.playMode === 'throw') throw domErr('NotSupportedError');
    if (this.playMode === 'reject') return Promise.reject(domErr('NotSupportedError'));
    if (this.playMode === 'manual') return new Promise((resolve, reject) => this.pendingPlays.push({ resolve, reject }));
    return Promise.resolve();
  }
  pause() { this.pauses++; }
  ready(w = 1280, h = 720) { this.videoWidth = w; this.videoHeight = h; this.readyState = 4; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

async function run() {
  // ------------------------------------------------------------------ A. support and constraints
  check('A1. support: available / insecure-context / unsupported', palmCameraSupport({ secureContext: true, getUserMedia: async () => streamOf('video').stream }) === 'available' && palmCameraSupport({ secureContext: false, getUserMedia: async () => streamOf('video').stream }) === 'insecure-context' && palmCameraSupport({ secureContext: true, getUserMedia: null }) === 'unsupported' && palmCameraSupport({ secureContext: true }) === 'unsupported');
  check('A2. the default environment in Node (no navigator.mediaDevices) is unsupported', palmCameraSupport() === 'unsupported');
  check('A3. constraints: video only (audio: false), rear camera preferred, frozen', PALM_CAMERA_CONSTRAINTS.audio === false && (PALM_CAMERA_CONSTRAINTS.video.facingMode as { ideal: string }).ideal === 'environment' && Object.isFrozen(PALM_CAMERA_CONSTRAINTS) && Object.isFrozen(PALM_CAMERA_CONSTRAINTS.video));
  {
    const cam = createPalmCamera({ secureContext: true, getUserMedia: null });
    await cam.start();
    check('A4. unavailable: start() reports camera-unsupported, not retryable, and requests nothing', cam.getState().phase === 'error' && cam.getState().error?.code === 'camera-unsupported' && cam.getState().error?.retryable === false);
    const g = controllableEnv({ secureContext: false });
    const cam2 = createPalmCamera(g.env);
    await cam2.start();
    check('A5. insecure page: camera-insecure-context and getUserMedia is never called', cam2.getState().error?.code === 'camera-insecure-context' && g.calls.length === 0);
  }
  check('A6. error mapping by DOMException name', cameraErrorCode(domErr('NotAllowedError')) === 'camera-denied' && cameraErrorCode(domErr('SecurityError')) === 'camera-denied' && cameraErrorCode(domErr('NotFoundError')) === 'camera-not-found' && cameraErrorCode(domErr('OverconstrainedError')) === 'camera-not-found' && cameraErrorCode(domErr('NotReadableError')) === 'camera-busy' && cameraErrorCode(domErr('AbortError')) === 'camera-busy' && cameraErrorCode(domErr('TypeError')) === 'camera-failed' && cameraErrorCode('x') === 'camera-failed' && cameraErrorCode(null) === 'camera-failed');
  {
    const cam = createPalmCamera(controllableEnv().env);
    check('A7. a new camera is idle and has asked for nothing; toJSON reveals only kind and phase', cam.getState().phase === 'idle' && JSON.stringify(cam) === JSON.stringify({ kind: PALM_CAMERA_VERSION, phase: 'idle' }));
  }

  // ------------------------------------------------------------------ B. permission granted, live, photo, stop
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    cam.attach(video);
    const p = cam.start();
    check('B1. start() asks once, with exactly the video-only constraints', g.calls.length === 1 && JSON.stringify(g.calls[0]) === JSON.stringify(PALM_CAMERA_CONSTRAINTS) && (g.calls[0] as { audio: unknown }).audio === false && cam.getState().phase === 'requesting');
    void cam.start(); void cam.start();
    check('B2. repeated start() while asking does not ask again', g.calls.length === 1);
    const { tracks, stream } = streamOf('video');
    g.pending[0].resolve(stream);
    await p;
    check('B3. granted: live, and the stream is shown muted and inline in the attached video', cam.getState().phase === 'live' && video.srcObject === stream && video.muted && video.playsInline && 'playsinline' in video.attrs && video.plays === 1);
    check('B4. a frame before the video has data is refused as camera-not-ready (camera stays on)', cam.frame() === null && cam.getState().error?.code === 'camera-not-ready' && cam.getState().phase === 'live');
    video.ready(1280, 720);
    const f = cam.frame();
    check('B5. once ready, frame() returns the video itself and its size', !!f && f.drawable === video && f.width === 1280 && f.height === 720);
    cam.stop('done');
    check('B6. stop(): every track stopped, the video detached and paused, the stream dropped', tracks.every((t) => t.stops === 1 && t.readyState === 'ended') && video.srcObject === null && video.pauses >= 1 && cam.getState().phase === 'idle' && cam.getState().stopped === 'done' && cam.frame() === null && cam.liveTrackCount() === 0);
    check('B7. stop() removes the track end listeners', tracks.every((t) => t.listenerCount() === 0));
    cam.stop('cancel'); cam.stop('cancel');
    check('B8. stop() is idempotent (no second stop of a track)', tracks.every((t) => t.stops === 1));
    // repeated capture: a second session of the camera
    const p2 = cam.start();
    check('B9. the camera can be turned on again after taking a photo (retake asks again)', g.calls.length === 2 && cam.getState().phase === 'requesting');
    const s2 = streamOf('video');
    g.pending[1].resolve(s2.stream);
    await p2;
    check('B10. the retake stream is live in the same video', cam.getState().phase === 'live' && video.srcObject === s2.stream);
    cam.dispose();
    check('B11. dispose(): every track stopped, the video detached, and start() can never ask again', s2.tracks.every((t) => t.readyState === 'ended') && video.srcObject === null && cam.disposed && (await cam.start(), g.calls.length === 2));
  }

  // ------------------------------------------------------------------ C. denied, not found, busy
  for (const [name, code, retry] of [['NotAllowedError', 'camera-denied', false], ['NotFoundError', 'camera-not-found', false], ['NotReadableError', 'camera-busy', true], ['Weird', 'camera-failed', true]] as Array<[string, string, boolean]>) {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const p = cam.start();
    g.pending[0].reject(domErr(name));
    await p;
    check(`C. ${name} -> ${code} (retryable ${retry}), nothing live`, cam.getState().phase === 'error' && cam.getState().error?.code === code && cam.getState().error?.retryable === retry && cam.liveTrackCount() === 0);
  }
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const p = cam.start(); g.pending[0].reject(domErr('NotAllowedError')); await p;
    const p2 = cam.start();
    check('C5. after a denial, asking again happens only on a new explicit start()', g.calls.length === 2 && cam.getState().phase === 'requesting');
    g.pending[1].reject(domErr('NotAllowedError')); await p2;
  }

  // ------------------------------------------------------------------ D. delayed completion (cancel, unmount, newer start)
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    cam.attach(video);
    const p = cam.start();
    cam.stop('cancel');
    const late = streamOf('video');
    g.pending[0].resolve(late.stream);
    await p;
    check('D1. a permission grant that arrives after Cancel is stopped at once and never shown', late.tracks.every((t) => t.stops === 1) && video.srcObject === null && cam.getState().phase === 'idle' && cam.liveTrackCount() === 0);
  }
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    cam.attach(video);
    const p = cam.start();
    cam.dispose();
    const late = streamOf('video');
    g.pending[0].resolve(late.stream);
    await p;
    check('D2. a grant that arrives after unmount (dispose) is stopped at once and never shown', late.tracks.every((t) => t.stops === 1) && video.srcObject === null && cam.liveTrackCount() === 0);
  }
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const p = cam.start();
    cam.stop('hidden');
    g.pending[0].reject(domErr('NotAllowedError'));
    await p;
    check('D3. a rejection that arrives after the page was hidden does not resurrect an error state', cam.getState().phase === 'idle' && cam.getState().stopped === 'hidden' && cam.getState().error === null);
  }
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    cam.attach(video);
    const p1 = cam.start();
    cam.stop('cancel');
    const p2 = cam.start();
    const second = streamOf('video');
    g.pending[1].resolve(second.stream);
    await p2;
    const first = streamOf('video');
    g.pending[0].resolve(first.stream);
    await p1;
    check('D4. an OLDER request resolving after a newer one is stopped; the newer stream stays live and shown', first.tracks.every((t) => t.stops === 1) && second.tracks.every((t) => t.stops === 0) && video.srcObject === second.stream && cam.getState().phase === 'live');
    cam.stop();
  }

  // ------------------------------------------------------------------ E. fail closed and track end
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    cam.attach(video);
    const p = cam.start();
    const s = streamOf('video', 'audio');
    g.pending[0].resolve(s.stream);
    await p;
    check('E1. a stream with an audio track (never requested) is stopped entirely and refused', s.tracks.every((t) => t.stops === 1) && cam.getState().error?.code === 'camera-failed' && video.srcObject === null);
  }
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const p = cam.start();
    const s = streamOf();
    g.pending[0].resolve(s.stream);
    await p;
    check('E2. a stream with no video track is refused', cam.getState().error?.code === 'camera-failed');
  }
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    cam.attach(video);
    const p = cam.start();
    const s = streamOf('video');
    g.pending[0].resolve(s.stream);
    await p;
    s.tracks[0].end();
    check('E3. a track that ends by itself turns the camera off with camera-ended (retryable)', cam.getState().phase === 'error' && cam.getState().error?.code === 'camera-ended' && cam.getState().error?.retryable === true && video.srcObject === null);
  }
  {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const v1 = new FakeVideo(), v2 = new FakeVideo();
    cam.attach(v1);
    const p = cam.start();
    const s = streamOf('video');
    g.pending[0].resolve(s.stream); await p;
    cam.attach(v2);
    check('E4. re-attaching moves the stream: the old element is detached', v1.srcObject === null && v2.srcObject === s.stream);
    cam.attach(null);
    check('E5. attach(null) (the video unmounted) detaches it', v2.srcObject === null);
    cam.stop();
    check('E6. stop after detach still stops every track', s.tracks.every((t) => t.readyState === 'ended'));
  }

  // ------------------------------------------------------------------ F. into the real session (submitDrawable)
  {
    const HAND = Array.from({ length: 21 }, (_, k) => ({ x: 0.3 + 0.02 * (k % 7), y: 0.2 + 0.03 * k }));
    const draws: unknown[] = [];
    const canvas = (w: number, h: number) => {
      const c: { width: number; height: number; getContext: () => unknown } = { width: w, height: h, getContext: () => ({ drawImage: (src: unknown) => draws.push(src), clearRect() {}, getImageData: (_x: number, _y: number, W: number, H: number) => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).map((_v, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) }) }) };
      return c as never;
    };
    const session = createPalmAnalysisSession({ detectorFactory: async () => ({ detect: () => [{ landmarks: HAND, handednessLabel: 'Left', handednessScore: 0.9 }], close() {} }) as never, normalizeEnv: { createCanvas: canvas }, isEnabled: () => true, yieldToUi: () => Promise.resolve() });
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    cam.attach(video);
    const p = cam.start(); const s = streamOf('video'); g.pending[0].resolve(s.stream); await p;
    video.ready(1280, 960);
    const shot = cam.frame()!;
    const done = session.submitDrawable(shot.drawable, shot.width, shot.height, 'camera');
    check('F1. submitDrawable draws the video frame into the pipeline canvas synchronously (before the camera turns off)', draws.length === 1 && draws[0] === video);
    cam.stop('done');
    await done;
    const st = session.getState();
    check('F2. the camera photo goes through the shared tail (source camera), and the camera is off', st.frame?.source === 'camera' && (st.phase === 'result' || st.phase === 'error') && s.tracks.every((t) => t.readyState === 'ended'));
    const ctx1 = session.getConstructionContext();
    // retake: a second photo replaces the first
    const p2 = cam.start(); const s2 = streamOf('video'); g.pending[1].resolve(s2.stream); await p2;
    const shot2 = cam.frame()!;
    const done2 = session.submitDrawable(shot2.drawable, shot2.width, shot2.height, 'camera');
    cam.stop('done');
    check('F3. retaking replaces the photo: the old frame is released and its construction context revoked at once', !!st.frame?.released && (ctx1 === null || !ctx1.isActive()));
    await done2;
    session.clear();
    const after = session.getState();
    check('F4. clearing the session leaves no frame, result or construction context', after.frame === null && after.result === null && session.getConstructionContext() === null);
    session.dispose();
  }
  // ------------------------------------------------------------------ G. R1 (50362 F1): preview failure is terminal for its stream
  for (const mode of ['reject', 'throw', 'attach'] as const) {
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    if (mode === 'attach') video.failAttach = true; else video.playMode = mode;
    cam.attach(video);
    const p = cam.start();
    const s = streamOf('video');
    g.pending[0].resolve(s.stream);
    await p;
    await tick();
    const st = cam.getState();
    check(`G1-${mode}. a preview that cannot start (${mode === 'attach' ? 'attaching the stream throws' : `play() ${mode === 'reject' ? 'rejects' : 'throws'}`}) stops every track of that stream, detaches it and reports camera-preview-failed (retryable)`, s.tracks.every((t) => t.stops === 1 && t.readyState === 'ended') && video.srcObject === null && st.phase === 'error' && st.error?.code === 'camera-preview-failed' && st.error?.retryable === true && cam.liveTrackCount() === 0, { st, tracks: s.tracks.map((t) => t.readyState), attached: video.srcObject !== null });
    check(`G2-${mode}. after a preview failure no frame can be taken (nothing live to read)`, cam.frame() === null);
    video.playMode = 'ok'; video.failAttach = false;
    const p2 = cam.start();
    check(`G3-${mode}. the user can try again: one new request`, g.calls.length === 2);
    const s2 = streamOf('video');
    g.pending[1].resolve(s2.stream);
    await p2; await tick();
    check(`G4-${mode}. the retry is live and shown`, cam.getState().phase === 'live' && video.srcObject === s2.stream && s2.tracks[0].readyState === 'live');
    cam.dispose();
  }
  {
    // a STALE playback failure: stream A's play() rejects only after A was stopped and stream B is live
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo();
    video.playMode = 'manual';
    cam.attach(video);
    const pa = cam.start(); const a = streamOf('video'); g.pending[0].resolve(a.stream); await pa;
    const playA = video.pendingPlays[0];
    cam.stop('cancel');
    const pb = cam.start(); const b = streamOf('video'); g.pending[1].resolve(b.stream); await pb;
    video.pendingPlays[1].resolve();
    playA.reject(domErr('NotSupportedError'));
    await tick(); await tick();
    check('G5. a late playback failure from an OLDER stream does not stop, detach or invalidate the newer live stream', cam.getState().phase === 'live' && cam.getState().error === null && video.srcObject === b.stream && b.tracks.every((t) => t.stops === 0 && t.readyState === 'live') && a.tracks.every((t) => t.stops === 1));
    // the same stream re-shown in another element: the first element's late failure is superseded too
    const v2 = new FakeVideo(); v2.playMode = 'manual';
    const playB1 = video.pendingPlays.length;
    cam.attach(v2);
    void playB1;
    v2.pendingPlays[0].resolve();
    await tick();
    check('G6. a late failure of a superseded preview start (re-attached to another element) is ignored', cam.getState().phase === 'live' && v2.srcObject === b.stream && b.tracks[0].readyState === 'live');
    v2.playMode = 'manual';
    cam.attach(v2); // re-show in the same element: a newer preview start
    v2.pendingPlays[0].reject(domErr('AbortError')); // the earlier start's play() is interrupted by the newer one
    await tick();
    check('G7. a play() interrupted by a newer preview start in the same element does not stop the stream', cam.getState().phase === 'live' && b.tracks[0].readyState === 'live');
    v2.pendingPlays[1].reject(domErr('NotSupportedError'));
    await tick();
    check('G8. but the CURRENT preview start failing is terminal for the current stream', cam.getState().error?.code === 'camera-preview-failed' && b.tracks.every((t) => t.readyState === 'ended') && v2.srcObject === null);
    cam.dispose();
  }
  {
    // cancellation, photo and teardown still work with a preview whose play() is still pending
    const g = controllableEnv();
    const cam = createPalmCamera(g.env);
    const video = new FakeVideo(); video.playMode = 'manual';
    cam.attach(video);
    const p = cam.start(); const s = streamOf('video'); g.pending[0].resolve(s.stream); await p;
    video.ready();
    const f = cam.frame();
    cam.stop('done');
    video.pendingPlays[0].reject(domErr('AbortError'));
    await tick();
    check('G9. photo then a late play() rejection: the camera stays cleanly off (idle, no error), every track ended', !!f && cam.getState().phase === 'idle' && cam.getState().error === null && s.tracks.every((t) => t.readyState === 'ended'));
    cam.dispose();
  }

  // ------------------------------------------------------------------ H. R1 (50362 F2): the DEFAULT browser surface, behaviourally
  {
    const g = globalThis as { navigator?: unknown; isSecureContext?: unknown };
    const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const savedSecure = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
    let acquisitions = 0;
    const handed: Array<ReturnType<typeof streamOf>> = [];
    let next: 'video' | 'mixed' = 'video';
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: (c: unknown) => { acquisitions++; void c; const s = next === 'mixed' ? streamOf('video', 'audio') : streamOf('video'); handed.push(s); return Promise.resolve(s.stream); } } } });
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
    try {
      check('H1. the default environment finds the (installed) browser camera API', palmCameraSupport() === 'available');
      const cam = createPalmCamera();
      check('H2. creating the camera requests nothing', acquisitions === 0);
      await cam.start();
      check('H3. exactly ONE browser acquisition request for one explicit start (default surface)', acquisitions === 1 && cam.getState().phase === 'live', { acquisitions });
      await cam.start(); await cam.start();
      check('H4. further start() calls while live request nothing more', acquisitions === 1);
      cam.stop('done');
      await cam.start();
      check('H5. one more request per accepted explicit start (2 starts -> 2 requests), every earlier track stopped', acquisitions === 2 && handed[0].tracks.every((t) => t.readyState === 'ended'));
      cam.stop('done');
      next = 'mixed';
      await cam.start();
      const mixed = handed[handed.length - 1];
      check('H6. a mixed video+audio stream from the browser is rejected and EVERY acquired track (video and audio) is stopped', acquisitions === 3 && cam.getState().error?.code === 'camera-failed' && mixed.tracks.length === 2 && mixed.tracks.every((t) => t.stops === 1 && t.readyState === 'ended') && cam.liveTrackCount() === 0);
      cam.dispose();
      check('H7. no track handed out by the browser is left live', handed.every((h) => h.tracks.every((t) => t.readyState === 'ended')));
    } finally {
      if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav); else delete g.navigator;
      if (savedSecure) Object.defineProperty(globalThis, 'isSecureContext', savedSecure); else delete g.isSecureContext;
    }
  }
  // ------------------------------------------------------------------ K. D6-I1 DR-1: bounded preview start-up (fake timers)
  {
    /** Fake timers; `honourClear: false` simulates a late callback delivered after it was cancelled. */
    const timers = (honourClear = true) => {
      const list: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
      return { list, setTimer: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; list.push(t); return t; }, clearTimer: (h: any) => { if (honourClear) h.cleared = true; }, fire: (k: number) => { const t = list[k]; if (t && !t.cleared) t.fn(); } };
    };
    const liveCamera = async (T: ReturnType<typeof timers>, extra: Record<string, unknown> = {}) => {
      const g = controllableEnv({ setTimer: T.setTimer, clearTimer: T.clearTimer, ...extra } as any);
      const cam = createPalmCamera(g.env);
      const video = new FakeVideo();
      cam.attach(video);
      const p = cam.start(); const s = streamOf('video'); g.pending[0].resolve(s.stream); await p;
      return { g, cam, video, s };
    };
    check('K0. the DR-1 limit is 8 seconds', PALM_CAMERA_PREVIEW_TIMEOUT_MS === 8000);
    {
      const T = timers(); const { cam, video, s } = await liveCamera(T);
      check('K1. once the stream is acquired and live, one start-up timer is set at the 8 s default', T.list.length === 1 && T.list[0].ms === 8000 && cam.getState().phase === 'live');
      T.fire(0);
      const st = cam.getState();
      check('K2. no usable frame by the deadline: every track stopped, the stream detached, camera-preview-timeout (retryable)', st.phase === 'error' && st.error?.code === 'camera-preview-timeout' && st.error?.retryable === true && s.tracks.every((t) => t.readyState === 'ended' && t.stops === 1) && video.srcObject === null && cam.liveTrackCount() === 0);
      cam.dispose();
    }
    {
      const T = timers(); const { cam, video, s } = await liveCamera(T);
      video.ready();
      T.fire(0);
      check('K3. a usable frame before the deadline: the timer does nothing (still live, attached)', cam.getState().phase === 'live' && cam.getState().error === null && video.srcObject === s.stream && s.tracks[0].readyState === 'live');
      cam.dispose();
    }
    {
      const T = timers(); const { cam, s } = await liveCamera(T);
      cam.stop('cancel');
      check('K4. Cancel clears the timer', T.list[0].cleared === true && s.tracks[0].readyState === 'ended');
      cam.dispose();
    }
    {
      const T = timers(false); // a late callback is delivered even though it was cancelled
      const { g, cam, video } = await liveCamera(T);
      cam.stop('cancel');
      const p2 = cam.start(); const s2 = streamOf('video'); g.pending[1].resolve(s2.stream); await p2;
      T.fire(0); // session 1's late timer
      check('K5. a stale timer from an earlier camera session cannot stop, detach or fail the newer session', cam.getState().phase === 'live' && cam.getState().error === null && video.srcObject === s2.stream && s2.tracks[0].readyState === 'live');
      T.fire(1);
      check('K6. the newer session\'s own timer still applies to it (no usable frame -> timeout)', cam.getState().error?.code === 'camera-preview-timeout' && s2.tracks[0].readyState === 'ended');
      cam.dispose();
    }
    {
      const T = timers(false); const { cam, video, s } = await liveCamera(T);
      video.ready(); const f = cam.frame(); cam.stop('done');
      video.videoWidth = 0; T.fire(0);
      check('K7. a photo cancels it: a late timer after the photo changes nothing (idle, no error)', !!f && cam.getState().phase === 'idle' && cam.getState().error === null && s.tracks[0].readyState === 'ended');
      cam.dispose();
    }
    {
      const T = timers(); const { cam } = await liveCamera(T);
      cam.dispose();
      check('K8. dispose cancels the timer', T.list[0].cleared === true);
    }
    {
      const T = timers(); const { g, cam, video } = await liveCamera(T, { previewTimeoutMs: 600 });
      check('K9. the limit is configurable for tests only through the camera environment', T.list[0].ms === 600);
      T.fire(0);
      const p2 = cam.start(); const s2 = streamOf('video'); g.pending[1].resolve(s2.stream); await p2;
      check('K10. after a timeout the user can try again: a fresh, live session with its own timer', cam.getState().phase === 'live' && video.srcObject === s2.stream && T.list.length === 2);
      cam.dispose();
    }
  }
  await tick();
}

run().then(() => {
  console.log(`\nPALM-04-I5 camera adapter: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
