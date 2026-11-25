/**
 * AURA-ANDROID-REL-04 (R3) -- queue durability and auth-transition findings
 * from the final independent disposition of 091e3ce, against the real client
 * modules (one instance per tab) and the real middleware + routes.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R3QueueAuth.test.ts
 *
 * Deterministic in-process simulation (rel04AccountIsolationHarness); the
 * real-browser counterparts are in test/rel04Chromium.test.ts.
 */
import { Device, addUser, check, closeAllTabs, finish, locks, logsOf, openTab, payload, queueKeys, queuedCrids, resetStore, routes, storage, store } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');
const habitRoute = routes['POST /api/habit-logs'];

function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  locks.enabled = true; closeAllTabs(); routes['POST /api/habit-logs'] = habitRoute;
}
async function tabAs(dev: Device, user: string | null, id = 'tab1') {
  if (user) dev.signIn(user); else dev.cookie = null;
  const t = openTab(id);
  t.acct.subscribeAccount(() => {});
  await t.acct.fetchVerifiedSession(dev.fetch as any);
  return t;
}
const rec = (owner: string, crid: string, rid: string, title = 't') => [`aura_q4:${owner}:${crid}:${rid}`, JSON.stringify({ ...payload(title, crid), ownerUserId: owner, tempId: 'x', recordId: rid, queuedAt: 1 })] as const;

