/**
 * AURA-PALM-04-I2 -- the tracing overlay mounted inside the real Upload Photo flow (jsdom + React 18 via
 * test/jsdomReactHarness.ts), with synthetic fixtures behind the session's injection seams (as in the G5 upload
 * test). Pointer input is dispatched as real DOM pointer events at client positions computed by an independent
 * contain oracle; jsdom has no layout, so the stage's box is fixed by a getBoundingClientRect stub. Real layout,
 * device pixel ratios, touch and screenshots are covered in a real browser (test/palm04I2TracingBrowser.test.ts).
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/palm04I2TracingUiJsdom.test.ts
 */
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { makeHand, makePixels, makePng } from './palmG5I1Fixtures';
import { buildPalmFeatureSet } from '../apps/web/lib/palm-analysis/features';
import { LINE_UNASSESSED_REASONS } from '../apps/web/lib/palm-analysis/features';

const { PalmImageInput, PLACEMENT_TEXT, PLACEMENT_OK_TEXT, TRACING_SCOPE_NOTE } = require('../apps/web/components/palm-scan/PalmImageInput');

let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`OK   ${label}`); } else { failures.push(label); console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
}

// ---------------------------------------------------------------- privacy spies
const privacy: string[] = [];
(global as any).fetch = () => { privacy.push('fetch'); return new Promise(() => {}); };
(window as any).fetch = (global as any).fetch;
(window.navigator as any).sendBeacon = () => { privacy.push('sendBeacon'); return true; };
for (const m of ['setItem', 'getItem', 'removeItem', 'clear'] as const) { const o = (window as any).Storage.prototype[m]; (window as any).Storage.prototype[m] = function (...a: unknown[]) { privacy.push(`storage.${m}`); return o.apply(this, a); }; }
{ const d = Object.getOwnPropertyDescriptor((window as any).Document.prototype, 'cookie')!; Object.defineProperty(document, 'cookie', { get() { privacy.push('cookie.get'); return d.get!.call(document); }, set(v) { privacy.push('cookie.set'); d.set!.call(document, v); } }); }
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  const orig = (console as any)[level].bind(console);
  (console as any)[level] = (...args: unknown[]) => { if (typeof args[0] === 'string' && /^(OK|FAIL) {1,3}|^\n?PALM-04-I2/.test(args[0])) return orig(...args); privacy.push(`console.${level}:${String(args[0]).slice(0, 100)}`); return orig(...args); };
}

// ---------------------------------------------------------------- synthetic session seams (as the G5 upload test)
const fakeCtx = () => ({ drawImage() {}, clearRect() {}, setTransform() {}, imageSmoothingQuality: 'low', getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: makePixels(w, h, 'textured'), width: w, height: h }) });
function createCanvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = fakeCtx(); (c as any).getContext = () => ctx; return c as any; }
// jsdom has no canvas: the overlay's own photo canvas gets a no-op 2D context too.
(window as any).HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
const decode = async () => ({ width: 1600, height: 1200, source: {}, close() {} });
let hands: any[] = [{ landmarks: makeHand(), handednessLabel: 'Left', handednessScore: 0.97 }];
const deps = { detectorFactory: async () => ({ detect: () => hands, close() {} }), normalizeEnv: { createCanvas, decode }, yieldToUi: () => Promise.resolve() };
const pngFile = () => new File([Buffer.from(makePng(400, 300))], 'palm.png', { type: 'image/png' });

// The stage's layout box (jsdom has none): a 360 x 480 phone-sized stage at (12, 200).
const STAGE = { left: 12, top: 200, width: 360, height: 480 };
const origRect = (window as any).HTMLElement.prototype.getBoundingClientRect;
(window as any).HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.getAttribute && this.getAttribute('data-testid') === 'palm-tracing-stage') return { ...STAGE, x: STAGE.left, y: STAGE.top, right: STAGE.left + STAGE.width, bottom: STAGE.top + STAGE.height, toJSON() {} };
  return origRect.call(this);
};

