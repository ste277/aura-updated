/**
 * AURA-AUTH-SESSION-01-I1 R1 (39233) -- real-PostgreSQL verification of the
 * three corrections, against a DISPOSABLE loopback database only.
 *
 *   DATABASE_URL="postgresql://...@localhost/..." npx ts-node test/authSessionR1Db.test.ts
 *
 * A  39232-01: one absolute revoke deadline, outcome classification and retry,
 *    with real lock timeouts and injected connection faults (test/authSessionFaultProxy.ts).
 * B  39232-02: provisional (caller-transaction) vs committed sessions, incl. an
 *    uncertain COMMIT acknowledgement.
 * C  Fixed expiry: 720 elapsed hours under several session time zones and
 *    across daylight-saving transitions.
 *
 * Synthetic users only (auth-session-r1-*@example.test), removed at the end.
 */
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { Client, Pool } from 'pg';
import { boundedSessionQuery, createSessionPool, SESSION_POOL_APPLICATION_NAME, SESSION_TTL_SQL, SESSION_WRITE_BOUNDS } from '../apps/web/lib/authSessionDb';
import {
  confirmCommittedAuthSession,
  createAuthSession,
  createAuthSessionInTransaction,
  lookupAuthSession,
  revokeAuthSession,
  type SessionAttemptEvent,
} from '../apps/web/lib/authSessionStore';
import { hashSessionId, sessionCookieOptions, SESSION_TTL_MS } from '../apps/web/lib/authSessionToken';
import { SessionVerificationUnavailableError } from '../apps/web/lib/sessionErrors';
import { startFaultProxy } from './authSessionFaultProxy';

const dbUrl = process.env.AURA_DATABASE_URL || process.env.DATABASE_URL || '';
if (!dbUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(dbUrl).hostname)) {
  console.error('DATABASE_URL must be a disposable loopback database.');
  process.exit(1);
}

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let uncaught = 0;
process.on('uncaughtException', (e) => (uncaught++, console.error('uncaughtException', e instanceof Error ? e.name : e)));
process.on('unhandledRejection', (e) => (uncaught++, console.error('unhandledRejection', e instanceof Error ? e.name : e)));

const admin = new Pool({ connectionString: dbUrl, max: 4, application_name: 'auth-session-r1-admin' });
type LibPool = Parameters<typeof revokeAuthSession>[0];
type LibClient = Parameters<typeof createAuthSessionInTransaction>[0];
const lib = <T>(x: unknown) => x as T;
const users: string[] = [];

async function newUser(): Promise<string> {
  const id = randomUUID();
  await admin.query(`INSERT INTO "User" (id, email, "cityName", latitude, longitude) VALUES ($1, $2, 'Chennai', 13.08, 80.27)`, [id, `auth-session-r1-${id}@example.test`]);
  users.push(id);
  return id;
}
const rowOf = async (idHash: string) => (await admin.query(`SELECT "revokedAt", "revokeReason" FROM "AuthSession" WHERE "idHash" = $1`, [idHash])).rows[0] ?? null;

async function revokeTimed(pool: LibPool, idHash: string) {
  const events: SessionAttemptEvent[] = [];
  const t = performance.now();
  try {
    const v = await revokeAuthSession(pool, idHash, 'logout', { observe: (e) => events.push(e) });
    return { value: v, ms: performance.now() - t, events, attempts: events.length };
  } catch (e) {
    const err = e as SessionVerificationUnavailableError;
    return { reason: err.reason, outcome: err.outcome, ms: performance.now() - t, events, attempts: events.length };
  }
}
const r0 = (x: { ms: number }) => ({ ...x, ms: Math.round(x.ms) });

