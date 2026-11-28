/**
 * AURA-AUTH-SESSION-01-I2-R1 (39247) F2 -- ONE 2-second foreground caller
 * budget for sign-in (Rev 3 §8.1) across pool acquisition, the pre-commit
 * transaction work, the transaction-bound COMMIT and the release read-back.
 *
 * DISPOSABLE loopback PostgreSQL only. A test-only latency proxy delays
 * selected client->server messages (each delay stays under its own phase
 * maximum, so only a SHARED deadline can stop the pipeline). Real
 * createSignInSession, real I1 commit / release, real verify-code route.
 *
 *   DATABASE_URL=postgresql://...127.0.0.1.../x npx ts-node test/authSessionI2R1DeadlineDb.test.ts
 */
import * as net from 'net';
import { Pool } from 'pg';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { upsertUserByEmail, createAuthCode } from '../apps/web/lib/db';
import { hashAuthCode } from '../apps/web/lib/auth';
import { activeSessionCookieName, closeSessionPool, createSignInSession, setSessionPoolForTesting } from '../apps/web/lib/session';
import { createSessionPool, SYSTEM_SESSION_CLOCK } from '../apps/web/lib/authSessionDb';
import { commitAuthSessionTransaction, createAuthSessionInTransaction } from '../apps/web/lib/authSessionStore';
import { POST as verifyCode } from '../apps/web/app/api/auth/verify-code/route';

