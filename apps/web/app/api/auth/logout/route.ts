import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookies, revokeRequestSession } from '../../../../lib/session';

/**
 * AURA-AUTH-SESSION-01-I2 -- D8 durable logout. The session row is revoked
 * (idempotent UPDATE, one bounded retry of an uncertain outcome within the
 * same 2 s deadline) BEFORE success is reported. Only then are the cookies
 * cleared and 200 returned. If the revocation cannot be confirmed the answer
 * is 503, the cookie is KEPT and no Set-Cookie is sent: there is no
 * local-only logout fallback (the client retries once, then shows
 * "Couldn't sign out. Try again.").
 */
export async function POST(req: NextRequest) {
  const result = await revokeRequestSession(req);
  if (result.kind === 'unavailable') {
    return NextResponse.json(
      { error: "Couldn't sign out. Try again." },
      { status: 503, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store' } }
    );
  }
  const response = NextResponse.json({ loggedOut: true });
  response.headers.set('Cache-Control', 'no-store');
  clearSessionCookies(response);
  return response;
}
