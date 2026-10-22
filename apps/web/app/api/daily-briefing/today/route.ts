import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { getDatePartsInTimezone } from '../../../../lib/timezone';
import { generateAstroDailyBriefing } from '../../../../lib/dailyAstroBriefing';

/**
 * AURA DB2 -- Personalized Daily Briefing API.
 *
 * Consumes the merged DB1 engine (apps/web/lib/dailyAstroBriefing.ts)
 * UNCHANGED: this route resolves the authenticated user's own birth
 * profile + configured timezone + "today" (in that timezone), then calls
 * generateAstroDailyBriefing() once and returns its result as-is. It
 * never recomputes, re-interprets, or duplicates any part of the Gochar
 * calculation -- see dailyAstroBriefing.ts's own header comment for why
 * that engine is pure/deterministic and this route is its only new
 * caller.
 *
 * `?date=` is deliberately NOT exposed yet (DB2's own ticket: "Keep the
 * API design compatible with a future ?date= parameter for DB3, but do
 * not add an unnecessary second endpoint... do not add it unless
 * needed" -- Home only ever needs today's briefing; DB3 owns the
 * Insights "yesterday" surface). `resolveTargetLocalDate` below is kept
 * as its own small function specifically so DB3 can extend it (e.g. an
 * optional, strictly-validated, bounded `searchParams.get('date')`
 * override) without restructuring this route.
 */

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  // DB2 brief section 1: "Prevent responses from being cached or shared
  // across users." This route is already session-cookie-gated (so a
  // shared HTTP cache could never serve one user's response to another
  // without also leaking the cookie), but these headers make that
  // guarantee explicit rather than implicit, matching the
  // `export const dynamic = 'force-dynamic'` segment config above.
  'Cache-Control': 'private, no-store, max-age=0',
} as const;

function formatUTCDateString(dateInput: Date | string): string {
  if (typeof dateInput === 'string') return dateInput.split('T')[0];
  const year = dateInput.getUTCFullYear();
  const month = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveTargetLocalDate(timezone: string): string {
  return getDatePartsInTimezone(timezone, new Date()).dateStr;
}

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ status: 'AUTH_REQUIRED', error: 'Not authenticated.' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    // Loads ONLY the requesting session's own user row -- getUserById is
    // keyed by session.userId, never by a client-suppliable id, so there
    // is no code path here that can return another user's birth details
    // (DB2 brief section 1: "Prevent access to another user's birth
    // information").
    const user = await getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ status: 'AUTH_REQUIRED', error: 'User not found.' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const localDate = resolveTargetLocalDate(user.timezone);

    const result = generateAstroDailyBriefing({
      birthDate: user.birthDate ? formatUTCDateString(user.birthDate) : null,
      birthTime: user.birthTime,
      birthTimezone: user.birthTimezone,
      birthLatitude: user.birthLatitude,
      birthLongitude: user.birthLongitude,
      localDate,
      timezone: user.timezone,
      currentLatitude: user.latitude,
      currentLongitude: user.longitude,
    });

    if (result.status === 'OK') {
      return NextResponse.json({ status: 'OK', briefing: result.briefing }, { headers: NO_STORE_HEADERS });
    }

    if (result.status === 'UNAVAILABLE') {
      // A normal, expected state (no/incomplete birth profile) -- 200,
      // not an error, with a typed reason the frontend switches on.
      return NextResponse.json({ status: 'UNAVAILABLE', reason: result.reason }, { headers: NO_STORE_HEADERS });
    }

    // INVALID_INPUT and CALCULATION_FAILED both indicate the engine could
    // not produce an interpretation for otherwise-valid input -- in THIS
    // route (no client-suppliable date/timezone yet), INVALID_INPUT
    // should be unreachable in practice (localDate/timezone are both
    // server-resolved from already-validated user data), so either case
    // is treated the same: a genuine, typed "unavailable right now"
    // condition, distinct from an incomplete profile.
    return NextResponse.json(
      { status: 'CALCULATION_UNAVAILABLE', reason: result.reason },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      { status: 'SERVER_ERROR', error: err instanceof Error ? err.message : 'Unexpected error.' },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
