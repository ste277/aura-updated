/**
 * AURA-ANDROID-REL-04 IR-01 -- the original cross-account failure REPRODUCES
 * on the reviewed head (a54daf6) and is PREVENTED on the corrected head.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04ReviewedHeadReproduction.test.ts
 *
 * Reviewed-head code is vendored VERBATIM in test/fixtures/rel04-reviewed-head
 * (CI checks out shallow): its habit-logs route, lib/signOut.ts, and the
 * offline enqueue and replay (`syncOfflineLogs`) blocks of app/page.tsx. When
 * the reviewed commit is available locally, the fixtures are re-checked
 * against it byte for byte. Both heads run against the same harness
 * (rel04AccountIsolationHarness): real cookie-at-send semantics, held
 * requests, synthetic accounts A and B.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, closeAllTabs, finish, logsOf, openTab, payload, resetStore, routes, storage } from './rel04AccountIsolationHarness';

const REVIEWED = 'a54daf60fe562e83df96f5db90f792ce0f2341e7';
const FIX = path.join(__dirname, 'fixtures', 'rel04-reviewed-head');
const fx = (n: string) => fs.readFileSync(path.join(FIX, n), 'utf8');
const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');

// ---------------------------------------------------------------- fixture provenance
(function verifyFixtures() {
  let available = true;
  try { execFileSync('git', ['cat-file', '-e', `${REVIEWED}^{commit}`], { stdio: 'ignore' }); } catch { available = false; }
  if (!available) { console.log('SKIP fixture re-check: reviewed commit not in this checkout (shallow clone); fixtures used as vendored'); return; }
  const show = (p: string) => execFileSync('git', ['show', `${REVIEWED}:${p}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
  check('fixture habit-logs route == a54daf6 apps/web/app/api/habit-logs/route.ts', show('apps/web/app/api/habit-logs/route.ts') === fx('habit-logs.route.ts.txt'));
  check('fixture signOut == a54daf6 apps/web/lib/signOut.ts', show('apps/web/lib/signOut.ts') === fx('signOut.ts.txt'));
  const page = show('apps/web/app/page.tsx');
  check('fixture syncOfflineLogs block is verbatim in a54daf6 app/page.tsx', page.includes(fx('page.syncOfflineLogs.txt').trimEnd()));
  check('fixture enqueue block is verbatim in a54daf6 app/page.tsx', page.includes(fx('page.enqueue.txt')));
})();

// ---------------------------------------------------------------- reviewed-head modules
function compileModule(source: string, fakeFile: string) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const m = new Module(fakeFile, module);
  m.filename = fakeFile;
  m.paths = Module._nodeModulePaths(path.dirname(fakeFile));
  m._compile(js, fakeFile);
  return m.exports;
}
const reviewedRoute = compileModule(fx('habit-logs.route.ts.txt'), path.join(WEB, 'app', 'api', 'habit-logs', 'route.reviewed-head.js'));
const reviewedSignOut = compileModule(fx('signOut.ts.txt'), path.join(WEB, 'lib', 'signOut.reviewed-head.js'));
const { classifyHabitLogSyncOutcome } = require(path.join(WEB, 'lib', 'habitLogSyncPolicy'));

function compileBlock(params: string[], body: string) {
  const src = `async function __block(${params.join(', ')}) {\n${body}\n}`;
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return vm.runInThisContext(`(${js.trim().replace(/;$/, '')})`);
}
const reviewedReplay = compileBlock(['localStorage', 'fetch', 'classifyHabitLogSyncOutcome', 'loadUserDataAndLogs', 'loadMyDay'], `${fx('page.syncOfflineLogs.txt')}\n    return syncOfflineLogs();`);
const reviewedEnqueue = compileBlock(['localStorage', 'payload', 'tempId'], fx('page.enqueue.txt'));

const currentRoutePost = routes['POST /api/habit-logs'];
function useReviewedServer(on: boolean) {
  routes['POST /api/habit-logs'] = on ? (req) => reviewedRoute.POST(req) : currentRoutePost;
}
function fresh() { resetStore(); storage.clear(); closeAllTabs(); }

async function main() {
  // ======================= R1: account switch without logout (expiry, or another tab signs in as B)
  {
    // Reviewed head
    fresh(); useReviewedServer(true);
    const dev = new Device();
    dev.signIn(A);
    await reviewedEnqueue(storage, payload('A private walk', 'crid-r1a'), 't1');
    await reviewedEnqueue(storage, payload('A private journal', 'crid-r1b'), 't2');
    dev.signIn(B); // A's session ended without an ordinary logout; B signs in on the device
    await reviewedReplay(storage, dev.fetch, classifyHabitLogSyncOutcome, () => {}, () => {});
    const leaked = logsOf(B).map((l) => l.activityTitle).sort();
    check('R1 REVIEWED HEAD: defect reproduces -- A\'s queued activity is stored under B', JSON.stringify(leaked) === JSON.stringify(['A private journal', 'A private walk']));

    // Corrected head
    fresh(); useReviewedServer(false);
    const dev2 = new Device();
    dev2.signIn(A);
    const tab = openTab('tab1');
    await tab.acct.fetchVerifiedSession(dev2.fetch as any);
    for (const [t, c] of [['A private walk', 'crid-r1a'], ['A private journal', 'crid-r1b']]) {
      dev2.fault('POST', '/api/habit-logs', 'network-before');
      await tab.sync.submitActivityLog(payload(t, c), 't', dev2.fetch as any);
    }
    dev2.signIn(B);
    await tab.acct.fetchVerifiedSession(dev2.fetch as any);
    const r = await tab.sync.replayOfflineQueue(dev2.fetch as any);
    check('R1 CORRECTED HEAD: B\'s replay sends nothing; nothing of A\'s stored under B', r.attempted === 0 && logsOf(B).length === 0);
    // Even the reviewed-head replay running under B's session cannot leak against the corrected server.
    await reviewedEnqueue(storage, payload('A queued by an old bundle', 'crid-r1-old'), 't-old');
    await reviewedReplay(storage, dev2.fetch, classifyHabitLogSyncOutcome, () => {}, () => {});
    const refused = dev2.calls.filter((c) => c.key === 'POST /api/habit-logs' && c.status === 428 && c.sessionUser === B).length;
    check('R1 CORRECTED SERVER: an out-of-date client replaying under B is refused (no expected account -> 428), nothing stored under B', refused === 1 && logsOf(B).length === 0);
  }

  // ======================= R2: replay in progress when logout starts, then B signs in
  {
    // Reviewed head
    fresh(); useReviewedServer(true);
    const dev = new Device();
    dev.signIn(A);
    for (const n of [1, 2, 3]) await reviewedEnqueue(storage, payload(`A item ${n}`, `crid-r2-${n}`), `t${n}`);
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = reviewedReplay(storage, dev.fetch, classifyHabitLogSyncOutcome, () => {}, () => {});
    await gate.arrived;
    const out = await reviewedSignOut.performSignOut({ fetch: dev.fetch, storage, confirm: () => true });
    dev.signIn(B);
    gate.release();
    await replay;
    check('R2 REVIEWED HEAD: sign-out did not stop the running replay', out === 'signed-out');
    check('R2 REVIEWED HEAD: defect reproduces -- A\'s remaining items stored under B after B signed in', logsOf(B).map((l) => l.activityTitle).sort().join('|') === 'A item 2|A item 3');

    // Corrected head
    fresh(); useReviewedServer(false);
    const dev2 = new Device();
    dev2.signIn(A);
    const tab = openTab('tab1');
    await tab.acct.fetchVerifiedSession(dev2.fetch as any);
    for (const n of [1, 2, 3]) { dev2.fault('POST', '/api/habit-logs', 'network-before'); await tab.sync.submitActivityLog(payload(`A item ${n}`, `crid-r2-${n}`), 't', dev2.fetch as any); }
    const gate2 = dev2.hold('POST', '/api/habit-logs', 'before');
    const replay2 = tab.sync.replayOfflineQueue(dev2.fetch as any);
    await gate2.arrived;
    const out2 = await tab.so.performSignOut({ fetch: dev2.fetch as any, confirm: () => true });
    dev2.signIn(B);
    await tab.acct.fetchVerifiedSession(dev2.fetch as any);
    gate2.release();
    await replay2;
    await tab.sync.replayOfflineQueue(dev2.fetch as any);
    check('R2 CORRECTED HEAD: replay aborted by the sign-out; nothing stored under B', out2 === 'signed-out' && logsOf(B).length === 0 && logsOf(A).length === 0);
  }

  // ======================= R3: stale tab request with B's session
  {
    fresh(); useReviewedServer(true);
    const dev = new Device();
    dev.signIn(B);
    const res = await dev.fetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aura-Expected-Account': A }, body: JSON.stringify(payload('meant for A', 'crid-r3')) });
    check('R3 REVIEWED SERVER: a write meant for A is accepted under B\'s session', res.status === 200 && logsOf(B).length === 1);
    fresh(); useReviewedServer(false);
    const dev2 = new Device();
    dev2.signIn(B);
    const res2 = await dev2.fetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aura-Expected-Account': A }, body: JSON.stringify(payload('meant for A', 'crid-r3')) });
    check('R3 CORRECTED SERVER: the same write is refused (409) and nothing is stored', res2.status === 409 && logsOf(B).length === 0);
  }

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
