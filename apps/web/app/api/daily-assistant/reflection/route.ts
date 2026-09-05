import { NextRequest, NextResponse } from 'next/server';
import { getDailyReflection, getUserById, upsertDailyReflection } from '../../../../lib/db';
import { getSessionFromRequest } from '../../../../lib/session';
import { parseJsonObject } from '../../../../lib/request';
import { getDatePartsInTimezone } from '../../../../lib/timezone';

const OUTPUT_LEVELS = new Set(['LOW', 'MODERATE', 'PEAK_FLOW']);

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const date = getReflectionDate(req.nextUrl.searchParams.get('date'), user.timezone);
  const reflection = await getDailyReflection(session.userId, date);
  return NextResponse.json(reflection);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const outputLevel = String(body?.outputLevel || '').toUpperCase();
  if (!OUTPUT_LEVELS.has(outputLevel)) {
    return NextResponse.json({ error: 'Invalid output level.' }, { status: 400 });
  }

  const reflection = await upsertDailyReflection({
    userId: session.userId,
    reflectionDate: getReflectionDate(typeof body?.date === 'string' ? body.date : null, user.timezone),
    outputLevel: outputLevel as 'LOW' | 'MODERATE' | 'PEAK_FLOW',
    followedGuidance: Boolean(body?.followedGuidance),
    notes: body?.notes ? String(body.notes).trim() : undefined,
  });

  return NextResponse.json(reflection);
}

/**
 * Insights Timezone Consistency V1 -- reflectionDate is chosen as a pure
 * semantic calendar date ("YYYY-MM-DD"), then encoded as literal UTC
 * midnight ONLY as a storage mechanism for the @db.Date column -- never
 * re-interpreted through any timezone afterward (db.ts's upsertDailyReflection/
 * getDailyReflection read/write this value verbatim).
 *
 * An explicit, validated `rawDate` (from a caller-supplied `body.date`/
 * `?date=` query param) remains authoritative when supplied -- unchanged
 * contract, still requires the exact "YYYY-MM-DD" shape, still silently
 * falls through to the default below on anything else (invalid input stays
 * fail-safe, matching prior behavior).
 *
 * When omitted -- today's only real caller, page.tsx's
 * handleSubmitReflection (POST, no `date` field) and its own GET fetch (no
 * query string) -- the fallback is now the OWNER'S Timing Location "today"
 * (getDatePartsInTimezone(timezone, now).dateStr), replacing the previous
 * `new Date().toISOString().slice(0,10)`: the server process's own UTC
 * date, which drifted from the user's real local "today" for any user not
 * near UTC+0, especially in the evening (brief section 6/15 of the prior
 * audit).
 */
function getReflectionDate(rawDate: string | null | undefined, timezone: string, now: Date = new Date()): Date {
  const dateKey = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : getDatePartsInTimezone(timezone, now).dateStr;
  return new Date(`${dateKey}T00:00:00.000Z`);
}
