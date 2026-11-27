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
type Mutation = 'none' | 'stretch' | 'container' | 'bypass';
const MUTATIONS: Record<Exclude<Mutation, 'none'>, Array<{ file: string; from: string; to: string }>> = {
  stretch: [{ file: 'apps/web/lib/palm-analysis/tracingGeometry.ts', from: 'const scale = Math.min(box.width / imgW, box.height / imgH);\n  const width = imgW * scale;\n  const height = imgH * scale;', to: 'const width = box.width;\n  const height = box.height;' }],
  container: [{ file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'const c = containRect({ left: r.left, top: r.top, width: r.width, height: r.height }, imgW, imgH);', to: 'const c = { left: r.left, top: r.top, width: r.width, height: r.height };' }],
  bypass: [
    { file: 'apps/web/lib/palm-analysis/tracing.ts', from: 'if (!placement.ok) return Object.freeze({ ok: false as const, reason: placement.reason, line: view(data, id) });', to: '' },
    { file: 'apps/web/components/palm-scan/PalmImageInput.tsx', from: 'disabled={!placement?.ok}', to: 'disabled={false}' },
  ],
};

function bundle(entry: string, mutation: Mutation): string {
  const mods = new Map<string, string>();
  const ids = new Map<string, number>();
  const muts = mutation === 'none' ? [] : MUTATIONS[mutation];
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
    let src = fs.readFileSync(file, 'utf8');
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

function page(mutation: Mutation, w: number, h: number): string {
  const app = bundle(path.join(ROOT, 'test/palm04I2Harness.tsx'), mutation);
  const esc = (s: string) => s.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:#0b1020;color:#f8fafc;font-family:system-ui,sans-serif}</style>
<script>${esc(SPIES)}</script><script>window.process = { env: { NODE_ENV: 'development' } };window.__PALM_HARNESS_SIZE=${JSON.stringify({ w, h })};</script>
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
    // a stroke that leaves the photo is judged, not clamped
    await dragN([N(HEAD)[0], { x: 1.06, y: HEAD[3][1] }]);
    const outside = await placement();
    check(`O1 ${T} a stroke that leaves the photo is not clamped: I1 reports it (${outside}) and it cannot be confirmed`, outside === 'trace-outside-image' && (await pg.$eval('[data-testid="palm-tracing-confirm"]', (e: Element) => (e as HTMLButtonElement).disabled)));
    // a gesture that starts in the letterbox is refused
    await fresh();
    if (content.left - stage.left > 12 || content.top - stage.top > 12) {
      const lb = content.left - stage.left > 12 ? { x: stage.left + 4, y: stage.top + stage.height / 2 } : { x: stage.left + stage.width / 2, y: stage.top + 4 };
      const beforeLb = await traceOf('head');
      await tap(lb.x, lb.y);
      check(`O2 ${T} a gesture starting in the letterbox (outside the photo) adds nothing`, JSON.stringify(await traceOf('head')) === JSON.stringify(beforeLb) && /on the photo/.test(await statusText()));
    }
    await click('palm-tracing-undo'); await settle();
    check(`U2 ${T} Undo restores the drawn stroke after the bad one`, (await placement()) === 'ok');
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
    await pg.evaluate(() => (window as any).__palmHarness.revoke());
    await tapN({ x: 0.61, y: 0.545 });
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

async function main() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const channel = process.env.PALM_BROWSER_CHANNEL || undefined;
  const browser = await chromium.launch(channel ? { channel } : {});
  console.log(`browser: ${channel ?? 'playwright chromium'} ${browser.version()}`);
  let ok = true;
  try {
    const real = await suite(browser, 'none', CONFIGS, SHOTS);
    console.log(`\nPALM-04-I2 browser: ${real.passed} passed, ${real.failed.length} failed`);
    if (real.failed.length) ok = false;
    // negative controls: each broken bundle must fail checks in its own category
    const controls: Array<[Exclude<Mutation, 'none'>, RegExp]> = [['stretch', /^(G1|G2|G4|T1|L1|L3) /], ['container', /^(T1|D1|L4|M1) /], ['bypass', /^V2 /]];
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

export { bundle, page };
if (require.main === module) main().catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
