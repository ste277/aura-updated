/**
 * AURA-AUTH-SESSION-01-I2-R2 (39250, design Rev 4 B3) -- session-bound MCP
 * consent finalization, end to end.
 *
 * Real pieces: the local authorization server (getLocalMcpAuth: real consent
 * handler, real Postgres OAuth adapter, real finalization hooks), the real
 * verify-code and logout routes, lib/session.ts, and TWO disposable loopback
 * databases: DATABASE_URL (Aura: sessions + McpConsentFinalization) and
 * AURA_MCP_OAUTH_DATABASE_URL (the separate MCP OAuth store). Synthetic
 * pieces only: advisory-lock barrier triggers on selected INSERTs, a TCP
 * latency/fault proxy in front of the Aura session pool, and a child process
 * that is SIGKILLed mid-consent.
 *
 *   DATABASE_URL=... AURA_MCP_OAUTH_DATABASE_URL=... npx ts-node test/mcpConsentFinalizationDb.test.ts
 */
import * as http from 'http';
import * as net from 'net';
import { spawn } from 'child_process';
import type { AddressInfo } from 'net';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { upsertUserByEmail, createAuthCode } from '../apps/web/lib/db';
import { hashAuthCode } from '../apps/web/lib/auth';
import { activeSessionCookieName, closeSessionPool, setSessionPoolForTesting } from '../apps/web/lib/session';
import { createSessionPool } from '../apps/web/lib/authSessionDb';
import { POST as verifyCode } from '../apps/web/app/api/auth/verify-code/route';
import { POST as logout } from '../apps/web/app/api/auth/logout/route';
import { isStoreUnavailableError } from '../packages/mcp-tools/src/security/deadline';
import { storageKey } from '../packages/mcp-tools/src/auth/postgresAdapter';
import { Browser, sleep } from './mcpOAuthI2bHarness';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';

const AURA = process.env.DATABASE_URL!;
const OAUTH = process.env.AURA_MCP_OAUTH_DATABASE_URL!;
for (const u of [AURA, OAUTH]) {
  if (!u || !['127.0.0.1', 'localhost', '::1'].includes(new URL(u).hostname)) {
    console.error('Refusing: DATABASE_URL and AURA_MCP_OAUTH_DATABASE_URL must be disposable loopback databases.');
    process.exit(2);
  }
}
if (new URL(AURA).pathname === new URL(OAUTH).pathname && new URL(AURA).port === new URL(OAUTH).port) {
  console.error('Refusing: the Aura and OAuth databases must be different databases.');
  process.exit(2);
}
Object.assign(process.env, { NODE_ENV: 'development', AURA_MCP_AUTH_MODE: 'local-dev', AURA_MCP_OAUTH_STORE: 'postgres' });

