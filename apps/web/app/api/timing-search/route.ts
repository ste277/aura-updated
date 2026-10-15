import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getUserById } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser } from '../../../lib/natalContext';
import { buildTimingSearchRequest } from '../../../lib/timingSearchRequest';
import { DailyAssistantContext } from '../../../../../packages/recommendation/src/dailyAssistant';
import { recordProductEvent } from '../../../lib/productEvents';
import { runTimingSearchWithDailyRhythm } from '../../../lib/timingSearchDailyRhythm';
import type { DailyRhythmPreferencesInput } from '../../../lib/dailyRhythmScheduling';

/**
 * The Timing Search API: a thin HTTP wrapper around runTimingSearch() (the
 * only calculation entry point -- no search/scoring logic is duplicated
 * here). Request validation lives in ../../../lib/timingSearchRequest.ts
 * (Next's route modules may only export HTTP handlers + a few config
 * options, so a testable pure validation function can't live in this file).
 *
 * buildPersonalMuhurtaContext() below shares its actual astronomy work with
 * ../muhurtham-search/route.ts and ../panchang/natal-chart/route.ts via
 * ../../../lib/natalContext.ts's natalContextFromBirthDetails() -- the
 * "collapse all three copies" consolidation flagged as future work in an
 * earlier PR, done as part of the Partner Profile Foundation PR (which needs
 * this same shared conversion for SavedPerson). resolveRequestNow() is still
 * duplicated from ../daily-assistant/slot-task/route.ts, since that route
 * must not be touched here.
 */

const MAX_CLIENT_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;

function resolveRequestNow(clientNow: unknown): Date {
  const serverNow = new Date();
  if (typeof clientNow !== 'string') return serverNow;

  const parsed = new Date(clientNow);
  if (Number.isNaN(parsed.getTime())) return serverNow;

  if (Math.abs(parsed.getTime() - serverNow.getTime()) > MAX_CLIENT_CLOCK_SKEW_MS) return serverNow;
  return parsed;
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const now = resolveRequestNow(body.clientNow);
  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };

  const startedAt = Date.now();
  const validated = buildTimingSearchRequest(body, context);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  // Daily Rhythm V1 PR DR4-B -- Find a Time integration. All real logic
  // (widen the search limit before runTimingSearch for an applicable FIND
  // request, soft-prefer/annotate its output afterward) lives in the pure,
  // directly-testable runTimingSearchWithDailyRhythm (lib/
  // timingSearchDailyRhythm.ts) -- this route stays a thin wrapper, same
  // convention timingSearchRequest.ts's own module doc comment already
  // establishes. runTimingSearch itself, its request/response shape, and
  // every other call path through it (Day Constructor, the legacy
  // slot-task route) are completely untouched.
  //
  // Same defaulting getDailyWorkPreferences (db.ts) itself applies --
  // inlined here since this route already has the full user row loaded,
  // with no need for a second query for the same three columns.
  const dailyRhythmPrefs: DailyRhythmPreferencesInput = {
    workStart: user.dailyRhythmWorkStart ?? null,
    workEnd: user.dailyRhythmWorkEnd ?? null,
    workDays: user.dailyRhythmWorkDays ?? [],
  };
  const result = runTimingSearchWithDailyRhythm(validated.request, user.timezone, dailyRhythmPrefs);

  void recordProductEvent({
    eventName: 'PLAN_SEARCH_COMPLETED',
    userId: session.userId,
    metadata: {
      mode: result.mode,
      resultCount: result.candidates.length,
      durationMs: Date.now() - startedAt,
    },
  });

  return NextResponse.json(result);
}
