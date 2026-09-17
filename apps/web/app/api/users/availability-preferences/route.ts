import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { parseJsonObject } from '../../../../lib/request';
import { getUserById, getUserAvailabilityConfiguration, replaceUserAvailabilityConfiguration, resetUserAvailabilityConfiguration } from '../../../../lib/db';
import { validateAvailabilityPeriodInput, type AvailabilityPeriodInput, type Weekday } from '../../../../lib/availabilityContext';
import { periodsOverlap } from '../../../../lib/availabilitySettings';

/**
 * Availability Settings V1 -- PR H2 API. Every operation is scoped
 * exclusively to `session.userId` (never accepted from the request body
 * -- this ticket's own section 28/30: "Never trust client userId").
 * `User.timezone` is likewise always the server's own already-
 * authenticated user record, never a client-submitted value.
 *
 * GET returns the authoritative read `AvailabilityConfiguration` PR H1
 * already defines (configured/periods) plus `timezone`, for Settings
 * display only -- this route never edits timezone itself (that remains
 * whichever existing screen already owns it, untouched here).
 *
 * PUT is REPLACE semantics (this ticket's own section 20/21): the
 * submitted `periods` array becomes the user's entire saved week,
 * atomically, via `replaceUserAvailabilityConfiguration`
 * (db.ts) -- never a per-row PATCH. An empty array is a valid,
 * deliberate "configured, every day empty" state (section 22), not an
 * error and not a reset.
 *
 * DELETE is Reset (this ticket's own section 23/29) -- the ONLY
 * operation that returns the user to UNCONFIGURED. Deliberately a
 * separate method/route from PUT with an empty body, so "save an empty
 * week" and "reset" can never be confused with one another at the
 * transport layer either.
 */

const MAX_PERIODS_PER_REQUEST = 100; // 7 weekdays worth of periods, generously bounded -- transport/input protection only, not a scheduling policy (mirrors dayConstructorPreviewRequest.ts's own MAX_INTENTS_PER_REQUEST convention).

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const configuration = await getUserAvailabilityConfiguration(session.userId);
  if (!configuration) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  return NextResponse.json({
    configured: configuration.configured,
    timezone: user.timezone,
    periods: configuration.periods.map((p) => ({ weekday: p.weekday, startTime: p.startTime, endTime: p.endTime })),
  });
}

function validateSubmittedPeriods(raw: unknown): { ok: true; periods: AvailabilityPeriodInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'periods must be an array.' };
  if (raw.length > MAX_PERIODS_PER_REQUEST) return { ok: false, error: `periods must contain at most ${MAX_PERIODS_PER_REQUEST} items.` };

  const periods: AvailabilityPeriodInput[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, error: `periods[${index}] must be an object.` };
    const record = entry as Record<string, unknown>;
    if (typeof record.weekday !== 'number' || typeof record.startTime !== 'string' || typeof record.endTime !== 'string') {
      return { ok: false, error: `periods[${index}] must have a numeric weekday and string startTime/endTime.` };
    }
    try {
      periods.push(validateAvailabilityPeriodInput({ weekday: record.weekday as Weekday, startTime: record.startTime, endTime: record.endTime }));
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : `periods[${index}] is invalid.` };
    }
  }

  // Overlap policy (this ticket's own section 17: reject overlapping,
  // accept touching) -- checked per weekday, same formula the client's
  // own validateWeekDraft (availabilitySettings.ts) already applies;
  // the server never trusts that client-side check alone.
  for (const weekday of [0, 1, 2, 3, 4, 5, 6] as const) {
    const sameDay = periods.filter((p) => p.weekday === weekday).sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
    for (let i = 0; i < sameDay.length - 1; i += 1) {
      if (periodsOverlap(sameDay[i], sameDay[i + 1])) {
        return { ok: false, error: `Two periods on the same weekday overlap: ${sameDay[i].startTime}–${sameDay[i].endTime} and ${sameDay[i + 1].startTime}–${sameDay[i + 1].endTime}.` };
      }
    }
  }

  return { ok: true, periods };
}

export async function PUT(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const validated = validateSubmittedPeriods(body.periods);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  await replaceUserAvailabilityConfiguration(session.userId, validated.periods);
  return NextResponse.json({ configured: true, periods: validated.periods });
}

export async function DELETE(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  await resetUserAvailabilityConfiguration(session.userId);
  return NextResponse.json({ configured: false });
}
