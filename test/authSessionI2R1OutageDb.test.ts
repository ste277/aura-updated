/**
 * AURA-AUTH-SESSION-01-I2-R1 (39247) F3 -- a session-store outage is an
 * outage (503 + Retry-After), never "signed out" / sign-in required.
 *
 * Real pieces: the local authorization server (getLocalMcpAuth: real
 * resolveSessionUser and guardConsentGrant over lib/session.ts) over HTTP on
 * 127.0.0.1, real verify-code / logout routes, a DISPOSABLE loopback
 * PostgreSQL. The outage is real: the session pool is swapped for one whose
 * database does not exist. Also the E2 page boundary (lib/sessionPage.ts) and
 * the /session-unavailable 503 route.
 *
 *   DATABASE_URL=postgresql://...127.0.0.1.../x npx ts-node test/authSessionI2R1OutageDb.test.ts
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { Pool } from 'pg';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { upsertUserByEmail, createAuthCode } from '../apps/web/lib/db';
import { hashAuthCode } from '../apps/web/lib/auth';
import { activeSessionCookieName, closeSessionPool, setSessionPoolForTesting } from '../apps/web/lib/session';
import { createSessionPool } from '../apps/web/lib/authSessionDb';
import { SessionVerificationUnavailableError } from '../apps/web/lib/sessionErrors';
import { pageSessionOrUnavailable, safeReturnPath } from '../apps/web/lib/sessionPage';
import { GET as unavailableRoute } from '../apps/web/app/session-unavailable/route';
import { POST as verifyCode } from '../apps/web/app/api/auth/verify-code/route';
import { POST as logout } from '../apps/web/app/api/auth/logout/route';
import { Browser, authorize } from './mcpOAuthI2bHarness';

const URL_ = process.env.DATABASE_URL!;
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(URL_).hostname)) {
  console.error('Refusing: DATABASE_URL must be a disposable loopback database.');
  process.exit(2);
}
Object.assign(process.env, { NODE_ENV: 'development', AURA_MCP_AUTH_MODE: 'local-dev' });
delete process.env.AURA_MCP_OAUTH_STORE; // memory OAuth store: this test is about the SESSION store

const admin = new Pool({ connectionString: URL_, max: 2 });
const NAME = activeSessionCookieName();
let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, note: unknown = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && note !== '' ? ' -- ' + JSON.stringify(note).slice(0, 400) : ''}`);
  if (ok) passes++;
  else failures++;
}

async function signIn(email: string): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await admin.query(`DELETE FROM "AuthCode" WHERE email = $1`, [email]);
  await createAuthCode({ email, codeHash: hashAuthCode(email, code), expiresAt: new Date(Date.now() + 600_000) });
  const res = await verifyCode(new NextRequest('http://localhost/api/auth/verify-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) }));
  const sc = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie().find((c) => c.startsWith(NAME + '='))!;
  return decodeURIComponent(sc.slice(NAME.length + 1).split(';')[0]);
}

async function main() {
  const email = 'i2r1-outage@example.test';
  await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' });
  const { getLocalMcpAuth, LOCAL_DEV_CLIENT_ID } = await import('../apps/web/lib/mcpLocalOAuth');
  let handle: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => undefined;
  const server = http.createServer((req, res) => handle(req, res));
  server.keepAliveTimeout = 1;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const state = getLocalMcpAuth({ authorizationServer: origin, resourceUrl: `${origin}/api/mcp` });
  handle = (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    void state.server.handle(req, res, url.pathname, url.search);
  };
  const cluster = { origin, resource: `${origin}/api/mcp` } as unknown as Parameters<typeof authorize>[0];
  const dbDown = new URL(URL_);
  dbDown.pathname = '/i2r1_database_that_does_not_exist';
  const deadPool = createSessionPool(dbDown.toString());

  const token = await signIn(email);
  const browser = () => {
    const b = new Browser(origin);
    b.jar.set(NAME, token);
    return b;
  };

  // O0 control: live session -> the consent page (200) is shown.
  const live = await authorize(cluster, browser(), { clientId: LOCAL_DEV_CLIENT_ID });
  check('O0 control: live session -> consent page (200)', live.stoppedStatus === 200 && !!live.consentHtml, live);

  // O1 outage during the login/interaction check -> 503 + Retry-After, never the sign-in page.
  setSessionPoolForTesting(deadPool);
  const b1 = browser();
  const verifier = 'x'.repeat(43);
  const q = new URLSearchParams({ client_id: LOCAL_DEV_CLIENT_ID, redirect_uri: 'http://127.0.0.1:8976/callback', response_type: 'code', scope: 'mcp:tools', resource: cluster.resource, code_challenge: verifier, code_challenge_method: 'S256', state: 's' });
  let r = await b1.fetch(`/oauth/authorize?${q}`);
  const hops: Array<{ status: number; retryAfter: string | null; signIn: boolean }> = [];
  for (let i = 0; i < 8; i++) {
    const body = await r.clone().text().catch(() => '');
    hops.push({ status: r.status, retryAfter: r.headers.get('retry-after'), signIn: /Sign in/i.test(body) });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc && !loc.startsWith('http://127.0.0.1:8976')) {
      r = await b1.fetch(loc);
      continue;
    }
    break;
  }
  const last = hops[hops.length - 1];
  check('O1 session-store outage at the authorization/consent step -> 503 with Retry-After', last.status === 503 && last.retryAfter !== null, hops);
  check('O2 an outage never sends the user to sign in (no "Sign in" page, no 401)', !hops.some((h) => h.signIn || h.status === 401), hops);

  // O3 outage at consent APPROVAL (the B3 guard's session re-check) -> 503, no grant.
  setSessionPoolForTesting(null);
  const b3 = browser();
  const atConsent = await authorize(cluster, b3, { clientId: LOCAL_DEV_CLIENT_ID });
  const csrf = /name="csrf" value="([^"]+)"/.exec(atConsent.consentHtml ?? '')?.[1] ?? '';
  const action = /action="([^"]+\/confirm)"/.exec(atConsent.consentHtml ?? '')?.[1] ?? '';
  // The outage starts AFTER the interaction's own session check (1st checkout) and hits the
  // B3 guard's re-check (2nd checkout): a pool whose later checkouts fail.
  const livePool = createSessionPool(URL_);
  let checkouts = 0;
  const flaky = new Proxy(livePool, {
    get(target, prop, recv) {
      if (prop === 'connect') return () => (++checkouts === 1 ? target.connect() : Promise.reject(new Error('session store down')));
      return Reflect.get(target, prop, recv);
    },
  }) as typeof livePool;
  setSessionPoolForTesting(flaky);
  const approve = await b3.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: `csrf=${encodeURIComponent(csrf)}` });
  const approveBody = await approve.text();
  check('O3 outage at consent approval (the B3 guard re-check) -> 503 + Retry-After, not "Sign in required"', checkouts >= 2 && approve.status === 503 && approve.headers.get('retry-after') !== null && !/Sign in/i.test(approveBody), { checkouts, status: approve.status, body: approveBody.slice(0, 160) });
  setSessionPoolForTesting(null);
  await livePool.end().catch(() => undefined);

  // O4 revoked session (a definitive answer) -> sign-in required (401), distinct from the outage.
  const revokedToken = await signIn(email);
  await logout(new NextRequest('http://localhost/api/auth/logout', { method: 'POST', headers: { cookie: `${NAME}=${revokedToken}` } }));
  const b4 = new Browser(origin);
  b4.jar.set(NAME, revokedToken);
  const revoked = await authorize(cluster, b4, { clientId: LOCAL_DEV_CLIENT_ID });
  check('O4 revoked session -> 401 "Sign in to Aura" (not 503)', revoked.stoppedStatus === 401 && /Sign in/i.test(revoked.body ?? ''), revoked);
  // O5 missing credentials -> sign-in required (401).
  const missing = await authorize(cluster, new Browser(origin), { clientId: LOCAL_DEV_CLIENT_ID });
  check('O5 no session cookie -> 401 "Sign in to Aura" (not 503)', missing.stoppedStatus === 401 && /Sign in/i.test(missing.body ?? ''), missing);

  // E2 page boundary.
  let redirected = '';
  try {
    await pageSessionOrUnavailable(async () => {
      throw new SessionVerificationUnavailableError('acquire', 'failed');
    }, '/plan-day?horizon=TOMORROW');
  } catch (err) {
    redirected = String((err as { digest?: string }).digest ?? (err as Error).message);
  }
  check('O6 E2 page: an outage redirects to /session-unavailable with the page as returnTo', /NEXT_REDIRECT/.test(redirected) && redirected.includes('/session-unavailable?returnTo=%2Fplan-day%3Fhorizon%3DTOMORROW'), redirected);
  let other = '';
  try {
    await pageSessionOrUnavailable(async () => {
      throw new Error('boom');
    }, '/goals');
  } catch (err) {
    other = (err as Error).message;
  }
  check('O7 E2 page: any other error propagates unchanged (not mapped to 503)', other === 'boom');
  check('O8 E2 page: a signed-out (null) answer passes through (no redirect)', (await pageSessionOrUnavailable(async () => null, '/goals')) === null);
  const page = await unavailableRoute(new NextRequest('http://localhost/session-unavailable?returnTo=%2Fcaptures'));
  const html = await page.text();
  check('O9 /session-unavailable answers 503 with Retry-After, no-store and a "Try again" link to the page', page.status === 503 && page.headers.get('retry-after') === '2' && /no-store/.test(page.headers.get('cache-control') ?? '') && /href="\/captures">Try again/.test(html) && !/Sign in/i.test(html));
  check('O10 /session-unavailable sets and clears no cookie', !page.headers.get('set-cookie'));
  check('O11 returnTo accepts only same-origin paths', safeReturnPath('//evil.example/x') === '/' && safeReturnPath('https://evil.example') === '/' && safeReturnPath('/\\evil') === '/' && safeReturnPath('/goals/abc') === '/goals/abc');

  server.close();
  await deadPool.end().catch(() => undefined);
}

main()
  .catch((err) => {
    console.error(err);
    failures++;
  })
  .finally(async () => {
    await closeSessionPool().catch(() => undefined);
    await admin.end();
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
  });
