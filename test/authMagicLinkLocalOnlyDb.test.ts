/**
 * AURA-AUTH-02 -- magic-link sign-in works ONLY in authorized local development
 * (live database).
 *
 * Drives the real POST /api/auth/request-link, GET /api/auth/verify and
 * POST /api/auth/verify-code handlers with a duck-typed fake NextRequest (the
 * pattern of test/authRequestLinkQuotaDb.test.ts) across an environment matrix:
 * authorized local dev, Production, Vercel Preview / Production markers,
 * config mistakes (the opt-in copied to a deployed env), and missing or
 * ambiguous values. Email delivery runs the real Resend code path against a
 * stubbed global fetch: nothing leaves the process. Synthetic identities only
 * (@e2e.aura.local); every token is minted in-process against this local DB.
 *
 *   DATABASE_URL="postgresql://...@localhost/..." npx ts-node test/authMagicLinkLocalOnlyDb.test.ts
 */
import { Pool } from 'pg';
import * as authLib from '../apps/web/lib/auth';
import * as dbLib from '../apps/web/lib/db';
import { magicLinksEnabled, MAGIC_LINK_DISABLED_MESSAGE } from '../apps/web/lib/magicLinkGate';
import { buildSignInEmail } from '../apps/web/lib/email';
import { POST as requestLink } from '../apps/web/app/api/auth/request-link/route';
import { GET as verifyLink } from '../apps/web/app/api/auth/verify/route';
import { POST as verifyCode } from '../apps/web/app/api/auth/verify-code/route';

