/**
 * AURA-ANDROID-REL-04 (R2) -- the delta review's findings REPRODUCE on the R1
 * head (d09449b) and are PREVENTED on the corrected head.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R1HeadReproduction.test.ts
 *
 * R1-head code is vendored VERBATIM in test/fixtures/rel04-r1-head (CI checks
 * out shallow) and re-checked byte for byte against d09449b when available.
 * The pre-REL-04 client (a54daf6) comes from test/fixtures/rel04-reviewed-head.
 * Both run against the same harness as the corrected code. Interleavings are
 * deterministic simulations in one process, not real browser processes.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, logsOf, openTab, payload, resetStore, routes, storage, store } from './rel04AccountIsolationHarness';

const R1 = 'd09449b655d21c213f8bbb29cf90f5bdc71c208e';
const FIX = path.join(__dirname, 'fixtures', 'rel04-r1-head');
const OLD = path.join(__dirname, 'fixtures', 'rel04-reviewed-head');
const fx = (dir: string, n: string) => fs.readFileSync(path.join(dir, n), 'utf8');
const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const { NextRequest } = require(require.resolve('next/server', { paths: [path.join(WEB, 'app', 'api', 'habit-logs')] }));
const auth = require(path.join(WEB, 'lib', 'auth'));

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');

// ---------------------------------------------------------------- provenance
(function verify() {
  let available = true;
  try { execFileSync('git', ['cat-file', '-e', `${R1}^{commit}`], { stdio: 'ignore' }); } catch { available = false; }
  if (!available) { console.log('SKIP fixture re-check: d09449b not in this checkout (shallow clone); fixtures used as vendored'); return; }
  const files: Array<[string, string]> = [
    ['apps/web/app/api/habit-logs/route.ts', 'habit-logs.route.ts.txt'],
    ['apps/web/app/api/plans/route.ts', 'plans.route.ts.txt'],
    ['apps/web/app/api/auth/logout/route.ts', 'logout.route.ts.txt'],
    ['apps/web/lib/expectedAccount.ts', 'expectedAccount.ts.txt'],
    ['apps/web/lib/offlineHabitQueue.ts', 'offlineHabitQueue.ts.txt'],
    ['apps/web/lib/accountSession.ts', 'accountSession.ts.txt'],
    ['apps/web/components/LocationPicker.tsx', 'LocationPicker.tsx.txt'],
  ];
  for (const [src, f] of files) check(`fixture ${f} == d09449b ${src}`, execFileSync('git', ['show', `${R1}:${src}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(FIX, f));
})();

// ---------------------------------------------------------------- loaders
function compile(source: string, fakeFile: string, overrides: Record<string, unknown> = {}) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const m = new Module(fakeFile, module);
  m.filename = fakeFile;
  m.paths = Module._nodeModulePaths(path.dirname(fakeFile));
  const orig = m.require.bind(m);
  m.require = (id: string) => (id in overrides ? overrides[id] : orig(id));
  m._compile(js, fakeFile);
  return m.exports;
}
const r1Expected = compile(fx(FIX, 'expectedAccount.ts.txt'), path.join(WEB, 'lib', 'expectedAccount.r1.js'));
const r1HabitRoute = compile(fx(FIX, 'habit-logs.route.ts.txt'), path.join(WEB, 'app', 'api', 'habit-logs', 'route.r1.js'), { '../../../lib/expectedAccount': r1Expected });
const r1PlansRoute = compile(fx(FIX, 'plans.route.ts.txt'), path.join(WEB, 'app', 'api', 'plans', 'route.r1.js'), { '../../../lib/expectedAccount': r1Expected });
const r1Logout = compile(fx(FIX, 'logout.route.ts.txt'), path.join(WEB, 'app', 'api', 'auth', 'logout', 'route.r1.js'));
const r1Queue = compile(fx(FIX, 'offlineHabitQueue.ts.txt'), path.join(WEB, 'lib', 'offlineHabitQueue.r1.js'));
const currentQueue = require(path.join(WEB, 'lib', 'offlineHabitQueue'));
const { classifyHabitLogSyncOutcome } = require(path.join(WEB, 'lib', 'habitLogSyncPolicy'));

function compileBlock(params: string[], body: string) {
  const js = ts.transpileModule(`async function __b(${params.join(', ')}) {\n${body}\n}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return vm.runInThisContext(`(${js.trim().replace(/;$/, '')})`);
}
const oldReplay = compileBlock(['localStorage', 'fetch', 'classifyHabitLogSyncOutcome', 'loadUserDataAndLogs', 'loadMyDay'], `${fx(OLD, 'page.syncOfflineLogs.txt')}\n    return syncOfflineLogs();`);
const oldEnqueue = compileBlock(['localStorage', 'payload', 'tempId'], fx(OLD, 'page.enqueue.txt'));

function req(method: string, url: string, cookieUser: string | null, headers: Record<string, string> = {}, body?: unknown) {
  const h = new Headers(headers);
  if (cookieUser) h.set('cookie', `as_session=${auth.createSessionToken(cookieUser, store.users.get(cookieUser)!.email)}`);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new NextRequest(`http://localhost${url}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const current = { habit: routes['POST /api/habit-logs'] };
function fresh() { resetStore(); storage.clear(); closeAllTabs(); routes['POST /api/habit-logs'] = current.habit; }

async function main() {
  // ================= D1 deployment compatibility: pre-REL-04 client vs R1 route (428) and corrected route (503)
  for (const sessionState of ['valid', 'expired'] as const) {
    for (const head of ['R1', 'corrected'] as const) {
      fresh();
      routes['POST /api/habit-logs'] = head === 'R1' ? (r) => r1HabitRoute.POST(r) : current.habit;
      const dev = new Device();
      dev.useMiddleware = head !== 'R1'; // the R1 head had no middleware
      dev.signIn(A);
      for (const n of [1, 2, 3]) await oldEnqueue(storage, payload(`A pending ${n}`, `crid-d1-${n}`), `t${n}`);
      const before = storage.data.get('offline_habit_queue');
      if (sessionState === 'expired') dev.cookie = null;
      await oldReplay(storage, dev.fetch, classifyHabitLogSyncOutcome, () => {}, () => {});
      const after = storage.data.get('offline_habit_queue');
      const statuses = dev.calls.filter((c) => c.key === 'POST /api/habit-logs').map((c) => c.status);
      if (head === 'R1') {
        check(`D1 R1 HEAD (${sessionState} session): old client's 3 pending entries are DELETED (${statuses.join(',')})`, before !== undefined && after === undefined && store.logs.length === 0);
      } else {
        check(`D1 CORRECTED (${sessionState} session): every request refused 503 upgrade, nothing written, entries kept BYTE FOR BYTE`, statuses.length === 3 && statuses.every((s) => s === 503) && after === before && store.logs.length === 0);
      }
    }
  }
  {
    // The new client keeps such legacy entries quarantined and never assigns them.
    fresh();
    const dev = new Device();
    dev.signIn(A);
    for (const n of [1, 2]) await oldEnqueue(storage, payload(`legacy ${n}`, `crid-lg-${n}`), `t${n}`);
    const tab = openTab('tab1');
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('D1 CORRECTED new client: legacy entries are not replayed or assigned automatically (quarantined)', r.attempted === 0 && store.logs.length === 0 && storage.data.has('offline_habit_queue'));
    check('D1 CORRECTED (R3): there is no way to assign unowned legacy entries to an account (no adopt API)', !('adoptLegacyQueue' in tab.q));
    const snap = tab.q.readLegacySnapshot();
    check('D1 CORRECTED (R4): they are counted, kept unchanged (never rewritten while older writers may be active), and nothing is stored for any account', snap.ok && snap.count === 2 && storage.data.has('offline_habit_queue') && !('discardLegacySnapshot' in tab.q) && store.logs.length === 0);
  }

  // ================= D2 ordinary plan creation without account binding
  {
    fresh();
    let r1Status = 0;
    try { r1Status = (await r1PlansRoute.POST(req('POST', '/api/plans', A, {}, { title: 'unbound' }))).status; } catch { r1Status = -1; /* reached persistence: the stub has no plan writes */ }
    const dbBefore = store.dbCalls.length;
    const reached = store.dbCalls.length > 0 || r1Status === -1 || (r1Status !== 409 && r1Status !== 428 && r1Status !== 503);
    check(`D2 R1 HEAD: unbound plan creation passes the account boundary (reaches body validation; status ${r1Status}, not 409/428/503)`, reached);
    const cur = await (require(path.join(WEB, 'app', 'api', 'plans', 'route'))).POST(req('POST', '/api/plans', A, {}, { title: 'unbound' }));
    check('D2 CORRECTED: unbound plan creation refused (503 upgrade) before any read or write', cur.status === 503 && store.dbCalls.length === dbBefore);
  }

  // ================= D3 logout without account binding clears a newer sign-in
  {
    fresh();
    const r1 = await r1Logout.POST(req('POST', '/api/auth/logout', B, { 'X-Aura-Expected-Account': A }));
    check('D3 R1 HEAD: A\'s logout carrying B\'s session clears B\'s cookie', r1.status === 200 && /Max-Age=0/i.test(r1.headers.get('set-cookie') ?? ''));
    const cur = await (require(path.join(WEB, 'app', 'api', 'auth', 'logout', 'route'))).POST(req('POST', '/api/auth/logout', B, { 'X-Aura-Expected-Account': A }));
    check('D3 CORRECTED: refused (409), B\'s cookie untouched', cur.status === 409 && !cur.headers.get('set-cookie'));
  }

  // ================= D4 cross-context queue mutation interleaving
  {
    // Simulates two contexts: while context 1 is inside its enqueue (between
    // its read and its write), context 2 completes a whole enqueue.
    const interleave = (q: any, owner: string, readKeyMatch: (k: string) => boolean) => {
      fresh();
      let injected = false;
      const realGet = storage.getItem.bind(storage);
      (storage as any).getItem = (k: string) => {
        const v = realGet(k);
        if (!injected && readKeyMatch(k)) {
          injected = true;
          q.enqueueOwned({ ...payload('context 2', 'crid-ctx2'), tempId: 't2', ownerUserId: owner });
        }
        return v;
      };
      try {
        q.enqueueOwned({ ...payload('context 1', 'crid-ctx1'), tempId: 't1', ownerUserId: owner });
      } finally {
        (storage as any).getItem = realGet;
      }
    };
    interleave(r1Queue, A, (k) => k === 'offline_habit_queue_v2:' + A);
    const r1Items = JSON.parse(storage.data.get('offline_habit_queue_v2:' + A) ?? '[]').map((i: any) => i.clientRequestId);
    check(`D4 R1 HEAD: interleaved enqueues lose an entry (kept: ${JSON.stringify(r1Items)})`, r1Items.length === 1);
    // Corrected (R4): each enqueue is ONE IndexedDB transaction; two contexts enqueueing at once are serialized.
    fresh();
    await clearQueueDb();
    await Promise.all([
      currentQueue.enqueueOwned({ ...payload('context 1', 'crid-ctx1'), tempId: 't1', ownerUserId: A }),
      currentQueue.enqueueOwned({ ...payload('context 2', 'crid-ctx2'), tempId: 't2', ownerUserId: A }),
    ]);
    check('D4 CORRECTED (R4): concurrent enqueues are atomic transactions -- both kept', (await currentQueue.readOfflineHabitQueue(A)).length === 2);
  }

  // ================= D5 concurrent same-epoch session answers
  {
    const r1Acct = compile(fx(FIX, 'accountSession.ts.txt'), path.join(WEB, 'lib', 'accountSession.r1.js'));
    fresh();
    const dev = new Device();
    dev.useMiddleware = false;
    dev.signIn(A);
    const gate = dev.hold('GET', '/api/auth/session', 'after');
    const first = r1Acct.fetchVerifiedSession(dev.fetch);
    await gate.arrived;
    dev.signIn(B);
    await r1Acct.fetchVerifiedSession(dev.fetch);
    gate.release();
    await first;
    check(`D5 R1 HEAD: the late older answer (A) overrides the newer one (B) -> account ${r1Acct.getVerifiedAccount()}`, r1Acct.getVerifiedAccount() === A);
    fresh();
    const dev2 = new Device();
    dev2.signIn(A);
    const tab = openTab('tab1');
    const gate2 = dev2.hold('GET', '/api/auth/session', 'after');
    const f2 = tab.acct.fetchVerifiedSession(dev2.fetch as any);
    await gate2.arrived;
    dev2.signIn(B);
    await tab.acct.fetchVerifiedSession(dev2.fetch as any);
    gate2.release();
    await f2;
    check('D5 CORRECTED: the newer answer (B) stands', tab.acct.getVerifiedAccount() === B);
  }

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
