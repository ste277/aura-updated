import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '../../../../lib/auth';
import { getSessionFromRequest } from '../../../../lib/session';
import { expectedAccountOf, accountMismatchResponse } from '../../../../lib/expectedAccount';

// Removes the session cookie, with the attributes it was issued with
// (api/auth/verify-code), so every client, including the Android WebView,
// replaces the stored cookie. Never cached.
//
// AURA-ANDROID-REL-04 IR-03 (R2) -- account-bound logout. The client states
// the account it is signing out (X-Aura-Expected-Account). If the request
// carries a session for a DIFFERENT account (another sign-in happened first),
// the cookie is NOT touched and 409 account_mismatch is returned, so an old
// logout can never clear a newer sign-in it can see. A logout without the
// header (a client loaded before this change) keeps the previous behaviour.
// Same-browser ordering of a logout RESPONSE versus a later sign-in RESPONSE
// is handled on the client by the cross-tab auth lock (lib/accountSession.ts).
//
// The session token itself is a signed, stateless value (lib/auth.ts): this
// route cannot revoke a copy held elsewhere. Server-side revocation is
// AURA-AUTH-01.
export async function POST(req: NextRequest) {
  const expected = expectedAccountOf(req);
  if (expected) {
    const session = getSessionFromRequest(req);
    if (session && session.userId !== expected) return accountMismatchResponse();
  }
  const response = NextResponse.json({ loggedOut: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
