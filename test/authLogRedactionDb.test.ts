/**
 * AURA-SEC-01 (#350) -- sign-in logs never contain a plaintext email address,
 * a sign-in code or a token, while every failure still logs a useful event
 * with a stable per-address reference (emailRef) for correlation.
 *
 * Drives the real request-link, verify-code and verify (magic link) handlers
 * against a local disposable database. Email delivery runs the real Resend
 * code path against a stubbed global fetch: nothing leaves the process.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/authLogRedactionDb.test.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { emailLogRef } from '../apps/web/lib/auth';
import { errorForLog, redactEmails } from '../apps/web/lib/authLog';
import { POST as requestLink } from '../apps/web/app/api/auth/request-link/route';
import { POST as verifyCode } from '../apps/web/app/api/auth/verify-code/route';
import { GET as verifyLink } from '../apps/web/app/api/auth/verify/route';

const dbUrl = process.env.AURA_DATABASE_URL || process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error('refusing: this suite only runs against a local disposable database');
  process.exit(1);
}

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count++;
  out(`${condition ? 'OK  ' : 'FAIL'} ${label}${detail !== undefined && !condition ? ' ' + JSON.stringify(detail) : ''}`);
  if (!condition) allPassed = false;
}

// ---- capture every console line the routes write ----
const real = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
const out = (s: string) => real.log(s);
const captured: string[] = [];
const fmt = (a: unknown) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v)); } catch { return String(a); } })());
for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) (console as any)[k] = (...args: unknown[]) => { captured.push(args.map(fmt).join(' ')); };

// ---- stubbed email provider ----
type Sent = { to: string; code: string; link: string };
const sends: Sent[] = [];
let failSends = false;
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
  if (!String(url).startsWith('https://api.resend.com/')) throw new Error(`unexpected outbound request: ${url}`);
  const body = JSON.parse(String(init?.body ?? '{}'));
  const to = body.to[0] as string;
  const code = /enter this code in the app: (\d{6})/.exec(body.text)?.[1] ?? '';
  const link = /Sign in to AuraSchedule: (\S+)/.exec(body.text)?.[1] ?? '';
  sends.push({ to, code, link });
  // A provider error that echoes the recipient -- must not reach the logs.
  return failSends
    ? ({ ok: false, status: 422, text: async () => `{"message":"Invalid recipient ${to}"}` } as any)
    : ({ ok: true, status: 200, text: async () => '' } as any);
};
delete process.env.MOM_API_KEY;
delete process.env.MOM_FROM_EMAIL;
process.env.RESEND_API_KEY = 'stub-not-a-real-key';

function fakeRequest(body: unknown, ip: string): any {
  const headers = new Map<string, string>([['host', 'aura.test.local'], ['x-forwarded-proto', 'https'], ['x-real-ip', ip]]);
  return {
    headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
    nextUrl: { host: 'aura.test.local', origin: 'https://aura.test.local' },
    cookies: { get: () => undefined },
    json: async () => body,
  };
}
function fakeGet(url: string): any {
  const u = new URL(url);
  return { url: u.toString(), nextUrl: u, headers: { get: () => null }, cookies: { get: () => undefined } };
}

const RUN = `sec01-${Date.now()}`;
const IP = (k: string) => `203.0.113.${k}-${RUN}`;

async function main() {
  // ---- unit: the reference and the sanitiser ----
  const A = `${RUN}-Alice.Example@e2e.aura.local`;
  const refA = emailLogRef(A);
  check('emailLogRef: 16 hex chars, case/whitespace-insensitive, no address content', /^[0-9a-f]{16}$/.test(refA) && refA === emailLogRef(`  ${A.toUpperCase()} `) && !refA.includes('alice'));
  check('emailLogRef: different addresses give different references', refA !== emailLogRef(`${RUN}-bob@e2e.aura.local`));
  const pgLike = Object.assign(new Error(`duplicate key value violates unique constraint (email)=(${A})`), { code: '23505', detail: `Key (lower(email))=(${A.toLowerCase()}) already exists.` });
  const safe = errorForLog(pgLike);
  check('errorForLog: keeps name and code, redacts the address, drops detail', safe.name === 'Error' && safe.code === '23505' && safe.message.includes('[email]') && !JSON.stringify(safe).toLowerCase().includes('alice') && !('detail' in safe));
  check('errorForLog: non-Error values are reduced to a redacted string', errorForLog(`boom for ${A}`).message === 'boom for [email]' && errorForLog(`boom for ${A}`).name === 'NonError');
  check('redactEmails: every address in a string is replaced', redactEmails(`a@b.co and ${A}`) === '[email] and [email]');

  // ---- scenario: link + code sign-in, every failure path, rate limit, send failure ----
  const B = `${RUN}-Bob.Example@e2e.aura.local`;
  const C = `${RUN}-Carol@e2e.aura.local`;
  const D = `${RUN}-Dave@e2e.aura.local`;
  captured.length = 0;

  // 1. Request + verify by code (success), then reuse (already consumed path is covered by verify-code's REJECTED on the consumed row: findActiveAuthCode returns null -> "no active code").
  const r1 = await requestLink(fakeRequest({ email: A }, IP('1')));
  const sentA = sends.find((s) => s.to === A.toLowerCase())!;
  const v1 = await verifyCode(fakeRequest({ email: A, code: sentA.code }, IP('1')));
  check('email-code sign-in still works: request 200, verify 200 with a session cookie', r1.status === 200 && v1.status === 200 && (v1.headers.get('set-cookie') ?? '').includes('as_session='));
  const v1again = await verifyCode(fakeRequest({ email: A, code: sentA.code }, IP('1')));
  check('a used code is refused (401) and logged without the address', v1again.status === 401);

  // 2. Magic-link sign-in.
  const r2 = await requestLink(fakeRequest({ email: B }, IP('2')));
  const sentB = sends.find((s) => s.to === B.toLowerCase())!;
  const v2 = await verifyLink(fakeGet(sentB.link));
  check('email-link sign-in still works: 307 redirect home with a session cookie', r2.status === 200 && v2.status === 307 && (v2.headers.get('set-cookie') ?? '').includes('as_session=') && new URL(v2.headers.get('location')!).pathname === '/');

  // 3. Wrong codes until the attempt cap.
  await requestLink(fakeRequest({ email: C }, IP('3')));
  const sentC = sends.find((s) => s.to === C.toLowerCase())!;
  const wrong = sentC.code === '000000' ? '111111' : '000000';
  const wrongs = [];
  for (let i = 0; i < 6; i++) wrongs.push((await verifyCode(fakeRequest({ email: C, code: wrong }, IP('3')))).status);
  check('wrong codes: 401 x5 then 429 (attempt cap), unchanged', JSON.stringify(wrongs) === JSON.stringify([401, 401, 401, 401, 401, 429]));

  // 4. AUTH-01 rate limit: 4th request for one address is 429.
  const rl = [];
  for (let i = 0; i < 4; i++) rl.push((await requestLink(fakeRequest({ email: D }, IP(`4${i}`)))).status);
  check('rate limit unchanged: 3 x 200 then 429 for one address', JSON.stringify(rl) === JSON.stringify([200, 200, 200, 429]));

  // 5. Provider failure whose error echoes the recipient.
  failSends = true;
  const E = `${RUN}-Erin@e2e.aura.local`;
  const r5 = await requestLink(fakeRequest({ email: E }, IP('5')));
  failSends = false;
  check('send failure: 502 with the existing message', r5.status === 502 && (await r5.json()).error === "Our email provider isn't responding right now. Please try again in a few minutes.");

  // ---- the logs ----
  const logs = captured.join('\n');
  const addresses = [A, B, C, D, E];
  const leaked = addresses.filter((x) => logs.toLowerCase().includes(x.toLowerCase()) || logs.toLowerCase().includes(x.split('@')[0].toLowerCase()));
  check(`no plaintext address (or its local part) in ${captured.length} captured log lines`, leaked.length === 0 && captured.length > 0, { leaked, sample: captured.slice(0, 3) });
  check('no email-shaped string at all in the logs', !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(logs), captured.filter((l) => /@/.test(l)).slice(0, 3));
  const codes = sends.map((s) => s.code).filter(Boolean);
  const tokens = sends.map((s) => new URL(s.link).searchParams.get('token') ?? '').filter(Boolean);
  check('no sign-in code or magic-link token in the logs', codes.every((c) => !logs.includes(c)) && tokens.every((t) => !logs.includes(t.slice(0, 24))));
  const has = (event: string, email: string) => captured.some((l) => l.includes(event) && l.includes(emailLogRef(email)));
  check('diagnostic event kept: verify-code "no active code" with the reference for that address', has('[auth] verify-code: no active code', A));
  check('diagnostic event kept: verify-code "incorrect code" with the reference', has('[auth] verify-code: incorrect code', C));
  check('diagnostic event kept: verify-code "attempt cap reached" with the reference', has('[auth] verify-code: attempt cap reached', C));
  check('diagnostic event kept: request-link "rate-limited" with the reference, IP and count', captured.some((l) => l.includes('[auth] request-link rate-limited') && l.includes(emailLogRef(D)) && l.includes(IP('43')) && l.includes('"recent":3')));
  check('diagnostic event kept: "sign-in email send failed" with the reference and a redacted provider error', captured.some((l) => l.includes('[auth] sign-in email send failed') && l.includes(emailLogRef(E)) && l.includes('Resend API error (422)') && l.includes('[email]')));

  // ---- source guard: no auth route logs a raw email or a whole error object again ----
  for (const f of ['request-link', 'verify-code', 'verify', 'session', 'logout']) {
    let src = '';
    try { src = readFileSync(join(__dirname, '..', 'apps/web/app/api/auth', f, 'route.ts'), 'utf8'); } catch { continue; }
    const calls = src.match(/console\.(log|info|warn|error|debug)\([^;]*\);/g) ?? [];
    const bad = calls.filter((c) => /[{,]\s*email\s*[,}]/.test(c) || /[{,]\s*(err|releaseErr|error)\s*[,}]/.test(c) || /\b(code|token|verifyUrl)\b\s*[,}]/.test(c));
    check(`source guard: ${f} logs no raw email, raw error object, code or token (${calls.length} log calls)`, bad.length === 0, bad);
  }
}

main()
  .catch((e) => { allPassed = false; real.error(e); })
  .finally(async () => {
    (globalThis as any).fetch = realFetch;
    Object.assign(console, real);
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: dbUrl });
      await pool.query(`DELETE FROM "AuthCode" WHERE email LIKE $1`, [`${RUN.toLowerCase()}-%`]);
      await pool.end();
    } catch { /* disposable DB; cleanup is best-effort */ }
    out(`\n${count} checks, ${allPassed ? 'all passed' : 'FAILURES'}`);
    process.exit(allPassed ? 0 : 1);
  });
