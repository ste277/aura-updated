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
 * createSessionPool) and run under its L1-L3 bounds within ONE absolute
 * caller deadline per operation (R1, 39232-01). Operations that must sit
 * inside a caller's transaction (provisional create, revoke-all during account
 * deletion, the B3 FOR SHARE re-check) take that caller's client: the CALLER
 * owns the transaction -- BEGIN, every statement in it, when to commit, any
 * ROLLBACK, and its SET LOCAL statement_timeout / lock_timeout. These helpers
 * never begin, roll back or change those settings; the one exception is
 * commitAuthSessionTransaction(), which sends COMMIT only when the caller
 * invokes it AS its commit (below).
 *
 * Commit authorization (R1 39232-02, corrected in R2 39235). Five separate facts:
 *   1. createAuthSessionInTransaction() -> ProvisionalAuthSession: the INSERT
 *      succeeded inside the caller's still-open transaction. NO raw session id;
 *      nothing cookie-issuable.
 *   2. commitAuthSessionTransaction(client, provisional) commits the caller's
 *      transaction and classifies the CALLER'S COMMIT:
 *        'committed'   -- PostgreSQL acknowledged COMMIT. Only this outcome
 *                         carries a CommitAuthorization.
 *        'rolled_back' -- confirmed: this session did not commit (the
 *                         transaction is aborted, PostgreSQL rejected the
 *                         COMMIT, or -- R3 -- the transaction being committed
 *                         is not the one whose INSERT created the session).
 *        'ambiguous'   -- the outcome is unknown (connection lost, deadline).
 *      For every outcome except 'committed' the raw id is destroyed at once:
 *      no later call can ever release it. R3 (39237): the INSERT records its
 *      transaction id (txid_current()); the binding check and the COMMIT go in
 *      ONE message, so 'committed' can only mean the ORIGINATING transaction's
 *      own acknowledged COMMIT -- never a substituted, replaced, re-opened or
 *      reused transaction, and never a caller COMMIT / BEGIN queued in between.
 *   3. releaseCommittedAuthSession(pool, authorization) consumes the
 *      authorization synchronously before anything else (R3: single use, also
 *      under overlapping calls; never restored), then reads the row back on an
 *      independent connection. Session material (CommittedAuthSession, with the
 *      raw id) is released ONLY for a confirmed commit AND a live matching row
 *      (same idHash and userId, not revoked, not expired). Missing / expired /
 *      revoked / mismatched -> null. Unavailable -> throws.
 *   4. classifyAmbiguousCommit(pool, provisional) may tell, after an ambiguous
 *      commit, whether the row exists ('committed_undisclosed') or not
 *      ('not_committed'). It NEVER releases session material: an undisclosed
 *      committed row is acceptable (its raw id never left the server, so it can
 *      never authenticate; it expires and is cleaned up).
 *   5. A cookie may be issued ONLY from a CommittedAuthSession -- i.e. never
 *      after a rolled-back or ambiguous commit, however the read-back turns out.
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
  SESSION_TTL_SQL,
  SESSION_WRITE_BOUNDS,
  SYSTEM_SESSION_CLOCK,
  type SessionClock,
  type SessionRevokeReason,
} from './authSessionDb';
import { generateSessionId, hashSessionId, SESSION_ID_HASH_PATTERN, USER_ID_PATTERN } from './authSessionToken';
import { SessionVerificationUnavailableError, type SessionOperationOutcome, type SessionUnavailableReason } from './sessionErrors';

// --- Result contracts ------------------------------------------------------------

/** Not exported: no code outside this module can construct a CommittedAuthSession. */
declare const COMMITTED: unique symbol;

/** A session whose row is durably committed. The only source of a raw id for a token. */
export interface CommittedAuthSession {
  readonly state: 'committed';
  /** The raw session id: goes into the signed token only, never stored. */
  readonly sid: string;
  readonly idHash: string;
  readonly userId: string;
  /** Set by the database: now() + 720 hours. */
  readonly expiresAt: Date;
  readonly [COMMITTED]: true;
}

