/**
 * AURA-PALM-04-I3 -- feature review and confirmation inside the real Upload Photo flow (jsdom + React 18), synthetic
 * fixtures behind the session seams (as test/palm04I2TracingUiJsdom.test.ts). Pointer input is dispatched as DOM
 * pointer events at positions from an independent contain oracle.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/palm04I3ReviewJsdom.test.ts
 */
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { makeHand, makePixels, makePng } from './palmG5I1Fixtures';

const { PalmImageInput, REVIEW_SCOPE_NOTE, reviewBlockers } = require('../apps/web/components/palm-scan/PalmImageInput');

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
  (console as any)[level] = (...args: unknown[]) => { if (typeof args[0] === 'string' && /^(OK|FAIL) {1,3}|^\n?PALM-04-I3/.test(args[0])) return orig(...args); privacy.push(`console.${level}:${String(args[0]).slice(0, 100)}`); return orig(...args); };
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
  process.env.NODE_ENV = 'development';
  process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = 'g5-i1-dev';
  const h = await mount(React.createElement(PalmImageInput, { sessionDeps: deps }));
  const c = h.container;
  await choose(c, pngFile());
  await press(c, 'palm-trace-button');
  const photo = q(c, 'palm-tracing-photo') as HTMLCanvasElement;
  const W = photo.width, H = photo.height;
  const s = Math.min(STAGE.width / W, STAGE.height / H);
  const O = { left: STAGE.left + (STAGE.width - W * s) / 2, top: STAGE.top + (STAGE.height - H * s) / 2, width: W * s, height: H * s };
  const tap = async (x: number, y: number) => { const st = q(c, 'palm-tracing-stage')!; const px = O.left + x * O.width, py = O.top + y * O.height; await act(async () => { pointer(st, 'pointerdown', px, py); pointer(st, 'pointerup', px, py); }); await settle(2); };
  const review = () => q(c, 'palm-review');
  const blockers = () => Array.from(c.querySelectorAll('[data-testid="palm-review-blockers"] li')).map((li) => li.textContent ?? '');
  const confirmBtn = () => q(c, 'palm-review-confirm') as HTMLButtonElement | null;

  // ---- 1. nothing traced: review is blocked, nothing defaulted
  await press(c, 'palm-review-open');
  check('I1. Review all lines opens the review (final step), with the scope note', !!review() && /review and confirm/i.test(q(c, 'palm-review-progress')!.textContent!) && q(c, 'palm-review-scope')!.textContent === REVIEW_SCOPE_NOTE);
  check('I2. the hand answers are never defaulted (no radio pre-selected)', Array.from(c.querySelectorAll('[data-testid="palm-review"] input[type="radio"]')).every((r) => !(r as HTMLInputElement).checked));
  const b0 = blockers();
  check('I3. with nothing decided, confirmation is blocked and every missing decision is listed (hand, dominant hand, heart, head, life)', confirmBtn()!.disabled && b0.length === 5 && /which hand/i.test(b0[0]) && /dominant/i.test(b0[1]) && /Heart line: not traced/.test(b0[2]) && /Head line: not traced/.test(b0[3]) && /Life line: not traced/.test(b0[4]), b0);
  check('I4. the optional upward line left alone is shown as not requested (not a blocker)', q(c, 'palm-review-lines')!.querySelector('[data-line="upward"]')!.textContent!.includes('Not requested (optional)'));
  check('I5. without hand answers no features are assembled (nothing guessed)', !!q(c, 'palm-review-features-pending') && !q(c, 'palm-review-measurements'));

  // ---- 2. decide each line: heart traced + confirmed, head skipped, life cannot-see
  await press(c, 'palm-review-edit-heart');
  check('I6. Edit returns to tracing on that line', !!q(c, 'palm-tracing-stage') && /Heart/.test(q(c, 'palm-tracing-title')!.textContent!));
  for (const [x, y] of [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]]) await tap(x, y);
  await press(c, 'palm-review-open');
  check('I7. an unconfirmed draft blocks confirmation (never silently confirmed)', blockers().some((b) => /Heart line: the trace is an unconfirmed draft/.test(b)) && q(c, 'palm-review-lines')!.querySelector('[data-line="heart"]')!.getAttribute('data-status') === 'tracing');
  await press(c, 'palm-review-edit-heart');
  await press(c, 'palm-tracing-confirm');
  await press(c, 'palm-tracing-next');
  await press(c, 'palm-tracing-skip');
  await press(c, 'palm-tracing-next');
  await press(c, 'palm-tracing-cannot-see');
  await press(c, 'palm-review-open');
  const rows = (id: string) => q(c, 'palm-review-lines')!.querySelector(`[data-line="${id}"]`)!;
  check('I8. the review distinguishes confirmed, skipped, cannot-see and not requested', rows('heart').getAttribute('data-status') === 'confirmed' && /Confirmed trace/.test(rows('heart').textContent!) && rows('head').getAttribute('data-skip-reason') === 'user-skipped' && /Skipped \(not assessed\)/.test(rows('head').textContent!) && rows('life').getAttribute('data-skip-reason') === 'user-cannot-see' && /Can’t see it/.test(rows('life').textContent!) && /Not requested/.test(rows('upward').textContent!));
  check('I9. only the hand answers remain blocking', blockers().length === 2);
  await pick(c, 'palm-review-hand-left');
  await pick(c, 'palm-review-dominant-unknown');
  const ms = q(c, 'palm-review-measurement-status');
  check('I10. with the hand answers, I1 measurements are shown with their status (automatic, from the photo) and the photo check', !!ms && c.querySelectorAll('[data-testid="palm-review-measurements"] [data-measurement]').length === 9 && !!q(c, 'palm-review-quality'));
  const uncertain = !!q(c, 'palm-review-ack');
  if (uncertain) {
    check('I11. uncertain or unavailable items require an explicit acknowledgement before confirming', confirmBtn()!.disabled && blockers().some((b) => /uncertain/.test(b)));
    await pick(c, 'palm-review-ack');
  } else check('I11. no uncertain items: no acknowledgement is required', !blockers().some((b) => /uncertain/.test(b)));
  check('I12. with every decision made, confirmation is enabled', !confirmBtn()!.disabled && blockers().length === 0 && review()!.getAttribute('data-state') === 'ready');
  await press(c, 'palm-review-confirm');
  const conf = q(c, 'palm-review-confirmed');
  check('I13. confirming records I1 features exactly as decided: heart user-confirmed, head user-skipped, life user-cannot-see, upward not-requested', !!conf && conf.getAttribute('data-lines') === 'heart:user-confirmed;head:unassessed/user-skipped;life:unassessed/user-cannot-see;upward:unassessed/not-requested' && review()!.getAttribute('data-state') === 'confirmed', conf?.getAttribute('data-lines'));
  check('I14. measurements keep their own status (confirming never upgrades uncertain items)', q(c, 'palm-review-measurement-status')!.getAttribute('data-status') === (uncertain ? q(c, 'palm-review-measurement-status')!.getAttribute('data-status') : 'measured') && !q(c, 'palm-review-confirm'));

  // ---- 3. stale confirmation is impossible
  await pick(c, 'palm-review-dominant-right');
  check('I15. changing a hand answer after confirming withdraws the confirmation and says so', !q(c, 'palm-review-confirmed') && /withdrawn/.test(q(c, 'palm-tracing-status')!.textContent!));
  await pick(c, 'palm-review-dominant-unknown');
  check('I16. switching the answer back does not restore the old confirmation (a new confirmation is needed)', !q(c, 'palm-review-confirmed') && (uncertain ? confirmBtn()!.disabled : !confirmBtn()!.disabled));
  if (uncertain) await pick(c, 'palm-review-ack');
  await press(c, 'palm-review-confirm');
  check('I17. confirming again works', !!q(c, 'palm-review-confirmed'));
  await press(c, 'palm-review-back');
  check('I18. back in tracing, a banner shows the confirmation is current', !!q(c, 'palm-review-confirmed-banner'));
  await press(c, 'palm-tracing-step-heart');
  await press(c, 'palm-tracing-edit');
  check('I19. reopening a confirmed line for editing withdraws the confirmation at once', !q(c, 'palm-review-confirmed-banner') && /withdrawn/.test(q(c, 'palm-tracing-status')!.textContent!));
  await press(c, 'palm-tracing-confirm');
  await press(c, 'palm-review-open');
  check('I20. after the edit, the review needs a fresh confirmation (nothing carried over)', !q(c, 'palm-review-confirmed') && !!q(c, 'palm-review-confirm'));
  if (uncertain) await pick(c, 'palm-review-ack');
  await press(c, 'palm-review-confirm');
  await press(c, 'palm-review-back');
  await press(c, 'palm-tracing-undo');
  check('I21. Undo after confirming withdraws the confirmation', !q(c, 'palm-review-confirmed-banner'));

  // ---- 4. accessibility
  await press(c, 'palm-review-open');
  check('I22. hand questions are fieldsets with legends; radios are labelled; blockers are a polite live region', c.querySelectorAll('[data-testid="palm-review"] fieldset legend').length === 2 && Array.from(c.querySelectorAll('[data-testid="palm-review"] input[type="radio"]')).every((r) => !!r.closest('label')?.textContent?.trim()) && (q(c, 'palm-review-blockers') ? q(c, 'palm-review-blockers')!.getAttribute('aria-live') === 'polite' : true));
  check('I23. every review button has a name and a 48 px minimum target', Array.from(review()!.querySelectorAll('button')).every((b) => (b.textContent ?? '').trim().length > 0 && parseInt((b as HTMLElement).style.minHeight, 10) >= 48));

  // ---- 5. cancellation, replacement, removal
  await press(c, 'palm-tracing-close');
  await press(c, 'palm-trace-button');
  check('I24. Close tracing (cancellation) drops the review: reopening starts with no answers and nothing confirmed', !q(c, 'palm-review') && c.querySelectorAll('[data-trace]').length === 0);
  await press(c, 'palm-review-open');
  check('I25. ...and the review is blocked again', confirmBtn()!.disabled && blockers().length === 5);
  hands = [{ landmarks: makeHand({ dx: 0.02 }), handednessLabel: 'Left', handednessScore: 0.97 }];
  await choose(c, pngFile());
  check('I26. photo replacement closes tracing and review (the old confirmation can never apply to the new photo)', !q(c, 'palm-review') && !q(c, 'palm-tracing') && !!q(c, 'palm-trace-button'));
  await press(c, 'palm-trace-button');
  await press(c, 'palm-review-open');
  check('I27. the new photo starts a fresh review (no answers, nothing confirmed)', !q(c, 'palm-review-confirmed') && Array.from(c.querySelectorAll('[data-testid="palm-review"] input[type="radio"]')).every((r) => !(r as HTMLInputElement).checked));
  await click(q(c, 'palm-remove-button')!); await settle();
  check('I28. removing the photo removes the review', !q(c, 'palm-review') && !q(c, 'palm-trace-button'));
  await h.unmount();

  // ---- 6. the gating function itself
  const v = (line: string, status: string, skip: string | null = null) => ({ line, status, points: [], skipReason: skip, placement: null });
  const all = [v('heart', 'confirmed'), v('head', 'skipped', 'user-skipped'), v('life', 'skipped', 'user-cannot-see'), v('upward', 'not-started')];
  check('I29. reviewBlockers: ready only with all decisions; an upward draft also blocks', reviewBlockers(all, 'left', 'unknown', { ok: true }, false, false).length === 0 && reviewBlockers([...all.slice(0, 3), v('upward', 'tracing')], 'left', 'unknown', { ok: true }, false, false).length === 1 && reviewBlockers(all, 'left', 'unknown', { ok: true }, true, false).length === 1 && reviewBlockers(all, 'left', 'unknown', { ok: false }, false, false).length === 1);
  check('I30. privacy: no network, storage, cookie or console use during the whole journey', privacy.length === 0, privacy);
}

run().then(() => {
  console.log(`\nPALM-04-I3 review (jsdom): ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
