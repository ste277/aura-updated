import { NextRequest, NextResponse } from 'next/server';
import { createMagicLinkToken } from '../../../../lib/auth';
import { sendMagicLinkEmail } from '../../../../lib/email';

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  const token = createMagicLinkToken(email);
  const origin = req.nextUrl.origin;
  const verifyUrl = `${origin}/api/auth/verify?token=${encodeURIComponent(token)}`;

  // If RESEND_API_KEY is set, send a real email. Otherwise fall back to returning
  // the link directly — dev-only convenience for local testing without an email
  // provider configured (also the only mode this build sandbox could exercise,
  // since it has no egress to api.resend.com — see README).
  if (process.env.RESEND_API_KEY) {
    try {
      await sendMagicLinkEmail(email, verifyUrl);
      return NextResponse.json({ sent: true });
    } catch (err) {
      console.error('Failed to send magic link email:', err);
      return NextResponse.json({ error: 'Could not send the email. Try again.' }, { status: 502 });
    }
  }

  return NextResponse.json({ devLoginUrl: verifyUrl });
}
