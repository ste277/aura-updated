/**
 * AURA-AUTH-SESSION-01-I2 -- the ONLY reader (and, at sign-in, issuer) of
 * session cookies. AURA_AUTH_SESSION_01_REVOCATION_DESIGN.md §2.3, §2.4, §3, §5, §8.1.
 *
 * A request is authenticated only if BOTH hold:
 *   1. the v2 token in the session cookie verifies (lib/authSessionToken.ts:
 *      HKDF key from AUTH_SECRET, exact typ/v, sid/uid shape, iat/exp,
 *      constant-time signature); and
 *   2. its AuthSession row exists, is not revoked and has not expired by the
 *      DATABASE clock (lib/authSessionStore.ts), looked up on the dedicated,
 *      bounded `aura-session` pool (L1 acquire 500 ms, L2 SET LOCAL
 *      statement/lock timeouts, L3 one 2 s caller deadline).
 *
 * Outcomes are never conflated:
 *   - authenticated          -> RequestSession
 *   - not authenticated      -> null (no / malformed / tampered / expired /
 *                               revoked / unknown session)
 *   - could not find out     -> SESSION_UNAVAILABLE from the request helpers
 *                               (the route answers sessionUnavailableResponse(),
 *                               503 + Retry-After), or a thrown
 *                               SessionVerificationUnavailableError from the
 *                               page / header helpers. NEVER 401, NEVER 200.
 *
 * There is no legacy path: the v1 `as_session` cookie is never read for
 * authentication (it is only cleared), there is no mode switch and no
 * fallback. Only sign-in sets the session cookie (B4); nothing here renews,
 * re-issues or slides it. Expiry is fixed at 30 days (720 h) by the database.
 */
