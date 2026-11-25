/**
 * AURA-ANDROID-REL-04 (R5) -- IndexedDB queue follow-ups from the R4
 * independent disposition (architecture accepted), against the real client
 * modules (one instance and IndexedDB connection per tab) and the real
 * middleware + routes.
 *
 *  T1  migration tombstones are retained until source retirement is established (prolonged cleanup failure)
 *  T2  an uncertain migration source (changed since it was copied) is preserved, and its new content migrates
 *  T3  one claim per account + clientRequestId (several records of one logical request)
 *  T4  release and settlement are fenced by the attempt token (late completion after reclaim)
 *  T5  integration: a delayed send completing after another attempt reclaimed and settled
 *  T6  unavailable queue state is distinct from an empty queue (presentation read)
 *  T7  version-1 database upgrade keeps records and carries dispatch marks over to the request key
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R5QueueLifecycle.test.ts
 */
import { Device, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, locks, logsOf, openTab, payload, queueDump, queuedCrids, resetStore, routes, storage } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
addUser(A, 'alicesynth@example.invalid');
const habitRoute = routes['POST /api/habit-logs'];
const realNow = Date.now;
const DAY = 24 * 3600_000;

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  locks.enabled = true; closeAllTabs(); routes['POST /api/habit-logs'] = habitRoute;
  Date.now = realNow;
  await clearQueueDb();
}
async function tabAs(dev: Device, id: string) {
  dev.signIn(A);
  const t = openTab(id);
  t.acct.subscribeAccount(() => {});
  await t.acct.fetchVerifiedSession(dev.fetch as any);
  return t;
}
const owned = (title: string, crid: string) => ({ ...payload(title, crid), ownerUserId: A, tempId: 't' });

