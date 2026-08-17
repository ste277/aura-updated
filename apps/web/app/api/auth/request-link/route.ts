import { NextRequest, NextResponse } from 'next/server';
import { createMagicLinkToken, generateAuthCode, hashAuthCode, AUTH_CODE_TTL_MS } from '../../../../lib/auth';
import { createAuthCode, countRecentAuthRequests } from '../../../../lib/db';
import { sendMagicLinkEmail, isEmailConfigured } from '../../../../lib/email';

// Sign-in requests allowed per email/IP per window — enough for a user who
// mistypes twice, low enough to make email-bombing and code-guessing via
// re-requests impractical.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_REQUESTS = 3;

function requestIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }
  const rawEmail = body.email;
  if (!rawEmail || typeof rawEmail !== 'string' || rawEmail.length > 254 || !rawEmail.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();

  const ip = requestIp(req);
  const recent = await countRecentAuthRequests(email, ip, RATE_LIMIT_WINDOW_MINUTES);
  if (recent >= RATE_LIMIT_MAX_REQUESTS) {
    console.warn('[auth] request-link rate-limited', { email, ip, recent });
    return NextResponse.json(
      { error: `Too many sign-in requests. Try again in about ${RATE_LIMIT_WINDOW_MINUTES} minutes.` },
      { status: 429 }
    );
  }

  const token = createMagicLinkToken(email);
  // Build the link from the PUBLIC origin, not req.nextUrl.origin — behind a
  // tunnel or reverse proxy nextUrl reports the internal address
  // (localhost:3001), which would put a dead link in the email.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto =
    req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const verifyUrl = `${proto}://${host}/api/auth/verify?token=${encodeURIComponent(token)}`;

  // The 6-digit code travels in the same email as the link. It exists for
  // surfaces where following the link would land the session in the wrong
  // browser context (the native app shells) — the code can be typed anywhere.
  const code = generateAuthCode();
  const codeRow = {
    email,
    codeHash: hashAuthCode(email, code),
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    requestIp: ip,
  };

  if (isEmailConfigured()) {
    // Send first, persist second: the AuthCode row is also what the rate
    // limiter counts, so a failed send must not consume one of the user's
    // three slots — otherwise "try again" during a provider outage locks
    // them out.
    try {
      await sendMagicLinkEmail(email, verifyUrl, code);
    } catch (err) {
      console.error('[auth] sign-in email send failed', { email, err });
      return NextResponse.json(
        { error: "Our email provider isn't responding right now. Please try again in a few minutes." },
        { status: 502 }
      );
    }
    await createAuthCode(codeRow);
    return NextResponse.json({ sent: true });
  }

  // No email provider configured. In development, return the link and code
  // directly for local testing. In production this is a misconfiguration and
  // must fail closed — returning credentials here would let anyone sign in
  // as any email address.
  if (process.env.NODE_ENV === 'production') {
    console.error('[auth] no email provider configured (MOM_API_KEY+MOM_FROM_EMAIL or RESEND_API_KEY); refusing to expose sign-in credentials');
    return NextResponse.json(
      { error: 'Sign-in email is not configured on this server.' },
      { status: 500 }
    );
  }

  await createAuthCode(codeRow);
  return NextResponse.json({ devLoginUrl: verifyUrl, devLoginCode: code });
}
