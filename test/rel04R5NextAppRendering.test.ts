/**
 * AURA-ANDROID-REL-04 IR-01 (R5) -- ACTUAL APPLICATION RENDERING evidence.
 *
 * Runs the real, production-built Next.js app (`next build` + `next start`)
 * against a real Postgres database with a synthetic account, and checks:
 *   N1  the actual HTTP responses (HTML + React Server Component payload) for
 *       /plan-day, /goals, /goals/<id> and /captures, requested WITH the
 *       account's session cookie, contain none of the account's data (id,
 *       email, city, goal title);
 *   N2  the real GET /api/plan-day/bootstrap is account-scoped (headerless 503,
 *       other account 409, own account 200 with the account's data);
 *   N3  in real Chromium, the account data appears only after the page's own
 *       session verification, from requests that state the verified account
 *       (Plan Day bootstrap, Goal detail, Goals list).
 *
 * Requires DATABASE_URL (a disposable database with the migrations applied).
 * Builds apps/web unless REL04_SKIP_BUILD=1 and a build exists.
 *
 *   DATABASE_URL=postgresql://… npx ts-node test/rel04R5NextAppRendering.test.ts
 */
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

const WEB = path.join(__dirname, '..', 'apps', 'web');
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.log('FAIL DATABASE_URL is required (a disposable database with migrations applied)'); process.exit(1); }
const AUTH_SECRET = 'rel04-r5-rendering-test-secret-not-for-production-0123456789';
const env = { ...process.env, DATABASE_URL, AUTH_SECRET, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
process.env.AUTH_SECRET = AUTH_SECRET;

let passed = 0, failed = 0;
const check = (label: string, ok: boolean) => { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); };

const freePort = () => new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

