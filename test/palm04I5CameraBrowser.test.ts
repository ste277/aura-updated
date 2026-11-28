/**
 * AURA-PALM-04-I5 -- camera capture in the integrated scanner journey, in a real Chromium, with MOCKED camera streams
 * (canvas.captureStream of a drawn synthetic palm) and Chrome's built-in FAKE camera device. No real camera, no
 * photograph, no network. Desktop (mouse) and phone (touch, mobile emulation) layouts.
 *
 * Covers: the camera is asked for only after an explicit choice; video only (no microphone); track cleanup after the
 * photo, on cancel, on error, when hidden, frozen, unmounted or navigated away; delayed permission grants and delayed
 * detection never restoring cleared state; permission granted / denied / busy / unavailable / insecure; repeated
 * capture, retake, cancel and restart; confirmation invalidation on a new photo; the full camera -> trace -> review ->
 * result journey; immediate (event-driven) revocation with timers fully throttled; privacy spies; and five mutation
 * negative controls, each of which must be detected.
 *
 *   npx ts-node test/palm04I5CameraBrowser.test.ts [--shots <dir>]      (PALM_BROWSER_CHANNEL=chrome in CI)
 */
import * as fs from 'fs';
import * as path from 'path';
import { page, oracleContent, type Box, type Mutation } from './palm04I2TracingBrowser.test';
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
const HARNESS = 'test/palm04I5CameraHarness.tsx';

type Layout = { name: string; vw: number; vh: number; dpr: number; touch: boolean };
const DESKTOP: Layout = { name: 'desktop 1280x800 mouse', vw: 1280, vh: 800, dpr: 1, touch: false };
const PHONE: Layout = { name: 'phone 390x844 @3x touch', vw: 390, vh: 844, dpr: 3, touch: true };

/** One app page on a routed origin (https = secure context, unless `insecure`). */
async function open(browser: any, L: Layout, opts: { mode?: string; extra?: Record<string, unknown>; mutation?: Mutation; insecure?: boolean; grant?: boolean; init?: string } = {}) {
  const ctx = await browser.newContext({ viewport: { width: L.vw, height: L.vh }, deviceScaleFactor: L.dpr, hasTouch: L.touch, isMobile: L.touch });
  if (opts.grant) await ctx.grantPermissions(['camera'], { origin: 'https://palm-harness.test' });
  const reports: string[] = [];
  await ctx.exposeBinding('__report', (_src: unknown, k: string) => { reports.push(k); });
  const pg = await ctx.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  pg.on('pageerror', (e: any) => errors.push(String(e).split('\n')[0]));
  pg.on('request', (r: any) => requests.push(r.url()));
  if (opts.init) await pg.addInitScript(opts.init);
  // the harness also records object URLs (none may be created for a camera photo)
  await pg.addInitScript('(function(){var o=URL.createObjectURL;URL.createObjectURL=function(){(window.__privacy=window.__privacy||[]).push("createObjectURL");return o.apply(URL,arguments);};})();');
  const html = page(opts.mutation ?? 'none', 1, 1, { __PALM_CAMERA_MODE: opts.mode ?? 'mock', ...(opts.extra ?? {}) }, HARNESS);
  const origin = opts.insecure ? 'http://palm-harness.test' : 'https://palm-harness.test';
  const OBSERVER = '<!doctype html><script>window.__got=[];new BroadcastChannel("palm-camera-test").onmessage=function(e){window.__got.push(e.data);};</script><p>observer</p>';
  await ctx.route(`${origin}/**`, (route: any) => { const u = route.request().url(); route.fulfill({ status: 200, contentType: 'text/html', body: u.endsWith('/elsewhere') ? '<!doctype html><p id="elsewhere">elsewhere</p>' : u.endsWith('/observer') ? OBSERVER : html }); });
  await pg.goto(`${origin}/`);
  if (opts.mode !== 'unmounted') await pg.waitForSelector('[data-testid="palm-upload-button"]');
  const cdp = await ctx.newCDPSession(pg);
  const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const press = async (id: string) => {
    const sel = `[data-testid="${id}"]`;
    const ok = await (L.touch ? pg.tap(sel, { timeout: 4000 }) : pg.click(sel, { timeout: 4000 })).then(() => true, () => false);
    if (!ok) console.log(`note: ${id} not pressable`);
    await settle();
    return ok;
  };
  const has = async (id: string) => (await pg.$(`[data-testid="${id}"]`)) !== null;
  const text = async (id: string) => pg.$eval(`[data-testid="${id}"]`, (e: Element) => e.textContent ?? '').catch(() => '');
  const attr = async (id: string, a: string) => pg.$eval(`[data-testid="${id}"]`, (e: Element, n: string) => e.getAttribute(n), a).catch(() => null);
  const tracks = async (): Promise<Array<{ kind: string; state: string }>> => pg.evaluate(() => ((window as any).__camTracks as MediaStreamTrack[]).map((t) => ({ kind: t.kind, state: t.readyState })));
  const liveTracks = async () => (await tracks()).filter((t) => t.state === 'live').length;
  const calls = async (): Promise<any[]> => pg.evaluate(() => (window as any).__camCalls);
  const videoLive = async () => pg.evaluate(() => { const v = document.querySelector('[data-testid="palm-camera-video"]') as HTMLVideoElement | null; return !!v && v.srcObject instanceof MediaStream && v.videoWidth > 0; });
  /** Use camera, then wait until the live video has frames. */
  const cameraOn = async () => {
    await press('palm-camera-button');
    for (let k = 0; k < 80 && !(await videoLive()); k++) await sleep(50);
    return videoLive();
  };
  const takePhoto = async () => {
    await press('palm-camera-take');
    await pg.waitForSelector('[data-testid="palm-result"], [data-testid="palm-error"]', { timeout: 20000 }).catch(() => undefined);
    await settle();
  };
  const tap = async (x: number, y: number) => {
    const st = await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const W = await pg.$eval('[data-testid="palm-tracing-photo"]', (e: Element) => [(e as HTMLCanvasElement).width, (e as HTMLCanvasElement).height]);
    const b: Box = oracleContent(st, W[0], W[1]);
    const p = { x: b.left + x * b.width, y: b.top + y * b.height };
    if (L.touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else await pg.mouse.click(p.x, p.y);
    await settle();
  };
  const setHidden = async (hidden: boolean) => pg.evaluate((h: boolean) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  // React's own development-build banner is not app logging
  const privacy = async (): Promise<string[]> => (await pg.evaluate(() => (window as any).__privacy ?? [])).filter((k: string) => !/Download the React DevTools/.test(k));
  const shot = async (n: string) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `p4i5-${L.vw}x${L.vh}-${n}.png`), fullPage: true }); };
  return { ctx, pg, cdp, reports, errors, requests, press, has, text, attr, tracks, liveTracks, calls, videoLive, cameraOn, takePhoto, tap, setHidden, privacy, settle, shot, origin };
}

