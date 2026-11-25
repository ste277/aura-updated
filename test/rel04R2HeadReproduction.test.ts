/**
 * AURA-ANDROID-REL-04 (R3) -- the final independent disposition's findings
 * REPRODUCE on the R2 head (091e3ce) and are PREVENTED on the corrected head.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R2HeadReproduction.test.ts
 *
 * R2-head modules are vendored VERBATIM in test/fixtures/rel04-r2-head (CI is
 * a shallow clone) and re-checked byte for byte against 091e3ce when present.
 * They are loaded as ONE module set (their relative imports resolve to each
 * other), next to the corrected modules, against the same in-process harness.
 * Deterministic simulation, one process (real-browser checks: rel04Chromium).
 */
import { React, flush } from './jsdomReactHarness';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, closeAllTabs, finish, locks, logsOf, openTab, payload, queuedCrids, resetStore, routes, storage, store } from './rel04AccountIsolationHarness';

void React;
const R2 = '091e3ce90b62440bc0dc6fb25dc5666385d0ca65';
const FIX = path.join(__dirname, 'fixtures', 'rel04-r2-head');
const fx = (n: string) => fs.readFileSync(path.join(FIX, n), 'utf8');
const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const { NextRequest } = require(require.resolve('next/server', { paths: [path.join(WEB, 'app', 'api', 'habit-logs')] }));
const auth = require(path.join(WEB, 'lib', 'auth'));

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');

