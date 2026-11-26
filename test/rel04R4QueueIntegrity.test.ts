/**
 * AURA-ANDROID-REL-04 IR-01 / IR-03 (R4) -- offline queue consistency on
 * IndexedDB (assessment of b323d2a, queue and legacy findings), against the
 * real client modules (one instance per tab, each with its OWN IndexedDB
 * connection to the same spec-conformant in-memory database) and the real
 * middleware + routes.
 *
 *   M   migration vs settlement / discard in other contexts (no resurrection),
 *       existing data preserved, interrupted migration
 *   H   replay <-> discard handoff through atomic claims (both orders)
 *   D   already-dispatched work: a discard never claims to undo an accepted send
 *   C   concurrent contexts WITHOUT Web Locks: one send per identity at a time
 *   I   interrupted sender: its claim expires, the entry is sent again (same id)
 *   F   storage failures: no fallback store, honest results
 *   L   legacy shared array: never rewritten/removed; reported separately
 *   S   sign-out messaging: owned and legacy outcomes separate, every outcome stated
 *
 * Deterministic in-process simulation (fake-indexeddb implements the
 * transaction scheduling of the IndexedDB spec); real-browser counterparts
 * (real Chromium IndexedDB, two pages) are in test/rel04Chromium.test.ts.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R4QueueIntegrity.test.ts
 */
import { Device, addUser, check, clearQueueDb, closeAllTabs, finish, idbFault, locks, logsOf, openTab, payload, queueDump, queuedCrids, resetStore, routes, storage } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');
const habitRoute = routes['POST /api/habit-logs'];
const realNow = Date.now;

async function fresh() {
  resetStore(); storage.clear(); storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  locks.enabled = true; closeAllTabs(); routes['POST /api/habit-logs'] = habitRoute;
  Date.now = realNow;
  await clearQueueDb();
}
async function tabAs(dev: Device, user: string | null, id: string) {
  if (user) dev.signIn(user); else dev.cookie = null;
  const t = openTab(id);
  t.acct.subscribeAccount(() => {});
  await t.acct.fetchVerifiedSession(dev.fetch as any);
  return t;
}
const sends = (dev: Device, crid?: string) => dev.calls.filter((c) => c.key === 'POST /api/habit-logs' && (!crid || (c as any).body?.includes?.(crid)));
const lsQueueKeys = () => [...storage.data.keys()].filter((k) => /^(aura_q|offline_habit_queue_v2)/.test(k));
const ownedEntry = (title: string, crid: string) => ({ ...payload(title, crid), ownerUserId: A, tempId: 't' });

