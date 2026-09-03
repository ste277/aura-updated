import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getSavedPersonForOwner, getUserById } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser, natalContextFromBirthDetails } from '../../../lib/natalContext';
import { handleMuhurthamSearchBody, handleSharedMuhurthamSearchBody, validateEventLocation } from '../../../lib/muhurthamSearchRequest';
import { DailyAssistantContext } from '../../../../../packages/recommendation/src/dailyAssistant';
import { recordProductEvent } from '../../../lib/productEvents';

/** Uniform result-count computation across GENERAL (always has `.dates`)
 * and PERSONAL/SHARED (a discriminated union where `.dates` only exists
 * when status === 'OK') outcome shapes, without per-scope branching. */
function muhurthamResultCount(result: { dates: unknown[] } | { status: string; dates?: unknown[] }): number {
  return 'dates' in result && Array.isArray(result.dates) ? result.dates.length : 0;
}

/**
 * The Muhurtham Finder API: a thin HTTP wrapper around findMuhurthams()/
 * findPersonalMuhurthams()/findSharedMuhurthams() (the only calculation
 * entry points -- no search/scoring logic is duplicated here). Request
 * validation lives in ../../../lib/muhurthamSearchRequest.ts (Next's route
 * modules may only export HTTP handlers).
 *
 * buildPersonalMuhurtaContext() below shares its actual astronomy work with
 * ../timing-search/route.ts and ../panchang/natal-chart/route.ts via
 * ../../../lib/natalContext.ts's natalContextFromBirthDetails() -- the
 * "collapse all three copies" consolidation flagged as future work in an
 * earlier PR, done as part of the Partner Profile Foundation PR (which needs
 * this same shared conversion for SavedPerson).
 *
 * SHARED scope resolves its SavedPerson HERE, not inside
 * muhurthamSearchRequest.ts or muhurthamFinder.ts (brief section 2: "Do not
 * accept raw partner birth details through the Finder request. Resolve
 * SavedPerson server-side with ownership enforcement.") -- getSavedPersonForOwner()
 * only ever returns a row owned by the authenticated session's userId (see
 * db.ts), so a savedPersonId belonging to a different user resolves to null
 * here exactly like it would from the People screen's own API, and this
 * route returns a plain 404 without ever revealing whether that id exists
 * for someone else (brief section 11).
 */

function formatUTCDateString(dateInput: Date | string): string {
  if (typeof dateInput === 'string') return dateInput.split('T')[0];
  const year = dateInput.getUTCFullYear();
  const month = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  // Event Location Search V1: an optional, request-local override of WHERE
  // this Muhurtham's Panchang/solar context is computed for -- never the
  // user's persistent Timing Location (never mutated here), and never the
  // birth/natal fields personalContext is built from below (see that
  // variable's own construction, untouched by this). Absent -> fall back to
  // the user's Timing Location, byte-identical to before this PR. Present
  // but invalid -> a 400, never a silent fallback (the caller explicitly
  // asked for a specific location; silently substituting a different one
  // would be more surprising than refusing the request).
  const eventLocationResult = validateEventLocation(body.eventLocation);
  if (!eventLocationResult.ok) return NextResponse.json({ error: eventLocationResult.error }, { status: 400 });
  const effectiveLocation = eventLocationResult.location ?? { cityName: user.cityName, latitude: user.latitude, longitude: user.longitude, timezone: user.timezone };

  const now = new Date();
  // GENERAL requests never need natal data (brief section 10) -- only
  // resolve/compute it (a real natal-chart calculation, not free) when
  // PERSONAL or SHARED scope was actually requested. buildMuhurthamSearchRequest()
  // re-validates `scope` itself; this is just an early, cheap peek so the
  // natal chart is never computed for a GENERAL request.
  const requestsNatalData = body.scope === 'PERSONAL' || body.scope === 'SHARED';
  const context: DailyAssistantContext = {
    now,
    latitude: effectiveLocation.latitude,
    longitude: effectiveLocation.longitude,
    timezone: effectiveLocation.timezone,
    // Must track the EFFECTIVE (possibly Event Location) timezone, not
    // always user.timezone -- a Kochi event context must never carry a
    // Dubai UTC offset (brief section 7).
    tzOffsetMinutes: resolveTzOffsetMinutes(effectiveLocation.timezone, now),
    // Natal/personal context is built from the user's BIRTH fields only
    // (buildPersonalMuhurtaContextForUser reads user.birthDate/birthTime/
    // birthTimezone exclusively -- see that function's own implementation),
    // never from `effectiveLocation` -- Event Location can never influence
    // Janma Nakshatra/Tara Bala, structurally, by construction.
    personalContext: requestsNatalData ? buildPersonalMuhurtaContextForUser(user) : undefined,
  };

  if (body.scope === 'SHARED') {
    const savedPersonId = typeof body.savedPersonId === 'string' ? body.savedPersonId.trim() : '';
    if (!savedPersonId) return NextResponse.json({ error: 'savedPersonId is required for SHARED scope.' }, { status: 400 });

    const person = await getSavedPersonForOwner(session.userId, savedPersonId);
    if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });

    const partner = {
      savedPersonId: person.id,
      name: person.name,
      context: natalContextFromBirthDetails(formatUTCDateString(person.birthDate), person.birthTime, person.birthTimezone),
    };

    const sharedStartedAt = Date.now();
    const sharedOutcome = handleSharedMuhurthamSearchBody(body, context, partner);
    if (!sharedOutcome.ok) return NextResponse.json({ error: sharedOutcome.error }, { status: sharedOutcome.status });

    void recordProductEvent({
      eventName: 'MUHURTHAM_SEARCH_COMPLETED',
      userId: session.userId,
      metadata: {
        scope: 'SHARED',
        activityId: typeof body.activityId === 'string' ? body.activityId.trim() : '',
        resultCount: muhurthamResultCount(sharedOutcome.result),
        durationMs: Date.now() - sharedStartedAt,
      },
    });
    return NextResponse.json(sharedOutcome.result);
  }

  const startedAt = Date.now();
  const outcome = handleMuhurthamSearchBody(body, context);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  void recordProductEvent({
    eventName: 'MUHURTHAM_SEARCH_COMPLETED',
    userId: session.userId,
    metadata: {
      scope: body.scope === 'PERSONAL' ? 'PERSONAL' : 'GENERAL',
      activityId: typeof body.activityId === 'string' ? body.activityId.trim() : '',
      resultCount: muhurthamResultCount(outcome.result),
      durationMs: Date.now() - startedAt,
    },
  });

  return NextResponse.json(outcome.result);
}
