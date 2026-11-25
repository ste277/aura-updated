/**
 * AURA-ANDROID-REL-04 IR-01 (R3) -- the shared account boundary across every
 * authenticated surface: route inventory, middleware policy, the client
 * wrapper's unknown-account and failed-verification behaviour, and the
 * standalone Goals, Captures and Connected Apps surfaces mounted with their
 * AccountScoped boundary (real components, real middleware + harness routes).
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04R3BoundaryJsdom.test.ts
 */
import { React, mount, flush, act } from './jsdomReactHarness';
import * as fs from 'fs';
import * as path from 'path';
import { Device, WEB, addUser, check, finish, store } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');

const policy = require(path.join(WEB, 'lib', 'accountRoutePolicy'));
const mw = require(path.join(WEB, 'middleware'));
const auth = require(path.join(WEB, 'lib', 'auth'));
const { NextRequest } = require(require.resolve('next/server', { paths: [path.join(WEB, 'app', 'api', 'habit-logs')] }));

const dev = new Device();
dev.extra['/api/goals'] = (u) => (u === A ? [{ id: 'g-a', title: 'AliceGoal', status: 'ACTIVE' }] : [{ id: 'g-b', title: 'BobGoal', status: 'ACTIVE' }]);
dev.extra['/api/captures'] = (u) => (u === A ? [{ id: 'c-a', title: 'AliceCapture' }] : [{ id: 'c-b', title: 'BobCapture' }]);
dev.extra['/api/mcp/connections'] = (u) => ({ connections: u === A ? [{ clientId: 'a-app', label: 'AliceApp', connectedAt: 1 }] : [{ clientId: 'b-app', label: 'BobApp', connectedAt: 1 }] });
(global as any).fetch = dev.fetch;
(window as any).fetch = dev.fetch;
let reloads = 0;

const acct = require(path.join(WEB, 'lib', 'accountSession'));
require(path.join(WEB, 'app', 'AccountBoundaryRoot')); // installs the boundary (as the root layout does)
const { AccountScoped, pageReload } = require(path.join(WEB, 'components', 'AccountScoped'));
pageReload.fn = () => { reloads++; };
const { GoalsListClient } = require(path.join(WEB, 'app', 'goals', 'GoalsListClient'));
const { CapturesClient } = require(path.join(WEB, 'app', 'captures', 'CapturesClient'));
const { ConnectedAppsClient } = require(path.join(WEB, 'app', 'connect', 'apps', 'ConnectedAppsClient'));

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await flush(); };
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');
const callsTo = (p: string) => dev.calls.filter((c) => c.key.endsWith(` ${p}`) || c.key.split(' ')[1].startsWith(p));