/** A synthetic PNG for the upload alternative (drawn in a scratch page). */
async function syntheticPng(browser: any): Promise<Buffer> {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const b64: string = await pg.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 900; const g = c.getContext('2d')!; g.fillStyle = '#334'; g.fillRect(0, 0, 1200, 900); for (let i = 0; i < 9000; i++) { g.fillStyle = i % 2 ? '#a76' : '#fdc'; g.fillRect((i * 97) % 1200, (i * 53) % 900, 4, 4); } return c.toDataURL('image/png').split(',')[1]; });
  await ctx.close();
  return Buffer.from(b64, 'base64');
}

async function journey(browser: any, L: Layout) {
  const T = `[${L.name}]`;
  const A = await open(browser, L);
  const { pg } = A;
  // ------------------------------------------------ explicit action only
  await sleep(300);
  check(`C1 ${T} the camera button and note are shown, and nothing asked for the camera on load`, (await A.has('palm-camera-button')) && /turns on only when you choose Use camera/.test(await A.text('palm-camera-note')) && (await A.calls()).length === 0 && (await A.tracks()).length === 0);
  check(`C2 ${T} the upload alternative is still offered next to the camera`, (await A.text('palm-upload-button')) === 'Upload photo' && (await pg.$('[data-testid="palm-file-input"]:not([capture])')) !== null);
  // ------------------------------------------------ granted -> live -> photo
  const live = await A.cameraOn();
  const c1 = await A.calls();
  check(`C3 ${T} Use camera asks once, video only (audio: false), and shows the live stream`, live && c1.length === 1 && c1[0].audio === false && !!c1[0].video && (await A.attr('palm-camera', 'data-phase')) === 'live', c1);
  check(`C4 ${T} while the camera is on, only Take photo and Cancel are offered (no upload or tracing on top)`, (await A.has('palm-camera-take')) && (await A.has('palm-camera-cancel')) && !(await A.has('palm-upload-button')) && !(await A.has('palm-tracing')));
  await A.shot('1-camera-live');
  await A.takePhoto();
  const t1 = await A.tracks();
  check(`C5 ${T} taking the photo turns the camera off at once: every track ended, the video is gone`, t1.length > 0 && t1.every((t) => t.state === 'ended') && !(await A.has('palm-camera-video')), t1);
  check(`C6 ${T} the camera photo goes through the real photo check (accepted)`, (await A.attr('palm-result', 'data-status')) === 'accepted', await A.text('palm-result'));
  check(`C7 ${T} the photo is offered for a retake with the camera`, (await A.text('palm-camera-button')) === 'Retake with camera');
  await pg.evaluate(() => { (window as any).__photo1 = document.querySelector('[data-testid="palm-preview-canvas"]'); });
  await A.shot('2-camera-photo');
  // ------------------------------------------------ the journey on a camera photo
  await A.press('palm-trace-button');
  for (const p of [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]] as Array<[number, number]>) await A.tap(p[0], p[1]);
  await A.press('palm-tracing-confirm');
  await A.press('palm-tracing-next'); await A.press('palm-tracing-skip');
  await A.press('palm-tracing-next'); await A.press('palm-tracing-cannot-see');
  await A.press('palm-review-open');
  await A.press('palm-review-hand-left'); await A.press('palm-review-dominant-right');
  if (await A.has('palm-review-ack')) await A.press('palm-review-ack');
  await A.press('palm-review-confirm');
  await A.press('palm-review-see-result');
  const lines = await A.attr('palm-scanner-result', 'data-lines');
  check(`C8 ${T} camera photo -> trace -> review -> confirmed result`, lines === 'heart:user-confirmed;head:unassessed/user-skipped;life:unassessed/user-cannot-see;upward:unassessed/not-requested', lines);
  await A.shot('3-result');
  // ------------------------------------------------ retake, then cancel: the old photo stays, its traces do not
  await A.cameraOn();
  check(`C9 ${T} opening the camera from the result closes tracing and withdraws the result`, !(await A.has('palm-scanner-result')) && !(await A.has('palm-tracing')) && (await A.liveTracks()) === 1);
  await A.press('palm-camera-cancel');
  check(`C10 ${T} Cancel turns the camera off (every track ended) and says no photo was taken`, (await A.liveTracks()) === 0 && /No photo was taken/.test(await A.text('palm-camera-message')) && !(await A.has('palm-camera-video')));
  check(`C11 ${T} after Cancel the previous photo is still there`, (await A.attr('palm-result', 'data-status')) === 'accepted');
  await A.press('palm-trace-button');
  check(`C12 ${T} tracing that photo again starts fresh (the earlier traces and confirmation were dropped)`, (await pg.$$('[data-trace]')).length === 0 && !(await A.has('palm-review-confirmed-banner')));
  await A.tap(0.67, 0.555); await A.tap(0.6, 0.545);
  // ------------------------------------------------ retake and take: replacement
  const gen1 = await pg.evaluate(() => document.querySelectorAll('[data-trace]').length);
  await A.cameraOn();
  await A.takePhoto();
  check(`C13 ${T} a new camera photo releases the old one: its pixels are cleared (canvas 0x0) and it is no longer shown`, await pg.evaluate(() => { const c = (window as any).__photo1 as HTMLCanvasElement; return !!c && c.width === 0 && c.height === 0 && !c.isConnected; }));
  await A.press('palm-trace-button');
  check(`C14 ${T} the new photo starts with no traces (${gen1} traces on the old photo were withdrawn)`, gen1 > 0 && (await pg.$$('[data-trace]')).length === 0);
  // ------------------------------------------------ repeated capture
  for (let k = 0; k < 3; k++) { await A.cameraOn(); await A.takePhoto(); }
  const tAll = await A.tracks();
  check(`C15 ${T} repeated capture (3 more): one camera request per choice, every track ended each time`, (await A.calls()).length === 6 && tAll.length === 6 && tAll.every((t) => t.state === 'ended'), { calls: (await A.calls()).length, tAll });
  // ------------------------------------------------ restart
  await A.press('palm-trace-button');
  await A.press('palm-scanner-restart');
  check(`C16 ${T} Start over clears the camera photo and returns to step 1 with the camera off`, !(await A.has('palm-preview-canvas')) && (await A.text('palm-upload-button')) === 'Upload photo' && (await A.text('palm-camera-button')) === 'Use camera' && (await A.liveTracks()) === 0);
  // ------------------------------------------------ backgrounding (emulated visibility) and freezing (CDP lifecycle)
  await A.cameraOn();
  await A.setHidden(true);
  await A.settle();
  check(`C17 ${T} hiding the page turns the camera off at once (every track ended) and says why`, (await A.liveTracks()) === 0 && !(await A.has('palm-camera-video')) && /left this page/.test(await A.text('palm-camera-message')));
  await A.setHidden(false);
  check(`C18 ${T} coming back does not turn the camera on again by itself`, (await A.liveTracks()) === 0 && (await A.calls()).length === 7);
  await A.cameraOn(); await A.takePhoto();
  await A.cameraOn();
  // headless Chrome does not dispatch Page Lifecycle "freeze" for a foreground page, so the event is dispatched (emulated)
  await pg.evaluate(() => document.dispatchEvent(new Event('freeze')));
  await A.settle();
  check(`C19 ${T} a frozen page (Page Lifecycle "freeze", emulated) turns the camera off and clears the photo`, (await A.liveTracks()) === 0 && !(await A.has('palm-preview-canvas')) && !(await A.has('palm-result')));
  // ------------------------------------------------ the device ends the track
  await A.cameraOn();
  await pg.evaluate(() => { const ts = (window as any).__camTracks as MediaStreamTrack[]; ts[ts.length - 1].dispatchEvent(new Event('ended')); });
  await A.settle();
  check(`C20 ${T} a camera that stops by itself turns the camera off with a retry`, (await A.liveTracks()) === 0 && (await A.attr('palm-camera-message', 'data-code')) === 'camera-ended' && (await A.text('palm-camera-button')) === 'Try the camera again');
  // ------------------------------------------------ unmount while live
  await A.cameraOn();
  await pg.evaluate(() => (window as any).__harness.unmount());
  await A.settle();
  check(`C21 ${T} leaving the screen (unmount) while the camera is on stops every track`, (await A.liveTracks()) === 0 && (await pg.$('[data-testid="harness-unmounted"]')) !== null);
  await pg.evaluate(() => (window as any).__harness.remount());
  await pg.waitForSelector('[data-testid="palm-camera-button"]');
  // ------------------------------------------------ navigation while live
  await A.cameraOn();
  const appPriv = await A.privacy();
  const observer = await A.ctx.newPage();
  await observer.goto(`${A.origin}/observer`);
  await pg.goto(`${A.origin}/elsewhere`);
  await sleep(400);
  const got: string[] = await observer.evaluate(() => (window as any).__got);
  const lastStart = [...got].reverse().find((k) => k.startsWith('start:'));
  check(`C22 ${T} navigating away while the camera is on stops its track as the page goes (pagehide)`, !lastStart && got.some((k) => k.startsWith('stop:')), got);
  check(`C23a ${T} the whole camera journey used no storage, cookie, toDataURL/toBlob, object URL or console`, appPriv.length === 0, appPriv);
  check(`C23 ${T} no network, storage, cookie, image encoding, object URL or console use; no page errors`, A.requests.every((u) => u.startsWith(A.origin)) && A.errors.length === 0, { requests: A.requests.filter((u) => !u.startsWith(A.origin)), errors: A.errors });
  await A.ctx.close();
}

