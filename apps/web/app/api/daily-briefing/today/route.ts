import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { getDatePartsInTimezone, addDaysToDateStr } from '../../../../lib/timezone';
import { isValidCalendarDateString } from '../../../../../../packages/panchang/src/localDate';
import { generateAstroDailyBriefing } from '../../../../lib/dailyAstroBriefing';

/**
 * AURA DB2/DB3 -- Personalized Daily Briefing API.
 *
 * Consumes the merged DB1 engine (apps/web/lib/dailyAstroBriefing.ts)
 * UNCHANGED: this route resolves the authenticated user's own birth
 * profile + configured timezone + the requested local date, then calls
 * generateAstroDailyBriefing() once and returns its result as-is. It
 * never recomputes, re-interprets, or duplicates any part of the Gochar
 * calculation -- see dailyAstroBriefing.ts's own header comment for why
 * that engine is pure/deterministic and this route is its only caller.
 *
 * DB3 -- historical-date support: an optional `?date=YYYY-MM-DD` query
 * param (same ONE endpoint, per DB3's own ticket: "Do not create a
 * separate historical API"). Omitted -- the exact DB2 behavior,
 * unchanged, backward-compatible -- resolves to the user's own current
 * local date. Supplied -- strictly validated (exact "YYYY-MM-DD" shape,
 * calendrically real date) and bounded to
 * [today - MAX_HISTORICAL_DAYS_BACK, today] in the user's OWN configured
 * timezone (never the server's) -- generous enough for Insights V1's
 * only real need (yesterday) while staying a documented, bounded range
 * rather than an open-ended historical/future browser, per the ticket's
 * own explicit ask.
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

/** How far back `?date=` may reach, in days before the user's own
 * "today". Documented, bounded, generous for yesterday's briefing
 * (Insights V1's only real need) without becoming an open-ended
 * historical browser. */
const MAX_HISTORICAL_DAYS_BACK = 7;

function formatUTCDateString(dateInput: Date | string): string {
  if (typeof dateInput === 'string') return dateInput.split('T')[0];
  const year = dateInput.getUTCFullYear();
  const month = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveTodayLocalDate(timezone: string): string {
  return getDatePartsInTimezone(timezone, new Date()).dateStr;
}

type DateResolution = { status: 'OK'; localDate: string } | { status: 'INVALID_DATE' } | { status: 'DATE_OUT_OF_RANGE'; minDate: string; maxDate: string };

/**
 * Resolves the requested `?date=` (or, absent, "today") against the
 * user's OWN timezone -- never the server's. Lexicographic comparison on
 * "YYYY-MM-DD" strings is exact for calendar-date ordering (zero-padded,
 * fixed-width), so no Date-object arithmetic is needed for the range
 * check itself.
 */
function resolveRequestedLocalDate(rawDate: string | null, timezone: string): DateResolution {
  const today = resolveTodayLocalDate(timezone);
  if (!rawDate) return { status: 'OK', localDate: today };
  if (!isValidCalendarDateString(rawDate)) return { status: 'INVALID_DATE' };
  const minDate = addDaysToDateStr(today, -MAX_HISTORICAL_DAYS_BACK);
  if (rawDate < minDate || rawDate > today) return { status: 'DATE_OUT_OF_RANGE', minDate, maxDate: today };
  return { status: 'OK', localDate: rawDate };
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

    const dateResolution = resolveRequestedLocalDate(req.nextUrl.searchParams.get('date'), user.timezone);
    if (dateResolution.status === 'INVALID_DATE') {
      return NextResponse.json({ status: 'INVALID_INPUT', reason: 'INVALID_LOCAL_DATE' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (dateResolution.status === 'DATE_OUT_OF_RANGE') {
      return NextResponse.json(
        { status: 'INVALID_INPUT', reason: 'DATE_OUT_OF_RANGE', minDate: dateResolution.minDate, maxDate: dateResolution.maxDate },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    const localDate = dateResolution.localDate;

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

    // The engine's own INVALID_INPUT/CALCULATION_FAILED statuses should be
    // unreachable here specifically -- `localDate` has already passed this
    // route's own strict validation/range check above (resolveRequestedLocalDate),
    // and `timezone` is always the already-valid, server-stored user.timezone,
    // never client-suppliable -- so either case is treated the same: a
    // genuine, typed "unavailable right now" condition, distinct from an
    // incomplete profile.
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
