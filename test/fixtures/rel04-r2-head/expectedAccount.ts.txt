import { NextRequest, NextResponse } from 'next/server';

/**
 * AURA-ANDROID-REL-04 IR-01 (R2) -- server-side account boundary for writes.
 *
 * The client states the account it is writing for in
 * `X-Aura-Expected-Account` (lib/accountSession.ts). That value is NEVER used
 * to decide who the caller is: authorization comes only from the signed
 * session cookie. It is a CONSTRAINT: a write whose session belongs to a
 * different account is refused (409) before the body is read or anything is
 * persisted.
 *
 * Bound write routes (activity logs, plan creation) also REQUIRE the header.
 * A request without it comes from a client loaded before this change. It is
 * refused with a non-cacheable 503 + `client_upgrade_required` -- decided
 * BEFORE authentication, so the same answer reaches an old tab whose session
 * has expired. Old clients classify 5xx as "retry later" and keep their
 * queued entries byte for byte (their 401/4xx handling would discard them).
 * Old replay runs only on page load and on the browser's `online` event, so
 * this cannot become a tight retry loop; Retry-After states the intent.
 * Nothing is written for an unbound request, and authentication is not
 * weakened: an upgraded client still needs a valid session.
 */
export const EXPECTED_ACCOUNT_HEADER_LC = 'x-aura-expected-account';
export const UPGRADE_REQUIRED_CODE = 'client_upgrade_required';
export const ACCOUNT_MISMATCH_CODE = 'account_mismatch';

const NO_STORE = { 'Cache-Control': 'no-store', Vary: 'Cookie, X-Aura-Expected-Account' };

export function expectedAccountOf(req: NextRequest): string {
  return req.headers.get(EXPECTED_ACCOUNT_HEADER_LC)?.trim() ?? '';
}

/** Step 1, BEFORE authentication: refuse an unbound write from an out-of-date client. */
export function refuseUnboundWrite(req: NextRequest): NextResponse | null {
  if (expectedAccountOf(req)) return null;
  return NextResponse.json(
    { error: 'This version of Aura is out of date. Reload to continue; nothing on this device was lost.', code: UPGRADE_REQUIRED_CODE },
    { status: 503, headers: { ...NO_STORE, 'Retry-After': '3600' } }
  );
}

/** Step 2, AFTER authentication: refuse a write whose session belongs to another account. */
export function refuseAccountMismatch(req: NextRequest, sessionUserId: string): NextResponse | null {
  const expected = expectedAccountOf(req);
  if (!expected || expected === sessionUserId) return null;
  return accountMismatchResponse();
}

export function accountMismatchResponse(): NextResponse {
  return NextResponse.json(
    { error: 'You are signed in to a different account. Nothing was saved.', code: ACCOUNT_MISMATCH_CODE },
    { status: 409, headers: NO_STORE }
  );
}
