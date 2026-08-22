import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getUserById, User } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { localDateTimeToUTC, resolveTzOffsetMinutes } from '../../../lib/timezone';
import { handleTimingSearchBody } from '../../../lib/timingSearchRequest';
import { DailyAssistantContext } from '../../../../../packages/recommendation/src/dailyAssistant';
import { PersonalMuhurtaContext } from '../../../../../packages/recommendation/src/auraFitEngine';
import { getNatalChart } from '../../../../../packages/vedic/src/natalChart';
import { getNakshatra } from '../../../../../packages/vedic/src/panchangElements';

/**
 * The Timing Search API: a thin HTTP wrapper around runTimingSearch() (the
 * only calculation entry point -- no search/scoring logic is duplicated
 * here). Request validation lives in ../../../lib/timingSearchRequest.ts
 * (Next's route modules may only export HTTP handlers + a few config
 * options, so a testable pure validation function can't live in this file).
 *
 * buildPersonalMuhurtaContext()/RASHI_ELEMENT/resolveRequestNow() below are
 * intentionally duplicated from ../daily-assistant/slot-task/route.ts rather
 * than extracted into a shared module, because that route must not be
 * touched in this PR (see brief). Both copies are small and behavior-
 * identical; a future PR that actually re-routes slot-task through Timing
 * Search should collapse them.
 */

const MAX_CLIENT_CLOCK_SKEW_MS = 12 * 60 * 60 * 1000;

const RASHI_ELEMENT: Record<string, PersonalMuhurtaContext['moonElement']> = {
  Mesha: 'FIRE',
  Vrishabha: 'EARTH',
  Mithuna: 'AIR',
  Karka: 'WATER',
  Simha: 'FIRE',
  Kanya: 'EARTH',
  Tula: 'AIR',
  Vrishchika: 'WATER',
  Dhanu: 'FIRE',
  Makara: 'EARTH',
  Kumbha: 'AIR',
  Meena: 'WATER',
};

function formatUTCDateString(dateInput: Date | string): string {
  if (typeof dateInput === 'string') return dateInput.split('T')[0];
  const year = dateInput.getUTCFullYear();
  const month = String(dateInput.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildPersonalMuhurtaContext(user: User): PersonalMuhurtaContext | undefined {
  if (!user.birthDate || !user.birthTime || !user.birthTimezone) return undefined;

  const birthDateStr = formatUTCDateString(user.birthDate);
  const birthMomentUTC = localDateTimeToUTC(birthDateStr, user.birthTime, user.birthTimezone);
  const natalNakshatra = getNakshatra(birthMomentUTC);
  const chart = getNatalChart(birthMomentUTC);
  const moonPlacement = chart.find((graha) => graha.graha === 'Moon');

  return {
    natalNakshatraIndex: natalNakshatra.index,
    janmaNakshatra: natalNakshatra.name,
    janmaRashi: moonPlacement?.rashiName,
    moonElement: moonPlacement?.rashiName ? RASHI_ELEMENT[moonPlacement.rashiName] : undefined,
  };
}

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
    personalContext: buildPersonalMuhurtaContext(user),
  };

  const outcome = handleTimingSearchBody(body, context);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json(outcome.result);
}
