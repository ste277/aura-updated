/**
 * AURA-AUTH-SESSION-01-I2-R1 (39247) F5 / F6 -- client authentication state
 * around logout and session-store outages.
 *
 * F5: the Home sign-out fence (lib/sessionClient.ts createAuthFence) mounted
 *     in a real React 18 component that wires it exactly as app/page.tsx does
 *     (refresh -> ticket -> apply only while current; sign-out start / end),
 *     with deferred fetches the test resolves in chosen orders; plus a source
 *     guard that app/page.tsx wires it that way.
 * F6: the REAL /find client (GuestFindClient) mounted after a 503 session
 *     check: it must never take the guest path or the signed-in path on an
 *     unknown session, and must re-check before deciding.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/authSessionI2R1ClientJsdom.test.ts
 */
import { React, mount, click, flush, act } from './jsdomReactHarness';
import * as fs from 'fs';
import * as path from 'path';

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, note: unknown = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && note !== '' ? ' -- ' + JSON.stringify(note) : ''}`);
  if (ok) passes++;
  else failures++;
}
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const { createAuthFence, fetchSessionBootstrap, signOutDurably } = require('../apps/web/lib/sessionClient');

// ---------------------------------------------------------------- F5 -------------------
type Fetch = (url: string, init?: { method?: string }) => Promise<ReturnType<typeof res>>;
let routeFetch: Fetch = async () => res(200, {});

/** Mirrors app/page.tsx: loadUserDataAndLogs + handleLogout with the real fence and helpers. */
function HomeAuthProbe(props: { expose: (api: { refresh(): Promise<void>; logout(): Promise<void> }) => void }) {
  const [user, setUser] = React.useState(undefined as undefined | null | { id: string });
  const [plans, setPlans] = React.useState([] as string[]);
  const [error, setError] = React.useState(null as string | null);
  const fence = React.useRef(createAuthFence());
  const refresh = React.useCallback(async () => {
    const ticket = fence.current.begin();
    if (ticket === null) return;
    const current = () => fence.current.isCurrent(ticket);
    const boot = await fetchSessionBootstrap((u: string, i: unknown) => routeFetch(u, i as never));
    if (!current()) return;
    if (boot.kind === 'unknown') return;
    if (boot.kind === 'signed_out') {
      setUser(null);
      setPlans([]);
      return;
    }
    setUser(boot.data.user);
    const plansRes = await routeFetch('/api/plans');
    if (!current()) return;
    const list = await plansRes.json();
    if (!current()) return;
    setPlans(list as string[]);
  }, []);
  const logout = React.useCallback(async () => {
    if (fence.current.signingOut) return;
    fence.current.startSignOut();
    let outcome = 'failed';
    try {
      outcome = await signOutDurably((u: string, i: unknown) => routeFetch(u, i as never), async () => undefined);
    } finally {
      fence.current.endSignOut();
    }
    if (outcome === 'signed_out') {
      setUser(null);
      setPlans([]);
    } else {
      setError('failed');
      refresh();
    }
  }, [refresh]);
  React.useEffect(() => {
    props.expose({ refresh, logout });
  }, [refresh, logout]);
  return React.createElement('div', { 'data-user': user === undefined ? 'undefined' : user === null ? 'null' : user.id, 'data-plans': plans.join(','), 'data-error': error ?? '' });
}

async function f5() {
  let api!: { refresh(): Promise<void>; logout(): Promise<void> };
  const h = await mount(React.createElement(HomeAuthProbe, { expose: (a: typeof api) => (api = a) }));
  const el = () => h.container.firstElementChild as HTMLElement;
  const state = () => ({ user: el().dataset.user, plans: el().dataset.plans, error: el().dataset.error });

  // Sign in (initial refresh).
  routeFetch = async (u) => (u === '/api/auth/session' ? res(200, { user: { id: 'u1' } }) : res(200, ['p1']));
  await act(async () => api.refresh());
  check('F5-0 control: a refresh signs in and loads plans', state().user === 'u1' && state().plans === 'p1', state());

  // F5-1 stale refresh in flight BEFORE logout resolves AFTER a confirmed logout.
  const stale = deferred<ReturnType<typeof res>>();
  routeFetch = async (u) => (u === '/api/auth/session' ? stale.promise : res(200, ['p-stale']));
  let refreshDone!: Promise<void>;
  await act(async () => {
    refreshDone = api.refresh();
  });
  routeFetch = async (u) => (u === '/api/auth/logout' ? res(200, { ok: true }) : res(200, ['p-late']));
  await act(async () => api.logout());
  check('F5-1a confirmed logout signs out', state().user === 'null' && state().plans === '', state());
  stale.resolve(res(200, { user: { id: 'u1' } }));
  await act(async () => refreshDone);
  await flush();
  check('F5-1b a refresh begun before the logout cannot restore the signed-in state afterwards', state().user === 'null' && state().plans === '', state());

  // F5-2 a refresh started DURING the logout is paused (never even fetches).
  await act(async () => api.refresh());
  routeFetch = async (u) => (u === '/api/auth/session' ? res(200, { user: { id: 'u1' } }) : res(200, ['p1']));
  await act(async () => api.refresh());
  const slowLogout = deferred<ReturnType<typeof res>>();
  const seen: string[] = [];
  routeFetch = async (u) => {
    seen.push(u);
    if (u === '/api/auth/logout') return slowLogout.promise;
    return u === '/api/auth/session' ? res(200, { user: { id: 'u1' } }) : res(200, ['p-during']);
  };
  let loggingOut!: Promise<void>;
  await act(async () => {
    loggingOut = api.logout();
  });
  await act(async () => api.refresh());
  check('F5-2a no authenticated refresh starts while a sign-out is in flight', !seen.includes('/api/auth/session') && !seen.includes('/api/plans'), seen);
  slowLogout.resolve(res(200, { ok: true }));
  await act(async () => loggingOut);
  check('F5-2b logout completes signed out', state().user === 'null', state());

  // F5-3 logout 503 twice (unknown outcome): stays signed in, error shown, one retry, then re-checks.
  routeFetch = async (u) => (u === '/api/auth/session' ? res(200, { user: { id: 'u1' } }) : res(200, ['p1']));
  await act(async () => api.refresh());
  const calls: string[] = [];
  const stale3 = deferred<ReturnType<typeof res>>();
  routeFetch = async (u) => (u === '/api/auth/session' ? stale3.promise : res(200, ['p-stale3']));
  let refresh3!: Promise<void>;
  await act(async () => {
    refresh3 = api.refresh();
  });
  routeFetch = async (u) => {
    calls.push(u);
    if (u === '/api/auth/logout') return res(503, { error: 'unavailable' });
    return u === '/api/auth/session' ? res(200, { user: { id: 'u1' } }) : res(200, ['p-fresh']);
  };
  await act(async () => api.logout());
  await flush();
  check('F5-3a logout 503 x2: still signed in, failure shown, exactly one automatic retry', state().user === 'u1' && state().error === 'failed' && calls.filter((c) => c === '/api/auth/logout').length === 2, { state: state(), calls });
  check('F5-3b after the failed sign-out the page re-checks (fresh ticket) and is current', calls.includes('/api/auth/session') && state().plans === 'p-fresh', { state: state(), calls });
  // The stale refresh would now load stale data if it were allowed to continue.
  routeFetch = async (u) => (u === '/api/auth/session' ? res(200, { user: { id: 'u1' } }) : res(200, ['p-stale3']));
  stale3.resolve(res(200, { user: { id: 'u1' } }));
  await act(async () => refresh3);
  await flush();
  check('F5-3c a refresh begun before the failed sign-out is still fenced off (no stale overwrite)', state().plans === 'p-fresh', state());

  // F5-4 re-authentication after a confirmed logout works (fresh ticket).
  routeFetch = async (u) => (u === '/api/auth/logout' ? res(200, { ok: true }) : res(200, []));
  await act(async () => api.logout());
  routeFetch = async (u) => (u === '/api/auth/session' ? res(200, { user: { id: 'u2' } }) : res(200, ['p2']));
  await act(async () => api.refresh());
  check('F5-4 re-authentication after logout signs the new session in', state().user === 'u2' && state().plans === 'p2', state());

  // F5-5 a 503 session check during normal use keeps state (unknown, not signed out).
  routeFetch = async () => res(503, { error: 'unavailable' });
  await act(async () => api.refresh());
  check('F5-5 a 503 refresh is unknown: the signed-in state and data are kept', state().user === 'u2' && state().plans === 'p2', state());
  await h.unmount();

  // Source guard: app/page.tsx wires the same fence.
  const page = fs.readFileSync(path.join(__dirname, '../apps/web/app/page.tsx'), 'utf8');
  const load = page.slice(page.indexOf('const loadUserDataAndLogs = useCallback'), page.indexOf('}, [applyConfirmedLogs]);'));
  const logoutAt = page.indexOf('const handleLogout = useCallback');
  const logout = page.slice(logoutAt, page.indexOf('}, [loadUserDataAndLogs]);', logoutAt));
  const awaits = (load.match(/\bawait\b/g) ?? []).length;
  const guards = (load.match(/if \(!current\(\)\) return;/g) ?? []).length;
  check('F5-6 app/page.tsx: Home refresh takes a fence ticket and re-checks it after every await', /authFenceRef\.current\.begin\(\)/.test(load) && /if \(ticket === null\) return;/.test(load) && guards >= awaits && awaits >= 4, { awaits, guards });
  check('F5-7 app/page.tsx: sign-out starts and (in finally) ends the fence', /authFenceRef\.current\.startSignOut\(\)/.test(logout) && /finally\s*{\s*authFenceRef\.current\.endSignOut\(\)/.test(logout));
}

// ---------------------------------------------------------------- F6 -------------------
async function f6() {
  let session: () => ReturnType<typeof res> = () => res(503, { error: 'Session verification is temporarily unavailable.' });
  const calls: string[] = [];
  (global as any).fetch = (url: string) => {
    calls.push(url);
    if (url === '/api/auth/session') return Promise.resolve(session());
    return Promise.resolve(res(200, {}));
  };
  // jsdom cannot navigate; it reports each attempted navigation (window.location.href = ...)
  // as a "Not implemented: navigation" error on the console -- counted here.
  const navigations: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
    if (/Not implemented: navigation/.test(msg)) navigations.push('navigation');
    else realError(...(args as []));
  };
  const { GuestFindClient } = require('../apps/web/app/find/GuestFindClient');
  const h = await mount(React.createElement(GuestFindClient, { initialSource: 'DIRECT', initialRestoreToken: null }));
  await flush();
  const c = h.container as HTMLElement;
  const text = () => (c.textContent ?? '').replace(/\s+/g, ' ');
  const chip = () => ([...c.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => /Workout/.test(b.textContent ?? ''))!;
  const inDetails = () => !/What are you planning\?/.test(text());

  check('F6-0 a 503 session check still shows the picker (no sign-in prompt, nothing decided)', /What are you planning\?/.test(text()) && !c.querySelector('[data-testid=find-session-unknown]'));
  const before = calls.filter((u) => u === '/api/auth/session').length;
  await click(chip());
  await flush();
  check('F6-1 choosing an activity on an UNKNOWN session re-checks the session first', calls.filter((u) => u === '/api/auth/session').length === before + 1, calls);
  check('F6-2 still unknown: neither the guest path (details) nor the signed-in Plan route is taken', !inDetails() && navigations.length === 0, { navigations, text: text().slice(0, 120) });
  check('F6-3 still unknown: an explicit "couldn\'t check" notice is shown', !!c.querySelector('[data-testid=find-session-unknown]'));

  session = () => res(200, { user: { id: 'u1' } });
  await click(chip());
  await flush();
  check('F6-4 the session recovers as SIGNED IN: routed to the signed-in Plan flow, never guest search', !inDetails() && navigations.length === 1 && !c.querySelector('[data-testid=find-session-unknown]'), { navigations });
  await h.unmount();

  // A fresh mount where the recovered answer is a definitive signed-out: only then the guest path.
  session = () => res(503, {});
  navigations.length = 0;
  const h2 = await mount(React.createElement(GuestFindClient, { initialSource: 'DIRECT', initialRestoreToken: null }));
  await flush();
  const c2 = h2.container as HTMLElement;
  session = () => res(200, { user: null });
  const chip2 = ([...c2.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => /Workout/.test(b.textContent ?? ''))!;
  await click(chip2);
  await flush();
  check('F6-5 a definitive { user: null } after the outage: the guest path (details) is taken', !/What are you planning\?/.test(c2.textContent ?? '') && navigations.length === 0, { navigations });
  await h2.unmount();
  console.error = realError;

  const src = fs.readFileSync(path.join(__dirname, '../apps/web/app/find/GuestFindClient.tsx'), 'utf8');
  const save = src.slice(src.indexOf('const handleSaveClick = async'), src.indexOf('const performSave = async'));
  check('F6-6 the save path resolves the session state before guest signup / signed-in save', /await resolveAuthState\(\)/.test(save) && /if \(auth === null\) return;/.test(save) && save.indexOf('resolveAuthState') < save.indexOf("setPhase('SIGNUP')"));
  check('F6-7 /find reads the session through the shared helper (503 = unknown), no direct res.ok guess', /fetchSessionBootstrap\(/.test(src) && !/fetch\('\/api\/auth\/session'\)/.test(src));
}

(async () => {
  await f5();
  await f6();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
