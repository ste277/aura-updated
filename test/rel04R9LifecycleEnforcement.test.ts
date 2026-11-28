/**
 * AURA-ANDROID-REL-04 (R9) -- durable lifecycle enforcement: the three lifecycle blockers of the R8
 * independent assessment of PR #392 (reviewed head 2e32b91, implementation eab072c).
 *
 * The assessment's witnesses (docs/android/evidence/rel04-r8-independent-45804709468/review-independent.log,
 * preserved byte-for-byte with its SHA256SUMS) are re-run here against the R8 code head eab072c (queue,
 * replay and sign-out vendored in test/fixtures/rel04-r8-head, checked against git) and against the
 * current code. The assessor's probe scripts were not part of the evidence directory; the witnesses are
 * rebuilt from the logged shapes, with historical data written by the ACTUAL producers (R2 db8607e, R3 b323d2a).
 *
 *  X1  no single transmission boundary: a discarded request is transmitted when IndexedDB reads fail
 *      (direct-network fallback), and when a matching retired source is unreadable
 *  X2  discard of a retired localStorage-only entry removes it WITHOUT a durable decision: the same
 *      request is then submitted and confirmed (R2 aura_q3, R3 aura_q4)
 *  X3  cleanup before decision: a failed IndexedDB discard still removes the retired copy, which unpauses
 *      the active copy and replays it; sign-out counts physical copies
 *
 *  E   the current lifecycle: eligibility boundary, durable discard before cleanup, interrupted and
 *      ambiguous transactions, concurrency, logical counts, healthy submission, other POST paths
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R9LifecycleEnforcement.test.ts
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
    ['eab072c', 'rel04-r8-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['eab072c', 'rel04-r8-head', 'activitySync.ts.txt', 'apps/web/lib/activitySync.ts'],
    ['eab072c', 'rel04-r8-head', 'signOut.ts.txt', 'apps/web/lib/signOut.ts'],
  ];
  for (const [c, dir, f, src] of HEADS) {
    if (!gitHas(c)) { console.log(`SKIP fixture re-check: ${c} not in this checkout; ${dir}/${f} used as vendored`); continue; }
    check(`fixture ${dir}/${f} == ${c} ${src}`, execFileSync('git', ['show', `${c}:${src}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(dir, f));
  }
  const W = path.join(__dirname, '..', 'docs', 'android', 'evidence', 'rel04-r8-independent-45804709468');
  const sums = fs.readFileSync(path.join(W, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/));
  const crypto = require('crypto');
  check('the R8 independent witnesses are preserved byte-for-byte (SHA256SUMS of the evidence directory)', sums.length === 4 && sums.every(([h, f]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(W, f))).digest('hex') === h));
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

const A = 'r9-account-a';
const B = 'r9-account-b';
addUser(A, 'r9-a@example.invalid');
addUser(B, 'r9-b@example.invalid');
const item = (ownerUserId: string, crid: string, title = 'same-payload') => ({ ...payload(title, crid), ownerUserId, tempId: 'temp' });
const realNow = Date.now;
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

type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: 'R8' | 'current'; tab: (id: string) => Stack };
const R8: Impl = {
  name: 'R8',
  tab: (id) => {
    const t = openTab(id);
    const q = compile(fx('rel04-r8-head', 'offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r8.${id}.${seq++}.js`));
    const sync = compile(fx('rel04-r8-head', 'activitySync.ts.txt'), lib(`activitySync.r8.${id}.${seq++}.js`), { './offlineHabitQueue': q });
    const so = compile(fx('rel04-r8-head', 'signOut.ts.txt'), lib(`signOut.r8.${id}.${seq++}.js`), { './offlineHabitQueue': q });
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
async function signOut(s: Stack, onConfirm?: () => void) {
  let asked = '';
  const out = await s.so.performSignOut({ fetch: dev.fetch as any, confirm: (m: string) => { asked = m; onConfirm?.(); return true; } });
  return { out, asked, message: (s.so.signOutOutcomeMessage(out) as string | null) ?? '' };
}
const decisions = async () => (await queueDump()).tombstones.filter((t: any) => t.fmt === 'r8');
const offline = async (s: Stack, title: string, crid: string) => { dev.fault('POST', '/api/habit-logs', 'network-before'); return s.sync.submitActivityLog(payload(title, crid), 't', dev.fetch as any); };

// ---------------------------------------------------------------- the assessment's witnesses
async function wLocalOnly(impl: Impl, format: 'r2' | 'r3') {
  await fresh();
  const crid = `lso-${format}`;
  if (format === 'r2') { if (!producer('rel04-r2-head').enqueueOwned(item(A, crid))) throw new Error('R2 enqueue failed'); }
  else if (producer('rel04-r3-head').enqueueOwned(item(A, crid)).status !== 'stored') throw new Error('R3 enqueue failed');
  const s = await asAccount(impl, A);
  const so = await signOut(s);
  const markersBeforeRetry = (await decisions()).length;
  const s2 = await asAccount(impl, A);
  const sub = await s2.sync.submitActivityLog(payload('same-payload', crid), 't', dev.fetch as any);
  return { format, removed: so.out.owned?.removed, markersBeforeRetry, submit: sub.kind, serverRows: rowsOf(A, crid) };
}
async function wIdbFailureAfterDiscard(impl: Impl) {
  await fresh();
  const s = await asAccount(impl, A);
  await offline(s, 'same-payload', 'idbf-1');
  const so = await signOut(s);
  const decision = (await decisions()).find((d: any) => d.clientRequestId === 'idbf-1')?.decision;
  const s2 = await asAccount(impl, A);
  idbFault.read = true;
  const sub = await s2.sync.submitActivityLog(payload('same-payload', 'idbf-1'), 't', dev.fetch as any);
  const rp = await s2.sync.replayOfflineQueue(dev.fetch as any);
  idbFault.read = false;
  return { removed: so.out.owned?.removed, decision, submit: sub.kind, replay: rp.stoppedBecause, serverRows: rowsOf(A, 'idbf-1') };
}
async function wInterruptedDiscard(impl: Impl) {
  await fresh();
  const s = await asAccount(impl, A);
  await offline(s, 'same-payload', 'mix-1');
  if (!producer('rel04-r2-head').enqueueOwned(item(A, 'mix-1'))) throw new Error('R2 enqueue failed'); // the retired copy
  const before = await s.q.readOwnedQueue(A);
  const so = await signOut(s, () => { idbFault.write = true; }); // the IndexedDB discard transaction fails
  idbFault.write = false;
  const sourceCount = lsKeys(`aura_q3:${A}:`).length;
  const s2 = await asAccount(impl, A);
  const after = await s2.q.readOwnedQueue(A);
  const rp = await s2.sync.replayOfflineQueue(dev.fetch as any);
  return { initialPaused: before.ok ? before.paused : -1, confirmation: so.asked, removed: so.out.owned?.removed, failed: so.out.owned?.failed, sourceCount, afterPaused: after.ok ? after.paused : -1, afterPending: after.ok ? after.items.length : -1, attempted: rp.attempted, serverRows: rowsOf(A, 'mix-1') };
}
async function wUnreadableSource(impl: Impl, how: 'denied' | 'getItem-throws') {
  await fresh();
  if (!producer('rel04-r2-head').enqueueOwned(item(A, 'unread-1'))) throw new Error('R2 enqueue failed');
  const s = await asAccount(impl, A);
  if (how === 'denied') denyStorage(); else storage.fail.get = true;
  const sub = await s.sync.submitActivityLog(payload('same-payload', 'unread-1'), 't', dev.fetch as any);
  restoreStorage(); storage.fail.get = false;
  const r = await s.q.readOwnedQueue(A);
  return { direct: sub.kind, stillPaused: r.ok ? r.paused : -1, rows: rowsOf(A, 'unread-1') };
}

async function main() {
  // ================================================================ X2 localStorage-only discard (R2, R3)
  for (const f of ['r2', 'r3'] as const) {
    const b = await wLocalOnly(R8, f);
    console.log(`X2 R8 ${f}:`, JSON.stringify(b));
    check(`X2 R8 HEAD reproduces (${f === 'r2' ? 'R2 aura_q3' : 'R3 aura_q4'} localStorage-only): the confirmed sign-out discard removes it with NO decision; the same request is then submitted and CONFIRMED (server row)`, b.removed === 1 && b.markersBeforeRetry === 0 && b.submit === 'confirmed' && b.serverRows === 1);
    const a = await wLocalOnly(CUR, f);
    console.log(`X2 current ${f}:`, JSON.stringify(a));
    check(`X2 CORRECTED (${f}): the discard records a durable decision BEFORE removing the entry; the same request is refused (not sent), ZERO server rows`, a.removed === 1 && a.markersBeforeRetry === 1 && a.submit === 'not-stored' && a.serverRows === 0);
  }

  // ================================================================ X1 transmission boundary
  {
    const b = await wIdbFailureAfterDiscard(R8);
    console.log('X1 R8 IndexedDB failure:', JSON.stringify(b));
    check('X1 R8 HEAD reproduces: after a confirmed discard (decision written), an IndexedDB read failure makes the submission fall back to the network: CONFIRMED, server row', b.removed === 1 && b.decision === 'discarded' && b.submit === 'confirmed' && b.serverRows === 1);
    const a = await wIdbFailureAfterDiscard(CUR);
    console.log('X1 current IndexedDB failure:', JSON.stringify(a));
    check('X1 CORRECTED: with IndexedDB reads failing the discarded request is NOT transmitted (storage-unavailable, no direct fallback); replay stops unreadable; ZERO server rows', a.decision === 'discarded' && a.submit === 'storage-unavailable' && a.replay === 'unreadable' && a.serverRows === 0);
  }
  for (const how of ['denied', 'getItem-throws'] as const) {
    const b = await wUnreadableSource(R8, how);
    console.log(`X1 R8 unreadable source (${how}):`, JSON.stringify(b));
    check(`X1 R8 HEAD reproduces (${how}): with the matching retired source unreadable the request is submitted directly and CONFIRMED (server row) while still paused`, b.direct === 'confirmed' && b.stillPaused === 1 && b.rows === 1);
    const a = await wUnreadableSource(CUR, how);
    console.log(`X1 current unreadable source (${how}):`, JSON.stringify(a));
    check(`X1 CORRECTED (${how}): an unreadable retired source blocks transmission (storage-unavailable), the entry stays paused, ZERO server rows`, a.direct === 'storage-unavailable' && a.stillPaused === 1 && a.rows === 0);
  }

  // ================================================================ X3 cleanup before decision; physical counts
  {
    const b = await wInterruptedDiscard(R8);
    console.log('X3 R8:', JSON.stringify({ ...b, confirmation: undefined }));
    check('X3 R8 HEAD reproduces: the IndexedDB discard fails, the retired copy is removed anyway, the active copy is UNPAUSED and replayed (server row)', b.initialPaused === 1 && b.failed === 1 && b.removed === 1 && b.sourceCount === 0 && b.afterPaused === 0 && b.afterPending === 1 && b.attempted === 1 && b.serverRows === 1);
    check('X3 R8 HEAD reproduces: sign-out asks about 2 activity logs for ONE logical activity (physical copies)', /You have 2 activity logs/.test(b.confirmation));
    const a = await wInterruptedDiscard(CUR);
    console.log('X3 current:', JSON.stringify({ ...a, confirmation: undefined }));
    check('X3 CORRECTED: the failed discard transaction removes NOTHING (retired copy preserved), reports the activity as failed (never removed), it stays paused, nothing is replayed, ZERO server rows', a.removed === 0 && a.failed === 1 && a.sourceCount === 1 && a.afterPaused === 1 && a.afterPending === 0 && a.attempted === 0 && a.serverRows === 0);
    check('X3 CORRECTED: sign-out asks about ONE activity log (logical), paused', /You have 1 activity log that has not synced yet/.test(a.confirmation) && /it is paused legacy activity/.test(a.confirmation));
  }

  // ================================================================ E current lifecycle
  // E1 failed localStorage cleanup AFTER the durable discard can never resurrect; a retry completes the cleanup
  {
    await fresh();
    if (!producer('rel04-r2-head').enqueueOwned(item(A, 'cl-1'))) throw new Error('R2 enqueue failed');
    if (producer('rel04-r3-head').enqueueOwned(item(A, 'cl-2')).status !== 'stored') throw new Error('R3 enqueue failed');
    const s = await asAccount(CUR, A);
    storage.fail.remove = true;
    const so = await signOut(s);
    storage.fail.remove = false;
    const s2 = await asAccount(CUR, A);
    const view = await s2.q.readOfflineQueueView(A);
    const subs = [await s2.sync.submitActivityLog(payload('same-payload', 'cl-1'), 't', dev.fetch as any), await s2.sync.submitActivityLog(payload('same-payload', 'cl-2'), 't', dev.fetch as any)];
    const rp = await s2.sync.replayOfflineQueue(dev.fetch as any);
    check('E1 cleanup failing after the decisions committed: reported as discarded-but-not-deleted (cleanupPending 2, never "removed"), the message says they will never be sent', so.out.owned?.removed === 0 && so.out.owned?.cleanupPending === 2 && /discarded and will never be sent/.test(so.message) && (await decisions()).length === 2);
    check('E1 the surviving copies stay paused (Home counts them for a retry) and are permanently ineligible: both re-submissions refused, replay sends nothing, ZERO server rows', view?.paused === 2 && view?.items.length === 0 && subs.every((r: any) => r.kind === 'not-stored') && rp.attempted === 0 && rowsOf(A, 'cl-1') + rowsOf(A, 'cl-2') === 0);
    const so2 = await signOut(s2);
    check('E1 a retried sign-out safely completes the cleanup (2 removed), keeps the decisions, sends nothing', so2.out.owned?.removed === 2 && lsKeys('aura_q').length === 0 && (await decisions()).length === 2 && rowsOf(A, 'cl-1') + rowsOf(A, 'cl-2') === 0);
  }
  // E2 an interrupted transaction (fails after its first write) commits NOTHING: no partial decision, sources kept
  {
    await fresh();
    for (const c of ['ab-1', 'ab-2']) if (!producer('rel04-r2-head').enqueueOwned(item(A, c))) throw new Error('R2 enqueue failed');
    const s = await asAccount(CUR, A);
    const snap = await s.q.readOwnedQueue(A);
    const proto = require('fake-indexeddb').IDBObjectStore.prototype;
    const realPut = proto.put;
    let puts = 0;
    proto.put = function (...a: unknown[]) { if (++puts === 2) throw new Error('UnknownError: interrupted (synthetic)'); return realPut.apply(this, a); };
    const d = await s.q.discardOwned(A, snap, { tab: 't' });
    proto.put = realPut;
    const sub = await s.sync.submitActivityLog(payload('same-payload', 'ab-1'), 't', dev.fetch as any);
    check('E2 a discard transaction interrupted after its first decision write commits NOTHING: both reported failed, no decision, both sources kept, still paused and never sent', d.failed === 2 && d.removed === 0 && (await decisions()).length === 0 && lsKeys(`aura_q3:${A}:`).length === 2 && sub.kind === 'not-stored' && rowsOf(A, 'ab-1') === 0);
    const d2 = await s.q.discardOwned(A, snap, { tab: 't' });
    check('E2 retrying the same confirmed discard completes it exactly once', d2.removed === 2 && (await decisions()).length === 2 && lsKeys(`aura_q3:${A}:`).length === 0);
  }
  // E3 ambiguous outcome: committed, then the context dies before cleanup (no cleanup at all) -- the survivor is ineligible
  {
    await fresh();
    if (!producer('rel04-r2-head').enqueueOwned(item(A, 'amb-1'))) throw new Error('R2 enqueue failed');
    const s = await asAccount(CUR, A);
    const snap = await s.q.readOwnedQueue(A);
    const realRemove = storage.removeItem.bind(storage);
    (storage as any).removeItem = () => { throw new Error('context terminated before cleanup (synthetic)'); };
    await s.q.discardOwned(A, snap, { tab: 't' });
    (storage as any).removeItem = realRemove;
    const s2 = await asAccount(CUR, A);
    const sub = await s2.sync.submitActivityLog(payload('same-payload', 'amb-1'), 't', dev.fetch as any);
    const sub2 = await s2.sync.submitActivityLog(payload('a different payload', 'amb-1'), 't', dev.fetch as any);
    check('E3 decision committed but cleanup never ran: the surviving retired entry is ineligible for any payload; ZERO server rows', lsKeys(`aura_q3:${A}:`).length === 1 && sub.kind === 'not-stored' && sub2.kind === 'not-stored' && rowsOf(A, 'amb-1') === 0);
  }
  // E4 unreadable retired data of other kinds
  {
    await fresh();
    storage.setItem(`aura_q3:${A}:keyonly-1`, '{not json');
    const s = await asAccount(CUR, A);
    const sub = await s.sync.submitActivityLog(payload('same-payload', 'keyonly-1'), 't', dev.fetch as any);
    const other = await s.sync.submitActivityLog(payload('unrelated', 'fresh-1'), 't', dev.fetch as any);
    check('E4 an unparseable aura_q3 value is identified by its key: that request is paused and never sent; unrelated activity is unaffected', sub.kind === 'not-stored' && rowsOf(A, 'keyonly-1') === 0 && other.kind === 'confirmed' && rowsOf(A, 'fresh-1') === 1);
    await fresh();
    storage.setItem(`offline_habit_queue_v2:${A}`, '{not json');
    const s2 = await asAccount(CUR, A);
    const sub2 = await s2.sync.submitActivityLog(payload('anything', 'opaque-1'), 't', dev.fetch as any);
    const v = await s2.q.readOfflineQueueView(A);
    const so = await signOut(s2);
    const s3 = await asAccount(CUR, A);
    const after = await s3.sync.submitActivityLog(payload('anything', 'opaque-2'), 't', dev.fetch as any);
    // R10: an entry whose identity cannot be established is PRESERVED by the discard (never deleted) and reported
    // as such; while it remains, eligibility of the account's requests cannot be established.
    check('E4 an unidentifiable (unparseable v2) entry blocks every transmission of the account (storage-unavailable, nothing sent) and is shown paused; the confirmed discard PRESERVES it (R10: reported as not identifiable, never removed) and transmission stays blocked', sub2.kind === 'storage-unavailable' && rowsOf(A, 'opaque-1') === 0 && v?.paused === 1 && so.out.owned?.removed === 0 && so.out.owned?.unidentified === 1 && /couldn't be identified safely/.test(so.message) && storage.data.get(`offline_habit_queue_v2:${A}`) === '{not json' && after.kind === 'storage-unavailable' && rowsOf(A, 'opaque-2') === 0);
  }
  // E5 concurrent submission and discard
  {
    // (a) the send holds the claim: a discard in another context keeps it (undecided); the send then settles it once.
    await fresh();
    const t1 = await asAccount(CUR, A);
    const t2 = CUR.tab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const sending = t1.sync.submitActivityLog(payload('in flight', 'race-1'), 't', dev.fetch as any);
    await gate.arrived;
    const snap = await t2.q.readOwnedQueue(A);
    const d = await t2.q.discardOwned(A, snap, { tab: 't2' });
    gate.release();
    const r = await sending;
    check('E5a a discard while another context is sending keeps the activity undecided (keptInFlight); the send completes and settles it exactly once', d.keptInFlight === 1 && d.removed === 0 && r.kind === 'confirmed' && rowsOf(A, 'race-1') === 1 && (await decisions()).find((x: any) => x.clientRequestId === 'race-1')?.decision === 'settled');
    // (b) a localStorage-only request: submission racing its durable discard, every interleaving.
    let unsafe = 0;
    for (let round = 0; round < 20; round++) {
      await fresh();
      if (!producer('rel04-r2-head').enqueueOwned(item(A, 'race-2'))) throw new Error('R2 enqueue failed');
      const s = await asAccount(CUR, A);
      const sn = await s.q.readOwnedQueue(A);
      const ops = [() => s.q.discardOwned(A, sn, { tab: 'x' }), () => s.sync.submitActivityLog(payload('same-payload', 'race-2'), 't', dev.fetch as any)];
      await Promise.all((round % 2 ? ops.reverse() : ops).map((f) => f()));
      const late = await s.sync.submitActivityLog(payload('same-payload', 'race-2'), 't', dev.fetch as any);
      if (rowsOf(A, 'race-2') !== 0 || late.kind === 'confirmed') unsafe++;
    }
    check('E5b 20 interleavings of a submission racing the durable discard of its localStorage-only request: never transmitted (zero server rows), refused afterwards', unsafe === 0);
  }
  // E6 Home and sign-out use the same logical classification
  {
    await fresh();
    const s = await asAccount(CUR, A);
    await offline(s, 'pending one', 'c-1');
    await offline(s, 'same-payload', 'c-2');
    producer('rel04-r2-head').enqueueOwned(item(A, 'c-2')); // retired copy of c-2 -> c-2 paused
    producer('rel04-r2-head').enqueueOwned(item(A, 'c-3')); // localStorage-only
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([item(A, 'c-4'), item(A, 'c-5'), item(A, 'c-3')]));
    const v = await s.q.readOfflineQueueView(A);
    const so = await signOut(s);
    check('E6 Home: 1 pending + 4 paused logical activities (7 physical copies); sign-out asks about the SAME 5 (4 paused) and reports 5 removed', v?.items.length === 1 && v?.paused === 4 && /You have 5 activity logs/.test(so.asked) && /4 of them are paused legacy activity/.test(so.asked) && so.out.owned?.removed === 5 && /5 unsynced activity logs were removed/.test(so.message));
  }
  // E7 account isolation of the durable discard
  {
    await fresh();
    for (const o of [A, B]) if (!producer('rel04-r2-head').enqueueOwned(item(o, 'iso-1'))) throw new Error('R2 enqueue failed');
    const sA = await asAccount(CUR, A);
    await signOut(sA);
    const sB = await asAccount(CUR, B);
    const vB = await sB.q.readOfflineQueueView(B);
    check('E7 A\'s durable discard decides only A\'s request: B\'s identical entry is untouched and still paused; no decision for B', lsKeys(`aura_q3:${B}:`).length === 1 && vB?.paused === 1 && (await decisions()).every((x: any) => x.ownerUserId === A));
  }
  // E8 healthy submission
  {
    await fresh();
    const s = await asAccount(CUR, A);
    const on = await s.sync.submitActivityLog(payload('online', 'ok-1'), 't', dev.fetch as any);
    const off = await offline(s, 'offline', 'ok-2');
    const pend = await s.q.readOfflineQueueView(A);
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    check('E8 healthy online submission is confirmed once; offline submission is queued, shown pending, then replayed and confirmed once', on.kind === 'confirmed' && rowsOf(A, 'ok-1') === 1 && off.kind === 'queued' && pend?.items.length === 1 && pend?.paused === 0 && rp.confirmed === 1 && rowsOf(A, 'ok-2') === 1);
  }
  // E9 no alternative submission path bypasses the boundary
  {
    const lsrc = fs.readFileSync(path.join(WEB, 'lib', 'activitySync.ts'), 'utf8');
    check('E9 submitActivityLog sends only after enqueueOwned stored and claimed the activity (storage failure -> storage-unavailable; no "outbox ? … : send anyway" path)', /if \(stored\.status === 'failed' \|\| stored\.status === 'unavailable'\) return \{ kind: 'storage-unavailable' \};/.test(lsrc) && /if \(!stored\.claim\) return/.test(lsrc) && (lsrc.match(/await post\(/g) ?? []).length === 2);
    const callers = execFileSync('git', ['grep', '-l', "fetch('/api/habit-logs', {", '--', 'apps/web'], { encoding: 'utf8' }).trim().split('\n').sort();
    const hookImported = execFileSync('git', ['grep', '-l', 'useHabitLogs', '--', 'apps/web'], { encoding: 'utf8' }).trim().split('\n');
    check('E9 the only other client POSTs are the unused useHabitLogs hook (never imported) and PastActivityModal\'s fallback (no clientRequestId, never reached: every caller passes onConfirmLog)', JSON.stringify(callers) === JSON.stringify(['apps/web/app/hooks/useHabitLogs.ts', 'apps/web/components/PastActivityModal.tsx']) && JSON.stringify(hookImported) === JSON.stringify(['apps/web/app/hooks/useHabitLogs.ts']));
    await fresh();
    dev.signIn(A);
    const before = logsOf(A).length;
    const res = await dev.fetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activityTitle: 'fallback', logMinuteOfDay: 600, logTimestamp: new Date().toISOString() }) });
    check(`E9 such a header-less POST is refused by the server before storing anything (${res.status})`, res.status === 503 && logsOf(A).length === before);
  }
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
