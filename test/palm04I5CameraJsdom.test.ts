/**
 * AURA-PALM-04-I5 -- the camera in the real Upload Photo component (jsdom + React 18) with a MOCKED camera and a fake
 * <video> frame: structure and accessibility, explicit-action-only, video-only constraints, the unavailable branch,
 * photo -> shared pipeline, cancel, error states, lifecycle (hidden, pagehide, freeze, unmount), and the static
 * source rules for the UI file. (Real-browser camera journeys: test/palm04I5CameraBrowser.test.ts.)
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/palm04I5CameraJsdom.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { makeHand, makePixels, makePng } from './palmG5I1Fixtures';

const { PalmImageInput, PALM_CAMERA_NOTE, CAMERA_HIDDEN_TEXT, CAMERA_CANCEL_TEXT } = require('../apps/web/components/palm-scan/PalmImageInput');
const ROOT = path.join(__dirname, '..');

let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`OK   ${label}`); } else { failures.push(label); console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
}
const privacy: string[] = [];
(global as any).fetch = () => { privacy.push('fetch'); return new Promise(() => {}); };
(window as any).fetch = (global as any).fetch;
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  const orig = (console as any)[level].bind(console);
  (console as any)[level] = (...args: unknown[]) => { if (typeof args[0] === 'string' && /^(OK|FAIL) {1,3}|^\n?PALM-04-I5/.test(args[0])) return orig(...args); privacy.push(`console.${level}:${String(args[0]).slice(0, 100)}`); return orig(...args); };
}

// synthetic session seams (as the P4-I4 jsdom test)
const draws: unknown[] = [];
const fakeCtx = () => ({ drawImage(src: unknown) { draws.push(src); }, clearRect() {}, setTransform() {}, imageSmoothingQuality: 'low', getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: makePixels(w, h, 'textured'), width: w, height: h }) });
function createCanvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = fakeCtx(); (c as any).getContext = () => ctx; return c as any; }
(window as any).HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
const deps = { detectorFactory: async () => ({ detect: () => [{ landmarks: makeHand(), handednessLabel: 'Left', handednessScore: 0.97 }], close() {} }), normalizeEnv: { createCanvas, decode: async () => ({ width: 1600, height: 1200, source: {}, close() {} }) }, yieldToUi: () => Promise.resolve() };

// a fake <video> frame: jsdom has no media pipeline, so the element reports a frame size once a stream is attached
Object.defineProperty((window as any).HTMLMediaElement.prototype, 'srcObject', { configurable: true, get() { return this.__src ?? null; }, set(v) { this.__src = v; } });
Object.defineProperty((window as any).HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get() { return this.__src ? 1280 : 0; } });
Object.defineProperty((window as any).HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get() { return this.__src ? 960 : 0; } });
Object.defineProperty((window as any).HTMLMediaElement.prototype, 'readyState', { configurable: true, get() { return this.__src ? 4 : 0; } });
let playFails = false; // R1: a terminal preview playback failure
(window as any).HTMLMediaElement.prototype.play = function () { return playFails ? Promise.reject(Object.assign(new Error('mock preview failure'), { name: 'NotSupportedError' })) : Promise.resolve(); };
(window as any).HTMLMediaElement.prototype.pause = function () {};

type Track = { kind: string; readyState: string; stops: number; stop(): void; addEventListener(): void; removeEventListener(): void };
function mockCamera(opts: { reject?: string; delayed?: boolean } = {}) {
  const calls: any[] = [];
  const tracks: Track[] = [];
  const pending: Array<() => void> = [];
  const env = {
    secureContext: true,
    getUserMedia: (c: unknown) => {
      calls.push(JSON.parse(JSON.stringify(c)));
      return new Promise((resolve, reject) => {
        const go = () => {
          if (opts.reject) { reject(Object.assign(new Error('mock'), { name: opts.reject })); return; }
          const t: Track = { kind: 'video', readyState: 'live', stops: 0, stop() { this.stops++; this.readyState = 'ended'; }, addEventListener() {}, removeEventListener() {} };
          tracks.push(t);
          resolve({ getTracks: () => [t] });
        };
        if (opts.delayed) pending.push(go); else go();
      });
    },
  };
  return { env, calls, tracks, pending, live: () => tracks.filter((t) => t.readyState === 'live').length };
}
async function settle(n = 8) { for (let i = 0; i < n; i++) await flush(); }
const q = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
/** Press a control; a missing control is a recorded failure (never an uncaught crash that hides later checks). */
const press = async (c: HTMLElement, id: string) => { const el = q(c, id); if (!el) { check(`(control ${id} is present)`, false); return; } await click(el); await settle(4); };
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1');

