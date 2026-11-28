import type { Pool, PoolClient } from 'pg';
import { storageKey } from '../../../packages/mcp-tools/src/auth/postgresAdapter';
import { authorizationCovered } from '../../../packages/mcp-tools/src/auth/consentFinalization';
import { SESSION_CLEANUP_BOUNDS, SESSION_LOOKUP_BOUNDS, SESSION_WRITE_BOUNDS, SYSTEM_SESSION_CLOCK, type SessionClock, type SessionQueryBounds } from './authSessionDb';
import { SessionVerificationUnavailableError } from './sessionErrors';

/**
 * AURA-AUTH-SESSION-01-I2-R2 (39250, design Rev 4 B3) -- MCP consent
 * finalization in the AURA database (migration 0057). The MCP OAuth store
 * stays in its own database; this table is the authoritative "completed
 * authorization" record that the OAuth server's Grant model checks
 * (packages/mcp-tools/src/auth/consentFinalization.ts).
 *
 * Linearization point: the COMMIT of ONE conditional INSERT that selects the
 * approving AuthSession row FOR SHARE and requires it to be live by the
 * database clock (revokedAt IS NULL, expiresAt > now()) and to be the row
 * the cookie's token was issued for (same userId and expiresAt). Logout's
 * UPDATE conflicts with FOR SHARE, so in this one database either the
 * finalization commits first (a completed authorization, which then
 * survives ordinary logout) or the revocation does and READ COMMITTED
 * re-evaluates the row: zero rows inserted, consent refused.
 *
 * Bounds (Rev 3 §8.1): every call runs on the session pool inside one
 * caller deadline (`deadlineAt`, monotonic), with acquisition and the SET
 * LOCAL statement / lock / idle-in-transaction limits clamped to what
 * remains. Statements are parameterized. Failures throw
 * SessionVerificationUnavailableError: outcome 'failed' (nothing committed)
 * or 'uncertain' (COMMIT sent, reply not received -- the caller must treat
 * the finalization as NOT confirmed).
 */

const TIMED_OUT = Symbol('timed out');

function onClientError(err: unknown): void {
  console.error(`[mcp-consent] checked-out client error (${err instanceof Error ? err.name : 'Error'})`);
}

async function race<T>(work: Promise<T>, ms: number, clock: SessionClock): Promise<T | typeof TIMED_OUT> {
  work.catch(() => {});
  if (!(ms > 0)) return TIMED_OUT;
  let handle: unknown;
  const timer = new Promise<typeof TIMED_OUT>((resolve) => {
    handle = clock.setTimer(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, timer]);
  } finally {
    clock.clearTimer(handle);
  }
}

/** Runs `work` in one bounded transaction; resolves only after an ACKNOWLEDGED COMMIT. */
async function boundedTransaction<T>(
  pool: Pool,
  bounds: Required<SessionQueryBounds>,
  deadlineAt: number,
  work: (client: PoolClient) => Promise<T>,
  clock: SessionClock = SYSTEM_SESSION_CLOCK
): Promise<T> {
  const end = Math.min(deadlineAt, clock.now() + bounds.deadlineMs);
  const remaining = () => end - clock.now();
  if (!(remaining() >= 1)) throw new SessionVerificationUnavailableError('deadline', 'failed');
  let abandoned = false;
  const connecting = pool.connect();
  connecting.then((c) => abandoned && c.release(new Error('mcp-consent checkout abandoned')), () => {});
  let acquired: PoolClient | typeof TIMED_OUT;
  try {
    acquired = await race(connecting, Math.min(bounds.acquireTimeoutMs, remaining()), clock);
  } catch {
    abandoned = true;
    throw new SessionVerificationUnavailableError('acquire', 'failed');
  }
  if (acquired === TIMED_OUT) {
    abandoned = true;
    throw new SessionVerificationUnavailableError(remaining() > 0 ? 'acquire' : 'deadline', 'failed');
  }
  const client = acquired;
  client.on('error', onClientError);
  let released = false;
  const release = (discard: boolean) => {
    if (released) return;
    released = true;
    client.off('error', onClientError);
    client.release(discard ? new Error('mcp-consent connection discarded') : undefined);
  };
  try {
    const left = Math.floor(remaining());
    if (left < 1) throw new SessionVerificationUnavailableError('deadline', 'failed');
    const statementMs = Math.min(bounds.statementTimeoutMs, left);
    const lockMs = Math.min(bounds.lockTimeoutMs, statementMs);
    const begun = await race(
      client.query(`BEGIN; SET LOCAL statement_timeout = '${statementMs}ms'; SET LOCAL lock_timeout = '${lockMs}ms'; SET LOCAL idle_in_transaction_session_timeout = '${left}ms'`),
      remaining(),
      clock
    );
    if (begun === TIMED_OUT) throw new SessionVerificationUnavailableError('deadline', 'failed');
    const value = await race(work(client), remaining(), clock);
    if (value === TIMED_OUT) throw new SessionVerificationUnavailableError('deadline', 'failed');
    // Nothing is committed unless the COMMIT is sent with budget left.
    if (!(remaining() >= 1)) throw new SessionVerificationUnavailableError('deadline', 'failed');
    let committed: { command?: string } | typeof TIMED_OUT;
    try {
      committed = (await race(client.query('COMMIT'), remaining(), clock)) as { command?: string } | typeof TIMED_OUT;
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      release(true);
      // PostgreSQL itself rejected the COMMIT: nothing committed.
      if (typeof code === 'string' && /^(23|25|40)/.test(code)) throw new SessionVerificationUnavailableError('driver', 'failed');
      throw new SessionVerificationUnavailableError('driver', 'uncertain');
    }
    if (committed === TIMED_OUT) {
      release(true);
      throw new SessionVerificationUnavailableError('deadline', 'uncertain');
    }
    if (committed.command !== 'COMMIT') {
      release(true);
      throw new SessionVerificationUnavailableError('shape', committed.command === 'ROLLBACK' ? 'failed' : 'uncertain');
    }
    release(false);
    return value;
  } catch (err) {
    // Unknown connection state: discard it; PostgreSQL rolls the open transaction back.
    release(true);
    if (err instanceof SessionVerificationUnavailableError) throw err;
    throw new SessionVerificationUnavailableError('driver', 'failed');
  }
}