async function scenarios(browser: any, L: Layout, png: Buffer) {
  const T = `[${L.name}]`;
  // ------------------------------------------------ privacy over a full camera session
  {
    const A = await open(browser, L);
    await A.cameraOn(); await A.takePhoto(); await A.cameraOn(); await A.press('palm-camera-cancel');
    const priv = await A.privacy();
    check(`P1 ${T} a camera session uses no network, storage, cookie, toDataURL/toBlob, object URL or console`, priv.length === 0 && A.requests.length === 1 && A.errors.length === 0, { priv, requests: A.requests, errors: A.errors });
    await A.ctx.close();
  }
  // ------------------------------------------------ denied, busy, refused audio
  for (const [reject, code, label] of [['NotAllowedError', 'camera-denied', 'Use camera'], ['NotReadableError', 'camera-busy', 'Try the camera again'], ['NotFoundError', 'camera-not-found', 'Use camera']] as Array<[string, string, string]>) {
    const A = await open(browser, L, { extra: { __camReject: reject } });
    await A.press('palm-camera-button');
    await A.pg.waitForSelector('[data-testid="palm-camera-message"]', { timeout: 4000 }).catch(() => undefined);
    check(`D1 ${T} ${reject}: ${code} is explained, nothing is live, the button says "${label}"`, (await A.attr('palm-camera-message', 'data-code')) === code && (await A.liveTracks()) === 0 && (await A.text('palm-camera-button')) === label && !(await A.has('palm-camera-video')));
    await A.pg.setInputFiles('[data-testid="palm-file-input"]', { name: 'synthetic.png', mimeType: 'image/png', buffer: png });
    await A.pg.waitForSelector('[data-testid="palm-result"], [data-testid="palm-error"]', { timeout: 20000 });
    check(`D2 ${T} after ${reject} the upload alternative still works and clears the camera message`, (await A.has('palm-preview-canvas')) && !(await A.has('palm-camera-message')));
    await A.ctx.close();
  }
  {
    const A = await open(browser, L, { extra: { __camAudio: true } });
    await A.press('palm-camera-button');
    await sleep(400);
    const t = await A.tracks();
    check(`D3 ${T} a stream that carries an audio track is refused and every track (audio too) is stopped`, (await A.attr('palm-camera-message', 'data-code')) === 'camera-failed' && t.length === 2 && t.every((x) => x.state === 'ended'), t);
    await A.ctx.close();
  }
  // ------------------------------------------------ unavailable / insecure
  {
    const A = await open(browser, L, { mode: 'none' });
    check(`U1 ${T} no camera API: no camera button, an explanation, upload still offered`, !(await A.has('palm-camera-button')) && (await A.attr('palm-camera-unavailable', 'data-support')) === 'unsupported' && (await A.has('palm-upload-button')));
    await A.ctx.close();
    const B = await open(browser, L, { mode: 'native', insecure: true });
    check(`U2 ${T} an insecure (http) page: no camera button, the secure-page explanation, upload still offered`, !(await B.has('palm-camera-button')) && (await B.attr('palm-camera-unavailable', 'data-support')) === 'insecure-context' && (await B.has('palm-upload-button')));
    await B.ctx.close();
  }
  // ------------------------------------------------ delayed permission grant after cancel / unmount
  {
    const A = await open(browser, L, { extra: { __camDelay: 600 } });
    await A.press('palm-camera-button');
    await A.press('palm-camera-cancel');
    await sleep(900);
    const t = await A.tracks();
    check(`L1 ${T} a permission grant that arrives after Cancel is stopped at once and never shown`, t.length === 1 && t[0].state === 'ended' && !(await A.has('palm-camera-video')) && !(await A.has('palm-camera')), t);
    await A.press('palm-camera-button');
    await A.pg.evaluate(() => (window as any).__harness.unmount());
    await sleep(900);
    const t2 = await A.tracks();
    check(`L2 ${T} a grant that arrives after unmount is stopped at once`, t2.length === 2 && t2.every((x) => x.state === 'ended'), t2);
    await A.ctx.close();
  }
  // ------------------------------------------------ delayed detection after the photo was removed or replaced
  {
    const A = await open(browser, L, { extra: { __detDelay: 900 } });
    await A.cameraOn();
    await A.press('palm-camera-take');
    check(`L3 ${T} (setup) the camera photo is waiting for the slow hand model`, /Loading the on-device hand model/.test(await A.text('palm-status')));
    await A.press('palm-remove-button');
    await sleep(1400);
    check(`L4 ${T} a detection that finishes after the photo was removed never restores it (no photo, no result)`, !(await A.has('palm-result')) && !(await A.has('palm-preview-canvas')) && (await A.text('palm-upload-button')) === 'Upload photo' && (await A.liveTracks()) === 0);
    await A.ctx.close();
  }
  {
    const A = await open(browser, L, { extra: { __detDelay: 900 } });
    await A.cameraOn(); await A.press('palm-camera-take');
    await A.cameraOn(); await A.press('palm-camera-take');
    await A.pg.waitForSelector('[data-testid="palm-result"]', { timeout: 6000 }).catch(() => undefined);
    await sleep(300);
    const shown = await A.pg.$$eval('[data-testid="palm-preview-canvas"]', (els: Element[]) => els.length);
    check(`L5 ${T} two quick camera photos: only the second is analysed and shown`, shown === 1 && (await A.attr('palm-result', 'data-status')) === 'accepted' && (await A.liveTracks()) === 0);
    await A.ctx.close();
  }
}

