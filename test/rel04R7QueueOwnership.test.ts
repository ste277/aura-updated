/**
 * AURA-ANDROID-REL-04 (R7) -- queue ownership across EVERY supported storage
 * format (the sole remaining application finding of the R6 independent
 * assessment of 8d83f1f).
 *
 * Valid interim data is produced by the ACTUAL historical producers, vendored
 * byte-for-byte and re-checked against git when available:
 *   R1 d09449b  offline_habit_queue_v2:<owner>         (array)           enqueueOwned
 *   R2 db8607e  aura_q3:<owner>:<crid>                 (per entry)       enqueueOwned
 *   R3 b323d2a  aura_q4:<owner>:<crid>:<recordId>      random id         enqueueOwned
 *               aura_q4:<owner>:<crid>:m<hash>         SHARED id         its migrator (from aura_q3)
 *               aura_q4t:<owner>:<recordId>            marker            removeRecords
 *   R5 a3a02b8  IndexedDB records/markers under owner-less ids          readOwnedQueue/settle/discard
 *   R6 13d773e  IndexedDB records under account-scoped ids (q3/v2) and under the SHARED aura_q4 id
 * Each scenario runs against the R6 code head (test/fixtures/rel04-r6-head) to
 * show the defect and against the R7 code head 7cae58a (test/fixtures/rel04-r7-head)
 * to show the R7 correction.
 *
 * R8 (ticket 39224): HISTORICAL RECORD. Automatic migration of these unreleased
 * formats was retired; the current code is covered by test/rel04R8LogicalLifecycle.test.ts
 * (which also reproduces the four findings of the R7 assessment on 7cae58a).
 *
 *  O1  the assessment's reproduction (R3-migrated aura_q4 for two accounts, identical id + payload):
 *      shared identity; B reads zero; B's discard replaces A's marker; A's source (cleanup failed)
 *      resurrects; A's explicitly discarded activity replays and creates a server row
 *  O2  format matrix (R1 v2, R2 q3, R3 q4 random, R3 q4 migrated): independent records, reads,
 *      settlement and discard per account; no resurrection; discarded activity never replays
 *  O3  persisted IndexedDB formats: R5 owner-less records and markers, R6 mixed records, R3
 *      localStorage markers -- same-account compatibility, no duplicate logical work
 *  O4  an R6-damaged marker (another account's write replaced it): ownership cannot be established
 *      -> kept, shown, HELD (never sent automatically), discardable
 *  O5  settle/discard never act on another account's record; markers are account-scoped
 *  O6  repeated, interrupted (IndexedDB write failure) migration; unreadable storage keeps everything
 *  O7  concurrent operations of two accounts in two tabs
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R7QueueOwnership.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Device, WEB, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, logsOf, openTab, payload, queueDump, resetStore, storage, store } from './rel04AccountIsolationHarness';

const ts = require(require.resolve('typescript', { paths: [WEB] }));
const Module = require('module');
const FIX = path.join(__dirname, 'fixtures');
const fx = (dir: string, n: string) => fs.readFileSync(path.join(FIX, dir, n), 'utf8');

const HEADS: Array<[string, string, string, string]> = [
  ['d09449b', 'rel04-r1-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
  ['db8607e', 'rel04-r2-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
  ['b323d2a', 'rel04-r3-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
  ['a3a02b8', 'rel04-r5-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
  ['13d773e', 'rel04-r6-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
  ['13d773e', 'rel04-r6-head', 'activitySync.ts.txt', 'apps/web/lib/activitySync.ts'],
  ['13d773e', 'rel04-r6-head', 'signOut.ts.txt', 'apps/web/lib/signOut.ts'],
  ['7cae58a', 'rel04-r7-head', 'offlineHabitQueue.ts.txt', 'apps/web/lib/offlineHabitQueue.ts'],
  ['7cae58a', 'rel04-r7-head', 'activitySync.ts.txt', 'apps/web/lib/activitySync.ts'],
  ['7cae58a', 'rel04-r7-head', 'signOut.ts.txt', 'apps/web/lib/signOut.ts'],
];
(function provenance() {
  for (const [c, dir, f, src] of HEADS) {
    try { execFileSync('git', ['cat-file', '-e', `${c}^{commit}`], { stdio: 'ignore' }); } catch { console.log(`SKIP fixture re-check: ${c} not in this checkout; ${dir}/${f} used as vendored`); continue; }
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
const producer = (dir: string) => compile(fx(dir, 'offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.${dir}.js`));

const A = 'owner-account-a';
const B = 'owner-account-b';
addUser(A, 'owner-a@example.invalid');
addUser(B, 'owner-b@example.invalid');
const item = (ownerUserId: string, crid: string, title = 'same-payload') => ({ ...payload(title, crid), ownerUserId, tempId: 'temp' });
const realNow = Date.now;
const lsDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const denyStorage = () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage access denied'); } });
const restoreStorage = () => Object.defineProperty(globalThis, 'localStorage', lsDesc ?? { configurable: true, writable: true, value: storage });
const lsKeys = (prefix: string) => [...storage.data.keys()].filter((k) => k.startsWith(prefix));

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  closeAllTabs(); Date.now = realNow; restoreStorage();
  await clearQueueDb();
}

// ---------------------------------------------------------------- the code under test: R6 head or current
type Stack = { q: any; sync: any; acct: any; so: any };
type Impl = { name: 'R6' | 'R7'; tab: (id: string) => Stack };
const R6: Impl = {
  name: 'R6',
  tab: (id) => {
    const t = openTab(id); // fresh accountSession etc. for this tab; R6 queue/sync/sign-out bound to it
    const q = compile(fx('rel04-r6-head', 'offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r6.${id}.js`));
    const sync = compile(fx('rel04-r6-head', 'activitySync.ts.txt'), lib(`activitySync.r6.${id}.js`), { './offlineHabitQueue': q });
    const so = compile(fx('rel04-r6-head', 'signOut.ts.txt'), lib(`signOut.r6.${id}.js`), { './offlineHabitQueue': q });
    return { q, sync, acct: t.acct, so };
  },
};
const R7: Impl = {
  name: 'R7',
  tab: (id) => {
    const t = openTab(id); // R8: the R7 code head 7cae58a, vendored (the current code no longer migrates these formats)
    const q = compile(fx('rel04-r7-head', 'offlineHabitQueue.ts.txt'), lib(`offlineHabitQueue.r7.${id}.js`));
    const sync = compile(fx('rel04-r7-head', 'activitySync.ts.txt'), lib(`activitySync.r7.${id}.js`), { './offlineHabitQueue': q });
    const so = compile(fx('rel04-r7-head', 'signOut.ts.txt'), lib(`signOut.r7.${id}.js`), { './offlineHabitQueue': q });
    return { q, sync, acct: t.acct, so };
  },
};

const dev = new Device();
async function asAccount(impl: Impl, account: string, id: string): Promise<Stack> {
  dev.signIn(account);
  const s = impl.tab(id);
  await s.acct.fetchVerifiedSession(dev.fetch as any);
  return s;
}
const count = (r: any) => (r.ok ? r.records.length : -1);
const ownedMarkers = async (owner: string) => (await queueDump()).tombstones.filter((t: any) => t.ownerUserId === owner).length;

// ---------------------------------------------------------------- historical producers
type Format = { name: string; seed: (owner: string, crid: string, title?: string) => void };
const FORMATS: Format[] = [
  { name: 'R1 offline_habit_queue_v2 (R1 enqueueOwned)', seed: (o, c, t) => { if (!producer('rel04-r1-head').enqueueOwned(item(o, c, t))) throw new Error('R1 enqueue failed'); } },
  { name: 'R2 aura_q3 (R2 enqueueOwned)', seed: (o, c, t) => { if (!producer('rel04-r2-head').enqueueOwned(item(o, c, t))) throw new Error('R2 enqueue failed'); } },
  { name: 'R3 aura_q4 random id (R3 enqueueOwned)', seed: (o, c, t) => { if (producer('rel04-r3-head').enqueueOwned(item(o, c, t)).status !== 'stored') throw new Error('R3 enqueue failed'); } },
  {
    name: 'R3 aura_q4 shared migrated id (R3 migrator)',
    seed: (o, c, t) => {
      storage.setItem(`aura_q3:${o}:${c}`, JSON.stringify(item(o, c, t))); // R2-format source, migrated by the actual R3 migrator
      const r = producer('rel04-r3-head').readOwnedQueue(o);
      if (!r.ok || lsKeys(`aura_q3:${o}:`).length !== 0) throw new Error('R3 migration did not run');
    },
  },
];

/**
 * The isolation scenario on one format: identical crid + payload for A and B,
 * localStorage cleanup failing throughout (sources stay). Leg S: A replays
 * (settles), B discards, A's source is read again. Leg D: A discards, B
 * replays, A replays again.
 */
