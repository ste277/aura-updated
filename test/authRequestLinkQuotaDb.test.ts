/**
 * AURA-AUTH-01 -- sign-in rate limit under concurrency (live database).
 *
 * Drives the real POST /api/auth/request-link and POST /api/auth/verify-code
 * handlers with a duck-typed fake NextRequest (the established pattern of
 * test/availabilityPreferencesApi.test.ts). Email delivery runs the real
 * Resend code path against a stubbed global fetch: no email ever leaves the
 * process, and any other outbound request fails the suite.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/authRequestLinkQuotaDb.test.ts
 */
import { Pool } from 'pg';
import { hashAuthCode } from '../apps/web/lib/auth';
import { POST as requestLink } from '../apps/web/app/api/auth/request-link/route';
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

// ---- stubbed email provider (real sendViaResend code path, fake fetch) ----
type Sent = { to: string; code: string; failed: boolean };
const sends: Sent[] = [];
let failWhen: (to: string, n: number) => boolean = () => false;
let attempts = 0;
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
  if (!String(url).startsWith('https://api.resend.com/')) throw new Error(`unexpected outbound request: ${url}`);
  const body = JSON.parse(String(init?.body ?? '{}'));
  const to = body.to[0] as string;
  const code = /enter this code in the app: (\d{6})/.exec(body.text)?.[1] ?? '';
  const n = attempts++; // entry order, taken before the simulated network delay
  await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 60)));
  const failed = failWhen(to, n);
  sends.push({ to, code, failed });
  return { ok: !failed, status: failed ? 503 : 200, text: async () => (failed ? 'stub outage' : '') } as any;
};
function useEmailProvider(on: boolean) {
  delete process.env.MOM_API_KEY;
  delete process.env.MOM_FROM_EMAIL;
  if (on) process.env.RESEND_API_KEY = 'stub-not-a-real-key';
  else delete process.env.RESEND_API_KEY;
}

function fakeRequest(body: unknown, ip: string | null, opts: { malformed?: boolean } = {}): any {
  const headers = new Map<string, string>([['host', 'aura.test.local'], ['x-forwarded-proto', 'https']]);
  if (ip) headers.set('x-real-ip', ip);
  return {
    headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
    nextUrl: { host: 'aura.test.local', origin: 'https://aura.test.local' },
    cookies: { get: () => undefined },
    json: async () => {
      if (opts.malformed) throw new SyntaxError('Unexpected token');
      return body;
    },
  };
}
async function call(email: string, ip: string | null) {
  const res = await requestLink(fakeRequest({ email }, ip));
  return { status: res.status, body: await res.json() };
}

const pool = new Pool({ connectionString: dbUrl });
const RUN = `auth01-${Date.now()}`;
const em = (k: string) => `${RUN}-${k}@e2e.aura.local`;
const ipOf = (k: string) => `198.51.100.${k}-${RUN}`; // never a real address; unique per run
const rowsFor = async (where: string, params: unknown[]) =>
  Number((await pool.query(`SELECT count(*)::int AS c FROM "AuthCode" WHERE ${where}`, params)).rows[0].c);

const LIMIT_MSG = 'Too many sign-in requests. Try again in about 10 minutes.';
const OUTAGE_MSG = "Our email provider isn't responding right now. Please try again in a few minutes.";