import type { Pool, PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import { getAuthSecret } from './auth';
import { createSessionPool, SESSION_WRITE_BOUNDS } from './authSessionDb';
import {
  createSessionTokenV2,
  deriveSessionKey,
  hashSessionId,
  sessionCookieClearList,
  sessionCookieName,
  sessionCookieOptions,
  verifySessionTokenV2,
  LEGACY_SESSION_COOKIE_NAME,
  type SessionKey,
  type SessionTokenClaims,
} from './authSessionToken';
import {
  commitAuthSessionTransaction,
  createAuthSessionInTransaction,
  lookupAuthSession,
  lookupAuthSessionWithUser,
  recheckAuthSessionForShare,
  releaseCommittedAuthSession,
  revokeAuthSession,
  type CommittedAuthSession,
  type RevokeOutcome,
} from './authSessionStore';
import { SessionVerificationUnavailableError, SESSION_UNAVAILABLE_MESSAGE } from './sessionErrors';
import type { User } from './db';

export { SessionVerificationUnavailableError } from './sessionErrors';

// --- Types ---------------------------------------------------------------------------

/** An authenticated request's session. `idHash` identifies the row; the raw id never leaves the token. */
export interface RequestSession {
  readonly userId: string;
  readonly idHash: string;
  /** Database-set expiry of the row. */
  readonly expiresAt: Date;
}

export interface RequestSessionWithUser extends RequestSession {
  /** The User row read in the SAME round trip as the session (design §8: joined lookup). */
  readonly user: User;
}

/** "Could not find out" -- the database was unreachable, slow, or answered unexpectedly. Maps to 503. */
export const SESSION_UNAVAILABLE: unique symbol = Symbol('aura.session.unavailable');
export type SessionUnavailable = typeof SESSION_UNAVAILABLE;

/** Anything with a Next.js-style `cookies.get(name)` -- a NextRequest, or next/headers `cookies()`. */
export interface CookieSource {
  get(name: string): { value: string } | undefined;
}
export interface RequestWithCookies {
  cookies: CookieSource;
}

// --- Configuration (lazy: nothing connects at import) ---------------------------------

/** Secure (and therefore `__Host-as_sid`) on every deployment; `as_sid` only for local http development. */
export function sessionCookieSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** The ONE cookie name this deployment reads and issues. */
export function activeSessionCookieName(): string {
  return sessionCookieName(sessionCookieSecure());
}

const globalRef = globalThis as typeof globalThis & { __auraSessionPool?: Pool; __auraSessionKey?: SessionKey };
let testPool: Pool | null = null;

/** The dedicated, bounded `aura-session` pool (created on first use). Throws SessionVerificationUnavailableError if unconfigured. */
export function getSessionPool(): Pool {
  if (testPool) return testPool;
  if (globalRef.__auraSessionPool) return globalRef.__auraSessionPool;
  const connectionString = process.env.AURA_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new SessionVerificationUnavailableError('acquire', 'failed');
  globalRef.__auraSessionPool = createSessionPool(connectionString);
  return globalRef.__auraSessionPool;
}

/**
 * Tests only (fault injection through test/authSessionFaultProxy.ts). Refuses
 * in production builds. Passing null restores the default pool.
 */
export function setSessionPoolForTesting(pool: Pool | null): void {
  if (process.env.NODE_ENV === 'production') throw new Error('setSessionPoolForTesting is unavailable in production.');
  testPool = pool;
}

/** Ends the default pool (test teardown). */
export async function closeSessionPool(): Promise<void> {
  const p = globalRef.__auraSessionPool;
  globalRef.__auraSessionPool = undefined;
  if (p) await p.end();
}

function sessionKey(): SessionKey {
  if (!globalRef.__auraSessionKey) globalRef.__auraSessionKey = deriveSessionKey(getAuthSecret());
  return globalRef.__auraSessionKey;
}

// --- Verification ---------------------------------------------------------------------

/** Signature, typ/v, shape and app-clock expiry only -- NOT authentication on its own. */
function verifiedClaims(token: string | undefined | null): SessionTokenClaims | null {
  if (!token) return null;
  return verifySessionTokenV2(sessionKey(), token);
}

/**
 * Authenticates one cookie value. null = not authenticated. Throws
 * SessionVerificationUnavailableError when the database cannot answer.
 */
async function authenticateToken(token: string | undefined | null, withUser: false): Promise<RequestSession | null>;
async function authenticateToken(token: string | undefined | null, withUser: true): Promise<RequestSessionWithUser | null>;
async function authenticateToken(token: string | undefined | null, withUser: boolean): Promise<RequestSession | RequestSessionWithUser | null> {
  const claims = verifiedClaims(token);
  if (!claims) return null;
  const idHash = hashSessionId(claims.sid);
  const pool = getSessionPool();
  if (withUser) {
    const live = await lookupAuthSessionWithUser(pool, idHash, claims.uid);
    if (!live || live.expiresAt.getTime() !== claims.exp) return null;
    return Object.freeze({ userId: live.userId, idHash, expiresAt: live.expiresAt, user: live.user as unknown as User });
  }
  const live = await lookupAuthSession(pool, idHash, claims.uid);
  // The token's exp is copied from the row at issue; a mismatch means it is not this row's token.
  if (!live || live.expiresAt.getTime() !== claims.exp) return null;
  return Object.freeze({ userId: live.userId, idHash, expiresAt: live.expiresAt });
}

function unavailableOr<T>(err: unknown): T | SessionUnavailable {
  if (err instanceof SessionVerificationUnavailableError) return SESSION_UNAVAILABLE;
  throw err;
}

/**
 * E1 (API routes). Every caller MUST handle all three outcomes:
 *
 *   const session = await getSessionFromRequest(req);
 *   if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
 *   if (!session) return ...401;
 *
 * (enforced by test/authSessionCoverage.test.ts and by the type system:
 * the sentinel has no `userId`).
 */
export async function getSessionFromRequest(req: RequestWithCookies): Promise<RequestSession | null | SessionUnavailable> {
  try {
    return await authenticateToken(req.cookies.get(activeSessionCookieName())?.value, false);
  } catch (err) {
    return unavailableOr(err);
  }
}

/** E1, joined variant for routes that need the User row: the session and the user in ONE round trip. */
export async function getSessionWithUserFromRequest(req: RequestWithCookies): Promise<RequestSessionWithUser | null | SessionUnavailable> {
  try {
    return await authenticateToken(req.cookies.get(activeSessionCookieName())?.value, true);
  } catch (err) {
    return unavailableOr(err);
  }
}

/**
 * E2 (server pages, `cookies()` from next/headers). Throws
 * SessionVerificationUnavailableError on an outage: the page fails (error
 * page) rather than rendering as signed out.
 */
export async function getSessionFromCookieStore(store: CookieSource): Promise<RequestSession | null> {
  return authenticateToken(store.get(activeSessionCookieName())?.value, false);
}

/** E2 joined variant. */
export async function getSessionWithUserFromCookieStore(store: CookieSource): Promise<RequestSessionWithUser | null> {
  return authenticateToken(store.get(activeSessionCookieName())?.value, true);
}

/** The active session cookie's value from a raw Cookie header (E4, MCP consent). */
export function readSessionCookieFromHeader(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const name = activeSessionCookieName();
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** E4 (MCP consent, D6). Throws SessionVerificationUnavailableError on an outage. */
export async function getSessionFromCookieHeader(cookieHeader: string | null | undefined): Promise<RequestSession | null> {
  return authenticateToken(readSessionCookieFromHeader(cookieHeader), false);
}

/** 503 for "could not verify the session". Never clears or sets a cookie. */
export function sessionUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: SESSION_UNAVAILABLE_MESSAGE },
    { status: 503, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store' } }
  );
}

