import { NextRequest, NextResponse } from 'next/server';
import { verifyMagicLinkToken, createSessionToken, SESSION_COOKIE_NAME } from '../../../../lib/auth';
import { getOrCreateUserForAuth } from '../../../../lib/db';
import { magicLinksEnabled, MAGIC_LINK_DISABLED_MESSAGE } from '../../../../lib/magicLinkGate';

export async function GET(req: NextRequest) {
  // AURA-AUTH-02 -- outside authorized local development no magic link is
  // accepted, including links issued before this change. Checked FIRST: the
  // token is never read, verified or logged, and no user or session is created.
  if (!magicLinksEnabled()) {
    return NextResponse.json({ error: MAGIC_LINK_DISABLED_MESSAGE }, { status: 403 });
  }

  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
  }

  const payload = verifyMagicLinkToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired link. Request a new one.' }, { status: 401 });
  }

  const user = await getOrCreateUserForAuth(payload.email);
  const sessionToken = createSessionToken(user.id, user.email);

  // Recipient Conversion V1 (brief section 10/24) -- a guest search state
  // token riding along on this link (see api/auth/request-link/route.ts)
  // redirects to the restore step instead of generic Home. Not re-verified
  // here -- /find itself verifies it before restoring anything; this route
  // only decides WHERE to redirect.
  const guestStateToken = req.nextUrl.searchParams.get('guest');
  const redirectUrl = guestStateToken ? new URL(`/find?restore=${encodeURIComponent(guestStateToken)}`, req.url) : new URL('/', req.url);

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
