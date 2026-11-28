/**
 * AURA-PALM-04-I4 -- the integrated scanner journey in a real Chromium, upload to confirmed result, with native input:
 * photo (real file input, decoding and G5 quality check) -> trace -> review -> result, plus back navigation, editing,
 * restart, photo replacement, a poor-quality photo, friendly uncertainty wording and privacy. Synthetic photo and hand
 * points only (test/palm04I4AppHarness.tsx); bundled in memory, no server, no network.
 *
 *   npx ts-node test/palm04I4JourneyBrowser.test.ts [--shots <dir>]      (PALM_BROWSER_CHANNEL=chrome in CI)
 */
import * as fs from 'fs';
import * as path from 'path';
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
const RAW_CODES = ['hand-rotated', 'implausible-proportions', 'depends-on-uncertain', 'depends-on-unavailable', 'too-dark', 'needs-retake', 'user-skipped', 'user-cannot-see', 'not-requested'];

/** A synthetic palm photo (drawn, not photographed) as PNG bytes, rendered in a separate scratch page. */
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
    // skin texture (a flat drawn palm would fail the G5 contrast check, honestly)
    for (let i = 0; i < 9000; i++) { const x = (0.15 + 0.65 * ((i * 7919) % 1000) / 1000) * W, y = (0.12 + 0.78 * ((i * 104729) % 1000) / 1000) * H; g.fillStyle = i % 2 ? 'rgba(90,50,30,0.35)' : 'rgba(255,240,225,0.35)'; g.fillRect(x, y, 4, 4); }
    g.strokeStyle = '#7a4a35'; g.lineWidth = 3;
    for (const ln of [[[0.67, 0.555], [0.52, 0.54], [0.44, 0.525]], [[0.37, 0.56], [0.54, 0.62], [0.62, 0.64]], [[0.36, 0.57], [0.4, 0.74], [0.45, 0.81]]]) { g.beginPath(); ln.forEach(([x, y], i) => (i ? g.lineTo(x * W, y * H) : g.moveTo(x * W, y * H))); g.stroke(); }
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h] as [number, number]);
  await ctx.close();
  return Buffer.from(b64, 'base64');
}

