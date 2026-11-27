/**
 * AURA-AUTH-SESSION-01-I1 R1 (39233) -- real-PostgreSQL verification of the
 * three corrections, against a DISPOSABLE loopback database only.
 *
 *   DATABASE_URL="postgresql://...@localhost/..." npx ts-node test/authSessionR1Db.test.ts
 *
 * A  39232-01: one absolute revoke deadline, outcome classification and retry,
 *    with real lock timeouts and injected connection faults (test/authSessionFaultProxy.ts).
 * B  39232-02 / R2 39235: commit authorization -- session material is released
 *    only after an ACKNOWLEDGED caller COMMIT and a live matching row; never
 *    after a rolled-back or ambiguous COMMIT, whatever a read-back finds.
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
  classifyAmbiguousCommit,
  commitAuthSessionTransaction,
  createAuthSession,
  createAuthSessionInTransaction,
  lookupAuthSession,
  releaseCommittedAuthSession,
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
  // R2 (39235): commit authorization. Release of session material requires an
  // ACKNOWLEDGED caller COMMIT plus a live matching row; nothing else releases it.
  const u = await newUser();
  const other = await newUser();
  const independentSees = async (idHash: string) => (await admin.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [idHash])).rows.length === 1;
  const hasSid = (x: unknown) => !!x && typeof x === 'object' && 'sid' in (x as object);
  const openTx = async () => {
    const c = await admin.connect();
    await c.query('BEGIN');
    const p = await createAuthSessionInTransaction(lib<LibClient>(c), u);
    return { c, p };
  };

  // B1 -- provisional creation exposes no cookie-issuable session material.
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
    check('B1 provisional: state=provisional, keys exactly expiresAt/idHash/state/userId, no sid, no symbols, JSON carries no raw id', p.state === 'provisional' && !hasSid(p) && Object.keys(p).sort().join() === 'expiresAt,idHash,state,userId' && Object.getOwnPropertySymbols(p).length === 0 && !/"sid"/.test(JSON.stringify(p)));
    check('B1 visible inside the caller transaction, absent from an independent connection before commit', visibleInside && !(await independentSees(p.idHash)));
    check('B1 the INSERT helper sent exactly one INSERT and no BEGIN / COMMIT / ROLLBACK / SET', sent.length === 1 && /^INSERT INTO "AuthSession"/.test(sent[0]), sent.map((x) => x.slice(0, 32) + '...'));
    check("B1 the caller's own SET LOCAL statement_timeout is untouched", callerTimeout === '4321ms', callerTimeout);
    await c.query('ROLLBACK');
    c.release();
  }

  // B2 -- confirmed commit + valid read-back -> release (once).
  {
    const { c, p } = await openTx();
    const sent: string[] = [];
    const spy = new Proxy(c, {
      get(t, k, r) {
        if (k === 'query') return (text: string, ...rest: unknown[]) => (sent.push(String(text)), (t.query as (...a: unknown[]) => unknown).call(t, text, ...rest));
        const v = Reflect.get(t, k, r);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const d = await commitAuthSessionTransaction(lib<LibClient>(spy), p);
    c.release();
    const cs = d.outcome === 'committed' ? await releaseCommittedAuthSession(direct, d.authorization) : null;
    check('B2 acknowledged COMMIT -> outcome committed with an authorization; the decision itself carries no sid', d.outcome === 'committed' && !hasSid(d) && !hasSid((d as { authorization?: unknown }).authorization));
    check('B2 the commit helper sent only its in-transaction check and COMMIT (no BEGIN / ROLLBACK / SET)', sent.length === 2 && /^SELECT txid_current_if_assigned/.test(sent[0]) && sent[1] === 'COMMIT', sent.map((x) => x.slice(0, 40)));
    check('B2 confirmed commit + live matching row -> CommittedAuthSession whose sid hashes to the row', cs?.state === 'committed' && hashSessionId(cs.sid) === p.idHash && cs.userId === u);
    const again = d.outcome === 'committed' ? await releaseCommittedAuthSession(direct, d.authorization).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other')) : 'n/a';
    check('B2 an authorization releases at most once', again === 'TypeError', again);
  }

  // B3 -- confirmed commit, then the row is missing / expired / revoked / belongs to another account -> no release.
  for (const [label, tamper] of [
    ['missing', `DELETE FROM "AuthSession" WHERE "idHash" = $1`],
    ['expired', `UPDATE "AuthSession" SET "createdAt" = now() - interval '800 hours', "expiresAt" = now() - interval '1 second' WHERE "idHash" = $1`],
    ['revoked', `UPDATE "AuthSession" SET "revokedAt" = now(), "revokeReason" = 'logout' WHERE "idHash" = $1`],
    ['mismatched (row now belongs to another account)', `UPDATE "AuthSession" SET "userId" = '${other}' WHERE "idHash" = $1`],
  ] as const) {
    const { c, p } = await openTx();
    const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
    c.release();
    await admin.query(tamper, [p.idHash]);
    const r = d.outcome === 'committed' ? await releaseCommittedAuthSession(direct, d.authorization) : 'not committed';
    check(`B3 confirmed commit but ${label} row -> no session material (null)`, d.outcome === 'committed' && r === null, { outcome: d.outcome, r: hasSid(r) ? 'RELEASED' : r });
  }

  // B4 -- confirmed rollback -> no authorization, no release, ever.
  {
    const { c, p } = await openTx();
    await c.query('ROLLBACK'); // the caller's own rollback
    const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
    const again = await commitAuthSessionTransaction(lib<LibClient>(c), p).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
    c.release();
    check("B4 caller's own ROLLBACK, then the commit helper -> rolled_back (session_not_in_transaction), no authorization, no row; cannot be retried", d.outcome === 'rolled_back' && (d as { reason?: string }).reason === 'session_not_in_transaction' && !('authorization' in d) && !(await independentSees(p.idHash)) && again === 'TypeError', d);
  }
  {
    const { c, p } = await openTx();
    const err = await c.query('SELECT 1 / 0').then(() => 'none', (e) => e.code);
    const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
    c.release();
    check('B4 aborted transaction (22012) -> COMMIT answers ROLLBACK -> rolled_back (aborted_transaction), no authorization', err === '22012' && d.outcome === 'rolled_back' && (d as { reason?: string }).reason === 'aborted_transaction' && !('authorization' in d) && !(await independentSees(p.idHash)), d);
  }
  {
    const c = await admin.connect();
    await c.query('BEGIN');
    await c.query(`CREATE TEMP TABLE r2_deferred (id int, CONSTRAINT r2_deferred_u UNIQUE (id) DEFERRABLE INITIALLY DEFERRED) ON COMMIT DROP`);
    await c.query(`INSERT INTO r2_deferred VALUES (1), (1)`);
    const p = await createAuthSessionInTransaction(lib<LibClient>(c), u);
    const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
    c.release();
    check('B4 COMMIT rejected by a deferred constraint (23505) -> rolled_back (rejected_at_commit), no authorization, no row', d.outcome === 'rolled_back' && (d as { reason?: string }).reason === 'rejected_at_commit' && !('authorization' in d) && !(await independentSees(p.idHash)), d);
  }
  {
    const c = await admin.connect();
    await c.query('BEGIN');
    let reason = '';
    try {
      await createAuthSessionInTransaction(lib<LibClient>(c), randomUUID());
    } catch (e) {
      reason = `${(e as SessionVerificationUnavailableError).reason}/${(e as SessionVerificationUnavailableError).outcome}`;
    }
    const aborted = await c.query('SELECT 1').then(() => 'none', (e) => e.code);
    await c.query('ROLLBACK');
    c.release();
    check('B4 foreign-key failure on INSERT: propagated (constraint/failed); caller transaction aborted for the caller to roll back', reason === 'constraint/failed' && aborted === '25P02', { reason, aborted });
  }

  // B5/B6/B7 -- AMBIGUOUS caller COMMIT (isolated fault injection on the caller's connection).
  const ambiguous = async (fault: 'drop-after-forward' | 'drop-before-forward' | 'blackhole') => {
    const proxy = await startFaultProxy(dbUrl, 'COMMIT');
    const caller = new Client({ connectionString: proxy.url, application_name: 'auth-session-r2-caller' });
    caller.on('error', () => {});
    await caller.connect();
    await caller.query('BEGIN');
    const p = await createAuthSessionInTransaction(lib<LibClient>(caller), u);
    proxy.queue.push(fault);
    const t = performance.now();
    const d = await commitAuthSessionTransaction(lib<LibClient>(caller), p);
    const ms = performance.now() - t;
    await caller.end().catch(() => {});
    await proxy.close();
    await sleep(400);
    return { p, d, ms };
  };
  {
    // B5: the COMMIT actually succeeded, but its acknowledgement was lost.
    const { p, d } = await ambiguous('drop-after-forward');
    const labels: unknown[] = [];
    for (let i = 0; i < 3; i++) labels.push(await classifyAmbiguousCommit(direct, p));
    check('B5 ambiguous COMMIT that actually succeeded -> outcome ambiguous, NO authorization', d.outcome === 'ambiguous' && !('authorization' in d), d);
    check('B5 the row IS committed in the database (undisclosed)', await independentSees(p.idHash));
    check('B5 read-back classifies it as committed_undisclosed -- three times -- and never releases session material', labels.every((l) => l === 'committed_undisclosed') && !labels.some(hasSid), labels);
    const conv = await commitAuthSessionTransaction(lib<LibClient>(null as unknown), p).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
    check('B5 an ambiguous provisional can never be committed / authorized again', conv === 'TypeError', conv);
    const live = await lookupAuthSession(direct, p.idHash, u);
    check('B5 the undisclosed row cannot authenticate without its raw id: the only live lookup is by idHash the server alone holds; no sid was ever returned', live?.userId === u && !hasSid(live));
  }
  {
    // B6: the COMMIT never reached the server.
    const { p, d } = await ambiguous('drop-before-forward');
    const label = await classifyAmbiguousCommit(direct, p);
    check('B6 ambiguous COMMIT that did not succeed -> ambiguous, no authorization; read-back not_committed; no row', d.outcome === 'ambiguous' && !('authorization' in d) && label === 'not_committed' && !(await independentSees(p.idHash)), { d, label });
  }
  {
    // B7: ambiguous COMMIT, then the read-back itself is unavailable.
    const { p, d } = await ambiguous('drop-after-forward');
    const dead = lib<LibPool>(createSessionPool(dbUrl));
    await (dead as unknown as Pool).end();
    const unavailable = await classifyAmbiguousCommit(dead, p).then((x) => `resolved ${String(x)}`, (e) => (e instanceof SessionVerificationUnavailableError ? `unavailable/${e.outcome}` : 'other'));
    const later = await classifyAmbiguousCommit(direct, p);
    check('B7 ambiguous COMMIT + unavailable read-back -> throws unavailable (no material); a later read-back still only labels', d.outcome === 'ambiguous' && unavailable.startsWith('unavailable/') && later === 'committed_undisclosed', { unavailable, later });
  }
  {
    // B8: black-holed COMMIT answer -> ambiguous at the 2 000 ms deadline.
    const { d, ms } = await ambiguous('blackhole');
    check('B8 COMMIT answer never arrives -> ambiguous (deadline) at ~2000 ms, no authorization', d.outcome === 'ambiguous' && (d as { reason?: string }).reason === 'deadline' && ms >= 1900 && ms < 2600 && !('authorization' in d), { d, ms: Math.round(ms) });
  }
  // B9 -- cross-account and forged inputs cannot authorize issuance.
  {
    const forged = Object.freeze({ kind: 'commit_authorization', idHash: 'A'.repeat(43), userId: u });
    const r = await releaseCommittedAuthSession(direct, forged as never).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
    check('B9 a forged CommitAuthorization (not from an acknowledged COMMIT) is refused', r === 'TypeError', r);
    const { c, p } = await openTx();
    const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
    c.release();
    const otherLive = await createAuthSession(direct, other);
    const crossed = d.outcome === 'committed' ? Object.freeze({ ...d.authorization, userId: other, idHash: otherLive.idHash }) : null;
    const r2 = await releaseCommittedAuthSession(direct, crossed as never).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
    check("B9 a copied authorization re-pointed at another account's live session is refused", r2 === 'TypeError', r2);
    const cls = await classifyAmbiguousCommit(direct, p).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
    check('B9 classification is refused for a provisional whose commit was not ambiguous', cls === 'TypeError', cls);
  }
  // B10 -- standalone creation is unchanged: committed on return.
  {
    const s = await createAuthSession(direct, u);
    check('B10 standalone create: state=committed, visible to an independent connection at once', s.state === 'committed' && (await independentSees(s.idHash)) && hashSessionId(s.sid) === s.idHash);
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