async function isolation(impl: Impl, f: Format, crid = 'same-id') {
  // ---- leg S
  await fresh();
  f.seed(A, crid); f.seed(B, crid);
  const q4ids = [A, B].map((o) => lsKeys(`aura_q4:${o}:`).map((k) => JSON.parse(storage.data.get(k)!).recordId)[0]);
  storage.fail.remove = true; // cleanup keeps failing: every source stays in place
  const sA = await asAccount(impl, A, `${impl.name}-sA`);
  const a0 = count(await sA.q.readOwnedQueue(A));
  const b0 = count(await sA.q.readOwnedQueue(B));
  const rpA = await sA.sync.replayOfflineQueue(dev.fetch as any);
  const sB = await asAccount(impl, B, `${impl.name}-sB`);
  const rB = await sB.q.readOwnedQueue(B);
  const b1 = count(rB);
  const dB = await sB.q.discardRecords(rB.ok ? rB.records.map((r: any) => r.recordId) : [], { tab: `${impl.name}-sB`, owner: B });
  const aMarkerKept = (await ownedMarkers(A)) > 0;
  const sA2 = await asAccount(impl, A, `${impl.name}-sA2`);
  const aResurrected = count(await sA2.q.readOwnedQueue(A));
  const legS = { sharedId: Boolean(q4ids[0] && q4ids[0] === q4ids[1]), a0, b0, aReplayed: rpA.attempted, aRows: logsOf(A).length, b1, bDiscarded: dB.removed, aMarkerKept, aResurrected };

  // ---- leg D
  await fresh();
  f.seed(A, crid); f.seed(B, crid);
  storage.fail.remove = true;
  const dA = await asAccount(impl, A, `${impl.name}-dA`);
  const rA = await dA.q.readOwnedQueue(A);
  const discA = await dA.q.discardRecords(rA.ok ? rA.records.map((r: any) => r.recordId) : [], { tab: `${impl.name}-dA`, owner: A });
  const dB2 = await asAccount(impl, B, `${impl.name}-dB`);
  const rpB = await dB2.sync.replayOfflineQueue(dev.fetch as any);
  const dA2 = await asAccount(impl, A, `${impl.name}-dA2`);
  const rpA2 = await dA2.sync.replayOfflineQueue(dev.fetch as any);
  const legD = { aDiscarded: discA.removed, bReplayed: rpB.attempted, bRows: logsOf(B).length, aDiscardedReplayed: rpA2.attempted, aRowsAfterDiscard: logsOf(A).length };
  storage.fail.remove = false;
  const ok = legS.a0 === 1 && legS.b0 === 1 && legS.aRows === 1 && legS.b1 === 1 && legS.bDiscarded === 1 && legS.aMarkerKept && legS.aResurrected === 0
    && legD.aDiscarded === 1 && legD.bRows === 1 && legD.aDiscardedReplayed === 0 && legD.aRowsAfterDiscard === 0;
  return { ok, legS, legD };
}

