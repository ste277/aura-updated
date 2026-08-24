import { NextRequest, NextResponse } from 'next/server';
import { parseJsonObject } from '../../../../lib/request';
import { findCity } from '../../../../lib/cities';
import { FULL_ACTIVITY_CATALOG } from '../../../../../../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../../../../../../packages/recommendation/src/activityDefinitions';
import { createGuestStateToken, verifyGuestStateToken, GuestStateTokenPayload } from '../../../../lib/guestState';
import { isIsoInstantString } from '../../../../lib/timingSearchRequest';
import { isRateLimited } from '../../../../lib/inMemoryRateLimit';

/**
 * Recipient Conversion V1 (brief section 10/24/25) -- mints and reads the
 * short-lived signed guest-state token that survives the magic-link auth
 * round trip. See lib/guestState.ts for the payload shape and why this is
 * a stateless token rather than a new DB table.
 *
 * POST: guest chose a result and clicked "Save this moment" -- validate the
 * shape (same allow-listed fields lib/guestState.ts's payload type defines,
 * nothing else) and mint a token.
 * GET:  the post-auth restore step (/find?restore=<token>) reads it back.
 */

const VALID_HORIZONS = new Set(['TODAY', 'TOMORROW', 'WEEKEND', 'SEVEN_DAYS']);
const VALID_TIME_PREFERENCES = new Set(['ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']);
const VALID_SOURCES = new Set(['AURA_MOMENT', 'DIRECT']);

function requestIp(req: NextRequest): string {
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  if (isRateLimited(`guest-state-create:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again in a moment.' }, { status: 429 });
  }

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const activityId = typeof body.activityId === 'string' ? body.activityId.trim() : '';
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId);
  const definition = activity ? getActivityDefinition(activity) : undefined;
  if (!activity || !definition || definition.experience.planningMode !== 'EVERYDAY') {
    return NextResponse.json({ error: 'Invalid activityId.' }, { status: 400 });
  }

  const horizon = String(body.horizon || '');
  if (!VALID_HORIZONS.has(horizon)) return NextResponse.json({ error: 'Invalid horizon.' }, { status: 400 });

  const timePreference = String(body.timePreference || 'ANY');
  if (!VALID_TIME_PREFERENCES.has(timePreference)) return NextResponse.json({ error: 'Invalid time preference.' }, { status: 400 });

  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 15 || durationMinutes > 180) {
    return NextResponse.json({ error: 'Invalid durationMinutes.' }, { status: 400 });
  }

  const cityName = typeof body.cityName === 'string' ? body.cityName.trim() : '';
  if (!findCity(cityName)) return NextResponse.json({ error: 'Unknown city.' }, { status: 400 });

  if (!isIsoInstantString(body.candidateStart) || !isIsoInstantString(body.candidateEnd)) {
    return NextResponse.json({ error: 'Invalid candidate start/end.' }, { status: 400 });
  }

  const source = String(body.source || 'DIRECT');
  if (!VALID_SOURCES.has(source)) return NextResponse.json({ error: 'Invalid source.' }, { status: 400 });

  const token = createGuestStateToken({
    activityId,
    horizon: horizon as GuestStateTokenPayload['horizon'],
    timePreference: timePreference as GuestStateTokenPayload['timePreference'],
    durationMinutes,
    cityName,
    candidateStart: body.candidateStart as string,
    candidateEnd: body.candidateEnd as string,
    source: source as GuestStateTokenPayload['source'],
  });

  return NextResponse.json({ token });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 });

  const payload = verifyGuestStateToken(token);
  if (!payload) return NextResponse.json({ error: 'expired' }, { status: 404 });

  return NextResponse.json(payload);
}
