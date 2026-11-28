/**
 * AURA-ANDROID-REL-04 R18 (ticket 39265; decision 39264 Option B; verification 39262 G10/G11) -- the ONLINE-FIRST
 * initial release on the ACTUAL product: production build (next build / next start), real Chromium, the real
 * habit-logs route and a disposable, fully migrated PostgreSQL, with deterministic fault injection.
 *
 *   G10   a surviving copy whose nested request id was changed (contradictory identity): after a restart the
 *         identical Calendar Save is withheld; no Retry (the identity is untrusted); the copy is kept; 1 row
 *   G11   a valid receipt for the real row beside a second live copy with another body: Check again keeps the conflict
 *         (no confirmation), offers no Retry, writes nothing; reload shows the same; 1 row, both copies kept
 *   offline  a real offline browser context: the Calendar Save stores and sends nothing, with the online-first message
 *   automatic  a stored unresolved activity and an REL-05 legacy queue: reload, offline->online and visibility send
 *         ZERO activity requests; the legacy queue is left byte-identical
 *   recovery  an ambiguous submission (route committed, unreadable acknowledgement) survives a restart; the shared
 *         notice's Retry converges on ONE row under the original id; two tabs retrying together still give one row
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
const AUTH_SECRET = 'rel04-r15-operation-contract-secret-not-for-production-0123456789'; // the shared synthetic secret of the REL-04 browser suites (one build)
const env = { ...process.env, DATABASE_URL, AUTH_SECRET, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
process.env.AUTH_SECRET = AUTH_SECRET;
const auth = require(path.join(WEB, 'lib', 'auth'));
let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }
const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
const FIXED = Date.parse('2026-11-27T06:35:00.000Z'); // 12:05 IST: a favourable Chennai window with a "Start now" card
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
  let serverLog: string[] = [];
  let browser: any = null;
  const users: string[] = [];
  try {
    server = spawn('npx', ['next', 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: WEB, env, stdio: ['ignore', 'pipe', 'pipe'] });
    // drain the server's output: an unread pipe fills (~64 KB) and then blocks the server's writes -- and its requests
    serverLog = [];
    for (const st of [server.stdout, server.stderr]) st?.on('data', (c: Buffer) => { serverLog.push(c.toString()); if (serverLog.length > 400) serverLog.shift(); });
    let ready = false;
    for (let i = 0; i < 200 && !ready; i++) { await new Promise((r) => setTimeout(r, 150)); try { ready = (await fetch(`${origin}/api/health`)).status < 500; } catch { /* not yet */ } }
    check('S0 the production build serves (next start)', ready);
    if (!ready) return;
    const { chromium } = require('@playwright/test');
    browser = await chromium.launch();
    console.log('versions', JSON.stringify({ chromium: browser.version(), node: process.version }));

    async function session(tag: string) {
      const email = `r18-${tag}-${Date.now()}@example.invalid`;
      const user = await prisma.user.create({ data: { email, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata', onboardingResolvedAt: new Date() } });
      users.push(user.id);
      const ctx = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Asia/Kolkata' });
      await ctx.addCookies([{ name: 'as_session', value: auth.createSessionToken(user.id, email), url: origin }]);
      const rows = async () => (await pg.query('select id, "clientRequestId", "activityTitle", "logTimestamp", "durationMinutes", "logSource" from "HabitLog" where "userId" = $1 order by "logTimestamp", id', [user.id])).rows;
      const posts: any[] = [];
      const watch = (p: any) => {
        p.on('request', (r: any) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/habit-logs') posts.push({ account: r.headers()['x-aura-expected-account'], body: r.postDataJSON() }); });
        p.on('pageerror', (e: Error) => console.log(`[${tag}] page error`, e.message));
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
        // read through the requests' own results (a held completion never blocks this inspection)
        Promise.all(pairs.map(([, r]) => new Promise((ok) => { r.onsuccess = () => ok(r.result); }))).then(() => { const data = Object.fromEntries(pairs.map(([n, r]) => [n, r.result])); db.close(); resolve(data); });
      };
    })) as Promise<{ records: any[]; claims: any[]; tombstones: any[] }>;
    const putMarker = (p: any, m: Record<string, unknown>) => p.evaluate((marker: any) => new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('aura-offline', 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('tombstones', 'readwrite');
        tx.objectStore('tombstones').put(marker);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }), m);
    const key = (owner: string, crid: string) => ['d', owner, crid].join(String.fromCharCode(0));
    const canonical = (b: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.keys(b).sort().filter((k) => b[k] !== undefined).map((k) => [k, b[k]])));
    const startButton = (p: any) => p.locator('button').filter({ hasText: /^Start now$/ }).first();
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
    const putRecord = (p: any, r: Record<string, unknown>) => p.evaluate((rec: any) => new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('aura-offline', 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(rec); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    }), r);
    const state = async (p: any) => JSON.stringify(await inspect(p));
    /** The real route commits; the acknowledgement for the FIRST request id is unreadable while `unreadable.on`. */
    const ambiguous = (unreadable: { on: boolean; id: string }) => async (r: any) => {
      if (r.request().method() !== 'POST') return r.continue();
      const b = r.request().postDataJSON();
      const reply = await r.fetch();
      if (!unreadable.id) unreadable.id = b.clientRequestId;
      if (unreadable.on && b.clientRequestId === unreadable.id) return r.fulfill({ status: 200, contentType: 'text/html', body: '<html>Unreadable acknowledgement</html>' });
      return r.fulfill({ response: reply });
    };
    async function committedUnverified(S: any, title: string) {
      const u = { on: true, id: '' };
      const a = await S.ctx.newPage(); S.watch(a);
      await a.route('**/api/habit-logs', ambiguous(u));
      await a.clock.setFixedTime(new Date(FIXED));
      await a.goto(origin);
      await youNav(a).waitFor({ timeout: 15000 });
      await openCalendarModal(a);
      await saveEntry(a, title);
      await a.getByText(UNVERIFIED, { exact: false }).first().waitFor({ timeout: 10000 });
      const st = await inspect(a);
      if (st.records.length !== 1 || (await S.rows()).length !== 1 || !u.id) throw new Error('committed-unverified preconditions');
      return { a, u, record: st.records[0], original: u.id };
    }
    async function restart(S: any, u?: { on: boolean; id: string }) {
      const b = await S.ctx.newPage(); S.watch(b);
      if (u) await b.route('**/api/habit-logs', ambiguous(u));
      await b.clock.setFixedTime(new Date(FIXED));
      await b.goto(origin);
      await youNav(b).waitFor({ timeout: 15000 });
      await b.waitForTimeout(1500);
      return b;
    }
    const title = 'Review exact original';

    // ================================================================ G10
    {
      const S = await session('g10');
      const { a, u, record, original } = await committedUnverified(S, title);
      await putRecord(a, { ...record, item: { ...record.item, clientRequestId: original + '-replaced-nested-id' } });
      await a.close();
      const b = await restart(S, u);
      const p0 = S.posts.length;
      await openCalendarModal(b);
      await saveEntry(b, title);
      await b.waitForTimeout(1500);
      const rows = await S.rows(), st = await inspect(b);
      const retry = await b.getByRole('button', { name: 'Retry that entry' }).count();
      const separate = await b.getByRole('button', { name: 'Save as a separate activity' }).count();
      console.log('R18-G10 ' + JSON.stringify({ original, sent: S.posts.slice(p0).map((x: any) => x.body.clientRequestId), rows, retry, separate, records: st.records.map((r: any) => ({ outer: r.clientRequestId, nested: r.item.clientRequestId })) }));
      check('G10 contradictory copy after restart: the identical Calendar Save sends NOTHING (1 row, original id); no Retry is offered; a separate entry is; the copy is kept', S.posts.length === p0 && rows.length === 1 && rows[0].clientRequestId === original && retry === 0 && separate > 0 && st.records.length === 1);
      await S.ctx.close();
    }

    // ================================================================ G11
    {
      const S = await session('g11');
      const { a, u, record, original } = await committedUnverified(S, title);
      const row = (await pg.query('select * from "HabitLog" where "clientRequestId" = $1', [original])).rows[0];
      const pl = canonical(Object.fromEntries(Object.entries(record.item).filter(([k]) => !['tempId', 'ownerUserId', 'recordId', 'queuedAt'].includes(k))));
      const fullRow = { id: row.id, userId: row.userId, clientRequestId: row.clientRequestId, activityTitle: row.activityTitle, activityId: row.activityId, activeWindow: row.activeWindow, logMinuteOfDay: row.logMinuteOfDay, logTimestamp: new Date(row.logTimestamp).toISOString(), durationMinutes: row.durationMinutes, notes: row.notes, logSource: row.logSource, activitySignificance: row.activitySignificance };
      await putMarker(a, { recordId: key(S.user.id, original), ownerUserId: S.user.id, clientRequestId: original, payload: pl, decision: 'settled', fmt: 'r8', at: Date.now(), serverOutcome: 'accepted', possiblySent: true, receipt: { v: 2, kind: 'accepted', owner: S.user.id, crid: original, payload: pl, serverRecordId: row.id, row: fullRow, at: Date.now() } });
      await putRecord(a, { recordId: 'second-copy', ownerUserId: S.user.id, clientRequestId: original, item: { ...record.item, activityTitle: 'A different second copy', recordId: 'second-copy' }, queuedAt: Date.now(), fmt: 'r8' });
      await a.close();
      u.on = false;
      const b = await restart(S, u);
      const item = b.locator(`[data-operation-id="${original}"]`);
      await item.waitFor({ timeout: 12000 });
      const before = await state(b);
      const p0 = S.posts.length;
      await item.getByRole('button', { name: 'Check again', exact: true }).click();
      await b.waitForTimeout(1500);
      const afterText = (await item.innerText().catch(() => '')).replace(/\s+/g, ' ');
      const retryAfter = await item.getByRole('button', { name: 'Retry', exact: true }).count().catch(() => 0);
      const unchanged = before === (await state(b));
      await b.reload(); await youNav(b).waitFor({ timeout: 15000 }); await b.waitForTimeout(1200);
      const reloadText = (await b.locator(`[data-operation-id="${original}"]`).innerText().catch(() => '')).replace(/\s+/g, ' ');
      const rows = await S.rows(), st = await inspect(b);
      console.log('R18-G11 ' + JSON.stringify({ original, afterText, retryAfter, unchanged, reloadText, sent: S.posts.length - p0, rows: rows.length, records: st.records.length }));
      check('G11 valid receipt beside a conflicting copy: after Check again the conflict is still shown with no Retry; storage unchanged; nothing sent; the same after reload; 1 row, both copies kept', afterText.includes('conflicting copies') && retryAfter === 0 && unchanged && S.posts.length === p0 && reloadText.includes('conflicting copies') && rows.length === 1 && st.records.length === 2);
      await S.ctx.close();
    }

    // ================================================================ zero automatic POSTs + REL-05 legacy queue; restart recovery
    {
      const S = await session('automatic');
      const { a, u, original } = await committedUnverified(S, title);
      const legacy = JSON.stringify([{ activityTitle: 'REL-05 legacy entry', activeWindow: 'NEUTRAL', logTimestamp: '2026-11-20T06:00:00.000Z', durationMinutes: 30, tempId: 'legacy-1', clientRequestId: 'legacy-crid-1' }]);
      await a.evaluate((v: string) => localStorage.setItem('offline_habit_queue', v), legacy);
      await a.close();
      const p0 = S.posts.length;
      const b = await restart(S, u);
      // connectivity loss and restoration as the page sees them (the real offline context is exercised in the case
      // above; toggling it here would also stall Playwright's own route.fetch for the later Retry)
      await b.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); }); await b.waitForTimeout(1200);
      await b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await b.reload(); await youNav(b).waitFor({ timeout: 15000 }); await b.waitForTimeout(1500);
      const automatic = S.posts.length - p0;
      const legacyKept = (await b.evaluate(() => localStorage.getItem('offline_habit_queue'))) === legacy;
      const item = b.locator(`[data-operation-id="${original}"]`);
      const shown = await item.count();
      u.on = false;
      await b.unroute('**/api/habit-logs'); // the recovery step needs no fault: the request goes straight to the route
      const beforeRetry = await inspect(b);
      const p1 = S.posts.length;
      await item.getByRole('button', { name: 'Retry', exact: true }).click();
      for (let i = 0; i < 80 && (await inspect(b)).records.length; i++) await b.waitForTimeout(250); // converged: no copy left
      const rows = await S.rows(), st = await inspect(b);
      const sent = S.posts.slice(p1).map((x: any) => x.body);
      const receipt = st.tombstones.find((t: any) => t.clientRequestId === original)?.receipt;
      console.log('R18-automatic ' + JSON.stringify({ automatic, legacyKept, shown, sent, rows, copies: st.records.length, receipt: receipt && { v: receipt.v, kind: receipt.kind, row: receipt.serverRecordId } }));
      if (st.records.length) console.log('R18-automatic-diagnostics ' + JSON.stringify({ claimsBefore: beforeRetry.claims, claimsAfter: st.claims, tombstones: st.tombstones, notice: (await item.innerText().catch(() => '')).slice(0, 300), serverTail: serverLog.join('').slice(-1500) }));
      check(`zero automatic activity POSTs: restart, offline->online, visibility and reload with an unresolved activity and an REL-05 legacy queue sent ${automatic} requests; the legacy queue is byte-identical`, automatic === 0 && legacyKept && !S.posts.some((x: any) => x.body.activityTitle === 'REL-05 legacy entry'));
      check('ambiguous submission across restart: the shared notice shows it; Retry sends the ORIGINAL id and body; 1 PostgreSQL row; a valid v2 receipt names it; no copy left', shown === 1 && sent.length >= 1 && sent.every((x: any) => x.clientRequestId === original && x.activityTitle === title) && rows.length === 1 && rows[0].clientRequestId === original && st.records.length === 0 && receipt?.v === 2 && receipt?.kind === 'accepted' && receipt?.serverRecordId === rows[0].id);
      await S.ctx.close();
    }

    // ================================================================ two tabs, explicit Retry together
    {
      const S = await session('two-tabs');
      const { a, u, original } = await committedUnverified(S, title);
      await a.close();
      u.on = false;
      const t1 = await restart(S, u), t2 = await restart(S, u);
      const r1 = t1.locator(`[data-operation-id="${original}"]`).getByRole('button', { name: 'Retry', exact: true });
      const r2 = t2.locator(`[data-operation-id="${original}"]`).getByRole('button', { name: 'Retry', exact: true });
      await Promise.all([r1.click(), r2.click()]);
      await t1.waitForTimeout(2500);
      const rows = await S.rows(), st = await inspect(t1);
      console.log('R18-two-tabs ' + JSON.stringify({ posts: S.posts.map((x: any) => x.body.clientRequestId), rows, copies: st.records.length }));
      check('two tabs press Retry together: every request carries the original id; exactly 1 PostgreSQL row; no copy left', S.posts.every((x: any) => x.body.clientRequestId === original) && rows.length === 1 && st.records.length === 0);
      await S.ctx.close();
    }
    // ================================================================ offline before dispatch (last: a real offline context)
    {
      const S = await session('offline');
      const p = await S.ctx.newPage(); S.watch(p);
      await p.clock.setFixedTime(new Date(FIXED));
      await p.goto(origin);
      await youNav(p).waitFor({ timeout: 15000 });
      await openCalendarModal(p);
      await S.ctx.setOffline(true);
      await saveEntry(p, 'Offline entry');
      await p.waitForTimeout(1000);
      const msg = await p.getByText("You're offline, so this activity wasn't saved", { exact: false }).count();
      const st = await inspect(p);
      await S.ctx.setOffline(false);
      await p.waitForTimeout(800);
      console.log('R18-offline ' + JSON.stringify({ msg, records: st.records.length, posts: S.posts.length }));
      check('offline before dispatch (real offline context): the Calendar Save stores nothing and sends nothing; the online-first message is shown; coming back online sends nothing', msg > 0 && st.records.length === 0 && S.posts.length === 0 && (await S.rows()).length === 0);
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
