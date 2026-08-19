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
import { readJsonObject } from '../../../../lib/request';

// One message for every "your input didn't verify" outcome, so an
// unauthenticated caller can't distinguish "no code pending for this email"
// from "wrong code" (an email-enumeration oracle).
const REJECTED = { error: 'That code is not valid. Check the email or request a new one.' };

// Code-entry counterpart of GET /api/auth/verify. Same outcome (session
// cookie), but works inside native webview shells where the emailed link
// would open in the system browser instead.
export async function POST(req: NextRequest) {
  const parsed = await readJsonObject(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }
  const body = parsed.body;
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const { email: rawEmail, code: rawCode } = body;
  if (!rawEmail || typeof rawEmail !== 'string' || !rawCode || typeof rawCode !== 'string') {
    return NextResponse.json({ error: 'Email and code are required.' }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.trim();

  // Everything below touches the database. An outage must read as "service
  // unavailable", never as "your code is wrong" — otherwise users retype a
  // correct code, burn attempts, and conclude the feature is broken.
  try {
    const row = await findActiveAuthCode(email);
    if (!row) {
      console.warn('[auth] verify-code: no active code', { email });
      return NextResponse.json(REJECTED, { status: 401 });
    }

    // Every verification request — right or wrong, sequential or parallel —
    // costs exactly one attempt; null means the cap is spent.
    const attempt = await spendAuthCodeAttempt(row.id, AUTH_CODE_MAX_ATTEMPTS);
    if (!attempt) {
      console.warn('[auth] verify-code: attempt cap reached', { email });
      return NextResponse.json(
        { error: 'Too many incorrect attempts. Request a new code.' },
        { status: 429 }
      );
    }

    if (!authCodeHashesEqual(hashAuthCode(email, code), attempt.codeHash)) {
      console.warn('[auth] verify-code: incorrect code', { email });
      return NextResponse.json(REJECTED, { status: 401 });
    }

    // Create/find the user BEFORE consuming the code: if user creation fails,
    // the code stays valid and the user can simply retry, instead of being
    // told to request a new one they may be rate-limited from getting.
    const user = await getOrCreateUserForAuth(email);

    // Single-use: only the request that flips consumedAt gets a session. A
    // concurrent duplicate submission loses the race and is rejected here.
    const consumed = await consumeAuthCode(row.id);
    if (!consumed) {
      console.warn('[auth] verify-code: code already consumed', { email });
      return NextResponse.json(REJECTED, { status: 401 });
    }

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
  } catch (err) {
    console.error('[auth] verify-code failed', { email, err });
    return NextResponse.json(
      { error: 'Sign-in is temporarily unavailable. Please try again in a moment.' },
      { status: 503 }
    );
  }
}