/** A camera-CAPABLE environment that counts every acquisition request. */
function countingCamera() {
  const m = mockCamera();
  return m;
}
async function choosePng(c: HTMLElement) {
  const input = c.querySelector<HTMLInputElement>('[data-testid="palm-file-input"]');
  if (!input) { check('(file input is present)', false); return; }
  Object.defineProperty(input, 'files', { value: [new File([Buffer.from(makePng(400, 300))], 'palm.png', { type: 'image/png' })], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(10);
}

async function run() {
  // ---- R1 (50362 F3): automatic start, with a camera-CAPABLE environment
  for (const [runtime, flag] of [['production', 'g5-i1-dev'], ['development', undefined]] as Array<[string, string | undefined]>) {
    process.env.NODE_ENV = runtime;
    if (flag) process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = flag; else delete process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT;
    const m = countingCamera();
    const hh = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: m.env }));
    await settle();
    check(`J20. development gate CLOSED (${runtime}, flag ${flag ?? 'unset'}) with a camera available: nothing renders and the camera is never requested`, hh.container.innerHTML === '' && m.calls.length === 0);
    await hh.unmount();
  }
  process.env.NODE_ENV = 'development';
  process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = 'g5-i1-dev';
  {
    const m = countingCamera();
    const hh = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: m.env }));
    const c0 = hh.container;
    await settle(10);
    check('J21. gate OPEN, camera available: mounting makes ZERO acquisition requests (and nothing is live)', m.calls.length === 0 && m.tracks.length === 0 && !!q(c0, 'palm-camera-button'));
    let picker = 0;
    const input = c0.querySelector<HTMLInputElement>('[data-testid="palm-file-input"]');
    if (input) input.click = () => { picker++; };
    await press(c0, 'palm-upload-button');
    check('J22. pressing Upload photo opens the picker and makes ZERO acquisition requests', picker === 1 && m.calls.length === 0);
    check('J23. the file input still has no capture attribute', !!input && !input.hasAttribute('capture'));
    await choosePng(c0);
    check('J24. choosing and analysing an uploaded photo makes ZERO acquisition requests', !!q(c0, 'palm-result') && m.calls.length === 0);
    await press(c0, 'palm-trace-button');
    await press(c0, 'palm-scanner-restart');
    check('J25. Start over (restart) makes ZERO acquisition requests', !q(c0, 'palm-result') && !q(c0, 'palm-tracing') && m.calls.length === 0);
    await choosePng(c0);
    await press(c0, 'palm-remove-button');
    check('J26. Remove photo makes ZERO acquisition requests', !q(c0, 'palm-preview-canvas') && m.calls.length === 0);
    await press(c0, 'palm-camera-button');
    check('J27. only the explicit Use camera choice requests the camera: exactly one request, video only', m.calls.length === 1 && m.calls[0].audio === false);
    await press(c0, 'palm-camera-cancel');
    await hh.unmount();
  }

  // ---- unavailable (jsdom has no camera API): the G5 upload-only page is unchanged
  {
    const h = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: { secureContext: true, getUserMedia: null } }));
    const c = h.container;
    await settle();
    check('J1. explicitly camera-UNSUPPORTED fixture (no camera API): no camera control at all, an explanation instead, and upload unchanged', !Array.from(c.querySelectorAll('button')).some((b) => /camera/i.test(b.textContent ?? '')) && q(c, 'palm-camera-unavailable')?.getAttribute('data-support') === 'unsupported' && q(c, 'palm-upload-button')?.textContent === 'Upload photo');
    await h.unmount();
  }

  // ---- available: structure, explicit action only, video only
  const cam = mockCamera();
  const h = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: cam.env }));
  const c = h.container;
  await settle();
  const btn = q(c, 'palm-camera-button') as HTMLButtonElement;
  check('J2. one native "Use camera" button, described by the camera note', !!btn && btn.tagName === 'BUTTON' && btn.getAttribute('type') === 'button' && btn.textContent === 'Use camera' && document.getElementById(btn.getAttribute('aria-describedby')!)?.textContent === PALM_CAMERA_NOTE);
  check('J3. the camera note promises no recording, no microphone and nothing uploaded or saved (and no erasure claim)', /No video is recorded/.test(PALM_CAMERA_NOTE) && /microphone is not used/.test(PALM_CAMERA_NOTE) && /nothing is uploaded or saved/.test(PALM_CAMERA_NOTE) && !/erase|wipe|permanent|forensic/i.test(PALM_CAMERA_NOTE));
  check('J4. still exactly one polite live region, and the file input still has no capture attribute', c.querySelectorAll('[role="status"][aria-live="polite"]').length === 1 && !(c.querySelector('input[type="file"]') as HTMLInputElement).hasAttribute('capture'));
  check('J5. mounting asks for nothing', cam.calls.length === 0);
  await press(c, 'palm-camera-button');
  check('J6. Use camera asks once, video only', cam.calls.length === 1 && cam.calls[0].audio === false && !!cam.calls[0].video);
  check('J7. live: the video shows the stream, Take photo and Cancel are offered, upload and the photo controls are hidden', q(c, 'palm-camera')?.getAttribute('data-phase') === 'live' && !!(q(c, 'palm-camera-video') as any)?.srcObject && !!q(c, 'palm-camera-take') && !!q(c, 'palm-camera-cancel') && !q(c, 'palm-upload-button'));
  check('J8. the video element is muted and inline (no audio playback, no full-screen takeover)', (q(c, 'palm-camera-video') as HTMLVideoElement).muted === true && q(c, 'palm-camera-video')!.hasAttribute('playsinline'));
  check('J9. the live status is announced in the single live region', /Camera on/.test(q(c, 'palm-status')!.textContent ?? ''));
  draws.length = 0;
  await press(c, 'palm-camera-take');
  check('J10. Take photo draws the video frame into the pipeline canvas, then the camera is off (track stopped, video gone)', draws.some((d) => (d as Element)?.tagName === 'VIDEO') && cam.live() === 0 && cam.tracks[0].stops === 1 && !q(c, 'palm-camera-video'));
  check('J11. the camera photo is checked by the shared pipeline and offered for a retake', q(c, 'palm-result')?.getAttribute('data-status') !== null && q(c, 'palm-camera-button')?.textContent === 'Retake with camera');
  // cancel
  await press(c, 'palm-camera-button');
  await press(c, 'palm-camera-cancel');
  check('J12. Cancel stops the track and says no photo was taken; the photo stays', cam.live() === 0 && q(c, 'palm-camera-message')?.textContent === CAMERA_CANCEL_TEXT && !!q(c, 'palm-result'));
  // hidden
  await press(c, 'palm-camera-button');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await settle();
  check('J13. a hidden page turns the camera off at once and says why', cam.live() === 0 && q(c, 'palm-camera-message')?.textContent === CAMERA_HIDDEN_TEXT);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  check('J14. becoming visible again does not turn it back on', cam.calls.length === 3 && cam.live() === 0);
  // pagehide
  await press(c, 'palm-camera-button');
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  await settle();
  check('J15. pagehide turns the camera off and clears the photo', cam.live() === 0 && !q(c, 'palm-result') && !q(c, 'palm-preview-canvas'));
  // freeze
  await press(c, 'palm-camera-button');
  await act(async () => { document.dispatchEvent(new Event('freeze')); });
  await settle();
  check('J16. a frozen page turns the camera off', cam.live() === 0 && !q(c, 'palm-camera-video'));
  // unmount while live
  await press(c, 'palm-camera-button');
  await h.unmount();
  await settle();
  check('J17. unmounting while the camera is on stops the track', cam.live() === 0);

  // ---- errors
  for (const [name, code] of [['NotAllowedError', 'camera-denied'], ['NotReadableError', 'camera-busy']] as Array<[string, string]>) {
    const m = mockCamera({ reject: name });
    const hh = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: m.env }));
    await settle();
    await press(hh.container, 'palm-camera-button');
    check(`J18. ${name}: the camera message has ${code}, and it is announced in the live region`, q(hh.container, 'palm-camera-message')?.getAttribute('data-code') === code && (q(hh.container, 'palm-status')?.textContent ?? '').length > 0 && !!q(hh.container, 'palm-upload-button'));
    await hh.unmount();
  }
  // ---- R1 (50362 F1): a terminal preview playback failure
  {
    const m = mockCamera();
    const hh = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: m.env }));
    const c2 = hh.container;
    await settle();
    playFails = true;
    await press(c2, 'palm-camera-button');
    await settle(6);
    check('J28. preview playback fails: the stream\'s track is stopped, the video is gone (detached) and camera-preview-failed is shown', m.tracks.length === 1 && m.tracks[0].readyState === 'ended' && m.tracks[0].stops === 1 && !q(c2, 'palm-camera-video') && q(c2, 'palm-camera-message')?.getAttribute('data-code') === 'camera-preview-failed');
    check('J29. after a preview failure the user can try again or upload', q(c2, 'palm-camera-button')?.textContent === 'Try the camera again' && !!q(c2, 'palm-upload-button'));
    playFails = false;
    await press(c2, 'palm-camera-button');
    check('J30. trying again starts a fresh, live preview (one new request)', m.calls.length === 2 && q(c2, 'palm-camera')?.getAttribute('data-phase') === 'live' && m.tracks[1].readyState === 'live');
    await press(c2, 'palm-camera-take');
    check('J31. and that preview takes a photo normally (camera off afterwards)', m.live() === 0 && !!q(c2, 'palm-preview-canvas'));
    await hh.unmount();
  }
  // ---- delayed grant after unmount
  {
    const m = mockCamera({ delayed: true });
    const hh = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: m.env }));
    await settle();
    await press(hh.container, 'palm-camera-button');
    await hh.unmount();
    m.pending.forEach((go) => go());
    await settle();
    check('J19. a permission grant that arrives after unmount is stopped at once', m.tracks.length === 1 && m.live() === 0);
  }

  // ---- static source rules for the UI file
  const ui = strip(fs.readFileSync(path.join(ROOT, 'apps/web/components/palm-scan/PalmImageInput.tsx'), 'utf8'));
  check('S1. the UI never calls the browser camera API itself (only the camera adapter does)', !/getUserMedia|mediaDevices|ImageCapture|MediaRecorder|enumerateDevices|getDisplayMedia/.test(ui));
  check('S2. the camera starts only from the Use camera button (one start() call site, in openCamera)', (ui.match(/\.start\(\)/g) ?? []).length === 1 && /const openCamera = useCallback\(\(\) => \{[\s\S]{0,120}cameraRef\.current\?\.start\(\)/.test(ui) && /onClick=\{openCamera\}/.test(ui));
  check('S3. the photo is taken by submitDrawable and the camera is stopped right after it', /void session\.submitDrawable\(shot\.drawable, shot\.width, shot\.height, 'camera'\);\s*cam\.stop\('done'\);/.test(ui));
  check('S4. unmount stops the camera before the session is disposed', /cam\.dispose\(\);[\s\S]{0,200}session\.dispose\(\);/.test(ui));
  check('S5. the cleared tracing panel drops its landmark copy (not only on unmount)', /const markCleared = useCallback\(\(\) => \{[\s\S]{0,300}setHeld\(\(h\) => \(h\.data === null \? h : \{ context: h\.context, data: null \}\)\)/.test(ui));
  check('S6. the panel checks revocation on lifecycle events as well as the 250 ms poll', /addEventListener\('visibilitychange', onLifecycle\)/.test(ui) && /addEventListener\('pagehide', onLeave\)/.test(ui) && /addEventListener\('freeze', onLeave\)/.test(ui) && /setInterval\(watch, 250\)/.test(ui));
  check('S7. no image or camera data is logged, stored or sent from the component', privacy.length === 0, privacy);
}

run().then(() => {
  console.log(`\nPALM-04-I5 camera jsdom: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
