/**
 * AURA-PALM-04-I2 -- browser-level tests of the tracing overlay in a real Chromium, driven by REAL pointer input
 * (Playwright mouse events and Chrome DevTools touch events, which the browser turns into pointer events), on the
 * synthetic development harness (test/palm04I2Harness.tsx). Synthetic fixtures only.
 *
 * The harness and the real component sources are transpiled with the repo's own TypeScript and bundled in memory
 * (no new dependency, no server, no network); the page is loaded with setContent. Expected positions come from an
 * INDEPENDENT oracle in this file (object-fit: contain arithmetic), never from the code under test.
 *
 *   npx ts-node test/palm04I2TracingBrowser.test.ts [--shots <dir>]
 *   PALM_BROWSER_CHANNEL=chrome  -> use the installed Google Chrome (CI) instead of Playwright's bundled Chromium
 *
 * Negative controls (run after the real suite, each on a deliberately broken bundle; each MUST make checks fail):
 *   N1 stretch    -- the overlay geometry stretches the photo to the stage (no contain / letterbox)
 *   N2 container  -- pointer positions are mapped against the stage box instead of the photo's content rectangle
 *   N3 bypass     -- placement validation bypassed (the model confirms anything; the UI never disables Confirm)
 */
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ts = require('typescript');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const argShots = process.argv.indexOf('--shots');
const SHOTS = argShots > 0 ? process.argv[argShots + 1] : null;

// ---------------------------------------------------------------- in-memory bundle
type Mutation = 'none' | 'stretch' | 'container' | 'bypass' | 'original' | 'stale-gesture' | 'ignore-release' | 'retain-revoked' | 'unhandled-limit' | 'r1-head' | 'tap-boundary-bypass' | 'r2-head' | 'filter-before-validate' | 'ignore-coalesced' | 'r3-head' | 'skip-unmappable' | 'stale-confirmation' | 'silent-missing';
/** The R3 head reviewed by the R3 focused review (9463431): the R4 geometry-loss witness must fail on it. */
const R3_HEAD = '94634312f4249e5edb72e008795fceabb2cca86c';
/** The R2 head reviewed by 50351 (6ddaa65): the R3 sample-pipeline witness must fail on it. */
const R2_HEAD = '6ddaa651a19cb3096a9093a16e0300e501d89c8f';
/** The R1 head reviewed by 50348 (57ef630): the R2 boundary witness must fail on it. */
const R1_HEAD = '57ef6302a2b43fb94b7aed3c1ef3f655d074a9e6';
/** The reviewed P4-I2 component (head 0c1c650), before the R1 corrections: the F1-F4 witnesses must fail on it. */
const ORIGINAL_HEAD = '0c1c6500e3bf9b4bd046772c32e5fab86e178ac7';
const originalComponent = (rev: string = ORIGINAL_HEAD): string => {
  try { return require('child_process').execFileSync('git', ['show', `${rev}:apps/web/components/palm-scan/PalmImageInput.tsx`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error(`the reviewed commit ${rev} is not in this clone; fetch it first: git fetch --no-tags --depth=1 origin ${rev}`); }
};
const MUTATIONS: Record<Exclude<Mutation, 'none' | 'original' | 'r1-head' | 'r2-head' | 'r3-head'>, Array<{ file: string; from: string; to: string }>> = {
  stretch: [{ file: 'apps/web/lib/palm-analysis/tracingGeometry.ts', from: 'const scale = Math.min(box.width / imgW, box.height / imgH);\n  const width = imgW * scale;\n  const height = imgH * scale;', to: 'const width = box.width;\n  const height = box.height;' }],
  container: [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'const c = containRect({ left: r.left, top: r.top, width: r.width, height: r.height }, imgW, imgH);', to: 'const c = { left: r.left, top: r.top, width: r.width, height: r.height };' }],
  bypass: [
    { file: 'apps/web/lib/palm-analysis/tracing.ts', from: 'if (!placement.ok) return Object.freeze({ ok: false as const, reason: placement.reason, line: view(data, id) });', to: '' },
    { file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'disabled={!placement?.ok}', to: 'disabled={false}' },
  ],
  // R1 negative controls: each re-introduces one finding into the corrected component
  'stale-gesture': [
    { file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'const decide = <T,>(op: (m: TracingModel) => T): T | undefined => { invalidateGesture(); return run(op); };', to: 'const decide = <T,>(op: (m: TracingModel) => T): T | undefined => run(op);' },
    { file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: "if (g.epoch !== gestureEpoch.current || g.model !== modelRef.current || g.line !== lineId) return;", to: "if (g.model !== modelRef.current) return;" },
  ],
  'ignore-release': [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: "const release = toImage(e.clientX, e.clientY);\n    if (!release) invalidateSample(g, 'unverifiable'); // fail closed: an unmappable release is never skipped", to: 'const release = null as ReturnType<typeof toImage>; // the release is ignored entirely' }],
  'retain-revoked': [
    { file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'const timer = setInterval(watch, 250);', to: 'const timer = 0 as unknown as ReturnType<typeof setInterval>; void watch;' },
    { file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'if (modelRef.current && !modelRef.current.isActive()) { markCleared(); return; } // a late observer callback restores nothing', to: '' },
  ],
  // R2 negative control (filled in with the R2 implementation)
  // R3 negative control (filled in with the R3 implementation)
  // R4 negative control (filled in with the R4 implementation)
  // P4-I3 negative controls (used by test/palm04I3ReviewBrowser.test.ts)
  'stale-confirmation': [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'const confirmedValid = !!confirmed && confirmed.key === reviewKey && !cleared;', to: 'const confirmedValid = !!confirmed && !cleared;' }],
  'silent-missing': [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: "else if (v.status === 'not-started' && REVIEW_PRIMARY_LINES.includes(v.line)) out.push(", to: 'else if (false) out.push(' }],
  'skip-unmappable': [
    { file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: "if (!p) { invalidateSample(g, 'unverifiable'); continue; }", to: 'if (!p) continue;' },
    { file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: "if (!release) invalidateSample(g, 'unverifiable');", to: '' },
  ],
  'filter-before-validate': [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'if (g.invalid) { setMessage(', to: 'if (spaceStroke(g.pts, imgW, imgH, Math.max(2, 0.006 * Math.max(imgW, imgH))).some((q) => q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1)) { setMessage(' }],
  'ignore-coalesced': [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'const samples: Array<{ clientX: number; clientY: number }> = coalesced.length ? coalesced : [native];', to: 'const samples: Array<{ clientX: number; clientY: number }> = [native]; void coalesced;' }],
  'tap-boundary-bypass': [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'if (g.invalid) { setMessage(', to: 'if (g.moved && g.invalid) { setMessage(' }],
  'unhandled-limit': [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: "if (e instanceof TracingError) { setMessage(e.code === 'too-many-points'", to: "if (false) { setMessage(e.code === 'too-many-points'" }],
};

function bundle(entry: string, mutation: Mutation): string {
  const mods = new Map<string, string>();
  const ids = new Map<string, number>();
  const muts = mutation === 'none' || mutation === 'original' || mutation === 'r1-head' || mutation === 'r2-head' || mutation === 'r3-head' ? [] : MUTATIONS[mutation];
  const used = new Set<number>();
  const resolve = (spec: string, from: string): string => {
    const base = path.resolve(path.dirname(from), spec);
    for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    throw new Error(`cannot resolve ${spec} from ${from}`);
  };
  const EXTERNAL: Record<string, string> = { react: 'window.React', 'react-dom': 'window.ReactDOM', 'react-dom/client': 'window.ReactDOM', '@mediapipe/tasks-vision': '{}' };
  const visit = (file: string): number => {
    if (ids.has(file)) return ids.get(file)!;
    const id = ids.size;
    ids.set(file, id);
    const pinned: Partial<Record<Mutation, string>> = { original: ORIGINAL_HEAD, 'r1-head': R1_HEAD, 'r2-head': R2_HEAD, 'r3-head': R3_HEAD };
    let src = pinned[mutation] && file === path.join(WEB, 'components/palm-scan/PalmImageInput.tsx') ? originalComponent(pinned[mutation]) : fs.readFileSync(file, 'utf8');
    muts.forEach((m, k) => {
      if (path.join(ROOT, m.file) !== file) return;
      if (!src.includes(m.from)) throw new Error(`mutation ${mutation} target not found in ${m.file}`);
      src = src.replace(m.from, m.to);
      used.add(k);
    });
    let out: string = ts.transpileModule(src, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    out = out.replace(/require\("([^"]+)"\)/g, (_m: string, spec: string) => {
      if (spec in EXTERNAL) return `__ext(${JSON.stringify(spec)})`;
      if (!spec.startsWith('.')) throw new Error(`unexpected external import ${spec} in ${file}`);
      return `__req(${visit(resolve(spec, file))})`;
    });
    mods.set(file, out);
    return id;
  };
  const entryId = visit(entry);
  if (used.size !== muts.length) throw new Error(`mutation ${mutation}: not every target applied`);
  const defs = [...ids.entries()].map(([file, id]) => `${id}: function (exports, module, __req, __ext) { /* ${path.relative(ROOT, file)} */\n${mods.get(file)}\n}`).join(',\n');
  return `(function () {
  var __ext = function (s) { return s === 'react' ? window.React : s === 'react-dom/client' || s === 'react-dom' ? window.ReactDOM : {}; };
  var defs = {${defs}};
  var cache = {};
  function __req(id) { if (cache[id]) return cache[id].exports; var module = { exports: {} }; cache[id] = module; defs[id](module.exports, module, __req, __ext); return module.exports; }
  __req(${entryId});
})();`;
}

const reactUmd = fs.readFileSync(path.join(WEB, 'node_modules/react/umd/react.development.js'), 'utf8');
const reactDomUmd = fs.readFileSync(path.join(WEB, 'node_modules/react-dom/umd/react-dom.development.js'), 'utf8');
// Privacy spies installed before any page script: every network, storage and logging API records its use.
const SPIES = `
window.__privacy = [];
(function () {
  var rec = function (k) { return function () { window.__privacy.push(k); }; };
  window.fetch = function () { window.__privacy.push('fetch'); return new Promise(function () {}); };
  var xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function () { window.__privacy.push('xhr'); return xo.apply(this, arguments); };
  navigator.sendBeacon = function () { window.__privacy.push('sendBeacon'); return true; };
  window.WebSocket = function () { window.__privacy.push('websocket'); throw new Error('blocked'); };
  ['setItem', 'getItem', 'removeItem', 'clear', 'key'].forEach(function (m) { var o = Storage.prototype[m]; Storage.prototype[m] = function () { window.__privacy.push('storage.' + m); return o.apply(this, arguments); }; });
  var idb = indexedDB.open.bind(indexedDB); indexedDB.open = function () { window.__privacy.push('indexedDB'); return idb.apply(null, arguments); };
  var cd = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie'); Object.defineProperty(document, 'cookie', { get: function () { window.__privacy.push('cookie.get'); return cd.get.call(document); }, set: function (v) { window.__privacy.push('cookie.set'); cd.set.call(document, v); } });
  ['toDataURL', 'toBlob'].forEach(function (m) { var o = HTMLCanvasElement.prototype[m]; HTMLCanvasElement.prototype[m] = function () { window.__privacy.push('canvas.' + m); return o.apply(this, arguments); }; });
  ['log', 'info', 'debug', 'warn', 'error'].forEach(function (m) { var o = console[m].bind(console); console[m] = function () { window.__privacy.push('console.' + m + ':' + String(arguments[0]).slice(0, 120)); return o.apply(null, arguments); }; });
})();`;