async function main() {
  useEmailProvider(true);

  // ---- 1. ten concurrent requests to ONE email (distinct IPs) ----
  {
    sends.length = 0;
    const email = em('one-email');
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => call(email, ipOf(`a${i}`))));
    const ok = res.filter((r) => r.status === 200);
    const limited = res.filter((r) => r.status === 429);
    check(`1. one email x10 concurrent: exactly 3 permitted (got ${ok.length}), 7 refused with 429 (got ${limited.length})`, ok.length === 3 && limited.length === 7);
    check(`1. one email: exactly 3 emails sent (got ${sends.filter((s) => s.to === email).length}) and 3 AuthCode rows`, sends.filter((s) => s.to === email).length === 3 && (await rowsFor('email = $1', [email])) === 3);
  }

  // ---- 2. ten concurrent requests from ONE IP (different emails) ----
  {
    sends.length = 0;
    const ip = ipOf('one-ip');
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => call(em(`ip-${i}`), ip)));
    const ok = res.filter((r) => r.status === 200).length;
    check(`2. one IP x10 concurrent (10 emails): exactly 3 permitted (got ${ok}), 7 x 429`, ok === 3 && res.filter((r) => r.status === 429).length === 7);
    check(`2. one IP: exactly 3 emails sent (got ${sends.length}) and 3 rows for the IP`, sends.length === 3 && (await rowsFor('"requestIp" = $1', [ip])) === 3);
  }

  // ---- 3. combined email/IP limits (existing rule: email OR IP rows in the window) ----
  {
    const eA = em('comb-a'), eB = em('comb-b'), eC = em('comb-c');
    const i1 = ipOf('c1'), i2 = ipOf('c2'), i3 = ipOf('c3');
    const s1 = await call(eA, i1);
    const s2 = await call(eA, i1);
    const s3 = await call(eB, i1); // IP i1 now has 3 rows
    const s4 = await call(eC, i1); // IP quota reached
    const s5 = await call(eA, i2); // email eA has 2 -> allowed (3rd)
    const s6 = await call(eA, i3); // email quota reached, fresh IP
    check('3. sequential: email and IP rows both count (200,200,200,429 for the IP; 200,429 for the email)', [s1, s2, s3, s5].every((r) => r.status === 200) && s4.status === 429 && s6.status === 429, [s1, s2, s3, s4, s5, s6].map((r) => r.status));
    // Concurrent mix: 5 x (shared email, own IP) + 5 x (own email, shared IP), all at once.
    sends.length = 0;
    const EM = em('mix'), IM = ipOf('mix');
    const res = await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => call(EM, ipOf(`mx${i}`))),
      ...Array.from({ length: 5 }, (_, i) => call(em(`mix-${i}`), IM)),
    ]);
    const ok = res.filter((r) => r.status === 200).length;
    check(`3. concurrent mix: 3 for the shared email + 3 for the shared IP = 6 permitted (got ${ok}), no errors`, ok === 6 && res.every((r) => r.status === 200 || r.status === 429));
    // Concurrent cross-product: 3 emails x 3 IPs, 27 requests -- no deadlock, no 500, no key over its quota.
    const E = [0, 1, 2].map((k) => em(`x-${k}`)), I = [0, 1, 2].map((k) => ipOf(`x${k}`));
    const reqs = E.flatMap((e) => I.flatMap((i) => [call(e, i), call(e, i), call(e, i)]));
    const all = await Promise.all(reqs);
    const per = await Promise.all([...E.map((e) => rowsFor('email = $1', [e])), ...I.map((i) => rowsFor('"requestIp" = $1', [i]))]);
    check(`3. 27 concurrent cross requests: only 200/429 (no deadlock or 500), every email and IP at most 3 rows ${JSON.stringify(per)}`, all.every((r) => r.status === 200 || r.status === 429) && per.every((c) => c <= 3) && all.some((r) => r.status === 200));
  }

  // ---- 4. a failed delivery releases only its own reservation ----
  {
    sends.length = 0;
    const email = em('fail-own');
    const ip = ipOf('f1');
    failWhen = () => false;
    const first = await call(email, ip); // a good request stays in place
    failWhen = (to) => to === email;
    const failed = await call(email, ip);
    check('4. failed send: 502 with the existing message', failed.status === 502 && failed.body.error === OUTAGE_MSG, failed);
    const okCode = sends.find((s) => !s.failed)!.code;
    const badCode = sends.find((s) => s.failed)!.code;
    check('4. failed send: its own row removed, the earlier good row kept', first.status === 200 && (await rowsFor('email = $1', [email])) === 1 && (await rowsFor('"codeHash" = $1', [hashAuthCode(email, okCode)])) === 1 && (await rowsFor('"codeHash" = $1', [hashAuthCode(email, badCode)])) === 0);
    failWhen = () => false;
    const after = [await call(email, ip), await call(email, ip), await call(email, ip)];
    check('4. the released slot is usable again: 2 more succeed, then 429 (3 in total)', after[0].status === 200 && after[1].status === 200 && after[2].status === 429 && (await rowsFor('email = $1', [email])) === 3, after.map((r) => r.status));
  }

  // ---- 5. concurrent failures cannot remove another request's reservation ----
  {
    sends.length = 0;
    const email = em('fail-concurrent');
    failWhen = (to, n) => to === email && n % 2 === 1; // every other send fails, while others are in flight
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => call(email, ipOf(`fc${i}`))));
    failWhen = () => false;
    const mine = sends.filter((s) => s.to === email);
    const good = mine.filter((s) => !s.failed), bad = mine.filter((s) => s.failed);
    const goodRows = await Promise.all(good.map((s) => rowsFor('"codeHash" = $1', [hashAuthCode(email, s.code)])));
    const badRows = await Promise.all(bad.map((s) => rowsFor('"codeHash" = $1', [hashAuthCode(email, s.code)])));
    const rows = await rowsFor('email = $1', [email]);
    check(`5. concurrent failures: ${good.length} delivered, ${bad.length} failed; responses match (200=${res.filter((r) => r.status === 200).length}, 502=${res.filter((r) => r.status === 502).length})`, res.filter((r) => r.status === 200).length === good.length && res.filter((r) => r.status === 502).length === bad.length && bad.length >= 1);
    check(`5. every delivered code keeps its row, every failed code has none, rows = delivered (${rows}) <= 3`, goodRows.every((c) => c === 1) && badRows.every((c) => c === 0) && rows === good.length && rows <= 3);
  }

  // ---- 6. response codes and messages unchanged ----
  {
    const ip = ipOf('codes');
    const malformed = await requestLink(fakeRequest(null, ip, { malformed: true }));
    check('6. malformed body -> 400 "Malformed request body."', malformed.status === 400 && (await malformed.json()).error === 'Malformed request body.');
    const notObject = await requestLink(fakeRequest([1, 2], ip));
    check('6. non-object body -> 400 "A valid JSON request body is required."', notObject.status === 400 && (await notObject.json()).error === 'A valid JSON request body is required.');
    const bad = await requestLink(fakeRequest({ email: 'not-an-email' }, ip));
    check('6. invalid email -> 400 "A valid email is required."', bad.status === 400 && (await bad.json()).error === 'A valid email is required.');
    const email = em('codes');
    const r = [await call(email, ip), await call(email, ip), await call(email, ip), await call(email, ip)];
    check('6. success -> 200 {sent:true}; over quota -> 429 with the existing message', r.slice(0, 3).every((x) => x.status === 200 && JSON.stringify(x.body) === '{"sent":true}') && r[3].status === 429 && JSON.stringify(r[3].body) === JSON.stringify({ error: LIMIT_MSG }));
    const mixed = await call(`  ${em('CASE').toUpperCase()}  `, ipOf('case'));
    check('6. email is trimmed and lower-cased before counting and storing (unchanged)', mixed.status === 200 && (await rowsFor('email = $1', [em('CASE').toLowerCase()])) === 1);
    const noIp = [await call(em('noip'), null), await call(em('noip'), null), await call(em('noip'), null), await call(em('noip'), null)];
    check('6. no client IP: the email quota still applies (3 then 429)', noIp.slice(0, 3).every((x) => x.status === 200) && noIp[3].status === 429);
  }

  // ---- 7. development fallback and production misconfiguration unchanged ----
  {
    useEmailProvider(false);
    const email = em('dev');
    const env = process.env as Record<string, string | undefined>;
    const dev = await call(email, ipOf('dev'));
    // AURA-AUTH-02: without the local magic-link opt-in only the code comes back.
    check('7. dev (no provider, not production, no magic-link opt-in): returns devLoginCode only and stores the row', dev.status === 200 && dev.body.devLoginUrl === undefined && /^\d{6}$/.test(dev.body.devLoginCode) && (await rowsFor('"codeHash" = $1', [hashAuthCode(email, dev.body.devLoginCode)])) === 1);
    // AURA-AUTH-02: authorized local development (next dev + opt-in) keeps the link.
    const prevNode = env.NODE_ENV, prevFlag = env.AURA_LOCAL_MAGIC_LINKS;
    env.NODE_ENV = 'development';
    env.AURA_LOCAL_MAGIC_LINKS = 'true';
    const devEmail = em('dev-link');
    const devLink = await call(devEmail, ipOf('devlink'));
    env.NODE_ENV = prevNode;
    if (prevFlag === undefined) delete env.AURA_LOCAL_MAGIC_LINKS; else env.AURA_LOCAL_MAGIC_LINKS = prevFlag;
    if (prevNode === undefined) delete env.NODE_ENV;
    check('7. local dev with the opt-in: returns devLoginUrl + devLoginCode and stores the row', devLink.status === 200 && /\/api\/auth\/verify\?token=/.test(devLink.body.devLoginUrl) && /^\d{6}$/.test(devLink.body.devLoginCode) && (await rowsFor('"codeHash" = $1', [hashAuthCode(devEmail, devLink.body.devLoginCode)])) === 1);
    const prevEnv = env.NODE_ENV, prevSecret = env.AUTH_SECRET;
    env.NODE_ENV = 'production';
    env.AUTH_SECRET = prevSecret && prevSecret.length >= 32 ? prevSecret : 'auth01-test-secret-0123456789abcdef0123456789';
    const sentBefore = sends.length;
    const prodEmail = em('prod-misconfig');
    const prod = await call(prodEmail, ipOf('prod'));
    env.NODE_ENV = prevEnv;
    env.AUTH_SECRET = prevSecret;
    check('7. production without a provider: 500 with the existing message, no credentials, no row left, no send', prod.status === 500 && prod.body.error === 'Sign-in email is not configured on this server.' && !prod.body.devLoginCode && (await rowsFor('email = $1', [prodEmail])) === 0 && sends.length === sentBefore);
    useEmailProvider(true);
  }

  // ---- 8. normal sign-in and code verification still work ----
  {
    sends.length = 0;
    const email = em('signin');
    const r = await call(email, ipOf('signin'));
    const code = sends.find((s) => s.to === email)?.code ?? '';
    const v = await verifyCode(fakeRequest({ email, code }, ipOf('signin')));
    const cookie = v.headers.get('set-cookie') ?? '';
    check('8. request-link then verify-code with the emailed code: 200 {ok:true} and a session cookie', r.status === 200 && /^\d{6}$/.test(code) && v.status === 200 && (await v.json()).ok === true && cookie.includes('as_session='));
    const again = await verifyCode(fakeRequest({ email, code }, ipOf('signin')));
    check('8. the same code cannot be used twice (401, unchanged)', again.status === 401);
    const user = await pool.query('SELECT count(*)::int AS c FROM "User" WHERE email = $1', [email]);
    check('8. open registration: a first sign-in creates the account', user.rows[0].c === 1);
  }

  // Clean up this run's rows (disposable DB; only rows created by this run).
  await pool.query(`DELETE FROM "AuthCode" WHERE email LIKE $1`, [`${RUN}-%`]);
  console.log(`\n${count} checks, ${allPassed ? 'all passed' : 'FAILURES'}`);
}

main()
  .catch((e) => {
    console.error(e);
    allPassed = false;
  })
  .finally(async () => {
    (globalThis as any).fetch = realFetch;
    await pool.end();
    process.exit(allPassed ? 0 : 1);
  });
