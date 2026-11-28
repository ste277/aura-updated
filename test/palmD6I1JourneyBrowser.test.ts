/**
 * AURA-PALM-D6-I1 -- in a real Chrome, synthetic inputs only (bundled in memory, no server, no network):
 *   L   browser vs Node catalogue-loading parity (same digests, same validated-library fingerprint);
 *   J   the mobile-first journey Photo -> Trace -> Review and Confirm -> Personalised Reading, desktop (mouse) and phone
 *       (touch), through the real upload flow: frame first, five topics, tentative E1 items, not-assessed list,
 *       withdrawal on edit and Start over, privacy spies;
 *   T   DR-1 with real MediaStreams: a preview that never yields a frame is stopped at the limit (retryable, upload kept);
 *       a working preview is never timed out.
 *
 *   npx ts-node test/palmD6I1JourneyBrowser.test.ts [--shots <dir>]      (PALM_BROWSER_CHANNEL=chrome in CI)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { page, oracleContent, type Box } from './palm04I2TracingBrowser.test';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require('playwright');

const argShots = process.argv.indexOf('--shots');
const SHOTS = argShots > 0 ? process.argv[argShots + 1] : null;
let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`OK   ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEV_BANNER = (k: string) => !/Download the React DevTools/.test(k);

async function syntheticPng(browser: any, w: number, h: number): Promise<Buffer> {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const b64: string = await pg.evaluate(([W, H]: [number, number]) => {
    const HAND = [[0.5, 0.85], [0.36, 0.76], [0.29, 0.64], [0.24, 0.55], [0.2, 0.47], [0.38, 0.45], [0.37, 0.33], [0.36, 0.25], [0.36, 0.18], [0.5, 0.42], [0.5, 0.29], [0.5, 0.2], [0.5, 0.13], [0.6, 0.44], [0.61, 0.32], [0.62, 0.24], [0.62, 0.18], [0.68, 0.5], [0.71, 0.41], [0.73, 0.35], [0.74, 0.3]];
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#5b6b8c'); bg.addColorStop(1, '#2b3a55'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${(i * 37) % 255},${(i * 61) % 255},${(i * 17) % 255},0.15)`; g.fillRect((i * 97) % W, (i * 53) % H, 3, 3); }
    const X = (k: number) => HAND[k][0] * W, Y = (k: number) => HAND[k][1] * H;
    g.lineCap = 'round'; g.strokeStyle = '#e8b48f';
    for (const ch of [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]]) { g.lineWidth = Math.min(W, H) * 0.075; g.beginPath(); ch.forEach((k, i) => (i ? g.lineTo(X(k), Y(k)) : g.moveTo(X(k), Y(k)))); g.stroke(); }
    g.fillStyle = '#f0c4a0'; g.beginPath(); [0, 1, 2, 5, 9, 13, 17].forEach((k, i) => (i ? g.lineTo(X(k), Y(k)) : g.moveTo(X(k), Y(k)))); g.closePath(); g.fill();
    for (let i = 0; i < 9000; i++) { const x = (0.15 + 0.65 * ((i * 7919) % 1000) / 1000) * W, y = (0.12 + 0.78 * ((i * 104729) % 1000) / 1000) * H; g.fillStyle = i % 2 ? 'rgba(90,50,30,0.35)' : 'rgba(255,240,225,0.35)'; g.fillRect(x, y, 4, 4); }
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h] as [number, number]);
  await ctx.close();
  return Buffer.from(b64, 'base64');
}

async function loaderParity(browser: any) {
  // Node side: the same loader, the same fingerprint definition
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const packaged = require('../packages/palm-reading-engine/e1/src/packaged.mjs');
  const lib = packaged.pinnedLibrary();
  const nodeFp = crypto.createHash('sha256').update(`${JSON.stringify(lib.catalogue)}|${JSON.stringify(lib.schema ?? null)}`).digest('hex');
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const requests: string[] = [];
  pg.on('request', (r: any) => requests.push(r.url()));
  await pg.setContent(page('none', 1, 1, {}, 'test/palmD6I1LoaderHarness.tsx'));
  const b = await pg.evaluate(() => (window as any).__loader);
  check('L1. Chrome loads the pinned library through the browser-compatible loader (no file system, no network)', b?.ok === true && b.records === 29 && b.frozen === true && requests.length === 0, { b, requests });
  check('L2. browser and Node loading agree: the same C1 rev. 4 digests and the same validated-library fingerprint', b?.fingerprint === nodeFp && JSON.stringify(b?.digests) === JSON.stringify(packaged.C1_REV4_DIGESTS), { browser: b?.fingerprint, node: nodeFp });
  await ctx.close();
}

async function journey(browser: any, png: Buffer, L: { name: string; vw: number; vh: number; dpr: number; touch: boolean }) {
  const T = `[${L.name}]`;
  const ctx = await browser.newContext({ viewport: { width: L.vw, height: L.vh }, deviceScaleFactor: L.dpr, hasTouch: L.touch, isMobile: L.touch });
  const pg = await ctx.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  pg.on('pageerror', (e: any) => errors.push(String(e).split('\n')[0]));
  pg.on('request', (r: any) => requests.push(r.url()));
  await pg.setContent(page('none', 1, 1, {}, 'test/palm04I4AppHarness.tsx'));
  await pg.waitForSelector('[data-testid="palm-upload-button"]');
  const cdp = await ctx.newCDPSession(pg);
  const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const press = async (id: string) => { const sel = `[data-testid="${id}"]`; await (L.touch ? pg.tap(sel, { timeout: 4000 }) : pg.click(sel, { timeout: 4000 })).catch(() => console.log(`note: ${id} not pressable`)); await settle(); };
  const has = async (id: string) => (await pg.$(`[data-testid="${id}"]`)) !== null;
  const tap = async (x: number, y: number) => {
    const st = await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const W = await pg.$eval('[data-testid="palm-tracing-photo"]', (e: Element) => [(e as HTMLCanvasElement).width, (e as HTMLCanvasElement).height]);
    const b: Box = oracleContent(st, W[0], W[1]);
    const p = { x: b.left + x * b.width, y: b.top + y * b.height };
    if (L.touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else await pg.mouse.click(p.x, p.y);
    await settle();
  };
  const shot = async (n: string) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `d6i1-${L.vw}x${L.vh}-${n}.png`), fullPage: true }); };
  await pg.setInputFiles('[data-testid="palm-file-input"]', { name: 'synthetic-palm.png', mimeType: 'image/png', buffer: png });
  await pg.waitForSelector('[data-testid="palm-result"], [data-testid="palm-error"]', { timeout: 20000 });
  await press('palm-trace-button');
  for (const [x, y] of [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]] as Array<[number, number]>) await tap(x, y);
  await press('palm-tracing-confirm');
  await press('palm-tracing-next'); await press('palm-tracing-skip');
  await press('palm-tracing-next'); await press('palm-tracing-cannot-see');
  await press('palm-review-open');
  await press('palm-review-hand-left'); await press('palm-review-dominant-right');
  if (await has('palm-review-ack')) await press('palm-review-ack');
  await press('palm-review-confirm');
  await press('palm-review-see-result');
  const r = await pg.evaluate(() => {
    const root = document.querySelector('[data-testid="palm-reading"]');
    if (!root) return null;
    const topics = Array.from(root.querySelectorAll('section[data-testid^="palm-reading-topic-"]')).filter((s) => s.getAttribute('data-testid') !== 'palm-reading-topic-other');
    const items = Array.from(root.querySelectorAll('[data-testid="palm-reading-item"]'));
    const frame = root.querySelector('[data-testid="palm-reading-frame"]');
    const firstItem = items[0];
    return {
      frameFirst: root.firstElementChild === frame,
      frameBeforeItems: !!frame && (!firstItem || !!(frame.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING)),
      frameText: frame?.querySelector('p')?.textContent ?? '',
      topics: topics.map((t) => ({ label: t.querySelector('h4')?.textContent, state: t.getAttribute('data-state'), n: t.querySelectorAll('[data-testid="palm-reading-item"]').length })),
      items: items.map((i) => ({ tier: i.getAttribute('data-tier'), reflection: Array.from(i.querySelectorAll('p')).map((p) => p.textContent ?? '').find((t) => t.startsWith('To reflect on: ')) ?? '' })),
      notAssessed: Array.from(root.querySelectorAll('[data-testid="palm-reading-not-assessed"] li')).map((l) => l.getAttribute('data-feature')),
      width: (root as HTMLElement).getBoundingClientRect().width,
      scrollW: document.documentElement.scrollWidth,
      viewW: window.innerWidth,
    };
  });
  check(`J1 ${T} confirming leads to the personalised reading (step 4)`, !!r && (await pg.$eval('[data-testid="palm-scanner-steps"]', (e: Element) => e.getAttribute('data-current')).catch(() => '')) === '4');
  check(`J2 ${T} the disclaimer frame is shown first, before every interpretation`, !!r && r.frameFirst && r.frameBeforeItems && /not a prediction/.test(r.frameText));
  check(`J3 ${T} five topics in order, each shown with items or explicitly not assessed`, !!r && JSON.stringify(r.topics.map((t: any) => t.label)) === JSON.stringify(['Personality', 'Personal strengths', 'Relationships', 'Career and work', 'Life direction']) && r.topics.every((t: any) => (t.state === 'shown') === (t.n > 0)), r?.topics);
  check(`J4 ${T} at least one tentative E1 item; every reflection is a question`, !!r && r.items.length > 0 && r.items.every((i: any) => i.tier === 'tentative' && /\?\s*$/.test(i.reflection)));
  check(`J5 ${T} skipped and not-visible lines are listed as not assessed; the confirmed heart line is not`, !!r && r.notAssessed.includes('lines.head') && r.notAssessed.includes('lines.life') && !r.notAssessed.includes('lines.heart'));
  check(`J6 ${T} mobile-first layout: no horizontal overflow`, !!r && r.scrollW <= r.viewW + 1, r && { scrollW: r.scrollW, viewW: r.viewW });
  await shot('reading');
  await press('palm-result-edit');
  await press('palm-review-dominant-left');
  check(`J7 ${T} changing an answer after confirming withdraws the reading`, !(await has('palm-reading')) && !(await has('palm-review-see-result')));
  await press('palm-scanner-restart');
  check(`J8 ${T} Start over returns to step 1 with no reading`, !(await has('palm-reading')) && (await pg.$eval('[data-testid="palm-scanner-steps"]', (e: Element) => e.getAttribute('data-current')).catch(() => '')) === '1');
  const priv = (await pg.evaluate(() => (window as any).__privacy)).filter(DEV_BANNER);
  check(`J9 ${T} no network, storage, cookie, image encoding or console use; no page errors`, requests.length === 0 && priv.length === 0 && errors.length === 0, { requests, priv, errors });
  await ctx.close();
}

async function dr1(browser: any) {
  const html = page('none', 1, 1, { __PALM_CAMERA_MODE: 'mock', __previewTimeoutMs: 700 }, 'test/palm04I5CameraHarness.tsx');
  for (const [noFrames, label] of [[true, 'no frame ever'], [false, 'a working preview']] as Array<[boolean, string]>) {
    const ctx = await browser.newContext();
    if (noFrames) await ctx.addInitScript(() => {
      for (const key of ['videoWidth', 'videoHeight'] as const) { const o = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, key)!; Object.defineProperty(HTMLVideoElement.prototype, key, { configurable: true, get() { return (this as HTMLElement).dataset?.testid === 'palm-camera-video' ? 0 : o.get!.call(this); } }); }
    });
    const pg = await ctx.newPage();
    await ctx.route('https://palm-harness.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await pg.goto('https://palm-harness.test/');
    await pg.waitForSelector('[data-testid="palm-camera-button"]');
    await pg.click('[data-testid="palm-camera-button"]');
    await sleep(1500);
    const s = await pg.evaluate(() => ({ tracks: ((window as any).__camTracks as MediaStreamTrack[]).map((t) => t.readyState), attached: Array.from(document.querySelectorAll('video')).some((v) => !!(v as HTMLVideoElement).srcObject), code: document.querySelector('[data-testid="palm-camera-message"]')?.getAttribute('data-code') ?? null, phase: document.querySelector('[data-testid="palm-camera"]')?.getAttribute('data-phase') ?? null, retry: document.querySelector('[data-testid="palm-camera-button"]')?.textContent ?? null, upload: !!document.querySelector('[data-testid="palm-upload-button"]') }));
    if (noFrames) check('T1 DR-1 in Chrome: a preview that never yields a frame is stopped at the limit (track ended, detached), retryable, upload still offered', s.tracks.length === 1 && s.tracks[0] === 'ended' && !s.attached && s.code === 'camera-preview-timeout' && s.retry === 'Try the camera again' && s.upload, s);
    else check('T2 DR-1 in Chrome: a working preview is never timed out (still live and attached past the limit)', s.tracks.length === 1 && s.tracks[0] === 'live' && s.attached && s.phase === 'live' && s.code === null, s);
    await ctx.close();
  }
}

async function run() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const channel = process.env.PALM_BROWSER_CHANNEL || undefined;
  const browser = await chromium.launch(channel ? { channel } : {});
  console.log(`browser: ${channel ?? 'playwright chromium'} ${browser.version()}`);
  try {
    await loaderParity(browser);
    const png = await syntheticPng(browser, 1200, 900);
    await journey(browser, png, { name: 'desktop 1280x800 mouse', vw: 1280, vh: 800, dpr: 1, touch: false });
    await journey(browser, png, { name: 'phone 390x844 @3x touch', vw: 390, vh: 844, dpr: 3, touch: true });
    await dr1(browser);
  } finally { await browser.close(); }
}

run().then(() => {
  console.log(`\nPALM-D6-I1 journey browser: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
