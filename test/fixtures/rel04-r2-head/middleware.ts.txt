import { NextRequest, NextResponse } from 'next/server';
import { sessionUserIdFromToken } from './lib/edgeSession';

/**
 * AURA-ANDROID-REL-04 IR-01 (R2) -- header-bound API requests.
 *
 * The client states the account it believes is signed in on every
 * account-scoped API request (lib/accountBoundFetch.ts). If the request's
 * session belongs to a DIFFERENT account -- e.g. the cookie changed in
 * another tab before this tab noticed -- the request is refused here with
 * 409 account_mismatch, before any route runs. Reads therefore never return
 * one account's data into another account's screen, and writes never land
 * in the wrong account.
 *
 * It never authorizes anything: no header, or no valid session, passes
 * through unchanged and each route applies its own authentication (and the
 * bound write routes their own required-header rule).
 */
export async function middleware(req: NextRequest) {
  const expected = req.headers.get('x-aura-expected-account')?.trim();
  if (!expected) return NextResponse.next();
  const sessionUser = await sessionUserIdFromToken(req.cookies.get('as_session')?.value);
  if (sessionUser && sessionUser !== expected) {
    return NextResponse.json(
      { error: 'You are signed in to a different account. Reload to continue.', code: 'account_mismatch' },
      { status: 409, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
