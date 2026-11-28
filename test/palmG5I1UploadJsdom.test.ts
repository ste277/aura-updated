/**
 * AURA-PALM-G5-I1 -- mounted-component integration tests (jsdom + React 18
 * via test/jsdomReactHarness.ts) for Upload Photo: gate enforcement, file
 * selection, preview, loading state, quality feedback, remove/reselect,
 * error recovery, model-failure retry, focus/labels, cleanup on exit and the
 * privacy assertions (no network, no storage, no logging).
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/palmG5I1UploadJsdom.test.ts
 *
 * Scope (stated honestly): jsdom has no canvas pixels, no layout and no WASM,
 * so the decoder, canvas 2D context and hand detector are test doubles behind
 * the pipeline's own injection seams (the same interfaces the real
 * createImageBitmap / canvas / MediaPipe implementations satisfy). Real
 * decoding, real MediaPipe inference, layout, overflow and touch-target sizes
 * are verified in a real Chromium build (12_BROWSER_VALIDATION.md).
 */
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { makeHand, makePixels, makePng } from './palmG5I1Fixtures';

const { PalmImageInput } = require('../apps/web/components/palm-scan/PalmImageInput');
const { PalmistryView } = require('../apps/web/components/PalmistryView');

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) { passed++; console.log(`OK   ${label}`); } else { failed++; console.log(`FAIL ${label}`); }
}

// ---------------------------------------------------------------- privacy spies
const fetchCalls: string[] = [];
(global as any).fetch = (url: string) => { fetchCalls.push(String(url)); return new Promise(() => {}); };
(window as any).fetch = (global as any).fetch;
const xhrOpens: string[] = [];
const origOpen = (window as any).XMLHttpRequest.prototype.open;
(window as any).XMLHttpRequest.prototype.open = function (m: string, u: string, ...rest: unknown[]) { xhrOpens.push(String(u)); return origOpen.call(this, m, u, ...rest); };
const beacons: string[] = [];
(window.navigator as any).sendBeacon = (u: string) => { beacons.push(String(u)); return true; };
const consoleCalls: { level: string; args: unknown[] }[] = [];
for (const level of ['log', 'info', 'debug', 'warn'] as const) {
  const orig = (console as any)[level].bind(console);
  (console as any)[level] = (...args: unknown[]) => {
    // Our own OK/FAIL lines are printed with console.log from this file; record only others.
    if (typeof args[0] === 'string' && /^(OK|FAIL) {1,3}|^\n?\d+ passed/.test(args[0])) return orig(...args);
    consoleCalls.push({ level, args });
    return orig(...args);
  };
}

// ---------------------------------------------------------------- test doubles
function fakeCtx() {
  return {
    drawImage() {},
    clearRect() {},
    setTransform() {},
    imageSmoothingQuality: 'low',
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: makePixels(w, h, 'textured'), width: w, height: h }),
  };
}
const liveCanvases: HTMLCanvasElement[] = [];
function createCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = fakeCtx();
  (c as any).getContext = () => ctx;
  liveCanvases.push(c);
  return c as any;
}
const decode = async () => ({ width: 1600, height: 1200, source: {}, close() {} });

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeDetectorControl() {
  const ctl = {
    hands: [{ landmarks: makeHand(), handednessLabel: 'Left', handednessScore: 0.97 }] as any[],
    factoryCalls: 0,
    closed: 0,
    load: null as null | ReturnType<typeof deferred<any>>,
    failNext: 0,
    factory: async () => {
      ctl.factoryCalls++;
      if (ctl.failNext > 0) { ctl.failNext--; throw new Error('model file missing'); }
      const det = { detect: () => ctl.hands, close: () => { ctl.closed++; } };
      if (ctl.load) return ctl.load.promise.then(() => det);
      return det;
    },
  };
  return ctl;
}

const pngFile = () => new File([Buffer.from(makePng(400, 300))], 'palm.png', { type: 'image/png' });

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await flush();
}