async function main() {
  if (!(process.env.REL04_SKIP_BUILD === '1' && fs.existsSync(path.join(WEB, '.next', 'BUILD_ID')))) {
    console.log('building apps/web (next build)…');
    const b = spawnSync('npm', ['run', 'build'], { cwd: WEB, env, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (b.status !== 0) { console.log((b.stdout ?? '') + (b.stderr ?? '')); console.log('FAIL next build'); process.exit(1); }
  }
  const { PrismaClient } = require(require.resolve('@prisma/client', { paths: [WEB] }));
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  const auth = require(path.join(WEB, 'lib', 'auth'));
  const tag = Date.now().toString(36);
  const email = `r5render-${tag}@example.invalid`;
  const city = `AliceRenderTown${tag}`;
  const goalTitle = `AliceRenderGoal${tag}`;
  const user = await prisma.user.create({ data: { email, cityName: city, latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata', onboardingResolvedAt: new Date() } });
  const goal = await prisma.goal.create({ data: { userId: user.id, title: goalTitle } });
  const other = await prisma.user.create({ data: { email: `r5other-${tag}@example.invalid`, cityName: 'OtherTown', latitude: 1, longitude: 1 } });
  const cookie = `as_session=${auth.createSessionToken(user.id, email)}`;
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let server: ChildProcess | null = null;
  try {
    server = spawn('npx', ['next', 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: WEB, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { ready = (await fetch(`${origin}/api/health`)).ok; } catch { /* not yet */ }
    }
    check('N0 the production build serves (next start)', ready);

    // ---------------------------------------------------------------- N1 actual responses carry no account data
    const secrets = [user.id, email, city, goalTitle];
    for (const route of ['/plan-day', '/plan-day?horizon=tomorrow', '/goals', `/goals/${goal.id}`, '/captures']) {
      const res = await fetch(origin + route, { headers: { cookie } });
      const body = await res.text();
      const leaked = secrets.filter((s) => body.includes(s));
      check(`N1 GET ${route} with the account's session cookie: ${res.status}, response (HTML + RSC payload, ${body.length} bytes) contains NONE of the account's id/email/city/goal${leaked.length ? ` -- leaked: ${leaked.join(', ')}` : ''}`, res.status === 200 && leaked.length === 0 && /Checking your account/.test(body));
    }

    // ---------------------------------------------------------------- N2 the bootstrap route is account-scoped
    const b0 = await fetch(`${origin}/api/plan-day/bootstrap`, { headers: { cookie } });
    const b1 = await fetch(`${origin}/api/plan-day/bootstrap`, { headers: { cookie, 'X-Aura-Expected-Account': other.id } });
    const b2 = await fetch(`${origin}/api/plan-day/bootstrap`, { headers: { cookie, 'X-Aura-Expected-Account': user.id } });
    const j2 = b2.ok ? await b2.json() : null;
    // R6: missing or invalid session -> 401 (the protected-API contract), never an empty 200.
    const bNone = await fetch(`${origin}/api/plan-day/bootstrap`);
    // An invalid cookie WITH the stated account (what the client sends) reaches the route -> 401. (Headerless with any
    // cookie stays the existing boundary rule: 503 client_upgrade_required from the middleware, unchanged.)
    const bBad = await fetch(`${origin}/api/plan-day/bootstrap`, { headers: { cookie: 'as_session=not-a-valid-token', 'X-Aura-Expected-Account': user.id } });
    const bBadHeaderless = await fetch(`${origin}/api/plan-day/bootstrap`, { headers: { cookie: 'as_session=not-a-valid-token' } });
    const bNoneBody = await bNone.json().catch(() => null);
    check(`N2 (R6) real GET /api/plan-day/bootstrap without a session -> ${bNone.status} ${JSON.stringify(bNoneBody)}, with an invalid session stating an account -> ${bBad.status} (both 401); headerless + invalid cookie -> ${bBadHeaderless.status} (existing middleware rule, 503)`, bNone.status === 401 && bNoneBody?.error === 'Not authenticated.' && bBad.status === 401 && bBadHeaderless.status === 503);
    check(`N2 real GET /api/plan-day/bootstrap: headerless ${b0.status} (503), other account ${b1.status} (409), own account ${b2.status} with the account's city and a server planning date`, b0.status === 503 && b1.status === 409 && b2.status === 200 && j2?.cityName === city && typeof j2?.planningDate === 'string');

    // ---------------------------------------------------------------- N3 real Chromium: data only after verification, bound requests
    const { chromium } = require('@playwright/test');
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext();
      await context.addCookies([{ name: 'as_session', value: cookie.split('=').slice(1).join('='), url: origin }]);
      const page = await context.newPage();
      const log: Array<{ t: number; kind: 'req' | 'res'; url: string; expected: string | null }> = [];
      let seq = 0;
      page.on('request', (r: any) => { if (r.url().includes('/api/')) log.push({ t: seq++, kind: 'req', url: r.url(), expected: r.headers()['x-aura-expected-account'] ?? null }); });
      page.on('response', (r: any) => { if (r.url().includes('/api/')) log.push({ t: seq++, kind: 'res', url: r.url(), expected: null }); });
      const order = (dataPath: string) => {
        const sessionRes = log.find((e) => e.kind === 'res' && e.url.includes('/api/auth/session'));
        const dataReqs = log.filter((e) => e.kind === 'req' && e.url.includes(dataPath));
        return { ok: !!sessionRes && dataReqs.length > 0 && dataReqs.every((d) => d.t > sessionRes.t && d.expected === user.id), n: dataReqs.length };
      };

      await page.goto(`${origin}/plan-day`);
      const shown = await page.waitForFunction((c: string) => document.body.innerText.includes(c), city, { timeout: 20000 }).then(() => true, () => false);
      const o1 = order('/api/plan-day/bootstrap');
      check(`N3 (real Chromium, real app) Plan Day shows the account's city only after verification; the bootstrap request(s) (${o1.n}) were sent after the session answer and stated the verified account`, shown && o1.ok);

      log.length = 0;
      await page.goto(`${origin}/goals/${goal.id}`);
      const gShown = await page.waitForFunction((t: string) => document.body.innerText.includes(t), goalTitle, { timeout: 20000 }).then(() => true, () => false);
      const o2 = order(`/api/goals/${goal.id}`);
      check(`N3 (real Chromium, real app) Goal detail shows the goal only after verification; GET /api/goals/<id> sent after the session answer, stating the verified account`, gShown && o2.ok);

      log.length = 0;
      await page.goto(`${origin}/goals`);
      const lShown = await page.waitForFunction((t: string) => document.body.innerText.includes(t), goalTitle, { timeout: 20000 }).then(() => true, () => false);
      const o3 = order('/api/goals');
      check('N3 (real Chromium, real app) Goals list shows the goal only after verification, from bound requests', lShown && o3.ok);

      log.length = 0;
      await page.goto(`${origin}/captures`);
      await page.waitForFunction(() => !document.body.innerText.includes('Checking your account'), null, { timeout: 20000 }).catch(() => undefined);
      const o4 = order('/api/captures');
      check('N3 (real Chromium, real app) Captures fetches its list only after verification, stating the verified account', o4.ok);
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    server?.kill('SIGTERM');
    await prisma.goal.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