// --- Issuance (sign-in only, B4) ------------------------------------------------------

export type SignInSessionResult =
  | { readonly kind: 'issued'; readonly session: CommittedAuthSession }
  /** The caller's in-transaction step declined (e.g. the code was already consumed); rolled back. */
  | { readonly kind: 'rejected' }
  /** Fail closed: no cookie. The transaction rolled back, or its outcome is unknown. */
  | { readonly kind: 'unavailable' };

const PRE_COMMIT_TIMED_OUT = Symbol('pre-commit deadline');

/**
 * A checked-out client whose connection drops emits 'error' on the CLIENT (not
 * the pool); without a listener that would crash the process. Logged by class
 * only (a message can quote values); the next query on it then fails and the
 * caller discards it.
 */
function onCheckedOutClientError(err: unknown): void {
  console.error(`[auth-session] checked-out client error (${err instanceof Error ? err.name : 'Error'})`);
}

/**
 * Design §2.4 sign-in: `inTransaction` (e.g. consuming the sign-in code) and
 * the AuthSession INSERT run in ONE transaction on a session-pool connection,
 * committed through commitAuthSessionTransaction (R2/R3: an acknowledged,
 * transaction-bound COMMIT is the only source of a CommitAuthorization), and
 * the session is released single-use for a cookie. Any other outcome returns
 * 'unavailable' and no session material: a rolled-back transaction also
 * un-consumes the code; an ambiguous commit discards the connection.
 *
 * Bounds: acquisition 500 ms (pool), SET LOCAL statement/lock timeouts of the
 * foreground write budget, and one 2 s client deadline for everything before
 * the COMMIT (the COMMIT has its own 2 s bound in the store).
 */