const CHILD = process.env.R2_CHILD_TOKEN;
const aura = new Pool({ connectionString: AURA, max: 4 });
const oauth = new Pool({ connectionString: OAUTH, max: 4 });
const NAME = activeSessionCookieName();
const REDIRECT = 'http://127.0.0.1:8976/callback';
const KEY_OAUTH = 7725001;
const KEY_FIN = 7725002;
const BUDGET_SLACK_MS = 400;

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, note: unknown = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${!ok && note !== '' ? ' -- ' + JSON.stringify(note).slice(0, 500) : ''}`);
  if (ok) passes++;
  else failures++;
}

// ------------------------------------------------------------------ server -----
async function startServer() {
  const { getLocalMcpAuth, LOCAL_DEV_CLIENT_ID } = await import('../apps/web/lib/mcpLocalOAuth');
  let handle: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => undefined;
  const server = http.createServer((req, res) => handle(req, res));
  server.keepAliveTimeout = 1;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const resource = `${origin}/api/mcp`;
  const state = getLocalMcpAuth({ authorizationServer: origin, resourceUrl: resource });
  handle = (req, res) => {
    const url = new URL(req.url ?? '/', origin);
    void state.server.handle(req, res, url.pathname, url.search);
  };
  return { server, origin, resource, state, clientId: LOCAL_DEV_CLIENT_ID };
}
type Srv = Awaited<ReturnType<typeof startServer>>;

async function signIn(email: string): Promise<string> {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await aura.query(`DELETE FROM "AuthCode" WHERE email = $1`, [email]);
  await createAuthCode({ email, codeHash: hashAuthCode(email, code), expiresAt: new Date(Date.now() + 600_000) });
  const res = await verifyCode(new NextRequest('http://localhost/api/auth/verify-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) }));
  const sc = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie().find((c) => c.startsWith(NAME + '='))!;
  return decodeURIComponent(sc.slice(NAME.length + 1).split(';')[0]);
}
const doLogout = (token: string) => logout(new NextRequest('http://localhost/api/auth/logout', { method: 'POST', headers: { cookie: `${NAME}=${token}` } }));
const b64 = (b: Buffer) => b.toString('base64url');

interface Pending {
  browser: Browser;
  verifier: string;
  csrf: string;
  action: string;
  uid: string;
}
/** Runs the authorization request up to the consent page. */
async function toConsent(s: Srv, token: string, scope = `${MCP_SCOPE} offline_access`, existing?: Browser): Promise<Pending> {
  const browser = existing ?? new Browser(s.origin);
  browser.jar.set(NAME, token);
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: s.clientId, redirect_uri: REDIRECT, response_type: 'code', scope, resource: s.resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's', prompt: 'consent' });
  let res = await browser.fetch(`/oauth/authorize?${q}`);
  for (let i = 0; i < 10; i++) {
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      res = await browser.fetch(loc);
      continue;
    }
    break;
  }
  const html = await res.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  const action = /action="([^"]+\/confirm)"/.exec(html)?.[1];
  if (!csrf || !action) throw new Error(`no consent page (${res.status}): ${html.slice(0, 200)}`);
  return { browser, verifier, csrf, action, uid: decodeURIComponent(action.split('/').slice(-2)[0]) };
}
const approve = (s: Srv, p: Pending) => p.browser.fetch(p.action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: s.origin }, body: `csrf=${encodeURIComponent(p.csrf)}` });
/** Follows redirects after the consent POST to the client callback. */
async function followToCode(p: Pending, res: Response): Promise<{ code?: string; status: number; consentAgain: boolean; error?: string }> {
  for (let i = 0; i < 10; i++) {
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (loc.startsWith(REDIRECT)) {
        const u = new URL(loc);
        return { code: u.searchParams.get('code') ?? undefined, error: u.searchParams.get('error') ?? undefined, status: res.status, consentAgain: false };
      }
      res = await p.browser.fetch(loc);
      continue;
    }
    const html = await res.text();
    return { status: res.status, consentAgain: /name="csrf"/.test(html) };
  }
  return { status: 0, consentAgain: false };
}
async function tokenReq(s: Srv, body: Record<string, string>) {
  const r = await fetch(`${s.origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, string> };
}
const redeem = (s: Srv, code: string, verifier: string) => tokenReq(s, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: s.clientId, code_verifier: verifier, resource: s.resource });
const refreshReq = (s: Srv, rt: string) => tokenReq(s, { grant_type: 'refresh_token', refresh_token: rt, client_id: s.clientId, resource: s.resource });
async function resource(s: Srv, at: string): Promise<string | null | 'unavailable'> {
  try {
    return (await s.state.server.verifyAccessToken(at, s.resource))?.userId ?? null;
  } catch (err) {
    return isStoreUnavailableError(err) ? 'unavailable' : (`threw:${(err as Error).name}` as never);
  }
}
async function connect(s: Srv, token: string) {
  const p = await toConsent(s, token);
  const res = await approve(s, p);
  const out = await followToCode(p, res);
  if (!out.code) throw new Error(`connect failed: ${JSON.stringify(out)}`);
  const t = await redeem(s, out.code, p.verifier);
  return { p, code: out.code, tokens: t.json, status: t.status };
}

// ------------------------------------------------------------------ DB helpers --
const finRows = async (userId: string) => (await aura.query(`SELECT "grantKey", "clientId", "authorization", "authSessionIdHash", "expiresAt" FROM "McpConsentFinalization" WHERE "userId" = $1`, [userId])).rows;
const grantRows = async (userId: string) => (await oauth.query(`SELECT "grantId" FROM "McpOAuthPayload" WHERE model = 'Grant' AND "accountId" = $1 ORDER BY "createdAt"`, [userId])).rows.map((r) => r.grantId as string);
const finalizedKeys = async (userId: string) => new Set((await finRows(userId)).map((r) => r.grantKey as string));
const unfinalizedGrants = async (userId: string) => {
  const keys = await finalizedKeys(userId);
  return (await grantRows(userId)).filter((g) => !keys.has(storageKey(g)));
};

