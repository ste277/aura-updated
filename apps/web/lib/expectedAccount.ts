import { NextRequest, NextResponse } from 'next/server';

/**
 * AURA-ANDROID-REL-04 IR-01 -- server-side account boundary for writes.
 *
 * The client sends the account it believes it is writing for in
 * `X-Aura-Expected-Account` (lib/accountSession.ts). That value is NEVER used
 * to decide who the caller is: authorization still comes only from the
 * signed session cookie. It is used as a CONSTRAINT: if the authenticated
 * session belongs to a different account (the user signed out, another tab
 * signed in as someone else, or a replay outlived its account), the write is
 * refused with 409 before the body is read or anything is persisted.
 *
 * `required` routes (activity logs, the only offline-replayed write) also
 * refuse a request without the header (428), so an out-of-date client can't
 * write outside the boundary.
 */
export const EXPECTED_ACCOUNT_HEADER_LC = 'x-aura-expected-account';

export function checkExpectedAccount(req: NextRequest, sessionUserId: string, { required }: { required: boolean }): NextResponse | null {
  const raw = req.headers.get(EXPECTED_ACCOUNT_HEADER_LC);
  const expected = raw?.trim() ?? '';
  if (!expected) {
    if (!required) return null;
    return NextResponse.json(
      { error: 'This page is out of date. Reload and try again.', code: 'expected_account_required' },
      { status: 428 }
    );
  }
  if (expected !== sessionUserId) {
    return NextResponse.json(
      { error: 'You are signed in to a different account. Nothing was saved.', code: 'account_mismatch' },
      { status: 409 }
    );
  }
  return null;
}
