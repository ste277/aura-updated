/**
 * AURA-ANDROID-REL-04 (R6) -- the findings the R5 independent assessment
 * reproduced (AURA_ANDROID_REL_04_R5_INDEPENDENT_DISPOSITION_0c97d3a.md), each
 * run against the R5 code head a3a02b8 (vendored byte-for-byte in
 * test/fixtures/rel04-r5-head, re-checked against git when available) to show
 * the defect, and against the current code to show the correction.
 *
 *  Q1  two owned interim entries, same clientRequestId and payload, DIFFERENT accounts
 *      (exact assessment probe) -> both preserved, independently counted and discarded
 *      (R8: interim formats are quarantined, never migrated or replayed -- ticket 39224)
 *  Q2  temporary localStorage access denial + 45 days (exact assessment probe) -> reported
 *      unreadable, decision kept, restored access never recreates or replays the settled entry;
 *      Home and sign-out report "unavailable" (R8: the settled entry is an active one; its
 *      stale interim copy stays quarantined)
 *  W1  known current page, two overlapping recovery checks, acknowledgement arrives (exact worker probe)
 *  W2  three overlapping recovery checks for one old page (exact worker probe)
 *  W3  origin-wide limit persisted across restarts (exact worker probe; already correct in R5)
 *  B1  GET /api/plan-day/bootstrap with a missing or invalid session -> 401 (real route handler)
 *
 * The real-browser counterpart of W1 (concurrent refusals, 150 ms delayed
 * acknowledgement) is Chromium CH15 in test/rel04Chromium.test.ts; the real
 * production-build counterpart of B1 is N2 in test/rel04R5NextAppRendering.test.ts.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R6Findings.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage, store } from './rel04AccountIsolationHarness';

const R5 = 'a3a02b816e35733739f428e85cf0810c4f17f50a';
const FIX = path.join(__dirname, 'fixtures', 'rel04-r5-head');
const fx = (n: string) => fs.readFileSync(path.join(FIX, n), 'utf8');
const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const { NextRequest } = require(require.resolve('next/server', { paths: [path.join(WEB, 'app', 'api', 'habit-logs')] }));
const auth = require(path.join(WEB, 'lib', 'auth'));

(function provenance() {
  let available = true;
  try { execFileSync('git', ['cat-file', '-e', `${R5}^{commit}`], { stdio: 'ignore' }); } catch { available = false; }
  if (!available) { console.log('SKIP fixture re-check: a3a02b8 not in this checkout (shallow clone); fixtures used as vendored'); return; }
  for (const [src, f] of [['apps/web/public/sw.js', 'sw.js.txt'], ['apps/web/lib/offlineHabitQueue.ts', 'offlineHabitQueue.ts.txt'], ['apps/web/app/api/plan-day/bootstrap/route.ts', 'bootstrap.route.ts.txt']]) {
    check(`fixture ${f} == a3a02b8 ${src}`, execFileSync('git', ['show', `${R5}:${src}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(f));
  }
})();

function compile(source: string, fakeFile: string, overrides: Record<string, unknown> = {}) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = new Module(fakeFile, module);
  m.filename = fakeFile;
  m.paths = Module._nodeModulePaths(path.dirname(fakeFile));
  const orig = m.require.bind(m);
  m.require = (id: string) => (id in overrides ? overrides[id] : orig(id));
  m._compile(js, fakeFile);
  return m.exports;
}
const loadR5Queue = () => compile(fx('offlineHabitQueue.ts.txt'), path.join(WEB, 'lib', 'offlineHabitQueue.r5.js'));

const A = 'review-account-a';
const B = 'review-account-b';
addUser(A, 'queue-review-a@example.invalid');
addUser(B, 'queue-review-b@example.invalid');
const item = (ownerUserId: string, crid: string, title: string) => ({ ...payload(title, crid), ownerUserId, tempId: 'temp' });
const key = (owner: string, crid: string) => 'aura_q3:' + owner + ':' + crid;
const realNow = Date.now;
const lsDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const denyStorage = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage access denied'); } });
const restoreStorage = () => Object.defineProperty(globalThis, 'localStorage', lsDesc ?? { configurable: true, writable: true, value: storage });

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  closeAllTabs(); Date.now = realNow; restoreStorage();
  await clearQueueDb();
}

/** The assessment's Q1 probe, against a queue module `q`. */
async function probeQ1(q: any) {
  const a = item(A, 'same-id', 'same-payload');
  const b = { ...a, ownerUserId: B };
  storage.data.set(key(A, a.clientRequestId), JSON.stringify(a));
  storage.data.set(key(B, b.clientRequestId), JSON.stringify(b));
  const ra = await q.readOwnedQueue(A);
  const rb = await q.readOwnedQueue(B);
  return { a: ra.ok ? ra.records.length : -1, b: rb.ok ? rb.records.length : -1, bSourceStillPresent: storage.data.has(key(B, b.clientRequestId)) };
}