async function installBarriers() {
  await oauth.query(`CREATE TABLE IF NOT EXISTS r2_ctl (model text PRIMARY KEY)`);
  await oauth.query(`CREATE OR REPLACE FUNCTION r2_oauth_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS (SELECT 1 FROM r2_ctl WHERE model = NEW.model) THEN PERFORM pg_advisory_xact_lock(${KEY_OAUTH}); END IF; RETURN NEW; END $$`);
  await oauth.query(`DROP TRIGGER IF EXISTS r2_oauth_barrier ON "McpOAuthPayload"`);
  await oauth.query(`CREATE TRIGGER r2_oauth_barrier BEFORE INSERT ON "McpOAuthPayload" FOR EACH ROW EXECUTE FUNCTION r2_oauth_barrier()`);
  await aura.query(`CREATE TABLE IF NOT EXISTS r2_ctl (model text PRIMARY KEY)`);
  await aura.query(`CREATE OR REPLACE FUNCTION r2_fin_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS (SELECT 1 FROM r2_ctl WHERE model = 'fin') THEN PERFORM pg_advisory_xact_lock(${KEY_FIN}); END IF; RETURN NEW; END $$`);
  await aura.query(`DROP TRIGGER IF EXISTS r2_fin_barrier ON "McpConsentFinalization"`);
  await aura.query(`CREATE TRIGGER r2_fin_barrier BEFORE INSERT ON "McpConsentFinalization" FOR EACH ROW EXECUTE FUNCTION r2_fin_barrier()`);
}
async function removeBarriers() {
  await oauth.query(`DROP TRIGGER IF EXISTS r2_oauth_barrier ON "McpOAuthPayload"`).catch(() => undefined);
  await oauth.query(`DROP TABLE IF EXISTS r2_ctl`).catch(() => undefined);
  await aura.query(`DROP TRIGGER IF EXISTS r2_fin_barrier ON "McpConsentFinalization"`).catch(() => undefined);
  await aura.query(`DROP TABLE IF EXISTS r2_ctl`).catch(() => undefined);
}
/** Holds the barrier for `model` ('Grant' / 'Interaction' on the OAuth DB, 'fin' on the Aura DB) until released. */
async function hold(model: 'Grant' | 'Interaction' | 'fin') {
  const db = model === 'fin' ? aura : oauth;
  const key = model === 'fin' ? KEY_FIN : KEY_OAUTH;
  const c = await db.connect();
  await c.query('SELECT pg_advisory_lock($1)', [key]);
  await db.query(`INSERT INTO r2_ctl (model) VALUES ($1) ON CONFLICT DO NOTHING`, [model]);
  let held = true;
  return async () => {
    if (!held) return;
    held = false;
    await db.query(`DELETE FROM r2_ctl WHERE model = $1`, [model]);
    await c.query('SELECT pg_advisory_unlock($1)', [key]);
    c.release();
  };
}
async function waitFor(f: () => Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await f()) return true;
    await sleep(15);
  }
  return false;
}
const waitingOn = (db: Pool, like: string) => async () => (await db.query(`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1`, [like])).rowCount! > 0;
const grantWaiting = waitingOn(oauth, '%INSERT INTO "McpOAuthPayload"%');
const finWaiting = waitingOn(aura, '%INSERT INTO "McpConsentFinalization"%');
const finPid = async () => (await aura.query(`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query ILIKE '%INSERT INTO "McpConsentFinalization"%' AND pid <> pg_backend_pid()`)).rows[0]?.pid as number | undefined;

/** TCP proxy in front of the Aura session pool: per-chunk predicate -> delay or cut after forwarding. */
async function startProxy(upstream: string) {
  const up = new URL(upstream);
  const rules: Array<{ when: (chunk: Buffer) => boolean; action: 'delay' | 'drop-after-forward'; ms?: number; once?: boolean; fired?: boolean }> = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstreamSock = net.connect(Number(up.port || 5432), up.hostname);
    sockets.add(client);
    sockets.add(upstreamSock);
    let chain = Promise.resolve();
    client.on('data', (chunk) => {
      const rule = rules.find((r) => !(r.once && r.fired) && r.when(chunk));
      if (rule) rule.fired = true;
      chain = chain.then(async () => {
        if (rule?.action === 'delay') await sleep(rule.ms ?? 0);
        if (!upstreamSock.destroyed) upstreamSock.write(chunk);
        if (rule?.action === 'drop-after-forward') {
          client.destroy();
          setTimeout(() => upstreamSock.destroy(), 300);
        }
      });
    });
    upstreamSock.on('data', (c) => !client.destroyed && client.write(c));
    const end = () => {
      client.destroy();
      upstreamSock.destroy();
    };
    client.on('error', end);
    upstreamSock.on('error', end);
    client.on('close', () => setTimeout(() => upstreamSock.destroy(), 300));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = new URL(upstream);
  url.host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: url.toString(), rules, close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }) };
}
const isLoneCommit = (c: Buffer) => c.includes('COMMIT') && !/SELECT|INSERT|UPDATE|DELETE|\$auth_session_commit\$/.test(c.toString('latin1'));

