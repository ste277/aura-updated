/**
 * AURA-AUTH-SESSION-01-I2 -- end-to-end session integration against a
 * DISPOSABLE loopback PostgreSQL (synthetic users and codes only). Real route
 * handlers, real NextRequest / NextResponse objects, real AuthSession rows.
 *
 *   DATABASE_URL=postgresql://...127.0.0.1.../x npx ts-node test/authSessionI2Db.test.ts
 *
 * Covers: sign-in issuance (transactional code consume + session, cookie
 * attributes, single use, concurrency), E3 bootstrap, E1 routes, account
 * isolation, tampering, v1 tokens (incl. signed with the CURRENT secret),
 * expiry by the database clock, token/row binding, logout D8 (durable,
 * idempotent, replay rejected, 503 keeps the cookie), B1 after logout, B3
 * share-lock ordering in both directions, E4 MCP consent helper, database
 * failure and timeout (503, never 401 / 200), production cookie contract,
 * 30-day expiry, and the daily cleanup in the cron route.
 */
import { NextRequest } from '../apps/web/node_modules/next/server';
import { Pool } from 'pg';
import { upsertUserByEmail, createAuthCode } from '../apps/web/lib/db';
import { hashAuthCode, sign, getAuthSecret } from '../apps/web/lib/auth';
import {
  activeSessionCookieName,
  closeSessionPool,
  getSessionFromCookieHeader,
  getSessionFromRequest,
  getSessionPool,
  setSessionCookie,
  setSessionPoolForTesting,
  withSessionShareLock,
  SESSION_UNAVAILABLE,
  type RequestSession,
} from '../apps/web/lib/session';
import { createSessionPool } from '../apps/web/lib/authSessionDb';
import { createAuthSession } from '../apps/web/lib/authSessionStore';
import { createSessionTokenV2, deriveSessionKey, generateSessionId, hashSessionId, verifySessionTokenV2 } from '../apps/web/lib/authSessionToken';
import { sessionUserFromCookie } from '../apps/web/lib/mcpLocalOAuth';
import { POST as verifyCode } from '../apps/web/app/api/auth/verify-code/route';
import { POST as logout } from '../apps/web/app/api/auth/logout/route';
import { GET as sessionRoute } from '../apps/web/app/api/auth/session/route';
import { GET as listCaptures, POST as postCapture } from '../apps/web/app/api/captures/route';
import { GET as cronDispatch } from '../apps/web/app/api/internal/reminders/dispatch/route';
import { startFaultProxy } from './authSessionFaultProxy';

const URL_ = process.env.DATABASE_URL!;
const host = new URL(URL_).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error('Refusing: DATABASE_URL must be a disposable loopback database.');
  process.exit(2);
}
const admin = new Pool({ connectionString: URL_, max: 3 });
const q = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows;

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, note: unknown = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${note !== '' && !ok ? ' -- ' + JSON.stringify(note) : ''}`);
  if (ok) passes++;
  else failures++;
}

const NAME = activeSessionCookieName();
const BASE = 'http://localhost:3000';
function req(path: string, opts: { method?: string; cookie?: string; cookies?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  const jar = { ...(opts.cookies ?? {}) };
  if (opts.cookie !== undefined) jar[NAME] = opts.cookie;
  const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (cookieHeader) headers.cookie = cookieHeader;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`${BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}
