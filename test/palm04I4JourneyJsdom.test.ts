/**
 * AURA-PALM-04-I4 -- the integrated scanner journey in the real Upload Photo flow (jsdom + React 18), synthetic fixtures
 * behind the session seams: friendly wording for every I1/G5 code, the four-step progress, the result step, its
 * invalidation, restart and privacy. (Real-browser journeys: test/palm04I4JourneyBrowser.test.ts.)
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/palm04I4JourneyJsdom.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { makeHand, makePixels, makePng } from './palmG5I1Fixtures';

const { PalmImageInput, UNCERTAINTY_TEXT, friendlyReason } = require('../apps/web/components/palm-scan/PalmImageInput');
const ROOT = path.join(__dirname, '..');

let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`OK   ${label}`); } else { failures.push(label); console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
}

// privacy spies
const privacy: string[] = [];
(global as any).fetch = () => { privacy.push('fetch'); return new Promise(() => {}); };
(window as any).fetch = (global as any).fetch;
(window.navigator as any).sendBeacon = () => { privacy.push('sendBeacon'); return true; };
for (const m of ['setItem', 'getItem', 'removeItem', 'clear'] as const) { const o = (window as any).Storage.prototype[m]; (window as any).Storage.prototype[m] = function (...a: unknown[]) { privacy.push(`storage.${m}`); return o.apply(this, a); }; }
{ const d = Object.getOwnPropertyDescriptor((window as any).Document.prototype, 'cookie')!; Object.defineProperty(document, 'cookie', { get() { privacy.push('cookie.get'); return d.get!.call(document); }, set(v) { privacy.push('cookie.set'); d.set!.call(document, v); } }); }
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  const orig = (console as any)[level].bind(console);
  (console as any)[level] = (...args: unknown[]) => { if (typeof args[0] === 'string' && /^(OK|FAIL) {1,3}|^\n?PALM-04-I4/.test(args[0])) return orig(...args); privacy.push(`console.${level}:${String(args[0]).slice(0, 100)}`); return orig(...args); };
}

// synthetic session seams
const fakeCtx = () => ({ drawImage() {}, clearRect() {}, setTransform() {}, imageSmoothingQuality: 'low', getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: makePixels(w, h, 'textured'), width: w, height: h }) });
function createCanvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = fakeCtx(); (c as any).getContext = () => ctx; return c as any; }
(window as any).HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
const decode = async () => ({ width: 1600, height: 1200, source: {}, close() {} });
let hands: any[] = [{ landmarks: makeHand(), handednessLabel: 'Left', handednessScore: 0.97 }];
const deps = { detectorFactory: async () => ({ detect: () => hands, close() {} }), normalizeEnv: { createCanvas, decode }, yieldToUi: () => Promise.resolve() };
const pngFile = () => new File([Buffer.from(makePng(400, 300))], 'palm.png', { type: 'image/png' });
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
function pointer(target: Element, type: string, x: number, y: number) {
  const e = new (window as any).MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 }); Object.defineProperty(e, 'isPrimary', { value: true }); Object.defineProperty(e, 'pointerType', { value: 'touch' });
  target.dispatchEvent(e);
}
const press = async (c: HTMLElement, id: string) => { await click(q(c, id)!); await settle(2); };
const pick = async (c: HTMLElement, id: string) => { const el = q(c, id) as HTMLInputElement; await act(async () => { el.click(); }); await settle(2); };

async function run() {
  // ---- friendly wording covers every code I1 or G5 can produce
  const union = (file: string, typeName: string) => { const t = fs.readFileSync(path.join(ROOT, file), 'utf8'); const m = t.slice(t.indexOf(`export type ${typeName} =`)); return [...m.slice(0, m.indexOf(';')).matchAll(/'([a-z-]+)'/g)].map((x) => x[1]); };
  const codes = [...new Set([...union('apps/web/lib/palm-analysis/measurements.ts', 'MeasurementReason'), ...union('apps/web/lib/palm-analysis/types.ts', 'PalmFeedbackCode')])];
  check(`W1. every I1 measurement reason and G5 quality code (${codes.length}) has friendly wording`, codes.length === 22 && codes.every((c) => typeof UNCERTAINTY_TEXT[c] === 'string'), codes.filter((c) => !UNCERTAINTY_TEXT[c]));
  check('W2. the wording is plain language (no hyphenated code appears in any text) and an unknown code gets a safe fallback', Object.values(UNCERTAINTY_TEXT).every((t: any) => !codes.filter((c) => c.includes('-')).some((c) => t.includes(c))) && friendlyReason('something-new') === 'This could not be checked.');

  process.env.NODE_ENV = 'development';
  process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = 'g5-i1-dev';
  const h = await mount(React.createElement(PalmImageInput, { sessionDeps: deps }));
  const c = h.container;
  const stage = () => Number(q(c, 'palm-scanner-steps')?.getAttribute('data-current') ?? 0);
  check('W3. before any photo the journey shows step 1 of 4', stage() === 1 && c.querySelectorAll('[data-testid="palm-scanner-steps"] li').length === 4 && q(c, 'palm-scanner-steps')!.querySelector('[aria-current="step"]')!.textContent!.includes('Photo'));
  await choose(c, pngFile());
  await press(c, 'palm-trace-button');
  check('W4. tracing is step 2', stage() === 2);
  const photo = q(c, 'palm-tracing-photo') as HTMLCanvasElement;
  const W = photo.width, H = photo.height;
  const s = Math.min(STAGE.width / W, STAGE.height / H);
  const O = { left: STAGE.left + (STAGE.width - W * s) / 2, top: STAGE.top + (STAGE.height - H * s) / 2, width: W * s, height: H * s };
  const tap = async (x: number, y: number) => { const st = q(c, 'palm-tracing-stage')!; const px = O.left + x * O.width, py = O.top + y * O.height; await act(async () => { pointer(st, 'pointerdown', px, py); pointer(st, 'pointerup', px, py); }); await settle(2); };
  for (const [x, y] of [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]]) await tap(x, y);
  await press(c, 'palm-tracing-confirm');
  await press(c, 'palm-tracing-next'); await press(c, 'palm-tracing-skip');
  await press(c, 'palm-tracing-next'); await press(c, 'palm-tracing-cannot-see');
  await press(c, 'palm-review-open');
  check('W5. review is step 3; the result is not reachable before confirming', stage() === 3 && !q(c, 'palm-review-see-result'));
  await pick(c, 'palm-review-hand-right'); await pick(c, 'palm-review-dominant-left');
  if (q(c, 'palm-review-ack')) await pick(c, 'palm-review-ack');
  await press(c, 'palm-review-confirm');
  await press(c, 'palm-review-see-result');
  const result = q(c, 'palm-scanner-result');
  check('W6. the result is step 4 and shows the confirmed features (record unchanged)', stage() === 4 && result?.getAttribute('data-lines') === 'heart:user-confirmed;head:unassessed/user-skipped;life:unassessed/user-cannot-see;upward:unassessed/not-requested' && /Right hand · dominant hand: left/.test(result!.textContent!));
  const resultText = result!.textContent ?? '';
  const reasonEls = Array.from(c.querySelectorAll('[data-testid="palm-scanner-result"] [data-code]'));
  check('W7. reasons on the result are friendly sentences, each keeping its I1 code in data-code', !codes.filter((code) => code.includes('-')).some((code) => resultText.includes(code)) && reasonEls.every((e) => e.textContent === friendlyReason(e.getAttribute('data-code')!)));
  check('W8. the result never presents a skipped or unseen line as an observed absence', /Skipped \(not assessed\)/.test(resultText) && /You could not see it \(not assessed\)/.test(resultText) && /Nothing is guessed or filled in/.test(resultText));
  // invalidation from the result
  await press(c, 'palm-result-edit');
  check('W9. Review or edit returns to step 3 with the confirmation still valid', stage() === 3 && !!q(c, 'palm-review-confirmed'));
  await pick(c, 'palm-review-dominant-unknown');
  check('W10. changing an answer withdraws the confirmation; the result is no longer offered', !q(c, 'palm-review-confirmed') && !q(c, 'palm-review-see-result') && !q(c, 'palm-scanner-result'));
  // restart
  await press(c, 'palm-scanner-restart');
  check('W11. Start over returns to step 1: no photo, no tracing, no review', stage() === 1 && !q(c, 'palm-tracing') && !q(c, 'palm-review') && q(c, 'palm-upload-button')!.textContent === 'Upload photo' && !q(c, 'palm-trace-button'));
  await h.unmount();
  check('W12. privacy: no network, storage, cookie or console use during the whole journey', privacy.length === 0, privacy);
}

run().then(() => {
  console.log(`\nPALM-04-I4 journey (jsdom): ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
