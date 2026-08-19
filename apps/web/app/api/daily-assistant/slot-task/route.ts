import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById, User } from '../../../../lib/db';
import { parseJsonObject } from '../../../../lib/request';
import { localDateTimeToUTC, resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { findOptimalTaskTimes, recommendTaskSlot, PlanningHorizon, TimePreference } from '../../../../../../packages/recommendation/src/dailyAssistant';
import { PersonalMuhurtaContext } from '../../../../../../packages/recommendation/src/auraFitEngine';
import { getNatalChart } from '../../../../../../packages/vedic/src/natalChart';
import { getNakshatra } from '../../../../../../packages/vedic/src/panchangElements';

/** Longest CUSTOM planning window. Comfortably beyond any real use (the UI
 *  offers today/week/month) while keeping the synchronous per-day search
 *  bounded — see the span check below. */
const MAX_CUSTOM_RANGE_DAYS = 90;
const MAX_TASK_TITLE_LENGTH = 200;
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 360;
const VALID_HORIZONS = new Set<PlanningHorizon>(['NOW', 'TODAY', 'TOMORROW', 'WEEKEND', 'SEVEN_DAYS', 'CUSTOM']);
const VALID_TIME_PREFERENCES = new Set<TimePreference>(['ANYTIME', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']);
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

  // Use the browser's clock to keep "today/tomorrow" labels aligned with the
  // UI, but ignore obviously stale/future values.
  if (Math.abs(parsed.getTime() - serverNow.getTime()) > MAX_CLIENT_CLOCK_SKEW_MS) return serverNow;
  return parsed;
}

function parseDateOnly(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, monthIndex, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex && date.getUTCDate() === day
    ? timestamp
    : null;
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const taskTitle = String(body?.taskTitle || '').trim();
  const durationMinutes = Number(body?.durationMinutes ?? 30);
  const rawHorizon = String(body?.horizon || 'TODAY') as PlanningHorizon;
  const horizon = VALID_HORIZONS.has(rawHorizon) ? rawHorizon : null;
  const customStartDate = body?.customStartDate ? String(body.customStartDate) : undefined;
  const customEndDate = body?.customEndDate ? String(body.customEndDate) : undefined;
  const rawTimePreference = String(body?.timePreference || 'ANYTIME') as TimePreference;
  const timePreference = VALID_TIME_PREFERENCES.has(rawTimePreference) ? rawTimePreference : null;
  const requestedStartMinute = body?.requestedStartMinute === undefined ? undefined : Number(body.requestedStartMinute);
  const customStartTimestamp = parseDateOnly(customStartDate);
  const customEndTimestamp = parseDateOnly(customEndDate);

  if (!taskTitle || taskTitle.length > MAX_TASK_TITLE_LENGTH) {
    return NextResponse.json({ error: 'A task title of up to 200 characters is required.' }, { status: 400 });
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
    return NextResponse.json({ error: `durationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.` }, { status: 400 });
  }
  if (requestedStartMinute !== undefined && (!Number.isFinite(requestedStartMinute) || requestedStartMinute < 0 || requestedStartMinute > 1439)) {
    return NextResponse.json({ error: 'requestedStartMinute must be between 0 and 1439.' }, { status: 400 });
  }
  if (!horizon) {
    return NextResponse.json({ error: 'Invalid planning horizon.' }, { status: 400 });
  }
  if (!timePreference) {
    return NextResponse.json({ error: 'Invalid time preference.' }, { status: 400 });
  }
  if (horizon === 'CUSTOM' && (!customStartDate || !customEndDate || customStartTimestamp === null || customEndTimestamp === null || customEndTimestamp < customStartTimestamp)) {
    return NextResponse.json({ error: 'A valid custom start and end date are required.' }, { status: 400 });
  }
  // Cap the span. findOptimalTaskTimes runs a full ephemeris computation plus
  // ~96 slot scorings per day, synchronously — an unbounded range (the date
  // strings alone allow year 0001 to 9999) blocks the single-threaded event
  // loop for hours and takes the whole site down from one request.
  if (horizon === 'CUSTOM') {
    const spanDays = (customEndTimestamp! - customStartTimestamp!) / 86_400_000;
    if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Custom range must be ${MAX_CUSTOM_RANGE_DAYS} days or fewer.` },
        { status: 400 }
      );
    }
  }

  const now = resolveRequestNow(body.clientNow);
  const assistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContext(user),
  };
  const recommendation = horizon === 'NOW'
    ? recommendTaskSlot(taskTitle, assistantContext, durationMinutes, requestedStartMinute)
    : findOptimalTaskTimes(taskTitle, assistantContext, durationMinutes, horizon, customStartDate, customEndDate, timePreference);

  return NextResponse.json(recommendation);
}
