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
 * The message is fixed. The error never carries a user id, email, session id,
 * token, SQL text or database message -- only a fixed `reason` for diagnostics.
 *
 * Dormant: nothing in the application imports this module yet
 * (test/authSessionDormancy.test.ts).
 */

export type SessionUnavailableReason =
  | 'acquire' // no connection within the pool's acquisition bound
  | 'statement_timeout' // PostgreSQL cancelled the statement (SQLSTATE 57014)
  | 'lock_timeout' // PostgreSQL gave up waiting for a lock (SQLSTATE 55P03)
  | 'deadline' // the client-side absolute deadline passed; the connection was discarded
  | 'constraint' // an integrity constraint rejected the write (SQLSTATE class 23)
  | 'driver' // any other driver, socket or server error
  | 'shape'; // the database answered, but not in the expected shape

export const SESSION_UNAVAILABLE_MESSAGE = 'Session verification is temporarily unavailable.';

export class SessionVerificationUnavailableError extends Error {
  readonly reason: SessionUnavailableReason;

  constructor(reason: SessionUnavailableReason) {
    super(SESSION_UNAVAILABLE_MESSAGE);
    this.name = 'SessionVerificationUnavailableError';
    this.reason = reason;
  }
}
