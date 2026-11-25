/**
 * AURA-ANDROID-REL-04 IR-01 / IR-03 (R2) -- integrated account-isolation and
 * account-transition scenarios (synthetic accounts A and B).
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04AccountIsolation.test.ts
 *
 * Client: the real lib/accountSession, activitySync, offlineHabitQueue,
 * signOut, signInCode and accountBoundFetch modules, one instance per tab.
 * Server: the real middleware.ts and the real logout, session, habit-logs and
 * plans route handlers over an in-memory db stub. Interleavings are
 * DETERMINISTIC SIMULATIONS (held/failed requests, one process); they are not
 * a real multi-process browser race.
 */
import { Device, addUser, check, finish, locks, logsOf, openTab, closeAllTabs, payload, queueKeys, queuedCrids, clearQueueDb, idbFault, realPlansPost, resetStore, routes, storage, store, tick, WEB } from './rel04AccountIsolationHarness';
import * as path from 'path';

const { NextRequest } = require(require.resolve('next/server', { paths: [path.join(WEB, 'app', 'api', 'habit-logs')] }));
const auth = require(path.join(WEB, 'lib', 'auth'));

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');
const qA = async () => (await queueKeys(A)).length;
const qB = async () => (await queueKeys(B)).length;

async function fresh() {
  resetStore();
  storage.clear();
  storage.fail = { get: false, set: false, remove: false };
  idbFault.open = false; idbFault.read = false; idbFault.write = false;
  locks.enabled = true;
  closeAllTabs();
  await clearQueueDb();
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
const signOut = (tab: ReturnType<typeof openTab>, dev: Device, extra: Record<string, unknown> = {}) =>
  tab.so.performSignOut({ fetch: dev.fetch as any, confirm: yes, ...extra } as any);
function routeReq(method: string, url: string, cookieUser: string | null, headers: Record<string, string> = {}, body?: unknown) {
  const h = new Headers(headers);
  if (cookieUser) h.set('cookie', `as_session=${auth.createSessionToken(cookieUser, store.users.get(cookieUser)!.email)}`);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new NextRequest(`http://localhost${url}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function main() {
  // ================================================================ server boundary
  {
    await fresh();
    const before = store.dbCalls.length;
    const direct = await routes['POST /api/habit-logs'](routeReq('POST', '/api/habit-logs', B, { 'X-Aura-Expected-Account': A }, payload('x', 'c1')));
    check('SB1 habit-logs route: A expected + B session -> 409 account_mismatch, zero db calls', direct.status === 409 && (await direct.json()).code === 'account_mismatch' && store.dbCalls.length === before && store.logs.length === 0);

    const unbound = await routes['POST /api/habit-logs'](routeReq('POST', '/api/habit-logs', A, {}, payload('x', 'c2')));
    const ub = await unbound.json();
    check('SB2 habit-logs route: unbound (old client), signed in -> 503 client_upgrade_required, no-store, nothing written', unbound.status === 503 && ub.code === 'client_upgrade_required' && unbound.headers.get('cache-control') === 'no-store' && store.logs.length === 0 && store.dbCalls.length === before);
    const unboundExpired = await routes['POST /api/habit-logs'](routeReq('POST', '/api/habit-logs', null, {}, payload('x', 'c3')));
    check('SB3 habit-logs route: unbound + expired session -> the same 503 (decided before authentication, never 401)', unboundExpired.status === 503 && (await unboundExpired.json()).code === 'client_upgrade_required');
    const noSession = await routes['POST /api/habit-logs'](routeReq('POST', '/api/habit-logs', null, { 'X-Aura-Expected-Account': A }, payload('x', 'c4')));
    check('SB4 the header never authorizes: bound request without a session -> 401', noSession.status === 401 && store.logs.length === 0);

    const pMismatch = await realPlansPost(routeReq('POST', '/api/plans', B, { 'X-Aura-Expected-Account': A }, { title: 'x' }));
    const pUnbound = await realPlansPost(routeReq('POST', '/api/plans', A, {}, { title: 'x' }));
    const pUnboundExpired = await realPlansPost(routeReq('POST', '/api/plans', null, {}, { title: 'x' }));
    check('SB5 plans route (real handler): mismatch -> 409; unbound -> 503 upgrade (signed in and expired); zero db calls', pMismatch.status === 409 && pUnbound.status === 503 && pUnboundExpired.status === 503 && store.dbCalls.length === before);

    const lo = await routes['POST /api/auth/logout'](routeReq('POST', '/api/auth/logout', B, { 'X-Aura-Expected-Account': A }));
    check('SB6 logout bound to A while the session is B -> 409, cookie untouched (no Set-Cookie)', lo.status === 409 && !lo.headers.get('set-cookie'));
    const loOld = await routes['POST /api/auth/logout'](routeReq('POST', '/api/auth/logout', A));
    check('SB7 (R3) unbound legacy logout is refused (503 upgrade, no-store) and never clears a cookie', loOld.status === 503 && (await loOld.json()).code === 'client_upgrade_required' && !loOld.headers.get('set-cookie'));

    const dev = new Device();
    dev.signIn(B);
    const read = await dev.fetch('/api/habit-logs', { headers: { 'X-Aura-Expected-Account': A } });
    check('SB8 middleware: account-sensitive READ stating A with B\'s cookie -> 409 (no B data returned)', read.status === 409 && (await read.json()).code === 'account_mismatch');
    dev.cookie = 'forged.signature';
    const forged = await dev.fetch('/api/habit-logs', { method: 'POST', headers: { 'X-Aura-Expected-Account': A, 'Content-Type': 'application/json' }, body: JSON.stringify(payload('x', 'c5')) });
    check('SB9 middleware passes an invalid session through; the route answers 401', forged.status === 401);
  }

  // ================================================================ C1 A queues, signs out, B signs in
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A walk', 'crid-a1');
    await queueOffline(tab, dev, 'A read', 'crid-a2');
    let asked = '';
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    check('C1 sign-out asked about the 2 pending logs, acknowledged, discarded exactly them', out.outcome === 'signed-out' && out.owned?.failed === 0 && out.owned?.removed === 2 && /2 activity logs/.test(asked) && (await qA()) === 0 && dev.cookie === null);
    dev.signIn(B);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    const r = await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('C1 B replays nothing; nothing of A stored under B', r.attempted === 0 && logsOf(B).length === 0);
  }

  // ================================================================ C2 replay in progress when logout starts
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    for (const n of [1, 2, 3]) await queueOffline(tab, dev, `A item ${n}`, `crid-r${n}`);
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const replay = tab.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    let asked = '';
    const out = tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return true; } });
    const rr = await replay;
    check('C2 the running replay is aborted by the transition', rr.stoppedBecause === 'account-changed');
    check('C2 sign-out waited, then counted all 3 still-pending logs', (await out).outcome === 'signed-out' && /3 activity logs/.test(asked));
    dev.signIn(B);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    gate.release();
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    await tick();
    check('C2 nothing reached the server under B', logsOf(B).length === 0 && dev.calls.every((c) => !(c.key === 'POST /api/habit-logs' && c.sessionUser === B && c.processed)));
  }

  // ================================================================ C3 unresolved direct writes before logout confirmation
  for (const phase of ['before', 'after'] as const) {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    const gate = dev.hold('POST', '/api/habit-logs', phase);
    const write = tab.sync.submitActivityLog(payload('in flight', 'crid-if'), 't', dev.fetch as any);
    await gate.arrived;
    let asked = '';
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return false; } });
    const w = await write;
    gate.release();
    const committed = logsOf(A).length;
    check(`C3(${phase}) sign-out aborted the in-flight write; its outcome is unresolved, so it STAYS in A's queue`, w.kind === 'account-changed' && (w as any).keptForAccount === true && (await qA()) === 1);
    check(`C3(${phase}) the confirmation counts it, says it may already be saved, and Cancel keeps A signed in`, out.outcome === 'cancelled' && /1 activity log/.test(asked) && /may already have been sent/.test(asked) && dev.cookie !== null);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    check(`C3(${phase}) replay with the original clientRequestId resolves it exactly once for A (server ${phase === 'after' ? 'had committed' : 'had not committed'})`, logsOf(A).filter((l) => l.clientRequestId === 'crid-if').length === 1 && (await qA()) === 0 && committed === (phase === 'after' ? 1 : 0));
  }

  // ================================================================ C4 A identity + B session (unrecognized cookie change)
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    dev.signIn(B); // another tab signed in; this tab has not heard
    const r = await tab.sync.submitActivityLog(payload('tab thinks A', 'crid-s4'), 't', dev.fetch as any);
    check('C4 refused by the server (409), kept for A, nothing stored for B', r.kind === 'account-changed' && (r as any).keptForAccount && (await qA()) === 1 && (await qB()) === 0 && store.logs.length === 0);
  }

  // ================================================================ C5 multi-tab queue interleavings (per-entry atomic storage)
  {
    await fresh();
    const dev = new Device();
    const tab1 = await signedInTab(dev, A, 'tab1');
    const tab2 = openTab('tab2');
    await tab2.acct.fetchVerifiedSession(dev.fetch as any);
    await queueOffline(tab1, dev, 'A one', 'crid-m1');
    await queueOffline(tab2, dev, 'A two', 'crid-m2');
    check('C5a two tabs enqueue for A: both entries kept (no shared-array overwrite)', (await qA()) === 2);
    const gate = dev.hold('POST', '/api/habit-logs', 'before');
    const rep1 = tab1.sync.replayOfflineQueue(dev.fetch as any);
    await gate.arrived;
    await queueOffline(tab2, dev, 'A three (during tab1 replay)', 'crid-m3');
    const rep2 = await tab2.sync.replayOfflineQueue(dev.fetch as any);
    check('C5b a second tab\'s replay while one runs is excluded by the shared lock', rep2.stoppedBecause === 'busy');
    gate.release();
    const r1 = await rep1;
    const left = await queuedCrids(A);
    check('C5c tab1 settled and removed only the entries it read; tab2\'s new entry survived', r1.confirmed === 2 && JSON.stringify(left) === '["crid-m3"]');
    // Discard snapshot: an entry that appears AFTER confirmation survives the discard.
    let injected = false;
    const db: IDBDatabase = await tab2.q.__openQueueDbForTests();
    const out = await tab1.so.performSignOut({
      fetch: dev.fetch as any,
      confirm: () => {
        // Simulates a tab that did not observe the transition (no Web Locks, missed marker) adding work after the question.
        db.transaction(['records'], 'readwrite').objectStore('records').put({ recordId: 'rlate', ownerUserId: A, clientRequestId: 'crid-late', queuedAt: Date.now(), item: { ...payload('late', 'crid-late'), ownerUserId: A, tempId: 't', recordId: 'rlate' } });
        injected = true;
        return true;
      },
    });
    check('C5d confirmed discard removes exactly the confirmed snapshot; work added afterwards is kept for A', out.outcome === 'signed-out' && injected && JSON.stringify(await queuedCrids(A)) === '["crid-late"]');
  }
  {
    await fresh();
    locks.enabled = false; // supported environment without Web Locks
    const dev = new Device();
    const tab1 = await signedInTab(dev, A, 'tab1');
    const tab2 = openTab('tab2');
    await tab2.acct.fetchVerifiedSession(dev.fetch as any);
    for (const n of [1, 2]) await queueOffline(tab1, dev, `A n${n}`, `crid-n${n}`);
    const [x, y] = await Promise.all([tab1.sync.replayOfflineQueue(dev.fetch as any), tab2.sync.replayOfflineQueue(dev.fetch as any)]);
    check('C6 without Web Locks two tabs may replay concurrently; nothing is lost and nothing is duplicated (clientRequestId)', (await qA()) === 0 && logsOf(A).length === 2 && x.stoppedBecause === null && y.stoppedBecause === null);
  }

  // ================================================================ C7 storage failures
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    idbFault.write = true;
    dev.fault('POST', '/api/habit-logs', 'network-before');
    const r = await tab.sync.submitActivityLog(payload('cannot store', 'crid-f1'), 't', dev.fetch as any);
    check('C7a write fails AND storage write fails -> not-stored (reported, never claimed pending)', r.kind === 'not-stored');
    idbFault.write = false;
    await queueOffline(tab, dev, 'stored 1', 'crid-f2');
    await queueOffline(tab, dev, 'stored 2', 'crid-f3');
    idbFault.read = true;
    let asked = '';
    const c = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: (m) => { asked = m; return false; } });
    check('C7b unreadable storage: asked (cannot check) and Cancel keeps the session', c.outcome === 'cancelled' && /couldn't read this device's unsynced activity/i.test(asked) && dev.cookie !== null);
    idbFault.read = false;
    idbFault.write = true;
    const out = await signOut(tab, dev);
    idbFault.write = false;
    check('C7c removal failure after acknowledged logout: signed out AND reported truthfully (2 not removed)', out.outcome === 'signed-out' && out.owned?.failed === 2 && (await qA()) === 2);
    dev.signIn(B);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    await tab.sync.replayOfflineQueue(dev.fetch as any);
    check('C7d the entries that could not be removed stay A\'s: never sent under B', logsOf(B).length === 0 && dev.count('POST', '/api/habit-logs', (x) => x.sessionUser === B) === 0);
  }

  // ================================================================ C8 bounded logout stages
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A pending', 'crid-t1');
    dev.fault('POST', '/api/auth/logout', 'hang');
    const t0 = Date.now();
    const out = await signOut(tab, dev, { logoutTimeoutMs: 60, reconcileTimeoutMs: 60 });
    check('C8a logout request that never settles: bounded; reconciled to the same account -> failed, A kept with its queue', out.outcome === 'failed' && tab.acct.getVerifiedAccount() === A && (await qA()) === 1 && Date.now() - t0 < 2000);
    dev.fault('POST', '/api/auth/logout', 'hang-body');
    const out2 = await signOut(tab, dev, { logoutTimeoutMs: 60, reconcileTimeoutMs: 60 });
    check('C8b acknowledgement body that never finishes (server DID sign out): bounded, reconciled -> signed-out-unconfirmed, queue kept', out2.outcome === 'signed-out-unconfirmed' && (await qA()) === 1);
    dev.signIn(A);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    dev.fault('POST', '/api/auth/logout', 'hang');
    dev.fault('GET', '/api/auth/session', 'hang');
    const out3 = await signOut(tab, dev, { logoutTimeoutMs: 60, reconcileTimeoutMs: 60 });
    let refused = '';
    try { await tab.sync.submitActivityLog(payload('while unverified', 'crid-t2'), 't', dev.fetch as any); } catch (e: any) { refused = e?.reason; }
    check('C8c logout AND reconciliation never settle: bounded -> unverified; bound writes refused; queue kept', out3.outcome === 'unverified' && tab.acct.getVerifiedAccount() === undefined && refused === 'unverified' && (await qA()) === 1);
    const back = await tab.acct.fetchVerifiedSession(dev.fetch as any);
    check('C8d recovery: a fresh session answer resumes A (the Retry path)', back.status === 'current' && tab.acct.getVerifiedAccount() === A);
  }

  // ================================================================ C9 HTTP failures are ambiguous
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A pending', 'crid-h1');
    dev.fault('POST', '/api/auth/logout', 'process-then-500'); // server signed out; the client sees a 500
    const out = await signOut(tab, dev);
    check('C9a 500 after the server changed the session is NOT treated as "still A": reconciled -> signed-out-unconfirmed', out.outcome === 'signed-out-unconfirmed' && tab.acct.getVerifiedAccount() === null && (await qA()) === 1);
    dev.signIn(A);
    await tab.acct.fetchVerifiedSession(dev.fetch as any);
    dev.fault('POST', '/api/auth/logout', 'json500');
    const sessionCallsBefore = dev.count('GET', '/api/auth/session');
    const out2 = await signOut(tab, dev);
    check('C9b 500 with the session unchanged: A resumes only after a fresh session answer', out2.outcome === 'failed' && dev.count('GET', '/api/auth/session') === sessionCallsBefore + 1 && tab.acct.getVerifiedAccount() === A);
    for (const mode of ['html200', 'redirect', 'json200-wrong', 'json-suffix-type'] as const) {
      dev.fault('POST', '/api/auth/logout', mode);
      const o = await signOut(tab, dev);
      check(`C9c unexpected answer '${mode}' is never an acknowledgement; reconciled -> failed, A kept`, o.outcome === 'failed' && tab.acct.getVerifiedAccount() === A && (await qA()) === 1);
    }
  }

  // ================================================================ C10 sign-in while logout is pending; concurrent logout across tabs
  for (const withLocks of [true, false]) {
    await fresh();
    locks.enabled = withLocks;
    const dev = new Device();
    dev.verifyAs['bobsynth@example.invalid'] = B;
    const tab1 = await signedInTab(dev, A, 'tab1');
    const tab2 = openTab('tab2');
    await tab2.acct.fetchVerifiedSession(dev.fetch as any);
    const gate = dev.hold('POST', '/api/auth/logout', 'before');
    const out = signOut(tab1, dev);
    await gate.arrived;
    await tick();
    const si = await tab2.si.verifySignInCode({ email: 'bobsynth@example.invalid', code: '123456' }, dev.fetch as any);
    const second = await tab2.so.performSignOut({ fetch: dev.fetch as any, confirm: yes });
    check(`C10 (${withLocks ? 'Web Locks' : 'marker fallback'}) sign-in in another tab while logout is pending is refused (BUSY), no verify-code sent`, si.kind === 'BUSY' && dev.count('POST', '/api/auth/verify-code') === 0);
    check(`C10 (${withLocks ? 'Web Locks' : 'marker fallback'}) a concurrent logout in another tab is refused (busy): one logout request`, second.outcome === 'busy' && dev.count('POST', '/api/auth/logout') === 1);
    gate.release();
    await out;
    const si2 = await tab2.si.verifySignInCode({ email: 'bobsynth@example.invalid', code: '123456' }, dev.fetch as any);
    check(`C10 (${withLocks ? 'Web Locks' : 'marker fallback'}) after the logout completes, B signs in and is confirmed; the old logout cannot clear it`, si2.kind === 'VERIFIED' && (si2 as any).userId === B && dev.sessionUser() === B);
  }

  // ================================================================ C11 old logout cannot clear a newer sign-in (account-bound logout)
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'A pending', 'crid-o1');
    // An uncoordinated sign-in as B lands after the question but BEFORE A's
    // logout is sent, so the logout carries B's cookie.
    const o = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: () => { dev.signIn(B); return true; } });
    check('C11 A\'s logout carrying B\'s session is refused by the server: B stays signed in; client switches to B; A\'s queue kept', o.outcome === 'account-changed' && dev.sessionUser() === B && tab.acct.getVerifiedAccount() === B && (await qA()) === 1);
    // Documented limitation (report R2.6): a logout SENT with A's cookie is a
    // valid logout of A; if an uncoordinated sign-in's response lands before
    // that logout's response, the browser applies the logout's Set-Cookie
    // last. Coordinated flows prevent this with the auth lock (C10).
  }

  // ================================================================ C12 session answer ordering
  {
    await fresh();
    const dev = new Device();
    dev.signIn(A);
    const tab = openTab('tab1');
    const gate = dev.hold('GET', '/api/auth/session', 'after'); // answers "A", delivered late
    const first = tab.acct.fetchVerifiedSession(dev.fetch as any);
    await gate.arrived;
    dev.signIn(B);
    const second = await tab.acct.fetchVerifiedSession(dev.fetch as any);
    gate.release();
    const late = await first;
    check('C12a concurrent same-epoch answers: the newer (B) wins; the late older (A) answer is never applied -- its caller gets the newer answer', second.status === 'current' && late.status === 'current' && (late as any).user.id === B && tab.acct.getVerifiedAccount() === B);
  }
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    const gate = dev.hold('GET', '/api/auth/session', 'after');
    const held = tab.acct.fetchVerifiedSession(dev.fetch as any);
    await gate.arrived;
    dev.signIn(B); // another tab signed in as B ...
    tab.acct.__deliverStorageEventForTests({ key: 'aura_account_announce_v2', newValue: JSON.stringify({ account: B, tab: 'other', at: Date.now() }) });
    const sessionsBefore = dev.count('GET', '/api/auth/session');
    gate.release();
    const r = await held;
    check('C12b the held "A" answer across a cross-tab invalidation is discarded; a fresh check finds B (A is not restored)', r.status === 'current' && (r as any).user.id === B && tab.acct.getVerifiedAccount() === B && dev.count('GET', '/api/auth/session') === sessionsBefore + 1);
  }
  {
    await fresh();
    const dev = new Device();
    const tab = await signedInTab(dev, A);
    await queueOffline(tab, dev, 'x', 'crid-c12');
    const gate = dev.hold('GET', '/api/auth/session', 'after');
    const held = tab.acct.fetchVerifiedSession(dev.fetch as any);
    await gate.arrived;
    const out = await tab.so.performSignOut({ fetch: dev.fetch as any, confirm: () => false }); // cancelled transition
    const sessionsBefore = dev.count('GET', '/api/auth/session');
    gate.release();
    const r = await held;
    void sessionsBefore;
    const heldRec = dev.calls.filter((c) => c.key === 'GET /api/auth/session')[1];
    check('C12c a session read in flight when a transition starts is aborted (never applied); the caller gets stale or a FRESH re-check; account unchanged after Cancel', out.outcome === 'cancelled' && heldRec?.status === 'aborted' && (r.status === 'stale' || (r.status === 'current' && (r as any).user.id === A)) && tab.acct.getVerifiedAccount() === A);
  }

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
