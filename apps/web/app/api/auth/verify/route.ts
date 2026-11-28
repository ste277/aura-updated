import { NextRequest, NextResponse } from 'next/server';
import { verifyMagicLinkToken } from '../../../../lib/auth';
import { getOrCreateUserForAuth } from '../../../../lib/db';
import { magicLinksEnabled, MAGIC_LINK_DISABLED_MESSAGE } from '../../../../lib/magicLinkGate';
import { createSignInSession, setSessionCookie } from '../../../../lib/session';

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
  // AURA-AUTH-SESSION-01-I2: the same committed-session issuance as
  // verify-code (no code to consume here: local development only).
  const signIn = await createSignInSession(user.id, async () => true);
  if (signIn.kind !== 'issued') {
    return NextResponse.json(
      { error: 'Sign-in is temporarily unavailable. Please try again in a moment.' },
      { status: 503, headers: { 'Retry-After': '2' } }
    );
  }

  // Recipient Conversion V1 (brief section 10/24) -- a guest search state
  // token riding along on this link (see api/auth/request-link/route.ts)
  // redirects to the restore step instead of generic Home. Not re-verified
  // here -- /find itself verifies it before restoring anything; this route
  // only decides WHERE to redirect.
  const guestStateToken = req.nextUrl.searchParams.get('guest');
  const redirectUrl = guestStateToken ? new URL(`/find?restore=${encodeURIComponent(guestStateToken)}`, req.url) : new URL('/', req.url);

  const response = NextResponse.redirect(redirectUrl);
  setSessionCookie(response, signIn.session);
  return response;
}
