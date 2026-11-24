/**
 * AURA-ANDROID-REL-04 IR-01/IR-03 -- shared integration harness.
 *
 * SYNTHETIC ONLY. No database, network, real account or credential:
 *  - the REAL route handlers for POST /api/auth/logout, GET /api/auth/session,
 *    GET/POST /api/habit-logs and POST /api/plans run in-process, over an
 *    in-memory stub of lib/db (any unexpected db call is recorded and throws);
 *  - a fake DEVICE holds one cookie jar (shared by all its tabs), attaches the
 *    cookie when a request is SENT (like a browser), applies Set-Cookie, honours
 *    `redirect: 'error'` and AbortSignal, and can hold requests (before or
 *    after the server processed them) or inject faults;
 *  - a fault-injecting localStorage is shared by every tab and delivers
 *    `storage` events for the account-transition key to the OTHER tabs;
 *  - each TAB is a separate instance of the real client modules
 *    (lib/accountSession, activitySync, signOut, offlineHabitQueue).
 *
 * Session tokens are minted with the real lib/auth.ts (dev secret), exactly
 * what POST /api/auth/verify-code issues.
 */
import * as path from 'path';

process.env.NODE_ENV = 'test';
delete process.env.AUTH_SECRET;

const Module = require('module');
export const WEB = path.join(__dirname, '..', 'apps', 'web');
const webPath = (...p: string[]) => path.join(WEB, ...p);

// ---------------------------------------------------------------- storage
export class FaultyStorage {
  data = new Map<string, string>();
  fail = { get: false, set: false, remove: false };
  onMutate: Array<(key: string, value: string | null) => void> = [];
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { if (this.fail.get) throw new Error('SecurityError: storage read denied'); return this.data.has(k) ? this.data.get(k)! : null; }
  setItem(k: string, v: string) { if (this.fail.set) throw new Error('QuotaExceededError'); this.data.set(k, String(v)); this.emit(k, String(v)); }
  removeItem(k: string) { if (this.fail.remove) throw new Error('SecurityError: storage write denied'); this.data.delete(k); this.emit(k, null); }
  clear() { this.data.clear(); }
  private emit(k: string, v: string | null) { for (const f of this.onMutate) queueMicrotask(() => f(k, v)); }
}
export const storage = new FaultyStorage();
(global as any).localStorage = storage;

