/**
 * AURA-ANDROID-REL-04 IR-01 (R4) -- account-bound server-rendered state and
 * bound downloads (assessment of b323d2a, IR-01 remaining items).
 *
 *  S1-S6  The REAL PlanDayClient (and GoalsListClient) mounted inside the
 *         REAL AccountScoped with the `serverAccount` the server page
 *         resolved: nothing account-specific is shown or actionable until the
 *         client's FIRST verification agrees (the first verification does not
 *         change the epoch, which is why the R3 epoch-only reload missed it);
 *         a disagreeing first verification reloads without ever showing the
 *         old account's server props; a failed verification shows a retry
 *         state; the server HTML (renderToString) never contains the gated
 *         content.
 *  D1-D6  Data export / calendar download bound to the account tapped under:
 *         real middleware refuses a headerless or mismatched export, a
 *         download whose account changed before its body arrived is never
 *         handed to the browser, and the calendar feed's headerless link
 *         contract is preserved.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R4SsrAgreementJsdom.test.ts
 */
import { React, mount, flush, act, click } from './jsdomReactHarness';
import * as path from 'path';
import { Device, WEB, addUser, check, finish } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');

const dev = new Device();
dev.extra['/api/goals'] = (u) => (u === A ? [{ id: 'g-a', title: 'AliceGoal', status: 'ACTIVE' }] : [{ id: 'g-b', title: 'BobGoal', status: 'ACTIVE' }]);
dev.extra['/api/users/export'] = (u) => ({ profile: { id: u, email: u === A ? 'alice' : 'bob' } });
dev.extra['/api/calendar/feed'] = (u) => ({ ics: `feed-for-${u}` });
(global as any).fetch = dev.fetch;
(window as any).fetch = dev.fetch;

const acct = require(path.join(WEB, 'lib', 'accountSession'));
require(path.join(WEB, 'app', 'AccountBoundaryRoot'));
const { AccountScoped, pageReload } = require(path.join(WEB, 'components', 'AccountScoped'));
let reloads = 0;
pageReload.fn = () => { reloads++; };
const { PlanDayClient } = require(path.join(WEB, 'app', 'plan-day', 'PlanDayClient'));
const { GoalsListClient } = require(path.join(WEB, 'app', 'goals', 'GoalsListClient'));
const { downloadBound } = require(path.join(WEB, 'lib', 'boundDownload'));
const { renderToString } = require(require.resolve('react-dom/server', { paths: [WEB] }));
// PlanDayClient calls next/navigation useRouter(): provide the App Router context (navigation is not exercised).
const { AppRouterContext } = require(require.resolve('next/dist/shared/lib/app-router-context.shared-runtime', { paths: [WEB] }));
const routerStub = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await flush(); };
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');

/** Plan Day props as the server resolved them FOR ALICE (her city and her captured handoff item). */
const alicePlanDay = () => React.createElement(PlanDayClient, {
  timezone: 'Asia/Kolkata', planningDate: '2026-11-25', horizon: 'TODAY', availabilityConfigured: true,
  locationConfirmed: false, cityName: 'AliceTown', goalActivities: [], captures: [{ id: 'c-a', title: 'AliceCaptureItem' }], autoGoalSuggestions: [],
});
const gate = (serverAccount: string | null, child: unknown) => React.createElement(AppRouterContext.Provider, { value: routerStub }, React.createElement(AccountScoped, { onChange: 'reload', serverAccount }, child));
const clearReloadGuard = () => { try { window.sessionStorage.clear(); } catch { /* ignore */ } };