const dbUrl = process.env.AURA_DATABASE_URL || process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error('refusing: this suite only runs against a local disposable database');
  process.exit(1);
}

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${detail !== undefined && !condition ? ' ' + JSON.stringify(detail) : ''}`);
  if (!condition) allPassed = false;
}

// ---- call counters on the real token / user functions (CommonJS exports are patchable) ----
const calls = { mint: 0, verifyToken: 0, createUser: 0 };
const auth = authLib as any, db = dbLib as any;
const realMint = auth.createMagicLinkToken, realVerify = auth.verifyMagicLinkToken, realUser = db.getOrCreateUserForAuth;
auth.createMagicLinkToken = (...a: unknown[]) => { calls.mint++; return realMint(...a); };
auth.verifyMagicLinkToken = (...a: unknown[]) => { calls.verifyToken++; return realVerify(...a); };
db.getOrCreateUserForAuth = (...a: unknown[]) => { calls.createUser++; return realUser(...a); };
const resetCalls = () => { calls.mint = 0; calls.verifyToken = 0; calls.createUser = 0; };

// ---- captured logs (everything the routes print) ----
const logs: string[] = [];
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };
function captureLogs<T>(fn: () => Promise<T>): Promise<T> {
  const grab = (...a: unknown[]) => { logs.push(a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x, Object.getOwnPropertyNames(x ?? {})); } catch { return String(x); } }).join(' ')); };
  console.info = console.warn = console.error = grab;
  return fn().finally(() => { console.info = realConsole.info; console.warn = realConsole.warn; console.error = realConsole.error; });
}

// ---- stubbed email provider (real sendViaResend code path, fake fetch) ----
type Sent = { to: string; subject: string; html: string; text: string };
const sends: Sent[] = [];
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
  if (!String(url).startsWith('https://api.resend.com/')) throw new Error(`unexpected outbound request: ${url}`);
  const body = JSON.parse(String(init?.body ?? '{}'));
  sends.push({ to: body.to[0], subject: body.subject, html: body.html, text: body.text });
  return { ok: true, status: 200, text: async () => '' } as any;
};
const codeOf = (s: Sent) => /enter this code in the app: (\d{6})/.exec(s.text)?.[1] ?? '';

// ---- environment control ----
const env = process.env as Record<string, string | undefined>;
const KEYS = ['NODE_ENV', 'AURA_LOCAL_MAGIC_LINKS', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'AUTH_SECRET', 'RESEND_API_KEY', 'MOM_API_KEY', 'MOM_FROM_EMAIL'];
const saved = Object.fromEntries(KEYS.map((k) => [k, env[k]]));
const SECRET = saved.AUTH_SECRET && saved.AUTH_SECRET.length >= 32 ? saved.AUTH_SECRET : 'auth02-test-secret-0123456789abcdef0123456789';
function setEnv(vars: Record<string, string | undefined>, provider: boolean) {
  for (const k of KEYS) delete env[k];
  env.AUTH_SECRET = SECRET;
  if (provider) env.RESEND_API_KEY = 'stub-not-a-real-key';
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) env[k] = v;
}
function restoreEnv() {
  for (const k of KEYS) { if (saved[k] === undefined) delete env[k]; else env[k] = saved[k]; }
}

const LOCAL = { NODE_ENV: 'development', AURA_LOCAL_MAGIC_LINKS: 'true' };
// Every environment below must keep magic links OFF.
const CLOSED: Array<[string, Record<string, string | undefined>]> = [
  ['Production (NODE_ENV=production, no opt-in)', { NODE_ENV: 'production' }],
  ['Production with the opt-in copied in by mistake', { NODE_ENV: 'production', AURA_LOCAL_MAGIC_LINKS: 'true' }],
  ['Vercel Production markers + opt-in', { NODE_ENV: 'production', AURA_LOCAL_MAGIC_LINKS: 'true', VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: 'aura-prod.example.test' }],
  ['Vercel Preview markers + opt-in', { NODE_ENV: 'production', AURA_LOCAL_MAGIC_LINKS: 'true', VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'aura-preview.example.test' }],
  ['Vercel Preview markers + opt-in + NODE_ENV=development', { ...LOCAL, VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'aura-preview.example.test' }],
  ['VERCEL_ENV alone + opt-in + NODE_ENV=development', { ...LOCAL, VERCEL_ENV: 'development' }],
  ['VERCEL_URL alone + opt-in + NODE_ENV=development', { ...LOCAL, VERCEL_URL: 'x.example.test' }],
  ['missing environment (nothing set)', {}],
  ['local dev without the opt-in', { NODE_ENV: 'development' }],
  ['opt-in without NODE_ENV', { AURA_LOCAL_MAGIC_LINKS: 'true' }],
  ['NODE_ENV=test + opt-in', { NODE_ENV: 'test', AURA_LOCAL_MAGIC_LINKS: 'true' }],
  ['ambiguous opt-in "TRUE"', { NODE_ENV: 'development', AURA_LOCAL_MAGIC_LINKS: 'TRUE' }],
  ['ambiguous opt-in "1"', { NODE_ENV: 'development', AURA_LOCAL_MAGIC_LINKS: '1' }],
  ['ambiguous opt-in " true "', { NODE_ENV: 'development', AURA_LOCAL_MAGIC_LINKS: ' true ' }],
  ['empty opt-in', { NODE_ENV: 'development', AURA_LOCAL_MAGIC_LINKS: '' }],
];

// Spoofable request data is deliberately "local-looking" -- the gate must ignore it.
function fakeRequest(body: unknown, ip: string | null, url = 'http://localhost:3000/api/auth/request-link'): any {
  const u = new URL(url);
  const headers = new Map<string, string>([['host', 'localhost:3000'], ['x-forwarded-host', 'localhost:3000'], ['x-forwarded-proto', 'http']]);
  if (ip) headers.set('x-real-ip', ip);
  return {
    url,
    headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
    nextUrl: { host: u.host, origin: u.origin, searchParams: u.searchParams },
    cookies: { get: () => undefined },
    json: async () => body,
  };
}
const verifyReq = (token: string) => fakeRequest(null, '127.0.0.1', `http://localhost:3000/api/auth/verify?token=${encodeURIComponent(token)}`);

const pool = new Pool({ connectionString: dbUrl });
const RUN = `auth02-${Date.now()}`;
let n = 0;
const em = (k: string) => `${RUN}-${k}-${n++}@e2e.aura.local`;
const ipOf = (k: string) => `198.51.100.${k}-${RUN}`;
const users = async (email: string) => Number((await pool.query('SELECT count(*)::int AS c FROM "User" WHERE email = $1', [email])).rows[0].c);
const LINKISH = /\/api\/auth\/verify|token=|href=|<a[\s>]|https?:\/\//i;