function page(mutation: Mutation, w: number, h: number, extra: Record<string, unknown> = {}, entry = 'test/palm04I2Harness.tsx'): string {
  const app = bundle(path.join(ROOT, entry), mutation);
  const esc = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#0b1020;color:#f8fafc;font-family:system-ui,sans-serif}</style>
<script>${esc(SPIES)}</script><script>window.process = { env: { NODE_ENV: 'development', NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT: 'g5-i1-dev' } };window.__PALM_HARNESS_SIZE=${JSON.stringify({ w, h })};${Object.entries(extra).map(([k, v]) => `window.${k}=${JSON.stringify(v)};`).join('')}</script>
<script>${esc(reactUmd)}</script><script>${esc(reactDomUmd)}</script></head><body><div id="root"></div><script>${esc(app)}</script></body></html>`;
}

// ---------------------------------------------------------------- independent geometry oracle
interface Box { left: number; top: number; width: number; height: number }
function oracleContent(stage: Box, imgW: number, imgH: number): Box {
  const s = Math.min(stage.width / imgW, stage.height / imgH);
  return { left: stage.left + (stage.width - imgW * s) / 2, top: stage.top + (stage.height - imgH * s) / 2, width: imgW * s, height: imgH * s };
}
const toClient = (c: Box, p: { x: number; y: number }) => ({ x: c.left + p.x * c.width, y: c.top + p.y * c.height });

const HEART: Array<[number, number]> = [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]];
const HEAD: Array<[number, number]> = [[0.37, 0.56], [0.45, 0.6], [0.54, 0.62], [0.62, 0.64]];

interface Config { name: string; vw: number; vh: number; dpr: number; touch: boolean; w: number; h: number; rotateTo?: [number, number] }
const CONFIGS: Config[] = [
  { name: 'phone-portrait 360x740 @3x touch, photo 960x1280', vw: 360, vh: 740, dpr: 3, touch: true, w: 960, h: 1280, rotateTo: [740, 360] },
  { name: 'phone-landscape 844x390 @2x touch, photo 1280x960', vw: 844, vh: 390, dpr: 2, touch: true, w: 1280, h: 960, rotateTo: [390, 844] },
  { name: 'desktop 1280x800 @1x mouse, photo 1280x960', vw: 1280, vh: 800, dpr: 1, touch: false, w: 1280, h: 960, rotateTo: [900, 700] },
  { name: 'tablet 768x1024 @2x mouse, square photo 1000x1000', vw: 768, vh: 1024, dpr: 2, touch: false, w: 1000, h: 1000 },
  { name: 'desktop 1024x700 @1.5x mouse, wide photo 1600x900', vw: 1024, vh: 700, dpr: 1.5, touch: false, w: 1600, h: 900 },
];

interface Result { passed: number; failed: string[] }

async function suite(browser: any, mutation: Mutation, configs: Config[], shots: string | null): Promise<Result> {
  const res: Result = { passed: 0, failed: [] };
  const verbose = mutation === 'none';
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { res.passed++; if (verbose) console.log(`OK   ${name}`); } else { res.failed.push(name); if (verbose) console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`); }
  };
  for (const cfg of configs) {
    try { await oneConfig(cfg); } catch (e) { res.failed.push(`EXC [${cfg.name}] ${String(e).split('\n')[0]}`); if (verbose) console.log(`FAIL EXC [${cfg.name}] ${String(e).split('\n')[0]}`); }
  }
  return res;

  async function oneConfig(cfg: Config) {
    const ctx = await browser.newContext({ viewport: { width: cfg.vw, height: cfg.vh }, deviceScaleFactor: cfg.dpr, hasTouch: cfg.touch, isMobile: false });
    const pg = await ctx.newPage();
    const requests: string[] = [];
    const errors: string[] = [];
    pg.on('request', (r: any) => requests.push(r.url()));
    pg.on('pageerror', (e: any) => errors.push(String(e)));
    await pg.setContent(page(mutation, cfg.w, cfg.h));
    await pg.waitForSelector('[data-testid="palm-tracing-stage"] canvas');
    const cdp = await ctx.newCDPSession(pg);
    const T = `[${cfg.name}]`;

    const stageBox = async (): Promise<Box> => pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const rectOf = async (sel: string): Promise<Box> => pg.$eval(sel, (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const traceOf = async (line: string): Promise<Array<{ x: number; y: number }> | null> => pg.evaluate(([l, W, H]: [string, number, number]) => {
      const el = document.querySelector(`[data-trace="${l}"]`);
      if (!el) return null;
      return (el.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map((s) => { const [x, y] = s.split(',').map(Number); return { x: x / W, y: y / H }; });
    }, [line, cfg.w, cfg.h]);
    const statusOf = async (line: string) => pg.$eval(`[data-testid="palm-tracing-step-${line}"]`, (e: Element) => ({ status: e.getAttribute('data-status'), skip: e.getAttribute('data-skip-reason') }));
    const placement = async () => pg.$eval('[data-testid="palm-tracing-feedback"]', (e: Element) => e.getAttribute('data-placement'));
    const statusText = async () => pg.$eval('[data-testid="palm-tracing-status"]', (e: Element) => e.textContent || '');
    const click = async (testid: string) => { await pg.click(`[data-testid="${testid}"]`, { timeout: 3000 }).catch(() => { if (verbose) console.log(`note: ${testid} not clickable`); }); };
    const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const tap = async (x: number, y: number) => {
      if (cfg.touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else await pg.mouse.click(x, y);
      await settle();
    };
    const drag = async (pts: Array<{ x: number; y: number }>, opts: { cancel?: boolean } = {}) => {
      const dense: Array<{ x: number; y: number }> = [];
      for (let i = 0; i + 1 < pts.length; i++) for (let k = 0; k < 8; k++) dense.push({ x: pts[i].x + ((pts[i + 1].x - pts[i].x) * k) / 8, y: pts[i].y + ((pts[i + 1].y - pts[i].y) * k) / 8 });
      dense.push(pts[pts.length - 1]);
      if (cfg.touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...dense[0], id: 1 }] });
        for (const p of dense.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: opts.cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      } else {
        await pg.mouse.move(dense[0].x, dense[0].y);
        await pg.mouse.down();
        for (const p of dense.slice(1)) await pg.mouse.move(p.x, p.y);
        if (opts.cancel) {
          // A mouse cannot be cancelled by the OS; interrupt the gesture the way the browser does when capture is lost.
          await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => e.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, isPrimary: true, bubbles: true })));
          await pg.mouse.up();
        } else await pg.mouse.up();
      }
      await settle();
    };

    // Clicking a button can scroll the page, which moves the stage: every gesture recomputes the geometry first.
    let stage = await stageBox();
    let content = oracleContent(stage, cfg.w, cfg.h);
    const fresh = async () => {
      await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => e.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await settle();
      stage = await stageBox();
      content = oracleContent(stage, cfg.w, cfg.h);
      return content;
    };
    const tapN = async (p: { x: number; y: number }) => { const c = await fresh(); const q = toClient(c, p); await tap(q.x, q.y); };
    const dragN = async (pts: Array<{ x: number; y: number }>, opts: { cancel?: boolean } = {}) => { const c = await fresh(); await drag(pts.map((p) => toClient(c, p)), opts); };
    const errPx = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * content.width, (a.y - b.y) * content.height);
    const N = (arr: Array<[number, number]>) => arr.map(([x, y]) => ({ x, y }));

    // ------------------------------------------------ geometry: photo, guides
    await fresh();
    const photo = await rectOf('[data-testid="palm-tracing-photo"]');
    const near = (a: number, b: number, tol = 0.75) => Math.abs(a - b) <= tol;
    check(`G1 ${T} the photo is shown at the contain rectangle (letterboxed, centred)`, near(photo.left, content.left) && near(photo.top, content.top) && near(photo.width, content.width) && near(photo.height, content.height), { photo, content });
    check(`G2 ${T} the photo is not distorted (displayed aspect = image aspect)`, Math.abs(photo.width / photo.height - cfg.w / cfg.h) < 0.005);
    const intrinsic = await pg.$eval('[data-testid="palm-tracing-photo"]', (e: Element) => ({ w: (e as HTMLCanvasElement).width, h: (e as HTMLCanvasElement).height }));
    check(`G3 ${T} the overlay draws the photo at its own image size (device pixel ratio does not change the geometry)`, intrinsic.w === cfg.w && intrinsic.h === cfg.h);
    const lm = await pg.evaluate(() => (window as any).__palmHarness.landmarks());
    const guideIdx: Record<string, number> = { index: 5, middle: 9, ring: 13, little: 17, wrist: 0 };
    const guideErr: number[] = [];
    for (const [name, k] of Object.entries(guideIdx)) {
      const r = await rectOf(`[data-guide="${name}"]`);
      const want = toClient(content, lm[k]);
      guideErr.push(Math.hypot(r.left + r.width / 2 - want.x, r.top + r.height / 2 - want.y));
    }
    check(`G4 ${T} all five guides sit on their landmarks (max error ${Math.max(...guideErr).toFixed(2)} CSS px)`, Math.max(...guideErr) <= 1.0, guideErr);

    // ------------------------------------------------ taps: exact coordinate round trip
    for (const p of N(HEART)) await tapN(p);
    const tapped = await traceOf('heart');
    const tapErr = tapped ? tapped.map((p, k) => errPx(p, N(HEART)[k])) : [99];
    check(`T1 ${T} four taps record four points at the tapped photo positions (max error ${Math.max(...tapErr).toFixed(3)} CSS px)`, !!tapped && tapped.length === 4 && Math.max(...tapErr) <= 0.6, { tapped, tapErr });
    check(`T2 ${T} live validation: the tapped heart trace is usable (I1 verdict)`, (await placement()) === 'ok');
    check(`T3 ${T} progress shows line 1 of 4`, /Line 1 of 4/.test(await pg.textContent('[data-testid="palm-tracing-progress"]')));

    // undo removes the last tapped point, then confirm
    await click('palm-tracing-undo'); await settle();
    check(`U1 ${T} Undo removes the last point`, ((await traceOf('heart')) ?? []).length === 3);
    await tapN(N(HEART)[3]);
    await click('palm-tracing-confirm'); await settle();
    check(`C1 ${T} a valid trace is confirmed`, (await statusOf('heart')).status === 'confirmed');
    const confirmedHeart = await traceOf('heart');
    // drawing on a confirmed line does nothing
    await tapN({ x: HEART[1][0] + 0.03, y: HEART[1][1] + 0.03 });
    check(`C2 ${T} drawing on a confirmed line changes nothing (Edit trace is required)`, JSON.stringify(await traceOf('heart')) === JSON.stringify(confirmedHeart) && (await statusOf('heart')).status === 'confirmed');

    // ------------------------------------------------ head line: invalid then drag
    await click('palm-tracing-next'); await settle();
    check(`N1 ${T} Next moves to line 2 (head)`, /Line 2 of 4/.test(await pg.textContent('[data-testid="palm-tracing-progress"]')) && (await pg.textContent('[data-testid="palm-tracing-title"]'))!.includes('Head'));
    await tapN(N(HEAD)[0]);
    await tapN({ x: HEAD[0][0] + 0.004, y: HEAD[0][1] + 0.001 });
    const invalid = await placement();
    check(`V1 ${T} an incomplete/too-short trace is not usable and says why (${invalid})`, invalid !== 'ok' && invalid !== 'none');
    const confirmDisabled = await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).disabled);
    await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).click());
    await settle();
    check(`V2 ${T} an unusable trace cannot be confirmed (button disabled, and a forced click is refused)`, confirmDisabled && (await statusOf('head')).status === 'tracing');
    // a drag replaces the trace with the drawn stroke (bounded points, endpoints kept)
    await dragN(N(HEAD));
    const dragged = await traceOf('head');
    const endErr = dragged ? Math.max(errPx(dragged[0], N(HEAD)[0]), errPx(dragged[dragged.length - 1], N(HEAD)[3])) : 99;
    check(`D1 ${T} a drag replaces the trace with the drawn stroke: ${dragged?.length} points (<= 24), endpoints within ${endErr.toFixed(2)} CSS px`, !!dragged && dragged.length >= 2 && dragged.length <= 24 && endErr <= 0.8, { dragged: dragged?.length, endErr });
    check(`D2 ${T} the drawn head line is usable`, (await placement()) === 'ok');
    // interrupted gesture: nothing changes
    const beforeCancel = await traceOf('head');
    await dragN([N(HEAD)[0], { x: HEAD[2][0], y: HEAD[2][1] + 0.05 }], { cancel: true });
    check(`I1 ${T} an interrupted gesture (pointercancel) changes nothing and says so`, JSON.stringify(await traceOf('head')) === JSON.stringify(beforeCancel) && /interrupted/i.test(await statusText()));
    // a stroke that leaves the photo is refused (R3: never clamped, never shortened, never enters the draft)
    const beforeOut = await traceOf('head');
    await dragN([N(HEAD)[0], { x: 1.06, y: HEAD[3][1] }]);
    check(`O1 ${T} a stroke that leaves the photo is refused: the draft is unchanged (no clamped or shortened stroke) and the user is told`, JSON.stringify(await traceOf('head')) === JSON.stringify(beforeOut) && /outside the photo/i.test(await statusText()));
    // a gesture that starts in the letterbox is refused
    await fresh();
    if (content.left - stage.left > 12 || content.top - stage.top > 12) {
      const lb = content.left - stage.left > 12 ? { x: stage.left + 4, y: stage.top + stage.height / 2 } : { x: stage.left + stage.width / 2, y: stage.top + 4 };
      const beforeLb = await traceOf('head');
      await tap(lb.x, lb.y);
      check(`O2 ${T} a gesture starting in the letterbox (outside the photo) adds nothing`, JSON.stringify(await traceOf('head')) === JSON.stringify(beforeLb) && /on the photo/.test(await statusText()));
    }
    check(`U2 ${T} the drawn stroke is still the draft after the refused one (nothing to undo) and is usable`, (await placement()) === 'ok');
    await click('palm-tracing-confirm'); await settle();
    // reopen and correct a confirmed line
    await click('palm-tracing-edit'); await settle();
    check(`E1 ${T} Edit trace reopens a confirmed line (no longer confirmed until re-confirmed)`, (await statusOf('head')).status === 'tracing');
    await dragN(N(HEAD).map((p) => ({ x: p.x, y: p.y + 0.004 })));
    await click('palm-tracing-confirm'); await settle();
    check(`E2 ${T} the corrected trace replaces the old one and is confirmed again`, (await statusOf('head')).status === 'confirmed');

    // ------------------------------------------------ skip / cannot see / not requested
    await click('palm-tracing-next'); await settle();
    await click('palm-tracing-cannot-see'); await settle();
    await click('palm-tracing-next'); await settle();
    const life = await statusOf('life');
    const upward = await statusOf('upward');
    check(`S1 ${T} I can't see this line, Skip and untouched stay distinct (life: skipped/user-cannot-see; upward: not-started = not requested)`, life.status === 'skipped' && life.skip === 'user-cannot-see' && upward.status === 'not-started' && upward.skip === null);
    await click('palm-tracing-skip'); await settle();
    const up2 = await statusOf('upward');
    check(`S2 ${T} Skip records user-skipped (not assessed), distinct from cannot-see`, up2.status === 'skipped' && up2.skip === 'user-skipped' && /not assessed/.test((await pg.textContent('[data-testid="palm-tracing-step-upward"]'))!));
    check(`S3 ${T} no skipped line carries a trace`, (await traceOf('life')) === null && (await traceOf('upward')) === null);
    await click('palm-tracing-back'); await settle();
    await click('palm-tracing-retrace'); await settle();
    check(`S4 ${T} a skipped line can be traced after all (Trace this line)`, (await statusOf('life')).status === 'tracing');

    if (shots && mutation === 'none') {
      await click('palm-tracing-step-head'); await settle();
      await pg.screenshot({ path: path.join(shots, `p4i2-${cfg.vw}x${cfg.vh}@${cfg.dpr}x-${cfg.w}x${cfg.h}.png`), fullPage: true });
    }

    // ------------------------------------------------ layout change: resize / orientation
    if (cfg.rotateTo) {
      const keep = { heart: await traceOf('heart'), head: await traceOf('head') };
      await pg.setViewportSize({ width: cfg.rotateTo[0], height: cfg.rotateTo[1] });
      await pg.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
      await settle(); await settle();
      await fresh();
      const ph = await rectOf('[data-testid="palm-tracing-photo"]');
      check(`L1 ${T} after rotating to ${cfg.rotateTo.join('x')} the photo follows the new contain rectangle`, near(ph.left, content.left) && near(ph.width, content.width) && near(ph.height, content.height), { ph, content });
      check(`L2 ${T} confirmed observations are unchanged by the layout change (same normalised points, still confirmed)`, JSON.stringify(await traceOf('heart')) === JSON.stringify(keep.heart) && JSON.stringify(await traceOf('head')) === JSON.stringify(keep.head) && (await statusOf('heart')).status === 'confirmed');
      const wrist = await rectOf('[data-guide="wrist"]');
      const wantW = toClient(content, lm[0]);
      check(`L3 ${T} guides are re-positioned exactly after the layout change`, Math.hypot(wrist.left + wrist.width / 2 - wantW.x, wrist.top + wrist.height / 2 - wantW.y) <= 1.0);
      await click('palm-tracing-step-life'); await settle();
      await tapN({ x: 0.36, y: 0.6 });
      const lt = await traceOf('life');
      check(`L4 ${T} input after the layout change maps through the new geometry`, !!lt && lt.length === 1 && errPx(lt[0], { x: 0.36, y: 0.6 }) <= 0.6);
    }

    // ------------------------------------------------ lifecycle: multi-pointer, replacement, revoke, teardown
    if (cfg.touch) {
      await click('palm-tracing-step-life'); await settle();
      const before = await traceOf('life');
      await fresh();
      const a = toClient(content, { x: 0.37, y: 0.66 }), b = toClient(content, { x: 0.6, y: 0.3 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }, { ...b, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...a, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await settle();
      const after = await traceOf('life');
      check(`M1 ${T} a second finger during a gesture is ignored (only the first finger's tap is recorded)`, (after ?? []).length === (before ?? []).length + 1 && errPx(after![after!.length - 1], { x: 0.37, y: 0.66 }) <= 0.6, { before: before?.length, after: after?.length });
    }
    // a gesture begun on the old photo and finished after replacement changes nothing on the new photo
    await click('palm-tracing-step-heart'); await settle();
    await fresh();
    const s0 = toClient(content, { x: 0.6, y: 0.6 });
    if (cfg.touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...s0, id: 1 }] });
    else { await pg.mouse.move(s0.x, s0.y); await pg.mouse.down(); }
    await pg.evaluate(() => (window as any).__palmHarness.replace());
    await settle();
    if (cfg.touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s0.x + 40, y: s0.y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await pg.mouse.move(s0.x + 40, s0.y); await pg.mouse.up(); }
    await settle();
    const freshStatus = await Promise.all(["heart", "head", "life", "upward"].map(statusOf));
    check(`R1 ${T} photo replacement starts over: a fresh model, no traces or statuses carried over, and the stale gesture changed nothing`, freshStatus.every((s) => s.status === "not-started") && (await traceOf('heart')) === null && /Line 1 of 4/.test(await pg.textContent('[data-testid="palm-tracing-progress"]')));
    const lm2 = await pg.evaluate(() => (window as any).__palmHarness.landmarks());
    await fresh();
    const wr2 = await rectOf('[data-guide="wrist"]');
    const want2 = toClient(content, lm2[0]);
    check(`R2 ${T} the guides now show the new photo's landmarks`, Math.hypot(wr2.left + wr2.width / 2 - want2.x, wr2.top + wr2.height / 2 - want2.y) <= 1.0 && lm2[0].x !== lm[0].x);
    // revoke while idle, then a delayed gesture and a delayed resize
    await tapN({ x: 0.6, y: 0.545 });
    const late = toClient(await fresh(), { x: 0.61, y: 0.545 }); // where the next gesture lands (the stage may already be gone)
    await pg.evaluate(() => (window as any).__palmHarness.revoke());
    await tap(late.x, late.y);
    await pg.setViewportSize({ width: cfg.vw, height: cfg.vh });
    await settle();
    const state = await pg.$eval('[data-testid="palm-tracing"]', (e: Element) => e.getAttribute('data-state'));
    check(`R3 ${T} after the context is cleared, the next gesture is refused, every trace is dropped and the overlay is gone`, state === 'cleared' && (await pg.$$('[data-trace]')).length === 0 && (await pg.$$('[data-testid="palm-tracing-photo"]')).length === 0);
    // teardown releases the overlay's copy of the photo
    await pg.evaluate(() => (window as any).__palmHarness.replace());
    await pg.waitForSelector('[data-testid="palm-tracing-photo"]', { timeout: 5000 });
    await pg.evaluate(() => { (window as any).__photo = document.querySelector('[data-testid="palm-tracing-photo"]'); (window as any).__palmHarness.unmount(); });
    await settle();
    const released = await pg.evaluate(() => ({ gone: !document.querySelector('[data-testid="palm-tracing"]'), w: (window as any).__photo.width, h: (window as any).__photo.height }));
    check(`X1 ${T} teardown removes the panel and empties its copy of the photo (0x0 canvas)`, released.gone && released.w === 0 && released.h === 0, released);

    // ------------------------------------------------ privacy
    const priv = await pg.evaluate(() => (window as any).__privacy);
    check(`P1 ${T} no network request, storage, cookie, IndexedDB, image encoding or console output during the whole session`, requests.length === 0 && priv.length === 0, { requests, priv });
    check(`P2 ${T} no page errors`, errors.length === 0, errors);
    await ctx.close();
  }
}