async function main() {
  // ---------------------------------------------------------------- S1 server HTML never contains gated content
  const html = renderToString(gate(A, alicePlanDay()));
  check('S1 server render of a gated page contains only the neutral checking state (no AliceTown, no capture item)', /Checking your account/.test(html) && !/AliceTown|AliceCaptureItem/.test(html));

  // ---------------------------------------------------------------- S2 first verification DISAGREES (cookie changed to Bob before hydration)
  clearReloadGuard();
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(B);
  reloads = 0;
  const sessionGate = dev.hold('GET', '/api/auth/session', 'before');
  const h2 = await mount(gate(A, alicePlanDay()));
  await settle(4);
  const c2 = h2.container as HTMLElement;
  const shownBeforeVerify = text(c2);
  check('S2 before the first verification answers: checking state only -- no AliceTown, no capture item, no Plan Day actions', /Checking your account/.test(shownBeforeVerify) && !/AliceTown|AliceCaptureItem/.test(shownBeforeVerify) && c2.querySelectorAll('button').length === 0);
  check('S2 the first verification does not change the epoch (why the R3 epoch-only reload missed this)', acct.getAccountEpoch() === 0);
  sessionGate.release();
  await settle(10);
  check('S2 first verification answers Bob for a page rendered for Alice -> reload requested, Alice\'s props never shown', reloads === 1 && !/AliceTown|AliceCaptureItem/.test(text(c2)) && /account changed/i.test(text(c2)));
  check('S2 no account-scoped request was sent by the gated page', dev.calls.every((x) => !/\/api\/(plans|plan-day|captures|goals)/.test(x.key)));
  await h2.unmount();

  // ---------------------------------------------------------------- S3 automatic reload is bounded (no reload loop)
  acct.__resetAccountSessionForTests('tab');
  reloads = 0;
  const h3 = await mount(gate(A, alicePlanDay()));
  await settle(12);
  const c3 = h3.container as HTMLElement;
  check('S3 a second disagreement within the guard window does not auto-reload again; a Reload button is offered', reloads === 0 && /Reload/.test(text(c3)) && !/AliceTown/.test(text(c3)));
  const reloadBtn = [...c3.querySelectorAll('button')].find((b) => /Reload/.test(b.textContent ?? '')) as HTMLElement;
  await click(reloadBtn);
  check('S3 the Reload button reloads', reloads === 1);
  await h3.unmount();

  // ---------------------------------------------------------------- S4 agreement -> content shown; later change -> hidden then reload
  clearReloadGuard();
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(A);
  reloads = 0;
  const h4 = await mount(gate(A, alicePlanDay()));
  await settle(12);
  const c4 = h4.container as HTMLElement;
  check('S4 first verification agrees (Alice) -> Plan Day rendered with Alice\'s server props', /AliceTown/.test(text(c4)) && reloads === 0);
  dev.signIn(B);
  const g4 = dev.hold('GET', '/api/auth/session', 'before');
  await act(async () => { acct.__deliverStorageEventForTests({ key: 'aura_account_announce_v2', newValue: JSON.stringify({ account: B, tab: 'other', at: Date.now() }) }); });
  await settle(4);
  check('S4 after cross-tab news the old account\'s server props are hidden immediately (before re-verification answers)', !/AliceTown|AliceCaptureItem/.test(text(c4)) && /Checking your account/.test(text(c4)));
  g4.release();
  await settle(12);
  check('S4 re-verification answers Bob -> reload; Alice\'s props stay hidden', reloads === 1 && !/AliceTown/.test(text(c4)));
  await h4.unmount();

  // ---------------------------------------------------------------- S5 verification fails -> retry state, nothing shown
  clearReloadGuard();
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(A);
  dev.fault('GET', '/api/auth/session', 'html200');
  const h5 = await mount(gate(A, alicePlanDay()));
  await settle(12);
  const c5 = h5.container as HTMLElement;
  check('S5 failed first verification -> "couldn\'t confirm" with Try again; no Plan Day content', /couldn.t confirm/i.test(text(c5)) && !/AliceTown/.test(text(c5)));
  const retry = [...c5.querySelectorAll('button')].find((b) => /Try again/.test(b.textContent ?? '')) as HTMLElement;
  await click(retry);
  await settle(12);
  check('S5 Try again verifies and, on agreement, shows the page', /AliceTown/.test(text(c5)));
  await h5.unmount();

  // ---------------------------------------------------------------- S6 Goals (client-fetched list) and signed-out render
  clearReloadGuard();
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(A);
  const h6 = await mount(gate(A, React.createElement(GoalsListClient, { authenticated: true })));
  await settle(14);
  check('S6 Goals with agreement: list loads for Alice with the stated account', /AliceGoal/.test(text(h6.container as HTMLElement)) && dev.calls.filter((x) => x.key.includes('/api/goals')).every((x) => x.expected === A));
  await h6.unmount();
  clearReloadGuard();
  acct.__resetAccountSessionForTests('tab');
  reloads = 0;
  const h6b = await mount(gate(null, React.createElement(GoalsListClient, { authenticated: false })));
  await settle(12);
  check('S6 page rendered SIGNED OUT while the device is signed in as Alice -> reload (never a signed-out shell acting for Alice)', reloads === 1);
  await h6b.unmount();

  // ---------------------------------------------------------------- D downloads
  clearReloadGuard();
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(A);
  await acct.fetchVerifiedSession();
  const saved: Array<{ name: string; body: string }> = [];
  const sink = { save: (blob: Blob, name: string) => { saved.push({ name, body: '' }); void blob.text().then((t) => { saved[saved.length - 1].body = t; }); } };
  let mark = dev.calls.length;
  const d1 = await downloadBound('/api/users/export', 'export.json', { sink });
  await settle(2);
  const exportCall = dev.calls.slice(mark).find((x) => x.key === 'GET /api/users/export');
  check('D1 export download states the tapped account and saves Alice\'s file', d1.status === 'saved' && exportCall?.expected === A && saved.length === 1 && /"id":"synthetic-user-a"/.test(saved[0].body));

  // D2 the account changes after the tap, before the body arrives
  const binding = acct.captureAccountBinding();
  const g = dev.hold('GET', '/api/users/export', 'after');
  const p2 = downloadBound('/api/users/export', 'export.json', { sink, binding });
  await g.arrived;
  dev.signIn(B);
  await act(async () => { acct.__deliverStorageEventForTests({ key: 'aura_account_announce_v2', newValue: JSON.stringify({ account: B, tab: 'other', at: Date.now() }) }); });
  g.release();
  const d2 = await p2;
  check('D2 account changed while the download was in flight -> account-changed, nothing handed to the browser', d2.status === 'account-changed' && saved.length === 1);

  // D3 stale binding (ambient cookie is Bob, binding is Alice) -> refused before sending
  mark = dev.calls.length;
  const d3 = await downloadBound('/api/users/export', 'export.json', { sink, binding });
  check('D3 a binding from before the change is refused before any request', d3.status === 'account-changed' && dev.calls.slice(mark).every((x) => x.key !== 'GET /api/users/export') && saved.length === 1);

  // D4 real middleware: headerless export with a session -> 503; mismatched -> 409 (server never runs the export)
  mark = dev.calls.length;
  const raw = await dev.fetch('/api/users/export', {});
  const mism = await dev.fetch('/api/users/export', { headers: { 'X-Aura-Expected-Account': A } });
  check('D4 headerless export (old link navigation) -> 503 client_upgrade_required; stating Alice while Bob is signed in -> 409', raw.status === 503 && mism.status === 409);

  // D5 calendar: in-app download is bound; the headerless subscription/link contract is preserved
  await acct.fetchVerifiedSession();
  const d5 = await downloadBound('/api/calendar/feed', 'aura.ics', { sink });
  const linkStyle = await dev.fetch('/api/calendar/feed', {});
  const calMismatch = await dev.fetch('/api/calendar/feed', { headers: { 'X-Aura-Expected-Account': A } });
  check('D5 in-app calendar download states Bob and saves; headerless feed (subscription/link) still answers; a stated mismatch is refused', d5.status === 'saved' && linkStyle.status === 200 && calMismatch.status === 409);

  // D6 during an auth transition the download is refused before sending
  const t = acct.beginTransition('signing-out');
  mark = dev.calls.length;
  const d6 = await downloadBound('/api/users/export', 'export.json', { sink });
  t?.end('resumed');
  check('D6 during a sign-in/out the download is refused (no request)', d6.status === 'unavailable' && dev.calls.slice(mark).every((x) => x.key !== 'GET /api/users/export'));

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