async function main() {
  // ---------------------------------------------------------------- M1 existing interim data is preserved
  {
    await fresh();
    storage.data.set('offline_habit_queue_v2:' + A, JSON.stringify([ownedEntry('v2 entry', 'crid-m-v2')]));
    storage.data.set(`aura_q3:${A}:crid-m-q3`, JSON.stringify(ownedEntry('q3 entry', 'crid-m-q3')));
    storage.data.set(`aura_q4:${A}:crid-m-q4:r4x`, JSON.stringify({ ...ownedEntry('q4 entry', 'crid-m-q4'), recordId: 'r4x', queuedAt: 5 }));
    storage.data.set(`aura_q4:${A}:crid-bad:rbad`, '{not json');
    storage.data.set('offline_habit_queue_v2:' + B, JSON.stringify([{ ...payload('bob v2', 'crid-b'), ownerUserId: B, tempId: 't' }]));
    const dev = new Device();
    const tab = await tabAs(dev, A, 'tab1');
    const r = await tab.q.readOwnedQueue(A);
    const crids = r.ok ? r.records.map((x) => x.item.clientRequestId).sort() : [];
    check('M1 every valid owned interim entry (R1 array, R2 per-entry, R3 record) is migrated with its payload intact', r.ok && JSON.stringify(crids) === JSON.stringify(['crid-m-q3', 'crid-m-q4', 'crid-m-v2']) && /* R7: an aura_q4 entry migrates to its ACCOUNT-SCOPED identity ('r4x' stays an alias of A's only) */ r.records.find((x) => x.item.clientRequestId === 'crid-m-q4')!.recordId === tab.q.migratedRecordId(r.records.find((x) => x.item.clientRequestId === 'crid-m-q4')!.item, A) && r.records.find((x) => x.item.clientRequestId === 'crid-m-v2')!.item.activityTitle === 'v2 entry');
    check('M1 sources are removed only after the copy committed; an unparseable source is left in place (never guessed at); another account\'s source is untouched', !storage.data.has('offline_habit_queue_v2:' + A) && !storage.data.has(`aura_q3:${A}:crid-m-q3`) && !storage.data.has(`aura_q4:${A}:crid-m-q4:r4x`) && storage.data.get(`aura_q4:${A}:crid-bad:rbad`) === '{not json' && storage.data.has('offline_habit_queue_v2:' + B));
  }

  // ---------------------------------------------------------------- M2 migration racing settlement and discard in OTHER contexts
  {
    let resurrected = 0, lost = 0;
    for (let round = 0; round < 25; round++) {
      await fresh();
      const src = JSON.stringify([ownedEntry('race 1', 'crid-r1'), ownedEntry('race 2', 'crid-r2')]);
      storage.data.set('offline_habit_queue_v2:' + A, src);
      const dev = new Device();
      const t1 = await tabAs(dev, A, 't1');
      const t2 = openTab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
      const t3 = openTab('t3'); await t3.acct.fetchVerifiedSession(dev.fetch as any);
      const first = await t1.q.readOwnedQueue(A); // migrated once
      const ids = first.ok ? first.records.map((x) => x.recordId) : [];
      // A stale context re-writes the old source while t2 settles record 1 and t3 discards record 2, interleaved.
      storage.data.set('offline_habit_queue_v2:' + A, src);
      const ops: Array<() => Promise<unknown>> = [
        () => t1.q.readOwnedQueue(A),
        () => t2.q.settleRecords([ids[0]]),
        () => t3.q.discardRecords([ids[1]], { tab: 't3' }),
        () => t1.q.readOwnedQueue(A),
      ];
      const order = ops.map((_, i) => i).sort(() => ((round * 7919 + 13) % 5) - 2);
      await Promise.all(order.map((i) => ops[i]()));
      const left = await queuedCrids(A);
      resurrected += left.length;
      if (!first.ok || ids.length !== 2) lost++;
    }
    check('M2 25 interleavings of migration (stale source re-written) with settlement and discard in two other contexts: a settled/discarded entry is NEVER recreated', resurrected === 0 && lost === 0);
  }

  // ---------------------------------------------------------------- H1 replay holds the claim -> a concurrent discard keeps it
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    const t2 = openTab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    dev.fault('POST', '/api/habit-logs', 'network-before');
    await t1.sync.submitActivityLog(payload('pending', 'crid-h1'), 't', dev.fetch as any);
    const snap = await t2.q.readOwnedQueue(A);
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = t1.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived; // t1 has claimed it and is sending
    const d = await t2.q.discardRecords(snap.ok ? snap.records.map((r) => r.recordId) : [], { tab: 't2' });
    check('H1 a discard while another context is SENDING the record keeps it (reported keptInFlight), never removes it from under the send', d.keptInFlight === 1 && d.removed === 0 && (await queuedCrids(A)).includes('crid-h1'));
    gate.release();
    await replay;
    check('H1 the send then decides it: confirmed and settled exactly once', logsOf(A).filter((l) => l.clientRequestId === 'crid-h1').length === 1 && (await queuedCrids(A)).length === 0);
  }

  // ---------------------------------------------------------------- H2 discard first -> the replay's claim finds it gone (never sent)
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    const t2 = openTab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    for (const n of [1, 2]) { dev.fault('POST', '/api/habit-logs', 'network-before'); await t1.sync.submitActivityLog(payload(`p${n}`, `crid-h2-${n}`), 't', dev.fetch as any); }
    // t1's replay has READ both (its snapshot), and is sending one of them (order among same-millisecond entries is not fixed).
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = t1.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    const snap = await t2.q.readOwnedQueue(A);
    const other = snap.ok ? snap.records.find((r) => !r.inFlight)! : null;
    const d = await t2.q.discardRecords(other ? [other.recordId] : [], { tab: 't2' });
    gate.release();
    const rr = await replay;
    check('H2 a record discarded after the replay read it is never sent (the claim transaction finds it gone)', !!other && d.removed === 1 && rr.attempted === 1 && logsOf(A).every((l) => l.clientRequestId !== other!.item.clientRequestId) && logsOf(A).length === 1);
  }

  // ---------------------------------------------------------------- D1 already-dispatched work
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    dev.fault('POST', '/api/habit-logs', 'network-after'); // the server SAVED it; the response was lost
    const r = await t1.sync.submitActivityLog(payload('saved but unanswered', 'crid-d1'), 't', dev.fetch as any);
    const dump = await queueDump();
    check('D1 an unanswered send stays queued, its claim released, its dispatch recorded', r.kind === 'queued' && dump.records.length === 1 && dump.claims.length === 0 && dump.dispatches.length === 1);
    let asked = '';
    const out = await t1.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    check('D1 (R5) the sign-out question says it may already have been sent and that removing it will not undo that', /may already have been sent/.test(asked) && /won't undo/.test(asked));
    check('D1 the discard reports it as removed-but-possibly-saved (never as undone)', out.outcome === 'signed-out' && out.owned?.removed === 1 && out.owned?.removedPossiblySent === 1 && logsOf(A).length === 1);
    const msg = t1.so.discardOutcomeMessage(out) ?? '';
    check('D1 (R5) the message states the removed count, that it may already have been sent and saved, and that removing it here does not undo that', /1 unsynced activity log was removed/.test(msg) && /may already have been sent, so it may be saved to your account/.test(msg) && /doesn't undo that/.test(msg));
  }

  // ---------------------------------------------------------------- C1 concurrent contexts WITHOUT Web Locks: one in-flight send per identity
  {
    await fresh();
    locks.enabled = false;
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    const t2 = openTab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    const t3 = openTab('t3'); await t3.acct.fetchVerifiedSession(dev.fetch as any);
    for (const n of [1, 2, 3]) { dev.fault('POST', '/api/habit-logs', 'network-before'); await t1.sync.submitActivityLog(payload(`c${n}`, `crid-c${n}`), 't', dev.fetch as any); }
    const before = dev.calls.length;
    const results = await Promise.all([t1, t2, t3].map((t) => t.sync.replayOfflineQueue(dev.fetch as any)));
    const sent = dev.calls.slice(before).filter((c) => c.key === 'POST /api/habit-logs');
    check('C1 three contexts replaying at once with no Web Locks: each entry is sent exactly once in total', sent.length === 3 && results.reduce((n, r) => n + r.attempted, 0) === 3);
    check('C1 every entry stored once and settled', ['crid-c1', 'crid-c2', 'crid-c3'].every((c) => logsOf(A).filter((l) => l.clientRequestId === c).length === 1) && (await queuedCrids(A)).length === 0);
  }

  // ---------------------------------------------------------------- C2 the same identity written in two contexts at once (no Web Locks)
  {
    await fresh();
    locks.enabled = false;
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    const t2 = openTab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const p1 = t1.sync.submitActivityLog(payload('same', 'crid-c2'), 't', dev.fetch as any);
    await gate.arrived;
    const r2 = await t2.sync.submitActivityLog(payload('same', 'crid-c2'), 't', dev.fetch as any);
    gate.release();
    const r1 = await p1;
    check('C2 while one context sends an identity, a second context does not send it again (queued for the first send to decide)', r1.kind === 'confirmed' && r2.kind === 'queued' && dev.count('POST', '/api/habit-logs') === 1 && (await queuedCrids(A)).length === 0);
  }

  // ---------------------------------------------------------------- I1 interrupted sender: claim expiry
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    const t2 = openTab('t2'); await t2.acct.fetchVerifiedSession(dev.fetch as any);
    await t1.q.enqueueOwned({ ...payload('orphaned', 'crid-i1'), tempId: 't', ownerUserId: A }, { claimFor: 't1' }); // t1 claimed it, then its page died
    const early = await t2.sync.replayOfflineQueue(dev.fetch as any);
    check('I1 a fresh claim from a context that died blocks re-sending (no concurrent duplicate)', early.attempted === 0 && dev.count('POST', '/api/habit-logs') === 0);
    const t0 = realNow();
    Date.now = () => t0 + 61_000;
    const late = await t2.sync.replayOfflineQueue(dev.fetch as any);
    Date.now = realNow;
    check('I1 after the claim expires, the entry is sent again with the same clientRequestId and settled once', late.attempted === 1 && logsOf(A).filter((l) => l.clientRequestId === 'crid-i1').length === 1 && (await queuedCrids(A)).length === 0);
  }

  // ---------------------------------------------------------------- F1 IndexedDB unavailable: no fallback, honest results
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    await t1.q.__resetQueueDbForTests();
    idbFault.open = true;
    dev.fault('POST', '/api/habit-logs', 'network-before');
    const r = await t1.sync.submitActivityLog(payload('no storage', 'crid-f1'), 't', dev.fetch as any);
    const read = await t1.q.readOwnedQueue(A);
    const rp = await t1.sync.replayOfflineQueue(dev.fetch as any);
    idbFault.open = false;
    check('F1 with IndexedDB unavailable an unresolved write is reported NOT STORED (never "queued")', r.kind === 'not-stored');
    check('F1 nothing silently falls back to localStorage or memory', lsQueueKeys().length === 0 && (await queuedCrids(A)).length === 0);
    check('F1 reads are UNREADABLE (not empty) and replay sends nothing', read.ok === false && rp.stoppedBecause === 'unreadable');
  }

  // ---------------------------------------------------------------- F2 write failure while settling: reported, entry kept
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    dev.fault('POST', '/api/habit-logs', 'network-before');
    await t1.sync.submitActivityLog(payload('kept', 'crid-f2'), 't', dev.fetch as any);
    const snap = await t1.q.readOwnedQueue(A);
    idbFault.write = true;
    const d = await t1.q.discardRecords(snap.ok ? snap.records.map((x) => x.recordId) : [], { tab: 't1' });
    idbFault.write = false;
    check('F2 a discard that cannot write reports every entry as failed (nothing claimed removed) and the entry is still there', d.failed === 1 && d.removed === 0 && (await queuedCrids(A)).includes('crid-f2'));
  }

  // ---------------------------------------------------------------- L1/S1 legacy kept; owned and legacy reported separately
  {
    await fresh();
    const L = 'offline_habit_queue';
    const legacy = JSON.stringify([payload('old 1', 'crid-l1'), payload('old 2', 'crid-l2')]);
    storage.data.set(L, legacy);
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    dev.fault('POST', '/api/habit-logs', 'network-before');
    await t1.sync.submitActivityLog(payload('owned', 'crid-s1'), 't', dev.fetch as any);
    idbFault.read = true; // owned queue unreadable
    let asked = '';
    const out = await t1.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    idbFault.read = false;
    const msg = t1.so.discardOutcomeMessage(out) ?? '';
    check('L1 the shared legacy array is byte-identical after sign-out (never rewritten, never removed)', storage.data.get(L) === legacy);
    check('S1 owned unreadable + legacy present: the owned part says none of the account\'s activity was removed, the legacy part says 2 earlier-version logs were left -- separately, no blanket "nothing removed"', out.owned?.unknown === true && out.legacyKept === 2 && /none of it was removed/.test(msg) && /2 activity logs from an earlier version/.test(msg) && !/nothing was removed/i.test(msg));
    check('S1 the confirmation is about owned entries only (legacy entries are not removed, so not asked about)', /couldn't read this device's unsynced activity/.test(asked) && !/earlier version|before an update/.test(asked));
  }

  // ---------------------------------------------------------------- S2 owned removed + legacy kept
  {
    await fresh();
    storage.data.set('offline_habit_queue', JSON.stringify([payload('old', 'crid-l')]));
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    await t1.q.enqueueOwned({ ...payload('owned never sent', 'crid-s2'), tempId: 't', ownerUserId: A });
    const out = await t1.so.performSignOut({ fetch: dev.fetch as any, confirm: () => true });
    const msg = t1.so.discardOutcomeMessage(out) ?? '';
    check('S2 an owned entry never sent is removed (not "possibly saved"); the legacy entry is reported as left on the device', out.owned?.removed === 1 && out.owned?.removedPossiblySent === 0 && out.legacyKept === 1 && /1 activity log from an earlier version/.test(msg) && (await queuedCrids(A)).length === 0);
  }

  // ---------------------------------------------------------------- S3 every outcome states whether sign-out completed
  {
    await fresh();
    const dev = new Device();
    const t1 = await tabAs(dev, A, 't1');
    const m = t1.so.signOutOutcomeMessage;
    check('S3 signed-out-unconfirmed says signed out on this device, server confirmation missing, activity kept', /signed out on this device/.test(m({ outcome: 'signed-out-unconfirmed' }) ?? '') && /kept/.test(m({ outcome: 'signed-out-unconfirmed' }) ?? ''));
    check('S3 account-changed says another account is now signed in (not "signed out")', /different account is now signed in/.test(m({ outcome: 'account-changed' }) ?? '') && !/You're signed out/.test(m({ outcome: 'account-changed' }) ?? ''));
    check('S3 failed / busy / unverified each say sign-out did not complete or is unconfirmed', /Couldn't sign out/.test(m({ outcome: 'failed' }) ?? '') && /Try again/.test(m({ outcome: 'busy' }) ?? '') && /couldn't confirm whether you're signed out/.test(m({ outcome: 'unverified' }) ?? ''));
    check('S3 cancelled says nothing (nothing happened)', m({ outcome: 'cancelled' }) === null);
  }

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