// ================================================================ R1 (50347): findings F1-F4
/**
 * Deterministic regressions for the four findings of independent verification 50346, with native Chromium input
 * (Playwright mouse and keyboard; Chrome DevTools mouse events with pointerType "pen"; DevTools touch events).
 * Every check name starts with its finding (F1..F4) so the negative controls can be attributed.
 */
async function findingsSuite(browser: any, mutation: Mutation, verbose: boolean): Promise<Result> {
  const res: Result = { passed: 0, failed: [] };
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { res.passed++; if (verbose) console.log(`OK   ${name}`); } else { res.failed.push(name); if (verbose) console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
  };
  const W = 1280, H = 960;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: true });
  const pg = await ctx.newPage();
  const errors: string[] = [];
  pg.on('pageerror', (e: any) => errors.push(String(e).split('\n')[0]));
  await pg.setContent(page(mutation, W, H));
  await pg.waitForSelector('[data-testid="palm-tracing-stage"] canvas');
  const cdp = await ctx.newCDPSession(pg);
  const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wait = (ms: number) => pg.waitForTimeout(ms);
  const stageBox = async (): Promise<Box> => pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const C = async () => oracleContent(await stageBox(), W, H);
  const at = (c: Box, x: number, y: number) => ({ x: c.left + x * c.width, y: c.top + y * c.height });
  const traceOf = async (line: string): Promise<Array<{ x: number; y: number }> | null> => pg.evaluate(([l, w, h]: [string, number, number]) => {
    const el = document.querySelector(`[data-trace="${l}"]`);
    return el ? (el.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map((t) => { const [x, y] = t.split(',').map(Number); return { x: x / w, y: y / h }; }) : null;
  }, [line, W, H]);
  const statusOf = async (line: string) => pg.$eval(`[data-testid="palm-tracing-step-${line}"]`, (e: Element) => ({ status: e.getAttribute('data-status'), skip: e.getAttribute('data-skip-reason') })).catch(() => ({ status: 'gone', skip: null }));
  const placement = async () => pg.$eval('[data-testid="palm-tracing-feedback"]', (e: Element) => e.getAttribute('data-placement')).catch(() => 'gone');
  const statusText = async () => pg.$eval('[data-testid="palm-tracing-status"]', (e: Element) => e.textContent || '').catch(() => '');
  const panelState = async () => pg.$eval('[data-testid="palm-tracing"]', (e: Element) => e.getAttribute('data-state')).catch(() => 'gone');
  const press = async (testid: string) => { await pg.focus(`[data-testid="${testid}"]`).catch(() => {}); await pg.keyboard.press('Enter'); await settle(); };
  const step = async (line: string) => press(`palm-tracing-step-${line}`);
  const fresh = async () => { await pg.evaluate(() => (window as any).__palmHarness.replace()); await pg.waitForSelector('[data-testid="palm-tracing-photo"]', { timeout: 5000 }).catch(() => {}); await settle(); };
  const HEADN: Array<[number, number]> = [[0.37, 0.56], [0.45, 0.6], [0.54, 0.62], [0.62, 0.64]];
  const tapPts = async (pts: Array<[number, number]>) => { const c = await C(); for (const [x, y] of pts) { const q = at(c, x, y); await pg.mouse.click(q.x, q.y); } await settle(); };
  /** Hold a mouse stroke (down + moves, no release). */
  const holdStroke = async (pts: Array<[number, number]>) => {
    const c = await C(); const a = at(c, pts[0][0], pts[0][1]);
    await pg.mouse.move(a.x, a.y); await pg.mouse.down();
    for (const [x, y] of pts.slice(1)) { const q = at(c, x, y); await pg.mouse.move(q.x, q.y, { steps: 4 }); }
    await settle();
  };
  const T = '[desktop 1280x800 mouse/keyboard/pen]';

  // ---------------------------------------------------------------- F1 pending gesture vs explicit decisions
  for (const [testid, want] of [['palm-tracing-skip', { status: 'skipped', skip: 'user-skipped' }], ['palm-tracing-cannot-see', { status: 'skipped', skip: 'user-cannot-see' }]] as const) {
    await fresh();
    await holdStroke(HEADN.slice(0, 3));
    await press(testid);
    await pg.mouse.up(); await settle();
    const st = await statusOf('heart');
    check(`F1 ${T} hold a stroke, press ${testid.replace('palm-tracing-', '')} with Enter, release: the decision stands (no draft, no trace)`, st.status === want.status && st.skip === want.skip && (await traceOf('heart')) === null, st);
  }
  {
    await fresh();
    await tapPts([[0.37, 0.56], [0.45, 0.6]]);
    await holdStroke(HEADN);
    await press('palm-tracing-clear');
    await pg.mouse.up(); await settle();
    check(`F1 ${T} hold a stroke, Clear line, release: the line stays cleared (not started, no trace)`, (await statusOf('heart')).status === 'not-started' && (await traceOf('heart')) === null);
  }
  {
    await fresh();
    await tapPts([[0.37, 0.56], [0.45, 0.6], [0.54, 0.62]]);
    await holdStroke(HEADN);
    await press('palm-tracing-undo');
    await pg.mouse.up(); await settle();
    const t = await traceOf('heart');
    check(`F1 ${T} hold a stroke, Undo, release: the undo stands (two points), the stroke is not applied`, !!t && t.length === 2, t?.length);
  }
  {
    await fresh();
    await tapPts(HEADN);
    const before = await traceOf('heart');
    await holdStroke([[0.37, 0.7], [0.5, 0.72], [0.6, 0.74]]);
    await press('palm-tracing-confirm');
    await pg.mouse.up(); await settle();
    check(`F1 ${T} hold a stroke, Confirm, release: the confirmed trace is the one that was confirmed (stroke discarded)`, (await statusOf('heart')).status === 'confirmed' && JSON.stringify(await traceOf('heart')) === JSON.stringify(before));
    await press('palm-tracing-edit');
    await holdStroke([[0.37, 0.7], [0.5, 0.72], [0.6, 0.74]]);
    await press('palm-tracing-confirm');
    await pg.mouse.up(); await settle();
    check(`F1 ${T} Edit, hold a stroke, Confirm, release: still the earlier trace, still confirmed`, (await statusOf('heart')).status === 'confirmed' && JSON.stringify(await traceOf('heart')) === JSON.stringify(before));
  }
  {
    await fresh();
    await tapPts([[0.37, 0.56]]);
    await holdStroke(HEADN);
    await press('palm-tracing-next');
    await pg.mouse.up(); await settle();
    const heart = await traceOf('heart'), head = await traceOf('head');
    check(`F1 ${T} hold a stroke on line 1, Next line, release: neither line 1 nor line 2 is changed`, !!heart && heart.length === 1 && head === null && (await statusOf('head')).status === 'not-started');
    await holdStroke(HEADN);
    await press('palm-tracing-back');
    await pg.mouse.up(); await settle();
    check(`F1 ${T} hold a stroke on line 2, Back, release: line 2 stays untouched`, (await traceOf('head')) === null && (await statusOf('head')).status === 'not-started' && (await traceOf('heart'))!.length === 1);
    await press('palm-tracing-skip');
    await press('palm-tracing-retrace');
    await holdStroke(HEADN);
    await press('palm-tracing-skip');
    await pg.mouse.up(); await settle();
    check(`F1 ${T} Trace this line, hold a stroke, Skip again, release: skipped stands`, (await statusOf('heart')).status === 'skipped');
  }
  {
    await fresh();
    await holdStroke(HEADN);
    await pg.evaluate(() => (window as any).__palmHarness.replace());
    await settle();
    await pg.mouse.up(); await settle();
    check(`F1 ${T} hold a stroke, photo replaced, release: the new photo's lines are untouched`, (await statusOf('heart')).status === 'not-started' && (await traceOf('heart')) === null);
  }

  // ---------------------------------------------------------------- F2 the release position counts
  const penOrMouse = async (kind: 'pen' | 'mouse', pts: Array<{ x: number; y: number }>, release: { x: number; y: number }) => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1, pointerType: kind });
    for (const q of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y, button: 'left', buttons: 1, pointerType: kind });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: release.x, y: release.y, button: 'left', buttons: 0, clickCount: 1, pointerType: kind });
    await settle();
  };
  for (const kind of ['pen', 'mouse'] as const) {
    await fresh();
    const c = await C();
    const inside = [at(c, 0.37, 0.56), at(c, 0.45, 0.6), at(c, 0.54, 0.62)];
    const outside = { x: c.left + c.width + 40, y: at(c, 0, 0.64).y };
    await penOrMouse(kind, inside, outside);
    const t = await traceOf('heart');
    check(`F2 ${T} ${kind}: down and moves inside, release OUTSIDE the photo with no final move -> the release position counts: the gesture is refused (nothing clamped or shortened enters the draft) and the user is told`, t === null && /outside the photo/i.test(await statusText()), { t, msg: await statusText() });
    check(`F2 ${T} ${kind}: that stroke cannot be confirmed (button disabled; forced click refused)`, await (async () => { const d = await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).disabled).catch(() => true); await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).click()).catch(() => {}); await settle(); return d && (await statusOf('heart')).status !== 'confirmed'; })());
  }
  {
    await fresh();
    const c = await C();
    await penOrMouse('pen', [at(c, 0.37, 0.56), at(c, 0.45, 0.6)], at(c, 0.62, 0.64));
    const t = (await traceOf('heart'))!;
    const e = Math.hypot((t[t.length - 1].x - 0.62) * c.width, (t[t.length - 1].y - 0.64) * c.height);
    check(`F2 ${T} pen: release INSIDE at a new position with no final move -> the stroke ends exactly at the release (${e.toFixed(3)} px) and is usable`, e <= 0.6 && (await placement()) === 'ok');
    await fresh();
    const c2 = await C();
    await penOrMouse('pen', [at(c2, 0.62, 0.64), at(c2, 0.5, 0.62), at(c2, 0.3, 0.6)], { x: c2.left, y: at(c2, 0, 0.6).y });
    const t2 = (await traceOf('heart'))!;
    check(`F2 ${T} pen: release exactly on the photo's left edge -> recorded at x = 0 (to float precision) and treated as on the photo (not outside-image)`, Math.abs(t2[t2.length - 1].x) < 1e-6 && (await placement()) !== 'trace-outside-image', t2[t2.length - 1]);
  }
  {
    await fresh();
    const c = await C();
    await tapPts([[0.37, 0.56]]);
    const before = await traceOf('heart');
    const a = at(c, 0.45, 0.6), b = at(c, 0.6, 0.62);
    await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move(b.x, b.y, { steps: 5 });
    await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { const s = e as HTMLElement; for (const id of [1, 0, 2]) { try { if (s.hasPointerCapture(id)) s.releasePointerCapture(id); } catch { /* not captured */ } } });
    await settle();
    await pg.mouse.up(); await settle();
    check(`F2 ${T} lost pointer capture mid-stroke -> nothing changes, even when the button is released afterwards`, JSON.stringify(await traceOf('heart')) === JSON.stringify(before));
    await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move(b.x, b.y, { steps: 5 });
    await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => e.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, isPrimary: true, bubbles: true })));
    await pg.mouse.up(); await settle();
    check(`F2 ${T} pointercancel mid-stroke -> nothing changes, release afterwards ignored`, JSON.stringify(await traceOf('heart')) === JSON.stringify(before) && /interrupted/i.test(await statusText()));
  }
  {
    await fresh();
    let c = await C();
    const a = at(c, 0.37, 0.56);
    await pg.mouse.move(a.x, a.y); await pg.mouse.down();
    await pg.mouse.move(at(c, 0.45, 0.6).x, at(c, 0.45, 0.6).y, { steps: 3 });
    await pg.setViewportSize({ width: 900, height: 700 }); await settle(); await settle();
    c = oracleContent(await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }), W, H);
    const end = at(c, 0.62, 0.64);
    await pg.mouse.move(end.x, end.y, { steps: 3 }); await pg.mouse.up(); await settle();
    const t = (await traceOf('heart'))!;
    const e = t ? Math.hypot((t[t.length - 1].x - 0.62) * c.width, (t[t.length - 1].y - 0.64) * c.height) : 99;
    check(`F2 ${T} layout change during a gesture -> later positions map through the new geometry (end error ${e.toFixed(2)} px)`, e <= 0.8);
    await pg.setViewportSize({ width: 1280, height: 800 }); await settle();
  }
  {
    // touch: the release is reported at the last touch position; a stroke ending off the photo is judged, not clamped
    await fresh();
    const c = await C();
    const pts = [at(c, 0.37, 0.56), at(c, 0.5, 0.6), { x: c.left + c.width + 30, y: at(c, 0, 0.62).y }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pts[0], id: 1 }] });
    for (const q of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...q, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle();
    check(`F2 ${T} touch: a stroke ending off the photo is refused (never clamped into the photo)`, (await traceOf('heart')) === null && /outside the photo/i.test(await statusText()));
  }

  // ---------------------------------------------------------------- F3 revocation without interaction
  {
    await fresh();
    await tapPts(HEADN);
    await press('palm-tracing-confirm');
    await pg.evaluate(() => { (window as any).__photoR1 = document.querySelector('[data-testid="palm-tracing-photo"]'); (window as any).__palmHarness.revoke(); });
    await wait(700);
    const cleared = await pg.evaluate(() => ({ state: document.querySelector('[data-testid="palm-tracing"]')?.getAttribute('data-state'), traces: document.querySelectorAll('[data-trace]').length, photo: !!document.querySelector('[data-testid="palm-tracing-photo"]'), w: (window as any).__photoR1.width, h: (window as any).__photoR1.height }));
    check(`F3 ${T} standalone revocation, no interaction: within 0.7 s the confirmed trace, guides and photo are gone and the photo copy is emptied`, cleared.state === 'cleared' && cleared.traces === 0 && !cleared.photo && cleared.w === 0 && cleared.h === 0, cleared);
    await pg.setViewportSize({ width: 1000, height: 760 });
    await pg.evaluate(() => { window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('orientationchange')); });
    await wait(400);
    check(`F3 ${T} revocation followed by resize and delayed observer callbacks: nothing is restored`, (await panelState()) === 'cleared' && (await pg.$$('[data-trace]')).length === 0 && (await pg.$$('[data-testid="palm-tracing-photo"]')).length === 0);
    await pg.setViewportSize({ width: 1280, height: 800 });
  }
  {
    await fresh();
    const c = await C();
    const a = at(c, 0.37, 0.56);
    await pg.mouse.move(a.x, a.y); await pg.mouse.down(); await pg.mouse.move(at(c, 0.5, 0.6).x, at(c, 0.5, 0.6).y, { steps: 4 });
    await pg.evaluate(() => (window as any).__palmHarness.revoke());
    await wait(700);
    const mid = await panelState();
    await pg.mouse.move(at(c, 0.62, 0.64).x, at(c, 0.62, 0.64).y, { steps: 2 }); await pg.mouse.up(); await settle();
    check(`F3 ${T} revocation during an active gesture: the panel clears by itself, and the release restores nothing`, mid === 'cleared' && (await panelState()) === 'cleared' && (await pg.$$('[data-trace]')).length === 0 && (await pg.$$('[data-draft]')).length === 0);
    await fresh();
    const w = await pg.$eval('[data-testid="palm-tracing-photo"]', (e: Element) => (e as HTMLCanvasElement).width).catch(() => 0);
    check(`F3 ${T} replacement after revocation: a fresh, working panel with the photo drawn again`, (await panelState()) === 'active' && w === W && (await statusOf('heart')).status === 'not-started');
  }
  {
    const cycles: boolean[] = [];
    for (let k = 0; k < 3; k++) {
      await pg.evaluate(() => { (window as any).__photoCycle = document.querySelector('[data-testid="palm-tracing-photo"]'); (window as any).__palmHarness.unmount(); });
      await settle();
      const gone = await pg.evaluate(() => !document.querySelector('[data-testid="palm-tracing"]') && (window as any).__photoCycle.width === 0);
      await pg.evaluate(() => (window as any).__palmHarness.mountAgain());
      await pg.waitForSelector('[data-testid="palm-tracing-photo"]', { timeout: 5000 }).catch(() => {});
      await settle();
      await tapPts([[0.37, 0.56]]);
      cycles.push(gone && (await panelState()) === 'active' && (await traceOf('heart'))?.length === 1);
    }
    check(`F3 ${T} repeated teardown and mounting (3 cycles): each teardown empties the photo copy, each mount starts fresh and works`, cycles.every(Boolean), cycles);
  }

  // ---------------------------------------------------------------- F4 the model's point limit, handled
  {
    await fresh();
    const c = await C();
    // 998 taps as native PointerEvents dispatched in the page (fast), then real Chromium clicks around the limit
    await pg.evaluate(([box, n]: [Box, number]) => {
      const st = document.querySelector('[data-testid="palm-tracing-stage"]')!;
      for (let i = 0; i < n; i++) {
        const x = box.left + (0.4 + 0.2 * ((i * 37) % 100) / 100) * box.width, y = box.top + (0.55 + 0.08 * ((i * 61) % 100) / 100) * box.height;
        st.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        st.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      }
    }, [c, 998] as [Box, number]);
    await settle();
    const n = async () => ((await traceOf('heart')) ?? []).length;
    check(`F4 ${T} below the limit: 998 points accepted`, (await n()) === 998, await n());
    await tapPts([[0.41, 0.57]]);
    const at999 = await n();
    await tapPts([[0.42, 0.57]]);
    check(`F4 ${T} immediately below and exactly at the model's limit: points 999 and 1000 are accepted (real clicks)`, at999 === 999 && (await n()) === 1000);
    const errsBefore = errors.length;
    await tapPts([[0.43, 0.57]]);
    check(`F4 ${T} beyond the limit: the 1001st tap is refused with no exception; the trace keeps 1000 points`, (await n()) === 1000 && errors.length === errsBefore && (await panelState()) === 'active', errors.slice(errsBefore));
    const msg = await statusText();
    check(`F4 ${T} the refusal is announced in the live region and says Undo, Clear line or retrace`, /point limit/i.test(msg) && /Undo/.test(msg) && /Clear line/.test(msg), msg);
    await tapPts([[0.44, 0.57], [0.45, 0.57], [0.46, 0.57]]);
    check(`F4 ${T} repeated input after the limit: still refused, still no exception, still 1000 points`, (await n()) === 1000 && errors.length === errsBefore);
    const confirmDisabled = await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).disabled).catch(() => false);
    await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).click()).catch(() => {}); await settle();
    check(`F4 ${T} an over-I1-limit trace cannot be confirmed (I1: too many points), and nothing was truncated into an eligible trace`, confirmDisabled && (await placement()) === 'trace-too-many-points' && (await statusOf('heart')).status === 'tracing');
    await press('palm-tracing-undo');
    const afterUndo = await n();
    await tapPts([[0.47, 0.57]]);
    check(`F4 ${T} Undo recovers below the limit (999) and input works again (1000)`, afterUndo === 999 && (await n()) === 1000 && errors.length === errsBefore);
    await press('palm-tracing-clear');
    await tapPts(HEADN);
    check(`F4 ${T} Clear line and retrace: a fresh usable trace`, (await n()) === 4 && (await placement()) === 'ok');
    // a very long drag is reduced to a bounded stroke, never a model overflow
    const c2 = await C();
    const a = at(c2, 0.37, 0.56);
    await pg.mouse.move(a.x, a.y); await pg.mouse.down();
    for (let i = 1; i <= 1500; i++) { const t = i / 1500; await pg.mouse.move(a.x + t * 0.25 * c2.width, a.y + t * 0.08 * c2.height + Math.sin(i / 9) * 1.5); }
    await pg.mouse.up(); await settle();
    check(`F4 ${T} a 1,500-move drag becomes one bounded stroke (<= 24 points), with no exception`, (await n()) >= 2 && (await n()) <= 24 && errors.length === errsBefore);
  }
  check(`F* ${T} no uncaught page errors in the whole findings run`, errors.length === 0, errors);
  await ctx.close();
  return res;
}