/**
 * A session row INSERTed inside a caller's open transaction -- not yet
 * committed. It deliberately has no `sid`: the raw id is held privately and is
 * released only through an acknowledged commit (commitAuthSessionTransaction ->
 * CommitAuthorization -> releaseCommittedAuthSession); any other commit outcome
 * destroys it.
 */
export interface ProvisionalAuthSession {
  readonly state: 'provisional';
  readonly idHash: string;
  readonly userId: string;
  /** Set by the database in the caller's transaction; meaningful only if it commits. */
  readonly expiresAt: Date;
}

/** Raw ids of OPEN provisional sessions; moved to an authorization on an acknowledged commit, otherwise deleted. */
const provisionalSids = new WeakMap<ProvisionalAuthSession, string>();

function committed(sid: string, idHash: string, userId: string, expiresAt: Date): CommittedAuthSession {
  return Object.freeze({ state: 'committed', sid, idHash, userId, expiresAt }) as unknown as CommittedAuthSession;
}

export interface LiveAuthSession {
  userId: string;
  expiresAt: Date;
}

export interface LiveAuthSessionWithUser extends LiveAuthSession {
  user: Record<string, unknown>;
}

export type RevokeOutcome = 'revoked' | 'already_inactive';

/** One revoke attempt, for observability and tests. Never carries an id or token. */
export interface SessionAttemptEvent {
  attempt: number;
  result: 'success' | SessionOperationOutcome;
  reason?: SessionUnavailableReason;
  remainingMs: number;
}

export interface SessionOperationOptions {
  /** Injected only by controlled-clock tests. */
  clock?: SessionClock;
  /** Called once per attempt (tests / diagnostics). */
  observe?: (event: SessionAttemptEvent) => void;
}

/** A revoke retry is attempted only if at least this much of the caller deadline remains. */
export const SESSION_MIN_RETRY_BUDGET_MS = 300;
/** At most one retry: the first attempt plus one. */
export const SESSION_MAX_REVOKE_ATTEMPTS = 2;

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
    `VALUES (${sqlLiteral(idHash, 'idHash')}, ${sqlLiteral(userId, 'userId')}, now() + ${SESSION_TTL_SQL}) ` +
    `RETURNING "expiresAt", txid_current()::text AS "authSessionTxid"`
  );
}

// --- Create --------------------------------------------------------------------------

/**
 * Creates and COMMITS a session row (its own bounded transaction). If this
 * throws -- confirmed or uncertain -- no cookie may be issued; a row that may
 * nevertheless have committed is unusable, because its raw id was never
 * disclosed. Never retried.
 */
export async function createAuthSession(pool: Pool, userId: string, opts: SessionOperationOptions = {}): Promise<CommittedAuthSession> {
  if (!validUserId(userId)) throw new TypeError('Invalid userId.');
  const sid = generateSessionId();
  const idHash = hashSessionId(sid);
  const { rows } = await boundedSessionQuery(pool, insertStatement(idHash, userId), SESSION_WRITE_BOUNDS, { clock: opts.clock });
  if (rows.length !== 1) throw new SessionVerificationUnavailableError('shape');
  return committed(sid, idHash, userId, asDate(rows[0].expiresAt));
}

/**
 * INSERTs a session row inside the CALLER's open transaction, e.g. together
 * with consuming the sign-in code (I2, design §2.4). Returns a PROVISIONAL
 * result: not a committed session, and no raw id.
 *
 * Caller responsibilities (I2):
 *   - own BEGIN and any ROLLBACK -- this helper sends neither, nor any SET;
 *   - set the transaction's own SET LOCAL statement_timeout / lock_timeout;
 *   - commit THROUGH commitAuthSessionTransaction() (never a bare COMMIT), and
 *     release session material only via releaseCommittedAuthSession() with the
 *     CommitAuthorization that a 'committed' outcome carries -- never after a
 *     'rolled_back' or 'ambiguous' outcome;
 *   - after 'ambiguous', discard the connection (its state is unknown);
 *   - keep the existing B3 rule: session-sensitive operations re-check with
 *     recheckAuthSessionForShare() inside their own transaction.
 * Failures propagate as SessionVerificationUnavailableError; the caller's
 * transaction is then aborted and must be rolled back by the caller.
 */