// ------------------------------------------------------------------ child (crash) --
async function childMain(token: string) {
  const s = await startServer();
  const p = await toConsent(s, token);
  process.stdout.write('CONSENT_READY\n');
  await approve(s, p); // the parent SIGKILLs this process while finalization waits on its barrier
  process.stdout.write('CHILD_FINISHED_UNEXPECTEDLY\n');
  process.exit(0);
}

// ------------------------------------------------------------------ main ---------
async function main() {
  await installBarriers();
  const s = await startServer();
  const userFor = async (tag: string) => {
    // Each scenario starts with fresh pre-auth limiter windows (the suite makes many OAuth requests).
    await oauth.query(`DELETE FROM "McpRateLimitWindow"`);
    const email = `r2-${tag}@example.test`;
    const u = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' });
    await oauth.query(`DELETE FROM "McpOAuthPayload" WHERE "accountId" = $1`, [u.id]);
    await aura.query(`DELETE FROM "McpConsentFinalization" WHERE "userId" = $1`, [u.id]);
    return { id: u.id, email, token: await signIn(email) };
  };

  // ---- C0 control: a complete authorization on every path ------------------------
  const u0 = await userFor('control');
  const c0 = await connect(s, u0.token);
  const f0 = await finRows(u0.id);
  const g0 = await grantRows(u0.id);
  check('C0 control: consent -> code -> tokens (200, access + refresh)', c0.status === 200 && !!c0.tokens.access_token && !!c0.tokens.refresh_token, c0.tokens);
  check('C0 one finalization row in the AURA database binds the exact grant, account, client and authorization', f0.length === 1 && g0.length === 1 && f0[0].grantKey === storageKey(g0[0]) && f0[0].clientId === s.clientId && f0[0].authorization.split('\n').includes('oidc:offline_access') && f0[0].authorization.split('\n').includes(`res:${s.resource} ${MCP_SCOPE}`), { f0, g0 });
  const oauthHasTable = (await oauth.query(`SELECT to_regclass('"McpConsentFinalization"') AS t`)).rows[0].t !== null;
  const oauthRows = oauthHasTable ? (await oauth.query(`SELECT count(*)::int n FROM "McpConsentFinalization"`)).rows[0].n : 0;
  check('C0 the finalization lives only in the AURA database: none in the OAuth database (separation kept)', oauthRows === 0, { oauthHasTable, oauthRows });
  check('C0 MCP resource access and refresh work; the connection is listed', (await resource(s, c0.tokens.access_token)) === u0.id && (await refreshReq(s, c0.tokens.refresh_token)).status === 200 && (await s.state.server.listUserConnections(u0.id)).length === 1);

  // ---- C1 a completed authorization survives ordinary logout ----------------------
  const c1 = await connect(s, u0.token);
  await doLogout(u0.token);
  const r1 = await refreshReq(s, c1.tokens.refresh_token);
  check('C1 after ordinary logout a completed connection keeps working (resource, refresh, listing)', (await resource(s, c1.tokens.access_token)) === u0.id && r1.status === 200 && (await s.state.server.listUserConnections(u0.id)).length === 2, r1);

  // ---- C2 finalization first, logout concurrent: strictly ordered, completed -------
  const u2 = await userFor('fin-first');
  {
    const p = await toConsent(s, u2.token);
    const release = await hold('fin');
    const approving = approve(s, p);
    const reached = await waitFor(finWaiting);
    const lo = doLogout(u2.token);
    const settledEarly = await Promise.race([lo.then(() => true), sleep(500).then(() => false)]);
    await release();
    const [res, out] = await Promise.all([approving, lo]);
    const after = await followToCode(p, res);
    const fr = await finRows(u2.id);
    const rev = (await aura.query(`SELECT "revokedAt" FROM "AuthSession" WHERE "userId" = $1`, [u2.id])).rows[0];
    check('C2 finalization holds FOR SHARE: logout waits for it (not settled while finalization is paused)', reached && !settledEarly && out.status === 200 && !!rev?.revokedAt, { reached, settledEarly });
    check('C2 the finalization committed first (completed authorization row exists); the logout then committed', fr.length === 1 && fr[0].grantKey === storageKey((await grantRows(u2.id))[0]), { fr: fr.length });
    check('C2 resuming after that logout issues no code (the login re-check sees the revoked session)', after.code === undefined && after.status === 401, after);
  }

  // ---- C3 logout first, grant write commits AFTER logout (the original F1 witness) -
  const u3 = await userFor('logout-first');
  {
    const p = await toConsent(s, u3.token);
    const release = await hold('Grant');
    const approving = approve(s, p);
    const reached = await waitFor(grantWaiting);
    const out = await doLogout(u3.token);
    await release();
    const res = await approving;
    const body = await res.clone().text();
    const unfinal = await unfinalizedGrants(u3.id);
    check('C3 logout committed while the grant write was paused; the grant then committed LATE in the OAuth DB', reached && out.status === 200 && unfinal.length === 1, { reached, out: out.status, unfinal });
    check('C3 the late grant is never finalized: consent refused (401), no finalization row', res.status === 401 && /Sign in/i.test(body) && (await finRows(u3.id)).length === 0, { status: res.status });
    const grantFound = await s.state.server.provider.Grant.find(unfinal[0]);
    check('C3 the late grant is invisible to the provider (Grant.find), not listed, and no code was issued', grantFound === undefined && (await s.state.server.listUserConnections(u3.id)).length === 0 && !(await followToCode(p, res)).code);
  }

  // ---- C4 finalization connection terminated mid-statement ---------------------------
  const u4 = await userFor('terminated');
  {
    const p = await toConsent(s, u4.token);
    const release = await hold('fin');
    const approving = approve(s, p);
    await waitFor(finWaiting);
    const pid = await finPid();
    if (pid) await aura.query('SELECT pg_terminate_backend($1)', [pid]);
    await doLogout(u4.token);
    await release();
    const res = await approving;
    check('C4 finalization backend terminated -> 503 + Retry-After, no finalization, grant unusable', !!pid && res.status === 503 && res.headers.get('retry-after') !== null && (await finRows(u4.id)).length === 0 && (await unfinalizedGrants(u4.id)).length === 1, { pid, status: res.status });
  }

  // ---- C5 idle-in-transaction timeout before COMMIT (COMMIT delayed past the budget) --
  const u5 = await userFor('idle');
  const proxy = await startProxy(AURA);
  const proxied = createSessionPool(proxy.url);
  {
    const p = await toConsent(s, u5.token);
    setSessionPoolForTesting(proxied);
    proxy.rules.push({ when: isLoneCommit, action: 'delay', ms: 2600, once: true });
    const t0 = Date.now();
    const res = await approve(s, p);
    const ms = Date.now() - t0;
    await sleep(2800);
    setSessionPoolForTesting(null);
    proxy.rules.length = 0;
    check('C5 COMMIT held past the budget (server idle-in-transaction timeout) -> 503 within the 2 s budget, nothing committed', res.status === 503 && ms <= 2000 + BUDGET_SLACK_MS && (await finRows(u5.id)).length === 0, { status: res.status, ms });
    check('C5 the interaction was not finished: resuming shows consent again, no code', (await followToCode(p, await p.browser.fetch(`/oauth/auth/${encodeURIComponent(p.uid)}`))).code === undefined);
  }

  // ---- C6 ambiguous finalization COMMIT that DID commit --------------------------------
  const u6 = await userFor('ambiguous');
  {
    const p = await toConsent(s, u6.token);
    setSessionPoolForTesting(proxied);
    proxy.rules.push({ when: isLoneCommit, action: 'drop-after-forward', once: true });
    const res = await approve(s, p);
    setSessionPoolForTesting(null);
    proxy.rules.length = 0;
    await sleep(400);
    const fr = await finRows(u6.id);
    const resume = await followToCode(p, await p.browser.fetch(`/oauth/auth/${encodeURIComponent(p.uid)}`));
    check('C6 COMMIT reached the server (row committed) but the reply was lost -> 503, interaction NOT finished', res.status === 503 && fr.length === 1, { status: res.status, rows: fr.length });
    check('C6 an ambiguous finalization never completes the interaction: resume issues no code', resume.code === undefined, resume);
  }
  await proxied.end().catch(() => undefined);
  await proxy.close();

  // ---- C7 session expired by the DATABASE clock while the consent is in flight ------
  const u7 = await userFor('expired');
  {
    const p = await toConsent(s, u7.token);
    const release = await hold('Grant');
    const approving = approve(s, p);
    await waitFor(grantWaiting);
    await aura.query(`UPDATE "AuthSession" SET "expiresAt" = "createdAt" + interval '1 millisecond' WHERE "userId" = $1`, [u7.id]);
    await release();
    const res = await approving;
    check('C7 session expired (database clock) before finalization -> refused, no finalization, grant unusable', res.status === 401 && (await finRows(u7.id)).length === 0 && (await unfinalizedGrants(u7.id)).length === 1, { status: res.status });
  }

  // ---- C8 outages: consent, token and MCP resource boundaries -----------------------------
  const dead = new URL(AURA);
  dead.pathname = '/r2_database_that_does_not_exist';
  const deadPool = createSessionPool(dead.toString());
  const u8 = await userFor('outage');
  {
    const p = await toConsent(s, u8.token);
    const release = await hold('Grant');
    const approving = approve(s, p);
    await waitFor(grantWaiting);
    setSessionPoolForTesting(deadPool);
    await release();
    const res = await approving;
    setSessionPoolForTesting(null);
    check('C8a Aura DB down at finalization -> 503 + Retry-After (not sign-in), no finalization, grant unusable', res.status === 503 && res.headers.get('retry-after') !== null && (await finRows(u8.id)).length === 0 && (await unfinalizedGrants(u8.id)).length === 1, { status: res.status });

    const live = await connect(s, u8.token);
    const p2 = await toConsent(s, u8.token);
    const code2 = (await followToCode(p2, await approve(s, p2))).code!;
    setSessionPoolForTesting(deadPool);
    const red = await redeem(s, code2, p2.verifier);
    const ref = await refreshReq(s, live.tokens.refresh_token);
    const res3 = await resource(s, live.tokens.access_token);
    let listed = 'ok';
    try {
      await s.state.server.listUserConnections(u8.id);
    } catch (err) {
      listed = isStoreUnavailableError(err) ? 'unavailable' : 'threw';
    }
    setSessionPoolForTesting(null);
    check('C8b Aura DB down at code redemption / refresh -> 503 (not invalid_grant)', red.status === 503 && ref.status === 503, { red, ref });
    check('C8c Aura DB down at MCP resource access -> unavailable (503 at /api/mcp), never "invalid token"; listing -> unavailable', res3 === 'unavailable' && listed === 'unavailable', { res3, listed });
    const red2 = await redeem(s, code2, p2.verifier);
    const ref2 = await refreshReq(s, live.tokens.refresh_token);
    check('C8d after recovery nothing was revoked or consumed: the same code redeems, the same refresh token rotates, the token works', red2.status === 200 && ref2.status === 200 && (await resource(s, live.tokens.access_token)) === u8.id, { red2: red2.status, ref2: ref2.status });
  }

  // ---- C9 process interruption between grant persistence and finalization -----------
  const u9 = await userFor('crash');
  {
    const release = await hold('fin');
    const child = spawn(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', __filename], { env: { ...process.env, R2_CHILD_TOKEN: u9.token }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    const reached = await waitFor(finWaiting, 30_000);
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;
    await sleep(300);
    await release();
    await sleep(300);
    check('C9 consent process SIGKILLed while finalization was in flight: grant persisted, NO finalization, grant unusable and unlisted', reached && !out.includes('CHILD_FINISHED') && (await finRows(u9.id)).length === 0 && (await unfinalizedGrants(u9.id)).length === 1 && (await s.state.server.listUserConnections(u9.id)).length === 0, { reached, out });
  }

  // ---- C10 every enabled path refuses a grant whose finalization is missing / mismatched ----
  const u10 = await userFor('paths');
  {
    // consent resume / code issuance
    const p = await toConsent(s, u10.token);
    const res = await approve(s, p);
    await aura.query(`DELETE FROM "McpConsentFinalization" WHERE "userId" = $1`, [u10.id]);
    const resumed = await followToCode(p, res);
    check('C10a resume with an unfinalized grant: no code is issued (consent is required again)', resumed.code === undefined, resumed);
    // code redemption
    const p2 = await toConsent(s, u10.token);
    const code = (await followToCode(p2, await approve(s, p2))).code!;
    await aura.query(`DELETE FROM "McpConsentFinalization" WHERE "userId" = $1`, [u10.id]);
    const red = await redeem(s, code, p2.verifier);
    check('C10b code redemption with an unfinalized grant -> invalid_grant, no tokens', red.status === 400 && red.json.error === 'invalid_grant' && !red.json.access_token, red);
    // refresh + resource + listing
    const live = await connect(s, u10.token);
    const [row] = await finRows(u10.id);
    await aura.query(`DELETE FROM "McpConsentFinalization" WHERE "userId" = $1`, [u10.id]);
    check('C10c refresh with an unfinalized grant -> invalid_grant', (await refreshReq(s, live.tokens.refresh_token)).json.error === 'invalid_grant');
    check('C10d MCP resource access with an unfinalized grant -> refused', (await resource(s, live.tokens.access_token)) === null);
    check('C10e listing excludes unfinalized grants', (await s.state.server.listUserConnections(u10.id)).length === 0);
    // mismatches
    const live2 = await connect(s, u10.token);
    const [r2] = await finRows(u10.id);
    const reinsert = async (over: Record<string, string>) => {
      await aura.query(`DELETE FROM "McpConsentFinalization" WHERE "grantKey" = $1`, [r2.grantKey]);
      const v = { clientId: r2.clientId, authorization: r2.authorization, userId: u10.id, ...over };
      await aura.query(`INSERT INTO "McpConsentFinalization" ("grantKey","userId","clientId","authorization","authSessionIdHash","expiresAt") VALUES ($1,$2,$3,$4,$5,$6)`, [r2.grantKey, v.userId, v.clientId, v.authorization, r2.authSessionIdHash, r2.expiresAt]);
      return resource(s, live2.tokens.access_token);
    };
    const u10b = await userFor('paths-other');
    check('C10f mismatched client -> refused', (await reinsert({ clientId: 'some-other-client' })) === null);
    check('C10g mismatched account -> refused', (await reinsert({ userId: u10b.id })) === null);
    check('C10h narrower finalized authorization (grant carries more) -> refused', (await reinsert({ authorization: `res:${s.resource} ${MCP_SCOPE}` })) === null);
    check('C10i malformed finalized authorization -> refused', (await reinsert({ authorization: '\n' })) === null);
    check('C10j the original finalization restores access (controls are not vacuous)', (await reinsert({})) === u10.id);
    await aura.query(`UPDATE "McpConsentFinalization" SET "expiresAt" = "createdAt" + interval '1 millisecond' WHERE "grantKey" = $1`, [r2.grantKey]).catch(() => undefined);
    void row;
  }

  // ---- C11 immutability, scope extension and grant reuse -------------------------------------
  const u11 = await userFor('immutable');
  {
    const live = await connect(s, u11.token);
    const [fr] = await finRows(u11.id);
    let updateBlocked = false;
    try {
      await aura.query(`UPDATE "McpConsentFinalization" SET "authorization" = "authorization" || E'\\noidc:openid' WHERE "grantKey" = $1`, [fr.grantKey]);
    } catch {
      updateBlocked = true;
    }
    const dup = await aura.query(`INSERT INTO "McpConsentFinalization" ("grantKey","userId","clientId","authorization","authSessionIdHash","expiresAt") VALUES ($1,$2,$3,'oidc:openid',$4, now() + interval '1 day') ON CONFLICT ("grantKey") DO NOTHING`, [fr.grantKey, u11.id, s.clientId, fr.authSessionIdHash]);
    check('C11a a finalization can never be rewritten to widen it (UPDATE blocked; a second INSERT does nothing)', updateBlocked && dup.rowCount === 0 && (await finRows(u11.id))[0].authorization === fr.authorization);
    const [grantId] = await grantRows(u11.id);
    const g = await s.state.server.provider.Grant.find(grantId);
    g!.addOIDCScope('openid');
    await g!.save();
    check('C11b a grant extended after finalization (scope expansion) is refused on every use', (await resource(s, live.tokens.access_token)) === null && (await refreshReq(s, live.tokens.refresh_token)).json.error === 'invalid_grant');
    // A clean, finalized connection; then re-consent in the SAME browser, whose provider session
    // already points at that grant (the case a reuse would take).
    const base = await connect(s, u11.token);
    const baseGrants = await grantRows(u11.id);
    const pAgain = await toConsent(s, u11.token, undefined, base.p.browser);
    const codeAgain = (await followToCode(pAgain, await approve(s, pAgain))).code;
    const again = codeAgain ? (await redeem(s, codeAgain, pAgain.verifier)).json : {};
    const grants = await grantRows(u11.id);
    check('C11c re-consent in the SAME browser never reuses or extends the earlier grant (new grant id, own finalization; earlier connection intact)', grants.length === baseGrants.length + 1 && !baseGrants.includes(grants[grants.length - 1]) && (await finRows(u11.id)).length === grants.length && (await resource(s, again.access_token)) === u11.id && (await resource(s, base.tokens.access_token)) === u11.id, { baseGrants: baseGrants.length, grants: grants.length, code: !!codeAgain });
  }

  // ---- C12 consent retry and resume after a refusal or 503 ------------------------------------
  const u12 = await userFor('retry');
  {
    const p = await toConsent(s, u12.token);
    setSessionPoolForTesting(deadPool);
    const first = await approve(s, p);
    setSessionPoolForTesting(null);
    const retry = await approve(s, p);
    const out = await followToCode(p, retry);
    check('C12a after a 503, retrying the same consent POST finalizes a NEW grant against the live session', first.status === 503 && !!out.code && (await finRows(u12.id)).length === 1, { first: first.status, out });
    const token2 = await signIn(u12.email);
    const p2 = await toConsent(s, token2);
    await doLogout(token2);
    const r2 = await approve(s, p2);
    check('C12b retrying after logout is refused (session no longer live); no new finalization', [401, 303].includes(r2.status) && (await followToCode(p2, r2)).code === undefined && (await finRows(u12.id)).length === 1, { status: r2.status });
  }

  // ---- C13 connection revocation and account deletion ---------------------------------------------
  const u13 = await userFor('revoke');
  {
    const live = await connect(s, u13.token);
    const n = await s.state.server.revokeUserClientGrants(u13.id, s.clientId);
    check('C13a disconnect revokes as before: token refused, refresh refused, nothing listed', n === 1 && (await resource(s, live.tokens.access_token)) === null && (await refreshReq(s, live.tokens.refresh_token)).status === 400 && (await s.state.server.listUserConnections(u13.id)).length === 0);
    const live2 = await connect(s, u13.token);
    await aura.query(`DELETE FROM "User" WHERE id = $1`, [u13.id]);
    check('C13b account deletion removes its finalizations (cascade) and the grant becomes unusable', (await finRows(u13.id)).length === 0 && (await resource(s, live2.tokens.access_token)) === null);
  }

  // ---- C14 the shared 2 000 ms consent budget, exhausted at each stage -------------------------------
  const u14 = await userFor('budget');
  const timed = async (label: string, setup: () => Promise<() => Promise<void>>, expectRows: number, extra?: (status: number) => boolean) => {
    const p = await toConsent(s, u14.token);
    const before = (await finRows(u14.id)).length;
    const cleanup = await setup();
    const t0 = Date.now();
    const res = await approve(s, p);
    const ms = Date.now() - t0;
    await cleanup();
    await sleep(300);
    const rows = (await finRows(u14.id)).length - before;
    const resume = await followToCode(p, await p.browser.fetch(`/oauth/auth/${encodeURIComponent(p.uid)}`));
    check(`C14 ${label}: 503 + Retry-After within the 2 s budget, ${expectRows} finalization row(s), interaction not finished`, res.status === 503 && res.headers.get('retry-after') !== null && ms <= 2000 + BUDGET_SLACK_MS && rows === expectRows && resume.code === undefined && (extra ? extra(res.status) : true), { status: res.status, ms, rows, resume });
  };
  const proxy2 = await startProxy(AURA);
  const proxied2 = createSessionPool(proxy2.url);
  await timed('(a) session verification slow (pool acquisition + lookup)', async () => {
    setSessionPoolForTesting(proxied2);
    proxy2.rules.push({ when: (c) => c.includes('FROM "AuthSession"') && !c.includes('McpConsentFinalization'), action: 'delay', ms: 2500, once: true });
    return async () => {
      setSessionPoolForTesting(null);
      proxy2.rules.length = 0;
    };
  }, 0);
  await timed('(b) grant persistence slow (OAuth store)', async () => {
    const release = await hold('Grant');
    setTimeout(() => void release(), 2600);
    return async () => {
      await sleep(800);
      await release();
    };
  }, 0);
  let finalizeSent = false;
  await timed('(c) under 300 ms left after the grant save: finalization not attempted', async () => {
    // The session verification uses ~1.75 s of the budget; the grant save is fast; < 300 ms remain.
    setSessionPoolForTesting(proxied2);
    proxy2.rules.push({ when: (c) => c.includes('FROM "AuthSession"') && !c.includes('McpConsentFinalization'), action: 'delay', ms: 1750, once: true });
    proxy2.rules.push({ when: (c) => { if (c.includes('McpConsentFinalization')) finalizeSent = true; return false; }, action: 'delay' });
    return async () => {
      setSessionPoolForTesting(null);
      proxy2.rules.length = 0;
    };
  }, 0, () => !finalizeSent);
  await timed('(d) finalization slow (statement clamped to the remaining budget)', async () => {
    const release = await hold('fin');
    return async () => {
      await sleep(1200);
      await release();
    };
  }, 0);
  await timed('(e) interaction completion slow (after a confirmed finalization)', async () => {
    const release = await hold('Interaction');
    return async () => {
      await sleep(1200);
      await release();
    };
  }, 1);
  await proxied2.end().catch(() => undefined);
  await proxy2.close();
  check('C14 (c) the finalization statement was never sent with under 300 ms left', !finalizeSent);

  // ---- residue ---------------------------------------------------------------------------------------
  const idle = await aura.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()`);
  check('R1 no Aura backend is left idle in transaction', idle.rows[0].n === 0, idle.rows[0].n);
  await deadPool.end().catch(() => undefined);
  s.server.close();
}

if (CHILD) {
  childMain(CHILD).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  main()
    .catch((err) => {
      console.error(err);
      failures++;
    })
    .finally(async () => {
      await removeBarriers();
      await closeSessionPool().catch(() => undefined);
      await aura.end();
      await oauth.end();
      console.log(`\n${passes} passed, ${failures} failed`);
      process.exit(failures === 0 ? 0 : 1);
    });
}
