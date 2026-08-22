import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getSavedPersonForOwner, getUserById } from '../../../../lib/db';
import { parseJsonObject } from '../../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser, natalContextFromBirthDetails } from '../../../../lib/natalContext';
import { findEverydaySharedTiming } from '../../../../../../packages/recommendation/src/everydayTimingFit';
import { isDateOnlyString } from '../../../../lib/timingSearchRequest';
import { recordProductEvent } from '../../../../lib/productEvents';
import { DailyAssistantContext } from '../../../../../../packages/recommendation/src/dailyAssistant';

/**
 * Product Structure V2 -- everyday SHARED timing search (brief section 12).
 * A thin HTTP wrapper around findEverydaySharedTiming(), the same pattern
 * every other search route in this app follows: no scoring logic here, just
 * request validation + server-side SavedPerson resolution.
 *
 * Deliberately a SEPARATE route from /api/muhurtham-search, not a new mode
 * on it -- findEverydaySharedTiming() is built on Timing Search's FIND, not
 * Muhurtham's occasion search, and calling it with a Muhurtham-eligible
 * activityId works fine (it's just Timing Search under the hood), so there
 * is no strictness concern in either direction.
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

  const activityId = typeof body.activityId === 'string' ? body.activityId.trim() : '';
  if (!activityId) return NextResponse.json({ error: 'activityId is required.' }, { status: 400 });

  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 360) {
    return NextResponse.json({ error: 'durationMinutes must be between 15 and 360.' }, { status: 400 });
  }

  let dateRange: { start: string; end: string } | undefined;
  if (body.dateRange !== undefined) {
    const raw = body.dateRange as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || !isDateOnlyString(raw.start) || !isDateOnlyString(raw.end)) {
      return NextResponse.json({ error: 'dateRange must be { start, end } as YYYY-MM-DD dates.' }, { status: 400 });
    }
    dateRange = { start: raw.start, end: raw.end };
  }
  const horizon = typeof body.horizon === 'string' ? (body.horizon as never) : undefined;
  if (!dateRange && !horizon) {
    return NextResponse.json({ error: 'Either dateRange or horizon is required.' }, { status: 400 });
  }

  const savedPersonId = typeof body.savedPersonId === 'string' ? body.savedPersonId.trim() : '';
  if (!savedPersonId) return NextResponse.json({ error: 'savedPersonId is required for shared timing search.' }, { status: 400 });

  // Ownership enforced here, at the route -- getSavedPersonForOwner() never
  // returns another user's row (same pattern as /api/muhurtham-search's own
  // SHARED handling).
  const person = await getSavedPersonForOwner(session.userId, savedPersonId);
  if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  const partnerContext = natalContextFromBirthDetails(formatUTCDateString(person.birthDate), person.birthTime, person.birthTimezone);

  const now = new Date();
  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };

  const startedAt = Date.now();
  const outcome = findEverydaySharedTiming({
    activityId,
    durationMinutes,
    dateRange,
    horizon,
    customStartDate: typeof body.customStartDate === 'string' ? body.customStartDate : undefined,
    customEndDate: typeof body.customEndDate === 'string' ? body.customEndDate : undefined,
    timePreference: typeof body.timePreference === 'string' ? (body.timePreference as never) : undefined,
    limit: typeof body.limit === 'number' ? body.limit : undefined,
    context,
    partnerContext,
  });

  if (outcome.status === 'UNSUPPORTED_ACTIVITY') {
    return NextResponse.json({ error: 'Unknown activityId.' }, { status: 400 });
  }

  void recordProductEvent({
    eventName: 'PLAN_SEARCH_COMPLETED',
    userId: session.userId,
    metadata: { mode: 'FIND', resultCount: outcome.candidates.length, durationMs: Date.now() - startedAt },
  });

  return NextResponse.json(outcome);
}