export async function createAuthSessionInTransaction(client: PoolClient, userId: string): Promise<ProvisionalAuthSession> {
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
  const txid = rows[0].authSessionTxid;
  if (typeof txid !== 'string' || !TXID_PATTERN.test(txid)) throw new SessionVerificationUnavailableError('shape');
  const provisional = Object.freeze({ state: 'provisional' as const, idHash, userId, expiresAt: asDate(rows[0].expiresAt) });
  provisionalSids.set(provisional, sid);
  provisionalTxids.set(provisional, txid);
  provisionalStates.set(provisional, 'open');
  return provisional;
}

// --- Commit authorization (R2, 39235) ----------------------------------------------

/** Not exported: no code outside this module can construct a CommitAuthorization. */
declare const AUTHORIZED: unique symbol;

/** Proof that PostgreSQL ACKNOWLEDGED the caller's COMMIT for one provisional session. */
export interface CommitAuthorization {
  readonly kind: 'commit_authorization';
  readonly idHash: string;
  readonly userId: string;
  readonly [AUTHORIZED]: true;
}

/** The caller's COMMIT, classified. Only 'committed' carries an authorization. */
export type CallerCommitDecision =
  | { readonly outcome: 'committed'; readonly authorization: CommitAuthorization }
  | { readonly outcome: 'rolled_back'; readonly reason: 'aborted_transaction' | 'rejected_at_commit' | 'transaction_mismatch' }
  | { readonly outcome: 'ambiguous'; readonly reason: 'connection' | 'deadline' | 'unexpected_reply' };

/** What a read-back after an AMBIGUOUS commit may say. Never session material. */
export type AmbiguousCommitClassification = 'committed_undisclosed' | 'not_committed';

type ProvisionalState = 'open' | 'committing' | 'committed' | 'rolled_back' | 'ambiguous';
const provisionalStates = new WeakMap<ProvisionalAuthSession, ProvisionalState>();
/** R3: the 64-bit, epoch-qualified id of the transaction whose INSERT created each provisional session. */
const provisionalTxids = new WeakMap<ProvisionalAuthSession, string>();
const TXID_PATTERN = /^[1-9][0-9]{0,19}$/;
/** R3: SQLSTATE raised when the transaction being committed is not the provisional session's own. */
export const TRANSACTION_MISMATCH_SQLSTATE = 'P0A01';
const authorizedSids = new WeakMap<CommitAuthorization, string>();

/** SQLSTATE classes with which PostgreSQL rejects a COMMIT that therefore did not commit. */
const ROLLED_BACK_AT_COMMIT = ['23', '25', '40'];

/**
 * Commits the caller's transaction (the caller invokes this AS its COMMIT) and
 * classifies the outcome. R3 (39237): the authorization is BOUND to the exact
 * transaction that created the provisional session. One simple-query message
 * carries both the binding check and the COMMIT:
 *
 *   DO $$ ... IF txid_current_if_assigned() IS DISTINCT FROM <txid of the INSERT>
 *             OR the row is not visible THEN RAISE (SQLSTATE P0A01) ... $$; COMMIT
 *
 * PostgreSQL executes the statements of one message in order with nothing
 * from the same connection interleaved, and skips COMMIT if the check raises.
 * So an acknowledged COMMIT here is necessarily the COMMIT of the originating
 * transaction: a substituted, replaced, rolled-back-then-reopened or reused
 * transaction (or a queued caller COMMIT / BEGIN) cannot be authorized.
 *
 * Never throws for a commit failure: it returns 'rolled_back' or 'ambiguous'.
 * For anything but an acknowledged COMMIT the provisional raw id is destroyed,
 * so it can never be released afterwards. After 'transaction_mismatch' or
 * 'aborted_transaction' the caller still owns (and must ROLLBACK) its
 * transaction; after 'ambiguous' it must discard the client. Bounded by the
 * foreground write deadline (2 000 ms) on top of the caller's own timeouts.
 */
