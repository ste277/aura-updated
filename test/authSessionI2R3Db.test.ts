/**
 * AURA-AUTH-SESSION-01-I2-R3 (39253) -- focused regressions for the three
 * 39251 merge blockers, on TWO disposable loopback databases (Aura +
 * separate MCP OAuth), real handlers:
 *
 *   X1  natural session expiry at the finalization boundary, including a lock
 *       wait: token and AuthSession row stay unchanged and matching;
 *   X2  GET /api/mcp/connections (the real App Router route) answers 503 +
 *       Retry-After when the Aura database fails during connection listing,
 *       distinct from "no connections" (200) and "signed out" (401);
 *   X3  the consent POST's request body is read inside the ONE 2 000 ms
 *       consent deadline: delayed delivery -> 503 + Retry-After, nothing
 *       written, the connection closed; the body-size limit is unchanged.
 *
 *   DATABASE_URL=... AURA_MCP_OAUTH_DATABASE_URL=... npx ts-node test/authSessionI2R3Db.test.ts
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { upsertUserByEmail, createAuthCode } from '../apps/web/lib/db';
import { getAuthSecret, hashAuthCode } from '../apps/web/lib/auth';
import { activeSessionCookieName, closeSessionPool, getSessionPool, setSessionPoolForTesting } from '../apps/web/lib/session';
import { createSessionPool } from '../apps/web/lib/authSessionDb';
import { createAuthSession } from '../apps/web/lib/authSessionStore';
import { createSessionTokenV2, deriveSessionKey, hashSessionId } from '../apps/web/lib/authSessionToken';
import { POST as verifyCode } from '../apps/web/app/api/auth/verify-code/route';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { Browser, sleep } from './mcpOAuthI2bHarness';

const AURA = process.env.DATABASE_URL!;
const OAUTH = process.env.AURA_MCP_OAUTH_DATABASE_URL!;
for (const u of [AURA, OAUTH]) {
  if (!u || !['127.0.0.1', 'localhost', '::1'].includes(new URL(u).hostname)) {
    console.error('Refusing: DATABASE_URL and AURA_MCP_OAUTH_DATABASE_URL must be disposable loopback databases.');
    process.exit(2);
  }
}
Object.assign(process.env, { NODE_ENV: 'development', AURA_MCP_AUTH_MODE: 'local-dev', AURA_MCP_OAUTH_STORE: 'postgres' });

const aura = new Pool({ connectionString: AURA, max: 4 });
const oauth = new Pool({ connectionString: OAUTH, max: 4 });
const NAME = activeSessionCookieName();
const REDIRECT = 'http://127.0.0.1:8976/callback';
const SLACK_MS = 400;
let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, note: unknown = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && note !== '' ? ' -- ' + JSON.stringify(note).slice(0, 500) : ''}`);
  if (ok) passes++;
  else failures++;
}

async function signIn(email: string): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await aura.query(`DELETE FROM "AuthCode" WHERE email = $1`, [email]);
  await createAuthCode({ email, codeHash: hashAuthCode(email, code), expiresAt: new Date(Date.now() + 600_000) });
  const res = await verifyCode(new NextRequest('http://localhost/api/auth/verify-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) }));
  const sc = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie().find((c) => c.startsWith(NAME + '='))!;
  return decodeURIComponent(sc.slice(NAME.length + 1).split(';')[0]);
}
const b64 = (b: Buffer) => b.toString('base64url');

async function main() {
  // One local authorization server; the App Router connections route resolves the SAME instance from env.
  let handle: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => undefined;
  const server = http.createServer((req, res) => handle(req, res));
  server.keepAliveTimeout = 1;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const resource = `${origin}/api/mcp`;
  Object.assign(process.env, { AURA_MCP_REMOTE_ENABLED: '1', AURA_MCP_AUTHORIZATION_SERVER: origin, AURA_MCP_RESOURCE_URL: resource });
  const { getLocalMcpAuth, LOCAL_DEV_CLIENT_ID } = await import('../apps/web/lib/mcpLocalOAuth');
  const state = getLocalMcpAuth({ authorizationServer: origin, resourceUrl: resource });
  handle = (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    void state.server.handle(req, res, url.pathname, url.search);
  };
  const { GET: connectionsGET } = await import('../apps/web/app/api/mcp/connections/route');

  const toConsent = async (token: string) => {
    const browser = new Browser(origin);
    browser.jar.set(NAME, token);
    const verifier = b64(randomBytes(32));
    const challenge = b64(createHash('sha256').update(verifier).digest());
    const q = new URLSearchParams({ client_id: LOCAL_DEV_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: `${MCP_SCOPE} offline_access`, resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's', prompt: 'consent' });
    let res = await browser.fetch(`/oauth/authorize?${q}`);
    for (let i = 0; i < 10 && res.status >= 300 && res.status < 400 && res.headers.get('location'); i++) res = await browser.fetch(res.headers.get('location')!);
    const html = await res.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
    const action = /action="([^"]+\/confirm)"/.exec(html)?.[1];
    if (!csrf || !action) throw new Error(`no consent page (${res.status})`);
    return { browser, verifier, csrf, action };
  };
  const approve = (p: Awaited<ReturnType<typeof toConsent>>) =>
    p.browser.fetch(p.action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: `csrf=${encodeURIComponent(p.csrf)}` });
  const finRows = async (userId: string) => (await aura.query(`SELECT 1 FROM "McpConsentFinalization" WHERE "userId" = $1`, [userId])).rowCount ?? 0;
  const grantRows = async (userId: string) => (await oauth.query(`SELECT 1 FROM "McpOAuthPayload" WHERE model = 'Grant' AND "accountId" = $1`, [userId])).rowCount ?? 0;
  const newUser = async (tag: string) => {
    await oauth.query(`DELETE FROM "McpRateLimitWindow"`);
    const email = `r3-${tag}@example.test`;
    const u = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' });
    await oauth.query(`DELETE FROM "McpOAuthPayload" WHERE "accountId" = $1`, [u.id]);
    await aura.query(`DELETE FROM "McpConsentFinalization" WHERE "userId" = $1`, [u.id]);
    return { id: u.id, email };
  };

  // ---- X1 natural expiry at the finalization boundary (lock wait) ---------------------------------
  {
    const u = await newUser('natural-expiry');
    const session = await createAuthSession(getSessionPool(), u.id);
    // A session that expires naturally in ~2.5 s by the DATABASE clock. Set ONCE, before the test; the
    // token is minted for exactly this row and neither changes afterwards.
    const exp = (await aura.query(`UPDATE "AuthSession" SET "expiresAt" = date_trunc('milliseconds', now() + interval '2500 milliseconds') WHERE "idHash" = $1 RETURNING "expiresAt"`, [session.idHash])).rows[0].expiresAt as Date;
    const token = createSessionTokenV2(deriveSessionKey(getAuthSecret()), { sid: session.sid, uid: u.id, iat: Date.now(), exp: exp.getTime() });
    const rowBefore = (await aura.query(`SELECT "idHash", "expiresAt", "revokedAt" FROM "AuthSession" WHERE "idHash" = $1`, [hashSessionId(session.sid)])).rows[0];
    const p = await toConsent(token);
    // A row lock that leaves the row unchanged: the finalization's FOR SHARE must wait for it.
    const locker = await aura.connect();
    await locker.query('BEGIN');
    await locker.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1 FOR UPDATE`, [session.idHash]);
    const msToExpiry = async () => Number((await aura.query(`SELECT extract(epoch FROM ($1::timestamptz - now())) * 1000 AS ms`, [exp])).rows[0].ms);
    while ((await msToExpiry()) > 600) await sleep(10);
    const approving = approve(p);
    // Hold the lock until the session has naturally expired, then release it (no change to the row).
    while ((await msToExpiry()) > -250) await sleep(10);
    await locker.query('COMMIT');
    locker.release();
    const res = await approving;
    const rowAfter = (await aura.query(`SELECT "idHash", "expiresAt", "revokedAt" FROM "AuthSession" WHERE "idHash" = $1`, [hashSessionId(session.sid)])).rows[0];
    check('X1 setup: the token and its AuthSession row stay unchanged and matching throughout', JSON.stringify(rowBefore) === JSON.stringify(rowAfter) && rowAfter.revokedAt === null && rowAfter.expiresAt.getTime() === exp.getTime());
    check('X1 a session that expired naturally while finalization waited on its row lock is NOT finalized (no row, no completed interaction)', (await finRows(u.id)) === 0 && res.status !== 303, { status: res.status, rows: await finRows(u.id) });
    check('X1 the consent answers "sign in required" (401), not a completed connection', res.status === 401, res.status);

    // Control: the same lock wait with a session that stays valid IS finalized (the check is not vacuous).
    const v = await newUser('lock-control');
    const vToken = await signIn(v.email);
    const vp = await toConsent(vToken);
    const vRow = (await aura.query(`SELECT "idHash" FROM "AuthSession" WHERE "userId" = $1 AND "revokedAt" IS NULL`, [v.id])).rows[0].idHash;
    const l2 = await aura.connect();
    await l2.query('BEGIN');
    await l2.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1 FOR UPDATE`, [vRow]);
    const ap2 = approve(vp);
    await sleep(800);
    await l2.query('COMMIT');
    l2.release();
    const r2 = await ap2;
    check('X1 control: the same lock wait on a live session finalizes and completes (303)', r2.status === 303 && (await finRows(v.id)) === 1, { status: r2.status });
  }

  // ---- X2 GET /api/mcp/connections: listing outage -> 503 ---------------------------------------
  {
    const u = await newUser('listing');
    const token = await signIn(u.email);
    const get = async () => {
      try {
        const r = await connectionsGET(new Request(`${origin}/api/mcp/connections`, { headers: { cookie: `${NAME}=${token}` } }));
        return { status: r.status, retryAfter: r.headers.get('retry-after'), body: await r.json().catch(() => null) };
      } catch (err) {
        return { status: 0, retryAfter: null, body: `threw ${(err as Error).name}` };
      }
    };
    const empty = await get();
    check('X2 control: signed in, no connections -> 200 { connections: [] } (absent authorization is not an outage)', empty.status === 200 && Array.isArray(empty.body?.connections) && empty.body.connections.length === 0, empty);
    const p = await toConsent(token);
    await approve(p);
    const one = await get();
    check('X2 control: one completed connection is listed (200)', one.status === 200 && one.body?.connections?.length === 1, one);
    // The outage starts AFTER the route's own session check (1st checkout): the listing's finalization lookups fail.
    const live = createSessionPool(AURA);
    let checkouts = 0;
    const flaky = new Proxy(live, {
      get(target, prop, recv) {
        if (prop === 'connect') return () => (++checkouts === 1 ? target.connect() : Promise.reject(new Error('aura database down')));
        return Reflect.get(target, prop, recv);
      },
    }) as typeof live;
    setSessionPoolForTesting(flaky);
    const down = await get();
    setSessionPoolForTesting(null);
    await live.end().catch(() => undefined);
    check('X2 the Aura database fails during connection listing -> HTTP 503 with Retry-After (not 500, not an empty list)', down.status === 503 && down.retryAfter !== null && checkouts >= 2, { down, checkouts });
    const noCookie = await connectionsGET(new Request(`${origin}/api/mcp/connections`));
    check('X2 control: no session -> 401 (signed out stays distinct from unavailable)', noCookie.status === 401);
  }

  // ---- X3 delayed request-body delivery inside the consent deadline --------------------------------
  {
    const u = await newUser('slow-body');
    const token = await signIn(u.email);
    const p = await toConsent(token);
    const grantsBefore = await grantRows(u.id);
    const body = `csrf=${encodeURIComponent(p.csrf)}`;
    const cookie = [...p.browser.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const outcome = await new Promise<{ status: number; retryAfter: string | null; ms: number; closed: boolean }>((resolve) => {
      const t0 = Date.now();
      let closed = false;
      const req = http.request(new URL(p.action, origin), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(body)), origin, cookie } }, (res) => {
        const ms = Date.now() - t0;
        res.resume();
        res.on('close', () => {
          closed = true;
        });
        res.on('end', () => setTimeout(() => resolve({ status: res.statusCode ?? 0, retryAfter: (res.headers['retry-after'] as string) ?? null, ms, closed: closed || req.socket?.destroyed === true }), 100));
      });
      req.on('error', () => resolve({ status: -1, retryAfter: null, ms: Date.now() - t0, closed: true }));
      req.flushHeaders();
      // The body arrives only after the whole consent budget has passed.
      setTimeout(() => {
        if (!req.destroyed) req.end(body);
      }, 2600);
    });
    await sleep(2800);
    check('X3 a body delivered after the deadline -> 503 + Retry-After within the 2 s consent budget', outcome.status === 503 && outcome.retryAfter !== null && outcome.ms <= 2000 + SLACK_MS, outcome);
    check('X3 processing stopped: no grant and no finalization were written, even after the late body', (await grantRows(u.id)) === grantsBefore && (await finRows(u.id)) === 0, { grants: await grantRows(u.id), grantsBefore });
    check('X3 the connection is closed after the 503 (the late body is never processed)', outcome.closed, outcome);
    // Body-size limit unchanged: an oversized form is refused (no CSRF read -> 403), nothing written.
    const big = await p.browser.fetch(p.action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: `csrf=${'x'.repeat(5000)}` });
    check('X3 control: the existing form-size limit still applies (oversized body -> 403, nothing written)', big.status === 403 && (await grantRows(u.id)) === grantsBefore);
    const ok = await approve(p);
    check('X3 control: the same consent with a prompt body still completes (303)', ok.status === 303 && (await finRows(u.id)) === 1, ok.status);
  }

  server.close();
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await closeSessionPool().catch(() => undefined);
    await aura.end();
    await oauth.end();
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
  });