const URL_ = process.env.DATABASE_URL!;
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(URL_).hostname)) {
  console.error('Refusing: DATABASE_URL must be a disposable loopback database.');
  process.exit(2);
}
const admin = new Pool({ connectionString: URL_, max: 3 });
const q = async (text: string, params: unknown[] = []) => (await admin.query(text, params)).rows;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NAME = activeSessionCookieName();
const BUDGET_MS = 2000;
const SLACK_MS = 250; // event-loop / socket teardown allowance

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, note: unknown = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${note !== '' ? ' -- ' + JSON.stringify(note) : ''}`);
  if (ok) passes++;
  else failures++;
}

/** Delays client->server chunks that contain a trigger text by its configured ms. */
async function startLatencyProxy(upstreamUrl: string) {
  const up = new URL(upstreamUrl);
  const delays = new Map<string, number>();
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(up.port || 5432), up.hostname);
    sockets.add(client);
    sockets.add(upstream);
    let chain = Promise.resolve();
    client.on('data', (chunk) => {
      let ms = 0;
      for (const [t, d] of delays) if (chunk.includes(t)) ms = Math.max(ms, d);
      chain = chain.then(async () => {
        if (ms) await sleep(ms);
        if (!upstream.destroyed) upstream.write(chunk);
      });
    });
    upstream.on('data', (chunk) => {
      if (!client.destroyed) client.write(chunk);
    });
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', end);
    upstream.on('error', end);
    client.on('close', end);
    upstream.on('close', end);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  const url = new URL(upstreamUrl);
  url.host = `127.0.0.1:${port}`;
  return {
    url: url.toString(),
    delays,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

async function newCode(email: string) {
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await q(`DELETE FROM "AuthCode" WHERE email = $1`, [email]);
  await createAuthCode({ email, codeHash: hashAuthCode(email, code), expiresAt: new Date(Date.now() + 600_000) });
  return code;
}

async function main() {
  const email = 'i2r1-deadline@example.test';
  const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.08, longitude: 80.27, timezone: 'Asia/Kolkata' });
  const rows = async () => (await q(`SELECT count(*)::int n FROM "AuthSession" WHERE "userId" = $1`, [user.id]))[0].n as number;
  const proxy = await startLatencyProxy(URL_);
  const pool = createSessionPool(proxy.url);
  setSessionPoolForTesting(pool);
  try {
    // D0 control: no added latency -> issued well inside the budget.
    let t0 = performance.now();
    const ok = await createSignInSession(user.id, async () => true);
    check('D0 control: no added latency -> session issued inside 2 s', ok.kind === 'issued' && performance.now() - t0 < BUDGET_MS, { kind: ok.kind, ms: Math.round(performance.now() - t0) });

    // D1 every phase slow but under its own maximum: pre-commit 1.2 s, COMMIT 1.2 s, release read-back 1.2 s.
    proxy.delays.set('auth_session_commit', 1200);
    proxy.delays.set('SELECT "userId", "expiresAt" FROM "AuthSession"', 1200);
    const before = await rows();
    t0 = performance.now();
    const slow = await createSignInSession(user.id, async () => {
      await sleep(1200);
      return true;
    });
    const ms1 = Math.round(performance.now() - t0);
    check('D1 shared deadline: slow pre-commit + COMMIT + read-back ends within 2 s (+ slack)', ms1 <= BUDGET_MS + SLACK_MS, { kind: slow.kind, ms: ms1 });
    check('D1 a pipeline past its 2 s budget never issues a session (no cookie material)', slow.kind === 'unavailable', { kind: slow.kind });
    await sleep(1500); // let delayed messages drain on the discarded connection
    void before;

    // D2 budget spent before COMMIT: the COMMIT is not sent; nothing is committed; the code stays unconsumed.
    proxy.delays.clear();
    const code2 = await newCode(email);
    proxy.delays.set('"AuthCode"', 2100);
    const before2 = await rows();
    t0 = performance.now();
    const r2 = await verifyCode(new NextRequest('http://localhost/api/auth/verify-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: code2 }) }));
    const ms2 = Math.round(performance.now() - t0);
    const sc2 = (r2.headers as unknown as { getSetCookie(): string[] }).getSetCookie().some((c) => c.startsWith(NAME + '=') && !/max-age=0/i.test(c));
    await sleep(2200);
    const consumed2 = (await q(`SELECT "consumedAt" FROM "AuthCode" WHERE email = $1`, [email]))[0]?.consumedAt ?? null;
    check('D2 route: budget spent in the code consume -> 503, no session cookie, within 2 s (+ slack)', r2.status === 503 && !sc2 && ms2 <= BUDGET_MS + SLACK_MS, { status: r2.status, cookie: sc2, ms: ms2 });
    check('D2 no session row and the code is NOT consumed (retry works)', (await rows()) === before2 && consumed2 === null, { rows: await rows(), before2, consumed2 });

    // D3 ambiguous COMMIT inside the budget keeps its contract: committed late -> no cookie, orphan unusable.
    proxy.delays.clear();
    proxy.delays.set('auth_session_commit', 1700);
    t0 = performance.now();
    const r3 = await createSignInSession(user.id, async () => {
      await sleep(500);
      return true;
    });
    const ms3 = Math.round(performance.now() - t0);
    check('D3 COMMIT reply past the remaining budget -> unavailable (ambiguous), within 2 s (+ slack)', r3.kind === 'unavailable' && ms3 <= BUDGET_MS + SLACK_MS, { kind: r3.kind, ms: ms3 });

    // D4 slow release read-back alone: committed, but the read-back past the budget -> no session.
    proxy.delays.clear();
    proxy.delays.set('SELECT "userId", "expiresAt" FROM "AuthSession"', 1900);
    t0 = performance.now();
    const r4 = await createSignInSession(user.id, async () => {
      await sleep(300);
      return true;
    });
    const ms4 = Math.round(performance.now() - t0);
    check('D4 release read-back past the remaining budget -> unavailable, within 2 s (+ slack)', r4.kind === 'unavailable' && ms4 <= BUDGET_MS + SLACK_MS, { kind: r4.kind, ms: ms4 });

    // D5 acquisition counts: every pool slot busy for 450 ms, then a 1.7 s pre-commit step.
    proxy.delays.clear();
    const held = await Promise.all(Array.from({ length: 5 }, () => pool.connect()));
    setTimeout(() => held.forEach((c) => c.release()), 450);
    t0 = performance.now();
    const r5 = await createSignInSession(user.id, async () => {
      await sleep(1700);
      return true;
    });
    const ms5 = Math.round(performance.now() - t0);
    check('D5 pool wait is part of the same budget: 450 ms checkout + 1.7 s work -> unavailable within 2 s (+ slack)', r5.kind === 'unavailable' && ms5 <= BUDGET_MS + SLACK_MS, { kind: r5.kind, ms: ms5 });

    // D7 store contract: a COMMIT with no budget left is never sent -> rolled_back (not_sent_deadline),
    // no authorization; after the caller's ROLLBACK nothing exists.
    proxy.delays.clear();
    const c7 = await pool.connect();
    await c7.query('BEGIN');
    const p7 = await createAuthSessionInTransaction(c7, user.id);
    const d7 = await commitAuthSessionTransaction(c7, p7, { deadlineAt: SYSTEM_SESSION_CLOCK.now() - 1 });
    const still = (await c7.query('SELECT txid_current_if_assigned() IS NOT NULL AS open')).rows[0].open;
    await c7.query('ROLLBACK');
    c7.release();
    const seen7 = (await q(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [p7.idHash])).length;
    check('D7 store: no budget -> COMMIT not sent: rolled_back(not_sent_deadline), no authorization, txn still open, no row after ROLLBACK', d7.outcome === 'rolled_back' && (d7 as { reason?: string }).reason === 'not_sent_deadline' && !('authorization' in d7) && still === true && seen7 === 0, { d7, still, seen7 });
  } finally {
    setSessionPoolForTesting(null);
    await sleep(2500);
    await pool.end().catch(() => undefined);
    await proxy.close();
  }
  const idle = await q(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name = 'aura-session' AND state LIKE 'idle in transaction%'`);
  check('D6 no aura-session backend is left idle in transaction', idle[0].n === 0, idle[0].n);
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