/** Revocation is event-driven: with timers fully throttled (the 250 ms poll never runs), a hidden page still clears. */
async function throttled(browser: any, mutation: Mutation): Promise<boolean> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  await pg.addInitScript('window.setInterval = function () { return 0; };');
  const html = page(mutation, 960, 1280, {}, 'test/palm04I2Harness.tsx');
  await pg.route('https://palm-harness.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await pg.goto('https://palm-harness.test/');
  await pg.waitForSelector('[data-testid="palm-tracing-stage"]');
  const cleared = await pg.evaluate(async () => {
    (window as any).__palmHarness.revoke();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelector('[data-testid="palm-tracing"]')?.getAttribute('data-state') === 'cleared' && document.querySelectorAll('[data-trace], [data-guide]').length === 0;
  });
  await ctx.close();
  return cleared;
}

async function nativeChrome(L: Layout) {
  const T = `[${L.name}, Chrome fake camera device]`;
  // Google Chrome (the CI channel): Playwright's headless shell has no media capture
  const channel = process.env.PALM_BROWSER_CHANNEL || 'chrome';
  const browser = await chromium.launch({ channel, args: ['--use-fake-device-for-media-stream'] });
  try {
    const A = await open(browser, L, { mode: 'native', grant: true });
    const live = await A.cameraOn();
    const t = await A.tracks();
    check(`N1 ${T} permission granted: the real getUserMedia is asked once for video only and gives one video track`, live && (await A.calls()).length === 1 && (await A.calls())[0].audio === false && t.length === 1 && t[0].kind === 'video', { calls: await A.calls(), t });
    await A.takePhoto();
    check(`N2 ${T} taking the photo ends the real camera track`, (await A.tracks()).every((x) => x.state === 'ended') && (await A.has('palm-preview-canvas')));
    const mic = await A.pg.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state);
    check(`N3 ${T} the microphone was never requested (permission still "${mic}")`, mic === 'prompt' || mic === 'denied', mic);
    await A.ctx.close();
    const B = await open(browser, L, { mode: 'native' });
    await B.press('palm-camera-button');
    await B.pg.waitForSelector('[data-testid="palm-camera-message"]', { timeout: 6000 }).catch(() => undefined);
    check(`N4 ${T} permission not granted: the browser's refusal is shown as camera-denied and nothing is live`, (await B.attr('palm-camera-message', 'data-code')) === 'camera-denied' && (await B.tracks()).length === 0);
    await B.ctx.close();
  } finally { await browser.close(); }
}

