/**
 * AURA-ANDROID-REL-04 (R8, ticket 39224) -- logical request lifecycle and the
 * retirement of automatic migration of the unreleased R1-R7 queue formats.
 *
 * The four findings of the R7 independent assessment (8e0a232) are reproduced
 * against the R7 code head 7cae58a (vendored byte-for-byte in
 * test/fixtures/rel04-r7-head, re-checked against git when available) and run
 * against the current code. Historical data is produced by the ACTUAL
 * producers (vendored R2 db8607e, R3 b323d2a, R6 13d773e):
 *
 *  A  mixed-format discard resurrection: R3 random-id record in IndexedDB (R6 migrator) + an
 *     equivalent aura_q3 source of the same account, source cleanup failing, successful sign-out
 *     discard -> R7 recreates and replays it (server row); current: never
 *  B  premature marker retirement: A's discard marker replaced by B's (the R6 state), 45 days,
 *     B reads first (R7 retires the marker), A reads and replays (server row); current: never
 *  C  unrelated foreign marker: B's valid entry HELD only because A has a matching marker (R7);
 *     current: A's markers have no effect on B; B's current activity is never held
 *  D  held-entry presentation: R7 presents held activity as "Pending sync"; current: it is never
 *     a pending entry, and Home shows "Sync paused" with the count; sign-out reports it
 *
 *  L  the current lifecycle matrix: mixed-format equivalent copies, random + deterministic
 *     historical ids, settlement/discard with failed cleanup, either account order, marker
 *     retirement before/after owner access, repeated/interrupted operations, distinct and
 *     conflicting requests, unrelated foreign markers, unreadable storage, presentation and
 *     sign-out reporting, no re-entry path for retired formats, the released legacy array
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R8LogicalLifecycle.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const FIX = path.join(__dirname, 'fixtures');
const fx = (dir: string, n: string) => fs.readFileSync(path.join(FIX, dir, n), 'utf8');
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };

(function provenance() {
  const HEADS: Array<[string, string, string, string]> = [
    ['db8607e', 'rel04-r2-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['b323d2a', 'rel04-r3-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['13d773e', 'rel04-r6-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['7cae58a', 'rel04-r7-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['7cae58a', 'rel04-r7-head', 'activitySync.ts.txt', 'apps/web/lib/activitySync.ts'],
    ['7cae58a', 'rel04-r7-head', 'signOut.ts.txt', 'apps/web/lib/signOut.ts'],
  ];
  for (const [c, dir, f, src] of HEADS) {
    if (!gitHas(c)) { console.log(`SKIP fixture re-check: ${c} not in this checkout; ${dir}/${f} used as vendored`); continue; }
    check(`fixture ${dir}/${f} == ${c} ${src}`, execFileSync('git', ['show', `${c}:${src}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(dir, f));
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
const lib = (n: string) => path.join(WEB, 'lib', n);
let seq = 0;
const producer = (dir: string) => compile(fx(dir, 'offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.${dir}.${seq++}.js`));

const A = 'r8-account-a';
const B = 'r8-account-b';
addUser(A, 'r8-a@example.invalid');
addUser(B, 'r8-b@example.invalid');
const item = (ownerUserId: string, crid: string, title = 'same-payload') => ({ ...payload(title, crid), ownerUserId, tempId: 'temp' });
const realNow = Date.now;
const DAY = 24 * 3600_000;
const lsDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const denyStorage = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage access denied'); } });
const restoreStorage = () => Object.defineProperty(globalThis, 'localStorage', lsDesc ?? { configurable: true, writable: true, value: storage });
const lsKeys = (prefix: string) => [...storage.data.keys()].filter((k) => k.startsWith(prefix));
const rowsOf = (owner: string, crid: string) => logsOf(owner).filter((l: any) => l.clientRequestId === crid).length;

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  closeAllTabs(); Date.now = realNow; restoreStorage();
  await clearQueueDb();
}

// ---------------------------------------------------------------- the code under test: R7 head or current
type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: 'R7' | 'current'; tab: (id: string) => Stack };
const R7: Impl = {
  name: 'R7',
  tab: (id) => {
    const t = openTab(id);
    const q = compile(fx('rel04-r7-head', 'offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r7.${id}.${seq++}.js`));
    const sync = compile(fx('rel04-r7-head', 'activitySync.ts.txt'), lib(`activitySync.r7.${id}.${seq++}.js`), { './offlineHabitQueue': q });
    const so = compile(fx('rel04-r7-head', 'signOut.ts.txt'), lib(`signOut.r7.${id}.${seq++}.js`), { './offlineHabitQueue': q });
    return { q, sync, acct: t.acct, so };
  },
};
const CUR: Impl = { name: 'current', tab: (id) => { const t = openTab(id); return { q: t.q, sync: t.sync, acct: t.acct, so: t.so }; } };

const dev = new Device();
let tabSeq = 0;
async function asAccount(impl: Impl, account: string): Promise<Stack> {
  dev.signIn(account);
  const s = impl.tab(`${impl.name}-${account}-${tabSeq++}`);
  await s.acct.fetchVerifiedSession(dev.fetch as any);
  return s;
}
async function signOut(s: Stack) {
  let asked = '';
  const out = await s.so.performSignOut({ fetch: dev.fetch as any, confirm: (m: string) => { asked = m; return true; } });
  return { out, asked, message: s.so.signOutOutcomeMessage(out) as string | null };
}

/** The R6 migrator (13d773e) run once, then its connection closed. */
async function withR6(owner: string, fn?: (q: any, read: any) => Promise<void>) {
  const r6 = producer('rel04-r6-head');
  const read = await r6.readOwnedQueue(owner);
  if (fn) await fn(r6, read);
  await r6.__resetQueueDbForTests();
  return read;
}
/** Writes raw IndexedDB rows (a state an earlier build persisted). */
async function putRows(rows: Array<['records' | 'tombstones', any]>) {
  const db: IDBDatabase = await openTab(`raw-${tabSeq++}`).q.__openQueueDbForTests();
  const t = db.transaction(['records', 'tombstones'], 'readwrite');
  for (const [store, v] of rows) t.objectStore(store).put(v);
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

// ---------------------------------------------------------------- A: mixed-format discard resurrection
async function findingA(impl: Impl) {
  await fresh();
  const crid = 'mix-1';
  // R3 (b323d2a) enqueue: aura_q4 under a RANDOM id; R6 (13d773e) migrated it into IndexedDB under that id.
  if (producer('rel04-r3-head').enqueueOwned(item(A, crid)).status !== 'stored') throw new Error('R3 enqueue failed');
  const randomId = JSON.parse(storage.data.get(lsKeys(`aura_q4:${A}:`)[0])!).recordId;
  await withR6(A);
  const idbRecord = (await queueDump()).records.find((r: any) => r.ownerUserId === A);
  // An equivalent same-account aura_q3 source (R2 db8607e enqueue) whose cleanup keeps failing.
  if (!producer('rel04-r2-head').enqueueOwned(item(A, crid))) throw new Error('R2 enqueue failed');
  storage.fail.remove = true;
  const s1 = await asAccount(impl, A);
  const so = await signOut(s1);
  const afterDiscard = (await queueDump()).records.filter((r: any) => r.ownerUserId === A).length;
  const s2 = await asAccount(impl, A);
  const rp = await s2.sync.replayOfflineQueue(dev.fetch as any);
  const recreated = (await queueDump()).records.filter((r: any) => r.ownerUserId === A).length;
  storage.fail.remove = false;
  return {
    seededRandomIdRecord: Boolean(idbRecord && idbRecord.recordId === randomId),
    q3SourcePresent: lsKeys(`aura_q3:${A}:`).length === 1,
    signedOut: so.out.outcome === 'signed-out', afterDiscard, recreated, replayed: rp.attempted, serverRows: rowsOf(A, crid),
  };
}

// ---------------------------------------------------------------- B: premature marker retirement
async function findingB(impl: Impl, order: 'B-first' | 'A-first') {
  await fresh();
  const crid = 'shared-1';
  // A's aura_q4 entry with the SHARED id, from the actual R3 migrator (b323d2a) run on an aura_q3 source.
  storage.setItem(`aura_q3:${A}:${crid}`, JSON.stringify(item(A, crid)));
  if (!producer('rel04-r3-head').readOwnedQueue(A).ok) throw new Error('R3 migration failed');
  const sharedId = JSON.parse(storage.data.get(lsKeys(`aura_q4:${A}:`)[0])!).recordId;
  // A discards it under R6 (13d773e), its source cleanup failing: R6 writes the bare marker <sharedId> for A.
  storage.fail.remove = true;
  await withR6(A, async (q, read) => { await q.discardRecords(read.records.map((r: any) => r.recordId), { tab: 'r6' }); });
  storage.fail.remove = false;
  const t0 = realNow();
  const aMarker = (await queueDump()).tombstones.find((t: any) => t.recordId === sharedId);
  // B's discard of an entry with the same shared id REPLACED A's marker (the R6 state reproduced by R7 O1).
  await putRows([['tombstones', { recordId: sharedId, ownerUserId: B, at: t0 }]]);
  Date.now = () => t0 + 45 * DAY;
  const tombsBefore = (await queueDump()).tombstones.length;
  let sA: Stack;
  if (order === 'B-first') { const sB = await asAccount(impl, B); await sB.q.readOwnedQueue(B); sA = await asAccount(impl, A); }
  else { sA = await asAccount(impl, A); await sA.q.readOwnedQueue(A); const sB = await asAccount(impl, B); await sB.q.readOwnedQueue(B); sA = await asAccount(impl, A); }
  const markerAfter = (await queueDump()).tombstones.some((t: any) => t.recordId === sharedId);
  const rp = await sA.sync.replayOfflineQueue(dev.fetch as any);
  Date.now = realNow;
  return { aDiscardedUnderR6: Boolean(aMarker && aMarker.ownerUserId === A), sharedId, tombsBefore, markerAfter, tombsAfter: (await queueDump()).tombstones.length, replayed: rp.attempted, serverRows: rowsOf(A, crid) };
}

// ---------------------------------------------------------------- C/D: unrelated foreign marker; held presentation
async function findingC(impl: Impl, withForeignMarker = true) {
  await fresh();
  const crid = 'shared-c';
  // A's entry (actual R3 migrator, shared id), settled by A under R6 -> bare marker <sharedId> for A.
  storage.setItem(`aura_q3:${A}:${crid}`, JSON.stringify(item(A, crid)));
  producer('rel04-r3-head').readOwnedQueue(A);
  if (withForeignMarker) await withR6(A, async (q, read) => { await q.settleRecords(read.records.map((r: any) => r.recordId)); });
  for (const k of lsKeys(`aura_q4:${A}:`)) storage.data.delete(k);
  // B's VALID entry for the same request id and payload (actual R3 migrator -> the same shared id).
  storage.setItem(`aura_q3:${B}:${crid}`, JSON.stringify(item(B, crid)));
  producer('rel04-r3-head').readOwnedQueue(B);
  const sB = await asAccount(impl, B);
  const read = await sB.q.readOwnedQueue(B);
  const shown = await sB.q.readOfflineHabitQueue(B);
  const view = impl.name === 'current' ? await sB.q.readOfflineQueueView(B) : null;
  const pending = (shown ?? []).map((i: any) => sB.q.toPendingLoggedEntry(i));
  const rp = await sB.sync.replayOfflineQueue(dev.fetch as any);
  const so = await signOut(sB);
  return {
    held: read.ok ? (read.held ?? []).length : -1,
    paused: read.ok ? read.paused ?? null : null,
    shownAsPending: pending.filter((e: any) => e.clientRequestId === crid && e.syncStatus === 'pending').length,
    viewPaused: view ? view.paused : null,
    replayed: rp.attempted, bRows: rowsOf(B, crid),
    asked: so.asked, removed: so.out.owned?.removed ?? -1, message: so.message ?? '',
  };
}

async function main() {
  // ================================================================ A
  const a7 = await findingA(R7);
  console.log('A R7:', JSON.stringify(a7));
  check('A R7 HEAD reproduces: R3 random-id IndexedDB record (R6 migrator) + equivalent aura_q3 source, cleanup failing; the sign-out discard succeeds and removes the record', a7.seededRandomIdRecord && a7.q3SourcePresent && a7.signedOut && a7.afterDiscard === 0);
  check('A R7 HEAD reproduces: the discarded activity is RECREATED from the aura_q3 source and REPLAYED, creating a server row', a7.recreated === 0 && a7.replayed === 1 && a7.serverRows === 1);
  const aC = await findingA(CUR);
  console.log('A current:', JSON.stringify(aC));
  check('A CORRECTED: after the successful sign-out discard (cleanup still failing) nothing is recreated, nothing replayed, ZERO server rows', aC.seededRandomIdRecord && aC.signedOut && aC.afterDiscard === 0 && aC.recreated === 0 && aC.replayed === 0 && aC.serverRows === 0);
  check('A CORRECTED: the uncleaned aura_q3 source is preserved in place, quarantined (it is never a queue input)', lsKeys(`aura_q3:${A}:`).length === 1);

  // ================================================================ B
  const b7 = await findingB(R7, 'B-first');
  console.log('B R7 (B first):', JSON.stringify(b7));
  check('B R7 HEAD setup: A discarded under R6 (bare marker for A), then B\'s discard replaced it; 45 days pass', b7.aDiscardedUnderR6 && b7.tombsBefore === 1);
  check('B R7 HEAD reproduces: B reads first and RETIRES the marker (B has no source); A then migrates and REPLAYS its previously discarded activity (server row)', b7.markerAfter === false && b7.replayed === 1 && b7.serverRows === 1);
  const b7a = await findingB(R7, 'A-first');
  console.log('B R7 (A first):', JSON.stringify(b7a));
  check('B R7 HEAD order dependence: if A reads before B\'s retirement the entry is held (not replayed) -- the outcome depends on which account reads first', b7a.serverRows === 0);
  for (const order of ['B-first', 'A-first'] as const) {
    const bc = await findingB(CUR, order);
    console.log(`B current (${order}):`, JSON.stringify(bc));
    check(`B CORRECTED (${order === 'B-first' ? 'B reads first' : 'A reads first'}, 45 days): no marker is retired by any account's read (nothing pruned), A's discarded activity is never replayed, ZERO server rows`, bc.markerAfter === true && bc.tombsAfter === bc.tombsBefore && bc.replayed === 0 && bc.serverRows === 0);
  }

  // ================================================================ C / D
  const c7 = await findingC(R7);
  console.log('C/D R7:', JSON.stringify({ ...c7, asked: undefined, message: undefined }));
  check('C R7 HEAD reproduces: B\'s valid entry is HELD solely because A (another account) has a matching historical marker', c7.held === 1 && c7.replayed === 0 && c7.bRows === 0);
  const c7n = await findingC(R7, false);
  check('C R7 HEAD: without A\'s marker the same entry of B is NOT held (the hold is caused by the foreign marker)', c7n.held === 0 && c7n.bRows === 1);
  check('D R7 HEAD reproduces: the held entry is presented as a PENDING entry ("Pending sync") although it is excluded from automatic replay', c7.shownAsPending === 1 && c7.replayed === 0);
  if (gitHas('7cae58a')) {
    const r7page = execFileSync('git', ['show', '7cae58a:apps/web/app/page.tsx'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    check('D R7 HEAD page.tsx reconstructs every readOfflineHabitQueue item as a pending entry and has no paused status', /readOfflineHabitQueue\(check\.user\.id\)/.test(r7page) && /selectQueueItemsToReconstruct\(queued, prev\)\.map\(toPendingLoggedEntry\)/.test(r7page) && !/Sync paused/.test(r7page));
  }
  const cc = await findingC(CUR);
  const ccn = await findingC(CUR, false);
  console.log('C/D current:', JSON.stringify({ ...cc, asked: undefined, message: undefined }), JSON.stringify({ ...ccn, asked: undefined, message: undefined }));
  check('C CORRECTED: A\'s markers have NO effect on B -- B\'s entry has the same state with and without A\'s marker (quarantined: a retired development format, ticket 39224)', JSON.stringify({ ...cc, asked: 0, message: 0 }) === JSON.stringify({ ...ccn, asked: 0, message: 0 }) && cc.paused === 1);
  // B's CURRENT activity for the same request id and payload as A's settled one is never held or suppressed.
  {
    await fresh();
    const sA = await asAccount(CUR, A);
    const rA = await sA.sync.submitActivityLog(payload('same-payload', 'cur-1'), 't', dev.fetch as any);
    await putRows([['tombstones', { recordId: 'm-legacy-shared', ownerUserId: A, at: 1 }], ['tombstones', { recordId: sA.q.decisionKey(A, 'cur-1') + 'x', ownerUserId: A, at: 1 }]]);
    const sB = await asAccount(CUR, B);
    const rB = await sB.sync.submitActivityLog(payload('same-payload', 'cur-1'), 't', dev.fetch as any);
    check('C CORRECTED: B\'s current activity with the same request id and payload as A\'s settled one (A\'s decision + pre-R8 markers present) is stored and SENT for B -- never held', rA.kind === 'confirmed' && rB.kind === 'confirmed' && rowsOf(A, 'cur-1') === 1 && rowsOf(B, 'cur-1') === 1);
  }
  check('D CORRECTED: the quarantined entry is NEVER presented as a pending entry; the presentation read reports it as paused (Home: "Sync paused")', cc.shownAsPending === 0 && cc.viewPaused === 1 && cc.replayed === 0 && cc.bRows === 0);
  const page = fs.readFileSync(path.join(WEB, 'app', 'page.tsx'), 'utf8');
  check('D CORRECTED: Home reads the paused count with the pending items and shows "Sync paused — legacy activity could not be safely reconciled." with that count (data-queue-state="paused")', /const view = await readOfflineQueueView\(check\.user\.id\);/.test(page) && /setPausedCount\(view \? view\.paused : 0\);/.test(page) && /\{pausedCount > 0 && \(/.test(page) && /data-queue-state="paused"/.test(page) && /Sync paused — legacy activity could not be safely reconciled\./.test(page));
  check('D CORRECTED: sign-out asks about it as paused legacy activity, discards it, and reports the removal', /paused legacy activity that won't sync automatically/.test(cc.asked) && cc.removed === 1 && /1 unsynced activity log was removed/.test(cc.message) && lsKeys(`aura_q4:${B}:`).length === 0);

  // ================================================================ L the current lifecycle matrix
  // L1/L2 mixed-format equivalent copies with historical random and deterministic ids
  {
    await fresh();
    const crid = 'mix-all';
    const x = item(A, crid);
    const q6 = producer('rel04-r6-head');
    await putRows([
      ['records', { recordId: 'r3randomid0001', ownerUserId: A, clientRequestId: crid, item: { ...x, recordId: 'r3randomid0001' }, queuedAt: 1 }], // R4-R6: R3 random id
      ['records', { recordId: q6.migratedRecordId(x, A), ownerUserId: A, clientRequestId: crid, item: { ...x, recordId: q6.migratedRecordId(x, A) }, queuedAt: 2 }], // R6: account-scoped deterministic id
      ['records', { recordId: q6.legacyMigratedRecordId(x), ownerUserId: A, clientRequestId: crid, item: { ...x, recordId: q6.legacyMigratedRecordId(x) }, queuedAt: 3 }], // R4/R5: owner-less deterministic id
    ]);
    await q6.__resetQueueDbForTests();
    storage.setItem(`aura_q3:${A}:${crid}`, JSON.stringify(x));
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([x]));
    storage.setItem(`aura_q4:${A}:${crid}:r3randomid0001`, JSON.stringify({ ...x, recordId: 'r3randomid0001' }));
    const s = await asAccount(CUR, A);
    const reads = [await s.q.readOwnedQueue(A), await s.q.readOwnedQueue(A), await s.q.readOwnedQueue(A)];
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    check('L1 six equivalent copies of ONE logical request (3 historical IndexedDB ids: random, account-scoped, owner-less; R1/R2/R3 localStorage) = ONE paused request; never pending; repeated reads identical', reads.every((r: any) => r.ok && r.paused === 1 && r.items.length === 0 && r.records.length === 3 && r.quarantined.length === 3) && rp.attempted === 0 && rowsOf(A, crid) === 0);
    const so = await signOut(s);
    const dump = await queueDump();
    check('L2 the sign-out discard removes every copy (3 records + 3 localStorage entries) and records ONE decision for the logical request', so.out.owned?.removed === 6 && dump.records.length === 0 && dump.tombstones.filter((t: any) => t.clientRequestId === crid).length === 1 && lsKeys(`aura_q`).length === 0 && !storage.data.has(`offline_habit_queue_v2:${A}`));
    const s2 = await asAccount(CUR, A);
    const posts0 = dev.count('POST', '/api/habit-logs');
    const again = await s2.q.enqueueOwned(x);
    const sent = await s2.sync.submitActivityLog(payload('same-payload', crid), 't', dev.fetch as any);
    check('L2 the discarded request can never re-enter: a re-enqueue is refused as decided, a re-submit sends NOTHING; ZERO server rows', again.status === 'settled' && sent.kind === 'not-stored' && rowsOf(A, crid) === 0 && dev.count('POST', '/api/habit-logs') === posts0);
    console.log('L2:', JSON.stringify({ again, sent, rows: rowsOf(A, crid), posts: dev.count('POST', '/api/habit-logs') - posts0 }));
  }
  // L3 settlement applies to every active equivalent copy; a stale interim copy after settlement stays out
  {
    await fresh();
    const crid = 'settle-copies';
    const x = item(A, crid);
    await putRows([
      ['records', { recordId: 'act-1', ownerUserId: A, clientRequestId: crid, item: { ...x, recordId: 'act-1' }, queuedAt: 1, fmt: 'r8' }],
      ['records', { recordId: 'act-2', ownerUserId: A, clientRequestId: crid, item: { ...x, recordId: 'act-2' }, queuedAt: 2, fmt: 'r8' }],
    ]);
    const s = await asAccount(CUR, A);
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    const dump = await queueDump();
    storage.setItem(`aura_q3:${A}:${crid}`, JSON.stringify(x)); // a stale interim copy appears after settlement
    const r = await s.q.readOwnedQueue(A);
    const rp2 = await s.sync.replayOfflineQueue(dev.fetch as any);
    check('L3 two active equivalent copies: sent ONCE, settlement removes BOTH and records one decision', rp.attempted === 1 && rowsOf(A, crid) === 1 && dump.records.length === 0 && dump.tombstones.length === 1 && dump.tombstones[0].decision === 'settled');
    check('L3 a stale interim copy of the settled request stays quarantined (paused, never sent)', r.ok && r.items.length === 0 && r.paused === 1 && rp2.attempted === 0 && rowsOf(A, crid) === 1);
  }
  // L4 either account order, identical request ids and payloads in every format
  for (const order of [[A, B], [B, A]] as const) {
    await fresh();
    const crid = 'both';
    for (const o of [A, B]) {
      producer('rel04-r2-head').enqueueOwned(item(o, crid));
      producer('rel04-r1-head').enqueueOwned(item(o, 'v2-' + crid));
    }
    storage.fail.remove = true; // cleanup failing throughout
    const results: Record<string, any> = {};
    for (const o of order) {
      const s = await asAccount(CUR, o);
      const before = await s.q.readOwnedQueue(o);
      const sub = await s.sync.submitActivityLog(payload('fresh activity', `live-${o}`), 't', dev.fetch as any);
      const so = await signOut(s);
      results[o] = { paused: before.ok ? before.paused : -1, live: sub.kind, removed: so.out.owned?.removed, failed: so.out.owned?.failed };
    }
    storage.fail.remove = false;
    for (const o of order) { const s = await asAccount(CUR, o); await s.sync.replayOfflineQueue(dev.fetch as any); await signOut(s); }
    const ok = [A, B].every((o) => results[o].paused === 2 && results[o].live === 'confirmed' && results[o].removed === 0 && results[o].failed === 2 && rowsOf(o, crid) === 0 && rowsOf(o, 'v2-' + crid) === 0 && rowsOf(o, `live-${o}`) === 1);
    check(`L4 ${order[0] === A ? 'A then B' : 'B then A'}: each account sees only its own 2 paused entries, its own live activity is sent once, its failed discard keeps its entries; nothing of either account is ever replayed`, ok && lsKeys(`aura_q3:${A}:`).length === 0 && lsKeys(`aura_q3:${B}:`).length === 0);
  }
  // L5 marker retirement: covered by B in both orders; plus: decisions are never pruned by any read
  {
    await fresh();
    const s = await asAccount(CUR, A);
    await s.sync.submitActivityLog(payload('settled', 'keep-1'), 't', dev.fetch as any);
    const t0 = realNow();
    Date.now = () => t0 + 400 * DAY;
    for (const o of [B, A, B]) { const t = await asAccount(CUR, o); await t.q.readOwnedQueue(o); await t.sync.replayOfflineQueue(dev.fetch as any); }
    Date.now = realNow;
    const re = await (await asAccount(CUR, A)).q.enqueueOwned(item(A, 'keep-1', 'settled'));
    check('L5 a decision survives 400 days of reads by both accounts (no expiry, no retirement) and still refuses the request', (await queueDump()).tombstones.length === 1 && re.status === 'settled' && rowsOf(A, 'keep-1') === 1);
  }
  // L6 repeated and interrupted operations
  {
    await fresh();
    storage.setItem(`aura_q3:${A}:int-1`, JSON.stringify(item(A, 'int-1')));
    const s = await asAccount(CUR, A);
    await s.q.enqueueOwned(item(A, 'int-2'));
    const snap = await s.q.readOwnedQueue(A);
    idbFault.write = true;
    const d = await s.q.discardRecords(snap.ok ? snap.records.map((r: any) => r.recordId) : [], { tab: 't', owner: A });
    idbFault.write = false;
    const after = await s.q.readOwnedQueue(A);
    check('L6 an interrupted discard (IndexedDB write failure) reports failed, removes nothing, records no decision', d.failed === 1 && d.removed === 0 && after.ok && after.records.length === 1 && (await queueDump()).tombstones.length === 0);
    const d2 = await s.q.discardRecords(snap.ok ? snap.records.map((r: any) => r.recordId) : [], { tab: 't', owner: A });
    const d3 = await s.q.discardRecords(snap.ok ? snap.records.map((r: any) => r.recordId) : [], { tab: 't', owner: A });
    check('L6 repeating the discard completes it once (then alreadyGone); the decision is written once', d2.removed === 1 && d3.alreadyGone === 1 && (await queueDump()).tombstones.length === 1);
    const q1 = s.q.discardQuarantined(A, after.ok ? after.quarantined : []);
    const q2 = s.q.discardQuarantined(A, after.ok ? after.quarantined : []);
    check('L6 repeating a quarantine discard is safe (removed once, then nothing left to remove)', q1.removed === 1 && q2.removed === 1 && lsKeys(`aura_q3:${A}:`).length === 0);
  }
  // L7 distinct requests and conflicting payloads
  {
    await fresh();
    const s = await asAccount(CUR, A);
    dev.fault('POST', '/api/habit-logs', 'network-before'); await s.sync.submitActivityLog(payload('one', 'd-1'), 't', dev.fetch as any);
    dev.fault('POST', '/api/habit-logs', 'network-before'); await s.sync.submitActivityLog(payload('two', 'd-2'), 't', dev.fetch as any);
    await putRows([['records', { recordId: 'cf-1', ownerUserId: A, clientRequestId: 'cf', item: { ...item(A, 'cf', 'first'), recordId: 'cf-1' }, queuedAt: 1, fmt: 'r8' }], ['records', { recordId: 'cf-2', ownerUserId: A, clientRequestId: 'cf', item: { ...item(A, 'cf', 'second'), recordId: 'cf-2' }, queuedAt: 2, fmt: 'r8' }]]);
    storage.setItem(`aura_q3:${A}:qc`, JSON.stringify(item(A, 'qc', 'legacy payload')));
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    check('L7 distinct requests are each sent once; conflicting active payloads are never sent and counted as paused', rp.attempted === 2 && rowsOf(A, 'd-1') === 1 && rowsOf(A, 'd-2') === 1 && rowsOf(A, 'cf') === 0 && rp.conflicts === 1 && rp.paused === 2);
    const c1 = await s.q.enqueueOwned(item(A, 'd-1', 'different payload'));
    const c2 = await s.q.enqueueOwned(item(A, 'qc', 'a different payload'));
    const c3 = await s.sync.submitActivityLog(payload('a different payload', 'qc'), 't', dev.fetch as any);
    check('L7 a different payload under a decided request is refused (conflict); any payload under a quarantined request is refused (paused) and NOT sent', c1.status === 'conflict' && c2.status === 'paused' && c3.kind === 'not-stored' && rowsOf(A, 'qc') === 0);
  }
  // L9 unreadable storage
  {
    await fresh();
    storage.setItem(`aura_q3:${A}:u-1`, JSON.stringify(item(A, 'u-1')));
    const s = await asAccount(CUR, A);
    await s.q.enqueueOwned(item(A, 'u-2'));
    denyStorage();
    const r = await s.q.readOwnedQueue(A);
    const v = await s.q.readOfflineQueueView(A);
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    const so = await signOut(s);
    restoreStorage();
    check('L9 denied localStorage: the queue is UNREADABLE (never empty, never "nothing paused"), replay sends nothing, sign-out keeps everything (owned UNKNOWN)', r.ok === false && v === null && rp.stoppedBecause === 'unreadable' && rowsOf(A, 'u-2') === 0 && so.out.owned?.unknown === true && lsKeys(`aura_q3:${A}:`).length === 1 && (await queueDump()).records.length === 1);
    idbFault.open = true;
    await s.q.__resetQueueDbForTests();
    const r2 = await s.q.readOwnedQueue(A);
    idbFault.open = false;
    check('L9 IndexedDB unavailable: unreadable, quarantined source untouched', r2.ok === false && lsKeys(`aura_q3:${A}:`).length === 1);
  }
  // L10 sign-out question and report for mixed active + paused activity
  {
    await fresh();
    storage.setItem(`aura_q3:${A}:p-1`, JSON.stringify(item(A, 'p-1')));
    const s = await asAccount(CUR, A);
    await s.q.enqueueOwned(item(A, 'a-1'));
    const so = await signOut(s);
    check('L10 sign-out asks about 2 logs of which 1 is paused legacy activity, removes both, and reports 2 removed', /You have 2 activity logs/.test(so.asked) && /1 of them is paused legacy activity/.test(so.asked) && so.out.owned?.removed === 2 && /2 unsynced activity logs were removed/.test(so.message ?? ''));
  }
  // L11 no supported path lets a retired format re-enter the active queue
  {
    await fresh();
    const x = item(A, 'ret-1');
    await putRows([['records', { recordId: 'pre-r8', ownerUserId: A, clientRequestId: 'ret-1', item: { ...x, recordId: 'pre-r8' }, queuedAt: 1 }], ['tombstones', { recordId: 'pre-r8-bare', ownerUserId: A, at: 1 }]]);
    storage.setItem(`aura_q4t:${A}:pre-r8`, '1');
    storage.setItem(`aura_q3:${A}:ret-2`, JSON.stringify(item(A, 'ret-2')));
    const s = await asAccount(CUR, A);
    const posts0 = dev.count('POST', '/api/habit-logs');
    const e1 = await s.q.enqueueOwned(x);
    const e2 = await s.q.enqueueOwned(item(A, 'ret-2'));
    const sub = await s.sync.submitActivityLog(payload('same-payload', 'ret-1'), 't', dev.fetch as any);
    const claim = await s.q.claimForDispatch('pre-r8', 't');
    const settle = await s.q.settleRecords(['pre-r8'], undefined, { owner: A });
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    const dump = await queueDump();
    check('L11 enqueue, submit, claim, settle and replay all refuse retired-format data: nothing created, nothing sent, nothing settled; the record and every pre-R8 marker stay untouched', e1.status === 'paused' && e2.status === 'paused' && sub.kind === 'not-stored' && claim.status === 'paused' && settle.paused === 1 && settle.removed === 0 && rp.attempted === 0 && dev.count('POST', '/api/habit-logs') === posts0 && dump.records.length === 1 && !dump.records[0].fmt && dump.tombstones.length === 1 && storage.data.get(`aura_q4t:${A}:pre-r8`) === '1');
    console.log('L11:', JSON.stringify({ e1, e2, sub, claim, settle, attempted: rp.attempted, posts: dev.count('POST', '/api/habit-logs') - posts0, records: dump.records.length, fmt: dump.records[0]?.fmt, tombs: dump.tombstones.length }));
    const src = fs.readFileSync(path.join(WEB, 'lib', 'offlineHabitQueue.ts'), 'utf8');
    check('L11 the module has no migration path: no code copies a localStorage entry into IndexedDB, and no marker is ever deleted', !/migrateOwnedSources|records\.add\(\{ ?recordId: c\./.test(src) && (src.match(/records\.add\(/g) ?? []).length === 1 && !/tombstones\.delete\(/.test(src));
  }
  // L12 the released legacy array is untouched and reported separately
  {
    await fresh();
    const legacy = JSON.stringify([{ ...payload('released legacy', 'leg-1') }]);
    storage.setItem('offline_habit_queue', legacy);
    const s = await asAccount(CUR, A);
    const r = await s.q.readOwnedQueue(A);
    const so = await signOut(s);
    check('L12 the released legacy offline_habit_queue is never paused-counted, never sent, byte-identical after sign-out, and reported as left in place', r.ok && r.paused === 0 && rowsOf(A, 'leg-1') === 0 && storage.data.get('offline_habit_queue') === legacy && so.out.legacyKept === 1);
  }
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