// ---------------------------------------------------------------- server store + db stub
export interface StoredUser { id: string; email: string; cityName: string; latitude: number; longitude: number; timezone: string; locationConfirmedAt: string; onboardingResolvedAt: string }
export const store = {
  users: new Map<string, StoredUser>(),
  logs: [] as Array<{ id: string; userId: string; clientRequestId: string | null; activityTitle: string; logTimestamp: string; createdAt: string; activeWindow: string }>,
  dbCalls: [] as string[],
};
let seq = 0;
export function addUser(id: string, email: string) {
  store.users.set(id, { id, email, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata', locationConfirmedAt: '2026-01-01T00:00:00.000Z', onboardingResolvedAt: '2026-01-01T00:00:00.000Z' });
}
export function resetStore() { store.logs.length = 0; store.dbCalls.length = 0; }
export const logsOf = (userId: string) => store.logs.filter((l) => l.userId === userId);

(function installDbStub() {
  const resolved = require.resolve(webPath('lib', 'db'));
  const impl: Record<string, any> = {
    INSIGHTS_HISTORY_DAYS: 90,
    getUserById: async (id: string) => store.users.get(id) ?? null,
    recordVisit: async () => {},
    getHabitLogByClientRequestId: async (userId: string, crid: string) => store.logs.find((l) => l.userId === userId && l.clientRequestId === crid) ?? null,
    createHabitLog: async (row: any) => {
      const e = { id: `log-${++seq}`, userId: row.userId, clientRequestId: row.clientRequestId ?? null, activityTitle: row.activityTitle, activeWindow: row.activeWindow, logTimestamp: new Date(row.logTimestamp).toISOString(), createdAt: new Date().toISOString() };
      store.logs.push(e);
      return e;
    },
    listHabitLogsForInsights: async (userId: string) => store.logs.filter((l) => l.userId === userId),
  };
  const proxy = new Proxy(impl, {
    get(target, key) {
      if (typeof key === 'symbol') return undefined;
      if (key === '__esModule') return true;
      if (key in target) {
        const v = target[key];
        return typeof v === 'function' ? (...a: unknown[]) => { store.dbCalls.push(key); return v(...a); } : v;
      }
      return (..._a: unknown[]) => { store.dbCalls.push(key); throw new Error(`unexpected db call ${key}`); };
    },
  });
  const m = new Module(resolved);
  m.filename = resolved; m.loaded = true; m.exports = proxy;
  require.cache[resolved] = m;
})();

const auth = require(webPath('lib', 'auth'));
const { NextRequest } = require(require.resolve('next/server', { paths: [webPath('app', 'api', 'habit-logs')] }));
export type RouteHandler = (req: any) => Promise<Response>;
export const routes: Record<string, RouteHandler> = {
  'POST /api/auth/logout': () => require(webPath('app', 'api', 'auth', 'logout', 'route')).POST(),
  'GET /api/auth/session': (req) => require(webPath('app', 'api', 'auth', 'session', 'route')).GET(req),
  'POST /api/habit-logs': (req) => require(webPath('app', 'api', 'habit-logs', 'route')).POST(req),
  'GET /api/habit-logs': (req) => require(webPath('app', 'api', 'habit-logs', 'route')).GET(req),
  'POST /api/plans': (req) => require(webPath('app', 'api', 'plans', 'route')).POST(req),
};

// ---------------------------------------------------------------- device (browser cookie jar + network)
type Fault = 'network-before' | 'network-after' | 'redirect' | 'html200' | 'json500' | 'json200-wrong';
interface Gate { key: string; phase: 'before' | 'after'; release: () => void; promise: Promise<void>; arrived: Promise<void>; markArrived: () => void }
export interface CallRecord { key: string; expected: string | null; sessionUser: string | null; status: number | 'network-error' | 'aborted' | 'pending'; processed: boolean }

function abortError() { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; return e; }

export class Device {
  cookie: string | null = null;
  calls: CallRecord[] = [];
  private gates: Gate[] = [];
  private faults: Array<{ key: string; mode: Fault }> = [];
  /** Responses for dashboard endpoints the harness does not route (path -> body or fn). */
  extra: Record<string, (sessionUser: string | null) => unknown> = {};

  signIn(userId: string) { this.cookie = auth.createSessionToken(userId, store.users.get(userId)!.email); }
  sessionUser(token = this.cookie): string | null { return token ? auth.verifySessionToken(token)?.userId ?? null : null; }

  hold(method: string, pathname: string, phase: 'before' | 'after' = 'before') {
    let release!: () => void, markArrived!: () => void;
    const promise = new Promise<void>((r) => { release = r; });
    const arrived = new Promise<void>((r) => { markArrived = r; });
    const g: Gate = { key: `${method} ${pathname}`, phase, release, promise, arrived, markArrived };
    this.gates.push(g);
    return g;
  }
  fault(method: string, pathname: string, mode: Fault) { this.faults.push({ key: `${method} ${pathname}`, mode }); }
  count(method: string, pathname: string, filter: (c: CallRecord) => boolean = () => true) {
    return this.calls.filter((c) => c.key === `${method} ${pathname}` && filter(c)).length;
  }

  fetch = async (input: unknown, init: any = {}): Promise<Response> => {
    const method = String(init.method ?? 'GET').toUpperCase();
    const url = new URL(String(input), 'http://localhost');
    const key = `${method} ${url.pathname}`;
    const signal: AbortSignal | undefined = init.signal;
    const headers = new Headers(init.headers ?? {});
    const cookieAtSend = this.cookie;
    if (cookieAtSend) headers.set('cookie', `as_session=${cookieAtSend}`);
    const rec: CallRecord = { key, expected: headers.get('x-aura-expected-account'), sessionUser: this.sessionUser(cookieAtSend), status: 'pending', processed: false };
    this.calls.push(rec);
    if (signal?.aborted) { rec.status = 'aborted'; throw abortError(); }

    const fi = this.faults.findIndex((f) => f.key === key);
    const fault = fi >= 0 ? this.faults.splice(fi, 1)[0].mode : null;
    if (fault === 'network-before') { rec.status = 'network-error'; throw new TypeError('Failed to fetch'); }

    const before = this.takeGate(key, 'before');
    if (before) {
      before.markArrived();
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { rec.status = 'aborted'; reject(abortError()); };
        signal?.addEventListener('abort', onAbort, { once: true });
        before.promise.then(() => { signal?.removeEventListener('abort', onAbort); resolve(); });
      });
    }
    if (fault === 'redirect') {
      if (init.redirect === 'error') { rec.status = 'network-error'; throw new TypeError('Failed to fetch: redirect'); }
      rec.status = 302; return new Response(null, { status: 302, headers: { location: '/' } });
    }
    if (fault === 'html200') { rec.status = 200; return new Response('<html>Wi-Fi sign-in</html>', { status: 200, headers: { 'content-type': 'text/html' } }); }
    if (fault === 'json500') { rec.status = 500; return Response.json({ error: 'boom' }, { status: 500 }); }
    if (fault === 'json200-wrong') { rec.status = 200; return Response.json({ ok: true }, { status: 200 }); }

    const req = new NextRequest(url.toString(), { method, headers, body: init.body });
    const handler = routes[key];
    let res: Response;
    if (handler) res = await handler(req);
    else {
      const fn = this.extra[url.pathname];
      res = Response.json(fn ? fn(rec.sessionUser) : {}, { status: 200 });
    }
    rec.processed = true;
    rec.status = res.status;
    const sc = res.headers.get('set-cookie');
    const m = sc ? /(?:^|,\s*)as_session=([^;]*)/.exec(sc) : null;
    if (m) this.cookie = m[1] === '' || /Max-Age=0/i.test(sc!) ? null : m[1];

    const after = this.takeGate(key, 'after');
    if (after) { after.markArrived(); await after.promise; }
    if (fault === 'network-after') { rec.status = 'network-error'; throw new TypeError('Failed to fetch'); }
    if (signal?.aborted) throw abortError();
    return res;
  };

  private takeGate(key: string, phase: 'before' | 'after') {
    const i = this.gates.findIndex((g) => g.key === key && g.phase === phase);
    return i >= 0 ? this.gates.splice(i, 1)[0] : null;
  }
}

