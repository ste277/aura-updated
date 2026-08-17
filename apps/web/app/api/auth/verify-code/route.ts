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
  spendAuthCodeAttempt,
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

  // Every verification request — right or wrong, sequential or parallel —
  // costs exactly one attempt; null means the cap is spent.
  const attempt = await spendAuthCodeAttempt(row.id, AUTH_CODE_MAX_ATTEMPTS);
  if (!attempt) {
    return NextResponse.json(
      { error: 'Too many incorrect attempts. Request a new code.' },
      { status: 429 }
    );
  }

  if (!authCodeHashesEqual(hashAuthCode(email, code.trim()), attempt.codeHash)) {
    return NextResponse.json({ error: 'Incorrect code. Check the email and try again.' }, { status: 401 });
  }

  // Single-use: only the request that flips consumedAt gets a session. A
  // concurrent duplicate submission loses the race and is rejected here.
  const consumed = await consumeAuthCode(row.id);
  if (!consumed) {
    return NextResponse.json({ error: 'This code was already used. Request a new one.' }, { status: 401 });
  }

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
