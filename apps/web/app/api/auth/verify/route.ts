import { NextRequest, NextResponse } from 'next/server';
import { verifyMagicLinkToken, createSessionToken, SESSION_COOKIE_NAME } from '../../../../lib/auth';
import { getOrCreateUserForAuth } from '../../../../lib/db';

export async function GET(req: NextRequest) {
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

  const response = NextResponse.redirect(new URL('/', req.url));
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