// ================================================================ R2 (50350): terminal boundary validation
/**
 * F2 residual (independent disposition 50348): a gesture that moves less than the tap slop but is RELEASED off the
 * photo. The terminal coordinate must never be discarded by the tap path: such a gesture is refused, the existing
 * draft is unchanged, and nothing invalid can be confirmed. Native mouse and pen (Chrome DevTools mouse events with
 * pointerType) and touch (DevTools touch events), on two letterboxed geometries. Check names start with "B".
 */
async function boundarySuite(browser: any, mutation: Mutation, verbose: boolean): Promise<Result> {
  const res: Result = { passed: 0, failed: [] };
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { res.passed++; if (verbose) console.log(`OK   ${name}`); } else { res.failed.push(name); if (verbose) console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
  };
  const geometries = [
    { name: 'desktop 1280x800 @1x, photo 1280x960 (letterboxed left/right)', vw: 1280, vh: 800, dpr: 1, W: 1280, H: 960 },
    { name: 'phone 390x844 @3x, photo 960x1280 (scaled, letterboxed top/bottom)', vw: 390, vh: 844, dpr: 3, W: 960, H: 1280 },
  ];
  for (const geo of geometries) {
    const ctx = await browser.newContext({ viewport: { width: geo.vw, height: geo.vh }, deviceScaleFactor: geo.dpr, hasTouch: true });
    const pg = await ctx.newPage();
    const errors: string[] = [];
    pg.on('pageerror', (e: any) => errors.push(String(e).split('\n')[0]));
    await pg.setContent(page(mutation, geo.W, geo.H));
    await pg.waitForSelector('[data-testid="palm-tracing-stage"] canvas');
    const cdp = await ctx.newCDPSession(pg);
    const T = `[${geo.name}]`;
    const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const C = async (): Promise<Box> => oracleContent(await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }), geo.W, geo.H);
    const at = (c: Box, x: number, y: number) => ({ x: c.left + x * c.width, y: c.top + y * c.height });
    const trace = async (line: string): Promise<Array<{ x: number; y: number }>> => pg.evaluate(([l, w, h]: [string, number, number]) => {
      const el = document.querySelector(`[data-trace="${l}"]`);
      return el ? (el.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map((t) => { const [x, y] = t.split(',').map(Number); return { x: x / w, y: y / h }; }) : [];
    }, [line, geo.W, geo.H]);
    const statusOf = async (line: string) => pg.$eval(`[data-testid="palm-tracing-step-${line}"]`, (e: Element) => e.getAttribute('data-status'));
    const placement = async () => pg.$eval('[data-testid="palm-tracing-feedback"]', (e: Element) => e.getAttribute('data-placement'));
    const statusText = async () => pg.$eval('[data-testid="palm-tracing-status"]', (e: Element) => e.textContent || '');
    const fresh = async (shift = 0.02) => { await pg.evaluate((s: number) => (window as any).__palmHarness.replace(s), shift); await pg.waitForSelector('[data-testid="palm-tracing-photo"]'); await settle(); };
    type Kind = 'mouse' | 'pen' | 'touch';
    /** Press at `a`, optionally move to `m`, release at `r` -- with NO pointermove at the release position. */
    const gesture = async (kind: Kind, a: { x: number; y: number }, r: { x: number; y: number }, m?: { x: number; y: number }) => {
      if (kind === 'touch') {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] });
        if (m) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...m, id: 1 }] });
        // touch reports its release at the last touch position: move there, then lift
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...r, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1, pointerType: kind });
        if (m) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: m.x, y: m.y, button: 'left', buttons: 1, pointerType: kind });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1, pointerType: kind });
      }
      await settle();
    };
    const tapAt = async (x: number, y: number) => { const c = await C(); const p = at(c, x, y); await gesture('mouse', p, p); };

    // ---- the exact 50348 witness: down at x = 0.996, release at x = 1.004 (below tap slop), no final move
    const BASE: Array<[number, number]> = [[0.75, 0.48], [0.85, 0.475], [0.93, 0.47]];
    for (const kind of ['mouse', 'pen', 'touch'] as Kind[]) {
      await fresh(0.255);
      for (const [x, y] of BASE) await tapAt(x, y);
      const before = await trace('heart');
      const c = await C();
      const a = at(c, 0.996, 0.47), r = at(c, 1.004, 0.47);
      const movePx = Math.hypot(r.x - a.x, r.y - a.y);
      await gesture(kind, a, r);
      const after = await trace('heart');
      check(`B1 ${T} ${kind}: 50348 witness (down x=0.996, release x=1.004, ${movePx.toFixed(3)} CSS px < ${6} px slop): the off-photo release is not discarded -- the gesture is refused, the draft is unchanged and the user is told`, movePx < 6 && JSON.stringify(after) === JSON.stringify(before) && /outside the photo/i.test(await statusText()), { movePx, before: before.length, after: after.length, msg: await statusText() });
      await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).click()).catch(() => {});
      await settle();
      const conf = await statusOf('heart');
      const confirmedTrace = await trace('heart');
      check(`B2 ${T} ${kind}: no confirmed trace can contain the in-photo start of an off-photo tap (x=0.996)`, !(conf === 'confirmed' && confirmedTrace.some((p) => Math.abs(p.x - 0.996) < 1e-3)), { conf, last: confirmedTrace[confirmedTrace.length - 1] });
    }
    {
      // the same terminal reached by a drag (above slop) is refused too (R3); frozen I1 would reject it (trace-outside-image)
      await fresh(0.255);
      for (const [x, y] of BASE) await tapAt(x, y);
      const before = await trace('heart');
      const c = await C();
      await gesture('pen', at(c, 0.75, 0.48), at(c, 1.004, 0.47), at(c, 0.9, 0.47));
      check(`B3 ${T} pen: a drag ending at x=1.004 is refused and the valid draft is unchanged (never an eligible trace)`, JSON.stringify(await trace('heart')) === JSON.stringify(before) && /outside the photo/i.test(await statusText()));
    }

    // ---- edges and corners: stationary taps exactly on the boundary are kept; short off-photo releases are refused
    const EDGES: Array<{ name: string; on: [number, number]; off: [number, number] }> = [
      { name: 'left edge', on: [0, 0.5], off: [-0.004, 0.5] },
      { name: 'right edge', on: [1, 0.5], off: [1.004, 0.5] },
      { name: 'top edge', on: [0.5, 0], off: [0.5, -0.003] },
      { name: 'bottom edge', on: [0.5, 1], off: [0.5, 1.003] },
      { name: 'top-left corner', on: [0, 0], off: [-0.003, -0.002] },
      { name: 'top-right corner', on: [1, 0], off: [1.003, -0.002] },
      { name: 'bottom-left corner', on: [0, 1], off: [-0.003, 1.002] },
      { name: 'bottom-right corner', on: [1, 1], off: [1.003, 1.002] },
    ];
    await fresh();
    for (const [x, y] of [[0.4, 0.6], [0.5, 0.62]] as Array<[number, number]>) await tapAt(x, y);
    for (const e of EDGES) {
      for (const kind of ['mouse', 'pen', 'touch'] as Kind[]) {
        const c = await C();
        const before = await trace('heart');
        // "On the boundary": 0.01 CSS px inside the edge -- browsers carry pointer coordinates in reduced precision,
        // so the exact edge position can land a hair outside (and is then, correctly, off the photo).
        // "On the boundary" = the photo's edge pixel, 0.6 CSS px inside the edge, for every pointer kind: touch positions
        // arrive rounded to about a whole CSS pixel, and browsers hit-test a box with a fractional edge (e.g. a bottom at
        // 648.42 px) against its pixel-snapped painted rectangle, so a pointer in the sub-pixel band never reaches the stage
        // at all (P4-I4: the new progress steps moved the stage onto such a fractional position).
        const inset = 0.6;
        const nudge = (v: number, size: number) => (v === 0 ? inset / size : v === 1 ? 1 - inset / size : v);
        const onP = at(c, nudge(e.on[0], c.width), nudge(e.on[1], c.height));
        await gesture(kind, onP, onP);
        const t1 = await trace('heart');
        const added = t1.length === before.length + 1;
        const last = t1[t1.length - 1];
        const tolX = (inset + 1) / c.width, tolY = (inset + 1) / c.height;
        const okOn = added && Math.abs(last.x - e.on[0]) <= tolX && Math.abs(last.y - e.on[1]) <= tolY && last.x >= 0 && last.x <= 1 && last.y >= 0 && last.y <= 1;
        const inside = at(c, e.on[0] === 0 ? 0.002 : e.on[0] === 1 ? 0.998 : e.on[0], e.on[1] === 0 ? 0.002 : e.on[1] === 1 ? 0.998 : e.on[1]);
        const offP = at(c, e.off[0], e.off[1]);
        const between = await trace('heart');
        await gesture(kind, inside, offP);
        const t2 = await trace('heart');
        check(`B4 ${T} ${kind} ${e.name}: a stationary tap on the boundary pixel (${inset} CSS px inside) is kept (${last ? `${last.x.toFixed(6)},${last.y.toFixed(6)}` : 'none'}); a short release just off the photo is refused and leaves the draft unchanged`, okOn && JSON.stringify(t2) === JSON.stringify(between), { okOn, last, n2: t2.length, n1: between.length });
        // keep the draft short: remove the boundary point again (only if one was added)
        if (added) { await pg.focus('[data-testid="palm-tracing-undo"]'); await pg.keyboard.press('Enter'); await settle(); }
      }
    }

    // ---- tap slop: below / at / above, inside and off the photo
    await fresh();
    for (const [x, y] of [[0.37, 0.56], [0.45, 0.6]] as Array<[number, number]>) await tapAt(x, y);
    {
      const c = await C();
      const n0 = (await trace('heart')).length;
      const a = at(c, 0.54, 0.62);
      await gesture('mouse', a, { x: a.x + 3, y: a.y });
      const t = await trace('heart');
      check(`B5 ${T} short in-photo movement below slop (3 px) is a tap: one point at the press position`, t.length === n0 + 1 && Math.abs(t[t.length - 1].x - 0.54) * c.width < 0.6);
      await gesture('pen', a, a);
      check(`B6 ${T} a stationary pen tap inside the photo still adds a point`, (await trace('heart')).length === n0 + 2);
      await pg.focus('[data-testid="palm-tracing-undo"]'); await pg.keyboard.press('Enter'); await settle();
      await pg.focus('[data-testid="palm-tracing-undo"]'); await pg.keyboard.press('Enter'); await settle();
    }
    {
      const c = await C();
      const before = await trace('heart');
      // press 2 px inside the right edge, release exactly 6 px (= slop, still a tap) to the right: off the photo
      const a = { x: c.left + c.width - 2, y: at(c, 0, 0.6).y };
      await gesture('mouse', a, { x: a.x + 6, y: a.y });
      check(`B7 ${T} movement exactly AT the slop (6 px) ending off the photo: refused, draft unchanged`, JSON.stringify(await trace('heart')) === JSON.stringify(before) && /outside the photo/i.test(await statusText()));
      await gesture('mouse', a, { x: a.x + 7, y: a.y });
      check(`B8 ${T} movement ABOVE the slop (7 px) ending off the photo: refused as well (a drag is no exception)`, /outside the photo/i.test(await statusText()));
      check(`B9 ${T} after the refused drag the earlier valid draft is exactly unchanged (no Undo needed)`, JSON.stringify(await trace('heart')) === JSON.stringify(before));
      // an in-photo press whose short gesture passes off the photo and comes back inside is still a tap inside
      const b = { x: c.left + c.width - 1, y: at(c, 0, 0.62).y };
      await gesture('pen', b, { x: b.x - 1, y: b.y }, { x: b.x + 2, y: b.y });
      check(`B10 ${T} a short gesture that briefly leaves the photo is refused even when released back inside (it left the photo)`, JSON.stringify(await trace('heart')) === JSON.stringify(before));
    }
    check(`B11 ${T} no uncaught page errors`, errors.length === 0, errors);
    await ctx.close();
  }
  return res;
}