async function controls(browser: any) {
  const L = DESKTOP;
  const detected: Record<string, boolean> = {};
  {
    const A = await open(browser, L, { mutation: 'camera-keep-on' });
    await A.cameraOn(); await A.takePhoto();
    detected['camera-keep-on'] = (await A.liveTracks()) > 0; // the camera stays on after the photo
    await A.ctx.close();
  }
  {
    const A = await open(browser, L, { mutation: 'camera-late-grant', extra: { __camDelay: 500 } });
    await A.press('palm-camera-button'); await A.press('palm-camera-cancel'); await sleep(800);
    detected['camera-late-grant'] = (await A.liveTracks()) > 0; // a late grant stays live
    await A.ctx.close();
  }
  {
    const A = await open(browser, L, { mutation: 'camera-ignore-hidden' });
    await A.cameraOn(); await A.setHidden(true); await A.settle();
    detected['camera-ignore-hidden'] = (await A.liveTracks()) > 0;
    await A.ctx.close();
  }
  {
    const A = await open(browser, L, { mutation: 'camera-audio' });
    await A.press('palm-camera-button'); await sleep(200);
    detected['camera-audio'] = (await A.calls()).some((c: any) => c.audio !== false);
    await A.ctx.close();
  }
  detected['poll-only'] = !(await throttled(browser, 'poll-only'));
  for (const [m, d] of Object.entries(detected)) check(`X ${m}: the negative control is detected`, d);
}

async function run() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const channel = process.env.PALM_BROWSER_CHANNEL || undefined;
  const browser = await chromium.launch(channel ? { channel } : {});
  console.log(`browser: ${channel ?? 'playwright chromium'} ${browser.version()}`);
  try {
    const png = await syntheticPng(browser);
    for (const L of [DESKTOP, PHONE]) {
      await journey(browser, L);
      await scenarios(browser, L, png);
    }
    check('R1 [desktop] revocation is event-driven: with timers fully throttled, a hidden page clears the revoked photo and its traces', await throttled(browser, 'none'));
    await controls(browser);
  } finally { await browser.close(); }
  for (const L of [DESKTOP, PHONE]) await nativeChrome(L);
}

run().then(() => {
  console.log(`\nPALM-04-I5 camera browser: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
