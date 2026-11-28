/**
 * AURA-ANDROID-REL-04 (R3) -- queue durability and auth-transition findings
 * from the final independent disposition of 091e3ce, against the real client
 * modules (one instance per tab) and the real middleware + routes.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R3QueueAuth.test.ts
 *
 * Deterministic in-process simulation (rel04AccountIsolationHarness); the
 * real-browser counterparts are in test/rel04Chromium.test.ts.
 *
 * R4: the queue is IndexedDB (fake-indexeddb in this harness). Q2/Q3/Q6/Q7
 * are the same findings re-expressed for that store; Q8 now asserts the R4
 * legacy rule (never rewritten or removed). New R4 guarantees are in
 * test/rel04R4QueueIntegrity.test.ts.
 */
import { Device, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, locks, logsOf, openTab, payload, queueDump, queueKeys, queuedCrids, resetStore, routes, storage, store } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');
const habitRoute = routes['POST /api/habit-logs'];

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  locks.enabled = true; closeAllTabs(); routes['POST /api/habit-logs'] = habitRoute;
  await clearQueueDb();
}
async function tabAs(dev: Device, user: string | null, id = 'tab1') {
  if (user) dev.signIn(user); else dev.cookie = null;
  const t = openTab(id);
  t.acct.subscribeAccount(() => {});
  await t.acct.fetchVerifiedSession(dev.fetch as any);
  return t;
}
/** Writes a record straight into the store, as another build/context would. */
async function putRecord(owner: string, crid: string, rid: string, title = 't') {
  const db: IDBDatabase = await require('../apps/web/lib/offlineHabitQueue').__openQueueDbForTests();
  const t = db.transaction(['records'], 'readwrite');
  t.objectStore('records').put({ recordId: rid, ownerUserId: owner, clientRequestId: crid, queuedAt: 1, item: { ...payload(title, crid), ownerUserId: owner, tempId: 'x', recordId: rid } });
  await new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

async function main() {
  // ---------------------------------------------------------------- Q1 ambiguous HTTP failure (502)
  {
    await fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    routes['POST /api/habit-logs'] = async () => Response.json({ error: 'bad gateway' }, { status: 502 });
    const r = await tab.sync.submitActivityLog(payload('A 502', 'crid-502'), 't', dev.fetch as any);
    check('Q1 a direct 502 is ambiguous: the outbox entry is KEPT (queued), not deleted', r.kind === 'queued' && (await queuedCrids(A)).includes('crid-502'));
    routes['POST /api/habit-logs'] = habitRoute;
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q1 later replay with the same clientRequestId stores it exactly once', logsOf(A).filter((l) => l.clientRequestId === 'crid-502').length === 1 && (await queueKeys(A)).length === 0);
  }

  // ---------------------------------------------------------------- Q2 unreadable storage vs empty
  {
    await fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    await putRecord(A, 'crid-u1', 'r1');
    idbFault.read = true;
    const read = await tab.q.readOwnedQueue(A);
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    let asked = '';
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    idbFault.read = false;
    check('Q2 a read failure is UNREADABLE, never an empty queue', read.ok === false);
    check('Q2 replay of an unreadable queue sends nothing', r.stoppedBecause === 'unreadable' && dev.count('POST', '/api/habit-logs') === 0);
    check('Q2 sign-out asks (cannot check) and, after acknowledgement, reports the owned discard as UNKNOWN (not a clean zero)', /couldn't read this device's unsynced activity/i.test(asked) && out.outcome === 'signed-out' && out.owned?.unknown === true);
    check('Q2 nothing was removed (it stays for A)', (await queueKeys(A)).includes('r1'));
  }

  // ---------------------------------------------------------------- Q3 identity conflicts
  {
    await fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    const first = await tab.q.enqueueOwned({ ...payload('original', 'crid-c'), tempId: 't', ownerUserId: A });
    const second = await tab.q.enqueueOwned({ ...payload('DIFFERENT payload', 'crid-c'), tempId: 't', ownerUserId: A });
    const same = await tab.q.enqueueOwned({ ...payload('original', 'crid-c'), tempId: 't2', ownerUserId: A });
    check('Q3 a different payload can never take an existing request identity (refused: conflict)', first.status === 'stored' && second.status === 'conflict' && (await queueKeys(A)).length === 1);
    check('Q3 the identical payload reuses the existing record (no second record)', same.status === 'stored' && (same as any).recordId === (first as any).recordId);
    await putRecord(A, 'crid-c', 'rX', 'written by another build');
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    // R8: a record written by another (pre-R8) build is quarantined, and it pauses its whole logical request.
    check('Q3 conflicting records under one identity are QUARANTINED: reported, never sent, never removed', r.paused === 1 && r.attempted === 0 && (await queueKeys(A)).length === 2 && (await tab.q.readOfflineHabitQueue(A))?.length === 0);
  }

  // ---------------------------------------------------------------- Q4 settlement never removes a different/newer record
  {
    await fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    await (async () => { dev.fault('POST', '/api/habit-logs', 'network-before'); await tab.sync.submitActivityLog(payload('same', 'crid-s'), 't', dev.fetch as any); })();
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = tab.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    await putRecord(A, 'crid-n', 'rnew', 'newer, different identity');
    gate.release();
    await replay;
    const left = await queuedCrids(A);
    check('Q4 settlement removed only the snapshotted record; a record written meanwhile is untouched', !left.includes('crid-s') && left.includes('crid-n'));
  }

  // ---------------------------------------------------------------- Q5 stale replay snapshot vs discard
  {
    await fresh();
    const dev = new Device();
    const tab1 = await tabAs(dev, A, 'tab1');
    for (const n of [1, 2]) { dev.fault('POST', '/api/habit-logs', 'network-before'); await tab1.sync.submitActivityLog(payload(`A ${n}`, `crid-d${n}`), 't', dev.fetch as any); }
    const snapshotBefore = await tab1.q.readOwnedQueue(A);
    const second = snapshotBefore.ok ? snapshotBefore.records.find((r) => r.item.clientRequestId === 'crid-d2')! : null;
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = tab1.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    // Another context discards record 2 (its confirmed snapshot) while tab1's replay holds an older snapshot.
    const removed = await tab1.q.discardRecords([second!.recordId], { tab: 'other-context' });
    gate.release();
    await replay;
    check('Q5 a record discarded after replay took its snapshot is never sent', removed.removed === 1 && dev.calls.filter((c) => c.key === 'POST /api/habit-logs' && c.processed).length === 1 && logsOf(A).every((l) => l.clientRequestId !== 'crid-d2'));
  }

  // ---------------------------------------------------------------- Q6/Q7 (R8: migration retired) a retired-format source is
  // quarantined in place: never copied, never sent, never removed without the account's discard; repeated reads change nothing.
  {
    await fresh();
    const v2Key = 'offline_habit_queue_v2:' + A;
    const v2Value = JSON.stringify([{ ...payload('v2 one', 'crid-v1'), ownerUserId: A, tempId: 't' }, { ...payload('v2 two', 'crid-v2'), ownerUserId: A, tempId: 't' }]);
    storage.data.set(v2Key, v2Value);
    const dev = new Device();
    dev.signIn(A);
    const tab = openTab('tab1');
    idbFault.write = true; // the migration transaction fails (e.g. quota)
    const r1 = await tab.q.readOwnedQueue(A);
    idbFault.write = false;
    check('Q6 (R8) a retired-format source is read without any write: kept in place, copied NOTHING, counted as 2 paused entries', r1.ok === true && r1.paused === 2 && r1.items.length === 0 && storage.data.get(v2Key) === v2Value && (await queueKeys(A)).length === 0);
    const r2 = await tab.q.readOwnedQueue(A);
    check('Q6 (R8) re-reading is idempotent: still no records, source unchanged', r2.ok && r2.records.length === 0 && r2.quarantined.length === 1 && (await queueKeys(A)).length === 0 && storage.data.get(v2Key) === v2Value);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    const rr = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q7 (R8) quarantined entries are never sent (no server row), and stay quarantined', rr.attempted === 0 && rr.paused === 2 && logsOf(A).length === 0 && storage.data.get(v2Key) === v2Value);
    // A concurrent context that read the OLD source now (re)writes it and migrates again.
    storage.data.set(v2Key, v2Value);
    storage.data.set(`aura_q3:${A}:crid-v1`, JSON.stringify({ ...payload('v2 one', 'crid-v1'), ownerUserId: A, tempId: 't' }));
    const r3 = await tab.q.readOwnedQueue(A);
    check('Q7 (R8) a re-written or additional retired-format source never enters the active queue (counted per logical request: 2)', r3.ok && r3.records.length === 0 && r3.items.length === 0 && r3.paused === 2 && logsOf(A).length === 0);
  }

  // ---------------------------------------------------------------- Q8 legacy quarantine (R4: never rewritten or removed)
  {
    await fresh();
    const L = 'offline_habit_queue';
    const legacy = JSON.stringify([{ ...payload('legacy private 1', 'crid-l1') }, { ...payload('legacy private 2', 'crid-l2') }]);
    storage.data.set(L, legacy);
    const dev = new Device();
    const tab = await tabAs(dev, A);
    check('Q8 there is no API to assign unowned legacy entries to an account, nor to rewrite/remove the shared array', !('adoptLegacyQueue' in tab.q) && !('discardLegacySnapshot' in tab.q));
    const snap = tab.q.readLegacySnapshot();
    check('Q8 the legacy entries are counted', snap.ok && snap.count === 2);
    const rp = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q8 legacy entries are never replayed for the signed-in account', rp.attempted === 0 && store.logs.length === 0);
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: () => true });
    check('Q8 sign-out leaves the shared legacy array byte-identical and reports it as kept', out.outcome === 'signed-out' && storage.data.get(L) === legacy && out.legacyKept === 2);
  }

  // ---------------------------------------------------------------- Q9 upgrade-required from automatic replay
  {
    await fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    dev.fault('POST', '/api/habit-logs', 'network-before');
    await tab.sync.submitActivityLog(payload('pending', 'crid-up'), 't', dev.fetch as any);
    routes['POST /api/habit-logs'] = async () => Response.json({ code: 'client_upgrade_required', error: 'x' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q9 an upgrade refusal during AUTOMATIC replay is surfaced (reload prompt raised) and the entry is kept', r.stoppedBecause === 'upgrade-required' && tab.acct.isUpgradeRequired() && (await queuedCrids(A)).includes('crid-up'));
  }

  // ---------------------------------------------------------------- A1 sign-in HTTP error reconciliation
  {
    await fresh();
    const dev = new Device();
    const tab = await tabAs(dev, null);
    dev.verifyAs['bobsynth@example.invalid'] = B;
    // 4xx that is NOT proof nothing changed: an intermediary answers 400 after the server signed B in.
    const realVerify = routes['POST /api/auth/verify-code'];
    routes['POST /api/auth/verify-code'] = async () => { dev.signIn(B); return Response.json({ error: 'proxy said no' }, { status: 400 }); };
    const r = await tab.si.verifySignInCode({ email: 'bobsynth@example.invalid', code: '123456' }, dev.fetch as any);
    check('A1 a sign-in 4xx is reconciled: the session actually changed to B, so the prior state is NOT restored', r.kind === 'FAILED' && tab.acct.getVerifiedAccount() === B && dev.count('GET', '/api/auth/session') >= 2);
    routes['POST /api/auth/verify-code'] = async () => Response.json({ error: 'That code is not valid.' }, { status: 401 });
    dev.cookie = null;
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    const r2 = await tab.si.verifySignInCode({ email: 'bobsynth@example.invalid', code: '000000' }, dev.fetch as any);
    check('A1 a 4xx with the session verified unchanged -> REJECTED, still signed out', r2.kind === 'REJECTED' && tab.acct.getVerifiedAccount() === null);
    if (realVerify) routes['POST /api/auth/verify-code'] = realVerify; else delete routes['POST /api/auth/verify-code'];
  }

  // ---------------------------------------------------------------- A2 cross-tab suspension through the HELD Web Lock (marker unwritable)
  {
    await fresh();
    const dev = new Device();
    const tab1 = await tabAs(dev, A, 'tab1');
    const tab2 = openTab('tab2');
    await tab2.acct.fetchVerifiedSession(dev.fetch as any);
    storage.fail.set = true; // the transition marker cannot be written
    const gate = dev.hold('POST', '/api/auth/logout', 'before');
    const out = tab1.so.performSignOut({ fetch: dev.fetch as any, confirm: () => true });
    await gate.arrived;
    storage.fail.set = false;
    check('A2 precondition: the marker could not be written', tab1.acct.getTransitionCoordination().markerWritten === false);
    let refused = '';
    try { await tab2.sync.submitActivityLog(payload('tab2 during sign-out', 'crid-a2'), 't', dev.fetch as any); } catch (e: any) { refused = e?.reason; }
    check('A2 with Web Locks, tab2 is suspended by the HELD auth lock even though no marker exists', refused === 'transition' && dev.count('POST', '/api/habit-logs') === 0);
    gate.release();
    await out;
  }

  // ---------------------------------------------------------------- A3 no Web Locks AND marker unwritable: coordination unavailable
  {
    await fresh();
    locks.enabled = false;
    const dev = new Device();
    const tab1 = await tabAs(dev, A, 'tab1');
    const tab2 = openTab('tab2');
    await tab2.acct.fetchVerifiedSession(dev.fetch as any);
    storage.fail.set = true;
    const out = await tab1.so.performSignOut({ fetch: dev.fetch as any, confirm: () => true });
    storage.fail.set = false;
    check('A3 the transition still completes in its own tab and records that coordination was unavailable', out.outcome === 'signed-out' && tab1.acct.getTransitionCoordination().markerWritten === false && tab1.acct.getTransitionCoordination().webLocks === false);
    dev.signIn(B); // someone else signs in; tab2 never heard anything
    const r = await tab2.sync.submitActivityLog(payload('stale tab2 write', 'crid-a3'), 't', dev.fetch as any);
    check('A3 the uncoordinated tab2 still cannot write into B: the server refuses (409) and nothing is stored for B', r.kind === 'account-changed' && logsOf(B).length === 0);
  }

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
