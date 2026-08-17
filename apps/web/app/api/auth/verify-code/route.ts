import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionToken,
  hashAuthCode,
  authCodeHashesEqual,
  SESSION_COOKIE_NAME,
  AUTH_CODE_MAX_ATTEMPTS,
} from '../../../../lib/auth';
import {
  findActiveAuthCode,
  incrementAuthCodeAttempts,
  consumeAuthCode,
  getOrCreateUserForAuth,
} from '../../../../lib/db';

// Code-entry counterpart of GET /api/auth/verify. Same outcome (session
// cookie), but works inside native webview shells where the emailed link
// would open in the system browser instead.
export async function POST(req: NextRequest) {
  const { email, code } = await req.json();
  if (!email || typeof email !== 'string' || !code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Email and code are required.' }, { status: 400 });
  }

  const row = await findActiveAuthCode(email);
  if (!row) {
    return NextResponse.json(
      { error: 'No active code for this email. Request a new one.' },
      { status: 401 }
    );
  }

  if (row.attempts >= AUTH_CODE_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: 'Too many incorrect attempts. Request a new code.' },
      { status: 429 }
    );
  }

  if (!authCodeHashesEqual(hashAuthCode(email, code.trim()), row.codeHash)) {
    await incrementAuthCodeAttempts(row.id);
    return NextResponse.json({ error: 'Incorrect code. Check the email and try again.' }, { status: 401 });
  }

  await consumeAuthCode(row.id);
  const user = await getOrCreateUserForAuth(email);
  const sessionToken = createSessionToken(user.id, user.email);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
