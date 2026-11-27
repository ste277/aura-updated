/**
 * AURA-AUTH-SESSION-01-I1 -- the server-side session allowlist ("AuthSession",
 * migration 0055). AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md §2.1, §2.4, §3.
 *
 * A session is valid ONLY while its row exists, has not been revoked and has
 * not expired (database clock). Anything else -- a missing row, a revoked or
 * expired row, a malformed id -- means "not authenticated". Any failure to
 * find out means SessionVerificationUnavailableError (fail closed).
 *
 * Standalone operations take the dedicated pool (lib/authSessionDb.ts
 * createSessionPool) and run under its L1-L3 bounds. Operations that must sit
 * inside a caller's transaction (revoke-all during account deletion, the B3
 * FOR SHARE re-check) take that caller's client; the caller owns its
 * transaction and its SET LOCAL timeouts.
 *
 * DORMANT: nothing in the application imports this module yet
 * (test/authSessionDormancy.test.ts). Sign-in, logout and the as_session
 * cookie are unchanged until the authorized cutover (I2).
 */
import type { Pool, PoolClient } from 'pg';
import {
  boundedSessionQuery,
  sqlInteger,
  sqlLiteral,
  toSessionUnavailable,
  SESSION_CLEANUP_BOUNDS,
  SESSION_LOOKUP_BOUNDS,
  SESSION_REVOKE_REASONS,
  SESSION_WRITE_BOUNDS,
  type SessionRevokeReason,
} from './authSessionDb';
import { generateSessionId, hashSessionId, SESSION_ID_HASH_PATTERN, SESSION_TTL_DAYS, USER_ID_PATTERN } from './authSessionToken';
import { SessionVerificationUnavailableError } from './sessionErrors';

export interface CreatedAuthSession {
  /** The raw session id: goes into the signed token only, never stored. */
  sid: string;
  idHash: string;
  /** Set by the database: now() + 30 days. */
  expiresAt: Date;
}

export interface LiveAuthSession {
  userId: string;
  expiresAt: Date;
}

export interface LiveAuthSessionWithUser extends LiveAuthSession {
  user: Record<string, unknown>;
}

export type RevokeOutcome = 'revoked' | 'already_inactive';

const TTL = `make_interval(days => ${SESSION_TTL_DAYS})`;

function validIdHash(v: unknown): v is string {
  return typeof v === 'string' && SESSION_ID_HASH_PATTERN.test(v);
}

function validUserId(v: unknown): v is string {
  return typeof v === 'string' && USER_ID_PATTERN.test(v);
}

function asDate(v: unknown): Date {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) throw new SessionVerificationUnavailableError('shape');
  return v;
}

/** Statement shared by the standalone and in-transaction creates. */
function insertStatement(idHash: string, userId: string): string {
  return (
    `INSERT INTO "AuthSession" ("idHash", "userId", "expiresAt") ` +
    `VALUES (${sqlLiteral(idHash, 'idHash')}, ${sqlLiteral(userId, 'userId')}, now() + ${TTL}) ` +
    `RETURNING "expiresAt"`
  );
}

/**
 * Creates a session row. If this throws, no cookie may be issued; a row that
 * may nevertheless have committed is unusable, because its raw id was never
 * disclosed.
 */
export async function createAuthSession(pool: Pool, userId: string): Promise<CreatedAuthSession> {
  if (!validUserId(userId)) throw new TypeError('Invalid userId.');
  const sid = generateSessionId();
  const idHash = hashSessionId(sid);
  const { rows } = await boundedSessionQuery(pool, insertStatement(idHash, userId), SESSION_WRITE_BOUNDS);
  if (rows.length !== 1) throw new SessionVerificationUnavailableError('shape');
  return { sid, idHash, expiresAt: asDate(rows[0].expiresAt) };
}

/**
 * The same insert inside the caller's transaction -- so that consuming the
 * sign-in code and creating the session commit together (I2, design §2.4).
 */
export async function createAuthSessionInTransaction(client: PoolClient, userId: string): Promise<CreatedAuthSession> {
  if (!validUserId(userId)) throw new TypeError('Invalid userId.');
  const sid = generateSessionId();
  const idHash = hashSessionId(sid);
  let rows: Record<string, unknown>[];
  try {
    rows = (await client.query(insertStatement(idHash, userId))).rows;
  } catch (err) {
    throw toSessionUnavailable(err);
  }
  if (rows.length !== 1) throw new SessionVerificationUnavailableError('shape');
  return { sid, idHash, expiresAt: asDate(rows[0].expiresAt) };
}

function liveWhere(idHash: string, userId: string, alias = ''): string {
  const a = alias ? `${alias}.` : '';
  return (
    `${a}"idHash" = ${sqlLiteral(idHash, 'idHash')} AND ${a}"userId" = ${sqlLiteral(userId, 'userId')} ` +
    `AND ${a}"revokedAt" IS NULL AND ${a}"expiresAt" > now()`
  );
}

