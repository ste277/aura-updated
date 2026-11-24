/**
 * AURA-ANDROID-REL-04 IR-01 / IR-03 -- integrated account-isolation and
 * sign-out transition scenarios (synthetic accounts A and B).
 *
 *   npx ts-node test/rel04AccountIsolation.test.ts
 *
 * Client side: the real lib/accountSession, activitySync, signOut and
 * offlineHabitQueue modules (one instance per tab). Server side: the real
 * route handlers (logout, session, habit-logs, plans) over an in-memory db
 * stub. Requests are held / failed under test control. See the harness.
 */
import { Device, addUser, check, finish, logsOf, openTab, closeAllTabs, payload, resetStore, routes, storage, store, tick } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');
const KEY_A = 'offline_habit_queue_v2:' + A;
const KEY_B = 'offline_habit_queue_v2:' + B;
const queueLen = (key: string) => { const raw = storage.data.get(key); return raw ? JSON.parse(raw).length : 0; };

function fresh() {
  resetStore();
  storage.clear();
  storage.fail = { get: false, set: false, remove: false };
  closeAllTabs();
}

async function signedInTab(dev: Device, user: string, id = 'tab1') {
  dev.signIn(user);
  const tab = openTab(id);
  tab.acct.subscribeAccount(() => {});
  const s = await tab.acct.fetchVerifiedSession(dev.fetch as any);
  if (s.status !== 'current') throw new Error('setup: session not verified');
  return tab;
}
async function queueOffline(tab: ReturnType<typeof openTab>, dev: Device, title: string, crid: string) {
  dev.fault('POST', '/api/habit-logs', 'network-before');
  const r = await tab.sync.submitActivityLog(payload(title, crid), `temp-${crid}`, dev.fetch as any);
  if (r.kind !== 'queued') throw new Error(`setup: expected queued, got ${r.kind}`);
}
const yes = () => true;

