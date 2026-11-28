/**
 * AURA-PALM-04-I3 -- the feature review and confirmation journey in a real Chromium, with native input, on the
 * synthetic development harness (bundled in memory by test/palm04I2TracingBrowser.test.ts; no network, no server).
 *
 *   npx ts-node test/palm04I3ReviewBrowser.test.ts [--shots <dir>]
 *   PALM_BROWSER_CHANNEL=chrome  -> the installed Google Chrome (CI)
 *
 * Negative controls (each MUST make checks fail): stale-confirmation (a confirmation survives later changes),
 * silent-missing (untraced primary lines no longer block confirmation).
 */
import * as fs from 'fs';
import * as path from 'path';
import { page, oracleContent, type Mutation, type Box } from './palm04I2TracingBrowser.test';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require('playwright');

const argShots = process.argv.indexOf('--shots');
const SHOTS = argShots > 0 ? process.argv[argShots + 1] : null;
interface Result { passed: number; failed: string[] }

async function journey(browser: any, mutation: Mutation, verbose: boolean, shots: string | null): Promise<Result> {
  const res: Result = { passed: 0, failed: [] };
  const check = (name: string, cond: boolean, detail?: unknown) => {
    if (cond) { res.passed++; if (verbose) console.log(`OK   ${name}`); } else { res.failed.push(name); if (verbose) console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
  };
  const layouts = [
    { name: 'desktop 1280x800 @1x mouse', vw: 1280, vh: 800, dpr: 1, touch: false, W: 1280, H: 960 },
    { name: 'phone 390x844 @3x touch', vw: 390, vh: 844, dpr: 3, touch: true, W: 960, H: 1280 },
  ];
  for (const L of layouts) {
    for (const quality of [[], ['too-dark']] as string[][]) {
      const T = `[${L.name}${quality.length ? ', photo quality issue' : ''}]`;
      const ctx = await browser.newContext({ viewport: { width: L.vw, height: L.vh }, deviceScaleFactor: L.dpr, hasTouch: L.touch });
      const pg = await ctx.newPage();
      const errors: string[] = [];
      const requests: string[] = [];
      pg.on('pageerror', (e: any) => errors.push(String(e).split('\n')[0]));
      pg.on('request', (r: any) => requests.push(r.url()));
      await pg.setContent(page(mutation, L.W, L.H, { __PALM_HARNESS_QUALITY: quality }));
      await pg.waitForSelector('[data-testid="palm-tracing-stage"] canvas');
      const cdp = await ctx.newCDPSession(pg);
      const settle = () => pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const click = async (id: string) => { await pg.click(`[data-testid="${id}"]`, { timeout: 3000 }).catch(() => { if (verbose) console.log(`note: ${id} not clickable`); }); await settle(); };
      const has = async (id: string) => (await pg.$(`[data-testid="${id}"]`)) !== null;
      const attr = async (sel: string, a: string) => pg.$eval(sel, (e: Element, n: string) => e.getAttribute(n), a).catch(() => null);
      const tap = async (x: number, y: number) => {
        const box: Box = oracleContent(await pg.$eval('[data-testid="palm-tracing-stage"]', (e: Element) => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }), L.W, L.H);
        const p = { x: box.left + x * box.width, y: box.top + y * box.height };
        if (L.touch) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
        else await pg.mouse.click(p.x, p.y);
        await settle();
      };
      const blockers = async (): Promise<string[]> => pg.$$eval('[data-testid="palm-review-blockers"] li', (els: Element[]) => els.map((e) => e.textContent ?? ''));
      const confirmDisabled = async () => pg.$eval('[data-testid="palm-review-confirm"]', (e: Element) => (e as HTMLButtonElement).disabled).catch(() => null);

      // missing decisions block (silent-missing control)
      await click('palm-review-open');
      check(`J1 ${T} with no lines decided the review lists them and confirmation is disabled (nothing confirmed silently)`, (await confirmDisabled()) === true && (await blockers()).filter((b) => /not traced yet/.test(b)).length === 3);
      await click('palm-review-hand-left'); await click('palm-review-dominant-right');
      await pg.$eval('[data-testid="palm-review-confirm"]', (e: Element) => (e as HTMLButtonElement).click()).catch(() => {});
      await settle();
      check(`J2 ${T} a forced Confirm with untraced primary lines confirms nothing`, !(await has('palm-review-confirmed')));
      // trace + decide
      await click('palm-review-edit-heart');
      for (const [x, y] of [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]]) await tap(x, y);
      await click('palm-tracing-confirm');
      await click('palm-tracing-next'); await click('palm-tracing-skip');
      await click('palm-tracing-next'); await click('palm-tracing-cannot-see');
      await click('palm-review-open');
      const uncertain = await has('palm-review-ack');
      const before = { m: await attr('[data-testid="palm-review-measurement-status"]', 'data-status'), q: await attr('[data-testid="palm-review-quality"]', 'data-quality') };
      const reported = before.m !== 'measured' || before.q !== 'accepted';
      check(`J3 ${T} an acknowledgement is required exactly when I1 reports uncertainty (measurements ${before.m}, photo ${before.q})${quality.length ? '; a photo quality issue always does' : ''}`, uncertain === reported && (quality.length ? uncertain : true) && (await confirmDisabled()) === uncertain, before);
      if (uncertain) await click('palm-review-ack');
      if (shots) await pg.screenshot({ path: path.join(shots, `p4i3-review-${L.vw}x${L.vh}${quality.length ? '-uncertain' : ''}.png`), fullPage: true });
      await click('palm-review-confirm');
      check(`J4 ${T} confirming records the decided features (heart confirmed, head skipped, life cannot-see, upward not requested)`, (await attr('[data-testid="palm-review-confirmed"]', 'data-lines')) === 'heart:user-confirmed;head:unassessed/user-skipped;life:unassessed/user-cannot-see;upward:unassessed/not-requested');
      const mstat = await attr('[data-testid="palm-review-measurement-status"]', 'data-status');
      check(`J5 ${T} confirmation never upgrades uncertainty: the measurement status is unchanged (${before.m} -> ${mstat})${quality.length ? ' and not measured' : ''}`, mstat === before.m && (quality.length ? mstat !== 'measured' : true), mstat);
      if (shots) await pg.screenshot({ path: path.join(shots, `p4i3-confirmed-${L.vw}x${L.vh}${quality.length ? '-uncertain' : ''}.png`), fullPage: true });
      // stale confirmation (stale-confirmation control)
      await click('palm-review-edit-head');
      await click('palm-tracing-retrace');
      check(`J6 ${T} reopening a decided line after confirming withdraws the confirmation`, !(await has('palm-review-confirmed-banner')));
      await click('palm-tracing-skip');
      await click('palm-review-open');
      check(`J7 ${T} after the change the review needs a fresh confirmation`, !(await has('palm-review-confirmed')) && (await has('palm-review-confirm')));
      if (await has('palm-review-ack')) await click('palm-review-ack');
      await click('palm-review-confirm');
      await click('palm-review-dominant-left');
      check(`J8 ${T} changing a hand answer after confirming withdraws the confirmation`, !(await has('palm-review-confirmed')));
      // context replacement and revocation during review
      await pg.evaluate(() => (window as any).__palmHarness.replace(0.02));
      await settle();
      check(`J9 ${T} replacing the photo during the review returns to a fresh tracing (no review, nothing confirmed)`, !(await has('palm-review')) && (await has('palm-tracing-stage')) && (await attr('[data-testid="palm-tracing-step-heart"]', 'data-status')) === 'not-started');
      await click('palm-review-open');
      await pg.evaluate(() => (window as any).__palmHarness.revoke());
      await pg.waitForTimeout(600);
      check(`J10 ${T} revoking the photo during the review clears it without interaction`, !(await has('palm-review')) && (await attr('[data-testid="palm-tracing"]', 'data-state')) === 'cleared');
      const priv = await pg.evaluate(() => (window as any).__privacy);
      check(`J11 ${T} no network, storage, cookie, image encoding or console use; no page errors`, requests.length === 0 && priv.length === 0 && errors.length === 0, { requests, priv, errors });
      await ctx.close();
    }
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
    const r = await journey(browser, 'none', true, SHOTS);
    console.log(`\nPALM-04-I3 review browser: ${r.passed} passed, ${r.failed.length} failed`);
    if (r.failed.length) ok = false;
    for (const [m, expect] of [['stale-confirmation', /^J(6|7|8) /], ['silent-missing', /^J(1|2) /]] as Array<[Mutation, RegExp]>) {
      const n = await journey(browser, m, false, null);
      const hit = n.failed.filter((x) => expect.test(x)).length;
      console.log(`${hit ? 'OK  ' : 'FAIL'} negative control ${m}: ${hit} expected checks fail (${n.failed.length} in all), ${n.passed} pass`);
      if (!hit) ok = false;
    }
  } finally { await browser.close(); }
  if (!ok) process.exit(1);
}
main().catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
