/**
 * AURA-ANDROID-REL-04 (R3) -- REAL Chromium multi-tab checks (Playwright).
 *
 *   npx ts-node test/rel04Chromium.test.ts      (needs `npx playwright install chromium`)
 *
 * A local HTTP server (this process) serves:
 *   - one page that loads the ACTUAL client modules (lib/accountRoutePolicy,
 *     accountSession, offlineHabitQueue, habitLogSyncPolicy, activitySync,
 *     signOut, signInCode, accountBoundFetch), transpiled and bundled as-is,
 *     plus the pre-REL-04 client's enqueue/replay code (vendored, a54daf6);
 *   - the REAL middleware and route handlers (logout, session, habit-logs,
 *     plans) over the in-memory db stub of rel04AccountIsolationHarness, and a
 *     simulated verify-code (it issues the real session cookie).
 * Two pages in ONE browser context = two tabs sharing real localStorage, real
 * Web Locks and the real cookie jar; Set-Cookie ordering is the browser's own.
 *
 * Chromium only: this is NOT WKWebView, Android WebView or physical-device
 * acceptance.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WEB, addUser, check, routes, store } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const { NextRequest } = require(require.resolve('next/server', { paths: [path.join(WEB, 'app', 'api', 'habit-logs')] }));
const auth = require(path.join(WEB, 'lib', 'auth'));
const middlewareMod = require(path.join(WEB, 'middleware'));
const Module = require('module');

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');
const EMAIL: Record<string, string> = { 'alicesynth@example.invalid': A, 'bobsynth@example.invalid': B };

// ---------------------------------------------------------------- bundle of the real client modules
const MODULES = ['accountRoutePolicy', 'accountSession', 'offlineHabitQueue', 'habitLogSyncPolicy', 'activitySync', 'signOut', 'signInCode', 'accountBoundFetch'];
const OLD = path.join(__dirname, 'fixtures', 'rel04-reviewed-head');
function bundle(): string {
  const defs = MODULES.map((n) => {
    const src = fs.readFileSync(path.join(WEB, 'lib', `${n}.ts`), 'utf8');
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    return `__def(${JSON.stringify('./' + n)}, function (require, module, exports) {\n${js}\n});`;
  }).join('\n');
  const tsOld = (body: string, params: string) => ts.transpileModule(`async function __f(${params}) {\n${body}\n}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const oldEnqueue = tsOld(fs.readFileSync(path.join(OLD, 'page.enqueue.txt'), 'utf8'), 'localStorage, payload, tempId');
  const oldReplay = tsOld(fs.readFileSync(path.join(OLD, 'page.syncOfflineLogs.txt'), 'utf8') + '\nreturn syncOfflineLogs();', 'localStorage, fetch, classifyHabitLogSyncOutcome, loadUserDataAndLogs, loadMyDay');
  return `(function(){
var __mods = {}, __cache = {};
function __def(id, fn) { __mods[id] = fn; }
function __req(id) {
  if (__cache[id]) return __cache[id].exports;
  var m = { exports: {} }; __cache[id] = m; __mods[id](__req, m, m.exports); return m.exports;
}
${defs}
var acct = __req('./accountSession');
window.aura = { acct: acct, q: __req('./offlineHabitQueue'), sync: __req('./activitySync'), so: __req('./signOut'), si: __req('./signInCode'), bf: __req('./accountBoundFetch'), policy: __req('./accountRoutePolicy'), cls: __req('./habitLogSyncPolicy') };
window.__nativeFetch = window.fetch.bind(window); // what an old bundle uses
window.aura.bf.installAccountBoundFetch();
window.oldEnqueue = (${oldEnqueue.trim().replace(/;$/, '')});
window.oldReplay = (${oldReplay.trim().replace(/;$/, '')});
window.auraReady = true;
})();`;
}

// R2 (091e3ce) logout route, to show the browser-ordering defect it allowed.
function compileFixture(file: string, fake: string, overrides: Record<string, unknown> = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = new Module(fake, module); m.filename = fake; m.paths = Module._nodeModulePaths(path.dirname(fake));
  const orig = m.require.bind(m); m.require = (id: string) => (id in overrides ? overrides[id] : orig(id));
  m._compile(js, fake); return m.exports;
}
const R2F = path.join(__dirname, 'fixtures', 'rel04-r2-head');
const r2Expected = compileFixture(path.join(R2F, 'expectedAccount.ts.txt'), path.join(WEB, 'lib', 'expectedAccount.r2c.js'));
const r2Logout = compileFixture(path.join(R2F, 'logout.route.ts.txt'), path.join(WEB, 'app', 'api', 'auth', 'logout', 'route.r2c.js'), { '../../../../lib/expectedAccount': r2Expected });

// ---------------------------------------------------------------- server
type Gate = { path: string; phase: 'before' | 'after'; release: () => void; promise: Promise<void>; arrived: Promise<void>; mark: () => void };
const gates: Gate[] = [];
function hold(p: string, phase: 'before' | 'after') {
  let release!: () => void, mark!: () => void;
  const g: Gate = { path: p, phase, release: () => release(), promise: new Promise((r) => { release = r; }), arrived: new Promise((r) => { mark = r; }), mark: () => mark() };
  gates.push(g); return g;
}
function takeGate(p: string, phase: 'before' | 'after') { const i = gates.findIndex((g) => g.path === p && g.phase === phase); return i >= 0 ? gates.splice(i, 1)[0] : null; }
const serverLog: Array<{ path: string; method: string; status: number; expected: string | null }> = [];
let BUNDLE = '';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><html><body><script src="/bundle.js"></script></body></html>'); return; }
  if (url.pathname === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(BUNDLE); return; }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const method = (req.method ?? 'GET').toUpperCase();
  const key = `${method} ${url.pathname}`;
  const before = takeGate(url.pathname, 'before');
  if (before) { before.mark(); await before.promise; }
  const nreq = new NextRequest(url.toString(), { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
  let out: Response;
  const mw: Response = url.pathname.startsWith('/api/') ? await middlewareMod.middleware(nreq) : new Response(null, { headers: { 'x-middleware-next': '1' } });
  if (mw.headers.get('x-middleware-next') !== '1') out = mw;
  else if (key === 'POST /api/auth/verify-code') {
    const uid = EMAIL[JSON.parse(body ?? '{}').email];
    out = uid
      ? Response.json({ ok: true, userId: uid }, { status: 200, headers: { 'set-cookie': `as_session=${auth.createSessionToken(uid, store.users.get(uid)!.email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`, 'Cache-Control': 'no-store' } })
      : Response.json({ error: 'That code is not valid.' }, { status: 401 });
  } else if (key === 'POST /api/auth/logout-r2') out = await r2Logout.POST(nreq);
  else if (routes[key]) out = await routes[key](nreq);
  else out = Response.json({}, { status: 200 });
  serverLog.push({ path: url.pathname, method, status: out.status, expected: headers.get('x-aura-expected-account') });
  const after = takeGate(url.pathname, 'after');
  if (after) { after.mark(); await after.promise; }
  const outHeaders: Record<string, string | string[]> = {};
  out.headers.forEach((v, k) => { if (k !== 'set-cookie') outHeaders[k] = v; });
  const sc = (out.headers as any).getSetCookie?.() ?? [];
  if (sc.length) outHeaders['set-cookie'] = sc;
  res.writeHead(out.status, outHeaders);
  res.end(Buffer.from(await out.arrayBuffer()));
});

const payload = (title: string, crid: string) => ({ activityTitle: title, activeWindow: 'NEUTRAL', logTimestamp: '2026-11-25T06:00:00.000Z', durationMinutes: 30, logSource: 'MANUAL', activitySignificance: 'MEDIUM', clientRequestId: crid });

async function main() {
  BUNDLE = bundle();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;
  const origin = `http://127.0.0.1:${port}`;
  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch();
  const ver = browser.version();
  console.log(`Chromium ${ver} (headless) on ${origin}`);
  try {
    const newContext = async () => {
      const context = await browser.newContext();
      const open = async () => { const p = await context.newPage(); await p.goto(origin + '/'); await p.waitForFunction(() => (window as any).auraReady === true); return p; };
      const signIn = async (email: string) => {
        const p = await context.newPage(); await p.goto(origin + '/'); await p.waitForFunction(() => (window as any).auraReady === true);
        await p.evaluate(async (e: string) => { await fetch('/api/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, code: '123456' }) }); }, email);
        await p.close();
      };
      const cookieUser = async () => {
        const c = (await context.cookies(origin)).find((x: any) => x.name === 'as_session');
        return c ? auth.verifySessionToken(c.value)?.userId ?? null : null;
      };
      return { context, open, signIn, cookieUser };
    };

    // ------------------------------------------------------------ CH1 concurrent enqueues in two tabs
    {
      const { context, open, signIn } = await newContext();
      await signIn('alicesynth@example.invalid');
      const [t1, t2] = [await open(), await open()];
      for (const t of [t1, t2]) await t.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      const N = 40;
      await Promise.all([t1, t2].map((t, i) => t.evaluate(({ i, N, A }: { i: number; N: number; A: string }) => {
        const q = (window as any).aura.q;
        for (let n = 0; n < N; n++) q.enqueueOwned({ activityTitle: `t${i}-${n}`, activeWindow: 'NEUTRAL', logTimestamp: '2026-11-25T06:00:00.000Z', clientRequestId: `crid-${i}-${n}`, tempId: 'x', ownerUserId: A });
      }, { i, N, A })));
      const count = await t1.evaluate((A: string) => { const r = (window as any).aura.q.readOwnedQueue(A); return r.ok ? r.records.length : -1; }, A);
      check(`CH1 two real tabs enqueue ${N} entries each concurrently: all ${2 * N} kept`, count === 2 * N);
      await context.close();
    }

    // ------------------------------------------------------------ CH2 replay in tab1 vs discard in tab2
    {
      store.logs.length = 0;
      const { context, open, signIn } = await newContext();
      await signIn('alicesynth@example.invalid');
      const [t1, t2] = [await open(), await open()];
      for (const t of [t1, t2]) await t.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      await t1.evaluate((A: string) => {
        const q = (window as any).aura.q;
        for (const n of [1, 2]) q.enqueueOwned({ activityTitle: `A ${n}`, activeWindow: 'NEUTRAL', logTimestamp: '2026-11-25T06:00:00.000Z', clientRequestId: `crid-r${n}`, tempId: 'x', ownerUserId: A, queuedAt: n });
      }, A);
      const g = hold('/api/habit-logs', 'before');
      const replay = t1.evaluate(async () => (window as any).aura.sync.replayOfflineQueue());
      await g.arrived;
      const removed = await t2.evaluate((A: string) => {
        const q = (window as any).aura.q;
        const r = q.readOwnedQueue(A);
        const rec = r.records.find((x: any) => x.item.clientRequestId === 'crid-r2');
        return q.removeRecords([rec]).removed;
      }, A);
      g.release();
      await replay;
      check('CH2 a record discarded in tab 2 after tab 1\'s replay took its snapshot is never sent', removed === 1 && store.logs.length === 1 && store.logs[0].clientRequestId === 'crid-r1');
      await context.close();
    }

    // ------------------------------------------------------------ CH3 auth lock across tabs (real Web Locks), marker unwritable
    {
      const { context, open, signIn } = await newContext();
      await signIn('alicesynth@example.invalid');
      const [t1, t2] = [await open(), await open()];
      for (const t of [t1, t2]) await t.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      // Tab 1 cannot write the storage marker: only the held Web Lock signals its transition.
      await t1.evaluate(() => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k: string, v: string) { if (k === 'aura_auth_transition_v2') throw new Error('blocked'); return orig.call(this, k, v); }; });
      const g = hold('/api/auth/logout', 'before');
      const out = t1.evaluate(async () => (await (window as any).aura.so.performSignOut({ fetch: (i: any, n: any) => fetch(i, n), confirm: () => true })).outcome);
      await g.arrived;
      const markerless = await t1.evaluate(() => (window as any).aura.acct.getTransitionCoordination().markerWritten === false);
      const busy = await t2.evaluate(async () => (await (window as any).aura.si.verifySignInCode({ email: 'bobsynth@example.invalid', code: '123456' })).kind);
      const write = await t2.evaluate(async (p: any) => { try { await (window as any).aura.sync.submitActivityLog(p, 't'); return 'sent'; } catch (e: any) { return e?.reason ?? String(e); } }, payload('tab2 during sign-out', 'crid-ch3'));
      g.release();
      const o = await out;
      check('CH3 precondition: tab 1 signs out with NO storage marker (blocked)', markerless);
      check('CH3 tab 2 sign-in during tab 1\'s sign-out is refused (BUSY) by the real cross-tab Web Lock', busy === 'BUSY');
      check('CH3 tab 2 account-bound write during tab 1\'s sign-out is refused via the HELD lock, not the marker', write === 'transition');
      check('CH3 tab 1 completes its sign-out', o === 'signed-out');
      await context.close();
    }

    // ------------------------------------------------------------ CH4 delayed Set-Cookie ordering (real browser)
    {
      // (a) R2 behaviour: an unbound old-client logout, delayed, clears the newer sign-in.
      const c1 = await newContext();
      await c1.signIn('alicesynth@example.invalid');
      const old = await c1.open();
      const gA = hold('/api/auth/logout-r2', 'after');
      const pendingOld = old.evaluate(async () => { await fetch('/api/auth/logout-r2', { method: 'POST' }); });
      await gA.arrived;
      await c1.signIn('bobsynth@example.invalid');
      const beforeRelease = await c1.cookieUser();
      gA.release(); await pendingOld;
      const afterR2 = await c1.cookieUser();
      check(`CH4a R2 HEAD (reproduced in Chromium): a delayed unbound legacy logout clears the newer sign-in (B before release: ${beforeRelease}, after: ${afterR2})`, beforeRelease === B && afterR2 === null);
      await c1.context.close();

      // (b) corrected: the same unbound legacy logout is refused and cannot clear B.
      const c2 = await newContext();
      await c2.signIn('alicesynth@example.invalid');
      const old2 = await c2.open();
      const gB = hold('/api/auth/logout', 'after');
      const pendingOld2 = old2.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).status);
      await gB.arrived;
      await c2.signIn('bobsynth@example.invalid');
      gB.release();
      const st = await pendingOld2;
      check(`CH4b CORRECTED: the delayed unbound legacy logout is refused (${st}) and B stays signed in`, st === 503 && (await c2.cookieUser()) === B);
      await c2.context.close();

      // (c) coordinated: a NEW-bundle sign-in in another tab waits out a pending new logout (BUSY), so no ordering race.
      const c3 = await newContext();
      await c3.signIn('alicesynth@example.invalid');
      const [x1, x2] = [await c3.open(), await c3.open()];
      for (const t of [x1, x2]) await t.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      const gC = hold('/api/auth/logout', 'after');
      const so = x1.evaluate(async () => (await (window as any).aura.so.performSignOut({ fetch: (i: any, n: any) => fetch(i, n), confirm: () => true })).outcome);
      await gC.arrived;
      const si = await x2.evaluate(async () => (await (window as any).aura.si.verifySignInCode({ email: 'bobsynth@example.invalid', code: '123456' })).kind);
      gC.release(); await so;
      check('CH4c coordinated new bundles: sign-in while the logout response is pending is refused (BUSY), so its cookie cannot be overwritten by that response', si === 'BUSY');
      await c3.context.close();

      // (d) residual (documented): a bound logout SENT with A's cookie, response delayed, versus an UNCOORDINATED sign-in.
      const c4 = await newContext();
      await c4.signIn('alicesynth@example.invalid');
      const y1 = await c4.open();
      await y1.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      const gD = hold('/api/auth/logout', 'after');
      const so2 = y1.evaluate(async () => (await (window as any).aura.so.performSignOut({ fetch: (i: any, n: any) => fetch(i, n), confirm: () => true })).outcome);
      await gD.arrived;
      await c4.signIn('bobsynth@example.invalid'); // bypasses the lock (old bundle / out-of-band)
      gD.release(); await so2;
      const residual = await c4.cookieUser();
      check(`CH4d RESIDUAL (documented, activation blocker A-3): an uncoordinated sign-in landing before a bound logout's delayed response is cleared by it (cookie now: ${residual})`, residual === null);
      await c4.context.close();
    }

    // ------------------------------------------------------------ CH5 pre-REL-04 client replay against the corrected route (valid and expired)
    for (const expired of [false, true]) {
      store.logs.length = 0;
      const c = await newContext();
      await c.signIn('alicesynth@example.invalid');
      const t = await c.open();
      await t.evaluate(async (ps: any[]) => { for (const p of ps) await (window as any).oldEnqueue(localStorage, p, 't'); }, [payload('A 1', 'crid-o1'), payload('A 2', 'crid-o2'), payload('A 3', 'crid-o3')]);
      const before = await t.evaluate(() => localStorage.getItem('offline_habit_queue'));
      if (expired) await c.context.clearCookies();
      // The old bundle's own fetch (no account statement): call the native fetch, bypassing the new wrapper.
      await t.evaluate(async () => {
        const native = (window as any).__nativeFetch ?? window.fetch;
        await (window as any).oldReplay(localStorage, native, (window as any).aura.cls.classifyHabitLogSyncOutcome, () => {}, () => {});
      });
      const after = await t.evaluate(() => localStorage.getItem('offline_habit_queue'));
      check(`CH5 pre-REL-04 client replay in Chromium, ${expired ? 'EXPIRED' : 'valid'} session: entries kept byte for byte, nothing stored`, before !== null && after === before && store.logs.length === 0);
      await c.context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const { finish } = require('./rel04AccountIsolationHarness');
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
