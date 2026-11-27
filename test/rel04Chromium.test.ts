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
const MODULES = ['serviceWorkerBridge', 'accountRoutePolicy', 'accountSession', 'offlineHabitQueue', 'habitLogSyncPolicy', 'activitySync', 'signOut', 'signInCode', 'accountBoundFetch'];
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
__req('./serviceWorkerBridge').announceAccountBoundary();
window.aura.swb = __req('./serviceWorkerBridge');
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
// R4 service-worker cases: what the "deployment" currently serves at /sw.js and at the app URL.
const OLD_SW = fs.readFileSync(path.join(__dirname, 'fixtures', 'rel04-prod-head', 'sw.js.txt'), 'utf8'); // Production ac46fc3
const NEW_SW = fs.readFileSync(path.join(WEB, 'public', 'sw.js'), 'utf8');
const R5_SW = fs.readFileSync(path.join(__dirname, 'fixtures', 'rel04-r5-head', 'sw.js.txt'), 'utf8'); // R6 before/after (CH15)
const OLD_LOGOUT = fs.readFileSync(path.join(__dirname, 'fixtures', 'rel04-prod-head', 'page.handleLogout.txt'), 'utf8');
const deploy = { sw: NEW_SW, appHtml: 'new' as 'old' | 'new' };
// The pre-boundary page: registers the worker like Home does, and signs out with Production's own handleLogout body.
const OLD_PAGE = `<!doctype html><html><body data-screen="signed-in"><script>
navigator.serviceWorker.register('/sw.js');
const setUser = (u) => { document.body.dataset.screen = u ? 'signed-in' : 'signed-out'; };
const useCallback = (fn) => fn;
${OLD_LOGOUT.replace('const handleLogout', 'window.handleLogout')}
window.oldReady = true;
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/sw.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' }); res.end(deploy.sw); return; }
  if (url.pathname === '/app') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' }); res.end(deploy.appHtml === 'old' ? OLD_PAGE : '<!doctype html><html><body><script>navigator.serviceWorker.register("/sw.js");</script><script src="/bundle.js"></script></body></html>'); return; }
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
      await Promise.all([t1, t2].map((t, i) => t.evaluate(async ({ i, N, A }: { i: number; N: number; A: string }) => {
        const q = (window as any).aura.q;
        await Promise.all(Array.from({ length: N }, (_, n) => q.enqueueOwned({ activityTitle: `t${i}-${n}`, activeWindow: 'NEUTRAL', logTimestamp: '2026-11-25T06:00:00.000Z', clientRequestId: `crid-${i}-${n}`, tempId: 'x', ownerUserId: A })));
      }, { i, N, A })));
      const count = await t1.evaluate(async (A: string) => { const r = await (window as any).aura.q.readOwnedQueue(A); return r.ok ? r.records.length : -1; }, A);
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
      await t1.evaluate(async (A: string) => {
        const q = (window as any).aura.q;
        for (const n of [1, 2]) await q.enqueueOwned({ activityTitle: `A ${n}`, activeWindow: 'NEUTRAL', logTimestamp: '2026-11-25T06:00:00.000Z', clientRequestId: `crid-r${n}`, tempId: 'x', ownerUserId: A });
      }, A);
      const g = hold('/api/habit-logs', 'before');
      const replay = t1.evaluate(async () => (window as any).aura.sync.replayOfflineQueue());
      await g.arrived;
      const removed = await t2.evaluate(async (A: string) => {
        const q = (window as any).aura.q;
        const r = await q.readOwnedQueue(A);
        const rec = r.records.find((x: any) => x.item.clientRequestId === 'crid-r2');
        return (await q.discardRecords([rec.recordId], { tab: 'tab2' })).removed;
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

    // ------------------------------------------------------------ CH6 (R4) replay holds the claim in tab 1 -> tab 2's discard keeps it (real IndexedDB)
    {
      store.logs.length = 0;
      const { context, open, signIn } = await newContext();
      await signIn('alicesynth@example.invalid');
      const [t1, t2] = [await open(), await open()];
      for (const t of [t1, t2]) await t.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      await t1.evaluate(async (A: string) => { await (window as any).aura.q.enqueueOwned({ activityTitle: 'in flight', activeWindow: 'NEUTRAL', logTimestamp: '2026-11-25T06:00:00.000Z', clientRequestId: 'crid-ch6', tempId: 'x', ownerUserId: A }); }, A);
      const g = hold('/api/habit-logs', 'before');
      const replay = t1.evaluate(async () => (window as any).aura.sync.replayOfflineQueue());
      await g.arrived;
      const d = await t2.evaluate(async (A: string) => {
        const q = (window as any).aura.q;
        const r = await q.readOwnedQueue(A);
        return q.discardRecords(r.records.map((x: any) => x.recordId), { tab: 'tab2' });
      }, A);
      g.release();
      await replay;
      const left = await t2.evaluate(async (A: string) => { const r = await (window as any).aura.q.readOwnedQueue(A); return r.ok ? r.records.length : -1; }, A);
      check('CH6 (R4, real Chromium IndexedDB, two pages) a discard while the other page is SENDING keeps the record (keptInFlight); the send settles it exactly once', d.keptInFlight === 1 && d.removed === 0 && store.logs.filter((l) => l.clientRequestId === 'crid-ch6').length === 1 && left === 0);
      await context.close();
    }

    // ------------------------------------------------------------ CH7 (R4) no Web Locks: concurrent replays in two pages send each entry once
    {
      store.logs.length = 0;
      const { context, open, signIn } = await newContext();
      await context.addInitScript(() => { try { Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }); } catch { /* ignore */ } });
      await signIn('alicesynth@example.invalid');
      const [t1, t2] = [await open(), await open()];
      const noLocks = await t1.evaluate(() => (navigator as any).locks === undefined);
      for (const t of [t1, t2]) await t.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      await t1.evaluate(async (A: string) => {
        const q = (window as any).aura.q;
        for (const n of [1, 2, 3, 4]) await q.enqueueOwned({ activityTitle: `nl ${n}`, activeWindow: 'NEUTRAL', logTimestamp: '2026-11-25T06:00:00.000Z', clientRequestId: `crid-nl${n}`, tempId: 'x', ownerUserId: A });
      }, A);
      const mark = serverLog.length;
      await Promise.all([t1, t2].map((t) => t.evaluate(async () => (window as any).aura.sync.replayOfflineQueue())));
      const posts = serverLog.slice(mark).filter((x) => x.path === '/api/habit-logs' && x.method === 'POST').length;
      check(`CH7 (R4, real Chromium, Web Locks REMOVED) two pages replaying at once: each of 4 entries sent exactly once (${posts} sends)`, noLocks && posts === 4 && ['crid-nl1', 'crid-nl2', 'crid-nl3', 'crid-nl4'].every((c) => store.logs.filter((l) => l.clientRequestId === c).length === 1));
      await context.close();
    }

    // ------------------------------------------------------------ CH8 (R4; R8: migration retired) settlement racing reads of a stale
    // retired-format source of the same entries across pages: nothing recreated, nothing of the stale source ever active or sent
    {
      const { context, open, signIn } = await newContext();
      await signIn('alicesynth@example.invalid');
      const [t1, t2, t3] = [await open(), await open(), await open()];
      const entries = [1, 2, 3].map((n) => ({ ...payload(`v2 ${n}`, `crid-mg${n}`), ownerUserId: A, tempId: 't' }));
      const src = JSON.stringify(entries);
      const ids: string[] = await t1.evaluate(async ({ A, entries }: { A: string; entries: any[] }) => {
        for (const e of entries) await (window as any).aura.q.enqueueOwned(e);
        const r = await (window as any).aura.q.readOwnedQueue(A);
        return r.ok ? r.records.map((x: any) => x.recordId) : [];
      }, { A, entries });
      const mark = serverLog.length;
      // A stale context writes a retired-format copy of the same entries; t2 and t3 read while t1 settles all three, concurrently.
      await t1.evaluate(({ A, src }: { A: string; src: string }) => localStorage.setItem('offline_habit_queue_v2:' + A, src), { A, src });
      await Promise.all([
        t2.evaluate(async (A: string) => (window as any).aura.q.readOwnedQueue(A), A),
        t1.evaluate(async ({ ids, A }: { ids: string[]; A: string }) => (window as any).aura.q.settleRecords(ids, undefined, { owner: A }), { ids, A }),
        t3.evaluate(async (A: string) => (window as any).aura.q.readOwnedQueue(A), A),
      ]);
      const after = await t3.evaluate(async (A: string) => { const r = await (window as any).aura.q.readOwnedQueue(A); await (window as any).aura.sync.replayOfflineQueue(); return r.ok ? { left: r.records.length, paused: r.paused } : null; }, A);
      const posts = serverLog.slice(mark).filter((x) => x.path === '/api/habit-logs' && x.method === 'POST').length;
      check(`CH8 (R4/R8, real Chromium) settlement in one page racing reads of a stale retired-format copy in two others never recreates a settled entry; the copy stays quarantined and is never sent (left: ${after?.left}, paused: ${after?.paused}, sends: ${posts})`, ids.length === 3 && after?.left === 0 && after?.paused === 3 && posts === 0);
      await context.close();
    }

    // ------------------------------------------------------------ CH9 (R4) an OLD bundle keeps writing the legacy array during a new page's sign-out
    {
      store.logs.length = 0;
      const { context, open, signIn } = await newContext();
      await signIn('alicesynth@example.invalid');
      const [oldTab, newTab] = [await open(), await open()];
      await oldTab.evaluate(async (ps: any[]) => { for (const p of ps) await (window as any).oldEnqueue(localStorage, p, 't'); }, [payload('old 1', 'crid-old1'), payload('old 2', 'crid-old2')]);
      await newTab.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      const g = hold('/api/auth/logout', 'before');
      const out = newTab.evaluate(async () => (window as any).aura.so.performSignOut({ fetch: (u: string, i: any) => fetch(u, i), confirm: () => true }));
      await g.arrived;
      await oldTab.evaluate(async (p: any) => (window as any).oldEnqueue(localStorage, p, 't'), payload('old 3 (during sign-out)', 'crid-old3'));
      g.release();
      const r = await out;
      const arr = JSON.parse((await oldTab.evaluate(() => localStorage.getItem('offline_habit_queue'))) ?? '[]');
      check(`CH9 (R4, real Chromium) sign-out never rewrites the shared legacy array: all 3 old-bundle entries survive, reported as kept (${r.legacyKept})`, r.outcome === 'signed-out' && arr.length === 3 && r.legacyKept === 3);
      await context.close();
    }

    // ------------------------------------------------------------ CH10a (R4) A-2 reproduced WITHOUT the updated worker (residual for uncontrolled pages)
    {
      deploy.sw = OLD_SW; deploy.appHtml = 'old';
      const { context, signIn, cookieUser } = await newContext();
      const oldPage = await context.newPage();
      await oldPage.goto(origin + '/app');
      await oldPage.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return Boolean(r.active) && Boolean(navigator.serviceWorker.controller); }, null, { timeout: 15000 });
      await signIn('alicesynth@example.invalid');
      await oldPage.evaluate(async () => { await (window as any).handleLogout(); });
      const screen = await oldPage.evaluate(() => document.body.dataset.screen);
      check(`CH10a RESIDUAL (A-2, page still under the OLD Production worker): the old page shows "${screen}" while the session is still ${await cookieUser()}`, screen === 'signed-out' && (await cookieUser()) === A);
      await context.close();
    }

    // ------------------------------------------------------------ CH10 (R4) old page + Production service worker, then the new worker is deployed
    {
      store.logs.length = 0;
      deploy.sw = OLD_SW; deploy.appHtml = 'old';
      const { context, signIn, cookieUser } = await newContext();
      const oldPage = await context.newPage();
      await oldPage.goto(origin + '/app');
      await oldPage.waitForFunction(async () => { const r = await navigator.serviceWorker.ready; return Boolean(r.active) && Boolean(navigator.serviceWorker.controller); }, null, { timeout: 15000 });
      await signIn('alicesynth@example.invalid');
      // "Deploy": the new worker and the new bundle are served from now on; the old page stays open.
      deploy.sw = NEW_SW; deploy.appHtml = 'new';
      const changed = oldPage.evaluate(() => new Promise<boolean>((resolve) => { navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true)); setTimeout(() => resolve(false), 15000); }));
      const other = await context.newPage();
      await other.goto(origin + '/app'); // any navigation in the origin makes the browser fetch the updated worker
      const tookOver = await changed;
      check('CH10 precondition (real Chromium): after a navigation elsewhere in the origin, the NEW worker takes control of the already-open OLD page', tookOver);
      // The old page signs out with Production's own handleLogout (headerless).
      const nav = oldPage.waitForURL(/aura_reloaded=upgrade/, { timeout: 15000 }).then(() => true, () => false);
      await oldPage.evaluate(async () => { await (window as any).handleLogout(); }).catch(() => undefined);
      const reloaded = await nav;
      await oldPage.waitForFunction(() => (window as any).auraReady === true, null, { timeout: 15000 }).catch(() => undefined);
      const logoutRefused = serverLog.filter((x) => x.path === '/api/auth/logout').some((x) => x.status === 503 && x.expected === null);
      const session = await oldPage.evaluate(async () => { const r = await (window as any).aura.acct.fetchVerifiedSession(); return r.status === 'current' ? r.user.id : r.status; }).catch(() => 'no-new-bundle');
      check('CH10 the old page\'s headerless sign-out is refused (503, cookie untouched) and the worker RELOADS that page into the current bundle (no lingering false "signed out" screen)', logoutRefused && reloaded && (await cookieUser()) === A);
      check('CH10 the reloaded page runs the current bundle and shows the REAL session (still Alice), with the reload marker for its notice', session === A && (await oldPage.evaluate(() => (window as any).aura.swb.consumeReloadedNotice())) === true);
      // A current-bundle page is never reloaded by the worker, even when the server refuses something.
      const urlBefore = other.url();
      await other.waitForFunction(() => (window as any).auraReady === true);
      const st = await other.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); return (await (window as any).__nativeFetch('/api/goals')).status; });
      await other.waitForTimeout(800);
      check(`CH10 a current-bundle page (announced to the worker) is NOT reloaded even when one of its requests is refused as out of date (${st})`, st === 503 && other.url() === urlBefore);
      await context.close();
    }

    // ------------------------------------------------------------ CH11 (R4) cookie settlement through the worker: the CH4d race is serialized
    {
      deploy.sw = NEW_SW; deploy.appHtml = 'new';
      const { context, open, signIn, cookieUser } = await newContext();
      const boot = await context.newPage();
      await boot.goto(origin + '/app');
      await boot.waitForFunction(async () => { await navigator.serviceWorker.ready; return Boolean(navigator.serviceWorker.controller); }, null, { timeout: 15000 });
      await signIn('alicesynth@example.invalid');
      const y1 = await open();
      const controlled = await y1.evaluate(() => Boolean(navigator.serviceWorker.controller));
      await y1.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      const gD = hold('/api/auth/logout', 'after');
      const so2 = y1.evaluate(async () => (await (window as any).aura.so.performSignOut({ fetch: (i: any, n: any) => fetch(i, n), confirm: () => true })).outcome);
      await gD.arrived;
      // The same UNCOORDINATED sign-in as CH4d (a separate page, no auth lock), but from a page the worker controls.
      const markSI = serverLog.length;
      const uncoordinated = (async () => {
        const p = await context.newPage(); await p.goto(origin + '/app');
        await p.evaluate(async () => { await fetch('/api/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bobsynth@example.invalid', code: '123456' }) }); });
        await p.close();
      })();
      await new Promise((r) => setTimeout(r, 400));
      const signInReachedServerEarly = serverLog.slice(markSI).some((x) => x.path === '/api/auth/verify-code');
      gD.release();
      const outcome = await so2; await uncoordinated;
      const now = await cookieUser();
      check(`CH11 (real Chromium, worker controlling both pages) the uncoordinated sign-in waits for the pending sign-out response, so it is NOT cleared by it (cookie now: ${now}; sign-out: ${outcome})`, controlled && !signInReachedServerEarly && now === B && outcome === 'signed-out');
      await context.close();
    }

    // ------------------------------------------------------------ CH12 (R5) worker RESTART: recovery decisions do not depend on in-memory state
    {
      deploy.sw = NEW_SW; deploy.appHtml = 'new';
      const { context, signIn, cookieUser } = await newContext();
      const cur = await context.newPage();
      await cur.goto(origin + '/app');
      await cur.waitForFunction(async () => { await navigator.serviceWorker.ready; return Boolean(navigator.serviceWorker.controller) && (window as any).auraReady === true; }, null, { timeout: 15000 });
      await signIn('alicesynth@example.invalid');
      await cur.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      // Wipe the persisted worker state AND stop the worker: the restarted worker knows nothing about this page.
      await cur.evaluate(async () => { await caches.delete('aura-sw-state-v1'); });
      const cdp = await context.newCDPSession(cur);
      await cdp.send('ServiceWorker.enable');
      await cdp.send('ServiceWorker.stopAllWorkers');
      const urlBefore = cur.url();
      const st = await cur.evaluate(async () => (await (window as any).__nativeFetch('/api/goals')).status);
      await cur.waitForTimeout(1500);
      check(`CH12 (R5, real Chromium) after a worker restart with NO persisted state, a current-bundle page refused as out of date (${st}) is asked, answers, and is NOT reloaded`, st === 503 && cur.url() === urlBefore);
      // An old page under the restarted worker is still recovered.
      deploy.appHtml = 'old';
      const old = await context.newPage();
      await old.goto(origin + '/app');
      await old.waitForFunction(() => (window as any).oldReady === true && Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
      deploy.appHtml = 'new';
      await cdp.send('ServiceWorker.stopAllWorkers');
      const nav = old.waitForURL(/aura_reloaded=upgrade/, { timeout: 15000 }).then(() => true, () => false);
      await old.evaluate(async () => { await (window as any).handleLogout(); }).catch(() => undefined);
      check('CH12 (R5) after a restart an OLD page (cannot answer) is still reloaded after its refused sign-out; the session is untouched', (await nav) && (await cookieUser()) === A);
      await context.close();
    }

    // ------------------------------------------------------------ CH13 (R5) reload-loop protection persists across restarts (stale old HTML keeps being served)
    {
      deploy.sw = NEW_SW; deploy.appHtml = 'old'; // e.g. a stale copy of the old page keeps being served
      const { context, signIn } = await newContext();
      const old = await context.newPage();
      await old.goto(origin + '/app');
      await old.waitForFunction(async () => { await navigator.serviceWorker.ready; return Boolean(navigator.serviceWorker.controller) && (window as any).oldReady === true; }, null, { timeout: 15000 });
      await signIn('alicesynth@example.invalid');
      let navigations = 0;
      old.on('framenavigated', (f: any) => { if (f === old.mainFrame()) navigations++; });
      const first = old.waitForURL(/aura_reloaded=upgrade/, { timeout: 15000 }).then(() => true, () => false);
      await old.evaluate(async () => { await (window as any).handleLogout(); }).catch(() => undefined);
      const reloadedOnce = await first;
      await old.waitForFunction(() => (window as any).oldReady === true, null, { timeout: 15000 });
      await old.evaluate(async () => { await (window as any).handleLogout(); }).catch(() => undefined);
      await old.waitForTimeout(1500);
      const cdp = await context.newCDPSession(old);
      await cdp.send('ServiceWorker.enable');
      await cdp.send('ServiceWorker.stopAllWorkers');
      await old.evaluate(async () => { await (window as any).handleLogout(); }).catch(() => undefined);
      await old.waitForTimeout(1500);
      check(`CH13 (R5, real Chromium) a page that is still old after its reload is NOT reloaded again -- also after a worker restart (navigations: ${navigations})`, reloadedOnce && navigations === 1);
      deploy.appHtml = 'new';
      await context.close();
    }

    // ------------------------------------------------------------ CH14 (R5) a slow sign-out: the queued sign-in is refused, never sent out of order or reported complete
    {
      deploy.sw = NEW_SW; deploy.appHtml = 'new';
      const { context, open, signIn, cookieUser } = await newContext();
      const boot = await context.newPage();
      await boot.goto(origin + '/app');
      await boot.waitForFunction(async () => { await navigator.serviceWorker.ready; return Boolean(navigator.serviceWorker.controller); }, null, { timeout: 15000 });
      await signIn('alicesynth@example.invalid');
      const [x, y] = [await open(), await open()];
      for (const t of [x, y]) await t.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      const slow = hold('/api/auth/logout', 'after'); // processed, response withheld longer than the worker's settle bound
      const logout = x.evaluate(async (A: string) => (await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Aura-Expected-Account': A } })).status, A);
      await slow.arrived;
      const mark = serverLog.length;
      const t0 = Date.now();
      const siR = await y.evaluate(async () => (window as any).aura.si.verifySignInCode({ email: 'bobsynth@example.invalid', code: '123456' }));
      const si = siR.kind;
      const waited = Date.now() - t0;
      const sentEarly = serverLog.slice(mark).some((e) => e.path === '/api/auth/verify-code');
      slow.release();
      await logout;
      const now = await cookieUser();
      check(`CH14 (R5, real Chromium) behind a sign-out unsettled beyond the worker bound (8 s, below the client's own timeouts) the sign-in is answered "unsettled" (~${Math.round(waited / 1000)} s), NOT sent, and the app does not report it as signed in (${si}: "${siR.message}")`, !sentEarly && si !== 'VERIFIED' && /still in progress/i.test(siR.message ?? '') && waited >= 7000 && waited < 14000);
      check(`CH14 (R5) the slow sign-out then lands; no replacement session existed for it to clear (cookie now: ${now})`, now === null);
      await context.close();
    }

    // ------------------------------------------------------------ CH15 (R6) concurrent refusals from a CURRENT page, acknowledgement delayed 150 ms
    // The R5 independent assessment's probe: worker restarted with its state wiped, 8 concurrent refusals.
    for (const [label, sw] of [['R5 HEAD (a3a02b8) worker', R5_SW], ['current worker', NEW_SW]] as const) {
      deploy.sw = sw; deploy.appHtml = 'new';
      const { context, signIn } = await newContext();
      await context.addInitScript(() => {
        const proto = ServiceWorker.prototype;
        const send = proto.postMessage;
        proto.postMessage = function (message: any, ...options: any[]) {
          if (message?.type === 'AURA_ACCOUNT_BOUNDARY') { Reflect.apply(setTimeout, window, [() => Reflect.apply(send, this, [message, ...options]), 150]); return; }
          Reflect.apply(send, this, [message, ...options]);
        };
      });
      const cur = await context.newPage();
      await cur.goto(origin + '/app');
      await cur.waitForFunction(() => Boolean(navigator.serviceWorker.controller) && (window as any).auraReady, null, { timeout: 15000 });
      await signIn('alicesynth@example.invalid');
      await cur.evaluate(async () => { await caches.delete('aura-sw-state-v1'); });
      const cdp = await context.newCDPSession(cur);
      await cdp.send('ServiceWorker.enable');
      await cdp.send('ServiceWorker.stopAllWorkers');
      const before = cur.url();
      let domNavigations = 0;
      cur.on('framenavigated', (f: any) => { if (f === cur.mainFrame()) domNavigations++; });
      const statuses: number[] = await cur.evaluate(async () => Promise.all(Array.from({ length: 8 }, async () => (await (window as any).__nativeFetch('/api/goals')).status))).catch(() => []);
      await cur.waitForTimeout(1600);
      const reloaded = cur.url() !== before;
      console.log(`CH15 ${label}:`, JSON.stringify({ statuses, reloaded, domNavigations }));
      if (sw === R5_SW) check(`CH15 (R6, real Chromium) ${label} reproduces the assessment: 8 concurrent refusals + 150 ms acknowledgement -> the CURRENT page is reloaded`, statuses.length === 8 && statuses.every((x) => x === 503) && reloaded);
      else check(`CH15 (R6, real Chromium) ${label}: the same 8 concurrent refusals + 150 ms acknowledgement -> the current page is NOT reloaded (checks coalesced, acknowledgement correlated)`, statuses.length === 8 && statuses.every((x) => x === 503) && !reloaded && domNavigations === 0);
      await context.close();
    }
    deploy.sw = NEW_SW;

    // ------------------------------------------------------------ CH16 (R14) lost enqueue acknowledgement while ANOTHER real tab settles the request
    {
      store.logs.length = 0;
      const { context, open, signIn } = await newContext();
      await signIn('alicesynth@example.invalid');
      const [t1, t2] = [await open(), await open()];
      for (const t of [t1, t2]) await t.evaluate(async () => { await (window as any).aura.acct.fetchVerifiedSession(); });
      const mark = serverLog.length;
      // t1: the next read-write transaction commits in REAL Chromium IndexedDB, but its acknowledgement is withheld and
      // then delivered as an error (a synthetic lost acknowledgement at the caller boundary).
      await t1.evaluate(() => {
        const w = window as any;
        const orig = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...a: any[]) {
          const t = (orig as any).apply(this, a);
          if (t.mode === 'readwrite') {
            IDBDatabase.prototype.transaction = orig;
            t.addEventListener('complete', () => { const onerror = t.onerror; t.oncomplete = null; w.__releaseAck = () => onerror?.call(t, new Event('error')); });
          }
          return t;
        };
        w.__submission = w.aura.sync.submitActivityLog({ activityTitle: 'CH16 activity', activeWindow: 'NEUTRAL', logTimestamp: '2026-11-27T06:00:00.000Z', clientRequestId: 'ch16-req' }, 'tmp');
      });
      await t1.waitForFunction(() => typeof (window as any).__releaseAck === 'function');
      // t2 (same profile, real shared IndexedDB): past the claim lifetime, replays and settles the committed request.
      const rp = await t2.evaluate(async () => { const t0 = Date.now(); Date.now = () => t0 + 61_000; return (window as any).aura.sync.replayOfflineQueue(); });
      const kind = await t1.evaluate(async () => { (window as any).__releaseAck(); return (await (window as any).__submission).kind; });
      const posts = serverLog.slice(mark).filter((x) => x.path === '/api/habit-logs' && x.method === 'POST').length;
      const rows = store.logs.filter((l: any) => l.clientRequestId === 'ch16-req').length;
      console.log('CH16', JSON.stringify({ replay: rp, kind, posts, rows }));
      check(`CH16 (R14, real Chromium) commit + lost acknowledgement + another tab settles it -> the original caller gets already-recorded (never "not saved"); exactly 1 POST and 1 server row for the original request id (kind ${kind}, posts ${posts}, rows ${rows})`, rp.confirmed === 1 && kind === 'already-recorded' && posts === 1 && rows === 1 && store.logs.length === 1);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  const { finish } = require('./rel04AccountIsolationHarness');
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