async function main() {
  // ---------------------------------------------------------------- O1 the assessment's reproduction
  const o1Format = FORMATS[3];
  const r6o1 = await isolation(R6, o1Format);
  console.log('O1 R6:', JSON.stringify(r6o1));
  check('O1 R6 HEAD: the actual R3 migrator gives both accounts\' aura_q4 entries the SAME recordId (shared legacy identity)', r6o1.legS.sharedId);
  check('O1 R6 HEAD reproduces: account B\'s readable queue reports ZERO entries while A\'s record holds the shared id', r6o1.legS.a0 === 1 && r6o1.legS.b0 === 0);
  check('O1 R6 HEAD reproduces: B\'s discard replaces A\'s settlement marker (no marker of A remains)', r6o1.legS.bDiscarded === 1 && r6o1.legS.aMarkerKept === false);
  check('O1 R6 HEAD reproduces: A\'s original source (cleanup failed) is RESURRECTED after that', r6o1.legS.aResurrected === 1);
  check('O1 R6 HEAD reproduces: A\'s explicitly DISCARDED activity is replayed and creates a server row', r6o1.legD.aDiscarded === 1 && r6o1.legD.aDiscardedReplayed === 1 && r6o1.legD.aRowsAfterDiscard === 1);
  const r7o1 = await isolation(R7, o1Format);
  console.log('O1 R7:', JSON.stringify(r7o1));
  check('O1 CORRECTED: identical R3 ids for two accounts -> two independent records; B reads its own entry (A 1, B 1)', r7o1.legS.sharedId && r7o1.legS.a0 === 1 && r7o1.legS.b0 === 1 && r7o1.legS.b1 === 1);
  check('O1 CORRECTED: A\'s settlement (server row for A) and B\'s discard are independent; A\'s marker is KEPT', r7o1.legS.aReplayed === 1 && r7o1.legS.aRows === 1 && r7o1.legS.bDiscarded === 1 && r7o1.legS.aMarkerKept);
  check('O1 CORRECTED: A\'s re-read source (cleanup failed) is matched to A\'s marker: NOT resurrected', r7o1.legS.aResurrected === 0);
  check('O1 CORRECTED: A\'s explicitly discarded activity NEVER replays (no server row for A); B\'s own entry is sent once', r7o1.legD.aDiscardedReplayed === 0 && r7o1.legD.aRowsAfterDiscard === 0 && r7o1.legD.bReplayed === 1 && r7o1.legD.bRows === 1);

  // ---------------------------------------------------------------- O2 format matrix
  const matrix: string[] = [];
  for (const f of FORMATS) {
    const r6 = await isolation(R6, f);
    const r7 = await isolation(R7, f);
    matrix.push(`${f.name}: R6 ${r6.ok ? 'isolated' : 'DEFECT'} | R7 ${r7.ok ? 'isolated' : 'DEFECT'}`);
    console.log(`O2 ${f.name} R6:`, JSON.stringify(r6), '\nO2', f.name, 'R7:', JSON.stringify(r7));
    check(`O2 ${f.name}: two accounts, identical crid + payload -> independent records, reads, settlement, discard; no resurrection; discarded activity never replays`, r7.ok);
  }
  console.log('O2 matrix:\n  ' + matrix.join('\n  '));
  check('O2 the matrix detects the R6 defect for the shared-id format (R3 migrated aura_q4) and passes every format after correction', matrix[3].includes('R6 DEFECT') && matrix.every((m) => m.endsWith('R7 isolated')));

  // ---------------------------------------------------------------- O3 persisted IndexedDB formats (compatibility)
  {
    // R5 (a3a02b8): A's aura_q3 entry migrated under the owner-less id, settled (bare-id marker), its source's cleanup failed.
    await fresh();
    producer('rel04-r2-head').enqueueOwned(item(A, 'r5-settled', 'settled under R5'));
    producer('rel04-r2-head').enqueueOwned(item(A, 'r5-pending', 'pending under R5'));
    const r5 = producer('rel04-r5-head');
    storage.fail.remove = true;
    const r5read = await r5.readOwnedQueue(A);
    await r5.settleRecords(r5read.records.filter((r: any) => r.item.clientRequestId === 'r5-settled').map((r: any) => r.recordId));
    await r5.__resetQueueDbForTests();
    storage.fail.remove = false;
    const before = await queueDump();
    const bareMarker = before.tombstones.find((t: any) => t.ownerUserId === A && !String(t.recordId).includes('\u0000'));
    const bareRecord = before.records.find((r: any) => r.clientRequestId === 'r5-pending');
    const t = await asAccount(R7, A, 'o3-r5');
    const r = await t.q.readOwnedQueue(A);
    const after = await queueDump();
    check('O3 R5 IndexedDB state: the owner-less marker of A is honoured (settled entry not recreated), A\'s owner-less pending record is kept AS IS (no duplicate), both sources retired', Boolean(bareMarker && bareRecord) && r.ok && r.records.length === 1 && r.records[0].recordId === bareRecord.recordId && after.records.length === 1 && after.tombstones.some((x: any) => x.recordId === bareMarker.recordId) && lsKeys(`aura_q3:${A}:`).length === 0);
    const rp = await t.sync.replayOfflineQueue(dev.fetch as any);
    check('O3 R5 pending record replays once for A and settles under A\'s account-scoped marker', rp.attempted === 1 && logsOf(A).length === 1 && (await queueDump()).records.length === 0 && (await queueDump()).tombstones.some((x: any) => x.recordId === t.q.markerKey(A, bareRecord.recordId)));
  }
  {
    // R6 (13d773e): one logical entry of A stored TWICE by R6 -- its aura_q3 copy migrated first (account-scoped id),
    // then an aura_q4 copy written by an R3 bundle (shared id) migrated by a later read.
    await fresh();
    const r6 = R6.tab('o3-r6');
    storage.setItem(`aura_q3:${A}:mixed`, JSON.stringify(item(A, 'mixed')));
    await r6.q.readOwnedQueue(A); // R6: aura_q3 -> account-scoped record
    storage.setItem(`aura_q3:${A}:mixed`, JSON.stringify(item(A, 'mixed'))); // an older (R3) tab writes the entry again ...
    producer('rel04-r3-head').readOwnedQueue(A); // ... and its migrator turns it into aura_q4 with the shared id
    const r6read = await r6.q.readOwnedQueue(A); // R6: aura_q4 -> a second record under the shared id
    const r6records = (await queueDump()).records.length;
    await r6.q.__resetQueueDbForTests();
    const t = await asAccount(R7, A, 'o3-r6b');
    const r = await t.q.readOwnedQueue(A);
    const rp = await t.sync.replayOfflineQueue(dev.fetch as any);
    check(`O3 R6 IndexedDB state with two records of one logical entry (R6 stored ${r6records}) is kept (no destructive normalization), presented once and sent ONCE`, r6read.ok && r6records === 2 && r.ok && r.records.length === 2 && r.items.length === 1 && rp.attempted === 1 && logsOf(A).length === 1 && (await queueDump()).records.length === 0);
  }
  {
    // Mixed-format interim sources of one entry under R7: one logical record.
    await fresh();
    producer('rel04-r1-head').enqueueOwned(item(A, 'mix3'));
    producer('rel04-r2-head').enqueueOwned(item(A, 'mix3'));
    storage.setItem(`aura_q3:${A}:mix3b`, JSON.stringify(item(A, 'mix3b')));
    producer('rel04-r3-head').readOwnedQueue(A); // mix3b -> aura_q4 shared id; mix3 q3 -> aura_q4 too (R3 migrates v2 and q3)
    producer('rel04-r2-head').enqueueOwned(item(A, 'mix3b')); // and its R2 copy again
    const t = await asAccount(R7, A, 'o3-mixed');
    const r = await t.q.readOwnedQueue(A);
    const crids = r.ok ? r.records.map((x: any) => x.item.clientRequestId).sort() : [];
    check('O3 mixed-format sources of the same entries (R1 v2 + R2 q3 + R3 q4) create ONE record per logical entry; every source retired', JSON.stringify(crids) === JSON.stringify(['mix3', 'mix3b']) && lsKeys('aura_q').filter((k) => !k.startsWith('aura_q4t:')).length === 0 && !storage.data.has(`offline_habit_queue_v2:${A}`));
  }
  {
    // R3 localStorage marker (aura_q4t:<owner>:<id>) of A; B's identical entry is unaffected.
    await fresh();
    FORMATS[3].seed(A, 'r3-marker'); FORMATS[3].seed(B, 'r3-marker');
    const r3 = producer('rel04-r3-head');
    const ra = r3.readOwnedQueue(A);
    storage.fail.remove = true; // R3 settlement: marker written, record removal fails
    r3.removeRecords(ra.records.map((x: any) => ({ key: x.key })));
    storage.fail.remove = false;
    const markerWritten = lsKeys(`aura_q4t:${A}:`).length === 1 && lsKeys(`aura_q4:${A}:`).length === 1;
    const t = await asAccount(R7, A, 'o3-r3m');
    const rA = await t.q.readOwnedQueue(A);
    const rB = await t.q.readOwnedQueue(B);
    check('O3 R3 localStorage marker of A is honoured for A only: A\'s settled entry not recreated, B\'s identical entry migrated for B', markerWritten && rA.ok && rA.records.length === 0 && rB.ok && rB.records.length === 1 && rB.records[0].item.ownerUserId === B);
  }

  // ---------------------------------------------------------------- O4 an R6-damaged marker: ownership cannot be established
  {
    await fresh();
    FORMATS[3].seed(A, 'damaged'); FORMATS[3].seed(B, 'damaged');
    storage.fail.remove = true;
    // R6 leg S: A settles, B's entry appears and is discarded -> A's bare marker now names B.
    const sA = await asAccount(R6, A, 'o4-a');
    await sA.q.readOwnedQueue(A);
    await sA.sync.replayOfflineQueue(dev.fetch as any);
    const sB = await asAccount(R6, B, 'o4-b');
    const rB = await sB.q.readOwnedQueue(B);
    await sB.q.discardRecords(rB.records.map((r: any) => r.recordId), { tab: 'o4-b' });
    await sA.q.__resetQueueDbForTests();
    const damaged = (await queueDump()).tombstones.every((x: any) => x.ownerUserId === B) && logsOf(A).length === 1;
    // Now the current code reads A (its source is still there).
    const t = await asAccount(R7, A, 'o4-r7');
    const r = await t.q.readOwnedQueue(A);
    const rp = await t.sync.replayOfflineQueue(dev.fetch as any);
    const claim = r.ok && r.records[0] ? await t.q.claimForDispatch(r.records[0].recordId, 'o4-r7') : null;
    const home = await t.q.readOfflineHabitQueue(A);
    check('O4 R6-damaged marker (A\'s decision overwritten by B): A\'s entry is KEPT and SHOWN but HELD -- not a replay group, not claimable, not replayed (no second row)', damaged && r.ok && r.records.length === 1 && r.records[0].held === true && r.groups.length === 0 && r.held.length === 1 && home?.length === 1 && rp.attempted === 0 && rp.held === 1 && claim?.status === 'held' && logsOf(A).length === 1);
    let asked = '';
    const so = await t.so.performSignOut({ fetch: dev.fetch as any, confirm: (m: string) => { asked = m; return true; } });
    const t2 = await asAccount(R7, A, 'o4-r7b');
    const again = await t2.q.readOwnedQueue(A);
    storage.fail.remove = false;
    check('O4 the held entry is counted at sign-out and the confirmed discard removes it under A\'s own marker; the remaining source is then matched to it (not recreated)', /1/.test(asked) && so.outcome === 'signed-out' && so.owned?.removed === 1 && again.ok && again.records.length === 0 && (await ownedMarkers(A)) >= 1);
  }

  // ---------------------------------------------------------------- O5 settle/discard never act on another account's record
  {
    await fresh();
    FORMATS[3].seed(A, 'guard'); FORMATS[3].seed(B, 'guard');
    const t = await asAccount(R7, B, 'o5');
    const rA = await t.q.readOwnedQueue(A);
    const aId = rA.records[0].recordId;
    const d = await t.q.discardRecords([aId], { tab: 'o5', owner: B });
    const s = await t.q.settleRecords([aId], undefined, { owner: B });
    const dump = await queueDump();
    check('O5 B\'s discard/settlement of A\'s recordId is refused (foreign), A\'s record intact, no marker written', d.removed === 0 && d.foreign === 1 && s.removed === 0 && s.foreign === 1 && dump.records.some((r: any) => r.recordId === aId && r.ownerUserId === A) && dump.tombstones.length === 0);
    const rB = await t.q.readOwnedQueue(B);
    await t.q.discardRecords(rB.records.map((r: any) => r.recordId), { tab: 'o5', owner: B });
    const tombs = (await queueDump()).tombstones;
    check('O5 every marker written is account-scoped (key = account + recordId) and names its account', tombs.length === 1 && tombs[0].ownerUserId === B && tombs[0].recordId === t.q.markerKey(B, tombs[0].ref));
  }

  // ---------------------------------------------------------------- O6 repeated / interrupted migration, unreadable storage
  {
    await fresh();
    FORMATS[3].seed(A, 'rep'); FORMATS[3].seed(B, 'rep');
    const t = await asAccount(R7, A, 'o6');
    idbFault.write = true; // the migration transaction fails (interrupted)
    const failA = await t.q.readOwnedQueue(A);
    idbFault.write = false;
    const sourcesKept = lsKeys(`aura_q4:${A}:`).length === 1 && lsKeys(`aura_q4:${B}:`).length === 1;
    for (let i = 0; i < 3; i++) { await t.q.readOwnedQueue(A); await t.q.readOwnedQueue(B); }
    const dump = await queueDump();
    check('O6 an interrupted migration reports unreadable and keeps both sources; repeated migration then yields exactly one record per account', !failA.ok && sourcesKept && dump.records.length === 2 && new Set(dump.records.map((r: any) => r.ownerUserId)).size === 2);
    await t.q.settleRecords(dump.records.filter((r: any) => r.ownerUserId === A).map((r: any) => r.recordId), undefined, { owner: A });
    FORMATS[3].seed(B, 'rep-2');
    const pre = await queueDump();
    denyStorage();
    const ua = await t.q.readOwnedQueue(A);
    const ub = await t.q.readOwnedQueue(B);
    restoreStorage();
    const post = await queueDump();
    check('O6 unreadable storage: both accounts reported unreadable; every marker and pending record kept', !ua.ok && !ub.ok && JSON.stringify(pre.tombstones) === JSON.stringify(post.tombstones) && post.records.length === pre.records.length);
  }

  // ---------------------------------------------------------------- O7 concurrency / account switching
  {
    await fresh();
    for (const c of ['c1', 'c2', 'c3']) { FORMATS[3].seed(A, c); FORMATS[3].seed(B, c); }
    const tA = await asAccount(R7, A, 'o7-a');
    const tB = R7.tab('o7-b');
    const reads = await Promise.all([tA.q.readOwnedQueue(A), tB.q.readOwnedQueue(B), tA.q.readOwnedQueue(B), tB.q.readOwnedQueue(A)]);
    const rB = reads[1];
    const [rp, dB] = await Promise.all([tA.sync.replayOfflineQueue(dev.fetch as any), tB.q.discardRecords(rB.records.map((r: any) => r.recordId), { tab: 'o7-b', owner: B })]);
    const dump = await queueDump();
    check('O7 concurrent migration/reads by two tabs for two accounts: 3 + 3 records, each read sees only its account', reads.every((r) => r.ok && r.records.length === 3) && reads[0].records.every((r: any) => r.item.ownerUserId === A) && reads[1].records.every((r: any) => r.item.ownerUserId === B));
    check('O7 concurrent replay (A) and discard (B): A sent 3 (3 rows), B discarded 3; 6 markers, each of its own account', rp.attempted === 3 && logsOf(A).length === 3 && logsOf(B).length === 0 && dB.removed === 3 && dump.records.length === 0 && dump.tombstones.length === 6 && dump.tombstones.filter((x: any) => x.ownerUserId === A).length === 3);
    const sw = await asAccount(R7, B, 'o7-b2');
    for (const c of ['c1', 'c2', 'c3']) { storage.setItem(`aura_q3:${A}:${c}`, JSON.stringify(item(A, c))); storage.setItem(`aura_q3:${B}:${c}`, JSON.stringify(item(B, c))); }
    const rpB = await sw.sync.replayOfflineQueue(dev.fetch as any);
    const rA2 = await sw.q.readOwnedQueue(A);
    check('O7 after switching to B, re-appearing sources of both accounts are matched to their own markers: nothing replayed, nothing recreated', rpB.attempted === 0 && rA2.ok && rA2.records.length === 0 && store.logs.length === 3);
  }

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