export async function createSignInSession(
  userId: string,
  inTransaction: (client: PoolClient) => Promise<boolean>
): Promise<SignInSessionResult> {
  let pool: Pool;
  let client: PoolClient;
  try {
    pool = getSessionPool();
    client = await pool.connect();
  } catch {
    return { kind: 'unavailable' };
  }
  client.on('error', onCheckedOutClientError);
  let released = false;
  const release = (discard: boolean) => {
    if (released) return;
    released = true;
    client.off('error', onCheckedOutClientError);
    client.release(discard ? new Error('auth-session sign-in connection discarded') : undefined);
  };
  const startedAt = performance.now();
  const step = async <T>(work: Promise<T>): Promise<T> => {
    const remaining = SESSION_WRITE_BOUNDS.deadlineMs - (performance.now() - startedAt);
    if (!(remaining > 0)) throw PRE_COMMIT_TIMED_OUT;
    work.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof PRE_COMMIT_TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(PRE_COMMIT_TIMED_OUT), remaining);
    });
    try {
      const r = await Promise.race([work, timeout]);
      if (r === PRE_COMMIT_TIMED_OUT) throw PRE_COMMIT_TIMED_OUT;
      return r as T;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await step(
      client.query(
        `BEGIN; SET LOCAL statement_timeout = '${SESSION_WRITE_BOUNDS.statementTimeoutMs}ms'; ` +
          `SET LOCAL lock_timeout = '${SESSION_WRITE_BOUNDS.lockTimeoutMs}ms'; ` +
          `SET LOCAL idle_in_transaction_session_timeout = '5000ms'`
      )
    );
    if (!(await step(inTransaction(client)))) {
      await step(client.query('ROLLBACK'));
      release(false);
      return { kind: 'rejected' };
    }
    const provisional = await step(createAuthSessionInTransaction(client, userId));
    const decision = await commitAuthSessionTransaction(client, provisional);
    if (decision.outcome === 'ambiguous') {
      release(true);
      return { kind: 'unavailable' };
    }
    if (decision.outcome === 'rolled_back') {
      // The caller still owns an aborted / mismatched transaction (R3): roll it back.
      try {
        await step(client.query('ROLLBACK'));
        release(false);
      } catch {
        release(true);
      }
      return { kind: 'unavailable' };
    }
    release(false);
    const session = await releaseCommittedAuthSession(pool, decision.authorization);
    return session ? { kind: 'issued', session } : { kind: 'unavailable' };
  } catch {
    // Unknown connection state (statement error, deadline, driver): discard it;
    // PostgreSQL rolls the open transaction back when the backend ends.
    release(true);
    return { kind: 'unavailable' };
  }
}

/**
 * The v2 token for a COMMITTED session (one only lib/authSessionStore.ts can
 * construct). Its exp is the row's database-set expiresAt.
 */
export function issueSessionToken(session: CommittedAuthSession, now: number = Date.now()): string {
  return createSessionTokenV2(sessionKey(), { sid: session.sid, uid: session.userId, iat: now, exp: session.expiresAt.getTime() });
}

/**
 * Sets the v2 session cookie for a COMMITTED session (sign-in only, B4) and
 * clears every other session cookie name, including legacy `as_session`.
 * Max-Age is a client hint derived from the database-set expiresAt.
 */
export function setSessionCookie(res: NextResponse, session: CommittedAuthSession, now: number = Date.now()): void {
  const secure = sessionCookieSecure();
  const name = sessionCookieName(secure);
  const token = issueSessionToken(session, now);
  res.cookies.set(name, token, sessionCookieOptions(session.expiresAt, secure, now));
  for (const c of sessionCookieClearList(secure)) if (c.name !== name) res.cookies.set(c.name, '', c.options);
}

/** Clears every session cookie name (v2 secure / insecure and legacy `as_session`) with deletable attributes. */
export function clearSessionCookies(res: NextResponse): void {
  for (const c of sessionCookieClearList(sessionCookieSecure())) res.cookies.set(c.name, '', c.options);
}

/** Clears ONLY the legacy v1 cookie (cutover, N6). Never touches a v2 cookie, so a concurrent sign-in elsewhere is unaffected. */
export function clearLegacySessionCookie(res: NextResponse): void {
  const legacy = sessionCookieClearList(sessionCookieSecure()).find((c) => c.name === LEGACY_SESSION_COOKIE_NAME);
  if (legacy) res.cookies.set(legacy.name, '', legacy.options);
}