export async function commitAuthSessionTransaction(
  client: PoolClient,
  provisional: ProvisionalAuthSession,
  opts: SessionOperationOptions = {}
): Promise<CallerCommitDecision> {
  const sid = provisionalSids.get(provisional);
  const txid = provisionalTxids.get(provisional);
  if (!sid || !txid || provisionalStates.get(provisional) !== 'open') {
    throw new TypeError('Not an open provisional session from createAuthSessionInTransaction().');
  }
  provisionalStates.set(provisional, 'committing'); // synchronous: a second call cannot pass the check above
  const clock = opts.clock ?? SYSTEM_SESSION_CLOCK;
  let handle: unknown;
  const deadline = new Promise<'deadline'>((resolve) => {
    handle = clock.setTimer(() => resolve('deadline'), SESSION_WRITE_BOUNDS.deadlineMs);
  });
  const finish = (decision: CallerCommitDecision): CallerCommitDecision => {
    clock.clearTimer(handle);
    provisionalTxids.delete(provisional);
    if (decision.outcome !== 'committed') {
      provisionalSids.delete(provisional); // the raw id is gone for good
      provisionalStates.set(provisional, decision.outcome);
    }
    return Object.freeze(decision);
  };
  if (!TXID_PATTERN.test(txid)) return finish({ outcome: 'rolled_back', reason: 'transaction_mismatch' });
  const text =
    `DO $auth_session_commit$ BEGIN ` +
    `IF txid_current_if_assigned() IS DISTINCT FROM ${txid}::bigint ` +
    `OR NOT EXISTS (SELECT 1 FROM "AuthSession" WHERE "idHash" = ${sqlLiteral(provisional.idHash, 'idHash')} AND "userId" = ${sqlLiteral(provisional.userId, 'userId')}) ` +
    `THEN RAISE EXCEPTION 'auth_session_transaction_mismatch' USING ERRCODE = '${TRANSACTION_MISMATCH_SQLSTATE}'; END IF; ` +
    `END $auth_session_commit$; COMMIT`;
  let reply: unknown;
  try {
    const running = client.query(text) as unknown as Promise<unknown>;
    running.catch(() => {});
    reply = await Promise.race([running, deadline]);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === TRANSACTION_MISMATCH_SQLSTATE) return finish({ outcome: 'rolled_back', reason: 'transaction_mismatch' });
    if (code === '25P02') return finish({ outcome: 'rolled_back', reason: 'aborted_transaction' });
    if (typeof code === 'string' && ROLLED_BACK_AT_COMMIT.includes(code.slice(0, 2))) {
      return finish({ outcome: 'rolled_back', reason: 'rejected_at_commit' });
    }
    return finish({ outcome: 'ambiguous', reason: 'connection' });
  }
  if (reply === 'deadline') return finish({ outcome: 'ambiguous', reason: 'deadline' });
  const last = Array.isArray(reply) ? (reply[reply.length - 1] as { command?: unknown } | undefined) : undefined;
  if (!Array.isArray(reply) || reply.length !== 2) return finish({ outcome: 'ambiguous', reason: 'unexpected_reply' });
  if (last?.command === 'ROLLBACK') return finish({ outcome: 'rolled_back', reason: 'aborted_transaction' });
  if (last?.command !== 'COMMIT') return finish({ outcome: 'ambiguous', reason: 'unexpected_reply' });
  const authorization = Object.freeze({ kind: 'commit_authorization', idHash: provisional.idHash, userId: provisional.userId }) as unknown as CommitAuthorization;
  authorizedSids.set(authorization, sid);
  provisionalSids.delete(provisional);
  finish({ outcome: 'committed', authorization });
  provisionalStates.set(provisional, 'committed');
  return Object.freeze({ outcome: 'committed', authorization });
}

/**
 * Releases session material for a CONFIRMED commit only: reads the row back on
 * an independent connection and returns a CommittedAuthSession (with the raw
 * id) only if it is live and matches (idHash AND userId; not revoked, not
 * expired). null = no session, permanently. R3: the authorization is consumed
 * BEFORE the read-back (exclusive, synchronous reservation), so at most one
 * invocation can ever return the raw id -- including under overlapping calls.
 * If the read-back fails or is uncertain it throws
 * SessionVerificationUnavailableError and the authorization is NOT restored
 * (fail closed: no session; the user signs in again).
 */
