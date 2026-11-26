/**
 * AURA-ANDROID-REL-04 (R10) -- durable discard identity and sign-out reporting: the open findings of independent
 * verification ticket 39228-R9 (reviewed head 9385eb2, implementation 513c12b; X2 PARTIAL).
 *
 * The reviewer's probe (test/review-rel04R9Independent.ts) and logs are preserved byte-for-byte in
 * docs/android/evidence/rel04-r9-independent-39228/ (SHA256SUMS). Its two new witnesses are re-run here, in the
 * probe's own shape, against the R9 code head 513c12b (vendored in test/fixtures/rel04-r9-head, checked against
 * git) and against the current code:
 *
 *  W1  an identifiable activity with a damaged NON-identity field (timestamp) -- historical v2 entry and IndexedDB
 *      record: R9 deletes it at sign-out WITHOUT a decision; the same request is then confirmed (server row)
 *  W2  one unsent activity removed + one possibly-sent activity pending physical cleanup: R9 attributes the
 *      possible send to the removed one
 *
 *  M   the R10 invariant: identity established from identity fields alone (missing / malformed / conflicting
 *      identity preserved), active + retired formats, mixed copies, foreign records, failed and ambiguous
 *      transactions, cleanup failure, resubmission, concurrency, per-category reporting, healthy submission,
 *      the released legacy array
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R10DurableDiscardIdentity.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const crypto = require('crypto');
const FIX = path.join(__dirname, 'fixtures');
const fx = (dir: string, n: string) => fs.readFileSync(path.join(FIX, dir, n), 'utf8');
const gitHas = (c: string) => { try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };

(function provenance() {
  const HEADS: Array<[string, string, string, string]> = [
    ['d09449b', 'rel04-r1-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['db8607e', 'rel04-r2-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['b323d2a', 'rel04-r3-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['513c12b', 'rel04-r9-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
    ['513c12b', 'rel04-r9-head', 'activitySync.ts.txt', 'apps/web/lib/activitySync.ts'],
    ['513c12b', 'rel04-r9-head', 'signOut.ts.txt', 'apps/web/lib/signOut.ts'],
  ];
  for (const [c, dir, f, src] of HEADS) {
    if (!gitHas(c)) { console.log(`SKIP fixture re-check: ${c} not in this checkout; ${dir}/${f} used as vendored`); continue; }
    check(`fixture ${dir}/${f} == ${c} ${src}`, execFileSync('git', ['show', `${c}:${src}`], { encoding: 'utf8', maxBuffer: 1 << 26 }) === fx(dir, f));
  }
  const W = path.join(__dirname, '..', 'docs', 'android', 'evidence', 'rel04-r9-independent-39228');
  const sums = fs.readFileSync(path.join(W, 'SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/));
  check('the 39228-R9 reviewer evidence (probe + logs) is preserved byte-for-byte (SHA256SUMS)', sums.length === 11 && sums.every(([h, f]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(W, f))).digest('hex') === h));
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

const A = 'r10-account-a';
const B = 'r10-account-b';
addUser(A, 'r10-a@example.invalid');
addUser(B, 'r10-b@example.invalid');
const item = (ownerUserId: string, crid: string, title = 'same-payload') => ({ ...payload(title, crid), ownerUserId, tempId: 'temp' });
const realNow = Date.now;
const lsKeys = (prefix: string) => [...storage.data.keys()].filter((k) => k.startsWith(prefix));
const rowsOf = (owner: string, crid: string) => logsOf(owner).filter((l: any) => l.clientRequestId === crid).length;

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  closeAllTabs(); Date.now = realNow;
  await clearQueueDb();
}

type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: 'R9' | 'current'; tab: (id: string) => Stack };
const R9: Impl = {
  name: 'R9',
  tab: (id) => {
    const t = openTab(id);
    const q = compile(fx('rel04-r9-head', 'offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r9.${id}.${seq++}.js`));
    const sync = compile(fx('rel04-r9-head', 'activitySync.ts.txt'), lib(`activitySync.r9.${id}.${seq++}.js`), { './offlineHabitQueue': q });
    const so = compile(fx('rel04-r9-head', 'signOut.ts.txt'), lib(`signOut.r9.${id}.${seq++}.js`), { './offlineHabitQueue': q });
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
async function putRecord(s: Stack, rec: any) {
  const db: IDBDatabase = await s.q.__openQueueDbForTests();
  const t = db.transaction(['records'], 'readwrite');
  t.objectStore('records').put(rec);
  await new Promise<void>((ok, err) => { t.oncomplete = () => ok(); t.onerror = () => err(t.error); });
}
async function damageRecord(s: Stack, crid: string, patch: Record<string, unknown>) {
  const rec = (await queueDump()).records.find((r: any) => r.clientRequestId === crid);
  await putRecord(s, { ...rec, item: { ...rec.item, ...patch } });
}
const submit = (s: Stack, crid: string, title = 'same-payload') => s.sync.submitActivityLog(payload(title, crid), 'temp', dev.fetch as any);

// ---------------------------------------------------------------- the reviewer's witnesses (probe shape)
async function w1(impl: Impl, format: 'v2' | 'idb') {
  await fresh();
  const crid = 'identifiable-damage-' + format;
  const x = item(A, crid);
  const a = await asAccount(impl, A);
  if (format === 'v2') {
    if (!producer('rel04-r1-head').enqueueOwned(x)) throw Error('Historical v2 setup failed');
    const key = a.q.QUEUE_V2_PREFIX + A;
    const prior = JSON.parse(storage.data.get(key)!);
    prior[0].logTimestamp = 'corrupt';
    storage.setItem(key, JSON.stringify(prior));
  } else {
    if ((await offline(a, 'same-payload', crid)).kind !== 'queued') throw Error('Active setup failed');
    await damageRecord(a, crid, { logTimestamp: 'corrupt' });
  }
  const view = await a.q.readOfflineQueueView(A);
  const discarded = await signOut(a);
  const markers = (await decisions()).filter((t: any) => t.clientRequestId === crid).length;
  const b = await asAccount(impl, A);
  const wrote = await submit(b, crid);
  return { format, paused: view.paused, removed: discarded.out.owned?.removed, markers, submit: wrote.kind, rows: rowsOf(A, crid) };
}
async function w2(impl: Impl) {
  await fresh();
  const a = await asAccount(impl, A);
  dev.fault('POST', '/api/habit-logs', 'network-after');
  const amb = await submit(a, 'was-sent');
  if (amb.kind !== 'queued' || rowsOf(A, 'was-sent') !== 1) throw Error('Ambiguous send setup failed');
  if ((await a.q.enqueueOwned(item(A, 'never-sent'))).status !== 'stored') throw Error('Unsent setup failed');
  producer('rel04-r2-head').enqueueOwned(item(A, 'was-sent'));
  storage.fail.remove = true;
  const removed = await signOut(a);
  storage.fail.remove = false;
  return { counts: removed.out.owned, actuallySentRows: rowsOf(A, 'was-sent'), unsentRows: rowsOf(A, 'never-sent'), message: removed.message };
}

async function main() {
  // ================================================================ W1
  for (const f of ['v2', 'idb'] as const) {
    const b = await w1(R9, f);
    console.log(`W1 R9 ${f}:`, JSON.stringify(b));
    check(`W1 R9 HEAD reproduces (${f}): readable request id, damaged timestamp -> sign-out removes it with NO decision; the same request is then CONFIRMED (1 server row)`, b.paused === 1 && b.removed === 1 && b.markers === 0 && b.submit === 'confirmed' && b.rows === 1);
    const a = await w1(CUR, f);
    console.log(`W1 current ${f}:`, JSON.stringify(a));
    check(`W1 CORRECTED (${f}): discarded by its identity with a durable decision; the same request is refused, ZERO server rows`, a.paused === 1 && a.removed === 1 && a.markers === 1 && a.submit === 'not-stored' && a.rows === 0);
  }
  // ================================================================ W2
  {
    const b = await w2(R9);
    console.log('W2 R9:', JSON.stringify(b));
    check('W2 R9 HEAD reproduces: the possible send is attributed to the REMOVED (never-sent) log, not to the cleanup-pending (sent) one', b.counts.removed === 1 && b.counts.removedPossiblySent === 1 && b.counts.cleanupPending === 1 && b.actuallySentRows === 1 && b.unsentRows === 0 && /1 unsynced activity log was removed from this device\. It may already have been sent/.test(b.message));
    const a = await w2(CUR);
    console.log('W2 current:', JSON.stringify(a));
    check('W2 CORRECTED: removed 1 (not possibly sent), cleanup-pending 1 (possibly sent); the message attributes the possible send only to the cleanup-pending log', a.counts.removed === 1 && a.counts.removedPossiblySent === 0 && a.counts.cleanupPending === 1 && a.counts.cleanupPendingPossiblySent === 1 && !/removed from this device\. It may already have been sent/.test(a.message) && /couldn't delete its copy from this device's storage\. It may already have been sent/.test(a.message));
  }

  // ================================================================ M invariant
  // M1 invalid or missing NON-identity fields, every format: discarded durably by identity, never resubmittable
  {
    await fresh();
    const s = await asAccount(CUR, A);
    const { activityTitle: _drop, ...noTitle } = item(A, 'v2-notitle');
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([{ ...item(A, 'v2-badts'), logTimestamp: 'not a date' }, noTitle, { ...item(A, 'v2-nots'), logTimestamp: undefined }]));
    storage.setItem(`aura_q3:${A}:q3-notitle`, JSON.stringify({ ...item(A, 'q3-notitle'), activityTitle: '' }));
    storage.setItem(`aura_q4:${A}:q4-badts:r1`, JSON.stringify({ ...item(A, 'q4-badts'), logTimestamp: 'x', recordId: 'r1' }));
    await offline(s, 'same-payload', 'idb-notitle');
    await damageRecord(s, 'idb-notitle', { activityTitle: 42 });
    const crids = ['v2-badts', 'v2-notitle', 'v2-nots', 'q3-notitle', 'q4-badts', 'idb-notitle'];
    const v = await s.q.readOfflineQueueView(A);
    const so = await signOut(s);
    const s2 = await asAccount(CUR, A);
    const subs = await Promise.all(crids.map((c) => submit(s2, c)));
    check('M1 six identifiable activities with malformed or missing non-identity fields (v2 ×3, aura_q3, aura_q4, IndexedDB): counted as 6 paused, all discarded with a durable decision, all copies removed; every resubmission refused; ZERO server rows', v?.paused === 6 && so.out.owned?.removed === 6 && (await decisions()).length === 6 && lsKeys('aura_q').length === 0 && !storage.data.has(`offline_habit_queue_v2:${A}`) && (await queueDump()).records.length === 0 && subs.every((r: any) => r.kind === 'not-stored') && crids.every((c) => rowsOf(A, c) === 0));
  }
  // M2 missing, malformed and conflicting IDENTITY fields: preserved, reported, never eligible
  {
    await fresh();
    const s = await asAccount(CUR, A);
    const { clientRequestId: _c, ...noId } = item(A, 'x');
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([noId, { ...item(A, 'y'), clientRequestId: 7 }, { ...item(A, 'v2-good') }]));
    storage.setItem(`aura_q3:${A}:q3-key`, JSON.stringify({ ...item(A, 'q3-value') })); // key and value disagree
    storage.setItem(`aura_q3:${A}:q3-badid`, JSON.stringify({ ...item(A, 'q3-badid'), clientRequestId: { not: 'an id' } }));
    await offline(s, 'same-payload', 'idb-conflict');
    await damageRecord(s, 'idb-conflict', { ownerUserId: B }); // the record's value names ANOTHER account
    const v = await s.q.readOfflineQueueView(A);
    const blocked = await Promise.all(['q3-key', 'q3-value', 'q3-badid', 'idb-conflict'].map((c) => submit(s, c)));
    const so = await signOut(s);
    check('M2 identity-less (v2 missing id, v2 malformed id) and identity-conflicting entries (aura_q3 key vs value, aura_q3 malformed id, IndexedDB naming another account) are counted, never eligible (all refused, no server row)', v?.paused === 6 && blocked.every((r: any) => r.kind === 'not-stored') && ['q3-key', 'q3-value', 'q3-badid', 'idb-conflict'].every((c) => rowsOf(A, c) === 0));
    check('M2 the discard decides ONLY the identified activity (v2-good) and PRESERVES the 5 unidentifiable ones (reported "couldn\'t be identified safely"); the v2 array that holds them is kept (v2-good cleanup pending)', so.out.owned?.unidentified === 5 && so.out.owned?.removed === 0 && so.out.owned?.cleanupPending === 1 && (await decisions()).map((d: any) => d.clientRequestId).join() === 'v2-good' && storage.data.has(`offline_habit_queue_v2:${A}`) && storage.data.has(`aura_q3:${A}:q3-key`) && storage.data.has(`aura_q3:${A}:q3-badid`) && (await queueDump()).records.length === 1 && /5 activity logs from an earlier test version of Aura couldn't be identified safely/.test(so.message));
  }
  // M3 mixed-format copies of ONE logical activity, some damaged: one activity, one decision, all removed
  {
    await fresh();
    const s = await asAccount(CUR, A);
    await offline(s, 'same-payload', 'mix-dmg');
    await damageRecord(s, 'mix-dmg', { logTimestamp: 'bad' });
    producer('rel04-r2-head').enqueueOwned(item(A, 'mix-dmg'));
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([{ ...item(A, 'mix-dmg'), activityTitle: null }]));
    const v = await s.q.readOfflineQueueView(A);
    const so = await signOut(s);
    const s2 = await asAccount(CUR, A);
    const r = await submit(s2, 'mix-dmg');
    check('M3 a damaged IndexedDB copy + valid aura_q3 + damaged v2 copy of ONE activity: counted once, asked about once, removed once with ONE decision; resubmission refused; ZERO rows', v?.paused === 1 && /You have 1 activity log/.test(so.asked) && so.out.owned?.removed === 1 && (await decisions()).length === 1 && lsKeys('aura_q').length === 0 && !storage.data.has(`offline_habit_queue_v2:${A}`) && (await queueDump()).records.length === 0 && r.kind === 'not-stored' && rowsOf(A, 'mix-dmg') === 0);
  }
  // M4 foreign-account records are never touched
  {
    await fresh();
    for (const o of [A, B]) storage.setItem(`aura_q3:${o}:iso`, JSON.stringify({ ...item(o, 'iso'), logTimestamp: 'bad' }));
    const sB = await asAccount(CUR, B);
    await offline(sB, 'same-payload', 'iso-idb');
    await damageRecord(sB, 'iso-idb', { logTimestamp: 'bad' });
    const sA = await asAccount(CUR, A);
    await signOut(sA);
    const sB2 = await asAccount(CUR, B);
    const vB = await sB2.q.readOfflineQueueView(B);
    check('M4 A\'s discard decides only A\'s damaged entry; B\'s damaged localStorage and IndexedDB entries are untouched, still paused, and B has no decision', lsKeys(`aura_q3:${B}:`).length === 1 && vB?.paused === 2 && (await queueDump()).records.length === 1 && (await decisions()).every((d: any) => d.ownerUserId === A));
  }
  // M5 failed and ambiguous discard transactions
  {
    await fresh();
    const s = await asAccount(CUR, A);
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([{ ...item(A, 'fx-1'), logTimestamp: 'bad' }]));
    const so = await signOut(s, () => { idbFault.write = true; });
    idbFault.write = false;
    const s2 = await asAccount(CUR, A);
    const r = await submit(s2, 'fx-1');
    check('M5 a FAILED discard transaction (damaged identifiable v2 entry) records nothing and removes nothing: reported failed (never removed), entry preserved, still refused, ZERO rows', so.out.owned?.failed === 1 && so.out.owned?.removed === 0 && (await decisions()).length === 0 && storage.data.has(`offline_habit_queue_v2:${A}`) && r.kind === 'not-stored' && rowsOf(A, 'fx-1') === 0);
    await fresh();
    const s3 = await asAccount(CUR, A);
    storage.setItem(`aura_q3:${A}:amb-1`, '{damaged');
    const snap = await s3.q.readOwnedQueue(A);
    const realRemove = storage.removeItem.bind(storage);
    (storage as any).removeItem = () => { throw new Error('context terminated before cleanup (synthetic)'); };
    const d = await s3.q.discardOwned(A, snap, { tab: 't' });
    (storage as any).removeItem = realRemove;
    const r2 = await submit(s3, 'amb-1');
    check('M5 an AMBIGUOUS end (decision committed, cleanup never ran) for an unparseable aura_q3 value identified by its key: cleanup pending, the survivor is permanently ineligible, ZERO rows', d.cleanupPending === 1 && lsKeys(`aura_q3:${A}:`).length === 1 && r2.kind === 'not-stored' && rowsOf(A, 'amb-1') === 0);
  }
  // M6 durable discard succeeds, physical cleanup fails; a retry completes it
  {
    await fresh();
    const s = await asAccount(CUR, A);
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([{ ...item(A, 'cp-1'), logTimestamp: 'bad' }]));
    storage.fail.remove = true;
    const so = await signOut(s);
    storage.fail.remove = false;
    const s2 = await asAccount(CUR, A);
    const r = await submit(s2, 'cp-1');
    const rp = await s2.sync.replayOfflineQueue(dev.fetch as any);
    const so2 = await signOut(s2);
    check('M6 cleanup failing after the durable discard: cleanup-pending (never removed), resubmission refused, replay sends nothing, ZERO rows; a retried sign-out removes it', so.out.owned?.cleanupPending === 1 && so.out.owned?.removed === 0 && r.kind === 'not-stored' && rp.attempted === 0 && rowsOf(A, 'cp-1') === 0 && so2.out.owned?.removed === 1 && !storage.data.has(`offline_habit_queue_v2:${A}`));
  }
  // M7 concurrent submission and discard of a damaged localStorage-only request
  {
    let unsafe = 0;
    for (let round = 0; round < 20; round++) {
      await fresh();
      storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([{ ...item(A, 'race-d'), logTimestamp: 'bad' }]));
      const s = await asAccount(CUR, A);
      const sn = await s.q.readOwnedQueue(A);
      const ops = [() => s.q.discardOwned(A, sn, { tab: 'x' }), () => submit(s, 'race-d')];
      await Promise.all((round % 2 ? ops.reverse() : ops).map((f) => f()));
      const late = await submit(s, 'race-d');
      if (rowsOf(A, 'race-d') !== 0 || late.kind === 'confirmed') unsafe++;
    }
    check('M7 20 interleavings of a submission racing the durable discard of its damaged localStorage-only request: never transmitted, refused afterwards', unsafe === 0);
  }
  // M8 per-category reporting with physical duplicates
  {
    await fresh();
    const s = await asAccount(CUR, A);
    dev.fault('POST', '/api/habit-logs', 'network-after');
    await submit(s, 'sent-dup');
    producer('rel04-r2-head').enqueueOwned(item(A, 'sent-dup'));
    storage.setItem(`offline_habit_queue_v2:${A}`, JSON.stringify([item(A, 'sent-dup'), item(A, 'unsent-ls')]));
    await s.q.enqueueOwned(item(A, 'unsent-idb'));
    storage.fail.remove = true;
    const so = await signOut(s);
    storage.fail.remove = false;
    const o = so.out.owned;
    check('M8 3 logical activities over 5 copies: asked about 3; 1 removed (not possibly sent), 2 cleanup-pending of which exactly 1 possibly sent; physical duplicates never counted twice', /You have 3 activity logs/.test(so.asked) && o?.removed === 1 && o?.removedPossiblySent === 0 && o?.cleanupPending === 2 && o?.cleanupPendingPossiblySent === 1 && /1 of those may already have been sent/.test(so.message));
  }
  // M9 healthy online submission and offline replay
  {
    await fresh();
    const s = await asAccount(CUR, A);
    const on = await submit(s, 'ok-1', 'online');
    const off = await offline(s, 'offline', 'ok-2');
    const rp = await s.sync.replayOfflineQueue(dev.fetch as any);
    check('M9 healthy online submission is confirmed once; offline submission is queued then replayed and confirmed once', on.kind === 'confirmed' && rowsOf(A, 'ok-1') === 1 && off.kind === 'queued' && rp.confirmed === 1 && rowsOf(A, 'ok-2') === 1);
  }
  // M10 the released unscoped legacy array keeps its read-only quarantine contract
  {
    await fresh();
    const legacy = JSON.stringify([{ ...payload('released legacy', 'leg-1'), logTimestamp: 'bad' }, { ...payload('released legacy 2', 'leg-2') }]);
    storage.setItem('offline_habit_queue', legacy);
    const s = await asAccount(CUR, A);
    const v = await s.q.readOfflineQueueView(A);
    const so = await signOut(s);
    check('M10 the released offline_habit_queue is never counted as the account\'s, never decided, never sent, byte-identical after sign-out and reported as left in place', v?.paused === 0 && (await decisions()).length === 0 && storage.data.get('offline_habit_queue') === legacy && so.out.legacyKept === 2 && rowsOf(A, 'leg-1') + rowsOf(A, 'leg-2') === 0);
  }
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