// ================================================================ R3: every delivered sample is validated
/**
 * F2 residual (independent disposition 50351): a drag whose intermediate sample leaves the photo by less than the
 * stroke-spacing distance (pen 0.850 -> 0.996 -> 1.001 -> 0.998) lost that sample to spacing and could be confirmed.
 * Invariant: every delivered sample -- including coalesced ones -- is checked against the photo BEFORE any spacing or
 * simplification; a gesture that left the photo is refused whatever happens afterwards, and the draft is unchanged.
 * Check names start with "Q".
 */
async function pipelineSuite(browser: any, mutation: Mutation, verbose: boolean): Promise<Result> {
  const res: Result = { passed: 0, failed: [] };
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { res.passed++; if (verbose) console.log(`OK   ${name}`); } else { res.failed.push(name); if (verbose) console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
  };
  const geometries = [
    { name: 'desktop 1280x800 @1x, photo 1280x960', vw: 1280, vh: 800, dpr: 1, W: 1280, H: 960 },
    { name: 'phone 390x844 @3x, photo 960x1280', vw: 390, vh: 844, dpr: 3, W: 960, H: 1280 },
  ];
  for (const geo of geometries) {
    const ctx = await browser.newContext({ viewport: { width: geo.vw, height: geo.vh }, deviceScaleFactor: geo.dpr, hasTouch: true });
    const pg = await ctx.newPage();
    const errors: string[] = [];
    pg.on('pageerror', (e: any) => errors.push(String(e).split('\n')[0]));
    // A secure context (as the app has on localhost / https): getCoalescedEvents() exists only there. The harness is
    // served from memory to a reserved .test origin via request interception -- nothing leaves the machine.
    const html = page(mutation, geo.W, geo.H);
    await pg.route('https://palm-harness.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await pg.goto('https://palm-harness.test/');
    await pg.waitForSelector('[data-testid="palm-tracing-stage"] canvas');
    const secure = await pg.evaluate(() => window.isSecureContext);
    const cdp = await ctx.newCDPSession(pg);
    const T = `[${geo.name}]`;
    const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const C = async (): Promise<Box> => oracleContent(await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }), geo.W, geo.H);
    const at = (c: Box, x: number, y: number) => ({ x: c.left + x * c.width, y: c.top + y * c.height });
    check(`Q0 ${T} the pipeline suite runs in a secure context (getCoalescedEvents available, as in the app)`, secure === true && (await pg.evaluate(() => typeof (PointerEvent.prototype as any).getCoalescedEvents === 'function')));
    const trace = async (): Promise<Array<{ x: number; y: number }>> => pg.evaluate(([w, h]: [number, number]) => {
      const el = document.querySelector('[data-trace="heart"]');
      return el ? (el.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map((t) => { const [x, y] = t.split(',').map(Number); return { x: x / w, y: y / h }; }) : [];
    }, [geo.W, geo.H]);
    const statusOf = async () => pg.$eval('[data-testid="palm-tracing-step-heart"]', (e: Element) => e.getAttribute('data-status'));
    const placement = async () => pg.$eval('[data-testid="palm-tracing-feedback"]', (e: Element) => e.getAttribute('data-placement'));
    const statusText = async () => pg.$eval('[data-testid="palm-tracing-status"]', (e: Element) => e.textContent || '');
    const fresh = async (shift = 0.02) => { await pg.evaluate((s: number) => (window as any).__palmHarness.replace(s), shift); await pg.waitForSelector('[data-testid="palm-tracing-photo"]'); await settle(); };
    type Kind = 'mouse' | 'pen' | 'touch';
    /** Press at pts[0], move through pts[1..], release at the last point (mouse/pen: release without a move there). */
    const stroke = async (kind: Kind, pts: Array<{ x: number; y: number }>) => {
      if (kind === 'touch') {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pts[0], id: 1 }] });
        for (const q of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...q, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', buttons: 1, clickCount: 1, pointerType: kind });
        for (const q of pts.slice(1, -1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: q.x, y: q.y, button: 'left', buttons: 1, pointerType: kind });
        const r = pts[pts.length - 1];
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1, pointerType: kind });
      }
      await settle();
    };
    const tapAt = async (x: number, y: number) => { const c = await C(); const p = at(c, x, y); await stroke('mouse', [p, p]); };

    // ---- the exact 50351 witness: 0.850 -> 0.996 -> 1.001 -> 0.998 (the outside sample is within the spacing distance)
    const BASE: Array<[number, number]> = [[0.75, 0.48], [0.85, 0.475], [0.93, 0.47]];
    for (const kind of ['pen', 'mouse', 'touch'] as Kind[]) {
      await fresh(0.255);
      for (const [x, y] of BASE) await tapAt(x, y);
      const before = await trace();
      const c = await C();
      const seq = [at(c, 0.85, 0.47), at(c, 0.996, 0.47), at(c, 1.001, 0.47), at(c, 0.998, 0.47)];
      await stroke(kind, seq);
      check(`Q1 ${T} ${kind}: 50351 witness (0.850 -> 0.996 -> 1.001 -> 0.998): the gesture left the photo, so it is refused -- the draft is unchanged and the user is told`, JSON.stringify(await trace()) === JSON.stringify(before) && /outside the photo/i.test(await statusText()), { before: before.length, after: (await trace()).length, msg: await statusText() });
      await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).click()).catch(() => {});
      await settle();
      const t = await trace();
      check(`Q2 ${T} ${kind}: nothing from the off-photo gesture can be confirmed (a confirmed trace never ends at the re-entry point x=0.998)`, !((await statusOf()) === 'confirmed' && t.some((p) => p.x > 0.995)), { status: await statusOf(), last: t[t.length - 1] });
    }

    // ---- leave and re-enter through every edge and corner, outside by less than the spacing distance
    const EDGES: Array<{ name: string; n: [number, number] }> = [
      { name: 'left edge', n: [-1, 0] }, { name: 'right edge', n: [1, 0] }, { name: 'top edge', n: [0, -1] }, { name: 'bottom edge', n: [0, 1] },
      { name: 'top-left corner', n: [-1, -1] }, { name: 'top-right corner', n: [1, -1] }, { name: 'bottom-left corner', n: [-1, 1] }, { name: 'bottom-right corner', n: [1, 1] },
    ];
    await fresh();
    for (const [x, y] of [[0.4, 0.6], [0.5, 0.62]] as Array<[number, number]>) await tapAt(x, y);
    for (const e of EDGES) {
      for (const kind of ['mouse', 'pen', 'touch'] as Kind[]) {
        const c = await C();
        // the boundary point the gesture crosses, in CSS px
        const bx = e.n[0] < 0 ? c.left : e.n[0] > 0 ? c.left + c.width : c.left + c.width * 0.5;
        const by = e.n[1] < 0 ? c.top : e.n[1] > 0 ? c.top + c.height : c.top + c.height * 0.55;
        const off = kind === 'touch' ? 1.6 : 1.2; // CSS px beyond the edge (touch positions round to ~1 px)
        const q = (d: number) => ({ x: bx + e.n[0] * d, y: by + e.n[1] * d });
        const seq = [q(-24), q(-1.2), q(off), q(-12)]; // inside -> just inside -> just OUTSIDE -> back inside (release inside)
        const before = await trace();
        await stroke(kind, seq);
        check(`Q3 ${T} ${kind} ${e.name}: a drag that dips ${off} CSS px outside and returns inside is refused; the draft is unchanged`, JSON.stringify(await trace()) === JSON.stringify(before) && /outside the photo/i.test(await statusText()), { n0: before.length, n1: (await trace()).length });
      }
    }

    // ---- coalesced samples: moves delivered in one frame are coalesced by the browser; the outside one must count
    {
      await fresh();
      for (const [x, y] of [[0.4, 0.6], [0.5, 0.62]] as Array<[number, number]>) await tapAt(x, y);
      await pg.evaluate(() => { (window as any).__coalesced = 0; (window as any).__xs = []; document.querySelector('[data-testid="palm-tracing-stage"]')!.addEventListener('pointermove', (ev: any) => { const list = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : []; if (list.length > 1) (window as any).__coalesced++; for (const q of (list.length ? list : [ev])) (window as any).__xs.push(q.clientX); }); });
      const c = await C();
      const before = await trace();
      const bx = c.left + c.width, by = c.top + c.height * 0.55;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bx - 30, y: by, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
      // fire the moves without waiting between them, so they land in one frame and are coalesced
      const moves = [bx - 20, bx - 10, bx - 1.2, bx + 1.2, bx - 1.2, bx - 8, bx - 14].map((x) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: by, button: 'left', buttons: 1, pointerType: 'pen' }));
      await Promise.all(moves);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx - 14, y: by, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
      await settle();
      const coalesced = await pg.evaluate(() => (window as any).__coalesced);
      const xs: number[] = await pg.evaluate(() => (window as any).__xs);
      const outsideDelivered = xs.some((x) => x > bx);
      // The browser may merge rapid injected moves so that an intermediate position is never delivered in any form;
      // the invariant concerns DELIVERED samples, so the check applies when the outside sample reached the page.
      check(`Q4 ${T} pen: rapid native moves (${xs.length} samples delivered, ${coalesced} coalesced event(s), outside sample delivered: ${outsideDelivered}) -- if any delivered sample was outside the photo, the gesture is refused and the draft unchanged`, !outsideDelivered || JSON.stringify(await trace()) === JSON.stringify(before), { coalesced, xs: xs.map((x) => +(x - bx).toFixed(2)), n0: before.length, n1: (await trace()).length });
    }

    {
      // deterministic: a trusted pen gesture whose pointermove carries explicit coalesced samples (one outside)
      await fresh();
      for (const [x, y] of [[0.4, 0.6], [0.5, 0.62]] as Array<[number, number]>) await tapAt(x, y);
      await pg.evaluate(() => { const st = document.querySelector('[data-testid="palm-tracing-stage"]')!; st.addEventListener('pointerdown', (ev: any) => { (window as any).__pid = ev.pointerId; }, { capture: true }); });
      const c = await C();
      const before = await trace();
      const bx = c.left + c.width, by = c.top + c.height * 0.55;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bx - 30, y: by, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
      const seen = await pg.evaluate(([x, y]: [number, number]) => {
        const st = document.querySelector('[data-testid="palm-tracing-stage"]')!;
        const pid = (window as any).__pid;
        const mk = (cx: number) => new PointerEvent('pointermove', { pointerId: pid, isPrimary: true, pointerType: 'pen', clientX: cx, clientY: y, bubbles: true });
        const ev = new PointerEvent('pointermove', { pointerId: pid, isPrimary: true, pointerType: 'pen', clientX: x - 14, clientY: y, bubbles: true, coalescedEvents: [mk(x - 20), mk(x + 1.2), mk(x - 14)] } as any);
        st.dispatchEvent(ev);
        return typeof (ev as any).getCoalescedEvents === 'function' ? (ev as any).getCoalescedEvents().length : -1;
      }, [bx, by] as [number, number]);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx - 14, y: by, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
      await settle();
      check(`Q4b ${T} pen: a pointermove whose COALESCED samples include one outside the photo (${seen} coalesced samples delivered; the event's own position is inside) is refused; the draft is unchanged`, seen === 3 && JSON.stringify(await trace()) === JSON.stringify(before), { seen, n0: before.length, n1: (await trace()).length });
    }

    // ---- valid gestures still work
    {
      await fresh();
      const c = await C();
      const HEADN: Array<[number, number]> = [[0.37, 0.56], [0.45, 0.6], [0.54, 0.62], [0.62, 0.64]];
      for (const kind of ['mouse', 'pen', 'touch'] as Kind[]) {
        await stroke(kind, HEADN.map(([x, y]) => at(c, x, y)));
        check(`Q5 ${T} ${kind}: a drag that stays on the photo is still accepted and usable`, (await trace()).length >= 2 && (await placement()) === 'ok');
      }
      await pg.focus('[data-testid="palm-tracing-clear"]'); await pg.keyboard.press('Enter'); await settle();
      await tapAt(0.37, 0.56); await tapAt(0.62, 0.64);
      check(`Q6 ${T} taps on the photo still add points (2)`, (await trace()).length === 2);
    }
    check(`Q7 ${T} no uncaught page errors`, errors.length === 0, errors);
    await ctx.close();
  }
  return res;
}

