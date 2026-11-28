/**
 * AURA-ANDROID-REL-04 R15 (ticket 39257; architecture 39256) -- operation-contract acceptance on the ACTUAL product:
 * the production-built app (`next build` + `next start`), its real Home "Start now" flow, two real Chromium tabs of
 * one browser context (one origin: shared IndexedDB, cookies and BroadcastChannel), the real habit-logs route and a
 * disposable, fully migrated PostgreSQL. Ordering is controlled with request interception and in-page barriers; the
 * real route and database serve every successful write.
 *
 *   A   the ORIGINAL 39255 G3 ordering (pre-save empty GET held, enqueue acknowledgement lost after commit, the other
 *       tab replays + commits + settles, the first decision read fails, then the stale GET is released) plus a
 *       same-title UNRELATED row (G), then refresh, remount (tab switch) and restart (reload): bound to the original
 *       id, never released into a fresh-id duplicate -- exactly one row
 *   A'  the two original one-row control orderings (settled before / during the original tab's recovery)
 *   B   an HTML 200 that never reached the writer: unresolved (Check again stays unresolved -- absence is not
 *       evidence); the explicit Retry resends the ORIGINAL id and body -> one row
 *   E   the route commits but the response is cut: pending under the same id; replay converges on one row
 *   H   the operations store cannot be read at load: new logging is blocked (no id, no record, no POST)
 * Every case asserts the exact POST bodies, request ids and account headers, the PostgreSQL rows, the durable
 * decisions / receipts and physical copies, and the visible Home state.
 *
 * Requires DATABASE_URL (a disposable database with the migrations applied). Builds apps/web unless
 * REL04_SKIP_BUILD=1 and a build exists. Synthetic accounts only; 127.0.0.1 only.
 *   DATABASE_URL=postgresql://… npx ts-node test/rel04ActivityOperationHomeChromiumDb.test.ts
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const WEB = path.join(__dirname, '..', 'apps', 'web');
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.log('FAIL DATABASE_URL is required (a disposable database with migrations applied)'); process.exit(1); }
const AUTH_SECRET = 'rel04-r15-operation-contract-secret-not-for-production-0123456789';
const env = { ...process.env, DATABASE_URL, AUTH_SECRET, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
process.env.AUTH_SECRET = AUTH_SECRET;
const auth = require(path.join(WEB, 'lib', 'auth'));
let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }
const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const barrier = () => { let open!: () => void; const seen = new Promise<void>((r) => { open = r; }); return { open, seen }; };
const within = <T>(p: Promise<T>, ms: number, what: string) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms))]);

const FIXED = Date.parse('2026-11-27T06:35:00.000Z'); // a favourable Chennai window with a "Start now" card
const UNVERIFIED = "Couldn't verify whether this activity was saved.";

async function main() {
  if (!(process.env.REL04_SKIP_BUILD === '1' && fs.existsSync(path.join(WEB, '.next', 'BUILD_ID')))) {
    console.log('building apps/web (next build)…');
    const b = spawnSync('npm', ['run', 'build'], { cwd: WEB, env, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (b.status !== 0) { console.log((b.stdout ?? '') + (b.stderr ?? '')); console.log('FAIL next build'); process.exit(1); }
  }
  const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [WEB] }));
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  const pg = new (require(require.resolve('pg', { paths: [WEB] })).Pool)({ connectionString: DATABASE_URL });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let server: ChildProcess | null = null;
  let browser: any = null;
  const users: string[] = [];
  try {
    server = spawn('npx', ['next', 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: WEB, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) { await new Promise((r) => setTimeout(r, 150)); try { ready = (await fetch(`${origin}/api/health`)).status < 500; } catch { /* not yet */ } }
    check('S0 the production build serves (next start)', ready);
    if (!ready) return;
    const { chromium } = require('@playwright/test');
    browser = await chromium.launch();
    console.log('versions', JSON.stringify({ chromium: browser.version(), node: process.version }));

    async function session(tag: string) {
      const email = `r15-${tag}-${Date.now()}@example.invalid`;
      const user = await prisma.user.create({ data: { email, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata', onboardingResolvedAt: new Date() } });
      users.push(user.id);
      const ctx = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
      await ctx.addCookies([{ name: 'as_session', value: auth.createSessionToken(user.id, email), url: origin }]);
      const rows = async () => (await pg.query('select id, "userId", "clientRequestId", "activityTitle", "logTimestamp", "durationMinutes", "logSource" from "HabitLog" where "userId" = $1 order by "logTimestamp", id', [user.id])).rows;
      const posts: Record<string, any[]> = { a: [], b: [] };
      const watch = (p: any, k: 'a' | 'b') => {
        p.on('request', (r: any) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/habit-logs') posts[k].push({ account: r.headers()['x-aura-expected-account'], body: r.postDataJSON() }); });
        p.on('pageerror', (e: Error) => console.log(`[${tag}:${k}] page error`, e.message));
      };
      return { user, ctx, rows, posts, watch };
    }
    const inspect = (p: any) => p.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('aura-offline', 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction(['records', 'claims', 'tombstones'], 'readonly');
        const pairs = ['records', 'claims', 'tombstones'].map((n) => [n, t.objectStore(n).getAll()] as const);
        t.oncomplete = () => { const data = Object.fromEntries(pairs.map(([n, r]) => [n, r.result])); db.close(); resolve(data); };
      };
    })) as Promise<{ records: any[]; claims: any[]; tombstones: any[] }>;
    const startButton = (p: any) => p.locator('button').filter({ hasText: /^Start now$/ }).first();
    async function openHome(p: any) {
      await p.clock.setFixedTime(new Date(FIXED));
      await p.goto(origin);
      await startButton(p).waitFor({ timeout: 20000 });
    }
    async function logOnce(p: any) {
      await startButton(p).click();
      await p.getByRole('button', { name: 'Start now for 30 minutes', exact: true }).first().click();
    }
    /** The next read-write transaction on the queue stores COMMITS; its acknowledgement is withheld until releaseAck(). */
    const withholdAck = (p: any, failDecisionReadOnce: boolean) => p.evaluate((fail: boolean) => {
      const w = window as any;
      const orig = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: any[]) {
        const tx = (orig as any).apply(this, args) as IDBTransaction;
        if (tx.mode === 'readwrite' && tx.objectStoreNames.contains('records')) {
          IDBDatabase.prototype.transaction = orig;
          tx.addEventListener('complete', () => {
            const reject = tx.onerror;
            tx.oncomplete = null;
            w.releaseAck = () => {
              if (fail) {
                // R18: the decision reads markers through get() or getAll() (one account-wide discovery): the one-shot
                // failure applies to the first read-only marker read either way.
                const before = IDBObjectStore.prototype.get, beforeAll = IDBObjectStore.prototype.getAll;
                const restore = () => { IDBObjectStore.prototype.get = before; IDBObjectStore.prototype.getAll = beforeAll; };
                IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...a: any[]) {
                  if (this.name === 'tombstones' && this.transaction.mode === 'readonly') { restore(); w.decisionReadFailed = true; throw new Error('synthetic one-shot decision read failure'); }
                  return (before as any).apply(this, a);
                };
                IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...a: any[]) {
                  if (this.name === 'tombstones' && this.transaction.mode === 'readonly') { restore(); w.decisionReadFailed = true; throw new Error('synthetic one-shot decision read failure'); }
                  return (beforeAll as any).apply(this, a);
                };
              }
              reject?.call(tx, new Event('error'));
            };
          });
        }
        return tx;
      };
    }, failDecisionReadOnce);

    // ============================================================ A / A': the original G3 ordering and its controls
    for (const mode of ['g3-original', 'settled-before', 'settled-during'] as const) {
      const S = await session(mode);
      const a = await S.ctx.newPage(), b = await S.ctx.newPage();
      S.watch(a, 'a'); S.watch(b, 'b');
      const staleStarted = barrier(), staleRelease = barrier();
      if (mode === 'g3-original') {
        // G: an UNRELATED earlier row with the same title (yesterday), present in every list the tab reads.
        await a.clock.setFixedTime(new Date(FIXED));
        await a.route('**/api/habit-logs', async (r: any) => {
          if (r.request().method() !== 'GET') return r.continue();
          const response = await r.fetch();
          const payload = await response.json();
          if (!Array.isArray(payload) || payload.some((x: any) => x.clientRequestId && !String(x.clientRequestId).startsWith('seed-'))) return r.fulfill({ response });
          staleStarted.open();
          await staleRelease.seen; // the genuine PRE-SAVE list, released only after the save
          await r.fulfill({ response });
        });
      }
      await openHome(a);
      if (mode === 'g3-original') await staleStarted.seen;
      await withholdAck(a, mode === 'g3-original');
      await logOnce(a);
      await a.waitForFunction(() => typeof (window as any).releaseAck === 'function');
      const initial = await inspect(a);
      const original = initial.records[0]?.clientRequestId;
      const title = initial.records[0]?.item?.activityTitle;
      if (mode === 'g3-original') {
        await pg.query(`insert into "HabitLog" (id, "userId", "activityTitle", "activeWindow", "logMinuteOfDay", "logTimestamp", "durationMinutes", "logSource", "activitySignificance", "clientRequestId") values ($1, $2, $3, 'NEUTRAL', 600, $4, 30, 'AURA_DO_NOW', 'MEDIUM', $5)`, [`seed-${Date.now()}`, S.user.id, title, new Date(FIXED - 86_400_000), `seed-${Date.now()}`]);
      }
      const finishResponse = barrier(), serverAccepted = barrier();
      if (mode === 'settled-during') {
        await b.route('**/api/habit-logs', async (r: any) => {
          if (r.request().method() !== 'POST') return r.continue();
          const response = await r.fetch();
          serverAccepted.open();
          await finishResponse.seen;
          await r.fulfill({ response });
        });
      }
      // The other tab, past the claim lifetime, re-sends and settles the committed request. R18 (39265, online-first):
      // nothing is sent automatically any more, so this is that tab's user pressing Retry on the shared notice.
      await b.goto(origin);
      await b.getByText('Good Right Now', { exact: false }).first().waitFor({ timeout: 15000 });
      await b.waitForTimeout(350);
      await b.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 61_000; });
      await b.locator(`[data-operation-id="${original}"]`).getByRole('button', { name: 'Retry', exact: true }).click();
      if (mode === 'settled-during') await within(serverAccepted.seen, 10000, 'replay POST');
      else {
        let settled = false;
        for (let i = 0; i < 80 && !settled; i++) { settled = (await inspect(a)).tombstones.some((x: any) => x.clientRequestId === original && x.receipt?.kind === 'accepted'); if (!settled) await a.waitForTimeout(125); }
        check(`A ${mode}: the other tab's explicit Retry persisted a VALIDATED accepted receipt for the original request`, settled);
      }
      await a.evaluate(() => (window as any).releaseAck());
      if (mode === 'g3-original') {
        await a.waitForFunction(() => Boolean((window as any).decisionReadFailed));
        await a.waitForTimeout(400);
        const afterAck = (await a.locator('body').innerText());
        staleRelease.open();
        await a.waitForTimeout(900);
        const afterStale = await a.locator('body').innerText();
        // The card must never be released into a new operation: no "Start now" on the same card.
        const card = a.locator('div', { hasText: title }).filter({ has: a.locator('button', { hasText: /^Start now$/ }) });
        const freshOffered = (await card.count()) > 0 && afterStale.includes(title) && /Start now/.test(afterStale) && !/Logged at|Couldn't verify|Saved offline/.test(afterStale);
        // refresh (a reconciliation pass), remount (tab switch), then restart (reload)
        await a.evaluate(() => window.dispatchEvent(new Event('online')));
        await a.waitForTimeout(600);
        const nav = a.getByRole('button', { name: /^(Timeline|Plan)$/ }).first();
        if (await nav.count()) { await nav.click(); await a.waitForTimeout(300); const homeNav = a.getByRole('button', { name: /^Home$/ }).first(); if (await homeNav.count()) await homeNav.click(); await a.waitForTimeout(500); }
        const afterRemount = await a.locator('body').innerText();
        await a.reload(); await a.waitForTimeout(1500);
        const final = await inspect(a);
        const rows = await S.rows();
        const mine = rows.filter((r: any) => !String(r.clientRequestId).startsWith('seed-'));
        console.log('A-g3', JSON.stringify({ original, postsA: S.posts.a, postsB: S.posts.b, rows, decision: final.tombstones.map((d: any) => ({ crid: d.clientRequestId, decision: d.decision, receipt: d.receipt?.kind, serverRecordId: d.receipt?.serverRecordId })), copies: final.records.length }));
        check('A g3-original: the original tab reports the outcome as UNRESOLVED or confirmed (never "not saved", never a retry invitation) after the lost acknowledgement + failed decision read', !/Couldn.t log\. Try again/.test(afterAck) && (/Couldn't verify|Logged at|Saved offline/.test(afterAck)));
        check('A g3-original: the stale pre-save list (and the same-title unrelated row) never releases the operation: no fresh "Start now" on that card after it, after refresh and after remount', !freshOffered && !/Couldn.t log\. Try again/.test(afterRemount));
        check(`A g3-original: exactly ONE row for the operation, under the ORIGINAL request id (${mine.length} rows; ids ${mine.map((r: any) => r.clientRequestId.slice(0, 8)).join(',')}), plus the untouched unrelated row`, mine.length === 1 && mine[0].clientRequestId === original && rows.length === 2);
        check('A g3-original: zero POSTs from the original tab; one bound POST (the explicit Retry) from the other tab carrying the original id, the account header and the canonical body', S.posts.a.length === 0 && S.posts.b.length === 1 && S.posts.b[0].body.clientRequestId === original && S.posts.b[0].account === S.user.id && S.posts.b[0].body.activityTitle === title);
        check('A g3-original (after restart): the durable decision carries the validated receipt (server record id == the PostgreSQL row); no copy or claim remains', final.tombstones.some((d: any) => d.clientRequestId === original && d.receipt?.kind === 'accepted' && d.receipt.serverRecordId === mine[0]?.id) && final.records.length === 0);
      } else {
        if (mode === 'settled-during') {
          await a.getByText(/Saved offline|Couldn't verify/, { exact: false }).first().waitFor({ timeout: 10000 });
          finishResponse.open();
        }
        await a.waitForTimeout(900);
        const text = await a.locator('body').innerText();
        const rows = await S.rows();
        check(`A' ${mode} control: one row under the original id, one bound replay POST, zero original-tab POSTs, no error or retry invitation`, rows.length === 1 && rows[0].clientRequestId === original && S.posts.a.length === 0 && S.posts.b.length === 1 && !/Couldn.t log\. Try again/.test(text));
      }
      await S.ctx.close();
    }

    // ============================================================ B: HTML 200 that never reached the writer; explicit Retry
    {
      const S = await session('html200');
      const a = await S.ctx.newPage(); S.watch(a, 'a');
      await openHome(a);
      await a.route('**/api/habit-logs', (r: any) => (r.request().method() === 'POST' ? r.fulfill({ status: 200, contentType: 'text/html', body: '<html>Wi-Fi sign-in</html>' }) : r.continue()));
      await logOnce(a);
      await a.getByText(UNVERIFIED, { exact: false }).first().waitFor({ timeout: 10000 });
      const startHidden = (await a.locator('[data-operation-state="unresolved"]').count()) > 0 && !(await a.locator('[data-operation-state="unresolved"] button', { hasText: /^Start now$/ }).count());
      const mid = await inspect(a);
      const original = mid.records[0]?.clientRequestId;
      // Retry while the answer still proves nothing: the SAME id and body again, still unresolved.
      await a.getByRole('button', { name: /^Retry/ }).first().click();
      await a.waitForTimeout(700);
      const stillUnresolved = (await a.getByText(UNVERIFIED, { exact: false }).count()) > 0 && (await S.rows()).length === 0;
      await a.unroute('**/api/habit-logs');
      await a.getByRole('button', { name: /^Retry/ }).first().click();
      await a.getByText(/Logged at/, { exact: false }).first().waitFor({ timeout: 10000 });
      const rows = await S.rows();
      const final = await inspect(a);
      console.log('B-html200', JSON.stringify({ original, posts: S.posts.a.map((p) => p.body.clientRequestId), rows, receipts: final.tombstones.map((d: any) => [d.clientRequestId, d.receipt?.kind, d.receipt?.serverRecordId]) }));
      check('B real Home: an HTML 200 shows "Couldn\'t verify whether this activity was saved." (no false success); the copy is kept; no accepted receipt', startHidden && Boolean(original) && mid.records.length === 1 && !mid.tombstones.some((d: any) => d.receipt?.kind === 'accepted'));
      check('B a Retry answered by another HTML 200 stays UNRESOLVED (no row, no receipt)', stillUnresolved);
      check(`B explicit Retry resends the ORIGINAL id and body every time (${S.posts.a.length} POSTs, ${new Set(S.posts.a.map((p) => JSON.stringify(p.body))).size} distinct bodies); exactly 1 row; validated receipt == row`, S.posts.a.length === 3 && S.posts.a.every((p) => p.body.clientRequestId === original && p.account === S.user.id) && new Set(S.posts.a.map((p) => JSON.stringify(p.body))).size === 1 && rows.length === 1 && rows[0].clientRequestId === original && final.tombstones.some((d: any) => d.receipt?.serverRecordId === rows[0].id) && final.records.length === 0);
      await S.ctx.close();
    }

    // ============================================================ E: the route commits, the response is cut
    {
      const S = await session('cut');
      const a = await S.ctx.newPage(); S.watch(a, 'a');
      await openHome(a);
      let cut = true;
      await a.route('**/api/habit-logs', async (r: any) => {
        if (r.request().method() !== 'POST' || !cut) return r.continue();
        cut = false;
        await r.fetch(); // the real route commits
        await r.abort('failed'); // ... and the response never arrives
      });
      await logOnce(a);
      // R18 (39265, online-first): the cut answer leaves the operation UNRESOLVED (no automatic replay); the user's
      // explicit Retry on the shared notice converges under the same id.
      await a.getByText(/Couldn't verify whether this activity was saved|Not confirmed yet/, { exact: false }).first().waitFor({ timeout: 10000 });
      const committed = (await S.rows()).length;
      await a.clock.setFixedTime(new Date(FIXED + 61_000)); // past the claim lifetime
      await a.locator('[data-operation-state="unresolved-list"]').getByRole('button', { name: 'Retry', exact: true }).first().click();
      await a.getByText(/Logged at/, { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => undefined);
      for (let i = 0; i < 60 && (await inspect(a)).records.length; i++) await a.waitForTimeout(250);
      await a.waitForTimeout(500);
      const rows = await S.rows();
      const final = await inspect(a);
      check(`E real Home: the route committed (${committed} row) but the response was cut -> unresolved under the same id; the explicit Retry converges on the SAME row (1 row, 1 id; ${S.posts.a.length} POSTs with one id)`, committed === 1 && rows.length === 1 && new Set(S.posts.a.map((p) => p.body.clientRequestId)).size === 1 && S.posts.a.length === 2 && final.tombstones.some((d: any) => d.receipt?.serverRecordId === rows[0].id));
      await S.ctx.close();
    }

    // ============================================================ H: unreadable operations store blocks new logging
    {
      const S = await session('blocked');
      const a = await S.ctx.newPage(); S.watch(a, 'a');
      await a.addInitScript(() => {
        const orig = IDBObjectStore.prototype.getAll;
        IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...args: any[]) { if (this.name === 'tombstones' && !(window as any).storeHealthy) throw new Error('synthetic operations read failure'); return (orig as any).apply(this, args); };
      });
      await openHome(a);
      await a.getByText('New activity logging is paused on this device', { exact: false }).first().waitFor({ timeout: 10000 });
      await logOnce(a);
      await a.waitForTimeout(600);
      const blocked = (await a.getByText(UNVERIFIED, { exact: false }).count()) > 0;
      await a.evaluate(() => { (window as any).storeHealthy = true; });
      const records = (await inspect(a)).records.length;
      check(`H real Home: an unreadable operations store blocks NEW logging (shown unresolved; ${S.posts.a.length} POSTs, ${records} records, ${(await S.rows()).length} rows) -- no replacement id is generated`, blocked && S.posts.a.length === 0 && records === 0 && (await S.rows()).length === 0);
      await S.ctx.close();
    }
  } catch (e) {
    console.log('FAIL unexpected error', e instanceof Error ? e.stack : e);
    failed++;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server) server.kill('SIGTERM');
    if (users.length) { await pg.query('delete from "HabitLog" where "userId" = any($1)', [users]).catch(() => undefined); await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined); }
    await prisma.$disconnect(); await pg.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