async function partA(direct: LibPool) {
  const u = await newUser();

  // A1 -- confirmed lock_timeout: never retried; bounded by the write lock maximum.
  {
    const s = await createAuthSession(direct, u);
    const locker = await admin.connect();
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE "AuthSession" IN ACCESS EXCLUSIVE MODE');
    const r = await revokeTimed(direct, s.idHash);
    await locker.query('ROLLBACK');
    locker.release();
    check('A1 locked table: confirmed lock_timeout, 1 attempt, ~1000 ms, row NOT revoked', r.reason === 'lock_timeout' && r.outcome === 'failed' && r.attempts === 1 && r.ms >= 900 && r.ms < 1600 && (await rowOf(s.idHash))?.revokedAt === null, r0(r));
  }

  const proxy = await startFaultProxy(dbUrl, 'UPDATE "AuthSession"');
  const viaProxy = lib<LibPool>(createSessionPool(proxy.url));
  try {
    // A2 -- uncertain (committed, acknowledgement lost) -> safe retry -> success.
    {
      const s = await createAuthSession(direct, u);
      proxy.queue.push('drop-after-forward');
      const r = await revokeTimed(viaProxy, s.idHash);
      const row = await rowOf(s.idHash);
      check('A2 ack lost after commit: retried once within budget -> already_inactive; row revoked once', r.value === 'already_inactive' && r.attempts === 2 && r.events[0].result === 'uncertain' && r.ms < 2000 && row?.revokeReason === 'logout', r0(r));
    }
    // A3 -- uncertain (never reached the server) -> safe retry -> revoked.
    {
      const s = await createAuthSession(direct, u);
      proxy.queue.push('drop-before-forward');
      const r = await revokeTimed(viaProxy, s.idHash);
      check('A3 dropped before the server: retried once -> revoked', r.value === 'revoked' && r.attempts === 2 && r.ms < 2000 && (await rowOf(s.idHash))?.revokeReason === 'logout', r0(r));
    }
    // A4 -- server answers never arrive: one attempt until the caller deadline; no retry.
    {
      const s = await createAuthSession(direct, u);
      proxy.queue.push('blackhole');
      const r = await revokeTimed(viaProxy, s.idHash);
      const row = await rowOf(s.idHash);
      check('A4 black-holed answer: uncertain at the 2000 ms deadline, 1 attempt, no retry', r.reason === 'deadline' && r.outcome === 'uncertain' && r.attempts === 1 && r.ms >= 1950 && r.ms < 2400, r0(r));
      check('A4 database outcome: the UPDATE did commit -- exactly why it is reported uncertain, never success', row?.revokeReason === 'logout');
    }
    // A5 -- retry cannot reset the deadline: first attempt lost, retry black-holed.
    {
      const s = await createAuthSession(direct, u);
      proxy.queue.push('drop-before-forward', 'blackhole');
      const r = await revokeTimed(viaProxy, s.idHash);
      check('A5 lost then black-holed: 2 attempts, total still <= the ORIGINAL 2000 ms deadline (not ~4000)', r.attempts === 2 && r.outcome === 'uncertain' && r.ms >= 1950 && r.ms < 2400, r0(r));
    }
    // A6 -- pool recovery through the same (faulty) pool.
    {
      const s = await createAuthSession(direct, u);
      const ok = await revokeTimed(viaProxy, s.idHash);
      const live = await createAuthSession(direct, u);
      const found = await lookupAuthSession(viaProxy, live.idHash, u);
      check('A6 pool recovery: after dropped and black-holed connections the same pool revokes and looks up normally', ok.value === 'revoked' && ok.attempts === 1 && found?.userId === u, r0(ok));
    }
  } finally {
    await (viaProxy as unknown as Pool).end().catch(() => {});
    await proxy.close();
  }

  // A7 -- acquisition failure: confirmed, no retry.
  {
    const s = await createAuthSession(direct, u);
    const held: Array<{ release(): void }> = [];
    for (let i = 0; i < 5; i++) held.push(await (direct as unknown as Pool).connect());
    const r = await revokeTimed(direct, s.idHash);
    held.forEach((h) => h.release());
    check('A7 pool exhausted: confirmed acquire failure in ~500 ms, 1 attempt, row not revoked', r.reason === 'acquire' && r.outcome === 'failed' && r.attempts === 1 && r.ms < 900 && (await rowOf(s.idHash))?.revokedAt === null, r0(r));
  }
  // A8 -- confirmed statement_timeout at the write maximum (1500 ms), enforced by PostgreSQL.
  {
    const t = performance.now();
    let reason = '';
    let outcome = '';
    try {
      await boundedSessionQuery(direct, 'SELECT pg_sleep(5)', SESSION_WRITE_BOUNDS);
    } catch (e) {
      reason = (e as SessionVerificationUnavailableError).reason;
      outcome = (e as SessionVerificationUnavailableError).outcome;
    }
    const ms = performance.now() - t;
    const sleeping = (await admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND query LIKE '%pg_sleep%' AND state = 'active'`, [SESSION_POOL_APPLICATION_NAME])).rows[0].n;
    check('A8 write statement bound: confirmed statement_timeout at ~1500 ms, nothing left running', reason === 'statement_timeout' && outcome === 'failed' && ms >= 1400 && ms < 2000 && sleeping === 0, { reason, outcome, ms: Math.round(ms), sleeping });
  }
}

async function partB(direct: LibPool) {
  const u = await newUser();
  const independentSees = async (idHash: string) => (await admin.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [idHash])).rows.length === 1;

  // B1/B2 -- provisional INSERT: visible to the caller, invisible elsewhere, gone after rollback.
  {
    const c = await admin.connect();
    const sent: string[] = [];
    const spy = new Proxy(c, {
      get(t, p, r) {
        if (p === 'query') return (text: string, ...rest: unknown[]) => (sent.push(String(text)), (t.query as (...a: unknown[]) => unknown).call(t, text, ...rest));
        const v = Reflect.get(t, p, r);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    await c.query('BEGIN');
    await c.query(`SET LOCAL statement_timeout = '4321ms'`);
    const p = await createAuthSessionInTransaction(lib<LibClient>(spy), u);
    const visibleInside = (await c.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [p.idHash])).rows.length === 1;
    const callerTimeout = (await c.query('SHOW statement_timeout')).rows[0].statement_timeout;
    check('B1 provisional: state=provisional, no raw sid exposed (keys / JSON)', p.state === 'provisional' && !('sid' in p) && Object.keys(p).sort().join() === 'expiresAt,idHash,state,userId' && !/[A-Za-z0-9_-]{43}"?\s*[,}]/.test(JSON.stringify({ ...p, idHash: 'x' })));
    check('B1 visible inside the caller transaction, absent from an independent connection before commit', visibleInside && !(await independentSees(p.idHash)));
    check('B1 the helper sent exactly one INSERT and no BEGIN / COMMIT / ROLLBACK / SET', sent.length === 1 && /^INSERT INTO "AuthSession"/.test(sent[0]) && !sent.some((s) => /\b(BEGIN|COMMIT|ROLLBACK|SET)\b/i.test(s.replace(/"[^"]*"/g, ''))), sent.map((x) => x.slice(0, 32) + '...'));
    check("B1 the caller's own SET LOCAL statement_timeout is untouched", callerTimeout === '4321ms', callerTimeout);
    await c.query('ROLLBACK');
    c.release();
    check('B2 caller rollback: row absent; confirmation returns null (no session)', !(await independentSees(p.idHash)) && (await confirmCommittedAuthSession(direct, p)) === null);
  }
  // B3 -- an unrelated later statement fails: the caller's transaction aborts and rolls back.
  {
    const c = await admin.connect();
    await c.query('BEGIN');
    const p = await createAuthSessionInTransaction(lib<LibClient>(c), u);
    const err = await c.query('SELECT 1 / 0').then(() => 'none', (e) => e.code);
    const aborted = await c.query('SELECT 1').then(() => 'none', (e) => e.code);
    await c.query('ROLLBACK');
    c.release();
    check('B3 unrelated failure (22012) aborts the caller transaction (25P02); after rollback no row, no session', err === '22012' && aborted === '25P02' && !(await independentSees(p.idHash)) && (await confirmCommittedAuthSession(direct, p)) === null, { err, aborted });
  }
  // B4 -- foreign-key failure propagates as a confirmed failure; the transaction is aborted.
  {
    const c = await admin.connect();
    await c.query('BEGIN');
    let reason = '';
    let outcome = '';
    try {
      await createAuthSessionInTransaction(lib<LibClient>(c), randomUUID());
    } catch (e) {
      reason = (e as SessionVerificationUnavailableError).reason;
      outcome = (e as SessionVerificationUnavailableError).outcome;
    }
    const aborted = await c.query('SELECT 1').then(() => 'none', (e) => e.code);
    await c.query('ROLLBACK');
    c.release();
    check('B4 foreign-key failure: propagated (constraint, failed); caller transaction aborted for the caller to roll back', reason === 'constraint' && outcome === 'failed' && aborted === '25P02', { reason, outcome, aborted });
  }
  // B5 -- caller commit -> confirmed committed session with its raw id.
  {
    const c = await admin.connect();
    await c.query('BEGIN');
    const p = await createAuthSessionInTransaction(lib<LibClient>(c), u);
    await c.query('COMMIT');
    c.release();
    const cs = await confirmCommittedAuthSession(direct, p);
    check('B5 after caller COMMIT: confirmation returns a committed session whose sid hashes to the row', cs?.state === 'committed' && hashSessionId(cs.sid) === p.idHash && cs.userId === u && cs.expiresAt.getTime() === p.expiresAt.getTime());
    const again = await confirmCommittedAuthSession(direct, p).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
    check('B5 a provisional result can be confirmed only once', again === 'TypeError', again);
  }
  // B6/B7 -- uncertain COMMIT acknowledgement (isolated fault injection on the caller's connection).
  for (const [label, fault, expectCommitted] of [
    ['B6 COMMIT executed but its acknowledgement lost', 'drop-after-forward', true],
    ['B7 COMMIT never reached the server', 'drop-before-forward', false],
  ] as const) {
    const proxy = await startFaultProxy(dbUrl, 'COMMIT');
    const caller = new Client({ connectionString: proxy.url, application_name: 'auth-session-r1-caller' });
    caller.on('error', () => {});
    await caller.connect();
    await caller.query('BEGIN');
    const p = await createAuthSessionInTransaction(lib<LibClient>(caller), u);
    proxy.queue.push(fault);
    const commit = await caller.query('COMMIT').then(() => 'acknowledged', () => 'uncertain');
    await caller.end().catch(() => {});
    await proxy.close();
    await sleep(400); // let the server finish the disconnected backend
    const cs = await confirmCommittedAuthSession(direct, p);
    check(`${label}: caller sees an uncertain commit; confirmation on an independent connection ${expectCommitted ? 'finds it committed' : 'finds no row'}`, commit === 'uncertain' && (expectCommitted ? cs?.state === 'committed' && hashSessionId(cs.sid) === p.idHash : cs === null && !(await independentSees(p.idHash))), { commit, confirmed: cs?.state ?? null });
  }
  // B8 -- standalone creation is unchanged: committed on return.
  {
    const s = await createAuthSession(direct, u);
    check('B8 standalone create: state=committed, visible to an independent connection at once', s.state === 'committed' && (await independentSees(s.idHash)) && hashSessionId(s.sid) === s.idHash);
  }
}

async function partC() {
  const u = await newUser();
  const zones = ['UTC', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kolkata', 'Pacific/Chatham'];
  const stored: Record<string, number> = {};
  for (const tz of zones) {
    const url = new URL(dbUrl);
    url.searchParams.set('options', `-c TimeZone=${tz}`);
    const pool = lib<LibPool>(createSessionPool(url.toString()));
    try {
      const shown = (await boundedSessionQuery(pool, 'SHOW TimeZone', SESSION_WRITE_BOUNDS)).rows[0]?.TimeZone ?? (await boundedSessionQuery(pool, 'SHOW TimeZone', SESSION_WRITE_BOUNDS)).rows[0]?.timezone;
      const s = await createAuthSession(pool, u);
      const h = Number((await admin.query(`SELECT EXTRACT(EPOCH FROM ("expiresAt" - "createdAt")) / 3600 AS h FROM "AuthSession" WHERE "idHash" = $1`, [s.idHash])).rows[0].h);
      stored[`${tz} (session ${shown})`] = h;
    } finally {
      await (pool as unknown as Pool).end().catch(() => {});
    }
  }
  check('C1 stored lifetime is exactly 720 h under every session time zone', Object.values(stored).every((h) => h === 720), stored);

  const instants: Array<[string, string]> = [
    ['America/New_York', '2026-03-07 12:00:00'],
    ['America/New_York', '2026-10-31 12:00:00'],
    ['Europe/London', '2026-03-28 12:00:00'],
    ['Europe/London', '2026-10-24 12:00:00'],
    ['Australia/Lord_Howe', '2026-03-28 12:00:00'],
    ['Pacific/Chatham', '2026-03-28 12:00:00'],
  ];
  const fixed: Record<string, number> = {};
  const calendar: Record<string, number> = {};
  const c = await admin.connect();
  try {
    for (const [tz, at] of instants) {
      await c.query(`SET TIME ZONE '${tz}'`);
      const start = `${at} ${tz}`;
      fixed[`${tz} @ ${at}`] = Number((await c.query(`SELECT EXTRACT(EPOCH FROM (($1::timestamptz + ${SESSION_TTL_SQL}) - $1::timestamptz)) / 3600 AS h`, [start])).rows[0].h);
      calendar[`${tz} @ ${at}`] = Number((await c.query(`SELECT EXTRACT(EPOCH FROM (($1::timestamptz + make_interval(days => 30)) - $1::timestamptz)) / 3600 AS h`, [start])).rows[0].h);
    }
  } finally {
    await c.query('RESET TIME ZONE').catch(() => {});
    c.release();
  }
  check(`C2 the production TTL expression (${SESSION_TTL_SQL}) is 720 h across every DST transition`, Object.values(fixed).every((h) => h === 720), fixed);
  check('C2 control: a calendar-day interval would NOT be 720 h across those transitions (the defect this replaces)', Object.values(calendar).some((h) => h !== 720), calendar);
  check('C3 token / cookie lifetime constants are the same 720 h', SESSION_TTL_MS === 720 * 3600 * 1000 && sessionCookieOptions(new Date(Date.now() + SESSION_TTL_MS), true).maxAge >= 720 * 3600 - 2);
}

async function main() {
  const direct = lib<LibPool>(createSessionPool(dbUrl));
  try {
    await partA(direct);
    await partB(direct);
    await partC();
  } finally {
    await (direct as unknown as Pool).end().catch(() => {});
  }
  check('no uncaught exceptions or unhandled rejections', uncaught === 0, uncaught);
}

main()
  .catch((e) => {
    failures++;
    console.error('FAIL  unexpected error', e);
  })
  .finally(async () => {
    try {
      if (users.length) await admin.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [users]);
    } catch {
      /* best effort */
    }
    await admin.end().catch(() => {});
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
  });