async function run() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const channel = process.env.PALM_BROWSER_CHANNEL || undefined;
  const browser = await chromium.launch(channel ? { channel } : {});
  console.log(`browser: ${channel ?? 'playwright chromium'} ${browser.version()}`);
  const png = await syntheticPng(browser, 1200, 900);
  const png2 = await syntheticPng(browser, 900, 1200);
  try {
    for (const L of [{ name: 'desktop 1280x800 mouse', vw: 1280, vh: 800, dpr: 1, touch: false }, { name: 'phone 390x844 @3x touch', vw: 390, vh: 844, dpr: 3, touch: true }]) {
      for (const rotate of [0, 60]) {
        const T = `[${L.name}${rotate ? ', tilted hand (poor photo)' : ''}]`;
        const ctx = await browser.newContext({ viewport: { width: L.vw, height: L.vh }, deviceScaleFactor: L.dpr, hasTouch: L.touch });
        const pg = await ctx.newPage();
        const errors: string[] = [];
        const requests: string[] = [];
        pg.on('pageerror', (e: any) => errors.push(String(e).split('\n')[0]));
        pg.on('request', (r: any) => requests.push(r.url()));
        await pg.setContent(page('none', 1, 1, { __PALM_APP_ROTATE: rotate }, 'test/palm04I4AppHarness.tsx'));
        await pg.waitForSelector('[data-testid="palm-upload-button"]');
        const cdp = await ctx.newCDPSession(pg);
        const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const click = async (id: string) => { await pg.click(`[data-testid="${id}"]`, { timeout: 4000 }).catch(() => console.log(`note: ${id} not clickable`)); await settle(); };
        const has = async (id: string) => (await pg.$(`[data-testid="${id}"]`)) !== null;
        const stage = async () => pg.$eval('[data-testid="palm-scanner-steps"]', (e: Element) => Number(e.getAttribute('data-current'))).catch(() => 0);
        const text = async (id: string) => pg.$eval(`[data-testid="${id}"]`, (e: Element) => e.textContent ?? '').catch(() => '');
        const upload = async (buf: Buffer, name = 'synthetic-palm.png') => {
          await pg.setInputFiles('[data-testid="palm-file-input"]', { name, mimeType: 'image/png', buffer: buf });
          await pg.waitForSelector('[data-testid="palm-result"], [data-testid="palm-error"]', { timeout: 20000 });
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
        const shot = async (n: string) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, `p4i4-${L.vw}x${L.vh}${rotate ? '-poor' : ''}-${n}.png`), fullPage: true }); };

        // 1. photo
        check(`J1 ${T} the journey starts at step 1 (Photo) with four steps shown`, (await stage()) === 1 && (await pg.$$('[data-testid="palm-scanner-steps"] li')).length === 4);
        await upload(png);
        const status = await pg.$eval('[data-testid="palm-result"]', (e: Element) => e.getAttribute('data-status')).catch(() => 'error');
        const issues: string[] = await pg.$$eval('[data-testid="palm-issues"] li', (els: Element[]) => els.map((e) => e.getAttribute('data-issue') ?? ''));
        check(`J2 ${T} the synthetic photo goes through the real upload flow and photo check (${status}${issues.length ? `: ${issues.join(', ')}` : ''})`, rotate ? status === 'needs-retake' : status === 'accepted', { status, issues });
        await shot('1-photo');
        // 2. trace
        await click('palm-trace-button');
        check(`J3 ${T} tracing is step 2`, (await stage()) === 2 && (await has('palm-tracing-stage')));
        // the heart line on THIS hand: rotated with the synthetic hand (same rotation as the harness landmarks)
        const turn = ([x, y]: [number, number]): [number, number] => { const a = (rotate * Math.PI) / 180, cx = 0.5, cy = 0.55; return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]; };
        for (const p of ([[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]] as Array<[number, number]>).map(turn)) await tap(p[0], p[1]);
        await click('palm-tracing-confirm');
        await click('palm-tracing-next'); await click('palm-tracing-skip');
        await click('palm-tracing-next'); await click('palm-tracing-cannot-see');
        await shot('2-trace');
        // 3. review
        await click('palm-review-open');
        check(`J4 ${T} review is step 3 and still needs the hand answers (nothing defaulted)`, (await stage()) === 3 && (await pg.$eval('[data-testid="palm-review-confirm"]', (e: Element) => (e as HTMLButtonElement).disabled)));
        await click('palm-review-hand-left'); await click('palm-review-dominant-right');
        const ack = await has('palm-review-ack');
        check(`J5 ${T} a poor photo requires acknowledging the uncertain items${rotate ? '' : ' (an accepted photo may still have I1-uncertain proportions)'}`, rotate ? ack : true);
        if (ack) await click('palm-review-ack');
        const reviewText = await text('palm-review');
        check(`J6 ${T} the review shows friendly wording, not raw codes (codes kept in data-code)`, !RAW_CODES.some((c) => reviewText.includes(c)) && (rotate ? /The hand is tilted\./.test(reviewText) && (await pg.$('[data-testid="palm-review-quality-reasons"] [data-code="hand-rotated"]')) !== null : true), RAW_CODES.filter((c) => reviewText.includes(c)));
        await shot('3-review');
        await click('palm-review-confirm');
        await click('palm-review-see-result');
        // 4. result
        const lines = await pg.$eval('[data-testid="palm-scanner-result"]', (e: Element) => e.getAttribute('data-lines')).catch(() => null);
        check(`J7 ${T} the result is step 4 and shows exactly the confirmed features`, (await stage()) === 4 && lines === 'heart:user-confirmed;head:unassessed/user-skipped;life:unassessed/user-cannot-see;upward:unassessed/not-requested', lines);
        const resultText = await text('palm-scanner-result');
        check(`J8 ${T} the result says skipped, not visible and not requested plainly, never as observed absences`, /Skipped \(not assessed\)/.test(resultText) && /could not see it \(not assessed\)/.test(resultText) && /Not requested \(optional\)/.test(resultText) && /Nothing is guessed or filled in/.test(resultText));
        check(`J9 ${T} the result uses friendly wording for every uncertainty (raw codes only in data-code)`, !RAW_CODES.some((c) => resultText.includes(c)) && (rotate ? (await pg.$('[data-testid="palm-result-quality-reasons"] [data-code="hand-rotated"]')) !== null && /A better photo would help/.test(resultText) : true), RAW_CODES.filter((c) => resultText.includes(c)));
        const mstat = await pg.$eval('[data-testid="palm-result-measurement-status"]', (e: Element) => e.getAttribute('data-status')).catch(() => null);
        check(`J10 ${T} uncertainty semantics are kept: measurement status ${mstat}${rotate ? ' (not measured)' : ''}`, rotate ? mstat !== 'measured' : !!mstat);
        await shot('4-result');
        // back navigation and editing
        await click('palm-result-edit');
        check(`J11 ${T} Review or edit goes back to step 3 with the confirmation still valid`, (await stage()) === 3 && (await has('palm-review-confirmed')));
        await click('palm-review-edit-head');
        check(`J12 ${T} Edit goes back to tracing (step 2)`, (await stage()) === 2);
        await click('palm-tracing-retrace');
        check(`J13 ${T} changing a line after confirming withdraws the confirmation (no result can be shown)`, !(await has('palm-review-confirmed-banner')));
        await click('palm-tracing-skip');
        await click('palm-review-open');
        check(`J14 ${T} the review needs a fresh confirmation and offers no result`, !(await has('palm-review-see-result')) && (await has('palm-review-confirm')));
        // restart
        await click('palm-scanner-restart');
        check(`J15 ${T} Start over returns to step 1 with no photo, no traces and no answers`, (await stage()) === 1 && !(await has('palm-tracing')) && !(await has('palm-review')) && (await text('palm-upload-button')) === 'Upload photo');
        // replacement mid-journey
        await upload(png);
        await click('palm-trace-button');
        await tap(0.67, 0.555); await tap(0.6, 0.545);
        await upload(png2, 'other-synthetic-palm.png');
        check(`J16 ${T} choosing another photo mid-journey closes tracing and returns to step 1 for the new photo`, (await stage()) === 1 && !(await has('palm-tracing')) && (await has('palm-trace-button')));
        await click('palm-trace-button');
        check(`J17 ${T} the new photo starts a fresh tracing (no traces carried over)`, (await pg.$$('[data-trace]')).length === 0);
        // revocation: removing the photo during review
        await click('palm-review-open');
        await click('palm-remove-button');
        check(`J18 ${T} removing the photo during the review clears the journey back to step 1`, (await stage()) === 1 && !(await has('palm-review')));
        const priv = await pg.evaluate(() => (window as any).__privacy);
        check(`J19 ${T} no network, storage, cookie, image encoding or console use in the app page; no page errors`, requests.length === 0 && priv.length === 0 && errors.length === 0, { requests, priv, errors });
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
}

run().then(() => {
  console.log(`\nPALM-04-I4 journey browser: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