async function main() {
  // ---------------------------------------------------------------- B1 route inventory
  const routeFiles: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === 'route.ts') routeFiles.push(full);
    }
  })(path.join(WEB, 'app', 'api'));
  const inventory = routeFiles.map((f) => {
    const p = '/api/' + path.relative(path.join(WEB, 'app', 'api'), path.dirname(f)).split(path.sep).map((seg) => (seg.startsWith('[') ? 'x' : seg)).join('/');
    const src = fs.readFileSync(f, 'utf8');
    const methods = (src.match(/export (?:async function|const) (GET|POST|PATCH|PUT|DELETE)\b/g) ?? []).map((m) => m.split(' ').pop()!);
    const session = /getSessionFromRequest|sessionUserFromCookie|SESSION_COOKIE_NAME/.test(src);
    return { p, methods, session, classes: methods.map((m) => policy.classifyApiRoute(p, m)) };
  });
  const exemptSessionRoutes = inventory.filter((r) => r.session && r.classes.some((c: string) => c === 'exempt'));
  const allowedExemptSession = ['/api/auth/', '/api/location/', '/api/calendar/feed', '/api/users/export'];
  check(`B1 inventory: ${inventory.length} API route files, each classified`, inventory.length >= 80 && inventory.every((r) => r.classes.length === r.methods.length));
  check('B1 every session-authenticated route is account-scoped, except the justified, listed exemptions', exemptSessionRoutes.every((r) => allowedExemptSession.some((a) => r.p.startsWith(a))));
  check('B1 Connected Apps management (/api/mcp/connections) is account-scoped; the MCP protocol endpoint stays exempt', policy.classifyApiRoute('/api/mcp/connections', 'GET') === 'account' && policy.classifyApiRoute('/api/mcp', 'POST') === 'exempt');
  check('B1 Goals, Captures, plans, habit logs, people, users settings are account-scoped', ['/api/goals', '/api/goals/x', '/api/captures', '/api/plans', '/api/habit-logs', '/api/people', '/api/users/location'].every((p) => policy.classifyApiRoute(p, 'POST') === 'account' && policy.classifyApiRoute(p, 'GET') === 'account'));
  check('B1 every exemption carries a written reason', policy.ROUTE_RULES.every((r: any) => typeof r.reason === 'string' && r.reason.length > 20));
  const exportPost = policy.classifyApiRoute('/api/users/export', 'POST');
  check('B1 navigation-download exemptions are GET-only', exportPost === 'account' && policy.classifyApiRoute('/api/calendar/feed', 'POST') === 'account');

  // ---------------------------------------------------------------- B2 middleware policy
  const req = (method: string, url: string, cookieUser: string | null, headers: Record<string, string> = {}) => {
    const h = new Headers(headers);
    if (cookieUser) h.set('cookie', `as_session=${auth.createSessionToken(cookieUser, store.users.get(cookieUser)!.email)}`);
    return new NextRequest(`http://localhost${url}`, { method, headers: h });
  };
  const passes = (r: Response) => r.headers.get('x-middleware-next') === '1';
  check('B2 headerless account-scoped read WITH a session -> 503 client_upgrade_required', (await mw.middleware(req('GET', '/api/goals', A))).status === 503);
  check('B2 "signed out" statement while a session exists -> 409 account_mismatch', (await mw.middleware(req('GET', '/api/captures', A, { 'X-Aura-Expected-Account': policy.SIGNED_OUT_ACCOUNT }))).status === 409);
  check('B2 stated account matches -> passes to the route', passes(await mw.middleware(req('GET', '/api/goals', A, { 'X-Aura-Expected-Account': A }))));
  check('B2 no cookie -> passes (the route answers 401)', passes(await mw.middleware(req('GET', '/api/goals', null))));
  check('B2 exempt routes pass headerless (auth, guest, location, calendar feed / export downloads)', [req('POST', '/api/auth/verify-code', A), req('POST', '/api/guest/timing-search', A), req('GET', '/api/location/search', A), req('GET', '/api/calendar/feed', A), req('GET', '/api/users/export', A)].every(() => true) && (await Promise.all([mw.middleware(req('POST', '/api/auth/verify-code', A)), mw.middleware(req('POST', '/api/guest/timing-search', A)), mw.middleware(req('GET', '/api/location/search', A)), mw.middleware(req('GET', '/api/calendar/feed', A)), mw.middleware(req('GET', '/api/users/export', A))])).every(passes));
  check('B2 telemetry (optional): headerless passes, a mismatched statement is refused', passes(await mw.middleware(req('POST', '/api/product-events', A))) && (await mw.middleware(req('POST', '/api/product-events', A, { 'X-Aura-Expected-Account': B }))).status === 409);

  // ---------------------------------------------------------------- B3 unknown account: verify before forwarding; never forward on failure
  dev.signIn(A);
  acct.__resetAccountSessionForTests('tab');
  const before = dev.calls.length;
  await (window as any).fetch('/api/goals?status=ACTIVE');
  const seq = dev.calls.slice(before).map((c) => `${c.key}|${c.expected}`);
  check('B3 with the account UNKNOWN, a read first verifies the session, then states the verified account', seq[0]?.startsWith('GET /api/auth/session') && seq[1] === `GET /api/goals|${A}`);
  acct.__resetAccountSessionForTests('tab');
  dev.fault('GET', '/api/auth/session', 'network-before');
  const b2 = dev.calls.length;
  let refused = '';
  try { await (window as any).fetch('/api/goals?status=ACTIVE'); } catch (e: any) { refused = e?.reason; }
  check('B3 if verification fails, the request is REFUSED and never forwarded', refused === 'unverified' && dev.calls.slice(b2).every((c) => !c.key.startsWith('GET /api/goals')));

  // ---------------------------------------------------------------- B4 signed-out tab, session appears elsewhere
  dev.cookie = null;
  acct.__resetAccountSessionForTests('tab');
  await acct.fetchVerifiedSession();
  dev.signIn(B); // another tab signed in; this tab believes "signed out"
  const r4 = await (window as any).fetch('/api/captures');
  await settle(2);
  check('B4 a tab that believes "signed out" states it; the server refuses B\'s data (409) and the tab re-verifies', r4.status === 409 && acct.getVerifiedAccount() === undefined);

  // ---------------------------------------------------------------- B5 mounted standalone surfaces
  dev.signIn(A);
  acct.__resetAccountSessionForTests('tab');
  for (const [name, el, reloadMode] of [
    ['Goals', React.createElement(AccountScoped, { onChange: 'reload' }, React.createElement(GoalsListClient, { authenticated: true })), true],
    ['Captures', React.createElement(AccountScoped, { onChange: 'reload' }, React.createElement(CapturesClient, { authenticated: true })), true],
    ['Connected Apps', React.createElement(AccountScoped, null, React.createElement(ConnectedAppsClient)), false],
  ] as const) {
    dev.signIn(A);
    acct.__resetAccountSessionForTests('tab');
    reloads = 0;
    const mark = dev.calls.length;
    const h = await mount(el as any);
    await settle(14);
    const c = h.container as HTMLElement;
    const sent = dev.calls.slice(mark).filter((x) => /\/api\/(goals|captures|mcp\/connections)/.test(x.key));
    check(`B5 ${name}: every account-scoped request states the verified account A`, sent.length > 0 && sent.every((x) => x.expected === A));
    check(`B5 ${name}: shows A's data`, /Alice/.test(text(c)));
    // The account changes in another tab (announced).
    dev.signIn(B);
    await act(async () => { acct.__deliverStorageEventForTests({ key: 'aura_account_announce_v2', newValue: JSON.stringify({ account: B, tab: 'other', at: Date.now() }) }); });
    await settle(14);
    if (reloadMode) check(`B5 ${name}: the server-rendered page reloads on the account change (fresh render for the current account)`, reloads === 1);
    else check(`B5 ${name}: remounts and shows only B's data`, /Bob/.test(text(c)) && !/Alice/.test(text(c)));
    await h.unmount();
  }

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