/** The assessment's Q2 probe: settle a migrated entry, deny localStorage for a read 45 days later, restore. */
async function probeQ2(loadFresh: () => any, q: any) {
  const x = item(A, 'marker-1', 'saved already');
  storage.data.set(key(A, 'marker-1'), JSON.stringify(x));
  storage.fail.remove = true; // the source's cleanup keeps failing
  const rx = await q.readOwnedQueue(A);
  await q.settleRecords(rx.records.filter((r: any) => r.item.clientRequestId === 'marker-1').map((r: any) => r.recordId));
  storage.fail.remove = false;
  const later = realNow() + 45 * 86400000;
  Date.now = () => later;
  const f = loadFresh();
  denyStorage();
  const unreadable = await f.readOwnedQueue(A);
  const markerKept = (await queueDump()).tombstones.length > 0;
  restoreStorage();
  const restored = await f.readOwnedQueue(A);
  Date.now = realNow;
  return { reportedUnreadable: !unreadable.ok, markerKept, restoredAlreadySettled: Boolean(restored.ok && restored.records.some((r: any) => r.item.clientRequestId === 'marker-1')), f };
}

/** R8: the same probe for the current code, whose only active format is an enqueued IndexedDB record (a stale interim copy re-appears). */
async function probeQ2R8(loadFresh: () => any, q: any) {
  const x = item(A, 'marker-1', 'saved already');
  await q.enqueueOwned(x);
  const rx = await q.readOwnedQueue(A);
  await q.settleRecords(rx.records.filter((r: any) => r.item.clientRequestId === 'marker-1').map((r: any) => r.recordId), undefined, { owner: A });
  storage.data.set(key(A, 'marker-1'), JSON.stringify(x)); // a stale interim copy of the settled entry
  const later = realNow() + 45 * 86400000;
  Date.now = () => later;
  const f = loadFresh();
  denyStorage();
  const unreadable = await f.readOwnedQueue(A);
  const markerKept = (await queueDump()).tombstones.length > 0;
  restoreStorage();
  const restored = await f.readOwnedQueue(A);
  Date.now = realNow;
  return { reportedUnreadable: !unreadable.ok, markerKept, restoredAlreadySettled: Boolean(restored.ok && restored.records.some((r: any) => r.item.clientRequestId === 'marker-1')), restoredPaused: restored.ok ? restored.paused : -1, f };
}

