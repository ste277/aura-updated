/**
 * AURA-PALM-D6-I1-R1 (50369 F1) -- landmark retention in MOUNTED REACT STATE (jsdom + React 18, synthetic fixtures).
 * Walks the real fiber tree of the mounted scanner and searches every hook's state (useState, useMemo, useRef ...) for
 * a raw landmark set (an array of 21 points with x, y in [0, 1]). The session's construction context (outside React,
 * owned by the session lifecycle approved in P4-I1) is not React state and is not counted.
 *   - after the photo check, while tracing, after confirmation, on the result, after Edit + re-confirmation, after
 *     answer changes, Start over, photo replacement, pagehide and unmount: NO component state holds raw landmarks;
 *   - Edit tracing and re-confirmation keep working (the tracing model reads the context on demand).
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/palmD6I1R1RetentionJsdom.test.ts
 */
import { React, mount, click, flush, act } from './jsdomReactHarness';
import { makeHand, makePixels, makePng } from './palmG5I1Fixtures';

const { PalmImageInput } = require('../apps/web/components/palm-scan/PalmImageInput');

let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`OK   ${label}`); } else { failures.push(label); console.log(`FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
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
async function choose(c: HTMLElement) {
  const input = c.querySelector<HTMLInputElement>('[data-testid="palm-file-input"]')!;
  Object.defineProperty(input, 'files', { value: [pngFile()], configurable: true });
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

// ---------------------------------------------------------------- mounted React state inspection
const isLandmarkSet = (v: unknown) => Array.isArray(v) && v.length === 21 && v.every((p) => !!p && typeof p === 'object' && typeof (p as any).x === 'number' && typeof (p as any).y === 'number' && (p as any).x >= 0 && (p as any).x <= 1 && (p as any).y >= 0 && (p as any).y <= 1);
/** Every raw landmark set reachable from the hook states of the mounted fiber tree under `container`. */
function landmarkSetsInState(container: HTMLElement): Array<{ component: string; hook: number; path: string }> {
  const rootKey = Object.keys(container).find((k) => k.startsWith('__reactContainer$'));
  const stored = rootKey ? (container as any)[rootKey] : null;
  const root = stored?.stateNode?.current ?? stored; // the COMMITTED tree (the stored fiber may be the stale alternate)
  const hits: Array<{ component: string; hook: number; path: string }> = [];
  const search = (v: unknown, path: string, seen: Set<unknown>, depth: number, component: string, hook: number) => {
    if (v === null || typeof v !== 'object' || seen.has(v) || depth > 8) return;
    if (typeof Node !== 'undefined' && v instanceof Node) return; // DOM nodes and canvases are not landmark state
    seen.add(v);
    if (isLandmarkSet(v)) { hits.push({ component, hook, path }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => search(x, `${path}[${i}]`, seen, depth + 1, component, hook)); return; }
    for (const k of Object.keys(v as object)) { let x: unknown; try { x = (v as any)[k]; } catch { continue; } search(x, `${path}.${k}`, seen, depth + 1, component, hook); }
  };
  const walk = (f: any) => {
    for (let n = f; n; n = n.sibling) {
      if (typeof n.type === 'function') {
        const name = n.type.displayName || n.type.name || 'anonymous';
        let h = n.memoizedState, i = 0;
        while (h && typeof h === 'object' && 'memoizedState' in h) { search(h.memoizedState, 'state', new Set(), 0, name, i); h = h.next; i++; }
      }
      if (n.child) walk(n.child);
    }
  };
  if (root) walk(root.child ?? root);
  return hits;
}

async function run() {
  process.env.NODE_ENV = 'development';
  process.env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = 'g5-i1-dev';
  // self-check of the inspector: it must find a landmark set placed in component state
  {
    function Holder() { const [s] = React.useState(() => ({ data: { landmarks: makeHand() } })); return React.createElement('p', null, String(!!s)); }
    const hh = await mount(React.createElement(Holder));
    check('M0. (inspector self-check) a 21-point landmark set kept in useState IS found in the mounted fiber tree', landmarkSetsInState(hh.container).some((x) => x.component === 'Holder'));
    await hh.unmount();
  }
  const h = await mount(React.createElement(PalmImageInput, { sessionDeps: deps, cameraEnv: { secureContext: true, getUserMedia: null } }));
  const c = h.container;
  const none = (label: string) => { const hits = landmarkSetsInState(c); check(label, hits.length === 0, hits); };
  await choose(c);
  none('M1. after the photo check: no component state holds raw landmarks');
  await press(c, 'palm-trace-button');
  none('M2. while tracing: no component state holds raw landmarks (the tracing model reads the context on demand)');
  const photo = q(c, 'palm-tracing-photo') as HTMLCanvasElement;
  const W = photo.width, H = photo.height;
  const s = Math.min(STAGE.width / W, STAGE.height / H);
  const O = { left: STAGE.left + (STAGE.width - W * s) / 2, top: STAGE.top + (STAGE.height - H * s) / 2, width: W * s, height: H * s };
  const tap = async (x: number, y: number) => { const st = q(c, 'palm-tracing-stage')!; const px = O.left + x * O.width, py = O.top + y * O.height; await act(async () => { pointer(st, 'pointerdown', px, py); pointer(st, 'pointerup', px, py); }); await settle(2); };
  check('M3. (setup) the photo is drawn at its real size in the tracing stage (dimensions available without landmarks)', W > 0 && H > 0);
  for (const [x, y] of [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]]) await tap(x, y);
  await press(c, 'palm-tracing-confirm');
  await press(c, 'palm-tracing-next'); await press(c, 'palm-tracing-skip');
  await press(c, 'palm-tracing-next'); await press(c, 'palm-tracing-cannot-see');
  await press(c, 'palm-review-open');
  await pick(c, 'palm-review-hand-left'); await pick(c, 'palm-review-dominant-right');
  if (q(c, 'palm-review-ack')) await pick(c, 'palm-review-ack');
  await press(c, 'palm-review-confirm');
  check('M4. (setup) the confirmation succeeded', !!q(c, 'palm-review-see-result'));
  none('M5. F1: after a valid confirmation no component state holds raw landmarks (the mounted tracing panel included)');
  await press(c, 'palm-review-see-result');
  none('M6. on the reading result: no component state holds raw landmarks');
  check('M6b. (setup) the reading is shown', !!q(c, 'palm-reading'));
  // Edit tracing and re-confirmation keep working
  await press(c, 'palm-result-edit');
  await press(c, 'palm-review-edit-head');
  await press(c, 'palm-tracing-retrace');
  for (const [x, y] of [[0.37, 0.56], [0.45, 0.6], [0.54, 0.62], [0.62, 0.64]]) await tap(x, y);
  check('M7. Edit tracing still works after confirmation: a new head-line trace is placed and can be confirmed', q(c, 'palm-tracing-feedback')?.getAttribute('data-placement') === 'ok');
  await press(c, 'palm-tracing-confirm');
  none('M8. while editing: no component state holds raw landmarks');
  await press(c, 'palm-review-open');
  if (q(c, 'palm-review-ack')) await pick(c, 'palm-review-ack');
  await press(c, 'palm-review-confirm');
  await press(c, 'palm-review-see-result');
  const headNa = Array.from(c.querySelectorAll('[data-testid="palm-reading-not-assessed"] li')).find((l) => l.getAttribute('data-feature') === 'lines.head');
  check('M9. re-confirmation after editing gives a fresh reading of the edited features (head now user-confirmed, no longer user-skipped)', !!q(c, 'palm-reading') && /head:user-confirmed/.test(q(c, 'palm-scanner-result')?.getAttribute('data-lines') ?? '') && headNa?.getAttribute('data-e1-code') !== 'user-skipped', { lines: q(c, 'palm-scanner-result')?.getAttribute('data-lines'), head: headNa?.getAttribute('data-e1-code') });
  none('M10. after re-confirmation: no component state holds raw landmarks');
  // invalidation paths
  await press(c, 'palm-result-edit'); await pick(c, 'palm-review-dominant-left');
  check('M11. (setup) an answer change withdrew the reading', !q(c, 'palm-reading'));
  none('M12. after the answer change: no component state holds raw landmarks');
  await press(c, 'palm-scanner-restart');
  none('M13. after Start over: no component state holds raw landmarks');
  await choose(c); await press(c, 'palm-trace-button'); await choose(c);
  none('M14. after a photo replacement mid-tracing: no component state holds raw landmarks');
  await press(c, 'palm-trace-button');
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  await settle();
  none('M15. after pagehide: no component state holds raw landmarks');
  await h.unmount();
  check('M16. after unmount nothing is mounted', landmarkSetsInState(c).length === 0 && !c.querySelector('[data-testid="palm-image-input"]'));
}

run().then(() => {
  console.log(`\nPALM-D6-I1-R1 retention (jsdom): ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
