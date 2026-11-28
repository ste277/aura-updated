/**
 * AURA-PALM-D6-I1 -- the personalised reading in the real scanner component (jsdom + React 18), synthetic fixtures
 * behind the session seams: Photo -> Trace -> Review/Confirm -> Reading.
 *   A2  the reading exists only while the confirmation is valid: edit, answer change, new photo, Start over, pagehide
 *       and unmount withdraw it; a re-confirmation gives a fresh reading (nothing stale reappears);
 *   A4  not-assessed features appear only in E1's list with E1's wording; every item is tentative and tradition-tagged;
 *   A5  the five topics, the disclaimer frame first, life direction as questions, "not assessed" states;
 *   no app-authored interpretation: every item's text equals the E1 library's own userFacing text for that record;
 *   A7  privacy spies (network, storage, cookie, console).
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/palmD6I1ReadingJsdom.test.ts
 */
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { makeHand, makePixels, makePng } from './palmG5I1Fixtures';

const { PalmImageInput, READING_TOPICS } = require('../apps/web/components/palm-scan/PalmImageInput');
// E1's own content, for comparison only (not the reading interface): the pinned library and the pinned frame
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pinnedLibrary } = require('../packages/palm-reading-engine/e1/src/packaged.mjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { READING_FRAME } = require('../packages/palm-reading-engine/e1/src/compose.mjs');

let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`OK   ${label}`); } else { failures.push(label); console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
}
const privacy: string[] = [];
(global as any).fetch = () => { privacy.push('fetch'); return new Promise(() => {}); };
(window as any).fetch = (global as any).fetch;
(window.navigator as any).sendBeacon = () => { privacy.push('sendBeacon'); return true; };
for (const m of ['setItem', 'getItem', 'removeItem', 'clear'] as const) { const o = (window as any).Storage.prototype[m]; (window as any).Storage.prototype[m] = function (...a: unknown[]) { privacy.push(`storage.${m}`); return o.apply(this, a); }; }
{ const d = Object.getOwnPropertyDescriptor((window as any).Document.prototype, 'cookie')!; Object.defineProperty(document, 'cookie', { get() { privacy.push('cookie.get'); return d.get!.call(document); }, set(v) { privacy.push('cookie.set'); d.set!.call(document, v); } }); }
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  const orig = (console as any)[level].bind(console);
  (console as any)[level] = (...args: unknown[]) => { if (typeof args[0] === 'string' && /^(OK|FAIL) {1,3}|^\n?PALM-D6/.test(args[0])) return orig(...args); privacy.push(`console.${level}:${String(args[0]).slice(0, 100)}`); return orig(...args); };
}

const fakeCtx = () => ({ drawImage() {}, clearRect() {}, setTransform() {}, imageSmoothingQuality: 'low', getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: makePixels(w, h, 'textured'), width: w, height: h }) });
function createCanvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = fakeCtx(); (c as any).getContext = () => ctx; return c as any; }
(window as any).HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(); };
const decode = async () => ({ width: 1600, height: 1200, source: {}, close() {} });
const deps = { detectorFactory: async () => ({ detect: () => [{ landmarks: makeHand(), handednessLabel: 'Left', handednessScore: 0.97 }], close() {} }), normalizeEnv: { createCanvas, decode }, yieldToUi: () => Promise.resolve() };
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
const press = async (c: HTMLElement, id: string) => { const el = q(c, id); if (!el) { check(`(control ${id} is present)`, false); return; } await click(el); await settle(3); };
const pick = async (c: HTMLElement, id: string) => { const el = q(c, id) as HTMLInputElement | null; if (!el) { check(`(control ${id} is present)`, false); return; } await act(async () => { el.click(); }); await settle(2); };