// ---------------------------------------------------------------- worker harness (the assessment's)
function workerHarness(source: string) {
  const state = new Map<string, string>();
  const clients = new Map<string, any>();
  const origin = 'http://127.0.0.1:12345';
  const worker = () => {
    const handlers: Record<string, any> = {};
    const self = { addEventListener: (n: string, h: any) => { handlers[n] = h; }, location: { origin }, clients: { get: async (id: string) => clients.get(id), matchAll: async () => [] } };
    const context: any = { self, caches: { open: async () => ({ match: async (k: string) => { const v = state.get(k); return v ? new Response(v) : undefined; }, put: async (k: string, v: Response) => { state.set(k, await v.text()); } }) }, URL, Response, setTimeout, clearTimeout };
    vm.runInNewContext(source, context);
    return { ...context, handlers };
  };
  const page = (id: string) => { const c: any = { id, type: 'window', url: origin + '/' + id, queries: 0, navigations: 0, postMessage() { c.queries++; }, navigate: async () => { c.navigations++; } }; clients.set(id, c); return c; };
  const until = async (f: () => boolean) => { const end = Date.now() + 2000; while (!f()) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };
  return { state, clients, worker, page, until };
}
async function workerProbes(source: string) {
  const h = workerHarness(source);
  // W3 origin limit across restart
  let w = h.worker();
  for (let i = 0; i < 2; i++) { const c = h.page('old-' + i); await w.reloadOutdatedClient(c.id); }
  w = h.worker();
  for (let i = 2; i < 5; i++) { const c = h.page('old-' + i); await w.reloadOutdatedClient(c.id); }
  const limit = [...h.clients.values()].map((c) => c.navigations).join(',');
  // W1 known current page, two overlapping checks
  h.state.clear();
  w = h.worker();
  const current = h.page('current');
  const calls = [w.reloadOutdatedClient(current.id), w.reloadOutdatedClient(current.id)];
  await h.until(() => current.queries >= 1).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 20));
  const waits: Promise<unknown>[] = [];
  w.handlers.message({ data: { type: 'AURA_ACCOUNT_BOUNDARY', version: 1 }, source: current, waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all([...calls, ...waits]);
  const w1 = { queries: current.queries, navigations: current.navigations };
  // W2 three overlapping checks for one old page
  h.state.clear();
  w = h.worker();
  const old = h.page('old-overlap');
  await Promise.all([w.reloadOutdatedClient(old.id), w.reloadOutdatedClient(old.id), w.reloadOutdatedClient(old.id)]);
  const st = h.state.values().next().value;
  const w2 = { queries: old.queries, navigations: old.navigations, budgetUsed: st ? JSON.parse(st).reloads.length : 0 };
  return { limit, w1, w2 };
}

async function main() {
  // ---------------------------------------------------------------- Q1 account-scoped migration identity
  await fresh();
  const r5q1 = await probeQ1(loadR5Queue());
  console.log('Q1 R5:', JSON.stringify(r5q1));
  check('Q1 R5 HEAD reproduces the assessment: two accounts, same id and payload -> ONE migrated entry, B\'s source deleted', r5q1.a === 1 && r5q1.b === 0 && r5q1.bSourceStillPresent === false);
  await fresh();
  const tab = openTab('q1');
  const cur1 = await probeQ1(tab.q);
  console.log('Q1 current (R8):', JSON.stringify(cur1));
  const dumpQ1 = await queueDump();
  const rqA = await tab.q.readOwnedQueue(A);
  const rqB = await tab.q.readOwnedQueue(B);
  check('Q1 CORRECTED (R8): each account keeps its own entry, quarantined in place (A paused 1, B paused 1); nothing migrated; both sources preserved', cur1.a === 0 && cur1.b === 0 && rqA.ok && rqA.paused === 1 && rqB.ok && rqB.paused === 1 && storage.data.has(key(A, 'same-id')) && storage.data.has(key(B, 'same-id')) && dumpQ1.records.length === 0);
  const dev = new Device();
  dev.signIn(A);
  await tab.acct.fetchVerifiedSession(dev.fetch as any);
  const rpA = await tab.sync.replayOfflineQueue(dev.fetch as any);
  check('Q1 (R8) replay for A sends nothing (quarantined entries are never sent; no server row for either account); B\'s entry is untouched', rpA.attempted === 0 && rpA.paused === 1 && logsOf(A).length === 0 && logsOf(B).length === 0 && storage.data.has(key(B, 'same-id')));
  const tabB = openTab('q1b');
  dev.signIn(B);
  await tabB.acct.fetchVerifiedSession(dev.fetch as any);
  const rbB = await tabB.q.readOwnedQueue(B);
  const dB = tabB.q.discardQuarantined(B, rbB.ok ? rbB.quarantined : []);
  check('Q1 (R8) B\'s discard removes exactly B\'s entry; A\'s identical entry is unaffected', rbB.ok && rbB.quarantined.length === 1 && dB.removed === 1 && !storage.data.has(key(B, 'same-id')) && storage.data.has(key(A, 'same-id')));
  storage.data.set(key(B, 'same-id'), JSON.stringify(item(B, 'same-id', 'same-payload')));
  const again = [await tab.q.readOwnedQueue(A), await tabB.q.readOwnedQueue(B)];
  check('Q1 (R8) a re-appearing source of either account stays quarantined for THAT account: never active', again.every((r) => r.ok && r.records.length === 0 && r.items.length === 0 && r.paused === 1));

  // ---------------------------------------------------------------- Q2 unreadable legacy storage
  await fresh();
  const r5mod = loadR5Queue();
  const r5q2 = await probeQ2(() => loadR5Queue(), r5mod);
  console.log('Q2 R5:', JSON.stringify({ reportedUnreadable: r5q2.reportedUnreadable, markerKept: r5q2.markerKept, restoredAlreadySettled: r5q2.restoredAlreadySettled }));
  check('Q2 R5 HEAD reproduces the assessment: denied storage read as retirement -> not reported unreadable, marker pruned, settled entry recreated', r5q2.reportedUnreadable === false && r5q2.markerKept === false && r5q2.restoredAlreadySettled === true);
  await fresh();
  const tq = openTab('q2');
  const cur2 = await probeQ2R8(() => openTab('q2-later').q, tq.q);
  console.log('Q2 current (R8):', JSON.stringify({ reportedUnreadable: cur2.reportedUnreadable, markerKept: cur2.markerKept, restoredAlreadySettled: cur2.restoredAlreadySettled }));
  check('Q2 CORRECTED: denied storage is reported UNREADABLE, the marker is KEPT, and restored access does not recreate the settled entry', cur2.reportedUnreadable === true && cur2.markerKept === true && cur2.restoredAlreadySettled === false);
  check('Q2 (R8) after access is restored the stale interim copy is preserved in place and quarantined (paused, never active); the decision never expires', storage.data.has(key(A, 'marker-1')) && cur2.restoredPaused === 1 && (await queueDump()).tombstones.length === 1);
  // Not eligible for replay after restore.
  const dev2 = new Device();
  dev2.signIn(A);
  await tq.acct.fetchVerifiedSession(dev2.fetch as any);
  const rp2 = await tq.sync.replayOfflineQueue(dev2.fetch as any);
  check('Q2 after restore the previously settled entry is not replayed', rp2.attempted === 0 && store.logs.length === 0);
  // Home and sign-out report "unavailable" while storage is denied.
  storage.data.set(key(A, 'pending-x'), JSON.stringify(item(A, 'pending-x', 'pending')));
  denyStorage();
  const home = await tq.q.readOfflineHabitQueue(A);
  let asked = '';
  const so = await tq.so.performSignOut({ fetch: dev2.fetch as any, confirm: (m: string) => { asked = m; return true; } });
  restoreStorage();
  check('Q2 while storage is denied Home\'s read is null (presented as unavailable, not empty) and sign-out asks "couldn\'t read" and reports the owned part UNKNOWN (kept)', home === null && /couldn't read this device's unsynced activity/.test(asked) && so.outcome === 'signed-out' && so.owned?.unknown === true && storage.data.has(key(A, 'pending-x')));

  // ---------------------------------------------------------------- W worker recovery
  const r5w = await workerProbes(fx('sw.js.txt'));
  console.log('W R5:', JSON.stringify(r5w));
  check('W3 R5 HEAD: origin limit across restart already held (1,1,1,0,0)', r5w.limit === '1,1,1,0,0');
  check('W1 R5 HEAD reproduces the assessment: a current page acknowledging two overlapping checks is still RELOADED', r5w.w1.navigations === 1);
  check('W2 R5 HEAD reproduces the assessment: three overlapping checks for one old page use all three reload slots', r5w.w2.navigations === 3 && r5w.w2.budgetUsed === 3);
  const curW = await workerProbes(fs.readFileSync(path.join(WEB, 'public', 'sw.js'), 'utf8'));
  console.log('W R6:', JSON.stringify(curW));
  check('W3 CORRECTED (preserved): origin limit across restart 1,1,1,0,0', curW.limit === '1,1,1,0,0');
  check('W1 CORRECTED: overlapping checks for a current page are coalesced; its acknowledgement answers them; NOT reloaded', curW.w1.navigations === 0 && curW.w1.queries === 1);
  check('W2 CORRECTED: three overlapping checks for one old page = ONE check, ONE reload, ONE slot', curW.w2.queries === 1 && curW.w2.navigations === 1 && curW.w2.budgetUsed === 1);

  // ---------------------------------------------------------------- B1 bootstrap authentication (real route handler)
  const reqTo = (cookie: string | null) => { const h = new Headers(); if (cookie) h.set('cookie', cookie); return new NextRequest('http://localhost/api/plan-day/bootstrap', { headers: h }); };
  let cookieHolder: { get: (n: string) => { value: string } | undefined } = { get: () => undefined };
  const r5route = compile(fx('bootstrap.route.ts.txt'), path.join(WEB, 'app', 'api', 'plan-day', 'bootstrap', 'route.r5.js'), { 'next/headers': { cookies: () => cookieHolder } });
  const r5Missing = await r5route.GET(reqTo(null));
  const r5MissingBody = await r5Missing.text();
  cookieHolder = { get: () => ({ value: 'not-a-valid-token' }) };
  const r5Invalid = await r5route.GET(reqTo('as_session=not-a-valid-token'));
  console.log('B1 R5:', r5Missing.status, r5MissingBody.slice(0, 80), '|', r5Invalid.status);
  check('B1 R5 HEAD reproduces the assessment: missing and invalid sessions get an empty 200', r5Missing.status === 200 && r5Invalid.status === 200 && /"timezone":null/.test(r5MissingBody));
  const route = require(path.join(WEB, 'app', 'api', 'plan-day', 'bootstrap', 'route'));
  const callsBefore = store.dbCalls.length;
  const m = await route.GET(reqTo(null));
  const i = await route.GET(reqTo('as_session=not-a-valid-token'));
  const callsAfterUnauth = store.dbCalls.length;
  const ghostToken = auth.createSessionToken('no-such-user', 'ghost@example.invalid');
  const g = await route.GET(reqTo(`as_session=${ghostToken}`));
  const mb = await m.json();
  check('B1 CORRECTED (real route): missing session -> 401 {"error":"Not authenticated."}, invalid -> 401, a session whose user no longer exists -> 401', m.status === 401 && mb.error === 'Not authenticated.' && i.status === 401 && g.status === 401 && m.headers.get('cache-control') === 'no-store');
  check('B1 the missing/invalid-session paths are refused before any data loader runs', callsAfterUnauth === callsBefore);

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