/** The live session, or null. Throws SessionVerificationUnavailableError if that cannot be established. */
export async function lookupAuthSession(pool: Pool, idHash: string, userId: string): Promise<LiveAuthSession | null> {
  if (!validIdHash(idHash) || !validUserId(userId)) return null;
  const { rows } = await boundedSessionQuery(
    pool,
    `SELECT "userId", "expiresAt" FROM "AuthSession" WHERE ${liveWhere(idHash, userId)}`,
    SESSION_LOOKUP_BOUNDS
  );
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0].userId !== userId) throw new SessionVerificationUnavailableError('shape');
  return { userId, expiresAt: asDate(rows[0].expiresAt) };
}

/** Joined variant for routes that also need the user row: one round trip. */
export async function lookupAuthSessionWithUser(pool: Pool, idHash: string, userId: string): Promise<LiveAuthSessionWithUser | null> {
  if (!validIdHash(idHash) || !validUserId(userId)) return null;
  const { rows } = await boundedSessionQuery(
    pool,
    `SELECT s."expiresAt" AS "authSessionExpiresAt", u.* FROM "AuthSession" s ` +
      `JOIN "User" u ON u.id = s."userId" WHERE ${liveWhere(idHash, userId, 's')}`,
    SESSION_LOOKUP_BOUNDS
  );
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0].id !== userId) throw new SessionVerificationUnavailableError('shape');
  const { authSessionExpiresAt, ...user } = rows[0];
  return { userId, expiresAt: asDate(authSessionExpiresAt), user };
}

/**
 * Idempotent revocation. 'already_inactive' (already revoked, or no such row)
 * is a success too. An ambiguous outcome is retried once -- the UPDATE is
 * idempotent -- and then reported as unavailable, never as success.
 */
export async function revokeAuthSession(pool: Pool, idHash: string, reason: SessionRevokeReason): Promise<RevokeOutcome> {
  if (!(SESSION_REVOKE_REASONS as readonly string[]).includes(reason)) throw new TypeError('Invalid revoke reason.');
  if (!validIdHash(idHash)) return 'already_inactive';
  const statement =
    `UPDATE "AuthSession" SET "revokedAt" = now(), "revokeReason" = ${sqlLiteral(reason, 'reason')} ` +
    `WHERE "idHash" = ${sqlLiteral(idHash, 'idHash')} AND "revokedAt" IS NULL`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { rowCount } = await boundedSessionQuery(pool, statement, SESSION_WRITE_BOUNDS);
      return rowCount === 1 ? 'revoked' : 'already_inactive';
    } catch (err) {
      lastError = err;
      if (err instanceof SessionVerificationUnavailableError && err.reason === 'constraint') break;
    }
  }
  throw toSessionUnavailable(lastError);
}

/** Revokes every live session of one user inside the caller's transaction. Returns the count. */
export async function revokeAllSessionsForUser(client: PoolClient, userId: string, reason: SessionRevokeReason): Promise<number> {
  if (!validUserId(userId)) throw new TypeError('Invalid userId.');
  if (!(SESSION_REVOKE_REASONS as readonly string[]).includes(reason)) throw new TypeError('Invalid revoke reason.');
  try {
    const r = await client.query(
      `UPDATE "AuthSession" SET "revokedAt" = now(), "revokeReason" = $2 WHERE "userId" = $1 AND "revokedAt" IS NULL`,
      [userId, reason]
    );
    return r.rowCount ?? 0;
  } catch (err) {
    throw toSessionUnavailable(err);
  }
}

/**
 * B3 (design §3): re-checks the session inside the caller's transaction and
 * holds FOR SHARE on its row until that transaction ends, so a concurrent
 * revocation is strictly ordered before or after the caller's operation.
 */
export async function recheckAuthSessionForShare(client: PoolClient, idHash: string, userId: string): Promise<boolean> {
  if (!validIdHash(idHash) || !validUserId(userId)) return false;
  try {
    const r = await client.query(
      `SELECT 1 FROM "AuthSession" WHERE "idHash" = $1 AND "userId" = $2 AND "revokedAt" IS NULL AND "expiresAt" > now() FOR SHARE`,
      [idHash, userId]
    );
    return r.rows.length === 1;
  } catch (err) {
    throw toSessionUnavailable(err);
  }
}

/**
 * Deletes, in one bounded batch, rows expired or revoked for longer than the
 * grace period. Never touches a live row. Removing rows can never re-enable a
 * session (allowlist). Returns the count deleted.
 */
export async function cleanupAuthSessions(pool: Pool, opts: { limit?: number; graceDays?: number } = {}): Promise<number> {
  const limit = sqlInteger(opts.limit ?? 5000, 1, 50_000);
  const grace = `make_interval(days => ${sqlInteger(opts.graceDays ?? 7, 1, 365)})`;
  const { rowCount } = await boundedSessionQuery(
    pool,
    `DELETE FROM "AuthSession" WHERE ctid IN (` +
      `SELECT ctid FROM "AuthSession" WHERE "expiresAt" < now() - ${grace} OR "revokedAt" < now() - ${grace} LIMIT ${limit})`,
    SESSION_CLEANUP_BOUNDS
  );
  return rowCount;
}
