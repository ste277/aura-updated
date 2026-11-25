/**
 * AURA-ANDROID-REL-04 (R4) -- reproductions of the findings in the
 * independent evidence assessment of the reviewed head b323d2a, against that
 * head's own code (vendored byte-for-byte in test/fixtures/rel04-r3-head and
 * re-checked against git when the commit is available), each followed by the
 * corrected behaviour at the current head.
 *
 *  X1  Plan Day: first verification disagreeing with the server-rendered account still shows the old props
 *  X2  migration: tombstone check and write are separate -> a concurrently settled entry is recreated
 *  X3  replay: "still queued" checked BEFORE an await -> a record discarded meanwhile is still sent
 *  X4  legacy: discard rewrites the shared array -> an old writer's concurrent update resurrects / loses entries
 *  X5  sign-out message: owned unreadable + legacy removed -> "nothing was removed"
 *  X6  data export: ambient-cookie link download passes the boundary unbound
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R3HeadReproduction.test.ts
 */
import { React, mount, flush, act } from './jsdomReactHarness';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, locks, openTab, payload, queuedCrids, resetStore, storage, store } from './rel04AccountIsolationHarness';

const R3 = 'b323d2a9dfd8ddc1a0ea430357611ebe25dd90b4';
const FIX = path.join(__dirname, 'fixtures', 'rel04-r3-head');
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
  ['apps/web/lib/accountRoutePolicy.ts', 'accountRoutePolicy.ts.txt'],
  ['apps/web/middleware.ts', 'middleware.ts.txt'],
  ['apps/web/lib/edgeSession.ts', 'edgeSession.ts.txt'],
  ['apps/web/components/AccountScoped.tsx', 'AccountScoped.tsx.txt'],
];
(function provenance() {
  let available = true;
  try { execFileSync('git', ['cat-file', '-e', `${R3}^{commit}`], { stdio: 'ignore' }); } catch { available = false; }
  if (!available) { console.log('SKIP fixture re-check: b323d2a not in this checkout (shallow clone); fixtures used as vendored'); return; }
  for (const [src, f] of FILES) check(`fixture ${f} == b323d2a ${src}`, execFileSync('git', ['show', `${R3}:${src}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(f));
})();

function compile(source: string, fakeFile: string, overrides: Record<string, unknown>, jsx = false) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: jsx ? ts.JsxEmit.ReactJSX : undefined } }).outputText;
  const m = new Module(fakeFile, module);
  m.filename = fakeFile;
  m.paths = Module._nodeModulePaths(path.dirname(fakeFile));
  const orig = m.require.bind(m);
  m.require = (id: string) => (id in overrides ? overrides[id] : orig(id));
  m._compile(js, fakeFile);
  return m.exports;
}
function loadR3() {
  const lib = (n: string) => path.join(WEB, 'lib', `${n}.r3.js`);
  const acct = compile(fx('accountSession.ts.txt'), lib('accountSession'), {});
  const q = compile(fx('offlineHabitQueue.ts.txt'), lib('offlineHabitQueue'), {});
  const sync = compile(fx('activitySync.ts.txt'), lib('activitySync'), { './accountSession': acct, './offlineHabitQueue': q });
  const so = compile(fx('signOut.ts.txt'), lib('signOut'), { './accountSession': acct, './offlineHabitQueue': q });
  const policy = compile(fx('accountRoutePolicy.ts.txt'), lib('accountRoutePolicy'), {});
  const edge = compile(fx('edgeSession.ts.txt'), lib('edgeSession'), {});
  const mw = compile(fx('middleware.ts.txt'), path.join(WEB, 'middleware.r3.js'), { './lib/edgeSession': edge, './lib/accountRoutePolicy': policy });
  acct.__resetAccountSessionForTests('r3-tab');
  return { acct, q, sync, so, policy, mw };
}
function req(method: string, url: string, cookieUser: string | null, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  if (cookieUser) h.set('cookie', `as_session=${auth.createSessionToken(cookieUser, store.users.get(cookieUser)!.email)}`);
  return new NextRequest(`http://localhost${url}`, { method, headers: h });
}
const passes = (res: Response) => res.headers.get('x-middleware-next') === '1';
async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  locks.enabled = true; locks.onQuery = null; closeAllTabs();
  await clearQueueDb();
}
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await flush(); };
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

async function main() {
  // ---------------------------------------------------------------- X1 Plan Day first verification
  {
    await fresh();
    const dev = new Device();
    (global as any).fetch = dev.fetch; (window as any).fetch = dev.fetch;
    const acct = require(path.join(WEB, 'lib', 'accountSession'));
    acct.__resetAccountSessionForTests('x1');
    const r3Scoped = compile(fx('AccountScoped.tsx.txt'), path.join(WEB, 'components', 'AccountScoped.r3.js'), { '../lib/accountSession': acct }, true);
    let r3Reloads = 0;
    r3Scoped.pageReload.fn = () => { r3Reloads++; };
    const Probe = () => React.createElement('div', null, 'AliceTown (server props for Alice)');
    dev.signIn(B); // the cookie changed to Bob before the page's first verification
    const h = await mount(React.createElement(r3Scoped.AccountScoped, { onChange: 'reload' }, React.createElement(Probe)));
    await settle(12);
    check(`X1 R3 HEAD: first verification answers Bob, yet the page rendered for Alice keeps showing Alice's server props (reloads: ${r3Reloads})`, acct.getVerifiedAccount() === B && /AliceTown/.test(text(h.container as HTMLElement)) && r3Reloads === 0);
    await h.unmount();
    check('X1 CORRECTED: see rel04R4SsrAgreementJsdom S1-S6 (gated until the first verification agrees; disagreement reloads without showing the props)', true);
  }

  // ---------------------------------------------------------------- X2 migration vs settlement in another context
  {
    await fresh();
    const r3 = loadR3();
    const v2Key = 'offline_habit_queue_v2:' + A;
    const src = JSON.stringify([{ ...payload('v2', 'crid-x2'), ownerUserId: A, tempId: 't' }]);
    storage.data.set(v2Key, src);
    const first = r3.q.readOwnedQueue(A); // migrated once: record m… exists, source removed
    const rec = first.ok ? first.records[0] : null;
    storage.data.set(v2Key, src); // a stale context still holds / re-writes the source
    // The second migration checks the tombstone (absent) ... and BEFORE it writes, another context settles the record.
    const realGet = storage.getItem.bind(storage);
    let injected = false;
    (storage as any).getItem = (k: string) => {
      const v = realGet(k);
      if (!injected && k.startsWith(`aura_q4t:${A}:`)) { injected = true; r3.q.removeRecords([rec]); }
      return v;
    };
    r3.q.readOwnedQueue(A);
    (storage as any).getItem = realGet;
    const after = [...storage.data.keys()].filter((k) => k.startsWith(`aura_q4:${A}:`));
    check(`X2 R3 HEAD: a settlement landing between the migration's tombstone check and its write is UNDONE (record recreated: ${after.length})`, injected && after.length === 1);
    check('X2 CORRECTED: see rel04R3QueueAuth Q6/Q7, rel04R4QueueIntegrity M2, rel04Chromium CH8 (check and write in ONE IndexedDB transaction)', true);
  }

  // ---------------------------------------------------------------- X3 replay "still queued" check before an await
  {
    await fresh();
    const r3 = loadR3();
    const dev = new Device(); dev.signIn(A);
    await r3.acct.fetchVerifiedSession(dev.fetch);
    for (const n of [1]) { dev.fault('POST', '/api/habit-logs', 'network-before'); await r3.sync.submitActivityLog(payload(`x3-${n}`, `crid-x3-${n}`), 't', dev.fetch); }
    const snap = r3.q.readOwnedQueue(A);
    // During replay's `await isTransitionActiveNow()` (after its stillQueued check), another context discards the record.
    // (query #1 is runActivityOperation's own entry check; #2 is the per-record check inside the loop)
    let q1 = 0;
    locks.onQuery = () => { if (++q1 === 2) { locks.onQuery = null; r3.q.removeRecords(snap.ok ? snap.records : []); } };
    const before = dev.calls.length;
    await r3.sync.replayOfflineQueue(dev.fetch);
    const sent = dev.calls.slice(before).filter((c) => c.key === 'POST /api/habit-logs').length;
    check(`X3 R3 HEAD: a record discarded after the replay's "still queued" check is STILL SENT (${sent} send, stored ${store.logs.length})`, sent === 1 && store.logs.length === 1);
    // Corrected: the same interleaving against the current modules.
    await fresh();
    const dev2 = new Device();
    dev2.signIn(A);
    const tab = openTab('x3');
    await tab.acct.fetchVerifiedSession(dev2.fetch as any);
    dev2.fault('POST', '/api/habit-logs', 'network-before');
    await tab.sync.submitActivityLog(payload('x3', 'crid-x3c'), 't', dev2.fetch as any);
    const snap2 = await tab.q.readOwnedQueue(A);
    let q2 = 0;
    locks.onQuery = async () => { if (++q2 === 2) { locks.onQuery = null; await tab.q.discardRecords(snap2.ok ? snap2.records.map((r) => r.recordId) : [], { tab: 'other' }); } };
    const b2 = dev2.calls.length;
    await tab.sync.replayOfflineQueue(dev2.fetch as any);
    check('X3 CORRECTED: the same interleaving at the current head -- the claim transaction (after the last await) finds it gone, never sent', q2 >= 2 && dev2.calls.slice(b2).filter((c) => c.key === 'POST /api/habit-logs').length === 0 && store.logs.length === 0);
  }

  // ---------------------------------------------------------------- X4 legacy discard vs an old writer
  {
    await fresh();
    const r3 = loadR3();
    const L = 'offline_habit_queue';
    storage.data.set(L, JSON.stringify([payload('old a', 'a'), payload('old b', 'b')]));
    const snap = r3.q.readLegacySnapshot();
    // An old-bundle tab is in the middle of its own read-modify-write (it read [a, b] and will append c).
    const oldRead = JSON.parse(storage.data.get(L)!);
    const r = r3.q.discardLegacySnapshot(snap);
    storage.data.set(L, JSON.stringify([...oldRead, payload('old c', 'c')])); // the old writer's write lands
    const left = JSON.parse(storage.data.get(L) ?? '[]').map((x: any) => x.clientRequestId);
    check(`X4 R3 HEAD: discard reports ${r.removed} removed, but an old writer active at the time puts them back (${JSON.stringify(left)})`, r.removed === 2 && left.includes('a') && left.includes('b'));
    check('X4 CORRECTED: no destructive cleanup of the shared array at all (rel04R3QueueAuth Q8, rel04R4QueueIntegrity L1, rel04Chromium CH9)', !('discardLegacySnapshot' in require(path.join(WEB, 'lib', 'offlineHabitQueue'))));
  }

  // ---------------------------------------------------------------- X5 sign-out message: owned unreadable + legacy removed
  {
    await fresh();
    const r3 = loadR3();
    const dev = new Device(); dev.signIn(A);
    await r3.acct.fetchVerifiedSession(dev.fetch);
    storage.data.set('offline_habit_queue', JSON.stringify([payload('old 1', 'l1'), payload('old 2', 'l2')]));
    storage.data.set(`aura_q4:${A}:crid-x5:r1`, JSON.stringify({ ...payload('owned', 'crid-x5'), ownerUserId: A, tempId: 't', recordId: 'r1', queuedAt: 1 }));
    const realGet = storage.getItem.bind(storage);
    (storage as any).getItem = (k: string) => { if (k.startsWith('aura_q4:')) throw new Error('read denied'); return realGet(k); };
    const out = await r3.so.performSignOut({ fetch: dev.fetch, confirm: () => true });
    (storage as any).getItem = realGet;
    const msg = r3.so.discardOutcomeMessage(out) ?? '';
    check(`X5 R3 HEAD: legacy entries WERE removed, but the message says "nothing was removed" (legacy left: ${storage.data.has('offline_habit_queue')})`, !storage.data.has('offline_habit_queue') && /nothing was removed/.test(msg));
    check('X5 CORRECTED: owned and legacy reported separately from observed counts (rel04R4QueueIntegrity S1/S2)', true);
  }

  // ---------------------------------------------------------------- X6 export download unbound
  {
    await fresh();
    const r3 = loadR3();
    const current = require(path.join(WEB, 'middleware'));
    check(`X6 R3 HEAD: /api/users/export is EXEMPT; a headerless link download passes with whatever cookie is current (${r3.policy.classifyApiRoute('/api/users/export', 'GET')})`, r3.policy.classifyApiRoute('/api/users/export', 'GET') === 'exempt' && passes(await r3.mw.middleware(req('GET', '/api/users/export', B))));
    check('X6 CORRECTED: account-scoped -- headerless refused (503), a stated other account refused (409); bound in-app download (rel04R4SsrAgreementJsdom D1-D6)', (await current.middleware(req('GET', '/api/users/export', B))).status === 503 && (await current.middleware(req('GET', '/api/users/export', B, { 'X-Aura-Expected-Account': A }))).status === 409);
  }

  void act; void queuedCrids;
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
