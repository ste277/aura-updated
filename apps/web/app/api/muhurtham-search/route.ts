import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getUserById, User } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { localDateTimeToUTC, resolveTzOffsetMinutes } from '../../../lib/timezone';
import { handleMuhurthamSearchBody } from '../../../lib/muhurthamSearchRequest';
import { DailyAssistantContext } from '../../../../../packages/recommendation/src/dailyAssistant';
import { PersonalMuhurtaContext } from '../../../../../packages/recommendation/src/auraFitEngine';
import { getNatalChart } from '../../../../../packages/vedic/src/natalChart';
import { getNakshatra } from '../../../../../packages/vedic/src/panchangElements';

/**
 * The Muhurtham Finder API: a thin HTTP wrapper around findMuhurthams() (the
 * only calculation entry point -- no search/scoring logic is duplicated
 * here). Request validation lives in ../../../lib/muhurthamSearchRequest.ts
 * (Next's route modules may only export HTTP handlers).
 *
 * buildPersonalMuhurtaContext()/RASHI_ELEMENT below are intentionally
 * duplicated from ../timing-search/route.ts (itself duplicated from
 * ../daily-assistant/slot-task/route.ts) rather than extracted into a shared
 * module -- see timing-search/route.ts's own comment for why. A future PR
 * that consolidates these context-building helpers should collapse all three
 * copies at once.
 */

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
  // PERSONAL scope was actually requested. buildMuhurthamSearchRequest()
  // re-validates `scope` itself; this is just an early, cheap peek so the
  // natal chart is never computed for a GENERAL request.
  const requestsPersonalScope = body.scope === 'PERSONAL';
  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: requestsPersonalScope ? buildPersonalMuhurtaContext(user) : undefined,
  };

  const outcome = handleMuhurthamSearchBody(body, context);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json(outcome.result);
}