const canonical = (items: readonly string[]) => [...new Set(items)].sort().join('\n');

export interface FinalizeConsentInput {
  grantId: string;
  userId: string;
  clientId: string;
  authorization: readonly string[];
  grantLifetimeSeconds: number;
  /** The approving session row, from the verified cookie token (lib/session.ts sessionRowRefFromCookieHeader). */
  session: { idHash: string; userId: string; expiresAt: Date };
  deadlineAt: number;
}

/** Margin past the grant's maximum lifetime before a finalization row may be cleaned up. */
export const FINALIZATION_RETENTION_MARGIN_SECONDS = 24 * 3600;

/**
 * 'finalized' only after an acknowledged COMMIT that inserted the row.
 * 'refused': the session is revoked, expired, not this user's or not the
 * token's row, or the grant was already finalized (rows are never replaced).
 */
export async function finalizeConsent(pool: Pool, input: FinalizeConsentInput, clock: SessionClock = SYSTEM_SESSION_CLOCK): Promise<'finalized' | 'refused'> {
  const authorization = canonical(input.authorization);
  if (!input.grantId || !input.clientId || authorization.length === 0 || input.session.userId !== input.userId) return 'refused';
  const lifetime = Math.floor(input.grantLifetimeSeconds) + FINALIZATION_RETENTION_MARGIN_SECONDS;
  if (!(lifetime > 0)) return 'refused';
  const inserted = await boundedTransaction(
    pool,
    SESSION_WRITE_BOUNDS,
    input.deadlineAt,
    async (client) => {
      const r = await client.query(
        `INSERT INTO "McpConsentFinalization" ("grantKey", "userId", "clientId", "authorization", "authSessionIdHash", "expiresAt")
         SELECT $1, s."userId", $3, $4, s."idHash", now() + make_interval(secs => $5::int)
           FROM "AuthSession" s
          WHERE s."idHash" = $6 AND s."userId" = $2 AND s."expiresAt" = $7
            AND s."revokedAt" IS NULL AND s."expiresAt" > now()
            FOR SHARE OF s
         ON CONFLICT ("grantKey") DO NOTHING
         RETURNING 1 AS ok`,
        [storageKey(input.grantId), input.userId, input.clientId, authorization, lifetime, input.session.idHash, input.session.expiresAt]
      );
      return r.rowCount === 1;
    },
    clock
  );
  return inserted ? 'finalized' : 'refused';
}

/** True only for a live (unexpired) finalization of this grant, account and client that covers `authorization`. */
export async function isConsentFinalized(
  pool: Pool,
  input: { grantId: string; accountId: string; clientId: string; authorization: readonly string[]; deadlineAt: number },
  clock: SessionClock = SYSTEM_SESSION_CLOCK
): Promise<boolean> {
  if (!input.grantId || input.authorization.length === 0) return false;
  const row = await boundedTransaction(
    pool,
    SESSION_LOOKUP_BOUNDS,
    input.deadlineAt,
    async (client) =>
      (
        await client.query(`SELECT "userId", "clientId", "authorization" FROM "McpConsentFinalization" WHERE "grantKey" = $1 AND "expiresAt" > now()`, [
          storageKey(input.grantId),
        ])
      ).rows[0] as { userId?: unknown; clientId?: unknown; authorization?: unknown } | undefined,
    clock
  );
  if (!row || row.userId !== input.accountId || row.clientId !== input.clientId || typeof row.authorization !== 'string') return false;
  const finalized = row.authorization.split('\n').filter(Boolean);
  return finalized.length > 0 && authorizationCovered(input.authorization, finalized);
}

/** Daily cron: deletes expired finalization rows (bounded batch). Never deletes an unexpired row. */
export async function cleanupConsentFinalizations(pool: Pool, limit = 500, clock: SessionClock = SYSTEM_SESSION_CLOCK): Promise<number> {
  const n = Math.max(1, Math.min(5000, Math.floor(limit)));
  return boundedTransaction(
    pool,
    SESSION_CLEANUP_BOUNDS,
    clock.now() + SESSION_CLEANUP_BOUNDS.deadlineMs,
    async (client) =>
      (await client.query(`DELETE FROM "McpConsentFinalization" WHERE ctid IN (SELECT ctid FROM "McpConsentFinalization" WHERE "expiresAt" < now() LIMIT $1)`, [n])).rowCount ?? 0,
    clock
  );
}
