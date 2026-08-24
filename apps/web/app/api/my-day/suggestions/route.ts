import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { buildMyDay } from '../../../../lib/myDayOrchestrator';
import { buildIntentionalDaySuggestions } from '../../../../lib/dayBuilderOrchestrator';
import { getMinuteOfDayInTimezone } from '../../../../lib/timezone';
import { resolveRequestNow } from '../../../../lib/testTimeOverride';
import { recordProductEvent } from '../../../../lib/productEvents';

/**
 * Intentional Day Builder V1 (brief section 37) -- GET
 * /api/my-day/suggestions?date=YYYY-MM-DD, deliberately SEPARATE from
 * GET /api/my-day. Computing suggestions means calling the canonical
 * timing-search engines for a small handful of candidates (real, if cheap,
 * work) -- keeping that off GET /api/my-day preserves that route's own fast
 * render path unconditionally, on every load, for every user, whether or
 * not Day Builder ever renders anything. Reuses buildMyDay() for the
 * agenda itself (same bounded reads, not duplicated) rather than
 * re-fetching Plans/Moments/logs a second time.
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

  const now = resolveRequestNow(req);
  const startedAt = Date.now();
  const { agenda } = await buildMyDay(user, rawDate ?? undefined, now);
  const minuteOfDay = getMinuteOfDayInTimezone(user.timezone, now);
  const suggestions = await buildIntentionalDaySuggestions({ user, agenda, minuteOfDay, now });
  const durationMs = Date.now() - startedAt;

  if (suggestions.length > 0) {
    // suggestionCount is what's actually DISPLAYED (capped at 3, brief
    // section 18/19) -- suggestions itself may carry a small reserve pool
    // beyond that for the client's "Another idea" swap (see
    // dayBuilderOrchestrator.ts's own doc comment), which isn't a second
    // impression.
    void recordProductEvent({
      eventName: 'DAY_BUILDER_SUGGESTIONS_VIEWED',
      userId: session.userId,
      metadata: { suggestionCount: Math.min(3, suggestions.length) },
    });
  }

  return NextResponse.json({ suggestions, durationMs });
}
