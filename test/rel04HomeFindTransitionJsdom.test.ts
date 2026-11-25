/**
 * AURA-ANDROID-REL-04 IR-01 / IR-03 -- the REAL Home page (app/page.tsx) and
 * /find (GuestFindClient) mounted in jsdom against the in-process routes of
 * rel04AccountIsolationHarness (synthetic accounts A and B).
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04HomeFindTransitionJsdom.test.ts
 *
 * Proves on screen: no previous-account data under the next account (sign-out
 * then sign-in, late dashboard responses, session expiry, another tab's
 * account switch), and the same transition behaviour on /find.
 */
import { React, mount, flush, act, click } from './jsdomReactHarness';
import { Device, addUser, check, finish, idbFault, storage, store } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');
const nowIso = new Date().toISOString();
store.logs.push({ id: 'log-a', userId: A, clientRequestId: null, activityTitle: 'AliceOnlyMeditation', logTimestamp: nowIso, createdAt: nowIso, activeWindow: 'NEUTRAL' });
store.logs.push({ id: 'log-b', userId: B, clientRequestId: null, activityTitle: 'BobOnlyWorkout', logTimestamp: nowIso, createdAt: nowIso, activeWindow: 'NEUTRAL' });

const dev = new Device();
dev.extra['/api/plans'] = () => [];
dev.extra['/api/habits'] = () => [];
(global as any).fetch = dev.fetch;
(window as any).fetch = dev.fetch; // the page installs the account-bound wrapper around window.fetch
(global as any).requestAnimationFrame = (f: any) => setTimeout(f, 0);
(global as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
(window as any).confirm = () => true;
(window as any).alert = () => {};

const Page = require('../apps/web/app/page').default;
const { GuestFindClient } = require('../apps/web/app/find/GuestFindClient');
const acct = require('../apps/web/lib/accountSession');
const { performSignOut } = require('../apps/web/lib/signOut');

const settle = async (n = 12) => { for (let i = 0; i < n; i++) await flush(); };
const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');
const hasA = (t: string) => /Alicesynth|AliceOnlyMeditation/.test(t);
const hasB = (t: string) => /Bobsynth|BobOnlyWorkout/.test(t);

async function setVisible() {
  // jsdom reports 'prerender' unless told otherwise.
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  await act(async () => { document.dispatchEvent(new (window as any).Event('visibilitychange')); });
}

async function main() {
  // ---------------------------------------------------------------- H1: A on Home
  dev.signIn(A);
  const home = await mount(React.createElement(Page));
  await settle();
  const c = home.container as HTMLElement;
  check('H1 Home shows account A (greeting derived from the verified account record)', /Alicesynth/.test(textOf(c)));
  check('H1 A\'s dashboard requests carried A\'s session only', dev.calls.filter((x) => x.key === 'GET /api/habit-logs').every((x) => x.sessionUser === A));

  // ---------------------------------------------------------------- H2-H4: A's own reload is in flight when A signs out and B signs in
  // Home's next data load for A is held AFTER the server answered with A's data.
  const lateLogs = dev.hold('GET', '/api/habit-logs', 'after');
  const lateSession = dev.hold('GET', '/api/auth/session', 'after');
  const remountA = await mount(React.createElement(Page)); // a second A dashboard whose first load is held
  await lateSession.arrived;
  let out = '';
  await act(async () => { out = (await performSignOut({ fetch: dev.fetch, confirm: () => true })).outcome; });
  await settle();
  check('H2 sign-out acknowledged; Home leaves account A (no A name or data on screen)', out === 'signed-out' && !hasA(textOf(c)));

  dev.signIn(B);
  const switchedAt = dev.calls.length;
  await act(async () => { await acct.fetchVerifiedSession(); });
  await settle();
  check('H3 B signs in: Home shows B', /Bobsynth/.test(textOf(c)));

  lateSession.release();
  await settle();
  await lateLogs.arrived.catch(() => {});
  lateLogs.release();
  await settle();
  const c2 = remountA.container as HTMLElement;
  check('H4 the late session answer for A was discarded as stale (account stays B)', acct.getVerifiedAccount() === B);
  check('H4 no surface shows A after the late responses: neither dashboard instance', !hasA(textOf(c)) && !hasA(textOf(c2)) && /Bobsynth/.test(textOf(c)));
  const afterSwitch = dev.calls.slice(switchedAt).filter((x) => x.key.startsWith('GET ') && x.key !== 'GET /api/auth/session');
  check('H4 every dashboard request issued after the switch carried B\'s session (none for A)', afterSwitch.every((x) => x.sessionUser === B));
  await remountA.unmount();

  // ---------------------------------------------------------------- H5: session expiry noticed on foreground
  dev.cookie = null;
  await setVisible();
  await settle();
  check('H5 session expiry (no logout) is noticed on return to foreground: Home leaves B', !hasB(textOf(c)) && acct.getVerifiedAccount() === null);

  // ---------------------------------------------------------------- H6: another tab switches the device to A
  dev.signIn(A);
  await act(async () => { await acct.fetchVerifiedSession(); });
  await settle();
  check('H6 A again: Home shows A', /Alicesynth/.test(textOf(c)));
  dev.signIn(B); // another tab signed in as B ...
  await act(async () => {
    acct.__deliverStorageEventForTests({ key: 'aura_account_announce_v2', newValue: JSON.stringify({ account: B, tab: 'other-tab', at: Date.now() }) });
  });
  await settle();
  check('H6 ... and announced it: this tab drops A and re-verifies as B', /Bobsynth/.test(textOf(c)) && !hasA(textOf(c)));
  await home.unmount();

  // ---------------------------------------------------------------- F1-F3: /find follows the same boundary
  dev.signIn(A);
  const find = await mount(React.createElement(GuestFindClient, { initialSource: 'DIRECT', initialRestoreToken: null }));
  await settle();
  check('F1 /find verifies the session through the shared boundary (account A)', acct.getVerifiedAccount() === A);

  let outFind = '';
  await act(async () => { outFind = (await performSignOut({ fetch: dev.fetch, confirm: () => true })).outcome; });
  await settle();
  const fc = find.container as HTMLElement;
  const chip = [...fc.querySelectorAll('button')].find((b) => /Workout/.test(b.textContent ?? ''));
  if (chip) await click(chip);
  await settle(4);
  check('F2 after sign-out /find treats the visitor as a guest (guest details step, not the signed-in Plan route)', outFind === 'signed-out' && /Workout/.test(textOf(fc)) && !!fc.querySelector('button') && /Back/.test(textOf(fc)));

  // F3: a /find save during another tab's sign-out is refused client-side, and a stale save is refused by the server.
  dev.signIn(A);
  await act(async () => { await acct.fetchVerifiedSession(); });
  storage.setItem('aura_auth_transition_v2', JSON.stringify({ kind: 'signing-out', tx: 'other-tx', tab: 'other-tab', at: Date.now() }));
  let refused = '';
  try { await acct.runActivityOperation(async () => 'saved'); } catch (e: any) { refused = e?.reason; }
  check('F3 during another tab\'s sign-out, /find-style saves are refused (shared runActivityOperation)', refused === 'transition');
  storage.removeItem('aura_auth_transition_v2');
  await find.unmount();

  // ---------------------------------------------------------------- Q-R5: the real Home with an UNREADABLE queue says so
  dev.signIn(A);
  acct.__resetAccountSessionForTests('home-q');
  idbFault.read = true;
  const homeQ = await mount(React.createElement(Page));
  await settle(16);
  const cq = homeQ.container as HTMLElement;
  const unavailable = cq.querySelector('[data-queue-state="unavailable"]');
  idbFault.read = false;
  check('Q-R5 (mounted Home) an unreadable offline queue is shown as UNAVAILABLE ("may not be shown; nothing was removed"), not as no pending activity', !!unavailable && /couldn.t read this device.s unsynced activity/i.test(unavailable?.textContent ?? '') && /Alicesynth/.test(textOf(cq)));
  await homeQ.unmount();
  const homeOk = await mount(React.createElement(Page));
  await settle(16);
  check('Q-R5 (mounted Home) with a readable queue there is no unavailable notice', !(homeOk.container as HTMLElement).querySelector('[data-queue-state="unavailable"]'));
  await homeOk.unmount();

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