// ================================================================ R4: fail closed on unmappable samples
/**
 * R3 focused review (NO-GO): during a captured drag the tracing stage was resized to zero width; the next trusted
 * pointer move or release could not be mapped to the photo and was SKIPPED, so the gesture completed from its earlier
 * samples and could be confirmed. Contract: every delivered sample (press, move, coalesced, release) must be mapped and
 * validated; an unmappable or unverifiable sample invalidates the whole gesture, and restoring the geometry or returning
 * inside does not restore it. The draft is unchanged. Check names start with "Z".
 */
async function geometryLossSuite(browser: any, mutation: Mutation, verbose: boolean): Promise<Result> {
  const res: Result = { passed: 0, failed: [] };
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { res.passed++; if (verbose) console.log(`OK   ${name}`); } else { res.failed.push(name); if (verbose) console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
  };
  const geometries = [
    { name: 'desktop 1280x800 @1x, photo 1280x960', vw: 1280, vh: 800, dpr: 1, W: 1280, H: 960 },
    { name: 'phone 390x844 @3x, photo 960x1280', vw: 390, vh: 844, dpr: 3, W: 960, H: 1280 },
  ];
  for (const geo of geometries) {
    const ctx = await browser.newContext({ viewport: { width: geo.vw, height: geo.vh }, deviceScaleFactor: geo.dpr, hasTouch: true });
    const pg = await ctx.newPage();
    const errors: string[] = [];
    pg.on('pageerror', (e: any) => errors.push(String(e).split('\n')[0]));
    const html = page(mutation, geo.W, geo.H);
    await pg.route('https://palm-harness.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await pg.goto('https://palm-harness.test/');
    await pg.waitForSelector('[data-testid="palm-tracing-stage"] canvas');
    const cdp = await ctx.newCDPSession(pg);
    const T = `[${geo.name}]`;
    const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const C = async (): Promise<Box> => oracleContent(await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }), geo.W, geo.H);
    const at = (c: Box, x: number, y: number) => ({ x: c.left + x * c.width, y: c.top + y * c.height });
    const trace = async (): Promise<Array<{ x: number; y: number }>> => pg.evaluate(([w, h]: [number, number]) => {
      const el = document.querySelector('[data-trace="heart"]');
      return el ? (el.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map((t) => { const [x, y] = t.split(',').map(Number); return { x: x / w, y: y / h }; }) : [];
    }, [geo.W, geo.H]);
    const statusOf = async () => pg.$eval('[data-testid="palm-tracing-step-heart"]', (e: Element) => e.getAttribute('data-status')).catch(() => 'gone');
    const statusText = async () => pg.$eval('[data-testid="palm-tracing-status"]', (e: Element) => e.textContent || '').catch(() => '');
    const placement = async () => pg.$eval('[data-testid="palm-tracing-feedback"]', (e: Element) => e.getAttribute('data-placement')).catch(() => 'gone');
    /** Collapse the tracing stage to zero width (the photo geometry disappears) or restore it. */
    const collapse = async (zero: boolean) => { await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element, z: boolean) => { (e as HTMLElement).style.width = z ? '0px' : '100%'; }, zero); await settle(); };
    const fresh = async () => { await pg.evaluate(() => (window as any).__palmHarness.replace(0.02)); await pg.waitForSelector('[data-testid="palm-tracing-photo"]'); await settle(); };
    type Kind = 'mouse' | 'pen' | 'touch';
    const press = async (kind: Kind, p: { x: number; y: number }) => kind === 'touch'
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] })
      : cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, pointerType: kind });
    const move = async (kind: Kind, p: { x: number; y: number }) => { await (kind === 'touch'
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] })
      : cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, pointerType: kind })); await settle(); };
    const release = async (kind: Kind, p: { x: number; y: number }) => { await (kind === 'touch'
      ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      : cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1, pointerType: kind })); await settle(); };
    const tapAt = async (x: number, y: number) => { const c = await C(); const p = at(c, x, y); await press('mouse', p); await release('mouse', p); };
    const HEAD: Array<[number, number]> = [[0.37, 0.56], [0.45, 0.6], [0.54, 0.62], [0.62, 0.64]];
    const refused = /could not be checked|outside the photo/i;

    for (const kind of ['mouse', 'pen', 'touch'] as Kind[]) {
      for (const scenario of ['during a move', 'only at the release', 'during a move, restored before the release'] as const) {
        await fresh();
        await tapAt(0.4, 0.58); await tapAt(0.5, 0.6); // an existing (valid) two-point draft
        const before = await trace();
        const c = await C();
        const P = HEAD.map(([x, y]) => at(c, x, y));
        await press(kind, P[0]);
        await move(kind, P[1]);
        if (scenario === 'only at the release') {
          await move(kind, P[2]); await move(kind, P[3]);
          await collapse(true);
          await release(kind, P[3]);
        } else {
          await collapse(true);
          await move(kind, P[2]); // delivered while the photo geometry is unavailable
          if (scenario === 'during a move, restored before the release') { await collapse(false); await move(kind, P[3]); }
          await release(kind, P[3]);
        }
        await collapse(false);
        const after = await trace();
        const msg = await statusText();
        check(`Z1 ${T} ${kind}: photo geometry lost ${scenario} -> the gesture is refused (fail-closed), the draft is unchanged and the user is told`, JSON.stringify(after) === JSON.stringify(before) && refused.test(msg), { n0: before.length, n1: after.length, msg });
        await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).click()).catch(() => {});
        await settle();
        const t = await trace();
        check(`Z2 ${T} ${kind}: geometry lost ${scenario} -> nothing from that gesture can be confirmed`, !((await statusOf()) === 'confirmed' && t.some((q) => Math.abs(q.x - 0.37) < 0.01 && Math.abs(q.y - 0.56) < 0.01)), { status: await statusOf(), t: t.length });
      }
      // a valid drag with stable geometry is unaffected
      await fresh();
      const c = await C();
      const P = HEAD.map(([x, y]) => at(c, x, y));
      await press(kind, P[0]); for (const q of P.slice(1)) await move(kind, q); await release(kind, P[3]);
      check(`Z3 ${T} ${kind}: a drag with stable geometry is still accepted and usable`, (await trace()).length >= 2 && (await placement()) === 'ok');
    }
    check(`Z4 ${T} no uncaught page errors`, errors.length === 0, errors);
    await ctx.close();
  }
  return res;
}

