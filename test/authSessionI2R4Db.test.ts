/**
 * AURA-AUTH-SESSION-01-I2-R4 (39255) -- focused regressions for the 39254
 * findings, on TWO disposable loopback databases (Aura + separate MCP OAuth),
 * real handlers:
 *
 *   X4  the consent deadline is ABSOLUTE: a body that completes after the
 *       2 000 ms monotonic deadline is refused even when the body-read timer
 *       has not run yet (a stalled event loop runs timer callbacks late; here
 *       the monotonic deadline clock is advanced past the deadline while the
 *       real timer is still pending, which is exactly that condition). 503 +
 *       Retry-After, connection closed, the form is never processed (a bad
 *       CSRF value is not even looked at), no grant and no finalization;
 *   X5  GET and POST /api/mcp/connections (the real App Router route) answer
 *       503 + Retry-After when the INITIAL session verification is
 *       unavailable; nothing is revoked; signed out stays 401 and "no
 *       connections" stays 200.
 *
 *   DATABASE_URL=... AURA_MCP_OAUTH_DATABASE_URL=... npx ts-node test/authSessionI2R4Db.test.ts
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { upsertUserByEmail, createAuthCode } from '../apps/web/lib/db';
import { hashAuthCode } from '../apps/web/lib/auth';
import { activeSessionCookieName, closeSessionPool, setSessionPoolForTesting } from '../apps/web/lib/session';
import { createSessionPool } from '../apps/web/lib/authSessionDb';
import { POST as verifyCode } from '../apps/web/app/api/auth/verify-code/route';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { setDeadlineClockForTests } from '../packages/mcp-tools/src/security/deadline';
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
  const route = await import('../apps/web/app/api/mcp/connections/route');

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
    const email = `r4-${tag}@example.test`;
    const u = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' });
    await oauth.query(`DELETE FROM "McpOAuthPayload" WHERE "accountId" = $1`, [u.id]);
    await aura.query(`DELETE FROM "McpConsentFinalization" WHERE "userId" = $1`, [u.id]);
    return { id: u.id, email };
  };

  // ---- X4 absolute consent deadline: body completes after the deadline, timer not yet run ----------
  {
    /**
     * Sends the consent POST headers, waits until the handler is reading the body (the body-read timer
     * is armed for the ~1.5 s that remain), then advances the MONOTONIC deadline clock past the 2 000 ms
     * deadline and delivers the body at once. The body therefore completes after the deadline while
     * the real timer is still pending -- the state a stalled event loop produces.
     */
    const latePost = (p: Awaited<ReturnType<typeof toConsent>>, csrf: string, jumpMs: number) =>
      new Promise<{ status: number; retryAfter: string | null; connection: string | null; closed: boolean; msAfterBody: number }>((resolve) => {
        const body = `csrf=${encodeURIComponent(csrf)}`;
        const cookie = [...p.browser.jar].map(([k, v]) => `${k}=${v}`).join('; ');
        let sentAt = 0;
        let closed = false;
        const req = http.request(new URL(p.action, origin), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(body)), origin, cookie } }, (res) => {
          const msAfterBody = Date.now() - sentAt;
          res.resume();
          res.on('close', () => {
            closed = true;
          });
          res.on('end', () => setTimeout(() => resolve({ status: res.statusCode ?? 0, retryAfter: (res.headers['retry-after'] as string) ?? null, connection: (res.headers.connection as string) ?? null, closed: closed || req.socket?.destroyed === true, msAfterBody }), 100));
        });
        req.on('error', () => resolve({ status: -1, retryAfter: null, connection: null, closed: true, msAfterBody: Date.now() - sentAt }));
        req.flushHeaders();
        setTimeout(() => {
          if (jumpMs > 0) {
            const offset = jumpMs;
            setDeadlineClockForTests(() => performance.now() + offset);
          }
          sentAt = Date.now();
          req.end(body);
        }, 500);
      }).finally(() => setDeadlineClockForTests(null));

    const u = await newUser('late-timer');
    const token = await signIn(u.email);
    const p = await toConsent(token);
    const grantsBefore = await grantRows(u.id);

    const valid = await latePost(p, p.csrf, 2500);
    check('X4 body completed after the absolute deadline (timer still pending) -> 503 + Retry-After', valid.status === 503 && valid.retryAfter !== null, valid);
    check('X4 the refusal was decided by the deadline recheck, before the pending timer (answered < 1 s after the body)', valid.msAfterBody < 1000, valid);
    check('X4 the expired request closes the connection (Connection: close, socket closed)', valid.connection === 'close' && valid.closed, valid);
    check('X4 no late consent processing: no grant and no finalization were written', (await grantRows(u.id)) === grantsBefore && (await finRows(u.id)) === 0, { grants: await grantRows(u.id), grantsBefore });

    const badCsrf = await latePost(p, 'not-the-csrf-token', 2500);
    check('X4 the late form is never processed: even an invalid CSRF value is not evaluated (503, not 403)', badCsrf.status === 503 && badCsrf.connection === 'close', badCsrf);
    check('X4 still nothing written after the second late body', (await grantRows(u.id)) === grantsBefore && (await finRows(u.id)) === 0);

    const control = await latePost(p, p.csrf, 0);
    check('X4 control: the same request with the body inside the deadline completes (303) and finalizes once', control.status === 303 && (await finRows(u.id)) === 1, control);
  }

  // ---- X5 GET / POST /api/mcp/connections: INITIAL session verification unavailable ----------------
  {
    const u = await newUser('initial-outage');
    const token = await signIn(u.email);
    const call = async (method: 'GET' | 'POST', withCookie = true) => {
      const headers: Record<string, string> = withCookie ? { cookie: `${NAME}=${token}` } : {};
      const init: RequestInit = { method, headers };
      if (method === 'POST') {
        Object.assign(headers, { origin, 'content-type': 'application/json' });
        init.body = JSON.stringify({ clientId: LOCAL_DEV_CLIENT_ID });
      }
      try {
        const r = await (method === 'GET' ? route.GET : route.POST)(new Request(`${origin}/api/mcp/connections`, init));
        return { status: r.status, retryAfter: r.headers.get('retry-after'), body: await r.json().catch(() => null) };
      } catch (err) {
        return { status: 0, retryAfter: null, body: `threw ${(err as Error).name}` };
      }
    };
    const empty = await call('GET');
    check('X5 control: signed in, no connections -> 200 { connections: [] }', empty.status === 200 && Array.isArray(empty.body?.connections) && empty.body.connections.length === 0, empty);
    await approve(await toConsent(token));
    const grants = await grantRows(u.id);
    const fins = await finRows(u.id);
    check('X5 setup: one completed connection', grants === 1 && fins === 1, { grants, fins });

    // Every Aura-database checkout fails: the route's own (initial) session verification is unavailable.
    const live = createSessionPool(AURA);
    let checkouts = 0;
    const down = new Proxy(live, {
      get(target, prop, recv) {
        if (prop === 'connect') return () => (++checkouts, Promise.reject(new Error('aura database down')));
        return Reflect.get(target, prop, recv);
      },
    }) as typeof live;
    setSessionPoolForTesting(down);
    const getDown = await call('GET');
    const postDown = await call('POST');
    setSessionPoolForTesting(null);
    await live.end().catch(() => undefined);
    check('X5 GET: initial session verification unavailable -> 503 + Retry-After', getDown.status === 503 && getDown.retryAfter !== null && checkouts >= 1, { getDown, checkouts });
    check('X5 POST (disconnect): initial session verification unavailable -> 503 + Retry-After', postDown.status === 503 && postDown.retryAfter !== null, postDown);
    check('X5 no authorization-state mutation on the unavailable responses (grant and finalization intact)', (await grantRows(u.id)) === grants && (await finRows(u.id)) === fins);
    const after = await call('GET');
    check('X5 after recovery the connection is still listed (200, one connection)', after.status === 200 && after.body?.connections?.length === 1, after);
    const getAnon = await call('GET', false);
    const postAnon = await call('POST', false);
    check('X5 control: signed out -> 401 for GET and POST (distinct from unavailable)', getAnon.status === 401 && postAnon.status === 401, { getAnon, postAnon });
    const invalid = await route.GET(new Request(`${origin}/api/mcp/connections`, { headers: { cookie: `${NAME}=not-a-valid-token` } }));
    check('X5 control: invalid session token -> 401', invalid.status === 401, invalid.status);
  }

  server.close();
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    setDeadlineClockForTests(null);
    await closeSessionPool().catch(() => undefined);
    await aura.end();
    await oauth.end();
    await sleep(0);
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
  });