async function choose(container: HTMLElement, file: File) {
  const input = container.querySelector<HTMLInputElement>('[data-testid="palm-file-input"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

const q = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

async function run() {
  // ============================================================ A. gate
  delete process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT;
  process.env.NODE_ENV = 'test';
  {
    const h = await mount(React.createElement(PalmImageInput, {}));
    check('A1. gate closed (not development): Upload Photo renders nothing', h.container.innerHTML === '');
    await h.unmount();
    const g = await mount(React.createElement(PalmistryView, { onBack: () => {} }));
    check('A2. gate closed: the Palmistry guide renders without any image input', !q(g.container, 'palm-image-input') && /Palmistry/.test(g.container.textContent ?? '') && !g.container.querySelector('input[type="file"]'));
    await g.unmount();
  }
  process.env.NODE_ENV = 'development';
  {
    const h = await mount(React.createElement(PalmImageInput, {}));
    check('A3. development without the explicit opt-in flag: still nothing', h.container.innerHTML === '');
    await h.unmount();
  }
  process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = 'g5-i1-dev';
  {
    const g = await mount(React.createElement(PalmistryView, { onBack: () => {} }));
    check('A4. development + opt-in: the section mounts inside the Palmistry screen', Boolean(q(g.container, 'palm-image-input')));
    await g.unmount();
  }

  // ============================================================ B. structure + a11y
  const ctl = makeDetectorControl();
  const deps = { detectorFactory: ctl.factory, normalizeEnv: { createCanvas, decode }, yieldToUi: () => Promise.resolve() };
  // AURA-PALM-04-I5-R1 (50362 F3): this G5 upload suite runs with an EXPLICITLY camera-unsupported fixture (no browser
  // camera API), instead of relying on jsdom happening to lack one. The camera-capable cases -- development gate closed
  // and open, mount / upload / restart, explicit start -- are in test/palm04I5CameraJsdom.test.ts (J20-J27).
  const UNSUPPORTED_CAMERA = Object.freeze({ secureContext: true, getUserMedia: null });
  const h = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: UNSUPPORTED_CAMERA }));
  const c = h.container;
  const uploadBtn = () => q(c, 'palm-upload-button') as HTMLButtonElement;
  await flush();
  check('B6-fixture. (P4-I5-R1) the fixture is explicitly camera-unsupported, and the page says only upload is offered', q(c, 'palm-camera-unavailable')?.getAttribute('data-support') === 'unsupported');
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  check('B1. section is labelled by its heading', (() => { const s = q(c, 'palm-image-input')!; const id = s.getAttribute('aria-labelledby'); return Boolean(id) && document.getElementById(id!)?.textContent === 'Check a palm photo'; })());
  check('B2. Upload photo is a native button with a visible name', uploadBtn().tagName === 'BUTTON' && uploadBtn().getAttribute('type') === 'button' && uploadBtn().textContent === 'Upload photo');
  check('B3. button is described by the format hint and the privacy note', (uploadBtn().getAttribute('aria-describedby') ?? '').split(' ').every((id) => Boolean(document.getElementById(id))) && /not uploaded or saved/.test(uploadBtn().getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent).join(' ')));
  check('B4. file input: JPEG/PNG/WebP only, NO capture attribute', input.getAttribute('accept') === 'image/jpeg,image/png,image/webp' && !input.hasAttribute('capture'));
  check('B5. hidden native input is out of the tab order and hidden from AT (the button is the control)', input.tabIndex === -1 && input.getAttribute('aria-hidden') === 'true');
  check('B6. no camera / scan control exists', !Array.from(c.querySelectorAll('button')).some((b) => /camera|scan/i.test(b.textContent ?? '')));
  check('B7. one polite live region for status', c.querySelectorAll('[role="status"][aria-live="polite"]').length === 1);
  check('B8. development-only privacy wording is shown and does not over-claim erasure', /checked on this device/.test(q(c, 'palm-privacy-note')!.textContent!) && !/permanently|forensic|securely erased|wiped/i.test(q(c, 'palm-privacy-note')!.textContent!));
  check('B9. model is not loaded just by opening the screen (lazy)', ctl.factoryCalls === 0);

  let pickerOpened = 0;
  input.click = () => { pickerOpened++; };
  await click(uploadBtn());
  check('B10. Upload photo opens the system file picker', pickerOpened === 1);

  // ============================================================ C. select -> loading -> feedback
  ctl.load = deferred<void>();
  await choose(c, pngFile());
  check('C1. loading state: status announces the on-device model load', /Loading the on-device hand model/.test(q(c, 'palm-status')!.textContent!) && q(c, 'palm-preview')!.getAttribute('aria-busy') === 'true');
  const preview = q(c, 'palm-preview-canvas') as HTMLCanvasElement | null;
  check('C2. preview shows the normalised canvas with an accessible label', Boolean(preview) && preview!.getAttribute('role') === 'img' && preview!.getAttribute('aria-label') === 'Preview of the selected photo');
  check('C3. while busy the user can already remove or replace the photo', Boolean(q(c, 'palm-remove-button')) && uploadBtn().textContent === 'Choose another photo');
  ctl.load.resolve(undefined);
  ctl.load = null;
  await settle();
  const result = q(c, 'palm-result');
  check('C4. accepted feedback after analysis', result?.getAttribute('data-status') === 'accepted' && q(c, 'palm-result-heading')!.textContent === 'Palm image looks suitable for further analysis.');
  check('C5. focus moves to the outcome heading', document.activeElement === q(c, 'palm-result-heading'));
  check('C6. scope note: quality only, no line reading or prediction', /does not read palm lines/.test(q(c, 'palm-scope-note')!.textContent!));
  check('C7. a positioning outline is drawn from the coarse palm box', Boolean(q(c, 'palm-box-outline')));
  check('C8. no personality / relationship / career / future wording anywhere', !/personality|relationship|career|your future|destiny|lifespan|diagnos|identity|biometric/i.test(c.textContent ?? ''));

  // ============================================================ D. remove + reselect + other feedback
  const shownCanvas = q(c, 'palm-preview-canvas') as HTMLCanvasElement;
  await click(q(c, 'palm-remove-button')!);
  await settle();
  check('D1. remove clears preview, result and status', !q(c, 'palm-preview-canvas') && !q(c, 'palm-result') && q(c, 'palm-status')!.textContent === '');
  check('D2. removed image canvas is zeroed (pixel buffer released)', shownCanvas.width === 0 && shownCanvas.height === 0);
  check('D3. focus returns to Upload photo after removal', document.activeElement === uploadBtn() && uploadBtn().textContent === 'Upload photo');

  ctl.hands = [];
  await choose(c, pngFile());
  check('D4. reselect: no hand -> clear guidance', q(c, 'palm-result')?.getAttribute('data-status') === 'no-hand' && /No hand detected/.test(q(c, 'palm-result-heading')!.textContent!));
  ctl.hands = [{ landmarks: makeHand(), handednessLabel: 'Left' }, { landmarks: makeHand({ dx: 0.2 }), handednessLabel: 'Right' }];
  await choose(c, pngFile());
  check('D5. multiple hands -> asks for one hand', q(c, 'palm-result')?.getAttribute('data-status') === 'multiple-hands');
  ctl.hands = [{ landmarks: makeHand({ rotateDeg: 90, scale: 0.3 }), handednessLabel: 'Left' }];
  await choose(c, pngFile());
  const issues = Array.from(c.querySelectorAll('[data-issue]')).map((li) => li.getAttribute('data-issue'));
  check('D6. poorly positioned hand -> needs-retake with specific issues listed', q(c, 'palm-result')?.getAttribute('data-status') === 'needs-retake' && issues.includes('hand-rotated') && issues.includes('hand-too-small'));
  check('D7. only one preview canvas is ever attached', c.querySelectorAll('canvas').length === 1);
  const prior = liveCanvases.slice(0, -1);
  check('D8. every replaced image canvas was released', prior.every((cv) => cv.width === 0 && cv.height === 0));

  // ============================================================ E. errors + recovery
  await choose(c, new File([] as BlobPart[], 'empty.png', { type: 'image/png' }));
  check('E1. empty file -> alert with message, focus on it', q(c, 'palm-error')?.getAttribute('data-code') === 'empty-file' && q(c, 'palm-error')!.getAttribute('role') === 'alert' && document.activeElement === q(c, 'palm-error-heading'));
  check('E2. an invalid file never shows a preview', !q(c, 'palm-preview-canvas'));
  await choose(c, new File([Buffer.from('not an image at all')], 'notes.jpg', { type: 'image/jpeg' }));
  check('E3. unsupported file -> unsupported-format message', q(c, 'palm-error')?.getAttribute('data-code') === 'unsupported-format');
  ctl.hands = [{ landmarks: makeHand(), handednessLabel: 'Left' }];
  await choose(c, pngFile());
  check('E4. recovery: the next valid photo is analysed normally', q(c, 'palm-result')?.getAttribute('data-status') === 'accepted');

  // ============================================================ F. exit cleanup
  const lastCanvas = q(c, 'palm-preview-canvas') as HTMLCanvasElement;
  const closedBefore = ctl.closed;
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  await settle();
  check('F1. pagehide clears the image and derived data', !q(c, 'palm-preview-canvas') && !q(c, 'palm-result') && lastCanvas.width === 0);
  await choose(c, pngFile());
  const beforeExit = q(c, 'palm-preview-canvas') as HTMLCanvasElement;
  await h.unmount();
  check('F2. leaving Palmistry (unmount) releases the image and closes the model', beforeExit.width === 0 && beforeExit.height === 0 && ctl.closed === closedBefore + 1);
  check('F3. no canvas remains in the document after exit', document.querySelectorAll('canvas').length === 0);

  // ============================================================ G. model failure + retry
  {
    const ctl2 = makeDetectorControl();
    ctl2.failNext = 1;
    const h2 = await mount(React.createElement(PalmImageInput, { sessionDeps: { detectorFactory: ctl2.factory, normalizeEnv: { createCanvas, decode }, yieldToUi: () => Promise.resolve() } }));
    await choose(h2.container, pngFile());
    check('G1. model load failure: friendly retryable error, photo kept', q(h2.container, 'palm-error')?.getAttribute('data-code') === 'analysis-failed' || q(h2.container, 'palm-error')?.getAttribute('data-code') === 'model-unavailable');
    check('G2. Try again is offered next to Remove/Choose another', Boolean(q(h2.container, 'palm-retry-button')) && Boolean(q(h2.container, 'palm-remove-button')) && Boolean(q(h2.container, 'palm-preview-canvas')));
    await click(q(h2.container, 'palm-retry-button')!);
    await settle();
    check('G3. Try again reloads the model and completes the check', ctl2.factoryCalls === 2 && q(h2.container, 'palm-result')?.getAttribute('data-status') === 'accepted');
    await h2.unmount();
  }

  // ============================================================ H. rapid replacement through the UI
  {
    const ctl3 = makeDetectorControl();
    const slow = deferred<void>();
    let n = 0;
    const decodeSlowFirst = async () => { if (n++ === 0) await slow.promise; return { width: 1600, height: 1200, source: {}, close() {} }; };
    const h3 = await mount(React.createElement(PalmImageInput, { sessionDeps: { detectorFactory: ctl3.factory, normalizeEnv: { createCanvas, decode: decodeSlowFirst }, yieldToUi: () => Promise.resolve() } }));
    const before = liveCanvases.length;
    await choose(h3.container, pngFile());
    ctl3.hands = [];
    await choose(h3.container, pngFile());
    const shown = q(h3.container, 'palm-result')?.getAttribute('data-status');
    slow.resolve();
    await settle();
    check('H1. second photo wins; first (slower) photo never replaces it', shown === 'no-hand' && q(h3.container, 'palm-result')?.getAttribute('data-status') === 'no-hand');
    const created = liveCanvases.slice(before);
    check('H2. the stale first photo was decoded but released, never displayed', created.length === 2 && created.filter((cv) => cv.width === 0).length === 1 && h3.container.querySelectorAll('canvas').length === 1);
    await h3.unmount();
  }

  // ============================================================ I. privacy
  check('I1. no fetch() requests were made', fetchCalls.length === 0);
  check('I2. no XMLHttpRequest was opened', xhrOpens.length === 0);
  check('I3. no beacon was sent', beacons.length === 0);
  check('I4. nothing written to localStorage / sessionStorage', window.localStorage.length === 0 && window.sessionStorage.length === 0);
  check('I5. no cookies set', document.cookie === '');
  check('I6. no console log/info/debug/warn output from the feature (no landmark or image logging)', consoleCalls.length === 0);
  if (consoleCalls.length) console.error(consoleCalls.map((x) => `${x.level}: ${String(x.args[0]).slice(0, 120)}`).join('\n'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
