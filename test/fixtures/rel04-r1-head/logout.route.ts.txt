import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '../../../../lib/auth';

// Removes the session cookie. The removal uses the same attributes the cookie
// was issued with (api/auth/verify-code), so every client, including the
// Android WebView, replaces the stored cookie rather than keeping it beside an
// empty one. The response is never cached.
//
// The session token itself is a signed, stateless value (lib/auth.ts): this
// route cannot revoke a copy of it held elsewhere. Server-side revocation is
// an open owner decision (AURA-ANDROID-REL-04 report, RV-1).
export async function POST() {
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
