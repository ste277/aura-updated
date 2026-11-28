/**
 * AURA-AUTH-SESSION-01-I1 R1 (39233, finding 39232-01) -- deterministic,
 * controlled-clock tests of the single absolute caller deadline, outcome
 * classification and revoke retry. No database, no real timers: a virtual
 * monotonic clock and a scripted fake pool drive every boundary exactly.
 *
 *   npx ts-node test/authSessionDeadline.test.ts
 *
 * Real-PostgreSQL behaviour of the same paths is in authSessionStoreDb.test.ts.
 */
import { boundedSessionQuery, SESSION_CLEANUP_BOUNDS, SESSION_LOOKUP_BOUNDS, SESSION_POOL_BOUNDS, SESSION_WRITE_BOUNDS, type SessionClock } from '../apps/web/lib/authSessionDb';
import { lookupAuthSession, revokeAuthSession, SESSION_MIN_RETRY_BUDGET_MS, type SessionAttemptEvent } from '../apps/web/lib/authSessionStore';
import { SessionVerificationUnavailableError } from '../apps/web/lib/sessionErrors';

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
}

// --- Virtual clock ---------------------------------------------------------------
class FakeClock implements SessionClock {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.t;
  }
  setTimer(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }
  clearTimer(h: unknown) {
    this.timers.delete(h as number);
  }
  nextAt(): number | null {
    let n: number | null = null;
    for (const v of this.timers.values()) if (n === null || v.at < n) n = v.at;
    return n;
  }
  fireDue() {
    const due = [...this.timers.entries()].filter(([, v]) => v.at <= this.t).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
    for (const [id, v] of due) {
      this.timers.delete(id);
      v.fn();
    }
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** Drives `op` to completion in virtual time; returns its outcome and the virtual elapsed time. */
async function run<T>(clock: FakeClock, op: () => Promise<T>) {
  const start = clock.now();
  let settled = false;
  let value: T | undefined;
  let error: unknown;
  op().then(
    (v) => ((settled = true), (value = v)),
    (e) => ((settled = true), (error = e))
  );
  for (let guard = 0; guard < 1000; guard++) {
    await flush();
    if (settled) break;
    const n = clock.nextAt();
    if (n === null) break;
    clock.t = n;
    clock.fireDue();
  }
  await flush();
  const e = error as SessionVerificationUnavailableError | undefined;
  return { settled, value, error: e, reason: e?.reason, outcome: e?.outcome, elapsed: clock.now() - start };
}

// --- Scripted fake pool ------------------------------------------------------------
type QueryScript = { after: number; ok?: { rowCount: number; rows?: unknown[] }; err?: { code?: string; message?: string } } | 'hang';
type ConnectScript = { after: number; fail?: string } | 'hang';

class FakePool {
  connects = 0;
  sent: string[] = [];
  released: Array<'ok' | 'discarded'> = [];
  constructor(private clock: FakeClock, private connectScript: ConnectScript[], private queryScript: QueryScript[]) {}
  connect() {
    const step = this.connectScript[Math.min(this.connects, this.connectScript.length - 1)];
    this.connects++;
    return new Promise((resolve, reject) => {
      if (step === 'hang') return;
      this.clock.setTimer(() => (step.fail ? reject(new Error(step.fail)) : resolve(this.client())), step.after);
    });
  }
  private client() {
    const pool = this;
    let done = false;
    return {
      on() {},
      off() {},
      release(err?: unknown) {
        if (done) return;
        done = true;
        pool.released.push(err ? 'discarded' : 'ok');
      },
      query(text: string) {
        pool.sent.push(text);
        const step = pool.queryScript[Math.min(pool.sent.length - 1, pool.queryScript.length - 1)];
        return new Promise((resolve, reject) => {
          if (step === 'hang') return;
          pool.clock.setTimer(() => {
            if (step.err) reject(Object.assign(new Error(step.err.message ?? 'server error'), step.err.code ? { code: step.err.code } : {}));
            else resolve([{}, {}, {}, { rows: step.ok?.rows ?? [], rowCount: step.ok?.rowCount ?? 0 }, {}]);
          }, step.after);
        });
      },
    };
  }
  asPool() {
    return this as unknown as Parameters<typeof revokeAuthSession>[0];
  }
}

const H = 'A'.repeat(43);
const timeoutsIn = (sql: string) => ({
  statement: Number(/statement_timeout = '(\d+)ms'/.exec(sql)?.[1]),
  lock: Number(/lock_timeout = '(\d+)ms'/.exec(sql)?.[1]),
});

async function revokeScenario(connect: ConnectScript[], queries: QueryScript[]) {
  const clock = new FakeClock();
  const pool = new FakePool(clock, connect, queries);
  const events: SessionAttemptEvent[] = [];
  const r = await run(clock, () => revokeAuthSession(pool.asPool(), H, 'logout', { clock, observe: (e) => events.push(e) }));
  return { ...r, pool, events, attempts: events.length };
}

async function main() {
  // Contract constants (39233 §2).
  check('budgets: lookup acquire 500 / lock 250 / statement 1000 / deadline 2000', JSON.stringify(SESSION_LOOKUP_BOUNDS) === JSON.stringify({ acquireTimeoutMs: 500, lockTimeoutMs: 250, statementTimeoutMs: 1000, deadlineMs: 2000 }));
  check('budgets: write acquire 500 / lock 1000 / statement 1500 / deadline 2000', JSON.stringify(SESSION_WRITE_BOUNDS) === JSON.stringify({ acquireTimeoutMs: 500, lockTimeoutMs: 1000, statementTimeoutMs: 1500, deadlineMs: 2000 }));
  check('budgets: cleanup acquire 500 / lock 1000 / statement 5000 / deadline 6000', JSON.stringify(SESSION_CLEANUP_BOUNDS) === JSON.stringify({ acquireTimeoutMs: 500, lockTimeoutMs: 1000, statementTimeoutMs: 5000, deadlineMs: 6000 }));
  check('pool: dedicated five connections, 500 ms acquisition', SESSION_POOL_BOUNDS.max === 5 && SESSION_POOL_BOUNDS.connectionTimeoutMillis === 500);

  // 1. Successful first attempt.
  {
    const r = await revokeScenario([{ after: 5 }], [{ after: 10, ok: { rowCount: 1 } }]);
    check('1 success: revoked, 1 attempt, 15 ms, connection returned', r.value === 'revoked' && r.attempts === 1 && r.elapsed === 15 && r.pool.released.join() === 'ok', r);
    check('1 success: first send uses the full write maxima (1500 / 1000)', JSON.stringify(timeoutsIn(r.pool.sent[0])) === '{"statement":1500,"lock":1000}', r.pool.sent);
  }
  // 2. Confirmed statement failure: never retried.
  {
    const r = await revokeScenario([{ after: 0 }], [{ after: 1500, err: { code: '57014' } }, { after: 1, ok: { rowCount: 1 } }]);
    check('2 confirmed statement_timeout: failed, 1 attempt, no retry, 1500 ms', r.reason === 'statement_timeout' && r.outcome === 'failed' && r.attempts === 1 && r.pool.connects === 1 && r.elapsed === 1500, { reason: r.reason, outcome: r.outcome, attempts: r.attempts, elapsed: r.elapsed });
  }
  // 3. Confirmed lock failure: never retried.
  {
    const r = await revokeScenario([{ after: 0 }], [{ after: 1000, err: { code: '55P03' } }, { after: 1, ok: { rowCount: 1 } }]);
    check('3 confirmed lock_timeout: failed, 1 attempt, no retry, 1000 ms', r.reason === 'lock_timeout' && r.outcome === 'failed' && r.attempts === 1 && r.pool.connects === 1 && r.elapsed === 1000);
  }
  // 3b. Confirmed constraint failure: never retried.
  {
    const r = await revokeScenario([{ after: 0 }], [{ after: 5, err: { code: '23514' } }, { after: 1, ok: { rowCount: 1 } }]);
    check('3b confirmed constraint failure: failed, 1 attempt', r.reason === 'constraint' && r.outcome === 'failed' && r.attempts === 1);
  }
  // 4. Connection acquisition failure.
  {
    const hang = await revokeScenario(['hang'], [{ after: 1, ok: { rowCount: 1 } }]);
    check('4 acquire (no connection): failed at exactly 500 ms, nothing sent, no retry', hang.reason === 'acquire' && hang.outcome === 'failed' && hang.elapsed === 500 && hang.pool.sent.length === 0 && hang.attempts === 1, hang);
    const rej = await revokeScenario([{ after: 500, fail: 'timeout exceeded when trying to connect' }], [{ after: 1, ok: { rowCount: 1 } }]);
    check('4b acquire (pool timeout error): failed, nothing sent, no retry', rej.reason === 'acquire' && rej.outcome === 'failed' && rej.pool.sent.length === 0 && rej.attempts === 1);
  }
  // 5. Uncertain write outcome, then a safe retry.
  {
    const r = await revokeScenario([{ after: 0 }], [{ after: 400, err: { message: 'Connection terminated unexpectedly' } }, { after: 200, ok: { rowCount: 0 } }]);
    check('5 uncertain then retry: already_inactive (the first attempt had committed), 2 attempts, 600 ms', r.value === 'already_inactive' && r.attempts === 2 && r.elapsed === 600 && r.events[0].result === 'uncertain', { value: r.value, events: r.events, elapsed: r.elapsed });
    check('5 uncertain: the uncertain connection is discarded, the retry gets a fresh one', r.pool.connects === 2 && r.pool.released.join() === 'discarded,ok', r.pool.released);
  }
  // 6. Safe retry within the remaining budget: the retry's limits shrink to what remains.
  {
    const r = await revokeScenario([{ after: 0 }], [{ after: 1600, err: { message: 'socket hang up' } }, { after: 100, ok: { rowCount: 1 } }]);
    check('6 retry within budget: revoked, 2 attempts, total 1700 ms <= 2000', r.value === 'revoked' && r.attempts === 2 && r.elapsed === 1700, { value: r.value, elapsed: r.elapsed });
    check('6 retry limits = remaining budget (400 ms), not the maxima', JSON.stringify(timeoutsIn(r.pool.sent[1])) === '{"statement":400,"lock":400}', r.pool.sent[1]);
  }
  // 7. Insufficient remaining budget: no retry.
  {
    const r = await revokeScenario([{ after: 0 }], [{ after: 2000 - SESSION_MIN_RETRY_BUDGET_MS + 1, err: { message: 'socket hang up' } }, { after: 1, ok: { rowCount: 1 } }]);
    check(`7 insufficient budget (< ${SESSION_MIN_RETRY_BUDGET_MS} ms left): uncertain, 1 attempt, no retry`, r.outcome === 'uncertain' && r.attempts === 1 && r.pool.connects === 1, { outcome: r.outcome, attempts: r.attempts });
    const edge = await revokeScenario([{ after: 0 }], [{ after: 2000 - SESSION_MIN_RETRY_BUDGET_MS, err: { message: 'socket hang up' } }, { after: 1, ok: { rowCount: 1 } }]);
    check(`7b exactly ${SESSION_MIN_RETRY_BUDGET_MS} ms left: one retry is allowed`, edge.value === 'revoked' && edge.attempts === 2);
  }
  // 8. Deadline exhaustion.
  {
    const r = await revokeScenario([{ after: 0 }], ['hang']);
    check('8 deadline exhaustion: uncertain at exactly 2000 ms, 1 attempt, connection discarded', r.reason === 'deadline' && r.outcome === 'uncertain' && r.elapsed === 2000 && r.attempts === 1 && r.pool.released.join() === 'discarded', r);
  }
  // 9. A retry can never reset or extend the deadline.
  {
    const r = await revokeScenario([{ after: 0 }], [{ after: 1600, err: { message: 'socket hang up' } }, 'hang']);
    check('9 retry hangs: still ends at the ORIGINAL deadline (2000 ms, not 1600 + 2000)', r.reason === 'deadline' && r.elapsed === 2000 && r.attempts === 2, { reason: r.reason, elapsed: r.elapsed, attempts: r.attempts });
    const slowAcquire = await revokeScenario([{ after: 0 }, 'hang'], [{ after: 1600, err: { message: 'socket hang up' } }]);
    check('9b retry acquisition waits only for the remaining 400 ms (not 500), ends at 2000 ms', slowAcquire.elapsed === 2000 && slowAcquire.outcome === 'failed' && slowAcquire.attempts === 2, { elapsed: slowAcquire.elapsed, reason: slowAcquire.reason });
  }
  // 10. Late operation completion: never used.
  {
    const r = await revokeScenario([{ after: 0 }], [{ after: 2100, ok: { rowCount: 1 } }]);
    check('10 late completion (2100 ms): reported uncertain at 2000 ms, result ignored, connection discarded once', r.reason === 'deadline' && r.outcome === 'uncertain' && r.elapsed === 2000 && r.value === undefined && r.pool.released.join() === 'discarded', r);
  }
  // 11. Pool recovery after a failure.
  {
    const clock = new FakeClock();
    const pool = new FakePool(clock, [{ after: 0 }], [{ after: 50, err: { message: 'socket hang up' } }, { after: 50, err: { message: 'socket hang up' } }, { after: 5, ok: { rowCount: 1 } }]);
    const first = await run(clock, () => revokeAuthSession(pool.asPool(), H, 'logout', { clock }));
    const second = await run(clock, () => revokeAuthSession(pool.asPool(), H, 'logout', { clock }));
    check('11 recovery: a failed operation discards its connections; the next one succeeds normally', first.outcome === 'uncertain' && second.value === 'revoked' && pool.released.join() === 'discarded,discarded,ok', { first: first.outcome, second: second.value, released: pool.released });
  }
  // 12. Exact deadline boundaries for a single bounded statement (lookup).
  {
    const clock = new FakeClock();
    const pool = new FakePool(clock, [{ after: 1999 }], [{ after: 0, ok: { rowCount: 0 } }]);
    // lookup's own acquisition maximum is 500 ms; use boundedSessionQuery with a larger acquisition bound to reach t=1999.
    const r = await run(clock, () => boundedSessionQuery(pool.asPool(), 'SELECT 1', { ...SESSION_LOOKUP_BOUNDS, acquireTimeoutMs: 5000 }, { clock }));
    check('12 boundary: connection at 1999 ms -> sent with statement/lock limits of exactly 1 ms', r.settled && JSON.stringify(timeoutsIn(pool.sent[0])) === '{"statement":1,"lock":1}', pool.sent);
    const clock2 = new FakeClock();
    const pool2 = new FakePool(clock2, [{ after: 2000 }], [{ after: 0, ok: { rowCount: 0 } }]);
    const r2 = await run(clock2, () => boundedSessionQuery(pool2.asPool(), 'SELECT 1', { ...SESSION_LOOKUP_BOUNDS, acquireTimeoutMs: 5000 }, { clock: clock2 }));
    check('12b boundary: connection only at 2000 ms -> nothing sent, confirmed failure (deadline)', r2.reason === 'deadline' && r2.outcome === 'failed' && pool2.sent.length === 0, { reason: r2.reason, sent: pool2.sent.length });
    const clock3 = new FakeClock();
    const pool3 = new FakePool(clock3, [{ after: 0 }], [{ after: 0, ok: { rowCount: 0 } }]);
    const r3 = await run(clock3, () => boundedSessionQuery(pool3.asPool(), 'SELECT 1', SESSION_LOOKUP_BOUNDS, { clock: clock3, deadlineAt: clock3.now() + 300 }));
    check('12c an external deadlineAt can only shorten the budget (300 ms -> limits 300 / 250)', r3.settled && JSON.stringify(timeoutsIn(pool3.sent[0])) === '{"statement":300,"lock":250}', pool3.sent);
    const clock4 = new FakeClock();
    const pool4 = new FakePool(clock4, [{ after: 0 }], [{ after: 0, ok: { rowCount: 0 } }]);
    await run(clock4, () => boundedSessionQuery(pool4.asPool(), 'SELECT 1', SESSION_LOOKUP_BOUNDS, { clock: clock4, deadlineAt: clock4.now() + 60_000 }));
    check('12d a far deadlineAt can never extend the budget (limits stay 1000 / 250)', JSON.stringify(timeoutsIn(pool4.sent[0])) === '{"statement":1000,"lock":250}', pool4.sent);
  }
  // 13. Lookups are never retried.
  {
    const clock = new FakeClock();
    const pool = new FakePool(clock, [{ after: 0 }], [{ after: 10, err: { message: 'socket hang up' } }, { after: 1, ok: { rowCount: 0 } }]);
    const r = await run(clock, () => lookupAuthSession(pool.asPool(), H, '00000000-0000-4000-8000-000000000000', { clock }));
    check('13 lookup: an uncertain failure is reported, never retried', r.outcome === 'uncertain' && pool.connects === 1);
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FAIL  unexpected', e);
  process.exit(1);
});
