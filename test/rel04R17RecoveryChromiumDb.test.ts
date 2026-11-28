/**
 * AURA-ANDROID-REL-04 R17 (ticket 39261; verification 39260 NO-GO: G7-G9) -- the shared recovery decision on the
 * ACTUAL product: the production-built app (next build / next start), real Chromium, the real habit-logs route and a
 * disposable, fully migrated PostgreSQL, with deterministic fault injection (response interception, IndexedDB
 * seeding, held read-only IndexedDB completions). Every case records exact request ids, outbound bodies, SQL rows,
 * durable receipts and surviving copies.
 *
 *   G7  Home: a queued "Start now" (JSON 429, never reaches the writer), then a same-id marker naming a DIFFERENT
 *       activity with a malformed v2 receipt; restart. The shared notice shows the operation's own activity, offers
 *       no Retry, and nothing is ever sent under the id (0 rows); an ordinary identical "Start now" is withheld; the
 *       original copy and the marker are kept
 *   G8  Calendar: the real write commits, its acknowledgement is unreadable; restart with EVERY read-only queue
 *       transaction's completion held (the projection never loads). The identical Save sends no new id; "Retry that
 *       entry" is offered from the claiming transaction's decision and resumes the original id (1 row, valid receipt)
 *   G9  Calendar: the same commit, plus an account-bound proofless null-payload marker beside the live copy; restart.
 *       Identical Save withheld; Retry resumes the original id (1 row)
 *   control  the same schedule with a completed startup; then a deliberately NEW identical entry after the original
 *       was resolved gets its own id, row and receipt
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
      const email = `r17-${tag}-${Date.now()}@example.invalid`;
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
    const holdReads = (b: any) => b.addInitScript(() => {
      const native = IDBDatabase.prototype.transaction;
      const w = window as any;
      w.heldQueueReads = 0;
      IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: any[]) {
        const tx = (native as any).apply(this, args) as IDBTransaction;
        if (this.name === 'aura-offline' && tx.mode === 'readonly' && tx.objectStoreNames.contains('dispatches')) {
          tx.addEventListener('complete', (ev) => { ev.stopImmediatePropagation(); w.heldQueueReads++; }); // physically complete; the app's acknowledgement is held
        }
        return tx;
      };
    });

    // ================================================================ G7 (Home)
    {
      const S = await session('g7');
      const a = await S.ctx.newPage(); S.watch(a);
      await a.route('**/api/habit-logs', (r: any) => (r.request().method() === 'POST' ? r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary rate limit' }) }) : r.continue()));
      await a.clock.setFixedTime(new Date(FIXED));
      await a.goto(origin);
      await startButton(a).waitFor({ timeout: 20000 });
      await startButton(a).click();
      await a.getByRole('button', { name: 'Start now for 30 minutes', exact: true }).first().click();
      await a.locator('[data-operation-state="unresolved-list"]').waitFor({ timeout: 10000 });
      const before = await inspect(a);
      const original = before.records[0]?.clientRequestId;
      const source = S.posts[0]?.body;
      if (!original || !source || (await S.rows()).length) throw new Error('G7 preconditions');
      const changed = { ...source, activityTitle: 'Different marker activity' };
      await putMarker(a, { recordId: key(S.user.id, original), ownerUserId: S.user.id, clientRequestId: original, payload: canonical(changed), decision: 'settled', fmt: 'r8', at: Date.now(), receipt: { v: 2, kind: 'accepted', owner: S.user.id } });
      await a.unroute('**/api/habit-logs');
      const postsBefore = S.posts.length;
      await a.reload();
      const item = a.locator(`[data-operation-id="${original}"]`);
      await item.waitFor({ timeout: 15000 });
      const shown = (await item.innerText()).replace(/\s+/g, ' ');
      const retryButtons = await item.getByRole('button', { name: 'Retry', exact: true }).count();
      // the same Home card: reattached to the open operation (unresolved), no "Start now" re-entry and no Retry for it
      await a.waitForTimeout(1500);
      const card = a.locator('[data-operation-state="unresolved"]').filter({ hasText: String(source.activityTitle) });
      const cardHeld = await card.count();
      const cardRetry = await a.getByRole('button', { name: `Retry ${source.activityTitle}`, exact: true }).count();
      const reentry = await a.locator('button').filter({ hasText: new RegExp(`^Start now\\s*${String(source.activityTitle)}$`) }).count(); // a "Start now" for the SAME activity
      const rows = await S.rows();
      const after = await inspect(a);
      const sent = S.posts.slice(postsBefore);
      console.log('R17-G7 ' + JSON.stringify({ original, shown, retryButtons, cardHeld, cardRetry, reentry, sent, rows, records: after.records.map((r: any) => ({ crid: r.clientRequestId, title: r.item.activityTitle })), markerTitle: JSON.parse(after.tombstones[0]?.payload ?? '{}').activityTitle }));
      check(`G7 Home after restart: the shared notice shows the operation's own activity ("${shown.slice(0, 40)}"), not the marker's, and offers NO Retry`, shown.startsWith(String(source.activityTitle)) && !shown.includes('Different marker activity') && retryButtons === 0);
      check(`G7 Home: no re-entry path for the open activity (unresolved card ${cardHeld}, "Start now ${source.activityTitle}" ${reentry}) and no Retry for it (${cardRetry})`, (cardHeld === 1 || reentry === 0) && cardRetry === 0);
      check(`G7 Home: nothing is sent under the id or as a fresh id (${sent.length} POSTs after restart), 0 PostgreSQL rows; the original copy and the marker are kept unchanged`, sent.length === 0 && rows.length === 0 && after.records.length === 1 && after.records[0].clientRequestId === original && after.records[0].item.activityTitle === source.activityTitle && after.tombstones.length === 1 && after.tombstones[0].payload === canonical(changed));
      await S.ctx.close();
    }

    // ================================================================ G8 / G9 / control (Calendar after restart)
    for (const mode of ['control', 'held-projection', 'null-marker'] as const) {
      const S = await session(mode);
      const title = 'Review exact original';
      const a = await S.ctx.newPage(); S.watch(a);
      let original = '';
      let unreadable = true;
      const fault = async (r: any) => {
        if (r.request().method() !== 'POST') return r.continue();
        const b = r.request().postDataJSON();
        const reply = await r.fetch();
        if (!original) original = b.clientRequestId;
        if (unreadable && b.clientRequestId === original) return r.fulfill({ status: 200, contentType: 'text/html', body: '<html>Unreadable acknowledgement</html>' });
        return r.fulfill({ response: reply });
      };
      await a.route('**/api/habit-logs', fault);
      await a.clock.setFixedTime(new Date(FIXED));
      await a.goto(origin);
      await youNav(a).waitFor({ timeout: 15000 });
      await openCalendarModal(a);
      await saveEntry(a, title);
      await a.getByText(UNVERIFIED, { exact: false }).first().waitFor({ timeout: 10000 });
      const pre = await inspect(a);
      if (pre.records.length !== 1 || pre.tombstones.length || (await S.rows()).length !== 1 || !original) throw new Error(`${mode} preconditions`);
      if (mode === 'null-marker') await putMarker(a, { recordId: key(S.user.id, original), ownerUserId: S.user.id, clientRequestId: original, payload: null, decision: 'settled', fmt: 'r8', at: Date.now() });
      await a.close();
      const b = await S.ctx.newPage(); S.watch(b);
      await b.route('**/api/habit-logs', fault);
      if (mode === 'held-projection') await holdReads(b);
      await b.clock.setFixedTime(new Date(FIXED));
      await b.goto(origin);
      await youNav(b).waitFor({ timeout: 15000 });
      if (mode === 'held-projection') {
        for (let i = 0; i < 50 && !(await b.evaluate(() => (window as any).heldQueueReads > 0)); i++) await b.waitForTimeout(100);
      } else await b.waitForTimeout(1500);
      const held = await b.evaluate(() => (window as any).heldQueueReads ?? 0);
      const postsBefore = S.posts.length;
      await openCalendarModal(b);
      await saveEntry(b, title); // the ordinary identical Save
      const retry = b.getByRole('button', { name: 'Retry that entry' });
      for (let i = 0; i < 40 && !(await retry.count()) && !S.posts.slice(postsBefore).some((p) => p.body.clientRequestId !== original); i++) await b.waitForTimeout(125);
      const sentNew = S.posts.slice(postsBefore).some((p) => p.body.clientRequestId !== original);
      const retryOffered = await retry.count();
      const rowsAfterSave = await S.rows();
      let afterRetry: any = null;
      if (retryOffered) {
        unreadable = false; // the recovery step: the route's own answer is delivered
        const p0 = S.posts.length;
        await retry.first().click();
        for (let i = 0; i < 40 && (await b.getByRole('button', { name: 'Retry that entry' }).count()); i++) await b.waitForTimeout(125);
        await b.waitForTimeout(500);
        const st = await inspect(b);
        afterRetry = { sent: S.posts.slice(p0).map((p) => p.body), rows: await S.rows(), copies: st.records.length, receipt: st.tombstones.find((t: any) => t.clientRequestId === original)?.receipt ?? null };
      }
      console.log('R17-' + mode + ' ' + JSON.stringify({ original, held, sentNew, retryOffered, rowsAfterSave, afterRetry }));
      const label = mode === 'held-projection' ? `G8 held startup projection (${held} read-only completion(s) held)` : mode === 'null-marker' ? 'G9 proofless null-payload marker beside the live copy' : 'control (startup completed)';
      check(`${label}: the identical Calendar Save after a restart sends NO new id (1 row) and offers "Retry that entry"`, (mode !== 'held-projection' || held > 0) && !sentNew && rowsAfterSave.length === 1 && rowsAfterSave[0].clientRequestId === original && retryOffered > 0);
      check(`${label}: Retry sends the ORIGINAL id with the original body; still 1 row; a valid accepted receipt names that row; no copy left`, Boolean(afterRetry) && afterRetry.sent.length >= 1 && afterRetry.sent.every((x: any) => x.clientRequestId === original && x.activityTitle === title) && afterRetry.rows.length === 1 && afterRetry.copies === 0 && afterRetry.receipt?.v === 2 && afterRetry.receipt?.kind === 'accepted' && afterRetry.receipt?.serverRecordId === afterRetry.rows[0].id);
      if (mode === 'control') {
        // the original is RESOLVED: a deliberately new identical entry is a legitimate independent operation
        await b.keyboard.press('Escape').catch(() => undefined);
        await b.reload();
        await youNav(b).waitFor({ timeout: 15000 });
        const p0 = S.posts.length;
        await openCalendarModal(b);
        await saveEntry(b, title);
        for (let i = 0; i < 40 && (await S.rows()).length < 2; i++) await b.waitForTimeout(125);
        const rows = await S.rows();
        const st = await inspect(b);
        const newId = S.posts.slice(p0).map((p) => p.body.clientRequestId).find((id: string) => id !== original);
        console.log('R17-independent ' + JSON.stringify({ newId, rows, receipts: st.tombstones.map((t: any) => ({ crid: t.clientRequestId, kind: t.receipt?.kind, row: t.receipt?.serverRecordId })) }));
        check('control: after the original was resolved, a deliberately new identical Calendar entry gets its OWN id, row and valid receipt (2 rows, 2 ids)', Boolean(newId) && rows.length === 2 && new Set(rows.map((r: any) => r.clientRequestId)).size === 2 && st.tombstones.some((t: any) => t.clientRequestId === newId && t.receipt?.kind === 'accepted'));
      }
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