// ---------------------------------------------------------------- tabs (separate module instances)
const LIB = ['accountSession', 'offlineHabitQueue', 'habitLogSyncPolicy', 'activitySync', 'signOut'].map((n) => require.resolve(webPath('lib', n)));
export interface Tab {
  id: string;
  acct: typeof import('../apps/web/lib/accountSession');
  sync: typeof import('../apps/web/lib/activitySync');
  so: typeof import('../apps/web/lib/signOut');
  q: typeof import('../apps/web/lib/offlineHabitQueue');
}
const tabs: Tab[] = [];
storage.onMutate.push((key, value) => {
  if (key !== 'aura_account_transition_v1') return;
  for (const t of tabs) t.acct.__deliverStorageEventForTests({ key, newValue: value });
});
/** A fresh tab: new instances of the client modules sharing this device's storage. */
export function openTab(id: string): Tab {
  for (const r of LIB) delete require.cache[r];
  const acct = require(LIB[0]);
  const q = require(LIB[1]);
  require(LIB[2]);
  const sync = require(LIB[3]);
  const so = require(LIB[4]);
  acct.__resetAccountSessionForTests(id);
  const t: Tab = { id, acct, sync, so, q };
  tabs.push(t);
  return t;
}
export function closeAllTabs() { tabs.length = 0; }

// ---------------------------------------------------------------- misc
export const tick = (n = 3) => new Promise<void>(async (r) => { for (let i = 0; i < n; i++) await new Promise((x) => setImmediate(x)); r(); });
let passed = 0, failed = 0;
export function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }
export function finish() { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }
export function payload(title: string, crid: string) {
  return { activityTitle: title, activeWindow: 'NEUTRAL', logTimestamp: '2026-11-24T06:00:00.000Z', durationMinutes: 30, logSource: 'MANUAL' as const, activitySignificance: 'MEDIUM' as const, clientRequestId: crid };
}