const setCookies = (res: Response) => (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
const cookieValue = (res: Response, name: string) => {
  const c = setCookies(res).find((x) => x.startsWith(name + '='));
  return c ? decodeURIComponent(c.slice(name.length + 1).split(';')[0]) : undefined;
};
const attrs = (res: Response, name: string) => (setCookies(res).find((x) => x.startsWith(name + '=')) ?? '').toLowerCase();

async function newCode(email: string, code = String(100000 + Math.floor(Math.random() * 899999))) {
  await q(`DELETE FROM "AuthCode" WHERE email = $1`, [email]);
  await createAuthCode({ email, codeHash: hashAuthCode(email, code), expiresAt: new Date(Date.now() + 10 * 60_000) });
  return code;
}
async function signIn(email: string): Promise<{ res: Response; token: string | undefined }> {
  const code = await newCode(email);
  const res = await verifyCode(req('/api/auth/verify-code', { method: 'POST', body: { email, code } }));
  return { res, token: cookieValue(res, NAME) };
}
const sessionUser = async (cookie?: string, cookies?: Record<string, string>) => {
  const res = await sessionRoute(req('/api/auth/session', { cookie, cookies }));
  return { status: res.status, body: (await res.json()) as { user?: { id: string } | null; error?: string }, res };
};
const key = deriveSessionKey(getAuthSecret());

async function main() {
  const A = await upsertUserByEmail({ email: 'i2-a@example.test', cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' });
  const B = await upsertUserByEmail({ email: 'i2-b@example.test', cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' });
  await q(`DELETE FROM "AuthSession" WHERE "userId" = ANY($1)`, [[A.id, B.id]]);
  await q(`DELETE FROM "Capture" WHERE "userId" = ANY($1)`, [[A.id, B.id]]);

  // --- S: sign-in issuance -------------------------------------------------------------
  const email = 'i2-a@example.test';
  const code = await newCode(email);
  const s1 = await verifyCode(req('/api/auth/verify-code', { method: 'POST', body: { email, code } }));
  const tokA = cookieValue(s1, NAME)!;
  check('S1 verify-code issues a session: 200 and a v2 cookie', s1.status === 200 && !!tokA && !!verifySessionTokenV2(key, tokA));
  const a1 = attrs(s1, NAME);
  check('S2 cookie: HttpOnly, SameSite=Lax, Path=/, no Domain (dev: as_sid, not Secure)', NAME === 'as_sid' && a1.includes('httponly') && a1.includes('samesite=lax') && a1.includes('path=/') && !a1.includes('domain=') && !a1.includes('secure'));
  const maxAge = Number((a1.match(/max-age=(\d+)/) ?? [])[1]);
  check('S3 Max-Age derives from the DB expiry (30 days, minus seconds)', maxAge > 30 * 86400 - 30 && maxAge <= 30 * 86400, maxAge);
  check('S4 legacy as_session is cleared at sign-in (Max-Age=0)', /max-age=0/.test(attrs(s1, 'as_session')));
  const rowsA = await q(`SELECT "idHash", "createdAt", "expiresAt", "revokedAt" FROM "AuthSession" WHERE "userId" = $1`, [A.id]);
  const claims = verifySessionTokenV2(key, tokA)!;
  check('S5 exactly one AuthSession row, keyed by sha256(sid) (raw sid not stored)', rowsA.length === 1 && rowsA[0].idHash === hashSessionId(claims.sid) && rowsA[0].idHash !== claims.sid);
  check('S6 fixed 30-day expiry: expiresAt - createdAt = 720 h exactly (DB-set)', rowsA[0].expiresAt.getTime() - rowsA[0].createdAt.getTime() === 720 * 3600_000);
  check('S7 the token exp is the row expiresAt', claims.exp === rowsA[0].expiresAt.getTime());
  const consumed = await q(`SELECT "consumedAt" FROM "AuthCode" WHERE email = $1`, [email]);
  check('S8 the code was consumed in the same transaction', consumed.length === 1 && consumed[0].consumedAt !== null);
  const replay = await verifyCode(req('/api/auth/verify-code', { method: 'POST', body: { email, code } }));
  check('S9 a consumed code is rejected (401, no cookie, no new row)', replay.status === 401 && !cookieValue(replay, NAME) && (await q(`SELECT 1 FROM "AuthSession" WHERE "userId" = $1`, [A.id])).length === 1);
  // concurrency: the same code submitted 6 times at once -> exactly one session
  const ccode = await newCode('i2-b@example.test');
  const burst = await Promise.all(Array.from({ length: 6 }, () => verifyCode(req('/api/auth/verify-code', { method: 'POST', body: { email: 'i2-b@example.test', code: ccode } }))));
  const okCount = burst.filter((r) => r.status === 200).length;
  const rowsB = await q(`SELECT 1 FROM "AuthSession" WHERE "userId" = $1`, [B.id]);
  check('S10 concurrent sign-ins with one code: exactly one 200 and one session row (others 401/429)', okCount === 1 && rowsB.length === 1 && burst.every((r) => [200, 401, 429].includes(r.status)), { okCount, rows: rowsB.length });
  const tokB = cookieValue(burst.find((r) => r.status === 200)!, NAME)!;

  // --- E3 / E1 / isolation ----------------------------------------------------------------
  const me = await sessionUser(tokA);
  check('E3-1 /api/auth/session returns the signed-in user (joined lookup)', me.status === 200 && me.body.user?.id === A.id);
  check('E3-2 /api/auth/session never sets the session cookie (B4)', !cookieValue(me.res, NAME));
  check('E3-3 no cookie -> { user: null }', (await sessionUser()).body.user === null);
  await postCapture(req('/api/captures', { method: 'POST', cookie: tokA, body: { title: 'A private thing' } }));
  const listA = await listCaptures(req('/api/captures', { cookie: tokA }));
  const listB = await listCaptures(req('/api/captures', { cookie: tokB }));
  const bodyA = JSON.stringify(await listA.json());
  const bodyB = JSON.stringify(await listB.json());
  check('E1-1 an authenticated route serves the session user', listA.status === 200 && bodyA.includes('A private thing'));
  check('E1-2 account isolation: B never sees A\'s data', listB.status === 200 && !bodyB.includes('A private thing'));
  check('E1-3 no cookie -> 401', (await listCaptures(req('/api/captures'))).status === 401);

  // --- Tampering and foreign tokens ----------------------------------------------------------
  const [body, sig] = tokA.split('.');
  const flipped = `${body}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
  const forgedUid = createSessionTokenV2(deriveSessionKey('x'.repeat(40)), { sid: claims.sid, uid: B.id, iat: Date.now(), exp: claims.exp });
  const v1Current = sign({ userId: A.id, email, exp: Date.now() + 86400_000 });
  const crossUser = createSessionTokenV2(key, { sid: claims.sid, uid: B.id, iat: Date.now(), exp: claims.exp });
  const unknownSid = createSessionTokenV2(key, { sid: generateSessionId(), uid: A.id, iat: Date.now(), exp: claims.exp });
  const wrongExp = createSessionTokenV2(key, { sid: claims.sid, uid: A.id, iat: Date.now(), exp: claims.exp - 1000 });
  for (const [label, t] of [
    ['a flipped signature', flipped],
    ['a token signed with another secret', forgedUid],
    ['a v1 token signed with the CURRENT secret, in the v2 cookie', v1Current],
    ["A's sid with B's uid (validly signed): row/user binding", crossUser],
    ['a validly signed token with no row', unknownSid],
    ['a validly signed token whose exp differs from its row', wrongExp],
    ['garbage', 'not-a-token'],
    ['an oversized value', 'a'.repeat(5000)],
  ] as const) {
    const r = await sessionUser(t);
    const c = await listCaptures(req('/api/captures', { cookie: t }));
    check(`T rejects ${label}: { user: null } and 401`, r.status === 200 && r.body.user === null && c.status === 401);
  }
  const legacyOnly = await sessionUser(undefined, { as_session: v1Current });
  check('T-v1 a legacy as_session cookie (current secret) is not authentication, and it is cleared (N6)', legacyOnly.body.user === null && /max-age=0/.test(attrs(legacyOnly.res, 'as_session')));
  check('T-v1b a legacy as_session cookie gives 401 on an E1 route', (await listCaptures(req('/api/captures', { cookies: { as_session: v1Current } }))).status === 401);
  check('T-v1c a v2 cookie under the wrong (secure) name is ignored outside production', (await sessionUser(undefined, { '__Host-as_sid': tokA })).body.user === null);

  // --- Expiry (database clock) ------------------------------------------------------------------
  const { token: tokExp } = await signIn(email);
  check('X0 a second session for A works', (await sessionUser(tokExp)).body.user?.id === A.id);
  await q(`UPDATE "AuthSession" SET "createdAt" = now() - interval '31 days', "expiresAt" = now() - interval '1 second' WHERE "idHash" = $1`, [hashSessionId(verifySessionTokenV2(key, tokExp!)!.sid)]);
  check('X1 expired by the DATABASE clock (token exp still in the future) -> null / 401', (await sessionUser(tokExp)).body.user === null && (await listCaptures(req('/api/captures', { cookie: tokExp }))).status === 401);
  check('X2 other sessions of the same user are unaffected', (await sessionUser(tokA)).body.user?.id === A.id);

  // --- Logout (D8) and B1 -------------------------------------------------------------------------
  const { token: tokL } = await signIn(email);
  const out = await logout(req('/api/auth/logout', { method: 'POST', cookie: tokL }));
  const rowL = (await q(`SELECT "revokedAt", "revokeReason" FROM "AuthSession" WHERE "idHash" = $1`, [hashSessionId(verifySessionTokenV2(key, tokL!)!.sid)]))[0];
  check('L1 logout: 200 only after the row is durably revoked (revokedAt set, reason logout)', out.status === 200 && rowL.revokedAt !== null && rowL.revokeReason === 'logout');
  check('L2 logout clears as_sid and legacy as_session (Max-Age=0, Path=/)', /max-age=0/.test(attrs(out, NAME)) && attrs(out, NAME).includes('path=/') && /max-age=0/.test(attrs(out, 'as_session')));
  const after = await Promise.all(Array.from({ length: 20 }, () => listCaptures(req('/api/captures', { cookie: tokL }))));
  check('L3 B1: every request after the revocation commit is 401 (20 concurrent replays)', after.every((r) => r.status === 401));
  check('L4 replayed cookie on /api/auth/session -> { user: null } (N3)', (await sessionUser(tokL)).body.user === null);
  check('L5 logout is idempotent: a replayed logout is 200', (await logout(req('/api/auth/logout', { method: 'POST', cookie: tokL }))).status === 200);
  check('L6 logout with no / garbage cookie is 200 (nothing to revoke) and clears cookies', (await logout(req('/api/auth/logout', { method: 'POST', cookie: 'junk' }))).status === 200);
  check('L7 other sessions survive one session\'s logout', (await sessionUser(tokA)).body.user?.id === A.id);
  const { token: tokN5 } = await signIn(email);
  check('L8 N5: signing in again after logout gives a new working session; the old stays rejected', (await sessionUser(tokN5)).body.user?.id === A.id && (await sessionUser(tokL)).body.user === null);

  // --- B3: share lock ordering --------------------------------------------------------------------
  const { token: tokS } = await signIn(email);
  const sessS = (await getSessionFromRequest(req('/', { cookie: tokS }))) as RequestSession;
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const locked = withSessionShareLock(sessS, async () => {
    order.push('operation-start');
    await gate;
    order.push('operation-end');
    return 'grant';
  });
  await new Promise((r) => setTimeout(r, 150));
  const logoutDuring = logout(req('/api/auth/logout', { method: 'POST', cookie: tokS })).then((r) => {
    order.push('logout-done');
    return r;
  });
  await new Promise((r) => setTimeout(r, 300));
  order.push('release');
  release();
  const [lockRes, outRes] = await Promise.all([locked, logoutDuring]);
  check('B3-1 an operation holding FOR SHARE completes; the concurrent logout waits for it, then commits', lockRes.ok && lockRes.value === 'grant' && outRes.status === 200 && order.join(',') === 'operation-start,release,operation-end,logout-done', order);
  let ran = false;
  const lockAfter = await withSessionShareLock(sessS, async () => {
    ran = true;
    return 'x';
  });
  check('B3-2 after the revocation committed, the share-locked operation is refused and never runs', lockAfter.ok === false && ran === false);

  // --- E4: MCP consent helper ---------------------------------------------------------------------
  check('E4-1 sessionUserFromCookie: live session -> user id', (await sessionUserFromCookie(`${NAME}=${tokA}`)) === A.id);
  check('E4-2 sessionUserFromCookie: revoked session -> null', (await sessionUserFromCookie(`${NAME}=${tokS}`)) === null);
  check('E4-3 sessionUserFromCookie: legacy as_session only -> null', (await sessionUserFromCookie(`as_session=${v1Current}`)) === null);

  // --- Database failure and timeout: 503, never 401 / 200 --------------------------------------------
  const dead = createSessionPool('postgresql://aura_ci@127.0.0.1:1/none');
  setSessionPoolForTesting(dead);
  try {
    const r1 = await sessionRoute(req('/api/auth/session', { cookie: tokA }));
    check('F1 DB unreachable: /api/auth/session -> 503 with Retry-After, no Set-Cookie', r1.status === 503 && !!r1.headers.get('retry-after') && setCookies(r1).length === 0);
    const r2 = await listCaptures(req('/api/captures', { cookie: tokA }));
    check('F2 DB unreachable: E1 route -> 503 (not 401)', r2.status === 503);
    const r3 = await logout(req('/api/auth/logout', { method: 'POST', cookie: tokA }));
    check('F3 D8: DB unreachable -> logout 503, the cookie is KEPT (no Set-Cookie), message "Couldn\'t sign out. Try again."', r3.status === 503 && setCookies(r3).length === 0 && (await r3.json()).error === "Couldn't sign out. Try again.");
    const fcode = await newCode('i2-b@example.test');
    const r4 = await verifyCode(req('/api/auth/verify-code', { method: 'POST', body: { email: 'i2-b@example.test', code: fcode } }));
    const fc = await q(`SELECT "consumedAt" FROM "AuthCode" WHERE email = $1`, ['i2-b@example.test']);
    check('F4 sign-in with the session DB unreachable -> 503, no cookie, code NOT consumed', r4.status === 503 && !cookieValue(r4, NAME) && fc[0].consumedAt === null);
    check('F5 no cookie is still 401 without touching the database (no false 503)', (await listCaptures(req('/api/captures'))).status === 401);
    check('F6 a malformed cookie is 401 without touching the database', (await listCaptures(req('/api/captures', { cookie: 'junk' }))).status === 401);
    let threw = false;
    try {
      await getSessionFromCookieHeader(`${NAME}=${tokA}`);
    } catch {
      threw = true;
    }
    check('F7 E4 helper throws (fail closed) when the DB is unreachable', threw);
  } finally {
    setSessionPoolForTesting(null);
    await dead.end().catch(() => {});
  }
  const proxy = await startFaultProxy(URL_, 'AuthSession');
  const viaProxy = createSessionPool(proxy.url);
  setSessionPoolForTesting(viaProxy);
  try {
    proxy.queue.push('blackhole');
    const t0 = performance.now();
    const r = await listCaptures(req('/api/captures', { cookie: tokA }));
    const ms = performance.now() - t0;
    check('F8 a hung database (blackholed lookup) -> 503 within the 2 s lookup deadline', r.status === 503 && ms < 2600, Math.round(ms));
    const rec = await listCaptures(req('/api/captures', { cookie: tokA }));
    check('F9 recovers on the next request without a restart', rec.status === 200);
    proxy.queue.push('drop-after-forward');
    const lo = await logout(req('/api/auth/logout', { method: 'POST', cookie: tokN5 }));
    check('F10 D8: an uncertain first revoke is retried once within the deadline -> 200 and the row is revoked', lo.status === 200 && (await sessionUser(tokN5)).body.user === null);
  } finally {
    setSessionPoolForTesting(null);
    await viaProxy.end().catch(() => {});
    await proxy.close();
  }

  // --- Sign-in COMMIT faults at the route (R2/R3 contracts end to end) ----------------------------------
  const cproxy = await startFaultProxy(URL_, 'auth_session_commit');
  const viaC = createSessionPool(cproxy.url);
  setSessionPoolForTesting(viaC);
  try {
    const rowsBefore = (await q(`SELECT count(*)::int n FROM "AuthSession" WHERE "userId" = $1`, [B.id]))[0].n;
    cproxy.queue.push('drop-after-forward');
    const k1 = await newCode('i2-b@example.test');
    const amb = await verifyCode(req('/api/auth/verify-code', { method: 'POST', body: { email: 'i2-b@example.test', code: k1 } }));
    // The server executes the forwarded COMMIT after the client already saw the drop: let it settle.
    let rowsAfter = rowsBefore;
    for (let i = 0; i < 20 && rowsAfter === rowsBefore; i++) {
      await new Promise((r) => setTimeout(r, 50));
      rowsAfter = (await q(`SELECT count(*)::int n FROM "AuthSession" WHERE "userId" = $1`, [B.id]))[0].n;
    }
    check('G1 ambiguous sign-in COMMIT (committed, reply lost) -> 503 and NO cookie; the orphan row is unusable', amb.status === 503 && !cookieValue(amb, NAME) && rowsAfter === rowsBefore + 1, { status: amb.status, rowsBefore, rowsAfter, triggered: cproxy.triggered });
    cproxy.queue.push('drop-before-forward');
    const k2 = await newCode('i2-b@example.test');
    const nc = await verifyCode(req('/api/auth/verify-code', { method: 'POST', body: { email: 'i2-b@example.test', code: k2 } }));
    await new Promise((r) => setTimeout(r, 300));
    const k2row = await q(`SELECT "consumedAt" FROM "AuthCode" WHERE email = $1`, ['i2-b@example.test']);
    check('G2 sign-in COMMIT never reached the server -> 503, no cookie, no row, code NOT consumed (retry works)', nc.status === 503 && !cookieValue(nc, NAME) && k2row[0].consumedAt === null && (await q(`SELECT count(*)::int n FROM "AuthSession" WHERE "userId" = $1`, [B.id]))[0].n === rowsAfter, { status: nc.status, consumed: k2row[0].consumedAt, triggered: cproxy.triggered });
    const retry = await verifyCode(req('/api/auth/verify-code', { method: 'POST', body: { email: 'i2-b@example.test', code: k2 } }));
    check('G3 the same code then signs in normally', retry.status === 200 && !!cookieValue(retry, NAME));
  } finally {
    setSessionPoolForTesting(null);
    await viaC.end().catch(() => {});
    await cproxy.close();
  }

  // --- Production cookie contract (__Host-) -----------------------------------------------------------
  const env = process.env as Record<string, string | undefined>;
  const prevEnv = env.NODE_ENV;
  const { NextResponse } = await import('../apps/web/node_modules/next/server');
  const committed = await createAuthSession(getSessionPool(), A.id);
  env.NODE_ENV = 'production';
  try {
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, committed);
    const p = attrs(res, '__Host-as_sid');
    check('P1 production: __Host-as_sid, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain', p.includes('secure') && p.includes('httponly') && p.includes('samesite=lax') && p.includes('path=/') && !p.includes('domain='));
    check('P2 production: sign-in also clears as_sid and as_session', /max-age=0/.test(attrs(res, 'as_sid')) && /max-age=0/.test(attrs(res, 'as_session')));
    const prodTok = cookieValue(res, '__Host-as_sid')!;
    const asInsecure = await getSessionFromRequest(req('/', { cookies: { as_sid: prodTok } }));
    const asSecure = await getSessionFromRequest(req('/', { cookies: { '__Host-as_sid': prodTok } }));
    check('P3 production reads ONLY __Host-as_sid (the unprefixed name is ignored)', asInsecure === null && asSecure !== null && asSecure !== SESSION_UNAVAILABLE && asSecure.userId === A.id);
    let refused = false;
    try {
      setSessionPoolForTesting(null);
    } catch {
      refused = true;
    }
    check('P4 the test pool seam refuses in production', refused);
  } finally {
    env.NODE_ENV = prevEnv;
  }

  // --- Daily cleanup in the cron route ---------------------------------------------------------------------
  await q(`INSERT INTO "AuthSession" ("idHash","userId","createdAt","expiresAt") VALUES ($1,$2, now() - interval '40 days', now() - interval '10 days')`, [hashSessionId(generateSessionId()), B.id]);
  await q(`INSERT INTO "AuthSession" ("idHash","userId","expiresAt","revokedAt","revokeReason") VALUES ($1,$2, now() + interval '1 day', now() - interval '8 days', 'logout')`, [hashSessionId(generateSessionId()), B.id]);
  const liveBefore = (await q(`SELECT count(*)::int n FROM "AuthSession" WHERE "revokedAt" IS NULL AND "expiresAt" > now()`))[0].n;
  env.INTERNAL_REMINDER_DISPATCH_SECRET = 'i2-test-dispatch-secret-0123456789';
  const cron = await cronDispatch(req('/api/internal/reminders/dispatch', { headers: { authorization: 'Bearer i2-test-dispatch-secret-0123456789' } }));
  const cronBody = (await cron.json()) as { authSessionCleanup?: { deleted?: number } };
  const liveAfter = (await q(`SELECT count(*)::int n FROM "AuthSession" WHERE "revokedAt" IS NULL AND "expiresAt" > now()`))[0].n;
  check('C1 the daily cron runs the bounded cleanup (old expired + old revoked rows deleted)', (cronBody.authSessionCleanup?.deleted ?? 0) >= 2, cronBody.authSessionCleanup);
  check('C2 cleanup never deletes a live session', liveAfter === liveBefore && (await sessionUser(tokA)).body.user?.id === A.id);
  delete env.INTERNAL_REMINDER_DISPATCH_SECRET;
  const unauth = await cronDispatch(req('/api/internal/reminders/dispatch'));
  check('C3 the cron route (and its cleanup) stays secret-gated: 404 without the secret', unauth.status === 404);

  // --- No session backend leaks ------------------------------------------------------------------------------
  await new Promise((r) => setTimeout(r, 200));
  const stuck = await q(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name = 'aura-session' AND state NOT IN ('idle')`);
  check('R1 no aura-session backend is left active or idle-in-transaction', stuck[0].n === 0, stuck[0].n);
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await closeSessionPool().catch(() => {});
    await admin.end().catch(() => {});
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
  });