async function settle(n = 8) { for (let i = 0; i < n; i++) await flush(); }
const q = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
async function choose(c: HTMLElement, file: File) {
  const input = c.querySelector<HTMLInputElement>('[data-testid="palm-file-input"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
}
function pointer(target: Element, type: string, x: number, y: number, opts: { id?: number; primary?: boolean; kind?: string } = {}) {
  const e = new (window as any).MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: opts.id ?? 1 });
  Object.defineProperty(e, 'isPrimary', { value: opts.primary ?? true });
  Object.defineProperty(e, 'pointerType', { value: opts.kind ?? 'touch' });
  target.dispatchEvent(e);
}
const oracle = (W: number, H: number) => { const s = Math.min(STAGE.width / W, STAGE.height / H); return { left: STAGE.left + (STAGE.width - W * s) / 2, top: STAGE.top + (STAGE.height - H * s) / 2, width: W * s, height: H * s }; };

async function run() {
  process.env.NODE_ENV = 'development';
  process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = 'g5-i1-dev';
  const h = await mount(React.createElement(PalmImageInput, { sessionDeps: deps }));
  const c = h.container;
  check('K0. no tracing control before a photo is analysed', !q(c, 'palm-trace-button') && !q(c, 'palm-tracing'));
  await choose(c, pngFile());
  check('K1. after an analysed photo with one hand, the development tracing control appears', !!q(c, 'palm-trace-button') && q(c, 'palm-result')?.getAttribute('data-status') === 'accepted');
  await click(q(c, 'palm-trace-button')!); await settle();
  const stage = () => q(c, 'palm-tracing-stage')!;
  const photo = q(c, 'palm-tracing-photo') as HTMLCanvasElement;
  const W = photo?.width ?? 0, H = photo?.height ?? 0;
  check('K2. opening tracing shows the panel on the analysed photo (its own size) and hides the plain preview', !!q(c, 'palm-tracing') && q(c, 'palm-tracing')!.getAttribute('data-state') === 'active' && W > 0 && H > 0 && (q(c, 'palm-preview') as HTMLElement).hidden);
  const O = oracle(W, H);
  check('K3. the photo is placed at the contain rectangle of the stage (no distortion)', Math.abs(parseFloat(photo.style.left) - (O.left - STAGE.left)) < 1e-6 && Math.abs(parseFloat(photo.style.width) - O.width) < 1e-6 && Math.abs(parseFloat(photo.style.height) - O.height) < 1e-6);
  const hand = makeHand();
  const guideOk = ([['index', 5], ['middle', 9], ['ring', 13], ['little', 17], ['wrist', 0]] as Array<[string, number]>).every(([n, k]) => { const g = c.querySelector(`[data-guide="${n}"]`)!; return Math.abs(Number(g.getAttribute('cx')) / W - hand[k].x) < 1e-9 && Math.abs(Number(g.getAttribute('cy')) / H - hand[k].y) < 1e-9; });
  check('K4. the five guides are drawn at the detector landmarks, in the photo\'s own coordinates', guideOk);
  check('K5. progress: four steps (heart, head, life, optional upward), line 1 of 4', c.querySelectorAll('[data-testid^="palm-tracing-step-"]').length === 4 && /Line 1 of 4/.test(q(c, 'palm-tracing-progress')!.textContent!) && /optional/.test(q(c, 'palm-tracing-step-upward')!.textContent!));

  // taps at exact client positions
  const HEART = [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]].map(([x, y]) => ({ x, y }));
  const at = (p: { x: number; y: number }) => ({ x: O.left + p.x * O.width, y: O.top + p.y * O.height });
  const tap = async (p: { x: number; y: number }, opts = {}) => { const q2 = at(p); await act(async () => { pointer(stage(), 'pointerdown', q2.x, q2.y, opts); pointer(stage(), 'pointerup', q2.x, q2.y, opts); }); await settle(2); };
  const trace = (line: string) => { const el = c.querySelector(`[data-trace="${line}"]`); return el ? el.getAttribute('points')!.trim().split(/\s+/).map((s) => { const [x, y] = s.split(',').map(Number); return { x: x / W, y: y / H }; }) : null; };
  for (const p of HEART) await tap(p);
  const rec = trace('heart');
  check('K6. taps record the intended normalised points exactly (coordinate transform round trip < 1e-9)', !!rec && rec.length === 4 && rec.every((p, k) => Math.abs(p.x - HEART[k].x) < 1e-9 && Math.abs(p.y - HEART[k].y) < 1e-9), rec);
  // identical normalised traces give identical I1 outcomes: through the UI vs direct
  const base = { hand: 'left' as const, dominantHand: 'unknown' as const, landmarks: hand, imageWidth: W, imageHeight: H, qualityIssues: [] as any[], rotationDeg: 0, handednessLabel: 'Left', marks: [] as any[] };
  const viaUi = buildPalmFeatureSet({ ...base, lines: [{ line: 'heart', action: 'traced', points: rec!, confirmed: true }] } as any);
  const direct = buildPalmFeatureSet({ ...base, lines: [{ line: 'heart', action: 'traced', points: HEART, confirmed: true }] } as any);
  check('K7. the UI does not change measurement outcomes: the trace it records builds the same I1 feature set as the intended trace', JSON.stringify(viaUi) === JSON.stringify(direct) && viaUi.ok && (viaUi as any).featureSet.lines.heart.provenance === 'user-confirmed');
  check('K8. live validation shows I1\'s verdict with words and a symbol, not colour alone', q(c, 'palm-tracing-feedback')!.getAttribute('data-placement') === 'ok' && q(c, 'palm-tracing-feedback')!.textContent!.includes(PLACEMENT_OK_TEXT) && /✓/.test(q(c, 'palm-tracing-feedback')!.textContent!));
  // secondary pointer ignored; cancelled gesture discarded
  await act(async () => { const a = at({ x: 0.5, y: 0.6 }); pointer(stage(), 'pointerdown', a.x, a.y, { id: 7, primary: false }); pointer(stage(), 'pointerup', a.x, a.y, { id: 7, primary: false }); }); await settle(2);
  check('K9. a non-primary pointer (second finger) adds nothing', trace('heart')!.length === 4);
  await act(async () => { const a = at({ x: 0.45, y: 0.6 }), b = at({ x: 0.6, y: 0.62 }); pointer(stage(), 'pointerdown', a.x, a.y); pointer(stage(), 'pointermove', b.x, b.y); pointer(stage(), 'pointercancel', b.x, b.y); }); await settle(2);
  check('K10. a cancelled gesture changes nothing and is announced', trace('heart')!.length === 4 && /interrupted/i.test(q(c, 'palm-tracing-status')!.textContent!));
  await click(q(c, 'palm-tracing-confirm')!); await settle(2);
  check('K11. a usable trace is confirmed', q(c, 'palm-tracing-step-heart')!.getAttribute('data-status') === 'confirmed');
  // head: invalid trace cannot be confirmed
  await click(q(c, 'palm-tracing-next')!); await settle(2);
  await tap({ x: 0.37, y: 0.56 }); await tap({ x: 0.372, y: 0.561 });
  const conf = q(c, 'palm-tracing-confirm') as HTMLButtonElement;
  check('K12. an incomplete trace (too short) is not usable: Confirm is disabled and the reason is shown', conf.disabled && q(c, 'palm-tracing-feedback')!.getAttribute('data-placement') === 'trace-too-short' && q(c, 'palm-tracing-feedback')!.textContent!.includes(PLACEMENT_TEXT['trace-too-short']));
  await act(async () => { conf.removeAttribute('disabled'); conf.click(); }); await settle(2);
  check('K13. forcing a click on the disabled Confirm does not confirm an unusable trace (still a draft)', q(c, 'palm-tracing-step-head')!.getAttribute('data-status') === 'tracing');
  // drag replaces the trace
  const HEAD = [[0.37, 0.56], [0.45, 0.6], [0.54, 0.62], [0.62, 0.64]].map(([x, y]) => ({ x, y }));
  await act(async () => {
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 3; i++) for (let k = 0; k < 20; k++) pts.push({ x: HEAD[i].x + ((HEAD[i + 1].x - HEAD[i].x) * k) / 20, y: HEAD[i].y + ((HEAD[i + 1].y - HEAD[i].y) * k) / 20 });
    pts.push(HEAD[3]);
    const a = at(pts[0]); pointer(stage(), 'pointerdown', a.x, a.y);
    for (const p of pts.slice(1)) { const b = at(p); pointer(stage(), 'pointermove', b.x, b.y); }
    const z = at(HEAD[3]); pointer(stage(), 'pointerup', z.x, z.y);
  });
  await settle(2);
  const hd = trace('head')!;
  check('K14. a drag replaces the draft with the drawn stroke (<= 24 points, exact endpoints) and it is usable', hd.length >= 2 && hd.length <= 24 && Math.abs(hd[0].x - 0.37) < 1e-9 && Math.abs(hd[hd.length - 1].y - 0.64) < 1e-9 && q(c, 'palm-tracing-feedback')!.getAttribute('data-placement') === 'ok', hd.length);
  await click(q(c, 'palm-tracing-undo')!); await settle(2);
  check('K15. Undo restores the previous draft (the two short taps)', trace('head')!.length === 2);
  await click(q(c, 'palm-tracing-clear')!); await settle(2);
  check('K16. Clear line returns the line to not started (no trace)', q(c, 'palm-tracing-step-head')!.getAttribute('data-status') === 'not-started' && trace('head') === null);
  // skip / cannot see / not requested; reopen confirmed
  await click(q(c, 'palm-tracing-cannot-see')!); await settle(2);
  await click(q(c, 'palm-tracing-next')!); await settle(2);
  await click(q(c, 'palm-tracing-skip')!); await settle(2);
  const st = (l: string) => [q(c, `palm-tracing-step-${l}`)!.getAttribute('data-status'), q(c, `palm-tracing-step-${l}`)!.getAttribute('data-skip-reason')];
  check('K17. cannot-see, skipped and not requested stay distinct (head: cannot-see; life: skipped; upward: not started)', JSON.stringify(st('head')) === JSON.stringify(['skipped', 'user-cannot-see']) && JSON.stringify(st('life')) === JSON.stringify(['skipped', 'user-skipped']) && JSON.stringify(st('upward')) === JSON.stringify(['not-started', null]));
  check('K18. skipped lines are labelled not assessed (never an observed absence)', /not assessed/.test(q(c, 'palm-tracing-step-head')!.textContent!) && /not assessed/.test(q(c, 'palm-tracing-step-life')!.textContent!) && /not requested/.test(q(c, 'palm-tracing-step-upward')!.textContent!));
  await click(q(c, 'palm-tracing-step-heart')!); await settle(2);
  await click(q(c, 'palm-tracing-edit')!); await settle(2);
  check('K19. a confirmed line can be reopened for correction (draft again, trace kept)', st('heart')[0] === 'tracing' && trace('heart')!.length === 4);
  await click(q(c, 'palm-tracing-confirm')!); await settle(2);

  // accessibility
  const buttons = Array.from(q(c, 'palm-tracing')!.querySelectorAll('button'));
  check('K20. every control is a named button with a 48 px minimum target', buttons.length >= 10 && buttons.every((b) => (b.textContent ?? '').trim().length > 0 && parseInt(b.style.minHeight, 10) >= 48));
  check('K21. the drawing surface is labelled and described (instructions, input note including the non-pointer alternative, feedback)', (() => { const s = stage(); const ids = (s.getAttribute('aria-describedby') ?? '').split(' '); return !!s.getAttribute('aria-label') && ids.length === 3 && ids.every((i) => document.getElementById(i)) && /Skip or I can’t see this line/.test(document.getElementById(ids[1])!.textContent!); })());
  check('K22. one polite live region for tracing messages, and a visible focus style', q(c, 'palm-tracing-status')!.getAttribute('aria-live') === 'polite' && /:focus-visible\{outline:3px/.test(q(c, 'palm-tracing')!.querySelector('style')!.textContent!));
  check('K23. every I1 trace reason has geometric guidance, and no message claims line detection', LINE_UNASSESSED_REASONS.filter((r) => r.startsWith('trace-') || r === 'frame-unavailable').every((r) => typeof PLACEMENT_TEXT[r] === 'string') && !/detect(ed|s)? (your|the) line|found your|recogni[sz]ed/i.test(JSON.stringify(PLACEMENT_TEXT) + PLACEMENT_OK_TEXT) && /does not find palm lines/.test(TRACING_SCOPE_NOTE));

  // lifecycle: cancel, replacement, stale gesture, removal, teardown
  await click(q(c, 'palm-tracing-close')!); await settle(2);
  check('K24. Close tracing (cancellation) removes the panel and shows the photo again', !q(c, 'palm-tracing') && !(q(c, 'palm-preview') as HTMLElement).hidden);
  await click(q(c, 'palm-trace-button')!); await settle();
  check('K25. reopening after cancellation starts fresh (no traces kept)', c.querySelectorAll('[data-trace]').length === 0 && st('heart')[0] === 'not-started');
  await tap(HEART[0]);
  // a gesture begun before a photo replacement, finished after it
  const oldStage = stage();
  await act(async () => { const a = at(HEART[1]); pointer(oldStage, 'pointerdown', a.x, a.y); });
  hands = [{ landmarks: makeHand({ dx: 0.02 }), handednessLabel: 'Left', handednessScore: 0.97 }];
  await choose(c, pngFile());
  await act(async () => { const a = at(HEART[2]); pointer(oldStage, 'pointerup', a.x, a.y); }); await settle(2);
  check('K26. photo replacement closes tracing (the old context is revoked, its traces dropped)', !q(c, 'palm-tracing') && !!q(c, 'palm-trace-button'));
  await click(q(c, 'palm-trace-button')!); await settle();
  const g2 = c.querySelector('[data-guide="wrist"]')!;
  check('K27. the new photo gets a fresh tracing: its own landmarks, no stale traces, and the stale gesture changed nothing', c.querySelectorAll('[data-trace]').length === 0 && Math.abs(Number(g2.getAttribute('cx')) / W - (hand[0].x + 0.02)) < 1e-9 && st('heart')[0] === 'not-started');
  await tap(HEART[0]);
  await click(q(c, 'palm-remove-button')!); await settle();
  check('K28. removing the photo removes tracing and every trace', !q(c, 'palm-tracing') && !q(c, 'palm-trace-button') && c.querySelectorAll('[data-trace]').length === 0);
  await choose(c, pngFile());
  await click(q(c, 'palm-trace-button')!); await settle();
  const ownCanvas = q(c, 'palm-tracing-photo') as HTMLCanvasElement;
  await h.unmount();
  check('K29. teardown (leaving the screen) unmounts everything and empties the overlay\'s copy of the photo', c.innerHTML === '' && ownCanvas.width === 0 && ownCanvas.height === 0);
  hands = [];
  const h2 = await mount(React.createElement(PalmImageInput, { sessionDeps: deps }));
  await choose(h2.container, pngFile());
  check('K30. no hand found: no tracing control (no context is ever created)', !q(h2.container, 'palm-trace-button'));
  await h2.unmount();
  check('K31. privacy: no network, storage, cookie or console use during the whole flow', privacy.length === 0, privacy);
}

run().then(() => {
  console.log(`\nPALM-04-I2 UI (jsdom): ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