export async function releaseCommittedAuthSession(
  pool: Pool,
  authorization: CommitAuthorization,
  opts: SessionOperationOptions = {}
): Promise<CommittedAuthSession | null> {
  const sid = authorizedSids.get(authorization);
  if (!sid) throw new TypeError('Not an unreleased CommitAuthorization from commitAuthSessionTransaction().');
  // R3 (39237): reserve = consume, SYNCHRONOUSLY, before the first await. JavaScript
  // runs this to completion, so an overlapping call finds no entry and fails above.
  // The authorization is never restored: a failed or uncertain read-back below
  // ends it permanently (fail closed -- the user signs in again).
  authorizedSids.delete(authorization);
  const live = await lookupAuthSession(pool, authorization.idHash, authorization.userId, opts);
  if (!live) return null;
  return committed(sid, authorization.idHash, authorization.userId, live.expiresAt);
}

/**
 * After an AMBIGUOUS commit only: classifies the database outcome. Returns a
 * label, never session material -- the raw id was destroyed when the commit
 * was found ambiguous, so no read-back can turn it into an issuable session.
 * Throws SessionVerificationUnavailableError if the database cannot answer.
 */
export async function classifyAmbiguousCommit(
  pool: Pool,
  provisional: ProvisionalAuthSession,
  opts: SessionOperationOptions = {}
): Promise<AmbiguousCommitClassification> {
  if (provisionalStates.get(provisional) !== 'ambiguous') {
    throw new TypeError('Only a provisional session whose commit was ambiguous can be classified.');
  }
  if (!validIdHash(provisional.idHash) || !validUserId(provisional.userId)) throw new TypeError('Malformed provisional session.');
  const { rows } = await boundedSessionQuery(
    pool,
    `SELECT 1 AS found FROM "AuthSession" WHERE "idHash" = ${sqlLiteral(provisional.idHash, 'idHash')} AND "userId" = ${sqlLiteral(provisional.userId, 'userId')}`,
    SESSION_LOOKUP_BOUNDS,
    { clock: opts.clock }
  );
  return rows.length === 1 ? 'committed_undisclosed' : 'not_committed';
}

// --- Lookup --------------------------------------------------------------------------

function liveWhere(idHash: string, userId: string, alias = ''): string {
  const a = alias ? `${alias}.` : '';
  return (
    `${a}"idHash" = ${sqlLiteral(idHash, 'idHash')} AND ${a}"userId" = ${sqlLiteral(userId, 'userId')} ` +
    `AND ${a}"revokedAt" IS NULL AND ${a}"expiresAt" > now()`
  );
}

/** The live session, or null. Throws SessionVerificationUnavailableError if that cannot be established. Never retried. */
export async function lookupAuthSession(pool: Pool, idHash: string, userId: string, opts: SessionOperationOptions = {}): Promise<LiveAuthSession | null> {
  if (!validIdHash(idHash) || !validUserId(userId)) return null;
  const { rows } = await boundedSessionQuery(
    pool,
    `SELECT "userId", "expiresAt" FROM "AuthSession" WHERE ${liveWhere(idHash, userId)}`,
    SESSION_LOOKUP_BOUNDS,
    { clock: opts.clock }
  );
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0].userId !== userId) throw new SessionVerificationUnavailableError('shape');
  return { userId, expiresAt: asDate(rows[0].expiresAt) };
}

/** Joined variant for routes that also need the user row: one round trip. */
export async function lookupAuthSessionWithUser(
  pool: Pool,
  idHash: string,
  userId: string,
  opts: SessionOperationOptions = {}
): Promise<LiveAuthSessionWithUser | null> {
  if (!validIdHash(idHash) || !validUserId(userId)) return null;
  const { rows } = await boundedSessionQuery(
    pool,
    `SELECT s."expiresAt" AS "authSessionExpiresAt", u.* FROM "AuthSession" s ` +
      `JOIN "User" u ON u.id = s."userId" WHERE ${liveWhere(idHash, userId, 's')}`,
    SESSION_LOOKUP_BOUNDS,
    { clock: opts.clock }
  );
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0].id !== userId) throw new SessionVerificationUnavailableError('shape');
  const { authSessionExpiresAt, ...user } = rows[0];
  return { userId, expiresAt: asDate(authSessionExpiresAt), user };
}

