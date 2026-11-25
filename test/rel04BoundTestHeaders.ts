/**
 * AURA-ANDROID-REL-04 (R2) -- headers for tests that call bound write routes
 * directly (POST /api/plans, POST /api/habit-logs). Every current client
 * states the account it is writing for (X-Aura-Expected-Account); a request
 * without it is an out-of-date client and gets 503 client_upgrade_required.
 * This states the account of the request's own session token, i.e. exactly
 * what the app sends. With no (or an invalid) token it states a placeholder,
 * so the route still reaches its own authentication answer (401).
 */
import { verifySessionToken } from '../apps/web/lib/auth';

export function boundHeaders(token?: string | null): Headers {
  const userId = token ? verifySessionToken(token)?.userId : undefined;
  return new Headers({ 'x-aura-expected-account': userId ?? 'unauthenticated-test-client' });
}

/**
 * For tests that call the real CLIENT save helpers (saveUpcomingPlanFromCandidate)
 * while switching the session token: make the client's verified account match
 * the token, as Home's session check does in the app.
 */
export function bindTestAccount(token?: string | null): void {
  const userId = token ? verifySessionToken(token)?.userId : undefined;
  require('../apps/web/lib/accountSession').setVerifiedAccount(userId ?? null, { broadcast: false });
}
