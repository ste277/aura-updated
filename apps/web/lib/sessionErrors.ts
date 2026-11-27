/**
 * AURA-AUTH-SESSION-01-I1 -- the fail-closed error for session storage.
 *
 * Contract (carried over from REL-02-A2): when the server cannot establish
 * whether a session is valid -- the database is slow, unreachable, out of
 * connections, or answers in an unexpected shape -- the request must fail as
 * "temporarily unavailable" (HTTP 503 once wired in I2). It must never be
 * treated as authenticated, and never as "signed out" (which would make
 * clients discard local state during a transient outage).
 *
 * R1 (39232-01): every failure also states its OUTCOME, so callers can tell a
 * confirmed failure (the operation did not take effect) from an uncertain one
 * (it may or may not have taken effect). Only an uncertain outcome of an
 * idempotent operation may ever be retried.
 *
 * The message is fixed. The error never carries a user id, email, session id,
 * token, SQL text or database message -- only a fixed `reason` and `outcome`.
 *
 * Dormant: nothing in the application imports this module yet
 * (test/authSessionDormancy.test.ts).
 */

export type SessionUnavailableReason =
  | 'acquire' // no connection within the acquisition bound -- nothing was sent
  | 'statement_timeout' // PostgreSQL cancelled the statement (SQLSTATE 57014)
  | 'lock_timeout' // PostgreSQL gave up waiting for a lock (SQLSTATE 55P03)
  | 'deadline' // the caller's absolute deadline passed
  | 'constraint' // an integrity constraint rejected the write (SQLSTATE class 23)
  | 'driver' // any other driver, socket or server error
  | 'shape'; // the database answered, but not in the expected shape

/**
 * 'failed'    -- confirmed: the operation did NOT take effect (it was never
 *                sent, or PostgreSQL rejected it before COMMIT).
 * 'uncertain' -- the operation was sent and its result is unknown: it may
 *                have committed.
 */
export type SessionOperationOutcome = 'failed' | 'uncertain';

export const SESSION_UNAVAILABLE_MESSAGE = 'Session verification is temporarily unavailable.';

const DEFAULT_OUTCOME: Record<SessionUnavailableReason, SessionOperationOutcome> = {
  acquire: 'failed',
  statement_timeout: 'failed',
  lock_timeout: 'failed',
  constraint: 'failed',
  deadline: 'uncertain',
  driver: 'uncertain',
  shape: 'uncertain',
};

export class SessionVerificationUnavailableError extends Error {
  readonly reason: SessionUnavailableReason;
  readonly outcome: SessionOperationOutcome;

  constructor(reason: SessionUnavailableReason, outcome: SessionOperationOutcome = DEFAULT_OUTCOME[reason]) {
    super(SESSION_UNAVAILABLE_MESSAGE);
    this.name = 'SessionVerificationUnavailableError';
    this.reason = reason;
    this.outcome = outcome;
  }
}