export function hasLegacySessionCookie(req: RequestWithCookies): boolean {
  return req.cookies.get(LEGACY_SESSION_COOKIE_NAME) !== undefined;
}

// --- Logout (D8) ----------------------------------------------------------------------

export type LogoutResult = { readonly kind: 'revoked' | 'already_inactive' | 'no_session' } | { readonly kind: 'unavailable' };

/**
 * D8: durable revocation BEFORE success. A cookie whose token verifies is
 * revoked by its row (idempotent; a missing or already revoked row is
 * success). Retries only an uncertain outcome, once, within the same 2 s
 * deadline (lib/authSessionStore.ts). 'unavailable' = the caller must answer
 * 503 and KEEP the cookie -- there is no local-only logout.
 */
export async function revokeRequestSession(req: RequestWithCookies): Promise<LogoutResult> {
  let claims: SessionTokenClaims | null;
  try {
    claims = verifiedClaims(req.cookies.get(activeSessionCookieName())?.value);
  } catch {
    return { kind: 'unavailable' };
  }
  // Nothing this deployment could ever authenticate: nothing to revoke.
  if (!claims) return { kind: 'no_session' };
  try {
    const outcome: RevokeOutcome = await revokeAuthSession(getSessionPool(), hashSessionId(claims.sid), 'logout');
    return { kind: outcome };
  } catch (err) {
    if (err instanceof SessionVerificationUnavailableError) return { kind: 'unavailable' };
    throw err;
  }
}

// --- B3: session-sensitive operations -------------------------------------------------

export type SessionLockedResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * B3 (design §3): runs `operation` while this session's row is held FOR SHARE
 * in an open transaction, after re-checking it is live. A logout / revoke-all
 * UPDATE conflicts with FOR SHARE, so the order is strict: either the
 * operation completes before the revocation commits, or the revocation
 * committed first and this returns { ok: false } (the caller answers 401)
 * without running `operation`. Throws SessionVerificationUnavailableError if
 * the re-check cannot be made. Bounded: acquisition 500 ms, lock 1 000 ms,
 * statement 1 500 ms, idle-in-transaction 5 000 ms (server-enforced).
 */
export async function withSessionShareLock<T>(session: RequestSession, operation: () => Promise<T>): Promise<SessionLockedResult<T>> {
  const pool = getSessionPool();
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw new SessionVerificationUnavailableError('acquire', 'failed');
  }
  client.on('error', onCheckedOutClientError);
  let discard = false;
  try {
    try {
      await client.query(
        `BEGIN; SET LOCAL statement_timeout = '${SESSION_WRITE_BOUNDS.statementTimeoutMs}ms'; ` +
          `SET LOCAL lock_timeout = '${SESSION_WRITE_BOUNDS.lockTimeoutMs}ms'; ` +
          `SET LOCAL idle_in_transaction_session_timeout = '5000ms'`
      );
    } catch {
      discard = true;
      throw new SessionVerificationUnavailableError('driver', 'failed');
    }
    let live: boolean;
    try {
      live = await recheckAuthSessionForShare(client, session.idHash, session.userId);
    } catch (err) {
      discard = true;
      throw err;
    }
    if (!live) {
      await client.query('ROLLBACK').catch(() => {
        discard = true;
      });
      return { ok: false };
    }
    let value: T;
    try {
      value = await operation();
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        discard = true;
      });
      throw err;
    }
    // The operation already took effect; COMMIT only releases the lock. A
    // failed COMMIT still ends the lock when the connection is discarded.
    await client.query('COMMIT').catch(() => {
      discard = true;
    });
    return { ok: true, value };
  } finally {
    client.off('error', onCheckedOutClientError);
    client.release(discard ? new Error('auth-session share-lock connection discarded') : undefined);
  }
}