async function main() {
  // ------------------------------------------------------------------ server write boundary
  {
    fresh();
    const dev = new Device();
    dev.signIn(B);
    const before = store.dbCalls.length;
    const res = await dev.fetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aura-Expected-Account': A }, body: JSON.stringify(payload('A-expected', 'crid-x1')) });
    const body = await res.json();
    check('SB1 request with A expected + B session -> 409 account_mismatch', res.status === 409 && body.code === 'account_mismatch');
    check('SB1 nothing persisted and no db call made (rejected before any read/write)', store.logs.length === 0 && store.dbCalls.length === before);

    const noHeader = await dev.fetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload('no-header', 'crid-x2')) });
    check('SB2 activity write without the expected-account header -> 428, nothing persisted', noHeader.status === 428 && store.logs.length === 0);

    const ok = await dev.fetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aura-Expected-Account': B }, body: JSON.stringify(payload('B own', 'crid-x3')) });
    check('SB3 matching expected account -> 200 and persisted for B only', ok.status === 200 && logsOf(B).length === 1 && logsOf(A).length === 0);

    dev.cookie = null;
    const anon = await dev.fetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aura-Expected-Account': B }, body: JSON.stringify(payload('anon', 'crid-x4')) });
    check('SB4 the header never authorizes: no session + header -> 401', anon.status === 401 && logsOf(B).length === 1);

    dev.signIn(B);
    const callsBefore = store.dbCalls.length;
    const plan = await dev.fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aura-Expected-Account': A }, body: JSON.stringify({ title: 'x' }) });
    check('SB5 POST /api/plans with A expected + B session -> 409 before any db call (real route)', plan.status === 409 && store.dbCalls.length === callsBefore);
  }

  // ------------------------------------------------------------------ S1: A queues, signs out, B signs in
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A walk', 'crid-a1');
    await queueOffline(tab, dev, 'A read', 'crid-a2');
    check('S1 A queued 2 entries under A\'s own key (none in the legacy key)', queueLen(KEY_A) === 2 && !storage.data.has('offline_habit_queue'));
    let asked = '';
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    check('S1 sign-out asked about exactly the 2 pending logs and was acknowledged', out === 'signed-out' && /2 activity logs/.test(asked));
    check('S1 A\'s queue discarded after confirmation + acknowledged logout', queueLen(KEY_A) === 0 && dev.cookie === null);
    dev.signIn(B);
    const s = await tab.acct.fetchVerifiedSession(dev.fetch as any);
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S1 B verified; B\'s replay sends nothing', s.status === 'current' && r.attempted === 0 && dev.count('POST', '/api/habit-logs', (c) => c.processed) === 0);
    check('S1 nothing of A\'s was ever stored under B', logsOf(B).length === 0);
  }

  // ------------------------------------------------------------------ S2: replay in progress when logout starts
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    for (const n of [1, 2, 3]) await queueOffline(tab, dev, `A item ${n}`, `crid-r${n}`);
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = tab.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    let asked = '';
    const out = tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    const rr = await replay;
    check('S2 the running replay is aborted when sign-out starts (item 1 never processed)', rr.stoppedBecause === 'account-changed' && dev.count('POST', '/api/habit-logs', (c) => c.processed) === 0);
    check('S2 sign-out waited for the replay, then counted all 3 still-pending logs', (await out) === 'signed-out' && /3 activity logs/.test(asked));
    dev.signIn(B);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    gate.release();
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    await tick();
    check('S2 no A entry ever reached the server under B', logsOf(B).length === 0 && dev.calls.every((c) => !(c.key === 'POST /api/habit-logs' && c.sessionUser === B)));
  }

  // S2b: replay request already on the wire with A's cookie, B signs in before it lands
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A item', 'crid-w1');
    await queueOffline(tab, dev, 'A item 2', 'crid-w2');
    const gate = dev.hold('POST', '/api/habit-logs', 'after'); // processed under A, response delayed
    const replay = tab.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    // Another tab switches the device to B meanwhile.
    dev.signIn(B);
    const tab2 = openTab('tab2');
    await tab2.acct.fetchVerifiedSession(dev.fetch as any);
    await tick();
    gate.release();
    const rr = await replay;
    check('S2b the in-flight item was stored for A (its cookie at send), never for B', logsOf(A).length === 1 && logsOf(B).length === 0);
    check('S2b the replay stopped at the account change; item 2 was never sent under B', rr.attempted === 1 && dev.count('POST', '/api/habit-logs', (c) => c.sessionUser === B) === 0);
    check('S2b A\'s entries stay in A\'s queue only (the aborted item 1 is kept: its answer was lost)', queueLen(KEY_A) >= 1 && queueLen(KEY_B) === 0);
    dev.signIn(A);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S2b when A returns, replay completes without duplicating item 1 (server idempotency by clientRequestId)', logsOf(A).filter((l) => l.clientRequestId === 'crid-w1').length === 1 && logsOf(A).length === 2 && queueLen(KEY_A) === 0);
  }

  // ------------------------------------------------------------------ S3: direct activity request after logout
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    let refused = false;
    try { await tab.sync.submitActivityLog(payload('after logout', 'crid-d1'), 't', dev.fetch as any); } catch (e: any) { refused = e?.name === 'AccountUnavailableError'; }
    check('S3 a direct activity write after logout is refused client-side, nothing sent or queued', refused && dev.count('POST', '/api/habit-logs') === 0 && queueLen(KEY_A) === 0);
    const raw = await dev.fetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Aura-Expected-Account': A }, body: JSON.stringify(payload('raw', 'crid-d2')) });
    check('S3 the same request sent anyway is rejected by the server (401), nothing stored', raw.status === 401 && store.logs.length === 0);
  }

  // ------------------------------------------------------------------ S4: A's identity, B's session (stale tab)
  {
    fresh();
    const dev = new Device();
    const tab1 = await signedInTab(dev, A, 'tab1');
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    // tab1 starts a direct write; before it is sent... model: B signs in elsewhere, then the request goes out with B's cookie.
    dev.signIn(B); // cookie now B; tab1 has not heard yet (no storage event)
    const write = tab1.sync.submitActivityLog(payload('tab1 thinks A', 'crid-s4'), 't', dev.fetch as any);
    await gate.arrived;
    gate.release();
    const r = await write;
    check('S4 request carrying A + B\'s session is rejected (409) and reported as rejected', r.kind === 'rejected' && (r as any).status === 409);
    check('S4 nothing persisted for B or A; not queued', store.logs.length === 0 && queueLen(KEY_A) === 0 && queueLen(KEY_B) === 0);
  }

  // ------------------------------------------------------------------ S5: concurrent replay and enqueue
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A one', 'crid-c1');
    await queueOffline(tab, dev, 'A two', 'crid-c2');
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const r1 = tab.sync.replayOfflineQueue(dev.fetch as any);
    const r2 = tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S5 a second replay while one runs is the same single flight', r1 === r2);
    await gate.arrived;
    await queueOffline(tab, dev, 'A three (new)', 'crid-c3');
    gate.release();
    const res = await r1;
    const left = JSON.parse(storage.data.get(KEY_A) ?? '[]').map((i: any) => i.clientRequestId);
    check('S5 replay confirmed the 2 it read and removed only those', res.confirmed === 2 && res.removed === 2);
    check('S5 the entry enqueued during replay survived (no snapshot overwrite)', JSON.stringify(left) === '["crid-c3"]');
    check('S5 each replayed entry reached the server exactly once', logsOf(A).filter((l) => l.clientRequestId === 'crid-c1').length === 1 && logsOf(A).filter((l) => l.clientRequestId === 'crid-c2').length === 1);
  }

  // ------------------------------------------------------------------ S6: legacy unowned entries
  {
    fresh();
    storage.data.set('offline_habit_queue', JSON.stringify([{ activityTitle: 'legacy 1', clientRequestId: 'crid-l1', logTimestamp: '2026-11-01T00:00:00.000Z' }, { activityTitle: 'legacy 2', clientRequestId: 'crid-l2', logTimestamp: '2026-11-01T00:00:00.000Z' }]));
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S6 legacy unowned entries are quarantined: never replayed for the verified account', r.attempted === 0 && dev.count('POST', '/api/habit-logs') === 0);
    check('S6 they are not shown as the current account\'s pending work', tab.q.readOfflineHabitQueue(A).length === 0);
    let asked = '';
    const cancelled = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return false; } });
    check('S6 sign-out names them explicitly; Cancel keeps them and keeps A signed in', cancelled === 'cancelled' && /2 older unsynced logs/.test(asked) && storage.data.has('offline_habit_queue') && dev.cookie !== null);
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    check('S6 explicit confirmed discard removes them only after the acknowledged logout', out === 'signed-out' && !storage.data.has('offline_habit_queue'));
  }

  // ------------------------------------------------------------------ S7: account switch / session expiry without logout
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A pending', 'crid-e1');
    const epochA = tab.acct.getAccountEpoch();
    dev.cookie = null; // session expired / cleared, no ordinary logout
    const s1 = await tab.acct.fetchVerifiedSession(dev.fetch as any);
    check('S7 session expiry is detected as signed-out and moves to a new epoch', s1.status === 'signed-out' && tab.acct.getAccountEpoch() > epochA && tab.acct.getVerifiedAccount() === null);
    check('S7 A\'s pending entry is kept for A (expiry is not a confirmed sign-out)', queueLen(KEY_A) === 1);
    dev.signIn(B);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S7 B replays nothing of A\'s; A\'s entry never reaches the server under B', r.attempted === 0 && logsOf(B).length === 0 && queueLen(KEY_A) === 1);
    dev.signIn(A);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    const rA = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S7 when A is verified again, A\'s entry replays for A', rA.confirmed === 1 && logsOf(A).length === 1 && queueLen(KEY_A) === 0);
  }

  // ------------------------------------------------------------------ S8: multiple tabs
  {
    fresh();
    const dev = new Device();
    const tab1 = await signedInTab(dev, A, 'tab1');
    const tab2 = openTab('tab2');
    tab2.acct.subscribeAccount(() => {});
    await tab2.acct.fetchVerifiedSession(dev.fetch as any);
    const gate = dev.hold('POST', '/api/auth/logout', 'before');
    const out = tab2.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    await gate.arrived;
    await tick();
    let refused = '';
    try { await tab1.sync.submitActivityLog(payload('tab1 during tab2 sign-out', 'crid-m1'), 't', dev.fetch as any); } catch (e: any) { refused = e?.reason; }
    check('S8 while tab2 signs out, tab1 refuses new activity writes (cross-tab marker)', refused === 'transition' && dev.count('POST', '/api/habit-logs') === 0);
    gate.release();
    await out;
    await tick();
    check('S8 tab2\'s completed sign-out moves tab1 to a new epoch with no verified account', tab1.acct.getVerifiedAccount() === undefined);
    let refused2 = '';
    try { await tab1.sync.submitActivityLog(payload('tab1 after', 'crid-m2'), 't', dev.fetch as any); } catch (e: any) { refused2 = e?.reason; }
    check('S8 tab1 does nothing authenticated until it re-verifies', refused2 === 'unverified');
    // tab2 signs in as B; tab1 learns through the storage event.
    dev.signIn(B);
    await tab2.acct.fetchVerifiedSession(dev.fetch as any);
    await tick();
    const s = await tab1.acct.fetchVerifiedSession(dev.fetch as any);
    check('S8 tab1 re-verifies as B (never A)', s.status === 'current' && tab1.acct.getVerifiedAccount() === B);
  }

  // ------------------------------------------------------------------ S9: storage failures
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    storage.fail.set = true;
    dev.fault('POST', '/api/habit-logs', 'network-before');
    const r = await tab.sync.submitActivityLog(payload('cannot store', 'crid-f1'), 't', dev.fetch as any);
    check('S9 enqueue write failure -> not-stored (caller tells the user; nothing claimed pending)', r.kind === 'not-stored');
    storage.fail.set = false;
    await queueOffline(tab, dev, 'stored', 'crid-f2');
    storage.fail.get = true;
    let asked = '';
    const cancel = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return false; } });
    check('S9 unreadable storage: sign-out asks (cannot check) and Cancel keeps the session', cancel === 'cancelled' && /couldn't check this device/i.test(asked) && dev.cookie !== null);
    const rr = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S9 unreadable storage: replay sends nothing', rr.stoppedBecause === 'unreadable' && dev.count('POST', '/api/habit-logs', (c) => c.processed) === 0);
    storage.fail.get = false;
    storage.fail.remove = true;
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    storage.fail.remove = false;
    check('S9 removal failure after acknowledged logout: still signed out', out === 'signed-out' && dev.cookie === null);
    dev.signIn(B);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S9 the undeletable A entry stays partitioned: never sent under B', logsOf(B).length === 0 && dev.count('POST', '/api/habit-logs', (c) => c.sessionUser === B) === 0);
  }

  // ------------------------------------------------------------------ S10/S11/S12: logout failures, unexpected answers, lost ack, retry
  for (const [label, mode, expect] of [
    ['S10 offline (no response)', 'network-before', 'failed'],
    ['S10 HTTP 500', 'json500', 'failed'],
    ['S11 unexpected 200 HTML (captive portal)', 'html200', 'failed'],
    ['S11 unexpected redirect', 'redirect', 'failed'],
    ['S11 malformed acknowledgement (200 JSON without loggedOut)', 'json200-wrong', 'failed'],
  ] as const) {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A pending', 'crid-x');
    dev.fault('POST', '/api/auth/logout', mode);
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    check(`${label}: outcome '${expect}', still A, A's queue kept`, out === expect && tab.acct.getVerifiedAccount() === A && queueLen(KEY_A) === 1 && dev.cookie !== null);
    const retry = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    check(`${label}: retry signs out and discards A's queue`, retry === 'signed-out' && queueLen(KEY_A) === 0 && dev.cookie === null);
  }
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A pending', 'crid-lost');
    dev.fault('POST', '/api/auth/logout', 'network-after'); // server cleared the cookie, answer lost
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    check('S12 lost acknowledgement is reconciled: signed out, but unconfirmed', out === 'signed-out-unconfirmed' && tab.acct.getVerifiedAccount() === null);
    check('S12 unacknowledged logout keeps A\'s queue for A (not discarded)', queueLen(KEY_A) === 1);
    dev.signIn(B);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('S12 B never receives A\'s kept entry', logsOf(B).length === 0);
  }
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    let asks = 0;
    await queueOffline(tab, dev, 'A pending', 'crid-cc');
    const gate = dev.hold('POST', '/api/auth/logout', 'before');
    const p1 = tab.so.performSignOut({ fetch: dev.fetch as any, confirm: () => { asks++; return true; } });
    const p2 = tab.so.performSignOut({ fetch: dev.fetch as any, confirm: () => { asks++; return true; } });
    await gate.arrived;
    gate.release();
    const [o1, o2] = await Promise.all([p1, p2]);
    check('S13 concurrent sign-out attempts share one transition: one question, one logout request', p1 === p2 && o1 === 'signed-out' && o2 === 'signed-out' && asks === 1 && dev.count('POST', '/api/auth/logout') === 1);
  }

  // ------------------------------------------------------------------ S14: late session response
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    const gate = dev.hold('GET', '/api/auth/session', 'after'); // answered "A", delivered late
    const late = tab.acct.fetchVerifiedSession(dev.fetch as any);
    await gate.arrived;
    await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    gate.release();
    const r = await late;
    check('S14 a session answer from before the sign-out is stale and does not restore A', r.status === 'stale' && tab.acct.getVerifiedAccount() === null);
  }

  // ------------------------------------------------------------------ S15: in-flight direct write when sign-out starts
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const write = tab.sync.submitActivityLog(payload('in flight', 'crid-if'), 't', dev.fetch as any);
    await gate.arrived;
    let asked: string | null = null;
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    const w = await write;
    check('S15 sign-out aborts the in-flight write and waits for it to settle', w.kind === 'account-changed' && out === 'signed-out');
    check('S15 the aborted write was neither stored nor queued (and the user was not asked about phantom work)', store.logs.length === 0 && queueLen(KEY_A) === 0 && asked === null);
    gate.release();
  }

  // ------------------------------------------------------------------ S16: busy write blocks sign-out (ambiguous -> no sign-out)
  {
    fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    let release!: () => void;
    const stuck = tab.acct.runActivityOperation(() => new Promise<void>((r) => { release = r; }));
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes, settleTimeoutMs: 50 });
    check('S16 an activity operation that will not settle -> busy; still signed in, nothing sent', out === 'busy' && dev.cookie !== null && dev.count('POST', '/api/auth/logout') === 0 && tab.acct.getVerifiedAccount() === A);
    release(); await stuck;
  }

  void routes;
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
