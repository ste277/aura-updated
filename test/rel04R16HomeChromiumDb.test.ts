/**
 * AURA-ANDROID-REL-04 R16 (ticket 39259; verification 39258 NO-GO: G4-G6) -- closure on the ACTUAL product: the
 * production-built app, real Chromium, the real habit-logs route and a disposable, fully migrated PostgreSQL, with
 * deterministic fault injection (request interception, IndexedDB seeding).
 *
 *   G5  Home "Start now" answered by a JSON 429 that never reaches the writer: unresolved, copy + id kept, no
 *       rejection; the explicit Retry and the replay reach the writer under the ORIGINAL id -> one row
 *   G6  Calendar / Past Activity: the route commits, the acknowledgement is an HTML 200; leave the Activity Log and
 *       return (remount + navigation) and restart (reload): the identical re-entry is withheld with THAT operation's
 *       recovery; "Retry that entry" keeps one row under the original id; "Save as a separate activity" still creates
 *       a deliberately separate row
 *   G4  a v2 receipt with matching ids but a contradictory row, beside the live copy: never "Logged"; nothing is sent
 *       automatically; Retry sends the original id once -> one row; the receipt is replaced by a valid one
 *
 * Requires DATABASE_URL. Builds apps/web unless REL04_SKIP_BUILD=1 and a build exists. Synthetic accounts; 127.0.0.1.
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const WEB = path.join(__dirname, '..', 'apps', 'web');
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.log('FAIL DATABASE_URL is required (a disposable database with migrations applied)'); process.exit(1); }
const AUTH_SECRET = 'rel04-r15-operation-contract-secret-not-for-production-0123456789'; // same synthetic secret as the R15 suite (one shared build)
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
                const before = IDBObjectStore.prototype.get;
                IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...a: any[]) {
                  if (this.name === 'tombstones' && this.transaction.mode === 'readonly') { IDBObjectStore.prototype.get = before; w.decisionReadFailed = true; throw new Error('synthetic one-shot decision read failure'); }
                  return (before as any).apply(this, a);
                };
              }
              reject?.call(tx, new Event('error'));
            };
          });
        }
        return tx;
      };
    }, failDecisionReadOnce);

    const youNav = (p: any) => p.locator('nav').getByText('You', { exact: true }).last();
    async function openCalendarModal(p: any) {
      await youNav(p).click();
      await p.getByRole('button', { name: /Activity log/i }).first().click();
      await p.getByRole('button', { name: '+ Log Activity', exact: true }).click();
    }
    async function saveEntry(p: any, title: string) {
      await p.locator('#quick-log-activity').fill(title);
      await p.locator('input[type="time"]').fill('10:00');
      await p.getByRole('button', { name: /^Save "/ }).click();
    }

    // ============================================================ G5: JSON 429 on the real Home flow
    {
      const S = await session('r16-429');
      const a = await S.ctx.newPage(); S.watch(a, 'a');
      await openHome(a);
      await a.route('**/api/habit-logs', (r: any) => (r.request().method() === 'POST' ? r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary rate limit' }) }) : r.continue()));
      await logOnce(a);
      await a.getByText(UNVERIFIED, { exact: false }).first().waitFor({ timeout: 10000 });
      const mid = await inspect(a);
      const original = mid.records[0]?.clientRequestId;
      // the replay path gets the same 429: still kept
      await a.clock.setFixedTime(new Date(FIXED + 61_000));
      await a.evaluate(() => window.dispatchEvent(new Event('online')));
      await a.waitForTimeout(800);
      const afterReplay = await inspect(a);
      await a.unroute('**/api/habit-logs');
      await a.getByRole('button', { name: /^Retry/ }).first().click();
      await a.getByText(/Logged at/, { exact: false }).first().waitFor({ timeout: 10000 });
      const rows = await S.rows(), final = await inspect(a);
      console.log('R16-G5', JSON.stringify({ original, posts: S.posts.a.map((p) => p.body.clientRequestId), rows, mid: { records: mid.records.length, tomb: mid.tombstones.map((d: any) => d.receipt?.kind ?? d.decision) }, afterReplay: afterReplay.records.length }));
      check('G5 real Home: a JSON 429 that never reached the writer is shown UNRESOLVED; the copy is KEPT under the original id; no rejection is recorded (direct path)', Boolean(original) && mid.records.length === 1 && mid.tombstones.length === 0 && (await S.rows()).length >= 0);
      check('G5 real Home: the replay path answered by the same 429 keeps the copy too (no rejection, no deletion)', afterReplay.records.length === 1 && afterReplay.tombstones.length === 0 && S.posts.a.length >= 2);
      check(`G5 real Home: the explicit Retry reaches the writer with the ORIGINAL id and body (${S.posts.a.length} POSTs, 1 id) -> exactly 1 row; its validated v2 receipt names the row`, new Set(S.posts.a.map((p) => p.body.clientRequestId)).size === 1 && new Set(S.posts.a.map((p) => JSON.stringify(p.body))).size === 1 && rows.length === 1 && rows[0].clientRequestId === original && final.tombstones.some((d: any) => d.receipt?.v === 2 && d.receipt.serverRecordId === rows[0].id) && final.records.length === 0);
      await S.ctx.close();
    }

    // ============================================================ G6: Calendar remount / navigation / restart
    for (const mode of ['remount', 'separate', 'restart'] as const) {
      const S = await session(`r16-calendar-${mode}`);
      const a = await S.ctx.newPage(); S.watch(a, 'a');
      const title = 'Review same operation';
      let html: 'first' | 'all' | 'off' = mode === 'restart' ? 'all' : 'first';
      await a.route('**/api/habit-logs', async (r: any) => {
        if (r.request().method() !== 'POST' || html === 'off') return r.continue();
        if (html === 'first') html = 'off';
        const reply = await r.fetch(); // the real route commits
        if (reply.status() !== 200) throw new Error('route did not commit: ' + reply.status());
        return r.fulfill({ status: 200, contentType: 'text/html', body: '<html>Unverified acknowledgement</html>' });
      });
      await openHome(a);
      await openCalendarModal(a);
      await saveEntry(a, title);
      await a.getByText(UNVERIFIED, { exact: false }).first().waitFor({ timeout: 12000 });
      const original = S.posts.a[0]?.body.clientRequestId;
      const first = { rows: (await S.rows()).length, copies: (await inspect(a)).records.length };
      await a.getByRole('button', { name: 'Cancel', exact: true }).click();
      await a.getByRole('button', { name: 'Back to You', exact: true }).click();
      if (mode === 'restart') { await a.reload(); await a.waitForTimeout(1500); await youNav(a).click(); }
      await a.getByRole('button', { name: /Activity log/i }).first().click();
      await a.getByRole('button', { name: '+ Log Activity', exact: true }).click();
      const noticeOnReturn = (await a.getByText(UNVERIFIED, { exact: false }).count()) > 0;
      const p0 = S.posts.a.length;
      await saveEntry(a, title); // the identical re-entry
      await a.waitForTimeout(800);
      const blocked = S.posts.a.length === p0 && (await a.getByRole('button', { name: 'Retry that entry' }).count()) > 0;
      const afterReentry = await S.rows();
      html = 'off';
      if (mode === 'separate') await a.getByRole('button', { name: 'Save as a separate activity' }).click();
      else await a.getByRole('button', { name: 'Retry that entry' }).click();
      await a.waitForTimeout(1200);
      const rows = await S.rows(), final = await inspect(a);
      const ids = [...new Set(rows.map((r: any) => r.clientRequestId))];
      console.log(`R16-G6-${mode}`, JSON.stringify({ original, noticeOnReturn, blocked, first, posts: S.posts.a.map((p) => p.body.clientRequestId), rows, receipts: final.tombstones.map((d: any) => [d.clientRequestId, d.receipt?.v, d.receipt?.kind]) }));
      check(`G6 ${mode}: the first save committed (1 row) but its acknowledgement was unverifiable -> UNRESOLVED, copy kept`, first.rows === 1 && first.copies === 1 && Boolean(original));
      check(`G6 ${mode}: after leaving and returning${mode === 'restart' ? ' + a full reload' : ''} the identical re-entry is WITHHELD (no POST) with THAT operation's recovery offered; still 1 row (notice on return: ${noticeOnReturn})`, blocked && afterReentry.length === 1 && (mode === 'restart' || noticeOnReturn));
      if (mode === 'separate') check('G6 separate: "Save as a separate activity" deliberately creates a second activity with identical intent -> 2 rows, 2 ids (the original kept)', rows.length === 2 && ids.length === 2 && ids.includes(original));
      else check(`G6 ${mode}: "Retry that entry" resumes the ORIGINAL id -> exactly 1 row, 1 id; every POST carried the original id (${S.posts.a.length})`, rows.length === 1 && ids.length === 1 && ids[0] === original && S.posts.a.every((p) => p.body.clientRequestId === original));
      await S.ctx.close();
    }

    // ============================================================ G4: contradictory v2 receipt beside the live copy
    {
      const S = await session('r16-receipt');
      const a = await S.ctx.newPage(); S.watch(a, 'a');
      await a.route('**/api/habit-logs', (r: any) => (r.request().method() === 'POST' ? r.abort('failed') : r.continue())); // first: offline
      await openHome(a);
      await logOnce(a);
      // R18 (39265, online-first): a failed send is shown as UNRESOLVED (no "saved offline, will sync" state)
      await a.getByText(/Couldn't verify whether this activity was saved|Not confirmed yet/, { exact: false }).first().waitFor({ timeout: 10000 });
      const seeded = await a.evaluate((account: string) => new Promise((resolve, reject) => {
        const req = indexedDB.open('aura-offline', 2);
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction(['records', 'tombstones'], 'readwrite');
          const g = t.objectStore('records').getAll();
          g.onsuccess = () => {
            const rec = g.result[0];
            const { tempId: _t, ownerUserId: _o, recordId: _r, queuedAt: _q, ...b } = rec.item;
            const pl = JSON.stringify(Object.keys(b).sort().reduce((o: any, k) => { if (b[k] !== undefined) o[k] = b[k]; return o; }, {}));
            const crid = rec.clientRequestId;
            t.objectStore('tombstones').put({ recordId: `d\u0000${account}\u0000${crid}`, ownerUserId: account, clientRequestId: crid, payload: pl, decision: 'settled', serverOutcome: 'accepted', fmt: 'r8', possiblySent: true, at: Date.now(),
              receipt: { v: 2, kind: 'accepted', owner: account, crid, payload: pl, serverRecordId: 'contradictory-row', at: Date.now(), row: { id: 'contradictory-row', userId: account, clientRequestId: crid, activityTitle: 'A different activity', activityId: null, logTimestamp: b.logTimestamp, durationMinutes: b.durationMinutes, notes: null, logSource: b.logSource, activitySignificance: b.activitySignificance } } });
            t.oncomplete = () => { db.close(); resolve(crid); };
          };
        };
        req.onerror = () => reject(req.error);
      }), S.user.id);
      await a.unroute('**/api/habit-logs');
      const p0 = S.posts.a.length;
      await a.reload(); await a.waitForTimeout(1800);
      const text = await a.locator('body').innerText();
      const afterReload = await inspect(a);
      const autoSent = S.posts.a.length - p0;
      const notLogged = !/Logged at/.test(text);
      const retry = a.locator('[data-operation-state="unresolved-list"] button', { hasText: 'Retry' }).first();
      const offered = (await retry.count()) > 0;
      if (offered) { await retry.click(); await a.waitForTimeout(1500); }
      const rows = await S.rows(), final = await inspect(a);
      console.log('R16-G4', JSON.stringify({ seeded, autoSent, offered, rows, final: final.tombstones.map((d: any) => [d.receipt?.v, d.receipt?.serverRecordId]) }));
      check('G4 real app: a v2 receipt whose row contradicts the intent (matching ids) beside the live copy -> never "Logged", shown unresolved with recovery; NOTHING sent automatically; the copy preserved', notLogged && offered && autoSent === 0 && afterReload.records.length === 1 && text.includes(UNVERIFIED));
      check('G4 real app: Retry sends the ORIGINAL id once -> exactly 1 row; the contradictory receipt is REPLACED by a valid v2 receipt naming that row', rows.length === 1 && rows[0].clientRequestId === seeded && final.tombstones.some((d: any) => d.receipt?.v === 2 && d.receipt.serverRecordId === rows[0].id) && final.records.length === 0);
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
