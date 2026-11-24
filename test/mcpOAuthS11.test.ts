/**
 * AURA-MCP-02-I2b-S11 -- offline regressions for the S10 independent review
 * findings (no database).
 *
 *   P3-1  absolute monotonic deadlines, checked at transaction boundaries --
 *         with a FAKE clock that jumps while timer callbacks are still
 *         pending (a stalled event loop): late checkout, pre-COMMIT expiry,
 *         late acknowledgement, hold expiry, limiter decisions, request
 *         budget; ambiguous outcomes stay "unknown", never success
 *   P3-2  configured-secret validation: canonical hex / base64 / base64url,
 *         decoded-length strength, and every counterexample from the review
 *   P2-1  (unit) the checkout guard: one listener, removed on clean release,
 *         kept on discard, errors never rethrown
 */
import { createHash, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { assessSecret } from '../packages/mcp-tools/src/auth/keys';
import { boundedStatement, guardClient, heldStatement, requestBudgetRemainingMs, runWithRequestBudget, setDeadlineClockForTests, StoreUnavailableError, type BoundedPool } from '../packages/mcp-tools/src/security/deadline';
import { createPostgresRateLimiter } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { check, summary } from './mcpOAuthI2bHarness';

let fake = 0;
const useFakeClock = () => {
  fake = 1_000_000;
  setDeadlineClockForTests(() => fake);
};
const realClock = () => setDeadlineClockForTests(null);
const failure = (p: Promise<unknown>) => p.then(() => null, (e) => e as unknown);

/** Fake pool whose statements can move the fake clock. */
function clockPool(onQuery: (text: string) => { advance?: number; result?: unknown } | void, onConnect?: () => void) {
  const st = { statements: [] as string[], clean: 0, destroyed: 0, connects: 0 };
  const pool = <BoundedPool>(<unknown>{
    connect: async () => {
      st.connects += 1;
      onConnect?.();
      const em = new EventEmitter();
      return Object.assign(em, {
        query: async (t: string) => {
          const head = t.split(';')[0];
          st.statements.push(head);
          const r = onQuery(t) ?? {};
          if (r.advance) fake += r.advance;
          return r.result ?? { rows: [{ ok: 1 }], rowCount: 1, command: head.startsWith('BEGIN') ? 'SET' : head === 'COMMIT' ? 'COMMIT' : 'UPDATE' };
        },
        release: (err?: unknown) => {
          if (err) st.destroyed += 1;
          else st.clean += 1;
        },
      });
    },
  });
  return { pool, st };
}
const opts = { deadlineMs: 100, statementTimeoutMs: 80, lockTimeoutMs: 50 };

async function main() {
  // ------------------------------------------------------------------ P3-1
  try {
    useFakeClock();
    {
      // The reviewer's probe: a 100 ms request clock reads 150 ms during the statement.
      const p = clockPool((t) => (t === 'SELECT 1' ? { advance: 50 } : undefined));
      const e = await runWithRequestBudget(100, async () => {
        fake += 100; // 100 ms already gone in the request
        return failure(boundedStatement(p.pool, 'SELECT 1', [], { ...opts, deadlineMs: 3000 }));
      });
      check('P3-1 review probe: budget 100 ms, clock at 150 ms during the statement -> NO COMMIT, no success (StoreUnavailableError)', e instanceof StoreUnavailableError && !p.st.statements.includes('COMMIT'), { e: String(e), st: p.st });
    }
    {
      const p = clockPool((t) => (t === 'UPDATE x' ? { advance: 150 } : undefined));
      const e = await failure(boundedStatement(p.pool, 'UPDATE x', [], opts));
      check('P3-1 pre-COMMIT expiry with the timer not yet run: COMMIT is never sent, timeout, connection discarded (rollback)', e instanceof StoreUnavailableError && (e as StoreUnavailableError).reason === 'timeout' && !p.st.statements.includes('COMMIT') && p.st.destroyed === 1, p.st);
    }
    {
      const p = clockPool(() => undefined, () => {
        fake += 150;
      });
      const e = await failure(boundedStatement(p.pool, 'UPDATE x', [], opts));
      check('P3-1 late checkout: the connection is returned UNUSED (clean, no BEGIN), timeout', e instanceof StoreUnavailableError && p.st.statements.length === 0 && p.st.clean === 1 && p.st.destroyed === 0, p.st);
    }
    {
      const p = clockPool((t) => (t === 'COMMIT' ? { advance: 150 } : undefined));
      const e = await failure(boundedStatement(p.pool, 'UPDATE x', [], opts));
      check('P3-1 late COMMIT acknowledgement (confirmed tag, past the deadline): reported as failure (outcome unknown -- it landed), never a late success; the finished connection is returned clean', e instanceof StoreUnavailableError && p.st.statements.includes('COMMIT') && p.st.clean === 1, p.st);
    }
    {
      const p = clockPool(() => undefined);
      const r = await failure(boundedStatement(p.pool, 'UPDATE x', [], opts));
      check('P3-1 control: within the deadline the statement commits and succeeds', r === null && p.st.clean === 1);
    }
    {
      const p = clockPool(() => undefined);
      const h = await heldStatement(p.pool, 'UPDATE x', [], { ...opts, holdMs: 100 });
      fake += 150; // the hold instant passes; its timer has not run
      const o = await h.commit(100);
      check('P3-1 held: a hold whose instant has passed (timer not yet run) -> not_committed, COMMIT never sent, connection discarded', o === 'not_committed' && !p.st.statements.includes('COMMIT') && p.st.destroyed === 1, { o, st: p.st });
    }
    {
      const p = clockPool((t) => (t === 'COMMIT' ? { advance: 200 } : undefined));
      const h = await heldStatement(p.pool, 'UPDATE x', [], { ...opts, holdMs: 1000 });
      const o = await h.commit(100);
      check('P3-1 held: a confirmed but LATE COMMIT acknowledgement -> "unknown" (it landed; never reported as a timely success)', o === 'unknown', o);
    }
    {
      const p = clockPool((t) => (t === 'UPDATE x' ? { advance: 150 } : undefined));
      const e = await failure(heldStatement(p.pool, 'UPDATE x', [], { ...opts, holdMs: 1000 }));
      check('P3-1 held phase 1 past its deadline: rejected, connection discarded, nothing held', e instanceof StoreUnavailableError && p.st.destroyed === 1, p.st);
    }
    {
      // Limiter: pre-COMMIT expiry -> deadline shedding (nothing counted).
      const p = clockPool((t) => {
        if (t.startsWith('WITH want')) return { advance: 2000, result: { rows: [{ key: 'user:a', cnt: 0, retry: 60, ok: true, bumped: 1 }], rowCount: 1 } };
        return undefined;
      });
      const lim = createPostgresRateLimiter({ pool: p.pool as never, windowMs: 60_000 });
      const d = await lim.check([{ key: 'user:a', limit: 5 }]);
      check('P3-1 limiter: decision past its absolute deadline before COMMIT -> unavailable/deadline, COMMIT never sent, connection discarded', !d.allowed && d.limitedBy === 'unavailable' && d.cause === 'deadline' && !p.st.statements.includes('COMMIT') && p.st.destroyed === 1, { d, st: p.st });
      const p2 = clockPool((t) => {
        if (t.startsWith('WITH want')) return { result: { rows: [{ key: 'user:a', cnt: 0, retry: 60, ok: true, bumped: 1 }], rowCount: 1 } };
        if (t === 'COMMIT') return { advance: 2000 };
        return undefined;
      });
      const lim2 = createPostgresRateLimiter({ pool: p2.pool as never, windowMs: 60_000 });
      const d2 = await lim2.check([{ key: 'user:a', limit: 5 }]);
      check('P3-1 limiter: a confirmed but LATE COMMIT is not an admission -> unavailable/commit_unknown (counted, not admitted: over-count only)', !d2.allowed && d2.cause === 'commit_unknown' && p2.st.statements.includes('COMMIT'), d2);
      const p3 = clockPool((t) => (t.startsWith('WITH want') ? { result: { rows: [{ key: 'user:a', cnt: 0, retry: 60, ok: true, bumped: 1 }], rowCount: 1 } } : undefined));
      const d3 = await createPostgresRateLimiter({ pool: p3.pool as never, windowMs: 60_000 }).check([{ key: 'user:a', limit: 5 }]);
      check('P3-1 limiter control: a timely confirmed COMMIT admits', d3.allowed === true, d3);
      const p4 = { connect: async () => {
        throw new Error('pool exhausted');
      } };
      const d4 = await createPostgresRateLimiter({ pool: p4 as never, windowMs: 60_000 }).check([{ key: 'user:a', limit: 5 }]);
      check('P2-3 limiter cause: a checkout failure is reported as cause "checkout" (unexpected, not shedding)', !d4.allowed && d4.cause === 'checkout', d4);
    }
    {
      const left = await runWithRequestBudget(500, async () => {
        fake += 600;
        return requestBudgetRemainingMs();
      });
      check('P3-1 the request budget runs on the monotonic clock (600 ms later: 0 left)', left === 0, left);
    }
  } finally {
    realClock();
  }

  // ------------------------------------------------------------------ P2-1 (unit) checkout guard
  {
    const em = new EventEmitter() as EventEmitter & { query: () => Promise<never>; release: (e?: unknown) => void };
    let released: unknown = 'no';
    em.query = async () => {
      throw new Error('unused');
    };
    em.release = (e?: unknown) => {
      released = e ?? null;
    };
    let errors = 0;
    const g = guardClient(em, () => {
      errors += 1;
    });
    check('P2-1 guard attaches exactly one error listener at checkout', em.listenerCount('error') === 1);
    g.releaseClean();
    check('P2-1 clean release removes exactly our listener and returns the client normally', em.listenerCount('error') === 0 && released === null);
    const em2 = new EventEmitter() as EventEmitter & { query: () => Promise<never>; release: (e?: unknown) => void };
    em2.query = em.query;
    let rel2: unknown = 'no';
    em2.release = (e?: unknown) => {
      rel2 = e ?? null;
    };
    const g2 = guardClient(em2, () => {
      errors += 1;
      throw new Error('handler throws');
    });
    em2.emit('error', new Error('terminating connection due to idle-in-transaction timeout'));
    em2.emit('error', new Error('Connection terminated unexpectedly'));
    check('P2-1 two connection errors: handled once (no throw, no crash), client marked broken', errors === 1 && g2.broken === true);
    g2.releaseClean();
    check('P2-1 releasing a broken client DISCARDS it (release with an error) and keeps the listener for late socket errors', rel2 instanceof Error && em2.listenerCount('error') === 1);
    em2.emit('error', new Error('late socket error after release'));
    check('P2-1 a late error after discard is still absorbed', errors === 1);
  }

  // ------------------------------------------------------------------ P3-2 secrets
  {
    const b24 = randomBytes(24);
    const odd = randomBytes(16).toString('hex') + 'a';
    const bad33 = b24.toString('base64') + 'A'; // 33 chars: an impossible base64 length
    // Non-canonical pad bits: last significant char altered so decode+encode differs.
    const canon44 = randomBytes(32).toString('base64');
    const lastIdx = canon44.length - 2; // char before the single '='
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const i = alpha.indexOf(canon44[lastIdx]);
    const nonCanon = canon44.slice(0, lastIdx) + alpha[(i & ~3) | ((i + 1) & 3)] + '=';
    const url43 = randomBytes(32).toString('base64url');
    const digest = createHash('sha256').update('aura-public-synthetic-label').digest('base64url');
    const r1 = assessSecret(odd);
    const r2 = assessSecret(bad33);
    const r3 = assessSecret(nonCanon);
    const r4 = assessSecret(url43);
    const r5 = assessSecret(digest);
    // A canonical 24-byte base64 value containing a 12+ run: build bytes whose encoding starts with "ABCDEFGHIJKL".
    const withRun = Buffer.concat([Buffer.from('ABCDEFGHIJKL', 'base64'), randomBytes(15)]).toString('base64');
    const r6 = assessSecret(withRun);
    check('P3-2 odd-length hex is NOT treated as hex (legacy S8 rule applies)', r1.format === 'text', r1);
    check('P3-2 an impossible base64 length (33 chars) is NOT treated as base64 (legacy rule; no 198-bit format estimate)', r2.format === 'text' && r2.bits < 198, r2);
    check('P3-2 non-canonical base64 pad bits are NOT treated as base64 (legacy rule)', nonCanon !== canon44 && Buffer.from(nonCanon, 'base64').toString('base64') !== nonCanon && r3.format === 'text', { nonCanon, r3 });
    check('P3-2 strength is the DECODED length: a 43-char base64url encoding of 32 bytes is 256 bits (not 258)', r4.format === 'base64' && r4.bits === 256 && r4.ok, r4);
    check('P3-2 canonical 24-byte base64 = 192 bits; 16-byte hex = 128 bits', assessSecret(b24.toString('base64')).bits === 192 && assessSecret(randomBytes(16).toString('hex')).bits === 128);
    check('P3-2 documented limitation: a deterministic digest of a public label is a canonical encoding and PASSES -- provenance is D9, not detectable at runtime', r5.ok && r5.format === 'base64', r5);
    check('P3-2 explicit legacy policy: a canonical value with a >= 12 run is REFUSED as patterned even though the S8 rule would accept it (regenerate it)', !r6.ok && r6.reason === 'run', { withRun: withRun.slice(0, 16), r6 });
    for (const [label, gen] of [
      ['hex 16 B', () => randomBytes(16).toString('hex')],
      ['HEX 16 B', () => randomBytes(16).toString('hex').toUpperCase()],
      ['base64 24 B', () => randomBytes(24).toString('base64')],
      ['base64 32 B', () => randomBytes(32).toString('base64')],
      ['base64url 24 B', () => randomBytes(24).toString('base64url')],
      ['base64url 32 B', () => randomBytes(32).toString('base64url')],
    ] as [string, () => string][]) {
      let refused = 0;
      let notCanonical = 0;
      for (let k = 0; k < 10_000; k += 1) {
        const r = assessSecret(gen());
        if (!r.ok) refused += 1;
        if (r.format === 'text') notCanonical += 1;
      }
      check(`P3-2 ${label}: 10,000 CSPRNG samples all canonical and accepted`, refused === 0 && notCanonical === 0, { refused, notCanonical });
    }
  }

  summary('AURA-MCP-02-I2b-S11 offline');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