async function main() {
  // ---- 1. gate truth table (pure) ----
  check('1. gate OPEN only for NODE_ENV=development + opt-in "true" + no Vercel marker', magicLinksEnabled(LOCAL) === true);
  for (const [name, vars] of CLOSED) check(`1. gate CLOSED: ${name}`, magicLinksEnabled(vars) === false);

  // ---- 2. email content policy (pure builder) ----
  {
    const codeOnly = buildSignInEmail(null, '123456');
    check('2. code-only email: subject, HTML and text carry the code', codeOnly.subject.includes('123456') && codeOnly.html.includes('123456') && codeOnly.text.includes('123456'));
    check('2. code-only email: no link, URL, href or button in HTML or text', !LINKISH.test(codeOnly.html) && !LINKISH.test(codeOnly.text) && !/Sign in<\/a>|Click the button/i.test(codeOnly.html), codeOnly);
    check('2. code-only email: clear wording ("enter this code in the app", expiry)', /enter this code in the app: 123456/.test(codeOnly.text) && /expires in 15 minutes/.test(codeOnly.text) && /Enter this code in the app/.test(codeOnly.html));
    const local = buildSignInEmail('http://localhost:3000/api/auth/verify?token=abc', '123456');
    check('2. local link email unchanged (link button + code; text has both)', local.html.includes('href="http://localhost:3000/api/auth/verify?token=abc"') && local.html.includes('123456') && local.text === 'Sign in to AuraSchedule: http://localhost:3000/api/auth/verify?token=abc\n\nOr enter this code in the app: 123456\n\nThis link and code expire in 15 minutes.' && local.subject === '123456 is your AuraSchedule sign-in code');
    let threw = false;
    try { buildSignInEmail(null, undefined); } catch { threw = true; }
    check('2. an email with neither link nor code is refused (never an empty email)', threw);
  }

  // ---- 3. authorized local development: links issued and redeemable ----
  {
    setEnv(LOCAL, false);
    resetCalls();
    const email = em('local-dev');
    const r = await requestLink(fakeRequest({ email }, ipOf('l1')));
    const body = await r.json();
    check('3. local (no provider): devLoginUrl + devLoginCode returned, token minted', r.status === 200 && /\/api\/auth\/verify\?token=/.test(body.devLoginUrl) && /^\d{6}$/.test(body.devLoginCode) && calls.mint === 1, body);
    const token = new URL(body.devLoginUrl).searchParams.get('token')!;
    const v = await verifyLink(verifyReq(token));
    check('3. local: the link signs in (307 redirect, session cookie, account created)', v.status === 307 && (v.headers.get('set-cookie') ?? '').includes('as_session=') && (await users(email)) === 1);

    setEnv(LOCAL, true);
    sends.length = 0;
    const email2 = em('local-provider');
    const r2 = await requestLink(fakeRequest({ email: email2 }, ipOf('l2')));
    const s = sends.find((x) => x.to === email2);
    check('3. local (provider): {sent:true}; the email has the link button AND the code', r2.status === 200 && JSON.stringify(await r2.json()) === '{"sent":true}' && !!s && s.html.includes('/api/auth/verify?token=') && /^\d{6}$/.test(codeOf(s)), s);
  }

  // ---- 4. every closed environment: no issuance, valid tokens rejected before any work ----
  for (const [name, vars] of CLOSED) {
    // 4a. issuance (with a provider, as deployed)
    setEnv(vars, true);
    sends.length = 0;
    resetCalls();
    logs.length = 0;
    const email = em('closed');
    const r = await captureLogs(() => requestLink(fakeRequest({ email }, ipOf(`c${n}`))));
    const body = await r.json();
    const s = sends.find((x) => x.to === email);
    const code = s ? codeOf(s) : '';
    check(`4. [${name}] request-link: 200 {sent:true}, no token minted, no link in the response`, r.status === 200 && JSON.stringify(body) === '{"sent":true}' && calls.mint === 0, { status: r.status, body, mint: calls.mint });
    check(`4. [${name}] email is code-only (code present; no link/URL/href in HTML or text)`, !!s && /^\d{6}$/.test(code) && !LINKISH.test(s.html) && !LINKISH.test(s.text), s);
    check(`4. [${name}] request-link logged nothing with the email or code`, logs.every((l) => !l.includes(email) && !(code && l.includes(code))), logs);

    // 4b. a VALID token (minted in-process with this env's secret) is refused before verification
    const victim = em('closed-token');
    const token = realMint(victim);
    resetCalls();
    logs.length = 0;
    const v = await captureLogs(() => verifyLink(verifyReq(token)));
    const vText = await v.text();
    check(`4. [${name}] verify: 403 with the fixed message, no cookie`, v.status === 403 && JSON.parse(vText).error === MAGIC_LINK_DISABLED_MESSAGE && !v.headers.get('set-cookie'), { status: v.status, vText });
    check(`4. [${name}] verify: token never verified, no user lookup/creation, no account created`, calls.verifyToken === 0 && calls.createUser === 0 && (await users(victim)) === 0, calls);
    check(`4. [${name}] verify: token and email absent from the response and logs`, !vText.includes(token) && !vText.includes(victim) && logs.every((l) => !l.includes(token) && !l.includes(victim)), logs);
    const missing = await verifyLink(fakeRequest(null, null, 'http://localhost:3000/api/auth/verify'));
    check(`4. [${name}] verify without a token: the same 403 (predictable)`, missing.status === 403);
  }

  // ---- 5. deployed dev fallback (no provider, not production) never returns a link ----
  {
    setEnv({ AURA_LOCAL_MAGIC_LINKS: 'true', VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'p.example.test' }, false);
    resetCalls();
    const r = await requestLink(fakeRequest({ email: em('fallback') }, ipOf('fb')));
    const body = await r.json();
    check('5. no provider + Vercel markers: only devLoginCode, no devLoginUrl, no token minted', r.status === 200 && body.devLoginUrl === undefined && /^\d{6}$/.test(body.devLoginCode) && calls.mint === 0, body);
    setEnv({ NODE_ENV: 'production' }, false);
    const p = await requestLink(fakeRequest({ email: em('prod-noprov') }, ipOf('pn')));
    const pb = await p.json();
    check('5. production without a provider: 500 unchanged, no credentials', p.status === 500 && pb.error === 'Sign-in email is not configured on this server.' && !pb.devLoginCode && !pb.devLoginUrl);
  }

  // ---- 6. Production: code sign-in, registration, sessions and rate limits unchanged ----
  {
    setEnv({ NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production', VERCEL_URL: 'aura-prod.example.test' }, true);
    sends.length = 0;
    logs.length = 0;
    const email = em('prod-code');
    const ip = ipOf('pc');
    const r = await captureLogs(() => requestLink(fakeRequest({ email }, ip)));
    const s = sends.find((x) => x.to === email)!;
    const code = codeOf(s);
    const v = await captureLogs(() => verifyCode(fakeRequest({ email, code }, ip)));
    const cookie = v.headers.get('set-cookie') ?? '';
    check('6. Production: request-link then verify-code with the emailed code -> 200 {ok:true} + Secure HttpOnly session cookie', r.status === 200 && v.status === 200 && (await v.json()).ok === true && cookie.includes('as_session=') && /HttpOnly/i.test(cookie) && /Secure/i.test(cookie), cookie);
    check('6. Production: open registration -- first code sign-in creates the account', (await users(email)) === 1);
    const again = await verifyCode(fakeRequest({ email, code }, ip));
    check('6. Production: a code cannot be reused (401)', again.status === 401);
    check('6. Production: the code never appears in logs', logs.every((l) => !l.includes(code)), logs);
    const rl = em('prod-rl');
    const res = [];
    for (let i = 0; i < 4; i++) res.push((await requestLink(fakeRequest({ email: rl }, ipOf(`rl${i}`)))).status);
    check('6. Production: the AUTH-01 quota still applies (200,200,200,429)', JSON.stringify(res) === '[200,200,200,429]', res);
  }
}

main()
  .catch((e) => {
    console.error(e);
    allPassed = false;
  })
  .finally(async () => {
    restoreEnv();
    (globalThis as any).fetch = realFetch;
    auth.createMagicLinkToken = realMint; auth.verifyMagicLinkToken = realVerify; db.getOrCreateUserForAuth = realUser;
    try {
      await pool.query(`DELETE FROM "AuthCode" WHERE email LIKE $1`, [`${RUN}-%`]);
      await pool.query(`DELETE FROM "User" WHERE email LIKE $1`, [`${RUN}-%`]);
    } catch (e) {
      console.error('cleanup failed', e);
    }
    await pool.end();
    console.log(`\n${count} checks, ${allPassed ? 'all passed' : 'FAILURES'}`);
    process.exit(allPassed ? 0 : 1);
  });