async function main() {
  // ---------------------------------------------------------------- T1 tombstones retained until source retirement
  {
    await fresh();
    const v2Key = 'offline_habit_queue_v2:' + A;
    const src = JSON.stringify([owned('v2', 'crid-t1')]);
    storage.data.set(v2Key, src);
    storage.data.set(`aura_q3:${A}:crid-broken`, '{unparseable'); // a source cleanup can never retire
    const dev = new Device();
    const t = await tabAs(dev, 't1');
    const r = await t.q.readOwnedQueue(A);
    await t.q.settleRecords(r.ok ? r.records.map((x) => x.recordId) : []);
    const t0 = realNow();
    Date.now = () => t0 + 45 * DAY; // far beyond the 30-day tombstone lifetime
    const t2 = openTab('t1b'); // fresh module (no per-session prune memo)
    await t2.q.readOwnedQueue(A);
    const tombsKept = (await queueDump()).tombstones.length;
    storage.data.set(v2Key, src); // a stale copy of the settled source re-appears
    const again = await t2.q.readOwnedQueue(A);
    check('T1 with an interim source still present (cleanup failing for 45 days), the tombstone is RETAINED and the settled entry is never recreated', tombsKept === 1 && again.ok && again.records.length === 0 && (await queueDump()).tombstones.length === 1);
    storage.data.delete(`aura_q3:${A}:crid-broken`); // retirement now established
    storage.data.delete(v2Key);
    const t3 = openTab('t1c');
    await t3.q.readOwnedQueue(A);
    check('T1 once no interim source remains (retirement established), the expired tombstone is pruned', (await queueDump()).tombstones.length === 0);
    Date.now = realNow;
  }

  // ---------------------------------------------------------------- T2 uncertain source preserved
  {
    await fresh();
    const key = `aura_q3:${A}:crid-t2`;
    const first = JSON.stringify(owned('first payload', 'crid-t2'));
    const changed = JSON.stringify(owned('changed payload', 'crid-t2b'));
    storage.data.set(key, first);
    const dev = new Device();
    const t = await tabAs(dev, 't2');
    // Another writer changes the source after it was read for copying, before the post-commit removal.
    const realGet = storage.getItem.bind(storage);
    let reads = 0;
    (storage as any).getItem = (k: string) => { if (k === key && ++reads === 2) storage.data.set(key, changed); return realGet(k); };
    await t.q.readOwnedQueue(A);
    (storage as any).getItem = realGet;
    check('T2 a source that changed after it was copied is NOT removed (uncertain: preserved)', storage.data.get(key) === changed);
    const r = await t.q.readOwnedQueue(A);
    const crids = r.ok ? r.records.map((x) => x.item.clientRequestId).sort() : [];
    check('T2 its new content migrates on the next read, and the source is then retired', JSON.stringify(crids) === JSON.stringify(['crid-t2', 'crid-t2b']) && !storage.data.has(key));
  }

  // ---------------------------------------------------------------- T3 one claim per logical request
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, 't3a');
    const t2 = openTab('t3b'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    // Two records of ONE logical request (same account + clientRequestId + payload): an R3 record and an R2 entry.
    storage.data.set(`aura_q4:${A}:crid-t3:r3rec`, JSON.stringify({ ...owned('same', 'crid-t3'), recordId: 'r3rec', queuedAt: 1 }));
    storage.data.set(`aura_q3:${A}:crid-t3`, JSON.stringify(owned('same', 'crid-t3')));
    const r = await t1.q.readOwnedQueue(A);
    const ids = r.ok ? r.records.map((x) => x.recordId) : [];
    const c1 = await t1.q.claimForDispatch(ids[0], 't3a');
    const c2 = await t2.q.claimForDispatch(ids[1], 't3b');
    check('T3 the request has two records; claiming one record claims the REQUEST: the other record cannot be claimed by another context', ids.length === 2 && c1.status === 'claimed' && c2.status === 'in-flight');
    const d = await t2.q.discardRecords([ids[1]], { tab: 't3b' });
    check('T3 a discard of the sibling record while the request is being sent keeps it (keptInFlight)', d.keptInFlight === 1 && d.removed === 0);
  }

  // ---------------------------------------------------------------- T4 attempt fencing
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, 't4a');
    const t2 = openTab('t4b'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    const e = await t1.q.enqueueOwned({ ...owned('slow', 'crid-t4') }, { claimFor: 't4a' });
    const tok1 = e.status === 'stored' ? e.claim! : null;
    const t0 = realNow();
    Date.now = () => t0 + 61_000; // attempt 1 is suspended past the claim lifetime
    const c2 = await t2.q.claimForDispatch(e.status === 'stored' ? e.recordId : '', 't4b');
    const tok2 = c2.status === 'claimed' ? c2.claim : null;
    const rel = await t1.q.releaseClaim(tok1!);
    const claimAfterRelease = (await queueDump()).claims[0];
    check('T4 a late release by the superseded attempt is refused ("superseded") and attempt 2\'s claim is intact', !!tok1 && !!tok2 && tok1.attempt !== tok2.attempt && rel === 'superseded' && claimAfterRelease?.attempt === tok2!.attempt);
    const s1 = await t1.q.settleRecords([e.status === 'stored' ? e.recordId : ''], tok1!);
    check('T4 a late DEFINITIVE answer for attempt 1 settles the records (the server has them) but reports superseded and leaves attempt 2\'s claim alone', s1.removed === 1 && s1.superseded === true && (await queueDump()).claims[0]?.attempt === tok2!.attempt);
    const rel2 = await t2.q.releaseClaim(tok2!);
    check('T4 attempt 2 then releases its own claim', rel2 === 'released' && (await queueDump()).claims.length === 0);
    Date.now = realNow;
  }

  // ---------------------------------------------------------------- T5 integration: delayed send completes after reclaim
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, 't5a');
    const t2 = openTab('t5b'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    const slow = dev.hold('POST', '/api/habit-logs', 'after'); // the server SAVES it; the response is delayed
    const p1 = t1.sync.submitActivityLog(payload('delayed', 'crid-t5'), 't', dev.fetch as any);
    await slow.arrived;
    const t0 = realNow();
    Date.now = () => t0 + 61_000;
    const rp = await t2.sync.replayOfflineQueue(dev.fetch as any); // reclaims and resends the same clientRequestId
    Date.now = realNow;
    slow.release();
    const r1 = await p1;
    const dump = await queueDump();
    check('T5 the replay reclaimed and resent the request (same clientRequestId); the server stored it exactly once', rp.attempted === 1 && logsOf(A).filter((l) => l.clientRequestId === 'crid-t5').length === 1);
    check('T5 the delayed first attempt completes consistently: confirmed, no record, claim or dispatch mark left behind', r1.kind === 'confirmed' && dump.records.length === 0 && dump.claims.length === 0 && dump.dispatches.length === 0);
  }

  // ---------------------------------------------------------------- T6 unavailable vs empty
  {
    await fresh();
    const dev = new Device();
    const t = await tabAs(dev, 't6');
    const empty = await t.q.readOfflineHabitQueue(A);
    idbFault.read = true;
    const unknown = await t.q.readOfflineHabitQueue(A);
    idbFault.read = false;
    check('T6 the presentation read returns [] for an empty queue but null for an UNREADABLE one (never presented as "no pending activity")', Array.isArray(empty) && empty.length === 0 && unknown === null);
    const page = require('fs').readFileSync(require('path').join(__dirname, '..', 'apps', 'web', 'app', 'page.tsx'), 'utf8');
    check('T6 Home shows an "unavailable" state and keeps pending rows when the queue cannot be read', /data-queue-state="unavailable"/.test(page) && /setQueueUnavailable\(queued === null\)/.test(page) && /queued === null\s*\?\s*new Set\(prev\.filter\(\(e\) => e\.syncStatus === 'pending'/.test(page));
  }

  // ---------------------------------------------------------------- T7 version-1 upgrade
  {
    await fresh();
    const t0 = openTab('t7');
    await t0.q.__resetQueueDbForTests();
    const fidb = require('fake-indexeddb');
    await new Promise<void>((res) => { const d = fidb.indexedDB.deleteDatabase('aura-offline'); d.onsuccess = () => res(); d.onerror = () => res(); d.onblocked = () => res(); });
    // Build a version-1 database exactly as R4 created it, with one dispatched record.
    await new Promise<void>((res, rej) => {
      const o = fidb.indexedDB.open('aura-offline', 1);
      o.onupgradeneeded = () => {
        const db = o.result;
        const r = db.createObjectStore('records', { keyPath: 'recordId' }); r.createIndex('owner', 'ownerUserId'); r.createIndex('ownerCrid', ['ownerUserId', 'clientRequestId']);
        db.createObjectStore('claims', { keyPath: 'recordId' });
        db.createObjectStore('dispatches', { keyPath: 'recordId' });
        db.createObjectStore('tombstones', { keyPath: 'recordId' }).createIndex('owner', 'ownerUserId');
        r.put({ recordId: 'rv1', ownerUserId: A, clientRequestId: 'crid-t7', queuedAt: 1, item: { ...owned('v1 record', 'crid-t7'), recordId: 'rv1' } });
        o.transaction!.objectStore('dispatches').put({ recordId: 'rv1', attempts: 1, lastAt: 1 });
      };
      o.onsuccess = () => { o.result.close(); res(); };
      o.onerror = () => rej(o.error);
    });
    const t = openTab('t7b');
    const r = await t.q.readOwnedQueue(A);
    check('T7 a version-1 database upgrades: the record is kept and its dispatch mark is carried over to the request (still reported "may have been sent")', r.ok && r.records.length === 1 && r.records[0].dispatched === true && r.records[0].inFlight === false);
  }

  void queuedCrids;
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