async function main() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const channel = process.env.PALM_BROWSER_CHANNEL || undefined;
  const browser = await chromium.launch(channel ? { channel } : {});
  console.log(`browser: ${channel ?? 'playwright chromium'} ${browser.version()}`);
  let ok = true;
  try {
    const real = process.env.PALM_I2_FINDINGS_ONLY ? { passed: 0, failed: [] } : await suite(browser, 'none', CONFIGS, SHOTS);
    console.log(`\nPALM-04-I2 browser: ${real.passed} passed, ${real.failed.length} failed`);
    if (real.failed.length) ok = false;
    const r1 = process.env.PALM_I2_BOUNDARY_ONLY ? { passed: 0, failed: [] as string[] } : await findingsSuite(browser, 'none', true);
    console.log(`\nPALM-04-I2 R1 findings (F1-F4): ${r1.passed} passed, ${r1.failed.length} failed`);
    if (r1.failed.length) ok = false;
    // the reviewed P4-I2 component (0c1c650) must fail every finding
    const orig = process.env.PALM_I2_BOUNDARY_ONLY ? { passed: 0, failed: ['F1 x', 'F2 x', 'F3 x', 'F4 x'] } : await findingsSuite(browser, 'original', false);
    const per = (r: Result) => ['F1', 'F2', 'F3', 'F4'].map((f) => `${f}:${r.failed.filter((n) => n.startsWith(f + ' ')).length}`).join(' ');
    const origAll = ['F1', 'F2', 'F3', 'F4'].every((f) => orig.failed.some((n) => n.startsWith(f + ' ')));
    console.log(`${origAll ? 'OK  ' : 'FAIL'} witnesses on the reviewed component ${ORIGINAL_HEAD.slice(0, 7)}: every finding reproduces (${per(orig)} failing checks; ${orig.passed} pass)`);
    if (!origAll) ok = false;
    // R2: terminal boundary validation
    const r2 = await boundarySuite(browser, 'none', true);
    console.log(`\nPALM-04-I2 R2 boundary (B1-B11): ${r2.passed} passed, ${r2.failed.length} failed`);
    if (r2.failed.length) ok = false;
    const before = await boundarySuite(browser, 'r1-head', false);
    const witnessFails = before.failed.filter((n) => /^B1 /.test(n)).length;
    console.log(`${witnessFails ? 'OK  ' : 'FAIL'} the 50348 witness fails on the reviewed R1 head ${R1_HEAD.slice(0, 7)}: ${witnessFails} B1 checks fail (${before.failed.length} boundary checks fail in all; ${before.passed} pass)`);
    if (!witnessFails) ok = false;
    // R4: fail closed on unmappable samples
    const r4 = await geometryLossSuite(browser, 'none', true);
    console.log(`\nPALM-04-I2 R4 geometry loss (Z1-Z4): ${r4.passed} passed, ${r4.failed.length} failed`);
    if (r4.failed.length) ok = false;
    const r4before = await geometryLossSuite(browser, 'r3-head', false);
    const z1 = r4before.failed.filter((n) => /^Z1 /.test(n)).length;
    console.log(`${z1 ? 'OK  ' : 'FAIL'} the R4 geometry-loss witness fails on the reviewed R3 head ${R3_HEAD.slice(0, 7)}: ${z1} Z1 checks fail (${r4before.failed.length} Z checks fail in all; ${r4before.passed} pass)`);
    if (!z1) ok = false;
    if ((MUTATIONS as any)['skip-unmappable'].length) {
      const nz = await geometryLossSuite(browser, 'skip-unmappable', false);
      const hz = nz.failed.filter((n) => /^Z1 /.test(n)).length;
      console.log(`${hz ? 'OK  ' : 'FAIL'} negative control skip-unmappable: ${hz} Z1 checks fail (${nz.failed.length} in all), ${nz.passed} pass`);
      if (!hz) ok = false;
    } else console.log('note: negative control skip-unmappable not defined yet');
    if (process.env.PALM_I2_GEOMETRY_ONLY) { await browser.close(); process.exit(ok ? 0 : 1); }
    // R3: every delivered sample validated before filtering
    const r3 = await pipelineSuite(browser, 'none', true);
    console.log(`\nPALM-04-I2 R3 sample pipeline (Q1-Q7): ${r3.passed} passed, ${r3.failed.length} failed`);
    if (r3.failed.length) ok = false;
    const r3before = await pipelineSuite(browser, 'r2-head', false);
    const q1 = r3before.failed.filter((n) => /^Q1 /.test(n)).length;
    console.log(`${q1 ? 'OK  ' : 'FAIL'} the 50351 witness fails on the reviewed R2 head ${R2_HEAD.slice(0, 7)}: ${q1} Q1 checks fail (${r3before.failed.length} Q checks fail in all; ${r3before.passed} pass)`);
    if (!q1) ok = false;
    if ((MUTATIONS as any)['filter-before-validate'].length) {
      const nf = await pipelineSuite(browser, 'filter-before-validate', false);
      const hit = nf.failed.filter((n) => /^Q(1|3|4) /.test(n)).length;
      console.log(`${hit ? 'OK  ' : 'FAIL'} negative control filter-before-validate: ${hit} Q1/Q3/Q4 checks fail (${nf.failed.length} in all), ${nf.passed} pass`);
      if (!hit) ok = false;
      const nc = await pipelineSuite(browser, 'ignore-coalesced', false);
      const hc = nc.failed.filter((n) => /^Q4b /.test(n)).length;
      console.log(`${hc ? 'OK  ' : 'FAIL'} negative control ignore-coalesced: ${hc} Q4b checks fail (${nc.failed.length} in all), ${nc.passed} pass`);
      if (!hc) ok = false;
    } else console.log('note: negative control filter-before-validate not defined yet');
    if ((MUTATIONS as any)['tap-boundary-bypass'].length) {
      const nb = await boundarySuite(browser, 'tap-boundary-bypass', false);
      const hit = nb.failed.filter((n) => /^B(1|4|7) /.test(n)).length;
      console.log(`${hit ? 'OK  ' : 'FAIL'} negative control tap-boundary-bypass: ${hit} B1/B4/B7 checks fail (${nb.failed.length} in all), ${nb.passed} pass`);
      if (!hit) ok = false;
    } else console.log('note: negative control tap-boundary-bypass not defined yet');
    for (const [m, f] of [['stale-gesture', 'F1'], ['ignore-release', 'F2'], ['retain-revoked', 'F3'], ['unhandled-limit', 'F4']] as Array<[Mutation, string]>) {
      if (!(MUTATIONS as any)[m].length || process.env.PALM_I2_BOUNDARY_ONLY) { if (!process.env.PALM_I2_BOUNDARY_ONLY) console.log(`note: negative control ${m} not defined yet`); continue; }
      const r = await findingsSuite(browser, m, false);
      const hit = r.failed.filter((n) => n.startsWith(f + ' '));
      console.log(`${hit.length ? 'OK  ' : 'FAIL'} negative control ${m}: ${hit.length} ${f} checks fail (${per(r)}), ${r.passed} pass`);
      if (!hit.length) ok = false;
    }
    // negative controls: each broken bundle must fail checks in its own category
    const controls: Array<[Exclude<Mutation, 'none'>, RegExp]> = process.env.PALM_I2_FINDINGS_ONLY ? [] : [['stretch', /^(G1|G2|G4|T1|L1|L3) /], ['container', /^(T1|D1|L4|M1) /], ['bypass', /^V2 /]];
    for (const [m, expect] of controls) {
      const r = await suite(browser, m, CONFIGS.slice(0, 3), null);
      const hit = r.failed.filter((n) => expect.test(n));
      const detected = hit.length > 0;
      console.log(`${detected ? 'OK  ' : 'FAIL'} negative control ${m}: ${r.failed.length} checks fail (${hit.length} in the expected category: ${[...new Set(hit.map((n) => n.split(' ')[0]))].join(', ')}), ${r.passed} pass`);
      if (!detected) ok = false;
    }
  } finally {
    await browser.close();
  }
  if (!ok) process.exit(1);
}

export { bundle, page, oracleContent };
export type { Mutation, Box };
if (require.main === module) main().catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