async function main() {
  // ---------------------------------------------------------------- Q1 ambiguous HTTP failure (502)
  {
    fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    routes['POST /api/habit-logs'] = async () => Response.json({ error: 'bad gateway' }, { status: 502 });
    const r = await tab.sync.submitActivityLog(payload('A 502', 'crid-502'), 't', dev.fetch as any);
    check('Q1 a direct 502 is ambiguous: the outbox entry is KEPT (queued), not deleted', r.kind === 'queued' && queuedCrids(A).includes('crid-502'));
    routes['POST /api/habit-logs'] = habitRoute;
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q1 later replay with the same clientRequestId stores it exactly once', logsOf(A).filter((l) => l.clientRequestId === 'crid-502').length === 1 && queueKeys(A).length === 0);
  }

  // ---------------------------------------------------------------- Q2 unreadable storage vs empty
  {
    fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    const [k, v] = rec(A, 'crid-u1', 'r1');
    storage.data.set(k, v);
    const realGet = storage.getItem.bind(storage);
    (storage as any).getItem = (key: string) => { if (key.startsWith('aura_q4:')) throw new Error('read denied'); return realGet(key); };
    const read = tab.q.readOwnedQueue(A);
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    let asked = '';
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    (storage as any).getItem = realGet;
    check('Q2 a per-record read exception is UNREADABLE, never an empty queue', read.ok === false);
    check('Q2 replay of an unreadable queue sends nothing', r.stoppedBecause === 'unreadable' && dev.count('POST', '/api/habit-logs') === 0);
    check('Q2 sign-out asks (cannot check) and, after acknowledgement, reports the discard as UNKNOWN (not a clean zero)', /couldn't check/i.test(asked) && out.outcome === 'signed-out' && out.discardUnknown === true);
    check('Q2 nothing was removed (it stays for A)', storage.data.get(k) === v);
  }

  // ---------------------------------------------------------------- Q3 identity conflicts
  {
    fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    const first = tab.q.enqueueOwned({ ...payload('original', 'crid-c'), tempId: 't', ownerUserId: A });
    const second = tab.q.enqueueOwned({ ...payload('DIFFERENT payload', 'crid-c'), tempId: 't', ownerUserId: A });
    const same = tab.q.enqueueOwned({ ...payload('original', 'crid-c'), tempId: 't2', ownerUserId: A });
    check('Q3 a different payload can never take an existing request identity (refused: conflict)', first.status === 'stored' && second.status === 'conflict' && queueKeys(A).length === 1);
    check('Q3 the identical payload reuses the existing record (no second record)', same.status === 'stored' && (same as any).key === (first as any).key);
    const [k2, v2] = rec(A, 'crid-c', 'rX', 'written by another build');
    storage.data.set(k2, v2);
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q3 conflicting records under one identity are QUARANTINED: reported, never sent, never removed', r.conflicts === 1 && r.attempted === 0 && queueKeys(A).length === 2 && tab.q.readOfflineHabitQueue(A).length === 0);
  }

  // ---------------------------------------------------------------- Q4 settlement never removes a different/newer record
  {
    fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    await (async () => { dev.fault('POST', '/api/habit-logs', 'network-before'); await tab.sync.submitActivityLog(payload('same', 'crid-s'), 't', dev.fetch as any); })();
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = tab.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    const [kNew, vNew] = rec(A, 'crid-n', 'rnew', 'newer, different identity');
    storage.data.set(kNew, vNew);
    gate.release();
    await replay;
    check('Q4 settlement removed only the snapshotted record; a record written meanwhile is untouched', !queuedCrids(A).includes('crid-s') && storage.data.get(kNew) === vNew);
  }

  // ---------------------------------------------------------------- Q5 stale replay snapshot vs discard
  {
    fresh();
    const dev = new Device();
    const tab1 = await tabAs(dev, A, 'tab1');
    for (const n of [1, 2]) { dev.fault('POST', '/api/habit-logs', 'network-before'); await tab1.sync.submitActivityLog(payload(`A ${n}`, `crid-d${n}`), 't', dev.fetch as any); }
    const snapshotBefore = tab1.q.readOwnedQueue(A);
    const second = snapshotBefore.ok ? snapshotBefore.records.find((r) => r.item.clientRequestId === 'crid-d2')! : null;
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = tab1.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    // Another context discards record 2 (its confirmed snapshot) while tab1's replay holds an older snapshot.
    const removed = tab1.q.removeRecords([second!]);
    gate.release();
    await replay;
    check('Q5 a record discarded after replay took its snapshot is never sent', removed.removed === 1 && dev.calls.filter((c) => c.key === 'POST /api/habit-logs' && c.processed).length === 1 && logsOf(A).every((l) => l.clientRequestId !== 'crid-d2'));
  }

  // ---------------------------------------------------------------- Q6/Q7 migration: interruption-safe, idempotent, no resurrection
  {
    fresh();
    const v2Key = 'offline_habit_queue_v2:' + A;
    storage.data.set(v2Key, JSON.stringify([{ ...payload('v2 one', 'crid-v1'), ownerUserId: A, tempId: 't' }, { ...payload('v2 two', 'crid-v2'), ownerUserId: A, tempId: 't' }]));
    const dev = new Device();
    dev.signIn(A);
    const tab = openTab('tab1');
    let writes = 0;
    const realSet = storage.setItem.bind(storage);
    (storage as any).setItem = (k: string, v: string) => { if (k.startsWith('aura_q4:') && ++writes === 2) throw new Error('interrupted'); return realSet(k, v); };
    const r1 = tab.q.readOwnedQueue(A);
    (storage as any).setItem = realSet;
    check('Q6 an interrupted migration reports unreadable, keeps the source, and has copied only what it wrote', r1.ok === false && storage.data.has(v2Key) && queueKeys(A).length === 1);
    const r2 = tab.q.readOwnedQueue(A);
    check('Q6 re-running completes it idempotently: 2 records, no duplicates, source removed', r2.ok && r2.records.length === 2 && queueKeys(A).length === 2 && !storage.data.has(v2Key));
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q7 migrated records settle once', logsOf(A).length === 2 && queueKeys(A).length === 0);
    // A concurrent context that read the OLD source now (re)writes it and migrates again.
    storage.data.set(v2Key, JSON.stringify([{ ...payload('v2 one', 'crid-v1'), ownerUserId: A, tempId: 't' }, { ...payload('v2 two', 'crid-v2'), ownerUserId: A, tempId: 't' }]));
    storage.data.set(`aura_q3:${A}:crid-v1`, JSON.stringify({ ...payload('v2 one', 'crid-v1'), ownerUserId: A, tempId: 't' }));
    const r3 = tab.q.readOwnedQueue(A);
    check('Q7 a concurrent/repeated migration can NOT recreate settled records (tombstones)', r3.ok && r3.records.length === 0 && !storage.data.has(v2Key));
  }

  // ---------------------------------------------------------------- Q8 legacy quarantine: exact-snapshot discard only
  {
    fresh();
    const L = 'offline_habit_queue';
    storage.data.set(L, JSON.stringify([{ ...payload('legacy private 1', 'crid-l1') }, { ...payload('legacy private 2', 'crid-l2') }]));
    const dev = new Device();
    const tab = await tabAs(dev, A);
    check('Q8 there is no API to assign unowned legacy entries to an account', !('adoptLegacyQueue' in tab.q));
    const snap = tab.q.readLegacySnapshot();
    // An old tab appends after the user confirmed.
    storage.data.set(L, JSON.stringify([...JSON.parse(storage.data.get(L)!), { ...payload('added later', 'crid-l3') }]));
    const r = snap.ok ? tab.q.discardLegacySnapshot(snap) : null;
    const left = JSON.parse(storage.data.get(L) ?? '[]');
    check('Q8 discard removes exactly the confirmed entries; one added afterwards is kept and reported', !!r && r.removed === 2 && r.keptAddedLater === 1 && left.length === 1 && left[0].clientRequestId === 'crid-l3');
    storage.fail.set = true; storage.fail.remove = true;
    const snap2 = tab.q.readLegacySnapshot();
    const r2 = snap2.ok ? tab.q.discardLegacySnapshot(snap2) : null;
    storage.fail.set = false; storage.fail.remove = false;
    check('Q8 a cleanup failure is reported (failed), never claimed', !!r2 && r2.failed === true && storage.data.has(L));
    const rp = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q8 legacy entries are never replayed for the signed-in account', rp.attempted === 0 && store.logs.length === 0);
  }

  // ---------------------------------------------------------------- Q9 upgrade-required from automatic replay
  {
    fresh();
    const dev = new Device();
    const tab = await tabAs(dev, A);
    dev.fault('POST', '/api/habit-logs', 'network-before');
    await tab.sync.submitActivityLog(payload('pending', 'crid-up'), 't', dev.fetch as any);
    routes['POST /api/habit-logs'] = async () => Response.json({ code: 'client_upgrade_required', error: 'x' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('Q9 an upgrade refusal during AUTOMATIC replay is surfaced (reload prompt raised) and the entry is kept', r.stoppedBecause === 'upgrade-required' && tab.acct.isUpgradeRequired() && queuedCrids(A).includes('crid-up'));
  }

  // ---------------------------------------------------------------- A1 sign-in HTTP error reconciliation
  {
    fresh();
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
    fresh();
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
    fresh();
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
