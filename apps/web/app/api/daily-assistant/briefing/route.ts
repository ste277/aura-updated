import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser } from '../../../../lib/natalContext';
import { buildDailyBriefingResult } from '../../../../../../packages/recommendation/src/dailyAssistant';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const;

/**
 * PA-3C-C1B-03: the response is now a discriminated envelope instead of a
 * flat spread, so a legitimate solar no-event condition (polar day/night)
 * can be represented explicitly instead of crashing. Modeled on the
 * existing, separately-shipped apps/web/app/api/daily-briefing/today/
 * route.ts precedent's OK/UNAVAILABLE/CALCULATION_UNAVAILABLE shape, not
 * copied verbatim -- this route has no client-supplied date/location
 * input, so there is no INVALID_REQUEST case of its own; see
 * dailyAssistant.ts's buildDailyBriefingResult() for the exact error
 * mapping. UNAVAILABLE is 200 (a normal, expected outcome, matching the
 * precedent's own reasoning), CALCULATION_UNAVAILABLE is 503, and any
 * other thrown error still reaches the outer catch below as a genuine
 * 500 -- never silently absorbed into either typed status.
 */
export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ status: 'AUTH_REQUIRED', error: 'Not authenticated.' }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const user = await getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ status: 'AUTH_REQUIRED', error: 'User not found.' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const now = new Date();
    const result = buildDailyBriefingResult({
      now,
      latitude: user.latitude,
      longitude: user.longitude,
      timezone: user.timezone,
      tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    });

    if (result.status === 'OK') {
      // Home Good Right Now Personalization V1 -- the SAME derived
      // {natalNakshatraIndex, janmaNakshatra, janmaRashi, moonElement} shape
      // buildPersonalMuhurtaContextForUser() already produces for Ask Aura/
      // Timing Search/Day Builder (apps/web/lib/natalContext.ts), reused
      // verbatim here rather than a second Home-specific natal DTO. Never
      // the raw birthDate/birthTime/birthTimezone -- those never leave the
      // server for this feature (data minimization, matching every other
      // consumer of this same helper). Naturally `undefined` (omitted from
      // the JSON body) when the owner's birth profile is incomplete -- no
      // error, no special casing, exactly buildPersonalMuhurtaContextForUser's
      // own existing contract.
      const personalContext = buildPersonalMuhurtaContextForUser(user);
      return NextResponse.json({ status: 'OK', briefing: result.briefing, personalContext }, { headers: NO_STORE_HEADERS });
    }

    if (result.status === 'UNAVAILABLE') {
      return NextResponse.json(
        { status: 'UNAVAILABLE', reason: result.reason, solarCondition: result.solarCondition },
        { headers: NO_STORE_HEADERS }
      );
    }

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