const FILES: Array<[string, string]> = [
  ['apps/web/lib/accountSession.ts', 'accountSession.ts.txt'],
  ['apps/web/lib/offlineHabitQueue.ts', 'offlineHabitQueue.ts.txt'],
  ['apps/web/lib/activitySync.ts', 'activitySync.ts.txt'],
  ['apps/web/lib/signOut.ts', 'signOut.ts.txt'],
  ['apps/web/lib/signInCode.ts', 'signInCode.ts.txt'],
  ['apps/web/lib/accountBoundFetch.ts', 'accountBoundFetch.ts.txt'],
  ['apps/web/middleware.ts', 'middleware.ts.txt'],
  ['apps/web/lib/edgeSession.ts', 'edgeSession.ts.txt'],
  ['apps/web/app/api/auth/logout/route.ts', 'logout.route.ts.txt'],
  ['apps/web/lib/expectedAccount.ts', 'expectedAccount.ts.txt'],
];
(function provenance() {
  let available = true;
  try { execFileSync('git', ['cat-file', '-e', `${R2}^{commit}`], { stdio: 'ignore' }); } catch { available = false; }
  if (!available) { console.log('SKIP fixture re-check: 091e3ce not in this checkout (shallow clone); fixtures used as vendored'); return; }
  for (const [src, f] of FILES) check(`fixture ${f} == 091e3ce ${src}`, execFileSync('git', ['show', `${R2}:${src}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(f));
})();

// ---------------------------------------------------------------- R2 module set
function compile(source: string, fakeFile: string, overrides: Record<string, unknown>) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = new Module(fakeFile, module);
  m.filename = fakeFile;
  m.paths = Module._nodeModulePaths(path.dirname(fakeFile));
  const orig = m.require.bind(m);
  m.require = (id: string) => (id in overrides ? overrides[id] : orig(id));
  m._compile(js, fakeFile);
  return m.exports;
}
function loadR2() {
  const lib = (n: string) => path.join(WEB, 'lib', `${n}.r2.js`);
  const acct = compile(fx('accountSession.ts.txt'), lib('accountSession'), {});
  const q = compile(fx('offlineHabitQueue.ts.txt'), lib('offlineHabitQueue'), {});
  const sync = compile(fx('activitySync.ts.txt'), lib('activitySync'), { './accountSession': acct, './offlineHabitQueue': q });
  const so = compile(fx('signOut.ts.txt'), lib('signOut'), { './accountSession': acct, './offlineHabitQueue': q });
  const si = compile(fx('signInCode.ts.txt'), lib('signInCode'), { './accountSession': acct });
  const bf = compile(fx('accountBoundFetch.ts.txt'), lib('accountBoundFetch'), { './accountSession': acct });
  const edge = compile(fx('edgeSession.ts.txt'), lib('edgeSession'), {});
  const mw = compile(fx('middleware.ts.txt'), path.join(WEB, 'middleware.r2.js'), { './lib/edgeSession': edge });
  const ea = compile(fx('expectedAccount.ts.txt'), lib('expectedAccount'), {});
  const logout = compile(fx('logout.route.ts.txt'), path.join(WEB, 'app', 'api', 'auth', 'logout', 'route.r2.js'), { '../../../../lib/expectedAccount': ea });
  acct.__resetAccountSessionForTests('r2-tab');
  return { acct, q, sync, so, si, bf, mw, logout };
}
const currentMw = require(path.join(WEB, 'middleware'));
const currentLogout = require(path.join(WEB, 'app', 'api', 'auth', 'logout', 'route'));

function req(method: string, url: string, cookieUser: string | null, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  if (cookieUser) h.set('cookie', `as_session=${auth.createSessionToken(cookieUser, store.users.get(cookieUser)!.email)}`);
  return new NextRequest(`http://localhost${url}`, { method, headers: h });
}
const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';
function fresh() { resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false }; locks.enabled = true; closeAllTabs(); }
const habitRoute = routes['POST /api/habit-logs'];

async function main() {
  // ---------------------------------------------------------------- E1 direct 502
  {
    fresh();
    const r2 = loadR2();
    const dev = new Device(); dev.signIn(A);
    await r2.acct.fetchVerifiedSession(dev.fetch);
    routes['POST /api/habit-logs'] = async () => Response.json({ error: 'bad gateway' }, { status: 502 });
    const o = await r2.sync.submitActivityLog(payload('A', 'crid-e1'), 't', dev.fetch);
    const r2Kept = [...storage.data.keys()].some((k) => k.includes('crid-e1'));
    routes['POST /api/habit-logs'] = habitRoute;
    check(`E1 R2 HEAD: a direct 502 DELETES the outbox entry (${o.kind}, kept=${r2Kept})`, o.kind === 'rejected' && !r2Kept);
    fresh();
    const tab = openTab('tab1'); dev.signIn(A); await tab.acct.fetchVerifiedSession(dev.fetch as any);
    routes['POST /api/habit-logs'] = async () => Response.json({ error: 'bad gateway' }, { status: 502 });
    const o2 = await tab.sync.submitActivityLog(payload('A', 'crid-e1'), 't', dev.fetch as any);
    routes['POST /api/habit-logs'] = habitRoute;
    check('E1 CORRECTED: kept as queued', o2.kind === 'queued' && queuedCrids(A).includes('crid-e1'));
  }

  // ---------------------------------------------------------------- E2 per-entry read exception
  {
    fresh();
    const r2 = loadR2();
    storage.data.set(`aura_q3:${A}:crid-e2`, JSON.stringify({ ...payload('A', 'crid-e2'), ownerUserId: A, tempId: 't' }));
    const realGet = storage.getItem.bind(storage);
    (storage as any).getItem = (k: string) => { if (k.startsWith('aura_q3:')) throw new Error('read denied'); return realGet(k); };
    const r = r2.q.readOwnedQueue(A);
    (storage as any).getItem = realGet;
    check(`E2 R2 HEAD: a per-entry read exception looks like a successful EMPTY queue (ok=${r.ok}, items=${r.ok ? r.items.length : '-'})`, r.ok === true && r.items.length === 0);
    fresh();
    const tab = openTab('tab1');
    storage.data.set(`aura_q4:${A}:crid-e2:r1`, JSON.stringify({ ...payload('A', 'crid-e2'), ownerUserId: A, tempId: 't', recordId: 'r1' }));
    (storage as any).getItem = (k: string) => { if (k.startsWith('aura_q4:')) throw new Error('read denied'); return realGet(k); };
    const r3 = tab.q.readOwnedQueue(A);
    (storage as any).getItem = realGet;
    check('E2 CORRECTED: unreadable (ok:false)', r3.ok === false);
  }

  // ---------------------------------------------------------------- E3 identity overwrite
  {
    fresh();
    const r2 = loadR2();
    r2.q.enqueueOwned({ ...payload('original', 'crid-e3'), ownerUserId: A, tempId: 't' });
    r2.q.enqueueOwned({ ...payload('DIFFERENT', 'crid-e3'), ownerUserId: A, tempId: 't' });
    const items = r2.q.readOfflineHabitQueue(A);
    check(`E3 R2 HEAD: a different payload OVERWRITES the identity (now "${items[0]?.activityTitle}")`, items.length === 1 && items[0].activityTitle === 'DIFFERENT');
    fresh();
    const tab = openTab('tab1');
    tab.q.enqueueOwned({ ...payload('original', 'crid-e3'), ownerUserId: A, tempId: 't' });
    const c = tab.q.enqueueOwned({ ...payload('DIFFERENT', 'crid-e3'), ownerUserId: A, tempId: 't' });
    check('E3 CORRECTED: refused (conflict); the original is kept', c.status === 'conflict' && tab.q.readOfflineHabitQueue(A)[0]?.activityTitle === 'original');
  }

  // ---------------------------------------------------------------- E4 migration resurrection
  {
    fresh();
    const r2 = loadR2();
    const v2Key = 'offline_habit_queue_v2:' + A;
    const src = JSON.stringify([{ ...payload('v2', 'crid-e4'), ownerUserId: A, tempId: 't' }]);
    storage.data.set(v2Key, src);
    r2.q.readOwnedQueue(A); // migrates
    r2.q.removeOwnedEntries(A, ['crid-e4']); // settled
    storage.data.set(v2Key, src); // a concurrent context re-writes / still holds the source
    const again = r2.q.readOfflineHabitQueue(A);
    check('E4 R2 HEAD: a concurrent migration RECREATES the settled entry', again.length === 1);
    fresh();
    const tab = openTab('tab1');
    storage.data.set(v2Key, src);
    const first = tab.q.readOwnedQueue(A);
    if (first.ok) tab.q.removeRecords(first.records);
    storage.data.set(v2Key, src);
    check('E4 CORRECTED: tombstoned, not recreated', tab.q.readOfflineHabitQueue(A).length === 0);
  }

  // ---------------------------------------------------------------- E5 unreadable snapshot reported as clean
  {
    fresh();
    const r2 = loadR2();
    const dev = new Device(); dev.signIn(A);
    await r2.acct.fetchVerifiedSession(dev.fetch);
    const realGet = storage.getItem.bind(storage);
    (storage as any).getItem = (k: string) => { if (k.startsWith('aura_q3:')) throw new Error('read denied'); return realGet(k); };
    storage.data.set(`aura_q3:${A}:x`, '{}');
    const out = await r2.so.performSignOut({ fetch: dev.fetch, confirm: () => true });
    (storage as any).getItem = realGet;
    check(`E5 R2 HEAD: an unreadable owned snapshot still yields a "clean" logout (discardFailed=${out.discardFailed})`, out.outcome === 'signed-out' && out.discardFailed === 0);
    // corrected: Q2 in rel04R3QueueAuth (discardUnknown = true)
  }

  // ---------------------------------------------------------------- E6 sign-in 4xx treated as definitive
  {
    fresh();
    const r2 = loadR2();
    const dev = new Device(); dev.cookie = null;
    await r2.acct.fetchVerifiedSession(dev.fetch);
    const realVerify = routes['POST /api/auth/verify-code'];
    routes['POST /api/auth/verify-code'] = async () => { dev.signIn(B); return Response.json({ error: 'proxy said no' }, { status: 400 }); };
    const before = dev.count('GET', '/api/auth/session');
    const r = await r2.si.verifySignInCode({ email: 'b@x', code: '1' }, dev.fetch);
    check(`E6 R2 HEAD: a sign-in 4xx resumes the prior (signed-out) state WITHOUT reconciliation, though the session is now B (${r.kind}, account=${r2.acct.getVerifiedAccount()})`, r.kind === 'REJECTED' && dev.count('GET', '/api/auth/session') === before && r2.acct.getVerifiedAccount() === null && dev.sessionUser() === B);
    if (realVerify) routes['POST /api/auth/verify-code'] = realVerify; else delete routes['POST /api/auth/verify-code'];
  }

  // ---------------------------------------------------------------- E7/E8 middleware pass-through
  {
    const r2 = loadR2();
    const headerless = await r2.mw.middleware(req('GET', '/api/goals', B));
    const headerlessNow = await currentMw.middleware(req('GET', '/api/goals', B));
    check('E7 R2 HEAD: a headerless account-scoped read with a session PASSES the middleware', passes(headerless));
    check('E7 CORRECTED: refused 503 client_upgrade_required', headerlessNow.status === 503 && (await headerlessNow.json()).code === 'client_upgrade_required');
    const env = { node: process.env.NODE_ENV, secret: process.env.AUTH_SECRET };
    (process.env as any).NODE_ENV = 'production'; delete process.env.AUTH_SECRET;
    const unverifiable = await r2.mw.middleware(req('GET', '/api/goals', B, { 'X-Aura-Expected-Account': A }));
    const unverifiableNow = await currentMw.middleware(req('GET', '/api/goals', B, { 'X-Aura-Expected-Account': A }));
    (process.env as any).NODE_ENV = env.node; if (env.secret) process.env.AUTH_SECRET = env.secret;
    check('E8 R2 HEAD: when the edge cannot verify the cookie, a mismatched request PASSES silently', passes(unverifiable));
    check('E8 CORRECTED: fails closed (503 account_check_unavailable)', unverifiableNow.status === 503 && (await unverifiableNow.json()).code === 'account_check_unavailable');
    const mcpMgmt = await r2.mw.middleware(req('GET', '/api/mcp/connections', B));
    const mcpMgmtNow = await currentMw.middleware(req('GET', '/api/mcp/connections', B));
    check('E7b R2 HEAD: Connected Apps management (/api/mcp/connections) passes headerless; CORRECTED: account-scoped (503)', passes(mcpMgmt) && mcpMgmtNow.status === 503);
  }

  // ---------------------------------------------------------------- E9 headerless legacy logout clears the cookie
  {
    const r2 = loadR2();
    const old = await r2.logout.POST(req('POST', '/api/auth/logout', B));
    const now = await currentLogout.POST(req('POST', '/api/auth/logout', B));
    check('E9 R2 HEAD: an unbound (old-client) logout CLEARS the current (replacement) session cookie', /Max-Age=0/i.test(old.headers.get('set-cookie') ?? ''));
    check('E9 CORRECTED: refused 503, no Set-Cookie', now.status === 503 && !now.headers.get('set-cookie'));
  }

  // ---------------------------------------------------------------- E10 wrapper forwards while unverified
  {
    fresh();
    const r2 = loadR2();
    const dev = new Device(); dev.signIn(B);
    (window as any).fetch = dev.fetch;
    r2.bf.__resetAccountBoundFetchForTests();
    r2.bf.installAccountBoundFetch();
    await (window as any).fetch('/api/goals');
    const sent = dev.calls.filter((c) => c.key === 'GET /api/goals');
    check(`E10 R2 HEAD: with the account UNKNOWN the wrapper forwards an account-scoped read without any account statement (header=${sent[0]?.expected})`, sent.length === 1 && sent[0].expected === null);
    // corrected: rel04R3BoundaryJsdom B3
  }

  // ---------------------------------------------------------------- E11 legacy reassignment
  {
    fresh();
    const r2 = loadR2();
    storage.data.set('offline_habit_queue', JSON.stringify([{ ...payload('someone else private', 'crid-e11') }]));
    const r = r2.q.adoptLegacyQueue(A);
    check('E11 R2 HEAD: unowned legacy entries can be ASSIGNED to the signed-in account', r.ok && r2.q.readOfflineHabitQueue(A).some((i: any) => i.activityTitle === 'someone else private'));
    const tab = openTab('tab1');
    check('E11 CORRECTED: no assignment API exists', !('adoptLegacyQueue' in tab.q));
  }

  // ---------------------------------------------------------------- E12 cross-tab suspension ignores a held Web Lock
  {
    fresh();
    const r2 = loadR2();
    const dev = new Device(); dev.signIn(A);
    await r2.acct.fetchVerifiedSession(dev.fetch);
    let release!: () => void;
    const held = locks.request('aura-auth-transition', {}, () => new Promise<void>((r) => { release = r; })); // another tab's transition, no marker
    await flush();
    const o = await r2.sync.submitActivityLog(payload('during other tab sign-out', 'crid-e12'), 't', dev.fetch);
    check(`E12 R2 HEAD: with another tab holding the auth lock but no marker, a write is SENT (${o.kind})`, o.kind === 'confirmed' && logsOf(A).length === 1);
    release(); await held;
    // corrected: A2 in rel04R3QueueAuth
  }

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
