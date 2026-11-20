import { NextRequest, NextResponse } from 'next/server';
import { createMagicLinkToken, generateAuthCode, hashAuthCode, AUTH_CODE_TTL_MS, emailLogRef } from '../../../../lib/auth';
import { errorForLog } from '../../../../lib/authLog';
import { reserveAuthCodeWithinQuota, releaseAuthCodeReservation } from '../../../../lib/db';
import { sendMagicLinkEmail, isEmailConfigured } from '../../../../lib/email';
import { readJsonObject } from '../../../../lib/request';
import { verifyGuestStateToken } from '../../../../lib/guestState';
import { magicLinksEnabled } from '../../../../lib/magicLinkGate';

// Sign-in requests allowed per email/IP per window — enough for a user who
// mistypes twice, low enough to make email-bombing and code-guessing via
// re-requests impractical.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_REQUESTS = 3;

function requestIp(req: NextRequest): string | null {
  // Only headers our own proxy sets can be trusted. nginx appends to
  // X-Forwarded-For (`$proxy_add_x_forwarded_for`), so its LEFTMOST entry is
  // whatever the client sent — using it would let anyone rotate the value to
  // bypass the per-IP limit, or spoof a victim's IP to lock them out.
  // X-Real-IP is set by nginx from $remote_addr, which the real_ip module has
  // already resolved to the true visitor via CF-Connecting-IP.
  return req.headers.get('x-real-ip')?.trim() || null;
}

export async function POST(req: NextRequest) {
  const parsed = await readJsonObject(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }
  const body = parsed.body;
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const rawEmail = body.email;
  if (!rawEmail || typeof rawEmail !== 'string' || rawEmail.length > 254 || !rawEmail.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  const email = rawEmail.trim().toLowerCase();

  const ip = requestIp(req);

  // AURA-AUTH-02 -- a magic link is minted ONLY in authorized local development
  // (lib/magicLinkGate.ts). Everywhere else no token is created, so none can be
  // emailed, returned or logged; sign-in uses the 6-digit code below.
  let verifyUrl: string | null = null;
  if (magicLinksEnabled()) {
    const token = createMagicLinkToken(email);
    // Build the link from the PUBLIC origin, not req.nextUrl.origin — behind a
    // tunnel or reverse proxy nextUrl reports the internal address
    // (localhost:3001), which would put a dead link in the email.
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
    const proto =
      req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    verifyUrl = `${proto}://${host}/api/auth/verify?token=${encodeURIComponent(token)}`;

    // Recipient Conversion V1 (brief section 10/24) -- if this sign-in was
    // triggered from the guest conversion flow at /find, thread the guest's
    // already-minted, short-lived state token through the magic link so the
    // GET /api/auth/verify click (which may land in a different browser
    // context than where the guest searched, e.g. a mail app's in-app
    // browser) can restore their result instead of dropping them on generic
    // Home. Re-verified here (not just shape-checked) so a malformed or
    // already-expired token is never embedded pointlessly. Without a link the
    // guest flow continues by code in the same page (find/GuestFindClient.tsx).
    const rawGuestStateToken = typeof body.guestStateToken === 'string' ? body.guestStateToken : '';
    if (rawGuestStateToken && rawGuestStateToken.length <= 2000 && verifyGuestStateToken(rawGuestStateToken)) {
      verifyUrl += `&guest=${encodeURIComponent(rawGuestStateToken)}`;
    }
  }

  // The 6-digit code is the sign-in credential in every deployed environment
  // (and travels alongside the link in local development); it can be typed
  // anywhere, including the native app shells.
  const code = generateAuthCode();
  const codeRow = {
    email,
    codeHash: hashAuthCode(email, code),
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    requestIp: ip,
  };

  // Reserve first, send second (AURA-AUTH-01). The quota check and this
  // request's AuthCode row are one atomic step, so concurrent requests can't
  // all pass the check before any of them is recorded. No lock is held while
  // the email is sent.
  const reservation = await reserveAuthCodeWithinQuota(codeRow, RATE_LIMIT_WINDOW_MINUTES, RATE_LIMIT_MAX_REQUESTS);
  if (!reservation.reserved) {
    console.warn('[auth] request-link rate-limited', { emailRef: emailLogRef(email), ip, recent: reservation.recent });
    return NextResponse.json(
      { error: `Too many sign-in requests. Try again in about ${RATE_LIMIT_WINDOW_MINUTES} minutes.` },
      { status: 429 }
    );
  }

  if (isEmailConfigured()) {
    try {
      await sendMagicLinkEmail(email, verifyUrl, code);
    } catch (err) {
      console.error('[auth] sign-in email send failed', { emailRef: emailLogRef(email), err: errorForLog(err) });
      // A failed send must not use up one of the user's three slots
      // (otherwise "try again" during a provider outage locks them out), so
      // release exactly this request's reservation.
      await releaseAuthCodeReservation(reservation.id).catch((releaseErr) => {
        console.error('[auth] could not release sign-in reservation', { emailRef: emailLogRef(email), err: errorForLog(releaseErr) });
      });
      return NextResponse.json(
        { error: "Our email provider isn't responding right now. Please try again in a few minutes." },
        { status: 502 }
      );
    }
    return NextResponse.json({ sent: true });
  }

  // No email provider configured. In development, return the link and code
  // directly for local testing. In production this is a misconfiguration and
  // must fail closed — returning credentials here would let anyone sign in
  // as any email address.
  if (process.env.NODE_ENV === 'production') {
    await releaseAuthCodeReservation(reservation.id).catch(() => {});
    console.error('[auth] no email provider configured (MOM_API_KEY+MOM_FROM_EMAIL or RESEND_API_KEY); refusing to expose sign-in credentials');
    return NextResponse.json(
      { error: 'Sign-in email is not configured on this server.' },
      { status: 500 }
    );
  }

  // Dev fallback (no email provider, not production): the code always; the link
  // only when the local magic-link gate is open.
  return NextResponse.json(verifyUrl ? { devLoginUrl: verifyUrl, devLoginCode: code } : { devLoginCode: code });
}