/** Trace the heart line, skip the head line, mark the life line not visible, review, answer, confirm, see the reading. */
async function journey(c: HTMLElement, opts: { traceHeart?: boolean; dominant?: string } = {}) {
  await press(c, 'palm-trace-button');
  const photo = q(c, 'palm-tracing-photo') as HTMLCanvasElement;
  const W = photo.width, H = photo.height;
  const s = Math.min(STAGE.width / W, STAGE.height / H);
  const O = { left: STAGE.left + (STAGE.width - W * s) / 2, top: STAGE.top + (STAGE.height - H * s) / 2, width: W * s, height: H * s };
  const tap = async (x: number, y: number) => { const st = q(c, 'palm-tracing-stage')!; const px = O.left + x * O.width, py = O.top + y * O.height; await act(async () => { pointer(st, 'pointerdown', px, py); pointer(st, 'pointerup', px, py); }); await settle(2); };
  if (opts.traceHeart !== false) { for (const [x, y] of [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]]) await tap(x, y); await press(c, 'palm-tracing-confirm'); }
  else await press(c, 'palm-tracing-skip');
  await press(c, 'palm-tracing-next'); await press(c, 'palm-tracing-skip');
  await press(c, 'palm-tracing-next'); await press(c, 'palm-tracing-cannot-see');
  await press(c, 'palm-review-open');
  await pick(c, 'palm-review-hand-left'); await pick(c, `palm-review-dominant-${opts.dominant ?? 'right'}`);
  if (q(c, 'palm-review-ack')) await pick(c, 'palm-review-ack');
  await press(c, 'palm-review-confirm');
  await press(c, 'palm-review-see-result');
}
const strip = (el: Element | null, label: string) => (el?.textContent ?? '').replace(label, '');

