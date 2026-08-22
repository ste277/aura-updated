import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getSavedPersonForOwner, getUserById, User } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../lib/timezone';
import { natalContextFromBirthDetails } from '../../../lib/natalContext';
import { handleMuhurthamSearchBody, handleSharedMuhurthamSearchBody } from '../../../lib/muhurthamSearchRequest';
import { DailyAssistantContext } from '../../../../../packages/recommendation/src/dailyAssistant';
import { PersonalMuhurtaContext } from '../../../../../packages/recommendation/src/auraFitEngine';

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

function buildPersonalMuhurtaContext(user: User): PersonalMuhurtaContext | undefined {
  if (!user.birthDate || !user.birthTime || !user.birthTimezone) return undefined;
  return natalContextFromBirthDetails(formatUTCDateString(user.birthDate), user.birthTime, user.birthTimezone);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const now = new Date();
  // GENERAL requests never need natal data (brief section 10) -- only
  // resolve/compute it (a real natal-chart calculation, not free) when
  // PERSONAL or SHARED scope was actually requested. buildMuhurthamSearchRequest()
  // re-validates `scope` itself; this is just an early, cheap peek so the
  // natal chart is never computed for a GENERAL request.
  const requestsNatalData = body.scope === 'PERSONAL' || body.scope === 'SHARED';
  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: requestsNatalData ? buildPersonalMuhurtaContext(user) : undefined,
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

    const sharedOutcome = handleSharedMuhurthamSearchBody(body, context, partner);
    if (!sharedOutcome.ok) return NextResponse.json({ error: sharedOutcome.error }, { status: sharedOutcome.status });
    return NextResponse.json(sharedOutcome.result);
  }

  const outcome = handleMuhurthamSearchBody(body, context);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json(outcome.result);
}
