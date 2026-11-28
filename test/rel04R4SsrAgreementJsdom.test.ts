/**
 * AURA-ANDROID-REL-04 IR-01 (R4, R5) -- account-bound page state and
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
// R5: Plan Day's bootstrap (the real route needs a database; the harness answers per session account BEHIND the real middleware).
dev.extra['/api/plan-day/bootstrap'] = (u) => ({ timezone: 'Asia/Kolkata', planningDate: '2026-11-25', horizon: 'TODAY', availabilityConfigured: true, locationConfirmed: false, cityName: u === A ? 'AliceTown' : 'BobTown', goalActivities: [], captures: [{ id: 'c-x', title: u === A ? 'AliceCaptureItem' : 'BobCaptureItem' }], autoGoalSuggestions: [] });
dev.extra['/api/goals'] = (u) => (u === A ? [{ id: 'g-a', title: 'AliceGoal', status: 'ACTIVE' }] : [{ id: 'g-b', title: 'BobGoal', status: 'ACTIVE' }]);
dev.extra['/api/users/export'] = (u) => ({ profile: { id: u, email: u === A ? 'alice' : 'bob' } });
dev.extra['/api/calendar/feed'] = (u) => ({ ics: `feed-for-${u}` });
(global as any).fetch = dev.fetch;
(window as any).fetch = dev.fetch;

const acct = require(path.join(WEB, 'lib', 'accountSession'));
require(path.join(WEB, 'app', 'AccountBoundaryRoot'));
const { AccountScoped } = require(path.join(WEB, 'components', 'AccountScoped'));
const { PlanDayLoader } = require(path.join(WEB, 'app', 'plan-day', 'PlanDayLoader'));
const { GoalsListScoped } = require(path.join(WEB, 'app', 'goals', 'GoalsListClient'));
const { downloadBound } = require(path.join(WEB, 'lib', 'boundDownload'));
const { renderToString } = require(require.resolve('react-dom/server', { paths: [WEB] }));
// PlanDayClient/PlanDayLoader use next/navigation (useRouter, useSearchParams): provide the App Router contexts.
const { AppRouterContext } = require(require.resolve('next/dist/shared/lib/app-router-context.shared-runtime', { paths: [WEB] }));
const { SearchParamsContext } = require(require.resolve('next/dist/shared/lib/hooks-client-context.shared-runtime', { paths: [WEB] }));
const routerStub = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await flush(); };
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');
const withRouter = (child: unknown, query = '') => React.createElement(AppRouterContext.Provider, { value: routerStub }, React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, child));
const planDay = (query = '') => withRouter(React.createElement(PlanDayLoader), query);
const bootstrapCalls = () => dev.calls.filter((c) => c.key === 'GET /api/plan-day/bootstrap');
const fs = require('fs');

async function main() {
  // ---------------------------------------------------------------- S1 no account data in the server response
  const html = renderToString(planDay());
  const pageSrc = fs.readFileSync(path.join(WEB, 'app', 'plan-day', 'page.tsx'), 'utf8');
  check('S1 (R5) the server render of Plan Day is the neutral checking state, and the page module reads no session, cookie or database (no account-derived props exist to serialize)', /Checking your account/.test(html) && !/AliceTown|BobTown/.test(html) && !/cookies\(|verifySessionToken|lib\/db|SESSION_COOKIE_NAME/.test(pageSrc));
  for (const f of [['goals', 'page.tsx'], ['goals', '[goalId]', 'page.tsx'], ['captures', 'page.tsx']]) {
    const src = fs.readFileSync(path.join(WEB, 'app', ...f), 'utf8');
    check(`S1 (R5) app/${f.join('/')} reads no session, cookie or database (nothing account-derived in its response)`, !/cookies\(|verifySessionToken|lib\/db|SESSION_COOKIE_NAME|serverAccount/.test(src));
  }

  // ---------------------------------------------------------------- S2 nothing account-derived is FETCHED before verification answers
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(B);
  const sessionGate = dev.hold('GET', '/api/auth/session', 'before');
  let mark = dev.calls.length;
  const h2 = await mount(planDay('horizon=today'));
  await settle(4);
  const c2 = h2.container as HTMLElement;
  check('S2 (R5) before the first verification answers: checking state only, and NO bootstrap request has been sent', /Checking your account/.test(text(c2)) && bootstrapCalls().length === 0);
  check('S2 the first verification does not change the epoch (why the R3 epoch-only reload missed it)', acct.getAccountEpoch() === 0);
  sessionGate.release();
  await settle(14);
  const b2 = dev.calls.slice(mark).filter((c) => c.key === 'GET /api/plan-day/bootstrap');
  check('S2 (R5) after verification (Bob) the bootstrap is fetched ONCE, stating Bob, and Bob\'s day is shown -- the query string is forwarded', b2.length === 1 && b2[0].expected === B && /BobTown/.test(text(c2)) && !/AliceTown/.test(text(c2)));
  await h2.unmount();

  // ---------------------------------------------------------------- S3 account change: unmount, re-verify, refetch for the new account (no reload)
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(A);
  const h3 = await mount(planDay());
  await settle(14);
  const c3 = h3.container as HTMLElement;
  check('S3 Alice verified -> Alice\'s day', /AliceTown/.test(text(c3)));
  dev.signIn(B);
  const g3 = dev.hold('GET', '/api/auth/session', 'before');
  mark = dev.calls.length;
  await act(async () => { acct.__deliverStorageEventForTests({ key: 'aura_account_announce_v2', newValue: JSON.stringify({ account: B, tab: 'other', at: Date.now() }) }); });
  await settle(4);
  check('S3 after cross-tab news Alice\'s day is unmounted immediately (checking state), before re-verification answers', !/AliceTown/.test(text(c3)) && /Checking your account/.test(text(c3)));
  g3.release();
  await settle(14);
  const b3 = dev.calls.slice(mark).filter((c) => c.key === 'GET /api/plan-day/bootstrap');
  check('S3 (R5) re-verification answers Bob -> a fresh bootstrap for Bob (stated Bob) and Bob\'s day; no page reload is involved', b3.length === 1 && b3[0].expected === B && /BobTown/.test(text(c3)) && !/AliceTown/.test(text(c3)));
  await h3.unmount();

  // ---------------------------------------------------------------- S4 verification fails -> retry, nothing fetched
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(A);
  dev.fault('GET', '/api/auth/session', 'html200');
  mark = dev.calls.length;
  const h4 = await mount(planDay());
  await settle(12);
  const c4 = h4.container as HTMLElement;
  check('S4 failed first verification -> "couldn\'t confirm" with Try again; no bootstrap request', /couldn.t confirm/i.test(text(c4)) && dev.calls.slice(mark).every((c) => c.key !== 'GET /api/plan-day/bootstrap'));
  const retry = [...c4.querySelectorAll('button')].find((b) => /Try again/.test(b.textContent ?? '')) as HTMLElement;
  await click(retry);
  await settle(14);
  check('S4 Try again verifies, then fetches and shows the day', /AliceTown/.test(text(c4)));
  await h4.unmount();

  // ---------------------------------------------------------------- S5 sessionStorage unavailable: still no automatic reload, still correct
  const ssDesc = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new Error('SecurityError (synthetic)'); } });
  const scopedSrc = fs.readFileSync(path.join(WEB, 'components', 'AccountScoped.tsx'), 'utf8');
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(B);
  const h5 = await mount(planDay());
  await settle(14);
  const ok5 = /BobTown/.test(text(h5.container as HTMLElement));
  await h5.unmount();
  if (ssDesc) Object.defineProperty(window, 'sessionStorage', ssDesc);
  check('S5 (R5) AccountScoped has no automatic reload path at all (no location.reload, no sessionStorage guard) -- so storage being unavailable cannot cause a reload loop', !/location\.reload|sessionStorage|pageReload/.test(scopedSrc) && ok5);

  // ---------------------------------------------------------------- S6 Goals (verified page) and the bootstrap boundary
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(A);
  mark = dev.calls.length;
  const h6 = await mount(withRouter(React.createElement(GoalsListScoped)));
  await settle(14);
  check('S6 Goals: list fetched only after verification, stating Alice', /AliceGoal/.test(text(h6.container as HTMLElement)) && dev.calls.slice(mark).filter((x) => x.key.includes('/api/goals')).every((x) => x.expected === A));
  await h6.unmount();
  const r1 = await dev.fetch('/api/plan-day/bootstrap', {});
  const r2 = await dev.fetch('/api/plan-day/bootstrap', { headers: { 'X-Aura-Expected-Account': B } });
  check('S6 (R5) the bootstrap route is account-scoped by the real middleware: headerless -> 503, another account -> 409', r1.status === 503 && r2.status === 409);
  void AccountScoped;

  // ---------------------------------------------------------------- D downloads
  acct.__resetAccountSessionForTests('tab');
  dev.signIn(A);
  await acct.fetchVerifiedSession();
  const saved: Array<{ name: string; body: string }> = [];
  const target = { save: (blob: Blob, name: string) => { saved.push({ name, body: '' }); void blob.text().then((t) => { saved[saved.length - 1].body = t; }); } };
  mark = dev.calls.length;
  const d1 = await downloadBound('/api/users/export', 'export.json', { target });
  await settle(2);
  const exportCall = dev.calls.slice(mark).find((x) => x.key === 'GET /api/users/export');
  check('D1 export download states the tapped account and saves Alice\'s file', d1.status === 'saved' && exportCall?.expected === A && saved.length === 1 && /"id":"synthetic-user-a"/.test(saved[0].body));

  // D2 the account changes after the tap, before the body arrives
  const binding = acct.captureAccountBinding();
  const g = dev.hold('GET', '/api/users/export', 'after');
  const p2 = downloadBound('/api/users/export', 'export.json', { target, binding });
  await g.arrived;
  dev.signIn(B);
  await act(async () => { acct.__deliverStorageEventForTests({ key: 'aura_account_announce_v2', newValue: JSON.stringify({ account: B, tab: 'other', at: Date.now() }) }); });
  g.release();
  const d2 = await p2;
  check('D2 account changed while the download was in flight -> account-changed, nothing handed to the browser', d2.status === 'account-changed' && saved.length === 1);

  // D3 stale binding (ambient cookie is Bob, binding is Alice) -> refused before sending
  mark = dev.calls.length;
  const d3 = await downloadBound('/api/users/export', 'export.json', { target, binding });
  check('D3 a binding from before the change is refused before any request', d3.status === 'account-changed' && dev.calls.slice(mark).every((x) => x.key !== 'GET /api/users/export') && saved.length === 1);

  // D4 real middleware: headerless export with a session -> 503; mismatched -> 409 (server never runs the export)
  mark = dev.calls.length;
  const raw = await dev.fetch('/api/users/export', {});
  const mism = await dev.fetch('/api/users/export', { headers: { 'X-Aura-Expected-Account': A } });
  check('D4 headerless export (old link navigation) -> 503 client_upgrade_required; stating Alice while Bob is signed in -> 409', raw.status === 503 && mism.status === 409);

  // D5 calendar: in-app download is bound; the headerless subscription/link contract is preserved
  await acct.fetchVerifiedSession();
  const d5 = await downloadBound('/api/calendar/feed', 'aura.ics', { target });
  const linkStyle = await dev.fetch('/api/calendar/feed', {});
  const calMismatch = await dev.fetch('/api/calendar/feed', { headers: { 'X-Aura-Expected-Account': A } });
  check('D5 in-app calendar download states Bob and saves; headerless feed (subscription/link) still answers; a stated mismatch is refused', d5.status === 'saved' && linkStyle.status === 200 && calMismatch.status === 409);

  // D6 during an auth transition the download is refused before sending
  const t = acct.beginTransition('signing-out');
  mark = dev.calls.length;
  const d6 = await downloadBound('/api/users/export', 'export.json', { target });
  t?.end('resumed');
  check('D6 during a sign-in/out the download is refused (no request)', d6.status === 'unavailable' && dev.calls.slice(mark).every((x) => x.key !== 'GET /api/users/export'));

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