async function run() {
  process.env.NODE_ENV = 'development';
  process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = 'g5-i1-dev';
  const lib = pinnedLibrary();
  const h = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: { secureContext: true, getUserMedia: null } }));
  const c = h.container;
  await choose(c, pngFile());
  await journey(c);
  const reading = q(c, 'palm-reading');
  check('R1. after confirming, step 4 shows the personalised reading', !!reading && q(c, 'palm-scanner-steps')?.getAttribute('data-current') === '4');
  // A5: frame first, five topics in order
  const frame = q(c, 'palm-reading-frame');
  check('R2. the disclaimer comes first: E1\'s pinned frame, before any topic or interpretation', !!frame && reading!.firstElementChild === frame && frame.querySelector('p')!.textContent === READING_FRAME && /not a scientific assessment and not a prediction/.test(READING_FRAME));
  check('R3. the development note shows the content status (unreviewed, not approved for publication)', q(c, 'palm-reading-dev-note')?.getAttribute('data-content-status') === 'UNREVIEWED_RESEARCH_CONTENT' && q(c, 'palm-reading-dev-note')?.getAttribute('data-publication-approved') === 'false');
  const topics = Array.from(reading!.querySelectorAll('[data-testid^="palm-reading-topic-"]')).filter((e) => e.getAttribute('data-testid') !== 'palm-reading-topic-empty' && e.getAttribute('data-testid') !== 'palm-reading-topic-other');
  check('R4. the five topics, in order: Personality, Personal strengths, Relationships, Career and work, Life direction', JSON.stringify(topics.map((t) => t.querySelector('h4')?.textContent)) === JSON.stringify(['Personality', 'Personal strengths', 'Relationships', 'Career and work', 'Life direction']) && READING_TOPICS.length === 5);
  check('R5. every topic is either shown (with items) or explicitly not assessed; none is silently empty', topics.every((t) => { const st = t.getAttribute('data-state'); const n = t.querySelectorAll('[data-testid="palm-reading-item"]').length; return (st === 'shown' && n > 0) || ((st === 'not-assessed' || st === 'no-content') && n === 0 && !!t.querySelector('[data-testid="palm-reading-topic-empty"]')); }), topics.map((t) => t.getAttribute('data-state')));
  const items = Array.from(reading!.querySelectorAll('[data-testid="palm-reading-item"]'));
  check('R6. the synthetic heart-line journey yields at least one interpretation', items.length > 0);
  // no app-authored interpretation: each paragraph equals the library's own text for that record
  const itemOk = (it: Element) => {
    const rec = lib.byId[it.getAttribute('data-record')!];
    if (!rec) return false;
    const ps = Array.from(it.querySelectorAll('p'));
    const u = rec.userFacing;
    const obs = ps.find((p) => p.textContent!.startsWith('What you traced or we measured: '));
    const rd = ps.find((p) => p.textContent!.startsWith('What the tradition says: '));
    const rf = ps.find((p) => p.textContent!.startsWith('To reflect on: '));
    const extra = ps.filter((p) => p !== obs && p !== rd && p !== rf);
    const tagLine = extra[0]?.textContent === `${it.closest('li')!.querySelector('p')!.textContent}`;
    const appNote = extra.slice(1).map((p) => p.textContent);
    return !!obs && !!rd && !!rf && strip(obs, 'What you traced or we measured: ') === u.observation && strip(rd, 'What the tradition says: ') === u.reading && strip(rf, 'To reflect on: ') === u.reflection
      && tagLine && / · tentative$/.test(extra[0].textContent!) && JSON.stringify(appNote) === JSON.stringify(u.applicationNote ? [u.applicationNote] : []);
  };
  check('R7. every interpretation is E1 text exactly (observation, reading, reflection, note); the app adds only labels and the tradition tag', items.every(itemOk), items.map((i) => i.getAttribute('data-record')));
  check('R8. every item is tentative', items.every((i) => i.getAttribute('data-tier') === 'tentative'));
  check('R9. every reflection is a question; life direction never forecasts', items.every((i) => /\?\s*$/.test(Array.from(i.querySelectorAll('p')).find((p) => p.textContent!.startsWith('To reflect on: '))!.textContent!)));
  // A4: not assessed
  const na = Array.from(q(c, 'palm-reading-not-assessed')!.querySelectorAll('li'));
  const naOf = (f: string) => na.find((l) => l.getAttribute('data-feature') === f);
  check('R10. the skipped head line is listed as not assessed with E1\'s wording (user-skipped)', naOf('lines.head')?.getAttribute('data-e1-code') === 'user-skipped' && naOf('lines.head')!.textContent!.endsWith(lib.reasons['user-skipped'].wording));
  check('R11. the not-visible life line is listed with E1\'s wording (user-cannot-see)', naOf('lines.life')?.getAttribute('data-e1-code') === 'user-cannot-see' && naOf('lines.life')!.textContent!.endsWith(lib.reasons['user-cannot-see'].wording));
  check('R12. every not-assessed entry uses exactly E1\'s wording for its code; no confirmed line is listed', na.length > 0 && na.every((l) => l.textContent!.endsWith(lib.reasons[l.getAttribute('data-e1-code')!].wording)) && !naOf('lines.heart'));
  check('R13. the confirmed features stay shown below the reading (unchanged record)', q(c, 'palm-scanner-result')?.getAttribute('data-lines') === 'heart:user-confirmed;head:unassessed/user-skipped;life:unassessed/user-cannot-see;upward:unassessed/not-requested');
  const firstItems = items.map((i) => i.getAttribute('data-record')).join();

  // A2: invalidation
  await press(c, 'palm-result-edit');
  await pick(c, 'palm-review-dominant-left');
  check('R14. changing a hand answer after confirming withdraws the confirmation and the reading', !q(c, 'palm-reading') && !q(c, 'palm-review-see-result'));
  await pick(c, 'palm-review-dominant-right');
  check('R15. changing it back does NOT bring the old reading back (a fresh confirmation is required)', !q(c, 'palm-reading') && !q(c, 'palm-review-see-result') && !!q(c, 'palm-review-confirm'));
  await press(c, 'palm-review-edit-heart');
  await press(c, 'palm-tracing-edit');
  await press(c, 'palm-tracing-skip');
  await press(c, 'palm-review-open');
  if (q(c, 'palm-review-ack')) await pick(c, 'palm-review-ack');
  await press(c, 'palm-review-confirm');
  await press(c, 'palm-review-see-result');
  const second = Array.from(c.querySelectorAll('[data-testid="palm-reading-item"]')).map((i) => i.getAttribute('data-record')).join();
  check('R16. a re-confirmation with the heart line skipped gives a FRESH reading of the new features (no stale items)', !!q(c, 'palm-reading') && second !== firstItems && !!Array.from(q(c, 'palm-reading-not-assessed')!.querySelectorAll('li')).find((l) => l.getAttribute('data-feature') === 'lines.heart'), { firstItems, second });
  await press(c, 'palm-scanner-restart');
  check('R17. Start over clears the reading with the photo', !q(c, 'palm-reading') && !q(c, 'palm-scanner-result') && !q(c, 'palm-preview-canvas'));
  await choose(c, pngFile());
  await journey(c);
  check('R18. (setup) a new journey reaches a reading again', !!q(c, 'palm-reading'));
  await choose(c, pngFile());
  check('R19. choosing another photo withdraws the reading', !q(c, 'palm-reading') && !q(c, 'palm-tracing'));
  await journey(c);
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  await settle();
  check('R20. leaving the page (pagehide) clears the reading', !q(c, 'palm-reading') && !q(c, 'palm-preview-canvas'));
  await choose(c, pngFile());
  await journey(c);
  check('R21. (setup) reading shown before unmount', !!q(c, 'palm-reading'));
  await h.unmount();
  check('R22. unmount removes the reading', !c.querySelector('[data-testid="palm-reading"]'));
  check('R23. no network, storage, cookie or console use during the whole reading journey', privacy.length === 0, privacy);
}

run().then(() => {
  console.log(`\nPALM-D6-I1 reading (jsdom): ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
