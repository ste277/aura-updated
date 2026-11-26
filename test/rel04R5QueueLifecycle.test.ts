/**
 * AURA-ANDROID-REL-04 (R5) -- IndexedDB queue follow-ups from the R4
 * independent disposition (architecture accepted), against the real client
 * modules (one instance and IndexedDB connection per tab) and the real
 * middleware + routes.
 *
 *  T1  (R8) a settle/discard decision is retained (no expiry); a stale interim source or a re-enqueue never recreates it
 *  T2  (R8) a quarantined interim source that changed since it was shown is preserved by the discard
 *  T3  one claim per account + clientRequestId (several records of one logical request)
 *  T4  release and settlement are fenced by the attempt token (late completion after reclaim)
 *  T5  integration: a delayed send completing after another attempt reclaimed and settled
 *  T6  unavailable queue state is distinct from an empty queue (presentation read)
 *  T7  version-1 database upgrade keeps records and carries dispatch marks over to the request key
 *  T8  an auth request the service worker did not send (auth_transition_unsettled) is reported as in progress / busy, never as done
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
  // ---------------------------------------------------------------- T1 (R8) decisions retained; never recreated
  {
    await fresh();
    const v2Key = 'offline_habit_queue_v2:' + A;
    const src = JSON.stringify([owned('v2', 'crid-t1')]);
    storage.data.set(`aura_q3:${A}:crid-broken`, '{unparseable'); // a source cleanup could never retire
    const dev = new Device();
    const t = await tabAs(dev, 't1');
    await t.q.enqueueOwned(owned('v2', 'crid-t1'));
    const r = await t.q.readOwnedQueue(A);
    await t.q.settleRecords(r.ok ? r.records.filter((x) => !x.paused).map((x) => x.recordId) : [], undefined, { owner: A });
    const t0 = realNow();
    Date.now = () => t0 + 45 * DAY; // far beyond the pre-R8 30-day tombstone lifetime
    const t2 = openTab('t1b');
    await t2.q.readOwnedQueue(A);
    const tombsKept = (await queueDump()).tombstones.length;
    storage.data.set(v2Key, src); // a stale interim copy of the settled entry re-appears
    const again = await t2.q.readOwnedQueue(A);
    const re = await t2.q.enqueueOwned(owned('v2', 'crid-t1'));
    check('T1 (R8) after 45 days the decision is RETAINED; a re-appearing interim copy stays quarantined (never active) and a re-enqueue of the request is refused as already settled', tombsKept === 1 && again.ok && again.items.length === 0 && again.records.length === 0 && re.status === 'settled' && (await queueDump()).records.length === 0);
    storage.data.delete(`aura_q3:${A}:crid-broken`);
    storage.data.delete(v2Key);
    const t3 = openTab('t1c');
    await t3.q.readOwnedQueue(A);
    check('T1 (R8) with no interim source left the decision is still kept (no expiry; positive retirement evidence does not exist)', (await queueDump()).tombstones.length === 1);
    Date.now = realNow;
  }

  // ---------------------------------------------------------------- T2 (R8) a changed quarantined source is preserved by the discard
  {
    await fresh();
    const key = `aura_q3:${A}:crid-t2`;
    const first = JSON.stringify(owned('first payload', 'crid-t2'));
    const changed = JSON.stringify(owned('changed payload', 'crid-t2b'));
    storage.data.set(key, first);
    const dev = new Device();
    const t = await tabAs(dev, 't2');
    const shown = await t.q.readOwnedQueue(A);
    storage.data.set(key, changed); // another writer changes it after it was shown for the confirmation
    const d = t.q.discardQuarantined(A, shown.ok ? shown.quarantined : []);
    check('T2 (R8) a quarantined source that changed after it was shown is NOT removed (uncertain: preserved) and reported as kept', d.removed === 0 && d.failed === 1 && storage.data.get(key) === changed);
    const r = await t.q.readOwnedQueue(A);
    check('T2 (R8) it stays quarantined: counted as paused, never in the active queue', r.ok && r.records.length === 0 && r.items.length === 0 && r.paused === 1);
  }

  // ---------------------------------------------------------------- T3 one claim per logical request
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, 't3a');
    const t2 = openTab('t3b'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    // Two ACTIVE records of ONE logical request (same account + clientRequestId + payload), written
    // directly (R8 enqueue reuses the existing record, so it never produces this state itself).
    {
      const db = await t1.q.__openQueueDbForTests();
      const w = db.transaction(['records'], 'readwrite');
      for (const [recordId, queuedAt] of [['r3rec', 1], ['m-r6-scoped', 2]] as const) w.objectStore('records').put({ recordId, ownerUserId: A, clientRequestId: 'crid-t3', item: { ...owned('same', 'crid-t3'), recordId }, queuedAt, fmt: 'r8' });
      await new Promise<void>((res, rej) => { w.oncomplete = () => res(); w.onerror = () => rej(w.error); });
    }
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

  // ---------------------------------------------------------------- T8 worker 'unsettled' answers are reported honestly
  {
    await fresh();
    const dev = new Device();
    const t = await tabAs(dev, 't8');
    const unsettled = async () => Response.json({ error: 'Signing in or out is still in progress. Try again in a moment.', code: 'auth_transition_unsettled' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const realLogout = routes['POST /api/auth/logout'];
    routes['POST /api/auth/logout'] = unsettled;
    const out = await t.so.performSignOut({ fetch: dev.fetch as any, confirm: () => true });
    routes['POST /api/auth/logout'] = realLogout;
    check('T8 a sign-out the worker did not send (unsettled) ends BUSY after reconciling the session (still A), never "signed out" or "failed"', out.outcome === 'busy' && t.acct.getVerifiedAccount() === A && dev.cookie !== null && /Try again/.test(t.so.signOutOutcomeMessage(out) ?? ''));
    const realVerify = routes['POST /api/auth/verify-code'];
    routes['POST /api/auth/verify-code'] = unsettled;
    const si = await t.si.verifySignInCode({ email: 'alicesynth@example.invalid', code: '123456' }, dev.fetch as any);
    if (realVerify) routes['POST /api/auth/verify-code'] = realVerify; else delete routes['POST /api/auth/verify-code'];
    check('T8 a sign-in the worker did not send is reported "still in progress ... nothing was changed", not "couldn\'t reach the server", and the account is unchanged', si.kind !== 'VERIFIED' && /still in progress/.test((si as any).message ?? '') && t.acct.getVerifiedAccount() === A);
  }

  void queuedCrids;
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
