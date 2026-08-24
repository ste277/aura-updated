import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getUserById } from '../../../lib/db';
import { buildMyDay } from '../../../lib/myDayOrchestrator';

/**
 * My Day V1 (brief section 41) -- GET /api/my-day?date=YYYY-MM-DD. Thin
 * orchestration only: auth, resolve the user, delegate to
 * lib/myDayOrchestrator.ts for the actual bounded reads + pure derivation.
 * No business logic here (brief: "Domain functions should derive. Do not
 * put business logic directly into route.ts").
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const rawDate = req.nextUrl.searchParams.get('date');
  if (rawDate && !DATE_RE.test(rawDate)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD.' }, { status: 400 });
  }

  const startedAt = Date.now();
  const { agenda, story, reflection, tomorrowPreview } = await buildMyDay(user, rawDate ?? undefined, new Date());
  const durationMs = Date.now() - startedAt;

  return NextResponse.json({ agenda, story, reflection, tomorrowPreview, durationMs });
}
