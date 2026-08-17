import { NextRequest, NextResponse } from 'next/server';
import { createMagicLinkToken, generateAuthCode, hashAuthCode, AUTH_CODE_TTL_MS } from '../../../../lib/auth';
import { createAuthCode, countRecentAuthRequests } from '../../../../lib/db';
import { sendMagicLinkEmail } from '../../../../lib/email';

// Sign-in requests allowed per email/IP per window — enough for a user who
// mistypes twice, low enough to make email-bombing and code-guessing via
// re-requests impractical.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_REQUESTS = 3;

function requestIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  const ip = requestIp(req);
  const recent = await countRecentAuthRequests(email, ip, RATE_LIMIT_WINDOW_MINUTES);
  if (recent >= RATE_LIMIT_MAX_REQUESTS) {
    return NextResponse.json(
      { error: 'Too many sign-in requests. Wait a few minutes and try again.' },
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
  await createAuthCode({
    email,
    codeHash: hashAuthCode(email, code),
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    requestIp: ip,
  });

  // If RESEND_API_KEY is set, send a real email. Otherwise fall back to returning
  // the link and code directly — dev-only convenience for local testing without
  // an email provider configured.
  if (process.env.RESEND_API_KEY) {
    try {
      await sendMagicLinkEmail(email, verifyUrl, code);
      return NextResponse.json({ sent: true });
    } catch (err) {
      console.error('Failed to send magic link email:', err);
      return NextResponse.json({ error: 'Could not send the email. Try again.' }, { status: 502 });
    }
  }

  return NextResponse.json({ devLoginUrl: verifyUrl, devLoginCode: code });
}
