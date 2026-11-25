import { NextRequest, NextResponse } from 'next/server';
import { readEdgeSession } from './lib/edgeSession';
import { classifyApiRoute, SIGNED_OUT_ACCOUNT } from './lib/accountRoutePolicy';

/**
 * AURA-ANDROID-REL-04 IR-01 (R3) -- the server side of the shared account
 * boundary for every /api route (policy: lib/accountRoutePolicy.ts).
 *
 * For an ACCOUNT-SCOPED route, a request that carries a session cookie must
 * state the account it acts for:
 *   - missing statement           -> 503 client_upgrade_required (a client
 *                                     loaded before the boundary; no-store)
 *   - "signed out" or another id   -> 409 account_mismatch
 *   - cookie present but the edge cannot verify it (secret unavailable)
 *                                  -> 503 account_check_unavailable (fail
 *                                     closed, never a silent pass-through)
 * A request with no cookie, or an invalid/expired one, passes to the route,
 * which answers with its own authentication (401). OPTIONAL routes enforce a
 * stated account only. EXEMPT routes pass unchanged.
 *
 * It never authorizes anything: the route's own session check stays the only
 * authorization.
 */
const NO_STORE = { 'Cache-Control': 'no-store' };
const deny = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status, headers: NO_STORE });

export async function middleware(req: NextRequest) {
  const cls = classifyApiRoute(req.nextUrl.pathname, req.method);
  if (cls === 'exempt') return NextResponse.next();
  const expected = req.headers.get('x-aura-expected-account')?.trim() ?? '';
  const cookie = req.cookies.get('as_session')?.value;
  if (!expected) {
    if (cls === 'optional' || !cookie) return NextResponse.next();
    return deny(503, 'client_upgrade_required', 'This version of Aura is out of date. Reload to continue.');
  }
  const session = await readEdgeSession(cookie);
  if (session.status === 'unverifiable') return deny(503, 'account_check_unavailable', 'Aura could not check your account. Try again shortly.');
  if (session.status === 'valid' && (expected === SIGNED_OUT_ACCOUNT || session.userId !== expected)) {
    return deny(409, 'account_mismatch', 'You are signed in to a different account. Reload to continue.');
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