// --- Revoke --------------------------------------------------------------------------

/**
 * Idempotent revocation within ONE absolute 2-second caller deadline (R1,
 * 39232-01). 'already_inactive' (already revoked, or no such row) is a success
 * too.
 *
 *   - confirmed success          -> returned;
 *   - confirmed failure          -> thrown at once ('failed': statement /
 *                                   lock timeout, constraint, acquisition);
 *                                   never retried;
 *   - uncertain outcome          -> retried once, ONLY if at least
 *                                   SESSION_MIN_RETRY_BUDGET_MS of the SAME
 *                                   deadline remains (the UPDATE is
 *                                   idempotent); the retry never restarts or
 *                                   extends the deadline;
 *   - anything else              -> thrown as 'uncertain'. Never reported as success.
 */
export async function revokeAuthSession(
  pool: Pool,
  idHash: string,
  reason: SessionRevokeReason,
  opts: SessionOperationOptions = {}
): Promise<RevokeOutcome> {
  if (!(SESSION_REVOKE_REASONS as readonly string[]).includes(reason)) throw new TypeError('Invalid revoke reason.');
  if (!validIdHash(idHash)) return 'already_inactive';
  const clock = opts.clock ?? SYSTEM_SESSION_CLOCK;
  const deadlineAt = clock.now() + SESSION_WRITE_BOUNDS.deadlineMs;
  const statement =
    `UPDATE "AuthSession" SET "revokedAt" = now(), "revokeReason" = ${sqlLiteral(reason, 'reason')} ` +
    `WHERE "idHash" = ${sqlLiteral(idHash, 'idHash')} AND "revokedAt" IS NULL`;
  for (let attempt = 1; ; attempt++) {
    try {
      const { rowCount } = await boundedSessionQuery(pool, statement, SESSION_WRITE_BOUNDS, { deadlineAt, clock });
      opts.observe?.({ attempt, result: 'success', remainingMs: deadlineAt - clock.now() });
      return rowCount === 1 ? 'revoked' : 'already_inactive';
    } catch (err) {
      const e = toSessionUnavailable(err);
      const remainingMs = deadlineAt - clock.now();
      opts.observe?.({ attempt, result: e.outcome, reason: e.reason, remainingMs });
      const retry = e.outcome === 'uncertain' && attempt < SESSION_MAX_REVOKE_ATTEMPTS && remainingMs >= SESSION_MIN_RETRY_BUDGET_MS;
      if (!retry) throw e;
    }
  }
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

// --- Cleanup (background only) ----------------------------------------------------

/**
 * Deletes, in one bounded batch, rows expired or revoked for longer than the
 * grace period. Never touches a live row. Removing rows can never re-enable a
 * session (allowlist). BACKGROUND ONLY (the daily job in I2) -- never on an
 * interactive authentication path. Returns the count deleted.
 */
export async function cleanupAuthSessions(
  pool: Pool,
  opts: { limit?: number; graceDays?: number; clock?: SessionClock } = {}
): Promise<number> {
  const limit = sqlInteger(opts.limit ?? 5000, 1, 50_000);
  const graceHours = sqlInteger((opts.graceDays ?? 7) * 24, 24, 365 * 24);
  const grace = `make_interval(hours => ${graceHours})`;
  const { rowCount } = await boundedSessionQuery(
    pool,
    `DELETE FROM "AuthSession" WHERE ctid IN (` +
      `SELECT ctid FROM "AuthSession" WHERE "expiresAt" < now() - ${grace} OR "revokedAt" < now() - ${grace} LIMIT ${limit})`,
    SESSION_CLEANUP_BOUNDS,
    { clock: opts.clock }
  );
  return rowCount;
}
